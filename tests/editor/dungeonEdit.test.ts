import { describe, expect, it } from 'vitest';
import { ADVENTURES, checkDungeonEdit, CONTENT, getDialogue } from '../../src/content';
import {
  addRoom,
  createBlankDungeon,
  makeFirst,
  moveFeature,
  paintRect,
  paintTile,
  placeFeature,
  removeFeature,
  resizeDungeon,
  setAssignment,
  slugify,
  uniqueId,
} from '../../src/editor/dungeonEdit';
import {
  addMerc,
  chooseOption,
  roomAt,
  setLeader,
  startNewGame,
  tileAt,
  validateDungeon,
  type DungeonDefinition,
  type GameState,
} from '../../src/engine';
import { PREMADES, premadeToDraft } from '../../src/content';
import { dialogueContext } from '../../src/state/context';

const defaults = { dialogueId: 'event-crate', nodes: ['crate'], monsterId: 'bandit-thug' };
const greywater = ADVENTURES.find((a) => a.id === 'greywater-ford')!;

/** A blank map with a goal placed, so it validates. */
function playable(): DungeonDefinition {
  const blank = createBlankDungeon('test-cave', 'Test Cave', 20, 12);
  return placeFeature(blank, 'goal', { x: blank.start.x + 1, y: blank.start.y }, { ...defaults, dialogueId: 'goal-strongbox', nodes: ['strongbox'] }).dungeon;
}

describe('ids', () => {
  it('turns names into file-safe ids', () => {
    expect(slugify("Smugglers' Caves")).toBe('smugglers-caves');
    expect(slugify('42 Halls')).toBe('d-42-halls');
  });

  it('never reuses a taken id', () => {
    expect(uniqueId('trap', ['trap', 'trap-2'])).toBe('trap-3');
    expect(uniqueId('trap', [])).toBe('trap');
  });
});

describe('a new map', () => {
  it('starts walled with an entrance room and the start inside it', () => {
    const d = createBlankDungeon('x', 'X', 20, 12);
    expect(d.tiles).toHaveLength(12);
    expect(d.tiles.every((r) => r.length === 20)).toBe(true);
    expect(tileAt(d, d.start.x, d.start.y)).toBe('room');
    expect(roomAt(d, d.start)?.id).toBe('entrance');
  });

  it('needs a goal before it is valid', () => {
    expect(validateDungeon(createBlankDungeon('x', 'X'))).toContain('needs exactly one goal, has 0');
    expect(validateDungeon(playable())).toEqual([]);
  });
});

describe('painting', () => {
  it('paints one tile without touching the original', () => {
    const d = createBlankDungeon('x', 'X', 10, 10);
    const painted = paintTile(d, { x: 1, y: 1 }, '.');
    expect(tileAt(painted, 1, 1)).toBe('corridor');
    expect(tileAt(d, 1, 1)).toBe('wall');
  });

  it('fills a rectangle from any two corners and clips at the edge', () => {
    const d = createBlankDungeon('x', 'X', 10, 10);
    const filled = paintRect(d, { x: 12, y: 3 }, { x: 7, y: 1 }, '_');
    for (let y = 1; y <= 3; y++) for (let x = 7; x <= 9; x++) expect(tileAt(filled, x, y)).toBe('hall');
    expect(filled.tiles.every((r) => r.length === 10)).toBe(true);
  });

  it('adds a room that paints its floor; halls get 5 rows', () => {
    const d = createBlankDungeon('x', 'X', 20, 12);
    const { dungeon, id } = addRoom(d, { x: 1, y: 1 }, { x: 4, y: 3 }, '_');
    const room = dungeon.rooms.find((r) => r.id === id)!;
    expect(room).toMatchObject({ x: 1, y: 1, width: 4, height: 3, rows: 5 });
    expect(tileAt(dungeon, 2, 2)).toBe('hall');
  });
});

describe('markers', () => {
  it('places features with unique ids and replaces whatever was on the tile', () => {
    let d = playable();
    d = placeFeature(d, 'trap', { x: 2, y: 2 }, defaults).dungeon;
    d = placeFeature(d, 'trap', { x: 3, y: 2 }, defaults).dungeon;
    expect(d.features.filter((f) => f.type === 'trap').map((f) => f.id)).toEqual(['trap', 'trap-2']);
    d = placeFeature(d, 'event', { x: 3, y: 2 }, defaults).dungeon;
    expect(d.features.filter((f) => f.x === 3 && f.y === 2).map((f) => f.type)).toEqual(['event']);
  });

  it('moves the goal instead of adding a second one', () => {
    let d = playable();
    d = placeFeature(d, 'goal', { x: 1, y: 1 }, defaults).dungeon;
    const goals = d.features.filter((f) => f.type === 'goal');
    expect(goals).toHaveLength(1);
    expect(goals[0]).toMatchObject({ x: 1, y: 1 });
  });

  it('moves a feature, but not onto another one', () => {
    let d = placeFeature(playable(), 'event', { x: 2, y: 2 }, defaults).dungeon;
    const goal = d.features.find((f) => f.type === 'goal')!;
    expect(moveFeature(d, 'event', { x: goal.x, y: goal.y })).toBe(d);
    d = moveFeature(d, 'event', { x: 5, y: 5 });
    expect(d.features.find((f) => f.id === 'event')).toMatchObject({ x: 5, y: 5 });
    expect(removeFeature(d, 'event').features.some((f) => f.id === 'event')).toBe(false);
  });
});

describe('resizing', () => {
  it('keeps what fits, walls in new space, and drops what falls outside', () => {
    let d = placeFeature(playable(), 'event', { x: 18, y: 10 }, defaults).dungeon;
    d = resizeDungeon(d, 15, 14);
    expect(d.tiles).toHaveLength(14);
    expect(d.tiles.every((r) => r.length === 15)).toBe(true);
    expect(d.tiles[13]).toBe('#'.repeat(15));
    expect(d.features.some((f) => f.id === 'event')).toBe(false);
  });
});

describe('assigning to adventures', () => {
  it('adds, removes and reorders without duplicates', () => {
    expect(setAssignment(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(setAssignment(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(setAssignment(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(makeFirst(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(makeFirst(['a'], 'z')).toEqual(['a']);
  });
});

describe('save checks', () => {
  const assigned = (dungeons: string[]) => ADVENTURES.map((a) => (a.id === greywater.id ? { ...a, dungeons } : a));

  it('accept a new map assigned to the adventure', () => {
    expect(checkDungeonEdit(playable(), assigned(['greywater-tower', 'test-cave']), CONTENT)).toEqual([]);
  });

  it('catch a dialogue the adventure does not have', () => {
    const base = playable();
    const floor = { x: base.start.x - 1, y: base.start.y };
    const d = placeFeature(base, 'event', floor, { ...defaults, dialogueId: 'no-such-dialogue' }).dungeon;
    expect(checkDungeonEdit(d, assigned(['test-cave']), CONTENT).join('\n')).toMatch(/no-such-dialogue/);
  });

  it('catch a broken map', () => {
    const d = { ...playable(), tiles: playable().tiles.slice(1) };
    expect(checkDungeonEdit(d, assigned(['test-cave']), CONTENT).join('\n')).toMatch(/rows but a height/);
  });

  it('catch an adventure left with no dungeon for its debrief to lead into', () => {
    expect(checkDungeonEdit(playable(), assigned([]), CONTENT).join('\n')).toMatch(/none is assigned/);
  });
});

describe('the debrief leads into the first dungeon', () => {
  it('follows the adventure order', () => {
    let state: GameState = { ...startNewGame(1), adventureId: 'greywater-ford' };
    state = setLeader(addMerc(state, premadeToDraft(PREMADES[0]!)), 'merc-1');
    state = { ...state, screen: 'dialogue', dialogue: { dialogueId: 'debrief', nodeId: 'agreed', result: null } };
    const ctx = { ...dialogueContext, defaultDungeon: () => 'greywater-tower' };
    const after = chooseOption(state, getDialogue('greywater-ford', 'debrief'), 'set-out', ctx);
    expect(after.store?.dungeonId).toBe('greywater-tower');
    expect(dialogueContext.defaultDungeon(state)).toBe(greywater.dungeons[0]);
  });
});
