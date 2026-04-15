/**
 * Effect discriminated union per Spec S07.
 *
 * The reducer in `reducer.ts` is a pure `(state, event) => { state, effects }`
 * function; the class wrapper in `code-session-store.ts` processes the
 * returned `effects[]` in order after each dispatch. Keeping effects
 * first-class makes every side effect grep-able and testable without a
 * live store.
 *
 * [D11] effect-list reducer
 */

import type { InboundMessage } from "@/protocol";
import type { TurnEntry } from "./types";

/** Stable path keys for the in-flight streaming document (Spec S05). */
export type InflightPath =
  | "inflight.assistant"
  | "inflight.thinking"
  | "inflight.tools";

export interface WriteInflightEffect {
  kind: "write-inflight";
  path: InflightPath;
  value: string;
}

export interface ClearInflightEffect {
  kind: "clear-inflight";
}

export interface SendFrameEffect {
  kind: "send-frame";
  msg: InboundMessage;
}

export interface AppendTranscriptEffect {
  kind: "append-transcript";
  entry: TurnEntry;
}

export type Effect =
  | WriteInflightEffect
  | ClearInflightEffect
  | SendFrameEffect
  | AppendTranscriptEffect;

export function isWriteInflight(e: Effect): e is WriteInflightEffect {
  return e.kind === "write-inflight";
}

export function isClearInflight(e: Effect): e is ClearInflightEffect {
  return e.kind === "clear-inflight";
}

export function isSendFrame(e: Effect): e is SendFrameEffect {
  return e.kind === "send-frame";
}

export function isAppendTranscript(e: Effect): e is AppendTranscriptEffect {
  return e.kind === "append-transcript";
}
