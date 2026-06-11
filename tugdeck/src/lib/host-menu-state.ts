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
 * actions themselves still execute natively (Swift re-dispatches the
 * AppKit selector) so the system pasteboard and the in-gesture clipboard
 * path are preserved — this block governs *enablement only*.
 */
export interface MenuStateEditBlock {
  cut: boolean;
  copy: boolean;
  paste: boolean;
  delete: boolean;
  selectAll: boolean;
  undo: boolean;
  redo: boolean;
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
    find: chain.validateAction(TUG_ACTIONS.FIND),
    findNext: chain.validateAction(TUG_ACTIONS.FIND_NEXT),
    findPrevious: chain.validateAction(TUG_ACTIONS.FIND_PREVIOUS),
  };
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

/** Deck-derived half of the payload (everything except the dev block). */
export interface MenuStateDeckProjection {
  panes: MenuStatePaneEntry[];
  activeCard: MenuStateActiveCard | null;
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
  /** Dev-card session block; null unless the active card is a dev card. */
  dev: MenuStateDevBlock | null;
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
    focusedActiveCardId: null,
  };
  /**
   * Per-card dev blocks. Every mounted dev card publishes its own
   * block unconditionally; the flush (not the card) decides which one
   * rides the payload, by checking the focused pane's active card.
   */
  private readonly devBlocks = new Map<string, MenuStateDevBlock>();
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
    const { panes, activeCard, focusedActiveCardId } = this.deckProjection;
    const dev =
      activeCard?.component === "dev" && focusedActiveCardId !== null
        ? (this.devBlocks.get(focusedActiveCardId) ?? null)
        : null;
    const payload: MenuStatePayload = {
      panes,
      activeCard,
      dev,
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
 * Publish the current first responder's edit-menu capabilities. Called
 * by the responder-chain provider on every validation change (focus /
 * register / unregister); a no-op before {@link initHostMenuState} runs.
 */
export function publishEditMenuState(caps: MenuStateEditBlock): void {
  activePublisher?.setEditCapabilities(caps);
}
