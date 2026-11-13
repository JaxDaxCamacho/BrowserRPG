import { useEffect, useState } from 'react';
import type { CombatEvent, DamageStyle } from '../engine';
import { loadAssetIndex } from './assets';

/**
 * Sound effects from the asset library (`sfx/...` ids). Like images, they are
 * synced locally and not committed, so a missing sound is simply silent.
 * Muting is remembered in the browser.
 */

const LIBRARY = `${import.meta.env.BASE_URL}asset-library/`;
const MUTE_KEY = 'allerya.muted';
const VOLUME = 0.55;

let files: Map<string, string> | null = null;
void loadAssetIndex().then((entries) => {
  files = new Map(entries.filter((e) => e.category.startsWith('sfx/')).map((e) => [e.id, e.file]));
});

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = readMuted();
const listeners = new Set<(m: boolean) => void>();

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Storage can be blocked; muting still works for this visit.
  }
  for (const l of listeners) l(value);
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const [value, setValue] = useState(muted);
  useEffect(() => {
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return [value, setMuted];
}

/** Plays a sound by asset id, after `delay` ms. Quietly does nothing when muted or missing. */
export function playSound(id: string | undefined, { delay = 0, volume = 1 }: { delay?: number; volume?: number } = {}): void {
  if (!id || muted) return;
  const file = files?.get(id);
  if (!file) return;
  const start = () => {
    const audio = new Audio(`${LIBRARY}${file}`);
    audio.volume = Math.min(1, VOLUME * volume);
    void audio.play().catch(() => {
      // Browsers refuse sound until the player has interacted with the page.
    });
  };
  if (delay > 0) window.setTimeout(start, delay);
  else start();
}

// ---------- what combat sounds like ----------

const HIT_BY_STYLE: Record<DamageStyle, string> = {
  slash: 'sfx/slash/evfx02-11-quickblade',
  blunt: 'sfx/impacts/beefy-impacts/beefy-impact-a',
  pierce: 'sfx/impacts/flesh-hits/flesh-hit-b',
  arcane: 'sfx/magic/shock/lightning-bolt-impact-b',
};

const MISS_BY_STYLE: Record<DamageStyle, string> = {
  slash: 'sfx/medieval/whooshes/small-blade-whoosh-a',
  blunt: 'sfx/medieval/whooshes/blunt-whoosh-a',
  pierce: 'sfx/medieval/whooshes/spear-whoosh-a',
  arcane: 'sfx/movement/whoosh/whoosh-a',
};

/** What a status event sounds like, by its label. */
const STATUS_SOUNDS: Record<string, string> = {
  poison: 'sfx/magic/dark/necrotic-touch',
  bleeding: 'sfx/impacts/flesh-hits/flesh-hit-c',
  flames: 'sfx/fire/fire-magic/fire-impact-a',
  stunned: 'sfx/impacts/punches/punch-heavy-b',
  frozen: 'sfx/magic/ice/frozen-echo',
  prone: 'sfx/impacts/falls/fall-a',
  Kicked: 'sfx/impacts/kicks/kick-medium-a',
  'Shrugged off': 'sfx/impacts/kicks/kick-swing-a',
  collision: 'sfx/impacts/exaggerated-impacts/massive-hit-stumble-a',
  retaliation: 'sfx/medieval/armor/shield-impact-a',
  cancelled: 'sfx/magic/dark/soul-shatter',
  reflected: 'sfx/magic/light/holy-ward',
  silenced: 'sfx/magic/dark/nightshade-curse',
  feared: 'sfx/magic/dark/horrify',
  taunted: 'sfx/medieval/armor/armor-salute-a',
};

function attackSound(e: CombatEvent): string {
  const ranged = e.roll?.ranged;
  const stat = e.roll?.stat;
  if (e.outcome === 'miss') {
    if (ranged) return 'sfx/movement/whoosh/whoosh-fast-a';
    return MISS_BY_STYLE[e.style ?? 'blunt'];
  }
  if (e.sound) return e.sound;
  if (stat === 'intellect') return 'sfx/magic/shock/lightning-bolt-impact-a';
  if (stat === 'spirit') return 'sfx/magic/dark/shadow-bolt-impact-a';
  if (ranged) return 'sfx/medieval/weapons/crossbow-shot-a';
  return e.style ? HIT_BY_STYLE[e.style] : 'sfx/impacts/punches/punch-medium-a';
}

/** The sound for one thing that happened in a fight. */
export function soundFor(e: CombatEvent): string | undefined {
  switch (e.kind) {
    case 'attack':
      return attackSound(e);
    case 'heal':
      return e.sound ?? 'sfx/magic/light/holy-light';
    case 'buff':
      return e.sound ?? 'sfx/magic/light/illuminate';
    case 'defend':
      return 'sfx/medieval/armor/equip-shield-a';
    case 'move':
      return 'sfx/footsteps/stone/shoe-step-stone-medium-a';
    case 'flee':
      return 'sfx/movement/whoosh/whoosh-long-airy-a';
    case 'down':
      return 'sfx/impacts/beefy-impacts/beefy-fall-a';
    case 'status':
      return e.label ? STATUS_SOUNDS[e.label] : undefined;
  }
}

/** Footsteps for a walk of a few tiles: one step a tile, a few at most. */
export function playSteps(tiles: number): void {
  const steps = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 0; i < Math.min(tiles, 4); i++) {
    playSound(`sfx/footsteps/stone/shoe-step-stone-medium-${steps[i % steps.length]}`, { delay: i * 110, volume: 0.6 });
  }
}

export const UI_SOUNDS = {
  select: 'sfx/ui/mouse/select-select-medieval-a',
  victory: 'sfx/ui/signals/positive-signal-positive-jrpg-a',
  defeat: 'sfx/ui/signals/negative-signal-negative-jrpg-a',
} as const;
