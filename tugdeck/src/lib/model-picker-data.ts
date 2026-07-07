/**
 * Model-picker data — pure resolvers that turn a metadata snapshot + the
 * persisted catalog into the picker's option list, active value, and labels.
 *
 * Split out from the React picker so it is unit-testable without a DOM
 * (pure-logic `bun:test` only — no fake-DOM render tests).
 *
 * **There is NO hardcoded model list.** Claude's live capabilities (persisted
 * as the model catalog, [model-catalog.ts]) are the only source of model
 * data. When nothing has ever been reported — a fresh install where no
 * session has run — the picker offers exactly one honest row: the `default`
 * selector, with an explanation that the full list arrives after the first
 * request ({@link UNKNOWN_CATALOG_OPTION}). `default` is the one selector
 * that is always valid regardless of knowledge: it forces no particular
 * model, so the row is truthful with zero data behind it.
 *
 * **Selectors vs resolved ids.** The picker rows are *selectors* the
 * `model_change` frame carries (`default` / `sonnet` / `haiku`), matching the
 * Claude Code terminal's `/model` picker. The live `system_metadata.model` is
 * a *resolved* model id (e.g. `claude-opus-4-8[1m]`) — these never
 * string-match, so the active row is mapped back to its selector by family
 * ({@link modelIdToSelector}). The account default resolves to the
 * most-capable model, so there is no standalone Opus row — Default *is* the
 * account default, exactly as the terminal presents it.
 *
 * @module lib/model-picker-data
 */

import type { CapabilityModel } from "./session-metadata-store";

/**
 * The single honest option offered when no model catalog exists yet (fresh
 * install, no session has ever reported capabilities). NOT a catalog and
 * never persisted — a UI placeholder whose description says exactly why the
 * list is short. The `default` selector forces no particular model, so this
 * row is valid with zero model knowledge.
 */
export const UNKNOWN_CATALOG_OPTION: CapabilityModel = {
  value: "default",
  displayName: "Default",
  description: "The full model list becomes available after the first request to Claude.",
};

export interface PickerModels {
  /** The options to render (live list, else the persisted catalog, else the
   *  single {@link UNKNOWN_CATALOG_OPTION} placeholder). */
  options: CapabilityModel[];
  /** The value of the row to mark active. */
  activeValue: string | null;
}

/**
 * Non-default families a resolved model id can be mapped back to a selector
 * by. Each is checked independently; opus and anything unrecognized fall
 * through to `default` — mirroring the terminal, which checkmarks "Default"
 * while naming the resolved most-capable model in its description. These are
 * family *name heuristics* for id↔selector mapping, not model data — no
 * version, label, or capability is asserted here.
 */
const NON_DEFAULT_FAMILIES = ["haiku", "sonnet"] as const;

/**
 * Map a resolved model id (`claude-sonnet-4-6`, `claude-opus-4-8[1m]`, …) —
 * or an optimistic display label — back to the picker selector it belongs
 * to. A sonnet/haiku family match yields that selector; opus, an
 * unrecognized id, or anything else yields `default` (the account default).
 */
export function modelIdToSelector(modelId: string): string {
  const lower = modelId.toLowerCase();
  for (const family of NON_DEFAULT_FAMILIES) {
    if (lower.includes(family)) return family;
  }
  return "default";
}

/**
 * Strip a trailing parenthetical from a catalog display name —
 * `Default (recommended)` → `Default` — for chip-width contexts. The picker
 * sheet keeps the full name (it has the room).
 */
export function stripDisplayNameParenthetical(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)\s*$/, "");
}

/**
 * The chip-ready label for a picker selector, resolved from the catalog —
 * the row's display name (parenthetical stripped). With no catalog, the
 * `default` selector reads "Default" (always truthful); any other selector
 * falls back to its raw value so an unknown-but-persisted pick stays legible
 * rather than being dressed up as model knowledge.
 */
export function selectorDisplayLabel(
  selector: string,
  catalog: CapabilityModel[] | null,
): string {
  const row = catalog?.find((m) => m.value === selector);
  if (row !== undefined) return stripDisplayNameParenthetical(row.displayName);
  return selector === UNKNOWN_CATALOG_OPTION.value
    ? UNKNOWN_CATALOG_OPTION.displayName
    : selector;
}

/**
 * Resolve the picker's option list and active row from a metadata snapshot.
 *
 * Options: the live `initialize` capability list when non-empty, else the
 * caller-supplied `fallback` (the persisted live catalog via
 * `readModelCatalog()` in production), else the single
 * {@link UNKNOWN_CATALOG_OPTION} placeholder — never a hardcoded list.
 *
 * Active row: the resolved id (or optimistic label) is mapped to its
 * selector by family ({@link modelIdToSelector}); a row with that value is
 * marked, else the first row (the account default by convention).
 */
export function resolvePickerModels(
  models: CapabilityModel[],
  activeModel: string | null,
  fallback: CapabilityModel[] | null,
): PickerModels {
  const known = models.length > 0 ? models : fallback;
  const options =
    known !== null && known.length > 0 ? known : [UNKNOWN_CATALOG_OPTION];

  if (activeModel !== null) {
    const selector = modelIdToSelector(activeModel);
    const hit = options.find(
      (m) =>
        m.value.toLowerCase().includes(selector) ||
        m.displayName.toLowerCase().includes(selector),
    );
    if (hit) return { options, activeValue: hit.value };
  }

  // No model yet, or an opus / default / unrecognized resolved id → the first
  // option, which is the account default by convention.
  return { options, activeValue: options[0].value };
}
