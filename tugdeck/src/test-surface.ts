/**
 * test-surface.ts -- In-app test harness surface (`window.__tug`).
 *
 * Scope of this module
 * --------------------
 * Exports {@link TugTestSurface} — the TypeScript interface the Swift
 * bridge talks to via `evaluateJavaScript` — and
 * {@link createTugTestSurface}, which binds that interface to a live
 * {@link DeckManager} instance. Also contains the `__tugTestMode`
 * guarded attach that installs `window.__tug` from `main.tsx`.
 *
 * Authoritative references
 * ------------------------
 * - [D01]: per-test isolation via granular `reset`.
 * - [D03]: DEBUG-only / release-safe.
 * - [D11]: surface is versioned; harness handshakes.
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
 * major on breaking changes, the minor on additive changes, and
 * coordinate with the in-app harness when the wire shape changes.
 */

import type { DeckManager } from "./deck-manager";
import type { DeckState, CardStateBag } from "./layout-tree";
import { deckTrace, type DeckTraceEvent } from "./deck-trace";
import { nodeToPath, selectionGuard } from "./components/tugways/selection-guard";
import {
  cardSessionBindingStore,
  type CardSessionMode,
} from "./lib/card-session-binding-store";
import { dispatchAction } from "./action-dispatch";

// ---------------------------------------------------------------------------
// Public types (`TugTestSurface`)
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
 *
 * `1.2.0`: adds EM-card
 * observation surface — {@link TugTestSurface.getEmCardState} and
 * {@link TugTestSurface.awaitEngineReady}. `getEngineSelection` and
 * `drainTugcodeTurn` are not separate surface entry points: the former is
 * subsumed by `getEmCardState().engineSelection`, the latter
 * requires tugcast-bypass plumbing not yet in place. Tugcode
 * lifecycle delegates (`startTugcode` / `stopTugcode` / etc.)
 * live as RPC verbs on the App handle in `_harness/index.ts`,
 * not on `__tug.*` — page-side delegates would be a layering
 * violation (only Swift can spawn subprocesses). Major stays `1`;
 * additive.
 *
 * `1.3.0`: adds
 * {@link TugTestSurface.getCardStateBag} (full bag introspection
 * for [AT0017] saveState-RPC-parity) and {@link TugTestSurface.closePane}
 * (whole-pane teardown for [AT0019] flush coverage). Markdown content
 * fixtures for [AT0014] / [AT0023] ride through a separate
 * `gallery-markdown-50kb` card registration that bakes 50KB of
 * static content on mount — no test-specific surface needed.
 * Additive; major stays `1`.
 *
 * `1.4.0`: adds
 * {@link TugTestSurface.appReload} and
 * {@link TugTestSurface.getReadyGen}. `appReload` invokes the
 * same `dispatchAction({ action: "reload" })` path the
 * `Developer > Reload` menu fires — `prepareForReload` →
 * synchronous flush → `location.reload()`. `getReadyGen` returns
 * a generation counter that {@link attachTugTestSurface}
 * increments at every page boot, persisted across reloads via
 * `sessionStorage`. The bun-side `app.appReload()` records the
 * pre-reload value, fires `appReload`, and polls `getReadyGen`
 * until it advances — that's the "the new page is up" signal,
 * tolerant of mid-navigation `evaluateJavaScript` errors.
 * Additive; major stays `1`.
 */
export const SURFACE_VERSION = "1.5.0" as const;

/**
 * `sessionStorage` key for the cross-reload generation counter.
 * `attachTugTestSurface` increments it on every page boot. The bun
 * harness's `app.appReload()` records the pre-reload value and
 * polls until it advances; that's the deterministic "the new page
 * has booted and `__tug` is ready again" signal. Survives
 * `location.reload()` because `sessionStorage` is per-tab/origin
 * and not cleared by reload (only by tab close), so the new page
 * sees the previous value and increments past it.
 */
const READY_GEN_STORAGE_KEY = "__tugReadyGen";

/**
 * Snapshot of the caret / selection for a single card, as returned by
 * {@link TugTestSurface.getCaretState}. Two variants cover the axes we
 * care about:
 *
 *   - `input` — the active element is a `<input>` / `<textarea>` with
 *     `data-tug-state-key`, and the snapshot carries the control's
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
  /** Drop per-card Component State Preservation Protocol registries. */
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
 * `cardId` is the nearest ancestor's `data-card-id`; `componentStatePreservationKey` is
 * the element's own `data-tug-state-key`. Both default to `null`
 * when absent. `selector` is a best-effort locator ("#id" if the
 * element has an id, else "tag[data-card-id=...]" when inside a card)
 * — useful for logging but NOT intended as a round-trip selector that
 * the harness re-uses.
 */
export interface ActiveElementInfo {
  tagName: string;
  id: string | null;
  cardId: string | null;
  componentStatePreservationKey: string | null;
  selector: string;
}

/**
 * Snapshot of an engine-managed (EM) card's state, as returned by
 * {@link TugTestSurface.getEmCardState}. EM cards are factories
 * whose `useCardStatePreservation`'s `onSave` returns a structured
 * engine state object (text, selection, atoms — see
 * `lib/tug-text-engine.ts::TugTextEditingState`). The framework
 * stashes that object as `bag.content`; this surface method
 * reads it back and tags it with the card's `componentId` so
 * tests can branch on engine flavor.
 *
 * `streamState` and `lastTurnSeq` are stub fields while the
 * harness's tugcode is not wired into tugdeck's production AI session
 * path, so no streaming activity is observable from this surface
 * today. The fields are present so test code can pin against them
 * now without rewriting when a later integration adds the real
 * values.
 */
export interface EmCardState {
  kind: "em";
  /**
   * The card's `componentId` — e.g. `"gallery-prompt-input"`,
   * `"gallery-prompt-entry"`, `"tide-card"`. Tagged so tests can
   * branch on engine flavor without consulting deck state
   * separately.
   */
  engine: string;
  /**
   * Plain-text content of the engine's current document. Read
   * from `bag.content.text` (the engine's `captureState()` shape
   * for TugTextEngine). Empty string when the engine has no
   * `text` field captured.
   */
  text: string;
  /**
   * Engine-specific selection snapshot, as captured by
   * `engine.captureState().selection`. Shape varies by engine —
   * the surface does not normalize. `null` when no selection.
   */
  engineSelection: unknown;
  /**
   * Streaming status. Stub (always `"idle"`) until real tugcode
   * integration is wired.
   */
  streamState: "idle" | "streaming" | "error";
  /**
   * Last completed turn sequence number. Stub (always `0`) until
   * wired to the session pipeline.
   */
  lastTurnSeq: number;
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
 * Additive changes bump {@link SURFACE_VERSION}'s minor; breaking
 * changes bump the major and need coordinated app + harness updates.
 */
export interface TugTestSurface {
  readonly version: typeof SURFACE_VERSION;

  // ---- State seeding ----
  seedDeckState(args: SeedDeckStateArgs): void;

  // ---- Granular reset ([D01]) ----
  reset(opts: ResetOptions): void;

  // ---- Gesture drivers (synthetic DOM event sequences) ----
  click(selector: string, opts?: ClickOptions): void;
  type(selector: string, text: string): void;
  focusElement(selector: string): void;

  // ---- State reads ----
  getActiveCardId(): string | null;
  getFocusedCardId(): string | null;
  getCaretState(cardId: string): CaretState | null;
  getFormControlValue(cardId: string, componentStatePreservationKey: string): string | null;
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

  // ---- Reload primitives (SURFACE_VERSION 1.4.0) ----

  /**
   * Trigger a soft reload via the same code path as the
   * `Developer > Reload` menu: `dispatchAction({action:"reload"})`,
   * which routes through the registered handler in
   * `action-dispatch.ts` —
   * `prepareForReload().then(() => location.reload())`. The
   * `prepareForReload` chain saves layout, drains every card's
   * save callback, and synchronously flushes dirty state through
   * tugcast to tugbank disk before the page navigates ([L23]).
   *
   * The action handler dedupes via a module-scoped `reloadPending`
   * flag, so a second `appReload()` in the same JS context is a
   * silent no-op. The flag resets on the new page (fresh module
   * instance), so subsequent reloads after a successful round-trip
   * work.
   *
   * Returns synchronously after kicking off the
   * `prepareForReload` Promise — `location.reload()` fires from
   * the `.then()` once the flush completes. Callers that need to
   * wait for the new page must poll {@link getReadyGen} for an
   * advancing value (the bun-side `app.appReload()` wrapper does
   * this).
   */
  appReload(): void;

  // ---- Generic control-action dispatch (SURFACE_VERSION 1.5.0) ----

  /**
   * Fire a control-action dispatch through the same path the native
   * Swift host uses for menu items and keyboard shortcuts:
   * `action-dispatch.ts`'s `dispatchAction({ action })`. Routes
   * through any registered handler (e.g. `show-component-gallery`,
   * `add-card-to-active-pane`, `close`, `reload`).
   *
   * Returns `true` if a handler ran (registered + chain reached a
   * matching responder), `false` otherwise. Most actions delegate to
   * `responderChainManagerRef.sendToFirstResponder(...)` internally —
   * so a `false` return commonly means "no first responder is set
   * AND no responder up the chain handles this action," which is the
   * useful signal for tests that need to verify an action stays
   * reachable across deck mutations.
   */
  dispatchControlAction(actionName: string): void;

  /**
   * Return the current "ready generation" — a counter
   * {@link attachTugTestSurface} increments on every page boot,
   * persisted across `location.reload()` via `sessionStorage`.
   *
   * The bun harness reads this BEFORE calling {@link appReload},
   * fires the reload, and then polls until `getReadyGen()`
   * returns a strictly greater value. That's the deterministic
   * "the new page has booted and `__tug` is online again"
   * signal — robust against the mid-navigation
   * `evaluateJavaScript` errors WKWebView can produce while the
   * page transitions.
   *
   * Returns `0` when no value is stored yet (first attach in a
   * fresh tab); `attachTugTestSurface` writes a `1` immediately,
   * so a caller observing `0` at any point after the surface is
   * attached has hit a page-storage misconfiguration.
   */
  getReadyGen(): number;

  // ---- EM-card observation (SURFACE_VERSION 1.2.0) ----

  /**
   * Read an EM card's engine state. Returns `null` when the card
   * is unknown OR is not an EM card (no `bag.content` written by
   * an `onSave`-returning-engine-state factory). The returned
   * shape's `engine` field tags the factory by `componentId`.
   *
   * Fires {@link DeckManager.invokeSaveCallback} synchronously
   * before reading so the bag reflects the engine's current
   * state, not the last debounced save (which may be hundreds of
   * ms stale). The cost is one engine `captureState()` call —
   * negligible — and the alternative would force tests to
   * manually drive a save before every read.
   */
  getEmCardState(cardId: string): EmCardState | null;

  /**
   * Synchronous "has the engine for `cardId` already emitted its
   * `engine-ready` event?" probe. Returns `true` when the deck-
   * trace ring contains an `engine-ready` event for the card,
   * `false` otherwise. The matching emit site lives at each EM-
   * engine factory's mount-time engine init (wired first in
   * `tug-prompt-input.tsx`; tide-card / gallery-prompt-entry
   * follow as they pick up their own sites).
   *
   * The harness's `awaitEngineReady` wraps this in
   * `waitForCondition` for the blocking variant — the JS surface
   * itself stays synchronous because evalJS-side busy-waits
   * can't observe trace ring writes from the same thread. The
   * trace ring is bounded but generous (512); the event survives
   * for any realistic test setup window.
   */
  isEngineReady(cardId: string): boolean;

  /**
   * Bind a fake session for a tide card so it skips past the
   * project-picker UI and renders TideCardBody directly. Without a
   * binding, `useTideCardServices` returns `null` and tide-card
   * shows the picker; production sets the binding from a
   * `spawn_session_ok` CONTROL ack that requires a live tugcast +
   * tugcode + Claude pipeline. Tests that exercise tide-specific
   * behavior — focus, selection, persistence, app-lifecycle
   * round-trips — don't need real session frames; they need the
   * editor to mount. This helper writes synthetic values directly
   * into `cardSessionBindingStore` so the existing services
   * reconciler constructs the real-shape services bag against the
   * harness's WebSocket connection. The stores stay empty (no
   * frames flow), but the editor renders and accepts focus.
   *
   * `tugSessionId` and `workspaceKey` default to deterministic
   * test-only sentinels so the same call shape works across every
   * tide test. Pass overrides only when a test specifically needs
   * a non-default value (e.g. testing workspace-key isolation
   * across sibling cards).
   *
   * Test-mode-only. Available when `window.__tugTestMode === true`.
   */
  bindTideSession(
    cardId: string,
    options?: {
      tugSessionId?: string;
      workspaceKey?: string;
      projectDir?: string;
      /**
       * `"new" | "resume"` — the user's session-mode intent at
       * card-open time. Threaded onto `CodeSessionSnapshot.sessionMode`
       * by `cardServicesStore` so pure derivations (e.g.
       * `deriveTideCardBannerSpec`) can branch on it. Defaults to
       * `"new"` so existing tests, which model the fresh-bind path,
       * keep their current semantics; tests that exercise resume
       * behavior (cold-boot preflight, replay-loading banner, etc.)
       * pass `"resume"` explicitly.
       */
      sessionMode?: CardSessionMode;
    },
  ): void;

  /**
   * Read the deck's current `hasFocus` state. The deck's
   * `installDeckStoreFocusListeners` flips this to `true` on
   * `window.focus` and `false` on `window.blur`; reading it from
   * the harness gives a synchronous probe for "has the JS-side
   * focus event fired and drained?" — useful after
   * `simulateAppResign` / `simulateAppBecomeActive` to confirm
   * WKWebView actually dispatched the blur/focus event (not just
   * AppKit's `did...Active` notification, which the Swift
   * primitive already waits for). Under rapid back-to-back
   * lifecycle simulations WebKit's window event dispatch can
   * lag the AppKit notification by several milliseconds.
   */
  getHasFocus(): boolean;

  /**
   * Read a card's full {@link CardStateBag} from the deck's in-
   * memory cache. Returns `null` when no bag exists. Does NOT
   * force a save first — callers wanting fresh state should call
   * `window.tugdeck.saveState()` (or trigger a will-phase save)
   * first. Used by [AT0017] saveState-RPC-parity
   * audit for structural diffs of the bag across save paths.
   */
  getCardStateBag(cardId: string): CardStateBag | null;

  /**
   * Close an entire pane by id. Mirrors `deckManager.handlePaneClosed`,
   * the entry point a "close every card in this pane" UI affordance
   * would call. Used by [AT0019] pane-teardown-flush
   * audit so a multi-card pane's `_closePane` flush loop can be
   * exercised directly rather than driven through the per-tab close
   * button (which routes through `_removeCard` and only delegates to
   * `_closePane` for the last surviving card in a single-card pane).
   */
  closePane(paneId: string): void;
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
 * `cardRoot` and carries a `data-tug-state-key` key. Returns
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
  if (active.getAttribute("data-tug-state-key") === null) return null;
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
    // Component State Preservation Protocol registries are owned by
    // the deck-manager (see `componentStatePreservationRegistries`).
    // They have no public
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

  // --- event synthesis ---
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
    //    Natural DOM ordering for a full click.
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
      // Direct `.focus()` — fallback
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

    getFormControlValue(cardId: string, componentStatePreservationKey: string): string | null {
      const cardRoot = deck.peekCardHostRoot(cardId);
      if (cardRoot === null) return null;
      // `CSS.escape` is important: componentStatePreservationKeys are authored
      // strings and can technically contain characters that would
      // otherwise be interpreted as selector syntax.
      const selector = `[data-tug-state-key="${CSS.escape(componentStatePreservationKey)}"]`;
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
      const componentStatePreservationKey = active.getAttribute("data-tug-state-key");
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
        componentStatePreservationKey,
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

    // ---- Reload primitives (SURFACE_VERSION 1.4.0) ----

    appReload(): void {
      // Same dispatch the `Developer > Reload` menu fires (see
      // `action-dispatch.ts` `registerAction("reload", ...)`).
      // Routing through `dispatchAction` rather than calling
      // `prepareForReload` + `location.reload()` directly keeps the
      // dedup guard (`reloadPending`) and any future reload-side
      // bookkeeping in one place. [L23]
      dispatchAction({ action: "reload" });
    },

    dispatchControlAction(actionName: string): void {
      dispatchAction({ action: actionName });
    },

    getReadyGen(): number {
      return readReadyGen();
    },

    // ---- EM-card observation (SURFACE_VERSION 1.2.0) ----

    getEmCardState(cardId: string): EmCardState | null {
      // Force a save so the bag reflects current engine state
      // rather than a stale snapshot from the last debounced /
      // visibilitychange flush. `invokeSaveCallback` no-ops if no
      // save callback is registered for the cardId, so this is
      // safe even when the card has no engine.
      deck.invokeSaveCallback(cardId, "manual");
      const bag = deck.getCardState(cardId);
      if (bag === undefined || bag.content === undefined) return null;

      // Look up the card's componentId for the `engine` tag.
      // `getSnapshot()` reads the same `cards[]` array reactive
      // consumers see, so a card that was just removed is a
      // miss — return null in that race rather than synthesizing
      // a partial state.
      const snapshot = deck.getSnapshot();
      const card = snapshot.cards.find((c) => c.id === cardId);
      if (card === undefined) return null;

      // EM persistence comes in two shapes:
      //
      //   - Raw `TugTextEditingState`: `{ text, atoms, selection }`.
      //     This is what TugPromptInput's standalone
      //     useCardStatePreservation (`gallery-prompt-input`) returns.
      //
      //   - TugPromptEntry wrapper:
      //     `{ currentRoute, perRoute: { [route]: TugTextEditingState }, maximized }`.
      //     This is what TugPromptEntry returns
      //     (`gallery-prompt-entry`, tide-card). Reach into
      //     `perRoute[currentRoute]` to get the engine state for
      //     the active route.
      //
      // Detection is shape-based rather than componentId-based so
      // a future EM factory that adopts either shape works
      // automatically. `perRoute` + `currentRoute` together are
      // the discriminator for the wrapper shape.
      const content = bag.content as Record<string, unknown>;
      let engineState: Record<string, unknown> = content;
      if (
        typeof content.currentRoute === "string" &&
        typeof content.perRoute === "object" &&
        content.perRoute !== null
      ) {
        const perRoute = content.perRoute as Record<string, unknown>;
        const route = content.currentRoute as string;
        const inner = perRoute[route];
        if (typeof inner === "object" && inner !== null) {
          engineState = inner as Record<string, unknown>;
        }
      }
      const text = typeof engineState.text === "string" ? engineState.text : "";
      const selection =
        "selection" in engineState ? engineState.selection : null;

      return {
        kind: "em",
        engine: card.componentId,
        text,
        engineSelection: selection,
        streamState: "idle",
        lastTurnSeq: 0,
      };
    },

    isEngineReady(cardId: string): boolean {
      // Walk the trace ring in reverse — the most-recent
      // `engine-ready` for `cardId` is what the test cares about
      // (older entries from a different mount cycle are
      // irrelevant once a new engine for the same id has reported
      // ready).
      const events = deckTrace.dump();
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.kind === "engine-ready" && e.cardId === cardId) return true;
      }
      return false;
    },

    bindTideSession(
      cardId: string,
      options?: {
        tugSessionId?: string;
        workspaceKey?: string;
        projectDir?: string;
        sessionMode?: CardSessionMode;
      },
    ): void {
      cardSessionBindingStore.setBinding(cardId, {
        tugSessionId: options?.tugSessionId ?? `test-session-${cardId}`,
        workspaceKey: options?.workspaceKey ?? `test-workspace-${cardId}`,
        projectDir: options?.projectDir ?? "/tmp/test-project",
        sessionMode: options?.sessionMode ?? "new",
      });
    },

    getHasFocus(): boolean {
      return deck.getSnapshot().hasFocus;
    },

    getCardStateBag(cardId: string): CardStateBag | null {
      const bag = deck.getCardState(cardId);
      return bag === undefined ? null : bag;
    },

    closePane(paneId: string): void {
      deck.handlePaneClosed(paneId);
    },
  };
}

// ---------------------------------------------------------------------------
// Ready-generation helpers (SURFACE_VERSION 1.4.0)
// ---------------------------------------------------------------------------

/**
 * Read the current ready-gen counter from `sessionStorage`. Returns
 * `0` when the slot is missing or unparseable. Defensive parsing
 * because `sessionStorage` values are user-controllable in principle —
 * the harness never writes garbage, but a malformed value should
 * round-trip as a fresh start rather than a thrown exception that
 * tears down the whole test surface.
 */
function readReadyGen(): number {
  if (typeof sessionStorage === "undefined") return 0;
  const raw = sessionStorage.getItem(READY_GEN_STORAGE_KEY);
  if (raw === null) return 0;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Increment the ready-gen counter and write it back. Called by
 * {@link attachTugTestSurface} on every page boot — including the
 * one after a `location.reload()`. The bun harness's
 * `app.appReload()` reads the counter pre-reload and polls until it
 * advances post-reload to confirm the new page is online.
 *
 * Silent no-op when `sessionStorage` is unavailable (non-browser
 * environments running tests against this module).
 */
function bumpReadyGen(): void {
  if (typeof sessionStorage === "undefined") return;
  const next = readReadyGen() + 1;
  sessionStorage.setItem(READY_GEN_STORAGE_KEY, String(next));
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
 * deck. In practice the app calls it exactly once per page
 * load from `main.tsx`; the idempotence exists for hot-reload
 * scenarios where the DeckManager instance changes mid-session.
 */
export function attachTugTestSurface(deck: DeckManager): void {
  // Gate on `window.__tugTestMode` only. Production users never have this
  // global set (it is injected by a DEBUG-only `WKUserScript` in Tug.app —
  // see `tugapp/Sources/TestHarness/TestHarnessUserScript.swift`), so the
  // attach is a no-op in production. Dropping the `import.meta.env.DEV`
  // half of the previous gate lets the in-app harness drive a prod-built
  // `dist/` (no Vite) — the launch path that runs `vite build` once and
  // serves static files is ~700ms faster than the dev-server path.
  if (typeof window !== "undefined" && window.__tugTestMode === true) {
    window.__tug = createTugTestSurface(deck);
    // Advance the ready-gen counter so the bun harness's
    // `app.appReload()` can detect post-reload re-attach by
    // polling for a strictly greater value than the pre-reload
    // read. The counter persists across `location.reload()` via
    // `sessionStorage` (per-tab/origin, not cleared by reload),
    // so the new page increments past the old.
    bumpReadyGen();
  }
}
