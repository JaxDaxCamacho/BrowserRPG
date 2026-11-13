export const STAT_NAMES = ['strength', 'agility', 'toughness', 'intellect', 'spirit', 'charisma'] as const;

export type StatName = (typeof STAT_NAMES)[number];
export type Stats = Record<StatName, number>;

/** Every stat starts here at creation. */
export const STARTING_STAT = 8;
/** Points a new merc spends at creation, one point per +1. There is no cap. */
export const CREATION_POINTS = 12;

/**
 * D&D-style modifier: 10 is the baseline, +1 for every 2 points above it,
 * -1 for every 2 points below. 8-9 gives -1, 10-11 gives 0, 12-13 gives +1.
 */
export function statModifier(value: number): number {
  return Math.floor((value - 10) / 2);
}

export function createStartingStats(): Stats {
  return {
    strength: STARTING_STAT,
    agility: STARTING_STAT,
    toughness: STARTING_STAT,
    intellect: STARTING_STAT,
    spirit: STARTING_STAT,
    charisma: STARTING_STAT,
  };
}

/** Points spent above the starting value, before any race bonus. */
export function creationPointsSpent(stats: Stats): number {
  return STAT_NAMES.reduce((sum, name) => sum + (stats[name] - STARTING_STAT), 0);
}

/** A valid spread never lowers a stat below the start and never overspends. */
export function isValidCreationSpread(stats: Stats): boolean {
  const noneLowered = STAT_NAMES.every((name) => Number.isInteger(stats[name]) && stats[name] >= STARTING_STAT);
  return noneLowered && creationPointsSpent(stats) <= CREATION_POINTS;
}

/** Stat points earned from levelling: +1 at levels 3, 5, 7, 9 and so on. */
export function statPointsFromLevels(level: number): number {
  return Math.max(0, Math.floor((level - 1) / 2));
}

export type StatChanges = Partial<Record<StatName, number>>;

/** Adds bonuses or penalties (from race, gear, talents) to a set of stats. */
export function applyStatChanges(stats: Stats, changes: StatChanges): Stats {
  const result = { ...stats };
  for (const name of STAT_NAMES) {
    result[name] += changes[name] ?? 0;
  }
  return result;
}
