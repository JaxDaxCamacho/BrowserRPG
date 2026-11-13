/**
 * Money is stored as a single count of copper so it never drifts.
 * Assumed rates: 100 copper to a silver, 100 silver to a gold.
 */
export const COPPER_PER_SILVER = 100;
export const SILVER_PER_GOLD = 100;
export const COPPER_PER_GOLD = COPPER_PER_SILVER * SILVER_PER_GOLD;

export interface Coins {
  gold: number;
  silver: number;
  copper: number;
}

export function toCopper({ gold, silver, copper }: Coins): number {
  return gold * COPPER_PER_GOLD + silver * COPPER_PER_SILVER + copper;
}

export function toCoins(totalCopper: number): Coins {
  const total = Math.max(0, Math.floor(totalCopper));
  return {
    gold: Math.floor(total / COPPER_PER_GOLD),
    silver: Math.floor((total % COPPER_PER_GOLD) / COPPER_PER_SILVER),
    copper: total % COPPER_PER_SILVER,
  };
}

/** "3g 50s 20c", leaving out zero parts but never returning an empty string. */
export function formatCoins(totalCopper: number): string {
  const { gold, silver, copper } = toCoins(totalCopper);
  const parts = [gold && `${gold}g`, silver && `${silver}s`, copper && `${copper}c`].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '0c';
}

/** Every new merc starts with 3 gold, 50 silver and 20 copper. */
export const STARTING_PURSE = toCopper({ gold: 3, silver: 50, copper: 20 });
