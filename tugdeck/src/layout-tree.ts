/**
 * Canvas data model for the card system (two-table shape).
 *
 * DeckState holds two flat arrays:
 *   - `cards`: the content identities — id, componentId, title, closable,
 *     plus an optional persistence bag.
 *   - `panes`: the visual frames — position, size, ordered cardIds, the
 *     active card in the pane, collapsed, acceptsFamilies, title.
 *
 * Invariants:
 *   1. Every `cardIds` entry in every pane references a real card (by id) in
 *      `deckState.cards`.
 *   2. Each card appears in exactly one pane's `cardIds` (no orphans, no
 *      duplicates).
 *   3. No pane has an empty `cardIds` array — closing the last card of a
 *      pane closes the pane.
 *   4. Each pane's `activeCardId` is a member of that pane's `cardIds`.
 *   5. `activePaneId`, when set, references a real pane in `panes`.
 *
 * Spec S01: Canvas Data Model Types
 */

// ---- Types (Spec S01) ----

/**
 * Per-card state bag. Uniform schema across every card type; each component
 * owns its own apply logic (see [D01]). Axis fields are all optional; a
 * missing field means the card has nothing to persist for that axis.
 *
 * Stored in DeckManager's in-memory cache (primary read source during a
 * session) and in tugbank under `dev.tugtool.deck.cardstate/{cardId}` (durable
 * backing store).
 *
 * Spec S01: CardStateBag type ([D01], [D02])
 */
export interface CardStateBag {
  /** Scroll position of the card's host content element. */
  scroll?: { x: number; y: number };
  /** Component-owned content payload (e.g. tide engine state). */
  content?: unknown;
  /**
   * Snapshot of every `<input>` / `<textarea>` inside the card that carries
   * a `data-tug-persist-value="<key>"` attribute, keyed by the attribute's
   * value. Captured at save time by walking the card-host subtree.
   * Reapplied on restore and on any DOM mutation that introduces a matching
   * element later (to handle late mounts). DOM-authority persistence for
   * native input state that sits outside `useCardPersistence`'s opt-in path.
   */
  formControls?: Record<string, FormControlSnapshot>;
  /** Nested-region scroll snapshot keyed by `data-tug-scroll-key`. */
  regionScroll?: RegionScrollSnapshot | null;
  /** Content-editable range snapshot captured from the card's owning boundary. */
  domSelection?: DomSelectionSnapshot | null;
  /** Element-level focus snapshot identifying which descendant of the card root held focus at save time. */
  focus?: FocusSnapshot | null;
  /**
   * Opt-in per-component state harvested at capture time, keyed by the
   * scoped `persistKey` each component registered via
   * `useComponentPersistence`. Populated by the Component Persistence
   * Protocol ([D13], [A9]); absent when the card uses no opt-in
   * components, empty when it uses some but none produced state.
   */
  components?: Record<string, unknown>;
}

/**
 * DOM-authority snapshot of a single native `<input>` or `<textarea>`.
 *
 * Captured and reapplied by `CardHost` for any element bearing
 * `data-tug-persist-value="<key>"`. The snapshot covers three axes:
 *
 *   - `value` — the control's text value. Always present.
 *   - `scrollTop` / `scrollLeft` — scroll inside textareas (and
 *     horizontally-scrolling single-line inputs). Always captured
 *     alongside `value`; zeros round-trip as zeros. (Optional on the
 *     type so consumers that synthesize snapshots by hand can omit
 *     them.)
 *   - `selectionStart` / `selectionEnd` / `selectionDirection` —
 *     the caret or highlighted range inside the control. Omitted
 *     for control types that do not support a text selection (e.g.
 *     `<input type="checkbox">` / `"radio"` / `"number"` in most
 *     browsers), or when the field is unreadable at save time.
 *
 * Focus is NOT recorded here — element-level focus rides
 * `bag.focus` (see [D10]). Selection persists regardless of focus
 * at save time; the restore path ([Step 10]) re-anchors the caret
 * after value restore and leaves paint to the browser once focus
 * lands on the element.
 */
export interface FormControlSnapshot {
  value: string;
  scrollTop?: number;
  scrollLeft?: number;
  selectionStart?: number;
  selectionEnd?: number;
  selectionDirection?: "forward" | "backward" | "none";
}

/**
 * Scroll positions of nested scrollable regions inside a card, keyed
 * by the element's `data-tug-scroll-key="<key>"` attribute.
 *
 * Distinct from `bag.scroll`, which captures the card's *outer*
 * host-content scroll (one per card). `regionScroll` covers inner
 * scrollers — most notably `tug-markdown-view`'s virtual-list
 * container — that the user has scrolled independently.
 *
 * Uniqueness of keys within a card subtree is an author contract
 * (same rule as `data-tug-persist-value`): `CardHost` walks the card
 * root and writes the last-encountered value per key.
 */
export type RegionScrollSnapshot = Record<string, { x: number; y: number }>;

/**
 * Serialized form of a DOM selection anchored inside a card's boundary.
 *
 * Paths are arrays of child indices rooted at the card's registered
 * boundary element (see {@link useSelectionBoundary}). Offsets mirror
 * `Range`'s start/end offsets at the resolved nodes. Captured by
 * `CardHost` from `selectionGuard.getCardRange(cardId)` at save time
 * and resolved back to a `Range` via `pathToNode` on restore.
 */
export interface DomSelectionSnapshot {
  anchorPath: readonly number[];
  anchorOffset: number;
  focusPath: readonly number[];
  focusOffset: number;
}

/**
 * Element-level focus snapshot.
 *
 * Captured by `CardHost` from `document.activeElement` at save time and
 * narrowed to the descendant of the card's boundary that held focus.
 * Four variants cover every real case:
 *
 *   - `form-control` — a `<input>` or `<textarea>` carrying
 *     `data-tug-persist-value="<key>"`. Focus travels with the
 *     persistKey; restore re-focuses that element after its value is
 *     re-applied.
 *   - `dom` — a non-form-control focusable element carrying an opt-in
 *     `data-tug-focus-key="<key>"` marker (e.g. a button, a card-local
 *     menu trigger). Keyed lookup on restore.
 *   - `component-owned` — focus belongs to a component that manages
 *     its own focus plus selection together (tide card's prompt-input
 *     contentEditable, for example). The owning component's
 *     `bag.content` carries whatever state it needs; `CardHost` merely
 *     notes that the component was focused.
 *   - `none` — no interesting focus inside the card (or focus is on
 *     `document.body`, or outside the card root entirely).
 *
 * Applied on cold-boot restore only, and only for the active card of
 * the active pane (see [D10]). In-app transitions preserve focus by
 * leaving the DOM mounted (see [D08]).
 */
export type FocusSnapshot =
  | { kind: "none" }
  | { kind: "form-control"; persistKey: string }
  | { kind: "dom"; focusKey: string }
  | { kind: "component-owned" };

/**
 * A card — the content identity that survives cross-pane moves.
 *
 * A card knows its componentId, title, and whether it is closable. Position,
 * size, and active-ness are properties of the enclosing pane, not the card.
 * An optional `state` bag carries per-content persistence.
 */
export interface CardState {
  id: string;
  componentId: string;
  title: string;
  closable: boolean;
  state?: CardStateBag;
}

/**
 * A pane — the visual frame containing one or more cards.
 *
 * Panes own position, size, collapsed, acceptsFamilies, and the ordered list
 * of cardIds they contain. Exactly one of the cardIds is the pane's
 * `activeCardId`, which is the card whose content is visible in the pane.
 */
export interface TugPaneState {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** Ordered list of card ids belonging to this pane. */
  cardIds: readonly string[];
  /** The currently-active card in the pane. Must be in `cardIds`. */
  activeCardId: string;
  /** Card-level display title (e.g. "Component Gallery"). Empty string for generic panes. */
  title: string;
  /** Families of card types this pane can host in its type picker. Defaults to ["standard"]. */
  acceptsFamilies: readonly string[];
  /**
   * Whether the pane is collapsed (title bar only, content hidden).
   * Missing/undefined is treated as false. ([D04])
   */
  collapsed?: boolean;
}

/**
 * The deck's full state.
 *
 * - `cards` holds every card identity in the deck.
 * - `panes` holds every pane frame; each pane's `cardIds` partitions
 *   `cards`.
 * - `activePaneId` identifies the deck's currently-active pane, if any.
 *
 * Reload-focus restoration is handled out-of-band: `putFocusedCardId`
 * writes a single-field row to tugbank, and `DeckManager` reads it back
 * via the `initialFocusedCardId` constructor parameter. That pointer is
 * deliberately not part of `DeckState` — it would duplicate persistence
 * paths.
 */
export interface DeckState {
  cards: readonly CardState[];
  panes: readonly TugPaneState[];
  activePaneId?: string;
}

// ---- Invariant validation ----

/**
 * Thrown by {@link validateDeckState} when the two-table invariants are
 * violated. The `message` names the violated invariant and includes the
 * offending ids so failures are traceable in test output.
 */
export class DeckStateInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckStateInvariantError";
  }
}

/**
 * Validate every DeckState invariant documented above. Throws
 * {@link DeckStateInvariantError} on the first violation.
 *
 * Invariants checked:
 *   1. every `pane.cardIds` entry references a real `state.cards[].id`;
 *   2. every card appears in exactly one pane's `cardIds` (no orphans, no
 *      duplicates);
 *   3. no pane has `cardIds.length === 0`;
 *   4. every `pane.activeCardId` is a member of that pane's `cardIds`;
 *   5. when `state.activePaneId` is set, it references a real pane.
 *
 * Called from `DeckManager.notify` in dev/test builds only — guarded by
 * `isDevEnv()` so production builds pay no cost. Violations surface at the
 * mutation site that produced them rather than downstream.
 */
export function validateDeckState(state: DeckState): void {
  const cardIds = new Set<string>();
  for (const card of state.cards) {
    if (cardIds.has(card.id)) {
      throw new DeckStateInvariantError(
        `duplicate card id "${card.id}" in deckState.cards`,
      );
    }
    cardIds.add(card.id);
  }

  const paneIds = new Set<string>();
  const cardToPane = new Map<string, string>();
  for (const pane of state.panes) {
    if (paneIds.has(pane.id)) {
      throw new DeckStateInvariantError(
        `duplicate pane id "${pane.id}" in deckState.panes`,
      );
    }
    paneIds.add(pane.id);

    // Invariant 3
    if (pane.cardIds.length === 0) {
      throw new DeckStateInvariantError(
        `pane "${pane.id}" has empty cardIds (no empty panes permitted)`,
      );
    }

    for (const cid of pane.cardIds) {
      // Invariant 1
      if (!cardIds.has(cid)) {
        throw new DeckStateInvariantError(
          `pane "${pane.id}" references missing card id "${cid}"`,
        );
      }
      // Invariant 2
      const existingHost = cardToPane.get(cid);
      if (existingHost !== undefined) {
        throw new DeckStateInvariantError(
          `card "${cid}" appears in both pane "${existingHost}" and "${pane.id}"`,
        );
      }
      cardToPane.set(cid, pane.id);
    }

    // Invariant 4
    if (!pane.cardIds.includes(pane.activeCardId)) {
      throw new DeckStateInvariantError(
        `pane "${pane.id}" activeCardId "${pane.activeCardId}" is not in cardIds`,
      );
    }
  }

  // Invariant 2 (second half): every card has a host pane.
  for (const card of state.cards) {
    if (!cardToPane.has(card.id)) {
      throw new DeckStateInvariantError(
        `card "${card.id}" is orphaned (no pane references it)`,
      );
    }
  }

  // Invariant 5
  if (
    state.activePaneId !== undefined &&
    !paneIds.has(state.activePaneId)
  ) {
    throw new DeckStateInvariantError(
      `activePaneId "${state.activePaneId}" does not reference a real pane`,
    );
  }
}
