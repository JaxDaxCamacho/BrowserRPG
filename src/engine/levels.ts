import type { GameState } from './gameState';
import type { Merc } from './merc';
import { STAT_NAMES, statPointsFromLevels, type StatChanges, type StatName } from './stats';

/**
 * Levelling. Experience raises a merc's level the moment it is earned; the
 * points a level brings are spent later, only at camp or back in town.
 *
 * XP to reach a level is 100 × level × (level − 1): 200 for level 2, 600 for 3,
 * 1,200 for 4, and 38,000 for the cap at 20. Each level costs 200 more than the last.
 */

export const MAX_LEVEL = 20;
export const TALENT_POINTS_PER_LEVEL = 2;

/** Total XP needed to reach a level. */
export function xpForLevel(level: number): number {
  const l = Math.min(Math.max(1, Math.floor(level)), MAX_LEVEL);
  return 100 * l * (l - 1);
}

/** The level a total of XP earns. */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Progress through the current level, for an XP bar. `next` is null at the cap. */
export function xpProgress(merc: Pick<Merc, 'level' | 'xp'>): { into: number; needed: number; next: number | null } {
  if (merc.level >= MAX_LEVEL) return { into: 0, needed: 0, next: null };
  const floor = xpForLevel(merc.level);
  const next = xpForLevel(merc.level + 1);
  return { into: merc.xp - floor, needed: next - floor, next };
}

/** Adds XP and raises the level to match. Returns the levels gained, 0 if none. */
export function gainXp(merc: Merc, amount: number): { merc: Merc; levelsGained: number } {
  if (merc.dead || amount <= 0) return { merc, levelsGained: 0 };
  const xp = merc.xp + amount;
  const level = Math.max(merc.level, levelForXp(xp));
  return { merc: { ...merc, xp, level }, levelsGained: level - merc.level };
}

/** "Aldric Vane reaches level 3: +1 stat point, +2 talent points." */
export function levelUpLine(name: string, from: number, to: number): string {
  const stats = statPointsFromLevels(to) - statPointsFromLevels(from);
  const talents = (to - from) * TALENT_POINTS_PER_LEVEL;
  const gains = [stats && `+${stats} stat point${stats === 1 ? '' : 's'}`, `+${talents} talent points`].filter(Boolean);
  return `${name} reaches level ${to}: ${gains.join(', ')}.`;
}

/** Gives XP to several mercs at once and says who levelled up. */
export function awardXp(party: Merc[], amounts: Record<string, number>): { party: Merc[]; lines: string[] } {
  const lines: string[] = [];
  const next = party.map((m) => {
    const gained = gainXp(m, amounts[m.id] ?? 0);
    if (gained.levelsGained > 0) lines.push(levelUpLine(m.name, m.level, gained.merc.level));
    return gained.merc;
  });
  return { party: next, lines };
}

// ---------- points ----------

const total = (changes: Record<string, number | undefined>) => Object.values(changes).reduce<number>((n, v) => n + (v ?? 0), 0);

export function unspentStatPoints(merc: Pick<Merc, 'level' | 'levelStats'>): number {
  return statPointsFromLevels(merc.level) - total(merc.levelStats);
}

export function unspentTalentPoints(merc: Pick<Merc, 'level' | 'talents'>): number {
  return (merc.level - 1) * TALENT_POINTS_PER_LEVEL - total(merc.talents);
}

/** Why points cannot be spent right now, or null when they can: only at camp or in town. */
export function trainingBlocker(state: GameState): string | null {
  if (state.screen === 'adventureSelect') return null;
  if (state.screen === 'dungeon' && state.dungeon?.camping) return null;
  return 'Points can only be spent at camp or back in town.';
}

/** Spends stat points, one +1 per entry in `picks`. */
export function spendStatPoints(state: GameState, mercId: string, picks: StatName[]): GameState {
  const blocker = trainingBlocker(state);
  if (blocker) throw new Error(blocker);
  const merc = state.party.find((m) => m.id === mercId);
  if (!merc || merc.dead) throw new Error('That merc cannot train.');
  if (picks.some((s) => !STAT_NAMES.includes(s))) throw new Error('Unknown stat.');
  if (picks.length > unspentStatPoints(merc)) throw new Error(`${merc.name} does not have that many stat points.`);
  const levelStats: StatChanges = { ...merc.levelStats };
  for (const s of picks) levelStats[s] = (levelStats[s] ?? 0) + 1;
  return { ...state, party: state.party.map((m) => (m.id === mercId ? { ...m, levelStats } : m)) };
}
