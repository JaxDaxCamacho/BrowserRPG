import type { ReactNode } from 'react';
import { effectiveArmour, effectiveDefense, RESOURCES, type Combatant } from '../engine';
import { RESOURCE_LABEL } from './ActionBar';
import { AssetImage } from './assets';
import { STATUS_FLAIR } from './combatFlair';
import { initials } from './MercCard';
import { StatBar } from './StatBar';

/**
 * A combatant at a glance: portrait, name, health and resources, Defense and
 * armour, and any conditions with the turns they have left. Used for the merc
 * who is acting and for the token being aimed at or hovered.
 */
export function CombatantPanel({
  x,
  subtitle,
  defense,
  className = '',
  children,
}: {
  x: Combatant;
  subtitle?: string;
  /** Defense in the fight, with allies' auras; the combatant's own when not given. */
  defense?: number;
  className?: string;
  /** Extra lines under the name, such as moves left or the chance to hit. */
  children?: ReactNode;
}) {
  const armour = effectiveArmour(x);
  return (
    <section className={`combatant-panel side-${x.side} ${className}`} aria-label={x.name}>
      <AssetImage id={x.portrait} fallback={initials(x.name)} className="panel-portrait" />
      <div className="panel-body">
        <p className="panel-name">
          <strong>{x.name}</strong>
          {subtitle && <span className="dim"> · {subtitle}</span>}
          {x.hp === 0 && <span className="panel-down"> · {x.dead ? 'Dead' : 'Down'}</span>}
        </p>
        <div className="panel-bars">
          <StatBar kind="hp" current={x.hp} max={x.maxHp} />
          {RESOURCES.filter((r) => x.resources[r]).map((r) => (
            <StatBar key={r} kind={r} current={x.resources[r]!.current} max={x.resources[r]!.max} label={RESOURCE_LABEL[r].short} />
          ))}
        </div>
        <p className="panel-chips">
          <span className="stat-chip" title="Attacks that roll above this hit; at or below, they graze">
            <span className="dim">Def</span> {defense ?? effectiveDefense(x)}
          </span>
          <span className="stat-chip" title="Taken off physical damage">
            <span className="dim">Armour</span> {armour.physical}
          </span>
          <span className="stat-chip" title="Taken off magic damage">
            <span className="dim">Magic</span> {armour.magic}
          </span>
          {x.shieldDropped && (
            <span className="stat-chip status-chip" title="The shield lies on the floor: no shield Defense until it is picked up">
              🛡 Shield dropped
            </span>
          )}
          {x.defending && (
            <span className="stat-chip" title="Defending: +2 Defense until their next turn">
              🛡 Defending
            </span>
          )}
          {x.statuses.map((st) => (
            <span
              key={st.kind}
              className="stat-chip status-chip"
              title={`${STATUS_FLAIR[st.kind].name}${st.amount ? (st.kind === 'warded' ? ` (${st.amount} left)` : ` (${st.amount} a turn)`) : ''}: ${st.rounds} turn${st.rounds === 1 ? '' : 's'} left`}
            >
              {STATUS_FLAIR[st.kind].icon} {STATUS_FLAIR[st.kind].name} <span className="dim">{st.rounds}</span>
            </span>
          ))}
        </p>
        {children}
      </div>
    </section>
  );
}
