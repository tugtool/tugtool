/**
 * model-label.ts — format a Claude model id into the dev-card's display label.
 *
 * `system_metadata.model` carries an exact model id like
 * `claude-opus-4-8[1m]`; the Z4B model chip ([#step-2]) shows a compact,
 * human-readable form: `Opus 4.8 · 1M`. This is the pure formatter — no
 * React, no DOM, no I/O — so the mapping is unit-testable on its own,
 * mirroring `model-context-max.ts`.
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
