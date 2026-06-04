/**
 * useFocusCursor -- the keyboard **movement cursor** for an item-container.
 *
 * In the Tug keyboard model the focus ring marks the *component* and never moves
 * onto a sub-item ([P03]); arrow keys move a separate *cursor* over the items
 * inside a deferred component (radio / choice / option / list / accordion). This
 * hook owns that cursor.
 *
 * It is deliberately **not** React state. The cursor is appearance: moving it
 * must not trigger a re-render ([L06]). The current index and the item set live
 * in refs, and the cursor is projected straight to the DOM as `data-key-cursor`
 * on the current item element — the same observe/mutate-without-a-round-trip
 * discipline the manager uses for the key view (`refreshKeyViewProjection`)
 * ([L22], [L07]). The committed *selection* a component lands on Space/Enter is a
 * separate concern owned by that component; this hook only tracks the hover-like
 * cursor.
 *
 * The styling of `data-key-cursor` reuses the component's mouse-hover treatment
 * ([Q01]); a quiet baseline lives in `focus-ring.css` and each component refines
 * it with its own hover token.
 */

import { useCallback, useRef } from "react";

/** The DOM attribute carrying the keyboard movement cursor. */
export const KEY_CURSOR_ATTRIBUTE = "data-key-cursor";

export interface UseFocusCursorResult {
  /**
   * Declare the ordered item elements the cursor moves over. Call from a layout
   * effect (or whenever the rendered items change). Re-projects the cursor onto
   * the (clamped) current index. `null` entries are tolerated and skipped.
   */
  setItems: (items: ReadonlyArray<Element | null>) => void;
  /**
   * Move the cursor to an absolute index (clamped to the item range) and project
   * it. Returns the resolved index, or `-1` when there are no items.
   */
  setCursor: (index: number) => number;
  /**
   * Move the cursor by a signed delta (clamped, no wrap) and project it. Returns
   * the resolved index, or `-1` when there are no items.
   */
  moveCursor: (delta: number) => number;
  /** The current cursor index (`-1` when there are no items). */
  cursorIndex: () => number;
  /** The element under the cursor, or `null`. */
  cursorElement: () => Element | null;
  /** Remove `data-key-cursor` from every tracked item (e.g. on blur / ascend). */
  clear: () => void;
}

/**
 * Create a movement cursor for an item-container. Stable across renders; holds
 * the cursor index and the item set in refs and projects `data-key-cursor`
 * directly to the DOM.
 */
export function useFocusCursor(): UseFocusCursorResult {
  const itemsRef = useRef<Element[]>([]);
  const indexRef = useRef(0);

  const project = useCallback((): void => {
    const items = itemsRef.current;
    for (let i = 0; i < items.length; i++) {
      if (i === indexRef.current) {
        items[i].setAttribute(KEY_CURSOR_ATTRIBUTE, "");
      } else {
        items[i].removeAttribute(KEY_CURSOR_ATTRIBUTE);
      }
    }
  }, []);

  const clampIndex = useCallback((index: number): number => {
    const last = itemsRef.current.length - 1;
    if (last < 0) return -1;
    if (index < 0) return 0;
    if (index > last) return last;
    return index;
  }, []);

  const setItems = useCallback(
    (items: ReadonlyArray<Element | null>): void => {
      itemsRef.current = items.filter((el): el is Element => el !== null);
      indexRef.current = clampIndex(indexRef.current);
      project();
    },
    [clampIndex, project],
  );

  const setCursor = useCallback(
    (index: number): number => {
      const resolved = clampIndex(index);
      if (resolved < 0) return -1;
      indexRef.current = resolved;
      project();
      return resolved;
    },
    [clampIndex, project],
  );

  const moveCursor = useCallback(
    (delta: number): number => setCursor(indexRef.current + delta),
    [setCursor],
  );

  const cursorIndex = useCallback(
    (): number => (itemsRef.current.length === 0 ? -1 : indexRef.current),
    [],
  );

  const cursorElement = useCallback(
    (): Element | null => itemsRef.current[indexRef.current] ?? null,
    [],
  );

  const clear = useCallback((): void => {
    for (const el of itemsRef.current) {
      el.removeAttribute(KEY_CURSOR_ATTRIBUTE);
    }
  }, []);

  return { setItems, setCursor, moveCursor, cursorIndex, cursorElement, clear };
}
