/**
 * test-surface.ts -- In-app test harness surface (`window.__tug`).
 *
 * Scope of this module
 * --------------------
 * Exports {@link TugTestSurface} — the TypeScript interface the Phase 2
 * Swift bridge talks to via `evaluateJavaScript` — and
 * {@link createTugTestSurface}, which binds that interface to a live
 * {@link DeckManager} instance. Also contains the DEV + `__tugTestMode`
 * guarded attach that installs `window.__tug` from `main.tsx`.
 *
 * This is a scaffold (parent plan Step 6): the surface is fully typed
 * and implemented here; the Swift side that drives it (RPC transport,
 * `evalJS` round-trip, `waitForCondition`, handshake) is not yet live
 * — those arrive in subsequent parent-plan steps, which continue to
 * reference Spec [#s03-tug-surface] and Spec [#s04-event-synthesis]
 * as the contract.
 *
 * Authoritative references
 * ------------------------
 * - Parent plan Spec [#s03-tug-surface]: the `TugTestSurface` shape.
 * - Parent plan Spec [#s04-event-synthesis]: event synthesis semantics.
 * - Parent plan [D01]: per-test isolation via granular `reset`.
 * - Parent plan [D03]: DEBUG-only / release-safe.
 * - Parent plan [D11]: surface is versioned; harness handshakes.
 * - Parent plan (#tug-surface), (#granular-reset): intent & tradeoffs.
 *
 * DEV/test-mode gating
 * --------------------
 * The `window.__tug` global is attached only when
 * `import.meta.env.DEV && window.__tugTestMode === true`. The
 * attach site lives in {@link attachTugTestSurface} so `main.tsx`'s
 * boot path stays readable. Release builds never reach the attach
 * path (Vite strips the `if (import.meta.env.DEV && ...)` branch) and
 * production dev builds never reach it either unless the Swift host
 * injects the `__tugTestMode` flag via a DEBUG-only `WKUserScript`
 * ([D03]/[D08]).
 *
 * Versioning
 * ----------
 * {@link SURFACE_VERSION} is a semver string literal baked into the
 * surface. The harness reads it during the handshake ([D11]) and
 * rejects connections whose major version doesn't match. Bump the
 * major on breaking changes, the minor on additive changes, and file
 * a tugplan follow-up for every bump.
 */

import type { DeckManager } from "./deck-manager";
import type { DeckState, CardStateBag } from "./layout-tree";
import { deckTrace, type DeckTraceEvent } from "./deck-trace";
import { nodeToPath, selectionGuard } from "./components/tugways/selection-guard";

// ---------------------------------------------------------------------------
// Public types (Spec [#s03-tug-surface])
// ---------------------------------------------------------------------------

/**
 * The `window.__tug` surface version. Bumped on breaking changes; the
 * Phase 2 harness handshake (see [D11]) asserts compatibility before
 * issuing any other RPC.
 *
 * Matched on major. Minor bumps denote additive fields only.
 *
 * `1.1.0` (harness extensions, 2026-04-24): adds the introspection
 * family — {@link TugTestSurface.getElementText},
 * {@link TugTestSurface.getElementValue},
 * {@link TugTestSurface.getElementAttribute},
 * {@link TugTestSurface.getElementBounds},
 * {@link TugTestSurface.getElementState},
 * {@link TugTestSurface.getActiveElement},
 * {@link TugTestSurface.getSelection},
 * {@link TugTestSurface.getComputedStyleValue}. The native-gesture
 * and keyboard-control families live out-of-band on the RPC bridge
 * (see `tugapp/Sources/TestHarness/NativeEventHandlers.swift`) — JS
 * cannot post `CGEvent`s, so there is nothing for `__tug` to expose
 * for those verbs. Major stays `1`; additive.
 */
export const SURFACE_VERSION = "1.1.0" as const;

/**
 * Snapshot of the caret / selection for a single card, as returned by
 * {@link TugTestSurface.getCaretState}. Two variants cover the axes we
 * care about:
 *
 *   - `input` — the active element is a `<input>` / `<textarea>` with
 *     `data-tug-persist-value`, and the snapshot carries the control's
 *     own `selectionStart` / `selectionEnd` / `selectionDirection` plus
 *     `value`.
 *   - `range` — the live DOM Range for the card, as published by the
 *     card's component to `selectionGuard`, serialized as
 *     `anchorPath`/`focusPath` rooted at the registered card-host
 *     element (same path shape as
 *     {@link import("./layout-tree").DomSelectionSnapshot}) and the
 *     Range's plain-text content.
 *
 * `null` means we could not classify the current focus/selection
 * inside the card.
 */
export type CaretState =
  | {
      kind: "input";
      selectionStart: number;
      selectionEnd: number;
      selectionDirection: "forward" | "backward" | "none";
      value: string;
    }
  | {
      kind: "range";
      anchorPath: readonly number[];
      anchorOffset: number;
      focusPath: readonly number[];
      focusOffset: number;
      text: string;
    };

/**
 * Options for {@link TugTestSurface.click}. Coordinates are optional
 * (defaults to the target element's bounding-rect center). Modifiers
 * are threaded through to every synthesized pointer/mouse event so
 * handlers that condition on Meta/Shift see a consistent bit.
 */
export interface ClickOptions {
  clientX?: number;
  clientY?: number;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Per-axis reset options. Every axis defaults to false — callers opt in
 * exactly the axes a test case needs ([D01]).
 */
export interface ResetOptions {
  /** Clear DeckState back to empty (one empty pane, no cards). */
  deck?: boolean;
  /** Clear registered selection boundaries + pinned card Ranges. */
  selectionGuard?: boolean;
  /** Drop per-card Component Persistence Protocol registries. */
  orchestrator?: boolean;
  /** `deckTrace.clear()` — preserves the enable flag. */
  trace?: boolean;
  /** Wipe `localStorage` (and any scoped IndexedDB stores the deck owns). */
  storage?: boolean;
}

/**
 * Arguments for {@link TugTestSurface.seedDeckState}. Mirrors the
 * `DeckManager.seedDeckState` contract: atomic state replace, optional
 * card-state-bag merge, optional cold-boot focus restore.
 */
export interface SeedDeckStateArgs {
  state: DeckState;
  cardStates?: Record<string, CardStateBag>;
  focusCardId?: string;
}

/**
 * Viewport-relative DOMRect shape returned by
 * {@link TugTestSurface.getElementBounds}. Flat POD so it survives
 * JSON transport over the `evalJS` bridge. `{x, y}` is the top-left
 * corner in CSS viewport coords (Y-down). Callers that need SCREEN
 * coords (for naming a pixel to pass to `nativeClick`) read
 * `app.getElementScreenBounds(selector)` on the harness side — that
 * hop goes through Swift's `CoordMapping` and is not derivable from
 * these viewport values alone.
 */
export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compact bundle of per-element state flags returned by
 * {@link TugTestSurface.getElementState}. The field set covers the
 * state surfaces tests actually branch on: enabled/disabled,
 * read-only, checked, visible (layout-bounds + `offsetParent`), plus
 * the tag name and focus bit.
 *
 * `visible` is a layout-probed boolean — an element with zero width or
 * height, or a detached `offsetParent`, is considered not visible. It
 * does NOT check `visibility: hidden` / `opacity: 0` / CSS-clipped
 * ancestors; callers that need finer-grained paint assertions use
 * {@link TugTestSurface.getComputedStyleValue}.
 */
export interface ElementStateSnapshot {
  tagName: string;
  disabled: boolean;
  readOnly: boolean;
  checked: boolean;
  visible: boolean;
  isFocused: boolean;
}

/**
 * Description of `document.activeElement` returned by
 * {@link TugTestSurface.getActiveElement}. `null` when the body is the
 * active element (no explicit focus).
 *
 * `cardId` is the nearest ancestor's `data-card-id`; `persistKey` is
 * the element's own `data-tug-persist-value`. Both default to `null`
 * when absent. `selector` is a best-effort locator ("#id" if the
 * element has an id, else "tag[data-card-id=...]" when inside a card)
 * — useful for logging but NOT intended as a round-trip selector that
 * the harness re-uses.
 */
export interface ActiveElementInfo {
  tagName: string;
  id: string | null;
  cardId: string | null;
  persistKey: string | null;
  selector: string;
}

/**
 * Selection snapshot returned by {@link TugTestSurface.getSelection}.
 * Superset of {@link CaretState} — covers the page-wide `Selection`
 * object (contentEditable, arbitrary spans) in addition to form
 * controls. `null` when no selection is active.
 *
 * `kind` discriminates:
 *   - `"input"` — the focused element is a form control and the
 *     selection is its `selectionStart`/`End` range.
 *   - `"range"` — there is a live `Selection` with at least one
 *     range; we serialize the first range's text + collapsed flag.
 *     `cardId` is populated if the range's start node sits inside a
 *     `[data-card-id]` subtree.
 */
export type SelectionSnapshot =
  | {
      kind: "input";
      selectionStart: number;
      selectionEnd: number;
      selectionDirection: "forward" | "backward" | "none";
      value: string;
      cardId: string | null;
    }
  | {
      kind: "range";
      text: string;
      isCollapsed: boolean;
      cardId: string | null;
    };

/**
 * `window.__tug` — the in-app test harness surface. Every method is
 * synchronous or returns a JSON-serializable value so the Swift-side
 * `evalJS` round-trip never has to marshal custom types.
 *
 * See Spec [#s03-tug-surface] for the authoritative contract. Additive
 * changes bump {@link SURFACE_VERSION}'s minor; breaking changes bump
 * the major and require a tugplan follow-up.
 */
export interface TugTestSurface {
  readonly version: typeof SURFACE_VERSION;

  // ---- State seeding ----
  seedDeckState(args: SeedDeckStateArgs): void;

  // ---- Granular reset ([D01]) ----
  reset(opts: ResetOptions): void;

  // ---- Gesture drivers (Spec [#s04-event-synthesis]) ----
  click(selector: string, opts?: ClickOptions): void;
  type(selector: string, text: string): void;
  focusElement(selector: string): void;

  // ---- State reads ----
  getActiveCardId(): string | null;
  getFocusedCardId(): string | null;
  getCaretState(cardId: string): CaretState | null;
  getFormControlValue(cardId: string, persistKey: string): string | null;
  assertHostRootRegistered(cardId: string): boolean;

  // ---- Trace access ----
  getDeckTrace(opts?: { since?: number }): readonly DeckTraceEvent[];
  markDeckTrace(): number;
  clearDeckTrace(): void;
  enableDeckTrace(flag: boolean): void;

  // ---- Introspection (SURFACE_VERSION 1.1.0, harness Phase A) ----
  getElementText(selector: string): string;
  getElementValue(selector: string): string;
  getElementAttribute(selector: string, name: string): string | null;
  getElementBounds(selector: string): ElementBounds;
  getElementState(selector: string): ElementStateSnapshot;
  getActiveElement(): ActiveElementInfo | null;
  getSelection(cardId?: string): SelectionSnapshot | null;
  getComputedStyleValue(selector: string, property: string): string;

  /**
   * Register an element as a selection boundary on behalf of a test
   * harness. Mirrors `useSelectionBoundary`'s call into
   * `selectionGuard.registerBoundary(cardId, element)` — the same
   * mechanism a real card uses on mount so WebKit's drag-selection
   * isn't blocked by `selectionGuard.handleSelectStart`.
   *
   * Needed because in-app smoke tests inject ad-hoc fixture
   * overlays outside of any real card; without registering the
   * overlay as a boundary, `selectstart` is preventDefault'd and
   * drag selection never begins. The companion
   * {@link TugTestSurface.unregisterSelectionBoundary} cleans up.
   */
  registerSelectionBoundary(cardId: string, selector: string): void;
  unregisterSelectionBoundary(cardId: string): void;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a CSS selector against `document`. Throws a descriptive
 * error (rather than silently swallowing) so harness-side tests fail
 * loudly on a stale selector. Keeping the throw centralized also
 * means the Swift bridge sees a consistent error shape surfaced by
 * `evalJS` when a selector goes stale.
 */
function queryRequired(selector: string): HTMLElement {
  const el = document.querySelector(selector);
  if (el === null) {
    throw new Error(`[tug] selector matched no element: ${selector}`);
  }
  if (!(el instanceof HTMLElement)) {
    throw new Error(`[tug] selector matched a non-HTMLElement: ${selector}`);
  }
  return el;
}

/**
 * Compute a click's default `clientX` / `clientY` from the target's
 * bounding-rect center. Matches what a user-space click on the
 * element's visual center would produce, and keeps our synthetic
 * clicks deterministic against any element's current layout.
 */
function defaultClickPoint(el: HTMLElement): { clientX: number; clientY: number } {
  const rect = el.getBoundingClientRect();
  return {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };
}

/**
 * Re-hydrate the `Map<string, CardStateBag>` shape that
 * `DeckManager.seedDeckState` consumes from the plain-object
 * `Record<string, CardStateBag>` that survives JSON transport over
 * the Swift `evalJS` bridge. Absent / empty input produces
 * `undefined` so `seedDeckState` treats it as a no-op pass.
 */
function cardStatesRecordToMap(
  rec: Record<string, CardStateBag> | undefined,
): Map<string, CardStateBag> | undefined {
  if (rec === undefined) return undefined;
  const keys = Object.keys(rec);
  if (keys.length === 0) return undefined;
  const map = new Map<string, CardStateBag>();
  for (const key of keys) {
    map.set(key, rec[key]);
  }
  return map;
}

/**
 * Build an empty-but-valid {@link DeckState}: one pane with no cards is
 * NOT valid (invariant 3 forbids empty panes), so the safe empty deck
 * is literally zero panes, zero cards, no `activePaneId`.
 */
function makeEmptyDeckState(): DeckState {
  return {
    cards: [],
    panes: [],
    hasFocus: typeof document !== "undefined" ? document.hasFocus() : false,
  };
}

/**
 * Narrow `document.activeElement` to a form-control that sits inside
 * `cardRoot` and carries a `data-tug-persist-value` key. Returns
 * `null` when the active element is outside the card subtree or is
 * not a recognized form control.
 *
 * Mirrors the "form-control focus" classification that `CardHost`'s
 * {@link import("./components/chrome/card-host").captureFocus} uses
 * when building `bag.focus`. Keeping the two in sync is important
 * because a `kind: "input"` caret-state read is what a test uses to
 * assert "this form-control has focus and its caret is here".
 */
function activeFormControlIn(
  cardRoot: HTMLElement,
): HTMLInputElement | HTMLTextAreaElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (!cardRoot.contains(active)) return null;
  if (active.getAttribute("data-tug-persist-value") === null) return null;
  if (active instanceof HTMLInputElement) return active;
  if (active instanceof HTMLTextAreaElement) return active;
  return null;
}

/**
 * Read the selection direction off an `HTMLInputElement` /
 * `HTMLTextAreaElement`, normalizing the nullable browser field to
 * the surface's {@link CaretState} `"forward" | "backward" | "none"`
 * union. Browsers that return `null` (rare — WebKit returns
 * `"none"`) get normalized to `"none"`.
 */
function readSelectionDirection(
  el: HTMLInputElement | HTMLTextAreaElement,
): "forward" | "backward" | "none" {
  const dir = el.selectionDirection;
  if (dir === "forward" || dir === "backward") return dir;
  return "none";
}

// ---------------------------------------------------------------------------
// createTugTestSurface
// ---------------------------------------------------------------------------

/**
 * Build a {@link TugTestSurface} bound to the supplied {@link DeckManager}.
 *
 * The returned object is a closure-over-`deck`; callers hand it out as
 * `window.__tug` via {@link attachTugTestSurface}. No module-level state
 * lives here — every surface method reaches into `deck` or the relevant
 * singleton (`selectionGuard`, `deckTrace`) on each call so rebuilding
 * the surface per test is just `createTugTestSurface(newDeck)`.
 */
export function createTugTestSurface(deck: DeckManager): TugTestSurface {
  // --- reset axis effects ([D01]: each axis idempotent) ---
  const resetDeckAxis = (): void => {
    // Seed with an empty DeckState. Goes through the same atomic
    // replace path as a real seed so component registries for
    // departing cards get discarded, subscribers notify once, and
    // the snapshot transitions cleanly for useSyncExternalStore.
    deck.seedDeckState({ state: makeEmptyDeckState() });
  };

  const resetSelectionGuardAxis = (): void => {
    selectionGuard.reset();
  };

  const resetOrchestratorAxis = (): void => {
    // Component Persistence Protocol registries are owned by the
    // deck-manager (see `componentRegistries`). They have no public
    // "clear" API because production never wants one — the only
    // legitimate drop is when a card leaves the deck. The `deck`
    // axis's `seedDeckState({ state: empty })` already discards
    // registries for every card that departs; calling it here
    // gives the orchestrator axis the same idempotent "drop all"
    // effect. If `resetDeckAxis` already ran in this same `reset`
    // call the deck is already empty — the seed is a cheap no-op
    // then, which matches the [D01] contract that every axis is
    // safe to call when already in its reset state.
    deck.seedDeckState({ state: makeEmptyDeckState() });
  };

  const resetTraceAxis = (): void => {
    deckTrace.clear();
  };

  const resetStorageAxis = (): void => {
    // `localStorage.clear()` is synchronous and deterministic; that
    // covers every persisted value tugdeck currently writes
    // (notably `td-theme`). Scoped IndexedDB is a placeholder —
    // tugdeck has no durable IDB today (see MEMORY: IndexedDB is
    // unwanted infra), but wire the shape now so a future IDB
    // consumer lands its cleanup here without widening the surface.
    try {
      localStorage.clear();
    } catch {
      /* storage unavailable (e.g. private mode); nothing to clear. */
    }
  };

  // --- event synthesis (Spec [#s04-event-synthesis]) ---
  const synthesizeClick = (el: HTMLElement, opts?: ClickOptions): void => {
    const { clientX, clientY } = opts?.clientX !== undefined && opts?.clientY !== undefined
      ? { clientX: opts.clientX, clientY: opts.clientY }
      : defaultClickPoint(el);
    const metaKey = opts?.metaKey === true;
    const shiftKey = opts?.shiftKey === true;

    // Common init for the "pressed" phase (pointerdown + mousedown).
    const pressedInit: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      pointerType: "mouse",
      pointerId: 1,
      isPrimary: true,
      metaKey,
      shiftKey,
    };
    // Common init for the "released" phase. `buttons: 0` reflects
    // the post-release state where no mouse button is depressed.
    const releasedInit: PointerEventInit = {
      ...pressedInit,
      buttons: 0,
    };

    // 1. pointerdown  2. mousedown  3. pointerup  4. mouseup  5. click.
    //    Ordered per Spec [#s04-event-synthesis].
    el.dispatchEvent(new PointerEvent("pointerdown", pressedInit));
    el.dispatchEvent(new MouseEvent("mousedown", pressedInit));
    el.dispatchEvent(new PointerEvent("pointerup", releasedInit));
    el.dispatchEvent(new MouseEvent("mouseup", releasedInit));
    el.dispatchEvent(new MouseEvent("click", releasedInit));
  };

  const synthesizeType = (
    el: HTMLInputElement | HTMLTextAreaElement,
    text: string,
  ): void => {
    // React's synthetic-event system only sees a value change when
    // the underlying native setter is what wrote the property —
    // assigning `el.value = "..."` directly bypasses the prototype
    // descriptor React installed and the onChange handler never
    // fires. The native-setter pattern is the canonical workaround.
    const proto =
      el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    const nativeSetter = descriptor?.set;
    if (!nativeSetter) {
      throw new Error(
        "[tug] native `value` setter is missing on prototype; cannot synthesize typing",
      );
    }
    for (const ch of text) {
      nativeSetter.call(el, el.value + ch);
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: false,
          composed: true,
          inputType: "insertText",
          data: ch,
        }),
      );
    }
  };

  return {
    version: SURFACE_VERSION,

    // ---- state seeding ----
    seedDeckState(args: SeedDeckStateArgs): void {
      deck.seedDeckState({
        state: args.state,
        cardStates: cardStatesRecordToMap(args.cardStates),
        focusCardId: args.focusCardId,
      });
    },

    // ---- granular reset ----
    reset(opts: ResetOptions): void {
      // Order matters: trace last so any earlier axis' subscriber
      // side-effects remain visible to a test that inspects the
      // trace during reset debugging. Storage first so a later
      // axis that reads storage (none today, but keeps the order
      // future-proof) sees the cleared state.
      if (opts.storage === true) resetStorageAxis();
      if (opts.deck === true) resetDeckAxis();
      if (opts.selectionGuard === true) resetSelectionGuardAxis();
      if (opts.orchestrator === true) resetOrchestratorAxis();
      if (opts.trace === true) resetTraceAxis();
    },

    // ---- gesture drivers ----
    click(selector: string, opts?: ClickOptions): void {
      const el = queryRequired(selector);
      synthesizeClick(el, opts);
    },

    type(selector: string, text: string): void {
      const el = queryRequired(selector);
      if (
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLTextAreaElement)
      ) {
        throw new Error(
          `[tug] type: selector must match <input> or <textarea>: ${selector}`,
        );
      }
      synthesizeType(el, text);
    },

    focusElement(selector: string): void {
      const el = queryRequired(selector);
      // Direct `.focus()` — the Spec [#s04-event-synthesis] fallback
      // for paths where synthesized pointerdown cannot drive
      // browser-default focus. Matches [D09] fidelity limits.
      el.focus();
    },

    // ---- state reads ----
    getActiveCardId(): string | null {
      // "Active card" in the surface's vocabulary is the composite
      // first-responder: the card the user perceives as active.
      // `getFirstResponderCardId` is the deck-manager's name for
      // exactly that bit.
      return deck.getFirstResponderCardId();
    },

    getFocusedCardId(): string | null {
      return deck.getFocusedCardId();
    },

    getCaretState(cardId: string): CaretState | null {
      const cardRoot = deck.peekCardHostRoot(cardId);
      if (cardRoot === null) return null;

      // Variant 1: active element is a keyed form-control inside
      // the card. Return its selection shape directly.
      const input = activeFormControlIn(cardRoot);
      if (input !== null) {
        return {
          kind: "input",
          selectionStart: input.selectionStart ?? 0,
          selectionEnd: input.selectionEnd ?? 0,
          selectionDirection: readSelectionDirection(input),
          value: input.value,
        };
      }

      // Variant 2: the card has a published DOM Range in
      // `selectionGuard`. Serialize it with paths rooted at the
      // card's registered host element. `nodeToPath` returns
      // `null` if the range's nodes are no longer inside the host
      // subtree — treat that as "no caret state available" rather
      // than synthesizing a bogus snapshot.
      const range = selectionGuard.getCardRange(cardId);
      if (range === undefined) return null;
      const anchorPath = nodeToPath(cardRoot, range.startContainer);
      const focusPath = nodeToPath(cardRoot, range.endContainer);
      if (anchorPath === null || focusPath === null) return null;
      return {
        kind: "range",
        anchorPath,
        anchorOffset: range.startOffset,
        focusPath,
        focusOffset: range.endOffset,
        text: range.toString(),
      };
    },

    getFormControlValue(cardId: string, persistKey: string): string | null {
      const cardRoot = deck.peekCardHostRoot(cardId);
      if (cardRoot === null) return null;
      // `CSS.escape` is important: persistKeys are authored
      // strings and can technically contain characters that would
      // otherwise be interpreted as selector syntax.
      const selector = `[data-tug-persist-value="${CSS.escape(persistKey)}"]`;
      const el = cardRoot.querySelector(selector);
      if (el === null) return null;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        return el.value;
      }
      return null;
    },

    assertHostRootRegistered(cardId: string): boolean {
      return deck.peekCardHostRoot(cardId) !== null;
    },

    // ---- trace access ----
    getDeckTrace(opts?: { since?: number }): readonly DeckTraceEvent[] {
      if (opts?.since !== undefined) return deckTrace.since(opts.since);
      return deckTrace.dump();
    },

    markDeckTrace(): number {
      return deckTrace.mark();
    },

    clearDeckTrace(): void {
      deckTrace.clear();
    },

    enableDeckTrace(flag: boolean): void {
      deckTrace.enable(flag);
    },

    // ---- introspection (SURFACE_VERSION 1.1.0) ----

    getElementText(selector: string): string {
      const el = queryRequired(selector);
      // Form controls don't meaningfully have `.textContent` — return
      // their `.value` so tests can write a uniform assertion against
      // whatever kind of element a selector happens to resolve to.
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement
      ) {
        return el.value;
      }
      return el.textContent ?? "";
    },

    getElementValue(selector: string): string {
      const el = queryRequired(selector);
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        return el.value;
      }
      throw new Error(
        `[tug] getElementValue: selector must match <input>/<textarea>/<select>: ${selector}`,
      );
    },

    getElementAttribute(selector: string, name: string): string | null {
      const el = queryRequired(selector);
      return el.getAttribute(name);
    },

    getElementBounds(selector: string): ElementBounds {
      const el = queryRequired(selector);
      const r = el.getBoundingClientRect();
      // Flatten the live DOMRect (whose `toJSON` is non-standard
      // across browsers) into a plain POD for stable JSON transport.
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },

    getElementState(selector: string): ElementStateSnapshot {
      const el = queryRequired(selector);
      const rect = el.getBoundingClientRect();
      // Layout-visibility probe: non-zero layout box AND attached to
      // the render tree (`offsetParent` is null for `display:none`
      // descendants; `<body>` is a special case that has no
      // offsetParent yet is still visible).
      const hasSize = rect.width > 0 && rect.height > 0;
      const attached = el.offsetParent !== null || el === document.body;
      const visible = hasSize && attached;
      // `disabled` / `readOnly` / `checked` exist on
      // HTMLInputElement/Textarea/Select/Button — branch via
      // instanceof so we return stable false rather than reading
      // undefined on non-form elements.
      const disabled =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLButtonElement ||
        el instanceof HTMLSelectElement
          ? el.disabled
          : false;
      const readOnly =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.readOnly
          : false;
      const checked =
        el instanceof HTMLInputElement &&
        (el.type === "checkbox" || el.type === "radio")
          ? el.checked
          : false;
      return {
        tagName: el.tagName,
        disabled,
        readOnly,
        checked,
        visible,
        isFocused: document.activeElement === el,
      };
    },

    getActiveElement(): ActiveElementInfo | null {
      const active = document.activeElement;
      if (
        active === null ||
        active === document.body ||
        !(active instanceof HTMLElement)
      ) {
        return null;
      }
      const cardEl = active.closest("[data-card-id]");
      const cardId =
        cardEl instanceof HTMLElement
          ? cardEl.getAttribute("data-card-id")
          : null;
      const persistKey = active.getAttribute("data-tug-persist-value");
      const id = active.id !== "" ? active.id : null;
      // Best-effort selector: id is stable when present; otherwise
      // scope by cardId and tag. We don't promise it re-resolves.
      const selector =
        id !== null
          ? `#${CSS.escape(id)}`
          : cardId !== null
          ? `[data-card-id="${CSS.escape(cardId)}"] ${active.tagName.toLowerCase()}`
          : active.tagName.toLowerCase();
      return {
        tagName: active.tagName,
        id,
        cardId,
        persistKey,
        selector,
      };
    },

    getSelection(cardId?: string): SelectionSnapshot | null {
      if (cardId !== undefined) {
        // Card-scoped: mirrors getCaretState(cardId)'s form-control
        // variant and augments with a contentEditable fallback.
        const cardRoot = deck.peekCardHostRoot(cardId);
        if (cardRoot === null) return null;
        const input = activeFormControlIn(cardRoot);
        if (input !== null) {
          return {
            kind: "input",
            selectionStart: input.selectionStart ?? 0,
            selectionEnd: input.selectionEnd ?? 0,
            selectionDirection: readSelectionDirection(input),
            value: input.value,
            cardId,
          };
        }
        const sel = window.getSelection();
        if (sel === null || sel.rangeCount === 0) return null;
        const range = sel.getRangeAt(0);
        if (!cardRoot.contains(range.startContainer)) return null;
        return {
          kind: "range",
          text: range.toString(),
          isCollapsed: range.collapsed,
          cardId,
        };
      }

      // Page-wide: prefer the focused form control when possible.
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      ) {
        const cardEl = active.closest("[data-card-id]");
        const containingCardId =
          cardEl instanceof HTMLElement
            ? cardEl.getAttribute("data-card-id")
            : null;
        return {
          kind: "input",
          selectionStart: active.selectionStart ?? 0,
          selectionEnd: active.selectionEnd ?? 0,
          selectionDirection: readSelectionDirection(active),
          value: active.value,
          cardId: containingCardId,
        };
      }
      const sel = window.getSelection();
      if (sel === null || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      let containingCardId: string | null = null;
      const startNode = range.startContainer;
      // Selection anchors inside text nodes; walk up to the nearest
      // element to query `closest("[data-card-id]")`.
      const elStart =
        startNode.nodeType === Node.ELEMENT_NODE
          ? (startNode as Element)
          : startNode.parentElement;
      if (elStart !== null) {
        const cardEl = elStart.closest("[data-card-id]");
        if (cardEl instanceof HTMLElement) {
          containingCardId = cardEl.getAttribute("data-card-id");
        }
      }
      return {
        kind: "range",
        text: range.toString(),
        isCollapsed: range.collapsed,
        cardId: containingCardId,
      };
    },

    getComputedStyleValue(selector: string, property: string): string {
      const el = queryRequired(selector);
      return window.getComputedStyle(el).getPropertyValue(property);
    },

    registerSelectionBoundary(cardId: string, selector: string): void {
      const el = queryRequired(selector);
      selectionGuard.registerBoundary(cardId, el);
    },

    unregisterSelectionBoundary(cardId: string): void {
      selectionGuard.unregisterBoundary(cardId);
    },
  };
}

// ---------------------------------------------------------------------------
// `window.__tug` binding — DEV + __tugTestMode only
// ---------------------------------------------------------------------------

/**
 * Global `window.__tug` handle, typed via `declare global` so the
 * attach below reads as a plain assignment rather than routing
 * through `Record<string, unknown>`.
 */
declare global {
  interface Window {
    /**
     * In-app test harness surface. Attached ONLY when
     * `import.meta.env.DEV && window.__tugTestMode === true` at
     * {@link attachTugTestSurface} time. Release builds never
     * populate it because the attach branch is tree-shaken; DEV
     * builds that aren't in test mode leave it `undefined` so
     * app code that accidentally reads `window.__tug` in prod
     * never sees a surface it shouldn't be using.
     */
    __tug?: TugTestSurface;
  }
}

/**
 * Install `window.__tug` from `main.tsx`, gated by BOTH the
 * DEV build flag and the `__tugTestMode` boot flag.
 *
 * The double guard is deliberate ([D03]):
 *
 *   - `import.meta.env.DEV` lets Vite tree-shake the entire branch
 *     (including `createTugTestSurface` and its transitive imports)
 *     out of release bundles.
 *   - `window.__tugTestMode === true` is set by the Swift host's
 *     DEBUG-only `WKUserScript` at `atDocumentStart` ([D08]), so
 *     even dev builds loaded in a normal (non-harness) browser
 *     never install the surface.
 *
 * The attach is idempotent: calling it a second time overwrites the
 * previous `window.__tug` with a surface bound to the newly-supplied
 * deck. In practice the parent plan calls it exactly once per page
 * load from `main.tsx`; the idempotence exists for hot-reload
 * scenarios where the DeckManager instance changes mid-session.
 */
export function attachTugTestSurface(deck: DeckManager): void {
  if (
    import.meta.env?.DEV === true &&
    typeof window !== "undefined" &&
    window.__tugTestMode === true
  ) {
    window.__tug = createTugTestSurface(deck);
  }
}
