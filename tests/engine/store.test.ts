import { describe, expect, it } from 'vitest';
import { getDungeon, getItem, PREMADES, premadeToDraft } from '../../src/content';
import {
  addMerc,
  enterDungeon,
  conditionMet,
  longRest,
  restBlocker,
  sellPrice,
  setDestination,
  setLeader,
  startNewGame,
  stepParty,
  type GameState,
} from '../../src/engine';
import { runCommand } from '../../src/state/commands';
import { dungeonContext } from '../../src/state/context';
import { ALWAYS_IN_STOCK } from '../../src/state/storeStock';

function atStore(): GameState {
  let s: GameState = { ...startNewGame(3), adventureId: 'greywater-ford' };
  for (const id of ['aldric-vane', 'pip-larkspur']) s = addMerc(s, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  s = setLeader(s, 'merc-1');
  s = { ...s, screen: 'dialogue', dialogue: { dialogueId: 'debrief', nodeId: 'agreed', result: null } };
  return runCommand(s, { type: 'chooseOption', optionId: 'set-out' });
}

describe('the store', () => {
  it('opens on the way to the dungeon, with the supplies always in stock and a few pieces of gear', () => {
    const s = atStore();
    expect(s.screen).toBe('store');
    for (const id of ['rope', 'trap-kit', 'camping-kit', 'rations', 'healing-draught']) {
      expect(s.store!.stock).toContainEqual({ itemId: id, quantity: null });
    }
    const gear = s.store!.stock.filter((e) => !ALWAYS_IN_STOCK.includes(e.itemId));
    expect(gear).toHaveLength(6);
    expect(gear.every((e) => e.quantity === 1)).toBe(true);
  });

  it('a merc buys with their own purse, into their pack; gear sells out', () => {
    let s = atStore();
    const purse = s.party[0]!.purse;
    s = runCommand(s, { type: 'buy', mercId: 'merc-1', itemId: 'rope' });
    expect(s.party[0]!.purse).toBe(purse - getItem('rope').value);
    expect(s.party[0]!.inventory.some((x) => x.itemId === 'rope')).toBe(true);
    expect(s.party[1]!.purse).toBe(atStore().party[1]!.purse);

    const piece = s.store!.stock.find((e) => e.quantity === 1)!;
    s = { ...s, party: s.party.map((m) => (m.id === 'merc-1' ? { ...m, purse: 10_000_000 } : m)) };
    s = runCommand(s, { type: 'buy', mercId: 'merc-1', itemId: piece.itemId });
    expect(() => runCommand(s, { type: 'buy', mercId: 'merc-1', itemId: piece.itemId })).toThrow(/sold out/);
  });

  it('refuses what a merc cannot afford, and sells back at half price', () => {
    let s = atStore();
    s = { ...s, party: s.party.map((m) => (m.id === 'merc-1' ? { ...m, purse: 100 } : m)) };
    expect(() => runCommand(s, { type: 'buy', mercId: 'merc-1', itemId: 'camping-kit' })).toThrow(/cannot afford/);
    s = { ...s, party: s.party.map((m) => (m.id === 'merc-1' ? { ...m, purse: 5000 } : m)) };
    s = runCommand(s, { type: 'buy', mercId: 'merc-1', itemId: 'camping-kit' });
    const index = s.party[0]!.inventory.findIndex((x) => x.itemId === 'camping-kit');
    s = runCommand(s, { type: 'sell', mercId: 'merc-1', index });
    expect(s.party[0]!.purse).toBe(5000 - 2000 + sellPrice(2000));
  });

  it('setting out enters the dungeon and closes the store', () => {
    const s = runCommand(atStore(), { type: 'setOut' });
    expect(s.screen).toBe('dungeon');
    expect(s.dungeon!.dungeonId).toBe('greywater-tower');
    expect(s.store ?? null).toBeNull();
  });
});

describe('supplies', () => {
  const tower = getDungeon('greywater-tower');
  const withItem = (s: GameState, itemId: string, n = 1): GameState => ({
    ...s,
    party: s.party.map((m, i) => (i === 0 ? { ...m, inventory: [...m.inventory, { itemId, quantity: n, x: 9, y: 3 }] } : m)),
  });

  it('rations heal outside a fight', () => {
    let s = withItem(runCommand(atStore(), { type: 'setOut' }), 'rations', 2);
    s = { ...s, party: s.party.map((m, i) => (i === 0 ? { ...m, wounds: 10 } : m)) };
    const index = s.party[0]!.inventory.findIndex((x) => x.itemId === 'rations');
    s = runCommand(s, { type: 'eat', mercId: 'merc-1', index });
    expect(s.party[0]!.wounds).toBe(4);
    expect(s.party[0]!.inventory.find((x) => x.itemId === 'rations')!.quantity).toBe(1);
  });

  it('a trap kit disarms a spotted trap without a roll, and is used up', () => {
    let s = withItem(enterDungeon(atStore(), tower), 'trap-kit');
    s = { ...s, dungeon: { ...s.dungeon!, seen: '1'.repeat(tower.width * tower.height), spotted: ['tripwire'], checkedTraps: ['tripwire'], pos: { x: 3, y: 8 }, previous: { x: 3, y: 7 } } };
    s = setDestination(s, tower, { x: 3, y: 9 });
    s = stepParty(s, tower, dungeonContext(s));
    expect(s.dungeon!.resolved).toContain('tripwire');
    expect(s.screen).toBe('dungeon');
    expect(s.party[0]!.inventory.some((x) => x.itemId === 'trap-kit')).toBe(false);
  });

  it('a camping kit lets the party camp a second time on a level', () => {
    let s = enterDungeon(atStore(), tower);
    s = longRest(s, { cure: [] }, getItem);
    s = { ...s, dungeon: { ...s.dungeon!, camping: false } };
    expect(restBlocker(s, getItem)).toMatch(/camping kit/);
    s = withItem(s, 'camping-kit');
    expect(restBlocker(s, getItem)).toBeNull();
    s = longRest(s, { cure: [] }, getItem);
    expect(s.party[0]!.inventory.some((x) => x.itemId === 'camping-kit')).toBe(false);
  });

  it('conversations can ask for an item, such as rope', () => {
    const cond = { type: 'partyHasItem' as const, itemId: 'rope' };
    const s = atStore();
    expect(conditionMet(s, cond)).toBe(false);
    expect(conditionMet(withItem(s, 'rope'), cond)).toBe(true);
  });
});
