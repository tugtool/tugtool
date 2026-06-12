/**
 * Wire types for the PULSE facility — the fact frames producers emit
 * and the line frames the commentator daemon answers with.
 *
 * The envelope is deliberately tiny: `fact` is one plain-language
 * sentence written by the producer; everything else exists for
 * routing, filtering, and weighting. The daemon consumes facts only —
 * never raw transcripts or any route's native protocol.
 *
 * @module pulse/types
 */

/** Open vocabulary of fact kinds; starts small, producers may extend. */
export type PulseFactKind = "turn" | "tool" | "task" | "job" | "error" | "note";

/** A producer-written fact: one sentence + routing envelope. */
export interface PulseFact {
  type: "pulse_fact";
  /** Producing route, open vocabulary: "claude-code", "shell", … */
  source: string;
  /** The work scope the fact belongs to: a tug session id, or "app". */
  scope: string;
  kind: PulseFactKind | (string & {});
  /** One plain-language sentence with specifics. */
  fact: string;
  /** Producer wall-clock ms. */
  at: number;
}

/** One commentator line, broadcast on the PULSE feed and ledgered. */
export interface PulseLine {
  type: "pulse";
  /** The single-line commentary text (≤ ~110 chars, clipped defensively). */
  text: string;
  /** Scopes the source beat covered (full ids, for later filtering). */
  scopes: string[];
  /** Monotonic beat counter within the daemon's lifetime. */
  beat: number;
  /** Daemon wall-clock ms at emission. */
  at: number;
}

/** Runtime guard for inbound fact lines (stdin is an untrusted pipe). */
export function isPulseFact(value: unknown): value is PulseFact {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === "pulse_fact" &&
    typeof v.source === "string" &&
    typeof v.scope === "string" &&
    typeof v.kind === "string" &&
    typeof v.fact === "string" &&
    v.fact.length > 0 &&
    typeof v.at === "number"
  );
}
