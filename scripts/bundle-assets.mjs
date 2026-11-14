/**
 * Copies the synced asset library into dist/ for the desktop app, which has no
 * server to serve it from. The browser build does not need this: the dev
 * server and `vite preview` serve asset-library/ directly.
 *   npm run build:app
 */
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'asset-library');
const to = join(root, 'dist', 'asset-library');
if (!existsSync(join(from, 'index.json'))) {
  console.error('No asset library: run `npm run assets:unpack` and `npm run assets:sync` first.');
  process.exit(1);
}
cpSync(from, to, { recursive: true });
console.log('Asset library copied into dist/ for the desktop app.');
