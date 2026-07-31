/**
 * block-reorder.ts — `useBlockReorder`, the FLIP drag lifecycle for Lens
 * section reordering ([P08], Spec S01).
 *
 * The whole row is the handle. There is no grip: a pointerdown anywhere on a
 * row that is not a control ARMS a drag, and travel past
 * {@link DRAG_THRESHOLD_PX} ENGAGES it. Below the threshold the gesture is
 * still a click, so a row keeps its click and its double-click; past it the
 * row is being carried. Distance is what tells the two apart, rather than
 * which pixels were pressed — which is what lets one surface answer to both.
 *
 * Where a row's surface is ALSO a native drag source (a snippet's incipit,
 * dragged into a session prompt) the axis arbitrates as well: the list is a
 * column, so a vertical act is the carry and a horizontal one is the drag-out
 * (see `nativeDragSource`).
 *
 * The lifecycle, all DOM/CSS with a single store write on drop:
 *
 *  - **engage** ghosts the dragged `.lens-section`
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

/**
 * How far the pointer travels before a press on a row becomes a carry. Under
 * it the gesture is still a click — which is the whole reason the row can be
 * both the thing you pick and the thing you drag.
 */
const DRAG_THRESHOLD_PX = 4;

/**
 * Parts of a row that own the pointer themselves: the slot picker, a close
 * box, a copy button, the band's fold chevron and filter field. A press on one
 * of these is that control's gesture and never arms a reorder — which is what
 * "the whole row except its controls" means, stated once.
 */
const CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  '[role="button"]',
  '[contenteditable="true"]',
  '[data-slot="tug-filter-field"]',
].join(", ");

export interface UseBlockReorderOptions {
  /** The `.lens-sections` container (the sections' offset parent + the caret's). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The persistently-mounted `BlockDropCaret` element to drive imperatively. */
  caretRef: React.RefObject<HTMLDivElement | null>;
  /** The current visible section order (kinds), read fresh at drag start. */
  getVisibleOrder: () => string[];
  /** Commit the new visible order — the ONLY store write, on drop ([L08]). */
  commit: (newVisibleOrder: readonly string[]) => void;
  /**
   * CSS selector matching each reorderable child within the container.
   * Defaults to the Lens-section selector; other clients (e.g. the Snippets
   * section's rows) pass their own so the same FLIP reorder drives any list.
   */
  selector?: string;
  /** Attribute on each child holding its stable key. Defaults to the Lens one. */
  kindAttr?: string;
  /**
   * The row's content is ALSO a native HTML5 drag source (a snippet's incipit,
   * dragged into a session prompt). Canceling a pointerdown suppresses the
   * mousedown the browser starts that drag from, so an arm on such a row must
   * leave the browser's defaults alone and arbitrate at `dragstart` instead.
   *
   * The cost of not claiming the press is that the enclosing list commits its
   * selection immediately rather than on the click — which is what a snippet
   * row wants anyway, since selecting one costs nothing. A row whose selection
   * is expensive (a Sessions row fronts its card) leaves this off, and its
   * selection waits to find out whether the press was a click.
   */
  nativeDragSource?: boolean;
}

export interface UseBlockReorder {
  /**
   * Arm a reorder from `kind`'s own row surface. Wire it to the row's
   * `onPointerDown`: presses on the row's controls are ignored, and the drag
   * engages only once the pointer has travelled vertically past the threshold,
   * so the row's click / double-click / native drag-out are all untouched.
   */
  onRowPointerDown: (kind: string, event: React.PointerEvent) => void;
}

export function useBlockReorder({
  containerRef,
  caretRef,
  getVisibleOrder,
  commit,
  selector = SECTION_SELECTOR,
  kindAttr = KIND_ATTR,
  nativeDragSource = false,
}: UseBlockReorderOptions): UseBlockReorder {
  // Latest-ref mirrors so the stable callback reads current inputs ([L07]).
  const getVisibleOrderRef = React.useRef(getVisibleOrder);
  const commitRef = React.useRef(commit);
  React.useLayoutEffect(() => {
    getVisibleOrderRef.current = getVisibleOrder;
    commitRef.current = commit;
  });

  const draggingRef = React.useRef(false);

  // Engage: the pointer has committed to a carry. Everything below runs from
  // the ORIGINAL pointerdown position, so the row picks up where it was
  // pressed rather than jumping to where the threshold was crossed.
  const beginDrag = React.useCallback(
    (kind: string, startY: number, currentY: number) => {
      if (draggingRef.current) return;
      const container = containerRef.current;
      if (container === null) return;

      const visible = getVisibleOrderRef.current();
      const dragIndex = visible.indexOf(kind);
      if (dragIndex < 0) return;

      // kind → element, in visible order.
      const elByKind = new Map<string, HTMLElement>();
      for (const el of Array.from(
        container.querySelectorAll<HTMLElement>(selector),
      )) {
        const k = el.getAttribute(kindAttr);
        if (k !== null) elByKind.set(k, el);
      }
      const els = visible.map((k) => elByKind.get(k));
      if (els.some((e) => e === undefined)) return;
      const sections = els as HTMLElement[];

      const n = visible.length;
      const containerRect = container.getBoundingClientRect();
      const containerTop = containerRect.top;
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
      let targetIndex = dragIndex;

      draggingRef.current = true;
      dragged.setAttribute("data-dragging", "true");
      dragged.style.transition = "none";
      // The press that started this was a plain press on text, so it may have
      // begun a selection and the browser would keep extending it for the
      // length of the carry. Drop what it took and suppress selection in the
      // container until the drop ([L06] — an attribute plus a CSS rule).
      container.setAttribute("data-reordering", "true");
      window.getSelection()?.removeAllRanges();

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

      // Keep the dragged element within the container's bounds — its top may
      // not rise above the container top, nor its bottom fall below the
      // container bottom. Without this the row/section follows the pointer out
      // of the list entirely. The target index still comes from the raw
      // pointer (bounded to `[0, n-1]` by `computeTarget`), so a drag past the
      // edge still drops at the nearest end.
      const draggedRect = rects[dragIndex];
      const minDy = containerRect.top - draggedRect.top;
      const maxDy = containerRect.bottom - draggedRect.bottom;
      const clampDy = (dy: number): number =>
        Math.max(minDy, Math.min(maxDy, dy));

      const moveTo = (clientY: number): void => {
        const dy = clampDy(clientY - startY);
        dragged.style.transform = `translateY(${dy}px) scale(0.99)`;
        const t = computeTarget(clientY);
        if (t !== targetIndex) {
          targetIndex = t;
          applyShift(t);
        }
      };
      const onMove = (ev: PointerEvent): void => moveTo(ev.clientY);

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
        container.removeAttribute("data-reordering");
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
        container.removeAttribute("data-reordering");
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

      // An engaged carry is a DRAG, never a row activation — but the pointerup
      // still spawns a trailing `click` on the cell under the pointer, which the
      // list would read as a select/activate (e.g. front the session card, or
      // focus a band's list). Swallow that one click at capture phase so a drop
      // never activates a row. One-shot: it removes itself the moment it fires,
      // and a post-up fallback clears it if no click follows.
      const swallowNextClick = (ev: MouseEvent): void => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        window.removeEventListener("click", swallowNextClick, true);
      };
      const clearSwallow = (): void => {
        window.setTimeout(
          () => window.removeEventListener("click", swallowNextClick, true),
          0,
        );
      };

      const detach = (): void => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("keydown", onKey, true);
      };

      const onUp = (): void => {
        detach();
        clearSwallow();
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
        clearSwallow();
        settleBack();
      };

      window.addEventListener("click", swallowNextClick, true);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("keydown", onKey, true);

      // The move that engaged the drag is spent — it was consumed deciding
      // this IS a drag — so replay it here. Without it a gesture whose whole
      // travel arrives in one move (a synthesized drag, a fast flick) would
      // engage and then never be told where the pointer went.
      moveTo(currentY);
    },
    [containerRef, caretRef, selector, kindAttr],
  );

  // Arm: a press on the row's own surface. Nothing has been decided yet — the
  // gesture is still a click until the pointer says otherwise.
  const onRowPointerDown = React.useCallback(
    (kind: string, event: React.PointerEvent) => {
      if (draggingRef.current) return;
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(CONTROL_SELECTOR) !== null) {
        return;
      }
      // Claim the press. The enclosing list reads `defaultPrevented` as "this
      // gesture has not decided what it is yet" and holds its selection until
      // the click, so a carry never selects the row it is carrying. Skipped on
      // a row that is also a native drag source — see `nativeDragSource`.
      if (!nativeDragSource) event.preventDefault();

      const startX = event.clientX;
      const startY = event.clientY;
      let dx = 0;
      let dy = 0;
      let armed = true;

      const disarm = (): void => {
        armed = false;
        window.removeEventListener("pointermove", onArmMove);
        window.removeEventListener("pointerup", disarm);
        window.removeEventListener("dragstart", onDragStart, true);
      };
      const engage = (currentY: number): void => {
        disarm();
        beginDrag(kind, startY, currentY);
      };

      // Travel decides. On an ordinary row there is nothing else the press
      // could become, so any travel past the threshold is the carry — a
      // diagonal drag from a row's left edge toward the middle of the list is
      // a carry like any other. Only where a SECOND drag shares the surface
      // does the axis have a job: there, a vertical act is the carry (the list
      // is a column) and a horizontal one is handed back to the drag-out.
      function onArmMove(ev: PointerEvent): void {
        dx = ev.clientX - startX;
        dy = ev.clientY - startY;
        if (!nativeDragSource) {
          if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) engage(ev.clientY);
          return;
        }
        if (Math.abs(dy) >= DRAG_THRESHOLD_PX && Math.abs(dy) > Math.abs(dx)) {
          engage(ev.clientY);
        } else if (Math.abs(dx) >= DRAG_THRESHOLD_PX) {
          disarm();
        }
      }

      // A Snippets row's incipit is ALSO a native drag source (drop the text
      // into a session prompt), and the browser decides to start that drag on
      // its own few pixels of movement — which can land before this arm has
      // seen enough to engage. So the two gestures are arbitrated here, on the
      // same axis rule: a vertical press-and-move is the reorder's, and the
      // native drag is refused so the arm survives to engage; a horizontal one
      // is the drag-out's, and the arm stands down.
      function onDragStart(ev: DragEvent): void {
        if (!armed) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          ev.preventDefault();
          return;
        }
        disarm();
      }

      window.addEventListener("pointermove", onArmMove);
      window.addEventListener("pointerup", disarm);
      window.addEventListener("dragstart", onDragStart, true);
    },
    [beginDrag, nativeDragSource],
  );

  return { onRowPointerDown };
}
