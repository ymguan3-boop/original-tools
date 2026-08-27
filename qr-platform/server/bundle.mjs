import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'dist');

async function bundle() {
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Bundle server into a single CJS file (sql.js kept external for WASM)
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(outDir, 'server.cjs'),
    target: 'node18',
    packages: 'bundle',
    external: ['sql.js'],
    define: {
      'import.meta.url': 'undefined',
    },
  });

  // Copy sql.js dist files
  const sqlSrc = path.join(__dirname, 'node_modules', 'sql.js', 'dist');
  const sqlDst = path.join(outDir, 'sql.js-dist');
  if (fs.existsSync(sqlSrc)) {
    fs.mkdirSync(sqlDst, { recursive: true });
    for (const f of fs.readdirSync(sqlSrc)) {
      fs.copyFileSync(path.join(sqlSrc, f), path.join(sqlDst, f));
    }
    console.log('Copied sql.js dist files');
  }

  console.log('Server bundled to dist/server.cjs');
}

bundle().catch((err) => {
  console.error(err);
  process.exit(1);
});
