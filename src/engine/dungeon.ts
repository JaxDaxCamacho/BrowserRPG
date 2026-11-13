import { makeCheck } from './checks';
import { checkMaker, startDialogue, type DialogueContext, type DialogueDefinition } from './dialogue';
import type { GameState } from './gameState';

/**
 * Dungeons are square grids stored as rows of characters, so they stay easy to
 * read in JSON and easy for the dungeon maker to paint.
 */
export const TILE_CHARS = {
  '#': 'wall',
  '.': 'corridor',
  ',': 'room',
  _: 'hall',
  '+': 'door',
  L: 'lockedDoor',
  '>': 'stairs',
} as const;

export type TileChar = keyof typeof TILE_CHARS;
export type TileType = (typeof TILE_CHARS)[TileChar];

const WALKABLE: ReadonlySet<TileType> = new Set(['corridor', 'room', 'hall', 'door', 'stairs']);

export interface Pos {
  x: number;
  y: number;
}

/** A room or hall: entering it reveals all of it, and its size sets the rows of a fight there. */
export interface RoomDefinition {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Combat rows for fights in this room, 2 to 5. */
  rows: number;
}

interface FeatureBase {
  id: string;
  name: string;
  x: number;
  y: number;
  icon?: string;
}

export interface TrapFeature extends FeatureBase {
  type: 'trap';
  /** Intellect check to spot it when the party comes within one tile. */
  detectDifficulty: number;
  dialogueId: string;
  /** Node played when the party walks onto it unawares. */
  triggerNode: string;
  /** Node played when the party walks onto it after spotting it. */
  disarmNode?: string;
}

export interface EncounterFeature extends FeatureBase {
  type: 'encounter';
  monsters: { monsterId: string; count: number }[];
}

/** A chest, a prisoner, a sentry: anything that opens a dialogue when stepped on. */
export interface EventFeature extends FeatureBase {
  type: 'event';
  dialogueId: string;
  node?: string;
}

/** The adventure's objective in this dungeon. Shown on the map from the start. */
export interface GoalFeature extends FeatureBase {
  type: 'goal';
  dialogueId: string;
  node?: string;
}

export type FeatureDefinition = TrapFeature | EncounterFeature | EventFeature | GoalFeature;

export interface DungeonDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  /** One string per row, one character per tile (see TILE_CHARS). */
  tiles: string[];
  start: Pos;
  rooms: RoomDefinition[];
  features: FeatureDefinition[];
}

export interface DungeonState {
  dungeonId: string;
  pos: Pos;
  /** The tile the party came from, for retreating from a fight. */
  previous: Pos;
  /** Tiles still to walk, nearest first. */
  path: Pos[];
  /** Fog of war: one character per tile, "1" once seen. */
  seen: string;
  /** Hidden traps the party has already had a chance to spot. */
  checkedTraps: string[];
  spotted: string[];
  /** Traps sprung or disarmed, events finished, enemy groups defeated. */
  resolved: string[];
  /** Enemy groups the party has already seen, so seeing them again does not stop the walk. */
  noticed: string[];
  /** Recent messages, newest last. */
  log: string[];
}

export interface EncounterState {
  featureId: string;
  /** Where the party goes if it retreats. */
  returnTo: Pos;
}

const LOG_LIMIT = 30;
export const SIGHT_RADIUS = 2;

// ---------- reading the map ----------

export function tileAt(def: DungeonDefinition, x: number, y: number): TileType {
  if (x < 0 || y < 0 || x >= def.width || y >= def.height) return 'wall';
  return TILE_CHARS[(def.tiles[y]?.[x] ?? '#') as TileChar] ?? 'wall';
}

export function isWalkable(def: DungeonDefinition, x: number, y: number): boolean {
  return WALKABLE.has(tileAt(def, x, y));
}

export function indexOf(def: DungeonDefinition, p: Pos): number {
  return p.y * def.width + p.x;
}

export function roomAt(def: DungeonDefinition, p: Pos): RoomDefinition | null {
  return def.rooms.find((r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height) ?? null;
}

export function featureAt(def: DungeonDefinition, p: Pos): FeatureDefinition | null {
  return def.features.find((f) => f.x === p.x && f.y === p.y) ?? null;
}

export function featureById(def: DungeonDefinition, id: string): FeatureDefinition {
  const f = def.features.find((x) => x.id === id);
  if (!f) throw new Error(`Dungeon "${def.id}" has no feature "${id}".`);
  return f;
}

/** Combat rows for a fight at this spot: the room's size, or 2 in a corridor. */
export function combatRowsAt(def: DungeonDefinition, p: Pos): number {
  return roomAt(def, p)?.rows ?? 2;
}

const samePos = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y;
const chebyshev = (a: Pos, b: Pos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// ---------- fog of war ----------

/** True when nothing solid stands between two tiles (doors do not block sight). */
function lineOfSight(def: DungeonDefinition, from: Pos, to: Pos): boolean {
  let { x, y } = from;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let err = dx + dy;
  while (!(x === to.x && y === to.y)) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === to.x && y === to.y) return true;
    if (!isWalkable(def, x, y)) return false;
  }
  return true;
}

/** Tiles the party can see from here: two tiles around it in line of sight, plus all of any room it stands in. */
export function visibleFrom(def: DungeonDefinition, p: Pos): Set<number> {
  const seen = new Set<number>();
  for (let y = p.y - SIGHT_RADIUS; y <= p.y + SIGHT_RADIUS; y++) {
    for (let x = p.x - SIGHT_RADIUS; x <= p.x + SIGHT_RADIUS; x++) {
      if (x < 0 || y < 0 || x >= def.width || y >= def.height) continue;
      if (lineOfSight(def, p, { x, y })) seen.add(y * def.width + x);
    }
  }
  const room = roomAt(def, p);
  if (room) {
    // The walls around the room are revealed with it.
    for (let y = room.y - 1; y <= room.y + room.height; y++) {
      for (let x = room.x - 1; x <= room.x + room.width; x++) {
        if (x >= 0 && y >= 0 && x < def.width && y < def.height) seen.add(y * def.width + x);
      }
    }
  }
  return seen;
}

function reveal(def: DungeonDefinition, seen: string, p: Pos): string {
  const chars = seen.split('');
  for (const i of visibleFrom(def, p)) chars[i] = '1';
  return chars.join('');
}

export function isSeen(dungeon: DungeonState, def: DungeonDefinition, p: Pos): boolean {
  return dungeon.seen[indexOf(def, p)] === '1';
}

// ---------- entering and moving ----------

function withLog(dungeon: DungeonState, ...lines: string[]): DungeonState {
  return { ...dungeon, log: [...dungeon.log, ...lines].slice(-LOG_LIMIT) };
}

export function enterDungeon(state: GameState, def: DungeonDefinition): GameState {
  const blank = '0'.repeat(def.width * def.height);
  const dungeon: DungeonState = {
    dungeonId: def.id,
    pos: def.start,
    previous: def.start,
    path: [],
    seen: reveal(def, blank, def.start),
    checkedTraps: [],
    spotted: [],
    resolved: [],
    noticed: [],
    log: [`You enter ${def.name}.`],
  };
  return { ...state, screen: 'dungeon', dungeon, encounter: null };
}

function isBlockingFeature(dungeon: DungeonState, f: FeatureDefinition | null): boolean {
  if (!f || dungeon.resolved.includes(f.id)) return false;
  if (f.type === 'encounter') return true;
  return f.type === 'trap' && dungeon.spotted.includes(f.id);
}

/**
 * Shortest walk to a tile through ground the party has already seen.
 * Spotted traps and enemy groups are walked around unless they are the destination.
 * Returns the tiles to step on, excluding the current one, or null if there is no way.
 */
export function findPath(dungeon: DungeonState, def: DungeonDefinition, target: Pos): Pos[] | null {
  if (!isWalkable(def, target.x, target.y) || !isSeen(dungeon, def, target)) return null;
  if (samePos(dungeon.pos, target)) return [];
  const start = indexOf(def, dungeon.pos);
  const goal = indexOf(def, target);
  const cameFrom = new Map<number, number>([[start, -1]]);
  const queue = [start];
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === goal) break;
    const cx = current % def.width;
    const cy = Math.floor(current / def.width);
    for (const [dx, dy] of steps) {
      const next = { x: cx + dx, y: cy + dy };
      const ni = indexOf(def, next);
      if (cameFrom.has(ni) || !isWalkable(def, next.x, next.y) || dungeon.seen[ni] !== '1') continue;
      if (ni !== goal && isBlockingFeature(dungeon, featureAt(def, next))) continue;
      cameFrom.set(ni, current);
      queue.push(ni);
    }
  }
  if (!cameFrom.has(goal)) return null;
  const path: Pos[] = [];
  for (let i = goal; i !== start; i = cameFrom.get(i)!) {
    path.unshift({ x: i % def.width, y: Math.floor(i / def.width) });
  }
  return path;
}

/** The player clicked a tile: plan the walk there. */
export function setDestination(state: GameState, def: DungeonDefinition, target: Pos): GameState {
  const dungeon = state.dungeon;
  if (!dungeon) return state;
  const path = findPath(dungeon, def, target);
  if (!path) return { ...state, dungeon: withLog(dungeon, 'You cannot find a way there.') };
  return { ...state, dungeon: { ...dungeon, path } };
}

export function stopWalking(state: GameState): GameState {
  if (!state.dungeon || state.dungeon.path.length === 0) return state;
  return { ...state, dungeon: { ...state.dungeon, path: [] } };
}

export interface DungeonContext extends DialogueContext {
  getDialogue: (dialogueId: string) => DialogueDefinition;
  /** Display name of a monster, for messages. */
  monsterName: (monsterId: string) => string;
}

function describeGroup(f: EncounterFeature, ctx: DungeonContext): string {
  return f.monsters.map((m) => (m.count > 1 ? `${ctx.monsterName(m.monsterId)} ×${m.count}` : ctx.monsterName(m.monsterId))).join(', ');
}

function openFeatureDialogue(state: GameState, f: FeatureDefinition, nodeId: string | undefined, ctx: DungeonContext): GameState {
  if (f.type === 'encounter') return state;
  return startDialogue(state, ctx.getDialogue(f.dialogueId), { nodeId, source: f.id });
}

/**
 * Moves the party one tile along its path, then checks, in order: a trap or
 * event underfoot, an enemy group close enough to fight, traps close enough to
 * spot, and enemy groups coming into view. Any of these stops the walk.
 */
export function stepParty(state: GameState, def: DungeonDefinition, ctx: DungeonContext): GameState {
  const start = state.dungeon;
  if (!start || start.path.length === 0 || state.screen !== 'dungeon') return state;
  const [next, ...rest] = start.path;
  if (!next) return state;

  let dungeon: DungeonState = {
    ...start,
    previous: start.pos,
    pos: next,
    path: rest,
    seen: reveal(def, start.seen, next),
  };
  let game: GameState = { ...state, dungeon };
  const halt = (extra: Partial<DungeonState> = {}, ...lines: string[]) => {
    dungeon = withLog({ ...dungeon, ...extra, path: [] }, ...lines);
    game = { ...game, dungeon };
  };

  // 1. Something underfoot.
  const here = featureAt(def, next);
  if (here && !dungeon.resolved.includes(here.id)) {
    if (here.type === 'trap') {
      const spotted = dungeon.spotted.includes(here.id);
      halt({}, spotted ? `You reach the ${here.name}.` : `You trigger a ${here.name}!`);
      const node = spotted ? (here.disarmNode ?? here.triggerNode) : here.triggerNode;
      return openFeatureDialogue(game, here, node, ctx);
    }
    if (here.type === 'event' || here.type === 'goal') {
      halt();
      return openFeatureDialogue(game, here, here.node, ctx);
    }
  }

  // 2. An enemy group in reach: on any of the eight tiles around the party.
  const foes = def.features.find(
    (f): f is EncounterFeature => f.type === 'encounter' && !dungeon.resolved.includes(f.id) && chebyshev(f, next) <= 1,
  );
  if (foes) {
    halt({ noticed: [...new Set([...dungeon.noticed, foes.id])] }, `${describeGroup(foes, ctx)} attack!`);
    return { ...game, screen: 'combat', encounter: { featureId: foes.id, returnTo: dungeon.previous } };
  }

  // 3. Hidden traps close enough to spot: each one gets a single hidden Intellect check.
  let seed = game.rngSeed;
  const newlyChecked: string[] = [];
  const newlySpotted: string[] = [];
  const spotLines: string[] = [];
  for (const f of def.features) {
    if (f.type !== 'trap' || dungeon.resolved.includes(f.id) || dungeon.checkedTraps.includes(f.id)) continue;
    if (chebyshev(f, next) > 1) continue;
    const maker = checkMaker(game, { stat: 'intellect', difficulty: f.detectDifficulty, by: 'best' }, ctx);
    const rolled = makeCheck(seed, maker.modifier, f.detectDifficulty);
    seed = rolled.seed;
    newlyChecked.push(f.id);
    if (rolled.value.success) {
      newlySpotted.push(f.id);
      spotLines.push(`${maker.merc.name} spots a ${f.name}.`);
    }
  }
  if (newlyChecked.length > 0) {
    dungeon = { ...dungeon, checkedTraps: [...dungeon.checkedTraps, ...newlyChecked] };
    game = { ...game, rngSeed: seed, dungeon };
  }
  if (newlySpotted.length > 0) {
    halt({ spotted: [...dungeon.spotted, ...newlySpotted] }, ...spotLines);
    return game;
  }

  // 4. Enemy groups coming into view for the first time.
  const visible = visibleFrom(def, next);
  const sighted = def.features.filter(
    (f): f is EncounterFeature =>
      f.type === 'encounter' && !dungeon.resolved.includes(f.id) && !dungeon.noticed.includes(f.id) && visible.has(indexOf(def, f)),
  );
  if (sighted.length > 0) {
    halt(
      { noticed: [...dungeon.noticed, ...sighted.map((f) => f.id)] },
      ...sighted.map((f) => `You see ${describeGroup(f, ctx)} ahead.`),
    );
  }
  return game;
}

/** A fight is over (or the party fled): back to the map. */
export function resolveEncounter(state: GameState, outcome: 'victory' | 'retreat'): GameState {
  const { encounter, dungeon } = state;
  if (!encounter || !dungeon) return state;
  if (outcome === 'victory') {
    return {
      ...state,
      screen: 'dungeon',
      encounter: null,
      dungeon: withLog({ ...dungeon, resolved: [...dungeon.resolved, encounter.featureId] }, 'The enemy group is defeated.'),
    };
  }
  return {
    ...state,
    screen: 'dungeon',
    encounter: null,
    dungeon: withLog({ ...dungeon, pos: encounter.returnTo, path: [] }, 'You fall back.'),
  };
}

/** Problems with a map's data. Empty means it is playable. */
export function validateDungeon(def: DungeonDefinition): string[] {
  const problems: string[] = [];
  if (def.tiles.length !== def.height) problems.push(`has ${def.tiles.length} rows but a height of ${def.height}`);
  def.tiles.forEach((row, y) => {
    if (row.length !== def.width) problems.push(`row ${y} is ${row.length} tiles wide, not ${def.width}`);
    for (const ch of row) if (!(ch in TILE_CHARS)) problems.push(`row ${y} has unknown tile "${ch}"`);
  });
  if (!isWalkable(def, def.start.x, def.start.y)) problems.push('the start is not on open ground');
  for (const f of def.features) {
    if (!isWalkable(def, f.x, f.y)) problems.push(`${f.id} is not on open ground`);
  }
  for (const r of def.rooms) {
    if (r.rows < 2 || r.rows > 5) problems.push(`room ${r.id} has ${r.rows} combat rows; use 2 to 5`);
  }
  const goals = def.features.filter((f) => f.type === 'goal');
  if (goals.length !== 1) problems.push(`needs exactly one goal, has ${goals.length}`);

  // Everything must be reachable from the start, ignoring fog and features.
  const reach = new Set<number>([indexOf(def, def.start)]);
  const queue = [def.start];
  while (queue.length > 0) {
    const p = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (isWalkable(def, n.x, n.y) && !reach.has(indexOf(def, n))) {
        reach.add(indexOf(def, n));
        queue.push(n);
      }
    }
  }
  for (const f of def.features) {
    if (isWalkable(def, f.x, f.y) && !reach.has(indexOf(def, f))) problems.push(`${f.id} cannot be reached from the start`);
  }
  return problems;
}
