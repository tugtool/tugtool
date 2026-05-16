/**
 * model-context-max.ts — static lookup for the context-window maximum
 * (in tokens) of a known Claude model name.
 *
 * Why a client-side table: the `system_metadata` payload Claude Code
 * emits does NOT carry the model's context-window maximum (only the
 * model name, permission mode, cwd, etc.). Window-utilization gauges
 * need a denominator; deriving it from the model name is the
 * minimum-change path that works today. When the protocol eventually
 * surfaces the max server-side, this module is the single place to
 * update.
 *
 * **The `[1m]` suffix.** Anthropic emits some models with a
 * `[1m]`-suffixed exact ID (e.g., `claude-opus-4-7[1m]`) to
 * disambiguate the 1M-token extended-context variant from the 200k
 * default. The suffix is preserved through `system_metadata.model` so
 * the lookup table treats it as a first-class signal.
 *
 * Unknown models default to {@link DEFAULT_CONTEXT_MAX_TOKENS} (200k —
 * the modern Claude default). Callers MAY pass `undefined` for the
 * model name when `SessionMetadataStore` has not yet observed a
 * `system_metadata` event; the default fires there too.
 *
 * Pure-functional: no DOM, no React, no module-mutable state.
 *
 * @module lib/model-context-max
 */

/**
 * Default context-window maximum for unknown / not-yet-observed models.
 * Matches the modern Claude default. Surfaced as a named export so
 * callers (and tests) don't sprinkle the literal `200_000` through
 * their own code.
 */
export const DEFAULT_CONTEXT_MAX_TOKENS = 200_000;

/**
 * Context-window maximum (in tokens) for the 1M extended-context
 * variant. Models marked with the `[1m]` suffix resolve to this value
 * regardless of the base-model entry in the table.
 */
export const EXTENDED_CONTEXT_MAX_TOKENS = 1_000_000;

/**
 * Static per-model maxima. Keys are EXACT model strings as
 * `SessionMetadataStore.snapshot.model` reports them — without the
 * `[1m]` suffix (that's handled separately as a per-call override).
 *
 * Add a new entry when a new model lands; the `[1m]` suffix is
 * automatically honored for any base model in the table.
 *
 * The empty table is intentional today: every modern Claude model
 * has a 200k default context, which the `DEFAULT_CONTEXT_MAX_TOKENS`
 * fallback already covers. The table exists so future per-model
 * deviations (a model with a non-standard default, say 100k or
 * 500k) have a registered home.
 */
const MODEL_CONTEXT_MAX_OVERRIDES: ReadonlyMap<string, number> = new Map([
  // (no per-model overrides today — all known models use the 200k
  //  default + optional [1m] suffix for 1M extended context).
]);

/**
 * Resolve the context-window maximum for a given model name.
 *
 *  - `undefined` / empty string → {@link DEFAULT_CONTEXT_MAX_TOKENS}.
 *  - Name carrying the `[1m]` suffix → {@link EXTENDED_CONTEXT_MAX_TOKENS}.
 *  - Name present in {@link MODEL_CONTEXT_MAX_OVERRIDES} → the entry's value.
 *  - Otherwise → {@link DEFAULT_CONTEXT_MAX_TOKENS}.
 *
 * The `[1m]` check fires BEFORE the override lookup so a future model
 * that has BOTH a non-standard default AND a 1M variant resolves to
 * 1M when the suffix is present (the variant trumps the per-model
 * default, which is itself a Claude-side convention).
 */
export function resolveModelContextMax(model: string | null | undefined): number {
  if (model === null || model === undefined || model === "") {
    return DEFAULT_CONTEXT_MAX_TOKENS;
  }
  if (model.endsWith("[1m]")) {
    return EXTENDED_CONTEXT_MAX_TOKENS;
  }
  const override = MODEL_CONTEXT_MAX_OVERRIDES.get(model);
  return override ?? DEFAULT_CONTEXT_MAX_TOKENS;
}
