import { validateDraft, type MercDraft, type RaceDefinition } from '../engine';
import classesJson from './classes.json';
import premadesJson from './premades.json';
import racesJson from './races.json';
import {
  classSchema,
  parseList,
  premadeSchema,
  raceSchema,
  weaponSchema,
  type ClassDefinition,
  type PremadeDefinition,
  type WeaponDefinition,
} from './schema';
import weaponsJson from './weapons.json';

/** All game data, validated once when this module first loads. */
export const CLASSES: ClassDefinition[] = parseList(classSchema, classesJson, 'class');
export const RACES: RaceDefinition[] = parseList(raceSchema, racesJson, 'race');
export const WEAPONS: WeaponDefinition[] = parseList(weaponSchema, weaponsJson, 'weapon');
export const PREMADES: PremadeDefinition[] = parseList(premadeSchema, premadesJson, 'pre-built merc');

function byId<T extends { id: string }>(list: T[], what: string) {
  const map = new Map(list.map((item) => [item.id, item]));
  return (id: string): T => {
    const found = map.get(id);
    if (!found) throw new Error(`Unknown ${what}: "${id}"`);
    return found;
  };
}

export const getClass = byId(CLASSES, 'class');
export const getRace = byId(RACES, 'race');
export const getWeapon = byId(WEAPONS, 'weapon');

export function premadeToDraft(premade: PremadeDefinition): MercDraft {
  return {
    name: premade.name,
    raceId: premade.raceId,
    classId: premade.classId,
    baseStats: premade.baseStats,
    raceChoices: premade.raceChoices,
    premadeId: premade.id,
  };
}

// Pre-built mercs must follow the same rules as ones the player builds.
for (const premade of PREMADES) {
  getClass(premade.classId);
  const problems = validateDraft(premadeToDraft(premade), getRace(premade.raceId));
  if (problems.length > 0) {
    throw new Error(`Invalid pre-built merc "${premade.id}": ${problems.join(' ')}`);
  }
}

export * from './schema';
