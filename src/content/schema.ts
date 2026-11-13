import { z } from 'zod';
import { isValidDice, STAT_NAMES, WEAPON_TYPES } from '../engine';

/**
 * Schemas for the JSON content files. Every file is checked when the game
 * loads and in tests, so a typo in data fails fast with a readable message.
 */

const id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'ids are lowercase words joined by hyphens');
const statName = z.enum(STAT_NAMES);
const dice = z.string().refine(isValidDice, 'must be dice notation such as "1d8", "2d6+1" or "2"');

const statChanges = z.strictObject({
  strength: z.number().int().optional(),
  agility: z.number().int().optional(),
  toughness: z.number().int().optional(),
  intellect: z.number().int().optional(),
  spirit: z.number().int().optional(),
  charisma: z.number().int().optional(),
});

export const classSchema = z.strictObject({
  id,
  name: z.string().min(1),
  role: z.string().min(1),
  keyStats: z.array(statName).min(1),
  baseHp: z.number().int().positive(),
  hpPerLevel: z.number().int().positive(),
  baseDefense: z.number().int(),
  armour: z.enum(['none', 'light', 'medium', 'heavy']),
});

const armourType = z.enum(['physical', 'magic']);

export const racePassiveSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('xpRate'), bonus: z.number().positive() }),
  z.strictObject({ type: z.literal('baseArmour'), armour: armourType, amount: z.number().int().positive() }),
  z.strictObject({
    type: z.literal('critThreshold'),
    threshold: z.number().int().min(2).max(20),
    weaponTypes: z.array(z.enum(WEAPON_TYPES)).min(1),
  }),
  z.strictObject({ type: z.literal('bonusHp'), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal('giantGrip') }),
  z.strictObject({ type: z.literal('deathSave'), difficulty: z.number().int().min(2).max(20) }),
]);

export const raceSchema = z.strictObject({
  id,
  name: z.string().min(1),
  statChanges,
  statChoices: z
    .strictObject({ count: z.number().int().min(1).max(STAT_NAMES.length), amount: z.number().int() })
    .optional(),
  passives: z.array(racePassiveSchema),
});

export const attackProfileSchema = z.strictObject({
  kind: z.enum(['melee', 'ranged', 'magic', 'spiritual']),
  damageType: z.enum(['physical', 'magic', 'spiritual']),
  graze: dice,
  hit: dice,
  critThreshold: z.number().int().min(2).max(20).optional(),
});

export const weaponSchema = z
  .strictObject({
    id,
    name: z.string().min(1),
    weaponType: z.enum(WEAPON_TYPES),
    hands: z.union([z.literal(1), z.literal(2)]),
    /** Reach in combat rows. 0 means the same row only (melee). */
    range: z.number().int().min(0).max(4),
    attack: attackProfileSchema,
  })
  .refine((w) => (w.attack.kind === 'melee') === (w.range === 0), {
    message: 'melee weapons have range 0; every other weapon needs a range of 1 or more',
  });

const statValue = z.number().int().min(1);

export const premadeSchema = z.strictObject({
  id,
  name: z.string().min(1),
  raceId: id,
  classId: id,
  baseStats: z.strictObject({
    strength: statValue,
    agility: statValue,
    toughness: statValue,
    intellect: statValue,
    spirit: statValue,
    charisma: statValue,
  }),
  raceChoices: z.array(statName),
});

export type PremadeDefinition = z.infer<typeof premadeSchema>;
export type ClassDefinition = z.infer<typeof classSchema>;
export type WeaponDefinition = z.infer<typeof weaponSchema>;

/** Checks a list of definitions and that no id is used twice. */
export function parseList<T extends { id: string }>(schema: z.ZodType<T>, data: unknown, what: string): T[] {
  const result = z.array(schema).safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid ${what} data:\n${z.prettifyError(result.error)}`);
  }
  const seen = new Set<string>();
  for (const item of result.data) {
    if (seen.has(item.id)) throw new Error(`Invalid ${what} data: id "${item.id}" is used twice`);
    seen.add(item.id);
  }
  return result.data;
}
