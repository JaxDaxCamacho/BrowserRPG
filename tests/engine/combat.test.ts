import { describe, expect, it } from 'vitest';
import { getMonster, PREMADES, premadeToDraft } from '../../src/content';
import {
  activeCombatant,
  addMerc,
  attack,
  attackTargets,
  castAbility,
  combatantById,
  defend,
  DEFEND_BONUS,
  distance,
  drinkPotion,
  effectiveDefense,
  endTurn,
  enterDungeon,
  finishCombat,
  flee,
  moveTo,
  planEnemyTurn,
  reach,
  reachableTiles,
  retryCombat,
  runEnemyTurn,
  setLeader,
  standing,
  startCombat,
  startNewGame,
  type CombatContext,
  type CombatState,
  type Combatant,
  type DungeonDefinition,
  type GameState,
  type MonsterDefinition,
  type Pos,
} from '../../src/engine';
import { combatContext } from '../../src/state/context';

/** A test arena: one room of the given size with one enemy group in it. */
function arena(width: number, height: number, monsters: { monsterId: string; count: number }[], ambush = false): DungeonDefinition {
  const w = width + 2;
  const h = height + 2;
  const tiles = Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? '#'.repeat(w) : `#${','.repeat(width)}#`));
  return {
    id: 'arena',
    name: 'the arena',
    width: w,
    height: h,
    tiles,
    start: { x: 1, y: 1 },
    rooms: [{ id: 'pit', x: 1, y: 1, width, height, rows: 3 }],
    features: [
      { type: 'encounter', id: 'foes', name: 'The foes', x: width, y: 1, monsters, ...(ambush ? { ambush } : {}) },
      { type: 'goal', id: 'goal', name: 'Goal', x: width, y: height, dialogueId: 'goal-strongbox' },
    ],
  };
}

function ctxFor(def: DungeonDefinition, extraMonsters: MonsterDefinition[] = []): CombatContext {
  return {
    ...combatContext,
    getDungeon: (id) => (id === def.id ? def : combatContext.getDungeon(id)),
    getMonster: (id) => extraMonsters.find((m) => m.id === id) ?? getMonster(id),
  };
}

function partyOf(ids: string[], seed = 5): GameState {
  let s: GameState = { ...startNewGame(seed), adventureId: 'greywater-ford' };
  for (const id of ids) s = addMerc(s, premadeToDraft(PREMADES.find((p) => p.id === id)!));
  return setLeader(s, 'merc-1');
}

const FOUR = ['aldric-vane', 'korg-the-unbowed', 'sylwen-ashbow', 'maelis-thorne'];

function fight(def: DungeonDefinition, ids = FOUR, seed = 5, extra: MonsterDefinition[] = []): { state: GameState; ctx: CombatContext } {
  const ctx = ctxFor(def, extra);
  let state = enterDungeon(partyOf(ids, seed), def);
  state = { ...state, screen: 'combat', encounter: { featureId: 'foes', returnTo: def.start } };
  return { state: startCombat(state, ctx), ctx };
}

const combatOf = (s: GameState): CombatState => s.encounter!.combat!;

/** Puts a chosen combatant first in line with a fresh turn, for precise checks. */
function giveTurnTo(s: GameState, id: string, change: Partial<Combatant> = {}): GameState {
  const c = combatOf(s);
  const order = [id, ...c.order.filter((x) => x !== id)];
  const combatants = c.combatants.map((x) => (x.id === id ? { ...x, ...change } : x));
  const me = combatants.find((x) => x.id === id)!;
  return { ...s, encounter: { ...s.encounter!, combat: { ...c, order, combatants, turn: 0, moveLeft: me.movement, acted: false } } };
}

function place(s: GameState, spots: Record<string, Pos>): GameState {
  const c = combatOf(s);
  return { ...s, encounter: { ...s.encounter!, combat: { ...c, combatants: c.combatants.map((x) => (x.id in spots ? { ...x, pos: spots[x.id]! } : x)) } } };
}

const room = arena(8, 6, [{ monsterId: 'bandit-thug', count: 1 }]);

describe('setting up a fight', () => {
  it('uses the room size for the grid, party along the near edge and enemies along the far one', () => {
    const c = combatOf(fight(arena(8, 6, [{ monsterId: 'bandit-thug', count: 2 }])).state);
    expect([c.width, c.height]).toEqual([8, 6]);
    expect(standing(c, 'party').every((x) => x.pos.y === 5)).toBe(true);
    expect(standing(c, 'enemy').every((x) => x.pos.y === 0)).toBe(true);
  });

  it('keeps the grid within its limits', () => {
    const c = combatOf(fight(arena(20, 2, [{ monsterId: 'bandit-thug', count: 1 }])).state);
    expect([c.width, c.height]).toEqual([12, 4]);
  });

  it('surrounds the party in an ambush', () => {
    const c = combatOf(fight(arena(8, 6, [{ monsterId: 'bandit-thug', count: 2 }], true)).state);
    expect(c.ambush).toBe(true);
    expect(standing(c, 'enemy').map((x) => x.pos.y).sort()).toEqual([0, 5]);
  });

  it('gives each merc movement from race plus Agility', () => {
    const c = combatOf(fight(room).state);
    // Aldric: Human 3, Agility 8 (-1) = 2. Sylwen: Elf 4, Agility 16 (+3) = 7.
    expect(combatantById(c, 'merc-1').movement).toBe(2);
    expect(combatantById(c, 'merc-3').movement).toBe(7);
  });

  it('gives every attack an effect', () => {
    const c = combatOf(fight(arena(8, 6, [{ monsterId: 'hedge-mage', count: 1 }])).state);
    expect(c.combatants.every((x) => x.attack.animation.startsWith('animations/'))).toBe(true);
  });
});

describe('reach', () => {
  it('lets melee hit the eight tiles around', () => {
    expect(reach(0, { x: 2, y: 2 }, { x: 3, y: 3 }, false).ok).toBe(true);
    expect(reach(0, { x: 2, y: 2 }, { x: 4, y: 2 }, false).ok).toBe(false);
  });

  it('gives ranged attacks disadvantage while engaged', () => {
    expect(reach(8, { x: 0, y: 0 }, { x: 8, y: 3 }, false)).toEqual({ ok: true, mode: 'normal' });
    expect(reach(8, { x: 0, y: 0 }, { x: 9, y: 0 }, false).ok).toBe(false);
    expect(reach(8, { x: 0, y: 0 }, { x: 1, y: 0 }, true).mode).toBe('disadvantage');
  });
});

describe('moving', () => {
  it('reaches tiles within the movement allowance, around others', () => {
    let s = giveTurnTo(fight(room).state, 'merc-3');
    const c = combatOf(s);
    const tiles = reachableTiles(c, activeCombatant(c));
    for (const path of tiles.values()) expect(path.length).toBeLessThanOrEqual(7);
    s = moveTo(s, { x: 0, y: 2 });
    expect(combatantById(combatOf(s), 'merc-3').pos).toEqual({ x: 0, y: 2 });
    expect(combatOf(s).moveLeft).toBeLessThan(7);
  });

  it('refuses a tile out of reach', () => {
    const s = giveTurnTo(fight(room).state, 'merc-1');
    expect(() => moveTo(s, { x: 0, y: 0 })).toThrow(/cannot reach/);
  });

  it('gives a free attack when stepping out of an enemy\'s reach', () => {
    let s = place(giveTurnTo(fight(room).state, 'merc-2'), { 'merc-2': { x: 3, y: 2 }, 'bandit-thug-1': { x: 3, y: 1 } });
    s = moveTo(s, { x: 3, y: 4 });
    expect(combatOf(s).log.some((l) => l.includes('strikes as Korg the Unbowed breaks away'))).toBe(true);
  });
});

describe('the party\'s turn', () => {
  it('can only hit adjacent enemies in melee', () => {
    let s = place(giveTurnTo(fight(room).state, 'merc-1'), { 'merc-1': { x: 3, y: 3 }, 'bandit-thug-1': { x: 3, y: 0 } });
    expect(attackTargets(combatOf(s), activeCombatant(combatOf(s)))).toEqual([]);
    s = place(s, { 'bandit-thug-1': { x: 4, y: 2 } });
    expect(attackTargets(combatOf(s), activeCombatant(combatOf(s))).map((t) => t.id)).toEqual(['bandit-thug-1']);
  });

  it('records the working of every attack and sends it to the dice tray', () => {
    let s = place(giveTurnTo(fight(room).state, 'merc-1'), { 'merc-1': { x: 3, y: 1 }, 'bandit-thug-1': { x: 3, y: 0 } });
    s = attack(s, 'bandit-thug-1');
    const event = combatOf(s).events.find((e) => e.kind === 'attack')!;
    expect(event.roll!.total).toBe(event.roll!.natural + event.roll!.modifier);
    expect(s.rollFeed?.rolls[0]?.what).toMatch(/Arming Sword/);
  });

  it('shoots with disadvantage when an enemy is adjacent, and spends an arrow', () => {
    let s = place(giveTurnTo(fight(room).state, 'merc-3'), { 'merc-3': { x: 3, y: 1 }, 'bandit-thug-1': { x: 3, y: 0 } });
    s = attack(s, 'bandit-thug-1');
    expect(combatOf(s).events[0]!.roll!.mode).toBe('disadvantage');
    expect(combatOf(s).mercs.find((m) => m.id === 'merc-3')!.inventory.find((i) => i.itemId === 'arrows')?.quantity).toBe(19);
  });

  it('defending adds 2 Defense', () => {
    let s = giveTurnTo(fight(room).state, 'merc-1');
    const before = effectiveDefense(combatantById(combatOf(s), 'merc-1'));
    s = defend(s);
    expect(effectiveDefense(combatantById(combatOf(s), 'merc-1'))).toBe(before + DEFEND_BONUS);
  });

  it('drinks a healing draught', () => {
    let s = fight(room).state;
    const c = combatOf(s);
    s = {
      ...s,
      encounter: {
        ...s.encounter!,
        combat: {
          ...c,
          mercs: c.mercs.map((m) => (m.id === 'merc-1' ? { ...m, inventory: [{ itemId: 'healing-draught', quantity: 1 }] } : m)),
          combatants: c.combatants.map((x) => (x.id === 'merc-1' ? { ...x, hp: 3 } : x)),
        },
      },
    };
    s = drinkPotion(giveTurnTo(s, 'merc-1'), 'healing-draught', combatContext);
    expect(combatantById(combatOf(s), 'merc-1').hp).toBe(11);
  });

  it('uses a gear ability and puts it on cooldown', () => {
    let s = giveTurnTo(fight(room).state, 'merc-1', { abilityIds: ['rally'] });
    s = castAbility(s, 'rally', null, combatContext);
    expect(combatantById(combatOf(s), 'merc-1').cooldowns.rally).toBe(4);
  });

  it('flees on a good roll and stays on a bad one', () => {
    const outcomes = new Set<string | null>();
    for (let seed = 1; seed < 40; seed++) outcomes.add(combatOf(flee(giveTurnTo(fight(room, FOUR, seed).state, 'merc-1'), combatContext)).outcome);
    expect(outcomes).toEqual(new Set(['fled', null]));
  });
});

describe('enemy tactics', () => {
  it('a brawler closes in next to a merc', () => {
    const { state, ctx } = fight(room);
    const plan = planEnemyTurn(giveTurnTo(state, 'bandit-thug-1'), ctx);
    const target = combatOf(state).combatants.find((x) => x.side === 'party')!;
    expect(plan.move).not.toBeNull();
    expect(Math.min(...standing(combatOf(state), 'party').map((p) => distance(plan.move!, p.pos)))).toBeLessThanOrEqual(distance(plan.move!, target.pos));
  });

  it('an archer steps away from a merc next to it', () => {
    const { state, ctx } = fight(arena(8, 6, [{ monsterId: 'bandit-archer', count: 1 }]));
    const s = place(giveTurnTo(state, 'bandit-archer-1'), { 'bandit-archer-1': { x: 3, y: 4 } });
    const plan = planEnemyTurn(s, ctx);
    expect(plan.move).not.toBeNull();
    expect(Math.min(...standing(combatOf(s), 'party').map((p) => distance(plan.move!, p.pos)))).toBeGreaterThanOrEqual(2);
  });

  it('a tank with no one in reach defends', () => {
    const { state, ctx } = fight(arena(12, 9, [{ monsterId: 'bandit-captain', count: 1 }]));
    const s = giveTurnTo(state, 'bandit-captain-1', { movement: 1 });
    expect(planEnemyTurn(s, ctx).action).toEqual({ kind: 'defend' });
  });
});

describe('ending a fight', () => {
  it('a victory writes HP back and clears the group', () => {
    let s = fight(room).state;
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, outcome: 'victory', combatants: c.combatants.map((x) => (x.side === 'enemy' ? { ...x, hp: 0 } : x.id === 'merc-1' ? { ...x, hp: 5 } : x)) } } };
    const after = finishCombat(s, ctxFor(room));
    expect(after.dungeon!.resolved).toContain('foes');
    expect(after.party[0]!.wounds).toBe(13 - 5);
  });

  it('after a defeat the fight can be tried again', () => {
    let s = fight(room).state;
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, outcome: 'defeat', combatants: c.combatants.map((x) => (x.side === 'party' ? { ...x, hp: 0 } : x)) } } };
    expect(standing(combatOf(retryCombat(s, ctxFor(room))), 'party')).toHaveLength(4);
  });
});

describe('whole fights', () => {
  /** A simple player: attack the weakest target in reach, otherwise walk towards the nearest enemy. */
  function partyTurn(s: GameState): GameState {
    const c = combatOf(s);
    const me = activeCombatant(c);
    const targets = attackTargets(c, me);
    if (!c.acted && targets.length > 0) return attack(s, [...targets].sort((a, b) => a.hp - b.hp)[0]!.id);
    if (c.moveLeft > 0) {
      const foe = standing(c, 'enemy').sort((a, b) => distance(me.pos, a.pos) - distance(me.pos, b.pos))[0]!;
      const best = [...reachableTiles(c, me).keys()]
        .map((k) => ({ x: Number(k.split(',')[0]), y: Number(k.split(',')[1]) }))
        .sort((a, b) => distance(a, foe.pos) - distance(b, foe.pos))[0];
      if (best && distance(best, foe.pos) < distance(me.pos, foe.pos)) return moveTo(s, best);
    }
    return c.acted ? endTurn(s) : defend(s);
  }

  it('always end, across seeds and room sizes', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const def = arena(5 + (seed % 7), 4 + (seed % 5), [
        { monsterId: 'bandit-thug', count: 1 },
        { monsterId: 'bandit-archer', count: 1 },
        { monsterId: 'hedge-mage', count: 1 },
      ], seed % 3 === 0);
      const started = fight(def, seed % 2 ? FOUR : ['pip-larkspur', 'vesper', 'dagna-ironbrow', 'brunna-stonehand'], seed);
      let state = started.state;
      for (let i = 0; i < 3000 && !combatOf(state).outcome; i++) {
        const actor = activeCombatant(combatOf(state));
        state = actor.side === 'enemy' ? runEnemyTurn(state, started.ctx) : partyTurn(state);
      }
      expect(combatOf(state).outcome, `seed ${seed}`).not.toBeNull();
    }
  });
});
