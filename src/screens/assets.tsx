import { useEffect, useState, type CSSProperties } from 'react';

/**
 * Images come from the locally synced asset library (`npm run assets:sync`).
 * It is not committed, so every image here falls back to a placeholder when
 * the file is missing.
 */

export interface AssetEntry {
  id: string;
  file: string;
  category: string;
  pack: string;
  label: string;
  /** Number of 192 px frames, for animation sheets. */
  frames?: number;
}

const LIBRARY = `${import.meta.env.BASE_URL}asset-library/`;

export function assetUrl(id: string): string {
  return `${LIBRARY}${id}${id.startsWith('animations/') ? '.png' : '.webp'}`;
}

let indexPromise: Promise<AssetEntry[]> | null = null;

/** The library index, fetched once. Empty when the library has not been synced. */
export function loadAssetIndex(): Promise<AssetEntry[]> {
  indexPromise ??= fetch(`${LIBRARY}index.json`)
    .then((r) => (r.ok ? r.json() : { entries: [] }))
    .then((data: { entries?: AssetEntry[] }) => data.entries ?? [])
    .catch(() => []);
  return indexPromise;
}

export function useAssetIndex(): AssetEntry[] | null {
  const [entries, setEntries] = useState<AssetEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadAssetIndex().then((e) => live && setEntries(e));
    return () => {
      live = false;
    };
  }, []);
  return entries;
}

/**
 * Plays a sprite-sheet animation: 192 px frames, 5 per row, 15 frames a second.
 * With `once`, it stops on the last frame instead of looping.
 */
export function AnimationPreview({ id, frames = 15, size = 96, once = false }: { id: string; frames?: number; size?: number; once?: boolean }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    setFrame(0);
    const total = Math.max(1, frames);
    const timer = window.setInterval(
      () => setFrame((f) => (once ? Math.min(f + 1, total - 1) : (f + 1) % total)),
      1000 / 15,
    );
    return () => window.clearInterval(timer);
  }, [id, frames, once]);
  const col = frame % 5;
  const row = Math.floor(frame / 5);
  const rows = Math.max(1, Math.ceil(frames / 5));
  return (
    <span
      className="animation-preview"
      role="img"
      aria-label={id}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${assetUrl(id)})`,
        backgroundSize: `${size * 5}px ${size * rows}px`,
        backgroundPosition: `-${col * size}px -${row * size}px`,
      }}
    />
  );
}

interface Props {
  id?: string;
  /** Shown when there is no id or the file is missing, e.g. initials. */
  fallback?: string;
  alt?: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
}

export function AssetImage({ id, fallback = '?', alt = '', className = '', size, style }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id]);

  const box: CSSProperties = size ? { width: size, height: size, ...style } : { ...style };
  if (!id || failed) {
    return (
      <span className={`asset-fallback ${className}`} style={box} aria-hidden={alt ? undefined : true} title={alt}>
        {fallback}
      </span>
    );
  }
  return (
    <img
      className={`asset-img ${className}`}
      src={assetUrl(id)}
      alt={alt}
      style={box}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
