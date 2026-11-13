import {
  abilityTargets,
  activeCombatant,
  attack,
  attackTargets,
  canUseAbility,
  combatantById,
  defend,
  effectiveDefense,
  endTurn,
  moveCombatant,
  standing,
  castAbility,
  type CombatContext,
  type Combatant,
  type CombatState,
} from './combat';
import type { GameState } from './gameState';
import type { AbilityDefinition, EnemyArchetype } from './monsters';

/**
 * How enemies fight. Each archetype picks where to stand and whom to hit:
 *
 * - brawler: closes in on the nearest merc and hits whoever is in reach, weakest first
 * - savage: the same, but never defends, even with no one in reach
 * - tank: closes in and hits; with no one in reach it defends
 * - assassin: hunts the merc with the least HP and armour
 * - archer, caster, summoner: keep a row away from mercs and attack from range
 * - healer: keeps away, heals the most hurt ally below 60%, otherwise attacks
 */

type Plan =
  | { kind: 'attack'; targetId: string }
  | { kind: 'ability'; abilityId: string; targetId: string | null }
  | { kind: 'defend' }
  | { kind: 'none' };

const RANGED: ReadonlySet<EnemyArchetype> = new Set(['archer', 'caster', 'summoner', 'healer']);

function nearestFoe(c: CombatState, actor: Combatant): Combatant | null {
  const foes = standing(c, actor.side === 'party' ? 'enemy' : 'party');
  return foes.reduce<Combatant | null>((best, f) => (!best || Math.abs(f.row - actor.row) < Math.abs(best.row - actor.row) ? f : best), null);
}

/** One row towards a row, or 0 when already there. */
function stepTowards(from: number, to: number): -1 | 0 | 1 {
  return to > from ? 1 : to < from ? -1 : 0;
}

/** For ranged enemies: one row away from the nearest merc, if that row exists. */
function stepAway(c: CombatState, actor: Combatant): -1 | 0 | 1 {
  const near = nearestFoe(c, actor);
  if (!near || near.row !== actor.row) return 0;
  const up = actor.row + 1 < c.rows;
  const down = actor.row - 1 >= 0;
  if (up && down) {
    // Prefer the side with fewer mercs.
    const foes = standing(c, 'party');
    const above = foes.filter((f) => f.row > actor.row).length;
    const below = foes.filter((f) => f.row < actor.row).length;
    return above <= below ? 1 : -1;
  }
  return up ? 1 : down ? -1 : 0;
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

/** What to do with the action, from where the actor stands now. */
function chooseAction(c: CombatState, actor: Combatant, ctx: Pick<CombatContext, 'getAbility'>): Plan {
  const abilities = usableAbilities(c, actor, ctx);
  const arch = actor.archetype ?? 'brawler';

  // Healers first look after their side.
  if (arch === 'healer') {
    const heal = abilities.find((a) => a.effects.some((e) => e.type === 'heal'));
    const hurt = standing(c, actor.side)
      .filter((a) => a.hp < a.maxHp * 0.6)
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    const patient = heal && hurt.find((h) => abilityTargets(c, actor, heal).some((t) => t.id === h.id));
    if (heal && patient) return { kind: 'ability', abilityId: heal.id, targetId: patient.id };
  }

  // Abilities that help the whole side (a rally) are used when they are ready.
  const rally = abilities.find((a) => !a.attack && (a.target === 'allAllies' || a.target === 'self') && a.effects.some((e) => e.type !== 'heal'));
  if (rally && standing(c, 'party').some((p) => Math.abs(p.row - actor.row) <= 1)) {
    return { kind: 'ability', abilityId: rally.id, targetId: null };
  }

  // Damaging abilities beat the basic attack when they can land.
  const strike = abilities.find((a) => a.attack);
  if (strike) {
    const options = abilityTargets(c, actor, strike);
    const pick = arch === 'assassin' ? softest(options) : RANGED.has(arch) ? weakest(options) : weakest(options);
    if (pick) return { kind: 'ability', abilityId: strike.id, targetId: pick.id };
  }

  const targets = attackTargets(c, actor);
  if (targets.length > 0) {
    const pick =
      arch === 'assassin' ? softest(targets) : arch === 'archer' ? easiestToHit(targets) : weakest(targets);
    return { kind: 'attack', targetId: pick!.id };
  }
  if (arch === 'tank') return { kind: 'defend' };
  return { kind: 'none' };
}

/** Where to step before acting. */
function chooseMove(c: CombatState, actor: Combatant): -1 | 0 | 1 {
  const arch = actor.archetype ?? 'brawler';
  if (RANGED.has(arch)) {
    const away = stepAway(c, actor);
    if (away !== 0) return away;
    // Out of range of everyone: close the distance, but never into a merc's row.
    if (attackTargets(c, actor).length === 0) {
      const near = nearestFoe(c, actor);
      if (!near) return 0;
      const step = stepTowards(actor.row, near.row);
      return actor.row + step === near.row ? 0 : step;
    }
    return 0;
  }
  if (attackTargets(c, actor).length > 0 && arch !== 'assassin') return 0;
  const quarry = arch === 'assassin' ? softest(standing(c, 'party')) : nearestFoe(c, actor);
  if (!quarry) return 0;
  if (arch === 'assassin' && quarry.row === actor.row) return 0;
  return stepTowards(actor.row, quarry.row);
}

function act(state: GameState, plan: Plan, ctx: Pick<CombatContext, 'getAbility'>): GameState {
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
 * Plays the active enemy's whole turn: a move if it wants one, then its action.
 * The turn ends by itself once both are used.
 */
export function runEnemyTurn(state: GameState, ctx: Pick<CombatContext, 'getAbility'>): GameState {
  const c = state.encounter?.combat;
  if (!c || c.outcome) return state;
  const actor = activeCombatant(c);
  if (actor.side !== 'enemy') return state;

  let next = state;
  const step = chooseMove(c, actor);
  if (step !== 0) {
    next = moveCombatant(next, step);
    const after = next.encounter?.combat;
    // The move may have ended the fight or the enemy (a free attack), or used up the turn.
    if (!after || after.outcome || after.order[after.turn] !== actor.id) return next;
    if (combatantById(after, actor.id).hp === 0) return endTurn(next);
  }
  const now = next.encounter!.combat!;
  const plan = chooseAction(now, combatantById(now, actor.id), ctx);
  next = act(next, plan, ctx);
  // An enemy that acted without moving gives up its move.
  const end = next.encounter?.combat;
  if (end && !end.outcome && end.order[end.turn] === actor.id) return endTurn(next);
  return next;
}

/** For tests and previews: what the active enemy would do. */
export function planEnemyTurn(state: GameState, ctx: Pick<CombatContext, 'getAbility'>): { move: -1 | 0 | 1; action: Plan } {
  const c = state.encounter!.combat!;
  const actor = activeCombatant(c);
  const move = chooseMove(c, actor);
  const moved = move === 0 ? c : { ...c, combatants: c.combatants.map((x) => (x.id === actor.id ? { ...x, row: x.row + move } : x)) };
  return { move, action: chooseAction(moved, combatantById(moved, actor.id), ctx) };
}
