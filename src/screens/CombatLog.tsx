import { useEffect, useRef } from 'react';
import type { AttackLogDetail, CombatLogEntry, CombatState } from '../engine';

export const STAT_SHORT: Record<string, string> = {
  strength: 'STR',
  agility: 'AGI',
  toughness: 'TOU',
  intellect: 'INT',
  spirit: 'SPI',
  charisma: 'CHA',
};

const OUTCOME_WORD: Record<string, string> = { miss: 'Miss', graze: 'Graze', hit: 'Hit', crit: 'Critical!' };

function plus(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** The fight's history, falling back to the short log for fights saved before the history existed. */
function entriesOf(combat: CombatState): CombatLogEntry[] {
  return combat.history ?? combat.log.map((text) => ({ round: combat.round, text }));
}

function AttackLine({ a }: { a: AttackLogDetail }) {
  const r = a.roll;
  const dice = r.dice.length > 1 ? `${r.dice.join(' / ')} (${r.mode}, kept ${r.natural})` : `${r.natural}`;
  const bonuses = `${plus(r.modifier)} ${STAT_SHORT[r.stat] ?? r.stat}${r.rollBonus ? ` ${plus(r.rollBonus)} off hand` : ''}${r.rangePenalty ? ` ${plus(-r.rangePenalty)} range` : ''}`;
  return (
    <li className={`log-attack outcome-${a.outcome}`}>
      <p className="log-who">
        <span className={`log-name side-${a.attackerSide}`}>{a.attacker}</span>
        <span className="log-arrow" aria-label="attacks"> → </span>
        <span className={`log-name side-${a.targetSide ?? 'none'}`}>{a.target}</span>
        <span className="dim"> · {r.free ? 'free attack, ' : ''}{r.label}</span>
      </p>
      <p className="log-roll">
        Rolled <strong>{dice}</strong> {bonuses} = <strong>{r.total}</strong> vs Defense {r.defense}
        <span className="log-outcome"> {OUTCOME_WORD[a.outcome]}</span>
      </p>
      <p className="log-damage">
        {a.outcome === 'miss' ? (
          <span className="dim">No damage</span>
        ) : (
          <>
            <strong>{r.damage}</strong> damage
            {r.armour > 0 && <span className="dim"> ({r.armour} soaked by armour)</span>}
            {r.extraDamage > 0 && <span className="dim"> (includes {r.extraDamage} extra)</span>}
          </>
        )}
      </p>
    </li>
  );
}

/** Everything that has happened in the fight, newest at the bottom, grouped by round. */
export function CombatLog({ combat }: { combat: CombatState }) {
  const entries = entriesOf(combat);
  const listRef = useRef<HTMLOListElement>(null);

  // Follow the newest line as it comes in.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length]);

  return (
    <aside className="combat-history" aria-label="Combat log">
      <h2>Combat log</h2>
      <ol ref={listRef} aria-live="polite">
        {entries.map((e, i) => {
          const newRound = i === 0 || entries[i - 1]!.round !== e.round;
          return (
            <LogItem key={i} entry={e} roundHeader={newRound ? e.round : null} />
          );
        })}
      </ol>
    </aside>
  );
}

function LogItem({ entry, roundHeader }: { entry: CombatLogEntry; roundHeader: number | null }) {
  return (
    <>
      {roundHeader !== null && <li className="log-round">Round {roundHeader}</li>}
      {entry.attack ? <AttackLine a={entry.attack} /> : <li className={entry.down ? 'log-down' : entry.phase ? 'log-phase' : 'log-note'}>{entry.text}</li>}
    </>
  );
}
