import {
  abilityTargets,
  activeCombatant,
  attack,
  attackTargets,
  canUseAbility,
  castAbility,
  combatantById,
  defend,
  distance,
  effectiveMovement,
  isAiControlled,
  effectiveDefense,
  endTurn,
  moveTo,
  reachableTiles,
  standing,
  statusOf,
  visibleFoes,
  type CombatContext,
  type Combatant,
  type CombatState,
} from './combat';
import type { Pos } from './dungeon';
import type { GameState } from './gameState';
import type { AbilityDefinition, EnemyArchetype } from './monsters';

/**
 * How enemies fight on the grid. Each archetype picks where to stand and whom to hit:
 *
 * - brawler: closes in on the nearest merc and hits whoever is in reach, weakest first
 * - savage: the same, but never defends, even with no one in reach
 * - tank: closes in and hits; with no one in reach it defends
 * - assassin: hunts the merc with the least HP and armour
 * - archer, caster, summoner: stay out of reach of mercs and attack from range
 * - healer: stays back, heals the most hurt ally below 60%, otherwise attacks
 */

type Plan =
  | { kind: 'attack'; targetId: string }
  | { kind: 'ability'; abilityId: string; targetId: string | null }
  | { kind: 'defend' }
  | { kind: 'none' };

const RANGED: ReadonlySet<EnemyArchetype> = new Set(['archer', 'caster', 'summoner', 'healer']);

/** Foes the actor can see; the invisible are left out. */
function foesOf(c: CombatState, actor: Combatant): Combatant[] {
  return visibleFoes(c, actor);
}

/** The one who taunted this actor, while the taunt holds and they are still up and visible. */
function taunter(c: CombatState, actor: Combatant): Combatant | undefined {
  const taunt = statusOf(actor, 'taunted');
  return taunt?.sourceId ? foesOf(c, actor).find((f) => f.id === taunt.sourceId) : undefined;
}

function nearest(from: Pos, among: Combatant[]): Combatant | undefined {
  return [...among].sort((a, b) => distance(from, a.pos) - distance(from, b.pos))[0];
}

function weakest(targets: Combatant[]): Combatant | undefined {
  return [...targets].sort((a, b) => a.hp - b.hp)[0];
}

function softest(targets: Combatant[]): Combatant | undefined {
  return [...targets].sort((a, b) => a.hp + a.armour.physical - (b.hp + b.armour.physical))[0];
}

function easiestToHit(targets: Combatant[]): Combatant | undefined {
  return [...targets].sort((a, b) => effectiveDefense(a) - effectiveDefense(b) || a.hp - b.hp)[0];
}

function usableAbilities(c: CombatState, actor: Combatant, ctx: Pick<CombatContext, 'getAbility'>): AbilityDefinition[] {
  return actor.abilityIds.map((id) => ctx.getAbility(id)).filter((a) => canUseAbility(c, actor, a));
}

/** The longest reach among the actor's attack and damaging abilities. */
function bestRange(actor: Combatant, ctx: Pick<CombatContext, 'getAbility'>): number {
  const abilities = actor.abilityIds.map((id) => ctx.getAbility(id)).filter((a) => a.attack);
  return Math.max(actor.attack.range, ...abilities.map((a) => a.range));
}

/** The same fight with the actor standing somewhere else, to ask what it could do from there. */
function standingAt(c: CombatState, actor: Combatant, pos: Pos): CombatState {
  return { ...c, combatants: c.combatants.map((x) => (x.id === actor.id ? { ...x, pos } : x)) };
}

/** What to do with the action, from where the actor stands now. */
function chooseAction(c: CombatState, actor: Combatant, ctx: Pick<CombatContext, 'getAbility'>): Plan {
  const abilities = usableAbilities(c, actor, ctx);
  const arch = actor.archetype ?? 'brawler';

  // A taunted enemy hits whoever taunted it if it can reach them, with its best blow.
  const goad = taunter(c, actor);
  if (goad) {
    const strike = abilities.find((a) => a.attack && abilityTargets(c, actor, a).some((t) => t.id === goad.id));
    if (strike) return { kind: 'ability', abilityId: strike.id, targetId: goad.id };
    if (attackTargets(c, actor).some((t) => t.id === goad.id)) return { kind: 'attack', targetId: goad.id };
  }

  // Healers first look after their side.
  if (arch === 'healer') {
    const heal = abilities.find((a) => a.effects.some((e) => e.type === 'heal'));
    const hurt = standing(c, actor.side)
      .filter((a) => a.hp < a.maxHp * 0.6)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    const patient = heal && hurt.find((h) => abilityTargets(c, actor, heal).some((t) => t.id === h.id));
    if (heal && patient) return { kind: 'ability', abilityId: heal.id, targetId: patient.id };
  }

  // Abilities that help the whole side (a rally) are used when mercs are close.
  const rally = abilities.find((a) => !a.attack && (a.target === 'allAllies' || a.target === 'self') && a.effects.some((e) => e.type !== 'heal'));
  if (rally && foesOf(c, actor).some((p) => distance(p.pos, actor.pos) <= 3)) {
    return { kind: 'ability', abilityId: rally.id, targetId: null };
  }

  // Damaging abilities beat the basic attack when they can land.
  const strike = abilities.find((a) => a.attack);
  if (strike) {
    const options = abilityTargets(c, actor, strike);
    const pick = arch === 'assassin' ? softest(options) : weakest(options);
    if (pick) return { kind: 'ability', abilityId: strike.id, targetId: pick.id };
  }

  const targets = attackTargets(c, actor);
  if (targets.length > 0) {
    const pick = arch === 'assassin' ? softest(targets) : arch === 'archer' ? easiestToHit(targets) : weakest(targets);
    return { kind: 'attack', targetId: pick!.id };
  }
  if (arch === 'tank') return { kind: 'defend' };
  return { kind: 'none' };
}

/** Whether from this tile the actor could hit someone. */
function canStrikeFrom(c: CombatState, actor: Combatant, pos: Pos, ctx: Pick<CombatContext, 'getAbility'>): boolean {
  const there = standingAt(c, actor, pos);
  const me = combatantById(there, actor.id);
  return attackTargets(there, me).length > 0 || usableAbilities(there, me, ctx).some((a) => a.attack);
}

/** Where to stand before acting, or null to stay put. */
function chooseMove(c: CombatState, actor: Combatant, ctx: Pick<CombatContext, 'getAbility'>): Pos | null {
  const arch = actor.archetype ?? 'brawler';
  const foes = foesOf(c, actor);
  if (foes.length === 0) return null;
  const tiles = [...reachableTiles(c, actor).keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x: x!, y: y! };
  });
  if (tiles.length === 0) return null;
  const closest = (p: Pos) => Math.min(...foes.map((f) => distance(p, f.pos)));

  if (RANGED.has(arch)) {
    // Stay out of reach: the tile furthest from mercs that still has a shot, closing in only if nothing does.
    const here = actor.pos;
    const withShot = tiles.filter((t) => closest(t) >= 2 && canStrikeFrom(c, actor, t, ctx));
    if (closest(here) >= 2 && canStrikeFrom(c, actor, here, ctx)) return null;
    if (withShot.length > 0) return withShot.sort((a, b) => closest(b) - closest(a))[0]!;
    const range = bestRange(actor, ctx);
    const safe = tiles.filter((t) => closest(t) >= 2);
    const pool = safe.length > 0 ? safe : tiles;
    return pool.sort((a, b) => Math.abs(closest(a) - range) - Math.abs(closest(b) - range))[0]!;
  }

  // Melee types: already next to a fitting target means stay; otherwise get next to it, or as close as possible.
  // A taunted enemy goes for the taunter, whatever its habits.
  const goad = taunter(c, actor);
  const quarry = goad ?? (arch === 'assassin' ? softest(foes) : nearest(actor.pos, foes));
  if (!quarry) return null;
  if (distance(actor.pos, quarry.pos) <= 1) return null;
  if (!goad && arch !== 'assassin' && attackTargets(c, actor).length > 0) return null;
  const adjacent = tiles.filter((t) => distance(t, quarry.pos) <= 1);
  if (adjacent.length > 0) return adjacent.sort((a, b) => distance(actor.pos, a) - distance(actor.pos, b))[0]!;
  return tiles.sort((a, b) => distance(a, quarry.pos) - distance(b, quarry.pos))[0]!;
}

/** The reachable tile furthest from a threat, or null when standing still is as far as it gets. */
function fleeFrom(c: CombatState, actor: Combatant, threat: Pos): Pos | null {
  const tiles = [...reachableTiles(c, actor).keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x: x!, y: y! };
  });
  const best = tiles.sort((a, b) => distance(b, threat) - distance(a, threat))[0];
  return best && distance(best, threat) > distance(actor.pos, threat) ? best : null;
}

function act(state: GameState, plan: Plan, ctx: Pick<CombatContext, 'getAbility'> & Partial<Pick<CombatContext, 'getMonster'>>): GameState {
  switch (plan.kind) {
    case 'attack':
      return attack(state, plan.targetId);
    case 'ability':
      return castAbility(state, plan.abilityId, plan.targetId, ctx);
    case 'defend':
      return defend(state);
    case 'none':
      return endTurn(state);
  }
}

/**
 * Plays one step of the active AI combatant's turn, so the screen can show
 * each in turn: first its move (if it wants one and has not moved yet), and
 * on the next call its action, after which the turn ends.
 */
export function runEnemyStep(state: GameState, ctx: Pick<CombatContext, 'getAbility'> & Partial<Pick<CombatContext, 'getMonster'>>): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome) return state;
  const actor = activeCombatant(c);
  if (!isAiControlled(actor)) return state;
  const fresh = !c.acted && c.moveLeft === effectiveMovement(actor);

  // The frightened only run: one step to move, then the turn is over.
  const fear = statusOf(actor, 'feared');
  const scarer = fear?.sourceId ? c.combatants.find((x) => x.id === fear.sourceId && x.hp > 0) : undefined;
  if (scarer) {
    const away = fresh ? fleeFrom(c, actor, scarer.pos) : null;
    if (away) return moveTo(state, away);
    return endTurn(state);
  }

  if (fresh) {
    const target = chooseMove(c, actor, ctx);
    if (target) {
      const moved = moveTo(state, target);
      const after = moved.encounter?.combat;
      if (after && !after.outcome && after.order[after.turn] === actor.id && combatantById(after, actor.id).hp === 0) return endTurn(moved);
      return moved;
    }
  }
  let next = act(state, chooseAction(c, actor, ctx), ctx);
  const end = next.encounter?.combat;
  if (end && !end.outcome && end.order[end.turn] === actor.id) next = endTurn(next);
  return next;
}

/**
 * Plays the active enemy's whole turn: a move if it wants one, then its action,
 * then the turn ends.
 */
export function runEnemyTurn(state: GameState, ctx: Pick<CombatContext, 'getAbility'> & Partial<Pick<CombatContext, 'getMonster'>>): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome) return state;
  const actor = activeCombatant(c);
  if (!isAiControlled(actor)) return state;

  // A frightened enemy runs as far as it can from whoever scared it, and does nothing else.
  const fear = statusOf(actor, 'feared');
  const scarer = fear?.sourceId ? c.combatants.find((x) => x.id === fear.sourceId && x.hp > 0) : undefined;
  if (scarer) {
    const away = fleeFrom(c, actor, scarer.pos);
    let fled = away ? moveTo(state, away) : state;
    const after = fled.encounter?.combat;
    if (after && !after.outcome && after.order[after.turn] === actor.id) fled = endTurn(fled);
    return fled;
  }

  let next = state;
  const target = chooseMove(c, actor, ctx);
  if (target) {
    next = moveTo(next, target);
    const after = next.encounter?.combat;
    // The move may have ended the fight or the enemy (a free attack), or used up the turn.
    if (!after || after.outcome || after.order[after.turn] !== actor.id) return next;
    if (combatantById(after, actor.id).hp === 0) return endTurn(next);
  }
  const now = next.encounter!.combat!;
  next = act(next, chooseAction(now, combatantById(now, actor.id), ctx), ctx);
  const end = next.encounter?.combat;
  if (end && !end.outcome && end.order[end.turn] === actor.id) return endTurn(next);
  return next;
}

/** For tests and previews: what the active enemy would do. */
export function planEnemyTurn(state: GameState, ctx: Pick<CombatContext, 'getAbility'>): { move: Pos | null; action: Plan } {
  const c = state.encounter!.combat!;
  const actor = activeCombatant(c);
  const fear = statusOf(actor, 'feared');
  const scarer = fear?.sourceId ? c.combatants.find((x) => x.id === fear.sourceId && x.hp > 0) : undefined;
  if (scarer) return { move: fleeFrom(c, actor, scarer.pos), action: { kind: 'none' } };
  const move = chooseMove(c, actor, ctx);
  const there = move ? standingAt(c, actor, move) : c;
  return { move, action: chooseAction(there, combatantById(there, actor.id), ctx) };
}
