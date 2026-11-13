import { ATTACK_STAT, DEFAULT_CRIT_THRESHOLD, resolveAttack, type Armour, type AttackOutcome, type AttackProfile } from './attack';
import { makeCheck } from './checks';
import { rollD20, rollDice, type RollMode } from './dice';
import { featureById, groupsOf, roomAt, setGroups, type DungeonDefinition, type ObstacleFeature, type Pos } from './dungeon';
import { announceRolls, type GameState, type ShownRoll } from './gameState';
import { ensureLiveLeader, knockDown, saveRoll } from './injuries';
import { awardXp } from './levels';
import { weaponAttack, type AmmoItem, type DamageStyle, type ItemEffect, type ItemLookup } from './items';
import type { Merc as MercType, MercSheet } from './merc';
import { isSpell, type AbilityDefinition, type BonusCondition, type EnemyArchetype, type MonsterDefinition, type Resource, type StatusKind, type StatusSpec } from './monsters';
import { getLeader } from './party';
import { raceCritThreshold, raceDeathSaveDifficulty, raceXpMultiplier, type RaceDefinition, type WeaponType } from './race';
import { applyStatChanges, statModifier, type StatChanges, type StatName, type Stats } from './stats';

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
  /** The weapon's icon, for the action bar. */
  icon?: string;
  /** How the weapon deals its blows, for default sounds. */
  style?: DamageStyle;
  /** Sound of a blow landing, when the data names one. */
  sound?: string;
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
  /** Conditions such as stunned or poisoned, counted in this combatant's turns. */
  statuses: Status[];
  /** Pools for whatever this combatant's abilities spend. */
  resources: Partial<Record<Resource, ResourcePool>>;
  /** Flat damage added to weapon attacks that land (talents, gear). */
  damageBonus: number;
  /** Damage dealt back to melee attackers that land a blow. */
  retaliate: number;
  /** Wielding a weapon that needs both hands. */
  twoHanded: boolean;
  /** Strength and movement per quarter of max HP missing. */
  bloodrage: number;
  /** Turns taken off hostile conditions. */
  statusResist: number;
  /** Extra damage and mana drained by weapon hits on casters. */
  manaBurn: number;
  /** Has spells or a magic attack: a target for mage hunters. */
  caster: boolean;
  /** Walking dead, for holy magic. */
  undead: boolean;
  /** Called up by an ability: fights for its side on its own, and fades after a number of its turns. */
  summoned?: { ownerId: string; rounds: number };
}

/** Summoned allies and every enemy act on their own; only the party's mercs wait for the player. */
export function isAiControlled(x: Combatant): boolean {
  return x.side === 'enemy' || !!x.summoned;
}

export interface Status {
  kind: StatusKind;
  /** Turns of the affected combatant still to come. */
  rounds: number;
  /** Damage per turn, for poison, bleeding and burning. */
  amount?: number;
  /** Who caused it: the taunter, for taunts. */
  sourceId?: string;
}

export interface ResourcePool {
  current: number;
  max: number;
}

export interface CombatEvent {
  kind: 'attack' | 'heal' | 'buff' | 'move' | 'defend' | 'flee' | 'down' | 'status';
  actorId: string;
  targetId?: string;
  outcome?: AttackOutcome;
  amount?: number;
  animation?: string;
  /** For attacks: the dice and arithmetic behind the result, so the screen can show the working. */
  roll?: AttackRoll;
  /** The die as the dice tray shows it. */
  shown?: ShownRoll;
  /** For status events: what took hold, or what hurt. */
  label?: string;
  /** The sound to play, when the data names one; otherwise the screen picks one by kind. */
  sound?: string;
  /** For attacks: how the blow was dealt, for default sounds. */
  style?: DamageStyle;
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
  /** True when this was a free attack (for stepping out of reach, or one an ally granted). */
  free?: boolean;
  /** Flat bonus damage included in `damage` (talents and ability bonuses). */
  bonusDamage: number;
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
  /**
   * Every merc here has fallen, but others are still out exploring: the fight
   * waits, with the enemies holding the room, until someone comes to the rescue.
   */
  dormant?: boolean;
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
  slash: 'animations/wind/aswind-04-breeze',
  blunt: 'animations/earth/asearth-04-tremor',
  pierce: 'animations/earth/asearth-03-stone',
  shot: 'animations/earth/asearth-03-stone',
  magic: 'animations/thunder/asthunder-03-spark',
  spiritual: 'animations/dark/asdark-04-sting',
  unarmed: 'animations/earth/asearth-03-stone',
  heal: 'animations/light/aslight-05-sparkle',
  buff: 'animations/light/aslight-03-glare',
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
  barrel: { name: 'Barrel', icon: 'obstacles/containers/barrel', emoji: '🛢️', blocksLoS: false, hp: 6 },
  chest: { name: 'Chest', icon: 'obstacles/containers/bagsandboxes-94-t', emoji: '🧰', blocksLoS: false, hp: null },
  barricade: { name: 'Barricade', icon: 'obstacles/containers/bagsandboxes-40-t', emoji: '🚧', blocksLoS: true, hp: 10 },
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

// ---------- statuses and resources ----------

export function hasStatus(x: Combatant, kind: StatusKind): boolean {
  return x.statuses.some((st) => st.kind === kind && st.rounds > 0);
}

export function statusOf(x: Combatant, kind: StatusKind): Status | undefined {
  return x.statuses.find((st) => st.kind === kind && st.rounds > 0);
}

/** Puts a condition on a combatant, replacing the same condition if it is already there. */
function withStatus(x: Combatant, spec: StatusSpec, sourceId: string): Combatant {
  const status: Status = { kind: spec.status, rounds: spec.rounds, ...(spec.amount ? { amount: spec.amount } : {}), sourceId };
  return { ...x, statuses: [...x.statuses.filter((st) => st.kind !== spec.status), status] };
}

const withoutStatus = (x: Combatant, kind: StatusKind): Combatant => ({ ...x, statuses: x.statuses.filter((st) => st.kind !== kind) });

/** Enemies this combatant can see: the invisible are hidden from the other side. */
export function visibleFoes(c: CombatState, x: Combatant): Combatant[] {
  return standing(c, opposite(x.side)).filter((t) => !hasStatus(t, 'invisible'));
}

/** True when the target stands next to one of the attacker's allies: it is flanked. */
export function isFlanked(c: CombatState, attacker: Combatant, target: Combatant): boolean {
  return standing(c, attacker.side).some((a) => a.id !== attacker.id && distance(a.pos, target.pos) <= 1);
}

export function conditionHolds(c: CombatState, when: BonusCondition, attacker: Combatant, target: Combatant): boolean {
  switch (when) {
    case 'targetStunned':
      return hasStatus(target, 'stunned');
    case 'targetFlanked':
      return isFlanked(c, attacker, target);
    case 'targetOiled':
      return hasStatus(target, 'oiled');
    case 'targetBlinded':
      return hasStatus(target, 'blinded');
    case 'fromInvisible':
      return hasStatus(attacker, 'invisible');
    case 'targetBigger':
      return target.maxHp > attacker.maxHp;
    case 'targetCaster':
      return target.caster;
    case 'targetUndead':
      return target.undead;
  }
}

/** Adds (or with a negative amount takes) from a pool, staying within 0 and its max. */
function changeResource(x: Combatant, resource: Resource, amount: number): Combatant {
  const pool = x.resources[resource];
  if (!pool) return x;
  return { ...x, resources: { ...x.resources, [resource]: { ...pool, current: Math.max(0, Math.min(pool.max, pool.current + amount)) } } };
}

/** Adrenaline a fight starts with: enough for the cheapest openers. */
export const STARTING_ADRENALINE = 2;

/** Starting pools for the resources a merc's abilities use. */
export function startingResources(abilities: AbilityDefinition[], stats: Stats): Partial<Record<Resource, ResourcePool>> {
  const pools: Partial<Record<Resource, ResourcePool>> = {};
  for (const a of abilities) {
    const r = a.cost?.resource;
    if (!r || pools[r]) continue;
    if (r === 'mana') {
      const max = Math.max(4, 6 + 2 * statModifier(stats.intellect));
      pools.mana = { current: max, max };
    } else if (r === 'adrenaline') {
      pools.adrenaline = { current: STARTING_ADRENALINE, max: 10 };
    } else {
      pools.souls = { current: 0, max: 5 };
    }
  }
  return pools;
}

/** Combines two reasons to roll twice: advantage and disadvantage cancel out. */
function combineModes(a: RollMode, b: RollMode): RollMode {
  if (a === 'normal') return b;
  if (b === 'normal' || a === b) return a;
  return 'normal';
}

/** All the buffs' effects of one kind added up. */
function buffTotal(x: Combatant, pick: (e: ItemEffect) => number): number {
  return x.buffs.reduce((sum, b) => sum + b.effects.reduce((s, e) => s + pick(e), 0), 0);
}

/** Quarters of max HP missing, 0 to 3, for bloodrage. */
export function rageLevel(x: Combatant): number {
  if (x.bloodrage <= 0 || x.hp <= 0) return 0;
  return Math.min(3, Math.floor(((x.maxHp - x.hp) * 4) / x.maxHp));
}

export function effectiveStats(x: Combatant): Stats {
  const changes: StatChanges = { strength: x.bloodrage * rageLevel(x) };
  for (const b of x.buffs) for (const e of b.effects) if (e.type === 'stat') changes[e.stat] = (changes[e.stat] ?? 0) + e.amount;
  return applyStatChanges(x.stats, changes);
}

/** Tiles a combatant may move this turn, with movement buffs and slows. Never below 1. */
export function effectiveMovement(x: Combatant): number {
  if (hasStatus(x, 'rooted')) return 0;
  return Math.max(1, x.movement + x.bloodrage * rageLevel(x) + buffTotal(x, (e) => (e.type === 'movement' ? e.amount : 0)));
}

/** Flat damage on a weapon blow: from gear and talents, plus any weapon enchantment buffs. */
export function weaponDamageBonus(x: Combatant): number {
  return x.damageBonus + buffTotal(x, (e) => (e.type === 'damage' ? e.amount : 0));
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
  return visibleFoes(c, actor).filter((t) => reach(c, actor.attack.range, actor.pos, t.pos, false).ok);
}

/** Destructible obstacles the actor's basic attack can reach right now. */
export function obstacleTargets(c: CombatState, actor: Combatant): Obstacle[] {
  if (ammoLeft(c, actor) === 0) return [];
  return c.obstacles.filter((o) => o.hp !== null && reach(c, actor.attack.range, actor.pos, o.pos, false).ok);
}

/** Targets an ability can be aimed at right now. Area-wide abilities return everyone they would affect. */
/** The reach of an ability: a weapon ability reaches as far as the weapon. */
export function abilityRange(actor: Combatant, ability: AbilityDefinition): number {
  return ability.weaponAttack ? actor.attack.range : ability.range;
}

export function abilityTargets(c: CombatState, actor: Combatant, ability: AbilityDefinition): Combatant[] {
  const foes = visibleFoes(c, actor);
  const friends = standing(c, actor.side);
  const range = abilityRange(actor, ability);
  const within = (t: Combatant) => range === 0 || distance(actor.pos, t.pos) <= range;
  const allyReach = (t: Combatant) => distance(actor.pos, t.pos) <= Math.max(1, range);
  const foeReach = (t: Combatant) => reach(c, range, actor.pos, t.pos, false).ok;
  // Granting an attack only helps an ally who has an enemy next to them.
  const engagedFriend = (t: Combatant) => !ability.grantAttack || visibleFoes(c, t).some((e) => distance(e.pos, t.pos) <= 1);
  if (ability.revive) {
    return c.combatants.filter((t) => t.side === actor.side && t.hp === 0 && !t.dead && !t.summoned && allyReach(t));
  }
  switch (ability.target) {
    case 'self':
      return [actor];
    case 'ally':
      return friends.filter((t) => allyReach(t) && engagedFriend(t) && (!ability.grantAttack || t.id !== actor.id));
    case 'enemy':
    case 'area':
      return foes.filter(foeReach);
    case 'any':
      return [...foes.filter(foeReach), ...friends.filter(allyReach)];
    case 'allAllies':
      return friends.filter((t) => within(t) && engagedFriend(t) && (!ability.grantAttack || t.id !== actor.id));
    case 'allEnemies':
      // A weapon sweep hits everyone the weapon reaches; otherwise everyone within the range.
      return foes.filter(ability.weaponAttack ? foeReach : within);
  }
}

/** Why the actor cannot use an ability right now, or null when it can. */
export function abilityBlocker(c: CombatState, actor: Combatant, ability: AbilityDefinition): string | null {
  if (ability.activation !== 'action') return 'Passive';
  if (hasStatus(actor, 'silenced')) return 'Silenced';
  const cooldown = actor.cooldowns[ability.id] ?? 0;
  if (cooldown > 0) return `Ready in ${cooldown} turn${cooldown === 1 ? '' : 's'}`;
  if (ability.cost) {
    const pool = actor.resources[ability.cost.resource];
    if (pool && pool.current < ability.cost.amount) return `Needs ${ability.cost.amount} ${ability.cost.resource}`;
    if (!pool && actor.side === 'party') return `Needs ${ability.cost.resource}`;
  }
  if (ability.requiresTwoHanded && !actor.twoHanded) return 'Needs a two-handed weapon';
  if (ability.weaponAttack && ammoLeft(c, actor) === 0) return 'Out of ammunition';
  if (abilityTargets(c, actor, ability).length === 0) return 'No target in reach';
  return null;
}

export function canUseAbility(c: CombatState, actor: Combatant, ability: AbilityDefinition): boolean {
  return abilityBlocker(c, actor, ability) === null;
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

function mercAttack(merc: MercType, ctx: CombatContext): { attack: CombatAttack; critThreshold: number; twoHanded: boolean } {
  const weaponId = merc.equipment.mainHand;
  const weapon = weaponId ? ctx.getItem(weaponId) : null;
  if (!weapon || weapon.kind !== 'weapon') return { attack: UNARMED, critThreshold: DEFAULT_CRIT_THRESHOLD, twoHanded: false };
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
      ...(weapon.icon ? { icon: weapon.icon } : {}),
      style: weapon.style,
      ...(weapon.sound ? { sound: weapon.sound } : {}),
      ...(weapon.ammo ? { ammoId: merc.equipment.ammo ?? `no-${weapon.ammo}` } : {}),
    },
    critThreshold: raceCritThreshold(ctx.raceOf(merc), weapon.weaponType, profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD),
    twoHanded: weapon.hands === 2,
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

/** A merc as a combatant: their sheet with gear and talents, potions still working, and resource pools. */
function mercCombatant(merc: MercType, pos: Pos, roll: (agility: number) => number, ctx: CombatContext): Combatant {
  const sheet = ctx.sheetOf(merc);
  const race = ctx.raceOf(merc);
  const { attack, critThreshold, twoHanded } = mercAttack(merc, ctx);
  const abilities = sheet.abilityIds.map((id) => ctx.getAbility(id));
  const potionBuffs: Buff[] = (merc.potionEffects ?? []).map((p) => {
    const item = ctx.getItem(p.itemId);
    return { source: item.name, effects: 'effects' in item ? item.effects.filter((e) => e.type !== 'heal') : [], roundsLeft: null };
  });
  return {
    id: merc.id,
    side: 'party',
    name: merc.name,
    ...(merc.portrait ? { portrait: merc.portrait } : {}),
    mercId: merc.id,
    pos,
    movement: Math.max(1, (race.movement ?? 3) + statModifier(sheet.stats.agility) + sheet.movementBonus),
    hp: merc.down ? 0 : Math.max(0, sheet.maxHp - merc.wounds),
    maxHp: sheet.maxHp,
    baseDefense: sheet.defense,
    armour: sheet.armour,
    stats: sheet.stats,
    initiative: roll(sheet.stats.agility),
    defending: false,
    buffs: potionBuffs,
    cooldowns: {},
    abilityIds: sheet.abilityIds,
    attack,
    critThreshold: Math.max(2, critThreshold - sheet.critRange),
    deathSave: raceDeathSaveDifficulty(race),
    dead: false,
    statuses: [],
    resources: startingResources(abilities, sheet.stats),
    damageBonus: sheet.damageBonus + (twoHanded ? sheet.twoHandedDamageBonus : 0),
    retaliate: sheet.retaliate,
    twoHanded,
    bloodrage: sheet.bloodrage,
    statusResist: sheet.statusResist,
    manaBurn: sheet.manaBurn,
    caster: abilities.some(isSpell) || attack.profile.kind === 'magic' || attack.profile.kind === 'spiritual',
    undead: false,
  };
}

/** A monster as a combatant, on either side (summons fight for the party). */
function monsterCombatant(
  monster: MonsterDefinition,
  id: string,
  name: string,
  side: Side,
  pos: Pos,
  initiative: number,
  ctx: Pick<CombatContext, 'getAbility'>,
): Combatant {
  return {
    id,
    side,
    name,
    ...(monster.portrait ? { portrait: monster.portrait } : {}),
    monsterId: monster.id,
    archetype: monster.archetype,
    pos,
    movement: monster.movement ?? DEFAULT_MONSTER_MOVEMENT,
    hp: monster.hp,
    maxHp: monster.hp,
    baseDefense: monster.defense,
    armour: monster.armour,
    stats: monster.stats,
    initiative,
    defending: false,
    buffs: [],
    cooldowns: {},
    abilityIds: monster.abilityIds,
    attack: {
      name: monster.attack.name,
      range: monster.attack.range,
      profile: monster.attack.profile,
      animation: monster.attack.animation ?? defaultAttackAnimation(monster.attack.profile),
      ...(monster.attack.sound ? { sound: monster.attack.sound } : {}),
    },
    critThreshold: monster.attack.profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD,
    deathSave: null,
    dead: false,
    statuses: [],
    resources: monster.mana ? { mana: { current: monster.mana, max: monster.mana } } : {},
    damageBonus: 0,
    retaliate: 0,
    twoHanded: false,
    bloodrage: 0,
    statusResist: 0,
    manaBurn: 0,
    caster:
      monster.abilityIds.some((a) => isSpell(ctx.getAbility(a))) || monster.attack.profile.kind === 'magic' || monster.attack.profile.kind === 'spiritual',
    undead: !!monster.undead,
  };
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
  // Only the mercs in this fight: with the party split, the rest are elsewhere.
  const living = state.party.filter((m) => !m.dead && (!encounter.mercIds || encounter.mercIds.includes(m.id)));
  const partyRow = ambush ? Math.floor(height / 2) : height - 1;
  const partySpots = lineUp(living.length, width, partyRow, -1, taken);

  const combatants: Combatant[] = living.map((merc, i) => mercCombatant(merc, partySpots[i]!, roll, ctx));

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
    combatants.push(
      monsterCombatant(monster, `${monster.id}-${n}`, count > 1 ? `${monster.name} ${n}` : monster.name, 'enemy', enemySpots.get(i)!, roll(monster.stats.agility), ctx),
    );
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
    mercs: living.map((m) => structuredClone(m)),
    xp,
    obstacles,
  };
  const first = skipDownedTurn(combat, seed);
  combat = checkOutcome(first.combat);
  return { ...state, rngSeed: first.seed, screen: 'combat', encounter: { ...encounter, combat } };
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
  if (standing(c, 'party').filter((x) => x.mercId).length === 0) {
    if (c.dormant) return c;
    return withLog({ ...c, outcome: 'defeat' }, 'The party has fallen.');
  }
  return c;
}

const DOT_WORDS: Partial<Record<StatusKind, string>> = { poisoned: 'poison', bleeding: 'bleeding', burning: 'flames' };

/**
 * Starts the turn of whoever is up: their Defend wears off, cooldowns tick down,
 * movement refills and mana trickles back. Poison, bleeding and burning bite.
 */
function beginTurn(c: CombatState, seed: number): { combat: CombatState; seed: number } {
  const actor = activeCombatant(c);
  const cooldowns = Object.fromEntries(Object.entries(actor.cooldowns).map(([k, v]) => [k, Math.max(0, v - 1)]));
  // Getting back up from the floor takes the whole move.
  const moveLeft = hasStatus(actor, 'prone') ? 0 : effectiveMovement(actor);
  let next = updateCombatant({ ...c, moveLeft, acted: false }, actor.id, (x) =>
    changeResource({ ...x, defending: false, cooldowns }, 'mana', 1),
  );
  // Regeneration heals before anything else bites.
  const regen = statusOf(actor, 'regenerating');
  if (regen?.amount && isStanding(actor)) {
    const me = combatantById(next, actor.id);
    const hp = Math.min(me.maxHp, me.hp + regen.amount);
    if (hp > me.hp) {
      next = updateCombatant(next, actor.id, (x) => ({ ...x, hp }));
      next = withLog(next, `${actor.name} regenerates ${hp - me.hp} HP.`);
      next = { ...next, events: [...next.events, { kind: 'heal', actorId: actor.id, targetId: actor.id, amount: hp - me.hp, animation: ANIMATIONS.heal }] };
    }
  }
  for (const st of actor.statuses) {
    const word = DOT_WORDS[st.kind];
    const me = combatantById(next, actor.id);
    if (!word || !st.amount || st.rounds <= 0 || !isStanding(me)) continue;
    next = withLog(next, `${actor.name} takes ${st.amount} damage from ${word}.`);
    next = { ...next, events: [...next.events, { kind: 'status', actorId: actor.id, targetId: actor.id, amount: st.amount, label: word }] };
    const hurt = applyDamage(next, seed, actor.id, st.amount);
    next = hurt.combat;
    seed = hurt.seed;
  }
  return { combat: next, seed };
}

/**
 * Moves on to the next combatant who can act, wrapping into new rounds: anyone
 * down is skipped, and so is anyone stunned (losing that turn).
 */
function skipDownedTurn(c: CombatState, seed: number): { combat: CombatState; seed: number } {
  let next = c;
  for (let guard = 0; guard < next.order.length * 3 + 3; guard++) {
    if (next.outcome) break;
    if (!isStanding(activeCombatant(next))) {
      next = advance(next);
      continue;
    }
    const begun = beginTurn(next, seed);
    next = checkOutcome(begun.combat);
    seed = begun.seed;
    const actor = activeCombatant(next);
    if (next.outcome) break;
    if (!isStanding(actor)) {
      next = advance(next);
      continue;
    }
    if (hasStatus(actor, 'stunned') || hasStatus(actor, 'frozen')) {
      next = withLog(next, `${actor.name} is ${hasStatus(actor, 'frozen') ? 'frozen solid' : 'stunned'} and loses the turn.`);
      next = advance(next);
      continue;
    }
    break;
  }
  return { combat: next, seed };
}

/** Passes the turn on. The combatant whose turn ends counts down their conditions. */
function advance(c: CombatState): CombatState {
  const ending = c.order[c.turn];
  if (ending) {
    c = updateCombatant(c, ending, (x) => ({
      ...x,
      statuses: x.statuses.map((st) => ({ ...st, rounds: st.rounds - 1 })).filter((st) => st.rounds > 0),
      ...(x.summoned && x.hp > 0 ? { summoned: { ...x.summoned, rounds: x.summoned.rounds - 1 } } : {}),
    }));
    const done = combatantById(c, ending);
    if (done.summoned && done.summoned.rounds <= 0 && done.hp > 0) {
      c = withLog(updateCombatant(c, ending, (x) => ({ ...x, hp: 0 })), `${done.name} fades away.`);
    }
  }
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
  return { ...c, turn, round, combatants };
}

/** Ends the active combatant's turn. */
export function endTurn(state: GameState): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome || !state.encounter) return state;
  const next = skipDownedTurn({ ...advance(c), events: [], seq: c.seq + 1 }, state.rngSeed);
  return withRolls({ ...state, rngSeed: next.seed, encounter: { ...state.encounter, combat: checkOutcome(next.combat) } });
}

/** Ends the turn by itself once the active combatant has acted and has no movement left. */
function autoEnd(c: CombatState, seed: number): { combat: CombatState; seed: number } {
  if (c.outcome) return { combat: c, seed };
  const actor = activeCombatant(c);
  if (!isStanding(actor) || (c.acted && c.moveLeft === 0)) return skipDownedTurn(advance(c), seed);
  return { combat: c, seed };
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
  /** Flat damage added on a graze, hit or crit. */
  bonusDamage?: number;
  /** The stat behind the roll, when not the usual one for the attack's kind. */
  stat?: StatName;
  sound?: string;
  style?: DamageStyle;
  /** A weapon blow: mana burn applies. */
  weapon?: boolean;
}

function describeOutcome(outcome: AttackOutcome): string {
  return { miss: 'misses', graze: 'grazes', hit: 'hits', crit: 'crits' }[outcome];
}

const OUTCOME_WORD: Record<AttackOutcome, string> = { miss: 'Miss', graze: 'Graze', hit: 'Hit', crit: 'Critical!' };

/**
 * Takes hit points off a combatant. A merc who goes down takes a lasting
 * injury (or dies at the fourth); anyone with souls to gather gathers one
 * when an enemy of theirs falls.
 */
function applyDamage(c: CombatState, seed: number, targetId: string, amount: number): { combat: CombatState; seed: number } {
  const target = combatantById(c, targetId);
  if (amount <= 0 || !isStanding(target)) return { combat: c, seed };
  let next = c;
  // A ward soaks the blow first.
  const ward = statusOf(target, 'warded');
  if (ward?.amount) {
    const soaked = Math.min(ward.amount, amount);
    amount -= soaked;
    const left = ward.amount - soaked;
    next = updateCombatant(next, targetId, (x) => ({
      ...x,
      statuses: left > 0 ? x.statuses.map((st) => (st.kind === 'warded' ? { ...st, amount: left } : st)) : x.statuses.filter((st) => st.kind !== 'warded'),
    }));
    next = withLog(next, left > 0 ? `${target.name}'s ward soaks ${soaked}.` : `${target.name}'s ward soaks ${soaked} and breaks.`);
    if (amount <= 0) return { combat: next, seed };
  }
  // A blow shatters the ice.
  if (hasStatus(target, 'frozen')) next = withLog(updateCombatant(next, targetId, (x) => withoutStatus(x, 'frozen')), `${target.name} shatters free of the ice.`);
  const hp = Math.max(0, target.hp - amount);
  next = updateCombatant(next, targetId, (x) => changeResource({ ...x, hp }, 'adrenaline', 1));
  let nextSeed = seed;
  if (hp > 0) return { combat: next, seed: nextSeed };

  const merc = target.mercId ? next.mercs.find((m) => m.id === target.mercId) : undefined;
  if (merc) {
    const fall = knockDown(merc, { deathSave: target.deathSave }, nextSeed);
    nextSeed = fall.seed;
    next = withLog({ ...next, mercs: next.mercs.map((m) => (m.id === merc.id ? fall.merc : m)) }, fall.line);
    if (fall.outcome.kind === 'dead') next = updateCombatant(next, targetId, (x) => ({ ...x, dead: true }));
    next = { ...next, events: [...next.events, { kind: 'down', actorId: targetId, ...(fall.save ? { shown: saveRoll(merc.name, fall.save) } : {}) }] };
  } else {
    next = withLog({ ...next, events: [...next.events, { kind: 'down', actorId: targetId }] }, `${target.name} goes down.`);
  }
  // The other side feeds on the fall.
  next = {
    ...next,
    combatants: next.combatants.map((x) => (x.side !== target.side && isStanding(x) ? changeResource(x, 'souls', 1) : x)),
  };
  return { combat: next, seed: nextSeed };
}

/** Rolls one attack and applies its damage. A blinded attacker rolls with disadvantage. */
function strike(c: CombatState, seed: number, s: Strike): { combat: CombatState; seed: number; outcome: AttackOutcome } {
  const attacker = combatantById(c, s.attacker.id);
  // Blinded attackers roll with disadvantage; a melee blow on someone lying on the floor has advantage.
  const mode = combineModes(
    combineModes(s.mode, hasStatus(attacker, 'blinded') ? 'disadvantage' : 'normal'),
    s.profile.kind === 'melee' && hasStatus(combatantById(c, s.target.id), 'prone') ? 'advantage' : 'normal',
  );
  const stat = s.stat ?? ATTACK_STAT[s.profile.kind];
  const modifier = statModifier(effectiveStats(attacker)[stat]);
  // Mage hunters hit casters harder with their weapons.
  const burn = s.weapon && s.target.caster ? attacker.manaBurn : 0;
  const result = resolveAttack(seed, {
    profile: s.profile,
    modifier,
    targetDefense: effectiveDefense(s.target),
    targetArmour: effectiveArmour(s.target),
    mode,
    critThreshold: s.critThreshold,
    bonusDamage: (s.bonusDamage ?? 0) + burn,
  });
  const r = result.value;
  const roll = r.roll.dice.length > 1 ? `${r.roll.dice.join('/')}→${r.roll.natural}` : `${r.roll.natural}`;
  let next = withLog(
    c,
    `${attacker.name} ${describeOutcome(r.outcome)} ${s.target.name} with ${s.label}${r.damage ? ` for ${r.damage}` : ''} (${roll}${modifier >= 0 ? '+' : ''}${modifier} vs ${r.defense}${mode === 'disadvantage' ? ', disadvantage' : mode === 'advantage' ? ', advantage' : ''}).`,
  );
  const detail: AttackRoll = {
    label: s.label,
    dice: r.roll.dice,
    natural: r.roll.natural,
    mode: r.roll.mode,
    modifier,
    stat,
    total: r.total,
    defense: r.defense,
    critThreshold: r.critThreshold,
    grazeRoll: r.grazeRoll,
    hitRoll: r.hitRoll,
    armour: r.armour,
    extraDamage: r.extraDamage,
    damage: r.damage,
    bonusDamage: r.bonusDamage,
    ...(s.free ? { free: true } : {}),
    ...(s.profile.kind === 'ranged' || s.profile.kind === 'magic' ? { ranged: true } : {}),
  };
  next = {
    ...next,
    events: [
      ...next.events,
      {
        kind: 'attack',
        actorId: attacker.id,
        targetId: s.target.id,
        outcome: r.outcome,
        amount: r.damage,
        roll: detail,
        animation: s.animation,
        ...(s.sound ? { sound: s.sound } : {}),
        ...(s.style ? { style: s.style } : {}),
        shown: {
          who: attacker.name,
          what: `${s.free ? 'Free attack: ' : ''}${s.label} → ${s.target.name}`,
          sides: 20,
          dice: r.roll.dice,
          kept: r.roll.natural,
          total: r.total,
          target: r.defense,
          result: `${OUTCOME_WORD[r.outcome]}${r.damage ? `, ${r.damage} damage` : ''}`,
          good: attacker.side === 'party' ? r.outcome !== 'miss' : r.outcome === 'miss',
        },
      },
    ],
  };
  let nextSeed = result.seed;
  // Landing a blow gets the blood up.
  if (r.damage > 0) next = updateCombatant(next, attacker.id, (x) => changeResource(x, 'adrenaline', 1));
  if (burn > 0 && r.outcome !== 'miss' && s.target.resources.mana) {
    next = updateCombatant(next, s.target.id, (x) => changeResource(x, 'mana', -burn));
    next = withLog(next, `${attacker.name} burns away ${burn} of ${s.target.name}'s mana.`);
  }
  const hurt = applyDamage(next, nextSeed, s.target.id, r.damage);
  next = hurt.combat;
  nextSeed = hurt.seed;

  // Hitting a guardian in melee hurts back.
  const target = combatantById(next, s.target.id);
  const thorns = target.retaliate + buffTotal(target, (e) => (e.type === 'retaliate' ? e.amount : 0));
  if (thorns > 0 && s.profile.kind === 'melee' && r.outcome !== 'miss' && isStanding(target)) {
    next = withLog(next, `${target.name} punishes ${attacker.name} for ${thorns}.`);
    next = { ...next, events: [...next.events, { kind: 'status', actorId: target.id, targetId: attacker.id, amount: thorns, label: 'retaliation' }] };
    const back = applyDamage(next, nextSeed, attacker.id, thorns);
    next = back.combat;
    nextSeed = back.seed;
  }
  return { combat: next, seed: nextSeed, outcome: r.outcome };
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
    bonusDamage: r.bonusDamage,
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
  const done = autoEnd(checkOutcome({ ...c, acted: true }), seed);
  return withRolls({ ...state, rngSeed: done.seed, encounter: { ...state.encounter!, combat: checkOutcome(done.combat) } });
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
  // Striking from hiding comes with advantage, and gives the attacker away.
  const hidden = hasStatus(actor, 'invisible');
  const hit = strike(spendShot(c, actor), state.rngSeed, {
    attacker: actor,
    target,
    profile: actor.attack.profile,
    label: actor.attack.name,
    mode: combineModes(mode, hidden ? 'advantage' : 'normal'),
    critThreshold: actor.critThreshold,
    animation: actor.attack.animation,
    bonusDamage: weaponDamageBonus(actor),
    weapon: true,
    ...(actor.attack.sound ? { sound: actor.attack.sound } : {}),
    ...(actor.attack.style ? { style: actor.attack.style } : {}),
  });
  return finishAction(state, reveal(hit.combat, actor.id), hit.seed);
}

/** Attacking ends invisibility. */
function reveal(c: CombatState, id: string): CombatState {
  const x = combatantById(c, id);
  if (!hasStatus(x, 'invisible')) return c;
  return withLog(updateCombatant(c, id, (k) => withoutStatus(k, 'invisible')), `${x.name} steps out of the shadows.`);
}

/** Puts an ability's conditions on a target. Those with an `if` take hold only when it held before the blow. */
function applyStatuses(c: CombatState, actor: Combatant, target: Combatant, specs: StatusSpec[], before: CombatState): CombatState {
  let next = c;
  for (const spec of specs) {
    if (spec.if && !conditionHolds(before, spec.if, actor, combatantById(before, target.id))) continue;
    const victim = combatantById(next, target.id);
    if (!isStanding(victim)) continue;
    // Hard heads shrug off hostile conditions sooner, or entirely.
    const rounds = victim.side !== actor.side ? spec.rounds - victim.statusResist : spec.rounds;
    if (rounds <= 0) {
      next = withLog(next, `${target.name} shrugs off being ${spec.status}.`);
      continue;
    }
    next = updateCombatant(next, target.id, (x) => withStatus(x, { ...spec, rounds }, actor.id));
    next = withLog(next, `${target.name} is ${spec.status}.`);
    next = { ...next, events: [...next.events, { kind: 'status', actorId: actor.id, targetId: target.id, label: spec.status }] };
  }
  return next;
}

/**
 * Calls up a monster on the summoner's side, on the nearest free tile next to
 * them. It acts straight after the summoner each round and fades after its turns run out.
 */
function summonMonster(
  c: CombatState,
  summoner: Combatant,
  spec: { monsterId: string; rounds: number },
  ctx: Pick<CombatContext, 'getAbility' | 'getMonster'>,
): CombatState {
  const spot = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ]
    .map(([dx, dy]) => ({ x: summoner.pos.x + dx!, y: summoner.pos.y + dy! }))
    .find((p) => p.x >= 0 && p.y >= 0 && p.x < c.width && p.y < c.height && !tileBlocked(c, p));
  const monster = ctx.getMonster(spec.monsterId);
  if (!spot) return withLog(c, `There is no room for the ${monster.name.toLowerCase()} to appear.`);
  const n = c.combatants.filter((x) => x.summoned).length + 1;
  const summon: Combatant = {
    ...monsterCombatant(monster, `summon-${n}`, monster.name, summoner.side, spot, summoner.initiative, ctx),
    summoned: { ownerId: summoner.id, rounds: spec.rounds },
  };
  // It joins the turn order right behind whoever called it.
  const at = c.order.indexOf(summoner.id);
  const order = [...c.order.slice(0, at + 1), summon.id, ...c.order.slice(at + 1)];
  const turn = at < c.turn ? c.turn + 1 : c.turn;
  return withLog(
    { ...c, combatants: [...c.combatants, summon], order, turn, events: [...c.events, { kind: 'buff', actorId: summoner.id, targetId: summon.id, animation: ANIMATIONS.buff }] },
    `${summoner.name} calls up a ${monster.name.toLowerCase()}!`,
  );
}

/** Damage for slamming into a wall, an obstacle or someone else when knocked back. */
export const COLLISION_DAMAGE = '1d6';

/**
 * Shoves the target straight away from the attacker, one tile at a time, up to
 * `tiles`. Stopping short against the edge, an obstacle or another combatant
 * hurts: the target takes collision damage (and so does anyone it slams into).
 */
function knockBack(c: CombatState, seed: number, attacker: Combatant, target: Combatant, tiles: number): { combat: CombatState; seed: number } {
  const dx = Math.sign(target.pos.x - attacker.pos.x);
  const dy = Math.sign(target.pos.y - attacker.pos.y);
  if (!dx && !dy) return { combat: c, seed };
  let pos = target.pos;
  let moved = 0;
  let blocker: Combatant | undefined;
  for (; moved < tiles; moved++) {
    const step = { x: pos.x + dx, y: pos.y + dy };
    const offGrid = step.x < 0 || step.y < 0 || step.x >= c.width || step.y >= c.height;
    if (offGrid || tileBlocked(c, step)) {
      blocker = offGrid ? undefined : occupant(c, step);
      break;
    }
    pos = step;
  }
  let next = updateCombatant(c, target.id, (x) => ({ ...x, pos }));
  next = { ...next, events: [...next.events, { kind: 'move', actorId: target.id }] };
  next = withLog(next, moved > 0 ? `${target.name} is hurled ${moved} tile${moved === 1 ? '' : 's'}.` : `${target.name} is slammed in place.`);
  if (moved === tiles) return { combat: next, seed };
  // Stopped short: something solid was in the way.
  const rolled = rollDice(seed, COLLISION_DAMAGE);
  let nextSeed = rolled.seed;
  next = withLog(next, `${target.name} crashes into ${blocker ? blocker.name : 'something solid'} for ${rolled.value}.`);
  next = { ...next, events: [...next.events, { kind: 'status', actorId: attacker.id, targetId: target.id, amount: rolled.value, label: 'collision' }] };
  const hurt = applyDamage(next, nextSeed, target.id, rolled.value);
  next = hurt.combat;
  nextSeed = hurt.seed;
  if (blocker) {
    const second = rollDice(nextSeed, COLLISION_DAMAGE);
    nextSeed = second.seed;
    next = { ...next, events: [...next.events, { kind: 'status', actorId: attacker.id, targetId: blocker.id, amount: second.value, label: 'collision' }] };
    const knocked = applyDamage(next, nextSeed, blocker.id, second.value);
    next = knocked.combat;
    nextSeed = knocked.seed;
  }
  return { combat: next, seed: nextSeed };
}

/** An ally makes a free weapon attack on the weakest enemy next to them, without using their own turn. */
function grantedAttack(c: CombatState, seed: number, ally: Combatant): { combat: CombatState; seed: number } {
  const foe = [...visibleFoes(c, ally)].filter((e) => distance(e.pos, ally.pos) <= 1).sort((a, b) => a.hp - b.hp)[0];
  if (!foe || ammoLeft(c, ally) === 0) return { combat: c, seed };
  const r = strike(spendShot(c, ally), seed, {
    attacker: ally,
    target: foe,
    profile: ally.attack.profile,
    label: ally.attack.name,
    mode: reach(c, ally.attack.range, ally.pos, foe.pos, true).mode,
    critThreshold: ally.critThreshold,
    animation: ally.attack.animation,
    bonusDamage: weaponDamageBonus(ally),
    weapon: true,
    ...(ally.attack.sound ? { sound: ally.attack.sound } : {}),
    ...(ally.attack.style ? { style: ally.attack.style } : {}),
    free: true,
  });
  return { combat: r.combat, seed: r.seed };
}

function applyBuffOrHeal(c: CombatState, actor: Combatant, target: Combatant, ability: AbilityDefinition, healToo = true): CombatState {
  let next = c;
  const heal = healToo ? ability.effects.reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0) : 0;
  const lasting = ability.effects.filter((e) => e.type !== 'heal');
  if (heal > 0) {
    const current = combatantById(next, target.id);
    const hp = Math.min(current.maxHp, current.hp + heal);
    next = updateCombatant(next, target.id, (x) => ({ ...x, hp }));
    next = withLog(next, `${actor.name} heals ${target.name} for ${hp - current.hp}.`);
    next = {
      ...next,
      events: [
        ...next.events,
        { kind: 'heal', actorId: actor.id, targetId: target.id, amount: hp - current.hp, animation: ability.animation ?? ANIMATIONS.heal, ...(ability.sound ? { sound: ability.sound } : {}) },
      ],
    };
  }
  if (lasting.length > 0) {
    const buff: Buff = { source: ability.name, effects: lasting, roundsLeft: ability.duration ?? 1 };
    next = updateCombatant(next, target.id, (x) => ({ ...x, buffs: [...x.buffs.filter((b) => b.source !== ability.name), buff] }));
    next = {
      ...next,
      events: [
        ...next.events,
        { kind: 'buff', actorId: actor.id, targetId: target.id, animation: ability.animation ?? ANIMATIONS.buff, ...(ability.sound ? { sound: ability.sound } : {}) },
      ],
    };
  }
  return next;
}

/**
 * The active combatant uses an ability. `targetId` picks the target for
 * single-target and area abilities. Attack abilities roll against each target;
 * their effects and conditions land on a hit. Other abilities apply at once.
 */
export function castAbility(
  state: GameState,
  abilityId: string,
  targetId: string | null,
  ctx: Pick<CombatContext, 'getAbility'> & Partial<Pick<CombatContext, 'getMonster'>>,
): GameState {
  const { c, actor } = beginAction(state);
  const ability = ctx.getAbility(abilityId);
  if (!actor.abilityIds.includes(abilityId)) throw new Error(`${actor.name} does not have ${ability.name}.`);
  const blocker = abilityBlocker(c, actor, ability);
  if (blocker) throw new Error(`${ability.name} cannot be used now: ${blocker.toLowerCase()}.`);
  const options = abilityTargets(c, actor, ability);

  let targets: Combatant[];
  if (ability.target === 'enemy' || ability.target === 'ally' || ability.target === 'any') {
    const chosen = options.find((t) => t.id === targetId);
    if (!chosen) throw new Error(`Choose a target for ${ability.name}.`);
    targets = [chosen];
  } else if (ability.target === 'area') {
    // The chosen enemy and every enemy next to them.
    const chosen = options.find((t) => t.id === targetId) ?? options[0]!;
    targets = visibleFoes(c, actor).filter((t) => distance(t.pos, chosen.pos) <= 1);
  } else {
    targets = options;
  }

  let next = updateCombatant(c, actor.id, (x) => {
    const paid = ability.cost ? changeResource(x, ability.cost.resource, -ability.cost.amount) : x;
    return { ...paid, cooldowns: { ...paid.cooldowns, [abilityId]: ability.cooldown ?? 0 } };
  });
  next = withLog(next, `${actor.name} uses ${ability.name}.`);
  let seed = state.rngSeed;
  const engaged = isEngaged(c, actor);
  const user = combatantById(next, actor.id);
  const hidden = hasStatus(user, 'invisible');
  const profile = ability.weaponAttack ? user.attack.profile : ability.attack;
  if (ability.weaponAttack) next = spendShot(next, user);

  for (const t of targets) {
    let target = combatantById(next, t.id);
    // A hostile spell can fizzle on a spellguard, or bounce back off a reflection at the caster.
    if (isSpell(ability) && target.side !== actor.side) {
      if (hasStatus(target, 'spellguard')) {
        next = withLog(updateCombatant(next, target.id, (x) => withoutStatus(x, 'spellguard')), `${ability.name} fizzles against ${target.name}.`);
        next = { ...next, events: [...next.events, { kind: 'status', actorId: target.id, targetId: target.id, label: 'cancelled' }] };
        continue;
      }
      if (hasStatus(target, 'reflecting')) {
        next = withLog(updateCombatant(next, target.id, (x) => withoutStatus(x, 'reflecting')), `${target.name} throws ${ability.name} back at ${actor.name}!`);
        next = { ...next, events: [...next.events, { kind: 'status', actorId: target.id, targetId: actor.id, label: 'reflected' }] };
        target = combatantById(next, actor.id);
        if (!isStanding(target)) continue;
      }
    }
    if (profile && (target.side !== actor.side || target.id === actor.id)) {
      // Bonus dice for the situation, judged before the blow lands.
      let bonus = ability.weaponAttack ? (ability.weaponAttack.bonus ?? 0) + weaponDamageBonus(user) : 0;
      for (const b of ability.bonuses ?? []) {
        if (!conditionHolds(next, b.when, user, target)) continue;
        const rolled = rollDice(seed, b.damage);
        seed = rolled.seed;
        bonus += rolled.value;
      }
      const before = next;
      const range = abilityRange(user, ability);
      const r = strike(next, seed, {
        attacker: user,
        target,
        profile,
        label: ability.name,
        mode: combineModes(reach(c, range, actor.pos, target.pos, engaged).mode, hidden ? 'advantage' : 'normal'),
        critThreshold: ability.weaponAttack ? user.critThreshold : (ability.attack?.critThreshold ?? DEFAULT_CRIT_THRESHOLD),
        animation: ability.animation ?? (ability.weaponAttack ? user.attack.animation : defaultAttackAnimation(profile)),
        bonusDamage: bonus,
        ...(ability.attackStat ? { stat: ability.attackStat } : {}),
        ...(ability.weaponAttack ? { weapon: true } : {}),
        ...((ability.sound ?? (ability.weaponAttack ? user.attack.sound : undefined)) ? { sound: ability.sound ?? user.attack.sound } : {}),
        ...(ability.weaponAttack && user.attack.style ? { style: user.attack.style } : {}),
      });
      next = r.combat;
      seed = r.seed;
      if (ability.lifesteal && r.outcome !== 'miss') {
        const dealt = target.hp - combatantById(next, target.id).hp;
        const me = combatantById(next, user.id);
        const hp = Math.min(me.maxHp, me.hp + Math.max(0, dealt));
        if (hp > me.hp && isStanding(me)) {
          next = withLog(updateCombatant(next, user.id, (x) => ({ ...x, hp })), `${user.name} drains ${hp - me.hp} HP.`);
          next = { ...next, events: [...next.events, { kind: 'heal', actorId: user.id, targetId: user.id, amount: hp - me.hp, animation: ANIMATIONS.heal }] };
        }
      }
      if (r.outcome !== 'miss') {
        const struck = combatantById(next, target.id);
        if (isStanding(struck)) {
          next = applyStatuses(next, user, struck, ability.statuses ?? [], before);
          if (ability.effects.some((e) => e.type !== 'heal')) next = applyBuffOrHeal(next, user, struck, ability, false);
          if (ability.consumes) next = updateCombatant(next, target.id, (x) => withoutStatus(x, ability.consumes!));
          if (ability.knockback) {
            const shoved = knockBack(next, seed, combatantById(next, user.id), combatantById(next, target.id), ability.knockback);
            next = shoved.combat;
            seed = shoved.seed;
          }
        }
      }
    } else {
      const wasDown = target.hp === 0;
      next = applyBuffOrHeal(next, user, target, ability);
      if (wasDown && combatantById(next, target.id).hp > 0) next = withLog(next, `${target.name} is back on their feet!`);
      next = applyStatuses(next, user, target, ability.statuses ?? [], next);
      if (ability.summon) {
        if (!ctx.getMonster) throw new Error('Summoning needs the monster list.');
        next = summonMonster(next, user, ability.summon, ctx as Pick<CombatContext, 'getAbility' | 'getMonster'>);
      }
      if (ability.grantAttack && target.side === actor.side) {
        const g = grantedAttack(next, seed, combatantById(next, target.id));
        next = g.combat;
        seed = g.seed;
      }
    }
  }
  // Attacking from hiding gives the attacker away; going into hiding does not.
  if (profile) next = reveal(next, actor.id);
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

// ---------- kick ----------

/** Enemies the active combatant can kick: those right next to them. */
export function kickTargets(c: CombatState, actor: Combatant): Combatant[] {
  return visibleFoes(c, actor).filter((t) => distance(t.pos, actor.pos) <= 1);
}

/**
 * Kick an enemy next to you: a d20 with no modifier against its Defense. Beat it
 * and the enemy is pushed one tile straight back (if there is room). Pushed, it
 * makes a Toughness check against 10 + your Strength modifier, or falls prone.
 */
export function kick(state: GameState, targetId: string): GameState {
  const { c, actor } = beginAction(state);
  const target = kickTargets(c, actor).find((t) => t.id === targetId);
  if (!target) throw new Error(`${actor.name} cannot reach that to kick it.`);
  const defense = effectiveDefense(target);
  const kickRoll = rollD20(state.rngSeed);
  let seed = kickRoll.seed;
  const natural = kickRoll.value.natural;
  const landed = natural === 20 || (natural !== 1 && natural > defense);
  const shown: ShownRoll[] = [
    {
      who: actor.name,
      what: `Kick → ${target.name}`,
      sides: 20,
      dice: kickRoll.value.dice,
      kept: natural,
      total: natural,
      target: defense,
      result: landed ? 'Pushed' : 'Shrugged off',
      good: actor.side === 'party' ? landed : !landed,
    },
  ];
  let next = withLog(c, `${actor.name} kicks at ${target.name} (${natural} vs ${defense}): ${landed ? 'it connects!' : 'it does not budge.'}`);
  next = { ...next, events: [{ kind: 'status', actorId: actor.id, targetId: target.id, label: landed ? 'Kicked' : 'Shrugged off' }] };

  if (landed) {
    const dx = Math.sign(target.pos.x - actor.pos.x);
    const dy = Math.sign(target.pos.y - actor.pos.y);
    const to = { x: target.pos.x + dx, y: target.pos.y + dy };
    const room = to.x >= 0 && to.y >= 0 && to.x < next.width && to.y < next.height && !tileBlocked(next, to);
    if (!room) {
      next = withLog(next, `${target.name} has nowhere to go and holds its ground.`);
    } else {
      next = updateCombatant(next, target.id, (x) => ({ ...x, pos: to }));
      next = { ...next, events: [...next.events, { kind: 'move', actorId: target.id }] };
      // Keeping its feet: Toughness against 10 + the kicker's Strength.
      const difficulty = 10 + statModifier(effectiveStats(actor).strength);
      const check = makeCheck(seed, statModifier(effectiveStats(target).toughness), difficulty);
      seed = check.seed;
      const fell = !check.value.success;
      shown.push({
        who: target.name,
        what: 'Keep footing (Toughness)',
        sides: 20,
        dice: check.value.roll.dice,
        kept: check.value.roll.natural,
        total: check.value.total,
        target: difficulty,
        result: fell ? 'Falls down' : 'Stays up',
        good: target.side === 'party' ? !fell : fell,
      });
      if (fell) {
        next = updateCombatant(next, target.id, (x) => withStatus(x, { status: 'prone', rounds: 1 }, actor.id));
        next = withLog(next, `${target.name} is knocked off its feet (${check.value.total} vs ${difficulty})!`);
        next = { ...next, events: [...next.events, { kind: 'status', actorId: actor.id, targetId: target.id, label: 'prone' }] };
      } else {
        next = withLog(next, `${target.name} staggers back but keeps its feet (${check.value.total} vs ${difficulty}).`);
      }
    }
  }
  const done = finishAction(state, next, seed);
  return announceRolls(done, shown);
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
  const present = getLeader(state);
  const leader = present && c.mercs.some((m) => m.id === present.id) ? present : c.mercs[0]!;
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
    // The evasive and the unseen slip away without giving anyone a free swing; the stunned cannot swing.
    const mover = combatantById(next, actor.id);
    const slips = hasStatus(mover, 'evasive') || hasStatus(mover, 'invisible');
    const leavingFrom = slips
      ? []
      : standing(next, opposite(actor.side)).filter(
          (e) => e.attack.range === 0 && !hasStatus(e, 'stunned') && !hasStatus(e, 'frozen') && !struck.has(e.id) && distance(e.pos, at) <= 1 && distance(e.pos, step) > 1,
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
        bonusDamage: weaponDamageBonus(punisher),
        weapon: true,
        ...(punisher.attack.sound ? { sound: punisher.attack.sound } : {}),
        ...(punisher.attack.style ? { style: punisher.attack.style } : {}),
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
  const ended = autoEnd(checkOutcome({ ...next, moveLeft: Math.max(0, next.moveLeft - walked) }), seed);
  return withRolls({ ...state, rngSeed: ended.seed, encounter: { ...state.encounter!, combat: checkOutcome(ended.combat) } });
}

// ---------- the end of the fight ----------

/** Splits the enemies' experience between the mercs still standing, with racial bonuses. */
export function shareXp(c: CombatState, ctx: Pick<CombatContext, 'raceOf'>): Record<string, number> {
  const earners = standing(c, 'party').filter((x) => x.mercId);
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

  const fought = c.mercs.map((merc) => {
    const x = c.combatants.find((k) => k.mercId === merc.id);
    // Mercs who were already dead took no part.
    if (!x || merc.dead) return { ...merc, down: true };
    const down = x.hp === 0 && c.outcome !== 'victory';
    const hp = x.hp === 0 && c.outcome === 'victory' ? 1 : x.hp;
    // Lasting potions count down one encounter per fight.
    const potionEffects = (merc.potionEffects ?? [])
      .map((p) => ({ ...p, encounters: p.encounters - 1 }))
      .filter((p) => p.encounters > 0);
    return { ...merc, wounds: x.maxHp - hp, down, potionEffects };
  });
  // Levelling up raises max HP; wounds stay as they are, so the new hit points come in full.
  const awarded = awardXp(fought, xp);
  // Only the mercs in this fight change; the rest of the party may be busy elsewhere.
  const party = state.party.map((m) => awarded.party.find((x) => x.id === m.id) ?? m);
  const fled = c.outcome !== 'victory';

  const gained = Object.values(xp)[0];
  const line = c.outcome === 'victory' ? `Victory${gained ? `: +${gained} XP each` : ''}.` : 'You escape the fight.';
  let next: GameState = {
    ...state,
    party,
    screen: 'dungeon',
    encounter: null,
    dungeon: {
      ...dungeon,
      ...(fled ? {} : { resolved: [...dungeon.resolved, c.featureId] }),
      log: [...dungeon.log, line, ...awarded.lines].slice(-30),
    },
  };
  if (fled) {
    // Everyone who fought falls back to where they came from.
    const inFight = new Set(c.mercs.map((m) => m.id));
    const back = state.encounter.returnTo;
    const groups = groupsOf(next).map((g) => (g.mercIds.some((id) => inFight.has(id)) ? { ...g, pos: back, path: [] } : g));
    next = setGroups(next, groups, groupsOf(next)[0]!.id);
  }
  return ensureLiveLeader(next);
}

/**
 * Mercs walk into a room where the fight on screen is going on. Each rolls
 * initiative and takes their place in the turn order, appearing on a random
 * open square along the edge of the battlefield they came in from.
 */
export function joinCombat(state: GameState, mercIds: string[], from: Pos, ctx: CombatContext): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome || !state.encounter || !state.dungeon) return state;
  const def = ctx.getDungeon(state.dungeon.dungeonId);
  const feature = featureById(def, c.featureId);
  const room = roomAt(def, feature);
  // Which edge: the side of the room the newcomers stepped in from.
  type Edge = 'west' | 'east' | 'north' | 'south';
  let edge: Edge = 'south';
  if (room) {
    if (from.x < room.x) edge = 'west';
    else if (from.x >= room.x + room.width) edge = 'east';
    else if (from.y < room.y) edge = 'north';
  }
  const onEdge = (p: Pos) =>
    edge === 'west' ? p.x === 0 : edge === 'east' ? p.x === c.width - 1 : edge === 'north' ? p.y === 0 : p.y === c.height - 1;

  let seed = state.rngSeed;
  const pickFrom = (spots: Pos[]): Pos | undefined => {
    if (spots.length === 0) return undefined;
    const r = rollDice(seed, `1d${spots.length}`);
    seed = r.seed;
    return spots[r.value - 1];
  };
  const roll = (agility: number) => {
    const r = rollD20(seed);
    seed = r.seed;
    return r.value.natural + statModifier(agility);
  };

  let next = c;
  const newcomers = state.party.filter((m) => mercIds.includes(m.id) && !m.dead && !c.combatants.some((x) => x.id === m.id));
  for (const merc of newcomers) {
    const free: Pos[] = [];
    for (let y = 0; y < next.height; y++) for (let x = 0; x < next.width; x++) if (!tileBlocked(next, { x, y })) free.push({ x, y });
    const pos = pickFrom(free.filter(onEdge)) ?? pickFrom(free);
    if (!pos) break;
    const joiner = mercCombatant(merc, pos, roll, ctx);
    // A place in the turn order by initiative; the one acting now keeps their turn.
    const order = [...next.order];
    let at = order.findIndex((id) => combatantById(next, id).initiative < joiner.initiative);
    if (at < 0) at = order.length;
    order.splice(at, 0, joiner.id);
    const turn = at <= next.turn ? next.turn + 1 : next.turn;
    next = withLog(
      { ...next, combatants: [...next.combatants, joiner], order, turn, mercs: [...next.mercs, structuredClone(merc)] },
      `${merc.name} joins the fight from the ${edge}!`,
    );
  }
  // Help has arrived: a fight left waiting over the fallen comes back to life.
  if (newcomers.length > 0 && next.dormant) {
    const { dormant: _d, ...awake } = next;
    next = withLog(awake, 'The fallen are not alone any more!');
  }
  const encounter = { ...state.encounter, combat: next, mercIds: [...new Set([...encounterMercIdsOf(state), ...newcomers.map((m) => m.id)])] };
  return { ...state, rngSeed: seed, encounter };
}

function encounterMercIdsOf(state: GameState): string[] {
  return state.encounter?.mercIds ?? state.party.filter((m) => !m.dead).map((m) => m.id);
}

/** After a defeat: start the same fight again from the moment it began. */
export function retryCombat(state: GameState, ctx: CombatContext): GameState {
  if (!state.encounter) return state;
  const { combat: _old, ...encounter } = state.encounter;
  return startCombat({ ...state, encounter }, ctx);
}
