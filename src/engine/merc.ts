import type { Armour } from './attack';
import { defenseOf, maxHitPoints, type ClassNumbers } from './derived';
import { raceBaseArmour, raceBonusHp, type RaceDefinition } from './race';
import {
  applyStatChanges,
  CREATION_POINTS,
  creationPointsSpent,
  isValidCreationSpread,
  type StatChanges,
  type StatName,
  type Stats,
} from './stats';

export const MAX_NAME_LENGTH = 24;

/** What the player fills in when building a merc, or what a pre-built merc supplies. */
export interface MercDraft {
  name: string;
  raceId: string;
  classId: string;
  /** Stats after spending creation points, before race changes. */
  baseStats: Stats;
  /** Stats picked for a race that lets the player choose its bonus (Human). */
  raceChoices: StatName[];
  /** Set when the merc came from the pre-built roster. */
  premadeId?: string;
}

export interface Merc extends MercDraft {
  id: string;
  level: number;
  xp: number;
}

/** Base stats with the race's fixed changes and chosen bonuses applied. */
export function finalStats(merc: Pick<MercDraft, 'baseStats' | 'raceChoices'>, race: RaceDefinition): Stats {
  const chosen: StatChanges = {};
  for (const name of merc.raceChoices) {
    chosen[name] = (chosen[name] ?? 0) + (race.statChoices?.amount ?? 0);
  }
  return applyStatChanges(applyStatChanges(merc.baseStats, race.statChanges), chosen);
}

/** Problems that stop a draft from joining the party. Empty means it is ready. */
export function validateDraft(draft: MercDraft, race: RaceDefinition): string[] {
  const problems: string[] = [];
  const name = draft.name.trim();
  if (name.length === 0) problems.push('Give your mercenary a name.');
  if (name.length > MAX_NAME_LENGTH) problems.push(`Names can be at most ${MAX_NAME_LENGTH} characters.`);

  if (!isValidCreationSpread(draft.baseStats)) {
    problems.push('Stats cannot go below their starting value or use more points than you have.');
  } else {
    const left = CREATION_POINTS - creationPointsSpent(draft.baseStats);
    if (left > 0) problems.push(`Spend your remaining ${left} stat point${left === 1 ? '' : 's'}.`);
  }

  const needed = race.statChoices?.count ?? 0;
  const distinct = new Set(draft.raceChoices).size;
  if (distinct !== draft.raceChoices.length || draft.raceChoices.length !== needed) {
    problems.push(
      needed === 0
        ? `${race.name} has no stat bonus to choose.`
        : `Choose ${needed} different stats for the ${race.name} bonus.`,
    );
  }
  return problems;
}

export interface MercSheet {
  stats: Stats;
  maxHp: number;
  defense: number;
  /** Armour before any gear: only what the race gives. */
  armour: Armour;
}

/** Everything the character sheet shows that is worked out rather than stored. */
export function mercSheet(
  merc: Pick<Merc, 'baseStats' | 'raceChoices'> & { level?: number },
  race: RaceDefinition,
  cls: ClassNumbers,
): MercSheet {
  const stats = finalStats(merc, race);
  return {
    stats,
    maxHp: maxHitPoints(cls, stats, merc.level ?? 1, raceBonusHp(race)),
    defense: defenseOf(cls, stats),
    armour: { physical: raceBaseArmour(race, 'physical'), magic: raceBaseArmour(race, 'magic') },
  };
}
