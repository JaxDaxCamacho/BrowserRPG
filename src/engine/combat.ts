import { ATTACK_STAT, DEFAULT_CRIT_THRESHOLD, resolveAttack, type Armour, type AttackOutcome, type AttackProfile } from './attack';
import { makeCheck } from './checks';
import { rollD20, type RollMode } from './dice';
import { featureById, type DungeonDefinition, type ObstacleFeature, type Pos } from './dungeon';
import { announceRolls, type GameState, type ShownRoll } from './gameState';
import { ensureLiveLeader, knockDown, saveRoll } from './injuries';
import { weaponAttack, type AmmoItem, type DamageStyle, type ItemEffect, type ItemLookup } from './items';
import type { Merc as MercType, MercSheet } from './merc';
import type { AbilityDefinition, EnemyArchetype, MonsterDefinition } from './monsters';
import { getLeader } from './party';
import { raceCritThreshold, raceDeathSaveDifficulty, raceXpMultiplier, type RaceDefinition, type WeaponType } from './race';
import { applyStatChanges, statModifier, type StatChanges, type Stats } from './stats';

/**
 * Turn-based fights on a square grid the size of the room. Each turn a
 * combatant can move up to their movement allowance (race base + Agility
 * modifier) and take one action. Melee reaches the eight tiles around the
 * attacker; ranged attacks reach a number of tiles and roll with disadvantage
 * while an enemy stands next to the shooter. Stepping out of an enemy's reach
 * gives that enemy a free attack.
 */

export type Side = 'party' | 'enemy';

/** Defense added by the Defend action until the defender's next turn. */
export const DEFEND_BONUS = 2;
/** Agility check the leader makes to flee. */
export const FLEE_DIFFICULTY = 12;
/** Movement for monsters whose data gives none. */
export const DEFAULT_MONSTER_MOVEMENT = 3;
/** The battlefield never gets smaller or bigger than this. */
export const GRID_MIN = { width: 5, height: 4 };
export const GRID_MAX = { width: 12, height: 9 };
/** A fight in a corridor happens on a strip this size. */
export const CORRIDOR_GRID = { width: 8, height: 3 };

export interface CombatAttack {
  name: string;
  /** 0 = melee, the eight tiles around the attacker. Otherwise the reach in tiles. */
  range: number;
  profile: AttackProfile;
  weaponType?: WeaponType;
  /** Ammunition item spent per shot, if any. */
  ammoId?: string;
  animation: string;
}

/** A temporary change from an ability or potion. */
export interface Buff {
  source: string;
  effects: ItemEffect[];
  /** Rounds left; null lasts the whole fight. */
  roundsLeft: number | null;
}

export interface Combatant {
  id: string;
  side: Side;
  name: string;
  portrait?: string;
  mercId?: string;
  monsterId?: string;
  archetype?: EnemyArchetype;
  pos: Pos;
  /** Tiles this combatant may move each turn. */
  movement: number;
  hp: number;
  maxHp: number;
  baseDefense: number;
  armour: Armour;
  stats: Stats;
  initiative: number;
  defending: boolean;
  buffs: Buff[];
  /** Turns until each ability can be used again. */
  cooldowns: Record<string, number>;
  abilityIds: string[];
  attack: CombatAttack;
  /** Lowest natural roll that crits with the basic attack. */
  critThreshold: number;
  /** Mercs only: the d20 a Cursed merc needs to avoid an injury when going down, or null. */
  deathSave: number | null;
  /** Mercs only: killed by a fourth injury in this fight. */
  dead: boolean;
}

export interface CombatEvent {
  kind: 'attack' | 'heal' | 'buff' | 'move' | 'defend' | 'flee' | 'down';
  actorId: string;
  targetId?: string;
  outcome?: AttackOutcome;
  amount?: number;
  animation?: string;
  /** For attacks: the dice and arithmetic behind the result, so the screen can show the working. */
  roll?: AttackRoll;
  /** The die as the dice tray shows it. */
  shown?: ShownRoll;
}

/** Everything about one attack roll that the player should be able to see. */
export interface AttackRoll {
  /** What was used, e.g. "Arming Sword" or "Aimed Shot". */
  label: string;
  /** Every d20 rolled: two with advantage or disadvantage. */
  dice: number[];
  /** The d20 that counts. */
  natural: number;
  mode: RollMode;
  /** Stat modifier added to the roll and to the damage. */
  modifier: number;
  /** Name of the stat behind the modifier. */
  stat: string;
  total: number;
  defense: number;
  /** Lowest natural roll that crits. */
  critThreshold: number;
  /** Damage dice as rolled (0 when not needed). */
  grazeRoll: number;
  hitRoll: number;
  armour: number;
  extraDamage: number;
  damage: number;
  /** True when this was a free attack for stepping out of reach. */
  free?: boolean;
  /** True for a ranged or magic attack: the screen draws a projectile for it. */
  ranged?: boolean;
}

export interface CombatState {
  featureId: string;
  width: number;
  height: number;
  ambush: boolean;
  round: number;
  combatants: Combatant[];
  /** Combatant ids in initiative order. */
  order: string[];
  /** Index into `order` of whoever is acting. */
  turn: number;
  /** Tiles of movement the active combatant still has this turn. */
  moveLeft: number;
  acted: boolean;
  outcome: 'victory' | 'defeat' | 'fled' | null;
  log: string[];
  /** What the last action did, for the screen to animate. */
  events: CombatEvent[];
  /** Goes up with every action so the screen knows when to play `events`. */
  seq: number;
  /** Working copies of the mercs: ammunition and potions are spent from these, and they are written back when the fight ends. */
  mercs: MercType[];
  /** Experience the enemies are worth. */
  xp: number;
  /** Barrels, chests, barricades and pillars dressing the battlefield. */
  obstacles: Obstacle[];
}

export interface CombatContext {
  getMonster: (id: string) => MonsterDefinition;
  getAbility: (id: string) => AbilityDefinition;
  getItem: ItemLookup;
  getDungeon: (id: string) => DungeonDefinition;
  sheetOf: (merc: MercType) => MercSheet;
  raceOf: (merc: MercType) => RaceDefinition;
}

const LOG_LIMIT = 40;

// ---------- effects for every attack ----------

const ANIMATIONS = {
  slash: 'animations/quantum/ac2q001-slash',
  blunt: 'animations/cursed-kingdoms/acck004-bludgeon',
  pierce: 'animations/cursed-kingdoms/acck002-lacerate',
  shot: 'animations/quantum/ac2q003-shot',
  magic: 'animations/thunder/asthunder-03-spark',
  spiritual: 'animations/dark/asdark-04-sting',
  unarmed: 'animations/quantum/ac2q002-blow',
  heal: 'animations/quantum/ac2q022-star-heal',
  buff: 'animations/quantum/ac2q023-star-aura',
} as const;

/** The effect an attack plays when its data names none. */
export function defaultAttackAnimation(profile: AttackProfile, style?: DamageStyle): string {
  if (profile.kind === 'magic') return ANIMATIONS.magic;
  if (profile.kind === 'spiritual') return ANIMATIONS.spiritual;
  if (profile.kind === 'ranged') return ANIMATIONS.shot;
  if (style === 'slash') return ANIMATIONS.slash;
  if (style === 'blunt') return ANIMATIONS.blunt;
  if (style === 'pierce') return ANIMATIONS.pierce;
  return ANIMATIONS.unarmed;
}

const UNARMED: CombatAttack = {
  name: 'Fists',
  range: 0,
  profile: { kind: 'melee', damageType: 'physical', graze: '1', hit: '2' },
  animation: ANIMATIONS.unarmed,
};

// ---------- obstacles ----------

export type ObstacleKind = ObstacleFeature['kind'];

export interface Obstacle {
  id: string;
  kind: ObstacleKind;
  pos: Pos;
  /** Blocks a ranged attack's line of sight through its tile. */
  blocksLoS: boolean;
  /** Blocks walking and standing on its tile. */
  blocksMove: boolean;
  /** Hit points, or null when it cannot be destroyed. */
  hp: number | null;
  maxHp: number | null;
}

/** What each obstacle kind looks and behaves like by default. */
export const OBSTACLE_PRESETS: Record<ObstacleKind, { name: string; icon?: string; emoji: string; blocksLoS: boolean; hp: number | null }> = {
  barrel: { name: 'Barrel', emoji: '🛢️', blocksLoS: false, hp: 6 },
  chest: { name: 'Chest', icon: 'loot/chest-t-01', emoji: '🧰', blocksLoS: false, hp: null },
  barricade: { name: 'Barricade', emoji: '🚧', blocksLoS: true, hp: 10 },
  pillar: { name: 'Pillar', emoji: '🗿', blocksLoS: true, hp: null },
};

export function obstacleById(c: CombatState, id: string): Obstacle | undefined {
  return c.obstacles.find((o) => o.id === id);
}

/** An obstacle standing on this tile that blocks walking, if any. */
function blockedBy(c: CombatState, p: Pos): Obstacle | undefined {
  return c.obstacles.find((o) => o.blocksMove && o.pos.x === p.x && o.pos.y === p.y);
}

/**
 * Whether a straight line between two tiles is clear of line-of-sight-blocking
 * obstacles. Walks every tile the line crosses (a supercover Bresenham), the
 * two endpoints excepted.
 */
export function hasLineOfSight(c: CombatState, from: Pos, to: Pos): boolean {
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (!(x === from.x && y === from.y) && !(x === to.x && y === to.y)) {
      if (c.obstacles.some((o) => o.blocksLoS && o.pos.x === x && o.pos.y === y)) return false;
    }
    if (x === to.x && y === to.y) return true;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// ---------- reading the fight ----------

export function combatantById(c: CombatState, id: string): Combatant {
  const found = c.combatants.find((x) => x.id === id);
  if (!found) throw new Error(`No combatant "${id}".`);
  return found;
}

export function activeCombatant(c: CombatState): Combatant {
  return combatantById(c, c.order[c.turn]!);
}

export const isStanding = (x: Combatant) => x.hp > 0;

export function standing(c: CombatState, side: Side): Combatant[] {
  return c.combatants.filter((x) => x.side === side && isStanding(x));
}

export const opposite = (side: Side): Side => (side === 'party' ? 'enemy' : 'party');

/** Tiles between two points when moving in any of eight directions. */
export const distance = (a: Pos, b: Pos) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const key = (p: Pos) => `${p.x},${p.y}`;

/** Someone standing on this tile, if anyone. Those who are down lie where they fell but do not block. */
export function occupant(c: CombatState, p: Pos): Combatant | undefined {
  return c.combatants.find((x) => isStanding(x) && x.pos.x === p.x && x.pos.y === p.y);
}

/** True when nobody and nothing can stand or pass through this tile. */
export function tileBlocked(c: CombatState, p: Pos): boolean {
  return !!occupant(c, p) || !!blockedBy(c, p);
}

/** True while a standing enemy is next to this combatant. */
export function isEngaged(c: CombatState, x: Combatant): boolean {
  return standing(c, opposite(x.side)).some((e) => distance(e.pos, x.pos) <= 1);
}

/** All the buffs' effects of one kind added up. */
function buffTotal(x: Combatant, pick: (e: ItemEffect) => number): number {
  return x.buffs.reduce((sum, b) => sum + b.effects.reduce((s, e) => s + pick(e), 0), 0);
}

export function effectiveStats(x: Combatant): Stats {
  const changes: StatChanges = {};
  for (const b of x.buffs) for (const e of b.effects) if (e.type === 'stat') changes[e.stat] = (changes[e.stat] ?? 0) + e.amount;
  return applyStatChanges(x.stats, changes);
}

export function effectiveDefense(x: Combatant): number {
  return x.baseDefense + (x.defending ? DEFEND_BONUS : 0) + buffTotal(x, (e) => (e.type === 'defense' ? e.amount : 0));
}

export function effectiveArmour(x: Combatant): Armour {
  return {
    physical: x.armour.physical + buffTotal(x, (e) => (e.type === 'armour' && e.armour === 'physical' ? e.amount : 0)),
    magic: x.armour.magic + buffTotal(x, (e) => (e.type === 'armour' && e.armour === 'magic' ? e.amount : 0)),
  };
}

/** Shots left for an attack that uses ammunition, or null when it needs none. */
export function ammoLeft(c: CombatState, x: Combatant): number | null {
  if (!x.attack.ammoId || !x.mercId) return null;
  const merc = c.mercs.find((m) => m.id === x.mercId);
  return merc?.inventory.find((s) => s.itemId === x.attack.ammoId)?.quantity ?? 0;
}

/**
 * Whether an attack with this reach can hit a target, and with what roll.
 * Melee reaches the eight tiles around the attacker. A ranged attack reaches
 * `range` tiles, with disadvantage while an enemy is next to the shooter.
 */
export function reach(c: CombatState, range: number, from: Pos, to: Pos, engaged: boolean): { ok: boolean; mode: RollMode } {
  const d = distance(from, to);
  if (range === 0) return { ok: d <= 1, mode: 'normal' };
  if (d > range || !hasLineOfSight(c, from, to)) return { ok: false, mode: 'normal' };
  return { ok: true, mode: engaged ? 'disadvantage' : 'normal' };
}

/** Targets the actor's basic attack can reach right now. */
export function attackTargets(c: CombatState, actor: Combatant): Combatant[] {
  if (ammoLeft(c, actor) === 0) return [];
  return standing(c, opposite(actor.side)).filter((t) => reach(c, actor.attack.range, actor.pos, t.pos, false).ok);
}

/** Destructible obstacles the actor's basic attack can reach right now. */
export function obstacleTargets(c: CombatState, actor: Combatant): Obstacle[] {
  if (ammoLeft(c, actor) === 0) return [];
  return c.obstacles.filter((o) => o.hp !== null && reach(c, actor.attack.range, actor.pos, o.pos, false).ok);
}

/** Targets an ability can be aimed at right now. Area-wide abilities return everyone they would affect. */
export function abilityTargets(c: CombatState, actor: Combatant, ability: AbilityDefinition): Combatant[] {
  const foes = standing(c, opposite(actor.side));
  const friends = standing(c, actor.side);
  switch (ability.target) {
    case 'self':
      return [actor];
    case 'ally':
      return friends.filter((t) => distance(actor.pos, t.pos) <= Math.max(1, ability.range));
    case 'enemy':
    case 'area':
      return foes.filter((t) => reach(c, ability.range, actor.pos, t.pos, false).ok);
    case 'allAllies':
      return friends;
    case 'allEnemies':
      return foes;
  }
}

export function canUseAbility(c: CombatState, actor: Combatant, ability: AbilityDefinition): boolean {
  return ability.activation === 'action' && (actor.cooldowns[ability.id] ?? 0) === 0 && abilityTargets(c, actor, ability).length > 0;
}

/**
 * Every tile the active combatant can reach this turn, with the path there.
 * Moves go in eight directions; standing combatants block, fallen ones do not.
 */
export function reachableTiles(c: CombatState, actor: Combatant, budget = c.moveLeft): Map<string, Pos[]> {
  const paths = new Map<string, Pos[]>([[key(actor.pos), []]]);
  let frontier: Pos[] = [actor.pos];
  for (let step = 0; step < budget; step++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const q = { x: p.x + dx, y: p.y + dy };
          if (q.x < 0 || q.y < 0 || q.x >= c.width || q.y >= c.height) continue;
          if (paths.has(key(q)) || tileBlocked(c, q)) continue;
          paths.set(key(q), [...paths.get(key(p))!, q]);
          next.push(q);
        }
      }
    }
    frontier = next;
  }
  paths.delete(key(actor.pos));
  return paths;
}

// ---------- setting up ----------

function mercAttack(merc: MercType, ctx: CombatContext): { attack: CombatAttack; critThreshold: number } {
  const weaponId = merc.equipment.mainHand;
  const weapon = weaponId ? ctx.getItem(weaponId) : null;
  if (!weapon || weapon.kind !== 'weapon') return { attack: UNARMED, critThreshold: DEFAULT_CRIT_THRESHOLD };
  const ammoItem = merc.equipment.ammo ? ctx.getItem(merc.equipment.ammo) : undefined;
  const ammo = ammoItem?.kind === 'ammo' && ammoItem.ammoType === weapon.ammo ? (ammoItem as AmmoItem) : undefined;
  const profile = weaponAttack(weapon, ammo);
  return {
    attack: {
      name: weapon.name,
      range: weapon.range,
      profile,
      weaponType: weapon.weaponType,
      animation: weapon.animation ?? defaultAttackAnimation(profile, weapon.style),
      ...(weapon.ammo ? { ammoId: merc.equipment.ammo ?? `no-${weapon.ammo}` } : {}),
    },
    critThreshold: raceCritThreshold(ctx.raceOf(merc), weapon.weaponType, profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD),
  };
}

/** Spreads `count` tokens along a row from the middle outwards, wrapping onto the next row inwards if needed. */
function lineUp(count: number, width: number, row: number, inward: 1 | -1, taken: Set<string>): Pos[] {
  const out: Pos[] = [];
  const centre = Math.floor((width - 1) / 2);
  for (let r = 0; out.length < count && r < 4; r++) {
    const y = row + r * inward;
    for (let i = 0; out.length < count && i < width; i++) {
      const offset = i % 2 === 0 ? i / 2 : -Math.ceil(i / 2);
      const p = { x: centre + offset, y };
      if (p.x < 0 || p.x >= width || taken.has(key(p))) continue;
      taken.add(key(p));
      out.push(p);
    }
  }
  return out;
}

/** Battlefield size: the room's own size within limits, or a corridor strip. */
function gridFor(def: DungeonDefinition, at: Pos): { width: number; height: number } {
  const room = def.rooms.find((r) => at.x >= r.x && at.x < r.x + r.width && at.y >= r.y && at.y < r.y + r.height);
  if (!room) return CORRIDOR_GRID;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return { width: clamp(room.width, GRID_MIN.width, GRID_MAX.width), height: clamp(room.height, GRID_MIN.height, GRID_MAX.height) };
}

/** Opens the fight for the encounter the party just walked into. */
export function startCombat(state: GameState, ctx: CombatContext): GameState {
  const { encounter, dungeon } = state;
  if (!encounter || !dungeon) throw new Error('There is no encounter to fight.');
  const def = ctx.getDungeon(dungeon.dungeonId);
  const feature = featureById(def, encounter.featureId);
  if (feature.type !== 'encounter') throw new Error(`${feature.id} is not an enemy group.`);
  const { width, height } = gridFor(def, feature);
  // Being surrounded needs room above and below.
  const ambush = !!feature.ambush && height >= 5;

  let seed = state.rngSeed;
  const roll = (agility: number) => {
    const r = rollD20(seed);
    seed = r.seed;
    return r.value.natural + statModifier(agility);
  };

  const obstacles: Obstacle[] = (feature.obstacles ?? []).map((o) => {
    const preset = OBSTACLE_PRESETS[o.kind];
    return { id: o.id, kind: o.kind, pos: { x: o.x, y: o.y }, blocksLoS: preset.blocksLoS, blocksMove: true, hp: preset.hp, maxHp: preset.hp };
  });

  const taken = new Set<string>(obstacles.map((o) => key(o.pos)));
  const living = state.party.filter((m) => !m.dead);
  const partyRow = ambush ? Math.floor(height / 2) : height - 1;
  const partySpots = lineUp(living.length, width, partyRow, -1, taken);

  const combatants: Combatant[] = [];
  living.forEach((merc, i) => {
    const sheet = ctx.sheetOf(merc);
    const race = ctx.raceOf(merc);
    const { attack, critThreshold } = mercAttack(merc, ctx);
    const potionBuffs: Buff[] = (merc.potionEffects ?? []).map((p) => {
      const item = ctx.getItem(p.itemId);
      return { source: item.name, effects: 'effects' in item ? item.effects.filter((e) => e.type !== 'heal') : [], roundsLeft: null };
    });
    combatants.push({
      id: merc.id,
      side: 'party',
      name: merc.name,
      ...(merc.portrait ? { portrait: merc.portrait } : {}),
      mercId: merc.id,
      pos: partySpots[i]!,
      movement: Math.max(1, (race.movement ?? 3) + statModifier(sheet.stats.agility)),
      hp: merc.down ? 0 : Math.max(0, sheet.maxHp - merc.wounds),
      maxHp: sheet.maxHp,
      baseDefense: sheet.defense,
      armour: sheet.armour,
      stats: sheet.stats,
      initiative: roll(sheet.stats.agility),
      defending: false,
      buffs: potionBuffs,
      cooldowns: {},
      abilityIds: sheet.gearAbilityIds,
      attack,
      critThreshold,
      deathSave: raceDeathSaveDifficulty(race),
      dead: false,
    });
  });

  const monsters = feature.monsters.flatMap((group) =>
    Array.from({ length: group.count }, (_, n) => ({ monster: ctx.getMonster(group.monsterId), n: n + 1, count: group.count })),
  );
  // Enemies start on the far edge; in an ambush they split between both edges.
  const top = monsters.filter((_, i) => !ambush || i % 2 === 0);
  const bottom = monsters.filter((_, i) => ambush && i % 2 === 1);
  const enemySpots = new Map<number, Pos>();
  lineUp(top.length, width, 0, 1, taken).forEach((p, i) => enemySpots.set(monsters.indexOf(top[i]!), p));
  lineUp(bottom.length, width, height - 1, -1, taken).forEach((p, i) => enemySpots.set(monsters.indexOf(bottom[i]!), p));

  let xp = 0;
  monsters.forEach(({ monster, n, count }, i) => {
    xp += monster.xp;
    combatants.push({
      id: `${monster.id}-${n}`,
      side: 'enemy',
      name: count > 1 ? `${monster.name} ${n}` : monster.name,
      ...(monster.portrait ? { portrait: monster.portrait } : {}),
      monsterId: monster.id,
      archetype: monster.archetype,
      pos: enemySpots.get(i)!,
      movement: monster.movement ?? DEFAULT_MONSTER_MOVEMENT,
      hp: monster.hp,
      maxHp: monster.hp,
      baseDefense: monster.defense,
      armour: monster.armour,
      stats: monster.stats,
      initiative: roll(monster.stats.agility),
      defending: false,
      buffs: [],
      cooldowns: {},
      abilityIds: monster.abilityIds,
      attack: {
        name: monster.attack.name,
        range: monster.attack.range,
        profile: monster.attack.profile,
        animation: monster.attack.animation ?? defaultAttackAnimation(monster.attack.profile),
      },
      critThreshold: monster.attack.profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD,
      deathSave: null,
      dead: false,
    });
  });

  // Highest initiative first; the party wins ties.
  const order = [...combatants]
    .sort((a, b) => b.initiative - a.initiative || (a.side === b.side ? 0 : a.side === 'party' ? -1 : 1))
    .map((x) => x.id);

  let combat: CombatState = {
    featureId: feature.id,
    width,
    height,
    ambush,
    round: 1,
    combatants,
    order,
    turn: 0,
    moveLeft: 0,
    acted: false,
    outcome: null,
    log: [ambush ? `Ambush! ${feature.name} close in from both sides.` : `${feature.name} attack!`],
    events: [],
    seq: 0,
    mercs: state.party.map((m) => structuredClone(m)),
    xp,
    obstacles,
  };
  combat = checkOutcome(skipDownedTurn(combat));
  return { ...state, rngSeed: seed, screen: 'combat', encounter: { ...encounter, combat } };
}

// ---------- the turn loop ----------

function withLog(c: CombatState, ...lines: string[]): CombatState {
  return { ...c, log: [...c.log, ...lines].slice(-LOG_LIMIT) };
}

function updateCombatant(c: CombatState, id: string, change: (x: Combatant) => Combatant): CombatState {
  return { ...c, combatants: c.combatants.map((x) => (x.id === id ? change(x) : x)) };
}

function checkOutcome(c: CombatState): CombatState {
  if (c.outcome) return c;
  if (standing(c, 'enemy').length === 0) return withLog({ ...c, outcome: 'victory' }, 'Victory!');
  if (standing(c, 'party').length === 0) return withLog({ ...c, outcome: 'defeat' }, 'The party has fallen.');
  return c;
}

/** Starts the turn of whoever is up: their Defend wears off, cooldowns tick down, movement refills. */
function beginTurn(c: CombatState): CombatState {
  const actor = activeCombatant(c);
  const cooldowns = Object.fromEntries(Object.entries(actor.cooldowns).map(([k, v]) => [k, Math.max(0, v - 1)]));
  return updateCombatant({ ...c, moveLeft: actor.movement, acted: false }, actor.id, (x) => ({ ...x, defending: false, cooldowns }));
}

/** Moves past anyone who is down, wrapping into a new round when needed. */
function skipDownedTurn(c: CombatState): CombatState {
  let next = c;
  for (let i = 0; i < next.order.length && !isStanding(activeCombatant(next)); i++) {
    next = advance(next, false);
  }
  return beginTurn(next);
}

function advance(c: CombatState, begin = true): CombatState {
  let turn = c.turn + 1;
  let round = c.round;
  let combatants = c.combatants;
  if (turn >= c.order.length) {
    turn = 0;
    round += 1;
    // Timed buffs wear off at the end of each round.
    combatants = combatants.map((x) => ({
      ...x,
      buffs: x.buffs
        .map((b) => (b.roundsLeft === null ? b : { ...b, roundsLeft: b.roundsLeft - 1 }))
        .filter((b) => b.roundsLeft === null || b.roundsLeft > 0),
    }));
  }
  const next = { ...c, turn, round, combatants };
  return begin ? beginTurn(next) : next;
}

/** Ends the active combatant's turn. */
export function endTurn(state: GameState): GameState {
  return mapCombat(state, (c) => (c.outcome ? c : skipDownedTurn(advance(c, false))));
}

function mapCombat(state: GameState, change: (c: CombatState) => CombatState): GameState {
  const combat = state.encounter?.combat;
  if (!combat || !state.encounter) return state;
  return { ...state, encounter: { ...state.encounter, combat: change(combat) } };
}

/** Ends the turn by itself once the active combatant has acted and has no movement left. */
function autoEnd(c: CombatState): CombatState {
  if (c.outcome) return c;
  const actor = activeCombatant(c);
  if (!isStanding(actor) || (c.acted && c.moveLeft === 0)) return skipDownedTurn(advance(c, false));
  return c;
}

/** Hands every roll in the last action to the dice tray. */
function withRolls(state: GameState): GameState {
  const events = state.encounter?.combat?.events ?? [];
  return announceRolls(state, events.flatMap((e) => (e.shown ? [e.shown] : [])));
}

// ---------- attacks ----------

interface Strike {
  attacker: Combatant;
  target: Combatant;
  profile: AttackProfile;
  label: string;
  mode: RollMode;
  critThreshold: number;
  animation: string;
  free?: boolean;
}

function describeOutcome(outcome: AttackOutcome): string {
  return { miss: 'misses', graze: 'grazes', hit: 'hits', crit: 'crits' }[outcome];
}

const OUTCOME_WORD: Record<AttackOutcome, string> = { miss: 'Miss', graze: 'Graze', hit: 'Hit', crit: 'Critical!' };

/** Rolls one attack and applies its damage. */
function strike(c: CombatState, seed: number, s: Strike): { combat: CombatState; seed: number } {
  const modifier = statModifier(effectiveStats(s.attacker)[ATTACK_STAT[s.profile.kind]]);
  const result = resolveAttack(seed, {
    profile: s.profile,
    modifier,
    targetDefense: effectiveDefense(s.target),
    targetArmour: effectiveArmour(s.target),
    mode: s.mode,
    critThreshold: s.critThreshold,
  });
  const r = result.value;
  const hp = Math.max(0, s.target.hp - r.damage);
  const roll = r.roll.dice.length > 1 ? `${r.roll.dice.join('/')}→${r.roll.natural}` : `${r.roll.natural}`;
  let next = updateCombatant(c, s.target.id, (x) => ({ ...x, hp }));
  next = withLog(
    next,
    `${s.attacker.name} ${describeOutcome(r.outcome)} ${s.target.name} with ${s.label}${r.damage ? ` for ${r.damage}` : ''} (${roll}${modifier >= 0 ? '+' : ''}${modifier} vs ${r.defense}${s.mode === 'disadvantage' ? ', disadvantage' : ''}).`,
  );
  const detail: AttackRoll = {
    label: s.label,
    dice: r.roll.dice,
    natural: r.roll.natural,
    mode: r.roll.mode,
    modifier,
    stat: ATTACK_STAT[s.profile.kind],
    total: r.total,
    defense: r.defense,
    critThreshold: r.critThreshold,
    grazeRoll: r.grazeRoll,
    hitRoll: r.hitRoll,
    armour: r.armour,
    extraDamage: r.extraDamage,
    damage: r.damage,
    ...(s.free ? { free: true } : {}),
    ...(s.profile.kind === 'ranged' || s.profile.kind === 'magic' ? { ranged: true } : {}),
  };
  const events: CombatEvent[] = [
    {
      kind: 'attack',
      actorId: s.attacker.id,
      targetId: s.target.id,
      outcome: r.outcome,
      amount: r.damage,
      roll: detail,
      animation: s.animation,
      shown: {
        who: s.attacker.name,
        what: `${s.free ? 'Free attack: ' : ''}${s.label} → ${s.target.name}`,
        sides: 20,
        dice: r.roll.dice,
        kept: r.roll.natural,
        total: r.total,
        target: r.defense,
        result: `${OUTCOME_WORD[r.outcome]}${r.damage ? `, ${r.damage} damage` : ''}`,
        good: s.attacker.side === 'party' ? r.outcome !== 'miss' : r.outcome === 'miss',
      },
    },
  ];
  let nextSeed = result.seed;
  if (hp === 0 && s.target.hp > 0) {
    const merc = s.target.mercId ? next.mercs.find((m) => m.id === s.target.mercId) : undefined;
    if (merc) {
      // A merc who goes down takes a lasting injury, or dies at the fourth.
      const fall = knockDown(merc, { deathSave: s.target.deathSave }, nextSeed);
      nextSeed = fall.seed;
      next = withLog({ ...next, mercs: next.mercs.map((m) => (m.id === merc.id ? fall.merc : m)) }, fall.line);
      if (fall.outcome.kind === 'dead') next = updateCombatant(next, s.target.id, (x) => ({ ...x, dead: true }));
      events.push({ kind: 'down', actorId: s.target.id, ...(fall.save ? { shown: saveRoll(merc.name, fall.save) } : {}) });
    } else {
      events.push({ kind: 'down', actorId: s.target.id });
      next = withLog(next, `${s.target.name} goes down.`);
    }
  }
  return { combat: { ...next, events: [...next.events, ...events] }, seed: nextSeed };
}

/** Rolls one attack against a destructible obstacle: it cannot dodge, so this always hits unless a natural 1 misses. */
function strikeObstacle(
  c: CombatState,
  seed: number,
  s: { attacker: Combatant; obstacle: Obstacle; profile: AttackProfile; label: string; mode: RollMode; critThreshold: number; animation: string },
): { combat: CombatState; seed: number } {
  const modifier = statModifier(effectiveStats(s.attacker)[ATTACK_STAT[s.profile.kind]]);
  const result = resolveAttack(seed, {
    profile: s.profile,
    modifier,
    targetDefense: 0,
    targetArmour: { physical: 0, magic: 0 },
    mode: s.mode,
    critThreshold: s.critThreshold,
  });
  const r = result.value;
  const name = OBSTACLE_PRESETS[s.obstacle.kind].name.toLowerCase();
  const hp = Math.max(0, (s.obstacle.hp ?? 0) - r.damage);
  const destroyed = hp === 0 && s.obstacle.hp !== null;
  const obstacles = destroyed
    ? c.obstacles.filter((o) => o.id !== s.obstacle.id)
    : c.obstacles.map((o) => (o.id === s.obstacle.id ? { ...o, hp } : o));
  let next = withLog(
    { ...c, obstacles },
    `${s.attacker.name} ${describeOutcome(r.outcome)} the ${name}${r.damage ? ` for ${r.damage}` : ''}${destroyed ? ', smashing it apart' : ''}.`,
  );
  const detail: AttackRoll = {
    label: s.label,
    dice: r.roll.dice,
    natural: r.roll.natural,
    mode: r.roll.mode,
    modifier,
    stat: ATTACK_STAT[s.profile.kind],
    total: r.total,
    defense: r.defense,
    critThreshold: r.critThreshold,
    grazeRoll: r.grazeRoll,
    hitRoll: r.hitRoll,
    armour: r.armour,
    extraDamage: r.extraDamage,
    damage: r.damage,
    ...(s.profile.kind === 'ranged' || s.profile.kind === 'magic' ? { ranged: true } : {}),
  };
  const events: CombatEvent[] = [
    {
      kind: 'attack',
      actorId: s.attacker.id,
      targetId: s.obstacle.id,
      outcome: r.outcome,
      amount: r.damage,
      roll: detail,
      animation: s.animation,
      shown: {
        who: s.attacker.name,
        what: `${s.label} → the ${name}`,
        sides: 20,
        dice: r.roll.dice,
        kept: r.roll.natural,
        total: r.total,
        target: r.defense,
        result: `${OUTCOME_WORD[r.outcome]}${r.damage ? `, ${r.damage} damage` : ''}`,
        good: r.outcome !== 'miss',
      },
    },
  ];
  next = { ...next, events: [...next.events, ...events] };
  return { combat: next, seed: result.seed };
}

function spendShot(c: CombatState, actor: Combatant): CombatState {
  if (!actor.attack.ammoId || !actor.mercId) return c;
  return {
    ...c,
    mercs: c.mercs.map((m) =>
      m.id !== actor.mercId
        ? m
        : {
            ...m,
            inventory: m.inventory
              .map((s) => (s.itemId === actor.attack.ammoId ? { ...s, quantity: s.quantity - 1 } : s))
              .filter((s) => s.quantity > 0),
          },
    ),
  };
}

function beginAction(state: GameState): { c: CombatState; actor: Combatant } {
  const c = state.encounter?.combat;
  if (!c || c.outcome) throw new Error('No fight in progress.');
  if (c.acted) throw new Error('This turn already has its action.');
  return { c: { ...c, events: [], seq: c.seq + 1 }, actor: activeCombatant(c) };
}

function finishAction(state: GameState, c: CombatState, seed: number): GameState {
  const done = autoEnd(checkOutcome({ ...c, acted: true }));
  return withRolls({ ...state, rngSeed: seed, encounter: { ...state.encounter!, combat: done } });
}

/** The active combatant attacks with their weapon, hitting an enemy or a destructible obstacle. */
export function attack(state: GameState, targetId: string): GameState {
  const { c, actor } = beginAction(state);
  const obstacle = obstacleById(c, targetId);
  if (obstacle) {
    if (!obstacleTargets(c, actor).some((o) => o.id === targetId)) throw new Error(`${actor.name} cannot reach that.`);
    const { mode: obMode } = reach(c, actor.attack.range, actor.pos, obstacle.pos, isEngaged(c, actor));
    const obHit = strikeObstacle(spendShot(c, actor), state.rngSeed, {
      attacker: actor,
      obstacle,
      profile: actor.attack.profile,
      label: actor.attack.name,
      mode: obMode,
      critThreshold: actor.critThreshold,
      animation: actor.attack.animation,
    });
    return finishAction(state, obHit.combat, obHit.seed);
  }
  const target = combatantById(c, targetId);
  if (!attackTargets(c, actor).some((t) => t.id === targetId)) throw new Error(`${actor.name} cannot reach ${target.name}.`);
  const { mode } = reach(c, actor.attack.range, actor.pos, target.pos, isEngaged(c, actor));
  const hit = strike(spendShot(c, actor), state.rngSeed, {
    attacker: actor,
    target,
    profile: actor.attack.profile,
    label: actor.attack.name,
    mode,
    critThreshold: actor.critThreshold,
    animation: actor.attack.animation,
  });
  return finishAction(state, hit.combat, hit.seed);
}

function applyBuffOrHeal(c: CombatState, actor: Combatant, target: Combatant, ability: AbilityDefinition): CombatState {
  let next = c;
  const heal = ability.effects.reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0);
  const lasting = ability.effects.filter((e) => e.type !== 'heal');
  if (heal > 0) {
    const current = combatantById(next, target.id);
    const hp = Math.min(current.maxHp, current.hp + heal);
    next = updateCombatant(next, target.id, (x) => ({ ...x, hp }));
    next = withLog(next, `${actor.name} heals ${target.name} for ${hp - current.hp}.`);
    next = { ...next, events: [...next.events, { kind: 'heal', actorId: actor.id, targetId: target.id, amount: hp - current.hp, animation: ability.animation ?? ANIMATIONS.heal }] };
  }
  if (lasting.length > 0) {
    const buff: Buff = { source: ability.name, effects: lasting, roundsLeft: ability.duration ?? 1 };
    next = updateCombatant(next, target.id, (x) => ({ ...x, buffs: [...x.buffs.filter((b) => b.source !== ability.name), buff] }));
    next = { ...next, events: [...next.events, { kind: 'buff', actorId: actor.id, targetId: target.id, animation: ability.animation ?? ANIMATIONS.buff }] };
  }
  return next;
}

/** The active combatant uses an ability. `targetId` picks the target for single-target and area abilities. */
export function castAbility(state: GameState, abilityId: string, targetId: string | null, ctx: Pick<CombatContext, 'getAbility'>): GameState {
  const { c, actor } = beginAction(state);
  const ability = ctx.getAbility(abilityId);
  if (!actor.abilityIds.includes(abilityId)) throw new Error(`${actor.name} does not have ${ability.name}.`);
  if (!canUseAbility(c, actor, ability)) throw new Error(`${ability.name} cannot be used now.`);
  const options = abilityTargets(c, actor, ability);

  let targets: Combatant[];
  if (ability.target === 'enemy' || ability.target === 'ally') {
    const chosen = options.find((t) => t.id === targetId);
    if (!chosen) throw new Error(`Choose a target for ${ability.name}.`);
    targets = [chosen];
  } else if (ability.target === 'area') {
    // The chosen enemy and every enemy next to them.
    const chosen = options.find((t) => t.id === targetId) ?? options[0]!;
    targets = standing(c, opposite(actor.side)).filter((t) => distance(t.pos, chosen.pos) <= 1);
  } else {
    targets = options;
  }

  let next = withLog(
    updateCombatant(c, actor.id, (x) => ({ ...x, cooldowns: { ...x.cooldowns, [abilityId]: ability.cooldown ?? 0 } })),
    `${actor.name} uses ${ability.name}.`,
  );
  let seed = state.rngSeed;
  const engaged = isEngaged(c, actor);
  for (const t of targets) {
    const target = combatantById(next, t.id);
    if (ability.attack) {
      const r = strike(next, seed, {
        attacker: actor,
        target,
        profile: ability.attack,
        label: ability.name,
        mode: reach(c, ability.range, actor.pos, target.pos, engaged).mode,
        critThreshold: ability.attack.critThreshold ?? DEFAULT_CRIT_THRESHOLD,
        animation: ability.animation ?? defaultAttackAnimation(ability.attack),
      });
      next = r.combat;
      seed = r.seed;
    } else {
      next = applyBuffOrHeal(next, actor, target, ability);
    }
  }
  return finishAction(state, next, seed);
}

/** The active merc drinks a potion from their pack. */
export function drinkPotion(state: GameState, itemId: string, ctx: Pick<CombatContext, 'getItem'>): GameState {
  const { c, actor } = beginAction(state);
  const merc = c.mercs.find((m) => m.id === actor.mercId);
  const stack = merc?.inventory.find((s) => s.itemId === itemId);
  const item = ctx.getItem(itemId);
  if (!merc || !stack || item.kind !== 'potion') throw new Error(`${actor.name} has no ${item.name} to drink.`);

  let next: CombatState = {
    ...c,
    mercs: c.mercs.map((m) =>
      m.id !== merc.id
        ? m
        : {
            ...m,
            inventory: m.inventory.map((s) => (s.itemId === itemId ? { ...s, quantity: s.quantity - 1 } : s)).filter((s) => s.quantity > 0),
            potionEffects:
              item.encounters && item.effects.some((e) => e.type !== 'heal')
                ? [...(m.potionEffects ?? []).filter((p) => p.itemId !== itemId), { itemId, encounters: item.encounters }]
                : (m.potionEffects ?? []),
          },
    ),
  };
  next = withLog(next, `${actor.name} drinks a ${item.name}.`);
  const heal = item.effects.reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0);
  if (heal > 0) {
    const hp = Math.min(actor.maxHp, actor.hp + heal);
    next = updateCombatant(next, actor.id, (x) => ({ ...x, hp }));
    next = withLog(next, `${actor.name} recovers ${hp - actor.hp} HP.`);
    next = { ...next, events: [{ kind: 'heal', actorId: actor.id, targetId: actor.id, amount: hp - actor.hp, animation: ANIMATIONS.heal }] };
  }
  const lasting = item.effects.filter((e) => e.type !== 'heal');
  if (lasting.length > 0) {
    next = updateCombatant(next, actor.id, (x) => ({ ...x, buffs: [...x.buffs, { source: item.name, effects: lasting, roundsLeft: null }] }));
    next = { ...next, events: [...next.events, { kind: 'buff', actorId: actor.id, targetId: actor.id, animation: ANIMATIONS.buff }] };
  }
  return finishAction(state, next, state.rngSeed);
}

/** +2 Defense until the defender's next turn. */
export function defend(state: GameState): GameState {
  const { c, actor } = beginAction(state);
  const next = withLog(updateCombatant(c, actor.id, (x) => ({ ...x, defending: true })), `${actor.name} defends.`);
  return finishAction(state, { ...next, events: [{ kind: 'defend', actorId: actor.id }] }, state.rngSeed);
}

/** The party tries to run: an Agility check by the leader. */
export function flee(state: GameState, ctx: Pick<CombatContext, 'sheetOf'>): GameState {
  const { c, actor } = beginAction(state);
  if (actor.side !== 'party') throw new Error('Only the party can flee.');
  const leader = getLeader(state) ?? state.party[0]!;
  const agility = ctx.sheetOf(leader).stats.agility;
  const rolled = makeCheck(state.rngSeed, statModifier(agility), FLEE_DIFFICULTY);
  const ok = rolled.value.success;
  const line = `${leader.name} looks for a way out (${rolled.value.total} vs ${FLEE_DIFFICULTY}): ${ok ? 'the party escapes!' : 'there is no way past.'}`;
  const shown: ShownRoll = {
    who: leader.name,
    what: 'Flee (Agility)',
    sides: 20,
    dice: rolled.value.roll.dice,
    kept: rolled.value.roll.natural,
    total: rolled.value.total,
    target: FLEE_DIFFICULTY,
    result: ok ? 'Escaped' : 'Trapped',
    good: ok,
  };
  const next = withLog({ ...c, events: [{ kind: 'flee', actorId: actor.id, shown }] }, line);
  if (ok) return withRolls({ ...state, rngSeed: rolled.seed, encounter: { ...state.encounter!, combat: { ...next, outcome: 'fled' } } });
  return finishAction(state, next, rolled.seed);
}

// ---------- movement ----------

/**
 * Moves the active combatant to a tile within its remaining movement. Each
 * enemy the mover steps away from (out of the tiles next to it) gets one free
 * melee attack; going down ends the move where it happened.
 */
export function moveTo(state: GameState, to: Pos): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome) return state;
  const actor = activeCombatant(c);
  const path = reachableTiles(c, actor).get(key(to));
  if (!path) throw new Error(`${actor.name} cannot reach that tile this turn.`);

  let next: CombatState = { ...c, events: [{ kind: 'move', actorId: actor.id }], seq: c.seq + 1 };
  let seed = state.rngSeed;
  let at = actor.pos;
  const struck = new Set<string>();
  let walked = 0;
  for (const step of path) {
    const leavingFrom = standing(next, opposite(actor.side)).filter(
      (e) => e.attack.range === 0 && !struck.has(e.id) && distance(e.pos, at) <= 1 && distance(e.pos, step) > 1,
    );
    for (const punisher of leavingFrom) {
      struck.add(punisher.id);
      next = withLog(next, `${punisher.name} strikes as ${actor.name} breaks away.`);
      const r = strike(next, seed, {
        attacker: punisher,
        target: combatantById(next, actor.id),
        profile: punisher.attack.profile,
        label: punisher.attack.name,
        mode: 'normal',
        critThreshold: punisher.critThreshold,
        animation: punisher.attack.animation,
        free: true,
      });
      next = r.combat;
      seed = r.seed;
    }
    if (!isStanding(combatantById(next, actor.id))) break;
    next = updateCombatant(next, actor.id, (x) => ({ ...x, pos: step }));
    at = step;
    walked++;
  }
  next = autoEnd(checkOutcome({ ...next, moveLeft: Math.max(0, next.moveLeft - walked) }));
  return withRolls({ ...state, rngSeed: seed, encounter: { ...state.encounter!, combat: next } });
}

// ---------- the end of the fight ----------

/** Splits the enemies' experience between the mercs still standing, with racial bonuses. */
export function shareXp(c: CombatState, ctx: Pick<CombatContext, 'raceOf'>): Record<string, number> {
  const earners = standing(c, 'party');
  if (earners.length === 0) return {};
  const share = c.xp / earners.length;
  return Object.fromEntries(
    earners.map((x) => {
      const merc = c.mercs.find((m) => m.id === x.mercId)!;
      return [x.mercId!, Math.floor(share * raceXpMultiplier(ctx.raceOf(merc)))];
    }),
  );
}

/**
 * Leaves a finished fight: writes hit points, ammunition and potions back to the
 * party and returns to the map. After a victory, anyone down gets up with 1 HP.
 */
export function finishCombat(state: GameState, ctx: CombatContext): GameState {
  const c = state.encounter?.combat;
  const dungeon = state.dungeon;
  if (!c || !c.outcome || c.outcome === 'defeat' || !dungeon || !state.encounter) return state;
  const xp = c.outcome === 'victory' ? shareXp(c, ctx) : {};

  const party = c.mercs.map((merc) => {
    const x = c.combatants.find((k) => k.mercId === merc.id);
    // Mercs who were already dead took no part.
    if (!x || merc.dead) return { ...merc, down: true };
    const down = x.hp === 0 && c.outcome !== 'victory';
    const hp = x.hp === 0 && c.outcome === 'victory' ? 1 : x.hp;
    // Lasting potions count down one encounter per fight.
    const potionEffects = (merc.potionEffects ?? [])
      .map((p) => ({ ...p, encounters: p.encounters - 1 }))
      .filter((p) => p.encounters > 0);
    return { ...merc, wounds: x.maxHp - hp, down, xp: merc.xp + (xp[merc.id] ?? 0), potionEffects };
  });

  const gained = Object.values(xp)[0];
  const line = c.outcome === 'victory' ? `Victory${gained ? `: +${gained} XP each` : ''}.` : 'You escape the fight.';
  return ensureLiveLeader({
    ...state,
    party,
    screen: 'dungeon',
    encounter: null,
    dungeon: {
      ...dungeon,
      ...(c.outcome === 'victory' ? { resolved: [...dungeon.resolved, c.featureId] } : { pos: state.encounter.returnTo, path: [] }),
      log: [...dungeon.log, line].slice(-30),
    },
  });
}

/** After a defeat: start the same fight again from the moment it began. */
export function retryCombat(state: GameState, ctx: CombatContext): GameState {
  if (!state.encounter) return state;
  const { combat: _old, ...encounter } = state.encounter;
  return startCombat({ ...state, encounter }, ctx);
}
