import type { z } from 'zod';
import {
  validateDraft,
  type AbilityDefinition,
  type DialogueDefinition,
  type DungeonDefinition,
  type ItemDefinition,
  type MercDraft,
  type MonsterDefinition,
  type RaceDefinition,
  type TalentTree,
} from '../engine';
import abilitiesJson from './abilities.json';
import classesJson from './classes.json';
import itemsJson from './items.json';
import monstersJson from './monsters.json';
import portraitsJson from './portraits.json';
import premadesJson from './premades.json';
import racesJson from './races.json';
import talentsJson from './talents.json';
import {
  abilitySchema,
  adventureSchema,
  classSchema,
  dungeonSchema,
  itemSchema,
  monsterSchema,
  parseList,
  portraitSchema,
  premadeSchema,
  raceSchema,
  talentTreeSchema,
  type AdventureDefinition,
  type PortraitDefinition,
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
  portraits: PortraitDefinition[];
  adventures: AdventureDefinition[];
  dungeons: DungeonDefinition[];
  /** One tree per class that has one. Not edited in the content editor yet. */
  talents: (TalentTree & { id: string })[];
}

export type CollectionKey = Exclude<keyof ContentSet, 'adventures' | 'dungeons' | 'talents'>;

/** Every dungeon and adventure file, one per entry, loaded at build time in file-name order. */
const dungeonFiles = import.meta.glob('./dungeons/*.json', { eager: true, import: 'default' });
const adventureFiles = import.meta.glob('./adventures/*.json', { eager: true, import: 'default' });
const byFileName = (files: Record<string, unknown>) =>
  Object.keys(files)
    .sort()
    .map((k) => files[k]);

/** Where each per-entry file lives, for the editors that write them. */
export const dungeonFile = (id: string) => `dungeons/${id}.json`;
export const adventureFile = (id: string) => `adventures/${id}.json`;

export interface CollectionInfo {
  key: CollectionKey;
  label: string;
  /** File under src/content that holds this collection. */
  file: string;
  schema: z.ZodType<{ id: string }>;
  /** The field holding the entry's picture. */
  imageField: 'icon' | 'portrait' | 'asset';
}

/** Every collection the content editor can change. */
export const COLLECTIONS: CollectionInfo[] = [
  { key: 'items', label: 'Gear', file: 'items.json', schema: itemSchema, imageField: 'icon' },
  { key: 'abilities', label: 'Abilities', file: 'abilities.json', schema: abilitySchema, imageField: 'icon' },
  { key: 'monsters', label: 'Monsters', file: 'monsters.json', schema: monsterSchema, imageField: 'portrait' },
  { key: 'classes', label: 'Classes', file: 'classes.json', schema: classSchema, imageField: 'icon' },
  { key: 'races', label: 'Races', file: 'races.json', schema: raceSchema, imageField: 'icon' },
  { key: 'premades', label: 'Pre-built mercs', file: 'premades.json', schema: premadeSchema, imageField: 'portrait' },
  { key: 'portraits', label: 'Portraits', file: 'portraits.json', schema: portraitSchema, imageField: 'asset' },
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
    ...(premade.startingTalents ? { startingTalents: premade.startingTalents } : {}),
  };
}

/**
 * Problems with the talents a new merc starts with: at most one, and only a tier 1
 * talent of their own class (the starting talent point). Empty means they are fine.
 */
export function startingTalentProblems(classId: string, talents: string[], trees: TalentTree[]): string[] {
  if (talents.length === 0) return [];
  if (talents.length > 1) return ['a new merc has one starting talent point'];
  const tree = trees.find((t) => t.classId === classId);
  const talent = tree?.branches.flatMap((b) => b.talents).find((t) => t.id === talents[0]);
  if (!talent) return [`"${talents[0]}" is not a talent of the ${classId} tree`];
  if (talent.tier !== 1) return [`"${talent.name}" is not a tier 1 talent`];
  return [];
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

  for (const ability of set.abilities) {
    if (ability.summon && !has(set.monsters, ability.summon.monsterId)) {
      problems.push(`Ability "${ability.id}" summons unknown monster "${ability.summon.monsterId}".`);
    }
  }

  const treeClasses = new Set<string>();
  for (const tree of set.talents ?? []) {
    if (!has(set.classes, tree.classId)) problems.push(`Talent tree "${tree.id}" is for unknown class "${tree.classId}".`);
    if (treeClasses.has(tree.classId)) problems.push(`Class "${tree.classId}" has more than one talent tree.`);
    treeClasses.add(tree.classId);
    for (const talent of tree.branches.flatMap((b) => b.talents)) {
      const owner = `Talent "${tree.id}/${talent.id}"`;
      if (talent.abilityId) {
        const ability = set.abilities.find((a) => a.id === talent.abilityId);
        if (!ability) problems.push(`${owner} teaches unknown ability "${talent.abilityId}".`);
        else if (ability.usableBy === 'monsters') problems.push(`${owner} teaches "${ability.id}", which only monsters can use.`);
      }
      checkAbilityEffects(owner, talent.effects ?? []);
    }
  }

  for (const item of set.items) {
    if ('effects' in item) checkAbilityEffects(`Item "${item.id}"`, item.effects);
  }
  for (const ability of set.abilities) checkAbilityEffects(`Ability "${ability.id}"`, ability.effects);

  for (const monster of set.monsters) {
    for (const abilityId of monster.abilityIds) {
      if (!has(set.abilities, abilityId)) problems.push(`Monster "${monster.id}" has unknown ability "${abilityId}".`);
    }
  }

  for (const portrait of set.portraits) {
    for (const raceId of portrait.races) {
      if (!has(set.races, raceId)) problems.push(`Portrait "${portrait.id}" names unknown race "${raceId}".`);
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
    for (const p of startingTalentProblems(premade.classId, premade.startingTalents ?? [], set.talents ?? [])) {
      problems.push(`Pre-built merc "${premade.id}": ${p}`);
    }
  }

  for (const adventure of set.adventures) {
    const dialogues = new Map(adventure.dialogues.map((d) => [d.id, d]));
    const where = `Adventure "${adventure.id}"`;

    for (const dungeonId of adventure.dungeons) {
      const dungeon = set.dungeons.find((d) => d.id === dungeonId);
      if (!dungeon) {
        problems.push(`${where} uses unknown dungeon "${dungeonId}".`);
        continue;
      }
      for (const f of dungeon.features) {
        if (f.type === 'encounter') {
          for (const m of f.monsters) {
            if (!has(set.monsters, m.monsterId)) problems.push(`Dungeon "${dungeon.id}": ${f.id} has unknown monster "${m.monsterId}".`);
          }
          continue;
        }
        const dialogue = dialogues.get(f.dialogueId);
        if (!dialogue) {
          problems.push(`Dungeon "${dungeon.id}": ${f.id} opens dialogue "${f.dialogueId}", which ${where} does not have.`);
          continue;
        }
        const nodes = f.type === 'trap' ? [f.triggerNode, f.disarmNode] : [f.node];
        for (const node of nodes) {
          if (node && !dialogue.nodes.some((n) => n.id === node)) {
            problems.push(`Dungeon "${dungeon.id}": ${f.id} starts at missing node "${node}" of "${f.dialogueId}".`);
          }
        }
      }
    }

    const ending = adventure.ending ? dialogues.get(adventure.ending) : undefined;
    if (ending) {
      const outcomes = ending.nodes.flatMap((n) => n.options).flatMap((o) => [o.outcome, o.success, o.failure]);
      if (!outcomes.some((o) => o?.effects?.some((e) => e.type === 'completeAdventure'))) {
        problems.push(`${where}: the ending "${ending.id}" never marks the adventure complete.`);
      }
      if (!outcomes.some((o) => o?.end === 'adventureSelect')) {
        problems.push(`${where}: the ending "${ending.id}" never returns to adventure select.`);
      }
    }

    for (const dialogue of adventure.dialogues) {
      for (const option of dialogue.nodes.flatMap((n) => n.options)) {
        for (const outcome of [option.outcome, option.success, option.failure]) {
          if (outcome?.end === 'dungeon' && !outcome.dungeon && adventure.dungeons.length === 0) {
            problems.push(`${where}: option "${option.id}" leads into the adventure's first dungeon, but none is assigned.`);
          }
          if (outcome?.dungeon && !adventure.dungeons.includes(outcome.dungeon)) {
            problems.push(`${where}: option "${option.id}" enters dungeon "${outcome.dungeon}", which the adventure does not list.`);
          }
          for (const effect of outcome?.effects ?? []) {
            if (effect.type === 'giveItem' && !has(set.items, effect.itemId)) {
              problems.push(`${where}: option "${option.id}" gives unknown item "${effect.itemId}".`);
            }
          }
        }
      }
    }
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

/**
 * Problems with an edited dungeon and the adventures it is assigned to,
 * checked against everything else. Empty means it is safe to save.
 */
export function checkDungeonEdit(dungeon: unknown, adventures: AdventureDefinition[], current: ContentSet): string[] {
  const parsed = dungeonSchema.safeParse(dungeon);
  if (!parsed.success) return parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
  const dungeons = [...current.dungeons.filter((d) => d.id !== parsed.data.id), parsed.data];
  return crossCheck({ ...current, dungeons, adventures });
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
  portraits: parseList(portraitSchema, portraitsJson, 'portrait'),
  adventures: parseList(adventureSchema, byFileName(adventureFiles), 'adventure'),
  dungeons: parseList(dungeonSchema, byFileName(dungeonFiles), 'dungeon'),
  talents: parseList(talentTreeSchema, talentsJson, 'talent tree'),
};

const contentProblems = crossCheck(CONTENT);
if (contentProblems.length > 0) throw new Error(`Invalid game content:\n${contentProblems.join('\n')}`);

export const { classes: CLASSES, races: RACES, items: ITEMS, abilities: ABILITIES, monsters: MONSTERS } = CONTENT;
export const { premades: PREMADES, adventures: ADVENTURES, dungeons: DUNGEONS, portraits: PORTRAITS } = CONTENT;

/** Portraits for a merc builder choice. Falls back to every portrait of that gender if none suit the race. */
export function portraitsFor(gender: string, raceId: string): PortraitDefinition[] {
  const ofGender = PORTRAITS.filter((p) => p.gender === gender);
  const fitting = ofGender.filter((p) => p.races.includes(raceId));
  return fitting.length > 0 ? fitting : ofGender;
}

export const getClass = lookup(CLASSES, 'class');
export const getRace = lookup(RACES, 'race');
export const getItem = lookup(ITEMS, 'item');
export const getAbility = lookup(ABILITIES, 'ability');

/** The talent tree for a class, if it has one yet. */
export function getTalentTree(classId: string): TalentTree | undefined {
  return CONTENT.talents.find((t) => t.classId === classId);
}
export const getMonster = lookup(MONSTERS, 'monster');
export const getAdventure = lookup(ADVENTURES, 'adventure');
export const getDungeon = lookup(DUNGEONS, 'dungeon');

export function getDialogue(adventureId: string, dialogueId: string): DialogueDefinition {
  const dialogue = getAdventure(adventureId).dialogues.find((d) => d.id === dialogueId);
  if (!dialogue) throw new Error(`Adventure "${adventureId}" has no dialogue "${dialogueId}".`);
  return dialogue;
}

export * from './schema';
