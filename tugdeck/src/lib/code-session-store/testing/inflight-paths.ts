/**
 * Test-only helpers for reading the in-flight streaming channels.
 *
 * Background: streaming writes now land on per-turn PropertyStore
 * paths (`turn.${turnKey}.${channel}`) instead of the legacy
 * `inflight.*` constants. The path is unknown to tests at literal
 * time because the `turnKey` is minted by the store wrapper at
 * dispatch. These helpers read the live or last-known `turnKey`
 * from the snapshot and resolve the path, so tests can assert on
 * the in-flight value without spelling out the turnKey.
 *
 * Returns `undefined` when no in-flight turn exists and the
 * caller hasn't passed an explicit `turnKey`. Test-only — never
 * imported from production code.
 */

import type { CodeSessionStore } from "@/lib/code-session-store";

export type InflightChannel = "assistant" | "thinking" | "tools";

/**
 * Read the value of the in-flight channel for the currently-active
 * turn. Returns `undefined` if no turn is in flight (or has just
 * committed and `inflightUserMessage` is null).
 */
export function inflightValue(
  store: CodeSessionStore,
  channel: InflightChannel,
): unknown {
  const turnKey = store.getSnapshot().inflightUserMessage?.turnKey;
  if (turnKey === undefined) return undefined;
  return store.streamingDocument.get(`turn.${turnKey}.${channel}`);
}

/**
 * Read the value of a channel for the LAST committed turn. Useful
 * for assertions after `turn_complete` when `inflightUserMessage` is
 * null but the per-turn path still holds the final value.
 */
export function lastCommittedTurnValue(
  store: CodeSessionStore,
  channel: InflightChannel,
): unknown {
  const transcript = store.getSnapshot().transcript;
  const last = transcript[transcript.length - 1];
  if (last === undefined) return undefined;
  return store.streamingDocument.get(`turn.${last.turnKey}.${channel}`);
}
