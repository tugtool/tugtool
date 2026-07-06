/**
 * model.ts — pure helpers for the dev-card model chip's per-card persistence
 * and deck-wide default.
 *
 * No React, no DOM, no I/O — every export is a pure function or a constant, so
 * the parse/seed logic is unit-testable without a store or a rendered
 * component. The model picker ([model-picker-sheet.tsx]) and the set/restore
 * hook ([use-model.ts]) consume these; tugbank persistence and IPC live in the
 * hook, not here. Mirrors `permission-mode.ts` / `effort.ts`.
 *
 * The persisted value is a picker **selector** (`default` / `sonnet` /
 * `haiku`), matching the `model_change` frame and the Claude Code terminal's
 * `/model` picker — NOT a resolved model id. `default` means the account
 * default (the most-capable model), so it is the natural zero-state: a card
 * seeded with `default` forces no particular model.
 */

import type { TaggedValue } from "@/lib/tugbank-client";
import { readModelCatalog } from "@/lib/model-catalog";

/**
 * Whether `value` is a picker selector claude currently offers — checked
 * against the live, persisted model catalog ([model-catalog.ts]), never a
 * hardcoded set, so a selector claude added (e.g. a new family) validates the
 * moment it appears. Used to drop untrusted persisted strings that aren't a
 * real selector rather than push a bogus model to claude. Falls back to the
 * `KNOWN_MODELS` bootstrap seed only before any session has reported
 * capabilities (and in pure unit tests, where there is no tugbank).
 */
export function isModelSelector(value: string): boolean {
  return readModelCatalog().some((m) => m.value === value);
}

/**
 * Parse the persisted model selector out of its tugbank tagged value, narrowed
 * to a known selector (or `null`). The persisted string is untrusted — a value
 * from a future / corrupt build that isn't a real selector yields `null` (no
 * seed) rather than being sent to claude. Mirrors `parsePersistedPermissionMode`.
 */
export function parsePersistedModel(entry: TaggedValue | undefined): string | null {
  if (
    entry?.kind === "string" &&
    typeof entry.value === "string" &&
    isModelSelector(entry.value)
  ) {
    return entry.value;
  }
  return null;
}

/** tugbank domain for per-card model persistence per [D07]. */
export const MODEL_DOMAIN = "dev.model";

/**
 * tugbank domain/key for the *global* default model selector — the model a
 * brand-new card (one with nothing persisted under {@link MODEL_DOMAIN}) adopts
 * on mount. Set from the Settings card's "Dev Card" tab; distinct from the
 * per-card domain so changing the global default never disturbs an open card
 * that already carries its own remembered model. Mirrors the permission-mode
 * default domain.
 */
export const MODEL_DEFAULT_DOMAIN = "dev.tugtool.model";
export const MODEL_DEFAULT_KEY = "default";

/** The selector new cards adopt when nothing else is configured — the account
 *  default, which forces no particular model. */
export const DEFAULT_MODEL_SELECTOR = "default";

/**
 * The model a freshly-mounted card should align its session to: its own
 * per-card persisted selector when present, otherwise the global default.
 * `null` when neither is set — the caller then leaves the session on whatever
 * model it spawned with (no frame sent). The per-card value always wins, so a
 * card that has been used keeps its remembered model regardless of the global
 * default. Mirrors `resolveSeedPermissionMode`.
 */
export function resolveSeedModel(
  persisted: string | null,
  globalDefault: string | null,
): string | null {
  return persisted ?? globalDefault;
}
