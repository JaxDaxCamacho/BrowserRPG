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
  drinkPotion,
  effectiveDefense,
  endTurn,
  finishCombat,
  flee,
  moveCombatant,
  planEnemyTurn,
  reach,
  retryCombat,
  runEnemyTurn,
  setLeader,
  standing,
  startCombat,
  startNewGame,
  enterDungeon,
  DEFEND_BONUS,
  type CombatContext,
  type CombatState,
  type Combatant,
  type DungeonDefinition,
  type GameState,
  type MonsterDefinition,
} from '../../src/engine';
import { combatContext } from '../../src/state/context';

/** A test arena: one room with a configurable number of rows and one enemy group. */
function arena(rows: number, monsters: { monsterId: string; count: number }[], ambush = false): DungeonDefinition {
  return {
    id: 'arena',
    name: 'the arena',
    width: 9,
    height: 7,
    tiles: ['#########', '#,,,,,,,#', '#,,,,,,,#', '#,,,,,,,#', '#,,,,,,,#', '#,,,,,,,#', '#########'],
    start: { x: 1, y: 3 },
    rooms: [{ id: 'pit', x: 1, y: 1, width: 7, height: 5, rows }],
    features: [
      { type: 'encounter', id: 'foes', name: 'The foes', x: 6, y: 3, monsters, ...(ambush ? { ambush } : {}) },
      { type: 'goal', id: 'goal', name: 'Goal', x: 7, y: 5, dialogueId: 'goal-strongbox' },
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
  return { ...s, encounter: { ...s.encounter!, combat: { ...c, order, combatants, turn: 0, moved: false, acted: false } } };
}

function place(s: GameState, rows: Record<string, number>): GameState {
  const c = combatOf(s);
  return { ...s, encounter: { ...s.encounter!, combat: { ...c, combatants: c.combatants.map((x) => (x.id in rows ? { ...x, row: rows[x.id]! } : x)) } } };
}

describe('setting up a fight', () => {
  it('uses the room size for rows, party on the lowest row and enemies on the highest', () => {
    const { state } = fight(arena(3, [{ monsterId: 'bandit-thug', count: 2 }]));
    const c = combatOf(state);
    expect(c.rows).toBe(3);
    expect(standing(c, 'party').every((x) => x.row === 0)).toBe(true);
    expect(standing(c, 'enemy').every((x) => x.row === 2)).toBe(true);
    expect(standing(c, 'enemy').map((x) => x.name)).toEqual(['Bandit Thug 1', 'Bandit Thug 2']);
  });

  it('puts the party in the middle of a 5-row ambush with enemies above and below', () => {
    const { state } = fight(arena(5, [{ monsterId: 'bandit-thug', count: 2 }], true));
    const c = combatOf(state);
    expect(c.ambush).toBe(true);
    expect(standing(c, 'party').every((x) => x.row === 2)).toBe(true);
    expect(standing(c, 'enemy').map((x) => x.row).sort()).toEqual([0, 4]);
  });

  it('ignores the ambush flag in rooms smaller than 5 rows', () => {
    const { state } = fight(arena(3, [{ monsterId: 'bandit-thug', count: 1 }], true));
    expect(combatOf(state).ambush).toBe(false);
  });

  it('orders turns by initiative, highest first', () => {
    const c = combatOf(fight(arena(3, [{ monsterId: 'bandit-thug', count: 2 }])).state);
    const inits = c.order.map((id) => combatantById(c, id).initiative);
    expect(inits).toEqual([...inits].sort((a, b) => b - a));
  });

  it('takes HP, Defense and weapon from the merc sheet and gear', () => {
    const c = combatOf(fight(arena(3, [{ monsterId: 'bandit-thug', count: 1 }])).state);
    const aldric = combatantById(c, 'merc-1');
    expect(aldric.maxHp).toBe(13);
    expect(aldric.baseDefense).toBe(9);
    expect(aldric.attack.name).toBe('Arming Sword');
    expect(combatantById(c, 'merc-3').attack).toMatchObject({ name: 'Shortbow', range: 3, ammoId: 'arrows' });
    // Elves crit on 19 with bows.
    expect(combatantById(c, 'merc-3').critThreshold).toBe(19);
  });
});

describe('reach', () => {
  it('lets melee hit only the same row', () => {
    expect(reach(0, 1, 1)).toEqual({ ok: true, mode: 'normal' });
    expect(reach(0, 1, 2).ok).toBe(false);
  });

  it('lets ranged attacks reach their range, with disadvantage in the same row', () => {
    expect(reach(3, 0, 3)).toEqual({ ok: true, mode: 'normal' });
    expect(reach(3, 0, 4).ok).toBe(false);
    expect(reach(3, 2, 2)).toEqual({ ok: true, mode: 'disadvantage' });
  });
});

describe('the party\'s turn', () => {
  const def = arena(3, [{ monsterId: 'bandit-thug', count: 1 }]);

  it('refuses a melee attack across rows', () => {
    const s = giveTurnTo(fight(def).state, 'merc-1');
    expect(attackTargets(combatOf(s), activeCombatant(combatOf(s)))).toEqual([]);
    expect(() => attack(s, 'bandit-thug-1')).toThrow(/cannot reach/);
  });

  it('hits in the same row and lowers HP', () => {
    let hurt = false;
    for (let seed = 1; seed < 40 && !hurt; seed++) {
      let s = place(giveTurnTo(fight(def, FOUR, seed).state, 'merc-1'), { 'merc-1': 2 });
      s = attack(s, 'bandit-thug-1');
      const thug = combatantById(combatOf(s), 'bandit-thug-1');
      if (thug.hp < thug.maxHp) hurt = true;
      expect(combatOf(s).acted).toBe(true);
    }
    expect(hurt).toBe(true);
  });

  it('records the dice and the damage working for every attack, and the working adds up', () => {
    for (let seed = 1; seed < 80; seed++) {
      let s = place(giveTurnTo(fight(def, FOUR, seed).state, 'merc-1'), { 'merc-1': 2 });
      s = attack(s, 'bandit-thug-1');
      const event = combatOf(s).events.find((e) => e.kind === 'attack')!;
      const r = event.roll!;
      expect(r.label).toBe('Arming Sword');
      expect(r.stat).toBe('strength');
      expect(r.dice).toEqual([r.natural]);
      expect(r.total).toBe(r.natural + r.modifier);
      const main = r.damage - r.extraDamage;
      const raw =
        event.outcome === 'miss' ? 0
        : event.outcome === 'graze' ? r.grazeRoll + r.modifier
        : event.outcome === 'hit' ? r.hitRoll + r.modifier
        : (r.grazeRoll + r.hitRoll + r.modifier) * 2;
      expect(main).toBe(event.outcome === 'miss' ? 0 : Math.max(0, raw - r.armour));
    }
  });

  it('shows both dice for a ranged shot in the same row', () => {
    let s = place(giveTurnTo(fight(def).state, 'merc-3'), { 'merc-3': 2 });
    s = attack(s, 'bandit-thug-1');
    const r = combatOf(s).events[0]!.roll!;
    expect(r.mode).toBe('disadvantage');
    expect(r.dice).toHaveLength(2);
    expect(r.natural).toBe(Math.min(...r.dice));
    expect(r.critThreshold).toBe(19);
  });

  it('marks a free attack for leaving a row', () => {
    let s = place(giveTurnTo(fight(def).state, 'merc-1'), { 'merc-1': 2, 'bandit-thug-1': 2 });
    s = moveCombatant(s, -1);
    expect(combatOf(s).events.find((e) => e.kind === 'attack')?.roll?.free).toBe(true);
  });

  it('spends an arrow per shot', () => {
    let s = giveTurnTo(fight(def).state, 'merc-3');
    s = attack(s, 'bandit-thug-1');
    const sylwen = combatOf(s).mercs.find((m) => m.id === 'merc-3')!;
    expect(sylwen.inventory.find((i) => i.itemId === 'arrows')?.quantity).toBe(19);
  });

  it('cannot shoot with no arrows left', () => {
    let s = fight(def).state;
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, mercs: c.mercs.map((m) => (m.id === 'merc-3' ? { ...m, inventory: [] } : m)) } } };
    s = giveTurnTo(s, 'merc-3');
    expect(attackTargets(combatOf(s), activeCombatant(combatOf(s)))).toEqual([]);
  });

  it('allows one move and one action, then ends the turn by itself', () => {
    let s = giveTurnTo(fight(def).state, 'merc-1');
    s = moveCombatant(s, 1);
    expect(combatantById(combatOf(s), 'merc-1').row).toBe(1);
    expect(() => moveCombatant(s, 1)).toThrow(/already has its move/);
    s = defend(s);
    expect(activeCombatant(combatOf(s)).id).not.toBe('merc-1');
  });

  it('gives a free melee attack to an enemy when leaving its row', () => {
    let s = place(giveTurnTo(fight(def).state, 'merc-1'), { 'merc-1': 2, 'bandit-thug-1': 2 });
    s = moveCombatant(s, -1);
    expect(combatOf(s).log.some((l) => l.includes('strikes as Aldric Vane breaks away'))).toBe(true);
  });

  it('defending adds 2 Defense until the defender\'s next turn', () => {
    let s = giveTurnTo(fight(def).state, 'merc-1');
    const before = effectiveDefense(combatantById(combatOf(s), 'merc-1'));
    s = defend(s);
    expect(effectiveDefense(combatantById(combatOf(s), 'merc-1'))).toBe(before + DEFEND_BONUS);
    s = giveTurnTo(s, 'merc-1');
    s = endTurn(s);
    // A new turn for Aldric clears it.
    const c = combatOf(s);
    const back = { ...s, encounter: { ...s.encounter!, combat: { ...c, turn: c.order.indexOf('merc-1') - 1 } } };
    const again = endTurn(back);
    expect(combatantById(combatOf(again), 'merc-1').defending).toBe(false);
  });

  it('drinks a healing draught from the pack', () => {
    let s = fight(def).state;
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
    expect(combatOf(s).mercs.find((m) => m.id === 'merc-1')!.inventory).toEqual([]);
  });

  it('uses a gear ability and puts it on cooldown', () => {
    let s = fight(def).state;
    s = giveTurnTo(s, 'merc-1', { abilityIds: ['rally'] });
    s = castAbility(s, 'rally', null, combatContext);
    const c = combatOf(s);
    expect(combatantById(c, 'merc-2').buffs[0]).toMatchObject({ source: 'Rally', roundsLeft: 3 });
    expect(combatantById(c, 'merc-1').cooldowns.rally).toBe(4);
  });

  it('flees on a good Agility roll and stays put on a bad one', () => {
    const outcomes = new Set<string | null>();
    for (let seed = 1; seed < 40; seed++) {
      const s = flee(giveTurnTo(fight(def, FOUR, seed).state, 'merc-1'), combatContext);
      outcomes.add(combatOf(s).outcome);
    }
    expect(outcomes).toEqual(new Set(['fled', null]));
  });
});

describe('enemy tactics', () => {
  it('a brawler walks to the party\'s row and attacks', () => {
    const { state, ctx } = fight(arena(3, [{ monsterId: 'bandit-thug', count: 1 }]));
    const s = place(giveTurnTo(state, 'bandit-thug-1'), { 'bandit-thug-1': 1 });
    const plan = planEnemyTurn(s, ctx);
    expect(plan.move).toBe(-1);
    expect(plan.action.kind).toBe('attack');
  });

  it('an archer steps out of a merc\'s row before shooting', () => {
    const { state, ctx } = fight(arena(3, [{ monsterId: 'bandit-archer', count: 1 }]));
    const s = place(giveTurnTo(state, 'bandit-archer-1'), { 'bandit-archer-1': 0 });
    expect(planEnemyTurn(s, ctx).move).toBe(1);
  });

  it('an assassin goes for the softest merc', () => {
    const assassin: MonsterDefinition = { ...getMonster('bandit-thug'), id: 'cutthroat', name: 'Cutthroat', archetype: 'assassin' };
    const { state, ctx } = fight(arena(3, [{ monsterId: 'cutthroat', count: 1 }]), FOUR, 5, [assassin]);
    const s = place(giveTurnTo(state, 'cutthroat-1'), { 'cutthroat-1': 0 });
    const plan = planEnemyTurn(s, ctx);
    // Maelis the wizard has the fewest HP and no armour.
    expect(plan.action).toEqual({ kind: 'attack', targetId: 'merc-4' });
  });

  it('a tank with no one in reach defends', () => {
    const { state, ctx } = fight(arena(5, [{ monsterId: 'bandit-captain', count: 1 }]));
    const s = giveTurnTo(state, 'bandit-captain-1');
    expect(planEnemyTurn(s, ctx)).toEqual({ move: -1, action: { kind: 'defend' } });
  });

  it('a healer patches up a badly hurt ally', () => {
    const mender: MonsterDefinition = { ...getMonster('hedge-mage'), id: 'mender', name: 'Mender', archetype: 'healer', abilityIds: ['mend'] };
    const mend = { id: 'mend', name: 'Mend', description: 'Heals 6.', activation: 'action' as const, usableBy: 'monsters' as const, target: 'ally' as const, range: 4, effects: [{ type: 'heal' as const, amount: 6 }] };
    const def = arena(3, [{ monsterId: 'mender', count: 1 }, { monsterId: 'bandit-thug', count: 1 }]);
    const ctx = { ...ctxFor(def, [mender]), getAbility: (id: string) => (id === 'mend' ? mend : combatContext.getAbility(id)) };
    let state = enterDungeon(partyOf(FOUR), def);
    state = startCombat({ ...state, screen: 'combat', encounter: { featureId: 'foes', returnTo: def.start } }, ctx);
    const c = combatOf(state);
    state = { ...state, encounter: { ...state.encounter!, combat: { ...c, combatants: c.combatants.map((x) => (x.id === 'bandit-thug-1' ? { ...x, hp: 2 } : x)) } } };
    state = giveTurnTo(state, 'mender-1');
    expect(planEnemyTurn(state, ctx).action).toEqual({ kind: 'ability', abilityId: 'mend', targetId: 'bandit-thug-1' });
    state = runEnemyTurn(state, ctx);
    expect(combatantById(combatOf(state), 'bandit-thug-1').hp).toBe(8);
  });
});

describe('ending a fight', () => {
  const def = arena(3, [{ monsterId: 'bandit-thug', count: 1 }]);

  it('a victory writes HP back, raises the fallen to 1 HP, shares XP and clears the group', () => {
    let s = fight(def).state;
    const c = combatOf(s);
    s = {
      ...s,
      encounter: {
        ...s.encounter!,
        combat: {
          ...c,
          outcome: 'victory',
          combatants: c.combatants.map((x) => (x.id === 'bandit-thug-1' ? { ...x, hp: 0 } : x.id === 'merc-2' ? { ...x, hp: 0 } : x.id === 'merc-1' ? { ...x, hp: 5 } : x)),
        },
      },
    };
    const after = finishCombat(s, ctxFor(def));
    expect(after.screen).toBe('dungeon');
    expect(after.encounter).toBeNull();
    expect(after.dungeon!.resolved).toContain('foes');
    const [aldric, korg, sylwen] = after.party;
    expect(aldric!.wounds).toBe(13 - 5);
    expect(korg).toMatchObject({ wounds: korg!.wounds, down: false });
    expect(korg!.wounds).toBe(20 - 1);
    // 25 XP shared by the three left standing; Korg was down.
    expect(aldric!.xp).toBe(Math.floor((25 / 3) * 1.03));
    expect(sylwen!.xp).toBe(8);
    expect(korg!.xp).toBe(0);
  });

  it('after a defeat the fight can be tried again from the start', () => {
    let s = fight(def).state;
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, outcome: 'defeat', combatants: c.combatants.map((x) => (x.side === 'party' ? { ...x, hp: 0 } : x)) } } };
    expect(finishCombat(s, ctxFor(def))).toBe(s);
    const again = retryCombat(s, ctxFor(def));
    expect(combatOf(again).outcome).toBeNull();
    expect(standing(combatOf(again), 'party')).toHaveLength(4);
  });
});

describe('whole fights', () => {
  /** A simple player: attack the weakest target in reach, otherwise step towards the enemy, otherwise defend. */
  function partyTurn(s: GameState): GameState {
    const c = combatOf(s);
    const me = activeCombatant(c);
    const targets = attackTargets(c, me);
    if (!c.acted && targets.length > 0) return attack(s, [...targets].sort((a, b) => a.hp - b.hp)[0]!.id);
    if (!c.moved) {
      const foe = standing(c, 'enemy')[0]!;
      const step = foe.row > me.row ? 1 : -1;
      if (me.row + step >= 0 && me.row + step < c.rows) return moveCombatant(s, step);
    }
    return c.acted ? endTurn(s) : defend(s);
  }

  it('always end, in victory or defeat, across many seeds and room sizes', () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const rows = 2 + (seed % 4);
      const def = arena(rows, [
        { monsterId: 'bandit-thug', count: 1 },
        { monsterId: 'bandit-archer', count: 1 },
        { monsterId: 'hedge-mage', count: 1 },
        { monsterId: 'war-hound', count: seed % 2 },
      ].filter((m) => m.count > 0), rows === 5 && seed % 3 === 0);
      const started = fight(def, seed % 2 ? FOUR : ['pip-larkspur', 'vesper', 'dagna-ironbrow', 'brunna-stonehand'], seed);
      const ctx = started.ctx;
      let state = started.state;
      for (let i = 0; i < 2000 && !combatOf(state).outcome; i++) {
        const actor = activeCombatant(combatOf(state));
        state = actor.side === 'enemy' ? runEnemyTurn(state, ctx) : partyTurn(state);
      }
      const outcome = combatOf(state).outcome;
      expect(outcome, `seed ${seed}`).not.toBeNull();
      outcomes.add(outcome!);
    }
    expect(outcomes.has('victory')).toBe(true);
  });
});
