import { describe, expect, it } from 'vitest';
import {
  attackOutcome,
  combineRollModes,
  createStartingStats,
  creationPointsSpent,
  damageDealt,
  defenseOf,
  DIFFICULTY,
  isValidCreationSpread,
  makeCheck,
  maxHitPoints,
  parseDice,
  resolveAttack,
  rollD20,
  rollDice,
  rollDie,
  statModifier,
  statPointsFromLevels,
  applyStatChanges,
  type AttackProfile,
} from '../../src/engine';

const seeds = Array.from({ length: 500 }, (_, i) => i * 7919 + 1);

describe('seeded dice', () => {
  it('gives the same roll for the same seed', () => {
    expect(rollDie(1234, 20)).toEqual(rollDie(1234, 20));
  });

  it('stays in range and reaches both ends of a d20', () => {
    const rolls = seeds.map((s) => rollDie(s, 20).value);
    expect(Math.min(...rolls)).toBe(1);
    expect(Math.max(...rolls)).toBe(20);
  });

  it('advances the seed so consecutive rolls differ', () => {
    let seed = 99;
    const rolls: number[] = [];
    for (let i = 0; i < 50; i++) {
      const r = rollDie(seed, 20);
      rolls.push(r.value);
      seed = r.seed;
    }
    expect(new Set(rolls).size).toBeGreaterThan(5);
  });
});

describe('advantage and disadvantage', () => {
  it('keeps the higher die with advantage and the lower with disadvantage', () => {
    for (const seed of seeds.slice(0, 100)) {
      const adv = rollD20(seed, 'advantage').value;
      const dis = rollD20(seed, 'disadvantage').value;
      expect(adv.dice).toHaveLength(2);
      expect(adv.natural).toBe(Math.max(...adv.dice));
      expect(dis.natural).toBe(Math.min(...dis.dice));
    }
  });

  it('rolls one die normally', () => {
    expect(rollD20(5).value.dice).toHaveLength(1);
  });

  it('cancels out when both apply', () => {
    expect(combineRollModes(true, true)).toBe('normal');
    expect(combineRollModes(true, false)).toBe('advantage');
    expect(combineRollModes(false, true)).toBe('disadvantage');
    expect(combineRollModes(false, false)).toBe('normal');
  });
});

describe('dice notation', () => {
  it('parses dice, bonuses and flat numbers', () => {
    expect(parseDice('1d8')).toEqual({ count: 1, sides: 8, bonus: 0 });
    expect(parseDice('2d6+1')).toEqual({ count: 2, sides: 6, bonus: 1 });
    expect(parseDice('1d4-1')).toEqual({ count: 1, sides: 4, bonus: -1 });
    expect(parseDice('3')).toEqual({ count: 0, sides: 1, bonus: 3 });
  });

  it('rejects nonsense', () => {
    for (const bad of ['', 'd8', '1d', 'sword', '0d6', '1d0', '1d8+']) {
      expect(() => parseDice(bad), bad).toThrow();
    }
  });

  it('rolls within the possible range', () => {
    for (const seed of seeds.slice(0, 200)) {
      const total = rollDice(seed, '2d6+1').value;
      expect(total).toBeGreaterThanOrEqual(3);
      expect(total).toBeLessThanOrEqual(13);
    }
    expect(rollDice(1, '2').value).toBe(2);
  });
});

describe('stats', () => {
  it('uses D&D-style modifiers around a baseline of 10', () => {
    const expected: Record<number, number> = { 6: -2, 7: -2, 8: -1, 9: -1, 10: 0, 11: 0, 12: 1, 13: 1, 14: 2, 18: 4, 20: 5 };
    for (const [stat, mod] of Object.entries(expected)) {
      expect(statModifier(Number(stat)), `stat ${stat}`).toBe(mod);
    }
  });

  it('starts every stat at 8 with nothing spent', () => {
    const stats = createStartingStats();
    expect(Object.values(stats)).toEqual([8, 8, 8, 8, 8, 8]);
    expect(creationPointsSpent(stats)).toBe(0);
  });

  it('allows spending up to 12 points with no cap on a single stat', () => {
    const allInOne = { ...createStartingStats(), strength: 20 };
    expect(creationPointsSpent(allInOne)).toBe(12);
    expect(isValidCreationSpread(allInOne)).toBe(true);
  });

  it('rejects overspending and lowering a stat below 8', () => {
    expect(isValidCreationSpread({ ...createStartingStats(), strength: 21 })).toBe(false);
    expect(isValidCreationSpread({ ...createStartingStats(), strength: 7, agility: 20 })).toBe(false);
  });

  it('grants a stat point at levels 3, 5, 7 and 9', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(statPointsFromLevels)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
  });

  it('applies race changes on top without touching the original', () => {
    const base = createStartingStats();
    const dwarf = applyStatChanges(base, { toughness: 2, strength: 1 });
    expect(dwarf.toughness).toBe(10);
    expect(dwarf.strength).toBe(9);
    expect(base.toughness).toBe(8);
  });
});

describe('checks', () => {
  it('succeeds when d20 + modifier meets the difficulty', () => {
    for (const seed of seeds.slice(0, 200)) {
      const check = makeCheck(seed, 2, DIFFICULTY.standard).value;
      expect(check.total).toBe(check.roll.natural + 2);
      expect(check.success).toBe(check.total >= 12);
    }
  });

  it('uses 8, 12 and 16 as difficulties', () => {
    expect(DIFFICULTY).toEqual({ easy: 8, standard: 12, hard: 16 });
  });
});

describe('attack outcome', () => {
  it('misses on a natural 1 whatever the modifier', () => {
    expect(attackOutcome(1, 50, 10)).toBe('miss');
  });

  it('hits only when the total is above Defense', () => {
    expect(attackOutcome(10, 3, 12)).toBe('hit');
    expect(attackOutcome(9, 3, 12)).toBe('graze');
    expect(attackOutcome(5, 3, 12)).toBe('graze');
  });

  it('crits on a natural 20 even when the total is below Defense', () => {
    expect(attackOutcome(20, -1, 30)).toBe('crit');
  });

  it('crits at the attack threshold, read off the natural die', () => {
    expect(attackOutcome(19, 0, 30, 19)).toBe('crit');
    expect(attackOutcome(18, 5, 30, 19)).toBe('graze');
    expect(attackOutcome(19, 0, 30)).toBe('graze');
  });
});

describe('damage', () => {
  it('deals nothing on a miss', () => {
    expect(damageDealt('miss', 2, 8, 3, 0)).toBe(0);
  });

  it('adds the modifier then subtracts armour on a graze and a hit', () => {
    expect(damageDealt('graze', 2, 8, 3, 1)).toBe(4);
    expect(damageDealt('hit', 2, 8, 3, 1)).toBe(10);
  });

  it('doubles graze, hit and modifier on a crit, then subtracts armour once', () => {
    expect(damageDealt('crit', 2, 8, 3, 0)).toBe(26);
    expect(damageDealt('crit', 2, 8, 3, 4)).toBe(22);
  });

  it('lets armour reduce damage to 0 but not below', () => {
    expect(damageDealt('graze', 2, 8, 1, 10)).toBe(0);
    expect(damageDealt('hit', 2, 1, -1, 0)).toBe(0);
  });
});

describe('resolveAttack', () => {
  const sword: AttackProfile = { kind: 'melee', damageType: 'physical', graze: '2', hit: '1d8' };
  const noArmour = { physical: 0, magic: 0 };

  it('produces every outcome with damage that matches the rules', () => {
    const outcomes = new Set<string>();
    for (const seed of seeds) {
      const r = resolveAttack(seed, { profile: sword, modifier: 2, targetDefense: 12, targetArmour: noArmour }).value;
      outcomes.add(r.outcome);
      if (r.outcome === 'miss') expect(r.damage).toBe(0);
      if (r.outcome === 'graze') expect(r.damage).toBe(4);
      if (r.outcome === 'hit') expect(r.damage).toBeGreaterThanOrEqual(3);
      if (r.outcome === 'hit') expect(r.damage).toBeLessThanOrEqual(10);
      if (r.outcome === 'crit') expect(r.damage).toBeGreaterThanOrEqual(10);
      if (r.outcome === 'crit') expect(r.damage).toBeLessThanOrEqual(24);
    }
    expect(outcomes).toEqual(new Set(['miss', 'graze', 'hit', 'crit']));
  });

  it('uses the armour that matches the damage type', () => {
    const wand: AttackProfile = { kind: 'magic', damageType: 'magic', graze: '5', hit: '5' };
    const armour = { physical: 100, magic: 1 };
    for (const seed of seeds.slice(0, 50)) {
      const r = resolveAttack(seed, { profile: wand, modifier: 0, targetDefense: 10, targetArmour: armour }).value;
      if (r.outcome === 'graze' || r.outcome === 'hit') expect(r.damage).toBe(4);
    }
  });

  it('is reproducible from the seed', () => {
    const input = { profile: sword, modifier: 1, targetDefense: 11, targetArmour: noArmour };
    expect(resolveAttack(777, input)).toEqual(resolveAttack(777, input));
  });
});

describe('derived values', () => {
  const knight = { baseHp: 12, hpPerLevel: 6, baseDefense: 12 };

  it('works out hit points from class, level and Toughness', () => {
    const stats = { ...createStartingStats(), toughness: 14 };
    expect(maxHitPoints(knight, stats, 1)).toBe(14);
    expect(maxHitPoints(knight, stats, 3)).toBe(30);
    expect(maxHitPoints(knight, stats, 1, 5)).toBe(19);
  });

  it('never drops hit points below 1', () => {
    expect(maxHitPoints({ baseHp: 1, hpPerLevel: 1, baseDefense: 9 }, createStartingStats(), 1)).toBe(1);
  });

  it('works out Defense from class base and Agility modifier', () => {
    expect(defenseOf(knight, createStartingStats())).toBe(11);
    expect(defenseOf(knight, { ...createStartingStats(), agility: 14 })).toBe(14);
  });
});
