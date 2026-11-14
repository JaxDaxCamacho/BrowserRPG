import { describe, expect, it } from 'vitest';
import { getDialogue, PREMADES, premadeToDraft } from '../../src/content';
import {
  addMerc,
  attack,
  allEncounters,
  canLeave,
  chooseOption,
  combatantById,
  endExploreTurn,
  endTurn,
  enterDungeon,
  findPath,
  finishCombat,
  groupMovement,
  groupsOf,
  isSplit,
  leaveTheFallen,
  regroup,
  restBlocker,
  setDestination,
  setLeader,
  settle,
  splitOff,
  startNewGame,
  stepParty,
  type CombatContext,
  type DungeonDefinition,
  type GameState,
  type Pos,
} from '../../src/engine';
import { combatContext, dialogueContext, dungeonContext } from '../../src/state/context';

/**
 * Two corridors from the west lead through doors into a hall. Bandits wait in
 * the hall; a crate sits in the corridor.
 *
 *   ##############
 *   #....+,,,,,,,#   y=1  door at (5,1)
 *   #.####,,,,,,,#
 *   #.####,,,,,,,#
 *   #....+,,,,,,,#   y=4  door at (5,4)
 *   #.####,,,,,,,#
 *   ##############
 */
const map: DungeonDefinition = {
  id: 'forked',
  name: 'a forked cellar',
  width: 14,
  height: 7,
  tiles: ['##############', '#....+,,,,,,,#', '#.####,,,,,,,#', '#.####,,,,,,,#', '#....+,,,,,,,#', '#.####,,,,,,,#', '##############'],
  start: { x: 1, y: 3 },
  rooms: [{ id: 'hall', x: 6, y: 1, width: 7, height: 5, rows: 3 }],
  features: [
    { type: 'encounter', id: 'bandits', name: 'Bandits', x: 11, y: 3, monsters: [{ monsterId: 'bandit-thug', count: 2 }], stealthDifficulty: 0, detection: 1 },
    { type: 'event', id: 'crate', name: 'Crate', x: 1, y: 5, dialogueId: 'event-crate' },
    { type: 'goal', id: 'box', name: 'Box', x: 12, y: 5, dialogueId: 'goal-strongbox' },
  ],
};

const ctx: CombatContext = { ...combatContext, getDungeon: (id) => (id === map.id ? map : combatContext.getDungeon(id)) };
const run = (s: GameState, command: (g: GameState) => GameState) => settle(command(s), ctx);

function party(): GameState {
  let s: GameState = { ...startNewGame(4), adventureId: 'greywater-ford' };
  for (const id of ['aldric-vane', 'pip-larkspur', 'maelis-thorne', 'korg-the-unbowed']) s = addMerc(s, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  s = enterDungeon(setLeader(s, 'merc-1'), map);
  // The whole map is known, to keep the walking simple.
  return { ...s, dungeon: { ...s.dungeon!, seen: '1'.repeat(map.width * map.height) } };
}

/** Walks the active group towards a tile, settling after every step like the game does. */
function walk(s: GameState, to: Pos): GameState {
  let g = run(s, (x) => setDestination(x, map, to));
  for (let i = 0; i < 40 && g.screen === 'dungeon' && g.dungeon!.path.length > 0; i++) g = run(g, (x) => stepParty(x, map, dungeonContext(x)));
  return g;
}

const slot = (s: GameState) => s.dungeon!.world?.current;
const posOf = (s: GameState, groupId: string) => groupsOf(s).find((g) => g.id === groupId)!.pos;

describe('splitting the party', () => {
  it('gives the merc their own token and starts taking turns', () => {
    const s = run(party(), (g) => splitOff(g, 'merc-2'));
    expect(isSplit(s)).toBe(true);
    expect(groupsOf(s).map((g) => g.mercIds)).toEqual([['merc-1', 'merc-3', 'merc-4'], ['merc-2']]);
    expect(slot(s)).toEqual({ kind: 'explore', groupId: 'g1' });
    expect(s.dungeon!.world!.movesLeft).toBe(groupMovement(s, groupsOf(s)[0]!, ctx));
  });

  it('a group walks only its movement, then the next group goes', () => {
    let s = run(party(), (g) => splitOff(g, 'merc-2'));
    const moves = s.dungeon!.world!.movesLeft!;
    const route = findPath(s.dungeon!, map, { x: 12, y: 5 })!;
    expect(route.length).toBeGreaterThan(moves);
    s = walk(s, { x: 12, y: 5 });
    expect(posOf(s, 'g1')).toEqual(route[moves - 1]);
    expect(slot(s)).toEqual({ kind: 'explore', groupId: 'g2' });
    expect(groupsOf(s)[0]!.id).toBe('g2'); // Pip's token is the one on the map now
  });

  it('ending a turn early passes it on, and a new world round begins after everyone', () => {
    let s = run(party(), (g) => splitOff(g, 'merc-2'));
    s = run(s, endExploreTurn);
    expect(slot(s)).toEqual({ kind: 'explore', groupId: 'g2' });
    s = run(s, endExploreTurn);
    expect(s.dungeon!.world!.round).toBe(2);
    expect(slot(s)).toEqual({ kind: 'explore', groupId: 'g1' });
  });

  it('groups on the same tile can regroup, and the party walks freely again', () => {
    let s = run(party(), (g) => splitOff(g, 'merc-2'));
    s = run(s, regroup);
    expect(isSplit(s)).toBe(false);
    expect(s.dungeon!.world).toBeUndefined();
  });

  it('no camp, and no leaving the dungeon, while split', () => {
    const s = run(party(), (g) => splitOff(g, 'merc-2'));
    expect(restBlocker(s)).toMatch(/Regroup/);
    expect(canLeave(s, map)).toBe(false);
  });
});

describe('fights while split', () => {
  /** Pip goes alone through the north door into the hall; the others stay at the start. */
  function pipAttacked(): GameState {
    let s = run(party(), (g) => splitOff(g, 'merc-2'));
    s = run(s, endExploreTurn); // the main group waits
    for (let i = 0; i < 12 && s.screen === 'dungeon'; i++) {
      if (slot(s)?.kind === 'explore' && (slot(s) as { groupId: string }).groupId === 'g2') s = walk(s, { x: 10, y: 2 });
      else s = run(s, endExploreTurn);
    }
    return s;
  }

  it('only the group that walked in fights', () => {
    const s = pipAttacked();
    expect(s.screen).toBe('combat');
    expect(s.encounter!.mercIds).toEqual(['merc-2']);
    expect(s.encounter!.combat!.combatants.filter((x) => x.mercId).map((x) => x.id)).toEqual(['merc-2']);
    expect(slot(s)).toEqual({ kind: 'fight', featureId: 'bandits' });
  });

  it('after a full round of the fight, the others get an exploration turn', () => {
    let s = pipAttacked();
    for (let i = 0; i < 10 && slot(s)?.kind === 'fight'; i++) s = run(s, endTurn);
    expect(slot(s)).toEqual({ kind: 'explore', groupId: 'g1' });
    expect(s.screen).toBe('dungeon');
    expect(s.encounter).toBeNull();
    expect(s.otherEncounters).toHaveLength(1);
    // And when they have moved, the fight comes back.
    s = run(s, endExploreTurn);
    expect(slot(s)).toEqual({ kind: 'fight', featureId: 'bandits' });
    expect(s.screen).toBe('combat');
  });

  it('walking into the room joins the fight, on the edge they came in from', () => {
    let s = pipAttacked();
    for (let i = 0; i < 10 && slot(s)?.kind === 'fight'; i++) s = run(s, endTurn);
    // The main group heads for the south door and into the hall.
    for (let i = 0; i < 20 && !(s.encounter?.mercIds?.includes('merc-1')); i++) {
      const cur = slot(s);
      if (cur?.kind === 'explore' && cur.groupId === 'g1') s = walk(s, { x: 7, y: 4 });
      else if (cur?.kind === 'fight') s = run(s, endTurn);
      else s = run(s, endExploreTurn);
    }
    const c = s.encounter!.combat!;
    expect(s.encounter!.mercIds!.sort()).toEqual(['merc-1', 'merc-2', 'merc-3', 'merc-4']);
    for (const id of ['merc-1', 'merc-3', 'merc-4']) {
      expect(c.order).toContain(id);
      expect(combatantById(c, id).pos.x).toBe(0); // came in from the west door
    }
    expect(c.log.some((l) => /joins the fight from the west/.test(l))).toBe(true);
  });

  it('a won fight writes back only its own mercs', () => {
    let s = pipAttacked();
    const knightBefore = s.party.find((m) => m.id === 'merc-1')!;
    const c = s.encounter!.combat!;
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, outcome: 'victory', combatants: c.combatants.map((x) => (x.side === 'enemy' ? { ...x, hp: 0 } : x)) } } };
    s = run(s, (g) => finishCombat(g, ctx));
    expect(s.party.find((m) => m.id === 'merc-1')).toEqual(knightBefore);
    expect(s.dungeon!.resolved).toContain('bandits');
    expect(allEncounters(s)).toHaveLength(0);
    expect(s.screen).toBe('dungeon');
  });
});

describe('dialogue while split', () => {
  it('only the group that found it takes part', () => {
    let s = run(party(), (g) => splitOff(g, 'merc-3'));
    s = run(s, endExploreTurn);
    s = walk(s, { x: 1, y: 5 }); // Maelis alone at the crate
    expect(s.screen).toBe('dialogue');
    expect(s.dialogue!.mercIds).toEqual(['merc-3']);
    const crate = getDialogue('greywater-ford', 'event-crate');
    const node = crate.nodes.find((n) => n.id === s.dialogue!.nodeId)!;
    const option = node.options.find((o) => o.check) ?? node.options[0]!;
    const after = chooseOption(s, crate, option.id, dialogueContext);
    if (after.dialogue?.result?.check) expect(after.dialogue.result.check.mercId).toBe('merc-3');
  });
});

describe('a fallen group while split', () => {
  it('does not end the adventure: the fight waits, and the others can come to the rescue', () => {
    let s = run(party(), (g) => splitOff(g, 'merc-2'));
    s = run(s, endExploreTurn);
    for (let i = 0; i < 12 && s.screen === 'dungeon'; i++) {
      const cur = slot(s);
      if (cur?.kind === 'explore' && cur.groupId === 'g2') s = walk(s, { x: 10, y: 2 });
      else s = run(s, endExploreTurn);
    }
    expect(s.encounter!.mercIds).toEqual(['merc-2']);

    // Pip goes down: the last merc in this fight.
    const c = s.encounter!.combat!;
    const thug = c.combatants.find((x) => x.side === 'enemy')!;
    const pip = c.combatants.find((x) => x.id === 'merc-2')!;
    const beside = { x: pip.pos.x + (pip.pos.x + 1 < c.width ? 1 : -1), y: pip.pos.y };
    s = {
      ...s,
      encounter: {
        ...s.encounter!,
        combat: {
          ...c,
          combatants: c.combatants.map((x) =>
            x.id === 'merc-2' ? { ...x, hp: 1, baseDefense: -50, armour: { physical: 0, magic: 0 } } : x.id === thug.id ? { ...x, pos: beside } : x,
          ),
        },
      },
    };
    const order = [thug.id, ...c.order.filter((x) => x !== thug.id)];
    s = { ...s, encounter: { ...s.encounter!, combat: { ...s.encounter!.combat!, order, turn: 0, acted: false, moveLeft: 0 } } };
    let downed = s;
    for (let seed = 1; seed < 300; seed++) {
      const tryIt = run({ ...s, rngSeed: seed }, (g) => attack(g, 'merc-2'));
      if (tryIt.encounter?.combat?.outcome === 'defeat') {
        // The defeat waits on screen until the player chooses to carry on with the others.
        expect(tryIt.screen).toBe('combat');
        downed = run(tryIt, leaveTheFallen);
        break;
      }
    }
    const waiting = allEncounters(downed).find((e) => e.featureId === 'bandits')!;
    expect(waiting.combat!.dormant).toBe(true);
    expect(waiting.combat!.outcome).toBeNull();
    // The game carries on with the others exploring.
    expect(downed.screen).toBe('dungeon');
    expect(slot(downed)).toEqual({ kind: 'explore', groupId: 'g1' });
    expect(downed.dungeon!.log.some((l) => /can still come to the rescue/.test(l))).toBe(true);

    // The rest of the party walks in, joins, and the fight wakes up.
    let r = downed;
    for (let i = 0; i < 20 && !r.encounter?.mercIds?.includes('merc-1'); i++) {
      const cur = slot(r);
      if (cur?.kind === 'explore' && cur.groupId === 'g1') r = walk(r, { x: 7, y: 4 });
      else r = run(r, endExploreTurn);
    }
    expect(r.encounter!.combat!.dormant).toBeUndefined();
    expect(r.encounter!.mercIds!.sort()).toEqual(['merc-1', 'merc-2', 'merc-3', 'merc-4']);
    expect(combatantById(r.encounter!.combat!, 'merc-2').hp).toBe(0);
  });
});
