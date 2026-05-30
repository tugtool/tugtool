// Pure parser for claude's `initialize` control-response into a
// `session_capabilities` IPC message.
//
// claude in stream-json mode is silent until the first user message, so
// the only turn-free way to learn a session's capabilities (available
// models, slash-command catalog, agents, output styles, account) is the
// standard `initialize` control-request handshake the SDKs send at spawn.
// claude answers immediately with a `control_response` whose nested
// `response` object carries those capabilities. This module turns that
// raw object into a strict-typed `SessionCapabilities` — unknown / extra
// fields are dropped, malformed entries skipped — so a forward-compatible
// claude can add fields without breaking the contract (per the
// strict-shape policy [R04]).
//
// What `initialize` does NOT carry: the exact current model id, version,
// permission mode, cwd, or session id. Those only arrive via
// `system_metadata` after the first turn. The default model appears only
// as prose inside `models[0].description`; the structured signal is the
// `value: "default"` / `displayName: "Default (recommended)"` convention
// on `models[0]`.

import type {
  CapabilityCommand,
  CapabilityModel,
  SessionCapabilities,
} from "./types.ts";

/** Narrow an unknown to a plain object (not null, not array). */
function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a required string field; returns null if absent / wrong type. */
function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

/** Keep only the string elements of an unknown array. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Parse the `models` array. Each entry needs a string `value` +
 * `displayName`; `description` is optional. The reasoning-effort capability
 * (`supportsEffort` + `supportedEffortLevels`) is carried through for the Z4B
 * effort chip ([#step-4]): `supportsEffort` is absent on the wire when the
 * model does not support effort (e.g. haiku), so it is kept only when the
 * entry actually carries the flag — its absence IS the "unsupported" signal.
 * Malformed entries are skipped rather than failing the whole parse.
 */
function parseModels(value: unknown): CapabilityModel[] {
  if (!Array.isArray(value)) return [];
  const out: CapabilityModel[] = [];
  for (const raw of value) {
    const obj = asObject(raw);
    if (obj === null) continue;
    const v = readString(obj, "value");
    const displayName = readString(obj, "displayName");
    if (v === null || displayName === null) continue;
    const model: CapabilityModel = { value: v, displayName };
    const description = readString(obj, "description");
    if (description !== null) model.description = description;
    if (typeof obj.supportsEffort === "boolean") {
      model.supportsEffort = obj.supportsEffort;
    }
    if (Array.isArray(obj.supportedEffortLevels)) {
      model.supportedEffortLevels = stringArray(obj.supportedEffortLevels);
    }
    out.push(model);
  }
  return out;
}

/**
 * Parse the `commands` array. Each entry needs a string `name`;
 * `description` + `argumentHint` are optional.
 */
function parseCommands(value: unknown): CapabilityCommand[] {
  if (!Array.isArray(value)) return [];
  const out: CapabilityCommand[] = [];
  for (const raw of value) {
    const obj = asObject(raw);
    if (obj === null) continue;
    const name = readString(obj, "name");
    if (name === null) continue;
    const command: CapabilityCommand = { name };
    const description = readString(obj, "description");
    if (description !== null) command.description = description;
    const argumentHint = readString(obj, "argumentHint");
    if (argumentHint !== null) command.argumentHint = argumentHint;
    out.push(command);
  }
  return out;
}

/**
 * Build a `session_capabilities` IPC message from the nested `response`
 * object of an `initialize` `control_response`
 * (`control_response.response.response`).
 *
 * Returns null when the input is not an object (nothing to forward).
 * Always succeeds with a value otherwise — missing fields degrade to
 * empty arrays / `""` / `null`, never throw, so a partial response still
 * surfaces what it can.
 *
 * `effort` is the session's current reasoning-effort level, supplied by the
 * caller ([#step-4]): claude's `initialize` response carries no current-effort
 * field, so tugcode — the `--effort` owner — passes in the level it spawned
 * with (`null` when no override is in force).
 */
export function buildSessionCapabilities(
  response: unknown,
  effort: string | null = null,
): SessionCapabilities | null {
  const obj = asObject(response);
  if (obj === null) return null;
  return {
    type: "session_capabilities",
    models: parseModels(obj.models),
    commands: parseCommands(obj.commands),
    agents: stringArray(obj.agents),
    available_output_styles: stringArray(obj.available_output_styles),
    output_style: readString(obj, "output_style") ?? "",
    account: asObject(obj.account),
    effort,
    ipc_version: 2,
  };
}

/**
 * Extract the nested capability object from a raw `control_response`
 * event (the line claude writes to stdout answering our `initialize`
 * request). The shape is
 * `{ type: "control_response", response: { subtype, request_id, response: {...} } }`.
 * Returns `{ requestId, capabilities }` when this is a well-formed
 * success response, else null. The caller correlates `requestId` against
 * the id it sent for `initialize`.
 */
export function parseInitializeControlResponse(
  event: Record<string, unknown>,
  effort: string | null = null,
): { requestId: string; capabilities: SessionCapabilities } | null {
  if (event.type !== "control_response") return null;
  const response = asObject(event.response);
  if (response === null) return null;
  if (response.subtype !== "success") return null;
  const requestId = readString(response, "request_id");
  if (requestId === null) return null;
  const capabilities = buildSessionCapabilities(response.response, effort);
  if (capabilities === null) return null;
  return { requestId, capabilities };
}
