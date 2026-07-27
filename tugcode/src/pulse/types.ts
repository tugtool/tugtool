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
  /**
   * The retained high-level thought behind a low-level `text` beat —
   * the assistant's last substantive monologue line, carried while a
   * tool chain runs so the deck can render "intent • action". Absent
   * when `text` is itself the monologue or a turn-boundary marker.
   */
  intent?: string;
  /**
   * What kind of line this is. **tugpulse never sets it** — every line this
   * daemon emits is a beat, and absent means beat. The field is declared here
   * because this type is the PULSE wire contract, and tugcast also publishes
   * `kind: "overview"` frames on the same feed (the local model's standing
   * answer to what a session is working on). A parser that ignores the field
   * simply sees every line as a beat, which is why it is optional.
   */
  kind?: "overview";
  /** Scopes the source beat covered — always one session id in the
   *  per-scope beat design; an array on the wire for compatibility. */
  scopes: string[];
  /** Monotonic beat counter within the daemon's lifetime. */
  beat: number;
  /** Daemon wall-clock ms at emission. */
  at: number;
}
