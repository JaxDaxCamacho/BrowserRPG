import { describe, expect, it } from 'vitest';
import { ADVENTURES, dialogueSchema, getDialogue, PREMADES, premadeToDraft } from '../../src/content';
import {
  addMerc,
  checkMaker,
  chooseOption,
  continueDialogue,
  createStartingStats,
  currentNode,
  migrateSave,
  SAVE_VERSION,
  setLeader,
  startAdventure,
  startDialogue,
  startNewGame,
  unmetConditions,
  type DialogueContext,
  type DialogueDefinition,
  type GameState,
} from '../../src/engine';
import { dialogueContext } from '../../src/state/context';

const talk: DialogueDefinition = {
  id: 'talk',
  start: 'a',
  nodes: [
    {
      id: 'a',
      text: 'A stranger blocks the road.',
      options: [
        { id: 'pass', text: 'Walk past.', outcome: { goto: 'b' } },
        {
          id: 'pay',
          text: 'Pay the toll.',
          outcome: { text: 'He takes your coin.', effects: [{ type: 'gold', amount: -5 }], goto: 'b' },
        },
        {
          id: 'push',
          text: 'Shove him aside.',
          check: { stat: 'strength', difficulty: 12, by: 'best' },
          success: { text: 'He stumbles.', effects: [{ type: 'setFlag', flag: 'shoved', value: true }], goto: 'b' },
          failure: { text: 'He does not move.', end: 'combat' },
        },
        {
          id: 'spell',
          text: 'Have your Wizard blind him.',
          requires: [{ type: 'partyHasClass', classId: 'wizard' }],
          outcome: { goto: 'b' },
        },
      ],
    },
    { id: 'b', text: 'The road is clear.', options: [{ id: 'go', text: 'Go on.', outcome: { end: 'dungeon' } }] },
  ],
};

/** Every merc has the same flat stats, so the modifier is known. */
function flatContext(value: number): DialogueContext {
  return { statsOf: () => ({ ...createStartingStats(), strength: value }) };
}

function party(...premadeIds: string[]): GameState {
  let state = { ...startNewGame(7), gold: 20 };
  for (const id of premadeIds) state = addMerc(state, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  return state;
}

const knights = () => startDialogue(party('aldric-vane', 'brunna-stonehand'), talk);

describe('dialogue', () => {
  it('starts on the start node and shows the dialogue screen', () => {
    const state = knights();
    expect(state.screen).toBe('dialogue');
    expect(currentNode(state, talk).id).toBe('a');
  });

  it('moves straight on when an outcome has no text', () => {
    const state = chooseOption(knights(), talk, 'pass', flatContext(10));
    expect(state.dialogue).toMatchObject({ nodeId: 'b', result: null });
  });

  it('applies effects, then waits on the result text until continued', () => {
    const shown = chooseOption(knights(), talk, 'pay', flatContext(10));
    expect(shown.gold).toBe(15);
    expect(shown.dialogue?.nodeId).toBe('a');
    expect(shown.dialogue?.result).toMatchObject({ text: 'He takes your coin.', check: null });
    expect(continueDialogue(shown).dialogue).toMatchObject({ nodeId: 'b', result: null });
  });

  it('refuses a second choice while a result is showing', () => {
    const shown = chooseOption(knights(), talk, 'pay', flatContext(10));
    expect(() => chooseOption(shown, talk, 'pass', flatContext(10))).toThrow();
  });

  it('ends on the screen the outcome names', () => {
    const atB = chooseOption(knights(), talk, 'pass', flatContext(10));
    const done = chooseOption(atB, talk, 'go', flatContext(10));
    expect(done.dialogue).toBeNull();
    expect(done.screen).toBe('dungeon');
  });

  it('rolls a check, uses the seed, and follows success or failure', () => {
    const seen = new Set<boolean>();
    for (let seed = 1; seed <= 60; seed++) {
      const start = { ...knights(), rngSeed: seed };
      const after = chooseOption(start, talk, 'push', flatContext(14));
      const check = after.dialogue!.result!.check!;
      expect(check.modifier).toBe(2);
      expect(check.success).toBe(check.total >= 12);
      expect(after.rngSeed).not.toBe(seed);
      seen.add(check.success);

      const moved = continueDialogue(after);
      if (check.success) {
        expect(after.flags.shoved).toBe(true);
        expect(moved.dialogue?.nodeId).toBe('b');
      } else {
        expect(after.flags.shoved).toBeUndefined();
        expect(moved.screen).toBe('combat');
        expect(moved.dialogue).toBeNull();
      }
    }
    expect(seen).toEqual(new Set([true, false]));
  });

  it('gives the same roll for the same seed', () => {
    const a = chooseOption(knights(), talk, 'push', flatContext(12));
    const b = chooseOption(knights(), talk, 'push', flatContext(12));
    expect(a).toEqual(b);
  });

  it('locks an option whose condition is not met', () => {
    const state = knights();
    const spell = talk.nodes[0]!.options[3]!;
    expect(unmetConditions(state, spell)).toHaveLength(1);
    expect(() => chooseOption(state, talk, 'spell', flatContext(10))).toThrow(/not available/);
  });

  it('unlocks it when the party has the class', () => {
    const state = startDialogue(party('aldric-vane', 'maelis-thorne'), talk);
    expect(unmetConditions(state, talk.nodes[0]!.options[3]!)).toEqual([]);
    expect(chooseOption(state, talk, 'spell', flatContext(10)).dialogue?.nodeId).toBe('b');
  });

  it('never lets gold go below zero', () => {
    const broke = { ...knights(), gold: 2 };
    expect(chooseOption(broke, talk, 'pay', flatContext(10)).gold).toBe(0);
  });
});

describe('who makes a check', () => {
  const state = setLeader(party('maelis-thorne', 'korg-the-unbowed'), 'merc-1');

  it('uses the leader for leader checks', () => {
    const maker = checkMaker(state, { stat: 'strength', difficulty: 12, by: 'leader' }, dialogueContext);
    expect(maker.merc.name).toBe('Maelis Thorne');
    expect(maker.modifier).toBe(-1);
  });

  it('uses the strongest merc for best checks', () => {
    const maker = checkMaker(state, { stat: 'strength', difficulty: 12, by: 'best' }, dialogueContext);
    expect(maker.merc.name).toBe('Korg the Unbowed');
    expect(maker.modifier).toBe(3);
  });
});

describe('the Greywater Ford debrief', () => {
  const adventure = ADVENTURES[0]!;
  const debrief = getDialogue(adventure.id, adventure.debrief);

  function play(seed: number, ...optionIds: string[]): GameState {
    let state = setLeader(party('aldric-vane', 'korg-the-unbowed', 'sylwen-ashbow', 'vesper'), 'merc-1');
    state = startAdventure({ ...state, rngSeed: seed }, adventure.id, debrief);
    for (const optionId of optionIds) {
      state = continueDialogue(chooseOption(state, debrief, optionId, dialogueContext));
    }
    return state;
  }

  it('plays from the office to setting out', () => {
    const state = play(1, 'ask-ford', 'to-pay', 'accept', 'set-out');
    expect(state.adventureId).toBe('greywater-ford');
    expect(state.screen).toBe('dungeon');
    expect(state.dialogue).toBeNull();
    expect(state.flags).toMatchObject({ fee: 100, debriefDone: true });
  });

  it('sets the fee from the negotiation check either way', () => {
    const fees = new Set<unknown>();
    for (let seed = 1; seed <= 40; seed++) fees.add(play(seed, 'ask-pay', 'negotiate').flags.fee);
    expect(fees).toEqual(new Set([100, 150]));
  });

  it('offers intimidation only with a Barbarian in the party', () => {
    const withKorg = play(1, 'ask-pay');
    const intimidate = currentNode(withKorg, debrief).options.find((o) => o.id === 'intimidate')!;
    expect(unmetConditions(withKorg, intimidate)).toEqual([]);

    let without = startAdventure(party('aldric-vane', 'vesper'), adventure.id, debrief);
    without = chooseOption(without, debrief, 'ask-pay', dialogueContext);
    expect(unmetConditions(without, intimidate)).toHaveLength(1);
  });
});

describe('dialogue data checks', () => {
  it('rejects a goto to a node that does not exist', () => {
    const broken = { ...talk, nodes: [{ ...talk.nodes[1]!, options: [{ id: 'x', text: 'x', outcome: { goto: 'nowhere' } }] }] };
    expect(dialogueSchema.safeParse({ ...broken, start: 'b' }).success).toBe(false);
  });

  it('rejects a check without success and failure', () => {
    const option = { id: 'x', text: 'x', check: { stat: 'strength', difficulty: 10, by: 'best' }, outcome: { end: 'dungeon' } };
    const broken = { id: 't', start: 'a', nodes: [{ id: 'a', text: 'a', options: [option] }] };
    expect(dialogueSchema.safeParse(broken).success).toBe(false);
  });

  it('accepts the test dialogue', () => {
    expect(dialogueSchema.safeParse(talk).success).toBe(true);
  });
});

describe('save migration', () => {
  it('upgrades a version 1 save to the current shape', () => {
    const v1 = { version: 1, screen: 'leaderSelect', rngSeed: 5, party: [], leaderId: null, nextMercId: 1 };
    expect(migrateSave(v1)).toEqual({
      ...v1,
      version: SAVE_VERSION,
      gold: 0,
      flags: {},
      adventureId: null,
      dialogue: null,
    });
  });

  it('refuses a save from a newer version of the game', () => {
    expect(migrateSave({ ...startNewGame(1), version: SAVE_VERSION + 1 })).toBeNull();
  });
});
