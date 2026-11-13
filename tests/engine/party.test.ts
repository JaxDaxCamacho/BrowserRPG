import { describe, expect, it } from 'vitest';
import { getClass, getItem, getRace, PREMADES, premadeToDraft } from '../../src/content';
import {
  addMerc,
  confirmLeader,
  confirmParty,
  createStartingStats,
  finalStats,
  getLeader,
  isPartyFull,
  mercSheet,
  migrateSave,
  PARTY_SIZE,
  removeMerc,
  setLeader,
  startNewGame,
  STARTING_PURSE,
  validateDraft,
  type GameState,
  type MercDraft,
  type RaceDefinition,
} from '../../src/engine';
import { createMemorySaveStore } from '../../src/platform/saveStore';

function draft(overrides: Partial<MercDraft> = {}): MercDraft {
  return {
    name: 'Tester',
    raceId: 'dwarf',
    classId: 'knight',
    baseStats: { ...createStartingStats(), strength: 14, toughness: 14 },
    raceChoices: [],
    loadout: { mainHand: 'arming-sword' },
    ...overrides,
  };
}

const knightGear = { armourProficiency: 'heavy' as const, getItem };

function check(d: MercDraft, race: RaceDefinition = getRace('dwarf')): string[] {
  return validateDraft(d, race, knightGear);
}

function fullParty(): GameState {
  let state = startNewGame(1);
  for (const premade of PREMADES.slice(0, PARTY_SIZE)) state = addMerc(state, premadeToDraft(premade));
  return state;
}

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    expect(check(draft())).toEqual([]);
  });

  it('needs a name', () => {
    expect(check(draft({ name: '   ' }))).toHaveLength(1);
  });

  it('needs every stat point spent', () => {
    const unspent = draft({ baseStats: { ...createStartingStats(), strength: 10 } });
    expect(check(unspent)[0]).toMatch(/remaining 10 stat points/);
  });

  it('rejects overspending', () => {
    const over = draft({ baseStats: { ...createStartingStats(), strength: 30 } });
    expect(check(over)).toHaveLength(1);
  });

  it('needs exactly two different stats for the Human bonus', () => {
    const human = getRace('human');
    expect(check(draft({ raceChoices: [] }), human)).toHaveLength(1);
    expect(check(draft({ raceChoices: ['strength'] }), human)).toHaveLength(1);
    expect(check(draft({ raceChoices: ['strength', 'strength'] }), human)).toHaveLength(1);
    expect(check(draft({ raceChoices: ['strength', 'agility'] }), human)).toEqual([]);
  });

  it('rejects stat choices for a race that has none', () => {
    expect(check(draft({ raceChoices: ['strength'] }))).toHaveLength(1);
  });

  it('needs a weapon', () => {
    expect(check(draft({ loadout: {} }))).toEqual(['Choose a weapon.']);
  });

  it('needs ammunition for a bow', () => {
    expect(check(draft({ loadout: { mainHand: 'shortbow' } }))).toEqual(['The Shortbow needs ammunition.']);
    expect(check(draft({ loadout: { mainHand: 'shortbow', ammo: 'arrows' } }))).toEqual([]);
  });

  it('refuses gear that is not starting gear', () => {
    expect(check(draft({ loadout: { mainHand: 'arming-sword', body: 'warded-plate' } }))).toHaveLength(1);
  });
});

describe('starting kit', () => {
  it('equips the loadout, packs 20 arrows and fills the purse', () => {
    const state = addMerc(startNewGame(1), draft({ loadout: { mainHand: 'shortbow', body: 'leather-armour', ammo: 'arrows' } }));
    const merc = state.party[0]!;
    expect(merc.equipment).toEqual({ mainHand: 'shortbow', body: 'leather-armour', ammo: 'arrows' });
    expect(merc.inventory).toEqual([{ itemId: 'arrows', quantity: 20 }]);
    expect(merc.purse).toBe(STARTING_PURSE);
    expect('loadout' in merc).toBe(false);
  });

  it('gives every pre-built merc a valid kit and a portrait', () => {
    for (const premade of PREMADES) {
      const cls = getClass(premade.classId);
      expect(validateDraft(premadeToDraft(premade), getRace(premade.raceId), { armourProficiency: cls.armour, getItem })).toEqual([]);
      expect(premade.portrait).toBeTruthy();
    }
  });
});

describe('merc sheet', () => {
  it('applies fixed race changes on top of the spent points', () => {
    const stats = finalStats(draft(), getRace('dwarf'));
    expect(stats.toughness).toBe(16);
    expect(stats.strength).toBe(15);
  });

  it('applies chosen Human bonuses', () => {
    const stats = finalStats(draft({ raceChoices: ['agility', 'charisma'] }), getRace('human'));
    expect(stats.agility).toBe(9);
    expect(stats.charisma).toBe(9);
    expect(stats.strength).toBe(14);
  });

  it('works out HP, Defense and race armour', () => {
    const sheet = mercSheet(draft(), getRace('dwarf'), getClass('knight'), getItem);
    expect(sheet.maxHp).toBe(15); // 12 base + 3 from Toughness 16
    expect(sheet.defense).toBe(11); // 12 base - 1 from Agility 8
    expect(sheet.armour).toEqual({ physical: 0, magic: 3 });
  });

  it('adds the Goliath HP bonus', () => {
    const sheet = mercSheet(draft({ raceId: 'goliath' }), getRace('goliath'), getClass('barbarian'), getItem);
    expect(sheet.maxHp).toBe(14 + 2 + 5); // 14 base, +2 from Toughness 15, +5 racial
  });
});

describe('party', () => {
  it('adds mercs with unique ids at level 1', () => {
    let state = startNewGame(1);
    state = addMerc(state, draft({ name: '  Padded  ' }));
    state = addMerc(state, draft({ name: 'Second' }));
    expect(state.party.map((m) => m.id)).toEqual(['merc-1', 'merc-2']);
    expect(state.party[0]).toMatchObject({ name: 'Padded', level: 1, xp: 0 });
  });

  it('holds exactly four and refuses a fifth', () => {
    const state = fullParty();
    expect(state.party).toHaveLength(4);
    expect(isPartyFull(state)).toBe(true);
    expect(() => addMerc(state, draft())).toThrow();
  });

  it('refuses the same pre-built merc twice', () => {
    const first = premadeToDraft(PREMADES[0]!);
    const state = addMerc(startNewGame(1), first);
    expect(() => addMerc(state, first)).toThrow(/already in the party/);
  });

  it('never reuses an id after a merc is removed', () => {
    let state = addMerc(startNewGame(1), draft());
    state = removeMerc(state, 'merc-1');
    state = addMerc(state, draft());
    expect(state.party.map((m) => m.id)).toEqual(['merc-2']);
  });

  it('cannot move on until the party is full', () => {
    expect(() => confirmParty(addMerc(startNewGame(1), draft()))).toThrow();
    expect(confirmParty(fullParty()).screen).toBe('leaderSelect');
  });

  it('sets a leader, and clears it when that merc is removed', () => {
    let state = setLeader(fullParty(), 'merc-2');
    expect(getLeader(state)?.id).toBe('merc-2');
    state = removeMerc(state, 'merc-2');
    expect(state.leaderId).toBeNull();
  });

  it('refuses a leader who is not in the party', () => {
    expect(() => setLeader(fullParty(), 'merc-99')).toThrow();
  });

  it('cannot move on without a leader', () => {
    const state = confirmParty(fullParty());
    expect(() => confirmLeader(state)).toThrow();
    expect(confirmLeader(setLeader(state, 'merc-1')).screen).toBe('adventureSelect');
  });
});

describe('pre-built roster', () => {
  it('has eight mercs covering every class', () => {
    expect(PREMADES).toHaveLength(8);
    expect(new Set(PREMADES.map((p) => p.classId)).size).toBe(6);
  });
});

describe('saves', () => {
  it('restores a party exactly after a save and load', async () => {
    const store = createMemorySaveStore(() => 1000);
    const state = setLeader(confirmParty(fullParty()), 'merc-3');
    await store.save('slot-1', state);
    const [record] = await store.list();
    expect(record).toEqual({ slotId: 'slot-1', savedAt: 1000, state });
  });

  it('keeps slots separate and removes them', async () => {
    const store = createMemorySaveStore();
    await store.save('slot-1', startNewGame(1));
    await store.save('slot-2', fullParty());
    expect(await store.list()).toHaveLength(2);
    await store.remove('slot-1');
    expect((await store.list()).map((r) => r.slotId)).toEqual(['slot-2']);
  });

  it('refuses data that is not a save this build can run', () => {
    expect(migrateSave(null)).toBeNull();
    expect(migrateSave('nonsense')).toBeNull();
    expect(migrateSave({ ...startNewGame(1), version: 999 })).toBeNull();
    expect(migrateSave({ ...startNewGame(1), screen: 'nowhere' })).toBeNull();
    expect(migrateSave(startNewGame(1))).not.toBeNull();
  });
});
