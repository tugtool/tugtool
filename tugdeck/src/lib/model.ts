/**
 * model.ts — pure helpers for the session-card model chip's per-card persistence
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
 *
 * A saved selector is read back through [model-selector.ts], which matches it
 * to the catalog row it names even when claude has respelled that selector
 * between releases — so a remembered pick survives a rename instead of being
 * mistaken for a model that went away.
 */

import type { TaggedValue } from "@/lib/tugbank-client";
import { readModelCatalog } from "@/lib/model-catalog";
import { resolveCatalogSelector } from "@/lib/model-selector";
import { DEFAULT_MODEL_SELECTOR } from "@/lib/model-domains";

/**
 * The *current* spelling of a saved selector: the value of the catalog row it
 * names ([model-selector.ts] matches across respellings — `claude-fable-5`
 * resolves to today's `claude-fable-5[1m]`), or `null` when the catalog offers
 * no model it could be. Reading through this is what keeps a remembered pick
 * working when claude renames its own selector, and what narrows an untrusted
 * persisted string down to something safe to send.
 *
 * Before any session has ever reported capabilities there is no catalog and no
 * model knowledge — only the `default` selector (which forces no particular
 * model) resolves.
 */
export function resolveModelSelector(value: string): string | null {
  const catalog = readModelCatalog();
  if (catalog === null) {
    return value === DEFAULT_MODEL_SELECTOR ? DEFAULT_MODEL_SELECTOR : null;
  }
  return resolveCatalogSelector(value, catalog)?.value ?? null;
}

/**
 * Whether `value` names a model claude currently offers — checked against the
 * live, persisted model catalog ([model-catalog.ts]), never a hardcoded set,
 * so a selector claude added (e.g. a new family) validates the moment it
 * appears and a selector claude respelled keeps validating. Used to drop
 * untrusted persisted strings that name nothing rather than push a bogus model
 * to claude.
 */
export function isModelSelector(value: string): boolean {
  return resolveModelSelector(value) !== null;
}

/**
 * Parse the persisted model selector out of its tugbank tagged value, resolved
 * to the selector claude offers for it *today* (or `null`). The persisted
 * string is untrusted and possibly written by an older build against an older
 * catalog: a respelled selector comes back in its current spelling, and one
 * naming no available model yields `null` (no seed) rather than being sent to
 * claude. Mirrors `parsePersistedPermissionMode`.
 */
export function parsePersistedModel(entry: TaggedValue | undefined): string | null {
  if (entry?.kind === "string" && typeof entry.value === "string") {
    return resolveModelSelector(entry.value);
  }
  return null;
}

// The tugbank domain/key constants live in a dependency-free leaf so
// `settings-api.ts` can name the domains without closing an import cycle
// through `model-catalog.ts`; this module stays their public home.
export {
  DEFAULT_MODEL_SELECTOR,
  MODEL_DEFAULT_DOMAIN,
  MODEL_DEFAULT_KEY,
  MODEL_DOMAIN,
} from "@/lib/model-domains";

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
