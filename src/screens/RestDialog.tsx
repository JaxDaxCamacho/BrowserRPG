import { useState } from 'react';
import { getItem } from '../content';
import { healingKitsHeld, longRest, restBlocker } from '../engine';
import { useGameStore } from '../state/store';
import { Token } from './MercCard';

/** Making camp: once per dungeon level, recover HP and spend healing kits on injuries. */
export function RestDialog({ onClose }: { onClose: () => void }) {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const [cure, setCure] = useState<{ mercId: string; injuryId: string }[]>([]);
  const kits = healingKitsHeld(game, getItem);
  const blocker = restBlocker(game);
  const chosen = (mercId: string, injuryId: string) => cure.some((c) => c.mercId === mercId && c.injuryId === injuryId);
  const injured = game.party.filter((m) => !m.dead && m.injuries.length > 0);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Make camp" onClick={onClose}>
      <div className="modal rest-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Make camp</h2>
        {blocker ? (
          <p>{blocker}</p>
        ) : (
          <>
            <p>
              A long rest restores everyone's hit points and gets the fallen back on their feet. You can rest once on each level of a dungeon.
            </p>
            <p>
              Healing kits: <strong>{kits - cure.length}</strong> of {kits} left to use. Each cures one injury.
            </p>
            {injured.length === 0 ? (
              <p className="dim">No one is injured.</p>
            ) : (
              <ul className="rest-list">
                {injured.map((m) => (
                  <li key={m.id}>
                    <span className="row">
                      <Token name={m.name} portrait={m.portrait} size={32} />
                      <strong>{m.name}</strong>
                    </span>
                    {m.injuries.map((i) => (
                      <label key={i.id} className="form-check">
                        <input
                          type="checkbox"
                          checked={chosen(m.id, i.id)}
                          disabled={!chosen(m.id, i.id) && cure.length >= kits}
                          onChange={(e) =>
                            setCure((c) =>
                              e.target.checked ? [...c, { mercId: m.id, injuryId: i.id }] : c.filter((x) => !(x.mercId === m.id && x.injuryId === i.id)),
                            )
                          }
                        />
                        Treat {i.name.toLowerCase()}
                      </label>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={!!blocker}
            onClick={() => {
              apply((g) => longRest(g, { cure }, getItem));
              onClose();
            }}
          >
            Rest
          </button>
          <button type="button" onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
