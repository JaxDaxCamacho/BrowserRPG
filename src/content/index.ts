import { validateDraft, type DialogueDefinition, type MercDraft, type RaceDefinition } from '../engine';
import greywaterFord from './adventures/greywater-ford.json';
import classesJson from './classes.json';
import premadesJson from './premades.json';
import racesJson from './races.json';
import {
  adventureSchema,
  type AdventureDefinition,
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

/** Adventures are one file each; add new ones to this list. */
export const ADVENTURES: AdventureDefinition[] = parseList(adventureSchema, [greywaterFord], 'adventure');
export const getAdventure = byId(ADVENTURES, 'adventure');

export function getDialogue(adventureId: string, dialogueId: string): DialogueDefinition {
  const dialogue = getAdventure(adventureId).dialogues.find((d) => d.id === dialogueId);
  if (!dialogue) throw new Error(`Adventure "${adventureId}" has no dialogue "${dialogueId}".`);
  return dialogue;
}

// Dialogue conditions must name classes and races that exist.
for (const adventure of ADVENTURES) {
  for (const dialogue of adventure.dialogues) {
    for (const option of dialogue.nodes.flatMap((n) => n.options)) {
      for (const condition of option.requires ?? []) {
        if (condition.type === 'partyHasClass') getClass(condition.classId);
        if (condition.type === 'partyHasRace') getRace(condition.raceId);
      }
    }
  }
}

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
