import { toCoins } from '../engine';
import { AssetImage } from './assets';

/** The coin art, a silver coin from the trading icons; gold and copper are the same coin tinted. */
const COIN = 'items/trading/tradingicons-98-t';

/**
 * An amount of money as numbers with little coins: gold, silver and copper,
 * leaving out zero parts (but always showing something).
 */
export function Coins({ copper }: { copper: number }) {
  const { gold, silver, copper: cu } = toCoins(copper);
  const parts: [number, 'gold' | 'silver' | 'copper', string][] = [
    [gold, 'gold', 'g'],
    [silver, 'silver', 's'],
    [cu, 'copper', 'c'],
  ];
  const shown = parts.filter(([n]) => n > 0);
  const list = shown.length > 0 ? shown : [parts[2]!];
  return (
    <span className="coins" aria-label={list.map(([n, kind]) => `${n} ${kind}`).join(', ')}>
      {list.map(([n, kind, letter]) => (
        <span key={kind} className="coin-amount">
          {n}
          <AssetImage id={COIN} fallback={letter} size={14} className={`coin coin-${kind}`} />
        </span>
      ))}
    </span>
  );
}
