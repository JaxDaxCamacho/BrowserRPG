import { rollDie, type Rolled } from './rng';

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface D20Roll {
  /** The die that counts. */
  natural: number;
  /** Every die rolled: one normally, two with advantage or disadvantage. */
  dice: number[];
  mode: RollMode;
}

/** Advantage and disadvantage cancel out; several of the same kind do not stack. */
export function combineRollModes(advantage: boolean, disadvantage: boolean): RollMode {
  if (advantage === disadvantage) return 'normal';
  return advantage ? 'advantage' : 'disadvantage';
}

export function rollD20(seed: number, mode: RollMode = 'normal'): Rolled<D20Roll> {
  const first = rollDie(seed, 20);
  if (mode === 'normal') {
    return { value: { natural: first.value, dice: [first.value], mode }, seed: first.seed };
  }
  const second = rollDie(first.seed, 20);
  const natural =
    mode === 'advantage' ? Math.max(first.value, second.value) : Math.min(first.value, second.value);
  return { value: { natural, dice: [first.value, second.value], mode }, seed: second.seed };
}

/** Dice notation such as "1d8", "2d6+1" or "1d4-1". */
export interface DiceExpression {
  count: number;
  sides: number;
  bonus: number;
}

const DICE_PATTERN = /^(\d+)d(\d+)([+-]\d+)?$/;
const FLAT_PATTERN = /^\d+$/;

/** A flat number such as "2" is allowed and means no dice, just the bonus. */
export function parseDice(text: string): DiceExpression {
  const trimmed = text.replace(/\s+/g, '');
  if (FLAT_PATTERN.test(trimmed)) return { count: 0, sides: 1, bonus: Number(trimmed) };
  const match = DICE_PATTERN.exec(trimmed);
  if (!match) throw new Error(`Not valid dice notation: "${text}"`);
  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (count < 1 || sides < 1) throw new Error(`Not valid dice notation: "${text}"`);
  return { count, sides, bonus: match[3] ? Number(match[3]) : 0 };
}

export function isValidDice(text: string): boolean {
  try {
    parseDice(text);
    return true;
  } catch {
    return false;
  }
}

export function rollDice(seed: number, text: string): Rolled<number> {
  const { count, sides, bonus } = parseDice(text);
  let total = bonus;
  let next = seed;
  for (let i = 0; i < count; i++) {
    const r = rollDie(next, sides);
    total += r.value;
    next = r.seed;
  }
  return { value: total, seed: next };
}
