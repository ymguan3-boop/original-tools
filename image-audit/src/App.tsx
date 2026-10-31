import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import {
  FileImage, Play, CheckCircle, X, Loader2, Plus, Trash2, AlertCircle,
  BarChart3, Folder, Filter, ClipboardList, Eraser, FileCheck,
  KeyRound, ExternalLink, Info, RefreshCw, Cpu, Sparkles, AlertTriangle, StopCircle,
  SquareStack,
} from 'lucide-react';
import { getDinoClient } from './dinoClient';
import type { ModelState } from './dinoClient';
import { assessPhotoEvidence, buildAuditRule } from './auditEvidence';
import { getCached, setCached, clearEmbedCache, countCached } from './embedCache';

/* =====================================================================
 *  影像分析引擎：DINOv2-small（瀏覽器本機執行，免 API Key）
 *  ---------------------------------------------------------------------
 *  - 全部運算在 Web Worker 內完成，主執行緒（UI）永遠不會被阻塞
 *  - 每張圖只解碼一次：同時產生 480px 縮圖、64×64 像素特徵、384 維特徵向量
 *  - 特徵向量比對只是餘弦相似度，瞬間完成，因此不需要先用像素初篩
 * ===================================================================== */
const DINO_MODEL_ID = 'Xenova/dinov2-small';
/** 清單最多保留的組數，避免記憶體爆掉 */
const MAX_RESULTS = 2000;
/** 清單每頁顯示組數 */
const PAGE_SIZE = 30;

/* =====================================================================
 *  文字說明引擎：OpenRouter（選配）
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

/** 送給 OpenRouter 的縮圖長邊 */
const SEND_MAX_SIDE = 1024;
/** 匯出 DOCX 時內嵌圖片的長邊（避免報告檔過大） */
const REPORT_MAX_SIDE = 1280;

/* ------------------------------- 型別 ------------------------------- */

interface ImageFolder {
  id: number;
  name: string;
  files: File[];
}

interface MatchItem {
  id: string;
  /** DINOv2 特徵相似度 0~100（主要分數；模型不可用時為 null） */
  dino: number | null;
  /** 像素相似度 0~100（輔助參考） */
  pixel: number;
  fileA: File;
  fileB: File;
  sourceA: string;
  sourceB: string;
  thumbA: string;
  thumbB: string;
  analysis: string | null;
  analysisSource: 'ai' | 'rule' | null;
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

/** 主要分數：有 DINOv2 就用它，否則退回像素相似度 */
const primaryScore = (item: MatchItem): number => item.dino ?? item.pixel;

/** 餘弦相似度（Worker 回傳的向量已正規化，因此等同內積） */
const cosineOf = (a: Float32Array, b: Float32Array): number => {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
};

/** 像素相似度（64×64 RGBA 特徵，0~100） */
const pixelSimilarity = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let diff = 0;
  let count = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 4) {
    diff +=
      (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) /
      (255 * 3);
    count++;
  }
  return count === 0 ? 0 : 100 - (diff / count) * 100;
};

/** 檔案內容雜湊：用來偵測「位元組完全相同」的檔案，直接沿用分析結果避免重複推論 */
const contentHash = async (file: File): Promise<string | null> => {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
};

/** 將 File 縮圖後轉為 JPEG Data URL（OpenRouter 傳圖／Word 內嵌用） */
const fileToJpegDataUrl = (file: File, maxSide: number, quality = 0.85): Promise<string> =>
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

/** 原始尺寸預覽 URL 快取（僅詳細檢視用，一次只有一組） */const fullUrlCache = new WeakMap<File, string>();
const fullUrl = (file: File): string => {
  let url = fullUrlCache.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    fullUrlCache.set(file, url);
  }
  return url;
};

/* --------------------------- 相似度分區設定 --------------------------- */

const RANGE_CONFIG: RangeConfig[] = [
  { key: '97-100', label: '97-100%', min: 97, max: 101, color: 'text-red-700', bg: 'bg-red-100', border: 'border-red-200' },
  { key: '94-96', label: '94-96%', min: 94, max: 97, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  { key: '90-93', label: '90-93%', min: 90, max: 94, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  { key: '85-89', label: '85-89%', min: 85, max: 90, color: 'text-orange-500', bg: 'bg-orange-50/60', border: 'border-orange-100' },
  { key: '80-84', label: '80-84%', min: 80, max: 85, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  { key: 'below-80', label: '80% 以下', min: 0, max: 80, color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200' },
];

/** Rules for audit triage. Do not interpret cosine scores as legal or duplicate probabilities. */
const buildRuleText = (item: MatchItem): string => buildAuditRule({dino:item.dino,pixel:item.pixel});

const isFatalApiError = (error: ApiError): boolean =>
  [401, 402, 403, 404, 429].includes(error.status ?? -1);

/* =============================== App =============================== */

const App = () => {
  /* ---------- 模型狀態 ---------- */
  const [modelState, setModelState] = useState<ModelState>('idle');
  const [modelProgress, setModelProgress] = useState(0);
  const [modelError, setModelError] = useState<string | null>(null);

  /* ---------- 文字引擎設定 ---------- */
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(KEY_STORAGE) ?? '');
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_TEXT_MODEL);
  const [topN, setTopN] = useState(() => Number(localStorage.getItem(TOPN_STORAGE) ?? 20));
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  /* ---------- 資料 ---------- */
  const [folders, setFolders] = useState<ImageFolder[]>([]);
  const [listThreshold, setListThreshold] = useState(80);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ stage: '', done: 0, total: 0 });

  const [results, setResults] = useState<MatchItem[]>([]);
  const [selectedRanges, setSelectedRanges] = useState<Set<string>>(new Set());
  const [selectedResult, setSelectedResult] = useState<MatchItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{title:string;message:string;type:'success'|'warning'} | null>(null);
  const notify = (title:string,message:string,type:'success'|'warning'='success') =>
    setDialog({title,message,type});


  /* ---------- 說明／匯出 ---------- */
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [apiError, setApiError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  /* ---------- 刪除門檻 ---------- */
  const [deleteThreshold, setDeleteThreshold] = useState(90);

  const stopRef = useRef(false);

  /* ---------------------- 初始化 Worker 狀態 ---------------------- */

  useEffect(() => {
    const client = getDinoClient();
    client.onStateChange = (state, value, error) => {
      setModelState(state);
      setModelProgress(value);
      setModelError(error);
    };
    setModelState(client.state);
    setModelProgress(client.progress);
    setModelError(client.error);
    return () => {
      client.onStateChange = null;
    };
  }, []);

  useEffect(() => {
    if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
    else localStorage.removeItem(KEY_STORAGE);
  }, [apiKey]);

  useEffect(() => localStorage.setItem(MODEL_STORAGE, model), [model]);
  useEffect(() => localStorage.setItem(TOPN_STORAGE, String(topN)), [topN]);

  /* ---------------------- 預估工作量 ---------------------- */

  const workload = useMemo(() => {
    const unique = new Set<File>();
    const perFolder: number[] = [];
    folders.forEach((folder) => {
      const seen = new Set<File>();
      folder.files.forEach((file) => {
        unique.add(file);
        seen.add(file);
      });
      perFolder.push(seen.size);
    });
    let pairs = 0;
    for (let i = 0; i < perFolder.length; i++) {
      for (let j = i + 1; j < perFolder.length; j++) pairs += perFolder[i] * perFolder[j];
    }
    return { unique: unique.size, pairs };
  }, [folders]);

  /* ---------------------- 資料來源（照片多選不會觸發資料夾上傳確認） ---------------------- */
  const appendPhotos = (photos: File[], name: string) => {
    const images = photos.filter(file=>file.type.startsWith('image/')||/\.(jpe?g|png|webp|bmp)$/i.test(file.name));
    if(!images.length) { notify('沒有可用照片','請選擇包含 JPG、PNG 或 WebP 的資料。','warning'); return; }
    setFolders(prev=>[...prev,{id:Date.now()+Math.floor(Math.random()*1000),name,files:images}]);
    notify('照片已加入','已加入「'+name+'」共 '+images.length+' 張；照片在本機瀏覽器進行比對。');
  };
  const addFolder = (e: ChangeEvent<HTMLInputElement>) => {
    const files=Array.from(e.target.files||[]);
    if(files.length){
      const rel=(files[0] as File & {webkitRelativePath?:string}).webkitRelativePath;
      appendPhotos(files,rel?rel.split('/')[0]:('照片批次 '+(folders.length+1)));
    }
    e.target.value='';
  };
  const addSelectedFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const files=Array.from(e.target.files||[]);
    if(files.length)appendPhotos(files,'照片批次 '+(folders.length+1));
    e.target.value='';
  };
  const chooseDirectory = async () => {
    // File System Access API: a user-initiated, read-only picker. Browser permission
    // prompts cannot be suppressed; use ordinary multiple files to avoid folder upload dialog.
    const picker=(window as unknown as {showDirectoryPicker?:()=>Promise<unknown>}).showDirectoryPicker;
    if(!picker){document.getElementById('desktopFolderInput')?.click();return;}
    type DirEntry={kind:string;name:string;getFile?:()=>Promise<File>;values?:()=>AsyncIterable<DirEntry>};
    try {
      const root=await picker.call(window) as DirEntry;
      const photos:File[]=[];
      const collect=async(dir:DirEntry):Promise<void>=>{
        for await(const entry of dir.values?.()??[]){
          if(entry.kind==='file'&&entry.getFile)photos.push(await entry.getFile());
          else if(entry.kind==='directory')await collect(entry);
        }
      };
      await collect(root);
      appendPhotos(photos,root.name||('照片批次 '+(folders.length+1)));
    }catch(e){
      if((e as Error)?.name!=='AbortError') notify('資料夾讀取未完成','無法讀取資料夾，請改用「選取多張照片」。瀏覽器的存取授權確認無法由網頁取消。','warning');
    }
  };

  const removeFolder = (id: number) => setFolders((prev) => prev.filter((f) => f.id !== id));

  /* ---------------------- 一次分析（核心） ---------------------- */

  const stopAnalysis = () => {
    stopRef.current = true;
    getDinoClient().terminate();
    setProgress({ stage: '已停止', done: 0, total: 0 });
  };

  const runAnalysis = async () => {
    if (folders.length < 2) {
      alert('請至少加入兩個資料夾以進行交叉比對');
      return;
    }

    /* 1) 建立唯一圖片清單（同一張圖只推論一次） */
    const files: File[] = [];
    const fileIndex = new Map<File, number>();
    const occurrences: { fi: number; folderId: number; folderName: string }[] = [];
    for (const folder of folders) {
      for (const file of folder.files) {
        let fi = fileIndex.get(file);
        if (fi === undefined) {
          fi = files.length;
          fileIndex.set(file, fi);
          files.push(file);
        }
        occurrences.push({ fi, folderId: folder.id, folderName: folder.name });
      }
    }

    if (files.length < 2) {
      alert('可分析的圖片不足，請確認資料夾內容。');
      return;
    }

    setIsAnalyzing(true);
    stopRef.current = false;
    setResults([]);
    setSelectedRanges(new Set());
    setVisibleCount(PAGE_SIZE);
    setApiError(null);
    setNotice(null);

    /* 清掉上一輪的縮圖 URL */
    results.forEach((r) => {
      URL.revokeObjectURL(r.thumbA);
      URL.revokeObjectURL(r.thumbB);
    });

    const thumbs: string[] = new Array(files.length).fill('');
    const sigs: (Uint8ClampedArray | null)[] = new Array(files.length).fill(null);
    const embeddings: (Float32Array | null)[] = new Array(files.length).fill(null);

    const client = getDinoClient();

    try {
      /* 2) 載入模型（失敗仍可繼續，只是改用像素比對） */
      setProgress({ stage: '載入 DINOv2 模型（首次約 23MB）', done: 0, total: files.length });
      try {
        await client.init();
      } catch {
        /* 失敗訊息會顯示在提示列 */
      }
      if (stopRef.current) return;

      /* 3) 逐張分析：縮圖 + 像素特徵 + 特徵向量（Worker 內逐張推論，結果可重現） */
      const hashToIndex = new Map<string, number>();
      let reused = 0;
      let cachedHitCount = 0;
      for (let i = 0; i < files.length; i++) {
        if (stopRef.current) return;
        const file = files[i];

        /* 位元組完全相同 → 直接沿用先前算好的結果（省下整次推論） */
        const hash = await contentHash(file);
        const twin = hash ? hashToIndex.get(hash) : undefined;
        if (twin !== undefined) {
          sigs[i] = sigs[twin];
          embeddings[i] = embeddings[twin];
          thumbs[i] = thumbs[twin];
          reused++;
          setProgress({ stage: `分析照片 ${i + 1} / ${files.length}（內容相同，沿用結果）`, done: i + 1, total: files.length });
          continue;
        }
        if (hash) hashToIndex.set(hash, i);

        // IndexedDB 快取：命中則跳過推論
        let cacheHit = false;
        if (hash) {
          const cached = await getCached(hash);
          if (cached) {
            sigs[i] = cached.sig;
            embeddings[i] = cached.embedding;
            thumbs[i] = URL.createObjectURL(cached.thumb);
            hashToIndex.set(hash, i);
            cachedHitCount++;
            setProgress({ stage: `分析照片 ${i + 1} / ${files.length}（已從快取載入）`, done: i + 1, total: files.length });
            cacheHit = true;
          }
        }
        if (cacheHit) continue;

        setProgress({ stage: `分析照片 ${i + 1} / ${files.length}`, done: i, total: files.length });

        const [item] = await client.analyze([{ id: i, file }]);
        if (item) {
          sigs[item.id] = item.sig;
          embeddings[item.id] = item.embedding;
          thumbs[item.id] = URL.createObjectURL(item.thumb);
          // 成功取得向量才寫入快取
          if (hash && item.embedding) {
            await setCached({
              hash,
              sig: item.sig,
              embedding: item.embedding,
              thumb: item.thumb,
              createdAt: Date.now(),
            });
          }
        }
        setProgress({ stage: `分析照片 ${i + 1} / ${files.length}`, done: i + 1, total: files.length });
        await sleep(0);
      }

      /* 4) 交叉比對（向量內積，瞬間完成） */
      setProgress({ stage: '交叉比對中…', done: files.length, total: files.length });

      const byFolder = new Map<number, Set<number>>();
      const folderName = new Map<number, string>();
      for (const occ of occurrences) {
        let set = byFolder.get(occ.folderId);
        if (!set) {
          set = new Set<number>();
          byFolder.set(occ.folderId, set);
        }
        set.add(occ.fi);
        folderName.set(occ.folderId, occ.folderName);
      }

      const folderIds = [...byFolder.keys()];
      const matches: MatchItem[] = [];
      let tick = 0;

      for (let a = 0; a < folderIds.length; a++) {
        for (let b = a + 1; b < folderIds.length; b++) {
          const listA = [...(byFolder.get(folderIds[a]) ?? [])];
          const listB = [...(byFolder.get(folderIds[b]) ?? [])];

          for (const fa of listA) {
            for (const fb of listB) {
              tick++;
              const ea = embeddings[fa];
              const eb = embeddings[fb];
              const sigA = sigs[fa];
              const sigB = sigs[fb];

              const dino = ea && eb ? Math.round(cosineOf(ea, eb) * 1000) / 10 : null;
              const pixel = sigA && sigB ? Math.round(pixelSimilarity(sigA, sigB) * 100) / 100 : 0;
              const score = dino ?? pixel;
              if (score < listThreshold) continue;

              matches.push({
                id: `${folderIds[a]}-${folderIds[b]}-${fa}-${fb}`,
                dino,
                pixel,
                fileA: files[fa],
                fileB: files[fb],
                sourceA: folderName.get(folderIds[a]) ?? 'A',
                sourceB: folderName.get(folderIds[b]) ?? 'B',
                thumbA: thumbs[fa],
                thumbB: thumbs[fb],
                analysis: null,
                analysisSource: null,
              });
            }
          }

          if (tick % 3000 < listB.length) await sleep(0);
        }
      }

      matches.sort((x, y) => primaryScore(y) - primaryScore(x));
      const capped = matches.slice(0, MAX_RESULTS);

      if (matches.length > MAX_RESULTS) {
        setNotice(
          `符合「相似度 ≥ ${listThreshold}%」的配對共 ${matches.length} 組，清單僅保留分數最高的 ${MAX_RESULTS} 組。建議調高列出門檻以縮小範圍。`
        );
      } else if (matches.length === 0) {
        setNotice(`沒有相似度達 ${listThreshold}% 的配對，可調低「列出門檻」後重新分析。`);
      } else if (!matches.some((r) => primaryScore(r) < 80)) {
        setNotice('所有配對相似度均達 80%，無低於 80% 的案例。');
      }

      setResults(capped);
      setProgress({ stage: '完成', done: files.length, total: files.length });

      notify('照片交叉比對完成',
          '本次照片 '+files.length+' 張、跨資料夾配對 '+workload.pairs.toLocaleString()+' 組\n'+
          (reused?'已重用 '+reused+' 張相同照片的分析結果\n':'')+
          (cachedHitCount?'已讀取 '+cachedHitCount+' 張快取特徵\n':'')+
          '符合門檻 '+matches.length+' 組'+(matches.length>MAX_RESULTS?'（列示前 '+MAX_RESULTS+' 組）':''));

    } catch (error) {
      if ((error as Error).message === '已停止') {
        setNotice('已停止分析。');
        return;
      }
      console.error(error);
      setApiError(`⚠️ 分析失敗：${(error as Error).message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  /* ---------------------- 篩選與統計 ---------------------- */

  const filteredResults = useMemo(() => {
    if (selectedRanges.size === 0) return results;
    return results.filter((r) => {
      const score = primaryScore(r);
      return [...selectedRanges].some((key) => {
        const c = RANGE_CONFIG.find((x) => x.key === key);
        return c ? score >= c.min && score < c.max : false;
      });
    });
  }, [results, selectedRanges]);

  useEffect(() => setVisibleCount(PAGE_SIZE), [selectedRanges]);

  const stats = useMemo(() => {
    const acc: Record<string, number> = {};
    RANGE_CONFIG.forEach((c) => (acc[c.key] = 0));
    results.forEach((r) => {
      const score = primaryScore(r);
      const c = RANGE_CONFIG.find((x) => score >= x.min && score < x.max);
      if (c) acc[c.key]++;
    });
    return acc;
  }, [results]);

  /** 低於「列出門檻」的分區沒有任何資料，隱藏以避免誤導 */
  const visibleBuckets = useMemo(
    () => RANGE_CONFIG.filter((c) => c.max > listThreshold),
    [listThreshold]
  );

  const toggleRangeFilter = (key: string) => {
    setSelectedRanges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const removeResult = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  const deleteBelowThreshold = () => {
    if (results.length === 0) return alert('目前無資料可刪除。');
    const toDelete = results.filter((r) => primaryScore(r) < deleteThreshold).length;
    if (toDelete === 0) {
      return alert(`目前清單中沒有相似度低於 ${deleteThreshold}% 的資料，因此無須刪除。`);
    }
    setResults((prev) => prev.filter((r) => primaryScore(r) >= deleteThreshold));
    setSelectedRanges(new Set());
    setTimeout(() => {
      alert(`刪除完成！\n已刪除 ${toDelete} 筆資料。`);
    }, 100);
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
            'X-Title': 'original-tools / 工程照片交叉稽核系統',
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

  const runGenerateText = async () => {
    if (results.length === 0) return alert('無資料可分析');

    const targets = results.filter((r) => r.analysis === null);
    if (targets.length === 0) return alert('目前清單所有項目皆已包含差異說明。');

    const useAi = apiKey.trim().length > 0 && topN > 0;
    const ranked = [...targets].sort((a, b) => primaryScore(b) - primaryScore(a));
    const aiIds = new Set(useAi ? ranked.slice(0, topN).map((t) => t.id) : []);

    setAnalyzingIds(new Set(aiIds));
    setApiError(null);

    let aiDone = 0;
    let ruleDone = 0;
    let failed = 0;
    let aborted = false;

    for (const item of targets) {
      if (!aiIds.has(item.id)) {
        const text = buildRuleText(item);
        setResults((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, analysis: text, analysisSource: 'rule' } : r))
        );
        ruleDone++;
        continue;
      }

      const scoreInfo =
        item.dino !== null
          ? `前一步 DINOv2 特徵相似度為 ${item.dino}%、像素相似度為 ${item.pixel}%（僅供參考，仍請以實際看到的內容為準）。`
          : `像素相似度為 ${item.pixel}%（未取得 DINOv2 特徵），僅供參考，仍請以實際看到的內容為準。`;

      const prompt = `你是專業工程稽核員。第一張圖為 A 組（${item.sourceA}），第二張圖為 B 組（${item.sourceB}）。
${scoreInfo}

請比對這兩張工程照片，直接依序輸出以下兩點：
1. 差異度說明：（例如「完全相同」、「角度略微偏移」、「光線或天候不同」、「背景物件增減」或「疑似裁切或變造」）
2. 分析結論：（一句話下結論，例如「極可能為重複請款」、「為同一地點不同時間拍攝」或「不同照片」）

不要輸出分數、不要重述題目、不要客套語。`;

      try {
        const text = await callOpenRouter(prompt, item);
        setResults((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, analysis: text, analysisSource: 'ai' } : r))
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
        const fallback = buildRuleText(item);
        setResults((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, analysis: fallback, analysisSource: 'rule' } : r))
        );
        ruleDone++;
      }
      await sleep(REQUEST_GAP_MS);
    }

    setAnalyzingIds(new Set());
    if (aborted) return;
    notify('差異說明已完成', 'AI 撰寫 '+aiDone+' 組、規則判定 '+ruleDone+' 組'+(failed ? '、失敗 '+failed+' 組' : '')+'。');
  };

  /* ---------------------- 匯出真正的 DOCX (OOXML) ---------------------- */
  const exportToWord = async () => {
    if (!results.length) { notify('沒有可匯出的照片', '請先完成跨資料夾照片比對。', 'warning'); return; }
    const ordered = [...results].sort((a,b)=>primaryScore(b)-primaryScore(a));
    const pending = ordered.filter((r)=>!r.analysis).length;
    if (pending > 0 && !window.confirm('尚有 ' + pending + ' 組未產生說明。將使用規則判定補齊，是否繼續？')) return;

    setIsExporting(true);
    try {
      const writer = (window as Window & {ImageAuditDocx?: {create: (arg: unknown)=>Promise<Blob>}}).ImageAuditDocx;
      if(!writer) throw Error('DOCX 產生器尚未載入，請重新下載最新完整桌面 ZIP。');
      const reportRows = [];
      for(const item of ordered){
        const [imageA,imageB] = await Promise.all([
          fileToJpegDataUrl(item.fileA, REPORT_MAX_SIDE, 0.83),
          fileToJpegDataUrl(item.fileB, REPORT_MAX_SIDE, 0.83),
        ]);
        reportRows.push({
          score:primaryScore(item),
          label:item.dino!==null?'DINOv2 特徵相似度':'像素相似度',
          detail:'像素相似度：'+item.pixel.toFixed(2)+'%｜查核判讀：'+assessPhotoEvidence(item).heading,
          sourceA:item.sourceA,sourceB:item.sourceB,
          filenameA:item.fileA.name,filenameB:item.fileB.name,
          imageA,imageB,
          analysis:item.analysis||buildRuleText(item),
          analysisSource:item.analysisSource==='ai'?'AI 分析':'規則判定'
        });
      }
      const blob = await writer.create({
        title:'工程照片完整查核報告',
        engine:ordered.some(r=>r.dino!==null)?'DINOv2-small（本機推論）':'像素比對（模型未載入）',
        rows:reportRows
      });
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;
      link.download='工程照片完整查核報告_'+new Date().toISOString().slice(0,10)+'.docx';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      notify('DOCX 報告匯出成功',
        '共 '+ordered.length+' 組，已依相似度由高至低排序。\n雙圖皆在固定欄寬中等比例縮放，並附完整分析說明。');
    } catch (e) {
      console.error(e);
      notify('DOCX 匯出失敗',String((e as Error)?.message??e),'warning');
    } finally {
      setIsExporting(false);
    }
  };

  /* ------------------------------ UI ------------------------------ */

  const hasKey = apiKey.trim().length > 0;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const dinoBadge = (() => {
    if (modelState === 'ready') return { text: '已就緒', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    if (modelState === 'loading') return { text: `下載模型 ${modelProgress}%`, cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (modelState === 'error') return { text: '模型不可用', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
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
                工程照片交叉稽核系統
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                一次分析（像素＋DINOv2 特徵，免金鑰）→ 差異說明 → Word 查核報告
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-blue-200 bg-blue-50 text-blue-700 font-semibold">
              <FileCheck className="w-3.5 h-3.5" /> 桌面 DINOv2 本機模型
            </span>
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
              <span className="text-sm font-semibold text-slate-700">影像引擎</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${dinoBadge.cls}`}>{dinoBadge.text}</span>
              <button
                onClick={async () => {
                  await clearEmbedCache();
                  setNotice('已清除嵌入快取。');
                }}
                title="清除 IndexedDB 中快取的嵌入向量與縮圖"
                className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-500"
              >
                清除快取
              </button>
            </div>
            <div className="text-xs text-slate-500 flex-1">
              DINOv2-small（{DINO_MODEL_ID}）在<span className="font-semibold text-slate-700">背景執行緒</span>本機執行，
              <span className="font-semibold text-slate-700">免 API Key、照片不外傳、操作不卡頓</span>。
              首次分析需下載約 23MB 模型，之後由瀏覽器快取。
            </div>
            {modelState === 'loading' && (
              <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden shrink-0">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${modelProgress}%` }} />
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
              評分完全在本機完成；金鑰只存在你自己的瀏覽器（localStorage），且唯有填寫時才會把前 N 組的縮圖送往 OpenRouter。
              未填金鑰時改用「DINOv2 分數 + 像素分數」規則模板產生差異說明與結論，報告格式完全相同。
            </span>
          </p>
        </header>

        {apiError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="font-bold text-sm">{apiError}</span>
          </div>
        )}

        {notice && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-start gap-2 text-sm">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {modelState === 'error' && modelError && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              DINOv2 模型載入失敗，已自動改為「像素比對」模式（功能仍可用，但無法辨識裁切／調色後的重複照片）。
              <br />
              原因：{modelError}
              <br />
              常見原因：內網封鎖 huggingface.co、瀏覽器阻擋 WebAssembly。
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* 左側：資料夾與設定 */}
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 h-full flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Folder className="w-5 h-5 text-blue-600" />
                  資料來源
                </h3>
                <div className="flex flex-wrap justify-end gap-2">
                  <label className="relative text-xs bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 cursor-pointer">
                    ＋ 選取多張照片
                    <input type="file" multiple accept="image/*" onChange={addSelectedFiles}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"/>
                  </label>
                  <button type="button" onClick={()=>{void chooseDirectory();}}
                    className="text-xs bg-white border border-blue-200 text-blue-700 px-3 py-2 rounded-md hover:bg-blue-50">
                    ＋ 選擇資料夾
                  </button>
                  <input id="desktopFolderInput" type="file" multiple onChange={addFolder}
                    {...({webkitdirectory:'',directory:''} as Record<string,string>)} className="hidden"/>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[300px] space-y-2 pr-2 custom-scrollbar">
                {folders.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-8 leading-relaxed">
                    建議「選取多張照片」以避免瀏覽器的資料夾上傳提示
                    <br />
                    至少加入 2 批照片；選擇資料夾仍可能顯示瀏覽器授權確認
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

              <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>列出門檻（低於此值不顯示）</span>
                    <span className="font-bold text-blue-600">{listThreshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="60"
                    max="99"
                    value={listThreshold}
                    onChange={(e) => setListThreshold(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">分析時套用；變更後需重新分析才會生效（分布圖也會同步隱藏低於此值的分區）</p>
                </div>

                <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded p-2 leading-relaxed">
                  照片 <span className="font-bold text-slate-700">{workload.unique}</span> 張
                  （比對 <span className="font-bold text-slate-700">{workload.pairs.toLocaleString()}</span> 組）
                  {workload.unique > 0 && (
                    <>
                      <br />
                      預估約 {Math.max(1, Math.ceil(workload.unique * 0.5))} 秒
                      {modelState !== 'ready' && '（不含首次模型下載）'}
                    </>
                  )}
                </div>

                <button
                  onClick={() => void runAnalysis()}
                  disabled={isAnalyzing || folders.length < 2}
                  className="w-full py-2.5 rounded-lg font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 flex items-center justify-center gap-2 transition-all"
                >
                  {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  {isAnalyzing ? '分析中…' : '開始分析'}
                </button>

                {isAnalyzing && (
                  <button
                    onClick={stopAnalysis}
                    className="w-full py-2 rounded-lg font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 flex items-center justify-center gap-2"
                  >
                    <StopCircle className="w-4 h-4" /> 停止
                  </button>
                )}

                {isAnalyzing && progress.total > 0 && (
                  <div className="space-y-1">
                    <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-600 transition-all" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="text-[11px] text-slate-500 text-center">{progress.stage}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右側：主工作區 */}
          <div className="lg:col-span-9 space-y-5">

            {/* 分數分佈 */}
            <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 pb-2 border-b border-slate-100 gap-3">
                <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
                  <BarChart3 className="w-6 h-6 text-orange-500" />
                  相似度分佈
                  <span className="text-xs font-normal text-slate-500">（點卡片可篩選）</span>
                </div>

                <div className="flex items-center gap-2 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100">
                  <span className="text-xs font-bold text-orange-800">刪除低於</span>
                  <input
                    type="range"
                    min="60"
                    max="99"
                    step="1"
                    value={deleteThreshold}
                    onChange={(e) => setDeleteThreshold(Number(e.target.value))}
                    className="w-24 h-2 bg-white rounded-lg appearance-none cursor-pointer accent-orange-600 border border-orange-200"
                  />
                  <span className="text-sm font-bold text-orange-700 w-9 text-right">{deleteThreshold}%</span>
                  <button
                    onClick={deleteBelowThreshold}
                    disabled={results.length === 0}
                    className="ml-2 bg-white text-orange-600 hover:bg-orange-100 border border-orange-200 px-3 py-1.5 rounded text-xs flex items-center gap-1 font-bold transition-colors shadow-sm disabled:opacity-40"
                    title="執行刪除"
                  >
                    <Eraser className="w-3 h-3" /> 執行刪除
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {visibleBuckets.map((config) => {
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
                      <div className={`text-xs font-bold ${config.color} mb-1`}>{config.label}</div>
                      <div className="flex justify-between items-end">
                        <span className="text-2xl font-bold text-slate-700">{stats[config.key] ?? 0}</span>
                        <span className="text-xs text-slate-400 mb-1">組</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 說明 / 匯出 / 清單 */}
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
                    onClick={() => void runGenerateText()}
                    disabled={results.length === 0 || analyzingIds.size > 0}
                    className="flex-1 md:flex-none text-xs bg-emerald-600 text-white px-3 py-2 rounded font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                  >
                    {analyzingIds.size > 0 ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FileCheck className="w-3 h-3" />
                    )}
                    產生差異說明及結論{hasKey && topN > 0 ? `（前 ${topN} 組用 AI）` : '（規則模板）'}
                  </button>

                  <div className="h-6 w-[1px] bg-slate-300 mx-1" />

                  <button
                    onClick={() => void exportToWord()}
                    disabled={isExporting}
                    className="flex-1 md:flex-none text-xs bg-blue-600 text-white px-3 py-2 rounded font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                  >
                    {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardList className="w-3 h-3" />}
                    匯出 WORD 報告
                  </button>
                </div>
              </div>

              <div className="p-4 space-y-3 h-[520px] overflow-y-auto custom-scrollbar bg-slate-50/50">
                {filteredResults.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <FileImage className="w-16 h-16 mb-3 opacity-20" />
                    <p className="text-sm">{results.length === 0 ? '清單為空' : '目前的分數區間篩選沒有命中任何項目'}</p>
                    {results.length === 0 && (
                      <p className="text-xs mt-1 text-slate-400">所有配對相似度均達 {listThreshold}%，無低於 {listThreshold}% 的案例</p>
                    )}
                  </div>
                )}

                {filteredResults.slice(0, visibleCount).map((item) => (
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
                          <img src={item.thumbA} className="w-full h-full object-contain" alt="" loading="lazy" />
                        </div>
                      </div>

                      <div className="flex flex-col items-center justify-center w-20 shrink-0">
                        <div className="text-[10px] text-indigo-400">DINOv2</div>
                        {item.dino !== null ? (
                          <div className={`text-lg font-black ${item.dino >= 95 ? 'text-red-600' : 'text-indigo-600'}`}>
                            {item.dino}%
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">--</span>
                        )}
                        <div className="w-8 h-[1px] bg-slate-200 my-1" />
                        <div className="text-[10px] text-slate-400">像素</div>
                        <div className="text-sm font-bold text-slate-600">{item.pixel}%</div>
                        <div className="text-[11px] font-semibold text-amber-800 text-center mt-2 leading-4">{assessPhotoEvidence(item).heading}</div>
                      </div>

                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="text-[10px] text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded w-fit truncate max-w-full">
                          B: {item.sourceB}
                        </div>
                        <div className="aspect-video bg-slate-100 rounded border border-slate-200 overflow-hidden">
                          <img src={item.thumbB} className="w-full h-full object-contain" alt="" loading="lazy" />
                        </div>
                      </div>
                    </div>

                    <div className="sm:w-1/3 border-l border-slate-100 pl-4 flex flex-col justify-center text-xs">
                      {item.analysis ? (
                        <div className="bg-emerald-50 text-emerald-800 p-2.5 rounded border border-emerald-100 h-full overflow-y-auto max-h-[100px] custom-scrollbar">
                          <div className="font-bold mb-1 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            {item.analysisSource === 'ai' ? 'AI 分析結論' : '規則判定結論'}
                          </div>
                          <div className="opacity-90 leading-relaxed whitespace-pre-line">{item.analysis}</div>
                        </div>
                      ) : (
                        <div className="text-center text-slate-400 py-4 italic border-2 border-dashed border-slate-100 rounded">
                          尚未產生差異說明
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {filteredResults.length > visibleCount && (
                  <button
                    onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
                    className="w-full py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 flex items-center justify-center gap-2"
                  >
                    <SquareStack className="w-3.5 h-3.5" />
                    顯示更多（還有 {filteredResults.length - visibleCount} 組）
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* 置中操作通知：取代原生 alert，避免跳至視窗上方 */}
      {dialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 bg-slate-900/50 backdrop-blur-sm" role="presentation" onMouseDown={(e)=>{if(e.target===e.currentTarget)setDialog(null);}}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="audit-dialog-title" aria-describedby="audit-dialog-message"
            className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl border border-slate-200">
            <div className={'mx-auto w-16 h-16 rounded-2xl flex items-center justify-center mb-5 '+(dialog.type==='warning'?'bg-amber-50 text-amber-600':'bg-emerald-50 text-emerald-600')}>
              {dialog.type==='warning' ? <AlertTriangle className="w-9 h-9" /> : <CheckCircle className="w-9 h-9" />}
            </div>
            <h2 id="audit-dialog-title" className="text-xl font-black text-slate-800 mb-3">{dialog.title}</h2>
            <p id="audit-dialog-message" className="text-sm text-slate-600 whitespace-pre-line leading-7 mb-6">{dialog.message}</p>
            <button autoFocus onClick={()=>setDialog(null)} className="rounded-xl bg-blue-700 px-10 py-3 text-white font-semibold hover:bg-blue-800">確定</button>
          </div>
        </div>
      )}
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
                    <img src={fullUrl(selectedResult.fileA)} className="max-w-full max-h-full object-contain mx-auto" alt="" />
                  </div>
                  <div className="flex-1 h-full flex flex-col">
                    <img src={fullUrl(selectedResult.fileB)} className="max-w-full max-h-full object-contain mx-auto" alt="" />
                  </div>
                </div>
              </div>
              <div className="w-full lg:w-96 border-l border-slate-200 bg-white p-6 overflow-y-auto">
                <h4 className="font-bold text-slate-800 mb-4 pb-2 border-b">分析報告</h4>
                <div className="flex gap-4 mb-4">
                  <div className="bg-indigo-50 p-3 rounded-lg flex-1 text-center">
                    <div className="text-xs font-bold text-indigo-800">DINOv2</div>
                    <div className="text-2xl font-black text-indigo-600">{selectedResult.dino ?? 'N/A'}%</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg flex-1 text-center">
                    <div className="text-xs font-bold text-slate-600">像素比對</div>
                    <div className="text-2xl font-bold text-slate-500">{selectedResult.pixel}%</div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 space-y-1 mb-3">
                  <div>A：{selectedResult.sourceA} / {selectedResult.fileA.name}</div>
                  <div>B：{selectedResult.sourceB} / {selectedResult.fileB.name}</div>
                </div>
                {selectedResult.analysis ? (
                  <div className="bg-slate-50 p-4 rounded text-sm leading-relaxed whitespace-pre-line text-slate-700">
                    {selectedResult.analysis}
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
