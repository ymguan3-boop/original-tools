import initSqlJs from 'sql.js';
import path from 'path';
import fs from 'fs';

declare const __dirname: string;
declare const __filename: string;

const DATA_DIR = process.env.WRITABLE_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'qr.db');
const SQL_WASM_PATH = process.env.SQL_WASM_PATH || path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');

let db: any = null;

export async function getDB() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(SQL_WASM_PATH, file),
  });

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');
  return db;
}

export function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function q(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function qOne(sql: string, params: any[] = []): any | null {
  const rows = q(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function run(sql: string, params: any[] = []) {
  db.run(sql, params);
  saveDB();
}

export async function initDB() {
  const d = await getDB();
  d.run(`CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#6366f1',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS qrcodes (
    id TEXT PRIMARY KEY, short_id TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    link_type TEXT NOT NULL DEFAULT 'url', target TEXT NOT NULL, content_data TEXT,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    appearance TEXT DEFAULT '{}', status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
  )`);
  d.run(`CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY, qrcode_id TEXT NOT NULL REFERENCES qrcodes(id) ON DELETE CASCADE,
    scanned_at TEXT DEFAULT (datetime('now')), ip_address TEXT, user_agent TEXT,
    device_type TEXT, browser TEXT, os TEXT, country TEXT, city TEXT, referer TEXT
  )`);

  const idx = d.exec("SELECT name FROM sqlite_master WHERE type='index'").flatMap((r: any) => r.values).flat();
  if (!idx.includes('idx_scans_qrcode')) d.run('CREATE INDEX idx_scans_qrcode ON scans(qrcode_id)');
  if (!idx.includes('idx_scans_date')) d.run('CREATE INDEX idx_scans_date ON scans(scanned_at)');
  if (!idx.includes('idx_qrcodes_short')) d.run('CREATE INDEX idx_qrcodes_short ON qrcodes(short_id)');
  if (!idx.includes('idx_qrcodes_folder')) d.run('CREATE INDEX idx_qrcodes_folder ON qrcodes(folder_id)');
  saveDB();
}
