/**
 * useItemGroupKeyboard -- the shared keyboard wiring for an **item-container**
 * component in the Tug keyboard model ([P01]/[P03]).
 *
 * One rule, one shape: the group is a *single* stop in the engine Tab walk
 * (`useFocusable`), so **Tab moves the ring between components, never onto an
 * item**. Arrows move a separate **movement cursor** (`useFocusCursor` →
 * `data-key-cursor`) over the items — appearance only, projected straight to the
 * DOM with no re-render ([L06]/[L22]). Space/Enter are carried by the engine's
 * act dispatch against the `behavior` this hook declares; the component supplies
 * what "select / act / descend" *means* via callbacks and what its items *are*
 * via `collectItems`.
 *
 * This is the generalization of the gallery proof-of-concept (`FocusList`) into
 * the hook every deferred item-group (radio / choice / option) and the
 * descend-capable containers (accordion / list) share — so behavior follows from
 * a thin declaration rather than a bespoke per-component keymap.
 *
 * What it owns:
 *  - the single focusable registration + its `behavior` (container `item`);
 *  - the movement cursor and its DOM projection;
 *  - landing the cursor on the initial item when the group becomes the keyboard
 *    key view, and clearing it when the key view leaves (a manager subscription,
 *    keyboard-only — the cursor tracks the *key view*, not DOM focus);
 *  - the movement `onKeyDown` (arrows / Home / End), with a `live` commit hook.
 *
 * What it does NOT own: Space/Enter/Escape (the act dispatch in
 * `responder-chain-provider` invokes the `behavior` callbacks) and the committed
 * selection (the component's own data zone — this hook only moves the cursor).
 *
 * Laws: [L03] registration + subscription in layout effects; [L06]/[L22] cursor
 * is appearance, mutated as DOM; [L07] live reads through refs; [L26] tolerant of
 * a null manager (no-op outside a provider).
 */

import { useCallback, useContext, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { FocusManagerContext } from "./focus-manager";
import type { FocusPolicy, KeyViewBehavior } from "./focus-manager";
import type { CommitMode } from "./focus-act";
import { useFocusable } from "./use-focusable";
import { useFocusCursor } from "./use-focus-cursor";

const LAST_INDEX = Number.MAX_SAFE_INTEGER;

export interface ItemGroupKeyboardOptions {
  /** Stable focusable id for the group (one stop for the whole component). */
  id: string;
  /** Focus group the surface authors this stop into (`""` = not authored). */
  group: string;
  /** Order within {@link group}. */
  order: number;
  /** Walk policy (`accept` default, `skip` = accessibility-only). */
  policy?: FocusPolicy;
  /** Whether to register (false leaves the items as plain native stops). */
  register: boolean;
  /**
   * Commit timing. `deferred` (default) commits on Space/Enter; `live` commits
   * as the cursor moves (tab bar) — {@link onMove} fires on every arrow move.
   */
  commit?: CommitMode;
  /**
   * Collect the cursor-eligible item elements in cursor order (typically the
   * **enabled** items, in DOM order). Called to (re)sync the cursor's range.
   */
  collectItems: () => ReadonlyArray<Element | null>;
  /**
   * The cursor index to land on when the group gains the keyboard key view —
   * usually the selected item's index among {@link collectItems}, else 0.
   */
  initialIndex: () => number;
  /** Whether the current item descends on Enter (accordion section / list row). */
  currentItemDescendable?: () => boolean;
  /**
   * The group commits by a gesture other than `Enter`, so `Enter` falls through
   * to the scope default ([P12]) instead of being consumed. Set this for both
   * shapes that don't commit on Return:
   *  - **selection-follows-cursor** (radio / choice): the arrows move the
   *    selection immediately — pair with `commit: "live"` + {@link onMove};
   *  - **Space-toggle** (multi-select option): arrows move the cursor, Space
   *    toggles ({@link onSelect}).
   *
   * Absent (the default) leaves the deferred model where `Enter` is the commit
   * (Space/Enter → {@link onSelect}/{@link onAct}; arrows move a cursor only).
   */
  enterPassthrough?: boolean;
  /** Space (and Enter-act on a non-descendable item): commit the current item. */
  onSelect: (element: Element | null, index: number) => void;
  /** Enter act on a non-descendable item. Defaults to {@link onSelect}. */
  onAct?: (element: Element | null, index: number) => void;
  /** Enter on a descendable item: push the inner scope + land the key view there. */
  onDescend?: (element: Element | null, index: number) => void;
  /** Live commit as the cursor moves (only meaningful with `commit: "live"`). */
  onMove?: (element: Element | null, index: number) => void;
}

export interface ItemGroupKeyboardResult {
  /**
   * Ref callback for the group's root element — wires `data-tug-focusable` and
   * lets the hook watch the key view. Compose with the component's own ref.
   */
  attachRoot: (el: HTMLElement | null) => void;
  /** Movement key handler (arrows / Home / End) for the root's `onKeyDown`. */
  onKeyDown: (event: ReactKeyboardEvent) => void;
  /** Re-sync the cursor's item range (call when the rendered items change). */
  syncItems: () => void;
  /** Move the cursor to an absolute index (e.g. on a pointer click) and project it. */
  setCursor: (index: number) => number;
  /** The current cursor index (`-1` when empty). */
  cursorIndex: () => number;
  /** The element under the cursor, or `null`. */
  cursorElement: () => Element | null;
}

/**
 * Wire a component as an item-container keyboard stop. Stable across renders;
 * the cursor and the item set live in refs ([L07]) and the cursor is projected
 * to the DOM ([L06]/[L22]).
 */
export function useItemGroupKeyboard(
  options: ItemGroupKeyboardOptions,
): ItemGroupKeyboardResult {
  const manager = useContext(FocusManagerContext);
  const cursor = useFocusCursor();

  // Latest options read live by the behavior proxy and the key handler, so the
  // registration never thrashes on a changed callback identity ([L07]).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const groupElRef = useRef<HTMLElement | null>(null);

  const syncItems = useCallback(() => {
    cursor.setItems(optionsRef.current.collectItems());
  }, [cursor]);

  // The component's thin declaration ([P01]). Read live; the act dispatch reads
  // it through `keyViewBehavior()` at the moment of Space/Enter.
  const behavior = useCallback((): KeyViewBehavior => {
    const o = optionsRef.current;
    const commit = (element: Element | null, index: number, kind: "select" | "act") => {
      if (kind === "select") o.onSelect(element, index);
      else (o.onAct ?? o.onSelect)(element, index);
    };
    return {
      container: "item",
      commit: o.commit ?? "deferred",
      currentItemDescendable: o.currentItemDescendable?.() ?? false,
      enterPassthrough: o.enterPassthrough ?? false,
      onSelect: () => commit(cursor.cursorElement(), cursor.cursorIndex(), "select"),
      onAct: () => commit(cursor.cursorElement(), cursor.cursorIndex(), "act"),
      onDescend: () => o.onDescend?.(cursor.cursorElement(), cursor.cursorIndex()),
    };
  }, [cursor]);

  const { focusableRef } = useFocusable({
    id: options.id,
    group: options.group,
    order: options.order,
    policy: options.policy,
    register: options.register,
    behavior,
  });

  const attachRoot = useCallback(
    (el: HTMLElement | null) => {
      groupElRef.current = el;
      focusableRef(el);
    },
    [focusableRef],
  );

  // Land the cursor on the initial item when the group becomes the *keyboard*
  // key view; clear it when the key view leaves. The cursor tracks the key view
  // (not DOM focus), so it never appears at rest or under the pointer. The
  // manager notifies after stamping `data-key-view-kbd` ([L22]).
  const wasKbdRef = useRef(false);
  useLayoutEffect(() => {
    if (manager === null) return;
    const onChange = () => {
      const el = groupElRef.current;
      if (el === null) return;
      const kbd = el.hasAttribute("data-key-view-kbd");
      if (kbd && !wasKbdRef.current) {
        // The group gained the keyboard key view: activate the cursor (so it may
        // paint) and land it on the initial item. Activation precedes the seed
        // so the projection includes the ring ([P12] — ring on keyboard focus).
        cursor.setActive(true);
        syncItems();
        cursor.setCursor(optionsRef.current.initialIndex());
      } else if (!kbd && wasKbdRef.current) {
        cursor.clear();
      }
      wasKbdRef.current = kbd;
    };
    const unsubscribe = manager.subscribe(onChange);
    onChange();
    return unsubscribe;
  }, [manager, cursor, syncItems]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      let next = -1;
      switch (event.key) {
        case "ArrowRight":
          // Tree-style descend ([P02] disclosure model): Right enters an open,
          // descendable item (an accordion section with navigable content),
          // mirroring Enter. When the current item isn't descendable — a closed
          // section, or any group that never descends (radio / choice / option,
          // and horizontal containers) — Right keeps its movement meaning, so
          // the shared "both arrow axes move" ergonomic is preserved everywhere
          // except where descent is genuinely available. Ascend is Escape.
          if (optionsRef.current.currentItemDescendable?.() ?? false) {
            event.preventDefault();
            optionsRef.current.onDescend?.(cursor.cursorElement(), cursor.cursorIndex());
            return;
          }
          event.preventDefault();
          next = cursor.moveCursor(1);
          break;
        case "ArrowDown":
          event.preventDefault();
          next = cursor.moveCursor(1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          next = cursor.moveCursor(-1);
          break;
        case "Home":
          event.preventDefault();
          next = cursor.setCursor(0);
          break;
        case "End":
          event.preventDefault();
          next = cursor.setCursor(LAST_INDEX);
          break;
        default:
          return;
      }
      // Live components (tab bar) commit on every move; deferred ones wait for act.
      if (next >= 0 && (optionsRef.current.commit ?? "deferred") === "live") {
        optionsRef.current.onMove?.(cursor.cursorElement(), next);
      }
    },
    [cursor],
  );

  return {
    attachRoot,
    onKeyDown,
    syncItems,
    setCursor: cursor.setCursor,
    cursorIndex: cursor.cursorIndex,
    cursorElement: cursor.cursorElement,
  };
}
