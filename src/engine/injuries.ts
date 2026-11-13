import { rollD20 } from './dice';
import type { GameState, ShownRoll } from './gameState';
import type { Merc } from './merc';
import { raceDeathSaveDifficulty, type RaceDefinition } from './race';
import { rollDie, type Rolled } from './rng';
import { STAT_NAMES, type StatChanges, type StatName } from './stats';

/**
 * Being knocked down leaves a permanent injury that lowers one or two stats.
 * A merc who would take a fourth injury dies instead. Injuries only heal with
 * a healing kit during a long rest.
 */

/** A merc can carry this many injuries; the next one kills. */
export const MAX_INJURIES = 3;

export interface Injury {
  id: string;
  name: string;
  statChanges: StatChanges;
}

const INJURY_NAMES: Record<StatName, string> = {
  strength: 'Torn shoulder',
  agility: 'Shattered knee',
  toughness: 'Cracked ribs',
  intellect: 'Head wound',
  spirit: 'Haunted',
  charisma: 'Scarred face',
};

/** An injury to one or two different stats, -1 each. */
export function rollInjury(seed: number, existing: Injury[]): Rolled<Injury> {
  const howMany = rollDie(seed, 2);
  let next = howMany.seed;
  const stats: StatName[] = [];
  while (stats.length < howMany.value) {
    const pick = rollDie(next, STAT_NAMES.length);
    next = pick.seed;
    const stat = STAT_NAMES[pick.value - 1]!;
    if (!stats.includes(stat)) stats.push(stat);
  }
  const statChanges: StatChanges = Object.fromEntries(stats.map((s) => [s, -1]));
  let n = existing.length + 1;
  while (existing.some((i) => i.id === `injury-${n}`)) n++;
  return {
    value: { id: `injury-${n}`, name: stats.map((s) => INJURY_NAMES[s]).join(' and '), statChanges },
    seed: next,
  };
}

/** All injuries' stat changes added up. */
export function injuryStatChanges(injuries: Injury[]): StatChanges {
  const total: StatChanges = {};
  for (const injury of injuries) {
    for (const [stat, amount] of Object.entries(injury.statChanges) as [StatName, number][]) {
      total[stat] = (total[stat] ?? 0) + amount;
    }
  }
  return total;
}

export type KnockDownOutcome =
  | { kind: 'injured'; injury: Injury }
  /** A Cursed merc beat their death save: down, but no injury. */
  | { kind: 'spared'; roll: number }
  | { kind: 'dead' };

/**
 * What happens to a merc who has just gone down. Returns the merc with any
 * new injury (or dead), plus a line for the log.
 */
export function knockDown(
  merc: Merc,
  race: RaceDefinition | { deathSave: number | null },
  seed: number,
): { merc: Merc; seed: number; outcome: KnockDownOutcome; line: string; save?: { roll: number; needed: number } } {
  let next = seed;
  const needed = 'deathSave' in race ? race.deathSave : raceDeathSaveDifficulty(race);
  let save: { roll: number; needed: number } | undefined;
  if (needed !== null) {
    const r = rollD20(next);
    next = r.seed;
    save = { roll: r.value.natural, needed };
    if (r.value.natural >= needed) {
      return {
        merc: { ...merc, down: true },
        seed: next,
        outcome: { kind: 'spared', roll: r.value.natural },
        line: `${merc.name} is knocked down, but the curse holds death back (rolled ${r.value.natural}, needed ${needed}): no injury.`,
        save,
      };
    }
  }
  if (merc.injuries.length >= MAX_INJURIES) {
    return {
      merc: { ...merc, down: true, dead: true },
      seed: next,
      outcome: { kind: 'dead' },
      line: `${merc.name} has taken one wound too many and dies.`,
      ...(save ? { save } : {}),
    };
  }
  const injury = rollInjury(next, merc.injuries);
  return {
    ...(save ? { save } : {}),
    merc: { ...merc, down: true, injuries: [...merc.injuries, injury.value] },
    seed: injury.seed,
    outcome: { kind: 'injured', injury: injury.value },
    line: `${merc.name} goes down with a lasting injury: ${injury.value.name} (${Object.entries(injury.value.statChanges)
      .map(([s, a]) => `${a} ${s}`)
      .join(', ')}).`,
  };
}

/** The Cursed death save, as the dice tray shows it. */
export function saveRoll(name: string, save: { roll: number; needed: number }): ShownRoll {
  const ok = save.roll >= save.needed;
  return { who: name, what: 'Death save', sides: 20, dice: [save.roll], kept: save.roll, target: save.needed, total: save.roll, result: ok ? 'Spared' : 'Injured', good: ok };
}

/** Makes sure the leader is alive, handing the role to the first living merc if not. */
export function ensureLiveLeader(state: GameState): GameState {
  const leader = state.party.find((m) => m.id === state.leaderId);
  if (leader && !leader.dead) return state;
  const heir = state.party.find((m) => !m.dead);
  return { ...state, leaderId: heir?.id ?? null };
}

export function livingMercs(state: GameState): Merc[] {
  return state.party.filter((m) => !m.dead);
}
