import { endTurn, joinCombat, startCombat, type CombatContext } from './combat';
import {
  activeMercIds,
  allEncounters,
  encounterMercIds,
  groupInFight,
  groupsOf,
  isSplit,
  MAIN_GROUP,
  setGroups,
  type DungeonState,
  type EncounterState,
  type GroupState,
  type WorldSlot,
  type WorldState,
} from './dungeon';
import type { GameState } from './gameState';
import type { Merc } from './merc';
import { statModifier } from './stats';

/**
 * The split party. Any merc can leave their group and explore alone; groups on
 * the same tile can regroup. While split, time runs in world rounds: every
 * fight plays one full round, then every group not fighting gets one
 * exploration turn of up to its movement in tiles. With the party whole, the
 * map works as before: free walking, and one fight at a time.
 *
 * Only one fight and one group are "on screen" at a time: the fight in
 * `encounter` and the group on `dungeon.pos`. The others wait in
 * `otherEncounters` and `dungeon.otherGroups`, and are swapped in when their
 * turn comes. Every command runs through `settle`, which keeps this in order.
 */

export type WorldContext = CombatContext;

// ---------- what is on screen ----------

/** Puts the fight on screen away with the others. */
function parkEncounter(state: GameState): GameState {
  if (!state.encounter) return state;
  return { ...state, encounter: null, otherEncounters: [...(state.otherEncounters ?? []), state.encounter] };
}

/** Brings a fight on screen. */
export function focusEncounter(state: GameState, featureId: string): GameState {
  if (state.encounter?.featureId === featureId) return { ...state, screen: 'combat' };
  const target = (state.otherEncounters ?? []).find((e) => e.featureId === featureId);
  if (!target) return state;
  const parked = parkEncounter(state);
  return {
    ...parked,
    screen: 'combat',
    encounter: target,
    otherEncounters: (parked.otherEncounters ?? []).filter((e) => e !== target),
  };
}

/** Makes a group the one on the map's `pos`. */
export function focusGroup(state: GameState, groupId: string): GameState {
  const groups = groupsOf(state);
  if (!groups.some((g) => g.id === groupId) || groups[0]?.id === groupId) return state;
  return setGroups(state, groups, groupId);
}

// ---------- splitting and regrouping ----------

/** Why the party cannot split or regroup right now, or null. */
export function groupingBlocker(state: GameState): string | null {
  const d = state.dungeon;
  if (!d || state.screen !== 'dungeon') return 'Only while exploring.';
  if (d.path.length > 0) return 'Stop walking first.';
  const w = d.world;
  if (w && !(w.current?.kind === 'explore' && w.current.groupId === (d.group?.id ?? MAIN_GROUP))) return 'Wait for this group’s turn.';
  return null;
}

/** A merc leaves the active group and takes their own token, on the same tile. */
export function splitOff(state: GameState, mercId: string): GameState {
  const blocker = groupingBlocker(state);
  if (blocker) throw new Error(blocker);
  const groups = groupsOf(state);
  const active = groups[0]!;
  if (!active.mercIds.includes(mercId)) throw new Error('That merc is not in this group.');
  if (active.mercIds.length < 2) throw new Error('A merc alone is already their own group.');
  const merc = state.party.find((m) => m.id === mercId);
  if (!merc || merc.dead) throw new Error('That merc cannot go off alone.');
  const used = new Set(groups.map((g) => g.id));
  let n = 2;
  while (used.has(`g${n}`)) n++;
  const loner: GroupState = { id: `g${n}`, mercIds: [mercId], pos: active.pos, previous: active.previous, path: [] };
  const rest: GroupState = { ...active, mercIds: active.mercIds.filter((id) => id !== mercId), path: [] };
  let next = setGroups(state, [rest, ...groups.slice(1), loner], rest.id);
  next = log(next, `${merc.name} heads off alone.`);
  // A new group joins the turn order straight away: it goes later this round.
  const w = next.dungeon?.world;
  if (w) next = withWorld(next, { ...w, queue: [...w.queue, { kind: 'explore', groupId: loner.id }] });
  return next;
}

/** Every group standing on the active group's tile, and not fighting, joins it. */
export function regroup(state: GameState): GameState {
  const blocker = groupingBlocker(state);
  if (blocker) throw new Error(blocker);
  const [active, ...others] = groupsOf(state);
  const here = others.filter((g) => g.pos.x === active!.pos.x && g.pos.y === active!.pos.y && !groupInFight(state, g));
  if (here.length === 0) throw new Error('No other group is standing here.');
  const merged: GroupState = { ...active!, mercIds: [...active!.mercIds, ...here.flatMap((g) => g.mercIds)] };
  const remaining = others.filter((g) => !here.includes(g));
  let next = setGroups(state, [merged, ...remaining], merged.id);
  const w = next.dungeon?.world;
  if (w) {
    const gone = new Set(here.map((g) => g.id));
    next = withWorld(next, { ...w, queue: w.queue.filter((s) => !(s.kind === 'explore' && gone.has(s.groupId))) });
  }
  return log(next, 'The groups join up.');
}

/** Groups that could regroup with the active one: on its tile and not fighting. */
export function groupsHere(state: GameState): GroupState[] {
  const [active, ...others] = groupsOf(state);
  if (!active) return [];
  return others.filter((g) => g.pos.x === active.pos.x && g.pos.y === active.pos.y && !groupInFight(state, g));
}

/** The active group stops for this turn. */
export function endExploreTurn(state: GameState): GameState {
  const w = state.dungeon?.world;
  if (!w || w.current?.kind !== 'explore') return state;
  return withWorld({ ...state, dungeon: { ...state.dungeon!, path: [] } }, { ...w, movesLeft: 0 });
}

// ---------- the world round ----------

/** Tiles every merc walks in an exploration turn on the map, before their Agility modifier, whatever their race or gear. */
export const EXPLORE_BASE_MOVEMENT = 3;

/** Tiles one merc can walk in an exploration turn while the party is split: 3 + Agility modifier, at least 1. */
export function exploreMovement(merc: Merc, ctx: Pick<CombatContext, 'sheetOf'>): number {
  return Math.max(1, EXPLORE_BASE_MOVEMENT + statModifier(ctx.sheetOf(merc).stats.agility));
}

/** Tiles a group can walk in one exploration turn: as far as its slowest member. */
export function groupMovement(state: GameState, group: GroupState, ctx: CombatContext): number {
  const mercs = group.mercIds.map((id) => state.party.find((m) => m.id === id)).filter((m): m is Merc => !!m && !m.dead);
  if (mercs.length === 0) return 0;
  return Math.min(...mercs.map((m) => exploreMovement(m, ctx)));
}

function withWorld(state: GameState, world: WorldState | undefined): GameState {
  const d = state.dungeon;
  if (!d) return state;
  const { world: _w, ...rest } = d;
  const dungeon: DungeonState = world ? { ...rest, world } : rest;
  return { ...state, dungeon };
}

function log(state: GameState, line: string): GameState {
  const d = state.dungeon;
  if (!d) return state;
  return { ...state, dungeon: { ...d, log: [...d.log, line].slice(-30) } };
}

/** Everything that gets a turn this round: fights first, then the groups that are free to explore. */
function roundSlots(state: GameState): WorldSlot[] {
  // A fight waiting over the fallen takes no turns until someone joins it.
  const fights: WorldSlot[] = allEncounters(state)
    .filter((e) => !e.combat?.outcome && !e.combat?.dormant)
    .map((e) => ({ kind: 'fight', featureId: e.featureId }));
  // Groups keep a steady order from round to round, whichever is on screen.
  const explorers: WorldSlot[] = [...groupsOf(state)]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .filter((g) => !groupInFight(state, g) && g.mercIds.some((id) => !state.party.find((m) => m.id === id)?.dead))
    .map((g) => ({ kind: 'explore', groupId: g.id }));
  return [...fights, ...explorers];
}

/** Moves on to the next slot, starting a new world round when this one is done. */
function nextSlot(state: GameState): GameState {
  const w = state.dungeon?.world;
  if (!w) return state;
  let next: GameState;
  if (w.queue.length > 0) {
    const [current, ...queue] = w.queue;
    next = withWorld(state, { round: w.round, current: current!, queue });
  } else {
    const [current, ...queue] = roundSlots(state);
    next = log(withWorld(state, { round: w.round + 1, current: current ?? null, queue }), `— World round ${w.round + 1} —`);
  }
  // An exploration turn happens on the map: any fight on screen waits with the others.
  if (next.dungeon?.world?.current?.kind === 'explore') next = { ...parkEncounter(next), screen: 'dungeon' };
  return next;
}

/**
 * The party lost this fight, but others are still out there: leave the fallen
 * where they lie, with the enemy holding the room, and carry on with the rest.
 * The fight waits until someone walks in to the rescue.
 */
export function leaveTheFallen(state: GameState): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome !== 'defeat' || !state.encounter || !rescuersExist(state, state.encounter)) return state;
  let s: GameState = { ...state, encounter: { ...state.encounter, combat: { ...c, outcome: null, dormant: true } } };
  // Move the turn on past whoever struck the last blow; the waiting fight cannot end in defeat.
  s = endTurn(s);
  const fallen = s.party.filter((m) => encounterMercIds(s, s.encounter!).includes(m.id)).map((m) => m.name);
  s = log(s, `${fallen.join(', ')} ${fallen.length === 1 ? 'has' : 'have'} fallen. The enemy holds the room: the rest of the party can still come to the rescue.`);
  const w = s.dungeon?.world;
  return w ? nextSlot(withWorld(s, { ...w, fightRound: undefined })) : s;
}

/** Someone outside this fight is still on their feet and could come to help. */
export function rescuersExist(state: GameState, fight: EncounterState): boolean {
  const inFight = new Set(encounterMercIds(state, fight));
  return state.party.some((m) => !inFight.has(m.id) && !m.dead && !m.down);
}

function findEncounter(state: GameState, featureId: string): EncounterState | undefined {
  return allEncounters(state).find((e) => e.featureId === featureId);
}

/**
 * Keeps the split party's turn order in step after any command: starts the
 * world round when the party splits, puts the right fight or group on screen,
 * starts and joins fights, and passes the turn on when a fight has played its
 * round or a group has walked its tiles. Does nothing while the party is whole.
 */
export function settle(state: GameState, ctx: WorldContext): GameState {
  let s = state;
  for (let guard = 0; guard < 40; guard++) {
    const d = s.dungeon;
    if (!d || (s.screen !== 'dungeon' && s.screen !== 'combat')) return s;

    // A fight begun on screen starts at once.
    if (s.encounter && !s.encounter.combat) s = startCombat(s, ctx);

    if (!isSplit(s) && allEncounters(s).length <= 1) {
      // Whole again: free walking, one fight at a time.
      if (d.world) return withWorld(s, undefined);
      return s;
    }

    // A group that walked into a fight joins it, and the fight takes over.
    if (d.pendingJoin) {
      const { featureId, from } = d.pendingJoin;
      const { pendingJoin: _p, ...rest } = d;
      s = { ...s, dungeon: rest };
      const mercIds = activeMercIds(s);
      s = focusEncounter(s, featureId);
      s = joinCombat(s, mercIds, from, ctx);
      if (s.dungeon?.world) s = withWorld(s, { ...s.dungeon.world, movesLeft: 0 });
      continue;
    }

    const w = d.world;
    if (!w) {
      const [current, ...queue] = roundSlots(s);
      s = log(withWorld(s, { round: 1, current: current ?? null, queue }), 'The party is split: everyone takes turns.');
      // A fight that started before the split keeps its place on screen.
      continue;
    }
    if (!w.current) {
      if (roundSlots(s).length === 0) return s;
      s = nextSlot(s);
      continue;
    }

    if (w.current.kind === 'fight') {
      const fight = findEncounter(s, w.current.featureId);
      if (!fight) {
        s = nextSlot(s);
        continue;
      }
      if (s.encounter?.featureId !== fight.featureId) {
        s = focusEncounter(s, fight.featureId);
        s = withWorld(s, { ...s.dungeon!.world!, fightRound: s.encounter?.combat?.round ?? 1 });
        continue;
      }
      if (s.screen !== 'combat') s = { ...s, screen: 'combat' };
      const c = s.encounter!.combat!;
      // The outcome waits on screen until the player moves on. A lost fight while others still
      // stand is left waiting for a rescue (leaveTheFallen) once the player has seen it.
      if (c.outcome) return s;
      if (w.fightRound === undefined) {
        s = withWorld(s, { ...w, fightRound: c.round });
        continue;
      }
      if (c.round > w.fightRound) {
        s = nextSlot(withWorld(s, { ...w, fightRound: undefined }));
        continue;
      }
      return s;
    }

    // An exploration turn.
    const group = groupsOf(s).find((g) => g.id === (w.current as { groupId: string }).groupId);
    if (!group || groupInFight(s, group)) {
      s = nextSlot(s);
      continue;
    }
    // This group's move started a fight: the fight goes next, and this turn is over.
    if (s.encounter && s.screen === 'combat' && w.current.kind === 'explore') {
      const started = s.encounter.featureId;
      s = withWorld(s, { ...w, current: { kind: 'fight', featureId: started }, fightRound: s.encounter.combat?.round ?? 1, movesLeft: undefined });
      continue;
    }
    if (s.encounter) s = parkEncounter(s);
    if (groupsOf(s)[0]?.id !== group.id) s = focusGroup(s, group.id);
    if (s.screen !== 'dungeon') s = { ...s, screen: 'dungeon' };
    const now = s.dungeon!.world!;
    if (now.movesLeft === undefined) {
      s = withWorld(s, { ...now, movesLeft: groupMovement(s, group, ctx) });
      continue;
    }
    if (now.movesLeft <= 0 && s.dungeon!.path.length === 0) {
      s = nextSlot(withWorld(s, { ...now, movesLeft: undefined }));
      continue;
    }
    return s;
  }
  return s;
}
