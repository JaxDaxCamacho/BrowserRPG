import { describe, expect, it } from 'vitest';
import { CLASSES, classSchema, getClass, getRace, getWeapon, parseList, RACES, weaponSchema, WEAPONS } from '../../src/content';
import {
  raceBaseArmour,
  raceBonusHp,
  raceCanWield,
  raceCritThreshold,
  raceDeathSaveDifficulty,
  raceHandsUsed,
  raceXpMultiplier,
} from '../../src/engine';

describe('content files', () => {
  it('load and validate', () => {
    expect(CLASSES.map((c) => c.id)).toEqual(['knight', 'barbarian', 'ranger', 'wizard', 'warlock', 'rogue']);
    expect(RACES.map((r) => r.id)).toEqual(['human', 'dwarf', 'elf', 'goliath', 'cursed']);
    expect(WEAPONS.length).toBeGreaterThan(0);
  });

  it('look up by id and fail clearly on an unknown one', () => {
    expect(getClass('knight').baseDefense).toBe(12);
    expect(() => getClass('bard')).toThrow('Unknown class: "bard"');
  });

  it('reject bad data with a readable message', () => {
    const bad = [{ ...getClass('knight'), baseHp: -3 }];
    expect(() => parseList(classSchema, bad, 'class')).toThrow(/Invalid class data/);
  });

  it('reject duplicate ids', () => {
    const twice = [getClass('knight'), getClass('knight')];
    expect(() => parseList(classSchema, twice, 'class')).toThrow(/used twice/);
  });

  it('reject bad dice notation and a melee weapon with range', () => {
    const sword = getWeapon('longsword');
    expect(() => parseList(weaponSchema, [{ ...sword, attack: { ...sword.attack, hit: 'big' } }], 'weapon')).toThrow();
    expect(() => parseList(weaponSchema, [{ ...sword, range: 2 }], 'weapon')).toThrow();
  });
});

describe('race passives', () => {
  it('Human earns 3% more XP', () => {
    expect(raceXpMultiplier(getRace('human'))).toBeCloseTo(1.03);
    expect(raceXpMultiplier(getRace('elf'))).toBe(1);
  });

  it('Dwarf has 3 base magic armour and no physical', () => {
    expect(raceBaseArmour(getRace('dwarf'), 'magic')).toBe(3);
    expect(raceBaseArmour(getRace('dwarf'), 'physical')).toBe(0);
    expect(raceBaseArmour(getRace('human'), 'magic')).toBe(0);
  });

  it('Elf crits on 19 with bows, swords and daggers only', () => {
    const elf = getRace('elf');
    expect(raceCritThreshold(elf, 'bow')).toBe(19);
    expect(raceCritThreshold(elf, 'sword')).toBe(19);
    expect(raceCritThreshold(elf, 'dagger')).toBe(19);
    expect(raceCritThreshold(elf, 'axe')).toBe(20);
    expect(raceCritThreshold(getRace('human'), 'bow')).toBe(20);
  });

  it('keeps a weapon threshold that is already lower than the racial one', () => {
    expect(raceCritThreshold(getRace('elf'), 'dagger', 18)).toBe(18);
  });

  it('Goliath has +5 HP, wields two-handed weapons in one hand and cannot use one-handed ones', () => {
    const goliath = getRace('goliath');
    expect(raceBonusHp(goliath)).toBe(5);
    expect(raceCanWield(goliath, 2)).toBe(true);
    expect(raceCanWield(goliath, 1)).toBe(false);
    expect(raceHandsUsed(goliath, 2)).toBe(1);
    expect(raceCanWield(getRace('human'), 1)).toBe(true);
    expect(raceHandsUsed(getRace('human'), 2)).toBe(2);
  });

  it('Cursed is knocked down instead of dead on 11 or more', () => {
    expect(raceDeathSaveDifficulty(getRace('cursed'))).toBe(11);
    expect(raceDeathSaveDifficulty(getRace('human'))).toBeNull();
  });
});
