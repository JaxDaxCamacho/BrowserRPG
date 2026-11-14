import { describe, expect, it } from 'vitest';
import { getAbility, getTalentTree, PREMADES, premadeToDraft } from '../../src/content';
import {
  abilityBlocker,
  abilityTargets,
  addMerc,
  attack,
  attackBonusFor,
  bannerBonus,
  castAbility,
  combatantById,
  defenseIn,
  effectiveArmour,
  effectiveDefense,
  endTurn,
  enterDungeon,
  migrateSave,
  moveTo,
  SAVE_VERSION,
  setLeader,
  sizeOf,
  spendTalentPoints,
  startCombat,
  startNewGame,
  xpForLevel,
  type Combatant,
  type CombatContext,
  type CombatState,
  type DungeonDefinition,
  type GameState,
  type Pos,
} from '../../src/engine';
import { combatContext } from '../../src/state/context';

// ---------- fixtures (as in abilities.test.ts) ----------

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

function party(members: { premade: string; talents?: string[]; mainHand?: string; offHand?: string | null }[], level = 11): GameState {
  let s: GameState = { ...startNewGame(9), adventureId: 'greywater-ford' };
  for (const m of members) s = addMerc(s, premadeToDraft(PREMADES.find((p) => p.id === m.premade)!));
  s = { ...setLeader(s, 'merc-1'), screen: 'adventureSelect' };
  s = { ...s, party: s.party.map((m) => ({ ...m, level, xp: xpForLevel(level) })) };
  members.forEach((m, i) => {
    const merc = s.party[i]!;
    const equipment = { ...merc.equipment, ...(m.mainHand ? { mainHand: m.mainHand } : {}) };
    if (m.offHand === null) delete equipment.offHand;
    s = { ...s, party: s.party.map((x) => (x.id === merc.id ? { ...x, equipment } : x)) };
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

function setUp(s: GameState, activeId: string, changes: Record<string, Partial<Combatant>> = {}): GameState {
  const c = combatOf(s);
  const order = [activeId, ...c.order.filter((x) => x !== activeId)];
  const combatants = c.combatants.map((x) => (changes[x.id] ? { ...x, ...changes[x.id] } : x));
  const me = combatants.find((x) => x.id === activeId)!;
  return { ...s, encounter: { ...s.encounter!, combat: { ...c, order, combatants, turn: 0, moveLeft: me.movement, acted: false, outcome: null } } };
}

const at = (x: number, y: number): Pos => ({ x, y });
const pool = (current: number) => ({ adrenaline: { current, max: 10 } });
function withSeed(s: GameState, test: (g: GameState) => boolean): GameState {
  for (let seed = 1; seed < 800; seed++) if (test({ ...s, rngSeed: seed })) return { ...s, rngSeed: seed };
  throw new Error('No seed fits');
}
const attacks = (s: GameState) => combatOf(s).events.filter((e) => e.kind === 'attack');

// Talent paths. Aldric starts with Taunt (Guardian), Brunna with Forward! (Captain).
const TEMPLAR_T1 = ['two-handed-mastery', 'two-handed-mastery', 'two-handed-mastery', 't-crushing-blow', 'divinity-channeled'];
const TEMPLAR_T2 = ['t-execution', 't-fanatic-zeal', 'righteous-vigour'];
const TEMPLAR_T3 = [...TEMPLAR_T1, 't-execution', 't-fanatic-zeal', 't-fanatic-zeal', 't-fanatic-zeal', 'righteous-vigour', 'righteous-vigour'];
const GUARDIAN_T2 = ['bulwark', 'bulwark', 'bulwark', 'stalwart'];
const GUARDIAN_T3 = [...GUARDIAN_T2, 't-shield-bash', 't-shield-bash', 't-shield-bash', 'retribution', 'retribution'];
const CAPTAIN_T2 = ['t-hold-fast', 'inspiring-presence', 'inspiring-presence', 'inspiring-presence'];
const CAPTAIN_T3 = [...CAPTAIN_T2, 't-opening', 'steady-ranks', 'steady-ranks', 'steady-ranks', 't-company-banner'];

// ---------- Templar ----------

describe('Templar', () => {
  it('Two-Handed Mastery adds to hit with a two-handed weapon, and crits on 19 at rank 3', () => {
    const greatsword = combatOf(fight(party([{ premade: 'aldric-vane', talents: TEMPLAR_T1, mainHand: 'greatsword', offHand: null }]))).combatants[0]!;
    expect(greatsword.perks!.attackBonus).toBe(3);
    expect(greatsword.critThreshold).toBe(19);
    const sword = combatOf(fight(party([{ premade: 'aldric-vane', talents: TEMPLAR_T1 }]))).combatants[0]!;
    expect(sword.perks!.attackBonus).toBe(0);
    expect(sword.critThreshold).toBe(20);
  });

  it('Divinity Channeled heals 10% of a critical hit, rounded up, and Righteous Vigour then raises Defense without stacking', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...TEMPLAR_T1, ...TEMPLAR_T2], mainHand: 'greatsword', offHand: null }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), hp: 10, critThreshold: 2 }, 'bandit-thug-1': { pos: at(4, 3), hp: 200, maxHp: 200, baseDefense: -50 } });
    s = withSeed(s, (g) => attacks(attack(g, 'bandit-thug-1')).some((e) => e.outcome === 'crit'));
    const after = attack(s, 'bandit-thug-1');
    const dealt = attacks(after)[0]!.amount!;
    expect(who(after, 'merc-1').hp).toBe(Math.min(who(s, 'merc-1').maxHp, 10 + Math.ceil(dealt / 10)));
    const vigour = who(after, 'merc-1').buffs.filter((b) => b.source === 'Righteous Vigour');
    expect(vigour).toEqual([{ source: 'Righteous Vigour', effects: [{ type: 'defense', amount: 2 }], roundsLeft: 2 }]);
  });

  it('Fanatic Zeal sets the templar burning and adds fire to melee blows', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...TEMPLAR_T1, 't-execution', 't-fanatic-zeal', 't-fanatic-zeal'], mainHand: 'greatsword', offHand: null }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3), hp: 200, maxHp: 200, baseDefense: -50 } });
    const lit = castAbility(s, 'fanatic-zeal-2', null, ctx);
    const me = who(lit, 'merc-1');
    expect(me.statuses).toContainEqual(expect.objectContaining({ kind: 'burning', amount: 2 }));
    expect(me.buffs.find((b) => b.source === 'Fanatic Zeal')!.effects).toContainEqual({ type: 'extraDamage', damageType: 'magic', dice: '1d6+2', meleeOnly: true });
    let swing = setUp(lit, 'merc-1');
    swing = withSeed(swing, (g) => attacks(attack(g, 'bandit-thug-1')).some((e) => e.outcome === 'hit'));
    // At least the +2 of 1d6+2 gets through the thug's magic armour.
    expect(attacks(attack(swing, 'bandit-thug-1'))[0]!.roll!.extraDamage).toBeGreaterThanOrEqual(3);
  });

  it('Judgement strikes in melee up to 4 squares away, with spiritual damage and no disadvantage', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...TEMPLAR_T3, 't-judgement'], mainHand: 'greatsword', offHand: null }]));
    s = setUp(s, 'merc-1', {
      'merc-1': { pos: at(1, 3), resources: pool(9) },
      'bandit-thug-1': { pos: at(5, 3), hp: 200, maxHp: 200, baseDefense: -50 },
      'bandit-thug-2': { pos: at(1, 4) },
    });
    expect(abilityTargets(combatOf(s), who(s, 'merc-1'), getAbility('judgement')).map((t) => t.id)).toContain('bandit-thug-1');
    s = withSeed(s, (g) => attacks(castAbility(g, 'judgement', 'bandit-thug-1', ctx)).some((e) => e.outcome === 'hit'));
    const blow = attacks(castAbility(s, 'judgement', 'bandit-thug-1', ctx))[0]!;
    expect(blow.roll!.mode).toBe('normal');
    expect(blow.roll!.extraDamage).toBeGreaterThanOrEqual(2);
  });

  it('Avatar of Wrath grows the templar to 2×2 for 4 rounds, then leaves 1 HP', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...TEMPLAR_T3, 't-avatar-of-wrath'], mainHand: 'greatsword', offHand: null }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(2, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(6, 0) }, 'bandit-thug-2': { pos: at(7, 0) } });
    const armour = who(s, 'merc-1').armour.physical;
    let g = castAbility(s, 'avatar-of-wrath', null, ctx);
    const avatar = who(g, 'merc-1');
    expect(sizeOf(avatar)).toBe(2);
    // +4 on top of Two-Handed Mastery's +3; +4 armour.
    expect(attackBonusFor(combatOf(g), avatar, true)).toBe(3 + 4);
    expect(effectiveArmour(avatar).physical).toBe(armour + 4);
    expect(avatar.buffs.find((b) => b.source === 'Avatar of Wrath')).toMatchObject({ roundsLeft: 4, expire: { shrink: true, toOneHp: true } });
    const startRound = combatOf(g).round;
    for (let i = 0; i < 200 && combatOf(g).round < startRound + 4; i++) g = endTurn(g);
    const spent = who(g, 'merc-1');
    expect(sizeOf(spent)).toBe(1);
    expect(spent.hp).toBe(1);
  });
});

// ---------- Guardian ----------

describe('Guardian', () => {
  it('Shield Bash needs a shield, and stuns (and at rank 3 knocks down) on a hit', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: GUARDIAN_T3 }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3), hp: 200, maxHp: 200, baseDefense: -50 } });
    s = withSeed(s, (g) => attacks(castAbility(g, 'shield-bash-3', 'bandit-thug-1', ctx)).some((e) => e.outcome !== 'miss'));
    const thug = who(castAbility(s, 'shield-bash-3', 'bandit-thug-1', ctx), 'bandit-thug-1');
    expect(thug.statuses.map((st) => st.kind).sort()).toEqual(['prone', 'stunned']);
    let bare = fight(party([{ premade: 'aldric-vane', talents: GUARDIAN_T3, offHand: null }]));
    bare = setUp(bare, 'merc-1', { 'merc-1': { pos: at(3, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3) } });
    expect(abilityBlocker(combatOf(bare), who(bare, 'merc-1'), getAbility('shield-bash'))).toBe('Needs a shield');
  });

  it('Thunderous Charge rushes in a straight line, strikes and taunts', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...GUARDIAN_T2, 't-thunderous-charge', 't-thunderous-charge'] }]));
    s = setUp(s, 'merc-1', {
      'merc-1': { pos: at(0, 3), resources: pool(9) },
      'bandit-thug-1': { pos: at(5, 3), hp: 200, maxHp: 200, baseDefense: -50 },
      'bandit-thug-2': { pos: at(4, 0) },
    });
    const charge = getAbility('thunderous-charge-2');
    // In line, 5 squares away: a target. Off the line: not.
    const options = abilityTargets(combatOf(s), who(s, 'merc-1'), charge).map((t) => t.id);
    expect(options).toEqual(['bandit-thug-1']);
    s = withSeed(s, (g) => attacks(castAbility(g, 'thunderous-charge-2', 'bandit-thug-1', ctx)).some((e) => e.outcome !== 'miss'));
    const after = castAbility(s, 'thunderous-charge-2', 'bandit-thug-1', ctx);
    expect(who(after, 'merc-1').pos).toEqual(at(4, 3));
    expect(who(after, 'bandit-thug-1').statuses).toContainEqual(expect.objectContaining({ kind: 'taunted', rounds: 2, sourceId: 'merc-1' }));
  });

  it('Shield Throw drops the shield: no shield Defense and no second throw until it is picked up', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...GUARDIAN_T3, 't-shield-throw'] }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(1, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3), hp: 200, maxHp: 200 }, 'bandit-thug-2': { pos: at(7, 0) } });
    const before = effectiveDefense(who(s, 'merc-1'));
    const thrown = castAbility(s, 'shield-throw', 'bandit-thug-1', ctx);
    const me = who(thrown, 'merc-1');
    expect(me.shieldDropped).toMatchObject({ pickup: 'on' });
    expect(effectiveDefense(me)).toBe(before - me.perks!.shieldDefense);
    const again = setUp(thrown, 'merc-1', { 'merc-1': { resources: pool(9), cooldowns: {} } });
    expect(abilityBlocker(combatOf(again), who(again, 'merc-1'), getAbility('shield-throw'))).toBe('Your shield is on the floor');
    // Walking onto the shield picks it up.
    const picked = moveTo(again, me.shieldDropped!.pos);
    expect(who(picked, 'merc-1').shieldDropped).toBeUndefined();
    expect(effectiveDefense(who(picked, 'merc-1'))).toBe(before);
  });

  it('Shield Throw at rank 3 comes straight back', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...GUARDIAN_T3, 't-shield-throw', 't-shield-throw', 't-shield-throw'] }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(1, 3), resources: pool(9) }, 'bandit-thug-1': { pos: at(4, 3) }, 'bandit-thug-2': { pos: at(7, 0) } });
    expect(who(castAbility(s, 'shield-throw-3', 'bandit-thug-1', ctx), 'merc-1').shieldDropped).toBeUndefined();
  });

  it('Heroic Intervention takes an attack meant for an adjacent merc, with +2 Defense at rank 2', () => {
    let s = fight(party([{ premade: 'aldric-vane', talents: [...GUARDIAN_T3, 'heroic-intervention', 'heroic-intervention'] }, { premade: 'maelis-thorne' }]));
    s = setUp(s, 'bandit-thug-1', { 'merc-1': { pos: at(3, 3) }, 'merc-2': { pos: at(4, 4) }, 'bandit-thug-1': { pos: at(5, 4) } });
    const after = attack(s, 'merc-2');
    const blow = attacks(after)[0]!;
    expect(blow.targetId).toBe('merc-1');
    expect(blow.roll!.defense).toBe(defenseIn(combatOf(s), who(s, 'merc-1')) + 2);
    expect(combatOf(after).log.some((l) => /steps in front of Maelis Thorne/.test(l))).toBe(true);
  });
});

// ---------- Captain ----------

describe('Captain', () => {
  it('Inspiring Presence and Steady Ranks are auras for allies in range', () => {
    let s = fight(party([{ premade: 'brunna-stonehand', talents: [...CAPTAIN_T2, 'steady-ranks'] }, { premade: 'korg-the-unbowed' }, { premade: 'maelis-thorne' }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(1, 3) }, 'merc-2': { pos: at(4, 3) }, 'merc-3': { pos: at(7, 5) } });
    const c = combatOf(s);
    // Rank 3 reaches 4 squares: Korg (3 away) gets +1 to hit, Maelis (6 away) does not.
    expect(attackBonusFor(c, who(s, 'merc-2'), false)).toBe(1);
    expect(attackBonusFor(c, who(s, 'merc-3'), false)).toBe(0);
    // Steady Ranks rank 1 reaches 2 squares: not Korg.
    expect(defenseIn(c, who(s, 'merc-2'))).toBe(effectiveDefense(who(s, 'merc-2')));
    expect(defenseIn(c, who(s, 'merc-1'))).toBe(effectiveDefense(who(s, 'merc-1')) + 1);
  });

  it('the Company Banner adds +1 to every roll near it, and planting it again moves it', () => {
    let s = fight(party([{ premade: 'brunna-stonehand', talents: CAPTAIN_T3 }, { premade: 'korg-the-unbowed' }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(2, 3), resources: pool(9) }, 'merc-2': { pos: at(4, 4) }, 'bandit-thug-1': { pos: at(7, 0) }, 'bandit-thug-2': { pos: at(7, 1) } });
    const planted = castAbility(s, 'company-banner', null, ctx);
    const banners = combatOf(planted).obstacles.filter((o) => o.aura);
    expect(banners).toHaveLength(1);
    expect(banners[0]!.pos).toEqual(at(2, 3));
    expect(bannerBonus(combatOf(planted), who(planted, 'merc-2'))).toBe(1);
    expect(bannerBonus(combatOf(planted), who(planted, 'bandit-thug-1'))).toBe(0);
    let again = setUp(planted, 'merc-1', { 'merc-1': { pos: at(5, 3), resources: pool(9), cooldowns: {} } });
    again = castAbility(again, 'company-banner', null, ctx);
    expect(combatOf(again).obstacles.filter((o) => o.aura).map((o) => o.pos)).toEqual([at(5, 3)]);
  });

  it('Lead by Example spurs allies nearby after a melee blow lands', () => {
    let s = fight(party([{ premade: 'brunna-stonehand', talents: [...CAPTAIN_T3, 't-coordinated-assault', 'lead-by-example', 'lead-by-example'] }, { premade: 'korg-the-unbowed' }]));
    s = setUp(s, 'merc-1', { 'merc-1': { pos: at(3, 3) }, 'merc-2': { pos: at(2, 4) }, 'bandit-thug-1': { pos: at(4, 3), hp: 200, maxHp: 200, baseDefense: -50 } });
    s = withSeed(s, (g) => attacks(attack(g, 'bandit-thug-1')).some((e) => e.outcome === 'hit'));
    const korg = who(attack(s, 'bandit-thug-1'), 'merc-2');
    expect(korg.buffs).toContainEqual({ source: 'Led by Example', effects: [{ type: 'damage', amount: 2 }], roundsLeft: 1 });
  });
});

// ---------- saves ----------

describe('the rebuilt knight tree in old saves', () => {
  it('gives knights their talent points back', () => {
    const s = party([{ premade: 'aldric-vane' }, { premade: 'korg-the-unbowed', talents: ['t-shove'] }]);
    const old = { ...s, version: 8, party: s.party.map((m) => (m.classId === 'knight' ? { ...m, talents: { 'heavy-swings': 2, 't-taunt': 1 } } : m)) };
    const migrated = migrateSave(JSON.parse(JSON.stringify(old)))!;
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.party[0]!.talents).toEqual({});
    expect(migrated.party[1]!.talents).toEqual(s.party[1]!.talents);
  });
});
