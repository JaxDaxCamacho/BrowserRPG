import type { DungeonDefinition, FeatureDefinition, Pos, RoomDefinition, TileChar } from '../engine';

/**
 * Pure helpers behind the dungeon maker. Every function returns a new map and
 * leaves the old one untouched, so undo is just keeping the previous value.
 */

export type FeatureType = FeatureDefinition['type'];

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return /^[a-z]/.test(s) ? s : `d-${s || 'dungeon'}`;
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** A walled map with one small room in the middle and the start in it. No goal yet. */
export function createBlankDungeon(id: string, name: string, width = 30, height = 24): DungeonDefinition {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const room: RoomDefinition = { id: 'entrance', name: 'Entrance', x: cx - 2, y: cy - 2, width: 5, height: 5, rows: 3 };
  const base: DungeonDefinition = {
    id,
    name,
    width,
    height,
    tiles: Array.from({ length: height }, () => '#'.repeat(width)),
    start: { x: cx, y: cy },
    rooms: [room],
    features: [],
  };
  return paintRect(base, { x: room.x, y: room.y }, { x: room.x + room.width - 1, y: room.y + room.height - 1 }, ',');
}

const inside = (d: DungeonDefinition, p: Pos) => p.x >= 0 && p.y >= 0 && p.x < d.width && p.y < d.height;

export function paintTile(d: DungeonDefinition, p: Pos, ch: TileChar): DungeonDefinition {
  if (!inside(d, p) || d.tiles[p.y]![p.x] === ch) return d;
  const tiles = d.tiles.slice();
  const row = tiles[p.y]!;
  tiles[p.y] = row.slice(0, p.x) + ch + row.slice(p.x + 1);
  return { ...d, tiles };
}

/** Fills the rectangle between two corners, in any order. */
export function paintRect(d: DungeonDefinition, a: Pos, b: Pos, ch: TileChar): DungeonDefinition {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const x1 = Math.min(d.width - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const y1 = Math.min(d.height - 1, Math.max(a.y, b.y));
  const tiles = d.tiles.map((row, y) => (y < y0 || y > y1 ? row : row.slice(0, x0) + ch.repeat(x1 - x0 + 1) + row.slice(x1 + 1)));
  return { ...d, tiles };
}

/** Changes the map size, keeping what fits and walling in anything new. Features and rooms outside are dropped. */
export function resizeDungeon(d: DungeonDefinition, width: number, height: number): DungeonDefinition {
  const tiles = Array.from({ length: height }, (_, y) => {
    const row = d.tiles[y] ?? '';
    return (row.slice(0, width) + '#'.repeat(Math.max(0, width - row.length))).slice(0, width);
  });
  const fits = (p: Pos) => p.x < width && p.y < height;
  return {
    ...d,
    width,
    height,
    tiles,
    start: fits(d.start) ? d.start : { x: Math.min(d.start.x, width - 1), y: Math.min(d.start.y, height - 1) },
    rooms: d.rooms.filter((r) => r.x + r.width <= width && r.y + r.height <= height),
    features: d.features.filter(fits),
  };
}

export function featureAtPos(d: DungeonDefinition, p: Pos): FeatureDefinition | null {
  return d.features.find((f) => f.x === p.x && f.y === p.y) ?? null;
}

export function roomAtPos(d: DungeonDefinition, p: Pos): RoomDefinition | null {
  return d.rooms.find((r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height) ?? null;
}

export interface FeatureDefaults {
  dialogueId: string;
  /** Nodes of that dialogue, first one used as the start. */
  nodes: string[];
  monsterId: string;
}

/** A new feature with sensible starting values. The goal is moved rather than duplicated. */
export function placeFeature(d: DungeonDefinition, type: FeatureType, p: Pos, defaults: FeatureDefaults): { dungeon: DungeonDefinition; id: string } {
  const taken = d.features.map((f) => f.id);
  const firstNode = defaults.nodes[0] ?? 'start';
  const occupant = featureAtPos(d, p);
  const without = occupant ? d.features.filter((f) => f !== occupant) : d.features;

  if (type === 'goal') {
    const goal = d.features.find((f) => f.type === 'goal');
    if (goal) {
      const moved = { ...goal, x: p.x, y: p.y };
      return {
        dungeon: { ...d, features: without.filter((f) => f !== goal).concat(moved) },
        id: goal.id,
      };
    }
  }

  const id = uniqueId(type, taken);
  let feature: FeatureDefinition;
  switch (type) {
    case 'trap':
      feature = { type, id, name: 'trap', x: p.x, y: p.y, detectDifficulty: 12, dialogueId: defaults.dialogueId, triggerNode: firstNode };
      break;
    case 'encounter':
      feature = { type, id, name: 'Enemy group', x: p.x, y: p.y, monsters: [{ monsterId: defaults.monsterId, count: 1 }] };
      break;
    case 'event':
      feature = { type, id, name: 'Event', x: p.x, y: p.y, dialogueId: defaults.dialogueId };
      break;
    case 'goal':
      feature = { type, id: 'goal', name: 'Goal', x: p.x, y: p.y, dialogueId: defaults.dialogueId };
      break;
  }
  return { dungeon: { ...d, features: [...without, feature] }, id };
}

export function moveFeature(d: DungeonDefinition, id: string, p: Pos): DungeonDefinition {
  if (!inside(d, p)) return d;
  const occupant = featureAtPos(d, p);
  if (occupant && occupant.id !== id) return d;
  return { ...d, features: d.features.map((f) => (f.id === id ? { ...f, x: p.x, y: p.y } : f)) };
}

export function removeFeature(d: DungeonDefinition, id: string): DungeonDefinition {
  return { ...d, features: d.features.filter((f) => f.id !== id) };
}

/** Adds a room over a rectangle and paints its floor. */
export function addRoom(d: DungeonDefinition, a: Pos, b: Pos, floor: TileChar): { dungeon: DungeonDefinition; id: string } {
  const x = Math.max(0, Math.min(a.x, b.x));
  const y = Math.max(0, Math.min(a.y, b.y));
  const width = Math.min(d.width - x, Math.abs(a.x - b.x) + 1);
  const height = Math.min(d.height - y, Math.abs(a.y - b.y) + 1);
  const id = uniqueId('room', d.rooms.map((r) => r.id));
  const rows = floor === '_' ? 5 : 3;
  const painted = paintRect(d, { x, y }, { x: x + width - 1, y: y + height - 1 }, floor);
  return { dungeon: { ...painted, rooms: [...painted.rooms, { id, name: 'Room', x, y, width, height, rows }] }, id };
}

export function removeRoom(d: DungeonDefinition, id: string): DungeonDefinition {
  return { ...d, rooms: d.rooms.filter((r) => r.id !== id) };
}

/** Puts a dungeon into an adventure's list, or takes it out. */
export function setAssignment(dungeons: string[], dungeonId: string, assigned: boolean): string[] {
  const without = dungeons.filter((id) => id !== dungeonId);
  return assigned ? [...without, dungeonId] : without;
}

/** Moves a dungeon to the front of an adventure's list: the debrief leads into the first one. */
export function makeFirst(dungeons: string[], dungeonId: string): string[] {
  return dungeons.includes(dungeonId) ? [dungeonId, ...dungeons.filter((id) => id !== dungeonId)] : dungeons;
}
