/**
 * route-constants — the canonical route scalars shared by the prompt
 * entry and the Session card.
 *
 * The route is a single-character scalar owned by a per-prompt-entry
 * `RouteLifecycle` ([D02], `route-lifecycle.ts`). These characters are
 * the persisted route values; they are shared here so the Session card
 * (which owns the lifecycle, [P02]) and the prompt entry (which drives
 * the selector and submit dispatch) agree on one set of literals rather
 * than duplicating magic strings.
 *
 * @module lib/route-constants
 */

/**
 * Default route at initial mount when no persisted state restores a
 * prior selection. Code (`❯`) is the sensible default: it's the most
 * common conversation surface.
 */
export const DEFAULT_ROUTE = "❯";

/** Code route — Claude on the record. Alias of {@link DEFAULT_ROUTE}. */
export const ROUTE_CODE = "❯";
/** Shell route — the machine (block-oriented shell backend). */
export const ROUTE_SHELL = "$";
/** btw route — Claude off the record (native side question). */
export const ROUTE_BTW = "?";
/** Find route — transcript search. */
export const ROUTE_FIND = "⌕";
/**
 * Changes view-route ([P01]) — the card's changed files + commit
 * composer. A *view-route*: it retargets submit (commit) and swaps the
 * transcript slot for the ChangesView.
 */
export const ROUTE_CHANGES = "±";
/**
 * History view-route ([P01]) — per-commit blocks over the project's git
 * log; submit sends an on-record `/tugplug:history` question.
 */
export const ROUTE_HISTORY = "↺";
