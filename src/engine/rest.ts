import type { GameState } from './gameState';
import type { ItemLookup } from './items';

/**
 * A long rest: the party makes camp, recovers all hit points, gets back up if
 * knocked down, and can spend healing kits to cure injuries. Only one long rest
 * is allowed on each level of a dungeon.
 */

export interface RestPlan {
  /** Injuries to cure, one healing kit each. */
  cure: { mercId: string; injuryId: string }[];
}

/** Why the party cannot rest right now, or null if it can. */
export function restBlocker(state: GameState): string | null {
  const d = state.dungeon;
  if (!d || state.screen !== 'dungeon') return 'You can only make camp while exploring.';
  if (d.rested) return 'You have already made camp on this level.';
  if (d.path.length > 0) return 'Stop walking first.';
  if (state.party.every((m) => m.dead)) return 'No one is left to rest.';
  return null;
}

/** Healing kits across every living merc's pack. */
export function healingKitsHeld(state: GameState, getItem: ItemLookup): number {
  return state.party
    .filter((m) => !m.dead)
    .flatMap((m) => m.inventory)
    .filter((s) => {
      const item = getItem(s.itemId);
      return item.kind === 'kit' && item.use === 'healInjury';
    })
    .reduce((n, s) => n + s.quantity, 0);
}

/** Takes one healing kit, from the patient's own pack if they carry one, otherwise from whoever does. */
function spendKit(state: GameState, patientId: string, getItem: ItemLookup): GameState {
  const isKit = (itemId: string) => {
    const item = getItem(itemId);
    return item.kind === 'kit' && item.use === 'healInjury';
  };
  const carriers = [...state.party].sort((a, b) => (a.id === patientId ? -1 : b.id === patientId ? 1 : 0));
  const carrier = carriers.find((m) => !m.dead && m.inventory.some((s) => isKit(s.itemId)));
  if (!carrier) throw new Error('There is no healing kit left.');
  const stack = carrier.inventory.find((s) => isKit(s.itemId))!;
  return {
    ...state,
    party: state.party.map((m) =>
      m.id !== carrier.id
        ? m
        : {
            ...m,
            inventory: m.inventory
              .map((s) => (s === stack ? { ...s, quantity: s.quantity - 1 } : s))
              .filter((s) => s.quantity > 0),
          },
    ),
  };
}

export function longRest(state: GameState, plan: RestPlan, getItem: ItemLookup): GameState {
  const blocker = restBlocker(state);
  if (blocker) throw new Error(blocker);
  if (plan.cure.length > healingKitsHeld(state, getItem)) throw new Error('Not enough healing kits.');

  let next = state;
  const lines: string[] = ['The party makes camp and rests.'];
  for (const { mercId, injuryId } of plan.cure) {
    const merc = next.party.find((m) => m.id === mercId);
    const injury = merc?.injuries.find((i) => i.id === injuryId);
    if (!merc || merc.dead || !injury) throw new Error('That injury cannot be treated.');
    next = spendKit(next, mercId, getItem);
    next = { ...next, party: next.party.map((m) => (m.id === mercId ? { ...m, injuries: m.injuries.filter((i) => i.id !== injuryId) } : m)) };
    lines.push(`A healing kit mends ${merc.name}'s ${injury.name.toLowerCase()}.`);
  }

  // Everyone alive wakes up whole, injuries aside.
  next = { ...next, party: next.party.map((m) => (m.dead ? m : { ...m, wounds: 0, down: false })) };
  const dungeon = next.dungeon!;
  return { ...next, dungeon: { ...dungeon, rested: true, log: [...dungeon.log, ...lines].slice(-30) } };
}
