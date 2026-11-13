import type { Armour, AttackProfile } from './attack';
import type { ItemEffect } from './items';
import type { Stats } from './stats';

/** Who an ability can be aimed at. */
/** `area` hits the chosen enemy and every enemy next to them. */
export const ABILITY_TARGETS = ['self', 'ally', 'enemy', 'area', 'allAllies', 'allEnemies'] as const;
export type AbilityTarget = (typeof ABILITY_TARGETS)[number];

/**
 * An active ability is used as an action; a passive one always applies.
 * The combat milestone gives these their full behaviour; for now they are data.
 */
export interface AbilityDefinition {
  id: string;
  name: string;
  icon?: string;
  /** Asset id of the sprite-sheet animation played when it is used. */
  animation?: string;
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
}
