/**
 * 嵌入向量快取（IndexedDB）
 * ---------------------------------------------------------------------
 * 以檔案內容的 SHA-256 為 key，快取 DINOv2 的 384 維向量、64×64 像素特徵與
 * 480px 縮圖。重跑同一案件（或同一張照片出現在不同資料夾）時直接命中，
 * 省下整次推論（約 0.5 秒/張）。
 *
 * - 內容定址：key 是雜湊，檔案內容不變就不會失效，不需要版本號。
 * - 僅在成功取得 DINOv2 向量時才寫入；模型失敗時不快取，下次重試。
 * - IndexedDB 不可用（隱私模式等）時所有函式靜默失敗，流程仍可走完。
 */
const DB_NAME = 'image-audit-embed-cache';
const STORE_NAME = 'embeddings';
const DB_VERSION = 1;

export interface CachedEmbed {
  hash: string;
  sig: Uint8ClampedArray;
  embedding: Float32Array;
  thumb: Blob;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

export const getCached = async (hash: string): Promise<CachedEmbed | null> => {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<CachedEmbed | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(hash);
      req.onsuccess = () => resolve((req.result as CachedEmbed) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
};

export const setCached = async (data: CachedEmbed): Promise<void> => {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* 配額不足或寫入失敗時靜默忽略，不影響主流程 */
  }
};

export const clearEmbedCache = async (): Promise<void> => {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* ignore */
  }
};

export const countCached = async (): Promise<number> => {
  try {
    const db = await openDb();
    if (!db) return 0;
    return await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
};
