import { useEffect } from 'react';
import { getAbility, getItem } from '../content';
import {
  abilityBlocker,
  abilityRange,
  ammoLeft,
  attackTargets,
  obstacleTargets,
  RESOURCES,
  type AbilityDefinition,
  type Combatant,
  type CombatState,
  type Merc,
  type Resource,
} from '../engine';
import { AssetImage } from './assets';

/** One button on the action bar. */
export type Slot =
  | { kind: 'attack' }
  | { kind: 'ability'; ability: AbilityDefinition }
  | { kind: 'potion'; itemId: string; quantity: number }
  | { kind: 'defend' };

export const RESOURCE_LABEL: Record<Resource, { name: string; short: string }> = {
  mana: { name: 'Mana', short: 'MP' },
  adrenaline: { name: 'Adrenaline', short: 'ADR' },
  souls: { name: 'Souls', short: 'SOUL' },
};

const TARGET_WORDS: Record<AbilityDefinition['target'], string> = {
  self: 'Self',
  ally: 'One ally',
  enemy: 'One enemy',
  any: 'One enemy or ally',
  area: 'An enemy and everyone next to it',
  allAllies: 'Allies in range',
  allEnemies: 'Enemies in range',
};

/** Abilities that need a target picked on the battlefield; the rest fire at once. */
export function needsPick(ability: AbilityDefinition): boolean {
  return ability.target === 'enemy' || ability.target === 'ally' || ability.target === 'any' || ability.target === 'area';
}

/** The slots in bar order: weapon, abilities, potions, Defend. */
export function slotsFor(actor: Combatant, merc: Merc | undefined): Slot[] {
  const abilities = actor.abilityIds.map((id) => getAbility(id)).filter((a) => a.activation === 'action');
  const potions = (merc?.inventory ?? []).filter((s) => getItem(s.itemId).kind === 'potion');
  return [
    { kind: 'attack' },
    ...abilities.map((ability): Slot => ({ kind: 'ability', ability })),
    ...potions.map((s): Slot => ({ kind: 'potion', itemId: s.itemId, quantity: s.quantity })),
    { kind: 'defend' },
  ];
}

/** Why a slot cannot be used now, or null. */
export function slotBlocker(combat: CombatState, actor: Combatant, slot: Slot): string | null {
  if (combat.acted) return 'Already acted this turn';
  switch (slot.kind) {
    case 'attack':
      if (ammoLeft(combat, actor) === 0) return 'Out of ammunition';
      return attackTargets(combat, actor).length === 0 && obstacleTargets(combat, actor).length === 0 ? 'No target in reach' : null;
    case 'ability':
      return abilityBlocker(combat, actor, slot.ability);
    case 'potion':
    case 'defend':
      return null;
  }
}

function slotInfo(actor: Combatant, slot: Slot): { name: string; icon?: string; fallback: string; lines: string[] } {
  switch (slot.kind) {
    case 'attack': {
      const a = actor.attack;
      return {
        name: a.name,
        fallback: '⚔',
        lines: [`Weapon attack · ${a.profile.kind}, ${a.range === 0 ? 'melee' : `range ${a.range}`}`, `Graze ${a.profile.graze} · hit ${a.profile.hit}`],
      };
    }
    case 'ability': {
      const ab = slot.ability;
      const range = abilityRange(actor, ab);
      const lines = [ab.description, `${TARGET_WORDS[ab.target]} · ${range === 0 ? 'melee' : `range ${range}`}`];
      const extra = [ab.cost && `${ab.cost.amount} ${RESOURCE_LABEL[ab.cost.resource].name.toLowerCase()}`, ab.cooldown && `cooldown ${ab.cooldown}`].filter(Boolean);
      if (extra.length) lines.push(extra.join(' · '));
      return { name: ab.name, ...(ab.icon ? { icon: ab.icon } : {}), fallback: ab.name.slice(0, 2), lines };
    }
    case 'potion': {
      const item = getItem(slot.itemId);
      return { name: `${item.name} ×${slot.quantity}`, ...(item.icon ? { icon: item.icon } : {}), fallback: '🧪', lines: [item.description ?? 'Drink it.'] };
    }
    case 'defend':
      return { name: 'Defend', fallback: '🛡', lines: ['+2 Defense until your next turn.'] };
  }
}

/** Mana, adrenaline and souls for the acting merc. */
export function ResourceMeters({ actor }: { actor: Combatant }) {
  const pools = RESOURCES.filter((r) => actor.resources[r]);
  if (pools.length === 0) return null;
  return (
    <div className="resource-meters">
      {pools.map((r) => {
        const pool = actor.resources[r]!;
        return (
          <span key={r} className={`resource-meter res-${r}`} title={`${RESOURCE_LABEL[r].name}: ${pool.current} of ${pool.max}`}>
            <span className="resource-name">{RESOURCE_LABEL[r].short}</span>
            <span className="resource-bar">
              <span style={{ width: `${(pool.current / pool.max) * 100}%` }} />
            </span>
            <span className="resource-value">
              {pool.current}/{pool.max}
            </span>
          </span>
        );
      })}
    </div>
  );
}

interface BarProps {
  combat: CombatState;
  actor: Combatant;
  slots: Slot[];
  /** Index of the slot waiting for a target, if any. */
  selected: number | null;
  onUse: (index: number) => void;
  onCancel: () => void;
  onEndTurn: () => void;
  onFlee: () => void;
}

/**
 * The acting merc's actions as a row of icons. Keys 1–9 use the first nine
 * slots, Escape cancels targeting, E ends the turn.
 */
export function ActionBar({ combat, actor, slots, selected, onUse, onCancel, onEndTurn, onFlee }: BarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        const slot = slots[i];
        if (slot && !slotBlocker(combat, actor, slot)) {
          e.preventDefault();
          onUse(i);
        }
      } else if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'e' || e.key === 'E') {
        onEndTurn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combat, actor, slots, onUse, onCancel, onEndTurn]);

  return (
    <div className="action-bar-wrap">
      <ResourceMeters actor={actor} />
      <div className="action-bar" role="toolbar" aria-label="Actions">
        {slots.map((slot, i) => {
          const info = slotInfo(actor, slot);
          const blocker = slotBlocker(combat, actor, slot);
          const cooldown = slot.kind === 'ability' ? (actor.cooldowns[slot.ability.id] ?? 0) : 0;
          const cost = slot.kind === 'ability' ? slot.ability.cost : undefined;
          const shots = slot.kind === 'attack' ? ammoLeft(combat, actor) : null;
          return (
            <button
              key={`${slot.kind}-${i}`}
              type="button"
              className={`action-slot${selected === i ? ' selected' : ''}${blocker ? ' blocked' : ''}`}
              disabled={!!blocker && selected !== i}
              onClick={() => (selected === i ? onCancel() : onUse(i))}
              aria-label={`${i < 9 ? `${i + 1}: ` : ''}${info.name}${blocker ? ` (${blocker})` : ''}`}
            >
              <AssetImage id={info.icon} fallback={info.fallback} size={44} className="slot-icon" />
              {i < 9 && <span className="slot-key">{i + 1}</span>}
              {cost && <span className={`slot-cost res-${cost.resource}`}>{cost.amount}</span>}
              {shots !== null && <span className="slot-cost">{shots}</span>}
              {cooldown > 0 && <span className="slot-cooldown">{cooldown}</span>}
              <span className="slot-tip" role="tooltip">
                <strong>{info.name}</strong>
                {info.lines.map((l, k) => (
                  <span key={k}>{l}</span>
                ))}
                {blocker && <span className="slot-why">{blocker}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="row action-extra">
        <button type="button" disabled={combat.acted} onClick={onFlee}>
          Flee
        </button>
        <button type="button" onClick={onEndTurn}>
          End turn <span className="dim">(E)</span>
        </button>
      </div>
    </div>
  );
}
