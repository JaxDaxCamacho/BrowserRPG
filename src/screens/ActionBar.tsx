import { useEffect } from 'react';
import { getAbility, getItem, getTalentTree } from '../content';
import {
  abilityBlocker,
  abilityRange,
  ammoLeft,
  attackTargets,
  kickTargets,
  obstacleTargets,
  OFF_HAND_PENALTY,
  RESOURCES,
  talentEffects,
  type AbilityDefinition,
  type Combatant,
  type CombatState,
  type Merc,
  type Resource,
} from '../engine';
import { AssetImage } from './assets';
import { Tip, useTip } from './Tip';

/** One button on the action bar. */
export type Slot =
  | { kind: 'attack' }
  | { kind: 'defend' }
  | { kind: 'kick' }
  | { kind: 'ability'; ability: AbilityDefinition }
  | { kind: 'potion'; itemId: string; quantity: number }
  | { kind: 'empty' };

/** Slots 1–3 are the same for everyone; 4–9 hold class abilities from the talent tree. */
export const BAR_SIZE = 9;
const CLASS_SLOTS = BAR_SIZE - 3;

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

/**
 * The numbered bar (always nine slots) and the extras that do not fit it:
 * talent abilities past the sixth, abilities from gear, and potions.
 */
export function slotsFor(actor: Combatant, merc: Merc | undefined): { bar: Slot[]; extras: Slot[] } {
  const actions = actor.abilityIds.map((id) => getAbility(id)).filter((a) => a.activation === 'action');
  const taught = merc
    ? talentEffects(merc, getTalentTree(merc.classId)).flatMap((e) => (e.type === 'ability' ? [e.abilityId] : []))
    : [];
  const classAbilities = taught.map((id) => actions.find((a) => a.id === id)).filter((a): a is AbilityDefinition => !!a);
  const fromGear = actions.filter((a) => !taught.includes(a.id));
  const toSlot = (ability: AbilityDefinition): Slot => ({ kind: 'ability', ability });
  const bar: Slot[] = [{ kind: 'attack' }, { kind: 'defend' }, { kind: 'kick' }, ...classAbilities.slice(0, CLASS_SLOTS).map(toSlot)];
  while (bar.length < BAR_SIZE) bar.push({ kind: 'empty' });
  const potions = (merc?.inventory ?? []).filter((s) => getItem(s.itemId).kind === 'potion');
  const extras: Slot[] = [
    ...classAbilities.slice(CLASS_SLOTS).map(toSlot),
    ...fromGear.map(toSlot),
    ...potions.map((s): Slot => ({ kind: 'potion', itemId: s.itemId, quantity: s.quantity })),
  ];
  return { bar, extras };
}

/** Why a slot cannot be used now, or null. */
export function slotBlocker(combat: CombatState, actor: Combatant, slot: Slot): string | null {
  if (slot.kind === 'empty') return 'Learn class abilities in the talent tree to fill this slot';
  if (combat.acted) return 'Already acted this turn';
  switch (slot.kind) {
    case 'attack':
      if (ammoLeft(combat, actor) === 0) return 'Out of ammunition';
      return attackTargets(combat, actor).length === 0 && obstacleTargets(combat, actor).length === 0 ? 'No target in reach' : null;
    case 'kick':
      return kickTargets(combat, actor).length === 0 ? 'No enemy next to you' : null;
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
        name: `Attack: ${a.name}${actor.offHand ? ` + ${actor.offHand.attack.name}` : ''}`,
        ...(a.icon ? { icon: a.icon } : {}),
        fallback: '⚔',
        lines: [
          `A normal attack with your weapon · ${a.range === 0 ? 'melee' : `range ${a.range}`}`,
          `Graze ${a.profile.graze} · hit ${a.profile.hit}`,
          ...(actor.offHand
            ? [
                `Then the ${actor.offHand.attack.name} in your off hand strikes too, at ${Math.max(0, OFF_HAND_PENALTY - actor.twinWeapons) === 0 ? 'no penalty' : `-${Math.max(0, OFF_HAND_PENALTY - actor.twinWeapons)} to hit`}.`,
              ]
            : []),
        ],
      };
    }
    case 'defend':
      return { name: 'Defend', fallback: '🛡', lines: ['Spend your action bracing: +2 Defense until your next turn.'] };
    case 'kick':
      return {
        name: 'Kick',
        fallback: '🦶',
        lines: [
          'Push an enemy next to you one tile back: a d20 with no modifier against its Defense.',
          'Pushed, it must make a Toughness check against 10 + your Strength modifier or fall down.',
        ],
      };
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
    case 'empty':
      return { name: 'Empty slot', fallback: '', lines: [] };
  }
}

/** Mana, adrenaline and souls for a combatant. */
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

interface SlotButtonProps {
  combat: CombatState;
  actor: Combatant;
  slot: Slot;
  index: number;
  hotkey?: number;
  selected: boolean;
  /** False while looking at a merc whose turn it is not: everything is shown, nothing can be used. */
  usable: boolean;
  onUse: (index: number) => void;
  onCancel: () => void;
}

function SlotButton({ combat, actor, slot, index, hotkey, selected, usable, onUse, onCancel }: SlotButtonProps) {
  const info = slotInfo(actor, slot);
  const blocker = usable ? slotBlocker(combat, actor, slot) : slot.kind === 'empty' ? slotBlocker(combat, actor, slot) : 'Not this merc’s turn';
  const cooldown = slot.kind === 'ability' ? (actor.cooldowns[slot.ability.id] ?? 0) : 0;
  const cost = slot.kind === 'ability' ? slot.ability.cost : undefined;
  const shots = slot.kind === 'attack' ? ammoLeft(combat, actor) : null;
  const tip = useTip();
  return (
    <button
      {...tip.bind}
      type="button"
      className={`action-slot${selected ? ' selected' : ''}${blocker ? ' blocked' : ''}${slot.kind === 'empty' ? ' empty' : ''}`}
      aria-disabled={!!blocker && !selected}
      onClick={() => {
        if (selected) onCancel();
        else if (!blocker) onUse(index);
      }}
      aria-label={`${hotkey ? `${hotkey}: ` : ''}${info.name}${blocker ? ` (${blocker})` : ''}`}
    >
      {slot.kind !== 'empty' && <AssetImage id={info.icon} fallback={info.fallback} size={44} className="slot-icon" />}
      {hotkey && <span className="slot-key">{hotkey}</span>}
      {cost && <span className={`slot-cost res-${cost.resource}`}>{cost.amount}</span>}
      {shots !== null && <span className="slot-cost">{shots}</span>}
      {cooldown > 0 && <span className="slot-cooldown">{cooldown}</span>}
      {slot.kind !== 'empty' || blocker ? (
        <Tip anchor={tip.anchor}>
          <strong>{info.name}</strong>
          {info.lines.map((l, k) => (
            <span key={k}>{l}</span>
          ))}
          {blocker && <span className="slot-why">{blocker}</span>}
        </Tip>
      ) : null}
    </button>
  );
}

interface BarProps {
  combat: CombatState;
  /** The merc whose bar is shown. */
  actor: Combatant;
  bar: Slot[];
  extras: Slot[];
  /** True when it is this merc's turn and the player may act. */
  usable: boolean;
  /** Index of the slot waiting for a target, if any. Extras count on from the end of the bar. */
  selected: number | null;
  onUse: (index: number) => void;
  onCancel: () => void;
  onEndTurn: () => void;
  onFlee: () => void;
}

/**
 * The nine numbered slots: 1 attack, 2 defend, 3 kick, 4–9 class abilities.
 * Keys 1–9 use them, Escape cancels targeting, E ends the turn.
 */
export function ActionBar({ combat, actor, bar, extras, usable, selected, onUse, onCancel, onEndTurn, onFlee }: BarProps) {
  useEffect(() => {
    if (!usable) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        const slot = bar[i];
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
  }, [combat, actor, bar, usable, onUse, onCancel, onEndTurn]);

  return (
    <div className="action-bar-wrap">
      <ResourceMeters actor={actor} />
      <div className="action-bar" role="toolbar" aria-label={`${actor.name}'s actions`}>
        {bar.map((slot, i) => (
          <SlotButton
            key={`bar-${i}`}
            combat={combat}
            actor={actor}
            slot={slot}
            index={i}
            hotkey={i + 1}
            selected={selected === i}
            usable={usable}
            onUse={onUse}
            onCancel={onCancel}
          />
        ))}
      </div>
      {extras.length > 0 && (
        <div className="action-bar extras" role="toolbar" aria-label="Items and other abilities">
          {extras.map((slot, i) => (
            <SlotButton
              key={`extra-${i}`}
              combat={combat}
              actor={actor}
              slot={slot}
              index={BAR_SIZE + i}
              selected={selected === BAR_SIZE + i}
              usable={usable}
              onUse={onUse}
              onCancel={onCancel}
            />
          ))}
        </div>
      )}
      {usable && (
        <div className="row action-extra">
          <button type="button" disabled={combat.acted} onClick={onFlee}>
            Flee
          </button>
          <button type="button" onClick={onEndTurn}>
            End turn <span className="dim">(E)</span>
          </button>
        </div>
      )}
    </div>
  );
}
