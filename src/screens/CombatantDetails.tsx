import { getAbility } from '../content';
import {
  effectiveArmour,
  effectiveDefense,
  effectiveMovement,
  effectiveStats,
  STAT_NAMES,
  statModifier,
  type Combatant,
  type StatName,
} from '../engine';
import { ResourceMeters } from './ActionBar';
import { AssetImage } from './assets';
import { formatModifier, initials } from './MercCard';

const STAT_FULL: Record<StatName, string> = {
  strength: 'Strength',
  agility: 'Agility',
  toughness: 'Toughness',
  intellect: 'Intellect',
  spirit: 'Spirit',
  charisma: 'Charisma',
};

const ARCHETYPE_WORDS: Record<string, string> = {
  brawler: 'Brawler: closes in and hits the weakest in reach',
  savage: 'Savage: all attack, never defends',
  tank: 'Tank: holds the line and defends',
  assassin: 'Assassin: hunts the softest target',
  archer: 'Archer: keeps its distance and shoots',
  caster: 'Caster: keeps its distance and casts',
  summoner: 'Summoner: keeps its distance',
  healer: 'Healer: keeps its side on its feet',
};

const STATUS_WORDS: Record<string, string> = {
  stunned: 'Stunned: loses its turn',
  frozen: 'Frozen: loses its turn until a blow shatters the ice',
  taunted: 'Taunted: must go after whoever taunted it',
  invisible: 'Invisible: cannot be targeted',
  poisoned: 'Poisoned',
  bleeding: 'Bleeding',
  burning: 'Burning',
  blinded: 'Blinded: attacks with disadvantage',
  oiled: 'Soaked in oil',
  evasive: 'Evasive: slips away without free attacks',
  silenced: 'Silenced: no abilities',
  feared: 'Feared: runs away',
  spellguard: 'Spellguard: the next hostile spell fizzles',
  reflecting: 'Reflecting: the next hostile spell bounces back',
  warded: 'Warded',
  prone: 'Prone: getting up takes its next move; melee attacks on it have advantage',
  rooted: 'Rooted: cannot move, but can still act',
  regenerating: 'Regenerating',
};

/** Everything known about an enemy (or a summoned ally) in a fight. Opened by double right-clicking its token. */
export function CombatantDetails({ x, onClose }: { x: Combatant; onClose: () => void }) {
  const stats = effectiveStats(x);
  const armour = effectiveArmour(x);
  const a = x.attack;
  const abilities = x.abilityIds.map((id) => getAbility(id));
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${x.name} details`} onClick={onClose}>
      <div className="modal combatant-details" onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        <header className="row char-title">
          <AssetImage id={x.portrait} fallback={initials(x.name)} size={72} className="token" />
          <div>
            <h2>{x.name}</h2>
            <p className="dim">
              {x.summoned ? 'Summoned ally' : x.side === 'enemy' ? 'Enemy' : 'Ally'}
              {x.archetype && ` · ${ARCHETYPE_WORDS[x.archetype] ?? x.archetype}`}
              {x.undead && ' · Undead'}
              {x.caster && ' · Caster'}
            </p>
            <p>
              HP {x.hp} / {x.maxHp}
              {x.hp === 0 && <span className="error"> · down</span>}
            </p>
          </div>
        </header>
        <ResourceMeters actor={x} />
        <p className="stat-line">
          <span className="stat-chip">
            <span className="dim">Defense</span> {effectiveDefense(x)}
          </span>
          <span className="stat-chip">
            <span className="dim">Armour</span> {armour.physical}
          </span>
          <span className="stat-chip">
            <span className="dim">Magic armour</span> {armour.magic}
          </span>
          <span className="stat-chip">
            <span className="dim">Movement</span> {effectiveMovement(x)}
          </span>
          <span className="stat-chip">
            <span className="dim">Initiative</span> {x.initiative}
          </span>
        </p>
        <table className="sheet-stats">
          <tbody>
            {STAT_NAMES.map((s) => (
              <tr key={s}>
                <th scope="row">{STAT_FULL[s]}</th>
                <td>{stats[s]}</td>
                <td className="dim">{formatModifier(statModifier(stats[s]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Attack</h3>
        <p>
          <strong>{a.name}</strong>{' '}
          <span className="dim">
            · {a.profile.kind}, {a.range === 0 ? 'melee' : `range ${a.range}`} · graze {a.profile.graze}, hit {a.profile.hit}
            {x.critThreshold < 20 && ` · crits on ${x.critThreshold}+`}
          </span>
        </p>
        {abilities.length > 0 && (
          <>
            <h3>Abilities</h3>
            <ul className="injury-list">
              {abilities.map((ab) => (
                <li key={ab.id}>
                  <strong>{ab.name}</strong>
                  {(x.cooldowns[ab.id] ?? 0) > 0 && <span className="dim"> · ready in {x.cooldowns[ab.id]}</span>}
                  <br />
                  <span className="dim">{ab.description}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {(x.statuses.length > 0 || x.buffs.length > 0 || x.defending) && (
          <>
            <h3>Conditions</h3>
            <ul className="injury-list">
              {x.defending && <li>Defending: +2 Defense until its next turn</li>}
              {x.statuses.map((st) => (
                <li key={st.kind}>
                  {STATUS_WORDS[st.kind] ?? st.kind}
                  {st.amount ? (st.kind === 'warded' ? ` (${st.amount} left)` : ` (${st.amount} a turn)`) : ''}
                  <span className="dim">
                    {' '}
                    · {st.rounds} turn{st.rounds === 1 ? '' : 's'} left
                  </span>
                </li>
              ))}
              {x.buffs.map((b, i) => (
                <li key={`${b.source}-${i}`}>
                  {b.source}:{' '}
                  {b.effects
                    .map((e) =>
                      e.type === 'stat'
                        ? `${e.amount >= 0 ? '+' : ''}${e.amount} ${STAT_FULL[e.stat]}`
                        : 'amount' in e
                          ? `${e.amount >= 0 ? '+' : ''}${e.amount} ${e.type}`
                          : e.type,
                    )
                    .join(', ')}
                  <span className="dim">{b.roundsLeft === null ? ' · all fight' : ` · ${b.roundsLeft} round${b.roundsLeft === 1 ? '' : 's'} left`}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="row">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
