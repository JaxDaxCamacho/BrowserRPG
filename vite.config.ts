import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Content files the in-game editor is allowed to overwrite. */
const EDITABLE_CONTENT = new Set([
  'items.json',
  'abilities.json',
  'monsters.json',
  'classes.json',
  'races.json',
  'premades.json',
]);

/**
 * Dev-only endpoint for the content editor: POST /__content/<file> with a JSON
 * array writes it to src/content/<file>. It does not exist in production builds.
 */
function contentEditorEndpoint(): Plugin {
  return {
    name: 'allerya-content-editor',
    apply: 'serve',
    configureServer(server) {
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
        if (!EDITABLE_CONTENT.has(file)) return reply(404, { error: `"${file}" is not an editable content file.` });

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
          if (!Array.isArray(data)) return reply(400, { error: 'Content files hold a JSON array.' });
          const target = join(server.config.root, 'src', 'content', file);
          writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
            .then(() => reply(200, { ok: true, file }))
            .catch((error: unknown) => reply(500, { error: String(error) }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), contentEditorEndpoint()],
  // Relative asset paths so the same build works in a browser, Tauri and Android.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
