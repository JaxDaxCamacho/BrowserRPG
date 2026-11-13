/**
 * Seeded random numbers (mulberry32). The seed lives in GameState, so every
 * roll is reproducible and survives save and reload. Functions here are pure:
 * they take a seed and return the result together with the next seed.
 */

export interface Rolled<T> {
  value: T;
  /** Seed to use for the next roll. */
  seed: number;
}

/** A float in [0, 1) and the next seed. */
export function nextRandom(seed: number): Rolled<number> {
  const next = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(next ^ (next >>> 15), next | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return { value, seed: next };
}

/** A whole number from 1 to `sides`, like rolling one die. */
export function rollDie(seed: number, sides: number): Rolled<number> {
  if (!Number.isInteger(sides) || sides < 1) throw new Error(`A die needs at least 1 side, got ${sides}`);
  const r = nextRandom(seed);
  return { value: Math.floor(r.value * sides) + 1, seed: r.seed };
}
