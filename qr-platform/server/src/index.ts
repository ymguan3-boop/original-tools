import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDB } from './models/database.js';
import apiRoutes from './routes/api.js';
import redirectRoutes from './routes/redirect.js';

declare const __dirname: string;

export interface ServerOptions {
  port?: number;
  clientDist?: string;
  writableDir?: string;
  sqlWasmPath?: string;
}

declare const module: any;

export async function startServer(opts?: ServerOptions) {
  const app = express();
  const PORT = opts?.port || Number(process.env.PORT) || 3001;

  // Set env vars so downstream modules (database, api) use the right paths
  if (opts?.writableDir) process.env.WRITABLE_DIR = opts.writableDir;
  if (opts?.sqlWasmPath) process.env.SQL_WASM_PATH = opts.sqlWasmPath;

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Serve built client
  const clientDist = opts?.clientDist || path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));

  // Uploads directory
  const uploadsDir = process.env.WRITABLE_DIR
    ? path.join(process.env.WRITABLE_DIR, 'logos')
    : path.join(__dirname, '..', '..', 'uploads');
  app.use('/uploads', express.static(uploadsDir));

  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  app.use('/api', apiRoutes);
  app.use('/r', redirectRoutes);

  // SPA fallback — serve index.html for all non-file routes
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  await initDB();

  const maxPort = (opts?.port || PORT) + 10;
  let port = PORT;
  let started = false;

  while (port <= maxPort && !started) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = app.listen(port, () => {
          console.log(`QR Platform server running at http://localhost:${port}`);
          started = true;
          resolve();
        });
        server.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            console.warn(`Port ${port} in use, trying ${port + 1}...`);
            port++;
            resolve();
          } else {
            reject(err);
          }
        });
      });
    } catch (err: any) {
      if (err.code === 'EADDRINUSE') continue;
      throw err;
    }
  }

  return { port };
}

// Auto-start when run directly (node dist/server.cjs), not when require()'d
if (typeof require !== 'undefined' && require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
