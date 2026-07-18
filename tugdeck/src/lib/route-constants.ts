/**
 * route-constants — the Code route scalar, kept for prompt-history keying.
 *
 * The sticky-route machinery is gone: Code is the only resting mode and
 * every other destination is reached per-submission via a slash command
 * ([P01]). What survives is the single Code scalar — persisted prompt
 * history keys entries by route, and the Code provider recalls only
 * `"❯"` entries ([P11]); entries persisted under the retired route
 * characters simply stop being recalled.
 *
 * @module lib/route-constants
 */

/** The Code route scalar — the one value prompt history keys against. */
export const DEFAULT_ROUTE = "❯";

/** Code route — Claude on the record. Alias of {@link DEFAULT_ROUTE}. */
export const ROUTE_CODE = "❯";
