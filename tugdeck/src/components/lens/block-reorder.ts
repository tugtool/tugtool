/**
 * block-reorder.ts — `useBlockReorder`, the FLIP drag lifecycle for Lens
 * section reordering ([P08], Spec S01).
 *
 * Replaces the old bare flex-`order` preview with hand-rolled FLIP visuals,
 * all DOM/CSS with a single store write on drop:
 *
 *  - **pointerdown on a grip** ghosts the dragged `.lens-section`
 *    (`data-dragging` → opacity/scale/raised-z/`pointer-events:none`, the CSS
 *    lives in `lens-section-band.css`) and snapshots the visible order + each
 *    section's rect.
 *  - **pointermove** translates the dragged band to follow the pointer
 *    (inline `transform`, no transition — instant), computes the target index
 *    from the snapshotted midpoints, shifts the non-dragged siblings by the
 *    dragged's slot to close the vacated gap / open the target slot
 *    (`transition: transform ease`), and positions the `BlockDropCaret` in
 *    the opened gap.
 *  - **pointerup** commits `setSectionOrder` only if the index changed, then
 *    FLIPs every section from its pre-commit visual into its committed slot
 *    (measure → `flushSync(commit)` → measure → invert → play), so the band
 *    settles into place with no jump even though sections have unequal
 *    heights. An unchanged index (or Escape) animates back and commits
 *    nothing.
 *  - **Escape** aborts locally: the handler's own capture-phase keydown
 *    listener swallows the key (so the Lens `CANCEL_DIALOG` responder never
 *    sees it) and animates the drag back without committing.
 *
 * No React state changes mid-drag — appearance is inline `transform` +
 * `data-*` + CSS transitions ([L06]/[L08]); the store commit and the
 * FocusManager group-order re-sync remain drop-time only ([L22], driven off
 * the store by the caller's order effect, which `flushSync` runs at drop).
 *
 * @module components/lens/block-reorder
 */

import React from "react";
import { flushSync } from "react-dom";

import { moveInArray } from "./lens-section-registry";

/** Close-up / settle duration (Spec S01: 120–160ms ease). */
const SETTLE_MS = 140;
/** Slack after the settle before inline transitions are cleared. */
const SETTLE_CLEAR_MS = SETTLE_MS + 60;

const SECTION_SELECTOR = ".lens-section[data-lens-section]";
const KIND_ATTR = "data-lens-section";

export interface UseBlockReorderOptions {
  /** The `.lens-sections` container (the sections' offset parent + the caret's). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The persistently-mounted `BlockDropCaret` element to drive imperatively. */
  caretRef: React.RefObject<HTMLDivElement | null>;
  /** The current visible section order (kinds), read fresh at drag start. */
  getVisibleOrder: () => string[];
  /** Commit the new visible order — the ONLY store write, on drop ([L08]). */
  commit: (newVisibleOrder: readonly string[]) => void;
}

export interface UseBlockReorder {
  /** Begin a reorder drag from `kind`'s grip. */
  onGripPointerDown: (kind: string, event: React.PointerEvent) => void;
}

export function useBlockReorder({
  containerRef,
  caretRef,
  getVisibleOrder,
  commit,
}: UseBlockReorderOptions): UseBlockReorder {
  // Latest-ref mirrors so the stable callback reads current inputs ([L07]).
  const getVisibleOrderRef = React.useRef(getVisibleOrder);
  const commitRef = React.useRef(commit);
  React.useLayoutEffect(() => {
    getVisibleOrderRef.current = getVisibleOrder;
    commitRef.current = commit;
  });

  const draggingRef = React.useRef(false);

  const onGripPointerDown = React.useCallback(
    (kind: string, event: React.PointerEvent) => {
      if (draggingRef.current) return;
      const container = containerRef.current;
      if (container === null) return;
      event.preventDefault();

      const visible = getVisibleOrderRef.current();
      const dragIndex = visible.indexOf(kind);
      if (dragIndex < 0) return;

      // kind → element, in visible order.
      const elByKind = new Map<string, HTMLElement>();
      for (const el of Array.from(
        container.querySelectorAll<HTMLElement>(SECTION_SELECTOR),
      )) {
        const k = el.getAttribute(KIND_ATTR);
        if (k !== null) elByKind.set(k, el);
      }
      const els = visible.map((k) => elByKind.get(k));
      if (els.some((e) => e === undefined)) return;
      const sections = els as HTMLElement[];

      const n = visible.length;
      const containerTop = container.getBoundingClientRect().top;
      const rects = sections.map((el) => el.getBoundingClientRect());
      const tops = rects.map((r) => r.top);
      const bottoms = rects.map((r) => r.bottom);
      const midpoints = rects.map((r) => r.top + r.height / 2);
      // The dragged's occupied vertical advance (height + any inter-section gap).
      const slot =
        dragIndex + 1 < n
          ? tops[dragIndex + 1] - tops[dragIndex]
          : dragIndex > 0
            ? tops[dragIndex] - tops[dragIndex - 1]
            : rects[dragIndex].height;

      const dragged = sections[dragIndex];
      const caret = caretRef.current;
      const startY = event.clientY;
      let targetIndex = dragIndex;

      draggingRef.current = true;
      dragged.setAttribute("data-dragging", "true");
      dragged.style.transition = "none";

      const shiftFor = (i: number, target: number): number => {
        if (i === dragIndex) return 0;
        if (target > dragIndex && i > dragIndex && i <= target) return -slot;
        if (target < dragIndex && i >= target && i < dragIndex) return slot;
        return 0;
      };

      const applyShift = (target: number): void => {
        for (let i = 0; i < n; i++) {
          if (i === dragIndex) continue;
          const ty = shiftFor(i, target);
          const el = sections[i];
          el.style.transition = `transform ${SETTLE_MS}ms ease`;
          el.style.transform = ty === 0 ? "" : `translateY(${ty}px)`;
        }
        if (caret !== null) {
          if (target === dragIndex) {
            caret.removeAttribute("data-visible");
          } else {
            // The opened gap sits at the target section's near edge: its top
            // when inserting above it (drag up), its bottom when below (drag
            // down). Both land inside the slot the siblings just opened.
            const edge = target <= dragIndex ? tops[target] : bottoms[target];
            caret.style.top = `${edge - containerTop - 1}px`;
            caret.setAttribute("data-visible", "true");
          }
        }
      };

      const computeTarget = (clientY: number): number => {
        for (let i = 0; i < n; i++) {
          if (clientY < midpoints[i]) return i;
        }
        return n - 1;
      };

      const onMove = (ev: PointerEvent): void => {
        dragged.style.transform = `translateY(${ev.clientY - startY}px) scale(0.99)`;
        const t = computeTarget(ev.clientY);
        if (t !== targetIndex) {
          targetIndex = t;
          applyShift(t);
        }
      };

      const clearInline = (): void => {
        for (const el of sections) {
          el.style.transition = "";
          el.style.transform = "";
        }
      };

      // Animate every section from its current transform back to none, then
      // clear — used for an abort or an unchanged-index drop (no commit).
      const settleBack = (): void => {
        for (const el of sections) {
          el.style.transition = `transform ${SETTLE_MS}ms ease`;
          el.style.transform = "";
        }
        dragged.removeAttribute("data-dragging");
        caret?.removeAttribute("data-visible");
        window.setTimeout(() => {
          for (const el of sections) el.style.transition = "";
          draggingRef.current = false;
        }, SETTLE_CLEAR_MS);
      };

      // FLIP the commit: snapshot the pre-commit visual, reorder synchronously,
      // then invert → play so each section slides from where it looked into
      // its committed slot (jump-free across unequal heights).
      const settleCommit = (): void => {
        const newVisible = moveInArray(visible, dragIndex, targetIndex);
        const first = new Map<string, number>();
        for (const [k, el] of elByKind) first.set(k, el.getBoundingClientRect().top);

        clearInline();
        dragged.removeAttribute("data-dragging");
        caret?.removeAttribute("data-visible");

        flushSync(() => commitRef.current(newVisible));

        for (const [k, el] of elByKind) {
          const last = el.getBoundingClientRect().top;
          const dy = (first.get(k) ?? last) - last;
          el.style.transition = "none";
          el.style.transform = dy === 0 ? "" : `translateY(${dy}px)`;
        }
        // Force a reflow so the inverted transform is the animation's start,
        // then play to none on the next frame.
        void container.offsetHeight;
        requestAnimationFrame(() => {
          for (const el of elByKind.values()) {
            el.style.transition = `transform ${SETTLE_MS}ms ease`;
            el.style.transform = "";
          }
          window.setTimeout(() => {
            for (const el of elByKind.values()) el.style.transition = "";
            draggingRef.current = false;
          }, SETTLE_CLEAR_MS);
        });
      };

      const detach = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKey, true);
      };

      const onUp = (): void => {
        detach();
        if (targetIndex !== dragIndex) settleCommit();
        else settleBack();
      };

      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key !== "Escape") return;
        // Keep the abort local: swallow Escape so the Lens `CANCEL_DIALOG`
        // responder does not also fire (which would focus the Lens out).
        ev.preventDefault();
        ev.stopImmediatePropagation();
        detach();
        settleBack();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey, true);
    },
    [containerRef, caretRef],
  );

  return { onGripPointerDown };
}
