/**
 * model-label.ts — THE single source of a model's display label.
 *
 * Every chip that names a model — the Dev card's Z4B model chip AND the
 * Settings Assistant default chip — derives its content through
 * {@link resolveModelLabel} in this module. One copy, by construction: the
 * two surfaces cannot drift because there is no second label path.
 *
 * The label is a compact "name with version" — `Opus 4.8 · 1M`,
 * `Fable 5`, `Sonnet 4.6` — derived from live data in this order:
 *
 *  1. A capability/catalog row for the model ({@link modelRowTitle}): the
 *     leading segment of claude's own `description` ("Fable 5 · Most
 *     capable…" → "Fable 5"), with the verbose context phrase compressed
 *     ("Opus 4.8 with 1M context" → "Opus 4.8 · 1M"). This is claude's
 *     reported wording, never a hardcoded list.
 *  2. No row → parse the exact model id ({@link formatModelLabel}):
 *     `claude-opus-4-8[1m]` → `Opus 4.8 · 1M`.
 *  3. Nothing known → `null` (callers show an honest `?` / `Default`).
 *
 * Pure — no React, no DOM, no I/O — so the mapping is unit-testable on its
 * own, mirroring `model-context-max.ts`.
 *
 * Shape of a model id (modern Anthropic convention, family-first):
 *   `claude-<family>-<major>-<minor>[-<release-date>][\[1m\]]`
 *   e.g. `claude-opus-4-8`, `claude-sonnet-4-6`,
 *        `claude-haiku-4-5-20251001`, `claude-opus-4-8[1m]`.
 *
 * The `[1m]` suffix marks the 1M extended-context variant (see
 * `model-context-max.ts`); we surface it as a ` · 1M` annotation.
 *
 * Pure-functional: no DOM, no React, no module-mutable state.
 *
 * @module lib/model-label
 */

import type { CapabilityModel } from "./session-metadata-store";

/** The vendor prefix every Claude model id carries. */
const CLAUDE_PREFIX = "claude-";

/** The extended-context suffix and the annotation it surfaces as. */
const EXTENDED_SUFFIX = "[1m]";
const EXTENDED_LABEL = "1M";

/**
 * Format a Claude model id for display.
 *
 *  - `claude-opus-4-8[1m]`        → `Opus 4.8 · 1M`
 *  - `claude-sonnet-4-6`          → `Sonnet 4.6`
 *  - `claude-haiku-4-5-20251001`  → `Haiku 4.5` (the trailing release date is dropped)
 *  - `claude-opus`                → `Opus` (no version segment)
 *  - An id we can't confidently parse (no `claude-` prefix, or a legacy
 *    number-first id like `claude-3-5-sonnet-…`) → the raw string, so an
 *    unfamiliar shape stays legible rather than rendering as garbage —
 *    matching `formatPermissionMode`'s raw-fallback discipline.
 */
export function formatModelLabel(model: string): string {
  // Peel the `[1m]` extended-context suffix first; it's orthogonal to the
  // family/version parse.
  const extended = model.endsWith(EXTENDED_SUFFIX);
  const base = extended ? model.slice(0, -EXTENDED_SUFFIX.length) : model;

  // Without the vendor prefix we can't parse family/version — fall back raw.
  if (!base.startsWith(CLAUDE_PREFIX)) {
    return model;
  }
  const parts = base
    .slice(CLAUDE_PREFIX.length)
    .split("-")
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return model;
  }

  // Modern ids are family-first (`opus`, `sonnet`, `haiku`). A number-first
  // id is the legacy `claude-3-5-sonnet-…` shape we don't format — bail raw.
  const family = parts[0];
  if (!/^[a-z]/i.test(family)) {
    return model;
  }
  const familyLabel = family.charAt(0).toUpperCase() + family.slice(1);

  // Version components are the short numeric tokens after the family
  // (`4`, `8`). A long all-digit token is the release date (`20251001`) —
  // stop collecting there; a non-numeric token also stops it.
  const version: string[] = [];
  for (const token of parts.slice(1)) {
    if (/^\d{1,2}$/.test(token)) {
      version.push(token);
    } else {
      break;
    }
  }

  const core =
    version.length > 0 ? `${familyLabel} ${version.join(".")}` : familyLabel;
  return extended ? `${core} · ${EXTENDED_LABEL}` : core;
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
 * Compress the verbose extended-context phrase in claude's model wording
 * into the chip's ` · 1M` annotation idiom:
 * `Opus 4.8 with 1M context` → `Opus 4.8 · 1M`. Text without the phrase
 * passes through unchanged.
 */
export function compressContextPhrase(text: string): string {
  return text.replace(
    /\s+with\s+(\d+(?:\.\d+)?\s*[MK])\s+context\b/i,
    (_m, size: string) => ` · ${size.replace(/\s+/g, "")}`,
  );
}

/**
 * The "name with version" title for a capability/catalog row, from claude's
 * own wording: the leading `·`-separated segment of the row's `description`
 * (`"Fable 5 · Most capable…"` → `"Fable 5"`), context phrase compressed
 * (`"Opus 4.8 with 1M context"` → `"Opus 4.8 · 1M"`). A row without a
 * description falls back to its display name, parenthetical stripped.
 */
export function modelRowTitle(row: CapabilityModel): string {
  if (row.description !== undefined) {
    // Isolate the leading name segment FIRST, then compress — compressing
    // first would introduce the very `·` the split keys on.
    const segment = compressContextPhrase(row.description.split("·")[0].trim());
    if (segment.length > 0) return segment;
  }
  return stripDisplayNameParenthetical(row.displayName);
}

/**
 * The model row a model string belongs to. `model` may be an exact resolved
 * id (`claude-sonnet-4-6`), a picker selector (`sonnet`), or an optimistic
 * display label (`Sonnet 4.6`) — matched first by exact selector value, then
 * by the row's value appearing in the string (the `default` row never
 * containment-matches; a resolved id names a family, not "default").
 */
export function findModelRow(
  model: string,
  rows: CapabilityModel[],
): CapabilityModel | null {
  const lower = model.toLowerCase();
  const exact = rows.find((r) => r.value.toLowerCase() === lower);
  if (exact !== undefined) return exact;
  return (
    rows.find(
      (r) =>
        r.value !== "default" &&
        r.value.length > 0 &&
        lower.includes(r.value.toLowerCase()),
    ) ?? null
  );
}

/**
 * The rows a label/selector resolution should consult: the live capability
 * list when present, else the persisted catalog, else nothing. Real data
 * only — there is no hardcoded model list.
 */
export function knownModelRows(
  models: CapabilityModel[],
  catalog: CapabilityModel[] | null,
): CapabilityModel[] {
  return models.length > 0 ? models : (catalog ?? []);
}

/**
 * THE model-chip label — the one path every surface shares ([P01]-grade:
 * consistency by construction, not by parallel implementations).
 *
 *  - `model === null` (session hasn't resolved one): the first row's title —
 *    the account default by convention — or `null` when nothing is known
 *    (callers show `?`).
 *  - A row matches (`findModelRow` handles ids, selectors, and optimistic
 *    labels alike): that row's {@link modelRowTitle}.
 *  - No row but the string is the `default` selector: `"Default"` — the
 *    honest zero-state word, since with no data we cannot say what the
 *    account default resolves to.
 *  - Anything else: {@link formatModelLabel} parses the id shape.
 */
export function resolveModelLabel(
  model: string | null,
  rows: CapabilityModel[],
): string | null {
  if (model === null) {
    return rows.length > 0 ? modelRowTitle(rows[0]) : null;
  }
  const row = findModelRow(model, rows);
  if (row !== null) return modelRowTitle(row);
  if (model === "default") return "Default";
  return formatModelLabel(model);
}
