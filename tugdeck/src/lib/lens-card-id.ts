/**
 * lens-card-id.ts — the Lens card's registry id, on its own.
 *
 * The Lens pane is identified by the card it hosts rather than by a stored
 * marker field, so code far from the Lens's React graph — serialization, the
 * deck-store selectors, `validateDeckState` — has to name this constant.
 * Importing it from `lens-register-card.tsx` would drag the Lens's whole
 * component graph into those module graphs; a leaf module keeps them pure.
 *
 * @module lib/lens-card-id
 */

/** Registry componentId of the Lens card. */
export const LENS_CARD_ID = "lens";
