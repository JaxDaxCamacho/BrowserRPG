import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getDungeon } from '../content';
import {
  abilityTargets,
  activeCombatant,
  attackTargets,
  ATTACK_STAT,
  effectiveDefense,
  featureById,
  isAiControlled,
  kickTargets,
  isEngaged,
  obstacleTargets,
  rangePenalty,
  reachableTiles,
  rescuersExist,
  shareXp,
  statModifier,
  effectiveStats,
  type AbilityDefinition,
  type AttackOutcome,
  type AttackRoll,
  type Combatant,
  type CombatState,
  type Obstacle,
  type Pos,
  type StatusKind,
} from '../engine';
import { combatContext } from '../state/context';
import { useControl } from '../state/net';
import { useGameStore } from '../state/store';
import { AnimationPreview, AssetImage, useAssetIndex } from './assets';
import { ActionBar, needsPick, slotsFor } from './ActionBar';
import { CombatantDetails } from './CombatantDetails';
import { CombatLog, STAT_SHORT } from './CombatLog';
import { ImpactFX, type ImpactKind } from './ImpactFX';
import { StatBar } from './StatBar';
import { PartyWindow } from './PartyWindow';
import { DieFace } from './Dice';
import { MuteButton } from './MuteButton';
import { playSound, playSteps, soundFor, UI_SOUNDS } from './sound';
import { TUMBLE_MS } from './DiceTray';
import { initials } from './MercCard';

/** Pause before each enemy acts, so the player can follow the fight. */
const ENEMY_DELAY_MS = 1500;
const FLASH_MS = 1200;
/**
 * The beats of an attack: first who attacks whom is shown (AIM_MS), then the
 * dice tumble (TUMBLE_MS), rest on their result for a moment (RESULT_MS), and
 * only then does the damage land.
 */
const AIM_MS = 800;
const RESULT_MS = 500;
/** How long a projectile takes to cross the battlefield before it lands or goes wide. */
const PROJECTILE_MS = 550;
/** Battlefield squares never get smaller or larger than this, in px. Below the minimum the battlefield scrolls. */
const MIN_CELL_PX = 56;
const MAX_CELL_PX = 150;
/** The grid's own padding and border, both sides together (see .combat-grid). */
const GRID_FRAME_PX = 14;

type Targeting = { kind: 'attack' } | { kind: 'kick' } | { kind: 'ability'; ability: AbilityDefinition };

interface Flash {
  key: string;
  targetId: string;
  text: string;
  tone: 'damage' | 'heal' | 'miss' | 'buff' | 'crit' | 'slain';
  animation?: string;
  /** Shown a moment after the others on the same token, so they do not overlap. */
  late?: boolean;
  /** For attacks: how the blow landed, which picks the impact effect and the token's reaction. */
  outcome?: AttackOutcome;
  /** For attacks: the damage dealt. */
  amount?: number;
  /** A faint second line under the number, such as the armour that soaked part of the blow. */
  sub?: string;
  /** The direction the blow travelled, in radians, so blood sprays away from the attacker. */
  dir?: number;
}

/** The effect a blow leaves on whoever it lands on. */
function impactOf(outcome: AttackOutcome | undefined, damage: number): ImpactKind | null {
  if (!outcome || outcome === 'miss') return null;
  if (outcome === 'graze' || damage === 0) return 'spark';
  return outcome === 'crit' ? 'gore' : 'blood';
}

function flashesFrom(combat: CombatState, seq: number): Flash[] {
  const at = (id: string) => combat.combatants.find((x) => x.id === id)?.pos ?? combat.obstacles.find((o) => o.id === id)?.pos;
  return combat.events.flatMap((e, i): Flash[] => {
    const key = `${seq}-${i}`;
    if (e.kind === 'attack' && e.targetId) {
      const amount = e.amount ?? 0;
      const text = e.outcome === 'miss' ? 'Miss' : `${e.outcome === 'crit' ? 'Crit! ' : e.outcome === 'graze' ? 'Graze ' : ''}-${amount}`;
      const from = at(e.actorId);
      const to = at(e.targetId);
      const dir = from && to && (from.x !== to.x || from.y !== to.y) ? Math.atan2(to.y - from.y, to.x - from.x) : Math.PI / 2;
      const soaked = e.roll && e.outcome !== 'miss' && e.roll.armour > 0 ? `${e.roll.armour} soaked` : undefined;
      return [
        {
          key,
          targetId: e.targetId,
          text,
          tone: e.outcome === 'miss' ? 'miss' : e.outcome === 'crit' ? 'crit' : 'damage',
          amount,
          dir,
          ...(e.outcome ? { outcome: e.outcome } : {}),
          ...(soaked ? { sub: soaked } : {}),
          ...(e.animation ? { animation: e.animation } : {}),
        },
      ];
    }
    if (e.kind === 'heal' && e.targetId) return [{ key, targetId: e.targetId, text: `+${e.amount ?? 0}`, tone: 'heal', ...(e.animation ? { animation: e.animation } : {}) }];
    if (e.kind === 'buff' && e.targetId) return [{ key, targetId: e.targetId, text: 'Boost', tone: 'buff', ...(e.animation ? { animation: e.animation } : {}) }];
    if (e.kind === 'defend') return [{ key, targetId: e.actorId, text: 'Defend', tone: 'buff' }];
    if (e.kind === 'down') return [{ key, targetId: e.actorId, text: e.label === 'dead' ? 'Slain!' : 'Down!', tone: e.label === 'dead' ? 'slain' : 'damage', late: true }];
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
  prone: { icon: '🤕', name: 'Prone' },
  rooted: { icon: '🌿', name: 'Rooted' },
  regenerating: { icon: '💚', name: 'Regenerating' },
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

/** An obstacle dressing the battlefield (a barrel, a pillar…); destructible ones can be targeted like an enemy. */
function ObstacleToken({ o, targetable, flashes, onPick }: { o: Obstacle; targetable: boolean; flashes: Flash[]; onPick: () => void }) {
  const destructible = o.hp !== null;
  return (
    <button
      type="button"
      className={`obstacle-token${destructible ? ' destructible' : ''}${targetable ? ' targetable' : ''}`}
      disabled={!targetable}
      onClick={onPick}
      title={`${o.name}${destructible ? ` (${o.hp}/${o.maxHp} HP)` : ''}`}
      aria-label={o.name}
    >
      <AssetImage id={o.icon} fallback={o.emoji} size={56} className="obstacle-icon" />
      {destructible && o.hp !== null && o.maxHp !== null && (
        <span className="obstacle-hp">
          <span style={{ width: `${(o.hp / o.maxHp) * 100}%` }} />
        </span>
      )}
      {flashes.map((f) => (
        <span key={f.key} className="token-flash">
          {f.outcome && f.outcome !== 'miss' && <ImpactFX kind="spark" seed={f.key} />}
          <FlashText f={f} />
        </span>
      ))}
    </button>
  );
}

/** The floating number (or word) over a token, with any faint second line. */
function FlashText({ f }: { f: Flash }) {
  return (
    <span className={`flash-text tone-${f.tone}${f.late ? ' late' : ''}`}>
      {f.text}
      {f.sub && <span className="flash-sub">{f.sub}</span>}
    </span>
  );
}

/** A small health bar under a token. The trailing part lingers a moment after a blow, so the loss reads clearly. */
function TokenHealth({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
  const tone = pct > 50 ? 'good' : pct > 25 ? 'low' : 'critical';
  return (
    <span className={`token-health ${tone}`} aria-hidden="true">
      <span className="token-health-lag" style={{ width: `${pct}%` }} />
      <span className="token-health-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

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
              {roll.natural} {signed(roll.modifier)} {STAT_SHORT[roll.stat]}
              {roll.rollBonus ? ` ${signed(roll.rollBonus)} off hand` : ''}
              {roll.rangePenalty ? ` ${signed(-roll.rangePenalty)} range` : ''} = <strong>{roll.total}</strong> vs Defense {roll.defense}
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

/** The natural roll the actor needs to hit (not graze) this target, for the targeting hint. Distance counts against ranged attacks. */
function hitOn(actor: Combatant, target: Combatant, kind: keyof typeof ATTACK_STAT): number {
  const modifier = statModifier(effectiveStats(actor)[ATTACK_STAT[kind]]) - rangePenalty(kind, actor.pos, target.pos);
  return Math.min(20, Math.max(2, effectiveDefense(target) - modifier + 1));
}

interface TokenProps {
  x: Combatant;
  active: boolean;
  targetable: boolean;
  hint?: string;
  flashes: Flash[];
  frames: (id: string) => number | undefined;
  /** Shown as the merc whose action bar is on screen. */
  viewed?: boolean;
  /** Making an attack that is about to be rolled. */
  aiming?: boolean;
  /** The target of an attack about to be rolled. */
  aimed?: boolean;
  onPick: () => void;
  /** A left click that is not picking a target: select the token. */
  onSelect: () => void;
  /** A right click: two in quick succession open the details. */
  onInspect: () => void;
}

function CombatToken({ x, active, targetable, hint, flashes, frames, viewed, aiming, aimed, onPick, onSelect, onInspect }: TokenProps) {
  const down = x.hp === 0;
  // The blow that landed on this token, if one just did: it shakes (or dodges) to match.
  const blow = flashes.find((f) => f.outcome);
  const reaction = blow ? ` react-${blow.outcome}` : '';
  return (
    <button
      type="button"
      className={`combat-token side-${x.side}${active ? ' active' : ''}${viewed ? ' viewed' : ''}${aiming ? ' aiming' : ''}${aimed ? ' aimed' : ''}${targetable ? ' targetable' : ''}${down ? ' down' : ''}${x.statuses.some((st) => st.kind === 'invisible') ? ' invisible' : ''}`}
      onClick={() => (targetable ? onPick() : onSelect())}
      onContextMenu={(e) => {
        e.preventDefault();
        onInspect();
      }}
      aria-label={`${x.name}, ${x.hp} of ${x.maxHp} HP${targetable ? `, target${hint ? `: ${hint}` : ''}` : ''}. Double right-click for details.`}
      title={`${x.name}: ${down ? (x.dead ? 'dead' : 'down') : `${x.hp} / ${x.maxHp} HP`}`}
    >
      <span className="token-face">
        {/* The body tips over when the token goes down; the inner part restarts its reaction on every blow. */}
        <span className="token-body">
          <span key={blow?.key ?? 'still'} className={`token-react${reaction}`}>
            <AssetImage id={x.portrait} fallback={initials(x.name)} className="token" />
          </span>
        </span>
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
        {flashes.map((f) => {
          const impact = impactOf(f.outcome, f.amount ?? 0);
          return (
            <span key={f.key} className="token-flash">
              {f.animation && <AnimationPreview id={f.animation} frames={frames(f.animation) ?? 15} size={110} once />}
              {impact && <ImpactFX kind={impact} seed={f.key} {...(f.dir !== undefined ? { dir: f.dir } : {})} />}
              <FlashText f={f} />
            </span>
          );
        })}
      </span>
      <span className="token-name">{x.name}</span>
      <TokenHealth hp={x.hp} max={x.maxHp} />
      {targetable && hint && <span className="token-hint">{hint}</span>}
      {x.buffs.length > 0 && <span className="token-buffs dim">{x.buffs.map((b) => b.source).join(', ')}</span>}
    </button>
  );
}

export function CombatScreen() {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const backToMenu = useGameStore((s) => s.backToMenu);
  const { isClient, controls, playerOf } = useControl();
  const assets = useAssetIndex();
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  /** The merc whose action bar is shown; by default whoever is acting. */
  const [viewId, setViewId] = useState<string | null>(null);
  /** The token whose details are open. */
  const [inspecting, setInspecting] = useState<string | null>(null);
  const lastRightClick = useRef<{ id: string; at: number } | null>(null);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const [projectiles, setProjectiles] = useState<ProjectileSpec[]>([]);
  const [rolls, setRolls] = useState<ShownRoll[]>([]);
  const lastSeq = useRef(-1);
  // Squares as large as the battlefield allows for this room, so tokens and their health bars read clearly.
  const fieldRef = useRef<HTMLElement>(null);
  const [cellPx, setCellPx] = useState<number | null>(null);
  const cols = game.encounter?.combat?.width;
  const rows = game.encounter?.combat?.height;
  useEffect(() => {
    const field = fieldRef.current;
    if (!field || !cols || !rows) return;
    const fit = () => {
      const style = getComputedStyle(field);
      const width = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - GRID_FRAME_PX;
      const height = field.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - GRID_FRAME_PX;
      setCellPx(Math.round(Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, Math.min(width / cols, height / rows)))));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(field);
    return () => watch.disconnect();
  }, [cols, rows]);
  const frames = useMemo(() => {
    const map = new Map((assets ?? []).map((a) => [a.id, a.frames]));
    return (id: string) => map.get(id);
  }, [assets]);

  /** The fight as it really is. */
  const live = game.encounter?.combat;
  /**
   * The fight as shown. After an action that rolls dice it holds the moment
   * before the roll while the dice tumble, then catches up: movement, the
   * projectile and the damage play out in order instead of all at once.
   */
  const [held, setHeld] = useState<CombatState | undefined>(live);
  const combat = held && live && held.featureId === live.featureId ? held : live;
  const revealing = !!live && combat !== live;
  useEffect(() => {
    if (!live) {
      setHeld(undefined);
      return;
    }
    setHeld((prev) => {
      if (!prev || prev.featureId !== live.featureId || prev.seq === live.seq) return live;
      return prev;
    });
    const rolled = live.events.some((e) => e.kind === 'attack' || !!e.shown || e.label === 'Kicked' || e.label === 'Shrugged off');
    if (!rolled) {
      setHeld(live);
      return;
    }
    const timer = window.setTimeout(() => setHeld(live), AIM_MS + TUMBLE_MS + RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [live]);

  // While a fight is on screen, the dice wait for the attack to be shown first.
  const setDiceDelay = useGameStore((s) => s.setDiceDelay);
  useEffect(() => {
    setDiceDelay(AIM_MS);
    return () => setDiceDelay(0);
  }, [setDiceDelay]);

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
    // Only the game that owns the state (alone, or the host) runs the fight.
    if (!isClient && game.encounter && !game.encounter.combat) dispatch({ type: 'startCombat' });
  }, [game.encounter, dispatch, isClient]);

  // Play the last action's animations, numbers and projectiles.
  useEffect(() => {
    if (!combat || combat.seq === lastSeq.current) return;
    lastSeq.current = combat.seq;
    const nextFlashes = flashesFrom(combat, combat.seq);
    const nextShots = projectilesFrom(combat, combat.seq);
    let flashTimer: number | undefined;
    let shotTimer: number | undefined;
    let showTimer: number | undefined;
    // A shot lands before its damage shows (and is heard).
    const wait = nextShots.length > 0 ? PROJECTILE_MS : 0;
    for (const e of combat.events) {
      if (e.kind === 'move') playSteps(3);
      else playSound(soundFor(e), { delay: e.kind === 'attack' && e.roll?.ranged ? wait : 0 });
    }
    if (nextFlashes.length > 0) {
      // Long spell effects get the time to play out, within reason.
      const longest = Math.max(0, ...nextFlashes.map((f) => (f.animation ? ((frames(f.animation) ?? 15) * 1000) / 15 : 0)));
      const linger = Math.min(2500, Math.max(FLASH_MS, longest));
      showTimer = window.setTimeout(() => {
        setFlashes(nextFlashes);
        flashTimer = window.setTimeout(() => setFlashes([]), linger);
      }, wait);
    }
    if (nextShots.length > 0) {
      setProjectiles(nextShots);
      shotTimer = window.setTimeout(() => setProjectiles([]), PROJECTILE_MS + 150);
    }
    return () => {
      if (showTimer) window.clearTimeout(showTimer);
      if (flashTimer) window.clearTimeout(flashTimer);
      if (shotTimer) window.clearTimeout(shotTimer);
    };
  }, [combat, frames]);

  // The end of a fight has its own sound.
  const shownOutcome = combat?.outcome;
  useEffect(() => {
    if (shownOutcome === 'victory') playSound(UI_SOUNDS.victory);
    else if (shownOutcome === 'defeat') playSound(UI_SOUNDS.defeat);
  }, [shownOutcome]);

  // Enemies (and summons) take their turns by themselves, one step at a time, each once the last has played out.
  const actor = live && !live.outcome ? activeCombatant(live) : null;
  const enemyTurnKey = actor && isAiControlled(actor) && !revealing && !isClient ? `${live!.round}-${live!.turn}-${live!.seq}` : null;
  useEffect(() => {
    if (!enemyTurnKey) return;
    const timer = window.setTimeout(() => dispatch({ type: 'enemyStep' }), ENEMY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enemyTurnKey, dispatch]);

  // A new turn clears any half-chosen action.
  useEffect(() => {
    setTargeting(null);
    setSelected(null);
    setViewId(null);
  }, [live?.turn, live?.round]);


  if (!game.encounter || !combat || !live || !game.dungeon) return <main className="screen">Preparing the fight…</main>;

  // Who is attacking whom, shown while the dice are out.
  const aim = { attackers: new Set<string>(), targets: new Set<string>(), lines: [] as { key: string; from: Pos; to: Pos }[] };
  if (revealing) {
    const at = (id: string) => combat.combatants.find((x) => x.id === id)?.pos ?? combat.obstacles.find((o) => o.id === id)?.pos;
    live.events.forEach((e, i) => {
      const aimed = e.kind === 'attack' || (e.kind === 'status' && (e.label === 'Kicked' || e.label === 'Shrugged off'));
      if (!aimed || !e.targetId) return;
      aim.attackers.add(e.actorId);
      aim.targets.add(e.targetId);
      const from = at(e.actorId);
      const to = at(e.targetId);
      if (from && to && e.actorId !== e.targetId) aim.lines.push({ key: `${live.seq}-${i}`, from, to });
    });
  }

  const def = getDungeon(game.dungeon.dungeonId);
  const feature = featureById(def, live.featureId);
  // Your turn: a merc you play is acting. In co-op, other players' mercs act on their own screens.
  const yourTurn = !!actor && !isAiControlled(actor) && controls(actor.mercId);
  // The bar shows the selected merc, or else whoever is acting; only the acting merc's bar can be used.
  const picked = viewId ? live.combatants.find((x) => x.id === viewId && x.side === 'party' && !x.summoned) : undefined;
  const viewed = picked ?? (yourTurn ? actor : undefined);
  const usable = !!viewed && yourTurn && viewed.id === actor!.id && !revealing;
  const viewedMerc = viewed ? live.mercs.find((m) => m.id === viewed.mercId) : undefined;
  // Health as shown, so the bar drops when the blow lands rather than before the dice.
  const viewedShown = viewed ? combat.combatants.find((x) => x.id === viewed.id) : undefined;

  /** Two right clicks on the same token within a short while open its details. */
  const rightClick = (id: string) => {
    const now = Date.now();
    const last = lastRightClick.current;
    if (last && last.id === id && now - last.at < 450) {
      lastRightClick.current = null;
      setInspecting(id);
    } else {
      lastRightClick.current = { id, at: now };
    }
  };

  // Who can be picked right now, and the roll needed against each.
  const targets = new Map<string, string>();
  if (yourTurn && targeting && actor && !revealing) {
    if (targeting.kind === 'attack') {
      for (const t of attackTargets(live, actor)) {
        const dis = actor.attack.range > 0 && isEngaged(live, actor);
        targets.set(t.id, `hit on ${hitOn(actor, t, actor.attack.profile.kind)}+${dis ? ', disadvantage' : ''}`);
      }
      for (const o of obstacleTargets(live, actor)) targets.set(o.id, 'destroy');
    } else if (targeting.kind === 'kick') {
      for (const t of kickTargets(live, actor)) targets.set(t.id, `push on ${Math.min(20, Math.max(2, effectiveDefense(t) + 1))}+`);
    } else {
      const ability = targeting.ability;
      const kind = ability.weaponAttack ? actor.attack.profile.kind : ability.attack?.kind;
      for (const t of abilityTargets(live, actor, ability)) {
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
    if (targeting.kind === 'attack') dispatch({ type: 'attack', targetId: id });
    else if (targeting.kind === 'kick') dispatch({ type: 'kick', targetId: id });
    else dispatch({ type: 'cast', abilityId: targeting.ability.id, targetId: id });
    cancel();
  };

  const slots = viewed ? slotsFor(viewed, viewedMerc) : { bar: [], extras: [] };
  const allSlots = [...slots.bar, ...slots.extras];
  const useSlot = (i: number) => {
    const slot = allSlots[i];
    if (!slot || !actor || !usable) return;
    if (slot.kind !== 'empty') playSound(UI_SOUNDS.select, { volume: 0.5 });
    switch (slot.kind) {
      case 'attack':
        setTargeting({ kind: 'attack' });
        setSelected(i);
        return;
      case 'kick':
        setTargeting({ kind: 'kick' });
        setSelected(i);
        return;
      case 'empty':
        return;
      case 'ability':
        if (needsPick(slot.ability)) {
          setTargeting({ kind: 'ability', ability: slot.ability });
          setSelected(i);
        } else {
          cancel();
          dispatch({ type: 'cast', abilityId: slot.ability.id, targetId: null });
        }
        return;
      case 'potion':
        cancel();
        dispatch({ type: 'drink', itemId: slot.itemId });
        return;
      case 'defend':
        cancel();
        dispatch({ type: 'defend' });
        return;
    }
  };

  // Tiles the active merc can walk to, when not choosing a target.
  const reachable = yourTurn && actor && !targeting && !revealing ? reachableTiles(live, actor) : new Map<string, unknown>();
  const cells = Array.from({ length: combat.height }, (_, y) => Array.from({ length: combat.width }, (_, x) => ({ x, y })));

  return (
    <main className="combat">
      <header className="combat-bar">
        <h1>{feature.name}</h1>
        <span className="dim">
          Round {combat.round}
          {combat.ambush ? ' · ambush' : ''}
          {game.dungeon.world && ` · world round ${game.dungeon.world.round}`}
          {(game.otherEncounters?.length ?? 0) > 0 &&
            ` · ${game.otherEncounters!.length} other fight${game.otherEncounters!.length === 1 ? '' : 's'} going on`}
        </span>
        <MuteButton />
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

      <div className="combat-main">
        <CombatLog combat={combat} />
        <section ref={fieldRef} className="battlefield" aria-label="Battlefield">
          <div className="battlefield-stage" style={cellPx ? ({ '--cell': `${cellPx}px` } as CSSProperties) : undefined}>
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
                        onClick={() => dispatch({ type: 'move', to: p })}
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
                    viewed={viewed?.id === x.id && viewed.id !== actor?.id}
                    aiming={aim.attackers.has(x.id)}
                    aimed={aim.targets.has(x.id)}
                    onPick={() => pick(x.id)}
                    onSelect={() => {
                      if (x.side === 'party' && !x.summoned && !targeting) setViewId(x.id === actor?.id ? null : x.id);
                    }}
                    onInspect={() => rightClick(x.id)}
                  />
                </div>
              ))}
            </div>
            {aim.lines.length > 0 && (
              <svg className="aim-layer" viewBox={`0 0 ${combat.width} ${combat.height}`} preserveAspectRatio="none" aria-hidden="true">
                {aim.lines.map((l) => (
                  <line key={l.key} x1={l.from.x + 0.5} y1={l.from.y + 0.5} x2={l.to.x + 0.5} y2={l.to.y + 0.5} className="aim-line" vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
            )}
            <div className="projectile-layer" aria-hidden="true">
              {projectiles.map((p) => (
                <ProjectileFX key={p.key} spec={p} width={combat.width} height={combat.height} />
              ))}
            </div>
          </div>
        </section>
      </div>

      <footer className="combat-footer">
        <div className="combat-actions">
          {combat.outcome ? (
            <Outcome combat={combat} onContinue={() => dispatch({ type: 'finishCombat' })}
              onRetry={() => dispatch({ type: 'retryCombat' })}
              {...(game.encounter && rescuersExist(game, game.encounter) && game.dungeon.otherGroups?.length ? { onCarryOn: () => dispatch({ type: 'leaveTheFallen' }) } : {})} onMenu={backToMenu} />
          ) : viewed ? (
            <>
              <p className="turn-title">
                <strong>{viewed.name}</strong>
                <span className="dim">
                  {usable ? (
                    <>
                      {live.moveLeft} of {viewed.movement} moves left · {live.acted ? 'acted' : 'can act'}
                      {live.moveLeft > 0 && !targeting && ' · click a lit tile to move'}
                    </>
                  ) : (
                    <>Looking at {viewed.name}’s actions · {actor ? `${actor.name} is acting` : ''}</>
                  )}
                </span>
                {!usable && (
                  <button type="button" className="link-button" onClick={() => setViewId(null)}>
                    Back
                  </button>
                )}
              </p>
              {viewedShown && (
                <div className="turn-vitals">
                  <StatBar kind="hp" current={viewedShown.hp} max={viewedShown.maxHp} />
                </div>
              )}
              {targeting && actor && (
                <p className="targeting-hint">
                  {targets.size > 0
                    ? `Choose a target for ${targeting.kind === 'attack' ? actor.attack.name : targeting.kind === 'kick' ? 'Kick' : targeting.ability.name}.`
                    : 'No target in reach.'}{' '}
                  <span className="dim">Esc to cancel.</span>
                </p>
              )}
              <ActionBar
                combat={live}
                actor={viewed}
                bar={slots.bar}
                extras={slots.extras}
                usable={usable}
                selected={selected}
                onUse={useSlot}
                onCancel={cancel}
                onEndTurn={() => {
                  cancel();
                  dispatch({ type: 'endTurn' });
                }}
                onFlee={() => {
                  cancel();
                  dispatch({ type: 'flee' });
                }}
              />
            </>
          ) : (
            <p className="turn-title dim">
              {actor
                ? `${actor.name} is acting${playerOf(actor.mercId) && playerOf(actor.mercId) !== 'you' ? ` (played by ${playerOf(actor.mercId)})` : ''}… Click one of your mercs to see their actions.`
                : ''}
            </p>
          )}
        </div>
        <RollReadout rolls={rolls} />
      </footer>
      {inspecting &&
        (() => {
          const x = combat.combatants.find((k) => k.id === inspecting);
          if (!x) return null;
          if (x.mercId) return <PartyWindow readOnly initialMercId={x.mercId} fight={combat.combatants} onClose={() => setInspecting(null)} />;
          return <CombatantDetails x={x} onClose={() => setInspecting(null)} />;
        })()}
    </main>
  );
}

function Outcome({
  combat,
  onContinue,
  onRetry,
  onMenu,
  onCarryOn,
}: {
  combat: CombatState;
  onContinue: () => void;
  onRetry: () => void;
  onMenu: () => void;
  /** With the party split and others still standing: leave the fallen and carry on. */
  onCarryOn?: () => void;
}) {
  if (combat.outcome === 'defeat' && onCarryOn) {
    return (
      <div className="outcome">
        <p className="turn-title">
          <strong>Everyone in this fight has fallen.</strong>
          <span className="dim"> The rest of the party is still out there and can come to the rescue.</span>
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={onCarryOn}>
            Carry on with the others
          </button>
        </div>
      </div>
    );
  }
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
