import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

/**
 * Start-up, behind the loading screen in index.html: load the game code, then
 * the asset index and the frame art every screen uses, then fade the loading
 * screen out. Loading the app with a dynamic import lets the loading screen
 * show what is happening while the code arrives.
 */

const boot = document.getElementById('boot');
const status = boot?.querySelector('.status');

function say(text: string) {
  if (status) status.textContent = text;
}

function fail(error: unknown) {
  boot?.classList.add('failed');
  say(`The game could not start:\n${error instanceof Error ? error.message : String(error)}`);
}

/** The 9-slice frames used by buttons and panels everywhere, so the first screen does not pop in. */
const FRAME_ART = ['/ui/panel_plain.png', '/ui/dialog.png', '/ui/btn_iron_m_normal.png', '/ui/btn_ember_m_normal.png', '/ui/input_normal.png'];

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;
  });
}

async function start() {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element in index.html');

  say('Loading the game…');
  const [{ App }, { loadAssetIndex }] = await Promise.all([import('./App'), import('./screens/assets')]);

  say('Loading art…');
  await Promise.all([loadAssetIndex(), ...FRAME_ART.map(preload)]);

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  // Fade out once the first screen has been drawn.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      boot?.classList.add('done');
      window.setTimeout(() => boot?.remove(), 500);
    }),
  );
}

start().catch(fail);
