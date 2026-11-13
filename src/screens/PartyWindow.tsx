import { useEffect, useState, type DragEvent } from 'react';
import { getClass, getItem, getRace, getTalentTree } from '../content';
import {
  arrangeParty,
  equipFromPack,
  formatCoins,
  giveStack,
  itemSize,
  moveInPack,
  naturalSlot,
  PACK_HEIGHT,
  PACK_WIDTH,
  STAT_NAMES,
  statModifier,
  unequip,
  type EquipSlot,
  type GearRules,
  type GameState,
  type Merc,
  unspentStatPoints,
  unspentTalentPoints,
} from '../engine';
import { currentHp, sheetOf } from '../state/context';
import { useGameStore } from '../state/store';
import { AssetImage } from './assets';
import { describeItem } from './MercBuilder';
import { formatModifier, initials, Token } from './MercCard';
import { XpBar } from './TrainingPanel';

const RULES: GearRules = {
  getItem,
  raceOf: (m) => getRace(m.raceId),
  proficiencyOf: (m) => getClass(m.classId).armour,
};

/** Equipment slots laid out around the figure: [slot, label, grid column, grid row]. */
const SLOTS: [EquipSlot, string, number, number][] = [
  ['head', 'Head', 2, 1],
  ['neck', 'Neck', 3, 1],
  ['mainHand', 'Main hand', 1, 2],
  ['body', 'Body', 2, 2],
  ['offHand', 'Off hand', 3, 2],
  ['hands', 'Hands', 1, 3],
  ['ring1', 'Ring', 2, 3],
  ['ring2', 'Ring', 3, 3],
  ['feet', 'Feet', 2, 4],
  ['ammo', 'Ammo', 3, 4],
];

const STAT_FULL: Record<string, string> = {
  strength: 'Strength',
  agility: 'Agility',
  toughness: 'Toughness',
  intellect: 'Intellect',
  spirit: 'Spirit',
  charisma: 'Charisma',
};

type Picked = { kind: 'pack'; index: number } | { kind: 'slot'; slot: EquipSlot } | null;

const CELL = 46;

/**
 * The party's character sheets and gear. `readOnly` is for looking during a
 * fight: the fight works on its own copy of each merc, so gear cannot change mid-fight.
 */
export function PartyWindow({ onClose, initialMercId, readOnly = false }: { onClose: () => void; initialMercId?: string; readOnly?: boolean }) {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const [mercId, setMercId] = useState(
    () => (initialMercId && game.party.some((m) => m.id === initialMercId) ? initialMercId : undefined) ?? game.party.find((m) => !m.dead)?.id ?? game.party[0]!.id,
  );
  const [picked, setPicked] = useState<Picked>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Older saves and freshly looted items may not have a place in the grid yet.
  useEffect(() => {
    if (!readOnly) apply((g) => arrangeParty(g, getItem));
  }, [apply, readOnly]);

  const merc = game.party.find((m) => m.id === mercId)!;
  const race = getRace(merc.raceId);
  const cls = getClass(merc.classId);
  const sheet = sheetOf(merc);
  const hp = currentHp(merc);
  const baseStats = sheetOf({ ...merc, injuries: [] }).stats;
  const tree = getTalentTree(merc.classId);
  const learned = (tree?.branches ?? []).flatMap((b) =>
    b.talents.filter((t) => (merc.talents[t.id] ?? 0) > 0).map((t) => ({ talent: t, rank: merc.talents[t.id]!, branch: b.name })),
  );

  /** Runs a change, showing why if it is refused. */
  const tryApply = (change: (g: GameState) => GameState) => {
    if (readOnly) {
      setMessage('Gear cannot be changed in the middle of a fight.');
      setPicked(null);
      return;
    }
    try {
      apply(change);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setPicked(null);
  };

  const equipPicked = (slot: EquipSlot) => {
    if (picked?.kind === 'pack') tryApply((g) => equipFromPack(g, mercId, picked.index, slot, RULES));
    else setPicked(merc.equipment[slot] ? { kind: 'slot', slot } : null);
  };

  const dropOnCell = (x: number, y: number) => {
    if (picked?.kind === 'pack') tryApply((g) => moveInPack(g, mercId, picked.index, x, y, getItem));
    else if (picked?.kind === 'slot') tryApply((g) => unequip(g, mercId, picked.slot, RULES, { x, y }));
  };

  const giveTo = (to: Merc) => {
    if (picked?.kind === 'pack' && to.id !== mercId) tryApply((g) => giveStack(g, mercId, picked.index, to.id, getItem));
    else {
      setMercId(to.id);
      setPicked(null);
    }
  };

  // Drag and drop carries the same "picked" item as a click does.
  const dragStart = (p: NonNullable<Picked>) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', 'item');
    setPicked(p);
  };
  const allowDrop = (e: DragEvent) => e.preventDefault();

  const pickedItem =
    picked?.kind === 'pack'
      ? getItem(merc.inventory[picked.index]!.itemId)
      : picked?.kind === 'slot' && merc.equipment[picked.slot]
        ? getItem(merc.equipment[picked.slot]!)
        : null;

  return (
    <div className="modal-backdrop party-backdrop" role="dialog" aria-modal="true" aria-label="Party">
      <div className="party-window">
        <header className="party-header">
          <ul className="party-tabs" aria-label="Mercenaries">
            {game.party.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`party-tab${m.id === mercId ? ' active' : ''}${m.dead ? ' dead' : ''}`}
                  onClick={() => giveTo(m)}
                  onDragOver={allowDrop}
                  onDrop={() => giveTo(m)}
                  title={picked?.kind === 'pack' && m.id !== mercId ? `Give to ${m.name}` : m.name}
                >
                  <Token name={m.name} portrait={m.portrait} size={40} />
                  <span>{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="party-body">
          <section className="char-sheet" aria-label="Character sheet">
            <div className="row char-title">
              <Token name={merc.name} portrait={merc.portrait} size={64} />
              <div>
                <h2>{merc.name}</h2>
                <p className="dim">
                  {race.name} {cls.name} · level {merc.level}
                </p>
                <XpBar merc={merc} />
                {merc.dead ? (
                  <p className="error">Dead</p>
                ) : (
                  <p>
                    HP {hp.current} / {hp.max}
                    {merc.down && <span className="error"> · down</span>}
                  </p>
                )}
              </div>
            </div>
            <table className="sheet-stats">
              <tbody>
                {STAT_NAMES.map((s) => {
                  const lowered = sheet.stats[s] < baseStats[s];
                  return (
                    <tr key={s} className={lowered ? 'injured' : ''}>
                      <th scope="row">{STAT_FULL[s]}</th>
                      <td>{sheet.stats[s]}</td>
                      <td className="dim">{formatModifier(statModifier(sheet.stats[s]))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="stat-line">
              <span className="stat-chip">
                <span className="dim">Defense</span> {sheet.defense}
              </span>
              <span className="stat-chip">
                <span className="dim">Armour</span> {sheet.armour.physical}
              </span>
              <span className="stat-chip">
                <span className="dim">Magic armour</span> {sheet.armour.magic}
              </span>
              <span className="stat-chip">
                <span className="dim">Movement</span> {Math.max(1, (race.movement ?? 3) + statModifier(sheet.stats.agility))}
              </span>
              <span className="stat-chip">
                <span className="dim">Purse</span> {formatCoins(merc.purse)}
              </span>
            </p>
            <h3>Injuries</h3>
            {merc.injuries.length === 0 ? (
              <p className="dim">None.</p>
            ) : (
              <ul className="injury-list">
                {merc.injuries.map((i) => (
                  <li key={i.id}>
                    <strong>{i.name}</strong>{' '}
                    <span className="dim">
                      {Object.entries(i.statChanges)
                        .map(([s, a]) => `${a} ${STAT_FULL[s]}`)
                        .join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="dim note">
              {merc.injuries.length} of 3 injuries. A fourth is fatal. Heal them with a healing kit during a long rest.
            </p>
            <h3>Talents</h3>
            {learned.length === 0 ? (
              <p className="dim">None yet.</p>
            ) : (
              <ul className="injury-list">
                {learned.map(({ talent, rank, branch }) => (
                  <li key={talent.id}>
                    <strong>{talent.name}</strong>
                    {talent.maxRanks > 1 && ` ${rank}/${talent.maxRanks}`} <span className="dim">· {branch}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="dim note">
              {unspentTalentPoints(merc) > 0 || unspentStatPoints(merc) > 0
                ? `${unspentStatPoints(merc)} stat and ${unspentTalentPoints(merc)} talent points unspent. Spend them at camp or in town.`
                : 'No unspent points.'}
            </p>
          </section>

          <section className="gear-panel" aria-label="Equipment and pack">
            <div className="equip-grid">
              {SLOTS.map(([slot, label, col, row]) => {
                const id = merc.equipment[slot];
                const item = id ? getItem(id) : null;
                const accepts = picked?.kind === 'pack' && pickedItem && naturalSlot(pickedItem, merc) !== null;
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`equip-slot${picked?.kind === 'slot' && picked.slot === slot ? ' picked' : ''}${accepts ? ' can-drop' : ''}`}
                    style={{ gridColumn: col, gridRow: row }}
                    onClick={() => equipPicked(slot)}
                    onDoubleClick={() => item && tryApply((g) => unequip(g, mercId, slot, RULES))}
                    onDragOver={allowDrop}
                    onDrop={() => equipPicked(slot)}
                    draggable={!!item}
                    onDragStart={item ? dragStart({ kind: 'slot', slot }) : undefined}
                    title={item ? `${item.name}: ${describeItem(item)}` : label}
                  >
                    {item ? <AssetImage id={item.icon} fallback={initials(item.name)} size={44} alt={item.name} /> : <span className="dim">{label}</span>}
                  </button>
                );
              })}
            </div>

            <div
              className="pack-grid"
              style={{ gridTemplateColumns: `repeat(${PACK_WIDTH}, ${CELL}px)`, gridTemplateRows: `repeat(${PACK_HEIGHT}, ${CELL}px)` }}
              aria-label="Pack"
            >
              {Array.from({ length: PACK_WIDTH * PACK_HEIGHT }, (_, i) => {
                const x = i % PACK_WIDTH;
                const y = Math.floor(i / PACK_WIDTH);
                return (
                  <button
                    key={`cell-${x}-${y}`}
                    type="button"
                    className="pack-cell"
                    style={{ gridColumn: x + 1, gridRow: y + 1 }}
                    aria-label={`Pack cell ${x + 1}, ${y + 1}`}
                    onClick={() => dropOnCell(x, y)}
                    onDragOver={allowDrop}
                    onDrop={() => dropOnCell(x, y)}
                  />
                );
              })}
              {merc.inventory.map((s, index) => {
                if (s.x === undefined || s.y === undefined) return null;
                const item = getItem(s.itemId);
                const { w, h } = itemSize(item);
                const isPicked = picked?.kind === 'pack' && picked.index === index;
                const equippedAmmo = merc.equipment.ammo === s.itemId;
                return (
                  <button
                    key={`${s.itemId}-${index}`}
                    type="button"
                    className={`pack-item kind-${item.kind}${isPicked ? ' picked' : ''}`}
                    style={{ gridColumn: `${s.x + 1} / span ${w}`, gridRow: `${s.y + 1} / span ${h}` }}
                    onClick={() => setPicked(isPicked ? null : { kind: 'pack', index })}
                    onDoubleClick={() => {
                      const slot = naturalSlot(item, merc);
                      if (slot) tryApply((g) => equipFromPack(g, mercId, index, slot, RULES));
                    }}
                    draggable
                    onDragStart={dragStart({ kind: 'pack', index })}
                    onDragOver={allowDrop}
                    title={`${item.name}${s.quantity > 1 ? ` ×${s.quantity}` : ''}: ${describeItem(item)}`}
                  >
                    <AssetImage id={item.icon} fallback={initials(item.name)} alt={item.name} style={{ width: '80%', height: '80%' }} />
                    {s.quantity > 1 && <span className="pack-qty">{s.quantity}</span>}
                    {equippedAmmo && <span className="pack-tag">loaded</span>}
                  </button>
                );
              })}
            </div>

            <div className="item-info" aria-live="polite">
              {message ? (
                <p className="error">{message}</p>
              ) : pickedItem ? (
                <p>
                  <strong>{pickedItem.name}</strong> <span className="dim">{describeItem(pickedItem)}</span>
                  <br />
                  <span className="dim note">
                    {picked?.kind === 'pack'
                      ? 'Click a slot to equip, an empty cell to move it, or another merc to hand it over.'
                      : 'Click an empty pack cell to take it off.'}
                  </span>
                </p>
              ) : (
                <p className="dim note">Click an item to pick it up. Double-click to equip or take off. You can also drag.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
