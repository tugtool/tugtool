/**
 * Pure-logic filter / projection helpers over the log buffer.
 *
 * All functions are side-effect-free and reference-stable when the
 * inputs are unchanged. `stringifyDataForSearch` is the one exception
 * — it lazily caches per-entry JSON via a `WeakMap` keyed on the
 * entry reference, so the same entry doesn't re-stringify per
 * keystroke. The cache is invisible to callers (no clear / no size
 * exposure); entries are GC'd when the entry is dropped from the
 * buffer.
 *
 * @module lib/tug-dev-log-store/filter
 */

import type { TugDevLogEntry, TugDevLogFilters } from "./types";

/**
 * `stringifyDataForSearch` cache. Keyed on entry reference. Survives
 * across calls so a multi-keystroke text-filter scan only pays the
 * `JSON.stringify` cost once per entry. The cache is module-scope
 * (one per process) — fine for a dev-only surface; the entries it
 * holds are dropped as soon as the entry is GC'd from the buffer.
 */
const stringifiedCache = new WeakMap<TugDevLogEntry, string>();

/**
 * Stringify the entry's `data` field for free-text search. Returns
 * an empty string for `undefined`. Cached per entry reference.
 *
 * Defensive against `JSON.stringify` failures (cyclic graphs,
 * BigInt, etc.) — returns the empty string on throw so the search
 * path stays robust at the cost of those entries being unmatched
 * by `data` content.
 */
export function stringifyDataForSearch(entry: TugDevLogEntry): string {
  const cached = stringifiedCache.get(entry);
  if (cached !== undefined) return cached;
  let s = "";
  if (entry.data !== undefined) {
    try {
      s = JSON.stringify(entry.data) ?? "";
    } catch {
      s = "";
    }
  }
  stringifiedCache.set(entry, s);
  return s;
}

/**
 * Project the distinct `source` values present in the buffer, in
 * first-seen order. Useful for populating the source-filter popup
 * with concrete options. Returns an array (caller never mutates).
 */
export function extractSources(
  entries: readonly TugDevLogEntry[],
): readonly string[] {
  if (entries.length === 0) return EMPTY_STRING_ARRAY;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (!seen.has(e.source)) {
      seen.add(e.source);
      out.push(e.source);
    }
  }
  return out;
}

const EMPTY_STRING_ARRAY: readonly string[] = Object.freeze([]);

/**
 * Apply the filter view over the buffer. Returns a new array of
 * matching entries (newest at end, matching the buffer's order — the
 * UI layer reverses for display). If no filter is active, returns
 * the input reference unchanged.
 */
export function filterEntries(
  entries: readonly TugDevLogEntry[],
  filters: TugDevLogFilters,
): readonly TugDevLogEntry[] {
  if (entries.length === 0) return entries;
  const levelsPass =
    filters.levels.size === 4 || filters.levels.size === 0;
  const sourceAny = filters.source === null;
  const textActive = filters.text.length > 0;
  if (levelsPass && filters.levels.size === 4 && sourceAny && !textActive) {
    return entries;
  }
  const text = textActive ? filters.text.toLowerCase() : "";
  const out: TugDevLogEntry[] = [];
  for (const e of entries) {
    if (!filters.levels.has(e.level)) continue;
    if (!sourceAny && e.source !== filters.source) continue;
    if (textActive) {
      const messageHit = e.message.toLowerCase().includes(text);
      const dataHit = !messageHit &&
        stringifyDataForSearch(e).toLowerCase().includes(text);
      if (!messageHit && !dataHit) continue;
    }
    out.push(e);
  }
  return out;
}
