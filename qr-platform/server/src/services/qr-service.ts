import QRCode from 'qrcode';
import { Jimp, JimpMime } from 'jimp';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { q, qOne, run } from '../models/database.js';

const UPLOADS_DIR = process.env.WRITABLE_DIR
  ? path.join(process.env.WRITABLE_DIR, 'logos')
  : path.join(process.cwd(), '..', 'uploads', 'logos');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export interface QRAppearance {
  fgColor?: string;
  bgColor?: string;
  borderStyle?: 'none' | 'solid' | 'rounded' | 'dots';
  borderWidth?: number;
  logoUrl?: string;
  margin?: number;
  width?: number;
}

export interface QRCreationInput {
  title: string;
  linkType: string;
  target: string;
  contentData?: string;
  folderId?: string;
  appearance?: QRAppearance;
}

export interface QRCodeRecord {
  id: string;
  short_id: string;
  title: string;
  link_type: string;
  target: string;
  content_data: string | null;
  folder_id: string | null;
  appearance: string;
  status: string;
  created_at: string;
  updated_at: string;
  scan_count?: number;
}

function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const existing = qOne('SELECT id FROM qrcodes WHERE short_id = ?', [result]);
  if (existing) return generateShortId();
  return result;
}

export async function resolveAndTrack(shortId: string, req: any): Promise<string | null> {
  const qr = qOne('SELECT * FROM qrcodes WHERE short_id = ? AND status = ?', [shortId, 'active']);
  if (!qr) return null;

  const scanId = uuidv4();
  const ua = req.headers['user-agent'] || '';
  const deviceType = /mobile/i.test(ua) ? 'mobile' : /tablet/i.test(ua) ? 'tablet' : 'desktop';
  const browser = /chrome/i.test(ua) ? 'Chrome' : /firefox/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : /edge/i.test(ua) ? 'Edge' : 'Other';
  const os = /windows/i.test(ua) ? 'Windows' : /mac/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : /android/i.test(ua) ? 'Android' : /ios/i.test(ua) ? 'iOS' : 'Other';

  run(
    'INSERT INTO scans (id, qrcode_id, ip_address, user_agent, device_type, browser, os, referer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [scanId, qr.id, req.ip || req.connection?.remoteAddress || '', ua, deviceType, browser, os, req.headers['referer'] || '']
  );

  return qr.target;
}

export async function generateQRImage(target: string, appearance: QRAppearance = {}): Promise<Buffer> {
  const { fgColor = '#000000', bgColor = '#ffffff', width = 400, margin = 2, logoUrl } = appearance;

  const qrBuffer = await QRCode.toBuffer(target, {
    width, margin,
    color: { dark: fgColor, light: bgColor },
    type: 'png',
  });

  if (!logoUrl) return qrBuffer;

  try {
    const logoPath = logoUrl.startsWith('/') ? path.join(process.cwd(), '..', logoUrl) : logoUrl;
    if (!fs.existsSync(logoPath)) return qrBuffer;

    const qrImage = await Jimp.read(qrBuffer);
    const logoImage = await Jimp.read(logoPath);
    const logoSize = Math.floor(qrImage.bitmap.width * 0.25);
    logoImage.resize({ w: logoSize, h: logoSize });

    const offsetX = Math.floor((qrImage.bitmap.width - logoSize) / 2);
    const offsetY = Math.floor((qrImage.bitmap.height - logoSize) / 2);
    qrImage.composite(logoImage, offsetX, offsetY);

    return await qrImage.getBuffer(JimpMime.png);
  } catch {
    return qrBuffer;
  }
}

export async function createQRCode(input: QRCreationInput): Promise<QRCodeRecord> {
  const id = uuidv4();
  const shortId = generateShortId();
  const appearanceJson = JSON.stringify(input.appearance || {});
  const contentData = input.contentData || JSON.stringify({ url: input.target });

  run(
    'INSERT INTO qrcodes (id, short_id, title, link_type, target, content_data, folder_id, appearance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, shortId, input.title, input.linkType, input.target, contentData, input.folderId || null, appearanceJson]
  );

  return qOne('SELECT * FROM qrcodes WHERE id = ?', [id]);
}

export function updateQRCode(id: string, updates: Partial<QRCreationInput> & { status?: string }): QRCodeRecord | null {
  const existing = qOne('SELECT * FROM qrcodes WHERE id = ?', [id]);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.linkType !== undefined) { fields.push('link_type = ?'); values.push(updates.linkType); }
  if (updates.target !== undefined) { fields.push('target = ?'); values.push(updates.target); }
  if (updates.contentData !== undefined) { fields.push('content_data = ?'); values.push(updates.contentData); }
  if (updates.folderId !== undefined) { fields.push('folder_id = ?'); values.push(updates.folderId || null); }
  if (updates.appearance !== undefined) { fields.push('appearance = ?'); values.push(JSON.stringify(updates.appearance)); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (fields.length > 0) {
    fields.push("updated_at = datetime('now')");
    run(`UPDATE qrcodes SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
  }

  return qOne('SELECT * FROM qrcodes WHERE id = ?', [id]);
}

export function deleteQRCode(id: string): boolean {
  run('DELETE FROM scans WHERE qrcode_id = ?', [id]);
  run('DELETE FROM qrcodes WHERE id = ?', [id]);
  return true;
}

export function listQRCodes(options: { folderId?: string; search?: string; page?: number; limit?: number } = {}) {
  const page = options.page || 1;
  const limit = options.limit || 20;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: any[] = [];

  if (options.folderId) { where += ' AND q.folder_id = ?'; params.push(options.folderId); }
  if (options.search) { where += ' AND (q.title LIKE ? OR q.target LIKE ?)'; params.push(`%${options.search}%`, `%${options.search}%`); }

  const totalRow = qOne(`SELECT COUNT(*) as cnt FROM qrcodes q ${where}`, params);
  const total = totalRow ? totalRow.cnt : 0;

  const items = q(`
    SELECT q.*, COALESCE(s.cnt, 0) as scan_count
    FROM qrcodes q
    LEFT JOIN (SELECT qrcode_id, COUNT(*) as cnt FROM scans GROUP BY qrcode_id) s ON s.qrcode_id = q.id
    ${where}
    ORDER BY q.updated_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export function getQRCodeById(id: string): QRCodeRecord | null {
  return qOne(`
    SELECT q.*, COALESCE(s.cnt, 0) as scan_count
    FROM qrcodes q
    LEFT JOIN (SELECT qrcode_id, COUNT(*) as cnt FROM scans GROUP BY qrcode_id) s ON s.qrcode_id = q.id
    WHERE q.id = ?
  `, [id]) || null;
}

// --- Folders ---
export function listFolders() {
  return q(`
    SELECT f.*, COALESCE(q.cnt, 0) as qrcode_count
    FROM folders f
    LEFT JOIN (SELECT folder_id, COUNT(*) as cnt FROM qrcodes GROUP BY folder_id) q ON q.folder_id = f.id
    ORDER BY f.name ASC
  `);
}

export function createFolder(name: string, color?: string) {
  const id = uuidv4();
  run('INSERT INTO folders (id, name, color) VALUES (?, ?, ?)', [id, name, color || '#6366f1']);
  return qOne('SELECT * FROM folders WHERE id = ?', [id]);
}

export function updateFolder(id: string, updates: { name?: string; color?: string }) {
  const fields: string[] = [];
  const values: any[] = [];
  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.color) { fields.push('color = ?'); values.push(updates.color); }
  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    run(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
  }
  return qOne('SELECT * FROM folders WHERE id = ?', [id]);
}

export function deleteFolder(id: string) {
  run('UPDATE qrcodes SET folder_id = NULL WHERE folder_id = ?', [id]);
  run('DELETE FROM folders WHERE id = ?', [id]);
  return true;
}

// --- Analytics ---
export function getScanStats(qrcodeId: string) {
  const totalRow = qOne('SELECT COUNT(*) as cnt FROM scans WHERE qrcode_id = ?', [qrcodeId]);
  const total = totalRow ? totalRow.cnt : 0;
  const byDevice = q('SELECT device_type, COUNT(*) as cnt FROM scans WHERE qrcode_id = ? GROUP BY device_type', [qrcodeId]);
  const byBrowser = q('SELECT browser, COUNT(*) as cnt FROM scans WHERE qrcode_id = ? GROUP BY browser', [qrcodeId]);
  const byOs = q('SELECT os, COUNT(*) as cnt FROM scans WHERE qrcode_id = ? GROUP BY os', [qrcodeId]);
  const byDay = q("SELECT date(scanned_at) as day, COUNT(*) as cnt FROM scans WHERE qrcode_id = ? GROUP BY day ORDER BY day ASC", [qrcodeId]);
  return { total, byDevice, byBrowser, byOs, byDay };
}

export function getDashboardStats() {
  const totalQR = (qOne('SELECT COUNT(*) as cnt FROM qrcodes') || { cnt: 0 }).cnt;
  const totalScans = (qOne('SELECT COUNT(*) as cnt FROM scans') || { cnt: 0 }).cnt;
  const activeQR = (qOne("SELECT COUNT(*) as cnt FROM qrcodes WHERE status = 'active'") || { cnt: 0 }).cnt;
  const recentScans = q(`
    SELECT s.*, q.title, q.short_id
    FROM scans s JOIN qrcodes q ON q.id = s.qrcode_id
    ORDER BY s.scanned_at DESC LIMIT 20
  `);
  const scansByDay = q(`
    SELECT date(scanned_at) as day, COUNT(*) as cnt
    FROM scans WHERE scanned_at >= datetime('now', '-30 days')
    GROUP BY day ORDER BY day ASC
  `);
  return { totalQR, totalScans, activeQR, recentScans, scansByDay };
}
