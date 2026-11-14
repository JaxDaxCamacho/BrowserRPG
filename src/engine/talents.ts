import type { GameState } from './gameState';
import type { ItemEffect } from './items';
import { trainingBlocker, unspentTalentPoints } from './levels';
import type { Merc } from './merc';

/**
 * Each class has a talent tree of three branches. A branch has three tiers:
 * tier 1 is open from the start, tier 2 needs 5 points spent in that branch,
 * tier 3 needs 10. A talent either grants an ability (one rank) or gives
 * passive effects once per rank taken.
 */

export const TIER_POINTS = 5;
export const TIERS = [1, 2, 3] as const;
export type Tier = (typeof TIERS)[number];

export interface TalentDefinition {
  id: string;
  name: string;
  icon?: string;
  description: string;
  tier: Tier;
  maxRanks: number;
  /** The ability this talent teaches. */
  abilityId?: string;
  /** Passive effects, applied once per rank. */
  effects?: ItemEffect[];
  /**
   * Effects for each rank, in place of `effects`: entry 0 is everything rank 1
   * gives, entry 1 everything rank 2 gives, and so on. Lets a rank change what
   * a talent does (a new ability version, a crit at the last rank).
   */
  ranks?: ItemEffect[][];
}

export interface TalentBranch {
  id: string;
  name: string;
  description: string;
  icon?: string;
  talents: TalentDefinition[];
}

export interface TalentTree {
  classId: string;
  branches: TalentBranch[];
}

/** Points a tier needs spent in its branch before it opens. */
export const pointsToOpen = (tier: Tier) => (tier - 1) * TIER_POINTS;

export function findTalent(tree: TalentTree, talentId: string): { branch: TalentBranch; talent: TalentDefinition } | null {
  for (const branch of tree.branches) {
    const talent = branch.talents.find((t) => t.id === talentId);
    if (talent) return { branch, talent };
  }
  return null;
}

export function pointsInBranch(talents: Record<string, number>, branch: TalentBranch): number {
  return branch.talents.reduce((n, t) => n + (talents[t.id] ?? 0), 0);
}

/** Why one more rank of this talent cannot be taken, or null when it can. */
export function talentBlocker(merc: Pick<Merc, 'level' | 'talents'>, tree: TalentTree, talentId: string): string | null {
  const found = findTalent(tree, talentId);
  if (!found) return 'Not a talent of this class';
  const { branch, talent } = found;
  const rank = merc.talents[talentId] ?? 0;
  if (rank >= talent.maxRanks) return 'Fully learned';
  const need = pointsToOpen(talent.tier);
  const have = pointsInBranch(merc.talents, branch);
  if (have < need) return `Needs ${need} points in ${branch.name} (${have} so far)`;
  if (unspentTalentPoints(merc) <= 0) return 'No talent points left';
  return null;
}

/** Takes the picked talent ranks in order, each one checked as it is taken. */
export function spendTalentPoints(state: GameState, mercId: string, picks: string[], tree: TalentTree): GameState {
  const blocker = trainingBlocker(state);
  if (blocker) throw new Error(blocker);
  const merc = state.party.find((m) => m.id === mercId);
  if (!merc || merc.dead) throw new Error('That merc cannot train.');
  if (tree.classId !== merc.classId) throw new Error(`That is not the ${merc.classId} talent tree.`);
  let learner: Merc = merc;
  for (const id of picks) {
    const why = talentBlocker(learner, tree, id);
    if (why) throw new Error(`${findTalent(tree, id)?.talent.name ?? id}: ${why}.`);
    learner = { ...learner, talents: { ...learner.talents, [id]: (learner.talents[id] ?? 0) + 1 } };
  }
  return { ...state, party: state.party.map((m) => (m.id === mercId ? learner : m)) };
}

/** Everything a merc's talents add: passive effects per rank, and the abilities they teach. */
export function talentEffects(merc: Pick<Merc, 'talents'>, tree: TalentTree | undefined): ItemEffect[] {
  if (!tree) return [];
  const out: ItemEffect[] = [];
  for (const branch of tree.branches) {
    for (const talent of branch.talents) {
      const rank = Math.min(merc.talents[talent.id] ?? 0, talent.maxRanks);
      if (rank <= 0) continue;
      if (talent.abilityId) out.push({ type: 'ability', abilityId: talent.abilityId });
      if (talent.ranks) out.push(...(talent.ranks[rank - 1] ?? []));
      else for (let i = 0; i < rank; i++) out.push(...(talent.effects ?? []));
    }
  }
  return out;
}
