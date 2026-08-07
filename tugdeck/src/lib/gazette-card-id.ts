/**
 * gazette-card-id.ts — the Gazette card's registry id, on its own.
 *
 * The Gazette pane is identified by the card it hosts rather than by a stored
 * marker field, so code far from the card's React graph (the ⌃⌘G handler in
 * `deck-canvas`) has to name this constant. Importing it from
 * `gazette-card-registration.tsx` would drag the card's whole component graph
 * into those module graphs; a leaf module keeps them pure — the same reasoning
 * as `jots-card-id.ts`.
 *
 * @module lib/gazette-card-id
 */

/** Registry componentId of the Gazette card. */
export const GAZETTE_CARD_ID = "gazette";
