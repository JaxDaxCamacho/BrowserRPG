import { describe, expect, it } from 'vitest';
import {
  CLASSES,
  checkCollection,
  classSchema,
  CONTENT,
  getClass,
  getItem,
  getRace,
  itemSchema,
  ITEMS,
  parseList,
  RACES,
} from '../../src/content';
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
    expect(ITEMS.length).toBeGreaterThan(0);
  });

  it('give every class and race an icon', () => {
    expect(CLASSES.every((c) => c.icon)).toBe(true);
    expect(RACES.every((r) => r.icon)).toBe(true);
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
});

describe('gear rules in the item schema', () => {
  const sword = getItem('arming-sword');
  const check = (item: unknown) => itemSchema.safeParse(item).success;

  it('accepts every shipped item', () => {
    expect(ITEMS.every(check)).toBe(true);
  });

  it('gives basic weapons the agreed damage by style', () => {
    const profile = (id: string) => {
      const item = getItem(id);
      return item.kind === 'weapon' ? [item.attack.graze, item.attack.hit] : null;
    };
    expect(profile('arming-sword')).toEqual(['3', '6']);
    expect(profile('hand-axe')).toEqual(['3', '6']);
    expect(profile('mace')).toEqual(['4', '5']);
    expect(profile('spear')).toEqual(['2', '7']);
  });

  it('keeps ranged weapons below melee damage', () => {
    const total = (id: string) => {
      const item = getItem(id);
      return item.kind === 'weapon' ? Number(item.attack.graze) + Number(item.attack.hit) : 0;
    };
    expect(total('shortbow')).toBeLessThan(total('spear'));
    expect(total('light-crossbow')).toBeLessThan(total('spear'));
  });

  it('rejects bad dice notation and a melee weapon with range', () => {
    if (sword.kind !== 'weapon') throw new Error('expected a weapon');
    expect(check({ ...sword, attack: { ...sword.attack, hit: 'big' } })).toBe(false);
    expect(check({ ...sword, range: 2 })).toBe(false);
  });

  it('refuses bonuses on starting gear', () => {
    expect(check({ ...sword, effects: [{ type: 'stat', stat: 'strength', amount: 1 }] })).toBe(false);
    expect(check({ ...sword, starter: false, effects: [{ type: 'stat', stat: 'strength', amount: 1 }] })).toBe(true);
  });

  it('holds body armour to its weight band', () => {
    const leather = getItem('leather-armour');
    expect(check({ ...leather, defense: -1 })).toBe(false);
    expect(check({ ...leather, physicalArmour: 3 })).toBe(false);
    const chain = getItem('chainmail');
    expect(check({ ...chain, defense: -3 })).toBe(false);
    expect(check({ ...chain, physicalArmour: 13 })).toBe(false);
    expect(check({ ...chain, defense: -6, physicalArmour: 12, magicArmour: 4 })).toBe(true);
  });

  it('gives shields Defense but no armour field', () => {
    expect(check({ ...getItem('round-shield'), physicalArmour: 2 })).toBe(false);
  });

  it('needs a duration for potions with lasting effects', () => {
    const tonic = getItem('stoneskin-tonic');
    expect(check({ ...tonic, encounters: undefined })).toBe(false);
    expect(check({ ...getItem('healing-draught') })).toBe(true);
  });
});

describe('editor save checks', () => {
  it('accept the content as it is', () => {
    expect(checkCollection('items', CONTENT.items, CONTENT)).toEqual([]);
  });

  it('catch an item a pre-built merc still uses being deleted', () => {
    const without = CONTENT.items.filter((i) => i.id !== 'chainmail');
    expect(checkCollection('items', without, CONTENT).join('\n')).toMatch(/aldric-vane.*chainmail/);
  });

  it('catch an ability a monster still uses being deleted', () => {
    const without = CONTENT.abilities.filter((a) => a.id !== 'rally');
    const problems = checkCollection('abilities', without, CONTENT).join('\n');
    expect(problems).toMatch(/bandit-captain/);
    expect(problems).toMatch(/signet-of-command/);
  });

  it('report schema errors instead of throwing', () => {
    const problems = checkCollection('items', [{ id: 'Bad Id' }], CONTENT);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Invalid gear data/);
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
