import { describe, expect, it } from 'vitest';
import { DUNGEONS, getDialogue, getDungeon, PREMADES, premadeToDraft } from '../../src/content';
import {
  addMerc,
  chooseOption,
  continueDialogue,
  enterDungeon,
  findPath,
  isSeen,
  migrateSave,
  resolveEncounter,
  setDestination,
  setLeader,
  setOut,
  startNewGame,
  stepParty,
  validateDungeon,
  visibleFrom,
  type DungeonDefinition,
  type GameState,
  type Pos,
} from '../../src/engine';
import { currentHp, dialogueContext, dungeonContext } from '../../src/state/context';

const tower = getDungeon('greywater-tower');

function party(seed = 3): GameState {
  let state: GameState = { ...startNewGame(seed), adventureId: 'greywater-ford' };
  for (const id of ['aldric-vane', 'maelis-thorne', 'sylwen-ashbow', 'pip-larkspur']) {
    state = addMerc(state, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  }
  return setLeader(state, 'merc-1');
}

/** Walks until the path ends or something interrupts. */
function walk(state: GameState, def: DungeonDefinition, to: Pos): GameState {
  let s = setDestination(state, def, to);
  for (let i = 0; i < 200 && s.screen === 'dungeon' && (s.dungeon?.path.length ?? 0) > 0; i++) {
    s = stepParty(s, def, dungeonContext(s));
  }
  return s;
}

/**
 * Heads for a tile that may still be in the fog, the way a player would:
 * clicks the furthest tile already revealed along the way.
 */
function travel(state: GameState, def: DungeonDefinition, target: Pos): GameState {
  const allSeen = { ...state.dungeon!, seen: '1'.repeat(def.width * def.height) };
  const route = findPath(allSeen, def, target);
  if (!route) return state;
  let stop: Pos | null = null;
  for (const p of route) {
    if (!isSeen(state.dungeon!, def, p)) break;
    stop = p;
  }
  return stop ? walk(state, def, stop) : state;
}

/** Picks the first option and continues past any result, until the dialogue is over. */
function finishDialogue(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 10 && s.dialogue; i++) {
    const dialogue = getDialogue('greywater-ford', s.dialogue.dialogueId);
    if (s.dialogue.result) {
      s = continueDialogue(s, dialogueContext);
      continue;
    }
    const node = dialogue.nodes.find((n) => n.id === s.dialogue!.nodeId)!;
    s = chooseOption(s, dialogue, node.options[0]!.id, dialogueContext);
  }
  return s;
}

/** A small hand-made map for precise checks. */
const tiny: DungeonDefinition = {
  id: 'tiny',
  name: 'a test cellar',
  width: 12,
  height: 5,
  tiles: [
    '############',
    '#..........#',
    '#.########.#',
    '#..........#',
    '############',
  ],
  start: { x: 1, y: 1 },
  rooms: [],
  features: [
    { type: 'trap', id: 'wire', name: 'tripwire', x: 6, y: 1, detectDifficulty: 99, dialogueId: 'trap-tripwire', triggerNode: 'sprung', disarmNode: 'spotted' },
    // Stealth always succeeds here, so these tests are about sighting, not sneaking.
    { type: 'encounter', id: 'dogs', name: 'Dogs', x: 10, y: 3, monsters: [{ monsterId: 'war-hound', count: 2 }], stealthDifficulty: 0 },
    { type: 'goal', id: 'box', name: 'Box', x: 10, y: 1, dialogueId: 'goal-strongbox' },
  ],
};

describe('map data', () => {
  it('ships a valid test map that the adventure uses', () => {
    expect(DUNGEONS.map((d) => d.id)).toContain('greywater-tower');
    expect(validateDungeon(tower)).toEqual([]);
    expect(validateDungeon(tiny)).toEqual([]);
  });

  it('reports ragged rows, unknown tiles and unreachable features', () => {
    const broken = { ...tiny, tiles: [...tiny.tiles.slice(0, 2), '#.#######?#', ...tiny.tiles.slice(3)] };
    const problems = validateDungeon(broken).join('\n');
    expect(problems).toMatch(/row 2 is 11 tiles wide/);
    expect(problems).toMatch(/unknown tile "\?"/);
  });

  it('needs exactly one goal', () => {
    expect(validateDungeon({ ...tiny, features: [] })).toContain('needs exactly one goal, has 0');
  });
});

describe('fog of war', () => {
  it('reveals two tiles around the party in line of sight', () => {
    const visible = visibleFrom(tiny, { x: 1, y: 1 });
    expect(visible.has(1 * 12 + 3)).toBe(true);
    expect(visible.has(1 * 12 + 4)).toBe(false);
    // The wall row blocks sight of the lower corridor.
    expect(visible.has(3 * 12 + 2)).toBe(false);
  });

  it('reveals a whole room on entering it', () => {
    const state = enterDungeon(party(), tower);
    const hall = tower.rooms.find((r) => r.id === 'gatehouse')!;
    for (let y = hall.y; y < hall.y + hall.height; y++) {
      for (let x = hall.x; x < hall.x + hall.width; x++) expect(isSeen(state.dungeon!, tower, { x, y })).toBe(true);
    }
    expect(isSeen(state.dungeon!, tower, { x: 18, y: 3 })).toBe(false);
  });

  it('remembers what was seen through a save and load', () => {
    let state = enterDungeon(party(), tower);
    state = walk(state, tower, { x: 7, y: 3 });
    const restored = migrateSave(JSON.parse(JSON.stringify(state)))!;
    expect(restored.dungeon!.seen).toBe(state.dungeon!.seen);
    expect(restored.dungeon!.pos).toEqual({ x: 7, y: 3 });
  });
});

describe('movement', () => {
  it('only plans paths through ground already seen', () => {
    const state = enterDungeon(party(), tiny);
    expect(findPath(state.dungeon!, tiny, { x: 3, y: 1 })).toHaveLength(2);
    expect(findPath(state.dungeon!, tiny, { x: 10, y: 1 })).toBeNull();
  });

  it('refuses walls and says so', () => {
    const state = setDestination(enterDungeon(party(), tiny), tiny, { x: 0, y: 0 });
    expect(state.dungeon!.path).toEqual([]);
    expect(state.dungeon!.log.at(-1)).toBe('You cannot find a way there.');
  });

  it('says when a tile has not been explored yet', () => {
    const state = setDestination(enterDungeon(party(), tiny), tiny, { x: 10, y: 3 });
    expect(state.dungeon!.log.at(-1)).toBe('You have not explored a way there yet.');
  });

  it('walks one tile per step and reveals as it goes', () => {
    let state = setDestination(enterDungeon(party(), tiny), tiny, { x: 3, y: 1 });
    state = stepParty(state, tiny, dungeonContext(state));
    expect(state.dungeon!.pos).toEqual({ x: 2, y: 1 });
    expect(isSeen(state.dungeon!, tiny, { x: 4, y: 1 })).toBe(true);
  });
});

describe('traps', () => {
  it('springs an unseen trap into its dialogue, and it never fires twice', () => {
    let state = enterDungeon(party(), tiny);
    state = walk(state, tiny, { x: 3, y: 1 });
    state = walk(state, tiny, { x: 5, y: 1 });
    state = walk(state, tiny, { x: 6, y: 1 });
    expect(state.screen).toBe('dialogue');
    expect(state.dialogue).toMatchObject({ dialogueId: 'trap-tripwire', nodeId: 'sprung', source: 'wire' });

    state = finishDialogue(state);
    expect(state.screen).toBe('dungeon');
    expect(state.dungeon!.resolved).toContain('wire');

    state = walk(state, tiny, { x: 5, y: 1 });
    state = walk(state, tiny, { x: 6, y: 1 });
    expect(state.screen).toBe('dungeon');
  });

  it('gives each nearby trap one hidden Intellect check, and stops the walk when one is spotted', () => {
    const easy = { ...tiny, features: tiny.features.map((f) => (f.id === 'wire' ? { ...f, detectDifficulty: 1 } : f)) };
    let state = enterDungeon(party(), easy);
    state = walk(state, easy, { x: 3, y: 1 });
    state = walk(state, easy, { x: 5, y: 1 });
    expect(state.dungeon!.spotted).toContain('wire');
    expect(state.dungeon!.pos).toEqual({ x: 5, y: 1 });
    expect(state.dungeon!.log.at(-1)).toMatch(/spots a tripwire/);
    // Spotted traps are walked around when there is another way, and opened in disarm mode when walked onto.
    state = walk(state, easy, { x: 6, y: 1 });
    expect(state.dialogue).toMatchObject({ nodeId: 'spotted' });
  });

  it('hurts the merc who failed the check', () => {
    let hurt: GameState | null = null;
    for (let seed = 1; seed < 60 && !hurt; seed++) {
      let state = enterDungeon(party(seed), tiny);
      state = walk(state, tiny, { x: 3, y: 1 });
      state = walk(state, tiny, { x: 5, y: 1 });
      state = walk(state, tiny, { x: 6, y: 1 });
      state = chooseOption(state, getDialogue('greywater-ford', 'trap-tripwire'), 'dive', dialogueContext);
      if (!state.dialogue!.result!.check!.success) hurt = state;
    }
    expect(hurt).not.toBeNull();
    const leader = hurt!.party.find((m) => m.id === 'merc-1')!;
    expect(leader.wounds).toBeGreaterThan(0);
    expect(currentHp(leader).current).toBe(currentHp(leader).max - leader.wounds);
    expect(hurt!.dialogue!.result!.notes[0]).toMatch(/Aldric Vane takes \d damage/);
  });
});

describe('enemy groups', () => {
  it('stops the walk when a group first comes into view', () => {
    // Sneaking always succeeds, so this is about sighting alone.
    const quiet: DungeonDefinition = {
      ...tower,
      features: tower.features.map((f) => (f.type === 'encounter' ? { ...f, stealthDifficulty: 0 } : f)),
    };
    let state = enterDungeon(party(), quiet);
    for (let i = 0; i < 5 && !state.dialogue; i++) state = travel(state, quiet, { x: 14, y: 3 });
    // The sentry is in the way; deal with him first.
    expect(state.dialogue?.dialogueId).toBe('event-sentry');
    state = finishDialogue(state);
    for (let i = 0; i < 5 && !(state.dungeon!.pos.x === 15 && state.dungeon!.pos.y === 3); i++) {
      state = travel(state, quiet, { x: 15, y: 3 });
    }
    expect(state.dungeon!.pos).toEqual({ x: 15, y: 3 });
    expect(state.dungeon!.noticed).toContain('guards');
    expect(state.dungeon!.log.at(-1)).toMatch(/You see Bandit Thug ×2 ahead/);
    expect(state.screen).toBe('dungeon');
  });

  it('starts a fight next to a group, and a victory marks it defeated', () => {
    let state = enterDungeon(party(), tiny);
    // Reveal the lower corridor by walking round, avoiding the trap row.
    state = { ...state, dungeon: { ...state.dungeon!, seen: '1'.repeat(60), resolved: ['wire'] } };
    state = walk(state, tiny, { x: 9, y: 3 });
    // Seeing the dogs stops the walk first; clicking again carries on into the fight.
    expect(state.dungeon!.log.at(-1)).toMatch(/You see War Hound ×2 ahead/);
    expect(state.screen).toBe('dungeon');
    state = walk(state, tiny, { x: 9, y: 3 });
    expect(state.screen).toBe('combat');
    expect(state.encounter?.featureId).toBe('dogs');
    // The dogs never spotted the party (stealth always succeeds here), so the party has the jump on them.
    expect(state.encounter?.surprise).toBe(true);
    expect(state.dungeon!.log.at(-1)).toMatch(/You catch War Hound ×2 off guard!/);

    const fled = resolveEncounter(state, 'retreat');
    expect(fled.screen).toBe('dungeon');
    expect(fled.dungeon!.pos).toEqual(state.encounter!.returnTo);

    const won = resolveEncounter(state, 'victory');
    expect(won.dungeon!.resolved).toContain('dogs');
    expect(walk(won, tiny, { x: 10, y: 3 }).screen).toBe('dungeon');
  });
});

describe('surprise', () => {
  it('is never the party\'s when the group lies in ambush', () => {
    const lurking: DungeonDefinition = {
      ...tiny,
      features: tiny.features.map((f) => (f.type === 'encounter' ? { ...f, ambush: true } : f)),
    };
    let state = enterDungeon(party(), lurking);
    state = { ...state, dungeon: { ...state.dungeon!, seen: '1'.repeat(60), resolved: ['wire'] } };
    state = walk(state, lurking, { x: 9, y: 3 });
    state = walk(state, lurking, { x: 9, y: 3 });
    expect(state.screen).toBe('combat');
    expect(state.encounter?.surprise).toBeUndefined();
  });
});

describe('the Greywater adventure', () => {
  it('enters the tower from the debrief', () => {
    let state = party();
    const debrief = getDialogue('greywater-ford', 'debrief');
    state = { ...state, screen: 'dialogue', dialogue: { dialogueId: 'debrief', nodeId: 'agreed', result: null } };
    state = chooseOption(state, debrief, 'set-out', dialogueContext);
    // First the store, then out the door.
    expect(state.screen).toBe('store');
    state = setOut(state, tower);
    expect(state.screen).toBe('dungeon');
    expect(state.dungeon?.dungeonId).toBe('greywater-tower');
    expect(state.dungeon?.pos).toEqual(tower.start);
  });

  it('can be played from the gate to the strongbox', () => {
    let state = enterDungeon(party(), tower);
    const route: Pos[] = [
      { x: 7, y: 3 }, // gate door
      { x: 10, y: 3 }, // sentry
      { x: 15, y: 3 }, // guardroom
      { x: 18, y: 7 }, // corridor to the hall
      { x: 17, y: 11 }, // the hall
      { x: 17, y: 17 },
      { x: 17, y: 20 }, // vault door (cursed lock)
      { x: 17, y: 23 }, // captain
      { x: 17, y: 25 }, // strongbox
    ];
    for (const target of route) {
      for (let tries = 0; tries < 20 && !(state.dungeon!.pos.x === target.x && state.dungeon!.pos.y === target.y); tries++) {
        if (state.screen === 'combat') state = resolveEncounter(state, 'victory');
        else if (state.screen === 'dialogue') state = finishDialogue(state);
        else state = travel(state, tower, target);
      }
      expect(state.dungeon!.pos, `reaching ${target.x},${target.y}`).toEqual(target);
      if (state.screen === 'dialogue') state = finishDialogue(state);
    }
    expect(state.dungeon!.resolved).toEqual(expect.arrayContaining(['guards', 'hall-band', 'cursed-lock', 'captain', 'strongbox']));
    expect(state.flags.hasStrongbox).toBe(true);
  });
});
