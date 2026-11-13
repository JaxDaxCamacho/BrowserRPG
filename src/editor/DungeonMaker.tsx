import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { z } from 'zod';
import {
  ADVENTURES,
  adventureFile,
  checkDungeonEdit,
  CONTENT,
  dungeonFile,
  dungeonSchema,
  MONSTERS,
  type AdventureDefinition,
} from '../content';
import { TILE_CHARS, type DungeonDefinition, type FeatureDefinition, type Pos, type TileChar } from '../engine';
import { useGameStore } from '../state/store';
import { writeContentFiles } from './contentFiles';
import {
  addRoom,
  createBlankDungeon,
  featureAtPos,
  makeFirst,
  moveFeature,
  paintRect,
  paintTile,
  placeFeature,
  removeFeature,
  removeRoom,
  resizeDungeon,
  roomAtPos,
  setAssignment,
  slugify,
  uniqueId,
  type FeatureType,
} from './dungeonEdit';
import type { JsonObject, JsonSchema } from './jsonSchema';
import { drawMap, tileColour, type Selection } from './mapCanvas';
import { SchemaForm, type RefOption } from './SchemaForm';

type Tool = 'select' | 'paint' | 'rect' | 'room' | 'start' | FeatureType;

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  { tool: 'select', label: 'Select', hint: 'Click a marker or room to edit it; drag a marker to move it.' },
  { tool: 'paint', label: 'Paint', hint: 'Click or drag to paint tiles.' },
  { tool: 'rect', label: 'Rectangle', hint: 'Drag to fill a rectangle with the chosen tile.' },
  { tool: 'room', label: 'Room', hint: 'Drag out a room: it is revealed whole on entry and sets the rows of fights in it.' },
  { tool: 'start', label: 'Start', hint: 'Click where the party enters.' },
  { tool: 'goal', label: 'Goal', hint: 'Click where the objective is. There is only one.' },
  { tool: 'trap', label: 'Trap', hint: 'Click to place a trap, then pick its dialogue.' },
  { tool: 'encounter', label: 'Enemies', hint: 'Click to place an enemy group, then pick its monsters.' },
  { tool: 'event', label: 'Event', hint: 'Click to place a chest, prisoner or anything that opens a dialogue.' },
];

const TILE_NAMES: Record<TileChar, string> = {
  '#': 'Wall',
  '.': 'Corridor',
  ',': 'Room floor',
  _: 'Hall floor',
  '+': 'Door',
  L: 'Locked door',
  '>': 'Stairs',
};

const SESSION_KEY = 'allerya.maker';

interface Remembered {
  open: string | null;
  flash?: string;
}

function remember(state: Remembered) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // Only restores the open map after the page reloads on save.
  }
}

function recall(): Remembered {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') ?? { open: null };
  } catch {
    return { open: null };
  }
}

/** Each adventure's dungeon list, as currently saved. */
function savedAssignments(): Record<string, string[]> {
  return Object.fromEntries(ADVENTURES.map((a) => [a.id, a.dungeons]));
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const featureSchema: JsonSchema = (() => {
  const root = z.toJSONSchema(dungeonSchema, { unrepresentable: 'any', io: 'input' }) as JsonSchema;
  return { ...(root.properties!.features!.items as JsonSchema), $defs: root.$defs };
})();

const roomSchema: JsonSchema = (() => {
  const root = z.toJSONSchema(dungeonSchema, { unrepresentable: 'any', io: 'input' }) as JsonSchema;
  return { ...(root.properties!.rooms!.items as JsonSchema), $defs: root.$defs };
})();

// ---------- the list of dungeons ----------

function DungeonList({ onOpen }: { onOpen: (d: DungeonDefinition, isNew: boolean) => void }) {
  const openTool = useGameStore((s) => s.openTool);
  const [name, setName] = useState('');
  // Show a message left by the last save or delete once, then forget it.
  const [flash] = useState(() => recall().flash);
  useEffect(() => {
    if (flash) remember({ open: null });
  }, [flash]);
  const usedIn = (id: string) => ADVENTURES.filter((a) => a.dungeons.includes(id)).map((a) => a.title);

  const create = (template?: DungeonDefinition) => {
    const taken = CONTENT.dungeons.map((d) => d.id);
    if (template) {
      const id = uniqueId(`${template.id}-copy`, taken);
      onOpen({ ...structuredClone(template), id, name: `${template.name} (copy)` }, true);
      return;
    }
    const title = name.trim() || 'New dungeon';
    onOpen(createBlankDungeon(uniqueId(slugify(title), taken), title), true);
  };

  return (
    <main className="screen wide maker-list">
      <header className="editor-header">
        <h1>Dungeon Maker</h1>
        <span className="dim">Maps are saved to src/content/dungeons.</span>
        <button type="button" onClick={() => openTool(null)}>
          Back to the game
        </button>
      </header>
      {flash && <p className="editor-status ok">{flash}</p>}
      <section className="panel">
        <h2>New dungeon</h2>
        <div className="row">
          <input type="text" placeholder="Name, e.g. Smugglers' Caves" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="primary" onClick={() => create()}>
            Create
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Dungeons</h2>
        <ul className="maker-dungeons">
          {CONTENT.dungeons.map((d) => (
            <li key={d.id} className="row">
              <span className="entry-text">
                <strong>{d.name}</strong>
                <span className="dim">
                  {d.id} · {d.width}×{d.height} ·{' '}
                  {usedIn(d.id).length > 0 ? `used in ${usedIn(d.id).join(', ')}` : 'not assigned to an adventure'}
                </span>
              </span>
              <button type="button" onClick={() => onOpen(structuredClone(d), false)}>
                Open
              </button>
              <button type="button" onClick={() => create(d)}>
                Duplicate
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

// ---------- editing one dungeon ----------

interface EditorProps {
  initial: DungeonDefinition;
  isNew: boolean;
  onClose: () => void;
}

function DungeonEditor({ initial, isNew: startsNew, onClose }: EditorProps) {
  const startTestPlay = useGameStore((s) => s.startTestPlay);
  const [dungeon, setDungeon] = useState(initial);
  const [assignments, setAssignments] = useState(savedAssignments);
  const [isNew, setIsNew] = useState(startsNew);
  const [dirty, setDirty] = useState(startsNew);
  const [undo, setUndo] = useState<DungeonDefinition[]>([]);
  const [tool, setTool] = useState<Tool>('paint');
  const [tile, setTile] = useState<TileChar>(',');
  const [selection, setSelection] = useState<Selection>(null);
  const [size, setSize] = useState(24);
  const [hover, setHover] = useState<Pos | null>(null);
  const [preview, setPreview] = useState<{ a: Pos; b: Pos } | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; lines: string[] } | null>(null);
  const [resize, setResize] = useState({ width: initial.width, height: initial.height });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: 'paint' | 'rect' | 'room' | 'move'; start: Pos; featureId?: string } | null>(null);

  // ---------- changes, with undo ----------

  // Refs hold the latest values so rapid changes (painting while dragging) never work on a stale map.
  const dungeonRef = useRef(dungeon);
  const undoRef = useRef<DungeonDefinition[]>([]);

  const change = useCallback((next: DungeonDefinition | ((d: DungeonDefinition) => DungeonDefinition)) => {
    const current = dungeonRef.current;
    const updated = typeof next === 'function' ? next(current) : next;
    if (updated === current) return;
    undoRef.current = [...undoRef.current.slice(-49), current];
    dungeonRef.current = updated;
    setUndo(undoRef.current);
    setDungeon(updated);
    setDirty(true);
  }, []);

  const undoLast = useCallback(() => {
    const previous = undoRef.current.at(-1);
    if (!previous) return;
    undoRef.current = undoRef.current.slice(0, -1);
    dungeonRef.current = previous;
    setUndo(undoRef.current);
    setDungeon(previous);
    setDirty(true);
  }, []);

  // ---------- what this dungeon is used by ----------

  const usedBy = ADVENTURES.filter((a) => assignments[a.id]?.includes(dungeon.id));
  const draftAdventures: AdventureDefinition[] = ADVENTURES.map((a) => ({ ...a, dungeons: assignments[a.id] ?? [] }));
  const dialogueSources = usedBy.length > 0 ? usedBy : ADVENTURES;
  const dialogues = dialogueSources.flatMap((a) => a.dialogues.map((d) => ({ adventure: a, dialogue: d })));
  const problems = useMemo(
    () => checkDungeonEdit(dungeon, draftAdventures, CONTENT),
    // draftAdventures is rebuilt from assignments each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dungeon, assignments],
  );

  const defaults = () => {
    const first = dialogues.find((x) => x.dialogue.id !== x.adventure.debrief) ?? dialogues[0];
    return {
      dialogueId: first?.dialogue.id ?? '',
      nodes: first?.dialogue.nodes.map((n) => n.id) ?? [],
      monsterId: MONSTERS[0]?.id ?? '',
    };
  };

  // ---------- drawing ----------

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = dungeon.width * size * ratio;
    canvas.height = dungeon.height * size * ratio;
    canvas.style.width = `${dungeon.width * size}px`;
    canvas.style.height = `${dungeon.height * size}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const colour = tool === 'room' ? tileColour(tile === '_' ? '_' : ',') : tileColour(tile);
    drawMap(ctx, dungeon, size, { selection, hover, ...(preview ? { preview: { ...preview, colour } } : {}) });
  }, [dungeon, size, selection, hover, preview, tool, tile]);

  // ---------- pointer input ----------

  const tileFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>): Pos => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.floor((e.clientX - rect.left) / size), y: Math.floor((e.clientY - rect.top) / size) };
  };

  const inBounds = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < dungeon.width && p.y < dungeon.height;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = tileFromEvent(e);
    if (!inBounds(p)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    switch (tool) {
      case 'paint':
        drag.current = { mode: 'paint', start: p };
        change((d) => paintTile(d, p, tile));
        break;
      case 'rect':
      case 'room':
        drag.current = { mode: tool, start: p };
        setPreview({ a: p, b: p });
        break;
      case 'start':
        change((d) => ({ ...d, start: p }));
        break;
      case 'select': {
        const f = featureAtPos(dungeon, p);
        if (f) {
          setSelection({ kind: 'feature', id: f.id });
          drag.current = { mode: 'move', start: p, featureId: f.id };
          break;
        }
        const room = roomAtPos(dungeon, p);
        setSelection(room ? { kind: 'room', id: room.id } : null);
        break;
      }
      default: {
        const placed = placeFeature(dungeon, tool, p, defaults());
        change(placed.dungeon);
        setSelection({ kind: 'feature', id: placed.id });
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = tileFromEvent(e);
    setHover(inBounds(p) ? p : null);
    const d = drag.current;
    if (!d || !inBounds(p)) return;
    if (d.mode === 'paint') change((m) => paintTile(m, p, tile));
    if (d.mode === 'rect' || d.mode === 'room') setPreview({ a: d.start, b: p });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    setPreview(null);
    if (!d) return;
    const raw = tileFromEvent(e);
    const p = { x: Math.max(0, Math.min(dungeon.width - 1, raw.x)), y: Math.max(0, Math.min(dungeon.height - 1, raw.y)) };
    if (d.mode === 'rect') change((m) => paintRect(m, d.start, p, tile));
    if (d.mode === 'room') {
      const floor: TileChar = tile === '_' ? '_' : ',';
      const added = addRoom(dungeon, d.start, p, floor);
      change(added.dungeon);
      setSelection({ kind: 'room', id: added.id });
    }
    if (d.mode === 'move' && d.featureId && (p.x !== d.start.x || p.y !== d.start.y)) {
      change((m) => moveFeature(m, d.featureId!, p));
    }
  };

  // ---------- keyboard ----------

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    change((d) => (selection.kind === 'feature' ? removeFeature(d, selection.id) : removeRoom(d, selection.id)));
    setSelection(null);
  }, [selection, change]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undoLast();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoLast, deleteSelection]);

  // ---------- saving ----------

  const save = async () => {
    if (problems.length > 0) {
      setStatus({ kind: 'error', lines: ['Fix these before saving:', ...problems] });
      return;
    }
    try {
      const saved = savedAssignments();
      const writes: { file: string; data: unknown }[] = [{ file: dungeonFile(dungeon.id), data: dungeon }];
      for (const a of ADVENTURES) {
        const next = assignments[a.id] ?? [];
        if (JSON.stringify(next) !== JSON.stringify(saved[a.id])) {
          writes.push({ file: adventureFile(a.id), data: { ...a, dungeons: next } });
        }
      }
      // One request for every file, so a page reload after the first write cannot drop the rest.
      await writeContentFiles(writes);
      setDirty(false);
      setIsNew(false);
      const message = `Saved ${dungeon.name}.`;
      remember({ open: dungeon.id, flash: message });
      setStatus({ kind: 'ok', lines: [message] });
    } catch (error) {
      setStatus({ kind: 'error', lines: [`Could not save: ${String(error)}`] });
    }
  };

  const deleteDungeon = async () => {
    try {
      const writes = ADVENTURES.filter((a) => a.dungeons.includes(dungeon.id)).map((a) => ({
        file: adventureFile(a.id),
        data: { ...a, dungeons: a.dungeons.filter((id) => id !== dungeon.id) },
      }));
      remember({ open: null, flash: `Deleted ${dungeon.name}.` });
      await writeContentFiles(writes, isNew ? [] : [dungeonFile(dungeon.id)]);
      onClose();
    } catch (error) {
      setStatus({ kind: 'error', lines: [`Could not delete: ${String(error)}`] });
    }
  };

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as DungeonDefinition;
      if (!Array.isArray(data.tiles) || typeof data.width !== 'number' || typeof data.height !== 'number') {
        throw new Error('That file is not a dungeon.');
      }
      change({ ...data, id: dungeon.id });
      setResize({ width: data.width, height: data.height });
      setStatus({ kind: 'ok', lines: [`Imported ${file.name}. Save to keep it.`] });
    } catch (error) {
      setStatus({ kind: 'error', lines: [String(error)] });
    }
  };

  // ---------- the selected thing ----------

  const selectedFeature = selection?.kind === 'feature' ? dungeon.features.find((f) => f.id === selection.id) : undefined;
  const selectedRoom = selection?.kind === 'room' ? dungeon.rooms.find((r) => r.id === selection.id) : undefined;

  const refsFor = (field: string): RefOption[] | null => {
    if (field === 'monsterId') return MONSTERS.map((m) => ({ value: m.id, label: `${m.name} (${m.archetype})` }));
    if (field === 'dialogueId') {
      return dialogues.map(({ adventure, dialogue }) => ({
        value: dialogue.id,
        label: usedBy.length === 1 ? dialogue.id : `${dialogue.id} (${adventure.title})`,
      }));
    }
    if (field === 'triggerNode' || field === 'disarmNode' || field === 'node') {
      const id = selectedFeature && 'dialogueId' in selectedFeature ? selectedFeature.dialogueId : '';
      const dialogue = dialogues.find((x) => x.dialogue.id === id)?.dialogue;
      return dialogue ? dialogue.nodes.map((n) => ({ value: n.id, label: n.id })) : [];
    }
    return null;
  };

  const updateSelected = (next: JsonObject) => {
    if (!selectedFeature) return;
    const updated = next as unknown as FeatureDefinition;
    change((d) => ({ ...d, features: d.features.map((f) => (f.id === selectedFeature.id ? updated : f)) }));
    if (updated.id !== selectedFeature.id) setSelection({ kind: 'feature', id: updated.id });
  };

  const updateRoom = (next: JsonObject) => {
    if (!selectedRoom) return;
    const updated = next as unknown as DungeonDefinition['rooms'][number];
    change((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === selectedRoom.id ? updated : r)) }));
    if (updated.id !== selectedRoom.id) setSelection({ kind: 'room', id: updated.id });
  };

  const firstAdventure = usedBy[0];
  const canTest = !dirty && !isNew && !!firstAdventure && problems.length === 0;
  const hint = TOOLS.find((t) => t.tool === tool)?.hint;

  return (
    <main className="maker">
      <header className="editor-header">
        <h1>{dungeon.name}</h1>
        <span className="dim">
          {dungeon.id} · {dirty ? 'unsaved changes' : 'saved'}
        </span>
        <span className="row maker-header-actions">
          <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>
            Save
          </button>
          <button
            type="button"
            disabled={!canTest}
            title={canTest ? undefined : 'Save the map and assign it to an adventure first.'}
            onClick={() => firstAdventure && startTestPlay(dungeon.id, firstAdventure.id)}
          >
            Test play
          </button>
          <button
            type="button"
            onClick={() => {
              if (!dirty || window.confirm('Leave without saving your changes?')) {
                remember({ open: null });
                onClose();
              }
            }}
          >
            All dungeons
          </button>
        </span>
      </header>

      <aside className="maker-tools" aria-label="Tools">
        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button key={t.tool} type="button" className={tool === t.tool ? 'active' : ''} aria-pressed={tool === t.tool} onClick={() => setTool(t.tool)}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="dim note">{hint}</p>
        <h3>Tile</h3>
        <div className="tile-palette">
          {(Object.keys(TILE_CHARS) as TileChar[]).map((ch) => (
            <button
              key={ch}
              type="button"
              className={tile === ch ? 'active' : ''}
              aria-pressed={tile === ch}
              onClick={() => {
                setTile(ch);
                if (tool !== 'paint' && tool !== 'rect' && tool !== 'room') setTool('paint');
              }}
            >
              <span className="swatch" style={{ background: tileColour(ch) }} />
              {TILE_NAMES[ch]}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Zoom</span>
          <input type="range" min={10} max={40} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <div className="row">
          <button type="button" disabled={undo.length === 0} onClick={undoLast}>
            Undo
          </button>
          <button type="button" disabled={!selection} onClick={deleteSelection}>
            Delete selected
          </button>
        </div>
        <p className="dim note">Ctrl+Z undoes; Delete removes the selected marker or room.</p>
      </aside>

      <section className="maker-canvas-wrap" aria-label="Map">
        <canvas
          ref={canvasRef}
          className={`maker-canvas tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
        />
      </section>

      <aside className="maker-side" aria-label="Details">
        {status && (
          <div className={`editor-status ${status.kind}`} role="status">
            {status.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}

        {selectedFeature && (
          <section className="panel">
            <h2>Selected: {selectedFeature.type}</h2>
            <SchemaForm
              key={`${selectedFeature.type}:${dungeon.features.indexOf(selectedFeature)}`}
              root={featureSchema}
              refsFor={refsFor}
              assetCategoryFor={(f) => (f === 'icon' ? 'loot' : null)}
              value={selectedFeature as unknown as JsonObject}
              onChange={updateSelected}
            />
          </section>
        )}
        {selectedRoom && (
          <section className="panel">
            <h2>Selected room</h2>
            <SchemaForm
              key={`room:${dungeon.rooms.indexOf(selectedRoom)}`}
              root={roomSchema}
              refsFor={() => null}
              assetCategoryFor={() => null}
              value={selectedRoom as unknown as JsonObject}
              onChange={updateRoom}
            />
          </section>
        )}

        <section className="panel">
          <h2>Problems</h2>
          {problems.length === 0 ? (
            <p className="dim">None. This map is ready to save.</p>
          ) : (
            <ul className="editor-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {usedBy.length === 0 && <p className="dim note">Assign the map to an adventure so its dialogues are checked and it can be played.</p>}
        </section>

        <section className="panel">
          <h2>Adventures</h2>
          {ADVENTURES.map((a) => {
            const list = assignments[a.id] ?? [];
            const included = list.includes(dungeon.id);
            return (
              <div key={a.id} className="maker-adventure">
                <label className="form-check">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={(e) => {
                      setAssignments((s) => ({ ...s, [a.id]: setAssignment(list, dungeon.id, e.target.checked) }));
                      setDirty(true);
                    }}
                  />
                  <span>{a.title}</span>
                </label>
                {included && (
                  <span className="row">
                    <span className="dim">{list[0] === dungeon.id ? 'First dungeon: the debrief leads here.' : `Dungeon ${list.indexOf(dungeon.id) + 1} of ${list.length}.`}</span>
                    {list[0] !== dungeon.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setAssignments((s) => ({ ...s, [a.id]: makeFirst(list, dungeon.id) }));
                          setDirty(true);
                        }}
                      >
                        Make first
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </section>

        <section className="panel">
          <h2>Map</h2>
          <label className="field">
            <span>Name</span>
            <input type="text" value={dungeon.name} onChange={(e) => change((d) => ({ ...d, name: e.target.value }))} />
          </label>
          {isNew && (
            <label className="field">
              <span>Id (file name; fixed once saved)</span>
              <input type="text" value={dungeon.id} onChange={(e) => change((d) => ({ ...d, id: slugify(e.target.value) }))} />
            </label>
          )}
          <div className="row">
            <label className="field">
              <span>Width</span>
              <input type="number" min={5} max={80} value={resize.width} onChange={(e) => setResize((r) => ({ ...r, width: Number(e.target.value) }))} />
            </label>
            <label className="field">
              <span>Height</span>
              <input type="number" min={5} max={80} value={resize.height} onChange={(e) => setResize((r) => ({ ...r, height: Number(e.target.value) }))} />
            </label>
          </div>
          <button
            type="button"
            disabled={resize.width === dungeon.width && resize.height === dungeon.height}
            onClick={() => change((d) => resizeDungeon(d, Math.max(5, Math.min(80, resize.width)), Math.max(5, Math.min(80, resize.height))))}
          >
            Resize map
          </button>
          <div className="row">
            <button type="button" onClick={() => download(`${dungeon.id}.json`, dungeon)}>
              Export JSON
            </button>
            <label className="button-like">
              Import JSON
              <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            </label>
          </div>
          {confirmDelete ? (
            <div className="row">
              <span>Delete {dungeon.name} for good?</span>
              <button type="button" className="danger" onClick={() => void deleteDungeon()}>
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>
              Delete this dungeon
            </button>
          )}
        </section>
      </aside>
    </main>
  );
}

export default function DungeonMaker() {
  const [open, setOpen] = useState<{ dungeon: DungeonDefinition; isNew: boolean } | null>(() => {
    const id = recall().open;
    const saved = id ? CONTENT.dungeons.find((d) => d.id === id) : undefined;
    return saved ? { dungeon: structuredClone(saved), isNew: false } : null;
  });

  if (!open) {
    return (
      <DungeonList
        onOpen={(dungeon, isNew) => {
          remember({ open: isNew ? null : dungeon.id });
          setOpen({ dungeon, isNew });
        }}
      />
    );
  }
  return <DungeonEditor key={open.dungeon.id} initial={open.dungeon} isNew={open.isNew} onClose={() => setOpen(null)} />;
}
