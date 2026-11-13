import type { RaceDefinition } from '../engine';
import classesJson from './classes.json';
import racesJson from './races.json';
import { classSchema, parseList, raceSchema, weaponSchema, type ClassDefinition, type WeaponDefinition } from './schema';
import weaponsJson from './weapons.json';

/** All game data, validated once when this module first loads. */
export const CLASSES: ClassDefinition[] = parseList(classSchema, classesJson, 'class');
export const RACES: RaceDefinition[] = parseList(raceSchema, racesJson, 'race');
export const WEAPONS: WeaponDefinition[] = parseList(weaponSchema, weaponsJson, 'weapon');

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

export * from './schema';
