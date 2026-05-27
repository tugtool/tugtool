/**
 * transcript-magnification-context — React context exposing the
 * transcript's current magnification multiplier to descendants that
 * need to re-bake pixel artifacts when the user adjusts magnification.
 *
 * The transcript magnification (0.5 – 1.5, default 1.0) already
 * cascades to text via the CSS `font-size: calc(14px * var(--tugx-tide-magnification))`
 * declaration on `.tide-card-transcript` — em-relative content scales
 * automatically. Pixel-baked artifacts like atom chips (SVG `<img>`
 * elements baked at a specific font size) don't ride that cascade,
 * so descendants that paint them need to read the magnification value
 * directly and feed it into their bake call.
 *
 * The transcript host subscribes to its `ResponseSettingsStore` via
 * `useSyncExternalStore` and provides the resulting magnification
 * through this context. Descendants (`TugAtomTextBody`, `TugAtomChip`)
 * consume via `useContext` and re-render on magnification change
 * because React re-renders context consumers whenever the provider's
 * value changes — same load-bearing rule `useSyncExternalStore`
 * relies on.
 *
 * Surfaces without a provider (gallery design-review cards, future
 * unmagnified transcript renderers) get the default `1.0` and the
 * chip bakes at the 12px base size unchanged. Per [Spec] —
 * `chipFontSizeForMagnification(1.0) === 12`.
 *
 * Laws:
 *  - [L02] external state enters React via the host's
 *    `useSyncExternalStore` against `ResponseSettingsStore`; this
 *    context is the React-tree fanout of that subscription.
 *  - [L06] the value drives the chip's pixel sizing, which is
 *    appearance — never React state.
 *
 * @module lib/transcript-magnification-context
 */

import * as React from "react";

/**
 * Default value when no provider is mounted. Matches
 * `DEFAULT_RESPONSE_SETTINGS.magnification` in
 * `lib/response-settings-store.ts` so an unprovidered descendant
 * paints chips at the same size the transcript root would publish at
 * default settings.
 */
export const DEFAULT_TRANSCRIPT_MAGNIFICATION = 1.0;

/**
 * Context carrying the current transcript magnification multiplier.
 * Consumers read via `React.useContext(TranscriptMagnificationContext)`
 * and re-render when the provider's value changes.
 */
export const TranscriptMagnificationContext = React.createContext<number>(
  DEFAULT_TRANSCRIPT_MAGNIFICATION,
);
