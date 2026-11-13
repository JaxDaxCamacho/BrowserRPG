import { useEffect, useMemo, useState } from 'react';
import { CLASSES, getClass, getItem, getRace, ITEMS, portraitsFor, PREMADES, RACES, type Gender } from '../content';
import {
  canWearArmour,
  CREATION_POINTS,
  createStartingStats,
  creationPointsSpent,
  formatCoins,
  MAX_NAME_LENGTH,
  mercSheet,
  raceCanWield,
  STARTING_AMMO,
  STARTING_PURSE,
  STARTING_STAT,
  STAT_NAMES,
  statModifier,
  validateDraft,
  type ItemDefinition,
  type Loadout,
  type MercDraft,
  type RaceDefinition,
  type RacePassive,
  type StatName,
  type Stats,
  type WeaponItem,
} from '../engine';
import { AssetImage, assetUrl } from './assets';
import { formatModifier, STAT_LABELS, Token } from './MercCard';

const STAT_FULL_NAMES: Record<StatName, string> = {
  strength: 'Strength',
  agility: 'Agility',
  toughness: 'Toughness',
  intellect: 'Intellect',
  spirit: 'Spirit',
  charisma: 'Charisma',
};

export function describePassive(passive: RacePassive): string {
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

/** One line describing what an item does, for the gear pickers. */
export function describeItem(item: ItemDefinition): string {
  switch (item.kind) {
    case 'weapon': {
      const reach = item.range === 0 ? 'melee' : `range ${item.range}`;
      return `${item.style}, graze ${item.attack.graze} / hit ${item.attack.hit}, ${item.hands}-handed, ${reach}`;
    }
    case 'armour':
      return `${item.weight}, Defense ${formatModifier(item.defense)}, armour ${item.physicalArmour}${item.magicArmour ? `, magic ${item.magicArmour}` : ''}`;
    case 'shield':
      return `Defense +${item.defense}`;
    case 'ammo':
      return `${item.ammoType}s${item.bonusHit ? `, hit +${item.bonusHit}` : ''}${item.extraDamage ? `, +${item.extraDamage.amount} ${item.extraDamage.damageType}` : ''}`;
    case 'trinket':
    case 'potion':
    case 'kit':
      return item.description ?? '';
  }
}

const STARTERS = ITEMS.filter((i) => i.starter);

function hasGiantGrip(race: RaceDefinition) {
  return race.passives.some((p) => p.type === 'giantGrip');
}

/** The starter items a merc of this race and class could put in each slot. */
function slotOptions(race: RaceDefinition, classId: string, loadout: Loadout) {
  const cls = getClass(classId);
  const main = loadout.mainHand ? getItem(loadout.mainHand) : null;
  const mainTwoHanded = main?.kind === 'weapon' && main.hands === 2 && !hasGiantGrip(race);
  const launcher = main?.kind === 'weapon' && main.ammo ? main : null;
  return {
    mainHand: STARTERS.filter((i) => i.kind === 'weapon' && raceCanWield(race, i.hands)),
    offHand: mainTwoHanded
      ? []
      : STARTERS.filter(
          (i) => i.kind === 'shield' || (i.kind === 'weapon' && i.hands === 1 && raceCanWield(race, 1)),
        ),
    body: STARTERS.filter((i) => i.kind === 'armour' && i.slot === 'body' && canWearArmour(cls.armour, i.weight)),
    ammo: launcher ? STARTERS.filter((i) => i.kind === 'ammo' && i.ammoType === launcher.ammo) : [],
  };
}

/** Drops anything no longer allowed and fills ammunition for a ranged weapon. */
function tidyLoadout(race: RaceDefinition, classId: string, loadout: Loadout): Loadout {
  const next: Loadout = { ...loadout };
  for (let pass = 0; pass < 2; pass++) {
    const options = slotOptions(race, classId, next);
    for (const slot of ['mainHand', 'offHand', 'body', 'ammo'] as const) {
      if (next[slot] && !options[slot].some((i) => i.id === next[slot])) delete next[slot];
    }
    if (!next.ammo && options.ammo[0]) next.ammo = options.ammo[0].id;
  }
  return next;
}

/** A sensible starting kit for a class: the first pre-built merc's, adjusted for the race. */
function defaultLoadout(race: RaceDefinition, classId: string): Loadout {
  const template = PREMADES.find((p) => p.classId === classId)?.loadout ?? {};
  const tidy = tidyLoadout(race, classId, template);
  if (!tidy.mainHand) {
    const firstWeapon = slotOptions(race, classId, {}).mainHand[0];
    if (firstWeapon) return tidyLoadout(race, classId, { ...tidy, mainHand: firstWeapon.id });
  }
  return tidy;
}

interface GearPickerProps {
  label: string;
  value?: string;
  options: ItemDefinition[];
  allowNone: boolean;
  onChange: (id: string | undefined) => void;
}

function GearPicker({ label, value, options, allowNone, onChange }: GearPickerProps) {
  const current = value ? getItem(value) : undefined;
  return (
    <label className="gear-picker">
      <AssetImage id={current?.icon} fallback={current ? current.name[0] : '–'} size={40} alt={current?.name} />
      <span className="field">
        <span>{label}</span>
        <select value={value ?? ''} disabled={options.length === 0} onChange={(e) => onChange(e.target.value || undefined)}>
          {(allowNone || !value) && <option value="">{options.length === 0 ? 'Not available' : 'None'}</option>}
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {current && <span className="dim note">{describeItem(current)}</span>}
      </span>
    </label>
  );
}

interface Props {
  disabled: boolean;
  onAdd: (draft: MercDraft) => void;
}

/** The custom merc form: name, portrait, race, class, 12 stat points and starting gear. */
export function MercBuilder({ disabled, onAdd }: Props) {
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('female');
  const [chosenPortrait, setChosenPortrait] = useState<string | null>(null);
  const [raceId, setRaceId] = useState(RACES[0]!.id);
  const [classId, setClassId] = useState(CLASSES[0]!.id);
  const [baseStats, setBaseStats] = useState<Stats>(createStartingStats);
  const [raceChoices, setRaceChoices] = useState<StatName[]>([]);
  const [loadout, setLoadout] = useState<Loadout>(() => defaultLoadout(RACES[0]!, CLASSES[0]!.id));

  const race = getRace(raceId);
  const cls = getClass(classId);
  // Only faces that suit the chosen gender and race; keep the pick while it still fits.
  const portraits = useMemo(() => portraitsFor(gender, raceId).map((p) => p.asset), [gender, raceId]);
  const portrait = chosenPortrait && portraits.includes(chosenPortrait) ? chosenPortrait : portraits[0];
  const draft: MercDraft = { name, gender, raceId, classId, baseStats, raceChoices, loadout, ...(portrait ? { portrait } : {}) };

  // Load every choice up front so picking one shows it straight away.
  useEffect(() => {
    for (const id of portraits) {
      const img = new Image();
      img.src = assetUrl(id);
    }
  }, [portraits]);
  const sheet = mercSheet(draft, race, cls, getItem);
  const pointsLeft = CREATION_POINTS - creationPointsSpent(baseStats);
  const problems = validateDraft(draft, race, { armourProficiency: cls.armour, getItem });
  const choicesNeeded = race.statChoices?.count ?? 0;
  const options = slotOptions(race, classId, loadout);

  const changeStat = (stat: StatName, by: number) => setBaseStats((s) => ({ ...s, [stat]: s[stat] + by }));

  const toggleChoice = (stat: StatName) =>
    setRaceChoices((current) => {
      if (current.includes(stat)) return current.filter((s) => s !== stat);
      return current.length < choicesNeeded ? [...current, stat] : current;
    });

  const setSlot = (slot: keyof Loadout, id: string | undefined) =>
    setLoadout((current) => tidyLoadout(race, classId, { ...current, [slot]: id }));

  const add = () => {
    onAdd(draft);
    setName('');
    setBaseStats(createStartingStats());
    setRaceChoices([]);
  };

  const main = loadout.mainHand ? getItem(loadout.mainHand) : null;
  const launcher = main?.kind === 'weapon' && main.ammo ? (main as WeaponItem) : null;

  return (
    <div className="builder">
      <div className="row builder-identity">
        <Token name={name || '?'} portrait={portrait} size={72} />
        <label className="field">
          <span>Name</span>
          <input type="text" value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field gender-field" role="radiogroup" aria-label="Gender">
          <span>Gender</span>
          <span className="row">
            {(['female', 'male'] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={gender === g} className={gender === g ? 'active' : ''} onClick={() => setGender(g)}>
                {g === 'female' ? 'Female' : 'Male'}
              </button>
            ))}
          </span>
        </div>
      </div>
      <div className="portrait-grid" role="radiogroup" aria-label="Portrait">
        {portraits.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={id === portrait}
            className={`portrait-choice${id === portrait ? ' active' : ''}`}
            onClick={() => setChosenPortrait(id)}
          >
            <AssetImage id={id} size={52} alt="" fallback="?" />
          </button>
        ))}
      </div>

      <div className="row">
        <label className="field">
          <span>Race</span>
          <select
            value={raceId}
            onChange={(e) => {
              const nextRace = getRace(e.target.value);
              setRaceId(nextRace.id);
              setRaceChoices([]);
              setLoadout((current) => {
                const tidy = tidyLoadout(nextRace, classId, current);
                return tidy.mainHand ? tidy : defaultLoadout(nextRace, classId);
              });
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
          <select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setLoadout(defaultLoadout(race, e.target.value));
            }}
          >
            {CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="note dim builder-notes">
        <span className="row">
          <AssetImage id={race.icon} fallback="" size={32} alt={race.name} />
          <span>
            <strong>{race.name}:</strong> {race.passives.map(describePassive).join('. ')}.
          </span>
        </span>
        <span className="row">
          <AssetImage id={cls.icon} fallback="" size={32} alt={cls.name} />
          <span>
            <strong>{cls.name}:</strong> {cls.role}. Key stats: {cls.keyStats.map((s) => STAT_FULL_NAMES[s]).join(', ')}.
            Armour: {cls.armour === 'none' ? 'clothing only' : `up to ${cls.armour}`}.
          </span>
        </span>
      </div>

      <h3 className="builder-heading">Stats</h3>
      <p className="points">
        Stat points left: <strong>{pointsLeft}</strong> of {CREATION_POINTS}
      </p>

      <table className="stat-table">
        <tbody>
          {STAT_NAMES.map((stat) => {
            const raceBonus = finalBonus(sheet.stats[stat], baseStats[stat]);
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

      <h3 className="builder-heading">Starting gear</h3>
      <div className="gear-pickers">
        <GearPicker
          label="Main hand"
          value={loadout.mainHand}
          options={options.mainHand}
          allowNone={false}
          onChange={(id) => setSlot('mainHand', id)}
        />
        <GearPicker
          label="Off hand"
          value={loadout.offHand}
          options={options.offHand}
          allowNone
          onChange={(id) => setSlot('offHand', id)}
        />
        <GearPicker label="Armour" value={loadout.body} options={options.body} allowNone onChange={(id) => setSlot('body', id)} />
        {launcher && (
          <GearPicker
            label={`Ammunition (${STARTING_AMMO})`}
            value={loadout.ammo}
            options={options.ammo}
            allowNone={false}
            onChange={(id) => setSlot('ammo', id)}
          />
        )}
      </div>

      <p className="stat-line">
        <span className="stat-chip">
          <span className="dim">HP</span> {sheet.maxHp}
        </span>
        <span className="stat-chip">
          <span className="dim">Defense</span> {sheet.defense}
        </span>
        <span className="stat-chip">
          <span className="dim">Armour</span> {sheet.armour.physical}
          {sheet.armour.magic > 0 && ` / magic ${sheet.armour.magic}`}
        </span>
        <span className="stat-chip">
          <span className="dim">Purse</span> {formatCoins(STARTING_PURSE)}
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

/** The part of a stat that comes from race and gear rather than spent points. */
function finalBonus(final: number, base: number): number {
  return final - base;
}
