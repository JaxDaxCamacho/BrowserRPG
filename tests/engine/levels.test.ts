import { describe, expect, it } from 'vitest';
import { getDialogue, getItem, getRace, PREMADES, premadeToDraft } from '../../src/content';
import {
  addMerc,
  awardXp,
  breakCamp,
  chooseOption,
  enterDungeon,
  finalStats,
  gainXp,
  levelForXp,
  longRest,
  MAX_LEVEL,
  migrateSave,
  setDestination,
  setLeader,
  spendStatPoints,
  startDialogue,
  startNewGame,
  trainingBlocker,
  unspentStatPoints,
  unspentTalentPoints,
  xpForLevel,
  xpProgress,
  type DungeonDefinition,
  type GameState,
  type Merc,
} from '../../src/engine';
import { currentHp, dialogueContext } from '../../src/state/context';

function party(): GameState {
  let s: GameState = { ...startNewGame(3), adventureId: 'greywater-ford' };
  for (const id of ['aldric-vane', 'maelis-thorne']) s = addMerc(s, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  return setLeader(s, 'merc-1');
}

const at = (s: GameState, level: number): GameState => ({
  ...s,
  party: s.party.map((m) => ({ ...m, level, xp: xpForLevel(level) })),
});

const hall: DungeonDefinition = {
  id: 'hall',
  name: 'a test hall',
  width: 6,
  height: 3,
  tiles: ['######', '#....#', '######'],
  start: { x: 1, y: 1 },
  rooms: [],
  features: [{ type: 'goal', id: 'box', name: 'Box', x: 4, y: 1, dialogueId: 'goal-strongbox' }],
};

describe('the XP curve', () => {
  it('costs 200 more for each level, starting at 200 for level 2', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 200, 600, 1200, 2000]);
    expect(xpForLevel(MAX_LEVEL)).toBe(38000);
    for (let l = 2; l < MAX_LEVEL; l++) expect(xpForLevel(l + 1) - xpForLevel(l)).toBe(200 * l);
  });

  it('turns XP into a level, capped at 20', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(199)).toBe(1);
    expect(levelForXp(200)).toBe(2);
    expect(levelForXp(599)).toBe(2);
    expect(levelForXp(1_000_000)).toBe(MAX_LEVEL);
  });

  it('shows progress through the current level', () => {
    expect(xpProgress({ level: 2, xp: 300 })).toEqual({ into: 100, needed: 400, next: 600 });
    expect(xpProgress({ level: MAX_LEVEL, xp: 50000 }).next).toBeNull();
  });
});

describe('gaining XP', () => {
  const merc = (): Merc => party().party[0]!;

  it('levels up the moment the XP is earned, several levels at once if need be', () => {
    expect(gainXp(merc(), 150)).toMatchObject({ levelsGained: 0, merc: { level: 1, xp: 150 } });
    expect(gainXp(merc(), 650)).toMatchObject({ levelsGained: 2, merc: { level: 3, xp: 650 } });
  });

  it('gives nothing to the dead', () => {
    const dead = { ...merc(), dead: true };
    expect(gainXp(dead, 500).merc).toBe(dead);
  });

  it('says who levelled up and what they earned', () => {
    const { lines } = awardXp(party().party, { 'merc-1': 600, 'merc-2': 10 });
    expect(lines).toEqual(['Aldric Vane reaches level 3: +1 stat point, +4 talent points.']);
  });

  it('raises max HP, and the new hit points come in full', () => {
    const before = merc();
    const after = gainXp(before, 200).merc;
    expect(currentHp(after).max).toBeGreaterThan(currentHp(before).max);
    expect(currentHp(after).current).toBe(currentHp(after).max);
  });

  it('levels up from a dialogue XP reward', () => {
    const ending = getDialogue('greywater-ford', 'return');
    let s = startDialogue({ ...party(), flags: { fee: 100 } }, ending);
    s = { ...s, party: s.party.map((m) => ({ ...m, xp: 100 })) };
    s = chooseOption(s, ending, 'hand-over', dialogueContext);
    expect(s.party.every((m) => m.level === 2)).toBe(true);
    expect(s.dialogue!.result!.notes).toEqual(expect.arrayContaining([expect.stringMatching(/reaches level 2/)]));
  });
});

describe('points', () => {
  it('gives 2 talent points a level and a stat point at levels 3, 5, 7…', () => {
    const m = at(party(), 5).party[0]!;
    expect(unspentTalentPoints(m)).toBe(8);
    expect(unspentStatPoints(m)).toBe(2);
    expect(unspentTalentPoints(at(party(), MAX_LEVEL).party[0]!)).toBe(38);
  });

  it('can only be spent at camp or in town', () => {
    const inDungeon = enterDungeon(at(party(), 3), hall);
    expect(trainingBlocker(inDungeon)).toMatch(/camp or back in town/);
    expect(() => spendStatPoints(inDungeon, 'merc-1', ['strength'])).toThrow(/camp or back in town/);
    expect(trainingBlocker({ ...inDungeon, screen: 'adventureSelect' })).toBeNull();
  });

  it('adds spent stat points to the merc’s stats, and will not overspend', () => {
    let s: GameState = { ...at(party(), 5), screen: 'adventureSelect' };
    const before = finalStats(s.party[0]!, getRace(s.party[0]!.raceId));
    s = spendStatPoints(s, 'merc-1', ['strength', 'strength']);
    const after = finalStats(s.party[0]!, getRace(s.party[0]!.raceId));
    expect(after.strength).toBe(before.strength + 2);
    expect(unspentStatPoints(s.party[0]!)).toBe(0);
    expect(() => spendStatPoints(s, 'merc-1', ['agility'])).toThrow(/stat points/);
  });
});

describe('camping', () => {
  it('opens training after a long rest, until the party breaks camp or walks on', () => {
    let s = longRest(enterDungeon(at(party(), 3), hall), { cure: [] }, getItem);
    expect(s.dungeon!.camping).toBe(true);
    expect(trainingBlocker(s)).toBeNull();
    s = spendStatPoints(s, 'merc-1', ['toughness']);
    expect(trainingBlocker(breakCamp(s))).not.toBeNull();
    expect(setDestination(s, hall, { x: 3, y: 1 }).dungeon!.camping).toBe(false);
  });
});

describe('save migration', () => {
  it('adds levelling to a version 7 save and sets levels from XP', () => {
    const s = party();
    const v7 = {
      ...s,
      version: 7,
      party: s.party.map(({ levelStats: _l, talents: _t, ...m }) => ({ ...m, xp: 650, level: 1 })),
    };
    const migrated = migrateSave(v7)!;
    expect(migrated.party[0]).toMatchObject({ level: 3, levelStats: {}, talents: {} });
  });
});

describe('the starting talent point', () => {
  it('every merc has one talent point at level 1', () => {
    const custom = addMerc(startNewGame(1), { ...premadeToDraft(PREMADES.find((p) => p.id === 'aldric-vane')!), premadeId: undefined, startingTalents: [] } as never).party[0]!;
    expect(custom.talents).toEqual({});
    expect(unspentTalentPoints(custom)).toBe(1);
    expect(unspentTalentPoints({ ...custom, level: MAX_LEVEL })).toBe(39);
  });

  it('pre-built mercs come with theirs already placed', () => {
    const aldric = party().party[0]!;
    expect(aldric.talents).toEqual({ 't-taunt': 1 });
    expect(unspentTalentPoints(aldric)).toBe(0);
  });
});
