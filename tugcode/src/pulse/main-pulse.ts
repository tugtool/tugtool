/**
 * tugpulse — the PULSE voice daemon.
 *
 * Stdio contract with tugcast (which spawns and supervises this
 * process app-scoped):
 *
 *   stdin   spliced CODE_OUTPUT lines — tugcode outbound frames with
 *           `tug_session_id` spliced in, pre-filtered to the pulse
 *           allowlist by tugcast's bridge tap
 *   stdout  `pulse` JSON lines (monologue updates, per scope)
 *   stderr  diagnostics
 *
 * Flags:
 *   --seed '<json string array>'   accepted for spawn-contract
 *                                  compatibility; the voice keeps no
 *                                  narrative memory, so it is ignored
 *
 * The line logic lives in {@link PulseVoice} (pure rules, explicit
 * clocks): the strip is the machine thinking out loud — its latest
 * settled thought, verbatim from the wire's `assistant_text` frames,
 * `done`/`stopped` at turn boundaries, cleared deck-side when the
 * user submits. In the machine's own words: nothing to fabricate, no
 * second model (that history lives in the spike README).
 *
 * One-way isolation invariant: nothing read here ever flows toward a
 * work session — the only outputs are stdout pulse lines and stderr
 * diagnostics.
 *
 * @module pulse/main-pulse
 */

import { PulseVoice, parseWireLine, type VoiceLine } from "./voice";
import type { PulseLine } from "./types";

/** Monologue flush cadence (change-driven; throttle in the voice). */
const FLUSH_MS = 500;
/** Inactive-scope sweep cadence, in flush ticks (~30s). */
const SWEEP_EVERY_FLUSHES = 60;

function main(): void {
  const voice = new PulseVoice();
  let emitted = 0;
  let flushCount = 0;

  const writeLine = (line: VoiceLine): void => {
    emitted++;
    const pulse: PulseLine = {
      type: "pulse",
      text: line.text,
      ...(line.intent !== undefined ? { intent: line.intent } : {}),
      scopes: [line.scope],
      beat: emitted,
      at: Date.now(),
    };
    process.stdout.write(`${JSON.stringify(pulse)}\n`);
  };

  const shutdown = (code: number): void => {
    clearInterval(flushTimer);
    process.exit(code);
  };
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(130));

  console.error("[tugpulse] voice up");

  // --- stdin: spliced wire-frame intake ------------------------------------
  void (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of Bun.stdin.stream()) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (raw.trim().length === 0) continue;
        const parsed = parseWireLine(raw);
        if (parsed === null) {
          console.error(`[tugpulse] unparseable frame line: ${raw.slice(0, 80)}`);
          continue;
        }
        const line = voice.onFrame(parsed.scope, parsed.frame, Date.now());
        if (line !== null) writeLine(line);
      }
    }
    // Producer side closed — tugcast is going away.
    console.error("[tugpulse] stdin closed; shutting down");
    shutdown(0);
  })();

  // --- monologue flush ------------------------------------------------------
  const flushTimer = setInterval(() => {
    if (++flushCount % SWEEP_EVERY_FLUSHES === 0) {
      voice.sweepInactive(Date.now());
    }
    for (const line of voice.flush(Date.now())) {
      writeLine(line);
    }
  }, FLUSH_MS);
}

main();
