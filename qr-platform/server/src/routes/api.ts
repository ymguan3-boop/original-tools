import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import {
  createQRCode, updateQRCode, deleteQRCode, listQRCodes, getQRCodeById,
  generateQRImage, createFolder, listFolders, updateFolder, deleteFolder,
  getScanStats, getDashboardStats, QRCodeRecord,
} from '../services/qr-service.js';

const router = Router();

function getUploadsDir(): string {
  return process.env.WRITABLE_DIR
    ? path.join(process.env.WRITABLE_DIR, 'logos')
    : path.join(process.cwd(), '..', 'uploads', 'logos');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = getUploadsDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Upload logo
router.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `/uploads/logos/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// QR Codes CRUD
router.get('/qrcodes', (req: Request, res: Response) => {
  const { folderId, search, page, limit } = req.query;
  const result = listQRCodes({
    folderId: folderId as string | undefined,
    search: search as string | undefined,
    page: page ? parseInt(page as string) : undefined,
    limit: limit ? parseInt(limit as string) : undefined,
  });
  res.json(result);
});

// Preview QR (no DB required) — MUST be before /:id to avoid "preview" being treated as an ID
router.get('/qrcodes/preview', async (req: Request, res: Response) => {
  const { target, fg, bg } = req.query;
  if (!target) return res.status(400).json({ error: 'target required' });
  try {
    const buf = await generateQRImage(target as string, {
      fgColor: (fg as string) || '#000000',
      bgColor: (bg as string) || '#ffffff',
      width: 300,
    });
    res.set('Content-Type', 'image/png');
    res.send(buf);
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/qrcodes/:id', (req: Request, res: Response) => {
  const qr = getQRCodeById(req.params.id);
  if (!qr) return res.status(404).json({ error: 'Not found' });
  res.json(qr);
});

router.post('/qrcodes', async (req: Request, res: Response) => {
  try {
    const qr = await createQRCode(req.body);
    res.status(201).json(qr);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/qrcodes/:id', async (req: Request, res: Response) => {
  try {
    const qr = updateQRCode(req.params.id, req.body);
    if (!qr) return res.status(404).json({ error: 'Not found' });
    res.json(qr);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/qrcodes/:id', (req: Request, res: Response) => {
  const ok = deleteQRCode(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Generate QR image
router.get('/qrcodes/:id/image', async (req: Request, res: Response) => {
  const qr = getQRCodeById(req.params.id);
  if (!qr) return res.status(404).json({ error: 'Not found' });

  const appearance = JSON.parse(qr.appearance || '{}');
  const target = qr.target;

  try {
    const buf = await generateQRImage(target, appearance);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(buf);
  } catch {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

// Folders
router.get('/folders', (_req: Request, res: Response) => {
  res.json(listFolders());
});

router.post('/folders', (req: Request, res: Response) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.status(201).json(createFolder(name, color));
});

router.put('/folders/:id', (req: Request, res: Response) => {
  res.json(updateFolder(req.params.id, req.body));
});

router.delete('/folders/:id', (req: Request, res: Response) => {
  const ok = deleteFolder(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Analytics
router.get('/qrcodes/:id/stats', (req: Request, res: Response) => {
  const qr = getQRCodeById(req.params.id);
  if (!qr) return res.status(404).json({ error: 'Not found' });
  res.json(getScanStats(req.params.id));
});

router.get('/dashboard/stats', (_req: Request, res: Response) => {
  res.json(getDashboardStats());
});

export default router;
