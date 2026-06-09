/**
 * focus-act -- the act-dispatch resolver for the Tug keyboard model ([P01]).
 *
 * Pure logic: given a key and the focused component's *declaration* (what kind
 * of container it is, whether it commits live or deferred, whether its current
 * item descends, whether it traps), decide the abstract act — `move` / `select`
 * / `act` / `descend` / `ascend` / `cancel` / `capture` / `passthrough`. The
 * window-level handler in `responder-chain-provider` carries each abstract act
 * out against the manager (the cursor, the scope stack, the default-action);
 * this module holds none of that wiring, so it is testable as data-in / data-out
 * with no DOM ([#test-categories]).
 *
 * The five keys, restated ([P01]): `Tab` is resolved by the focus walk before
 * this runs, so it never reaches here. `Space` selects, `Enter` acts-or-descends,
 * `Escape` ascends-or-cancels, and the movement keys move the cursor.
 */

// ---- Component declaration ----

/**
 * What kind of container the focused component is:
 *  - `item` — arrows move a cursor over items; Space selects, Enter acts/descends;
 *  - `component` — Tab cycles inner components; arrows unused; Enter/Escape do depth;
 *  - `none` — a leaf (button / checkbox / switch / slider / text editor).
 */
export type ContainerKind = "item" | "component" | "none";

/** Whether the component commits as the cursor moves (`live`) or on act (`deferred`). */
export type CommitMode = "live" | "deferred";

/**
 * The thin declaration a focused component makes against [P01]. The whole point
 * of the model: a component answers *move / act / container?* and behavior
 * follows — there is no bespoke per-component keyboard implementation.
 */
export interface ComponentKeyDeclaration {
  /** Container flavor. */
  container: ContainerKind;
  /** Commit timing. Defaults to `deferred`. Live components commit on move. */
  commit?: CommitMode;
  /**
   * Whether the current item is itself a container with navigable content, so
   * `Enter` **descends** into it rather than performing a plain act. Only
   * meaningful for `item` containers (accordion section, list row with content).
   */
  currentItemDescendable?: boolean;
  /**
   * Whether this is a **single-select** item container — one selected row that
   * the arrows move (selection follows the cursor). Such a container does NOT
   * consume `Enter`: with the selection already committed by movement, `Enter`
   * resolves to `passthrough` so it falls through to the scope's default action
   * ([P12] — Return's home). Only meaningful for `item` containers; absent leaves
   * the multi-select cursor model (Space selects, Enter acts/descends) unchanged.
   */
  singleSelect?: boolean;
  /**
   * Whether this is a **multi-select** item container that toggles on **Space**
   * (a two-stage highlight-then-select: arrows move the cursor, Space toggles the
   * cursor item). Like {@link singleSelect}, such a group does NOT consume
   * `Enter` — Space is its commit, so `Enter` resolves to `passthrough` and falls
   * through to the scope's default action ([P12]). The difference from
   * `singleSelect`: the selection does not follow the cursor (multiple items may
   * be selected). Only meaningful for `item` containers.
   */
  enterPassthrough?: boolean;
  /**
   * Whether the component's scope is modal (trapped). At a modal scope `Escape`
   * **cancels** the scope rather than ascending one level.
   */
  modal?: boolean;
  /**
   * The key-capture predicate — the generalization of `consumesTab`. When it
   * returns true for a key, that key is the component's to handle (an editor's
   * typing/caret) and the engine does not act on it ([P04]). Absent for
   * non-editor components.
   */
  captures?: (key: FocusKey) => boolean;
}

// ---- Key descriptor ----

/**
 * The minimal key shape the resolver reads. `key` is the DOM `KeyboardEvent.key`
 * (`" "` for Space, `"Enter"`, `"Escape"`, `"ArrowDown"`, …). Modifiers are
 * carried so a capture predicate (and future word/line movement) can read them.
 */
export interface FocusKey {
  key: string;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

// ---- Acts ----

/**
 * The abstract act the resolver returns. The handler maps each to a manager
 * operation; `passthrough` means the engine does not act (leave the event to the
 * browser / the component), `capture` means the component owns the key.
 */
export type FocusAct =
  | "move"
  | "select"
  | "act"
  | "descend"
  | "ascend"
  | "cancel"
  | "capture"
  | "passthrough";

const MOVEMENT_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** Whether `key` is a movement key (arrows / Home / End / Page). */
export function isMovementKey(key: string): boolean {
  return MOVEMENT_KEYS.has(key);
}

/**
 * Resolve a key against a component declaration to an abstract act.
 *
 * Order of precedence: a captured key (the editor leaf owns it) wins first; then
 * the act tier (`Space` / `Enter` / `Escape`); then the movement tier; else
 * `passthrough`.
 */
export function resolveFocusAct(
  event: FocusKey,
  declaration: ComponentKeyDeclaration,
): FocusAct {
  // (1) The component captures this key — editor typing / caret ([P04]).
  if (declaration.captures?.(event)) return "capture";

  const { key } = event;

  // (2) The act tier.
  if (key === " " || key === "Spacebar") {
    // Space selects the current item in an item-container; on a leaf control it
    // is a plain act (press / toggle). It never changes scope level.
    return declaration.container === "item" ? "select" : "act";
  }
  if (key === "Enter") {
    // A selection item-group does not consume Enter — its commit is arrow-select
    // (single-select, selection-follows-cursor) or Space (multi-select toggle) —
    // so Return falls through to the scope default ([P12]) and can reach the
    // dialog's ringed default button. Only a group whose Enter is *itself* the
    // commit (a deferred wizard step) keeps it.
    if (
      declaration.container === "item" &&
      (declaration.singleSelect || declaration.enterPassthrough)
    ) {
      return "passthrough";
    }
    // Enter descends when the current item is a navigable container, else acts.
    return declaration.currentItemDescendable ? "descend" : "act";
  }
  if (key === "Escape") {
    // Escape ascends one scope level; at a modal scope it cancels.
    return declaration.modal ? "cancel" : "ascend";
  }

  // (3) The movement tier — only item containers move a cursor; a leaf's arrows
  // are the caret (captured above) or the browser's, so they pass through.
  if (isMovementKey(key)) {
    return declaration.container === "item" ? "move" : "passthrough";
  }

  return "passthrough";
}

/**
 * Build a key-capture predicate from a fixed set of `KeyboardEvent.key` values —
 * the common case for a simple editor leaf. The returned predicate ignores
 * modifiers; a component needing modifier-aware capture passes its own.
 */
export function captureSet(keys: Iterable<string>): (event: FocusKey) => boolean {
  const set = new Set(keys);
  return (event: FocusKey) => set.has(event.key);
}
