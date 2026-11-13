import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 8;

/**
 * Hover and focus handlers for something that shows a tooltip, and where it is.
 * Spread `bind` onto the element and render <Tip anchor={anchor}> next to it.
 */
export function useTip() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const show = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => setAnchor(e.currentTarget.getBoundingClientRect());
  const hide = () => setAnchor(null);
  return { anchor, bind: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide } };
}

/**
 * A tooltip drawn on top of everything, above its anchor, or below it when
 * there is no room above, and always kept inside the window so it can be read.
 */
export function Tip({ anchor, children }: { anchor: DOMRect | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      setPos(null);
      return;
    }
    const { width, height } = ref.current.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - MARGIN;
    const left = Math.max(MARGIN, Math.min(maxLeft, anchor.left + anchor.width / 2 - width / 2));
    let top = anchor.top - height - MARGIN;
    if (top < MARGIN) top = anchor.bottom + MARGIN;
    top = Math.max(MARGIN, Math.min(window.innerHeight - height - MARGIN, top));
    setPos({ left, top });
  }, [anchor, children]);

  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      className="floating-tip"
      role="tooltip"
      // Measured first while hidden, then placed.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
