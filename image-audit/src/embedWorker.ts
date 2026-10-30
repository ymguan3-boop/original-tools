/// <reference lib="webworker" />
/**
 * DINOv2 影像分析 Worker
 * ---------------------------------------------------------------------
 * 所有耗時工作都放在這裡，主執行緒（UI）永遠不會被阻塞：
 *   1. 產生 480px 縮圖（清單顯示用，取代原本的原尺寸圖片）
 *   2. 產生 64×64 像素特徵（輔助相似度）
 *   3. 執行 DINOv2 推論，輸出正規化後的 384 維向量
 *
 * 兩點設計上的取捨（請勿隨便改回批次推論）：
 *   - 一次只推論一張：q8 量化模型的縮放參數是對整個張量（含 batch）計算的，
 *     同一張圖與不同鄰居併批會讓向量浮動約 0.7%，導致完全相同的照片拿不到
 *     100 分。逐張推論的結果可完全重現（cos = 1.000）。
 *   - 推論直接吃畫布像素，不經過「編碼 JPEG 再解回來」，省下一次編碼與解碼。
 *
 * 模型載入失敗時仍會回傳縮圖與像素特徵，讓程式可以退回「像素比對」模式。
 */
import { pipeline, env, RawImage } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/dinov2-small';
const DTYPE = 'q8';

/** 清單縮圖長邊上限（px），同時作為推論輸入 */
const THUMB_MAX_SIDE = 480;
const THUMB_QUALITY = 0.82;
/** 像素特徵取樣邊長 */
const SIG_SIZE = 64;

env.allowLocalModels = false;
env.useBrowserCache = true;

type AnyRecord = Record<string, unknown>;

const post = (message: AnyRecord, transfer: Transferable[] = []): void => {
  (self as unknown as { postMessage: (m: AnyRecord, t?: Transferable[]) => void }).postMessage(
    message,
    transfer
  );
};

let extractorPromise: Promise<unknown> | null = null;
/** 載入失敗後不再每批次重試（避免重複下載）；收到 init 時重置 */
let modelFailed = false;

function loadExtractor(): Promise<unknown> {
  if (!extractorPromise) {
    extractorPromise = pipeline('image-feature-extraction', MODEL_ID, {
      dtype: DTYPE,
      progress_callback: (p: AnyRecord) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          post({ type: 'model-progress', progress: Math.round(p.progress as number) });
        }
      },
    })
      .then((extractor) => {
        modelFailed = false;
        post({ type: 'ready' });
        return extractor;
      })
      .catch((err: unknown) => {
        post({ type: 'model-error', message: String((err as Error)?.message ?? err) });
        throw err;
      });
  }
  return extractorPromise;
}

/**
 * 單張推論：回傳正規化後的 CLS 向量（逐張推論，結果完全可重現）
 */
async function embedOne(extractor: unknown, image: RawImage): Promise<Float32Array> {
  const out = (await (extractor as (x: unknown) => Promise<AnyRecord>)([image])) as {
    data: Float32Array;
    dims: number[];
  };

  const dims = Array.from(out.dims ?? []);
  const hidden = dims[dims.length - 1] ?? 384;

  // CLS token 位於序列第 0 位
  const vec = new Float32Array(hidden);
  let norm = 0;
  for (let i = 0; i < hidden; i++) {
    const v = out.data[i];
    vec[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < hidden; i++) vec[i] /= norm;
  return vec;
}

/** 一次解碼，同時產出縮圖、64×64 像素特徵與推論用的畫布像素 */
async function prepareFile(file: File): Promise<{
  thumb: Blob;
  sig: Uint8ClampedArray;
  pixels: RawImage;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const tw = Math.max(1, Math.round(bitmap.width * scale));
    const th = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(tw, th);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, tw, th);

    // 推論直接用這張畫布的像素（省去 JPEG 編碼＋解碼）
    const pixels = RawImage.fromCanvas(canvas).rgb();

    const thumb = await canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY });

    const side = Math.min(bitmap.width, bitmap.height);
    const sigCanvas = new OffscreenCanvas(SIG_SIZE, SIG_SIZE);
    const sigCtx = sigCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    sigCtx.imageSmoothingQuality = 'high';
    sigCtx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      SIG_SIZE,
      SIG_SIZE
    );
    const sig = sigCtx.getImageData(0, 0, SIG_SIZE, SIG_SIZE).data;

    return { thumb, sig, pixels, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

type AnalyzeItem = { id: number; file: File };

async function handleAnalyze(batchId: number, items: AnalyzeItem[]): Promise<void> {
  let extractor: unknown = null;
  if (!modelFailed) {
    try {
      extractor = await loadExtractor();
    } catch {
      modelFailed = true;
      extractor = null;
    }
  }

  const results: {
    id: number;
    thumb: Blob;
    sig: Uint8ClampedArray;
    embedding: Float32Array | null;
    width: number;
    height: number;
  }[] = [];

  for (const item of items) {
    try {
      const { thumb, sig, pixels, width, height } = await prepareFile(item.file);

      let embedding: Float32Array | null = null;
      if (extractor) {
        try {
          embedding = await embedOne(extractor, pixels);
        } catch (err) {
          // 推論失敗：整批退回像素比對，避免部分項目有特徵、部分沒有
          modelFailed = true;
          post({ type: 'model-error', message: String((err as Error)?.message ?? err) });
          for (const r of results) r.embedding = null;
        }
      }

      results.push({ id: item.id, thumb, sig, embedding, width, height });
    } catch (err) {
      post({ type: 'item-error', id: item.id, message: String((err as Error)?.message ?? err) });
    }
  }

  const transfer: Transferable[] = [];
  for (const r of results) {
    transfer.push(r.sig.buffer as ArrayBuffer);
    if (r.embedding) transfer.push(r.embedding.buffer as ArrayBuffer);
  }

  post({ type: 'batch', batchId, results }, transfer);
}

(self as unknown as { onmessage: (e: MessageEvent) => void }).onmessage = async (event: MessageEvent) => {
  const msg = event.data as AnyRecord;
  if (!msg) return;

  if (msg.type === 'init') {
    modelFailed = false;
    extractorPromise = null;
    try {
      await loadExtractor();
    } catch {
      modelFailed = true;
      /* 失敗訊息已由 loadExtractor 回報 */
    }
    return;
  }

  if (msg.type === 'analyze') {
    const batchId = msg.batchId as number;
    const items = msg.items as AnalyzeItem[];
    try {
      await handleAnalyze(batchId, items);
    } catch (err) {
      post({ type: 'batch-error', batchId, message: String((err as Error)?.message ?? err) });
    }
  }
};
