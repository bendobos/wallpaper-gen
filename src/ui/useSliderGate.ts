import { useRef } from 'react';

/** Horizontal travel a finger must cover before a slider starts responding. */
const TOUCH_DRAG_THRESHOLD = 6;

/**
 * Makes a range input ignore taps from a finger while leaving mouse and
 * keyboard alone.
 *
 * Tapping the track would otherwise jump the value to wherever the finger
 * landed, which fires constantly when tapping to stop a flick-scroll. Gating on
 * `pointerType` per event rather than on a device media query means a laptop
 * with a touchscreen keeps precise click-to-position with the mouse and only
 * requires the drag when using a finger.
 *
 * Spread `handlers` onto the input and route its onChange through `accept`.
 */
export function useSliderGate(onCommitStart?: () => void) {
  // null means "not a pointer gesture" (keyboard), which is always allowed.
  const drag = useRef<{ active: boolean; startX: number } | null>(null);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const isTouch = e.pointerType === 'touch';
      drag.current = { active: !isTouch, startX: e.clientX };
      if (!isTouch) onCommitStart?.();
    },

    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || d.active) return;
      if (Math.abs(e.clientX - d.startX) >= TOUCH_DRAG_THRESHOLD) {
        d.active = true;
        onCommitStart?.();
      }
    },

    // Fires on release, and also when the browser claims the gesture for
    // scrolling. Stays as a blocking record rather than resetting to null: the
    // slider can still emit one more input event after the gesture ends, and
    // null would wave it through as if it were a keystroke.
    onPointerUp: () => {
      drag.current = { active: false, startX: 0 };
    },
    onPointerCancel: () => {
      drag.current = { active: false, startX: 0 };
    },

    onKeyDown: () => {
      drag.current = null;
      onCommitStart?.();
    },
  };

  /** Runs `apply` only if the current gesture is allowed to change the value. */
  const accept = (value: number, apply: (v: number) => void) => {
    if (drag.current && !drag.current.active) return;
    apply(value);
  };

  return { handlers, accept };
}
