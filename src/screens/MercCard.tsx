import type { ReactNode } from 'react';
import { getClass, getItem, getRace } from '../content';
import {
  formatCoins,
  mercSheet,
  STARTING_PURSE,
  STAT_NAMES,
  statModifier,
  type EquipSlot,
  type Equipment,
  type Merc,
  type MercDraft,
  type StatName,
} from '../engine';
import { AssetImage } from './assets';

export const STAT_LABELS: Record<StatName, string> = {
  strength: 'STR',
  agility: 'AGI',
  toughness: 'TOU',
  intellect: 'INT',
  spirit: 'SPI',
  charisma: 'CHA',
};

export function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [name.trim()[0] ?? '?'];
  return letters.join('').toUpperCase();
}

/** The merc's round token: their portrait, or their initials until one is set. */
export function Token({ name, portrait, size = 52 }: { name: string; portrait?: string; size?: number }) {
  return <AssetImage id={portrait} fallback={initials(name)} className="token" size={size} />;
}

const GEAR_SLOTS: EquipSlot[] = ['mainHand', 'offHand', 'body', 'ammo'];

type CardMerc = MercDraft | Merc;

function equipmentOf(merc: CardMerc): Equipment {
  return 'equipment' in merc ? merc.equipment : merc.loadout;
}

interface Props {
  merc: CardMerc;
  /** Buttons shown at the bottom of the card. */
  actions?: ReactNode;
  badge?: string;
  selected?: boolean;
  onSelect?: () => void;
}

/** One merc at a glance: who they are, their gear, stats and derived values. */
export function MercCard({ merc, actions, badge, selected, onSelect }: Props) {
  const race = getRace(merc.raceId);
  const cls = getClass(merc.classId);
  const equipment = equipmentOf(merc);
  const sheet = mercSheet({ ...merc, equipment }, race, cls, getItem);
  const purse = 'purse' in merc ? merc.purse : STARTING_PURSE;
  const gear = GEAR_SLOTS.flatMap((slot) => (equipment[slot] ? [getItem(equipment[slot])] : []));

  const body = (
    <>
      <span className="merc-head">
        <Token name={merc.name} portrait={merc.portrait} />
        <span className="merc-title">
          <strong>{merc.name}</strong>
          <span className="dim merc-kind">
            <AssetImage id={race.icon} fallback="" size={18} alt={race.name} className="badge-icon" />
            {race.name}
            <AssetImage id={cls.icon} fallback="" size={18} alt={cls.name} className="badge-icon" />
            {cls.name}
          </span>
        </span>
        {badge && <span className="badge">{badge}</span>}
      </span>
      <span className="gear-row">
        {gear.map((item, i) => (
          <span key={`${item.id}-${i}`} className="gear-chip" title={item.name}>
            <AssetImage id={item.icon} fallback={item.name[0]} size={28} alt={item.name} />
            <span className="gear-name">{item.name}</span>
          </span>
        ))}
      </span>
      <span className="stat-line">
        {STAT_NAMES.map((name) => (
          <span key={name} className="stat-chip">
            <span className="dim">{STAT_LABELS[name]}</span> {sheet.stats[name]}{' '}
            <span className="dim">({formatModifier(statModifier(sheet.stats[name]))})</span>
          </span>
        ))}
      </span>
      <span className="stat-line">
        <span className="stat-chip">
          <span className="dim">HP</span> {sheet.maxHp}
        </span>
        <span className="stat-chip">
          <span className="dim">Defense</span> {sheet.defense}
        </span>
        <span className="stat-chip">
          <span className="dim">Armour</span> {sheet.armour.physical}
          {sheet.armour.magic > 0 && (
            <>
              {' '}
              <span className="dim">/ magic</span> {sheet.armour.magic}
            </>
          )}
        </span>
        <span className="stat-chip">
          <span className="dim">Purse</span> {formatCoins(purse)}
        </span>
      </span>
    </>
  );

  return (
    <div className={`merc-card${selected ? ' selected' : ''}`}>
      {onSelect ? (
        <button type="button" className="merc-body merc-select" aria-pressed={selected} onClick={onSelect}>
          {body}
        </button>
      ) : (
        <div className="merc-body">{body}</div>
      )}
      {actions && <div className="row merc-actions">{actions}</div>}
    </div>
  );
}
