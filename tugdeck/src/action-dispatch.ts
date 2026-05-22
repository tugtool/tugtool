/**
 * Action dispatcher for incoming Control frames.
 *
 * Implements a Map-based action registry where handlers can be registered
 * and dispatched based on the action string in Control frame payloads.
 *
 * ## Two kinds of registered actions
 *
 * Per `tuglaws/action-naming.md`, the action-dispatch registry carries
 * two flavors of wire name:
 *
 * - **Control-frame-only** actions — app-level RPC from Swift to JS
 *   that never walks the responder chain. These stay as kebab-case
 *   string literals at the `registerAction` call site because they
 *   have no chain-action counterpart. Examples: `reload`, `set-theme`,
 *   `next-theme`, `set-dev-mode`, `show-card`, `source-tree`.
 *
 * - **Both** (identity) actions — Control-frame RPCs whose entire
 *   purpose is to inject a chain dispatch on behalf of a Swift menu
 *   item. These use the corresponding `TUG_ACTIONS.*` constant at
 *   both the `registerAction` call and the inner `manager.sendToFirstResponder`
 *   call, so the wire string on both sides is identical. Examples:
 *   `TUG_ACTIONS.SHOW_COMPONENT_GALLERY`, `TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE`,
 *   `TUG_ACTIONS.CLOSE`. The Swift side calls `sendControl("close")`
 *   (etc.) with the same string.
 *
 * Phase 0: DevNotificationRef dependency removed, card handlers removed.
 * Phase 2: Added gallerySetterRef and show-component-gallery handler.
 * Phase 5b3 (Step 6): Removed gallerySetterRef and registerGallerySetter.
 *   show-component-gallery now dispatches through the responder chain
 *   manager (same pattern as add-card-to-active-pane).
 * Action-naming rollout: Both-category handlers use TUG_ACTIONS constants
 *   at the registerAction call site; close-active-card was renamed to
 *   `close` so its wire format matches the chain-action name.
 * (#s04-action-dispatch-shape), [D04] Gut action-dispatch
 * (#s05-gallery-action)
 */

import type { TugConnection } from "./connection";
import type { DeckManager } from "./deck-manager";
import type { ResponderChainManager } from "./components/tugways/responder-chain";
import { FeedId } from "./protocol";
import { BASE_THEME_NAME } from "./theme-constants";
import { transferFocusForActivation } from "./focus-transfer";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { cardSessionBindingStore } from "./lib/card-session-binding-store";
import { tideSpawnErrorStore } from "./lib/tide-spawn-error-store";
import { tugDevPanelStore } from "./lib/tug-dev-panel-store/tug-dev-panel-store";
import { logSessionLifecycle } from "./lib/session-lifecycle-log";
import { getAppLifecycle } from "./lib/app-lifecycle";
import { decodeSessionUpdated } from "./protocol";
import type {
  CardBinding,
  SessionRow,
  SessionStateChangeWireRow,
} from "./protocol";
import {
  publishSessionUpdated,
  publishListSessionsOk,
  publishListSessionsErr,
  publishListCardBindingsOk,
  publishListCardBindingsErr,
  publishForgetSessionOk,
  publishForgetSessionErr,
  publishForgetProjectDirSessionsOk,
  publishForgetProjectDirSessionsErr,
  publishListSessionStateChangesOk,
  publishListSessionStateChangesErr,
} from "./lib/tide-session-ledger-events";

/**
 * Ordered list of all shipped themes.
 * Must stay in sync with tugdeck/styles/themes/*.css plus the base theme.
 * Base theme always comes first; others follow in alphabetical order.
 */
export const SHIPPED_THEME_NAMES: readonly string[] = [BASE_THEME_NAME, "harmony"];

/** Handler function for an action */
export type ActionHandler = (payload: Record<string, unknown>) => void;

/** Map of action names to handler functions */
const handlers = new Map<string, ActionHandler>();

/** Module-level flag to prevent duplicate reload calls */
let reloadPending = false;

/** Module-level reference to the theme setter, populated by TugThemeProvider on mount. */
let themeSetterRef: ((theme: string) => void) | null = null;

/** Module-level reference to the theme getter, populated by TugThemeProvider on mount. */
let themeGetterRef: (() => string) | null = null;

/**
 * Module-level reference to the ResponderChainManager, populated by
 * ResponderChainProvider on mount via `registerResponderChainManager`.
 *
 * Used by the `add-card-to-active-pane` and `show-component-gallery` Control-frame actions
 * to dispatch through the responder chain, which routes them to DeckCanvas's
 * registered handlers.
 *
 * [D06] Add-tab action uses DeckManager + responder chain
 * [D09] Add-tab routed as DeckCanvas responder action
 */
let responderChainManagerRef: ResponderChainManager | null = null;

/**
 * Register the theme setter function from TugThemeProvider.
 * Called by TugThemeProvider on mount so the set-theme action handler
 * can call it when a Theme submenu item is selected.
 */
export function registerThemeSetter(setter: (theme: string) => void): void {
  themeSetterRef = setter;
}

/**
 * Get the registered theme setter (used by the set-theme action handler).
 * Returns null if TugThemeProvider has not yet mounted.
 */
export function getThemeSetter(): ((theme: string) => void) | null {
  return themeSetterRef;
}

/**
 * Register the theme getter function from TugThemeProvider.
 * Called by TugThemeProvider on mount so the next-theme action handler
 * can read the current theme name.
 */
export function registerThemeGetter(getter: () => string): void {
  themeGetterRef = getter;
}

/**
 * Get the registered theme getter (used by the next-theme action handler).
 * Returns null if TugThemeProvider has not yet mounted.
 */
export function getThemeGetter(): (() => string) | null {
  return themeGetterRef;
}

/**
 * Register the ResponderChainManager from ResponderChainProvider.
 * Called by ResponderChainProvider on mount so the `add-tab` and
 * `show-component-gallery` action handlers can dispatch through the chain.
 *
 * Last-registration-wins: calling again replaces the previous manager.
 *
 * [D06] Add-tab action uses DeckManager + responder chain
 */
export function registerResponderChainManager(manager: ResponderChainManager): void {
  responderChainManagerRef = manager;
}

/**
 * Get the registered ResponderChainManager, or `null` if
 * `ResponderChainProvider` has not mounted (standalone gallery use,
 * unit tests, the brief pre-mount window).
 *
 * Lets non-React modules — e.g. the CM6 caret layer's dev-only
 * focus/first-responder invariant probe — read first-responder state
 * without threading the manager through React context.
 */
export function getResponderChainManager(): ResponderChainManager | null {
  return responderChainManagerRef;
}

/** TextDecoder for UTF-8 payload decoding */
const textDecoder = new TextDecoder();

/**
 * Register an action handler.
 */
export function registerAction(action: string, handler: ActionHandler): void {
  handlers.set(action, handler);
}

/**
 * Reset handler registry and module state for test isolation.
 * Internal/test-only -- must never be called from production code.
 */
export function _resetForTest(): void {
  handlers.clear();
  reloadPending = false;
  themeSetterRef = null;
  themeGetterRef = null;
  responderChainManagerRef = null;
}

/**
 * Dispatch an action to its registered handler.
 */
export function dispatchAction(payload: Record<string, unknown>): void {
  const action = payload.action;
  if (typeof action !== "string") {
    // Server error frames are CONTROL frames shaped
    // `{ type: "error", detail: "..." }` with no `action` field —
    // they are RPC error responses (e.g. a `spawn_session` rejected
    // with `session_live_elsewhere` / `session_unknown`), not
    // dispatchable actions. Surface them as errors carrying the
    // detail rather than swallowing them as a generic "missing
    // action field" warning, so a failed session restore is
    // diagnosable instead of silent.
    if (payload.type === "error") {
      const detail =
        typeof payload.detail === "string" ? payload.detail : "(no detail)";
      console.error(
        `dispatchAction: server error frame — ${detail}`,
        payload,
      );
      return;
    }
    console.warn("dispatchAction: payload missing action field", payload);
    return;
  }

  const handler = handlers.get(action);
  if (handler) {
    handler(payload);
  } else {
    console.warn(`dispatchAction: unknown action: ${action}`, payload);
  }
}

/**
 * Initialize action dispatch system.
 *
 * Registers a callback for Control frames and registers all built-in
 * handlers. Returns a disposer that unsubscribes any lifecycle
 * subscriptions installed here (currently the save-on-resign
 * subscription on `AppLifecycle`); callers that never tear the wiring
 * down can ignore the return value. Production does not call the
 * disposer; tests that re-initialize the action-dispatch wiring
 * should.
 *
 * The Control-frame `onFrame` callback is not reversible — `TugConnection.onFrame`
 * has no dispose surface today — so it stays registered for the lifetime
 * of the connection.
 */
export function initActionDispatch(
  connection: TugConnection,
  deckManager: DeckManager
): () => void {
  // Register Control frame callback
  connection.onFrame(FeedId.CONTROL, (payload: Uint8Array) => {
    try {
      const json = textDecoder.decode(payload);
      const data = JSON.parse(json) as Record<string, unknown>;
      dispatchAction(data);
    } catch (error) {
      console.error("initActionDispatch: failed to parse Control frame", error);
    }
  });

  // Register built-in handlers

  // reload: Reload page with dedup guard.
  // prepareForReload() saves+flushes with a normal fetch and sets reloadPending
  // on DeckManager so the beforeunload handler skips the redundant keepalive
  // flush (which fails in WKWebView during page navigation with CORS errors).
  registerAction("reload", () => {
    if (reloadPending) return;
    reloadPending = true;
    deckManager.prepareForReload().then(() => {
      location.reload();
    });
  });

  // set-dev-mode: Call WKScriptMessageHandler bridge if available
  registerAction("set-dev-mode", (payload) => {
    const enabled = payload.enabled;
    if (typeof enabled !== "boolean") {
      console.warn("set-dev-mode: missing or invalid enabled parameter", payload);
      return;
    }

    console.info(`set-dev-mode: enabled=${enabled}`);

    const webkit = (globalThis as unknown as Record<string, unknown>).webkit as Record<string, unknown> | undefined;
    const messageHandlers = webkit?.messageHandlers as Record<string, unknown> | undefined;
    if (messageHandlers?.setDevMode) {
      (messageHandlers.setDevMode as { postMessage: (v: unknown) => void }).postMessage({ enabled });
    } else {
      console.info("set-dev-mode: WKScriptMessageHandler bridge not available");
    }
  });

  // set-theme: Switch the active theme via TugThemeProvider.
  // Accepts any string theme name — validation is delegated to the theme provider,
  // which fetches CSS via middleware and handles 404s gracefully. [D07]
  // The Swift AppDelegate sends this action from the Theme submenu.
  registerAction("set-theme", (payload) => {
    const theme = payload.theme;
    if (typeof theme !== "string") {
      console.warn("set-theme: invalid theme", payload);
      return;
    }
    if (themeSetterRef) {
      themeSetterRef(theme);
    } else {
      console.warn("set-theme: theme setter not registered yet");
    }
  });

  // next-theme: Advance to the next shipped theme (wrapping around).
  // Uses SHIPPED_THEME_NAMES to determine order and the registered themeGetterRef to
  // read the current theme. Falls back to the base theme if the getter is not yet
  // registered or the current theme is not in the shipped list.
  registerAction("next-theme", () => {
    const currentTheme = themeGetterRef ? themeGetterRef() : SHIPPED_THEME_NAMES[0];
    const idx = SHIPPED_THEME_NAMES.indexOf(currentTheme);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % SHIPPED_THEME_NAMES.length;
    const nextTheme = SHIPPED_THEME_NAMES[nextIdx];
    if (themeSetterRef) {
      themeSetterRef(nextTheme);
    } else {
      console.warn("next-theme: theme setter not registered yet");
    }
  });

  // show-component-gallery (Both): show the Component Gallery card via the
  // DeckCanvas responder. The Control-frame name and the chain-action name
  // are the same string (TUG_ACTIONS.SHOW_COMPONENT_GALLERY), and this
  // handler is the trivial adapter — receive the Control frame, dispatch
  // the chain action, walk to DeckCanvas's registered handler. DeckCanvas
  // finds or creates the gallery card and focuses it. ([D05], [D07] show-only)
  registerAction(TUG_ACTIONS.SHOW_COMPONENT_GALLERY, () => {
    if (responderChainManagerRef) {
      responderChainManagerRef.sendToFirstResponder({ action: TUG_ACTIONS.SHOW_COMPONENT_GALLERY, phase: "discrete" });
    } else {
      console.warn(`${TUG_ACTIONS.SHOW_COMPONENT_GALLERY}: responder chain manager not registered yet`);
    }
  });

  // source-tree: Call WKScriptMessageHandler bridge if available
  registerAction("source-tree", () => {
    console.info("source-tree: triggering source tree picker");

    const webkit = (globalThis as unknown as Record<string, unknown>).webkit as Record<string, unknown> | undefined;
    const messageHandlers = webkit?.messageHandlers as Record<string, unknown> | undefined;
    if (messageHandlers?.sourceTree) {
      (messageHandlers.sourceTree as { postMessage: (v: unknown) => void }).postMessage({});
    } else {
      console.info("source-tree: WKScriptMessageHandler bridge not available");
    }
  });

  // show-dev-panel-toggle: Toggle the TugDevPanel's visibility. Fired
  // by the Swift Developer menu's "Show Dev Panel" item (Opt-Cmd-/).
  // Read-only inspector surface — no mutations propagate elsewhere.
  registerAction("show-dev-panel-toggle", () => {
    tugDevPanelStore.toggle();
  });

  // dev-panel-select-telemetry-tab / dev-panel-select-log-tab:
  // Programmatically switch the active inspector tab. Used by the
  // app-test harness to drive tab persistence verification without
  // synthesizing mouse events on the tab strip. Future tab-switch
  // menu items could route through the same action surface.
  registerAction("dev-panel-select-telemetry-tab", () => {
    tugDevPanelStore.selectTab("telemetry");
  });
  registerAction("dev-panel-select-log-tab", () => {
    tugDevPanelStore.selectTab("log");
  });

  // arrange-cards: Rearrange all cards on the canvas.
  // Swift sends arrange-cards with mode: "cascade" | "tile".
  registerAction("arrange-cards", (payload) => {
    const mode = payload.mode;
    if (mode !== "cascade" && mode !== "tile") {
      console.warn("arrange-cards: invalid mode", payload);
      return;
    }
    deckManager.arrangeCards(mode);
  });

  // focus-pane: Bring a pane to front by activating its active card.
  //
  // Swift's View menu builds a pane list from `pushCardListToHost` and
  // emits `focus-pane` with `payload.paneId` when the user picks an entry.
  // Routes through `activateCard` on the pane's `activeCardId`
  // so the menu selection fires the full will/didDeactivate +
  // will/didActivate transition and promotes the responder chain —
  // `focusCard` alone would only reorder z-order and skip the lifecycle
  // events.
  registerAction("focus-pane", (payload) => {
    const paneId = payload.paneId;
    if (typeof paneId !== "string") {
      console.warn("focus-pane: missing or invalid pane id (payload.paneId)", payload);
      return;
    }
    const pane = deckManager.getSnapshot().panes.find((s) => s.id === paneId);
    if (!pane) {
      console.warn(`focus-pane: no pane with id "${paneId}"`);
      return;
    }
    // Phase E.11 Step 4i D9b — runtime activation routed through
    // `transferFocusForActivation` so the menu activation fires
    // SAVE outgoing → commit → `applyBagFocus` on incoming. Raw
    // `activateCard` would flip the composite responder bit but
    // skip the focus claim.
    const incomingCardId = pane.activeCardId;
    transferFocusForActivation({
      outgoingCardId: deckManager.getFirstResponderCardId(),
      incomingCardId,
      store: deckManager,
      commitMutation: () => deckManager.activateCard(incomingCardId),
    });
  });

  // show-card: Add a card by componentId ()
  // The AppDelegate already sends show-card with component: "settings" and
  // component: "about" -- those will log a warning and return null from addCard
  // until Phase 9 registers those card types. This is correct behavior.
  registerAction("show-card", (payload) => {
    const component = payload.component;
    if (typeof component !== "string") {
      console.warn("show-card: missing or invalid component parameter", payload);
      return;
    }
    deckManager.addCard(component);
  });

  // add-card-to-active-pane (Both): add a new card to the focused pane.
  // Trivial adapter — Control-frame name and chain-action name are
  // identical (TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE). DeckCanvas's
  // registered handler reads the focused card from its cardsRef and
  // calls store.addCardToPane(). ([D06], [D09])
  registerAction(TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE, () => {
    if (responderChainManagerRef) {
      responderChainManagerRef.sendToFirstResponder({ action: TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE, phase: "discrete" });
    } else {
      console.warn(`${TUG_ACTIONS.ADD_CARD_TO_ACTIVE_PANE}: responder chain manager not registered yet`);
    }
  });

  // close (Both): close the focused card via the responder chain. Trivial
  // adapter — Control-frame name and chain-action name are identical
  // (TUG_ACTIONS.CLOSE = "close"). The walk lands on TugPane's registered
  // close handler. This is the File > Close Card menu item's Control-frame
  // round-trip: the Swift menu has keyEquivalent "w", so ⌘W triggers the
  // menu action (AppKit swallows the keystroke before the WKWebView sees
  // it) which fires this handler. The tugdeck-side keybinding map entry
  // for ⌘W exists for browser-only dev where no Swift menu is present.
  // [A3 / R4, action-naming]
  registerAction(TUG_ACTIONS.CLOSE, () => {
    if (responderChainManagerRef) {
      responderChainManagerRef.sendToFirstResponder({ action: TUG_ACTIONS.CLOSE, phase: "discrete" });
    } else {
      console.warn(`${TUG_ACTIONS.CLOSE}: responder chain manager not registered yet`);
    }
  });

  // spawn_session_ok: the tugcast supervisor echoes the
  // canonical workspace_key back via this CONTROL ack after a successful
  // spawn_session (). The handler populates
  // `cardSessionBindingStore` so `useCardWorkspaceKey(cardId)` returns
  // the exact string tugcast splices into FILETREE/FILESYSTEM/GIT
  // frames, enabling the per-card value-check filter in `TugPane`.
  //
  // Tugdeck does NOT canonicalize the path client-side — the canonical
  // form includes macOS firmlink resolution that JS path libraries
  // don't match. The server-provided `workspace_key` is the single
  // source of truth for filter identity.
  registerAction("spawn_session_ok", (payload) => {
    const cardId = payload.card_id;
    const tugSessionId = payload.tug_session_id;
    const workspaceKey = payload.workspace_key;
    const projectDir = payload.project_dir;
    const sessionMode = payload.session_mode;
    if (
      typeof cardId !== "string" ||
      typeof tugSessionId !== "string" ||
      typeof workspaceKey !== "string"
    ) {
      console.warn(
        "spawn_session_ok: missing or invalid field in ack payload",
        payload,
      );
      return;
    }
    // `project_dir` is the pre-canonical path the client sent in
    // `spawn_session`. Tugcast doesn't currently echo it in the ack
    // (only `workspace_key`), so fall back to the canonical form when
    // the ack omits it. The binding's `projectDir` is informational —
    // the filter uses `workspaceKey`.
    const projectDirResolved =
      typeof projectDir === "string" ? projectDir : workspaceKey;
    // Pre-`session_mode` server acks omit the field; default to
    // "new" to match the fresh-by-default behavior elsewhere.
    const sessionModeResolved =
      sessionMode === "resume" ? "resume" : "new";
    logSessionLifecycle("spawn.ack", {
      card_id: cardId,
      tug_session_id: tugSessionId,
      workspace_key: workspaceKey,
      project_dir: projectDirResolved,
      session_mode: sessionModeResolved,
    });
    cardSessionBindingStore.setBinding(cardId, {
      tugSessionId,
      workspaceKey,
      projectDir: projectDirResolved,
      sessionMode: sessionModeResolved,
    });
  });

  // session_updated: tugcast supervisor broadcasts these on every
  // ledger write (`record_spawn`, `record_turn`, `mark_closed`,
  // `mark_failed`, `forget`). Routed through the
  // `tide-session-ledger-events` bus so the picker's session-ledger
  // store (step 4) can patch its in-memory cache without re-fetching.
  registerAction("session_updated", (payload) => {
    const decoded = decodeSessionUpdated(payload);
    if (decoded === null) {
      console.warn("session_updated: invalid payload shape", payload);
      return;
    }
    publishSessionUpdated(decoded);
  });

  // list_sessions_ok / _err: response to a `list_sessions` request. The
  // store consumer (step 4) resolves its pending workspace fetch with
  // the rows or surfaces the error.
  registerAction("list_sessions_ok", (payload) => {
    const projectDir = payload.project_dir;
    const sessions = payload.sessions;
    if (typeof projectDir !== "string" || !Array.isArray(sessions)) {
      console.warn("list_sessions_ok: missing or invalid fields", payload);
      return;
    }
    // `dir_exists` gates the picker's Open button. Absent (older
    // tugcast) defaults to `true` so the dialog fails open — part 2's
    // spawn-error banner is the backstop.
    const dirExists =
      typeof payload.dir_exists === "boolean" ? payload.dir_exists : true;
    publishListSessionsOk({
      project_dir: projectDir,
      sessions: sessions as SessionRow[],
      dir_exists: dirExists,
    });
  });
  // spawn_session_error: the supervisor rejected a `spawn_session`
  // (e.g. the project directory no longer exists). The router echoes
  // the originating `card_id` so the failure routes to that card's
  // spawn-error banner — the unbound card has no CodeSessionStore to
  // carry it.
  registerAction("spawn_session_error", (payload) => {
    const cardId = payload.card_id;
    if (typeof cardId !== "string") {
      console.warn("spawn_session_error: missing card_id", payload);
      return;
    }
    const detail = payload.detail;
    tideSpawnErrorStore.set(cardId, {
      reason: typeof detail === "string" ? detail : "unknown",
    });
  });
  registerAction("list_sessions_err", (payload) => {
    const projectDir = payload.project_dir;
    const reason = payload.reason;
    if (typeof projectDir !== "string" || typeof reason !== "string") {
      console.warn("list_sessions_err: missing or invalid fields", payload);
      return;
    }
    publishListSessionsErr({ project_dir: projectDir, reason });
  });

  // list_card_bindings_ok / _err: response to a startup/reconnect
  // request from `restoreTideSessions`.
  registerAction("list_card_bindings_ok", (payload) => {
    const bindings = payload.bindings;
    if (!Array.isArray(bindings)) {
      console.warn("list_card_bindings_ok: missing or invalid bindings", payload);
      return;
    }
    publishListCardBindingsOk({ bindings: bindings as CardBinding[] });
  });
  registerAction("list_card_bindings_err", (payload) => {
    const reason = payload.reason;
    if (typeof reason !== "string") {
      console.warn("list_card_bindings_err: missing reason", payload);
      return;
    }
    publishListCardBindingsErr({ reason });
  });

  // forget_session_ok / _err
  registerAction("forget_session_ok", (payload) => {
    const sessionId = payload.session_id;
    if (typeof sessionId !== "string") {
      console.warn("forget_session_ok: missing session_id", payload);
      return;
    }
    publishForgetSessionOk({ session_id: sessionId });
  });
  registerAction("forget_session_err", (payload) => {
    const sessionId = payload.session_id;
    const reason = payload.reason;
    if (typeof sessionId !== "string" || typeof reason !== "string") {
      console.warn("forget_session_err: missing or invalid fields", payload);
      return;
    }
    publishForgetSessionErr({ session_id: sessionId, reason });
  });

  // forget_project_dir_sessions_ok / _err: response to a recents-eviction
  // → ledger-eviction dispatch from `card-services-store.ts`. The caller
  // is fire-and-forget (no UX surface waits on the ack), but registering
  // the handlers keeps the unknown-action warning out of the console.
  registerAction("forget_project_dir_sessions_ok", (payload) => {
    const projectDir = payload.project_dir;
    const count = payload.count;
    if (typeof projectDir !== "string" || typeof count !== "number") {
      console.warn("forget_project_dir_sessions_ok: missing or invalid fields", payload);
      return;
    }
    publishForgetProjectDirSessionsOk({ project_dir: projectDir, count });
  });
  registerAction("forget_project_dir_sessions_err", (payload) => {
    const projectDir = payload.project_dir;
    const reason = payload.reason;
    if (typeof projectDir !== "string" || typeof reason !== "string") {
      console.warn("forget_project_dir_sessions_err: missing or invalid fields", payload);
      return;
    }
    publishForgetProjectDirSessionsErr({ project_dir: projectDir, reason });
  });

  // list_session_state_changes_ok / _err: response to a
  // `list_session_state_changes` request from the popover-side reader
  // store. Rows are oldest-first by insertion order; unknown sessions
  // surface as an empty array (not an error).
  registerAction("list_session_state_changes_ok", (payload) => {
    const tugSessionId = payload.tug_session_id;
    const rows = payload.rows;
    if (typeof tugSessionId !== "string" || !Array.isArray(rows)) {
      console.warn("list_session_state_changes_ok: missing or invalid fields", payload);
      return;
    }
    publishListSessionStateChangesOk({
      tug_session_id: tugSessionId,
      rows: rows as SessionStateChangeWireRow[],
    });
  });
  registerAction("list_session_state_changes_err", (payload) => {
    const tugSessionId = payload.tug_session_id;
    const reason = payload.reason;
    if (typeof tugSessionId !== "string" || typeof reason !== "string") {
      console.warn("list_session_state_changes_err: missing or invalid fields", payload);
      return;
    }
    publishListSessionStateChangesErr({ tug_session_id: tugSessionId, reason });
  });

  // app-lifecycle: route macOS `NSApplicationDelegate` events into the
  // `AppLifecycle` singleton. The Swift side sends a control frame with
  // `action: "app-lifecycle"` and `event: "<willBecomeActive|didBecomeActive|
  // willResignActive|didResignActive|willHide|didHide|willUnhide|didUnhide>"`;
  // this handler dispatches to the matching `notifyApplication*` method.
  //
  // This control-frame path replaces earlier ad-hoc window globals so
  // the app lifecycle is a single unified pipe rather
  // than a set of one-off RPC functions.
  registerAction("app-lifecycle", (payload) => {
    const event = payload.event;
    if (typeof event !== "string") {
      console.warn("app-lifecycle: missing or invalid event", payload);
      return;
    }
    const lifecycle = getAppLifecycle();
    if (lifecycle === null) {
      console.warn(
        `app-lifecycle: AppLifecycle not registered yet (event=${event})`,
      );
      return;
    }
    // The Swift host tags frames replayed on tugcast reconnect with
    // `replayed: true` so the lifecycle trace can distinguish the
    // recovery path from a literal OS notification. Observers see no
    // difference — they are idempotent under repeated `did*` events
    // by contract (see `app-lifecycle.ts` JSDoc).
    if (payload.replayed === true) {
      console.log(`[AppLifecycle] replayed ${event} (post-reconnect resync)`);
    }
    switch (event) {
      case "willBecomeActive":
        lifecycle.notifyApplicationWillBecomeActive();
        break;
      case "didBecomeActive":
        lifecycle.notifyApplicationDidBecomeActive();
        break;
      case "willResignActive":
        lifecycle.notifyApplicationWillResignActive();
        break;
      case "didResignActive":
        lifecycle.notifyApplicationDidResignActive();
        break;
      case "willHide":
        lifecycle.notifyApplicationWillHide();
        break;
      case "didHide":
        lifecycle.notifyApplicationDidHide();
        break;
      case "willUnhide":
        lifecycle.notifyApplicationWillUnhide();
        break;
      case "didUnhide":
        lifecycle.notifyApplicationDidUnhide();
        break;
      default:
        console.warn(`app-lifecycle: unknown event ${event}`);
    }
  });

  // Save all card states around app backgrounding.
  //
  // Primary triggers are the **will-phase** events (`willResignActive`,
  // `willHide`). Firing on the will-phase is the [L23] win: the save
  // callbacks read `document.activeElement`, `selectionStart/End`, and
  // `selectionGuard.getCardRange(cardId)` *before* WebKit tears down
  // selection visibility and blurs the active input when the app
  // loses key status. A did-phase save would read a post-teardown
  // state and record `focus: none` with no selection. (See
  // [Collision 3](#audit-collisions) in design doc.)
  //
  // The **did-phase** `didResignActive` subscriber stays as an
  // idempotent backstop: if a will-phase event never arrived (older
  // host, test harness, unexpected teardown path), the did-phase save
  // still flushes whatever state is readable. Repeating a save is
  // harmless — `saveAndFlush` is debounce-free and idempotent.
  //
  // Selection repaint on the symmetric become-active / unhide events is
  // owned by the selection-guard paint authority.
  //
  // `getAppLifecycle()` is guaranteed non-null here because
  // `DeckManager` registers the lifecycle before `initActionDispatch`
  // is called.
  const disposers: Array<() => void> = [];
  const appLifecycle = getAppLifecycle();
  if (appLifecycle !== null) {
    disposers.push(
      appLifecycle.observeApplicationWillResignActive(() => {
        deckManager.saveAndFlush();
      }),
      appLifecycle.observeApplicationWillHide(() => {
        deckManager.saveAndFlush();
      }),
      appLifecycle.observeApplicationDidResignActive(() => {
        deckManager.saveAndFlush();
      }),
    );
  } else {
    console.warn(
      "initActionDispatch: AppLifecycle not registered; save-on-resign wire skipped",
    );
  }

  return () => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
  };
}
