import { describe, expect, it } from 'vitest';
import { getMonster, PREMADES, premadeToDraft } from '../../src/content';
import {
  BOSS_IMMUNE,
  covers,
  footprint,
  gap,
  isEngaged,
  kickTargets,
  occupant,
  rangePenaltyBetween,
  roomFor,
  sizeOf,
  tileBlocked,
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
  rangePenalty,
  reach,
  reachableTiles,
  retryCombat,
  runEnemyStep,
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
  it('uses the room size for the grid', () => {
    const c = combatOf(fight(arena(8, 6, [{ monsterId: 'bandit-thug', count: 2 }])).state);
    expect([c.width, c.height]).toEqual([8, 6]);
  });

  it('starts each side where it stood on the map, keeping the distance between them', () => {
    // The party stands at the room's top-left corner, the enemies at its top-right.
    const c = combatOf(fight(arena(10, 6, [{ monsterId: 'bandit-thug', count: 2 }])).state);
    const party = standing(c, 'party');
    const enemies = standing(c, 'enemy');
    expect(party.every((x) => x.pos.x <= 2)).toBe(true);
    expect(enemies.every((x) => x.pos.x >= 8)).toBe(true);
    const gap = Math.min(...party.flatMap((p) => enemies.map((e) => distance(p.pos, e.pos))));
    expect(gap).toBeGreaterThanOrEqual(6);
  });

  it('starts closer when the party was closer on the map', () => {
    const def = arena(10, 6, [{ monsterId: 'bandit-thug', count: 1 }]);
    const ctx = ctxFor(def);
    let near = enterDungeon(partyOf(FOUR), def);
    near = { ...near, screen: 'combat', dungeon: { ...near.dungeon!, pos: { x: 8, y: 1 } }, encounter: { featureId: 'foes', returnTo: def.start } };
    const c = combatOf(startCombat(near, ctx));
    const thug = standing(c, 'enemy')[0]!;
    expect(Math.min(...standing(c, 'party').map((p) => distance(p.pos, thug.pos)))).toBeLessThanOrEqual(2);
  });

  it('starts a party still in the doorway at the nearest edge of the room', () => {
    const def = arena(10, 6, [{ monsterId: 'bandit-thug', count: 1 }]);
    const ctx = ctxFor(def);
    let s = enterDungeon(partyOf(FOUR), def);
    // Outside the room, to its left, level with the third row.
    s = { ...s, screen: 'combat', dungeon: { ...s.dungeon!, pos: { x: 0, y: 3 } }, encounter: { featureId: 'foes', returnTo: def.start } };
    const c = combatOf(startCombat(s, ctx));
    expect(standing(c, 'party').every((x) => x.pos.x <= 1)).toBe(true);
  });

  it('a surprised group loses its whole first round', () => {
    const def = arena(8, 6, [{ monsterId: 'bandit-thug', count: 2 }]);
    const ctx = ctxFor(def);
    let s = enterDungeon(partyOf(FOUR), def);
    s = { ...s, screen: 'combat', encounter: { featureId: 'foes', returnTo: def.start, surprise: true } };
    let state = startCombat(s, ctx);
    const c = combatOf(state);
    expect(c.surprise).toBe(true);
    expect(c.log[0]).toMatch(/Surprise!/);
    // Round 1 is the party's alone.
    for (let i = 0; i < 10 && combatOf(state).round === 1; i++) {
      expect(activeCombatant(combatOf(state)).side).toBe('party');
      state = endTurn(state);
    }
    const after = combatOf(state);
    expect(after.round).toBe(2);
    expect(after.log.filter((l) => /caught off guard and loses the turn/.test(l))).toHaveLength(2);
    // From round 2 the enemies act as usual.
    const seen = new Set<string>();
    for (let i = 0; i < 10 && combatOf(state).round === 2; i++) {
      seen.add(activeCombatant(combatOf(state)).side);
      const actor = activeCombatant(combatOf(state));
      state = actor.side === 'enemy' ? runEnemyTurn(state, ctx) : endTurn(state);
    }
    expect(seen.has('enemy')).toBe(true);
  });

  it('gives no surprise round in an ambush', () => {
    const def = arena(8, 6, [{ monsterId: 'bandit-thug', count: 2 }], true);
    const ctx = ctxFor(def);
    let s = enterDungeon(partyOf(FOUR), def);
    s = { ...s, screen: 'combat', encounter: { featureId: 'foes', returnTo: def.start, surprise: true } };
    const c = combatOf(startCombat(s, ctx));
    expect(c.ambush).toBe(true);
    expect(c.surprise).toBeUndefined();
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
  // These checks are pure geometry: no obstacle sits in the way.
  const clear = { obstacles: [] } as unknown as CombatState;

  it('lets melee hit the eight tiles around', () => {
    expect(reach(clear, 0, { x: 2, y: 2 }, { x: 3, y: 3 }, false).ok).toBe(true);
    expect(reach(clear, 0, { x: 2, y: 2 }, { x: 4, y: 2 }, false).ok).toBe(false);
  });

  it('gives ranged attacks disadvantage while engaged', () => {
    expect(reach(clear, 8, { x: 0, y: 0 }, { x: 8, y: 3 }, false)).toEqual({ ok: true, mode: 'normal' });
    expect(reach(clear, 8, { x: 0, y: 0 }, { x: 9, y: 0 }, false).ok).toBe(false);
    expect(reach(clear, 8, { x: 0, y: 0 }, { x: 1, y: 0 }, true).mode).toBe('disadvantage');
  });

  it('takes 1 off a ranged or magic roll for every two squares to the target, and nothing off melee', () => {
    const at = { x: 0, y: 0 };
    expect(rangePenalty('ranged', at, { x: 1, y: 0 })).toBe(0);
    expect(rangePenalty('ranged', at, { x: 2, y: 1 })).toBe(1);
    expect(rangePenalty('ranged', at, { x: 3, y: 3 })).toBe(1);
    expect(rangePenalty('magic', at, { x: 4, y: 0 })).toBe(2);
    expect(rangePenalty('ranged', at, { x: 8, y: 5 })).toBe(4);
    expect(rangePenalty('melee', at, { x: 1, y: 1 })).toBe(0);
  });

  it('applies the distance penalty to a real bow shot', () => {
    const { state } = fight(arena(10, 6, [{ monsterId: 'bandit-thug', count: 1 }]));
    const sylwen = combatOf(state).combatants.find((x) => x.name === 'Sylwen Ashbow')!;
    let s = giveTurnTo(state, sylwen.id);
    s = place(s, { [sylwen.id]: { x: 0, y: 0 }, 'bandit-thug-1': { x: 5, y: 0 } });
    // Keep everyone else out of the line of fire.
    const c = combatOf(s);
    s = place(s, Object.fromEntries(c.combatants.filter((x) => x.id !== sylwen.id && x.side === 'party').map((x, i) => [x.id, { x: i, y: 5 }])));
    const roll = combatOf(attack(s, 'bandit-thug-1')).events.find((e) => e.kind === 'attack')!.roll!;
    expect(roll.rangePenalty).toBe(2);
    expect(roll.total).toBe(roll.natural + roll.modifier - 2);
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
    const s = place(giveTurnTo(state, 'bandit-archer-1'), { 'bandit-archer-1': { x: 3, y: 4 }, 'merc-1': { x: 3, y: 5 } });
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

describe('showing enemy attacks', () => {
  /** A thug standing next to Aldric with its whole move left, so its turn ends in the same step as its attack. */
  function thugBesideAldric(hp?: number): { state: GameState; ctx: CombatContext } {
    const { state, ctx } = fight(room);
    const aldric = combatOf(state).combatants.find((x) => x.mercId === 'merc-1')!;
    let s = place(giveTurnTo(state, 'bandit-thug-1'), { 'bandit-thug-1': { x: aldric.pos.x + 1, y: aldric.pos.y } });
    if (hp !== undefined) {
      const c = combatOf(s);
      s = { ...s, encounter: { ...s.encounter!, combat: { ...c, combatants: c.combatants.map((x) => (x.id === aldric.id ? { ...x, hp } : x)) } } };
    }
    return { state: s, ctx };
  }

  it('keeps the attack in the events when the enemy ends its turn in the same step', () => {
    const { state, ctx } = thugBesideAldric();
    const before = combatOf(state);
    const after = combatOf(runEnemyStep(state, ctx));
    expect(after.order[after.turn]).not.toBe('bandit-thug-1');
    expect(after.seq).toBeGreaterThan(before.seq);
    expect(after.events.some((e) => e.kind === 'attack' && e.actorId === 'bandit-thug-1' && e.roll)).toBe(true);
  });

  it('keeps the attack and the fall when the blow takes a merc down', () => {
    // Find a seed where the thug's blow gets through Aldric's armour while he has 1 HP.
    for (let seed = 1; seed <= 200; seed++) {
      const { state, ctx } = thugBesideAldric(1);
      const after = combatOf(runEnemyStep({ ...state, rngSeed: seed }, ctx));
      const blow = after.events.find((e) => e.kind === 'attack' && e.actorId === 'bandit-thug-1');
      expect(blow, `seed ${seed}`).toBeDefined();
      if (!blow!.amount) continue;
      expect(after.events.some((e) => e.kind === 'down' && e.actorId === blow!.targetId)).toBe(true);
      return;
    }
    throw new Error('No seed got a blow through.');
  });

  it('records each attack in the history with the roll and the damage', () => {
    const { state, ctx } = thugBesideAldric();
    const after = combatOf(runEnemyStep(state, ctx));
    const entry = after.history!.find((e) => e.attack?.attackerId === 'bandit-thug-1')!;
    expect(entry.attack!.attackerSide).toBe('enemy');
    expect(entry.attack!.targetSide).toBe('party');
    expect(entry.attack!.roll.total).toBe(entry.attack!.roll.natural + entry.attack!.roll.modifier);
    expect(entry.attack!.roll.damage).toBe(after.events.find((e) => e.kind === 'attack')!.amount);
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

  it('a victory with enough XP levels the party up and says so', () => {
    let s = fight(room).state;
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, xp: 2000, outcome: 'victory', combatants: c.combatants.map((x) => (x.side === 'enemy' ? { ...x, hp: 0 } : x)) } } };
    const after = finishCombat(s, ctxFor(room));
    expect(after.party.every((m) => m.level >= 2)).toBe(true);
    expect(after.dungeon!.log.some((l) => /reaches level/.test(l))).toBe(true);
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

describe('large creatures', () => {
  const trollRoom = arena(10, 7, [{ monsterId: 'cave-troll', count: 1 }]);

  it('covers every square of its size, and blocks them all', () => {
    const { state } = fight(trollRoom);
    const c = combatOf(state);
    const troll = combatantById(c, 'cave-troll-1');
    expect(sizeOf(troll)).toBe(2);
    for (const p of footprint(troll, troll.pos)) {
      expect(occupant(c, p)?.id).toBe('cave-troll-1');
      expect(tileBlocked(c, p)).toBe(true);
    }
    // Nobody else starts on any of its squares, and it fits on the grid.
    for (const x of c.combatants.filter((k) => k.id !== troll.id)) expect(covers(troll, troll.pos, x.pos)).toBe(false);
    expect(troll.pos.x + 1).toBeLessThan(c.width);
    expect(troll.pos.y + 1).toBeLessThan(c.height);
  });

  it('can be hit in melee from next to any of its squares, and reaches everyone next to it', () => {
    const { state } = fight(trollRoom);
    // Troll at 4,2 covers 4–5 × 2–3; Aldric stands off its bottom-right corner.
    let s = place(state, { 'cave-troll-1': { x: 4, y: 2 }, 'merc-1': { x: 6, y: 4 } });
    s = place(s, { 'merc-2': { x: 0, y: 6 }, 'merc-3': { x: 1, y: 6 }, 'merc-4': { x: 2, y: 6 } });
    const c = combatOf(s);
    const aldric = combatantById(c, 'merc-1');
    const troll = combatantById(c, 'cave-troll-1');
    expect(gap(aldric, troll)).toBe(1);
    expect(attackTargets(c, aldric).map((t) => t.id)).toContain('cave-troll-1');
    expect(attackTargets(c, troll).map((t) => t.id)).toEqual(['merc-1']);
    expect(isEngaged(c, aldric)).toBe(true);
  });

  it('only moves where its whole body fits', () => {
    const { state } = fight(trollRoom);
    let s = place(state, { 'cave-troll-1': { x: 4, y: 2 } });
    s = place(s, { 'merc-1': { x: 0, y: 6 }, 'merc-2': { x: 1, y: 6 }, 'merc-3': { x: 2, y: 6 }, 'merc-4': { x: 4, y: 5 } });
    s = giveTurnTo(s, 'cave-troll-1');
    const c = combatOf(s);
    const troll = combatantById(c, 'cave-troll-1');
    for (const k of reachableTiles(c, troll).keys()) {
      const [x, y] = k.split(',').map(Number);
      const at = { x: x!, y: y! };
      expect(roomFor(c, troll, at)).toBe(true);
      expect(at.x + 1).toBeLessThan(c.width);
      expect(at.y + 1).toBeLessThan(c.height);
    }
    // Moving down one row would put its lower half on Maelis at 4,5.
    expect(reachableTiles(c, troll).has('4,4')).toBe(false);
  });

  it('cannot be kicked back', () => {
    const { state } = fight(trollRoom);
    let s = place(state, { 'cave-troll-1': { x: 4, y: 2 }, 'merc-1': { x: 3, y: 2 } });
    s = giveTurnTo(s, 'merc-1');
    expect(kickTargets(combatOf(s), combatantById(combatOf(s), 'merc-1'))).toEqual([]);
  });

  it('measures the range penalty to its nearest square', () => {
    const { state } = fight(trollRoom);
    const s = place(state, { 'cave-troll-1': { x: 4, y: 2 }, 'merc-3': { x: 0, y: 2 } });
    const c = combatOf(s);
    // Sylwen at 0,2; the troll's nearest square is 4,2: four squares, -2.
    expect(rangePenaltyBetween('ranged', combatantById(c, 'merc-3'), combatantById(c, 'cave-troll-1'))).toBe(2);
  });

  it('a 3×3 golem never outgrows a corridor fight', () => {
    const corridor: DungeonDefinition = { ...arena(6, 4, [{ monsterId: 'stone-golem', count: 1 }]), rooms: [] };
    const c = combatOf(fight(corridor).state);
    const golem = combatantById(c, 'stone-golem-1');
    expect(sizeOf(golem)).toBeLessThan(c.height);
    for (const p of footprint(golem, golem.pos)) {
      expect(p.x).toBeLessThan(c.width);
      expect(p.y).toBeLessThan(c.height);
    }
  });
});

describe('boss fights', () => {
  const vault = arena(9, 6, [{ monsterId: 'bandit-captain', count: 1 }]);

  /** The captain on the given HP with Aldric next to him and the first turn, retried over seeds until Aldric's blow lands. */
  function captainHitAt(hp: number): CombatState {
    for (let seed = 1; seed < 200; seed++) {
      const { state } = fight(vault, FOUR, seed);
      let s = place(state, { 'bandit-captain-1': { x: 4, y: 2 }, 'merc-1': { x: 3, y: 2 } });
      const c = combatOf(s);
      s = { ...s, encounter: { ...s.encounter!, combat: { ...c, combatants: c.combatants.map((x) => (x.id === 'bandit-captain-1' ? { ...x, hp } : x)) } } };
      s = giveTurnTo({ ...s, rngSeed: seed }, 'merc-1');
      const after = combatOf(attack(s, 'bandit-captain-1'));
      const blow = after.events.find((e) => e.kind === 'attack');
      if (blow?.amount && combatantById(after, 'bandit-captain-1').hp > 0) return after;
    }
    throw new Error('No seed landed a blow that left the captain standing.');
  }

  it('is a boss from the start, with his reinforcements held back', () => {
    const c = combatOf(fight(vault).state);
    const captain = combatantById(c, 'bandit-captain-1');
    expect(captain.boss?.reached).toBe(0);
    expect(captain.boss?.phases).toHaveLength(2);
    expect(c.reserves).toHaveLength(2);
    expect(c.combatants.some((x) => x.id.includes('-p2-'))).toBe(false);
  });

  it('enters his second phase at half health: buffed, and two bandits join next to him', () => {
    const before = combatOf(fight(vault).state).xp;
    const c = captainHitAt(16);
    const captain = combatantById(c, 'bandit-captain-1');
    expect(captain.boss?.reached).toBe(1);
    expect(captain.buffs.some((b) => b.source === 'Phase 2')).toBe(true);
    const arrivals = c.combatants.filter((x) => x.id.includes('-p2-'));
    expect(arrivals).toHaveLength(2);
    for (const a of arrivals) {
      expect(a.side).toBe('enemy');
      expect(a.pos.x).toBeGreaterThanOrEqual(0);
      expect(c.order).toContain(a.id);
    }
    // They act right after the captain.
    const at = c.order.indexOf('bandit-captain-1');
    expect(c.order.slice(at + 1, at + 3).sort()).toEqual(arrivals.map((a) => a.id).sort());
    expect(c.reserves ?? []).toHaveLength(0);
    expect(c.xp).toBe(before + 2 * 25);
    expect(c.history!.some((e) => e.phase && /roars for his men/.test(e.text))).toBe(true);
  });

  it('runs through every threshold one blow crosses', () => {
    const c = captainHitAt(8);
    const captain = combatantById(c, 'bandit-captain-1');
    expect(captain.boss?.reached).toBe(2);
    expect(c.history!.filter((e) => e.phase)).toHaveLength(2);
  });

  it('cannot be kicked, stunned or knocked about', () => {
    const { state } = fight(vault);
    let s = place(state, { 'bandit-captain-1': { x: 4, y: 2 }, 'merc-1': { x: 3, y: 2 } });
    s = giveTurnTo(s, 'merc-1');
    expect(kickTargets(combatOf(s), combatantById(combatOf(s), 'merc-1'))).toEqual([]);
    expect(BOSS_IMMUNE).toEqual(expect.arrayContaining(['stunned', 'frozen', 'feared', 'prone']));
  });
});
