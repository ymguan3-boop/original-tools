/**
 * DINOv2 Worker 用戶端
 * ---------------------------------------------------------------------
 * 以單例方式管理 Worker 生命週期，提供 Promise 化的 init / analyze 介面，
 * 並把模型狀態與下載進度回報給 React（UI 不會被推論阻塞）。
 */

export interface BatchItemResult {
  id: number;
  thumb: Blob;
  sig: Uint8ClampedArray;
  embedding: Float32Array | null;
  width: number;
  height: number;
}

export type ModelState = 'idle' | 'loading' | 'ready' | 'error';

interface Waiter {
  resolve: (results: BatchItemResult[]) => void;
  reject: (err: Error) => void;
}

export class DinoClient {
  private worker: Worker | null = null;
  private seq = 0;
  private waiters = new Map<number, Waiter>();
  private initPromise: Promise<void> | null = null;
  private initResolve: (() => void) | null = null;
  private initReject: ((err: Error) => void) | null = null;

  state: ModelState = 'idle';
  progress = 0;
  error: string | null = null;
  onStateChange: ((state: ModelState, progress: number, error: string | null) => void) | null = null;

  private notify(): void {
    this.onStateChange?.(this.state, this.progress, this.error);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('./embedWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => this.handleMessage(event.data as Record<string, unknown>);
    worker.onerror = (event) => {
      const message = event.message || '背景執行緒發生錯誤';
      this.error = message;
      this.state = 'error';
      this.notify();
      this.initReject?.(new Error(message));
      this.waiters.forEach((w) => w.reject(new Error(message)));
      this.waiters.clear();
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'model-progress':
        this.state = 'loading';
        this.progress = Number(msg.progress ?? 0);
        this.notify();
        break;

      case 'ready':
        this.state = 'ready';
        this.progress = 100;
        this.error = null;
        this.notify();
        this.initResolve?.();
        this.initPromise = null;
        this.initResolve = null;
        this.initReject = null;
        break;

      case 'model-error': {
        const message = String(msg.message ?? '模型載入失敗');
        this.state = 'error';
        this.error = message;
        this.notify();
        if (this.initReject) {
          this.initReject(new Error(message));
          this.initPromise = null;
          this.initResolve = null;
          this.initReject = null;
        }
        break;
      }

      case 'batch': {
        const batchId = Number(msg.batchId);
        const waiter = this.waiters.get(batchId);
        if (!waiter) return;
        this.waiters.delete(batchId);
        waiter.resolve((msg.results ?? []) as BatchItemResult[]);
        break;
      }

      case 'batch-error': {
        const batchId = Number(msg.batchId);
        const waiter = this.waiters.get(batchId);
        if (!waiter) return;
        this.waiters.delete(batchId);
        waiter.reject(new Error(String(msg.message ?? '分析失敗')));
        break;
      }

      default:
        break;
    }
  }

  /** 載入模型；失敗時 reject，但 Worker 仍可繼續產生縮圖與像素特徵 */
  init(): Promise<void> {
    if (this.state === 'ready') return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    const worker = this.ensureWorker();
    this.state = 'loading';
    this.progress = 0;
    this.error = null;
    this.notify();

    this.initPromise = new Promise<void>((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
    worker.postMessage({ type: 'init' });
    return this.initPromise;
  }

  analyze(items: { id: number; file: File }[]): Promise<BatchItemResult[]> {
    if (items.length === 0) return Promise.resolve([]);
    const worker = this.ensureWorker();
    const batchId = ++this.seq;

    return new Promise<BatchItemResult[]>((resolve, reject) => {
      this.waiters.set(batchId, { resolve, reject });
      worker.postMessage({ type: 'analyze', batchId, items });
    });
  }

  /** 中止目前工作並重建 Worker（用於「停止」按鈕） */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.waiters.forEach((w) => w.reject(new Error('已停止')));
    this.waiters.clear();
    this.initReject?.(new Error('已停止'));
    this.initPromise = null;
    this.initResolve = null;
    this.initReject = null;
    this.state = 'idle';
    this.progress = 0;
    this.error = null;
    this.notify();
  }
}

let client: DinoClient | null = null;

export const getDinoClient = (): DinoClient => {
  if (!client) client = new DinoClient();
  return client;
};
