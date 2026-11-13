import { useEffect, useMemo, useRef, useState } from 'react';
import { getDungeon } from '../content';
import {
  abilityTargets,
  activeCombatant,
  attack,
  attackTargets,
  ATTACK_STAT,
  defend,
  effectiveDefense,
  endTurn,
  featureById,
  finishCombat,
  flee,
  isAiControlled,
  isEngaged,
  moveTo,
  obstacleTargets,
  OBSTACLE_PRESETS,
  reachableTiles,
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
  type Obstacle,
  type Pos,
  type StatusKind,
} from '../engine';
import { combatContext } from '../state/context';
import { useGameStore } from '../state/store';
import { AnimationPreview, AssetImage, useAssetIndex } from './assets';
import { ActionBar, needsPick, slotsFor } from './ActionBar';
import { DieFace } from './Dice';
import { initials } from './MercCard';

/** Pause before each enemy acts, so the player can follow the fight. */
const ENEMY_DELAY_MS = 750;
const FLASH_MS = 1100;
/** How long a projectile takes to cross the battlefield before it lands or goes wide. */
const PROJECTILE_MS = 420;

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
    if (e.kind === 'status' && e.targetId) {
      const text = e.amount ? `-${e.amount} ${e.label ?? ''}`.trim() : (STATUS_FLAIR[e.label as StatusKind]?.name ?? e.label ?? '');
      return [{ key, targetId: e.targetId, text, tone: e.amount ? 'damage' : 'buff' }];
    }
    return [];
  });
}

/** How each condition shows on a token. */
const STATUS_FLAIR: Record<StatusKind, { icon: string; name: string }> = {
  stunned: { icon: '💫', name: 'Stunned' },
  taunted: { icon: '😠', name: 'Taunted' },
  invisible: { icon: '👻', name: 'Invisible' },
  poisoned: { icon: '☠️', name: 'Poisoned' },
  bleeding: { icon: '🩸', name: 'Bleeding' },
  burning: { icon: '🔥', name: 'Burning' },
  blinded: { icon: '🙈', name: 'Blinded' },
  oiled: { icon: '🛢️', name: 'Oiled' },
  evasive: { icon: '💨', name: 'Evasive' },
  silenced: { icon: '🤐', name: 'Silenced' },
  feared: { icon: '😱', name: 'Feared' },
  spellguard: { icon: '🚫', name: 'Spellguard' },
  reflecting: { icon: '🪞', name: 'Reflecting' },
  frozen: { icon: '🧊', name: 'Frozen' },
  warded: { icon: '✨', name: 'Warded' },
};

interface ProjectileSpec {
  key: string;
  from: Pos;
  to: Pos;
  hit: boolean;
  kind: 'ranged' | 'magic';
}

/** A shot or bolt to animate for every ranged or magic attack in the last action. */
function projectilesFrom(combat: CombatState, seq: number): ProjectileSpec[] {
  return combat.events.flatMap((e, i): ProjectileSpec[] => {
    if (e.kind !== 'attack' || !e.roll?.ranged || !e.targetId) return [];
    const from = combat.combatants.find((x) => x.id === e.actorId)?.pos;
    const to = combat.combatants.find((x) => x.id === e.targetId)?.pos ?? combat.obstacles.find((o) => o.id === e.targetId)?.pos;
    if (!from || !to) return [];
    return [{ key: `${seq}-${i}`, from, to, hit: e.outcome !== 'miss', kind: e.roll.stat === 'intellect' ? 'magic' : 'ranged' }];
  });
}

/** Position as a percentage of the battlefield stage, centred on the tile. */
function pctStyle(p: Pos, width: number, height: number) {
  return { left: `${((p.x + 0.5) / width) * 100}%`, top: `${((p.y + 0.5) / height) * 100}%` };
}

/** A shot that flies from the attacker to the target, landing on a hit and skidding wide on a miss. */
function ProjectileFX({ spec, width, height }: { spec: ProjectileSpec; width: number; height: number }) {
  const [pos, setPos] = useState<Pos>(spec.from);
  const landing = spec.hit ? spec.to : { x: spec.to.x + (spec.to.x >= spec.from.x ? 0.7 : -0.7), y: spec.to.y + (spec.to.y >= spec.from.y ? 0.6 : -0.6) };
  useEffect(() => {
    setPos(spec.from);
    const raf = requestAnimationFrame(() => setPos(landing));
    return () => cancelAnimationFrame(raf);
    // Only a fresh shot restarts the flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key]);
  const angle = (Math.atan2(landing.y - spec.from.y, landing.x - spec.from.x) * 180) / Math.PI;
  return <span className={`projectile kind-${spec.kind}`} style={{ ...pctStyle(pos, width, height), transform: `translate(-50%, -50%) rotate(${angle}deg)` }} />;
}

/** A barrel, chest, barricade or pillar dressing the battlefield; destructible ones can be targeted like an enemy. */
function ObstacleToken({ o, targetable, flashes, onPick }: { o: Obstacle; targetable: boolean; flashes: Flash[]; onPick: () => void }) {
  const preset = OBSTACLE_PRESETS[o.kind];
  const destructible = o.hp !== null;
  return (
    <button
      type="button"
      className={`obstacle-token${destructible ? ' destructible' : ''}${targetable ? ' targetable' : ''}`}
      disabled={!targetable}
      onClick={onPick}
      title={`${preset.name}${destructible ? ` (${o.hp}/${o.maxHp} HP)` : ''}`}
      aria-label={preset.name}
    >
      <span aria-hidden="true">{preset.emoji}</span>
      {destructible && o.hp !== null && o.maxHp !== null && (
        <span className="obstacle-hp">
          <span style={{ width: `${(o.hp / o.maxHp) * 100}%` }} />
        </span>
      )}
      {flashes.map((f) => (
        <span key={f.key} className="token-flash">
          <span className={`flash-text tone-${f.tone}`}>{f.text}</span>
        </span>
      ))}
    </button>
  );
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
  const armour = `${r.bonusDamage > 0 ? ` + ${r.bonusDamage} bonus` : ''}${r.armour > 0 ? ` − ${r.armour} armour` : ''}`;
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
                  <DieFace value={d} />
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
      className={`combat-token side-${x.side}${active ? ' active' : ''}${targetable ? ' targetable' : ''}${down ? ' down' : ''}${x.statuses.some((st) => st.kind === 'invisible') ? ' invisible' : ''}`}
      disabled={!targetable}
      onClick={onPick}
      aria-label={`${x.name}, ${x.hp} of ${x.maxHp} HP${targetable ? `, target${hint ? `: ${hint}` : ''}` : ''}`}
    >
      <span className="token-face">
        <AssetImage id={x.portrait} fallback={initials(x.name)} className="token" size={64} />
        {x.defending && <span className="token-status" title="Defending">🛡</span>}
        {x.statuses.length > 0 && (
          <span className="token-statuses">
            {x.statuses.map((st) => (
              <span key={st.kind} title={`${STATUS_FLAIR[st.kind].name}${st.amount ? (st.kind === 'warded' ? ` (${st.amount} left)` : ` (${st.amount} a turn)`) : ''}: ${st.rounds} turn${st.rounds === 1 ? '' : 's'} left`}>
                {STATUS_FLAIR[st.kind].icon}
              </span>
            ))}
          </span>
        )}
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
  const [selected, setSelected] = useState<number | null>(null);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const [projectiles, setProjectiles] = useState<ProjectileSpec[]>([]);
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

  // Play the last action's animations, numbers and projectiles.
  useEffect(() => {
    if (!combat || combat.seq === lastSeq.current) return;
    lastSeq.current = combat.seq;
    const nextFlashes = flashesFrom(combat.events, combat.seq);
    const nextShots = projectilesFrom(combat, combat.seq);
    let flashTimer: number | undefined;
    let shotTimer: number | undefined;
    if (nextFlashes.length > 0) {
      setFlashes(nextFlashes);
      flashTimer = window.setTimeout(() => setFlashes([]), FLASH_MS);
    }
    if (nextShots.length > 0) {
      setProjectiles(nextShots);
      shotTimer = window.setTimeout(() => setProjectiles([]), PROJECTILE_MS + 150);
    }
    return () => {
      if (flashTimer) window.clearTimeout(flashTimer);
      if (shotTimer) window.clearTimeout(shotTimer);
    };
  }, [combat]);

  // Enemies take their turns by themselves.
  const actor = combat && !combat.outcome ? activeCombatant(combat) : null;
  const enemyTurnKey = actor && isAiControlled(actor) ? `${combat!.round}-${combat!.turn}-${combat!.seq}` : null;
  useEffect(() => {
    if (!enemyTurnKey) return;
    const timer = window.setTimeout(() => apply((g) => runEnemyTurn(g, combatContext)), ENEMY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enemyTurnKey, apply]);

  // A new turn clears any half-chosen action.
  useEffect(() => {
    setTargeting(null);
    setSelected(null);
  }, [combat?.turn, combat?.round]);

  const frames = useMemo(() => {
    const map = new Map((assets ?? []).map((a) => [a.id, a.frames]));
    return (id: string) => map.get(id);
  }, [assets]);

  if (!game.encounter || !combat || !game.dungeon) return <main className="screen">Preparing the fight…</main>;

  const def = getDungeon(game.dungeon.dungeonId);
  const feature = featureById(def, combat.featureId);
  const yourTurn = !!actor && !isAiControlled(actor);
  const merc = yourTurn ? combat.mercs.find((m) => m.id === actor.mercId) : undefined;

  // Who can be picked right now, and the roll needed against each.
  const targets = new Map<string, string>();
  if (yourTurn && targeting && actor) {
    if (targeting.kind === 'attack') {
      for (const t of attackTargets(combat, actor)) {
        const dis = actor.attack.range > 0 && isEngaged(combat, actor);
        targets.set(t.id, `hit on ${hitOn(actor, t, actor.attack.profile.kind)}+${dis ? ', disadvantage' : ''}`);
      }
      for (const o of obstacleTargets(combat, actor)) targets.set(o.id, 'destroy');
    } else {
      const ability = targeting.ability;
      const kind = ability.weaponAttack ? actor.attack.profile.kind : ability.attack?.kind;
      for (const t of abilityTargets(combat, actor, ability)) {
        targets.set(t.id, kind && t.side !== actor.side ? `hit on ${hitOn(actor, t, kind)}+` : t.side === actor.side ? 'ally' : '');
      }
    }
  }

  const cancel = () => {
    setTargeting(null);
    setSelected(null);
  };

  const pick = (id: string) => {
    if (!targeting) return;
    if (targeting.kind === 'attack') apply((g) => attack(g, id));
    else apply((g) => castAbility(g, targeting.ability.id, id, combatContext));
    cancel();
  };

  const slots = yourTurn && actor ? slotsFor(actor, merc) : [];
  const useSlot = (i: number) => {
    const slot = slots[i];
    if (!slot || !actor) return;
    switch (slot.kind) {
      case 'attack':
        setTargeting({ kind: 'attack' });
        setSelected(i);
        return;
      case 'ability':
        if (needsPick(slot.ability)) {
          setTargeting({ kind: 'ability', ability: slot.ability });
          setSelected(i);
        } else {
          cancel();
          apply((g) => castAbility(g, slot.ability.id, null, combatContext));
        }
        return;
      case 'potion':
        cancel();
        apply((g) => drinkPotion(g, slot.itemId, combatContext));
        return;
      case 'defend':
        cancel();
        apply(defend);
        return;
    }
  };

  // Tiles the active merc can walk to, when not choosing a target.
  const reachable = yourTurn && actor && !targeting ? reachableTiles(combat, actor) : new Map<string, unknown>();
  const cells = Array.from({ length: combat.height }, (_, y) => Array.from({ length: combat.width }, (_, x) => ({ x, y })));

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
            if (x.summoned && x.hp === 0) return null;
            return (
              <li key={id} className={`side-${x.side}${i === combat.turn ? ' current' : ''}${x.hp === 0 ? ' down' : ''}`} title={`${x.name} (initiative ${x.initiative})`}>
                <AssetImage id={x.portrait} fallback={initials(x.name)} size={32} className="token" />
              </li>
            );
          })}
        </ol>
      </header>

      <section className="battlefield" aria-label="Battlefield">
        <div className="battlefield-stage">
          <div
            className="combat-grid"
            style={{ gridTemplateColumns: `repeat(${combat.width}, var(--cell))`, gridTemplateRows: `repeat(${combat.height}, var(--cell))` }}
          >
            {cells.flat().map((p) => {
              // Someone standing here, or failing that someone lying here.
              const here =
                combat.combatants.find((x) => x.hp > 0 && x.pos.x === p.x && x.pos.y === p.y) ??
                combat.combatants.find((x) => x.pos.x === p.x && x.pos.y === p.y);
              const obstacle = combat.obstacles.find((o) => o.pos.x === p.x && o.pos.y === p.y);
              const canWalk = reachable.has(`${p.x},${p.y}`);
              return (
                <div key={`${p.x},${p.y}`} className={`combat-cell${canWalk ? ' walkable' : ''}`}>
                  {canWalk && !here && !obstacle && (
                    <button
                      type="button"
                      className="cell-move"
                      aria-label={`Move to column ${p.x + 1}, row ${p.y + 1}`}
                      onClick={() => apply((g) => moveTo(g, p))}
                    />
                  )}
                  {obstacle && (
                    <ObstacleToken
                      o={obstacle}
                      targetable={targets.has(obstacle.id)}
                      flashes={flashes.filter((f) => f.targetId === obstacle.id)}
                      onPick={() => pick(obstacle.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="token-layer">
            {combat.combatants.filter((x) => !(x.summoned && x.hp === 0)).map((x) => (
              <div key={x.id} className="token-slot" style={pctStyle(x.pos, combat.width, combat.height)}>
                <CombatToken
                  x={x}
                  active={actor?.id === x.id}
                  targetable={targets.has(x.id)}
                  hint={targets.get(x.id)}
                  flashes={flashes.filter((f) => f.targetId === x.id)}
                  frames={frames}
                  onPick={() => pick(x.id)}
                />
              </div>
            ))}
          </div>
          <div className="projectile-layer" aria-hidden="true">
            {projectiles.map((p) => (
              <ProjectileFX key={p.key} spec={p} width={combat.width} height={combat.height} />
            ))}
          </div>
        </div>
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
                  {combat.moveLeft} of {actor.movement} moves left · {combat.acted ? 'acted' : 'can act'}
                  {combat.moveLeft > 0 && !targeting && ' · click a lit tile to move'}
                </span>
              </p>
              {targeting && (
                <p className="targeting-hint">
                  {targets.size > 0
                    ? `Choose a target for ${targeting.kind === 'attack' ? actor.attack.name : targeting.ability.name}.`
                    : 'No target in reach.'}{' '}
                  <span className="dim">Esc to cancel.</span>
                </p>
              )}
              <ActionBar
                combat={combat}
                actor={actor}
                slots={slots}
                selected={selected}
                onUse={useSlot}
                onCancel={cancel}
                onEndTurn={() => {
                  cancel();
                  apply(endTurn);
                }}
                onFlee={() => {
                  cancel();
                  apply((g) => flee(g, combatContext));
                }}
              />
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
