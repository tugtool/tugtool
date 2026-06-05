/**
 * Card Registry Module
 *
 * Single-call card registration API for the deck card system.
 *
 * **Authoritative reference:** design-system-concepts.md [D04] Single-call card
 * registration, CardRegistration interface, Registry API.
 *
 * ## Usage
 *
 * ```typescript
 * import { registerCard, getRegistration, getAllRegistrations } from "./card-registry";
 *
 * registerCard({
 *   componentId: "hello",
 *   contentFactory: () => <HelloCardContent />,
 *   defaultMeta: { title: "Hello", closable: true },
 * });
 * ```
 *
 * @module card-registry
 */

import type React from "react";
import type { FeedIdValue } from "./protocol";
import type { CardState } from "./layout-tree";
import type { FeedStoreFilter } from "./lib/feed-store";

/**
 * Fallback filter used by `CardHost` while a card is still unbound — i.e.,
 * before the `spawn_session_ok` CONTROL ack has populated
 * `cardSessionBindingStore` with the card's canonical `workspace_key`.
 * Requires only that the field is present; does not match against any
 * specific value. Once `useCardWorkspaceKey(cardId)` returns a bound key,
 * the host switches to an exact value-check predicate.
 *
 * Consumers: `CardHost` (via `useCardWorkspaceKey` in card-host.tsx) and
 * `GalleryPromptInput` (see gallery-prompt-input.tsx). Accepts any
 * present `workspace_key` until the card is fully bound.
 */
export const presentWorkspaceKey: FeedStoreFilter = (_feedId, decoded) =>
  typeof decoded === "object" && decoded !== null && "workspace_key" in decoded;

/**
 * Size policy for a card type. Governs default sizing of new cards and
 * resize clamping in TugPane.
 *
 * - `min`: hard floor for resize (content can report a larger min, but not smaller).
 * - `max`: hard ceiling for resize (omit for unbounded).
 * - `preferred`: size for new cards with no saved state.
 */
export interface CardSizePolicy {
  min: { width: number; height: number };
  max?: { width: number; height: number };
  preferred: { width: number; height: number };
}

/**
 * Default size policy applied when a card registration omits `sizePolicy`.
 */
export const DEFAULT_SIZE_POLICY: CardSizePolicy = {
  min: { width: 250, height: 180 },
  preferred: { width: 400, height: 300 },
};

/**
 * Metadata describing a card's default appearance and behavior.
 *
 * **Authoritative reference:** CardMeta.
 */
export interface CardMeta {
  title: string;
  icon?: string;
  closable?: boolean;
  /**
   * Whether closing the pane requires user confirmation through the
   * close-confirm popover. Drives single-card panes only — a multi-card
   * pane always confirms regardless of any per-card value (the host
   * resolves the rule as `cards.length > 1 || activeMeta.confirmClose`).
   *
   * Defaults to `false`: a single-card pane's X-button click and Cmd-W
   * close the pane immediately. Card types whose contents are not
   * trivially recoverable (transcripts, drafts, etc.) opt in by setting
   * this to `true` and pay the two-step close as a guard.
   */
  confirmClose?: boolean;
}

/**
 * A single entry in the card registry.
 *
 * **Authoritative reference:** CardRegistration interface.
 *
 * DeckCanvas renders `CardHost` for every card (single-tab and
 * multi-tab alike) and uses `contentFactory` to get card-specific content.
 */
export interface CardRegistration {
  /** Unique identifier for this card type. e.g. "hello", "terminal", "git". */
  componentId: string;
  /**
   * Returns the content component (e.g. `<HelloCardContent />`) without
   * the pane chrome. DeckCanvas uses this
   * to get card-specific content.
   */
  contentFactory: (cardId: string) => React.ReactNode;
  /** Default title, icon, and closable for this card type. */
  defaultMeta: CardMeta;
  /** Default feed IDs. Defaults to `[]` when omitted. */
  defaultFeedIds?: readonly FeedIdValue[];
  /** Card type family (e.g. "standard", "developer"). Defaults to "standard". */
  family?: string;
  /** Families this card can host in its type picker. Defaults to `["standard"]`. */
  acceptsFamilies?: readonly string[];
  /**
   * Default cards to seed a new stack with when `addCard` is called against
   * this registration. Each entry is a template: `componentId`, `title`, and
   * `closable` are copied, but a fresh UUID is assigned as the card `id`.
   * When omitted, a single card is created from `defaultMeta`.
   */
  defaultCards?: readonly CardState[];
  /** Default card-level title (e.g. "Component Gallery"). Defaults to `""`. */
  defaultTitle?: string;
  /** Size policy for this card type. Falls back to DEFAULT_SIZE_POLICY when omitted. */
  sizePolicy?: CardSizePolicy;
  /**
   * Category this card belongs to in the type picker menu of a multi-tab
   * host. Registrations sharing a `category.label` are grouped together in
   * the [+] popup, ordered by first-encountered appearance in the registry.
   * Unsectioned registrations fall through as top-level items.
   *
   * This field is how type-picker grouping is declared — TugTabBar never
   * hardcodes category IDs.
   */
  category?: { label: string; icon?: string };
  /**
   * Hide this registration from the type-picker [+] menu while keeping it
   * fully registered (seedable by `componentId`, resolvable by
   * `getRegistration`). For cards that exist only as app-test fixtures or
   * narrow internal demos — they clutter the human-facing gallery menu but
   * must stay in the registry so tests can seed them. The menu builder in
   * `tug-tab-bar` filters these out; everything else treats them normally.
   * @default false
   */
  hidden?: boolean;
  /**
   * Engine classification for the activation pipeline.
   *
   * When set to `"em"` (engine-managed), the card's content factory
   * owns its own focus + selection lifecycle through `useCardStatePreservation`'s
   * `onCardActivated` callback. `resolveActivationTarget` (in
   * `focus-transfer.ts`) returns `dispatch-activated` for these cards
   * regardless of whether `bag.content` is populated yet — fresh
   * never-saved EM cards still activate via the factory dispatch path
   * rather than falling through to the generic `default-focus` walk
   * that would land focus on the first focusable descendant (often a
   * toolbar button before the contenteditable).
   *
   * Omit (or leave undefined) for DOM-authority "FC" cards — generic
   * forms, gallery components without an embedded engine, etc. Those
   * route through `bag.focus` snapshots and the
   * {@link DEFAULT_FOCUS_SELECTORS} fallback chain.
   */
  engineKind?: "em";
}

/** Module-level registry map. Keyed by componentId. */
const registry = new Map<string, CardRegistration>();

/**
 * Register a card type.
 *
 * Calling with a duplicate `componentId` logs a warning and overwrites the
 * existing registration.
 *
 * **Authoritative reference:** Registry API.
 */
export function registerCard(registration: CardRegistration): void {
  if (registry.has(registration.componentId)) {
    console.warn(
      `[card-registry] Duplicate registration for componentId "${registration.componentId}". Overwriting.`,
    );
  }
  registry.set(registration.componentId, registration);
}

/**
 * Retrieve a registered card by componentId.
 *
 * Returns `undefined` if no card is registered under that id.
 *
 * **Authoritative reference:** Registry API.
 */
export function getRegistration(componentId: string): CardRegistration | undefined {
  return registry.get(componentId);
}

/**
 * Return all registered cards.
 *
 * **Authoritative reference:** Registry API.
 */
export function getAllRegistrations(): Map<string, CardRegistration> {
  return registry;
}

/**
 * Return the size policy for a registered card type.
 *
 * Returns the registration's `sizePolicy` if set, otherwise `DEFAULT_SIZE_POLICY`.
 * Returns `DEFAULT_SIZE_POLICY` when the componentId is not registered.
 */
export function getSizePolicy(componentId: string): CardSizePolicy {
  return registry.get(componentId)?.sizePolicy ?? DEFAULT_SIZE_POLICY;
}

/**
 * Aggregate size policy for a TugPane hosting a stack of cards.
 *
 * A pane is one box shared by all its tabs, so it must satisfy every
 * hosted card kind at once. `getSizePolicy` answers for a single
 * card type; a pane that consults only its active tab would let a
 * narrow tab's policy float the resize floor below what a wider tab
 * needs, clipping that tab's content on the next tab switch. This
 * helper resolves the whole stack:
 *
 *  - `min` — element-wise MAX of the cards' mins. The pane fits the
 *    widest / tallest minimum, so no hosted card ever clips.
 *  - `max` — element-wise MIN of the cards' *defined* maxes. An
 *    unbounded card imposes no ceiling; when every card is unbounded
 *    the result omits `max`.
 *  - `preferred` — the first card's, floored to the aggregated `min`
 *    so the result stays a well-formed policy (`preferred >= min`).
 *    TugPane does not read `preferred` — only `addCard` does, and it
 *    sizes one card at a time, never a stack — so the carried value
 *    is immaterial to pane sizing.
 *
 * Each id resolves through `getSizePolicy`, so unknown ids contribute
 * `DEFAULT_SIZE_POLICY`. An empty list returns `DEFAULT_SIZE_POLICY`.
 */
export function getStackSizePolicy(
  componentIds: readonly string[],
): CardSizePolicy {
  if (componentIds.length === 0) return DEFAULT_SIZE_POLICY;
  const policies = componentIds.map(getSizePolicy);

  let minWidth = 0;
  let minHeight = 0;
  let maxWidth = Infinity;
  let maxHeight = Infinity;
  for (const policy of policies) {
    minWidth = Math.max(minWidth, policy.min.width);
    minHeight = Math.max(minHeight, policy.min.height);
    if (policy.max !== undefined) {
      maxWidth = Math.min(maxWidth, policy.max.width);
      maxHeight = Math.min(maxHeight, policy.max.height);
    }
  }

  const aggregated: CardSizePolicy = {
    min: { width: minWidth, height: minHeight },
    preferred: {
      width: Math.max(policies[0].preferred.width, minWidth),
      height: Math.max(policies[0].preferred.height, minHeight),
    },
  };
  if (Number.isFinite(maxWidth) && Number.isFinite(maxHeight)) {
    aggregated.max = { width: maxWidth, height: maxHeight };
  }
  return aggregated;
}

/**
 * True when the card type is registered and declares
 * `engineKind: "em"` — i.e., its content factory owns its own focus
 * via `useCardStatePreservation`'s `onCardActivated` callback. Used by
 * `resolveActivationTarget` to route fresh (never-saved) EM cards
 * through the dispatch path instead of the generic default-focus
 * walk. Returns `false` for unregistered componentIds and for
 * DOM-authority cards.
 */
export function isEngineManagedCard(componentId: string): boolean {
  return registry.get(componentId)?.engineKind === "em";
}

/**
 * Clear the registry.
 *
 * **For test use only.** Provides isolation between test cases.
 */
export function _resetForTest(): void {
  registry.clear();
}
