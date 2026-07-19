import { useLayoutEffect, useRef } from "react";

// FLIP: animate elements that moved between two renders.
//
// Grid/flex reflow is not animatable in CSS — when a choice is re-placed into a
// different cell it simply jumps. This measures each opted-in element before and
// after the reflow, offsets it back to where it was, then releases it so the
// browser animates it into its new home.
//
// Elements opt in with a `data-flip-key` attribute. Newly added elements have no
// previous position and are left alone (give them their own entry animation);
// removed elements are simply gone.
//
// Only the position is animated, never the size, so callers should keep an
// element's box the same across the two states (otherwise it will snap in size
// while sliding).
export function useFlip(containerRef, signature, { duration = 280 } = {}) {
  const previousRectsRef = useRef(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const nodes = container.querySelectorAll("[data-flip-key]");
    const previousRects = previousRectsRef.current;
    const nextRects = new Map();

    nodes.forEach(node => {
      const key = node.getAttribute("data-flip-key");
      const rect = node.getBoundingClientRect();

      nextRects.set(key, rect);

      const previousRect = previousRects.get(key);

      if (!previousRect) return;

      const dx = previousRect.left - rect.left;
      const dy = previousRect.top - rect.top;

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

      // Invert: drop the element back onto its old position with no transition...
      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      // ...flush that, so releasing the transform below animates from it.
      node.getBoundingClientRect();

      node.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
      node.style.transform = "";
    });

    previousRectsRef.current = nextRects;
  }, [containerRef, duration, signature]);
}
