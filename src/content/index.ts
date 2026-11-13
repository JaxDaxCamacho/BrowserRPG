import type { z } from 'zod';
import {
  validateDraft,
  type AbilityDefinition,
  type DialogueDefinition,
  type ItemDefinition,
  type MercDraft,
  type MonsterDefinition,
  type RaceDefinition,
} from '../engine';
import abilitiesJson from './abilities.json';
import greywaterFord from './adventures/greywater-ford.json';
import classesJson from './classes.json';
import itemsJson from './items.json';
import monstersJson from './monsters.json';
import premadesJson from './premades.json';
import racesJson from './races.json';
import {
  abilitySchema,
  adventureSchema,
  classSchema,
  itemSchema,
  monsterSchema,
  parseList,
  premadeSchema,
  raceSchema,
  type AdventureDefinition,
  type ClassDefinition,
  type PremadeDefinition,
} from './schema';

export interface ContentSet {
  classes: ClassDefinition[];
  races: RaceDefinition[];
  items: ItemDefinition[];
  abilities: AbilityDefinition[];
  monsters: MonsterDefinition[];
  premades: PremadeDefinition[];
  adventures: AdventureDefinition[];
}

export type CollectionKey = Exclude<keyof ContentSet, 'adventures'>;

export interface CollectionInfo {
  key: CollectionKey;
  label: string;
  /** File under src/content that holds this collection. */
  file: string;
  schema: z.ZodType<{ id: string }>;
  /** The field holding the entry's picture. */
  imageField: 'icon' | 'portrait';
}

/** Every collection the content editor can change. */
export const COLLECTIONS: CollectionInfo[] = [
  { key: 'items', label: 'Gear', file: 'items.json', schema: itemSchema, imageField: 'icon' },
  { key: 'abilities', label: 'Abilities', file: 'abilities.json', schema: abilitySchema, imageField: 'icon' },
  { key: 'monsters', label: 'Monsters', file: 'monsters.json', schema: monsterSchema, imageField: 'portrait' },
  { key: 'classes', label: 'Classes', file: 'classes.json', schema: classSchema, imageField: 'icon' },
  { key: 'races', label: 'Races', file: 'races.json', schema: raceSchema, imageField: 'icon' },
  { key: 'premades', label: 'Pre-built mercs', file: 'premades.json', schema: premadeSchema, imageField: 'portrait' },
];

export function parseCollection(key: CollectionKey, data: unknown): { id: string }[] {
  const info = COLLECTIONS.find((c) => c.key === key)!;
  return parseList(info.schema, data, info.label.toLowerCase());
}

function lookup<T extends { id: string }>(list: T[], what: string) {
  const map = new Map(list.map((item) => [item.id, item]));
  return (id: string): T => {
    const found = map.get(id);
    if (!found) throw new Error(`Unknown ${what}: "${id}"`);
    return found;
  };
}

export function premadeToDraft(premade: PremadeDefinition): MercDraft {
  return {
    name: premade.name,
    raceId: premade.raceId,
    classId: premade.classId,
    ...(premade.portrait ? { portrait: premade.portrait } : {}),
    baseStats: premade.baseStats,
    raceChoices: premade.raceChoices,
    loadout: premade.loadout,
    premadeId: premade.id,
  };
}

/** Checks that entries refer to things that exist. Empty means everything lines up. */
export function crossCheck(set: ContentSet): string[] {
  const problems: string[] = [];
  const has = (list: { id: string }[], id: string) => list.some((x) => x.id === id);
  const getItem = lookup(set.items, 'item');

  const checkAbilityEffects = (owner: string, effects: { type: string; abilityId?: string }[]) => {
    for (const effect of effects) {
      if (effect.type === 'ability' && effect.abilityId && !has(set.abilities, effect.abilityId)) {
        problems.push(`${owner} grants unknown ability "${effect.abilityId}".`);
      }
    }
  };

  for (const item of set.items) {
    if ('effects' in item) checkAbilityEffects(`Item "${item.id}"`, item.effects);
  }
  for (const ability of set.abilities) checkAbilityEffects(`Ability "${ability.id}"`, ability.effects);

  for (const monster of set.monsters) {
    for (const abilityId of monster.abilityIds) {
      if (!has(set.abilities, abilityId)) problems.push(`Monster "${monster.id}" has unknown ability "${abilityId}".`);
    }
  }

  for (const premade of set.premades) {
    const race = set.races.find((r) => r.id === premade.raceId);
    const cls = set.classes.find((c) => c.id === premade.classId);
    if (!race) problems.push(`Pre-built merc "${premade.id}" has unknown race "${premade.raceId}".`);
    if (!cls) problems.push(`Pre-built merc "${premade.id}" has unknown class "${premade.classId}".`);
    if (!race || !cls) continue;
    const draftProblems = validateDraft(premadeToDraft(premade), race, {
      armourProficiency: cls.armour,
      getItem,
    });
    for (const p of draftProblems) problems.push(`Pre-built merc "${premade.id}": ${p}`);
  }

  for (const adventure of set.adventures) {
    for (const dialogue of adventure.dialogues) {
      for (const option of dialogue.nodes.flatMap((n) => n.options)) {
        for (const condition of option.requires ?? []) {
          if (condition.type === 'partyHasClass' && !has(set.classes, condition.classId)) {
            problems.push(`Adventure "${adventure.id}" needs unknown class "${condition.classId}".`);
          }
          if (condition.type === 'partyHasRace' && !has(set.races, condition.raceId)) {
            problems.push(`Adventure "${adventure.id}" needs unknown race "${condition.raceId}".`);
          }
        }
      }
    }
  }
  return problems;
}

/** Problems with a changed collection, checked against the rest of the content as it stands. */
export function checkCollection(key: CollectionKey, data: unknown, current: ContentSet): string[] {
  let parsed: { id: string }[];
  try {
    parsed = parseCollection(key, data);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return crossCheck({ ...current, [key]: parsed });
}

/** All game data, validated once when this module first loads. */
export const CONTENT: ContentSet = {
  classes: parseList(classSchema, classesJson, 'class'),
  races: parseList(raceSchema, racesJson, 'race'),
  items: parseList(itemSchema, itemsJson, 'item'),
  abilities: parseList(abilitySchema, abilitiesJson, 'ability'),
  monsters: parseList(monsterSchema, monstersJson, 'monster'),
  premades: parseList(premadeSchema, premadesJson, 'pre-built merc'),
  // Adventures are one file each; add new ones to this list.
  adventures: parseList(adventureSchema, [greywaterFord], 'adventure'),
};

const contentProblems = crossCheck(CONTENT);
if (contentProblems.length > 0) throw new Error(`Invalid game content:\n${contentProblems.join('\n')}`);

export const { classes: CLASSES, races: RACES, items: ITEMS, abilities: ABILITIES, monsters: MONSTERS } = CONTENT;
export const { premades: PREMADES, adventures: ADVENTURES } = CONTENT;

export const getClass = lookup(CLASSES, 'class');
export const getRace = lookup(RACES, 'race');
export const getItem = lookup(ITEMS, 'item');
export const getAbility = lookup(ABILITIES, 'ability');
export const getMonster = lookup(MONSTERS, 'monster');
export const getAdventure = lookup(ADVENTURES, 'adventure');

export function getDialogue(adventureId: string, dialogueId: string): DialogueDefinition {
  const dialogue = getAdventure(adventureId).dialogues.find((d) => d.id === dialogueId);
  if (!dialogue) throw new Error(`Adventure "${adventureId}" has no dialogue "${dialogueId}".`);
  return dialogue;
}

export * from './schema';
