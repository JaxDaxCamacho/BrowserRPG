import { useState } from 'react';
import {
  MAX_LEVEL,
  spendStatPoints,
  STAT_NAMES,
  trainingBlocker,
  unspentStatPoints,
  unspentTalentPoints,
  xpProgress,
  type Merc,
  type StatName,
} from '../engine';
import { dialogueContext } from '../state/context';
import { useGameStore } from '../state/store';
import { Token } from './MercCard';
import { TalentTreeView } from './TalentTreeView';

const STAT_SHORT: Record<StatName, string> = {
  strength: 'STR',
  agility: 'AGI',
  toughness: 'TOU',
  intellect: 'INT',
  spirit: 'SPI',
  charisma: 'CHA',
};

const STAT_FULL: Record<StatName, string> = {
  strength: 'Strength',
  agility: 'Agility',
  toughness: 'Toughness',
  intellect: 'Intellect',
  spirit: 'Spirit',
  charisma: 'Charisma',
};

/** XP towards the next level, as a bar with numbers. */
export function XpBar({ merc }: { merc: Pick<Merc, 'level' | 'xp'> }) {
  const p = xpProgress(merc);
  if (p.next === null) return <span className="dim xp-text">Level {MAX_LEVEL}: the most a merc can reach.</span>;
  return (
    <span className="xp-meter">
      <span className="xp-bar" aria-label={`${p.into} of ${p.needed} XP to level ${merc.level + 1}`}>
        <span style={{ width: `${Math.min(100, (p.into / p.needed) * 100)}%` }} />
      </span>
      <span className="dim xp-text">
        {merc.xp} / {p.next} XP to level {merc.level + 1}
      </span>
    </span>
  );
}

/** Mercs with points waiting to be spent. */
export function mercsWithPoints(party: Merc[]): Merc[] {
  return party.filter((m) => !m.dead && (unspentStatPoints(m) > 0 || unspentTalentPoints(m) > 0));
}

/**
 * Spending the points that levels bring. Stat picks are held here until confirmed,
 * so a mis-click can be taken back; once confirmed they are permanent.
 */
export function TrainingPanel() {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const [picks, setPicks] = useState<Record<string, StatName[]>>({});
  const [openTree, setOpenTree] = useState<string | null>(null);
  const blocker = trainingBlocker(game);
  const living = game.party.filter((m) => !m.dead);
  const pending = Object.values(picks).some((p) => p.length > 0);

  const pick = (merc: Merc, stat: StatName) =>
    setPicks((p) => {
      const mine = p[merc.id] ?? [];
      return mine.length < unspentStatPoints(merc) ? { ...p, [merc.id]: [...mine, stat] } : p;
    });
  const unpick = (merc: Merc, stat: StatName) =>
    setPicks((p) => {
      const mine = [...(p[merc.id] ?? [])];
      const i = mine.lastIndexOf(stat);
      if (i >= 0) mine.splice(i, 1);
      return { ...p, [merc.id]: mine };
    });
  const confirm = () => {
    apply((g) => Object.entries(picks).reduce((s, [mercId, stats]) => (stats.length ? spendStatPoints(s, mercId, stats) : s), g));
    setPicks({});
  };

  return (
    <div className="training">
      {blocker && <p className="dim">{blocker}</p>}
      <ul className="training-list">
        {living.map((m) => {
          const mine = picks[m.id] ?? [];
          const statLeft = unspentStatPoints(m) - mine.length;
          const talentLeft = unspentTalentPoints(m);
          const stats = dialogueContext.statsOf(m);
          return (
            <li key={m.id} className="training-merc">
              <div className="row">
                <Token name={m.name} portrait={m.portrait} size={40} />
                <div className="training-who">
                  <strong>{m.name}</strong> <span className="dim">· level {m.level}</span>
                  <XpBar merc={m} />
                </div>
              </div>
              {unspentStatPoints(m) > 0 && (
                <>
                  <p className="training-points">
                    <strong>{statLeft}</strong> stat point{statLeft === 1 ? '' : 's'} to spend
                  </p>
                  <div className="training-stats">
                    {STAT_NAMES.map((s) => {
                      const added = mine.filter((x) => x === s).length;
                      return (
                        <span key={s} className={`training-stat${added ? ' raised' : ''}`} title={STAT_FULL[s]}>
                          <span className="dim">{STAT_SHORT[s]}</span>
                          <span>{stats[s] + added}</span>
                          <span className="row">
                            <button
                              type="button"
                              aria-label={`Take back a point from ${STAT_FULL[s]}`}
                              disabled={!!blocker || added === 0}
                              onClick={() => unpick(m, s)}
                            >
                              −
                            </button>
                            <button
                              type="button"
                              aria-label={`Raise ${STAT_FULL[s]}`}
                              disabled={!!blocker || statLeft === 0}
                              onClick={() => pick(m, s)}
                            >
                              +
                            </button>
                          </span>
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
              {(talentLeft > 0 || Object.keys(m.talents).length > 0) && (
                <div className="training-talents">
                  <button type="button" className={talentLeft > 0 ? 'primary' : ''} onClick={() => setOpenTree((o) => (o === m.id ? null : m.id))}>
                    {openTree === m.id ? 'Hide talents' : `Talents${talentLeft > 0 ? ` (${talentLeft} to spend)` : ''}`}
                  </button>
                  {openTree === m.id && <TalentTreeView merc={m} />}
                </div>
              )}
              {unspentStatPoints(m) === 0 && talentLeft === 0 && <p className="dim note">No points to spend.</p>}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button type="button" className="primary" disabled={!pending || !!blocker} onClick={confirm}>
          Confirm training
        </button>
        <button type="button" disabled={!pending} onClick={() => setPicks({})}>
          Undo picks
        </button>
      </div>
    </div>
  );
}

/** The training panel in its own window, for use in town. */
export function TrainingDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Train" onClick={onClose}>
      <div className="modal training-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Train</h2>
        <p className="dim">Back in town, your mercenaries can put what they learned to use. Stat points and talents are permanent once confirmed.</p>
        <TrainingPanel />
        <div className="row">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
