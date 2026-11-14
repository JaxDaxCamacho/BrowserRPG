import type { CombatState } from '../engine';
import { AssetImage } from './assets';
import { initials } from './MercCard';

/**
 * The bosses in a fight, in the top bar: name and title, a wide health bar
 * with a notch at every phase threshold, and which phase the fight is in.
 */
export function BossBanner({ combat }: { combat: CombatState }) {
  const bosses = combat.combatants.filter((x) => x.boss);
  if (bosses.length === 0) return null;
  return (
    <div className="boss-banners">
      {bosses.map((x) => {
        const plan = x.boss!;
        const pct = x.maxHp > 0 ? Math.max(0, (x.hp / x.maxHp) * 100) : 0;
        const phase = plan.reached + 1;
        const phases = plan.phases.length + 1;
        return (
          <div key={x.id} className={`boss-banner${x.hp === 0 ? ' defeated' : ''}`} title={`${x.name}: ${x.hp} / ${x.maxHp} HP`}>
            <AssetImage id={x.portrait} fallback={initials(x.name)} className="boss-portrait" />
            <div className="boss-body">
              <p className="boss-name">
                <span aria-hidden="true">👑 </span>
                <strong>{x.name}</strong>
                {plan.title && <span className="dim"> · {plan.title}</span>}
                <span className="boss-phase">{x.hp === 0 ? 'Defeated' : phases > 1 ? `Phase ${phase} of ${phases}` : ''}</span>
              </p>
              <span className="boss-health" role="meter" aria-label={`${x.name} health`} aria-valuemin={0} aria-valuemax={x.maxHp} aria-valuenow={x.hp}>
                <span className="boss-health-lag" style={{ width: `${pct}%` }} />
                <span className="boss-health-fill" style={{ width: `${pct}%` }} />
                {plan.phases.map((p, i) => (
                  <span key={i} className={`boss-notch${i < plan.reached ? ' passed' : ''}`} style={{ left: `${p.atHpPercent}%` }} />
                ))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
