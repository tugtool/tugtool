/**
 * Host menu state — the aggregator behind the `menuState` WKScriptMessage
 * push.
 *
 * The Swift host validates its menu bar from a cached snapshot of
 * frontend state (`AppDelegate.swift`, `MenuState` struct +
 * `validateMenuItem(_:)`). This module owns the frontend half of that
 * wire contract: it projects the deck store into the menu-relevant
 * shape, diffs, coalesces, and posts to
 * `webkit.messageHandlers.menuState`. Keep the payload fields in sync
 * with the Swift parser.
 *
 * Why an aggregator module rather than a push inside
 * `DeckManager.notify()`: menu enablement depends on more than deck
 * structure — the dev card's session state (bound, can-interrupt,
 * permission mode) changes without any deck mutation, so a second
 * publisher has to feed the same channel. One module owning the merged
 * payload keeps one wire channel and one diff.
 *
 * Why diff + coalesce: deck notifications fire on every mutation and
 * session stores emit on every streaming token, but the menu-relevant
 * projection changes far less often. Posting only when the serialized
 * projection changes — coalesced on a microtask — keeps WKScriptMessage
 * traffic proportional to menu-relevant change, not store churn.
 *
 * No React consumer reads this state; it mirrors stores outward to the
 * host and never drives render.
 */

import type { DeckState } from "../layout-tree";
import { TUG_ACTIONS } from "../components/tugways/action-vocabulary";

/**
 * Edit-menu capability block: per-action enablement for the native
 * Edit menu (and the Find submenu), derived from the responder chain's
 * `validateAction` — the suite's single source of truth for whether the
 * focused surface handles an edit action (design decision D05). Each
 * flag is `true` iff a focused responder currently handles that action;
 * `false` when nothing in focus does (e.g. only the Settings card is
 * up), which is exactly when the menu item should be disabled.
 *
 * The Swift host validates the Edit items against this block, the same
 * pull-based way it validates the close items against `panes`. The
 * clipboard actions still execute natively (Swift re-dispatches the
 * AppKit selector) so the system pasteboard and the in-gesture clipboard
 * path are preserved — for those, this block governs *enablement only*.
 *
 * Undo / Redo are here AND card-specific. The platform's NSUndoManager
 * (which AppKit would otherwise validate `undo:` against) is per-web-view:
 * it accumulates the whole view's edit history and knows nothing about
 * card activation, so a deactivated card's undo state would keep leaking
 * into the menu. The responder chain is card-scoped by construction — the
 * first responder lives inside the active card — so undo/redo ride this
 * block like the other edit actions, with the depth-accuracy supplied by
 * each editor's `validateAction` (CM6 reports `undoDepth`/`redoDepth` of
 * its own per-instance history).
 *
 * Native `<input>`/`<textarea>` take the third path: their undo stack is
 * the browser's (JS-opaque), reachable through the web view's
 * NSUndoManager. When the focused element is a native text control,
 * `nativeUndoToken` is non-zero and the Swift side validates Undo/Redo
 * LIVE from `webView.undoManager.canUndo`/`canRedo` and executes the
 * native `undo:`/`redo:` selectors. The token changes whenever the
 * focused native control changes (and drops to 0 on blur); the host
 * clears the web view's undo stack on every token change, so the
 * per-web-view stack never outlives focus in one control — that is what
 * keeps the native path card-safe.
 *
 * A chord whose menu item validates DISABLED is eaten at the menu bar
 * with a beep (standard macOS) — it does NOT fall through to the web
 * view. That is why the native path must light the item: a dark Undo
 * means a dead ⌘Z.
 */
export interface MenuStateEditBlock {
  cut: boolean;
  copy: boolean;
  paste: boolean;
  delete: boolean;
  selectAll: boolean;
  undo: boolean;
  redo: boolean;
  /** Menu-title noun for Undo ("Typing", "Paste", …); "" → plain "Undo". */
  undoLabel: string;
  /** Menu-title noun for Redo; "" → plain "Redo". */
  redoLabel: string;
  /**
   * Non-zero iff the focused element is an editable native text control
   * (`<input>`/`<textarea>`). Changes value when the focused control
   * changes. Drives the Swift side's NSUndoManager undo path and its
   * clear-on-blur.
   */
  nativeUndoToken: number;
  find: boolean;
  findNext: boolean;
  findPrevious: boolean;
}

/** All-disabled default — nothing focused handles any edit action. */
export const EMPTY_EDIT_CAPABILITIES: MenuStateEditBlock = {
  cut: false,
  copy: false,
  paste: false,
  delete: false,
  selectAll: false,
  undo: false,
  redo: false,
  undoLabel: "",
  redoLabel: "",
  nativeUndoToken: 0,
  find: false,
  findNext: false,
  findPrevious: false,
};

/** Minimal slice of the responder chain the cap computation needs. */
export interface EditCapabilitySource {
  validateAction(action: string): boolean;
}

/**
 * Compute the edit-menu capability block from the responder chain.
 * Pure (given the chain's current focus) — exported for unit tests.
 * Each flag mirrors `chain.validateAction(<action>)`, which returns
 * false when no focused responder handles the action.
 */
export function computeEditCapabilities(
  chain: EditCapabilitySource,
): MenuStateEditBlock {
  return {
    cut: chain.validateAction(TUG_ACTIONS.CUT),
    copy: chain.validateAction(TUG_ACTIONS.COPY),
    paste: chain.validateAction(TUG_ACTIONS.PASTE),
    delete: chain.validateAction(TUG_ACTIONS.DELETE),
    selectAll: chain.validateAction(TUG_ACTIONS.SELECT_ALL),
    undo: chain.validateAction(TUG_ACTIONS.UNDO),
    redo: chain.validateAction(TUG_ACTIONS.REDO),
    // Filled in by the publisher (responder-chain provider): labels come
    // from the focused editor's registry entry, the token from the
    // focused-native-control tracker.
    undoLabel: "",
    redoLabel: "",
    nativeUndoToken: 0,
    find: chain.validateAction(TUG_ACTIONS.FIND),
    findNext: chain.validateAction(TUG_ACTIONS.FIND_NEXT),
    findPrevious: chain.validateAction(TUG_ACTIONS.FIND_PREVIOUS),
  };
}

// ---------------------------------------------------------------------------
// Undo/redo menu-label registry
// ---------------------------------------------------------------------------

/** Menu-title nouns for an editor's next undo/redo steps. */
export interface EditUndoLabels {
  undo: string;
  redo: string;
}

/**
 * Per-editor undo/redo label registry, keyed by a DOM element inside the
 * editor (CM6 registers `view.dom`). The publisher resolves the focused
 * responder's element and picks the entry contained within it, so labels
 * are only ever shown for the editor that actually owns the lit Undo —
 * a registry keyed by element (not a single "current" slot) is what keeps
 * two mounted editors from leaking titles into each other.
 */
const editUndoLabelRegistry = new Map<Element, EditUndoLabels>();

/** Publish (or clear, with null) an editor's undo/redo menu labels. */
export function setEditUndoLabels(el: Element, labels: EditUndoLabels | null): void {
  if (labels === null) {
    editUndoLabelRegistry.delete(el);
  } else {
    editUndoLabelRegistry.set(el, labels);
  }
}

/**
 * Resolve the labels for the editor inside (or at) the given responder
 * element. Returns empty labels when no registered editor is in scope.
 */
export function editUndoLabelsWithin(scope: Element): EditUndoLabels {
  for (const [el, labels] of editUndoLabelRegistry) {
    if (scope === el || scope.contains(el)) return labels;
  }
  return { undo: "", redo: "" };
}

/** One pane entry, z-order topmost first (matches the Swift reader). */
export interface MenuStatePaneEntry {
  id: string;
  title: string;
  focused: boolean;
  cardCount: number;
  closable: boolean;
}

/** The focused pane's active card; null when the deck has no panes. */
export interface MenuStateActiveCard {
  component: string;
  closable: boolean;
}

/**
 * Dev-card session block, published by the dev card's menu-state
 * effect. Rides the payload only while its card is the focused pane's
 * active card.
 */
export interface MenuStateDevBlock {
  cardId: string;
  /** A session binding exists for the card. */
  sessionBound: boolean;
  /** The session's turn can be interrupted (Stop enablement). */
  canInterrupt: boolean;
  /** Effective mode: live metadata ?? persisted ?? "default". */
  permissionMode: string;
  /** The transcript holds at least one assistant message. */
  hasAssistantMessage: boolean;
  /** The transcript holds at least one completed turn (rewind gate). */
  hasTurns: boolean;
}

/**
 * File-card block, published by the File card's menu-state effect ([P07],
 * Spec S02). Rides the payload only while its card is the focused pane's
 * active card, exactly like the dev block. Gates the classic File menu
 * items (Save / Save As… / Save a Copy… / Revert / Reload).
 */
export interface MenuStateFileBlock {
  cardId: string;
  /** Save contract — automatic Save is always live; manual gates on dirty. */
  mode: "manual" | "automatic";
  /** Unsaved changes (manual). Automatic mode is always `false`. */
  dirty: boolean;
  /** Untitled buffer (manual, `path === null`) — Save runs the panel. */
  untitled: boolean;
  readOnly: boolean;
  /** A disk file is bound — gates Revert / Reload. */
  hasPath: boolean;
  /** An unresolved external-change conflict — Save disabled until resolved. */
  conflict: boolean;
}

/** Per-item enablement for the File menu, derived from a block (Spec S02). */
export interface FileMenuGates {
  save: boolean;
  saveAs: boolean;
  saveACopy: boolean;
  revert: boolean;
  reload: boolean;
}

/**
 * Compute the File menu enablement from a block (Spec S02). Pure; exported
 * to unit-test the gate matrix the Swift `validateMenuItem` mirrors —
 * notably that automatic-mode Save stays enabled (else its ⌘S would beep
 * instead of flushing, [P07]) while a clean titled manual card disables it.
 */
export function computeFileMenuGates(block: MenuStateFileBlock): FileMenuGates {
  const saveWritable = !block.readOnly && !block.conflict;
  return {
    save:
      saveWritable && (block.mode === "automatic" || block.dirty || block.untitled),
    saveAs: true,
    saveACopy: true,
    revert: block.dirty && block.hasPath,
    reload: block.hasPath,
  };
}

/** Deck-derived half of the payload (everything except the dev block). */
export interface MenuStateDeckProjection {
  panes: MenuStatePaneEntry[];
  activeCard: MenuStateActiveCard | null;
  /**
   * Whether a card is selected — `activePaneId` is set. A canvas-background
   * click deselects (clears it); the host enables the card / pane navigation
   * commands when this is `false` (with panes present) so a deselected deck
   * can re-activate a card by keyboard or menu.
   */
  selectionActive: boolean;
  /**
   * Id of the focused pane's active card — used by the publisher to
   * select which dev block rides the payload. Module-internal: never
   * serialized onto the wire.
   */
  focusedActiveCardId: string | null;
}

/** The full wire payload posted to `webkit.messageHandlers.menuState`. */
export interface MenuStatePayload {
  panes: MenuStatePaneEntry[];
  activeCard: MenuStateActiveCard | null;
  /** Whether a card is selected (see {@link MenuStateDeckProjection.selectionActive}). */
  selectionActive: boolean;
  /** Dev-card session block; null unless the active card is a dev card. */
  dev: MenuStateDevBlock | null;
  /** File-card block; null unless the active card is a File card. */
  file: MenuStateFileBlock | null;
  /** Edit-menu capabilities of the current first responder. */
  edit: MenuStateEditBlock;
}

/**
 * Project the deck store snapshot into the menu-relevant shape.
 *
 * Pure — exported for unit tests. The pane projection (focused = last
 * pane in z-order, title fallback chain, reverse to topmost-first)
 * carries the exact semantics the host's close-item validation and
 * pane-list menu were built against.
 */
export function projectDeckState(state: DeckState): MenuStateDeckProjection {
  const stacks = state.panes;
  const cardsById = new Map(state.cards.map((c) => [c.id, c]));
  const focusedStack = stacks.length > 0 ? stacks[stacks.length - 1] : null;
  const focusedId = focusedStack ? focusedStack.id : null;
  const panes = stacks
    .map((s) => {
      const activeCard = cardsById.get(s.activeCardId);
      const firstCard = cardsById.get(s.cardIds[0]);
      const title = s.title || activeCard?.title || firstCard?.title || "Untitled";
      return {
        id: s.id,
        title,
        focused: s.id === focusedId,
        cardCount: s.cardIds.length,
        closable: activeCard?.closable ?? false,
      };
    })
    .reverse();

  const focusedActiveCard = focusedStack
    ? cardsById.get(focusedStack.activeCardId)
    : undefined;
  const activeCard: MenuStateActiveCard | null = focusedActiveCard
    ? {
        component: focusedActiveCard.componentId,
        closable: focusedActiveCard.closable,
      }
    : null;

  return {
    panes,
    activeCard,
    selectionActive: state.activePaneId !== undefined,
    focusedActiveCardId: focusedActiveCard?.id ?? null,
  };
}

/**
 * Diff-and-coalesce publisher. Holds the latest inputs, schedules a
 * microtask flush on any change, and posts through the injected sink
 * only when the serialized payload differs from the last one sent.
 *
 * The sink is injected so unit tests can observe posts directly; the
 * production sink is {@link postToHost}.
 */
export class HostMenuStatePublisher {
  private readonly post: (payload: MenuStatePayload) => void;
  private deckProjection: MenuStateDeckProjection = {
    panes: [],
    activeCard: null,
    selectionActive: false,
    focusedActiveCardId: null,
  };
  /**
   * Per-card dev blocks. Every mounted dev card publishes its own
   * block unconditionally; the flush (not the card) decides which one
   * rides the payload, by checking the focused pane's active card.
   */
  private readonly devBlocks = new Map<string, MenuStateDevBlock>();
  /**
   * Per-card File blocks, same rider discipline as {@link devBlocks}:
   * every mounted File card publishes its own; the flush picks the one
   * whose card is the focused pane's active card.
   */
  private readonly fileBlocks = new Map<string, MenuStateFileBlock>();
  /**
   * Edit-menu capabilities of the current first responder. A single
   * publisher (the responder-chain provider) feeds this; defaults to
   * all-disabled until the first push.
   */
  private editCapabilities: MenuStateEditBlock = EMPTY_EDIT_CAPABILITIES;
  private lastSent: string | null = null;
  private flushScheduled = false;

  constructor(post: (payload: MenuStatePayload) => void) {
    this.post = post;
  }

  setDeckProjection(projection: MenuStateDeckProjection): void {
    this.deckProjection = projection;
    this.scheduleFlush();
  }

  setDevBlock(cardId: string, block: MenuStateDevBlock): void {
    this.devBlocks.set(cardId, block);
    this.scheduleFlush();
  }

  clearDevBlock(cardId: string): void {
    if (!this.devBlocks.delete(cardId)) return;
    this.scheduleFlush();
  }

  setFileBlock(cardId: string, block: MenuStateFileBlock): void {
    this.fileBlocks.set(cardId, block);
    this.scheduleFlush();
  }

  clearFileBlock(cardId: string): void {
    if (!this.fileBlocks.delete(cardId)) return;
    this.scheduleFlush();
  }

  setEditCapabilities(caps: MenuStateEditBlock): void {
    this.editCapabilities = caps;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    const { panes, activeCard, selectionActive, focusedActiveCardId } =
      this.deckProjection;
    const dev =
      activeCard?.component === "dev" && focusedActiveCardId !== null
        ? (this.devBlocks.get(focusedActiveCardId) ?? null)
        : null;
    const file =
      activeCard?.component === "file" && focusedActiveCardId !== null
        ? (this.fileBlocks.get(focusedActiveCardId) ?? null)
        : null;
    const payload: MenuStatePayload = {
      panes,
      activeCard,
      selectionActive,
      dev,
      file,
      edit: this.editCapabilities,
    };
    const serialized = JSON.stringify(payload);
    if (serialized === this.lastSent) return;
    this.lastSent = serialized;
    this.post(payload);
  }
}

/**
 * Production sink: post to the Swift host. No-op outside a WKWebView
 * (browser dev mode), same guard the old per-notify push used.
 */
function postToHost(payload: MenuStatePayload): void {
  const webkit = (globalThis as unknown as Record<string, unknown>).webkit as
    | Record<string, unknown>
    | undefined;
  const messageHandlers = webkit?.messageHandlers as Record<string, unknown> | undefined;
  const handler = messageHandlers?.menuState as
    | { postMessage: (v: unknown) => void }
    | undefined;
  if (!handler) return;
  handler.postMessage(payload);
}

/** Minimal slice of DeckManager the aggregator needs. */
interface DeckSource {
  subscribe(callback: () => void): () => void;
  getSnapshot(): DeckState;
}

/** The boot-time singleton behind the module-level publish functions. */
let activePublisher: HostMenuStatePublisher | null = null;

/**
 * Wire the aggregator to the deck store. Called once at boot
 * (`main.tsx`) right after the DeckManager is constructed; publishes
 * the initial state immediately so the host's menu validation never
 * runs against a stale cache.
 */
export function initHostMenuState(deck: DeckSource): void {
  const publisher = new HostMenuStatePublisher(postToHost);
  activePublisher = publisher;
  const push = (): void => {
    publisher.setDeckProjection(projectDeckState(deck.getSnapshot()));
  };
  deck.subscribe(push);
  push();
}

/**
 * Publish (or refresh) a dev card's session block. Called by the dev
 * card's menu-state effect on every relevant store change; a no-op
 * before {@link initHostMenuState} runs (browser-dev edge — the boot
 * sequence wires the publisher before any card mounts in-app).
 */
export function publishDevMenuState(cardId: string, block: MenuStateDevBlock): void {
  activePublisher?.setDevBlock(cardId, block);
}

/** Drop a dev card's session block (card unmount / services teardown). */
export function clearDevMenuState(cardId: string): void {
  activePublisher?.clearDevBlock(cardId);
}

/**
 * Publish (or refresh) a File card's menu block ([P07]). Called by the
 * File card's menu-state effect on every relevant snapshot change; a
 * no-op before {@link initHostMenuState} runs.
 */
export function publishFileMenuState(cardId: string, block: MenuStateFileBlock): void {
  activePublisher?.setFileBlock(cardId, block);
}

/** Drop a File card's menu block (card unmount). */
export function clearFileMenuState(cardId: string): void {
  activePublisher?.clearFileBlock(cardId);
}

/**
 * Publish the current first responder's edit-menu capabilities. Called
 * by the responder-chain provider on every validation change (focus /
 * register / unregister); a no-op before {@link initHostMenuState} runs.
 */
export function publishEditMenuState(caps: MenuStateEditBlock): void {
  activePublisher?.setEditCapabilities(caps);
}

/**
 * Recompute-and-publish hook for edit-capability changes that the chain's
 * validation version cannot see. Focus / register / unregister all bump
 * the version, but a capability can flip *within* a focused responder —
 * the canonical case is an editor's undo/redo depth changing as the user
 * types. The responder-chain provider registers its publish closure here;
 * substrates call {@link requestEditMenuStateRefresh} when such a flip
 * happens. Deliberately NOT a validationVersion bump: that would re-render
 * every chain-subscribed component on each keystroke. The publisher's
 * serialized diff suppresses no-op posts, so over-calling is cheap.
 */
let editCapsRefresher: (() => void) | null = null;

/** Register (or clear, with null) the provider's recompute-and-publish closure. */
export function registerEditCapsRefresher(refresh: (() => void) | null): void {
  editCapsRefresher = refresh;
}

/** Ask the provider to recompute and republish the edit capabilities. */
export function requestEditMenuStateRefresh(): void {
  editCapsRefresher?.();
}
