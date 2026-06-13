/**
 * Wire types for the PULSE facility — the line frames the commentator
 * daemon answers with. (The daemon's INPUT is spliced tugcode
 * outbound frames, typed by `../types`; see `pulse/intake.ts`.)
 *
 * @module pulse/types
 */

/** One commentator line, broadcast on the PULSE feed and ledgered. */
export interface PulseLine {
  type: "pulse";
  /** The single-line commentary text (≤ ~110 chars, clipped defensively). */
  text: string;
  /** Scopes the source beat covered — always one session id in the
   *  per-scope beat design; an array on the wire for compatibility. */
  scopes: string[];
  /** Monotonic beat counter within the daemon's lifetime. */
  beat: number;
  /** Daemon wall-clock ms at emission. */
  at: number;
}
