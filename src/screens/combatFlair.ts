import type { StatusKind } from '../engine';

/** How each condition shows on a token. */
export const STATUS_FLAIR: Record<StatusKind, { icon: string; name: string }> = {
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
