import type { CombatState } from '../engine';
import { AssetImage } from './assets';
import { initials } from './MercCard';

/**
 * Who acts when: starting with whoever is acting now, then the rest of this
 * round, a marker, and the start of the next round. Each portrait carries a
 * small health bar; hovering one lights up its token on the battlefield.
 */
export function TurnOrder({ combat, hoverId, onHover }: { combat: CombatState; hoverId: string | null; onHover: (id: string | null) => void }) {
  const shown = combat.order
    .map((id, i) => ({ id, i, x: combat.combatants.find((k) => k.id === id)! }))
    .filter(({ x }) => x && !(x.summoned && x.hp === 0));
  const now = shown.filter(({ i }) => i >= combat.turn);
  const next = shown.filter(({ i }) => i < combat.turn);
  const item = ({ id, i, x }: (typeof shown)[number], upcoming: boolean) => {
    const pct = x.maxHp > 0 ? Math.max(0, (x.hp / x.maxHp) * 100) : 0;
    const current = i === combat.turn && !upcoming;
    // In a surprise round the enemies' first turns are skipped.
    const surprised = !!combat.surprise && combat.round === 1 && !upcoming && x.side === 'enemy';
    return (
      <li
        key={`${upcoming ? 'next' : 'now'}-${id}`}
        className={`turn-entry side-${x.side}${current ? ' current' : ''}${x.hp === 0 ? ' down' : ''}${hoverId === id ? ' hovered' : ''}${upcoming ? ' upcoming' : ''}${surprised ? ' surprised' : ''}`}
        title={`${x.name}${x.hp === 0 ? ' (down)' : ` · ${x.hp} / ${x.maxHp} HP`} · initiative ${x.initiative}${surprised ? ' · caught off guard: loses this turn' : ''}`}
        onMouseEnter={() => onHover(id)}
        onMouseLeave={() => onHover(null)}
      >
        <AssetImage id={x.portrait} fallback={initials(x.name)} className="turn-portrait" />
        <span className="turn-health">
          <span style={{ width: `${pct}%` }} />
        </span>
      </li>
    );
  };
  return (
    <ol className="turn-order" aria-label="Turn order">
      {now.map((e) => item(e, false))}
      {next.length > 0 && (
        <li className="turn-divider" aria-label={`Round ${combat.round + 1}`}>
          <span>R{combat.round + 1}</span>
        </li>
      )}
      {next.map((e) => item(e, true))}
    </ol>
  );
}
