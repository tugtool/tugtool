/**
 * effort.ts — pure helpers for the dev-card reasoning-effort chip.
 *
 * No React, no DOM, no I/O — every export is a pure function or constant, so
 * the level ordering and label logic is unit-testable without a store or a
 * rendered component. The chip ([effort-chip.tsx]) and the picker hook
 * ([use-effort.ts] / [effort-picker-sheet.tsx]) consume these; tugbank
 * persistence and IPC live in the hook, not here.
 *
 * Reasoning effort is the Claude Code terminal's `/effort` control — "how
 * long Claude thinks before answering." Grounded in the claude 2.1.158
 * binary (`--effort <level>` help + the `initialize` capability response):
 *
 *  - The canonical level set is `low | medium | high | xhigh | max`, in that
 *    order of increasing thinking budget.
 *  - It is **model-gated and per-model**: the `initialize` `models[]` entries
 *    carry a `supportsEffort` flag (absent when unsupported, e.g. haiku) and a
 *    `supportedEffortLevels` list that VARIES by model — opus supports all
 *    five, sonnet supports four (no `xhigh`), haiku none. So the picker must
 *    offer the *active model's* `supportedEffortLevels`, not the full set.
 *  - There is **no current-effort field on the wire** — the terminal surfaces
 *    a level only when one has been explicitly set (`--effort`). So a session
 *    with no override has no level to show (`null` → "Default"); tugcode, the
 *    `--effort` owner, is the authority on the current level.
 */

import type { TaggedValue } from "@/lib/tugbank-client";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import { resolvePickerModels } from "@/lib/model-picker-data";

/**
 * The reasoning-effort levels in canonical order (increasing thinking
 * budget), matching the claude 2.1.158 `--effort` enum. A given model
 * supports a SUBSET of these (its `supportedEffortLevels`); this is the full
 * universe the picker filters against to keep a stable display order.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/** A reasoning-effort level. */
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * The effective effort level when a session supports effort but carries no
 * explicit `--effort` override. claude 2.1.158 *"now defaults to high effort"*
 * (its own release note, confirmed in the binary), so a fresh session is
 * genuinely running at `high` — the chip shows that rather than a bare
 * placeholder. Only an *unsupported* model (e.g. haiku) has no level at all
 * (`-`). Self-correcting: an explicit pick replaces it; if a future claude
 * changes its default, set one and the override carries.
 */
export const DEFAULT_EFFORT_LEVEL: EffortLevel = "high";

/**
 * Human-readable label per level for the chip's content line and the picker
 * rows. `xhigh` reads as claude's own "Extra-High" wording (the terminal
 * labels it `extra-high`); the rest are the title-cased level.
 */
const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra-High",
  max: "Max",
};

/**
 * The placeholder the effort chip shows when there is no level to display —
 * the model doesn't support effort, or supports it but no override is set
 * (the wire exposes no current-effort value). The chip is a permanent Z4B
 * fixture, so it shows this rather than hiding.
 */
export const EFFORT_NO_VALUE = "-";

/**
 * The chip's content-line text for a given level. `null` (no value — either no
 * override is set, or the model doesn't support effort) reads as the
 * {@link EFFORT_NO_VALUE} placeholder; an unknown level falls back to its raw
 * value so a future claude level is legible rather than blank.
 */
export function formatEffortLabel(level: string | null): string {
  if (level === null) return EFFORT_NO_VALUE;
  return EFFORT_LABELS[level] ?? level;
}

/**
 * Filter + order an arbitrary `supportedEffortLevels` list into the canonical
 * {@link EFFORT_LEVELS} order, dropping any unrecognized level. Used to render
 * the picker rows for the active model in a stable order regardless of how the
 * capability response ordered them.
 */
export function orderEffortLevels(levels: readonly string[]): EffortLevel[] {
  return EFFORT_LEVELS.filter((level) => levels.includes(level));
}

/** The active model's reasoning-effort capability. */
export interface EffortSupport {
  /** Whether the active model supports reasoning effort at all. */
  supported: boolean;
  /** The levels it supports, in canonical {@link EFFORT_LEVELS} order. */
  levels: EffortLevel[];
}

/**
 * Resolve whether the *active* model supports reasoning effort, and which
 * levels, from the capability `models[]` list ([#step-4]).
 *
 * The active model id (`system_metadata.model`, a resolved id like
 * `claude-opus-4-8[1m]`) is mapped back to its `models[]` entry by reusing the
 * picker's family resolution ({@link resolvePickerModels}); the entry's
 * `supportsEffort` + `supportedEffortLevels` drive the result. Effort is
 * "supported" only when the entry says so AND it lists at least one
 * recognized level.
 *
 * A resumed session carries no live `initialize` capabilities (`models` is
 * empty), but its model id is still known via `system_metadata` replay — so
 * support resolves from the static `KNOWN_MODELS` fallback (which carries the
 * captured per-family effort data), exactly as the model chip falls back for
 * its label. Only when NOTHING is known yet — no capabilities AND no resolved
 * model — is support genuinely unknowable (returns unsupported → `-`).
 */
export function resolveEffortSupport(
  models: CapabilityModel[],
  activeModel: string | null,
): EffortSupport {
  // Nothing known yet (no live capabilities, no resolved model) — can't tell.
  if (models.length === 0 && activeModel === null) {
    return { supported: false, levels: [] };
  }

  // `resolvePickerModels` uses the live list when present, else the static
  // `KNOWN_MODELS` fallback — so a resumed session with a known model id still
  // resolves its effort support.
  const { options, activeValue } = resolvePickerModels(models, activeModel);
  const entry =
    options.find((m) => m.value === activeValue) ?? options[0] ?? null;
  if (entry === null || entry.supportsEffort !== true) {
    return { supported: false, levels: [] };
  }
  const levels = orderEffortLevels(entry.supportedEffortLevels ?? []);
  return { supported: levels.length > 0, levels };
}

/** What the EFFORT chip should display: a level, or `null` for the `-` blank. */
export interface EffortDisplay {
  supported: boolean;
  /** The level to show, or `null` to show the `-` placeholder. */
  level: string | null;
  levels: EffortLevel[];
}

/**
 * Resolve what the EFFORT chip should DISPLAY, distinguishing a known level
 * from an honest unknown. EFFORT is NOT in the session JSONL — it exists only
 * when a live `session_capabilities` handshake delivers it (or the user set it,
 * which persists per-card and re-applies optimistically). So a pure offline
 * replay — a resumed session whose model resolves but which never handshook —
 * has no effort SIGNAL, and must read as unknown rather than an assumed default.
 *
 * Rules:
 * - model doesn't support effort → no level (`-`).
 * - an explicit `effort` (live override, or a restored per-card choice) → it.
 * - no `effort` but a live handshake is present (`models` non-empty) → the
 *   confirmed `DEFAULT_EFFORT_LEVEL` (claude runs a fresh session at that).
 * - no `effort` AND no live handshake (`models` empty — pure offline replay) →
 *   unknown (`null` → `-`), never a stale or assumed default. `resolveEffortSupport`
 *   still resolves *support* from the static model catalog (so the picker offers
 *   levels), but support ≠ a known current level.
 */
export function resolveEffortDisplay(
  models: CapabilityModel[],
  activeModel: string | null,
  effort: string | null,
): EffortDisplay {
  const support = resolveEffortSupport(models, activeModel);
  if (!support.supported) {
    return { supported: false, level: null, levels: support.levels };
  }
  if (effort !== null) {
    return { supported: true, level: effort, levels: support.levels };
  }
  const hasLiveHandshake = models.length > 0;
  return {
    supported: true,
    level: hasLiveHandshake ? DEFAULT_EFFORT_LEVEL : null,
    levels: support.levels,
  };
}

/**
 * Parse the per-card persisted effort out of its tugbank tagged value.
 * Returns the stored string when present and string-kinded, else `null`. Not
 * narrowed to a known level — a level persisted by a future build is still a
 * legible string the chip can show.
 */
export function parsePersistedEffort(entry: TaggedValue | undefined): string | null {
  return entry?.kind === "string" && typeof entry.value === "string"
    ? entry.value
    : null;
}

/** tugbank domain for per-card effort persistence per [D07]. */
export const EFFORT_DOMAIN = "dev.effort";
