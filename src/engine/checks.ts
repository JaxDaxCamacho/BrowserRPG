import { rollD20, type D20Roll, type RollMode } from './dice';
import type { Rolled } from './rng';

/** Target numbers for non-combat checks. */
export const DIFFICULTY = {
  easy: 8,
  standard: 12,
  hard: 16,
} as const;

export type DifficultyName = keyof typeof DIFFICULTY;

export interface CheckResult {
  roll: D20Roll;
  modifier: number;
  total: number;
  difficulty: number;
  success: boolean;
}

/** d20 + stat modifier; succeeds when the total meets the difficulty. */
export function makeCheck(
  seed: number,
  modifier: number,
  difficulty: number,
  mode: RollMode = 'normal',
): Rolled<CheckResult> {
  const rolled = rollD20(seed, mode);
  const total = rolled.value.natural + modifier;
  return {
    value: { roll: rolled.value, modifier, total, difficulty, success: total >= difficulty },
    seed: rolled.seed,
  };
}
