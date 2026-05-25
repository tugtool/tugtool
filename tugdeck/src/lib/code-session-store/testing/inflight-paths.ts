/**
 * Test-only helpers for reading per-Message streaming PropertyStore
 * paths.
 *
 * Under [D07] the substrate writes to per-Message paths
 * (`turn.${turnKey}.message.${messageKey}.text`) — these helpers walk
 * the snapshot's `activeTurn.messages` (or a committed turn's
 * `messages`) to find a Message of a given kind and resolve its path
 * without the test having to spell out the messageKey.
 *
 * For most tests, asserting against the snapshot Messages directly
 * (e.g. `activeTurn.messages.find(m => m.kind === "assistant_text")?.text`)
 * is cleaner. These helpers exist for tests that want to verify the
 * PropertyStore wire — i.e., that the reducer's write-inflight effect
 * actually landed the text on the right path.
 *
 * Returns `undefined` when no in-flight turn exists, or when no
 * Message of the requested kind is present.
 *
 * Test-only — never imported from production code.
 */

import type { CodeSessionStore } from "@/lib/code-session-store";

export type StreamingKindFilter =
  | "assistant_text"
  | "assistant_thinking";

/**
 * Read the value of the first in-flight Message of `kind`'s streaming
 * `text` path. Returns `undefined` if no turn is in flight or no
 * matching Message exists.
 */
export function inflightValue(
  store: CodeSessionStore,
  kind: StreamingKindFilter,
): unknown {
  const active = store.getSnapshot().activeTurn;
  if (active === null) return undefined;
  const match = active.messages.find((m) => m.kind === kind);
  if (match === undefined) return undefined;
  return store.streamingDocument.get(
    `turn.${active.turnKey}.message.${match.messageKey}.text`,
  );
}

/**
 * Read the value of the first Message of `kind` in a committed turn's
 * streaming `text` path. Defaults to the LAST committed turn for the
 * common case; pass `index` for assertions against earlier turns.
 *
 * Returns `undefined` when the transcript is empty, `index` is out of
 * bounds, or no matching Message is present.
 */
export function committedTurnValue(
  store: CodeSessionStore,
  kind: StreamingKindFilter,
  index?: number,
): unknown {
  const transcript = store.getSnapshot().transcript;
  const idx = index ?? transcript.length - 1;
  const turn = transcript[idx];
  if (turn === undefined) return undefined;
  const match = turn.messages.find((m) => m.kind === kind);
  if (match === undefined) return undefined;
  return store.streamingDocument.get(
    `turn.${turn.turnKey}.message.${match.messageKey}.text`,
  );
}

/**
 * @deprecated Use `committedTurnValue(store, kind)`. Retained for
 * source compatibility with tests written before the index parameter
 * was introduced.
 */
export const lastCommittedTurnValue = committedTurnValue;
