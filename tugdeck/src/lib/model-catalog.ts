/**
 * model-catalog.ts — the always-current model list, sourced from claude's live
 * `session_capabilities.models` and persisted to tugbank so it never goes
 * stale.
 *
 * The model lineup changes constantly; a hand-maintained constant rots and
 * shows up as the wrong list on launch, on resumed sessions, and in the
 * session-less Settings dropdown. The fix is to treat claude's live
 * `initialize` capabilities as the sole source of truth: whenever a card's
 * `session_capabilities` handshake reports a non-empty `models[]`, we persist
 * it here (`persistModelCatalog`), and every fallback reads it back
 * (`readModelCatalog`). `KNOWN_MODELS` from `model-picker-data.ts` is demoted
 * to a one-time bootstrap seed — used only on a fresh install that has never
 * once spawned a session, and overwritten the instant real capabilities land.
 *
 * The live Z4B picker already prefers live capabilities when present; this
 * module is what makes the *fallback* current too.
 */

import { getTugbankClient } from "@/lib/tugbank-singleton";
import type { TaggedValue } from "@/lib/tugbank-client";
import type { CapabilityModel } from "@/lib/session-metadata-store";
import { KNOWN_MODELS } from "@/lib/model-picker-data";
import { putModelCatalog } from "@/settings-api";

/** tugbank domain/key for the persisted live model catalog. */
export const MODEL_CATALOG_DOMAIN = "dev.tugtool.models";
export const MODEL_CATALOG_KEY = "catalog";

/**
 * Narrow an untrusted persisted value into a `CapabilityModel[]`. Each entry
 * must carry a string `value` + `displayName` (the picker's minimum); the
 * optional description / effort fields are copied through when present. Returns
 * `null` when the value isn't a usable non-empty list, so the caller falls back
 * to the bootstrap seed rather than rendering an empty picker.
 */
export function parsePersistedCatalog(
  entry: TaggedValue | undefined,
): CapabilityModel[] | null {
  if (entry?.kind !== "json" || !Array.isArray(entry.value)) return null;
  const out: CapabilityModel[] = [];
  for (const raw of entry.value) {
    if (raw === null || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.value !== "string" || typeof obj.displayName !== "string") {
      continue;
    }
    const model: CapabilityModel = { value: obj.value, displayName: obj.displayName };
    if (typeof obj.description === "string") model.description = obj.description;
    if (typeof obj.supportsEffort === "boolean") {
      model.supportsEffort = obj.supportsEffort;
    }
    if (Array.isArray(obj.supportedEffortLevels)) {
      model.supportedEffortLevels = obj.supportedEffortLevels.filter(
        (l): l is string => typeof l === "string",
      );
    }
    out.push(model);
  }
  return out.length > 0 ? out : null;
}

/**
 * Persist the live model catalog: optimistic local-cache write (so
 * `useTugbankValue` readers reflect instantly) plus an HTTP PUT. Called when a
 * card's `session_capabilities` reports a non-empty `models[]`. A no-op when
 * the list is empty (a resumed session carries none — don't clobber the cached
 * catalog with nothing).
 */
export function persistModelCatalog(models: CapabilityModel[]): void {
  if (models.length === 0) return;
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(MODEL_CATALOG_DOMAIN, MODEL_CATALOG_KEY, {
      kind: "json",
      value: models,
    });
  }
  putModelCatalog(models);
}

/**
 * Read the always-current model catalog synchronously from the tugbank cache:
 * the last live `session_capabilities.models` claude reported, else the
 * `KNOWN_MODELS` bootstrap seed on a fresh install that has never spawned a
 * session. This is the fallback the picker and the Settings dropdown use in
 * place of the hardcoded constant.
 */
export function readModelCatalog(): CapabilityModel[] {
  const client = getTugbankClient();
  if (client !== null) {
    const parsed = parsePersistedCatalog(
      client.get(MODEL_CATALOG_DOMAIN, MODEL_CATALOG_KEY),
    );
    if (parsed !== null) return parsed;
  }
  return KNOWN_MODELS;
}
