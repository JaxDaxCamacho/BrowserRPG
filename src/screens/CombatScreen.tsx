import { useEffect, useMemo, useRef, useState } from 'react';
import { getAbility, getDungeon, getItem } from '../content';
import {
  abilityTargets,
  activeCombatant,
  ammoLeft,
  attack,
  attackTargets,
  ATTACK_STAT,
  canUseAbility,
  defend,
  effectiveDefense,
  endTurn,
  featureById,
  finishCombat,
  flee,
  moveCombatant,
  retryCombat,
  runEnemyTurn,
  shareXp,
  startCombat,
  statModifier,
  effectiveStats,
  castAbility,
  drinkPotion,
  type AbilityDefinition,
  type AttackRoll,
  type CombatEvent,
  type Combatant,
  type CombatState,
} from '../engine';
import { combatContext } from '../state/context';
import { useGameStore } from '../state/store';
import { AnimationPreview, AssetImage, useAssetIndex } from './assets';
import { initials } from './MercCard';

/** Pause before each enemy acts, so the player can follow the fight. */
const ENEMY_DELAY_MS = 750;
const FLASH_MS = 1100;

type Targeting = { kind: 'attack' } | { kind: 'ability'; ability: AbilityDefinition };

interface Flash {
  key: string;
  targetId: string;
  text: string;
  tone: 'damage' | 'heal' | 'miss' | 'buff';
  animation?: string;
}

function flashesFrom(events: CombatEvent[], seq: number): Flash[] {
  return events.flatMap((e, i): Flash[] => {
    const key = `${seq}-${i}`;
    if (e.kind === 'attack' && e.targetId) {
      const text = e.outcome === 'miss' ? 'Miss' : `${e.outcome === 'crit' ? 'Crit! ' : e.outcome === 'graze' ? 'Graze ' : ''}-${e.amount ?? 0}`;
      return [{ key, targetId: e.targetId, text, tone: e.outcome === 'miss' ? 'miss' : 'damage', ...(e.animation ? { animation: e.animation } : {}) }];
    }
    if (e.kind === 'heal' && e.targetId) return [{ key, targetId: e.targetId, text: `+${e.amount ?? 0}`, tone: 'heal', ...(e.animation ? { animation: e.animation } : {}) }];
    if (e.kind === 'buff' && e.targetId) return [{ key, targetId: e.targetId, text: 'Boost', tone: 'buff', ...(e.animation ? { animation: e.animation } : {}) }];
    if (e.kind === 'defend') return [{ key, targetId: e.actorId, text: 'Defend', tone: 'buff' }];
    return [];
  });
}

const STAT_SHORT: Record<string, string> = {
  strength: 'STR',
  agility: 'AGI',
  toughness: 'TOU',
  intellect: 'INT',
  spirit: 'SPI',
  charisma: 'CHA',
};

const OUTCOME_LABEL: Record<string, string> = { miss: 'Miss', graze: 'Graze', hit: 'Hit', crit: 'Critical!' };

function signed(n: number): string {
  return n >= 0 ? `+ ${n}` : `− ${Math.abs(n)}`;
}

/** The damage working for one attack, e.g. "Hit 5 + 2 STR − 2 armour = 5". */
function damageWorking(r: AttackRoll, outcome: string): string {
  const stat = STAT_SHORT[r.stat] ?? r.stat;
  const main = r.damage - r.extraDamage;
  const armour = r.armour > 0 ? ` − ${r.armour} armour` : '';
  const extra = r.extraDamage > 0 ? `, + ${r.extraDamage} extra` : '';
  switch (outcome) {
    case 'miss':
      return 'A natural 1 always misses: no damage.';
    case 'graze':
      return `Graze ${r.grazeRoll} ${signed(r.modifier)} ${stat}${armour} = ${main}${extra}`;
    case 'hit':
      return `Hit ${r.hitRoll} ${signed(r.modifier)} ${stat}${armour} = ${main}${extra}`;
    default:
      return `(graze ${r.grazeRoll} + hit ${r.hitRoll} ${signed(r.modifier)} ${stat}) × 2${armour} = ${main}${extra}`;
  }
}

interface ShownRoll {
  key: string;
  attacker: string;
  target: string;
  outcome: string;
  roll: AttackRoll;
}

/** The last attack rolls, with the dice, the sum against Defense and the damage. Stays up until the next attack. */
function RollReadout({ rolls }: { rolls: ShownRoll[] }) {
  if (rolls.length === 0) {
    return <p className="dim roll-empty">Attack rolls appear here.</p>;
  }
  return (
    <div className="roll-readout" aria-live="polite">
      {rolls.map(({ key, attacker, target, outcome, roll }) => (
        <div key={key} className={`roll-card outcome-${outcome}`}>
          <div className="roll-dice" aria-hidden="true">
            {roll.dice.map((d, i) => {
              const kept = roll.dice.length === 1 || (d === roll.natural && roll.dice.indexOf(roll.natural) === i);
              return (
                <span key={i} className={`d20${kept ? ' kept' : ' dropped'}`}>
                  {d}
                </span>
              );
            })}
          </div>
          <div className="roll-text">
            <p className="roll-who">
              {roll.free && <span className="dim">Free attack · </span>}
              <strong>{attacker}</strong> → {target} <span className="dim">· {roll.label}</span>
            </p>
            <p className="roll-sum">
              {roll.natural} {signed(roll.modifier)} {STAT_SHORT[roll.stat]} = <strong>{roll.total}</strong> vs Defense {roll.defense}
              {roll.mode !== 'normal' && <span className="dim"> · {roll.mode} (rolled {roll.dice.join(' and ')})</span>}
              {roll.critThreshold < 20 && <span className="dim"> · crits on {roll.critThreshold}+</span>}
              <span className="roll-outcome"> {OUTCOME_LABEL[outcome]}</span>
            </p>
            <p className="roll-damage dim">{damageWorking(roll, outcome)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The natural roll the actor needs to hit (not graze) this target, for the targeting hint. */
function hitOn(actor: Combatant, target: Combatant, kind: keyof typeof ATTACK_STAT): number {
  const modifier = statModifier(effectiveStats(actor)[ATTACK_STAT[kind]]);
  return Math.min(20, Math.max(2, effectiveDefense(target) - modifier + 1));
}

interface TokenProps {
  x: Combatant;
  active: boolean;
  targetable: boolean;
  hint?: string;
  flashes: Flash[];
  frames: (id: string) => number | undefined;
  onPick: () => void;
}

function CombatToken({ x, active, targetable, hint, flashes, frames, onPick }: TokenProps) {
  const down = x.hp === 0;
  const pct = Math.max(0, (x.hp / x.maxHp) * 100);
  return (
    <button
      type="button"
      className={`combat-token side-${x.side}${active ? ' active' : ''}${targetable ? ' targetable' : ''}${down ? ' down' : ''}`}
      disabled={!targetable}
      onClick={onPick}
      aria-label={`${x.name}, ${x.hp} of ${x.maxHp} HP${targetable ? `, target${hint ? `: ${hint}` : ''}` : ''}`}
    >
      <span className="token-face">
        <AssetImage id={x.portrait} fallback={initials(x.name)} className="token" size={64} />
        {x.defending && <span className="token-status" title="Defending">🛡</span>}
        {flashes.map((f) => (
          <span key={f.key} className="token-flash">
            {f.animation && <AnimationPreview id={f.animation} frames={frames(f.animation) ?? 15} size={110} once />}
            <span className={`flash-text tone-${f.tone}`}>{f.text}</span>
          </span>
        ))}
      </span>
      <span className="token-name">{x.name}</span>
      <span className="hp-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="token-hp dim">{down ? 'Down' : `${x.hp} / ${x.maxHp}`}</span>
      {targetable && hint && <span className="token-hint">{hint}</span>}
      {x.buffs.length > 0 && <span className="token-buffs dim">{x.buffs.map((b) => b.source).join(', ')}</span>}
    </button>
  );
}

export function CombatScreen() {
  const game = useGameStore((s) => s.game);
  const apply = useGameStore((s) => s.apply);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const assets = useAssetIndex();
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const [rolls, setRolls] = useState<ShownRoll[]>([]);
  const lastSeq = useRef(-1);

  const combat = game.encounter?.combat;

  // Keep the dice of the latest attacks on screen until someone attacks again.
  useEffect(() => {
    if (!combat) return;
    const attacks = combat.events.filter((e) => e.kind === 'attack' && e.roll && e.targetId);
    if (attacks.length === 0) return;
    const nameOf = (id: string) => combat.combatants.find((x) => x.id === id)?.name ?? id;
    setRolls(
      attacks.map((e, i) => ({
        key: `${combat.seq}-${i}`,
        attacker: nameOf(e.actorId),
        target: nameOf(e.targetId!),
        outcome: e.outcome ?? 'miss',
        roll: e.roll!,
      })),
    );
  }, [combat]);

  // Start the fight the first time this screen opens for an encounter.
  useEffect(() => {
    if (game.encounter && !game.encounter.combat) apply((g) => startCombat(g, combatContext));
  }, [game.encounter, apply]);

  // Play the last action's animations and numbers.
  useEffect(() => {
    if (!combat || combat.seq === lastSeq.current) return;
    lastSeq.current = combat.seq;
    const next = flashesFrom(combat.events, combat.seq);
    if (next.length === 0) return;
    setFlashes(next);
    const timer = window.setTimeout(() => setFlashes([]), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [combat]);

  // Enemies take their turns by themselves.
  const actor = combat && !combat.outcome ? activeCombatant(combat) : null;
  const enemyTurnKey = actor?.side === 'enemy' ? `${combat!.round}-${combat!.turn}-${combat!.seq}` : null;
  useEffect(() => {
    if (!enemyTurnKey) return;
    const timer = window.setTimeout(() => apply((g) => runEnemyTurn(g, combatContext)), ENEMY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enemyTurnKey, apply]);

  // A new turn clears any half-chosen action.
  useEffect(() => setTargeting(null), [combat?.turn, combat?.round]);

  const frames = useMemo(() => {
    const map = new Map((assets ?? []).map((a) => [a.id, a.frames]));
    return (id: string) => map.get(id);
  }, [assets]);

  if (!game.encounter || !combat || !game.dungeon) return <main className="screen">Preparing the fight…</main>;

  const def = getDungeon(game.dungeon.dungeonId);
  const feature = featureById(def, combat.featureId);
  const yourTurn = actor?.side === 'party';
  const merc = yourTurn ? combat.mercs.find((m) => m.id === actor.mercId) : undefined;

  // Who can be picked right now, and the roll needed against each.
  const targets = new Map<string, string>();
  if (yourTurn && targeting && actor) {
    if (targeting.kind === 'attack') {
      for (const t of attackTargets(combat, actor)) {
        const dis = t.row === actor.row && actor.attack.range > 0;
        targets.set(t.id, `hit on ${hitOn(actor, t, actor.attack.profile.kind)}+${dis ? ', disadvantage' : ''}`);
      }
    } else {
      const ability = targeting.ability;
      for (const t of abilityTargets(combat, actor, ability)) {
        targets.set(t.id, ability.attack ? `hit on ${hitOn(actor, t, ability.attack.kind)}+` : '');
      }
    }
  }

  const pick = (id: string) => {
    if (!targeting) return;
    if (targeting.kind === 'attack') apply((g) => attack(g, id));
    else apply((g) => castAbility(g, targeting.ability.id, id, combatContext));
    setTargeting(null);
  };

  const rowsTopDown = Array.from({ length: combat.rows }, (_, i) => combat.rows - 1 - i);
  const abilities = actor ? actor.abilityIds.map((id) => getAbility(id)).filter((a) => a.activation === 'action') : [];
  const potions = (merc?.inventory ?? []).filter((s) => getItem(s.itemId).kind === 'potion');
  const shots = actor ? ammoLeft(combat, actor) : null;

  return (
    <main className="combat">
      <header className="combat-bar">
        <h1>{feature.name}</h1>
        <span className="dim">
          Round {combat.round}
          {combat.ambush ? ' · ambush' : ''}
        </span>
        <ol className="initiative" aria-label="Turn order">
          {combat.order.map((id, i) => {
            const x = combat.combatants.find((k) => k.id === id)!;
            return (
              <li key={id} className={`side-${x.side}${i === combat.turn ? ' current' : ''}${x.hp === 0 ? ' down' : ''}`} title={`${x.name} (initiative ${x.initiative})`}>
                <AssetImage id={x.portrait} fallback={initials(x.name)} size={32} className="token" />
              </li>
            );
          })}
        </ol>
      </header>

      <section className="battlefield" aria-label="Battlefield">
        {rowsTopDown.map((row) => (
          <div key={row} className={`combat-row${actor && actor.row === row ? ' actor-row' : ''}`}>
            <span className="row-label dim">Row {row + 1}</span>
            {(['party', 'enemy'] as const).map((side) => (
              <div key={side} className={`row-side side-${side}`}>
                {combat.combatants
                  .filter((x) => x.row === row && x.side === side)
                  .map((x) => (
                    <CombatToken
                      key={x.id}
                      x={x}
                      active={actor?.id === x.id}
                      targetable={targets.has(x.id)}
                      hint={targets.get(x.id)}
                      flashes={flashes.filter((f) => f.targetId === x.id)}
                      frames={frames}
                      onPick={() => pick(x.id)}
                    />
                  ))}
              </div>
            ))}
          </div>
        ))}
      </section>

      <footer className="combat-footer">
        <div className="combat-actions">
          {combat.outcome ? (
            <Outcome combat={combat} onContinue={() => apply((g) => finishCombat(g, combatContext))} onRetry={() => apply((g) => retryCombat(g, combatContext))} onMenu={backToMenu} />
          ) : yourTurn && actor ? (
            <>
              <p className="turn-title">
                <strong>{actor.name}</strong>
                <span className="dim">
                  {combat.moved ? 'moved' : 'can move'} · {combat.acted ? 'acted' : 'can act'}
                </span>
              </p>
              {targeting ? (
                <div className="row">
                  <span>
                    {targets.size > 0
                      ? `Choose a target for ${targeting.kind === 'attack' ? actor.attack.name : targeting.ability.name}.`
                      : 'No target in reach.'}
                  </span>
                  {targeting.kind === 'ability' && !['enemy', 'ally', 'row'].includes(targeting.ability.target) && (
                    <button type="button" className="primary" onClick={() => {
                      apply((g) => castAbility(g, targeting.ability.id, null, combatContext));
                      setTargeting(null);
                    }}>
                      Use {targeting.ability.name}
                    </button>
                  )}
                  <button type="button" onClick={() => setTargeting(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="row action-buttons">
                  <button type="button" disabled={combat.moved || actor.row >= combat.rows - 1} onClick={() => apply((g) => moveCombatant(g, 1))}>
                    Move up
                  </button>
                  <button type="button" disabled={combat.moved || actor.row <= 0} onClick={() => apply((g) => moveCombatant(g, -1))}>
                    Move down
                  </button>
                  <button
                    type="button"
                    className="primary"
                    disabled={combat.acted || attackTargets(combat, actor).length === 0}
                    title={shots === 0 ? 'Out of ammunition' : attackTargets(combat, actor).length === 0 ? 'No target in reach' : undefined}
                    onClick={() => setTargeting({ kind: 'attack' })}
                  >
                    {actor.attack.name}
                    {shots !== null ? ` (${shots})` : ''}
                  </button>
                  {abilities.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={combat.acted || !canUseAbility(combat, actor, a)}
                      title={a.description}
                      onClick={() => setTargeting({ kind: 'ability', ability: a })}
                    >
                      {a.name}
                      {(actor.cooldowns[a.id] ?? 0) > 0 ? ` (${actor.cooldowns[a.id]})` : ''}
                    </button>
                  ))}
                  {potions.map((s) => (
                    <button key={s.itemId} type="button" disabled={combat.acted} onClick={() => apply((g) => drinkPotion(g, s.itemId, combatContext))}>
                      Drink {getItem(s.itemId).name} ×{s.quantity}
                    </button>
                  ))}
                  <button type="button" disabled={combat.acted} onClick={() => apply(defend)}>
                    Defend
                  </button>
                  <button type="button" disabled={combat.acted} onClick={() => apply((g) => flee(g, combatContext))}>
                    Flee
                  </button>
                  <button type="button" onClick={() => apply(endTurn)}>
                    End turn
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="turn-title dim">{actor ? `${actor.name} is acting…` : ''}</p>
          )}
        </div>
        <RollReadout rolls={rolls} />
        <ol className="combat-log" aria-live="polite">
          {combat.log.slice(-6).map((line, i) => (
            <li key={`${combat.log.length}-${i}`}>{line}</li>
          ))}
        </ol>
      </footer>
    </main>
  );
}

function Outcome({ combat, onContinue, onRetry, onMenu }: { combat: CombatState; onContinue: () => void; onRetry: () => void; onMenu: () => void }) {
  if (combat.outcome === 'defeat') {
    return (
      <div className="outcome">
        <p className="turn-title">
          <strong>The party has fallen.</strong>
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={onRetry}>
            Try the fight again
          </button>
          <button type="button" onClick={onMenu}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }
  const xp = combat.outcome === 'victory' ? Object.values(shareXp(combat, combatContext))[0] : undefined;
  return (
    <div className="outcome">
      <p className="turn-title">
        <strong>{combat.outcome === 'victory' ? 'Victory!' : 'You escaped.'}</strong>
        {xp !== undefined && <span className="dim"> +{xp} XP each</span>}
      </p>
      <button type="button" className="primary" onClick={onContinue}>
        Back to the map
      </button>
    </div>
  );
}
