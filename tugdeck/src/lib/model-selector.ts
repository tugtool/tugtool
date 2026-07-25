/**
 * model-selector.ts — resolving a *saved* model selector against the live
 * catalog, tolerant of the ways claude respells a selector between releases.
 *
 * A persisted selector is a string claude's own capability list once offered
 * (`sonnet`, `opus[1m]`, `claude-fable-5[1m]`). That spelling is not stable:
 * the same model has appeared as `claude-fable-5` and later as
 * `claude-fable-5[1m]` when its 1M-context variant became the offered form,
 * and short family selectors coexist with fully-qualified ids. An exact
 * string test against the current catalog therefore reports a model the user
 * still has as "unavailable" and silently drops them to the account default.
 *
 * So a saved selector is matched by *identity of the model it names*, in
 * order: the exact value, then a canonical key that ignores the vendor
 * prefix, the `[Nm]` context-variant suffix, and a dated-snapshot tail, then
 * a family/version prefix relation in either direction (`fable` ↔
 * `claude-fable-5[1m]`). Catalog order breaks ties — it is claude's own
 * ordering, most-preferred first.
 *
 * The `default` row is never a fuzzy match: it names no particular model, so
 * nothing may drift onto it. It matches only its own exact value.
 *
 * Pure — no React, no DOM, no I/O. The catalog read and the persistence
 * write-back live in the callers ([model.ts], [use-unavailable-model-bulletin.ts]).
 *
 * @module lib/model-selector
 */

import type { CapabilityModel } from "./session-metadata-store";

/** The selector that forces no particular model — never a fuzzy-match target. */
const DEFAULT_ROW_VALUE = "default";

/**
 * The comparison key for a selector or model id: lowercased, with the vendor
 * prefix, the `[Nm]` extended-context suffix, and a trailing dated-snapshot
 * segment removed — the parts that vary between spellings of the same model.
 *
 *  - `claude-fable-5[1m]` → `fable-5`
 *  - `claude-fable-5`     → `fable-5`
 *  - `opus[1m]`           → `opus`
 *  - `claude-haiku-4-5-20251001` → `haiku-4-5`
 */
export function canonicalModelKey(value: string): string {
  let key = value.trim().toLowerCase();
  key = key.replace(/\[\d+m\]$/, "");
  if (key.startsWith("claude-")) key = key.slice("claude-".length);
  key = key.replace(/-\d{8}$/, "");
  return key;
}

/** Whether `a`'s segments are a leading run of `b`'s (`fable` ⊂ `fable-5`). */
function isKeyPrefix(a: string, b: string): boolean {
  if (a.length === 0 || a === b) return false;
  const left = a.split("-");
  const right = b.split("-");
  if (left.length >= right.length) return false;
  return left.every((segment, i) => segment === right[i]);
}

/**
 * The catalog row a saved selector names, or `null` when the catalog offers
 * nothing that could be the same model — the one condition that genuinely
 * means "this pick is gone".
 *
 * The returned row's `value` is the selector's *current* spelling, so callers
 * both validate and migrate from one call.
 */
export function resolveCatalogSelector(
  saved: string,
  rows: CapabilityModel[],
): CapabilityModel | null {
  const trimmed = saved.trim();
  if (trimmed.length === 0) return null;

  const lower = trimmed.toLowerCase();
  const exact = rows.find((r) => r.value.toLowerCase() === lower);
  if (exact !== undefined) return exact;

  // Past the exact tier, `default` is out of play — it names no model.
  const concrete = rows.filter((r) => r.value !== DEFAULT_ROW_VALUE);
  const key = canonicalModelKey(trimmed);
  if (key.length === 0) return null;

  const sameKey = concrete.find((r) => canonicalModelKey(r.value) === key);
  if (sameKey !== undefined) return sameKey;

  return (
    concrete.find((r) => {
      const rowKey = canonicalModelKey(r.value);
      return isKeyPrefix(key, rowKey) || isKeyPrefix(rowKey, key);
    }) ?? null
  );
}
