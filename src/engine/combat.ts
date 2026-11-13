import { ATTACK_STAT, DEFAULT_CRIT_THRESHOLD, resolveAttack, type Armour, type AttackOutcome, type AttackProfile } from './attack';
import { makeCheck } from './checks';
import { rollD20, type RollMode } from './dice';
import { featureById, type DungeonDefinition } from './dungeon';
import type { GameState } from './gameState';
import { weaponAttack, type AmmoItem, type ItemEffect, type ItemLookup } from './items';
import type { Merc as MercType, MercSheet } from './merc';
import type { AbilityDefinition, EnemyArchetype, MonsterDefinition } from './monsters';
import { getLeader } from './party';
import { ensureLiveLeader, knockDown } from './injuries';
import { raceCritThreshold, raceDeathSaveDifficulty, raceXpMultiplier, type RaceDefinition, type WeaponType } from './race';
import { applyStatChanges, statModifier, type StatChanges, type Stats } from './stats';

/**
 * Turn-based fights on 2 to 5 horizontal rows. Melee reaches only the same row;
 * ranged attacks reach a number of rows and roll with disadvantage at a target
 * in the same row. Each turn is one move (one row up or down) and one action.
 */

export type Side = 'party' | 'enemy';

/** Defense added by the Defend action until the defender's next turn. */
export const DEFEND_BONUS = 2;
/** Agility check the leader makes to flee. */
export const FLEE_DIFFICULTY = 12;

export interface CombatAttack {
  name: string;
  /** 0 = melee, same row only. */
  range: number;
  profile: AttackProfile;
  weaponType?: WeaponType;
  /** Ammunition item spent per shot, if any. */
  ammoId?: string;
  animation?: string;
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
  row: number;
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
  /** True when this was a free attack for leaving a row. */
  free?: boolean;
}

export interface CombatState {
  featureId: string;
  rows: number;
  ambush: boolean;
  round: number;
  combatants: Combatant[];
  /** Combatant ids in initiative order. */
  order: string[];
  /** Index into `order` of whoever is acting. */
  turn: number;
  moved: boolean;
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
const UNARMED: CombatAttack = { name: 'Fists', range: 0, profile: { kind: 'melee', damageType: 'physical', graze: '1', hit: '2' } };

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

const opposite = (side: Side): Side => (side === 'party' ? 'enemy' : 'party');

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

/** Whether an attack with this reach can hit from one row to another, and with what roll. */
export function reach(range: number, fromRow: number, toRow: number): { ok: boolean; mode: RollMode } {
  const distance = Math.abs(fromRow - toRow);
  if (range === 0) return { ok: distance === 0, mode: 'normal' };
  return { ok: distance <= range, mode: distance === 0 ? 'disadvantage' : 'normal' };
}

/** Targets the actor's basic attack can reach right now. */
export function attackTargets(c: CombatState, actor: Combatant): Combatant[] {
  if (ammoLeft(c, actor) === 0) return [];
  return standing(c, opposite(actor.side)).filter((t) => reach(actor.attack.range, actor.row, t.row).ok);
}

/** Targets an ability can be aimed at right now. Area abilities return everyone they would affect. */
export function abilityTargets(c: CombatState, actor: Combatant, ability: AbilityDefinition): Combatant[] {
  const foes = standing(c, opposite(actor.side));
  const friends = standing(c, actor.side);
  switch (ability.target) {
    case 'self':
      return [actor];
    case 'ally':
      return friends.filter((t) => Math.abs(actor.row - t.row) <= ability.range);
    case 'enemy':
    case 'row':
      return foes.filter((t) => reach(ability.range, actor.row, t.row).ok);
    case 'allAllies':
      return friends;
    case 'allEnemies':
      return foes;
  }
}

export function canUseAbility(c: CombatState, actor: Combatant, ability: AbilityDefinition): boolean {
  return ability.activation === 'action' && (actor.cooldowns[ability.id] ?? 0) === 0 && abilityTargets(c, actor, ability).length > 0;
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
      ...(weapon.ammo ? { ammoId: merc.equipment.ammo ?? `no-${weapon.ammo}` } : {}),
    },
    critThreshold: raceCritThreshold(ctx.raceOf(merc), weapon.weaponType, profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD),
  };
}

/** Starting rows: the party on the lowest row and enemies on the highest; in an ambush the party is in the middle. */
function startingRows(rows: number, ambush: boolean, enemyIndex: number): { party: number; enemy: number } {
  if (ambush && rows === 5) return { party: 2, enemy: enemyIndex % 2 === 0 ? 4 : 0 };
  return { party: 0, enemy: rows - 1 };
}

/** Opens the fight for the encounter the party just walked into. */
export function startCombat(state: GameState, ctx: CombatContext): GameState {
  const { encounter, dungeon } = state;
  if (!encounter || !dungeon) throw new Error('There is no encounter to fight.');
  const def = ctx.getDungeon(dungeon.dungeonId);
  const feature = featureById(def, encounter.featureId);
  if (feature.type !== 'encounter') throw new Error(`${feature.id} is not an enemy group.`);
  const room = def.rooms.find((r) => feature.x >= r.x && feature.x < r.x + r.width && feature.y >= r.y && feature.y < r.y + r.height);
  const rows = room?.rows ?? 2;
  const ambush = !!feature.ambush && rows === 5;

  let seed = state.rngSeed;
  const roll = (agility: number) => {
    const r = rollD20(seed);
    seed = r.seed;
    return r.value.natural + statModifier(agility);
  };

  const combatants: Combatant[] = [];
  // The dead take no part.
  for (const merc of state.party.filter((m) => !m.dead)) {
    const sheet = ctx.sheetOf(merc);
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
      row: startingRows(rows, ambush, 0).party,
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
      deathSave: raceDeathSaveDifficulty(ctx.raceOf(merc)),
      dead: false,
    });
  }

  let enemyIndex = 0;
  let xp = 0;
  for (const group of feature.monsters) {
    const monster = ctx.getMonster(group.monsterId);
    for (let n = 1; n <= group.count; n++) {
      xp += monster.xp;
      combatants.push({
        id: `${monster.id}-${n}`,
        side: 'enemy',
        name: group.count > 1 ? `${monster.name} ${n}` : monster.name,
        ...(monster.portrait ? { portrait: monster.portrait } : {}),
        monsterId: monster.id,
        archetype: monster.archetype,
        row: startingRows(rows, ambush, enemyIndex++).enemy,
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
        attack: { name: monster.attack.name, range: monster.attack.range, profile: monster.attack.profile, ...(monster.attack.animation ? { animation: monster.attack.animation } : {}) },
        critThreshold: monster.attack.profile.critThreshold ?? DEFAULT_CRIT_THRESHOLD,
        deathSave: null,
        dead: false,
      });
    }
  }

  // Highest initiative first; the party wins ties.
  const order = [...combatants]
    .sort((a, b) => b.initiative - a.initiative || (a.side === b.side ? 0 : a.side === 'party' ? -1 : 1))
    .map((x) => x.id);

  let combat: CombatState = {
    featureId: feature.id,
    rows,
    ambush,
    round: 1,
    combatants,
    order,
    turn: 0,
    moved: false,
    acted: false,
    outcome: null,
    log: [ambush ? `Ambush! ${feature.name} close in from both sides.` : `${feature.name} attack!`],
    events: [],
    seq: 0,
    mercs: state.party.map((m) => structuredClone(m)),
    xp,
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

/** Starts the turn of whoever is up: their Defend wears off and their cooldowns tick down. */
function beginTurn(c: CombatState): CombatState {
  const actor = activeCombatant(c);
  const cooldowns = Object.fromEntries(Object.entries(actor.cooldowns).map(([k, v]) => [k, Math.max(0, v - 1)]));
  return updateCombatant({ ...c, moved: false, acted: false }, actor.id, (x) => ({ ...x, defending: false, cooldowns }));
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

/** Ends the turn by itself once the active merc has both moved and acted. */
function autoEnd(c: CombatState): CombatState {
  if (c.outcome) return c;
  const actor = activeCombatant(c);
  if (!isStanding(actor) || (c.moved && c.acted)) return skipDownedTurn(advance(c, false));
  return c;
}

// ---------- attacks ----------

interface Strike {
  attacker: Combatant;
  target: Combatant;
  profile: AttackProfile;
  label: string;
  mode: RollMode;
  critThreshold: number;
  animation?: string;
  free?: boolean;
}

function describeOutcome(outcome: AttackOutcome): string {
  return { miss: 'misses', graze: 'grazes', hit: 'hits', crit: 'crits' }[outcome];
}

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
  const verb = describeOutcome(r.outcome);
  next = withLog(
    next,
    `${s.attacker.name} ${verb} ${s.target.name} with ${s.label}${r.damage ? ` for ${r.damage}` : ''} (${roll}${modifier >= 0 ? '+' : ''}${modifier} vs ${r.defense}${s.mode === 'disadvantage' ? ', disadvantage' : ''}).`,
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
  };
  const events: CombatEvent[] = [
    {
      kind: 'attack',
      actorId: s.attacker.id,
      targetId: s.target.id,
      outcome: r.outcome,
      amount: r.damage,
      roll: detail,
      ...(s.animation ? { animation: s.animation } : {}),
    },
  ];
  let nextSeed = result.seed;
  if (hp === 0 && s.target.hp > 0) {
    events.push({ kind: 'down', actorId: s.target.id });
    const merc = s.target.mercId ? next.mercs.find((m) => m.id === s.target.mercId) : undefined;
    if (merc) {
      // A merc who goes down takes a lasting injury, or dies at the fourth.
      const fall = knockDown(merc, { deathSave: s.target.deathSave }, nextSeed);
      nextSeed = fall.seed;
      next = withLog({ ...next, mercs: next.mercs.map((m) => (m.id === merc.id ? fall.merc : m)) }, fall.line);
      if (fall.outcome.kind === 'dead') next = updateCombatant(next, s.target.id, (x) => ({ ...x, dead: true }));
    } else {
      next = withLog(next, `${s.target.name} goes down.`);
    }
  }
  return { combat: { ...next, events: [...next.events, ...events] }, seed: nextSeed };
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
  return { ...state, rngSeed: seed, encounter: { ...state.encounter!, combat: done } };
}

/** The active combatant attacks with their weapon. */
export function attack(state: GameState, targetId: string): GameState {
  const { c, actor } = beginAction(state);
  const target = combatantById(c, targetId);
  if (!attackTargets(c, actor).some((t) => t.id === targetId)) throw new Error(`${actor.name} cannot reach ${target.name}.`);
  const { mode } = reach(actor.attack.range, actor.row, target.row);
  const hit = strike(spendShot(c, actor), state.rngSeed, {
    attacker: actor,
    target,
    profile: actor.attack.profile,
    label: actor.attack.name,
    mode,
    critThreshold: actor.critThreshold,
    ...(actor.attack.animation ? { animation: actor.attack.animation } : {}),
  });
  return finishAction(state, hit.combat, hit.seed);
}

function applyBuffOrHeal(c: CombatState, seed: number, actor: Combatant, target: Combatant, ability: AbilityDefinition) {
  let next = c;
  const heal = ability.effects.filter((e) => e.type === 'heal').reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0);
  const lasting = ability.effects.filter((e) => e.type !== 'heal');
  if (heal > 0) {
    const current = combatantById(next, target.id);
    const hp = Math.min(current.maxHp, current.hp + heal);
    next = updateCombatant(next, target.id, (x) => ({ ...x, hp }));
    next = withLog(next, `${actor.name} heals ${target.name} for ${hp - current.hp}.`);
    next = { ...next, events: [...next.events, { kind: 'heal', actorId: actor.id, targetId: target.id, amount: hp - current.hp, ...(ability.animation ? { animation: ability.animation } : {}) }] };
  }
  if (lasting.length > 0) {
    const buff: Buff = { source: ability.name, effects: lasting, roundsLeft: ability.duration ?? 1 };
    next = updateCombatant(next, target.id, (x) => ({ ...x, buffs: [...x.buffs.filter((b) => b.source !== ability.name), buff] }));
    next = { ...next, events: [...next.events, { kind: 'buff', actorId: actor.id, targetId: target.id, ...(ability.animation ? { animation: ability.animation } : {}) }] };
  }
  return { combat: next, seed };
}

/** The active combatant uses an ability. `targetId` picks the target for single-target abilities. */
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
  } else if (ability.target === 'row') {
    const chosen = options.find((t) => t.id === targetId) ?? options[0]!;
    targets = options.filter((t) => t.row === chosen.row);
  } else {
    targets = options;
  }

  let next = withLog(updateCombatant(c, actor.id, (x) => ({ ...x, cooldowns: { ...x.cooldowns, [abilityId]: ability.cooldown ?? 0 } })), `${actor.name} uses ${ability.name}.`);
  let seed = state.rngSeed;
  for (const t of targets) {
    const target = combatantById(next, t.id);
    if (ability.attack) {
      const r = strike(next, seed, {
        attacker: actor,
        target,
        profile: ability.attack,
        label: ability.name,
        mode: reach(ability.range, actor.row, target.row).mode,
        critThreshold: ability.attack.critThreshold ?? DEFAULT_CRIT_THRESHOLD,
        ...(ability.animation ? { animation: ability.animation } : {}),
      });
      next = r.combat;
      seed = r.seed;
    } else {
      const r = applyBuffOrHeal(next, seed, actor, target, ability);
      next = r.combat;
      seed = r.seed;
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
            potionEffects: item.encounters && item.effects.some((e) => e.type !== 'heal')
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
    next = { ...next, events: [{ kind: 'heal', actorId: actor.id, targetId: actor.id, amount: hp - actor.hp }] };
  }
  const lasting = item.effects.filter((e) => e.type !== 'heal');
  if (lasting.length > 0) {
    next = updateCombatant(next, actor.id, (x) => ({ ...x, buffs: [...x.buffs, { source: item.name, effects: lasting, roundsLeft: null }] }));
    next = { ...next, events: [...next.events, { kind: 'buff', actorId: actor.id, targetId: actor.id }] };
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
  const next = withLog({ ...c, events: [{ kind: 'flee', actorId: actor.id }] }, line);
  if (ok) return { ...state, rngSeed: rolled.seed, encounter: { ...state.encounter!, combat: { ...next, outcome: 'fled' } } };
  return finishAction(state, next, rolled.seed);
}

// ---------- movement ----------

/**
 * Moves the active combatant one row up (+1) or down (-1). Leaving a row that
 * holds a standing enemy lets one of them make a free melee attack.
 */
export function moveCombatant(state: GameState, direction: 1 | -1): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome) return state;
  if (c.moved) throw new Error('This turn already has its move.');
  const actor = activeCombatant(c);
  const row = actor.row + direction;
  if (row < 0 || row >= c.rows) throw new Error('There is no row that way.');

  let next: CombatState = { ...c, events: [{ kind: 'move', actorId: actor.id }], seq: c.seq + 1 };
  let seed = state.rngSeed;
  const punisher = standing(next, opposite(actor.side)).find((e) => e.row === actor.row && e.attack.range === 0);
  if (punisher) {
    next = withLog(next, `${punisher.name} strikes as ${actor.name} breaks away.`);
    const r = strike(next, seed, {
      attacker: punisher,
      target: actor,
      profile: punisher.attack.profile,
      label: punisher.attack.name,
      mode: 'normal',
      critThreshold: punisher.critThreshold,
      free: true,
      ...(punisher.attack.animation ? { animation: punisher.attack.animation } : {}),
    });
    next = r.combat;
    seed = r.seed;
  }
  const mover = combatantById(next, actor.id);
  if (isStanding(mover)) {
    next = withLog(updateCombatant(next, actor.id, (x) => ({ ...x, row })), `${actor.name} moves to row ${row + 1}.`);
  }
  next = autoEnd(checkOutcome({ ...next, moved: true }));
  return { ...state, rngSeed: seed, encounter: { ...state.encounter!, combat: next } };
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
