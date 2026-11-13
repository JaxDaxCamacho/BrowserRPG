import { useState } from 'react';
import { getAbility, getTalentTree } from '../content';
import {
  pointsInBranch,
  pointsToOpen,
  spendTalentPoints,
  talentBlocker,
  TIERS,
  trainingBlocker,
  unspentTalentPoints,
  type Merc,
  type TalentDefinition,
} from '../engine';
import { useGameStore } from '../state/store';
import { AssetImage } from './assets';
import { RESOURCE_LABEL } from './ActionBar';

/** A talent's icon: its own, or the icon of the ability it teaches. */
function iconOf(talent: TalentDefinition): string | undefined {
  return talent.icon ?? (talent.abilityId ? getAbility(talent.abilityId).icon : undefined);
}

function abilityLine(talent: TalentDefinition): string | null {
  if (!talent.abilityId) return null;
  const a = getAbility(talent.abilityId);
  const bits = [a.cost && `${a.cost.amount} ${RESOURCE_LABEL[a.cost.resource].name.toLowerCase()}`, a.cooldown && `cooldown ${a.cooldown}`].filter(Boolean);
  return `${a.name}: ${a.description}${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

/**
 * One merc's talent tree: three branches side by side, three tiers each.
 * Clicks add ranks to a pending list; Learn makes them permanent.
 */
export function TalentTreeView({ merc }: { merc: Merc }) {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const [picks, setPicks] = useState<string[]>([]);
  const tree = getTalentTree(merc.classId);
  if (!tree) return <p className="dim note">This class has no talent tree yet.</p>;

  const blocked = trainingBlocker(game);
  // The merc as they would be with the pending picks taken.
  const planned: Merc = { ...merc, talents: { ...merc.talents } };
  for (const id of picks) planned.talents[id] = (planned.talents[id] ?? 0) + 1;
  const left = unspentTalentPoints(planned);

  const add = (id: string) => {
    if (blocked || talentBlocker(planned, tree, id)) return;
    setPicks((p) => [...p, id]);
  };
  const remove = (id: string) =>
    setPicks((p) => {
      const i = p.lastIndexOf(id);
      if (i < 0) return p;
      // Taking back a rank must not leave a later pick standing on a tier it no longer opens.
      const next = [...p.slice(0, i), ...p.slice(i + 1)];
      let check: Merc = { ...merc, talents: { ...merc.talents } };
      for (const x of next) {
        if (talentBlocker(check, tree, x)) return p;
        check = { ...check, talents: { ...check.talents, [x]: (check.talents[x] ?? 0) + 1 } };
      }
      return next;
    });
  const learn = () => {
    apply((g) => spendTalentPoints(g, merc.id, picks, tree));
    setPicks([]);
  };

  return (
    <div className="talent-tree">
      <p className="talent-points">
        <strong>{left}</strong> talent point{left === 1 ? '' : 's'} to spend
        {picks.length > 0 && <span className="dim"> · {picks.length} picked, not learned yet</span>}
      </p>
      <div className="talent-branches">
        {tree.branches.map((branch) => {
          const spent = pointsInBranch(planned.talents, branch);
          return (
            <section key={branch.id} className="talent-branch" aria-label={branch.name}>
              <h4>
                {branch.name} <span className="dim">· {spent}</span>
              </h4>
              <p className="dim talent-branch-text">{branch.description}</p>
              {TIERS.map((tier) => {
                const open = spent >= pointsToOpen(tier);
                return (
                  <div key={tier} className={`talent-tier${open ? '' : ' locked'}`}>
                    <span className="talent-tier-label dim">{tier === 1 ? 'Tier 1' : `Tier ${tier} · ${pointsToOpen(tier)} points`}</span>
                    <div className="talent-row">
                      {branch.talents
                        .filter((t) => t.tier === tier)
                        .map((t) => {
                          const rank = planned.talents[t.id] ?? 0;
                          const pending = picks.filter((x) => x === t.id).length;
                          const why = blocked ?? talentBlocker(planned, tree, t.id);
                          const line = abilityLine(t);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={`talent${rank > 0 ? ' learned' : ''}${pending ? ' pending' : ''}${why ? ' unavailable' : ''}`}
                              onClick={() => add(t.id)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                remove(t.id);
                              }}
                              aria-label={`${t.name}, rank ${rank} of ${t.maxRanks}${why ? `, ${why}` : ''}`}
                            >
                              <AssetImage id={iconOf(t)} fallback={t.name.slice(0, 2)} size={40} className="talent-icon" />
                              <span className="talent-rank">
                                {rank}/{t.maxRanks}
                              </span>
                              {t.abilityId && <span className="talent-active" title="Teaches an ability">✦</span>}
                              <span className="slot-tip" role="tooltip">
                                <strong>{t.name}</strong>
                                <span>{t.description}</span>
                                {line && <span className="dim">{line}</span>}
                                {why && rank < t.maxRanks && <span className="slot-why">{why}</span>}
                                {pending > 0 && <span className="dim">Right-click to take back a pending rank.</span>}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
      <div className="row">
        <button type="button" className="primary" disabled={picks.length === 0 || !!blocked} onClick={learn}>
          Learn talents
        </button>
        <button type="button" disabled={picks.length === 0} onClick={() => setPicks([])}>
          Undo picks
        </button>
      </div>
    </div>
  );
}
