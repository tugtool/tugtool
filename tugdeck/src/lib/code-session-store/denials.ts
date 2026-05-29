/**
 * denials.ts — decode + accumulate `permission_denials` for the dev card's
 * `/permissions` Recently-denied tab.
 *
 * tugcode forwards a turn's denied tool calls verbatim on the `cost_update`
 * frame's `permission_denials[]` (snake_case `{ tool_name, tool_use_id,
 * tool_input }`). The reducer decodes them to {@link PermissionDenial}
 * (camelCase) and accumulates across the session, deduped by `toolUseId`,
 * most-recent last. Runtime-only — never persisted.
 *
 * Pure functions; unit-tested separately from the reducer.
 *
 * @module lib/code-session-store/denials
 */

import type { PermissionDenial } from "./types";

/** Cap the accumulated list so a long session can't grow it unbounded. */
const MAX_DENIALS = 200;

/**
 * Decode a `cost_update.permission_denials` payload into validated
 * {@link PermissionDenial}s. Tolerant: a non-array, or entries missing
 * `tool_name` / `tool_use_id`, are skipped rather than throwing.
 */
export function decodePermissionDenials(raw: unknown): PermissionDenial[] {
  if (!Array.isArray(raw)) return [];
  const out: PermissionDenial[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const toolName = typeof e.tool_name === "string" ? e.tool_name : "";
    const toolUseId = typeof e.tool_use_id === "string" ? e.tool_use_id : "";
    if (toolName === "" || toolUseId === "") continue;
    const toolInput =
      e.tool_input !== null && typeof e.tool_input === "object"
        ? (e.tool_input as Record<string, unknown>)
        : {};
    out.push({ toolName, toolUseId, toolInput });
  }
  return out;
}

/**
 * Append `incoming` denials to `existing`, deduping by `toolUseId` (a repeated
 * `cost_update` could re-report the same denial) and capping to the most-recent
 * {@link MAX_DENIALS}. Returns `existing` unchanged (same reference) when there
 * is nothing new — preserving `Object.is` stability for `useSyncExternalStore`.
 */
export function mergeDenials(
  existing: readonly PermissionDenial[],
  incoming: readonly PermissionDenial[],
): readonly PermissionDenial[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((d) => d.toolUseId));
  const fresh = incoming.filter((d) => !seen.has(d.toolUseId));
  if (fresh.length === 0) return existing;
  const merged = [...existing, ...fresh];
  return merged.length > MAX_DENIALS
    ? merged.slice(merged.length - MAX_DENIALS)
    : merged;
}
