import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import {
  FileImage, Play, CheckCircle, AlertTriangle, X, Loader2, Plus, Trash2, Zap,
  AlertCircle, BarChart3, Folder, Filter, ClipboardList, Eraser, ScanSearch,
  FileCheck, KeyRound, ExternalLink, Info, RefreshCw, Cpu, Sparkles,
} from 'lucide-react';

/* =====================================================================
 *  相似度引擎：DINOv2-small（在瀏覽器本機執行，免 API Key）
 *  - Transformers.js v4 + ONNX Runtime WASM
 *  - q8 量化模型約 23MB，首次使用時下載，之後由瀏覽器快取
 *  - 每張圖只推論一次，之後比對只是 384 維向量的餘弦相似度（瞬間完成）
 * ===================================================================== */
const DINO_MODEL_ID = 'Xenova/dinov2-small';
const DINO_DTYPE = 'q8';
/** DINOv2 原生輸入邊長 */
const DINO_INPUT_SIDE = 224;

/* =====================================================================
 *  文字說明引擎：OpenRouter（選配）
 *  - 僅用於第三步「差異度說明 + 分析結論」，未填金鑰時改用規則模板
 *  - 金鑰只存在瀏覽器 localStorage，請求由瀏覽器直送 OpenRouter
 * ===================================================================== */
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_KEYS_PAGE = 'https://openrouter.ai/keys';
const DEFAULT_TEXT_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const PREFERRED_MODELS = [
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-31b-it:free',
  'thinkingmachines/inkling:free',
  'dots-studio/dots-3-note-preview:free',
  'openrouter/free',
];
const REQUEST_GAP_MS = 3200;
const MAX_ATTEMPTS = 3;

const KEY_STORAGE = 'image-audit:openrouter-key';
const MODEL_STORAGE = 'image-audit:openrouter-model';
const TOPN_STORAGE = 'image-audit:top-n';

/* 送給 OpenRouter 的圖片縮圖上限 */
const SEND_MAX_SIDE = 1024;
const JPEG_QUALITY = 0.85;

/* ------------------------------- 型別 ------------------------------- */

interface ImageFolder {
  id: number;
  name: string;
  files: File[];
}

interface PixelSample {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type AnalysisSource = 'dino' | 'ai' | 'rule' | null;

interface MatchItem {
  id: string;
  similarity: number;
  fileA: File;
  fileB: File;
  sourceA: string;
  sourceB: string;
  /** DINOv2 特徵相似度 0~100（原 AI 分數欄位） */
  aiScore: number | null;
  aiAnalysis: string | null;
  analysisSource: AnalysisSource;
}

interface RangeConfig {
  key: string;
  label: string;
  min: number;
  max: number;
  color: string;
  bg: string;
  border: string;
}

interface OpenRouterModel {
  id: string;
  name: string;
}

interface ApiError extends Error {
  status?: number;
}

/* ----------------------------- 輔助函式 ----------------------------- */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 將 File 轉為 Data URL（Word 報告內嵌圖片用） */
const fileToDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('讀取檔案失敗'));
  });

/** 縮圖並轉為 JPEG Data URL */
const fileToJpegDataUrl = (
  file: File,
  maxSide: number,
  quality = JPEG_QUALITY
): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('瀏覽器不支援 Canvas');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        reject(e as Error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`無法讀取圖片：${file.name}`));
    };
    img.src = url;
  });

/** 中心裁切取樣，產生 64×64 像素特徵 */
const sampleImage = (file: File, sampleSize = 64): Promise<PixelSample> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('瀏覽器不支援 Canvas');
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, sampleSize, sampleSize);
        const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
        resolve({ data, width: sampleSize, height: sampleSize });
      } catch (e) {
        reject(e as Error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`無法讀取圖片：${file.name}`));
    };
    img.src = url;
  });

/** 像素級相似度（0~100） */
const calculateSimilarity = (a: PixelSample, b: PixelSample): number => {
  let diff = 0;
  const totalPixels = a.data.length / 4;
  for (let i = 0; i < a.data.length; i += 4) {
    const r = Math.abs(a.data[i] - b.data[i]);
    const g = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const bl = Math.abs(a.data[i + 2] - b.data[i + 2]);
    diff += (r + g + bl) / (255 * 3);
  }
  return 100 - (diff / totalPixels) * 100;
};

/** 餘弦相似度（自行計算正規化，避免上游 normalize 行為差異） */
const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
};

/** 圖片預覽 URL 快取，避免每次 render 都新建 ObjectURL（記憶體洩漏） */
const urlCache = new WeakMap<File, string>();
const fileUrl = (file: File): string => {
  let url = urlCache.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    urlCache.set(file, url);
  }
  return url;
};

const isFatalApiError = (error: ApiError): boolean =>
  [401, 402, 403, 404, 429].includes(error.status ?? -1);

/* --------------------------- 相似度分區設定 --------------------------- */

const RANGE_CONFIG: RangeConfig[] = [
  { key: '95-100', label: '95-100%', min: 95, max: 101, color: 'text-red-700', bg: 'bg-red-100', border: 'border-red-200' },
  { key: '90-94',  label: '90-94%',  min: 90, max: 95,  color: 'text-red-600', bg: 'bg-red-50',  border: 'border-red-200' },
  { key: '85-89',  label: '85-89%',  min: 85, max: 90,  color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  { key: '80-84',  label: '80-84%',  min: 80, max: 85,  color: 'text-orange-500', bg: 'bg-orange-50/50', border: 'border-orange-100' },
  { key: '60-79',  label: '60-79%',  min: 60, max: 80,  color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  { key: '50-59',  label: '50-59%',  min: 50, max: 60,  color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200' },
];

/** 依 DINOv2 與像素分數產生規則版差異說明（免 API Key） */
const buildRuleText = (item: MatchItem): string => {
  const d = item.aiScore;
  const p = item.similarity;

  if (d === null) {
    return `1. 差異度說明：像素相似度 ${p}%，尚未進行 DINOv2 特徵比對，無法判定語意層級差異。\n2. 分析結論：建議先執行第二步「相似度分析」後再進行判定。`;
  }

  const head = `DINOv2 特徵相似度 ${d}%、像素相似度 ${p}%。`;

  if (d >= 97 && p >= 88) {
    return `1. 差異度說明：${head}兩張影像在全域特徵與像素分佈上幾乎完全一致，研判為同一張照片，差異僅可能來自重新壓縮或浮水印。\n2. 分析結論：高度風險，極可能為重複使用同一張照片，建議調閱原始檔（含 EXIF 拍攝時間）確認。`;
  }
  if (d >= 94 && p >= 70) {
    return `1. 差異度說明：${head}主體、構圖與場景高度一致，像素差異主要來自裁切、縮放、光線或壓縮失真。\n2. 分析結論：中高度風險，可能為同一張照片裁切或調色後重複使用，建議與施工日誌及拍攝時間比對。`;
  }
  if (d >= 90) {
    return `1. 差異度說明：${head}場景與主要結構相同，但像素分佈差異明顯，研判為同一地點之不同角度或不同時間拍攝。\n2. 分析結論：中低風險，屬同一工地之不同照片，仍須以拍攝時間與施工進度確認是否重複計價。`;
  }
  if (d >= 80) {
    return `1. 差異度說明：${head}構圖或場景部分相似，惟細節特徵差異明顯，應為不同影像。\n2. 分析結論：低風險，研判為不同照片。`;
  }
  return `1. 差異度說明：${head}兩張影像在整體特徵上差異明顯。\n2. 分析結論：研判為不同照片，無重複請款疑慮。`;
};

/* =============================== App =============================== */

const App = () => {
  // --- 本地模型狀態 ---
  const [dinoState, setDinoState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [dinoProgress, setDinoProgress] = useState(0);
  const [dinoError, setDinoError] = useState<string | null>(null);
  const extractorRef = useRef<any>(null);
  const embeddingCache = useRef(new WeakMap<File, Float32Array>());

  // --- 文字引擎設定 ---
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? '');
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_TEXT_MODEL);
  const [topN, setTopN] = useState(() => Number(localStorage.getItem(TOPN_STORAGE) ?? 20));
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // --- 資料 ---
  const [folders, setFolders] = useState<ImageFolder[]>([]);
  const [threshold, setThreshold] = useState(50);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });

  const [results, setResults] = useState<MatchItem[]>([]);
  const [filteredResults, setFilteredResults] = useState<MatchItem[]>([]);
  const [selectedRanges, setSelectedRanges] = useState<Set<string>>(new Set());
  const [selectedResult, setSelectedResult] = useState<MatchItem | null>(null);

  // --- AI 狀態 ---
  const [isScoring, setIsScoring] = useState(false);
  const [scoreProgress, setScoreProgress] = useState({ done: 0, total: 0, label: '' });
  const [analyzingAiIds, setAnalyzingAiIds] = useState<Set<string>>(new Set());
  const [apiError, setApiError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // --- 刪除門檻（DINOv2 分數分佈約 80~99，故預設 90）---
  const [pixelDeleteThreshold, setPixelDeleteThreshold] = useState(70);
  const [aiDeleteThreshold, setAiDeleteThreshold] = useState(90);

  useEffect(() => {
    if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
    else localStorage.removeItem(KEY_STORAGE);
  }, [apiKey]);

  useEffect(() => localStorage.setItem(MODEL_STORAGE, model), [model]);
  useEffect(() => localStorage.setItem(TOPN_STORAGE, String(topN)), [topN]);

  /* ---------------------- DINOv2 模型載入 ---------------------- */

  const ensureExtractor = async (): Promise<any> => {
    if (extractorRef.current) return extractorRef.current;

    setDinoState('loading');
    setDinoProgress(0);
    setDinoError(null);

    try {
      const tf: any = await import('@huggingface/transformers');
      tf.env.allowLocalModels = false;
      tf.env.useBrowserCache = true;

      const extractor = await tf.pipeline('image-feature-extraction', DINO_MODEL_ID, {
        dtype: DINO_DTYPE,
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && typeof p.progress === 'number') {
            setDinoProgress(Math.round(p.progress));
          }
        },
      });

      extractorRef.current = extractor;
      setDinoState('ready');
      return extractor;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setDinoState('error');
      setDinoError(msg);
      throw new Error(`DINOv2 模型載入失敗（首次使用需下載約 23MB）：${msg}`);
    }
  };

  /** 取得單張圖片的 384 維特徵向量（含快取） */
  const embedFile = async (extractor: any, file: File): Promise<Float32Array> => {
    const cached = embeddingCache.current.get(file);
    if (cached) return cached;

    const dataUrl = await fileToJpegDataUrl(file, DINO_INPUT_SIDE, 0.92);
    const out = await extractor(dataUrl);
    const dims: number[] = Array.from(out.dims ?? [0, 0, 0]);
    const hidden = dims[dims.length - 1] || 384;
    const cls = new Float32Array(out.data.slice(0, hidden));
    embeddingCache.current.set(file, cls);
    return cls;
  };

  /* ---------------------- OpenRouter 文字生成 ---------------------- */

  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const res = await fetch(OPENROUTER_MODELS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          name: string;
          pricing?: { prompt?: string; completion?: string };
          architecture?: { input_modalities?: string[] };
        }>;
      };

      const free = (json.data ?? [])
        .filter((m) => {
          const p = m.pricing ?? {};
          const isFree = Number(p.prompt ?? 1) === 0 && Number(p.completion ?? 1) === 0;
          const hasImage = (m.architecture?.input_modalities ?? []).includes('image');
          return isFree && hasImage;
        })
        .map((m) => ({ id: m.id, name: m.name.replace(/\s*\(free\)$/i, '') }));

      free.sort((a, b) => {
        const ia = PREFERRED_MODELS.indexOf(a.id);
        const ib = PREFERRED_MODELS.indexOf(b.id);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.name.localeCompare(b.name);
      });

      setModels(free);
      if (free.length > 0 && !free.some((m) => m.id === model)) {
        setModel(free.some((m) => m.id === DEFAULT_TEXT_MODEL) ? DEFAULT_TEXT_MODEL : free[0].id);
      }
    } catch (e) {
      console.error('讀取模型清單失敗', e);
      setModels(PREFERRED_MODELS.map((id) => ({ id, name: id })));
    } finally {
      setIsLoadingModels(false);
    }
  }, [model]);

  useEffect(() => {
    void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const callOpenRouter = async (prompt: string, item: MatchItem): Promise<string> => {
    const [imageA, imageB] = await Promise.all([
      fileToJpegDataUrl(item.fileA, SEND_MAX_SIDE),
      fileToJpegDataUrl(item.fileB, SEND_MAX_SIDE),
    ]);

    const body = {
      model,
      messages: [
        {
          role: 'system',
          content:
            '你是嚴謹的工程影像稽核專家。只能依據圖片中實際可見的內容作答，不臆測、不編造，並使用繁體中文。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageA } },
            { type: 'image_url', image_url: { url: imageB } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 1200,
      stream: false,
    };

    let lastError: ApiError = new Error('呼叫失敗');

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetch(OPENROUTER_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey.trim()}`,
            'HTTP-Referer': window.location.href,
            'X-Title': 'original-tools / 工程照片 AI 交叉稽核系統',
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastError = new Error('無法連線至 OpenRouter，請檢查網路：' + (err as Error).message);
        lastError.status = 0;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(2000 * attempt);
          continue;
        }
        throw lastError;
      }

      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        /* 非 JSON 回應 */
      }

      if (res.ok) {
        const message = data?.choices?.[0]?.message;
        const content: string | undefined = message?.content;
        if (content && content.trim()) return content.trim();
        if (typeof message?.reasoning === 'string' && message.reasoning.trim()) return message.reasoning.trim();
        throw new Error('模型未回傳內容（可能達到 token 上限或觸發安全過濾），請重試或換一個模型。');
      }

      const status = res.status;
      const apiMessage = data?.error?.message || raw || `HTTP ${status}`;
      const err: ApiError = new Error(apiMessage);
      err.status = status;

      if (status === 401) err.message = 'OpenRouter API Key 無效或已撤銷（401），請重新輸入。';
      if (status === 402) err.message = 'OpenRouter 額度不足（402）。若使用免費模型，請確認帳號仍有免費額度。';
      if (status === 403) err.message = `請求被拒絕（403）：${apiMessage}`;
      if (status === 404) err.message = `模型不存在或已下架（404）：${model}，請改選其他模型。`;
      if (status === 429) err.message = '請求過於頻繁（429），免費模型每分鐘約 20 次上限。';
      if (status >= 500) err.message = `OpenRouter 或上游服務暫時異常（${status}），請稍後重試。`;
      lastError = err;

      if ((status === 429 || status >= 500) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * attempt);
        continue;
      }
      throw err;
    }

    throw lastError;
  };

  /* ---------------------- 資料夾操作 ---------------------- */

  const addFolder = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;

    const newFiles = Array.from(picked).filter((f) => f.type.startsWith('image/'));
    if (newFiles.length === 0) {
      alert('此資料夾內沒有可用的圖片檔（支援 JPG / PNG / WebP 等）。');
      e.target.value = '';
      return;
    }

    const relativePath = (newFiles[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
    const folderName = relativePath ? relativePath.split('/')[0] : `資料夾 ${folders.length + 1}`;

    setFolders((prev) => [...prev, { id: Date.now(), name: folderName, files: newFiles }]);
    e.target.value = '';
  };

  const removeFolder = (id: number) => setFolders((prev) => prev.filter((f) => f.id !== id));

  /* ---------------------- Step 0：像素初篩 ---------------------- */

  const startCrossAnalysis = async () => {
    if (folders.length < 2) {
      alert('請至少加入兩個資料夾以進行交叉比對');
      return;
    }

    setIsProcessing(true);
    setResults([]);
    setFilteredResults([]);
    setSelectedRanges(new Set());
    setApiError(null);

    try {
      const totalFiles = folders.reduce((acc, f) => acc + f.files.length, 0);
      setProgress({ current: 0, total: totalFiles, status: '正在建立圖片特徵索引...' });

      const samples: Record<number, Array<{ file: File; sample: PixelSample }>> = {};
      let processed = 0;

      for (const folder of folders) {
        samples[folder.id] = [];
        for (const file of folder.files) {
          try {
            samples[folder.id].push({ file, sample: await sampleImage(file) });
          } catch (err) {
            console.warn('略過無法讀取的圖片', file.name, err);
          }
          processed++;
          setProgress({ current: processed, total: totalFiles, status: `讀取特徵：${folder.name}` });
        }
      }

      const detected: MatchItem[] = [];
      let done = 0;
      let total = 0;
      for (let i = 0; i < folders.length; i++) {
        for (let j = i + 1; j < folders.length; j++) {
          total += folders[i].files.length * folders[j].files.length;
        }
      }

      for (let i = 0; i < folders.length; i++) {
        for (let j = i + 1; j < folders.length; j++) {
          const folderA = folders[i];
          const folderB = folders[j];

          for (const a of samples[folderA.id] ?? []) {
            for (const b of samples[folderB.id] ?? []) {
              done++;
              if (done % 100 === 0) {
                setProgress({
                  current: done,
                  total,
                  status: `正在交叉比對：${folderA.name} vs ${folderB.name}`,
                });
                await sleep(0);
              }

              const similarity = calculateSimilarity(a.sample, b.sample);
              if (similarity >= threshold) {
                detected.push({
                  id: `${folderA.id}-${folderB.id}-${a.file.name}-${b.file.name}`,
                  similarity: Number(similarity.toFixed(2)),
                  fileA: a.file,
                  fileB: b.file,
                  sourceA: folderA.name,
                  sourceB: folderB.name,
                  aiScore: null,
                  aiAnalysis: null,
                  analysisSource: null,
                });
              }
            }
          }
        }
      }

      detected.sort((a, b) => b.similarity - a.similarity);
      setResults(detected);
      alert(`交叉比對分析完成！共發現 ${detected.length} 組相似照片。`);
    } catch (error) {
      console.error(error);
      alert('分析失敗：' + (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  /* ---------------------- Step 1：像素刪除 ---------------------- */

  const deleteLowPixelSimilarity = () => {
    if (results.length === 0) return alert('目前無任何對照組資料可刪除。');

    const toDelete = results.filter((r) => r.similarity < pixelDeleteThreshold).length;
    if (toDelete === 0) {
      return alert(`目前清單中沒有像素相似度「低於 ${pixelDeleteThreshold}%」的資料，因此無須刪除。`);
    }

    const next = results.filter((r) => r.similarity >= pixelDeleteThreshold);
    setResults(next);
    setSelectedRanges(new Set());
    setFilteredResults(next);

    setTimeout(() => {
      alert(`刪除完成！\n已刪除 ${toDelete} 筆資料。\n剩餘 ${next.length} 筆資料（已更新至下方列表）。`);
    }, 100);
  };

  /* ---------------------- 篩選與統計 ---------------------- */

  useEffect(() => {
    if (results.length === 0) {
      setFilteredResults([]);
      return;
    }
    if (selectedRanges.size === 0) {
      setFilteredResults(results);
      return;
    }
    setFilteredResults(
      results.filter((r) =>
        [...selectedRanges].some((key) => {
          const c = RANGE_CONFIG.find((x) => x.key === key);
          return c ? r.similarity >= c.min && r.similarity < c.max : false;
        })
      )
    );
  }, [results, selectedRanges]);

  const stats = (() => {
    const acc: Record<string, number> = {};
    RANGE_CONFIG.forEach((c) => (acc[c.key] = 0));
    results.forEach((r) => {
      const c = RANGE_CONFIG.find((x) => r.similarity >= x.min && r.similarity < x.max);
      if (c) acc[c.key]++;
    });
    return acc;
  })();

  const toggleRangeFilter = (key: string) => {
    setSelectedRanges((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const removeResult = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  /* ---------------------- Step 2-1：DINOv2 相似度 ---------------------- */

  const runStep2_1_DinoScore = async () => {
    const targets = results.filter((r) => r.aiScore === null);
    if (targets.length === 0) return alert('目前清單中的所有項目皆已完成相似度分析。');

    setIsScoring(true);
    setApiError(null);
    setScoreProgress({ done: 0, total: targets.length, label: '載入模型...' });

    try {
      const extractor = await ensureExtractor();

      // 只對「唯一的圖片」推論一次
      const seen = new Set<File>();
      const unique: File[] = [];
      targets.forEach((t) =>
        [t.fileA, t.fileB].forEach((f) => {
          if (!seen.has(f)) {
            seen.add(f);
            unique.push(f);
          }
        })
      );

      const embeddings = new Map<File, Float32Array>();
      for (let i = 0; i < unique.length; i++) {
        setScoreProgress({
          done: i,
          total: unique.length,
          label: `建立特徵向量 ${i + 1} / ${unique.length}`,
        });
        try {
          embeddings.set(unique[i], await embedFile(extractor, unique[i]));
        } catch (err) {
          console.warn('特徵抽取失敗', unique[i].name, err);
        }
        if (i % 5 === 4) await sleep(0); // 讓 UI 有機會更新
      }

      const scores = new Map<string, number>();
      for (const t of targets) {
        const a = embeddings.get(t.fileA);
        const b = embeddings.get(t.fileB);
        if (!a || !b) continue;
        const cos = cosineSimilarity(a, b);
        scores.set(t.id, clamp(Math.round(cos * 1000) / 10, 0, 100));
      }

      setResults((prev) =>
        prev.map((r) => (scores.has(r.id) ? { ...r, aiScore: scores.get(r.id)!, analysisSource: 'dino' } : r))
      );

      const done = scores.size;
      setTimeout(() => {
        alert(
          `DINOv2 相似度分析完成！\n已評分 ${done} 組` +
            (done < targets.length ? `（${targets.length - done} 組因圖片讀取失敗略過）` : '') +
            '。'
        );
      }, 100);
    } catch (error) {
      console.error(error);
      setApiError(`⚠️ ${(error as Error).message}`);
    } finally {
      setIsScoring(false);
      setScoreProgress({ done: 0, total: 0, label: '' });
    }
  };

  /* ---------------------- Step 2-2：依分數刪除 ---------------------- */

  const runStep2_2_DeleteLowAi = () => {
    if (!results.some((r) => r.aiScore !== null)) {
      return alert('尚未進行相似度分析（Step 2-1），系統無法判斷哪些需要刪除。\n\n請先點擊「1. 相似度分析」。');
    }

    const toDelete = results.filter((r) => r.aiScore !== null && r.aiScore < aiDeleteThreshold).length;
    if (toDelete === 0) {
      return alert(`目前沒有相似度低於 ${aiDeleteThreshold}% 的項目，因此無須刪除。`);
    }

    setResults((prev) => prev.filter((r) => r.aiScore === null || r.aiScore >= aiDeleteThreshold));

    setTimeout(() => {
      alert(`篩選刪除完成！\n已刪除 ${toDelete} 筆資料。`);
    }, 100);
  };

  /* ---------------------- Step 3：差異說明與結論 ---------------------- */

  const runStep3_GenerateText = async () => {
    if (results.length === 0) return alert('無資料可分析');

    const targets = results.filter((r) => r.aiAnalysis === null);
    if (targets.length === 0) return alert('目前清單所有項目皆已包含詳細分析內容。');

    const useAi = apiKey.trim().length > 0 && topN > 0;
    const ranked = [...targets].sort(
      (a, b) => (b.aiScore ?? b.similarity) - (a.aiScore ?? a.similarity)
    );
    const aiIds = new Set(useAi ? ranked.slice(0, topN).map((t) => t.id) : []);

    setAnalyzingAiIds(new Set(aiIds));
    setApiError(null);

    let aiDone = 0;
    let ruleDone = 0;
    let failed = 0;
    let aborted = false;

    for (const item of targets) {
      if (!aiIds.has(item.id)) {
        const text = buildRuleText(item);
        setResults((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, aiAnalysis: text, analysisSource: 'rule' } : r))
        );
        ruleDone++;
        continue;
      }

      const scoreInfo =
        item.aiScore !== null
          ? `前一步 DINOv2 特徵相似度為 ${item.aiScore}%、像素相似度為 ${item.similarity}%（僅供參考，仍請以實際看到的内容為準）。`
          : '尚未評分，請自行判斷兩張照片的視覺相似程度。';

      const prompt = `你是專業工程稽核員。第一張圖為 A 組（${item.sourceA}），第二張圖為 B 組（${item.sourceB}）。
${scoreInfo}

請比對這兩張工程照片，直接依序輸出以下兩點：
1. 差異度說明：（例如「完全相同」、「角度略微偏移」、「光線或天候不同」、「背景物件增減」或「疑似裁切或變造」）
2. 分析結論：（一句話下結論，例如「極可能為重複請款」、「為同一地點不同時間拍攝」或「不同照片」）

不要輸出分數、不要重述題目、不要客套語。`;

      try {
        const text = await callOpenRouter(prompt, item);
        setResults((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, aiAnalysis: text, analysisSource: 'ai' } : r))
        );
        aiDone++;
      } catch (error) {
        console.error(`文字分析失敗 ${item.id}`, error);
        failed++;
        if (isFatalApiError(error as ApiError)) {
          setApiError(`⚠️ ${(error as Error).message}（已完成 ${aiDone} 組，其餘中斷）`);
          aborted = true;
          break;
        }
        // 單筆失敗改用規則文字，避免報告留白
        const fallback = buildRuleText(item);
        setResults((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, aiAnalysis: fallback, analysisSource: 'rule' } : r))
        );
        ruleDone++;
      }
      await sleep(REQUEST_GAP_MS);
    }

    setAnalyzingAiIds(new Set());
    if (aborted) return;
    alert(
      `差異說明與結論生成完成！\n` +
        `AI 撰寫 ${aiDone} 組、規則判定 ${ruleDone} 組` +
        (failed > 0 ? `、失敗 ${failed} 組` : '') +
        '。'
    );
  };

  /* ---------------------- Step 4：匯出 Word ---------------------- */

  const exportToWord = async () => {
    if (results.length === 0) return alert('無資料可匯出。');

    const incomplete = results.filter((r) => !r.aiAnalysis).length;
    if (incomplete > 0) {
      const ok = window.confirm(
        `尚有 ${incomplete} 筆項目未生成詳細說明（Step 3）。\n這些項目在報告中將無文字分析。確定要繼續匯出嗎？`
      );
      if (!ok) return;
    }

    setIsExporting(true);
    try {
      const title = '工程照片 AI 完整查核報告';
      const engine = apiKey.trim()
        ? `DINOv2-small（本機）＋ OpenRouter ${model}`
        : 'DINOv2-small（本機）＋ 規則判定';

      let html = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
          <meta charset="utf-8">
          <title>${title}</title>
          <style>
            @page { size: 21cm 29.7cm; margin: 1.5cm; }
            body { font-family: 'Microsoft JhengHei', sans-serif; font-size: 10pt; }
            h1 { font-size: 16pt; margin-bottom: 5px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
            td, th { border: 1px solid #aaa; padding: 4px; vertical-align: top; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .score-box { font-size: 12pt; font-weight: bold; color: #d32f2f; }
            .img-container { width: 50%; text-align: center; padding: 5px; }
            img { width: 6.5cm; height: auto; border: 1px solid #eee; display: block; margin: 0 auto; }
            .group-container { page-break-inside: avoid; margin-bottom: 20px; border: 1px solid #ccc; padding: 10px; }
            .ai-section { background-color: #f8fafc; padding: 8px; border-top: 1px solid #ddd; margin-top: 5px; }
            .ai-title { font-weight: bold; color: #1e40af; margin-bottom: 4px; display: block; }
            .meta { font-size: 8pt; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${title}</h1>
            <p>列印日期：${new Date().toLocaleDateString()} ｜ 稽核組數：${results.length}</p>
            <p class="meta">分析引擎：${engine}</p>
          </div>`;

      for (let i = 0; i < results.length; i++) {
        const item = results[i];
        const [dataUrlA, dataUrlB] = await Promise.all([fileToDataURL(item.fileA), fileToDataURL(item.fileB)]);
        const displayScore = item.aiScore !== null ? item.aiScore : item.similarity;
        const scoreLabel = item.aiScore !== null ? 'DINOv2 特徵相似度' : '像素初判相似度';
        const sourceLabel =
          item.analysisSource === 'ai' ? '（AI 撰寫）' : item.analysisSource === 'rule' ? '（規則判定）' : '';

        html += `
          <div class="group-container">
            <table style="border: none; margin-bottom: 5px;">
              <tr style="border: none;">
                <td style="border: none; width: 55%;"><h3 style="margin:0;">#${i + 1} 稽核群組</h3></td>
                <td style="border: none; text-align: right;">
                  <span class="score-box">${scoreLabel}：${displayScore}%</span><br/>
                  <span class="meta">像素相似度：${item.similarity}%</span>
                </td>
              </tr>
            </table>

            <table>
              <tr>
                <th style="width: 50%;">A：${item.sourceA}（${item.fileA.name}）</th>
                <th style="width: 50%;">B：${item.sourceB}（${item.fileB.name}）</th>
              </tr>
              <tr>
                <td class="img-container"><img src="${dataUrlA}" /></td>
                <td class="img-container"><img src="${dataUrlB}" /></td>
              </tr>
            </table>

            <div class="ai-section">
              <span class="ai-title">【查核結果】${sourceLabel}</span>
              ${item.aiAnalysis ? item.aiAnalysis.replace(/\n/g, '<br/>') : '<i>（無詳細分析文字）</i>'}
            </div>
          </div>`;
      }

      html += `</body></html>`;

      const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title}_${new Date().toISOString().slice(0, 10)}.doc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('匯出失敗：' + (e as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  /* ------------------------------ UI ------------------------------ */

  const hasKey = apiKey.trim().length > 0;

  const dinoBadge = (() => {
    if (dinoState === 'ready') return { text: '已就緒', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (dinoState === 'loading') return { text: `下載中 ${dinoProgress}%`, cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (dinoState === 'error') return { text: '載入失敗', cls: 'bg-red-50 text-red-700 border-red-200' };
    return { text: '待命（首次約 23MB）', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  })();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8">
      <div className="max-w-[1400px] mx-auto space-y-6">

        {/* Header */}
        <header className="bg-white rounded-xl shadow-sm p-5 border border-slate-200 space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-blue-700 flex items-center gap-2">
                <FileImage className="w-8 h-8" />
                工程照片 AI 交叉稽核系統
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                像素初篩 → DINOv2 特徵比對（免金鑰）→ 差異說明 → Word 查核報告
              </p>
            </div>
            <a
              href="https://github.com/ymguan3-boop/original-tools"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            >
              <ExternalLink className="w-3.5 h-3.5" /> 原創工具集
            </a>
          </div>

          {/* 引擎一：DINOv2 本機模型 */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-2 shrink-0">
              <Cpu className="w-4 h-4 text-slate-600" />
              <span className="text-sm font-semibold text-slate-700">相似度引擎</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${dinoBadge.cls}`}>{dinoBadge.text}</span>
            </div>
            <div className="text-xs text-slate-500 flex-1">
              DINOv2-small（{DINO_MODEL_ID}）在你的瀏覽器本機執行，<span className="font-semibold text-slate-700">免 API Key、免費用、照片不外傳</span>。
              首次分析需下載約 23MB 模型，之後由瀏覽器快取。
            </div>
            {dinoState === 'loading' && (
              <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden shrink-0">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${dinoProgress}%` }} />
              </div>
            )}
          </div>

          {/* 引擎二：OpenRouter 文字說明（選配） */}
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center bg-indigo-50/60 border border-indigo-100 rounded-lg p-3">
            <div className="flex items-center gap-2 shrink-0">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-semibold text-indigo-900">文字說明（選配）</span>
            </div>

            <div className="flex items-center gap-2 flex-1 min-w-0">
              <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="password"
                placeholder="sk-or-v1-…（留空則用規則模板產生結論）"
                className="bg-white border border-slate-200 rounded px-3 py-1.5 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <a
                href={OPENROUTER_KEYS_PAGE}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-indigo-600 hover:underline whitespace-nowrap"
              >
                免費申請
              </a>
            </div>

            <div className="flex items-center gap-2">
              <select
                className="bg-white border border-slate-200 rounded px-2 py-1.5 text-xs max-w-[220px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                title="文字說明使用的模型"
              >
                {models.length === 0 && <option value={model}>{model}</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}（免費）
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadModels()}
                title="重新整理免費模型清單"
                className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-500"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
              </button>

              <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
                僅前
                <input
                  type="number"
                  min={0}
                  max={999}
                  value={topN}
                  onChange={(e) => setTopN(clamp(Number(e.target.value) || 0, 0, 999))}
                  className="w-14 bg-white border border-slate-200 rounded px-1.5 py-1 text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                組用 AI
              </label>
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              金鑰只存在你自己的瀏覽器（localStorage），請求由瀏覽器直接送往 OpenRouter，本工具不經手任何資料。
              未填金鑰時，第三步改用「DINOv2 分數 + 像素分數」規則模板產生差異說明與結論，報告格式完全相同。
            </span>
          </p>
        </header>

        {apiError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="font-bold text-sm">{apiError}</span>
          </div>
        )}

        {dinoState === 'error' && dinoError && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              DINOv2 模型載入失敗：{dinoError}
              <br />
              常見原因：網路無法連線 huggingface.co（公司或政府內網封鎖）、瀏覽器阻擋 WebAssembly。可先用第一步像素比對。
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* 左側：資料夾與初判設定 */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 h-full flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Folder className="w-5 h-5 text-blue-600" />
                  資料來源
                </h3>
                <div className="relative">
                  <button className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> 加入
                  </button>
                  <input
                    type="file"
                    multiple
                    onChange={addFolder}
                    {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-[200px] space-y-2 pr-2 custom-scrollbar">
                {folders.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-8 leading-relaxed">
                    點「加入」選擇整個資料夾
                    <br />
                    至少需要 2 個資料夾才能比對
                  </p>
                )}
                {folders.map((folder, idx) => (
                  <div key={folder.id} className="border border-slate-200 p-3 rounded-lg bg-slate-50 relative group">
                    <button
                      onClick={() => removeFolder(folder.id)}
                      className="absolute top-2 right-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                      title="移除資料夾"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-100 text-blue-700 font-bold w-6 h-6 text-sm rounded flex items-center justify-center shrink-0">
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 text-sm truncate w-32" title={folder.name}>
                          {folder.name}
                        </div>
                        <div className="text-xs text-slate-500">{folder.files.length} 張照片</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="flex justify-between text-sm mb-1">
                  <span>初始比對門檻</span>
                  <span className="font-bold text-blue-600">{threshold}%</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="100"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />

                <button
                  onClick={() => void startCrossAnalysis()}
                  disabled={isProcessing || folders.length < 2}
                  className="mt-4 w-full py-2.5 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 flex items-center justify-center gap-2 transition-all"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  開始交叉比對
                </button>
                {isProcessing && <p className="text-xs text-center text-slate-500 mt-2">{progress.status}</p>}
              </div>
            </div>
          </div>

          {/* 右側：主工作區 */}
          <div className="lg:col-span-9 space-y-5">

            {/* 第一步：像素統計 & 刪除 */}
            <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 pb-2 border-b border-slate-100 gap-3">
                <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
                  <BarChart3 className="w-6 h-6 text-orange-500" />
                  第一步：像素相似度篩選
                </div>

                <div className="flex items-center gap-2 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100">
                  <span className="text-xs font-bold text-orange-800">刪除像素相似度低於</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={pixelDeleteThreshold}
                    onChange={(e) => setPixelDeleteThreshold(Number(e.target.value))}
                    className="w-24 h-2 bg-white rounded-lg appearance-none cursor-pointer accent-orange-600 border border-orange-200"
                  />
                  <span className="text-sm font-bold text-orange-700 w-9 text-right">{pixelDeleteThreshold}%</span>
                  <button
                    onClick={deleteLowPixelSimilarity}
                    className="ml-2 bg-white text-orange-600 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded text-xs flex items-center gap-1 font-bold transition-colors shadow-sm"
                    title="執行刪除"
                  >
                    <Eraser className="w-3 h-3" /> 執行刪除
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {RANGE_CONFIG.map((config) => {
                  const active = selectedRanges.has(config.key);
                  return (
                    <button
                      key={config.key}
                      onClick={() => toggleRangeFilter(config.key)}
                      className={`p-3 rounded-lg border transition-all relative text-left ${
                        active
                          ? `ring-2 ring-offset-1 ring-blue-500 ${config.bg} ${config.border}`
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {active && <CheckCircle className="absolute top-1 right-1 w-4 h-4 text-blue-600" />}
                      <div className={`text-xs font-bold uppercase ${config.color} mb-1`}>{config.label}</div>
                      <div className="flex justify-between items-end">
                        <span className="text-2xl font-bold text-slate-700">{stats[config.key]}</span>
                        <span className="text-xs text-slate-400 mb-1">組</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 第二步：DINOv2 篩選 */}
            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-lg flex flex-col md:flex-row items-start md:items-center gap-4">
              <div className="flex items-center gap-2 shrink-0 self-start md:self-center">
                <Zap className="w-6 h-6 text-indigo-600" />
                <div className="flex flex-col">
                  <span className="font-bold text-indigo-900 text-lg">第二步：DINOv2 相似度篩選</span>
                  <span className="text-xs text-indigo-500">本機執行，免金鑰</span>
                </div>
              </div>

              <div className="flex-1 w-full flex flex-col md:flex-row gap-3">
                <button
                  onClick={() => void runStep2_1_DinoScore()}
                  disabled={results.length === 0 || isScoring}
                  className="flex-1 bg-white border border-indigo-200 text-indigo-700 px-4 py-3 rounded-lg font-bold shadow-sm hover:bg-indigo-50 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {isScoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
                  {isScoring && scoreProgress.label ? scoreProgress.label : '1. 相似度分析'}
                </button>

                <div className="flex-[1.5] flex items-center gap-2 bg-white px-4 py-2 rounded-lg border border-red-100 shadow-sm">
                  <div className="flex flex-col leading-tight shrink-0 mr-1">
                    <span className="text-xs font-bold text-slate-500">2. 指定刪除</span>
                    <span className="text-xs font-bold text-red-600">相似度低於</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={aiDeleteThreshold}
                    onChange={(e) => setAiDeleteThreshold(Number(e.target.value))}
                    className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                  />
                  <div className="text-sm font-bold text-red-600 w-9 text-right">{aiDeleteThreshold}%</div>
                  <button
                    onClick={runStep2_2_DeleteLowAi}
                    disabled={results.length === 0}
                    className="ml-2 p-2 bg-red-50 text-red-600 rounded hover:bg-red-100 border border-red-200 disabled:opacity-40"
                    title="執行刪除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* 第三步 / 第四步 */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 p-3 border-b border-slate-200 flex flex-col md:flex-row justify-between items-center gap-3">
                <div className="flex items-center gap-2">
                  <Filter className="w-5 h-5 text-slate-600" />
                  <span className="font-bold text-slate-700">比對清單</span>
                  <span className="text-xs bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-600 font-mono">
                    剩餘 {filteredResults.length} 組
                  </span>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  <button
                    onClick={() => void runStep3_GenerateText()}
                    disabled={results.length === 0 || analyzingAiIds.size > 0}
                    className="flex-1 md:flex-none text-xs bg-emerald-600 text-white px-3 py-2 rounded font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                  >
                    {analyzingAiIds.size > 0 ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FileCheck className="w-3 h-3" />
                    )}
                    第三步：差異說明及結論{hasKey && topN > 0 ? `（前 ${topN} 組用 AI）` : '（規則模板）'}
                  </button>

                  <div className="h-6 w-[1px] bg-slate-300 mx-1" />

                  <button
                    onClick={() => void exportToWord()}
                    disabled={isExporting}
                    className="flex-1 md:flex-none text-xs bg-blue-600 text-white px-3 py-2 rounded font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                  >
                    {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />}
                    第四步：匯出 WORD 報告
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-3 h-[450px] overflow-y-auto custom-scrollbar bg-slate-50/50">
                {filteredResults.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <FileImage className="w-16 h-16 mb-3 opacity-20" />
                    <p className="text-sm">清單為空</p>
                  </div>
                )}

                {filteredResults.map((item) => (
                  <div
                    key={item.id}
                    className="relative bg-white rounded-lg border border-slate-200 p-3 hover:shadow-md transition-all flex flex-col sm:flex-row gap-4 group"
                  >
                    <button
                      onClick={(e) => removeResult(item.id, e)}
                      className="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-red-500 rounded-full transition-colors z-10"
                      title="移除此組"
                    >
                      <X className="w-4 h-4" />
                    </button>

                    <div className="flex gap-3 sm:w-2/3 cursor-pointer" onClick={() => setSelectedResult(item)}>
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="text-[10px] text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded w-fit truncate max-w-full">
                          A: {item.sourceA}
                        </div>
                        <div className="aspect-video bg-slate-100 rounded border border-slate-200 overflow-hidden">
                          <img src={fileUrl(item.fileA)} className="w-full h-full object-contain" alt="" />
                        </div>
                      </div>

                      <div className="flex flex-col items-center justify-center w-20 shrink-0">
                        <div className="text-[10px] text-slate-400">像素</div>
                        <div className="text-base font-bold text-slate-600">{item.similarity}%</div>
                        <div className="w-8 h-[1px] bg-slate-200 my-1" />
                        <div className="text-[10px] text-indigo-400">DINOv2</div>
                        {item.aiScore !== null ? (
                          <div className={`text-lg font-black ${item.aiScore >= 95 ? 'text-red-600' : 'text-indigo-600'}`}>
                            {item.aiScore}%
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">--</span>
                        )}
                      </div>

                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="text-[10px] text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded w-fit truncate max-w-full">
                          B: {item.sourceB}
                        </div>
                        <div className="aspect-video bg-slate-100 rounded border border-slate-200 overflow-hidden">
                          <img src={fileUrl(item.fileB)} className="w-full h-full object-contain" alt="" />
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/3 border-l border-slate-100 pl-4 flex flex-col justify-center text-xs">
                      {item.aiAnalysis ? (
                        <div className="bg-emerald-50 text-emerald-800 p-2.5 rounded border border-emerald-100 h-full overflow-y-auto max-h-[100px] custom-scrollbar">
                          <div className="font-bold mb-1 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            {item.analysisSource === 'ai' ? 'AI 分析結論' : '規則判定結論'}
                          </div>
                          <div className="opacity-90 leading-relaxed whitespace-pre-line">{item.aiAnalysis}</div>
                        </div>
                      ) : (
                        <div className="text-center text-slate-400 py-4 italic border-2 border-dashed border-slate-100 rounded">
                          等待生成差異說明（Step 3）...
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* 詳細檢視 Modal */}
      {selectedResult && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl">
            <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
              <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                <AlertTriangle className="text-yellow-500" /> 詳細檢視
              </h3>
              <button onClick={() => setSelectedResult(null)} className="p-1 hover:bg-slate-200 rounded-full">
                <X className="w-6 h-6 text-slate-400" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
              <div className="flex-1 p-6 bg-slate-900 flex flex-col gap-4 overflow-y-auto">
                <div className="flex gap-4 h-full items-center justify-center">
                  <div className="flex-1 h-full flex flex-col">
                    <img src={fileUrl(selectedResult.fileA)} className="max-w-full max-h-full object-contain mx-auto" alt="" />
                  </div>
                  <div className="flex-1 h-full flex flex-col">
                    <img src={fileUrl(selectedResult.fileB)} className="max-w-full max-h-full object-contain mx-auto" alt="" />
                  </div>
                </div>
              </div>
              <div className="w-full lg:w-96 border-l border-slate-200 bg-white p-6 overflow-y-auto">
                <h4 className="font-bold text-slate-800 mb-4 pb-2 border-b">分析報告</h4>
                <div className="flex gap-4 mb-4">
                  <div className="bg-indigo-50 p-3 rounded-lg flex-1 text-center">
                    <div className="text-xs font-bold text-indigo-800">DINOv2</div>
                    <div className="text-2xl font-black text-indigo-600">{selectedResult.aiScore ?? 'N/A'}%</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg flex-1 text-center">
                    <div className="text-xs font-bold text-slate-600">像素比對</div>
                    <div className="text-2xl font-bold text-slate-500">{selectedResult.similarity}%</div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 space-y-1 mb-3">
                  <div>A：{selectedResult.sourceA} / {selectedResult.fileA.name}</div>
                  <div>B：{selectedResult.sourceB} / {selectedResult.fileB.name}</div>
                </div>
                {selectedResult.aiAnalysis ? (
                  <div className="bg-slate-50 p-4 rounded text-sm leading-relaxed whitespace-pre-line text-slate-700">
                    {selectedResult.aiAnalysis}
                  </div>
                ) : (
                  <div className="text-center text-slate-400 text-sm">無詳細內容</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
