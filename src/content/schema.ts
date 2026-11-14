import { z } from 'zod';
import {
  ABILITY_TARGETS,
  BONUS_CONDITIONS,
  RESOURCES,
  STATUS_KINDS,
  AMMO_TYPES,
  ARMOUR_WEIGHTS,
  DAMAGE_STYLES,
  ENEMY_ARCHETYPES,
  KIT_USES,
  isValidDice,
  SCREENS,
  STAT_NAMES,
  validateDungeon,
  WEAPON_TYPES,
} from '../engine';

/**
 * Schemas for the JSON content files. Every file is checked when the game
 * loads, in tests, and by the content editor before it saves, so a typo in
 * data fails fast with a readable message.
 */

const id = z.string().regex(/^[a-z][a-z0-9-]*$/, 'ids are lowercase words joined by hyphens');
const statName = z.enum(STAT_NAMES);
const dice = z.string().refine(isValidDice, 'must be dice notation such as "1d8", "2d6+1" or "2"');
/** An asset from the synced library, e.g. "weapons/swords/sv-t-01". */
const assetId = z.string().regex(/^[a-z0-9][a-z0-9/-]*$/, 'asset ids look like "weapons/swords/sv-t-01"');
const armourType = z.enum(['physical', 'magic']);
const damageType = z.enum(['physical', 'magic', 'spiritual']);

const statChanges = z.strictObject({
  strength: z.number().int().optional(),
  agility: z.number().int().optional(),
  toughness: z.number().int().optional(),
  intellect: z.number().int().optional(),
  spirit: z.number().int().optional(),
  charisma: z.number().int().optional(),
});

const statValue = z.number().int().min(1);
const fullStats = z.strictObject({
  strength: statValue,
  agility: statValue,
  toughness: statValue,
  intellect: statValue,
  spirit: statValue,
  charisma: statValue,
});

// ---------- classes and races ----------

export const classSchema = z.strictObject({
  id,
  name: z.string().min(1),
  icon: assetId.optional(),
  role: z.string().min(1),
  keyStats: z.array(statName).min(1),
  baseHp: z.number().int().positive(),
  hpPerLevel: z.number().int().positive(),
  baseDefense: z.number().int(),
  armour: z.enum(['none', 'light', 'medium', 'heavy']),
});

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
  icon: assetId.optional(),
  movement: z.number().int().min(1).max(8),
  statChanges,
  statChoices: z
    .strictObject({ count: z.number().int().min(1).max(STAT_NAMES.length), amount: z.number().int() })
    .optional(),
  passives: z.array(racePassiveSchema),
});

// ---------- attacks ----------

export const attackProfileSchema = z.strictObject({
  kind: z.enum(['melee', 'ranged', 'magic', 'spiritual']),
  damageType,
  graze: dice,
  hit: dice,
  critThreshold: z.number().int().min(2).max(20).optional(),
  extra: z.strictObject({ damageType, amount: z.number().int().positive() }).optional(),
});

// ---------- items ----------

export const itemEffectSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('stat'), stat: statName, amount: z.number().int() }),
  z.strictObject({ type: z.literal('armour'), armour: armourType, amount: z.number().int() }),
  z.strictObject({ type: z.literal('defense'), amount: z.number().int() }),
  z.strictObject({ type: z.literal('maxHp'), amount: z.number().int() }),
  z.strictObject({ type: z.literal('ability'), abilityId: id }),
  z.strictObject({ type: z.literal('heal'), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal('movement'), amount: z.number().int() }),
  z.strictObject({ type: z.literal('damage'), amount: z.number().int(), twoHandedOnly: z.boolean().optional() }),
  z.strictObject({ type: z.literal('critRange'), amount: z.number().int().min(1).max(5) }),
  z.strictObject({ type: z.literal('retaliate'), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal('bloodrage'), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal('statusResist'), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal('manaBurn'), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal('twinWeapons'), amount: z.number().int().positive() }),
]);

const effects = z.array(itemEffectSchema);

const itemBase = {
  id,
  name: z.string().min(1),
  icon: assetId.optional(),
  description: z.string().optional(),
  /** Price in copper. */
  value: z.number().int().min(0),
  /** Can be picked as starting gear at character creation. */
  starter: z.boolean(),
};

const weaponItem = z.strictObject({
  ...itemBase,
  kind: z.literal('weapon'),
  weaponType: z.enum(WEAPON_TYPES),
  style: z.enum(DAMAGE_STYLES),
  hands: z.union([z.literal(1), z.literal(2)]),
  range: z.number().int().min(0).max(12),
  attack: attackProfileSchema,
  ammo: z.enum(AMMO_TYPES).optional(),
  animation: assetId.optional(),
  sound: assetId.optional(),
  effects,
});

const armourItem = z.strictObject({
  ...itemBase,
  kind: z.literal('armour'),
  slot: z.enum(['body', 'head', 'hands', 'feet']),
  weight: z.enum(ARMOUR_WEIGHTS),
  defense: z.number().int().max(0),
  physicalArmour: z.number().int().min(0),
  magicArmour: z.number().int().min(0),
  effects,
});

const shieldItem = z.strictObject({
  ...itemBase,
  kind: z.literal('shield'),
  defense: z.number().int().positive(),
  effects,
});

const trinketItem = z.strictObject({
  ...itemBase,
  kind: z.literal('trinket'),
  slot: z.enum(['neck', 'ring']),
  effects,
});

const potionItem = z.strictObject({
  ...itemBase,
  kind: z.literal('potion'),
  effects: effects.min(1),
  encounters: z.number().int().min(1).optional(),
});

const ammoItem = z.strictObject({
  ...itemBase,
  kind: z.literal('ammo'),
  ammoType: z.enum(AMMO_TYPES),
  bonusGraze: z.number().int(),
  bonusHit: z.number().int(),
  extraDamage: z.strictObject({ damageType, amount: z.number().int().positive() }).optional(),
});

const kitItem = z.strictObject({
  ...itemBase,
  kind: z.literal('kit'),
  use: z.enum(KIT_USES),
  heal: z.number().int().positive().optional(),
});

/** Body armour must sit in the bands agreed for each weight. */
const BODY_ARMOUR_BANDS = {
  clothing: { defense: [0, 0], physical: [0, 0] },
  light: { defense: [0, 0], physical: [1, 2] },
  medium: { defense: [-3, -1], physical: [3, 6] },
  heavy: { defense: [-6, -4], physical: [5, 12] },
} as const;

export const itemSchema = z
  .discriminatedUnion('kind', [weaponItem, armourItem, shieldItem, trinketItem, potionItem, ammoItem, kitItem])
  .superRefine((item, ctx) => {
    if (item.kind === 'weapon') {
      if ((item.attack.kind === 'melee') !== (item.range === 0)) {
        ctx.addIssue({ code: 'custom', message: 'melee weapons have range 0; every other weapon needs a range of 1 or more' });
      }
      if (item.ammo && item.attack.kind !== 'ranged') {
        ctx.addIssue({ code: 'custom', message: 'only ranged weapons use ammunition' });
      }
    }
    if (item.kind === 'armour' && item.slot === 'body') {
      const band = BODY_ARMOUR_BANDS[item.weight];
      const inBand = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
      if (!inBand(item.defense, band.defense)) {
        ctx.addIssue({ code: 'custom', message: `${item.weight} body armour has a Defense penalty of ${band.defense[0]} to ${band.defense[1]}` });
      }
      if (!inBand(item.physicalArmour, band.physical)) {
        ctx.addIssue({ code: 'custom', message: `${item.weight} body armour gives ${band.physical[0]} to ${band.physical[1]} physical armour` });
      }
    }
    if (item.kind === 'potion') {
      const lasting = item.effects.some((e) => e.type !== 'heal');
      if (lasting && !item.encounters) {
        ctx.addIssue({ code: 'custom', message: 'a potion with lasting effects needs a number of encounters' });
      }
    }
    if (item.starter && 'effects' in item && item.kind !== 'potion' && item.effects.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'starting gear has no bonuses' });
    }
  });

// ---------- abilities and monsters ----------

export const abilitySchema = z.strictObject({
  id,
  name: z.string().min(1),
  icon: assetId.optional(),
  animation: assetId.optional(),
  sound: assetId.optional(),
  description: z.string().min(1),
  activation: z.enum(['action', 'passive']),
  usableBy: z.enum(['mercs', 'monsters', 'both']),
  target: z.enum(ABILITY_TARGETS),
  range: z.number().int().min(0).max(12),
  cooldown: z.number().int().min(1).optional(),
  attack: attackProfileSchema.optional(),
  effects,
  duration: z.number().int().min(1).optional(),
  cost: z.strictObject({ resource: z.enum(RESOURCES), amount: z.number().int().positive() }).optional(),
  weaponAttack: z.strictObject({ bonus: z.number().int().optional() }).optional(),
  requiresTwoHanded: z.boolean().optional(),
  bonuses: z.array(z.strictObject({ when: z.enum(BONUS_CONDITIONS), damage: dice })).optional(),
  statuses: z
    .array(
      z.strictObject({
        status: z.enum(STATUS_KINDS),
        rounds: z.number().int().min(1).max(10),
        amount: z.number().int().positive().optional(),
        if: z.enum(BONUS_CONDITIONS).optional(),
      }),
    )
    .optional(),
  consumes: z.enum(STATUS_KINDS).optional(),
  grantAttack: z.boolean().optional(),
  knockback: z.number().int().min(1).max(6).optional(),
  attackStat: statName.optional(),
  revive: z.boolean().optional(),
  summon: z.strictObject({ monsterId: id, rounds: z.number().int().min(1).max(10) }).optional(),
  lifesteal: z.boolean().optional(),
}).refine((a) => !(a.attack && a.weaponAttack), { message: 'an ability uses its own "attack" or the "weaponAttack", not both' });

// ---------- talent trees ----------

const talentSchema = z
  .strictObject({
    id,
    name: z.string().min(1),
    icon: assetId.optional(),
    description: z.string().min(1),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    maxRanks: z.number().int().min(1).max(5),
    abilityId: id.optional(),
    effects: effects.optional(),
  })
  .refine((t) => !t.abilityId || t.maxRanks === 1, { message: 'a talent that teaches an ability has one rank' })
  .refine((t) => t.abilityId || (t.effects?.length ?? 0) > 0, { message: 'a talent needs an ability or effects' });

export const talentTreeSchema = z
  .strictObject({
    id,
    classId: id,
    branches: z
      .array(
        z.strictObject({
          id,
          name: z.string().min(1),
          description: z.string().min(1),
          icon: assetId.optional(),
          talents: z.array(talentSchema).min(1),
        }),
      )
      .length(3),
  })
  .superRefine((tree, ctx) => {
    const ids = tree.branches.flatMap((b) => b.talents.map((t) => t.id));
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'talent ids must be unique within a tree' });
  });

export const monsterSchema = z.strictObject({
  id,
  name: z.string().min(1),
  portrait: assetId.optional(),
  archetype: z.enum(ENEMY_ARCHETYPES),
  movement: z.number().int().min(1).max(8).optional(),
  level: z.number().int().min(1),
  stats: fullStats,
  hp: z.number().int().positive(),
  defense: z.number().int(),
  armour: z.strictObject({ physical: z.number().int().min(0), magic: z.number().int().min(0) }),
  attack: z.strictObject({
    name: z.string().min(1),
    range: z.number().int().min(0).max(12),
    profile: attackProfileSchema,
    animation: assetId.optional(),
    sound: assetId.optional(),
  }),
  abilityIds: z.array(id),
  xp: z.number().int().min(0),
  mana: z.number().int().min(1).max(50).optional(),
  undead: z.boolean().optional(),
});

// ---------- dialogue and adventures ----------

const flagValue = z.union([z.boolean(), z.number(), z.string()]);
const screenName = z.enum(SCREENS);

const conditionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('flag'), flag: z.string().min(1), equals: flagValue }),
  z.strictObject({ type: z.literal('partyHasClass'), classId: id }),
  z.strictObject({ type: z.literal('partyHasRace'), raceId: id }),
  z.strictObject({ type: z.literal('partyHasItem'), itemId: id }),
]);

const effectTarget = z.enum(['roller', 'leader', 'party']);

const effectSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('setFlag'), flag: z.string().min(1), value: flagValue }),
  z.strictObject({ type: z.literal('money'), amount: z.number().int() }),
  z.strictObject({ type: z.literal('damage'), amount: dice, target: effectTarget }),
  z.strictObject({ type: z.literal('heal'), amount: dice, target: effectTarget }),
  z.strictObject({ type: z.literal('giveItem'), itemId: id, quantity: z.number().int().positive() }),
  z.strictObject({ type: z.literal('resolveFeature') }),
  z.strictObject({ type: z.literal('payFlag'), flag: z.string().min(1) }),
  z.strictObject({ type: z.literal('xp'), amount: z.number().int().positive() }),
  z.strictObject({ type: z.literal('completeAdventure') }),
]);

const outcomeSchema = z
  .strictObject({
    text: z.string().min(1).optional(),
    effects: z.array(effectSchema).optional(),
    goto: id.optional(),
    end: screenName.optional(),
    dungeon: id.optional(),
  })
  .refine((o) => (o.goto === undefined) !== (o.end === undefined), {
    message: 'an outcome needs exactly one of "goto" and "end"',
  })
  .refine((o) => !o.dungeon || o.end === 'dungeon', { message: '"dungeon" goes with "end": "dungeon"' });

const optionSchema = z
  .strictObject({
    id,
    text: z.string().min(1),
    requires: z.array(conditionSchema).optional(),
    check: z
      .strictObject({ stat: statName, difficulty: z.number().int().min(1), by: z.enum(['leader', 'best']) })
      .optional(),
    outcome: outcomeSchema.optional(),
    success: outcomeSchema.optional(),
    failure: outcomeSchema.optional(),
  })
  .refine((o) => (o.check ? o.success && o.failure && !o.outcome : o.outcome && !o.success && !o.failure), {
    message: 'an option with a check needs "success" and "failure"; one without needs "outcome"',
  });

const nodeSchema = z.strictObject({
  id,
  speaker: z.string().min(1).optional(),
  image: id.optional(),
  text: z.string().min(1),
  options: z.array(optionSchema).min(1),
});

export const dialogueSchema = z
  .strictObject({ id, start: id, nodes: z.array(nodeSchema).min(1) })
  .superRefine((dialogue, ctx) => {
    const nodeIds = new Set(dialogue.nodes.map((n) => n.id));
    if (nodeIds.size !== dialogue.nodes.length) ctx.addIssue({ code: 'custom', message: 'node ids must be unique' });
    if (!nodeIds.has(dialogue.start)) {
      ctx.addIssue({ code: 'custom', message: `start node "${dialogue.start}" does not exist` });
    }
    for (const node of dialogue.nodes) {
      for (const option of node.options) {
        for (const outcome of [option.outcome, option.success, option.failure]) {
          if (outcome?.goto && !nodeIds.has(outcome.goto)) {
            ctx.addIssue({
              code: 'custom',
              message: `option "${option.id}" in node "${node.id}" goes to missing node "${outcome.goto}"`,
            });
          }
        }
      }
    }
  });

export const adventureSchema = z
  .strictObject({
    id,
    title: z.string().min(1),
    summary: z.string().min(1),
    difficulty: z.string().min(1),
    /** The dialogue that opens the adventure. */
    debrief: id,
    /** The dialogue played when the party leaves its last dungeon with the goal done. Without one, the adventure just ends. */
    ending: id.optional(),
    /** Dungeons this adventure uses, by id, in the order they are explored. */
    dungeons: z.array(id),
    dialogues: z.array(dialogueSchema).min(1),
  })
  .refine((a) => a.dialogues.some((d) => d.id === a.debrief), {
    message: "the debrief must be one of the adventure's dialogues",
  })
  .refine((a) => !a.ending || a.dialogues.some((d) => d.id === a.ending), {
    message: "the ending must be one of the adventure's dialogues",
  });

// ---------- dungeons ----------

const pos = z.strictObject({ x: z.number().int().min(0), y: z.number().int().min(0) });
const featureBase = {
  id,
  name: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  icon: assetId.optional(),
};

/** Obstacle kinds the battlefield can be dressed with; each carries its own blocking defaults. */
export const OBSTACLE_KINDS = ['barrel', 'chest', 'barricade', 'pillar'] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

const obstacleSchema = z.strictObject({
  id,
  kind: z.enum(OBSTACLE_KINDS),
  /** Position on the combat grid (not the dungeon map): 0,0 is the top-left of the battlefield. */
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0).max(8),
});

export const dungeonSchema = z
  .strictObject({
    id,
    name: z.string().min(1),
    width: z.number().int().min(5).max(80),
    height: z.number().int().min(5).max(80),
    tiles: z.array(z.string()),
    start: pos,
    rooms: z.array(
      z.strictObject({
        id,
        name: z.string().optional(),
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        width: z.number().int().min(1),
        height: z.number().int().min(1),
        rows: z.number().int().min(2).max(5),
      }),
    ),
    features: z.array(
      z.discriminatedUnion('type', [
        z.strictObject({
          ...featureBase,
          type: z.literal('trap'),
          detectDifficulty: z.number().int().min(1),
          dialogueId: id,
          triggerNode: id,
          disarmNode: id.optional(),
        }),
        z.strictObject({
          ...featureBase,
          type: z.literal('encounter'),
          monsters: z.array(z.strictObject({ monsterId: id, count: z.number().int().min(1) })).min(1),
          ambush: z.boolean().optional(),
          detection: z.number().int().min(0).max(12).optional(),
          stealthDifficulty: z.number().int().min(1).max(30).optional(),
          /** Barrels, chests, barricades and pillars dressing the battlefield for this fight. */
          obstacles: z.array(obstacleSchema).optional(),
        }),
        z.strictObject({ ...featureBase, type: z.literal('event'), dialogueId: id, node: id.optional() }),
        z.strictObject({ ...featureBase, type: z.literal('goal'), dialogueId: id, node: id.optional() }),
      ]),
    ),
  })
  .superRefine((dungeon, ctx) => {
    for (const problem of validateDungeon(dungeon)) ctx.addIssue({ code: 'custom', message: problem });
    const ids = dungeon.features.map((f) => f.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'feature ids must be unique' });
  });

// ---------- portraits ----------

export const GENDERS = ['female', 'male'] as const;
export type Gender = (typeof GENDERS)[number];

/** A portrait mercs can use, tagged so the merc builder can offer only fitting ones. */
export const portraitSchema = z.strictObject({
  id,
  /** The picture, from the asset library. */
  asset: assetId,
  gender: z.enum(GENDERS),
  /** Races this face suits. */
  races: z.array(id).min(1),
});

export type PortraitDefinition = z.infer<typeof portraitSchema>;

// ---------- pre-built mercs ----------

export const premadeSchema = z.strictObject({
  id,
  name: z.string().min(1),
  raceId: id,
  classId: id,
  gender: z.enum(GENDERS).optional(),
  portrait: assetId.optional(),
  baseStats: fullStats,
  raceChoices: z.array(statName),
  loadout: z.strictObject({
    mainHand: id.optional(),
    offHand: id.optional(),
    body: id.optional(),
    ammo: id.optional(),
  }),
  /** The talent its starting point is already placed in: a tier 1 talent of its class. */
  startingTalents: z.array(id).max(1).optional(),
});

export type AdventureDefinition = z.infer<typeof adventureSchema>;
export type PremadeDefinition = z.infer<typeof premadeSchema>;
export type ClassDefinition = z.infer<typeof classSchema>;

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
