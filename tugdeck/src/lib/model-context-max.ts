/**
 * model-context-max.ts — the context-window maximum (in tokens) for the
 * model a session is running.
 *
 * Why this exists client-side: the `system_metadata` payload Claude Code
 * emits does NOT carry the model's context-window maximum (only the model
 * name, permission mode, cwd, etc.). Window-utilization gauges need a
 * denominator, and the model name plus claude's own capability wording are
 * what we have.
 *
 * Resolution order, most-authoritative first:
 *
 *  1. **The `[1m]` suffix on the name.** Claude Code marks the 1M
 *     extended-context variant with a suffixed id (`claude-opus-4-7[1m]`).
 *     Present → 1M, whatever else says.
 *  2. **Claude's live catalog** ([model-label.ts] `findModelRow` +
 *     `modelRowTitle`). The rows state the window in their own words —
 *     `"Opus 5 · 1M · Best for everyday, complex tasks"` — so the number
 *     comes from claude, not from us. This is the tier that keeps working
 *     across a model launch.
 *  3. **A family/version floor** ({@link NATIVE_EXTENDED_MIN_VERSION}), for
 *     when no catalog has landed yet (fresh install, no session has reported
 *     capabilities). Keyed on family + version rather than exact ids, so
 *     `claude-opus-5` resolves the same as `claude-opus-4-8` without an edit.
 *  4. Otherwise {@link DEFAULT_CONTEXT_MAX_TOKENS} (200k).
 *
 * **The resume path is what makes tiers 2–4 load-bearing.** Claude's JSONL
 * records the bare `claude-opus-5` on every `assistant.message.model` — the
 * `[1m]` suffix exists only on the live `system/init`. A resumed session
 * whose ledger has no live row to merge against therefore reports the bare
 * name, and an exact-id table (which is what this module used to be) sized
 * its window at 200k the moment a new model shipped.
 *
 * Callers MAY pass `undefined` for the model name when `SessionMetadataStore`
 * has not yet observed a `system_metadata` event; the default fires there too.
 *
 * Pure-functional: no DOM, no React, no module-mutable state — the catalog
 * read lives in the caller.
 *
 * @module lib/model-context-max
 */

import type { CapabilityModel } from "./session-metadata-store";
import { findModelRow, isContextAnnotation, modelRowTitle } from "./model-label";
import { canonicalModelKey } from "./model-selector";

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
 * regardless of what any other tier says.
 */
export const EXTENDED_CONTEXT_MAX_TOKENS = 1_000_000;

/** The extended-context suffix Claude Code appends to the 1M variant's id. */
const EXTENDED_SUFFIX = "[1m]";

/**
 * The first version of each family that carries a native 1M window — the
 * catalog-less fallback. Opus and Sonnet crossed over at 4.6; Fable has been
 * 1M since 5. A family absent here (Haiku, and anything unrecognized) keeps
 * the 200k default, and a version below the floor (Opus 4.5) does too.
 *
 * Versions, not exact ids: a family's later releases inherit the window, so a
 * model that ships after this build still sizes correctly with no catalog.
 */
const NATIVE_EXTENDED_MIN_VERSION: ReadonlyMap<string, readonly number[]> =
  new Map([
    ["opus", [4, 6]],
    ["sonnet", [4, 6]],
    ["fable", [5]],
  ]);

/**
 * Split a canonical model key ([model-selector.ts] `canonicalModelKey` —
 * vendor prefix, `[Nm]` suffix, and dated tail already gone) into its family
 * and its numeric version segments: `opus-4-8` → `["opus", [4, 8]]`,
 * `opus-5` → `["opus", [5]]`, `opus` → `["opus", []]`.
 */
function splitFamilyVersion(key: string): [string, number[]] {
  const parts = key.split("-").filter((p) => p.length > 0);
  if (parts.length === 0) return ["", []];
  const version: number[] = [];
  for (const token of parts.slice(1)) {
    if (!/^\d{1,2}$/.test(token)) break;
    version.push(Number(token));
  }
  return [parts[0], version];
}

/**
 * Whether `version` is at or past `floor`, comparing segment by segment with
 * a missing segment read as `0` — so `[5] ≥ [4, 6]`, `[4, 8] ≥ [4, 6]`, and
 * an unversioned `[]` is below every floor (the conservative reading: an id
 * that names no version is not evidence of a new one).
 */
function atLeastVersion(version: readonly number[], floor: readonly number[]): boolean {
  const width = Math.max(version.length, floor.length);
  for (let i = 0; i < width; i += 1) {
    const a = version[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

/**
 * The token count a context annotation names — `1M` → 1,000,000, `200K` →
 * 200,000 — or `null` when the text carries no annotation. The one place the
 * `M`/`K` idiom in claude's wording is turned into a number.
 */
export function parseContextAnnotation(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*([MK])/i.exec(text);
  if (match === null) return null;
  const scale = match[2].toUpperCase() === "M" ? 1_000_000 : 1_000;
  const tokens = Number(match[1]) * scale;
  return Number.isFinite(tokens) && tokens > 0 ? tokens : null;
}

/**
 * The window a catalog row states, from claude's own wording: the `[1m]`
 * suffix on the row's selector, else the context annotation in the row's
 * title (`"Opus 5 · 1M"` → 1,000,000). `null` when the row says nothing about
 * its window — `"Sonnet 5 · Efficient for routine tasks"` names no size, so
 * the caller falls through rather than inventing one.
 */
function rowContextMax(row: CapabilityModel): number | null {
  if (row.value.trim().toLowerCase().endsWith(EXTENDED_SUFFIX)) {
    return EXTENDED_CONTEXT_MAX_TOKENS;
  }
  const title = modelRowTitle(row);
  const segments = title.split("·").map((s) => s.trim());
  const annotation = segments.find((s) => isContextAnnotation(s));
  return annotation !== undefined ? parseContextAnnotation(annotation) : null;
}

/**
 * Resolve the context-window maximum for a model name, preferring what
 * claude's own capability rows say over anything hardcoded here.
 *
 * `rows` is the live capability list, else the persisted catalog (callers pass
 * `knownModelRows(snapshot.models, readModelCatalog())`); omit it and the
 * resolution falls back to the family/version floor.
 */
export function resolveModelContextMax(
  model: string | null | undefined,
  rows: CapabilityModel[] = [],
): number {
  if (model === null || model === undefined || model === "") {
    return DEFAULT_CONTEXT_MAX_TOKENS;
  }
  if (model.endsWith(EXTENDED_SUFFIX)) {
    return EXTENDED_CONTEXT_MAX_TOKENS;
  }

  const row = rows.length > 0 ? findModelRow(model, rows) : null;
  if (row !== null) {
    const stated = rowContextMax(row);
    if (stated !== null) return stated;
  }

  const [family, version] = splitFamilyVersion(canonicalModelKey(model));
  const floor = NATIVE_EXTENDED_MIN_VERSION.get(family);
  if (floor !== undefined && atLeastVersion(version, floor)) {
    return EXTENDED_CONTEXT_MAX_TOKENS;
  }
  return DEFAULT_CONTEXT_MAX_TOKENS;
}
