import type { Armour, AttackProfile, DamageType } from './attack';
import type { ItemEffect } from './items';
import type { StatName, Stats } from './stats';

/**
 * Who an ability can be aimed at. `area` hits the chosen enemy and every enemy
 * next to them; `any` is one enemy or one ally. `allAllies` and `allEnemies`
 * reach everyone within `range` tiles (everyone, when the range is 0).
 */
export const ABILITY_TARGETS = ['self', 'ally', 'enemy', 'any', 'area', 'allAllies', 'allEnemies'] as const;
export type AbilityTarget = (typeof ABILITY_TARGETS)[number];

/**
 * What abilities spend. Each merc has a pool of every resource their abilities use:
 * - mana starts full and refills 1 a turn
 * - adrenaline starts at 2 and builds 1 for each blow dealt or taken
 * - souls start empty and gather 1 for each enemy that falls
 */
export const RESOURCES = ['mana', 'adrenaline', 'souls'] as const;
export type Resource = (typeof RESOURCES)[number];

/**
 * Conditions that last a number of the affected combatant's turns:
 * - stunned: loses its turns
 * - taunted: must go after whoever taunted it
 * - invisible: cannot be targeted by enemies; attacking ends it, with advantage
 * - poisoned, bleeding, burning: takes `amount` damage at the start of each turn
 * - blinded: attacks with disadvantage
 * - oiled: soaked in lamp oil, waiting for a spark
 * - evasive: stepping away from enemies draws no free attacks
 * - silenced: cannot use abilities, only its weapon
 * - feared: spends its turns running from whoever frightened it
 * - spellguard: the next hostile spell aimed at it fizzles
 * - reflecting: the next hostile spell aimed at it bounces back at the caster
 * - frozen: loses its turns, but taking damage shatters the ice
 * - warded: a shield that soaks up `amount` damage before it breaks
 * - prone: knocked off its feet; its next turn's movement goes on getting up, and melee attacks on it have advantage
 * - rooted: snared in place; it cannot move, but can still act
 * - regenerating: heals `amount` at the start of each turn
 */
export const STATUS_KINDS = [
  'stunned',
  'taunted',
  'invisible',
  'poisoned',
  'bleeding',
  'burning',
  'blinded',
  'oiled',
  'evasive',
  'silenced',
  'feared',
  'spellguard',
  'reflecting',
  'frozen',
  'warded',
  'prone',
  'rooted',
  'regenerating',
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/**
 * Situations that make an ability hit harder, or let a status take hold.
 * A target is bigger when its max HP is above the attacker's; a caster is
 * anyone with spells or a magic attack.
 */
export const BONUS_CONDITIONS = [
  'targetStunned',
  'targetFlanked',
  'targetOiled',
  'targetBlinded',
  'fromInvisible',
  'targetBigger',
  'targetCaster',
  'targetUndead',
] as const;
export type BonusCondition = (typeof BONUS_CONDITIONS)[number];

export interface StatusSpec {
  status: StatusKind;
  /** How many of the target's turns it lasts. */
  rounds: number;
  /** Damage per turn for poisoned, bleeding and burning. */
  amount?: number;
  /** Only takes hold when this is true. */
  if?: BonusCondition;
}

/**
 * An active ability is used as an action; a passive one always applies.
 * Attack abilities either carry their own `attack` profile or strike with the
 * user's weapon (`weaponAttack`); their `effects` and `statuses` land on a hit.
 * Other abilities apply `effects` (for `duration` rounds) and `statuses` at once.
 */
export interface AbilityDefinition {
  id: string;
  name: string;
  icon?: string;
  /** Asset id of the sprite-sheet animation played when it is used. */
  animation?: string;
  /** Asset id of the sound played when it lands. */
  sound?: string;
  description: string;
  activation: 'action' | 'passive';
  usableBy: 'mercs' | 'monsters' | 'both';
  target: AbilityTarget;
  /** Reach in tiles; 0 means melee, the eight tiles around the user. */
  range: number;
  /** Turns before it can be used again. */
  cooldown?: number;
  attack?: AttackProfile;
  /** Effects on the target, lasting `duration` turns (or permanently for a passive). */
  effects: ItemEffect[];
  duration?: number;
  /** What using it costs. */
  cost?: { resource: Resource; amount: number };
  /**
   * Strike with the user's own weapon, with its reach and ammunition, plus `bonus` damage.
   * `reach` lets a melee blow land that many squares away; `extra` adds damage dice of another type.
   */
  weaponAttack?: { bonus?: number; reach?: number; extra?: { damageType: DamageType; dice: string } };
  /** Needs a two-handed weapon in hand. */
  requiresTwoHanded?: boolean;
  /** Needs a shield in hand (and not lying on the floor after a throw). */
  requiresShield?: boolean;
  /** The user grows to this size (2 is 2×2) for as long as the ability's effects last. */
  grow?: number;
  /** When the ability's effects wear off, the user drops to 1 HP. */
  exhausts?: boolean;
  /** The user first charges in a straight line, up to `range` squares, to the target. */
  charge?: boolean;
  /** The shield is thrown: afterwards it lies by the target until picked up by standing on it ('on'), next to it ('adjacent'), or flies straight back ('return'). */
  throwShield?: 'on' | 'adjacent' | 'return';
  /** Plants a banner on the user's square: allies within `radius` squares of it add `bonus` to every d20 roll. */
  banner?: { radius: number; bonus: number };
  /** Extra damage dice when a condition holds. */
  bonuses?: { when: BonusCondition; damage: string }[];
  /** Conditions put on each target. */
  statuses?: StatusSpec[];
  /** Removes this condition from the target after a hit (the oil burns away). */
  consumes?: StatusKind;
  /** Each ally targeted makes a free weapon attack on an enemy next to them. */
  grantAttack?: boolean;
  /** On a hit, shoves the target this many tiles away; slamming into something hurts. */
  knockback?: number;
  /** The stat behind the ability's own attack, instead of the usual one for its kind (a thrown axe uses Strength). */
  attackStat?: StatName;
  /** Aimed at a fallen ally: they get back up with the ability's healing as hit points. */
  revive?: boolean;
  /** Calls up a monster to fight on the user's side for a number of its turns. */
  summon?: { monsterId: string; rounds: number };
  /** The user heals by the damage the ability deals. */
  lifesteal?: boolean;
}

/** A spell: a magic or spiritual attack, or anything paid for with mana or souls. Spells can be cancelled and reflected. */
export function isSpell(ability: AbilityDefinition): boolean {
  const kind = ability.attack?.kind;
  return kind === 'magic' || kind === 'spiritual' || ability.cost?.resource === 'mana' || ability.cost?.resource === 'souls';
}

/** How an enemy chooses where to move and whom to attack. */
export const ENEMY_ARCHETYPES = [
  'brawler',
  'tank',
  'assassin',
  'savage',
  'healer',
  'summoner',
  'archer',
  'caster',
] as const;
export type EnemyArchetype = (typeof ENEMY_ARCHETYPES)[number];

export interface MonsterAttack {
  name: string;
  range: number;
  profile: AttackProfile;
  animation?: string;
  sound?: string;
}

export interface MonsterDefinition {
  id: string;
  name: string;
  portrait?: string;
  archetype: EnemyArchetype;
  /** Tiles it can move each turn in a fight. */
  movement?: number;
  level: number;
  stats: Stats;
  hp: number;
  defense: number;
  armour: Armour;
  attack: MonsterAttack;
  abilityIds: string[];
  /** Experience shared by the party for defeating it. */
  xp: number;
  /** A mana pool: it starts full, refills 1 a turn, and pays for abilities that cost mana. Mana burn drains it. */
  mana?: number;
  /** Walking dead: holy magic hurts it more and can turn it away. */
  undead?: boolean;
  /** Squares it covers along each side in a fight: 2 for a 2×2 creature, 3 for 3×3. Missing means 1. */
  size?: number;
  /** Makes it a boss: a banner with its health over the battlefield, phases as it weakens, and no stuns or shoves. */
  boss?: BossDefinition;
}

/** What happens when a boss is worn down to a share of its health. */
export interface BossPhase {
  /** Starts when the boss's HP falls to this percentage of its maximum or below. */
  atHpPercent: number;
  /** Announced in the log after the boss's name, e.g. "roars for his men!" */
  text: string;
  /** Lasting changes for the rest of the fight, such as more damage or Defense. */
  effects?: ItemEffect[];
  /** Hit points it gets back when the phase starts. */
  heal?: number;
  /** Reinforcements that join the fight on its side. */
  summon?: { monsterId: string; count: number }[];
}

export interface BossDefinition {
  /** Shown on the banner under the name, e.g. "Master of the Watchtower". */
  title?: string;
  /** In order, from the first to strike (highest percentage) to the last. */
  phases: BossPhase[];
}
