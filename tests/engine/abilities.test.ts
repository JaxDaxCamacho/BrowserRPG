import { describe, expect, it } from 'vitest';
import { getAbility, getTalentTree, PREMADES, premadeToDraft } from '../../src/content';
import {
  abilityBlocker,
  addMerc,
  attack,
  attackTargets,
  effectiveMovement,
  effectiveStats,
  castAbility,
  combatantById,
  endTurn,
  isAiControlled,
  kick,
  kickTargets,
  enterDungeon,
  moveTo,
  planEnemyTurn,
  setLeader,
  spendTalentPoints,
  startCombat,
  startNewGame,
  talentBlocker,
  talentEffects,
  xpForLevel,
  type Combatant,
  type CombatContext,
  type CombatState,
  type DungeonDefinition,
  type GameState,
  type Pos,
} from '../../src/engine';
import { combatContext, currentHp, sheetOf } from '../../src/state/context';

// ---------- fixtures ----------

function arena(monsters: { monsterId: string; count: number }[]): DungeonDefinition {
  const width = 8;
  const height = 6;
  const tiles = Array.from({ length: height + 2 }, (_, y) => (y === 0 || y === height + 1 ? '#'.repeat(width + 2) : `#${','.repeat(width)}#`));
  return {
    id: 'arena',
    name: 'the arena',
    width: width + 2,
    height: height + 2,
    tiles,
    start: { x: 1, y: 1 },
    rooms: [{ id: 'pit', x: 1, y: 1, width, height, rows: 3 }],
    features: [
      { type: 'encounter', id: 'foes', name: 'The foes', x: width, y: 1, monsters },
      { type: 'goal', id: 'goal', name: 'Goal', x: width, y: height, dialogueId: 'goal-strongbox' },
    ],
  };
}

const room = arena([{ monsterId: 'bandit-thug', count: 2 }]);
const ctx: CombatContext = { ...combatContext, getDungeon: (id) => (id === room.id ? room : combatContext.getDungeon(id)) };

/** A party at a level, with talents learned (spent in town) and optional gear swaps. */
function party(
  members: { premade: string; talents?: string[]; mainHand?: string }[],
  level = 11,
): GameState {
  let s: GameState = { ...startNewGame(9), adventureId: 'greywater-ford' };
  for (const m of members) s = addMerc(s, premadeToDraft(PREMADES.find((p) => p.id === m.premade)!));
  s = { ...setLeader(s, 'merc-1'), screen: 'adventureSelect' };
  s = { ...s, party: s.party.map((m) => ({ ...m, level, xp: xpForLevel(level) })) };
  members.forEach((m, i) => {
    const merc = s.party[i]!;
    if (m.mainHand) s = { ...s, party: s.party.map((x) => (x.id === merc.id ? { ...x, equipment: { ...x.equipment, mainHand: m.mainHand } } : x)) };
    if (m.talents?.length) s = spendTalentPoints(s, merc.id, m.talents, getTalentTree(merc.classId)!);
  });
  return s;
}

function fight(s: GameState): GameState {
  const inside = enterDungeon(s, room);
  return startCombat({ ...inside, screen: 'combat', encounter: { featureId: 'foes', returnTo: room.start } }, ctx);
}

const combatOf = (s: GameState): CombatState => s.encounter!.combat!;
const who = (s: GameState, id: string): Combatant => combatantById(combatOf(s), id);

/** Hands the turn to one combatant, with optional changes to anyone. */
function setUp(s: GameState, activeId: string, changes: Record<string, Partial<Combatant>> = {}): GameState {
  const c = combatOf(s);
  const order = [activeId, ...c.order.filter((x) => x !== activeId)];
  const combatants = c.combatants.map((x) => (changes[x.id] ? { ...x, ...changes[x.id] } : x));
  const me = combatants.find((x) => x.id === activeId)!;
  return { ...s, encounter: { ...s.encounter!, combat: { ...c, order, combatants, turn: 0, moveLeft: me.movement, acted: false, outcome: null } } };
}

const at = (x: number, y: number): Pos => ({ x, y });
const pool = (current: number) => ({ adrenaline: { current, max: 10 } });
/** Never miss, never crit: the target's Defense is far below any roll, and natural 1s are re-seeded away by trying seeds. */
function withSeed(s: GameState, test: (g: GameState) => boolean): GameState {
  for (let seed = 1; seed < 500; seed++) if (test({ ...s, rngSeed: seed })) return { ...s, rngSeed: seed };
  throw new Error('No seed fits');
}

// ---------- talents ----------

describe('talent trees', () => {
  const knight = getTalentTree('knight')!;

  it('opens tier 2 after 5 points in a branch and tier 3 after 10', () => {
    let s = party([{ premade: 'aldric-vane' }]);
    const m = () => s.party[0]!;
    expect(talentBlocker(m(), knight, 't-execution')).toMatch(/Needs 5 points in Templar/);
    s = spendTalentPoints(s, 'merc-1', ['two-handed-mastery', 'two-handed-mastery', 'two-handed-mastery', 't-crushing-blow', 'heavy-swings'], knight);
    expect(talentBlocker(m(), knight, 't-execution')).toBeNull();
    expect(talentBlocker(m(), knight, 't-judgement')).toMatch(/Needs 10 points/);
    expect(talentBlocker(m(), knight, 'two-handed-mastery')).toBe('Fully learned');
  });

  it('refuses another class’s tree, too many points, and spending away from camp or town', () => {
    const s = party([{ premade: 'aldric-vane' }], 2); // 2 points
    expect(() => spendTalentPoints(s, 'merc-1', ['t-backstab'], getTalentTree('rogue')!)).toThrow(/not the knight/);
    expect(() => spendTalentPoints(s, 'merc-1', ['bulwark', 'bulwark', 'bulwark'], knight)).toThrow(/No talent points left/);
    expect(() => spendTalentPoints({ ...s, screen: 'dungeon' }, 'merc-1', ['bulwark'], knight)).toThrow(/camp or back in town/);
  });

  it('adds passive bonuses per rank and teaches abilities', () => {
    // Aldric starts with Taunt: his starting talent point is already placed.
    const s = party([{ premade: 'aldric-vane', talents: ['bulwark', 'bulwark', 'stalwart'] }]);
    const before = sheetOf(party([{ premade: 'aldric-vane' }]).party[0]!);
    const after = sheetOf(s.party[0]!);
    expect(after.defense).toBe(before.defense + 2);
    expect(after.maxHp).toBe(before.maxHp + 4);
    expect(after.abilityIds).toContain('taunt');
    expect(talentEffects(s.party[0]!, knight)).toContainEqual({ type: 'ability', abilityId: 'taunt' });
    expect(currentHp(s.party[0]!).max).toBe(after.maxHp);
  });
});

// ---------- abilities in a fight ----------

describe('resources and the action bar rules', () => {
  it('gives a merc pools for the resources their abilities use', () => {
    const s = fight(party([{ premade: 'pip-larkspur', talents: ['t-sidestep', 't-distract'] }]));
    const pip = who(s, 'merc-1');
    expect(pip.resources.adrenaline).toEqual({ current: 2, max: 10 });
    expect(pip.resources.mana?.current).toBe(pip.resources.mana?.max);
  });

  it('blocks an ability without enough of its resource, and spends it when used', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: ['t-crushing-blow'], mainHand: 'greatsword' }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(1) }, 'bandit-thug-1': { pos: at(4, 3) } });
    const blow = getAbility('crushing-blow');
    expect(abilityBlocker(combatOf(s), who(s, 'merc-1'), blow)).toBe('Needs 3 adrenaline');
    s = setUp(s, 'merc-1', { 'merc-1': { resources: pool(5) } });
    const after = castAbility(s, 'crushing-blow', 'bandit-thug-1', ctx);
    expect(who(after, 'merc-1').resources.adrenaline!.current).toBeGreaterThanOrEqual(2);
    expect(who(after, 'merc-1').cooldowns['crushing-blow']).toBe(2);
  });

  it('needs a two-handed weapon for Templar strikes', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: ['t-crushing-blow'] }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3) } });
    expect(abilityBlocker(combatOf(s), who(s, 'merc-1'), getAbility('crushing-blow'))).toBe('Needs a two-handed weapon');
  });
});

describe('conditions', () => {
  const knight = () =>
    fight(party([{ premade: 'aldric-vane', talents: ['two-handed-mastery', 'two-handed-mastery', 'two-handed-mastery', 't-crushing-blow', 'heavy-swings', 't-execution'], mainHand: 'greatsword' }]));

  it('a stunned enemy loses its turn, and Execution hits it much harder', () => {
    let s = setUp(knight(), 'merc-1', {
      'merc-1': { pos: at(3, 3), resources: pool(9) },
      'bandit-thug-1': { pos: at(4, 3), baseDefense: -50, hp: 200, maxHp: 200, statuses: [{ kind: 'stunned', rounds: 1 }] },
      'bandit-thug-2': { pos: at(7, 0) },
    });
    s = withSeed(s, (g) => combatOf(castAbility(g, 'execution', 'bandit-thug-1', ctx)).events.some((e) => e.roll && e.roll.natural > 1));
    const hit = castAbility(s, 'execution', 'bandit-thug-1', ctx);
    const roll = combatOf(hit).events.find((e) => e.kind === 'attack')!.roll!;
    // 3 two-handed mastery + at least 2 from 2d8.
    expect(roll.bonusDamage).toBeGreaterThanOrEqual(5);

    // The stunned thug's turn is skipped.
    const c = combatOf(s);
    const order = ['merc-1', 'bandit-thug-1', ...c.order.filter((x) => x !== 'merc-1' && x !== 'bandit-thug-1')];
    const queued = { ...s, encounter: { ...s.encounter!, combat: { ...c, order } } };
    const next = endTurn(queued);
    expect(combatOf(next).order[combatOf(next).turn]).not.toBe('bandit-thug-1');
    expect(combatOf(next).log.some((l) => /stunned and loses the turn/.test(l))).toBe(true);
    expect(who(next, 'bandit-thug-1').statuses).toEqual([]);
  });

  it('poison bites at the start of the poisoned one’s turn, then wears off', () => {
    let s = setUp(knight(), 'merc-1', { 'bandit-thug-1': { hp: 20, statuses: [{ kind: 'poisoned', rounds: 1, amount: 2 }] } });
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, order: ['merc-1', 'bandit-thug-1', ...c.order.filter((x) => x !== 'merc-1' && x !== 'bandit-thug-1')] } } };
    const next = endTurn(s);
    expect(who(next, 'bandit-thug-1').hp).toBe(18);
  });

  it('a taunted enemy goes for the taunter', () => {
    let s = fight(party([{ premade: 'aldric-vane' }, { premade: 'maelis-thorne' }]));
    s = setUp(s, 'bandit-thug-1', {
      'bandit-thug-1': { pos: at(4, 2), statuses: [{ kind: 'taunted', rounds: 2, sourceId: 'merc-1' }] },
      'merc-1': { pos: at(4, 5) },
      'merc-2': { pos: at(5, 2), hp: 1 },
    });
    const plan = planEnemyTurn(s, ctx);
    expect(plan.action).toEqual({ kind: 'attack', targetId: 'merc-1' });
  });

  it('the invisible cannot be targeted, attack with advantage, and are revealed by attacking', () => {
    let s = fight(party([{ premade: 'pip-larkspur' }]));
    s = setUp(s, 'bandit-thug-1', { 'merc-1': { pos: at(3, 3), statuses: [{ kind: 'invisible', rounds: 2 }] }, 'bandit-thug-1': { pos: at(4, 3) } });
    expect(attackTargets(combatOf(s), who(s, 'bandit-thug-1'))).toEqual([]);
    s = setUp(s, 'merc-1');
    const after = attack(s, 'bandit-thug-1');
    const roll = combatOf(after).events.find((e) => e.kind === 'attack')!.roll!;
    expect(roll.mode).toBe('advantage');
    expect(who(after, 'merc-1').statuses.some((st) => st.kind === 'invisible')).toBe(false);
  });

  it('retaliation hurts a melee attacker who lands a blow', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: ['bulwark', 'bulwark', 'bulwark', 'stalwart', 'stalwart', 'retribution', 'retribution'] }]));
    s = setUp(s, 'bandit-thug-1', { 'merc-1': { pos: at(3, 3), baseDefense: -50, hp: 100, maxHp: 100 }, 'bandit-thug-1': { pos: at(4, 3), hp: 50, maxHp: 50 } });
    expect(who(s, 'merc-1').retaliate).toBe(4);
    s = withSeed(s, (g) => combatOf(attack(g, 'merc-1')).events.some((e) => e.kind === 'attack' && e.outcome !== 'miss'));
    const after = attack(s, 'merc-1');
    expect(who(after, 'bandit-thug-1').hp).toBe(46);
  });

  it('Opening! lets an engaged ally make a free attack', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: ['t-forward', 't-hold-fast', 'field-discipline', 'field-discipline', 'field-discipline', 't-opening'] }, { premade: 'korg-the-unbowed' }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(1, 4), resources: pool(9) }, 'merc-2': { pos: at(4, 3) }, 'bandit-thug-1': { pos: at(5, 3) }, 'bandit-thug-2': { pos: at(7, 0) } });
    const after = castAbility(s, 'opening', 'merc-2', ctx);
    const free = combatOf(after).events.find((e) => e.kind === 'attack');
    expect(free).toMatchObject({ actorId: 'merc-2', targetId: 'bandit-thug-1' });
    expect(free!.roll!.free).toBe(true);
    // It was the knight's action, not Korg's turn.
    expect(combatOf(after).acted || combatOf(after).order[combatOf(after).turn] !== 'merc-1').toBe(true);
  });

  it('oil and a match: Light ’Em Up sets an oiled target burning and uses up the oil', () => {
    const talents = ['t-pocket-sand', 't-cheap-shot', 'dirty-fighting', 'dirty-fighting', 'dirty-fighting', 't-pierce-lung', 't-lighter-fluid', 'tough-customer', 'tough-customer', 'tough-customer', 't-light-em-up'];
    let s = fight(party([{ premade: 'pip-larkspur', talents }], 12));
    s = setUp(s, 'merc-1', {
      'merc-1': { pos: at(1, 4), resources: pool(9) },
      'bandit-thug-1': { pos: at(4, 3), baseDefense: -50, hp: 200, maxHp: 200, statuses: [{ kind: 'oiled', rounds: 3 }] },
    });
    s = withSeed(s, (g) => combatOf(castAbility(g, 'light-em-up', 'bandit-thug-1', ctx)).events.some((e) => e.kind === 'attack' && e.outcome !== 'miss'));
    const after = castAbility(s, 'light-em-up', 'bandit-thug-1', ctx);
    const thug = who(after, 'bandit-thug-1');
    expect(thug.statuses.map((st) => st.kind)).toEqual(['burning']);
    expect(combatOf(after).events.find((e) => e.kind === 'attack')!.roll!.bonusDamage).toBeGreaterThanOrEqual(2);
  });

  it('the evasive step away without drawing free attacks', () => {
    let s = fight(party([{ premade: 'pip-larkspur' }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), statuses: [{ kind: 'evasive', rounds: 2 }] }, 'bandit-thug-1': { pos: at(4, 3) }, 'bandit-thug-2': { pos: at(7, 0) } });
    const after = moveTo(s, at(1, 3));
    expect(combatOf(after).events.some((e) => e.kind === 'attack')).toBe(false);
    expect(who(after, 'merc-1').pos).toEqual(at(1, 3));
  });

  it('a slow takes movement away, and mana trickles back each turn', () => {
    let s = fight(party([{ premade: 'pip-larkspur', talents: ['t-sidestep', 't-distract'] }]));
    const pip = who(s, 'merc-1');
    s = setUp(s, 'bandit-thug-1', {
      'merc-1': { resources: { ...pip.resources, mana: { current: 0, max: pip.resources.mana!.max } }, buffs: [{ source: 'Pierce Lung', effects: [{ type: 'movement', amount: -2 }], roundsLeft: 2 }] },
    });
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, order: ['bandit-thug-1', 'merc-1', ...c.order.filter((x) => x !== 'merc-1' && x !== 'bandit-thug-1')] } } };
    const next = endTurn(s);
    expect(combatOf(next).moveLeft).toBe(Math.max(1, pip.movement - 2));
    expect(who(next, 'merc-1').resources.mana!.current).toBe(1);
  });
});

// ---------- the Barbarian ----------

describe('the Barbarian', () => {
  const mageRoom = arena([{ monsterId: 'hedge-mage', count: 1 }, { monsterId: 'bandit-thug', count: 1 }]);
  const mageCtx: CombatContext = { ...combatContext, getDungeon: (id) => (id === mageRoom.id ? mageRoom : combatContext.getDungeon(id)) };
  const mageFight = (s: GameState) =>
    startCombat({ ...enterDungeon(s, mageRoom), screen: 'combat', encounter: { featureId: 'foes', returnTo: mageRoom.start } }, mageCtx);
  const korg = (talents: string[], level = 11) => party([{ premade: 'korg-the-unbowed', talents }], level);
  const savagery5 = ['bloodrage', 'bloodrage', 'brute-strength', 'brute-strength', 'brute-strength'];
  const hunter5 = ['iron-will', 'iron-will', 'iron-will', 't-headbutt', 'stubborn'];
  const bully5 = ['t-shove', 't-throwing-axe', 'heavy-hands', 'heavy-hands', 'heavy-hands'];
  const landed = (g: GameState) => combatOf(g).events.some((e) => e.kind === 'attack' && e.outcome !== 'miss');

  it('Whirlwind strikes every enemy in reach', () => {
    let s = fight(korg([...savagery5, 't-whirlwind']));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3) }, 'bandit-thug-2': { pos: at(2, 2) } });
    const after = castAbility(s, 'whirlwind', null, ctx);
    const hit = combatOf(after).events.filter((e) => e.kind === 'attack').map((e) => e.targetId);
    expect(hit.sort()).toEqual(['bandit-thug-1', 'bandit-thug-2']);
  });

  it('Bloodrage adds Strength and movement for every quarter of HP missing', () => {
    const s = fight(korg(savagery5));
    const k = who(s, 'merc-1');
    const hurt = { ...k, hp: Math.floor(k.maxHp / 4) }; // three quarters missing
    expect(effectiveStats(hurt).strength).toBe(effectiveStats(k).strength + 6);
    expect(effectiveMovement(hurt)).toBe(effectiveMovement(k) + 6);
  });

  it('Giant Slayer hits harder against something bigger', () => {
    let s = fight(korg([...savagery5, 't-whirlwind', 'savage-instinct', 'savage-instinct', 'thick-blooded', 'thick-blooded', 't-giant-slayer']));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3), baseDefense: -50, hp: 999, maxHp: 999 } });
    s = withSeed(s, (g) => landed(castAbility(g, 'giant-slayer', 'bandit-thug-1', ctx)));
    const roll = combatOf(castAbility(s, 'giant-slayer', 'bandit-thug-1', ctx)).events.find((e) => e.kind === 'attack')!.roll!;
    expect(roll.bonusDamage).toBeGreaterThanOrEqual(2 + 3);
  });

  it('Headbutt silences: the mage cannot cast', () => {
    let s = mageFight(korg(hunter5));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'hedge-mage-1': { pos: at(4, 3), baseDefense: -50, hp: 99, maxHp: 99 } });
    s = withSeed(s, (g) => landed(castAbility(g, 'headbutt', 'hedge-mage-1', mageCtx)));
    const after = castAbility(s, 'headbutt', 'hedge-mage-1', mageCtx);
    const mage = who(after, 'hedge-mage-1');
    expect(mage.caster).toBe(true);
    expect(mage.statuses.map((st) => st.kind)).toContain('silenced');
    expect(abilityBlocker(combatOf(after), mage, getAbility('thunderbolt'))).toBe('Silenced');
  });

  it('status resistance shortens hostile conditions, or stops them taking hold', () => {
    let s = fight(party([{ premade: 'pip-larkspur', talents: ['t-pocket-sand'] }, { premade: 'korg-the-unbowed' }]));
    // Pip turns on Korg to test it: blindness for 2 turns against 2 points of resistance.
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), side: 'enemy', resources: pool(9) }, 'merc-2': { pos: at(4, 3), statusResist: 2 } });
    const after = castAbility(s, 'pocket-sand', 'merc-2', ctx);
    expect(who(after, 'merc-2').statuses).toEqual([]);
    expect(combatOf(after).log.some((l) => /shrugs off being blinded/.test(l))).toBe(true);
  });

  it('Mana Burn hits casters harder and drains an enemy’s mana pool', () => {
    let s = mageFight(korg([...hunter5, 'mana-burn', 'mana-burn']));
    s = setUp(s, 'merc-1', {
      'merc-1': { pos: at(3, 3) },
      'hedge-mage-1': { pos: at(4, 3), baseDefense: -50, hp: 99, maxHp: 99, resources: { mana: { current: 10, max: 10 } } },
    });
    expect(who(s, 'merc-1').manaBurn).toBe(4);
    s = withSeed(s, (g) => landed(attack(g, 'hedge-mage-1')));
    const after = attack(s, 'hedge-mage-1');
    expect(combatOf(after).events.find((e) => e.kind === 'attack')!.roll!.bonusDamage).toBe(4);
    expect(who(after, 'hedge-mage-1').resources.mana!.current).toBe(6);
  });

  it('enemies with mana in their data start with a full pool and pay for spells', () => {
    const withMana: CombatContext = { ...mageCtx, getMonster: (id) => ({ ...mageCtx.getMonster(id), ...(id === 'hedge-mage' ? { mana: 8 } : {}) }) };
    const s = startCombat({ ...enterDungeon(korg([]), mageRoom), screen: 'combat', encounter: { featureId: 'foes', returnTo: mageRoom.start } }, withMana);
    expect(who(s, 'hedge-mage-1').resources.mana).toEqual({ current: 8, max: 8 });
    const costly = { ...getAbility('thunderbolt'), cost: { resource: 'mana' as const, amount: 9 } };
    expect(abilityBlocker(combatOf(s), who(s, 'hedge-mage-1'), costly)).toBe('Needs 9 mana');
  });

  it('a spellguard makes the next hostile spell fizzle; a reflection throws it back', () => {
    let s = mageFight(korg([]));
    s = setUp(s, 'hedge-mage-1', {
      'hedge-mage-1': { pos: at(4, 0), hp: 99, maxHp: 99, baseDefense: -50 },
      'merc-1': { pos: at(4, 4), statuses: [{ kind: 'spellguard', rounds: 3 }] },
    });
    const fizzled = castAbility(s, 'thunderbolt', 'merc-1', mageCtx);
    expect(combatOf(fizzled).events.some((e) => e.kind === 'attack')).toBe(false);
    expect(who(fizzled, 'merc-1').statuses).toEqual([]);

    s = setUp(s, 'hedge-mage-1', { 'merc-1': { statuses: [{ kind: 'reflecting', rounds: 3 }] } });
    const bounced = castAbility(s, 'thunderbolt', 'merc-1', mageCtx);
    expect(combatOf(bounced).events.find((e) => e.kind === 'attack')).toMatchObject({ actorId: 'hedge-mage-1', targetId: 'hedge-mage-1' });
  });

  it('Shove knocks an enemy back; stopping short against a wall hurts', () => {
    let s = fight(korg(bully5));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3), baseDefense: -50, hp: 99, maxHp: 99 }, 'bandit-thug-2': { pos: at(0, 0) } });
    s = withSeed(s, (g) => landed(castAbility(g, 'shove', 'bandit-thug-1', ctx)));
    expect(who(castAbility(s, 'shove', 'bandit-thug-1', ctx), 'bandit-thug-1').pos).toEqual(at(6, 3));

    // Against the east edge of an 8-wide field: no room to fly, so it slams.
    let w = setUp(s, 'merc-1', { 'merc-1': { pos: at(6, 3) }, 'bandit-thug-1': { pos: at(7, 3) } });
    w = withSeed(w, (g) => landed(castAbility(g, 'shove', 'bandit-thug-1', ctx)));
    const slammed = castAbility(w, 'shove', 'bandit-thug-1', ctx);
    expect(who(slammed, 'bandit-thug-1').pos).toEqual(at(7, 3));
    expect(combatOf(slammed).log.some((l) => /crashes into something solid/.test(l))).toBe(true);
  });

  it('Throwing Axe is a ranged attack rolled with Strength', () => {
    let s = fight(korg(bully5));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(1, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3) } });
    const roll = combatOf(castAbility(s, 'throwing-axe', 'bandit-thug-1', ctx)).events.find((e) => e.kind === 'attack')!.roll!;
    expect(roll.stat).toBe('strength');
    expect(roll.ranged).toBe(true);
  });

  it('a feared enemy runs from whoever scared it and does not attack', () => {
    let s = fight(korg([]));
    s = setUp(s, 'bandit-thug-1', { 'bandit-thug-1': { pos: at(4, 3), statuses: [{ kind: 'feared', rounds: 2, sourceId: 'merc-1' }] }, 'merc-1': { pos: at(3, 3) } });
    const plan = planEnemyTurn(s, ctx);
    expect(plan.action).toEqual({ kind: 'none' });
    expect(plan.move && Math.max(Math.abs(plan.move.x - 3), Math.abs(plan.move.y - 3))).toBeGreaterThan(1);
  });
});

// ---------- the Wizard ----------

describe('the Wizard', () => {
  const maelis = (talents: string[], level = 11) => party([{ premade: 'maelis-thorne', talents }, { premade: 'aldric-vane' }], level);
  const elemental5 = ['t-ray-of-frost', 't-frost-armor', 'cold-mastery', 'cold-mastery', 'cold-mastery'];
  const white5 = ['t-mend', 't-blessing', 'devotion', 'devotion', 'devotion'];
  const mana = (current: number) => ({ mana: { current, max: 20 } });
  const landed = (g: GameState) => combatOf(g).events.some((e) => e.kind === 'attack' && e.outcome !== 'miss');

  it('Frost Nova freezes enemies next to the wizard; frozen ones lose their turn until a blow shatters the ice', () => {
    let s = fight(maelis([...elemental5, 't-frost-nova']));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: mana(20) }, 'bandit-thug-1': { pos: at(4, 3), baseDefense: -50, hp: 99, maxHp: 99 }, 'bandit-thug-2': { pos: at(7, 0) } });
    s = withSeed(s, (g) => landed(castAbility(g, 'frost-nova', null, ctx)));
    const frozen = castAbility(s, 'frost-nova', null, ctx);
    expect(who(frozen, 'bandit-thug-1').statuses.map((st) => st.kind)).toContain('frozen');

    // Its turn comes up: it loses it.
    const c = combatOf(frozen);
    const queued = setUp({ ...frozen, encounter: { ...frozen.encounter!, combat: { ...c, order: ['merc-1', 'bandit-thug-1', ...c.order.filter((x) => x !== 'merc-1' && x !== 'bandit-thug-1')] } } }, 'merc-1');
    expect(combatOf(endTurn(queued)).log.some((l) => /frozen solid/.test(l))).toBe(true);

    // A blow shatters it instead.
    let hit = setUp(frozen, 'merc-2', { 'merc-2': { pos: at(5, 3) } });
    hit = withSeed(hit, (g) => landed(attack(g, 'bandit-thug-1')));
    expect(who(attack(hit, 'bandit-thug-1'), 'bandit-thug-1').statuses.some((st) => st.kind === 'frozen')).toBe(false);
  });

  it('Ice Barrier soaks damage before hit points', () => {
    let s = fight(maelis([...elemental5, 't-ice-barrier']));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: mana(20) }, 'merc-2': { pos: at(4, 4) } });
    s = castAbility(s, 'ice-barrier', 'merc-2', ctx);
    const knight = who(s, 'merc-2');
    expect(knight.statuses).toContainEqual(expect.objectContaining({ kind: 'warded', amount: 8 }));
    let hit = setUp(s, 'bandit-thug-1', { 'bandit-thug-1': { pos: at(5, 4) }, 'merc-2': { baseDefense: -50, armour: { physical: 0, magic: 0 } } });
    hit = withSeed(hit, (g) => {
      const e = combatOf(attack(g, 'merc-2')).events.find((x) => x.kind === 'attack');
      return !!e && (e.amount ?? 0) > 0 && (e.amount ?? 0) <= 8;
    });
    const after = attack(hit, 'merc-2');
    const dealt = combatOf(after).events.find((x) => x.kind === 'attack')!.amount!;
    expect(who(after, 'merc-2').hp).toBe(knight.hp);
    expect(statusOfWard(who(after, 'merc-2'))).toBe(8 - dealt || undefined);
  });

  it('Revive raises a fallen ally', () => {
    let s = fight(maelis([...white5, 't-holy-smite', 't-revive', 't-sanctuary', 'grace', 'grace']));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: mana(20) }, 'merc-2': { pos: at(4, 4), hp: 0 } });
    const after = castAbility(s, 'revive', 'merc-2', ctx);
    expect(who(after, 'merc-2').hp).toBe(10);
    expect(combatOf(after).log.some((l) => /back on their feet/.test(l))).toBe(true);
  });

  it('Holy Smite burns the undead', () => {
    let s = fight(maelis([...white5, 't-holy-smite']));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: mana(20) }, 'bandit-thug-1': { pos: at(5, 3), baseDefense: -50, hp: 99, maxHp: 99, undead: true } });
    s = withSeed(s, (g) => landed(castAbility(g, 'holy-smite', 'bandit-thug-1', ctx)));
    const roll = combatOf(castAbility(s, 'holy-smite', 'bandit-thug-1', ctx)).events.find((e) => e.kind === 'attack')!.roll!;
    expect(roll.bonusDamage).toBeGreaterThanOrEqual(2);
    expect(roll.stat).toBe('intellect');
  });

  it('Summon Demon calls up an imp that acts on its own right after the wizard, then fades', () => {
    // Maelis starts with Firebolt.
    const destruction = ['kindling', 'kindling', 'kindling', 'hellfire-ward', 't-fireball', 't-immolate', 'infernal-vigour', 'infernal-vigour', 'infernal-vigour', 't-summon-demon'];
    let s = fight(maelis(destruction, 12));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: mana(20) } });
    s = castAbility(s, 'summon-demon', null, ctx);
    const c = combatOf(s);
    const imp = c.combatants.find((x) => x.summoned)!;
    expect(imp).toMatchObject({ side: 'party', monsterId: 'imp', summoned: { ownerId: 'merc-1', rounds: 4 } });
    expect(c.order[c.order.indexOf('merc-1') + 1]).toBe(imp.id);
    expect(isAiControlled(imp)).toBe(true);

    // When only the imp is left standing, the party has still lost.
    const lost = setUp(s, imp.id, Object.fromEntries(c.combatants.filter((x) => x.mercId).map((x) => [x.id, { hp: 0 }])));
    expect(combatOf(endTurn(lost)).outcome).toBe('defeat');

    // Its last turn ends and it fades.
    const last = setUp(s, imp.id, { [imp.id]: { summoned: { ownerId: 'merc-1', rounds: 1 } } });
    const faded = endTurn(last);
    expect(who(faded, imp.id).hp).toBe(0);
    expect(combatOf(faded).log.some((l) => /fades away/.test(l))).toBe(true);
  });
});

function statusOfWard(x: Combatant): number | undefined {
  return x.statuses.find((st) => st.kind === 'warded')?.amount;
}

// ---------- kick ----------

describe('kick', () => {
  const kicker = () => fight(party([{ premade: 'korg-the-unbowed' }]));
  const placed = (s: GameState, change: Partial<Combatant> = {}) =>
    setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3) }, 'bandit-thug-1': { pos: at(4, 3), ...change }, 'bandit-thug-2': { pos: at(7, 0) } });

  it('a kick that beats the enemy’s Defense pushes it one tile back', () => {
    let s = placed(kicker(), { baseDefense: 5, stats: { strength: 10, agility: 10, toughness: 30, intellect: 10, spirit: 10, charisma: 10 } });
    s = withSeed(s, (g) => who(kick(g, 'bandit-thug-1'), 'bandit-thug-1').pos.x === 5);
    const after = kick(s, 'bandit-thug-1');
    expect(who(after, 'bandit-thug-1').pos).toEqual(at(5, 3));
    expect(who(after, 'bandit-thug-1').hp).toBe(who(s, 'bandit-thug-1').hp); // a kick does no damage
    expect(combatOf(after).acted || combatOf(after).order[combatOf(after).turn] !== 'merc-1').toBe(true);
  });

  it('pushed, an enemy that fails its Toughness check falls prone', () => {
    let s = placed(kicker(), { baseDefense: -50, stats: { strength: 10, agility: 10, toughness: 1, intellect: 10, spirit: 10, charisma: 10 } });
    s = withSeed(s, (g) => who(kick(g, 'bandit-thug-1'), 'bandit-thug-1').statuses.some((st) => st.kind === 'prone'));
    const after = kick(s, 'bandit-thug-1');
    expect(who(after, 'bandit-thug-1').statuses.map((st) => st.kind)).toEqual(['prone']);
    expect(after.rollFeed!.rolls.map((r) => r.what)).toEqual(['Kick → Bandit Thug 1', 'Keep footing (Toughness)']);
  });

  it('a missed kick moves nothing', () => {
    let s = placed(kicker(), { baseDefense: 99 });
    s = withSeed(s, (g) => who(kick(g, 'bandit-thug-1'), 'bandit-thug-1').pos.x === 4);
    expect(who(kick(s, 'bandit-thug-1'), 'bandit-thug-1').pos).toEqual(at(4, 3));
  });

  it('an enemy with its back to the wall holds its ground', () => {
    let s = setUp(kicker(), 'merc-1', { 'merc-1': { pos: at(6, 3) }, 'bandit-thug-1': { pos: at(7, 3), baseDefense: -50 }, 'bandit-thug-2': { pos: at(0, 0) } });
    s = withSeed(s, (g) => combatOf(kick(g, 'bandit-thug-1')).log.some((l) => /nowhere to go/.test(l)));
    const after = kick(s, 'bandit-thug-1');
    expect(who(after, 'bandit-thug-1').pos).toEqual(at(7, 3));
    expect(who(after, 'bandit-thug-1').statuses).toEqual([]);
  });

  it('only reaches enemies right next to the kicker', () => {
    const s = setUp(kicker(), 'merc-1', { 'merc-1': { pos: at(1, 3) }, 'bandit-thug-1': { pos: at(4, 3) } });
    expect(kickTargets(combatOf(s), who(s, 'merc-1'))).toEqual([]);
    expect(() => kick(s, 'bandit-thug-1')).toThrow(/cannot reach/);
  });

  it('a prone enemy spends its next move getting up, and melee hits on it have advantage', () => {
    let s = placed(kicker(), { statuses: [{ kind: 'prone', rounds: 1 }] });
    const swing = attack(s, 'bandit-thug-1');
    expect(combatOf(swing).events.find((e) => e.kind === 'attack')!.roll!.mode).toBe('advantage');

    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, order: ['merc-1', 'bandit-thug-1', ...c.order.filter((x) => x !== 'merc-1' && x !== 'bandit-thug-1')] } } };
    const up = endTurn(s);
    expect(combatOf(up).order[combatOf(up).turn]).toBe('bandit-thug-1');
    expect(combatOf(up).moveLeft).toBe(0);
    // Its turn over, it is back on its feet.
    expect(who(endTurn(up), 'bandit-thug-1').statuses).toEqual([]);
  });
});

// ---------- the Ranger and the Warlock ----------

describe('the Ranger and the Warlock', () => {
  const landed = (g: GameState) => combatOf(g).events.some((e) => e.kind === 'attack' && e.outcome !== 'miss');

  it('a rooted combatant cannot move, but can still act', () => {
    let s = fight(party([{ premade: 'sylwen-ashbow' }]));
    s = setUp(s, 'bandit-thug-1', { 'bandit-thug-1': { pos: at(4, 3), statuses: [{ kind: 'rooted', rounds: 2 }] }, 'merc-1': { pos: at(1, 3) } });
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, order: ['merc-1', 'bandit-thug-1', ...c.order.filter((x) => x !== 'merc-1' && x !== 'bandit-thug-1')], turn: 0 } } };
    const next = endTurn(s);
    expect(combatOf(next).order[combatOf(next).turn]).toBe('bandit-thug-1');
    expect(combatOf(next).moveLeft).toBe(0);
  });

  it('Snare Shot roots on a hit (Sylwen starts with it)', () => {
    let s = fight(party([{ premade: 'sylwen-ashbow' }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(1, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(5, 3), baseDefense: -50, hp: 99, maxHp: 99 } });
    s = withSeed(s, (g) => landed(castAbility(g, 'snare-shot', 'bandit-thug-1', ctx)));
    expect(who(castAbility(s, 'snare-shot', 'bandit-thug-1', ctx), 'bandit-thug-1').statuses.map((st) => st.kind)).toContain('rooted');
  });

  it('regeneration heals at the start of the turn', () => {
    let s = fight(party([{ premade: 'vesper' }]));
    const v = who(s, 'merc-1');
    s = setUp(s, 'bandit-thug-1', { 'merc-1': { hp: v.maxHp - 5, statuses: [{ kind: 'regenerating', rounds: 2, amount: 3 }] } });
    const c = combatOf(s);
    s = { ...s, encounter: { ...s.encounter!, combat: { ...c, order: ['bandit-thug-1', 'merc-1', ...c.order.filter((x) => x !== 'merc-1' && x !== 'bandit-thug-1')], turn: 0 } } };
    expect(who(endTurn(s), 'merc-1').hp).toBe(v.maxHp - 2);
  });

  it('a weapon enchantment adds to weapon blows, and Draining Strike heals by the damage dealt', () => {
    const binder = ['t-bind-blade', 't-spectral-edge', 'binders-grip', 'binders-grip', 'binders-grip', 't-hexed-blade', 't-draining-strike'];
    let s = fight(party([{ premade: 'vesper', talents: binder, mainHand: 'arming-sword' }], 11));
    const v = who(s, 'merc-1');
    s = setUp(s, 'merc-1', {
      'merc-1': { pos: at(3, 3), hp: 5, resources: { mana: { current: 20, max: 20 } }, buffs: [{ source: 'Bind Blade', effects: [{ type: 'damage', amount: 2 }], roundsLeft: 3 }] },
      'bandit-thug-1': { pos: at(4, 3), baseDefense: -50, hp: 99, maxHp: 99, armour: { physical: 0, magic: 0 } },
    });
    s = withSeed(s, (g) => landed(castAbility(g, 'draining-strike', 'bandit-thug-1', ctx)));
    const after = castAbility(s, 'draining-strike', 'bandit-thug-1', ctx);
    const roll = combatOf(after).events.find((e) => e.kind === 'attack')!.roll!;
    expect(roll.bonusDamage).toBeGreaterThanOrEqual(2);
    expect(who(after, 'merc-1').hp).toBe(Math.min(v.maxHp, 5 + roll.damage));
  });

  it('the Beast Master’s wolf joins the fight on the party’s side', () => {
    const s0 = fight(party([{ premade: 'sylwen-ashbow', talents: ['t-call-wolf'] }]));
    const s = setUp(s0, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) } });
    const wolf = combatOf(castAbility(s, 'call-wolf', null, ctx)).combatants.find((x) => x.summoned)!;
    expect(wolf).toMatchObject({ side: 'party', monsterId: 'wolf-companion', summoned: { rounds: 6 } });
  });
});
