/**
 * Pointer-based drag from a Lens snippet row into the Session card's prompt
 * entry ([P04]/[P05]). No HTML5 DnD — a ghost chip follows the pointer, the
 * drop target is hit-tested by `[data-snippet-drop-target]`, and on release
 * over it the snippet text is parked on the code-session store's
 * `pendingSnippetInsert` slot (the prompt entry inserts it at the drop point).
 *
 * Hover feedback is a `data-snippet-drop-active` attribute on the target
 * (CSS accept ring); the precise insertion caret is resolved from the drop
 * coordinates by the entry's consumer (`dropOffsetAtCoords`).
 */

const DRAG_THRESHOLD_PX = 6;
const DROP_TARGET_SELECTOR = "[data-snippet-drop-target]";
const DROP_ACTIVE_ATTR = "data-snippet-drop-active";

export interface SnippetDragOptions {
  /** The snippet text to insert. */
  text: string;
  /** A short label for the drag ghost. */
  label: string;
  /**
   * Called on release over a prompt-entry drop target. `at` is the drop point
   * in client coordinates; `cardId` identifies the card that owns the target
   * (from its `[data-card-id]` host), so the caller routes the insert to that
   * card's prompt entry — no "focused card" ambiguity.
   */
  onDrop: (text: string, at: { x: number; y: number }, cardId: string | null) => void;
}

function dropTargetAt(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y);
  return el?.closest(DROP_TARGET_SELECTOR) ?? null;
}

function cardIdOf(target: Element): string | null {
  return target.closest("[data-card-id]")?.getAttribute("data-card-id") ?? null;
}

/**
 * Begin a drag from a snippet row. Call from the row's `onPointerDown`. The
 * ghost only appears once the pointer moves past a small threshold, so a plain
 * click (select) or double-click (open) is unaffected.
 */
export function startSnippetDrag(event: React.PointerEvent, opts: SnippetDragOptions): void {
  // Left button only; ignore the grip (it owns reorder).
  if (event.button !== 0) return;
  const startX = event.clientX;
  const startY = event.clientY;

  let dragging = false;
  let ghost: HTMLElement | null = null;
  let activeTarget: Element | null = null;

  const setActive = (target: Element | null): void => {
    if (activeTarget === target) return;
    activeTarget?.removeAttribute(DROP_ACTIVE_ATTR);
    activeTarget = target;
    activeTarget?.setAttribute(DROP_ACTIVE_ATTR, "true");
  };

  const positionGhost = (x: number, y: number): void => {
    if (ghost === null) return;
    ghost.style.transform = `translate(${x + 10}px, ${y + 10}px)`;
  };

  const onMove = (e: PointerEvent): void => {
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      ghost = document.createElement("div");
      ghost.className = "snippet-drag-ghost";
      ghost.textContent = opts.label.length > 0 ? opts.label : "Snippet";
      document.body.appendChild(ghost);
    }
    positionGhost(e.clientX, e.clientY);
    setActive(dropTargetAt(e.clientX, e.clientY));
  };

  const cleanup = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
    setActive(null);
    ghost?.remove();
    ghost = null;
  };

  const onUp = (e: PointerEvent): void => {
    const target = dragging ? dropTargetAt(e.clientX, e.clientY) : null;
    cleanup();
    if (target !== null) {
      opts.onDrop(opts.text, { x: e.clientX, y: e.clientY }, cardIdOf(target));
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
}
