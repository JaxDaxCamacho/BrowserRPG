import { useEffect, useMemo, useState } from 'react';
import { AnimationPreview, assetUrl, AssetImage, useAssetIndex, type AssetEntry } from '../screens/assets';

const PAGE = 240;

export { AnimationPreview };

/** Only the first frame of an animation, for grids where playing them all would be noisy. */
function FirstFrame({ entry, size }: { entry: AssetEntry; size: number }) {
  const rows = Math.max(1, Math.ceil((entry.frames ?? 15) / 5));
  return (
    <span
      className="animation-preview"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${assetUrl(entry.id)})`,
        backgroundSize: `${size * 5}px ${size * rows}px`,
      }}
    />
  );
}

export function AssetThumb({ entry, size }: { entry: AssetEntry; size: number }) {
  return entry.category.startsWith('animations') ? (
    <FirstFrame entry={entry} size={size} />
  ) : (
    <AssetImage id={entry.id} size={size} fallback="?" alt={entry.label} />
  );
}

interface BrowserProps {
  /** Category to show first, e.g. "weapons" or "portraits". */
  initialCategory?: string;
  selected?: string;
  onPick: (entry: AssetEntry) => void;
}

/** Search and browse the whole synced asset library. */
export function AssetBrowser({ initialCategory = '', selected, onPick }: BrowserProps) {
  const entries = useAssetIndex();
  const [top, setTop] = useState(initialCategory.split('/')[0] ?? '');
  const [sub, setSub] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const tops = useMemo(() => [...new Set((entries ?? []).map((e) => e.category.split('/')[0]!))].sort(), [entries]);
  const subs = useMemo(
    () => [...new Set((entries ?? []).filter((e) => e.category.split('/')[0] === top).map((e) => e.category))].sort(),
    [entries, top],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter(
      (e) =>
        (!top || e.category.split('/')[0] === top) &&
        (!sub || e.category === sub) &&
        (!q || e.id.includes(q) || e.label.toLowerCase().includes(q)),
    );
  }, [entries, top, sub, query]);

  useEffect(() => setLimit(PAGE), [top, sub, query]);

  if (entries === null) return <p className="dim">Loading the asset library…</p>;
  if (entries.length === 0) {
    return (
      <p className="dim">
        No asset library found. Run <code>npm run assets:sync</code> to copy the packs into <code>public/asset-library</code>.
      </p>
    );
  }

  return (
    <div className="asset-browser">
      <div className="row asset-filters">
        <select
          aria-label="Category"
          value={top}
          onChange={(e) => {
            setTop(e.target.value);
            setSub('');
          }}
        >
          <option value="">All categories</option>
          {tops.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {subs.length > 1 && (
          <select aria-label="Folder" value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">All of {top}</option>
            {subs.map((s) => (
              <option key={s} value={s}>
                {s.split('/').slice(1).join('/') || s}
              </option>
            ))}
          </select>
        )}
        <input type="search" placeholder="Search" aria-label="Search assets" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="dim">{shown.length} assets</span>
      </div>
      <div className="asset-grid">
        {shown.slice(0, limit).map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`asset-cell${entry.id === selected ? ' selected' : ''}`}
            title={`${entry.id}\n${entry.pack}`}
            onClick={() => onPick(entry)}
          >
            <AssetThumb entry={entry} size={64} />
            <span className="asset-label">{entry.label}</span>
          </button>
        ))}
      </div>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </div>
  );
}

interface FieldProps {
  value?: string;
  /** Which part of the library to open on, from the field's name. */
  category: string;
  onChange: (id: string | undefined) => void;
  allowClear: boolean;
}

/** An asset id field: preview, the id, and a picker. */
export function AssetField({ value, category, onChange, allowClear }: FieldProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="asset-field">
      {value && category === 'animations' ? (
        <AnimationPreview id={value} size={56} />
      ) : (
        <AssetImage id={value} size={56} fallback="–" alt={value} />
      )}
      <code className="asset-id">{value ?? 'none'}</code>
      <button type="button" onClick={() => setOpen(true)}>
        Choose
      </button>
      {allowClear && value && (
        <button type="button" onClick={() => onChange(undefined)}>
          Clear
        </button>
      )}
      {open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Choose an asset" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row modal-head">
              <h2>Choose an asset</h2>
              <button type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <AssetBrowser
              initialCategory={value?.split('/')[0] ?? category}
              selected={value}
              onPick={(entry) => {
                onChange(entry.id);
                setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
