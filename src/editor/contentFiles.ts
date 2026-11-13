/** Talks to the dev server's content endpoint (see vite.config.ts). Development builds only. */

async function send(method: 'POST', file: string, data: unknown): Promise<void> {
  const response = await fetch(`/__content/${file}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-allerya-editor': '1' },
    body: JSON.stringify(data),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? response.statusText);
}

export const writeContentFile = (file: string, data: unknown) => send('POST', file, data);

/** Writes and deletes several files in one request, so a reload between them cannot leave a half-saved change. */
export const writeContentFiles = (writes: { file: string; data: unknown }[], deletes: string[] = []) =>
  send('POST', '__batch', { writes, deletes });
