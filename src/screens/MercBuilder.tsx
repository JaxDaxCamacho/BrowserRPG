import { useState } from 'react';
import { CLASSES, getClass, getRace, RACES } from '../content';
import {
  CREATION_POINTS,
  createStartingStats,
  creationPointsSpent,
  MAX_NAME_LENGTH,
  mercSheet,
  STARTING_STAT,
  STAT_NAMES,
  statModifier,
  validateDraft,
  type MercDraft,
  type RacePassive,
  type StatName,
  type Stats,
} from '../engine';
import { formatModifier, STAT_LABELS } from './MercCard';

const STAT_FULL_NAMES: Record<StatName, string> = {
  strength: 'Strength',
  agility: 'Agility',
  toughness: 'Toughness',
  intellect: 'Intellect',
  spirit: 'Spirit',
  charisma: 'Charisma',
};

function describePassive(passive: RacePassive): string {
  switch (passive.type) {
    case 'xpRate':
      return `+${Math.round(passive.bonus * 100)}% XP rate`;
    case 'baseArmour':
      return `Base ${passive.amount} ${passive.armour} armour`;
    case 'critThreshold':
      return `Crits on ${passive.threshold}+ with ${passive.weaponTypes.join(', ')}`;
    case 'bonusHp':
      return `+${passive.amount} HP`;
    case 'giantGrip':
      return 'Wields two-handed weapons in one hand; cannot use one-handed weapons';
    case 'deathSave':
      return `When going down, on a d20 roll of ${passive.difficulty}+ is knocked down instead of dead`;
  }
}

interface Props {
  disabled: boolean;
  onAdd: (draft: MercDraft) => void;
}

/** The custom merc form: name, race, class and 12 stat points to spend. */
export function MercBuilder({ disabled, onAdd }: Props) {
  const [name, setName] = useState('');
  const [raceId, setRaceId] = useState(RACES[0]!.id);
  const [classId, setClassId] = useState(CLASSES[0]!.id);
  const [baseStats, setBaseStats] = useState<Stats>(createStartingStats);
  const [raceChoices, setRaceChoices] = useState<StatName[]>([]);

  const race = getRace(raceId);
  const cls = getClass(classId);
  const draft: MercDraft = { name, raceId, classId, baseStats, raceChoices };
  const sheet = mercSheet(draft, race, cls);
  const pointsLeft = CREATION_POINTS - creationPointsSpent(baseStats);
  const problems = validateDraft(draft, race);
  const choicesNeeded = race.statChoices?.count ?? 0;

  const changeStat = (stat: StatName, by: number) => setBaseStats((s) => ({ ...s, [stat]: s[stat] + by }));

  const toggleChoice = (stat: StatName) =>
    setRaceChoices((current) => {
      if (current.includes(stat)) return current.filter((s) => s !== stat);
      return current.length < choicesNeeded ? [...current, stat] : current;
    });

  const add = () => {
    onAdd(draft);
    setName('');
    setBaseStats(createStartingStats());
    setRaceChoices([]);
  };

  return (
    <div className="builder">
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="row">
        <label className="field">
          <span>Race</span>
          <select
            value={raceId}
            onChange={(e) => {
              setRaceId(e.target.value);
              setRaceChoices([]);
            }}
          >
            {RACES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Class</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            {CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="dim note">
        <strong>{race.name}:</strong> {race.passives.map(describePassive).join('. ')}.
        <br />
        <strong>{cls.name}:</strong> {cls.role}. Key stats: {cls.keyStats.map((s) => STAT_FULL_NAMES[s]).join(', ')}.
      </p>

      <p className="points">
        Stat points left: <strong>{pointsLeft}</strong> of {CREATION_POINTS}
      </p>

      <table className="stat-table">
        <tbody>
          {STAT_NAMES.map((stat) => {
            const raceBonus = sheet.stats[stat] - baseStats[stat];
            return (
              <tr key={stat}>
                <th scope="row">{STAT_FULL_NAMES[stat]}</th>
                <td className="stepper">
                  <button
                    type="button"
                    aria-label={`Lower ${STAT_FULL_NAMES[stat]}`}
                    disabled={baseStats[stat] <= STARTING_STAT}
                    onClick={() => changeStat(stat, -1)}
                  >
                    −
                  </button>
                  <span className="stat-value" aria-label={`${STAT_FULL_NAMES[stat]} value`}>
                    {sheet.stats[stat]}
                  </span>
                  <button
                    type="button"
                    aria-label={`Raise ${STAT_FULL_NAMES[stat]}`}
                    disabled={pointsLeft <= 0}
                    onClick={() => changeStat(stat, 1)}
                  >
                    +
                  </button>
                </td>
                <td className="dim">
                  {formatModifier(statModifier(sheet.stats[stat]))}
                  {raceBonus !== 0 && ` · race ${formatModifier(raceBonus)}`}
                </td>
                {choicesNeeded > 0 && (
                  <td>
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={raceChoices.includes(stat)}
                        disabled={!raceChoices.includes(stat) && raceChoices.length >= choicesNeeded}
                        onChange={() => toggleChoice(stat)}
                      />
                      {formatModifier(race.statChoices?.amount ?? 0)} {STAT_LABELS[stat]}
                    </label>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="stat-line">
        <span className="stat-chip">
          <span className="dim">HP</span> {sheet.maxHp}
        </span>
        <span className="stat-chip">
          <span className="dim">Defense</span> {sheet.defense}
        </span>
      </p>

      {problems.length > 0 && (
        <ul className="problems dim">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <button type="button" disabled={disabled || problems.length > 0} onClick={add}>
        {disabled ? 'Party is full' : 'Add to party'}
      </button>
    </div>
  );
}
