import { describe, expect, it } from 'vitest';
import { adventureSchema, ADVENTURES, getAdventure, getDialogue, PREMADES, premadeToDraft } from '../../src/content';
import {
  addMerc,
  canLeave,
  chooseOption,
  completeAdventure,
  continueDialogue,
  COPPER_PER_GOLD,
  enterDungeon,
  isAdventureComplete,
  leaveDungeon,
  migrateSave,
  setDestination,
  setLeader,
  startDialogue,
  startNewGame,
  stepParty,
  type DungeonDefinition,
  type GameState,
} from '../../src/engine';
import { dialogueContext, dungeonContext } from '../../src/state/context';

function party(seed = 3): GameState {
  let state: GameState = { ...startNewGame(seed), adventureId: 'greywater-ford' };
  for (const id of ['aldric-vane', 'maelis-thorne', 'sylwen-ashbow', 'pip-larkspur']) {
    state = addMerc(state, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  }
  return setLeader(state, 'merc-1');
}

/** A corridor with the goal at the far end and nothing in the way. */
const corridor: DungeonDefinition = {
  id: 'corridor',
  name: 'a test corridor',
  width: 7,
  height: 3,
  tiles: ['#######', '#.....#', '#######'],
  start: { x: 1, y: 1 },
  rooms: [],
  features: [{ type: 'goal', id: 'box', name: 'Box', x: 5, y: 1, dialogueId: 'goal-strongbox' }],
};

function walk(state: GameState, def: DungeonDefinition, x: number, y: number): GameState {
  let s = setDestination(state, def, { x, y });
  for (let i = 0; i < 50 && s.screen === 'dungeon' && (s.dungeon?.path.length ?? 0) > 0; i++) {
    s = stepParty(s, def, dungeonContext(s));
  }
  return s;
}

/** Into the corridor, take the strongbox, and back on the map. */
function withStrongbox(): GameState {
  // Sight reaches two tiles, so walk in two legs as a player would.
  let s = walk(walk(enterDungeon(party(), corridor), corridor, 3, 1), corridor, 5, 1);
  const goal = getDialogue('greywater-ford', 'goal-strongbox');
  s = chooseOption(s, goal, 'take', dialogueContext);
  return continueDialogue(s, dialogueContext);
}

const leaderPurse = (s: GameState) => s.party.find((m) => m.id === s.leaderId)!.purse;

describe('leaving a dungeon', () => {
  it('is not possible before the goal is done', () => {
    const s = walk(enterDungeon(party(), corridor), corridor, 3, 1);
    const back = walk(s, corridor, 1, 1);
    expect(back.screen).toBe('dungeon');
    expect(canLeave(back, corridor)).toBe(false);
    expect(leaveDungeon(back, corridor, dungeonContext(back))).toBe(back);
  });

  it('opens the ending when the party walks back to the entrance with the goal done', () => {
    const s = withStrongbox();
    expect(s.screen).toBe('dungeon');
    expect(s.flags.hasStrongbox).toBe(true);
    const out = walk(s, corridor, 1, 1);
    expect(out.screen).toBe('dialogue');
    expect(out.dialogue).toMatchObject({ dialogueId: 'return', nodeId: 'office' });
  });

  it('does not leave when the entrance is only passed through on the way somewhere', () => {
    // Start in the middle so the walk to the far end crosses nothing, then cross the entrance tile mid-path.
    const middle: DungeonDefinition = { ...corridor, start: { x: 3, y: 1 } };
    let s = walk(enterDungeon(party(), middle), middle, 5, 1);
    s = continueDialogue(chooseOption(s, getDialogue('greywater-ford', 'goal-strongbox'), 'take', dialogueContext), dialogueContext);
    s = walk(s, middle, 1, 1);
    expect(s.screen).toBe('dungeon');
    expect(s.dungeon!.pos).toEqual({ x: 1, y: 1 });
  });

  it('finishes the adventure at once when it has no ending dialogue', () => {
    const s = withStrongbox();
    const ctx = { ...dungeonContext(s), endingDialogue: () => null };
    let out = setDestination(s, corridor, corridor.start);
    while (out.screen === 'dungeon' && out.dungeon!.path.length > 0) out = stepParty(out, corridor, ctx);
    expect(out.screen).toBe('adventureSelect');
    expect(out.completedAdventures).toEqual(['greywater-ford']);
    expect(out.dungeon).toBeNull();
  });
});

describe('the Greywater ending', () => {
  const ending = getDialogue('greywater-ford', 'return');
  const atDesk = (fee: number, flags: Record<string, boolean> = {}) => {
    const s = withStrongbox();
    return startDialogue({ ...s, flags: { ...s.flags, fee, ...flags } }, ending);
  };

  it('pays the agreed fee to the leader and gives everyone XP', () => {
    const s = atDesk(150);
    const before = leaderPurse(s);
    const paid = chooseOption(s, ending, 'hand-over', dialogueContext);
    expect(leaderPurse(paid) - before).toBe(150 * COPPER_PER_GOLD);
    expect(paid.party.every((m) => m.xp === 150)).toBe(true);
    expect(paid.dialogue!.result!.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/receives 150g/), 'Everyone gains 150 XP.']),
    );
  });

  it('pays a bonus for the freed guard, once', () => {
    let s = continueDialogue(chooseOption(atDesk(100, { warnedAboutHall: true }), ending, 'hand-over', dialogueContext), dialogueContext);
    const before = leaderPurse(s);
    s = continueDialogue(chooseOption(s, ending, 'mention-guard', dialogueContext), dialogueContext);
    expect(leaderPurse(s) - before).toBe(20 * COPPER_PER_GOLD);
    expect(() => chooseOption(s, ending, 'mention-guard', dialogueContext)).toThrow(/not available/);
  });

  it('completes the contract and returns to adventure select with the party rested', () => {
    let s = atDesk(100);
    s = { ...s, party: s.party.map((m, i) => (i === 0 ? { ...m, wounds: 5 } : m)) };
    s = continueDialogue(chooseOption(s, ending, 'hand-over', dialogueContext), dialogueContext);
    s = chooseOption(s, ending, 'leave', dialogueContext);
    expect(s.completedAdventures).toEqual(['greywater-ford']);
    expect(s.party[0]!.wounds).toBe(0);
    // The result is still on screen, inside the adventure.
    expect(s.screen).toBe('dialogue');
    expect(s.adventureId).toBe('greywater-ford');
    s = continueDialogue(s, dialogueContext);
    expect(s).toMatchObject({ screen: 'adventureSelect', adventureId: null, dialogue: null, dungeon: null, encounter: null });
    expect(isAdventureComplete(s, 'greywater-ford')).toBe(true);
  });
});

describe('completing adventures', () => {
  it('records each adventure once and leaves the dead dead', () => {
    let s = party();
    s = { ...s, party: s.party.map((m, i) => (i === 1 ? { ...m, dead: true, wounds: 9, down: true } : { ...m, wounds: 3, down: true })) };
    s = completeAdventure(completeAdventure(s));
    expect(s.completedAdventures).toEqual(['greywater-ford']);
    expect(s.party[0]).toMatchObject({ wounds: 0, down: false });
    expect(s.party[1]).toMatchObject({ dead: true, wounds: 9 });
  });

  it('every shipped ending marks its adventure complete', () => {
    for (const adventure of ADVENTURES) {
      if (!adventure.ending) continue;
      const effects = getDialogue(adventure.id, adventure.ending)
        .nodes.flatMap((n) => n.options)
        .flatMap((o) => [o.outcome, o.success, o.failure])
        .flatMap((o) => o?.effects ?? []);
      expect(effects.some((e) => e.type === 'completeAdventure'), adventure.id).toBe(true);
    }
    expect(getAdventure('greywater-ford').ending).toBe('return');
  });

  it('rejects an ending that is not one of the adventure dialogues', () => {
    const bad = { ...getAdventure('greywater-ford'), ending: 'nowhere' };
    expect(adventureSchema.safeParse(bad).success).toBe(false);
  });

  it('upgrades a version 6 save with no finished adventures', () => {
    const v6 = { ...startNewGame(1), version: 6 } as Record<string, unknown>;
    delete v6.completedAdventures;
    expect(migrateSave(v6)!.completedAdventures).toEqual([]);
  });
});
