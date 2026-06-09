/**
 * useItemGroupKeyboard -- the shared keyboard wiring for an **item-container**
 * component in the Tug keyboard model ([P01]/[P03]).
 *
 * One rule, one shape: the group is a *single* stop in the engine Tab walk
 * (`useFocusable`), so **Tab moves the ring between components, never onto an
 * item**. Arrows move a separate **movement cursor** (`useFocusCursor` →
 * `data-key-cursor`) over the items — appearance only, projected straight to the
 * DOM with no re-render ([L06]/[L22]). The **arrow dispatch lives in the spatial
 * navigator** ([P22]): this hook registers a {@link SpatialCursorHandle} so an
 * in-group arrow drives the cursor (firing a live commit, descending Right where
 * disclosable) while an edge arrow crosses a declared seam — the navigator owns
 * the keydown, this hook owns what the cursor *does*. Home/End stay here (a local
 * jump, no spatial role). Space/Enter are carried by the engine's act dispatch
 * against the `behavior` this hook declares; the component supplies what "select /
 * act / descend" *means* via callbacks and what its items *are* via `collectItems`.
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
 *  - the {@link SpatialCursorHandle} the navigator drives for arrows, and the local
 *    Home/End `onKeyDown` — both with the `live` commit hook.
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

import { CardIdContext } from "@/lib/card-id-context";
import { FocusManagerContext } from "./focus-manager";
import type { FocusPolicy, KeyViewBehavior, SpatialCursorHandle } from "./focus-manager";
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
   * Whether Enter commits the ringed item like Space — for a commit-advances
   * primary group with no separate scope default (the question wizard's
   * single-select options). Default `false`: Enter bubbles to the scope default
   * ([P24]).
   */
  commitOnEnter?: boolean;
  /** Space: commit the current item. Enter commits too only when {@link commitOnEnter}. */
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

  const cardId = useContext(CardIdContext);

  // Latest options read live by the behavior proxy and the key handler, so the
  // registration never thrashes on a changed callback identity ([L07]).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const groupElRef = useRef<HTMLElement | null>(null);

  const syncItems = useCallback(() => {
    cursor.setItems(optionsRef.current.collectItems());
  }, [cursor]);

  // Fire a live commit ([P08], the tab bar) after the cursor lands on `index`. A
  // deferred group (the default) commits only on Space, so this no-ops there.
  const liveCommit = useCallback(
    (index: number) => {
      if (index >= 0 && (optionsRef.current.commit ?? "deferred") === "live") {
        optionsRef.current.onMove?.(cursor.cursorElement(), index);
      }
    },
    [cursor],
  );

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
      commitOnEnter: o.commitOnEnter ?? false,
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

  // The spatial navigator drives the group's arrows through this handle ([P22] /
  // [Q12]): an in-group arrow moves the 1D cursor (down/right → next, up/left →
  // previous, both axes, firing any live commit), ArrowRight descends a disclosable
  // item ([P02] tree model), and an off-the-edge arrow falls through so the
  // navigator can cross a declared seam. The handle methods read live state, so it
  // registers once. Only a *registered* group (an authored Tab stop) participates.
  const handleRef = useRef<SpatialCursorHandle | null>(null);
  if (handleRef.current === null) {
    handleRef.current = {
      length: () => optionsRef.current.collectItems().length,
      cursorIndex: () => cursor.cursorIndex(),
      moveCursor: (delta) => {
        liveCommit(cursor.moveCursor(delta));
      },
      tryDescendRight: () => {
        if (optionsRef.current.currentItemDescendable?.() ?? false) {
          optionsRef.current.onDescend?.(cursor.cursorElement(), cursor.cursorIndex());
          return true;
        }
        return false;
      },
    };
  }
  useLayoutEffect(() => {
    if (manager === null || !options.register) return;
    const ctx = manager.contextFor(cardId);
    ctx.registerCursorHandle(options.id, handleRef.current!);
    return () => ctx.unregisterCursorHandle(options.id);
  }, [manager, cardId, options.id, options.register]);

  // Home/End jump to the first/last item — a local cursor move with no spatial
  // (ring/seam) role, so it stays here rather than in the navigator. The arrows are
  // relocated to the navigator; this handler is reached only for Home/End.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      let next = -1;
      switch (event.key) {
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
      liveCommit(next);
    },
    [cursor, liveCommit],
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
