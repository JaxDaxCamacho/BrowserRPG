import { useMemo, useState } from 'react';
import { z } from 'zod';
import { checkCollection, COLLECTIONS, CONTENT, type CollectionKey } from '../content';
import { AssetImage } from '../screens/assets';
import { useGameStore } from '../state/store';
import { AssetBrowser } from './AssetPicker';
import { defaultFor, type JsonObject, type JsonSchema } from './jsonSchema';
import { SchemaForm, type RefOption } from './SchemaForm';

type Entry = JsonObject & { id: string };
type View = CollectionKey | 'assets';

const SESSION_KEY = 'allerya.editor';

interface Remembered {
  view: View;
  selected: string | null;
}

function remember(state: Remembered) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // Not essential: only restores the open entry after a reload.
  }
}

function recall(): Remembered {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as Remembered;
  } catch {
    // Fall through to the default.
  }
  return { view: 'items', selected: null };
}

function cloneContent(): Record<CollectionKey, Entry[]> {
  const out = {} as Record<CollectionKey, Entry[]>;
  for (const c of COLLECTIONS) out[c.key] = structuredClone(CONTENT[c.key]) as unknown as Entry[];
  return out;
}

/** Where an entry's picture usually comes from, by collection. */
const ASSET_HOME: Record<CollectionKey, string> = {
  items: 'weapons',
  abilities: 'skills',
  monsters: 'monsters',
  classes: 'badges',
  races: 'badges',
  premades: 'portraits',
  portraits: 'portraits',
};

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

function entryProblems(schema: z.ZodType, entry: Entry): string[] {
  const result = schema.safeParse(entry);
  if (result.success) return [];
  return result.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
}

export default function ContentEditor() {
  const openTool = useGameStore((s) => s.openTool);
  const initial = useMemo(recall, []);
  const [view, setView] = useState<View>(initial.view);
  const [data, setData] = useState(cloneContent);
  const [dirty, setDirty] = useState<Set<CollectionKey>>(new Set());
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; lines: string[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const info = view === 'assets' ? null : COLLECTIONS.find((c) => c.key === view)!;
  const entries = info ? data[info.key] : [];
  const entry = entries.find((e) => e.id === selected) ?? null;

  const jsonSchema = useMemo(
    () => (info ? (z.toJSONSchema(info.schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema) : null),
    [info],
  );

  const select = (nextView: View, id: string | null) => {
    setView(nextView);
    setSelected(id);
    setConfirmDelete(false);
    setJsonMode(false);
    setStatus(null);
    remember({ view: nextView, selected: id });
  };

  const updateEntries = (key: CollectionKey, next: Entry[]) => {
    setData((d) => ({ ...d, [key]: next }));
    setDirty((d) => new Set(d).add(key));
  };

  const updateEntry = (next: JsonObject) => {
    if (!info || !entry) return;
    const updated = next as Entry;
    updateEntries(info.key, entries.map((e) => (e === entry ? updated : e)));
    if (updated.id !== entry.id) {
      setSelected(updated.id);
      remember({ view: info.key, selected: updated.id });
    }
  };

  const addEntry = (template?: Entry) => {
    if (!info || !jsonSchema) return;
    const taken = new Set(entries.map((e) => e.id));
    const base = template ? structuredClone(template) : (defaultFor(jsonSchema, jsonSchema) as Entry);
    const id = uniqueId(template ? `${template.id}-copy` : `new-${info.key.replace(/s$/, '')}`, taken);
    const created: Entry = { ...base, id, ...(template ? { name: `${String(template.name ?? id)} (copy)` } : { name: 'New entry' }) };
    updateEntries(info.key, [...entries, created]);
    select(info.key, id);
  };

  const deleteEntry = () => {
    if (!info || !entry) return;
    updateEntries(info.key, entries.filter((e) => e !== entry));
    select(info.key, null);
  };

  const save = async (key: CollectionKey) => {
    const target = COLLECTIONS.find((c) => c.key === key)!;
    const others = { ...CONTENT };
    for (const c of COLLECTIONS) if (c.key !== key) (others as Record<string, unknown>)[c.key] = data[c.key];
    const problems = checkCollection(key, data[key], others);
    if (problems.length > 0) {
      setStatus({ kind: 'error', lines: [`${target.label} not saved:`, ...problems] });
      return;
    }
    try {
      const response = await fetch(`/__content/${target.file}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-allerya-editor': '1' },
        body: JSON.stringify(data[key]),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? response.statusText);
      setDirty((d) => {
        const next = new Set(d);
        next.delete(key);
        return next;
      });
      setStatus({ kind: 'ok', lines: [`Saved ${target.file}. The game reloads with the new content.`] });
    } catch (error) {
      setStatus({ kind: 'error', lines: [`Could not save ${target.file}: ${String(error)}`] });
    }
  };

  const refsFor = (field: string): RefOption[] | null => {
    const list = (items: { id: string; name?: unknown }[]) =>
      items.map((i) => ({ value: i.id, label: `${String(i.name ?? i.id)} (${i.id})` }));
    const itemsOfKind = (...kinds: string[]) => list(data.items.filter((i) => kinds.includes(String(i.kind))));
    switch (field) {
      case 'classId':
        return list(data.classes);
      case 'raceId':
      case 'race':
        return list(data.races);
      case 'abilityId':
        return list(data.abilities);
      case 'mainHand':
        return itemsOfKind('weapon');
      case 'offHand':
        return itemsOfKind('weapon', 'shield');
      case 'body':
        return itemsOfKind('armour');
      case 'ammo':
        return view === 'premades' ? itemsOfKind('ammo') : null;
      default:
        return null;
    }
  };

  const assetCategoryFor = (field: string): string | null => {
    if (field === 'animation') return 'animations';
    if (field === 'portrait') return view === 'monsters' ? 'monsters' : 'portraits';
    if (field === 'icon' || field === 'asset') return info ? ASSET_HOME[info.key] : 'weapons';
    return null;
  };

  const shown = entries.filter((e) => {
    const q = query.trim().toLowerCase();
    return !q || e.id.includes(q) || String(e.name ?? '').toLowerCase().includes(q) || String(e.kind ?? '').includes(q);
  });

  const problems = info && entry ? entryProblems(info.schema, entry) : [];

  return (
    <main className="editor">
      <header className="editor-header">
        <h1>Content Editor</h1>
        <span className="dim">Changes are written to src/content when you save.</span>
        <button
          type="button"
          onClick={() => {
            if (dirty.size === 0 || window.confirm('Leave without saving your changes?')) openTool(null);
          }}
        >
          Back to the game
        </button>
      </header>

      <nav className="editor-collections" aria-label="Collections">
        {COLLECTIONS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={view === c.key ? 'active' : ''}
            onClick={() => select(c.key, null)}
          >
            {c.label}
            {dirty.has(c.key) && <span className="dirty-dot" aria-label="unsaved changes"> ●</span>}
          </button>
        ))}
        <button type="button" className={view === 'assets' ? 'active' : ''} onClick={() => select('assets', null)}>
          Asset library
        </button>
      </nav>

      {view === 'assets' ? (
        <section className="editor-assets">
          <p className="dim">Click an asset to copy its id.{copied && ` Copied ${copied}.`}</p>
          <AssetBrowser
            onPick={(a) => {
              void navigator.clipboard?.writeText(a.id).catch(() => undefined);
              setCopied(a.id);
            }}
          />
        </section>
      ) : (
        info && (
          <>
            <section className="editor-list" aria-label={`${info.label} entries`}>
              <div className="row">
                <input type="search" placeholder="Search" aria-label="Search entries" value={query} onChange={(e) => setQuery(e.target.value)} />
                <button type="button" onClick={() => addEntry()}>
                  New
                </button>
              </div>
              <ul>
                {shown.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={`entry-button${e.id === selected ? ' active' : ''}`}
                      onClick={() => select(info.key, e.id)}
                    >
                      <AssetImage
                        id={typeof e[info.imageField] === 'string' ? (e[info.imageField] as string) : undefined}
                        fallback={String(e.name ?? e.id)[0] ?? '?'}
                        size={32}
                      />
                      <span className="entry-text">
                        <span>{String(e.name ?? e.id)}</span>
                        <span className="dim">{e.kind ? `${String(e.kind)} · ` : ''}{e.id}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="primary" disabled={!dirty.has(info.key)} onClick={() => void save(info.key)}>
                Save {info.label.toLowerCase()}
              </button>
              {status && (
                <div className={`editor-status ${status.kind}`} role="status">
                  {status.lines.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </div>
              )}
            </section>

            <section className="editor-form" aria-label="Entry">
              {!entry ? (
                <p className="dim">Pick an entry on the left, or press New.</p>
              ) : (
                <>
                  <div className="row editor-entry-actions">
                    <h2>{String(entry.name ?? entry.id)}</h2>
                    <button type="button" onClick={() => addEntry(entry)}>
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setJsonText(JSON.stringify(entry, null, 2));
                        setJsonMode((m) => !m);
                      }}
                    >
                      {jsonMode ? 'Back to form' : 'Edit as JSON'}
                    </button>
                    {confirmDelete ? (
                      <span className="row">
                        <span>Delete {entry.id}?</span>
                        <button type="button" className="danger" onClick={deleteEntry}>
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(false)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </button>
                    )}
                  </div>

                  {problems.length > 0 && (
                    <ul className="editor-problems">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}

                  {jsonMode ? (
                    <div className="json-editor">
                      <textarea rows={24} value={jsonText} onChange={(e) => setJsonText(e.target.value)} spellCheck={false} />
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            updateEntry(JSON.parse(jsonText) as JsonObject);
                            setJsonMode(false);
                          } catch {
                            setStatus({ kind: 'error', lines: ['That is not valid JSON.'] });
                          }
                        }}
                      >
                        Apply JSON
                      </button>
                    </div>
                  ) : (
                    jsonSchema && (
                      <SchemaForm
                        key={`${info.key}:${entries.indexOf(entry)}`}
                        root={jsonSchema}
                        refsFor={refsFor}
                        assetCategoryFor={assetCategoryFor}
                        value={entry}
                        onChange={updateEntry}
                      />
                    )
                  )}
                </>
              )}
            </section>
          </>
        )
      )}
    </main>
  );
}
