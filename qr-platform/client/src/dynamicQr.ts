export interface ActivityEntry {
  label: string;
  target: string;
  updatedAt: string;
}

export type ActivityMap = Record<string, ActivityEntry>;

export const OVERRIDES_KEY = 'qr-dynamic-overrides';

const SLUG_RE = /^[A-Za-z0-9_-]{2,32}$/;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s.trim());
}

export function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 印在 QR 裡的固定連結：內容永遠不變，只改中轉表 target */
export function fixedLinkFor(code: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${base}r/?c=${encodeURIComponent(code.trim())}`;
}

/** 本機測試用相對連結（dev / prod 皆可開） */
export function testLinkFor(code: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}r/?c=${encodeURIComponent(code.trim())}`;
}

export function loadOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj as Record<string, string>;
  } catch {
    /* 忽略 */
  }
  return {};
}

export function saveOverrides(overrides: Record<string, string>) {
  window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

export async function loadActivities(): Promise<ActivityMap> {
  const base = import.meta.env.BASE_URL || '/';
  const res = await fetch(`${base}links.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`links.json 載入失敗 (${res.status})`);
  const data = await res.json();
  if (!data || typeof data.links !== 'object') throw new Error('links.json 格式錯誤');
  return data.links as ActivityMap;
}

const FILE_COMMENT =
  '活動式連結 QR 中轉表：QR 印的是固定短碼網址(…/qr-platform/r/?c=代碼)，只改這裡的 target，QR 圖永遠不變。改完 commit + push，GitHub Pages 重部署即公開生效。';

export function buildLinksJson(activities: ActivityMap): string {
  return JSON.stringify({ _comment: FILE_COMMENT, links: activities }, null, 2) + '\n';
}

export function todayStr(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
