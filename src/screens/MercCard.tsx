import type { ReactNode } from 'react';
import { getClass, getRace } from '../content';
import { mercSheet, STAT_NAMES, statModifier, type MercDraft, type StatName } from '../engine';

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

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [name.trim()[0] ?? '?'];
  return letters.join('').toUpperCase();
}

/** Placeholder for the portrait token: a circle with the merc's initials. */
export function Token({ name }: { name: string }) {
  return (
    <span className="token" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

interface Props {
  merc: MercDraft;
  /** Buttons shown at the bottom of the card. */
  actions?: ReactNode;
  badge?: string;
  selected?: boolean;
  onSelect?: () => void;
}

/** One merc at a glance: who they are, their stats and their derived values. */
export function MercCard({ merc, actions, badge, selected, onSelect }: Props) {
  const race = getRace(merc.raceId);
  const cls = getClass(merc.classId);
  const sheet = mercSheet(merc, race, cls);

  const body = (
    <>
      <span className="merc-head">
        <Token name={merc.name} />
        <span className="merc-title">
          <strong>{merc.name}</strong>
          <span className="dim">
            {race.name} {cls.name}
          </span>
        </span>
        {badge && <span className="badge">{badge}</span>}
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
        {sheet.armour.magic > 0 && (
          <span className="stat-chip">
            <span className="dim">Magic armour</span> {sheet.armour.magic}
          </span>
        )}
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
