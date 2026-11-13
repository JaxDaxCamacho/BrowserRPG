import { describe, expect, it } from 'vitest';
import { getClass, getItem, getRace } from '../../src/content';
import {
  addToDice,
  extraDamageDealt,
  formatCoins,
  gearTotals,
  mercSheet,
  resolveAttack,
  spendAmmo,
  STARTING_PURSE,
  toCoins,
  toCopper,
  validateEquipment,
  weaponAttack,
  createStartingStats,
  type AmmoItem,
  type Equipment,
  type WeaponItem,
} from '../../src/engine';

const knightGear = { race: getRace('human'), armourProficiency: 'heavy' as const, getItem, startersOnly: true };

describe('money', () => {
  it('starts every merc with 3 gold, 50 silver and 20 copper', () => {
    expect(toCoins(STARTING_PURSE)).toEqual({ gold: 3, silver: 50, copper: 20 });
    expect(formatCoins(STARTING_PURSE)).toBe('3g 50s 20c');
  });

  it('converts at 100 copper to a silver and 100 silver to a gold', () => {
    expect(toCopper({ gold: 1, silver: 0, copper: 0 })).toBe(10000);
    expect(toCoins(10101)).toEqual({ gold: 1, silver: 1, copper: 1 });
    expect(formatCoins(0)).toBe('0c');
    expect(formatCoins(250)).toBe('2s 50c');
  });
});

describe('equipment rules', () => {
  it('accepts a sword, shield and chainmail on a knight', () => {
    expect(validateEquipment({ mainHand: 'arming-sword', offHand: 'round-shield', body: 'chainmail' }, knightGear)).toEqual([]);
  });

  it('keeps the off hand empty with a two-handed weapon', () => {
    expect(validateEquipment({ mainHand: 'greatsword', offHand: 'buckler' }, knightGear)).toHaveLength(1);
  });

  it('lets a Goliath carry a two-hander with a shield, but not a one-handed weapon', () => {
    const goliath = { ...knightGear, race: getRace('goliath') };
    expect(validateEquipment({ mainHand: 'greataxe', offHand: 'buckler' }, goliath)).toEqual([]);
    expect(validateEquipment({ mainHand: 'arming-sword' }, goliath)).toHaveLength(1);
  });

  it('stops a class wearing armour heavier than it is trained for', () => {
    const wizard = { ...knightGear, armourProficiency: 'none' as const };
    expect(validateEquipment({ mainHand: 'oak-staff', body: 'travellers-robes' }, wizard)).toEqual([]);
    expect(validateEquipment({ mainHand: 'oak-staff', body: 'leather-armour' }, wizard)).toHaveLength(1);
  });

  it('only allows starting gear at creation', () => {
    expect(validateEquipment({ mainHand: 'arming-sword', body: 'scale-mail' }, knightGear)).toHaveLength(1);
    expect(validateEquipment({ mainHand: 'arming-sword', body: 'scale-mail' }, { ...knightGear, startersOnly: false })).toEqual([]);
  });

  it('matches ammunition to the weapon', () => {
    expect(validateEquipment({ mainHand: 'shortbow', ammo: 'arrows' }, knightGear)).toEqual([]);
    expect(validateEquipment({ mainHand: 'shortbow', ammo: 'bolts' }, knightGear)).toHaveLength(1);
    expect(validateEquipment({ mainHand: 'arming-sword', ammo: 'arrows' }, knightGear)).toHaveLength(1);
  });

  it('refuses an item in the wrong slot', () => {
    expect(validateEquipment({ body: 'round-shield' } as Equipment, knightGear)).toHaveLength(1);
  });
});

describe('gear totals and the character sheet', () => {
  it('adds armour penalties, shields and trinkets', () => {
    const totals = gearTotals(
      { mainHand: 'arming-sword', offHand: 'round-shield', body: 'chainmail', neck: 'amulet-of-warding', ring1: 'ring-of-might' },
      getItem,
    );
    expect(totals.defense).toBe(-4 + 2);
    expect(totals.armour).toEqual({ physical: 6, magic: 2 });
    expect(totals.stats).toEqual({ strength: 1 });
  });

  it('collects abilities granted by gear', () => {
    expect(gearTotals({ ring1: 'signet-of-command' }, getItem).abilityIds).toEqual(['rally']);
  });

  it('shows gear on the sheet', () => {
    const merc = { baseStats: { ...createStartingStats(), agility: 14 }, raceChoices: [] };
    const bare = mercSheet(merc, getRace('dwarf'), getClass('knight'), getItem);
    const armed = mercSheet({ ...merc, equipment: { body: 'chainmail', offHand: 'round-shield' } }, getRace('dwarf'), getClass('knight'), getItem);
    expect(armed.defense).toBe(bare.defense - 4 + 2);
    expect(armed.armour).toEqual({ physical: 6, magic: 3 });
  });
});

describe('ammunition', () => {
  const bow = getItem('shortbow') as WeaponItem;

  it('adds dice bonuses', () => {
    expect(addToDice('3', 1)).toBe('4');
    expect(addToDice('1d8', 1)).toBe('1d8+1');
    expect(addToDice('1d8+2', -2)).toBe('1d8');
    expect(addToDice('1', -5)).toBe('0');
  });

  it('folds ammunition bonuses into the attack', () => {
    expect(weaponAttack(bow, getItem('broadhead-arrows') as AmmoItem).hit).toBe('7');
    expect(weaponAttack(bow, getItem('fire-arrows') as AmmoItem).extra).toEqual({ damageType: 'magic', amount: 2 });
    expect(weaponAttack(bow)).toBe(bow.attack);
  });

  it('deals extra damage on grazes and hits, doubled on a crit, against its own armour', () => {
    expect(extraDamageDealt('miss', 2, 0)).toBe(0);
    expect(extraDamageDealt('graze', 2, 0)).toBe(2);
    expect(extraDamageDealt('crit', 2, 1)).toBe(3);
    expect(extraDamageDealt('hit', 2, 5)).toBe(0);
  });

  it('adds fire damage that physical armour does not stop', () => {
    const profile = weaponAttack(bow, getItem('fire-arrows') as AmmoItem);
    for (let seed = 1; seed < 200; seed++) {
      const r = resolveAttack(seed, { profile, modifier: 0, targetDefense: 12, targetArmour: { physical: 50, magic: 0 } }).value;
      if (r.outcome === 'graze' || r.outcome === 'hit') expect(r.damage).toBe(2);
      if (r.outcome === 'crit') expect(r.damage).toBe(4);
    }
  });

  it('spends one shot at a time and runs out', () => {
    let inventory = [{ itemId: 'arrows', quantity: 2 }];
    inventory = spendAmmo(inventory, 'arrows')!;
    expect(inventory).toEqual([{ itemId: 'arrows', quantity: 1 }]);
    inventory = spendAmmo(inventory, 'arrows')!;
    expect(inventory).toEqual([]);
    expect(spendAmmo(inventory, 'arrows')).toBeNull();
  });
});
