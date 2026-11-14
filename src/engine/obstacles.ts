/**
 * Obstacle types, as content: barrels, chests, barricades, pillars and the
 * like that dress a battlefield. Encounters place them by id on the combat
 * grid; a fight copies what it needs from the type onto each obstacle.
 */
export interface ObstacleDefinition {
  id: string;
  name: string;
  /** Picture from the asset library; `emoji` stands in without one. */
  icon?: string;
  emoji: string;
  description?: string;
  /** Nobody can walk through or stand on it. */
  blocksMove: boolean;
  /** Ranged attacks and spells cannot pass through it. */
  blocksLoS: boolean;
  /** Hit points it takes to smash; null means it cannot be destroyed. */
  hp: number | null;
}
