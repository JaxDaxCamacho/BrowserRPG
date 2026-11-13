import { describe, expect, it } from 'vitest';
import { createInitialState, goToScreen, returnToMenu, SAVE_VERSION, startNewGame } from '../../src/engine';

describe('GameState', () => {
  it('starts on the main menu at the current save version', () => {
    const state = createInitialState();
    expect(state.screen).toBe('menu');
    expect(state.version).toBe(SAVE_VERSION);
  });

  it('survives a JSON round trip unchanged, so it can be saved as-is', () => {
    const state = startNewGame(1234);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('commands', () => {
  it('startNewGame goes to party creation and keeps the seed', () => {
    const state = startNewGame(42);
    expect(state.screen).toBe('partyCreation');
    expect(state.rngSeed).toBe(42);
  });

  it('goToScreen returns a new state without mutating the old one', () => {
    const before = createInitialState();
    const after = goToScreen(before, 'dungeon');
    expect(after.screen).toBe('dungeon');
    expect(before.screen).toBe('menu');
    expect(after).not.toBe(before);
  });

  it('goToScreen returns the same object when nothing changes', () => {
    const state = createInitialState();
    expect(goToScreen(state, 'menu')).toBe(state);
  });

  it('returnToMenu goes back to the menu from any screen', () => {
    expect(returnToMenu(startNewGame(1)).screen).toBe('menu');
  });
});
