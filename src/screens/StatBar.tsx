/**
 * A framed bar for health and resources, in the CinderUI style: the field
 * frame as the track, a coloured gradient as the fill.
 */

export type BarKind = 'hp' | 'mana' | 'adrenaline' | 'souls' | 'xp';

const LABELS: Record<BarKind, string> = {
  hp: 'HP',
  mana: 'Mana',
  adrenaline: 'Adrenaline',
  souls: 'Souls',
  xp: 'XP',
};

export function StatBar({ kind, current, max, label }: { kind: BarKind; current: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  // Health turns from green to amber to red as it runs out.
  const tone = kind === 'hp' ? (pct > 50 ? 'good' : pct > 25 ? 'low' : 'critical') : '';
  return (
    <div className={`stat-bar bar-${kind}${tone ? ` ${tone}` : ''}`} role="meter" aria-label={label ?? LABELS[kind]} aria-valuemin={0} aria-valuemax={max} aria-valuenow={current}>
      <span className="stat-bar-label">{label ?? LABELS[kind]}</span>
      <span className="stat-bar-track">
        <span className="stat-bar-fill" style={{ width: `${pct}%` }} />
        <span className="stat-bar-value">
          {current} / {max}
        </span>
      </span>
    </div>
  );
}
