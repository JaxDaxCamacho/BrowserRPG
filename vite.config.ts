import { createReadStream, existsSync, statSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Content files the in-game editors may overwrite, relative to src/content. */
const EDITABLE_CONTENT = new Set([
  'items.json',
  'abilities.json',
  'monsters.json',
  'classes.json',
  'races.json',
  'premades.json',
  'portraits.json',
]);
/** One file per dungeon or adventure, named by its id. */
const PER_ENTRY_FILE = /^(dungeons|adventures)\/[a-z][a-z0-9-]*\.json$/;
/** Only dungeons can be deleted from the editor. */
const DELETABLE = /^dungeons\/[a-z][a-z0-9-]*\.json$/;

/** Why a write is refused, or null when it is allowed. */
function refuseWrite(file: string, data: unknown): string | null {
  if (PER_ENTRY_FILE.test(file)) {
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? null : `${file} holds one JSON object.`;
  }
  if (EDITABLE_CONTENT.has(file)) return Array.isArray(data) ? null : `${file} holds a JSON array.`;
  return `"${file}" is not an editable content file.`;
}

/**
 * Dev-only endpoint for the content editor and dungeon maker. It does not exist in production builds.
 *   POST /__content/<file>     body: the file's JSON
 *   POST /__content/__batch    body: { writes: [{ file, data }], deletes: [file] }, all checked before any is done
 */
function contentEditorEndpoint(): Plugin {
  return {
    name: 'allerya-content-editor',
    apply: 'serve',
    configureServer(server) {
      const pathOf = (file: string) => join(server.config.root, 'src', 'content', file);
      const write = (file: string, data: unknown) => writeFile(pathOf(file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');

      server.middlewares.use('/__content', (req, res) => {
        const reply = (status: number, body: object) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const file = decodeURIComponent((req.url ?? '').replace(/^\/+/, '').split('?')[0] ?? '');
        if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
        // A custom header cannot be sent cross-site without a preflight, so only the game's own page can write.
        if (req.headers['x-allerya-editor'] !== '1') return reply(403, { error: 'Missing editor header.' });

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', () => {
          let data: unknown;
          try {
            data = JSON.parse(body);
          } catch {
            return reply(400, { error: 'Body is not valid JSON.' });
          }

          if (file === '__batch') {
            const batch = data as { writes?: { file: string; data: unknown }[]; deletes?: string[] };
            const writes = Array.isArray(batch.writes) ? batch.writes : [];
            const deletes = Array.isArray(batch.deletes) ? batch.deletes : [];
            for (const w of writes) {
              const why = refuseWrite(String(w.file), w.data);
              if (why) return reply(400, { error: why });
            }
            for (const d of deletes) {
              if (!DELETABLE.test(String(d))) return reply(400, { error: `"${d}" cannot be deleted.` });
            }
            Promise.all([...writes.map((w) => write(w.file, w.data)), ...deletes.map((d) => unlink(pathOf(d)))])
              .then(() => reply(200, { ok: true, written: writes.length, deleted: deletes.length }))
              .catch((error: unknown) => reply(500, { error: String(error) }));
            return;
          }

          const why = refuseWrite(file, data);
          if (why) return reply(EDITABLE_CONTENT.has(file) || PER_ENTRY_FILE.test(file) ? 400 : 404, { error: why });
          write(file, data)
            .then(() => reply(200, { ok: true, file }))
            .catch((error: unknown) => reply(500, { error: String(error) }));
        });
      });
    },
  };
}

const MEDIA_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * Serves the synced asset library (asset-library/, git-ignored) at /asset-library/ in both
 * the dev server and `vite preview`. It lives outside public/ so builds do not copy hundreds
 * of megabytes of art and sound into dist/ every time.
 */
function assetLibrary(): Plugin {
  const serve = (root: string) => (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
    const file = join(root, 'asset-library', path);
    // Stay inside the library: no climbing out with '..'.
    if (path.includes('..') || !existsSync(file) || !statSync(file).isFile()) return next();
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
    res.setHeader('Content-Type', MEDIA_TYPES[ext] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', ext === '.json' ? 'no-cache' : 'public, max-age=86400');
    createReadStream(file).pipe(res);
  };
  return {
    name: 'allerya-asset-library',
    configureServer(server) {
      server.middlewares.use('/asset-library', serve(server.config.root));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/asset-library', serve(server.config.root));
    },
  };
}

export default defineConfig({
  plugins: [react(), contentEditorEndpoint(), assetLibrary()],
  // Relative asset paths so the same build works in a browser, Tauri and Android.
  base: './',
  optimizeDeps: {
    // Bundled up front, so a first run does not stop to discover them and reload the page.
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'zustand', 'zod', 'pixi.js'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
