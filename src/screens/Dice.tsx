/**
 * Every die rolled in this game is a d20 (attacks, checks, saves, initiative),
 * so these two components cover every roll in the UI: a settled face showing
 * the result, and a tumbling frame for while it's still rolling.
 */
const DICE_PATH = '/dice';
const ROLL_FRAMES = 8;

export function DieFace({ value, className = '' }: { value: number; className?: string }) {
  return <img src={`${DICE_PATH}/face-${value}.png`} alt="" draggable={false} className={`die-face ${className}`} />;
}

export function DieRolling({ frame, className = '' }: { frame: number; className?: string }) {
  const n = (((frame % ROLL_FRAMES) + ROLL_FRAMES) % ROLL_FRAMES) + 1;
  return <img src={`${DICE_PATH}/roll-${n}.png`} alt="" draggable={false} className={`die-face ${className}`} />;
}
