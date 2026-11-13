import { describe, expect, it } from 'vitest';
import { getClass, getRace, PREMADES, premadeToDraft } from '../../src/content';
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
  validateDraft,
  type GameState,
  type MercDraft,
} from '../../src/engine';
import { createMemorySaveStore } from '../../src/platform/saveStore';

function draft(overrides: Partial<MercDraft> = {}): MercDraft {
  return {
    name: 'Tester',
    raceId: 'dwarf',
    classId: 'knight',
    baseStats: { ...createStartingStats(), strength: 14, toughness: 14 },
    raceChoices: [],
    ...overrides,
  };
}

function fullParty(): GameState {
  let state = startNewGame(1);
  for (const premade of PREMADES.slice(0, PARTY_SIZE)) state = addMerc(state, premadeToDraft(premade));
  return state;
}

describe('validateDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateDraft(draft(), getRace('dwarf'))).toEqual([]);
  });

  it('needs a name', () => {
    expect(validateDraft(draft({ name: '   ' }), getRace('dwarf'))).toHaveLength(1);
  });

  it('needs every stat point spent', () => {
    const unspent = draft({ baseStats: { ...createStartingStats(), strength: 10 } });
    expect(validateDraft(unspent, getRace('dwarf'))[0]).toMatch(/remaining 10 stat points/);
  });

  it('rejects overspending', () => {
    const over = draft({ baseStats: { ...createStartingStats(), strength: 30 } });
    expect(validateDraft(over, getRace('dwarf'))).toHaveLength(1);
  });

  it('needs exactly two different stats for the Human bonus', () => {
    const human = getRace('human');
    expect(validateDraft(draft({ raceChoices: [] }), human)).toHaveLength(1);
    expect(validateDraft(draft({ raceChoices: ['strength'] }), human)).toHaveLength(1);
    expect(validateDraft(draft({ raceChoices: ['strength', 'strength'] }), human)).toHaveLength(1);
    expect(validateDraft(draft({ raceChoices: ['strength', 'agility'] }), human)).toEqual([]);
  });

  it('rejects stat choices for a race that has none', () => {
    expect(validateDraft(draft({ raceChoices: ['strength'] }), getRace('dwarf'))).toHaveLength(1);
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
    const sheet = mercSheet(draft(), getRace('dwarf'), getClass('knight'));
    expect(sheet.maxHp).toBe(15); // 12 base + 3 from Toughness 16
    expect(sheet.defense).toBe(11); // 12 base - 1 from Agility 8
    expect(sheet.armour).toEqual({ physical: 0, magic: 3 });
  });

  it('adds the Goliath HP bonus', () => {
    const sheet = mercSheet(draft({ raceId: 'goliath' }), getRace('goliath'), getClass('barbarian'));
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
