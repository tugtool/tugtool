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
 * Read the value of a channel for a committed turn. Defaults to the
 * LAST committed turn for the common case (`turn_complete` just
 * landed); pass `index` for assertions against earlier turns in a
 * multi-turn transcript (e.g., a full replay bracket carrying
 * several turns).
 *
 * Resolves the per-turn path via the snapshot turnKey lookup, so it
 * works uniformly for any committed turn regardless of how the turn
 * was committed (live, replay, or any future ingestion path that
 * lands on `state.transcript`).
 *
 * Returns `undefined` when the transcript is empty or `index` is
 * out of bounds.
 */
export function committedTurnValue(
  store: CodeSessionStore,
  channel: InflightChannel,
  index?: number,
): unknown {
  const transcript = store.getSnapshot().transcript;
  const idx = index ?? transcript.length - 1;
  const turn = transcript[idx];
  if (turn === undefined) return undefined;
  return store.streamingDocument.get(`turn.${turn.turnKey}.${channel}`);
}

/**
 * @deprecated Use `committedTurnValue(store, channel)`. Retained for
 * source compatibility with tests written before the index parameter
 * was introduced.
 */
export const lastCommittedTurnValue = committedTurnValue;
