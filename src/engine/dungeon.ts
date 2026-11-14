import { closeAdventure, completeAdventure } from './adventure';
import { makeCheck } from './checks';
import type { CombatState } from './combat';
import { checkMaker, startDialogue, type DialogueContext, type DialogueDefinition } from './dialogue';
import { announceRolls, type GameState, type ShownRoll } from './gameState';
import type { ItemLookup } from './items';
import { findSupply, spendOne } from './store';

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
  /** Floor texture for this room on the map and the battlefield (an asset id under floors/). */
  floor?: string;
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

/** Battlefield dressing placed on an encounter. `kind` is an obstacle type id (obstacles.json). Position is on the combat grid, not the dungeon map. */
export interface ObstacleFeature {
  id: string;
  kind: string;
  x: number;
  y: number;
}

export interface EncounterFeature extends FeatureBase {
  type: 'encounter';
  monsters: { monsterId: string; count: number }[];
  /** The enemies attack from all sides with the party in the middle. */
  ambush?: boolean;
  /** Tiles within which the enemies may notice the party. Default 4. */
  detection?: number;
  /** Agility check to move unnoticed inside the detection range. Default 12. */
  stealthDifficulty?: number;
  /** Obstacles dressing this fight's battlefield. */
  obstacles?: ObstacleFeature[];
}

export const DEFAULT_DETECTION = 4;
export const DEFAULT_STEALTH_DIFFICULTY = 12;

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
  /** Floor texture for corridors and for rooms without one of their own. */
  floor?: string;
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
  /** The one long rest allowed on this level has been taken. */
  rested: boolean;
  /** The party is at camp right now: points can be spent until it moves on. */
  camping?: boolean;
  /**
   * When the party has split: the group whose token is `pos` above. Without it,
   * the whole party moves as one.
   */
  group?: { id: string; mercIds: string[] };
  /** The other groups, waiting while the active one moves. */
  otherGroups?: GroupState[];
  /** Turn order while the party is split: fights and exploration take turns. */
  world?: WorldState;
  /** The active group just walked into a room with a fight going on: it joins next. */
  pendingJoin?: { featureId: string; from: Pos };
}

/** A part of the party with its own token on the map. */
export interface GroupState {
  id: string;
  mercIds: string[];
  pos: Pos;
  previous: Pos;
  path: Pos[];
}

/** Whose go it is while the party is split: a fight's next round, or a group's exploration turn. */
export type WorldSlot = { kind: 'fight'; featureId: string } | { kind: 'explore'; groupId: string };

/**
 * A world round: every fight plays one full round, then every group not in a
 * fight takes one exploration turn of up to its movement in tiles.
 */
export interface WorldState {
  round: number;
  current: WorldSlot | null;
  /** Slots still to come this round. */
  queue: WorldSlot[];
  /** For a fight's slot: its round when the slot began, so a full round can be spotted. */
  fightRound?: number;
  /** For an exploration slot: tiles left to walk. */
  movesLeft?: number;
}

export interface EncounterState {
  featureId: string;
  /** Where the party goes if it retreats. */
  returnTo: Pos;
  /** The fight itself, once it has started. */
  combat?: CombatState;
  /** The mercs in this fight. Without it, every living merc is. */
  mercIds?: string[];
  /** The party reached the group unseen: the enemies lose their first round. */
  surprise?: boolean;
}

const LOG_LIMIT = 30;
export const SIGHT_RADIUS = 2;

// ---------- groups ----------

export const MAIN_GROUP = 'g1';

export function isSplit(state: GameState): boolean {
  return (state.dungeon?.otherGroups?.length ?? 0) > 0;
}

/** The mercs in the group whose token is on `pos`. */
export function activeMercIds(state: GameState): string[] {
  const d = state.dungeon;
  if (d?.group) return d.group.mercIds;
  const elsewhere = new Set((d?.otherGroups ?? []).flatMap((g) => g.mercIds));
  return state.party.filter((m) => !elsewhere.has(m.id)).map((m) => m.id);
}

/** Every group, the active one first. */
export function groupsOf(state: GameState): GroupState[] {
  const d = state.dungeon;
  if (!d) return [];
  const active: GroupState = { id: d.group?.id ?? MAIN_GROUP, mercIds: activeMercIds(state), pos: d.pos, previous: d.previous, path: d.path };
  return [active, ...(d.otherGroups ?? [])];
}

/** Writes groups back, with `activeId` as the one on `pos`. One group left means the party is whole again. */
export function setGroups(state: GameState, groups: GroupState[], activeId: string): GameState {
  const d = state.dungeon;
  if (!d) return state;
  const active = groups.find((g) => g.id === activeId) ?? groups[0]!;
  const others = groups.filter((g) => g.id !== active.id);
  const { group: _g, otherGroups: _o, ...rest } = d;
  const dungeon: DungeonState = {
    ...rest,
    pos: active.pos,
    previous: active.previous,
    path: active.path,
    ...(others.length > 0 ? { group: { id: active.id, mercIds: active.mercIds }, otherGroups: others } : {}),
  };
  return { ...state, dungeon };
}

/** The fight on screen and any others going on elsewhere. */
export function allEncounters(state: GameState): EncounterState[] {
  return [...(state.encounter ? [state.encounter] : []), ...(state.otherEncounters ?? [])];
}

/** The mercs in a fight. */
export function encounterMercIds(state: GameState, e: EncounterState): string[] {
  return e.mercIds ?? state.party.filter((m) => !m.dead).map((m) => m.id);
}

/** True while any merc of the group is in a fight. */
export function groupInFight(state: GameState, group: GroupState): boolean {
  const fighting = new Set(allEncounters(state).flatMap((e) => encounterMercIds(state, e)));
  return group.mercIds.some((id) => fighting.has(id));
}

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

/** The floor texture painted at a spot: its room's, or the map's own. */
export function floorAt(def: DungeonDefinition, p: Pos): string | undefined {
  return roomAt(def, p)?.floor ?? def.floor;
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
  // A round patch of sight, so the edge of what is lit is not a hard square.
  const reach = SIGHT_RADIUS + 0.5;
  for (let y = p.y - SIGHT_RADIUS; y <= p.y + SIGHT_RADIUS; y++) {
    for (let x = p.x - SIGHT_RADIUS; x <= p.x + SIGHT_RADIUS; x++) {
      if (x < 0 || y < 0 || x >= def.width || y >= def.height) continue;
      if (Math.hypot(x - p.x, y - p.y) > reach) continue;
      if (lineOfSight(def, p, { x, y })) seen.add(y * def.width + x);
    }
  }
  for (const room of roomsLitFrom(def, p)) {
    // The walls around the room are revealed with it.
    for (let y = room.y - 1; y <= room.y + room.height; y++) {
      for (let x = room.x - 1; x <= room.x + room.width; x++) {
        if (x >= 0 && y >= 0 && x < def.width && y < def.height) seen.add(y * def.width + x);
      }
    }
  }
  return seen;
}

/** The room the party stands in, or, from a doorway, the rooms that doorway opens into. */
export function roomsLitFrom(def: DungeonDefinition, p: Pos): RoomDefinition[] {
  const here = roomAt(def, p);
  if (here) return [here];
  const t = tileAt(def, p.x, p.y);
  if (t !== 'door' && t !== 'lockedDoor') return [];
  const rooms = new Set<RoomDefinition>();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const r = roomAt(def, { x: p.x + dx, y: p.y + dy });
    if (r) rooms.add(r);
  }
  return [...rooms];
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
    rested: false,
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

// ---------- leaving ----------

/** True once the dungeon's goal is done: its entrance then becomes the way out. */
export function goalReached(dungeon: DungeonState, def: DungeonDefinition): boolean {
  return def.features.some((f) => f.type === 'goal' && dungeon.resolved.includes(f.id));
}

/** The party may leave: the goal is done and it stands at the entrance. */
export function canLeave(state: GameState, def: DungeonDefinition): boolean {
  const d = state.dungeon;
  return !!d && state.screen === 'dungeon' && !isSplit(state) && goalReached(d, def) && samePos(d.pos, def.start);
}

/** Walks out with the goal done: plays the adventure's ending, or finishes it at once if it has none. */
export function leaveDungeon(state: GameState, def: DungeonDefinition, ctx: DungeonContext): GameState {
  if (!canLeave(state, def)) return state;
  const left: GameState = { ...state, dungeon: { ...state.dungeon!, path: [] } };
  const ending = ctx.endingDialogue(left);
  if (ending) return startDialogue(left, ending);
  return closeAdventure(completeAdventure(left));
}

/** The player clicked a tile: plan the walk there. */
export function setDestination(state: GameState, def: DungeonDefinition, target: Pos): GameState {
  const dungeon = state.dungeon;
  if (!dungeon) return state;
  const path = findPath(dungeon, def, target);
  if (path && path.length > 0 && dungeon.camping) return { ...state, dungeon: { ...dungeon, path, camping: false } };
  if (!path) {
    const message = isSeen(dungeon, def, target) ? 'You cannot find a way there.' : 'You have not explored a way there yet.';
    return { ...state, dungeon: withLog(dungeon, message) };
  }
  return { ...state, dungeon: { ...dungeon, path } };
}

export function stopWalking(state: GameState): GameState {
  if (!state.dungeon || state.dungeon.path.length === 0) return state;
  return { ...state, dungeon: { ...state.dungeon, path: [] } };
}

export interface DungeonContext extends DialogueContext {
  getDialogue: (dialogueId: string) => DialogueDefinition;
  /** For supplies the party carries, such as trap-disarming kits. */
  getItem?: ItemLookup;
  /** The dialogue played on leaving with the goal done, or null to finish the adventure straight away. */
  endingDialogue: (state: GameState) => DialogueDefinition | null;
  /** Display name of a monster, for messages. */
  monsterName: (monsterId: string) => string;
}

function describeGroup(f: EncounterFeature, ctx: DungeonContext): string {
  return f.monsters.map((m) => (m.count > 1 ? `${ctx.monsterName(m.monsterId)} ×${m.count}` : ctx.monsterName(m.monsterId))).join(', ');
}

/** The party sneaks only as well as its noisiest member: the standing merc with the lowest Agility. */
function quietestMerc(state: GameState, ctx: DungeonContext) {
  let worst: { merc: GameState['party'][number]; modifier: number } | null = null;
  for (const merc of state.party) {
    if (merc.down || merc.dead) continue;
    const modifier = Math.floor((ctx.statsOf(merc).agility - 10) / 2);
    if (!worst || modifier < worst.modifier) worst = { merc, modifier };
  }
  return worst;
}

function openFeatureDialogue(state: GameState, f: FeatureDefinition, nodeId: string | undefined, ctx: DungeonContext): GameState {
  if (f.type === 'encounter') return state;
  return startDialogue(state, ctx.getDialogue(f.dialogueId), {
    nodeId,
    source: f.id,
    ...(isSplit(state) ? { mercIds: activeMercIds(state) } : {}),
  });
}

/**
 * Moves the party one tile along its path, then checks, in order: a trap or
 * event underfoot, an enemy group close enough to fight, traps close enough to
 * spot, and enemy groups coming into view. Any of these stops the walk.
 */
export function stepParty(state: GameState, def: DungeonDefinition, ctx: DungeonContext): GameState {
  const start = state.dungeon;
  if (!start || start.path.length === 0 || state.screen !== 'dungeon') return state;
  // While split, a group only moves on its own exploration turn, and only as far as its movement.
  const w = start.world;
  if (w) {
    const mine = w.current?.kind === 'explore' && w.current.groupId === (start.group?.id ?? MAIN_GROUP);
    if (!mine || (w.movesLeft ?? 0) <= 0) return { ...state, dungeon: { ...start, path: [] } };
  }
  const [next, ...rest] = start.path;
  if (!next) return state;

  let dungeon: DungeonState = {
    ...start,
    previous: start.pos,
    pos: next,
    path: w && (w.movesLeft ?? 0) <= 1 ? [] : rest,
    seen: reveal(def, start.seen, next),
    ...(w ? { world: { ...w, movesLeft: (w.movesLeft ?? 0) - 1 } } : {}),
  };
  let game: GameState = { ...state, dungeon };
  // Fights already going on: their groups are not new encounters, but walking into their room joins them.
  const ongoing = new Set(allEncounters(state).map((e) => e.featureId));
  const room = roomAt(def, next);
  if (room && roomAt(def, start.pos) !== room) {
    const fight = allEncounters(state).find((e) => {
      const f = def.features.find((x) => x.id === e.featureId);
      return f && roomAt(def, f) === room;
    });
    if (fight) {
      dungeon = withLog({ ...dungeon, path: [], pendingJoin: { featureId: fight.featureId, from: start.pos } }, 'You run into the fight!');
      return { ...game, dungeon };
    }
  }
  const halt = (extra: Partial<DungeonState> = {}, ...lines: string[]) => {
    dungeon = withLog({ ...dungeon, ...extra, path: [] }, ...lines);
    game = { ...game, dungeon };
  };

  // 1. Something underfoot.
  const here = featureAt(def, next);
  if (here && !dungeon.resolved.includes(here.id)) {
    if (here.type === 'trap') {
      const spotted = dungeon.spotted.includes(here.id);
      // A trap-disarming kit makes short work of a trap the party has seen coming.
      const kit = spotted && ctx.getItem ? findSupply(game.party, activeMercIds(game), 'disarmTrap', ctx.getItem) : null;
      if (kit) {
        const who = game.party.find((m) => m.id === kit.mercId)!;
        halt({ resolved: [...dungeon.resolved, here.id] }, `${who.name} disarms the ${here.name} with a trap kit.`);
        return spendOne(game, kit.mercId, kit.stackIndex);
      }
      halt({}, spotted ? `You reach the ${here.name}.` : `You trigger a ${here.name}!`);
      const node = spotted ? (here.disarmNode ?? here.triggerNode) : here.triggerNode;
      return openFeatureDialogue(game, here, node, ctx);
    }
    if (here.type === 'event' || here.type === 'goal') {
      halt();
      return openFeatureDialogue(game, here, here.node, ctx);
    }
  }

  // 1b. Back at the entrance with the goal done: the way out.
  if (rest.length === 0 && goalReached(dungeon, def) && samePos(next, def.start)) {
    halt({}, 'You reach the way out.');
    return leaveDungeon(game, def, ctx);
  }

  // 2. An enemy group in reach: on any of the eight tiles around the party.
  const foes = def.features.find(
    (f): f is EncounterFeature => f.type === 'encounter' && !dungeon.resolved.includes(f.id) && !ongoing.has(f.id) && chebyshev(f, next) <= 1,
  );
  // Getting this close means the group never spotted the party (a failed stealth check starts the
  // fight sooner), so the party strikes first, unless the group is the one lying in ambush.
  if (foes) {
    const surprise = !foes.ambush;
    halt(
      { noticed: [...new Set([...dungeon.noticed, foes.id])] },
      surprise ? `You catch ${describeGroup(foes, ctx)} off guard!` : `${describeGroup(foes, ctx)} attack!`,
    );
    return beginEncounter(game, def, foes, dungeon.previous, surprise);
  }

  // 2b. Sneaking: inside a group's detection range and in its sight, every step needs a stealth check.
  const watchers = def.features.filter(
    (f): f is EncounterFeature =>
      f.type === 'encounter' &&
      !dungeon.resolved.includes(f.id) &&
      !ongoing.has(f.id) &&
      Math.hypot(f.x - next.x, f.y - next.y) <= (f.detection ?? DEFAULT_DETECTION) + 0.5 &&
      lineOfSight(def, f, next),
  );
  for (const group of watchers) {
    const sneak = quietestMerc(game, ctx);
    if (!sneak) break;
    const difficulty = group.stealthDifficulty ?? DEFAULT_STEALTH_DIFFICULTY;
    const rolled = makeCheck(game.rngSeed, sneak.modifier, difficulty);
    const shown: ShownRoll = {
      who: sneak.merc.name,
      what: 'Stealth (Agility)',
      sides: 20,
      dice: rolled.value.roll.dice,
      kept: rolled.value.roll.natural,
      total: rolled.value.total,
      target: difficulty,
      result: rolled.value.success ? 'Unseen' : 'Spotted!',
      good: rolled.value.success,
    };
    game = announceRolls({ ...game, rngSeed: rolled.seed }, [shown]);
    dungeon = game.dungeon!;
    if (!rolled.value.success) {
      halt(
        { noticed: [...new Set([...dungeon.noticed, group.id])] },
        `${describeGroup(group, ctx)} spot ${sneak.merc.name} and attack!`,
      );
      return beginEncounter(game, def, group, dungeon.previous);
    }
  }

  // 3. Hidden traps close enough to spot: each one gets a single hidden Intellect check.
  let seed = game.rngSeed;
  const newlyChecked: string[] = [];
  const newlySpotted: string[] = [];
  const spotLines: string[] = [];
  const spotRolls: ShownRoll[] = [];
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
      // Only a successful spot shows its die: a failed hidden check would give the trap away.
      spotRolls.push({
        who: maker.merc.name,
        what: 'Spotting (Intellect)',
        sides: 20,
        dice: rolled.value.roll.dice,
        kept: rolled.value.roll.natural,
        total: rolled.value.total,
        target: f.detectDifficulty,
        result: 'Spotted',
        good: true,
      });
    }
  }
  if (newlyChecked.length > 0) {
    dungeon = { ...dungeon, checkedTraps: [...dungeon.checkedTraps, ...newlyChecked] };
    game = { ...game, rngSeed: seed, dungeon };
  }
  if (newlySpotted.length > 0) {
    halt({ spotted: [...dungeon.spotted, ...newlySpotted] }, ...spotLines);
    return announceRolls(game, spotRolls);
  }

  // 4. Enemy groups coming into view for the first time.
  const visible = visibleFrom(def, next);
  const sighted = def.features.filter(
    (f): f is EncounterFeature =>
      f.type === 'encounter' && !dungeon.resolved.includes(f.id) && !ongoing.has(f.id) && !dungeon.noticed.includes(f.id) && visible.has(indexOf(def, f)),
  );
  if (sighted.length > 0) {
    halt(
      { noticed: [...dungeon.noticed, ...sighted.map((f) => f.id)] },
      ...sighted.map((f) => `You see ${describeGroup(f, ctx)} ahead.`),
    );
  }
  return game;
}

/**
 * An enemy group attacks. With the party whole, everyone fights. Split up, the
 * fight takes the active group plus any other group standing in the same room.
 */
function beginEncounter(state: GameState, def: DungeonDefinition, foes: EncounterFeature, returnTo: Pos, surprise = false): GameState {
  const encounter: EncounterState = { featureId: foes.id, returnTo, ...(surprise ? { surprise: true } : {}) };
  if (!isSplit(state)) return { ...state, screen: 'combat', encounter };
  const room = roomAt(def, foes);
  const mercIds = [...activeMercIds(state)];
  for (const g of (state.dungeon?.otherGroups ?? [])) {
    if (room && roomAt(def, g.pos) === room && !groupInFight(state, g)) mercIds.push(...g.mercIds);
  }
  const living = new Set(state.party.filter((m) => !m.dead).map((m) => m.id));
  return { ...state, screen: 'combat', encounter: { ...encounter, mercIds: mercIds.filter((id) => living.has(id)) } };
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
