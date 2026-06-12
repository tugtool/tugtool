/**
 * tugpulse — the PULSE commentator daemon.
 *
 * Stdio contract with tugcast (which spawns and supervises this
 * process app-scoped):
 *
 *   stdin   `pulse_fact` JSON lines from all producers
 *   stdout  `pulse` JSON lines (one per spoken beat; PASS emits nothing)
 *   stderr  diagnostics
 *
 * Flags:
 *   --seed '<json string array>'   prior ledger-tail lines, oldest
 *                                  first — restores narrative memory
 *                                  across daemon restarts
 *   --claude-path <path>           override the claude binary (tests
 *                                  point this at a fake child; also
 *                                  honored via TUGPULSE_CLAUDE_PATH)
 *
 * The beat discipline lives in {@link BeatScheduler} (pure logic); the
 * claude session in {@link HaikuDriver}. This file is only the wiring:
 * stdin facts → scheduler → digest → driver → shaped line → stdout.
 *
 * One-way isolation invariant: nothing read here ever flows toward a
 * work session — the only outputs are stdout pulse lines and stderr
 * diagnostics.
 *
 * @module pulse/main-pulse
 */

import { BeatScheduler, BEAT_DEFAULTS } from "./scheduler";
import { buildDigest, beatScopes } from "./digest";
import { HaikuDriver } from "./driver";
import { shapeLine } from "./line-shape";
import { isPulseFact, type PulseLine } from "./types";

const POLL_MS = 50;

/** Optional env override for one scheduler timing (tests tighten these). */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const TIMINGS = {
  coalesceMs: envMs("TUGPULSE_COALESCE_MS", BEAT_DEFAULTS.coalesceMs),
  minIntervalMs: envMs("TUGPULSE_MIN_INTERVAL_MS", BEAT_DEFAULTS.minIntervalMs),
  staleMs: envMs("TUGPULSE_STALE_MS", BEAT_DEFAULTS.staleMs),
};

/** Ask timeout: past the stale window the reply is unusable anyway. */
const ASK_TIMEOUT_MS = TIMINGS.staleMs + 2_000;

function parseArgs(argv: string[]): { seedLines: string[]; claudePath: string | undefined } {
  let seedLines: string[] = [];
  let claudePath = process.env.TUGPULSE_CLAUDE_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seed" && argv[i + 1] !== undefined) {
      try {
        const parsed: unknown = JSON.parse(argv[++i]);
        if (Array.isArray(parsed)) {
          seedLines = parsed.filter((l): l is string => typeof l === "string");
        }
      } catch {
        console.error("[tugpulse] ignoring unparseable --seed payload");
      }
    } else if (argv[i] === "--claude-path" && argv[i + 1] !== undefined) {
      claudePath = argv[++i];
    }
  }
  return { seedLines, claudePath };
}

async function main(): Promise<void> {
  const { seedLines, claudePath } = parseArgs(process.argv.slice(2));
  const scheduler = new BeatScheduler(TIMINGS);
  const driver = new HaikuDriver({ claudePath, seedLines });

  let emittedBeats = 0;
  let askInFlight = false;

  const shutdown = (code: number): void => {
    clearInterval(pollTimer);
    driver.shutdown();
    process.exit(code);
  };
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(130));

  await driver.start();
  console.error("[tugpulse] commentator session up");

  // --- stdin: fact intake -------------------------------------------------
  void (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of Bun.stdin.stream()) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.trim().length === 0) continue;
        try {
          const parsed: unknown = JSON.parse(line);
          if (isPulseFact(parsed)) {
            scheduler.addFact(parsed, Date.now());
          }
        } catch {
          console.error(`[tugpulse] unparseable fact line: ${line.slice(0, 80)}`);
        }
      }
    }
    // Producer side closed — tugcast is going away. Drain and exit.
    console.error("[tugpulse] stdin closed; shutting down");
    shutdown(0);
  })();

  // --- beat loop ----------------------------------------------------------
  const pollTimer = setInterval(() => {
    if (askInFlight) return; // driver serialization mirrors the scheduler's
    const beat = scheduler.takeBeat(Date.now());
    if (beat === null) return;
    askInFlight = true;
    const digest = buildDigest(beat.id, beat.facts);
    void driver
      .ask(digest, ASK_TIMEOUT_MS)
      .then(async (raw) => {
        const { emit } = scheduler.resolveBeat(beat.id, Date.now());
        const text = shapeLine(raw);
        // One diagnostic line per beat (beats are seconds apart) — the
        // only way an operator can tell PASS from timeout from drop.
        console.error(
          `[tugpulse] beat ${beat.id}: ${
            raw === null ? "no reply (timeout)" : text === null ? "PASS" : `line ${text.length}ch`
          }${emit ? "" : " (dropped: stale)"} — ${beat.facts.length} fact(s)`,
        );
        if (emit && text !== null) {
          emittedBeats++;
          const line: PulseLine = {
            type: "pulse",
            text,
            scopes: beatScopes(beat.facts),
            beat: emittedBeats,
            at: Date.now(),
          };
          process.stdout.write(`${JSON.stringify(line)}\n`);
          driver.noteEmitted(text);
        }
        await driver.maybeRestart();
      })
      .finally(() => {
        askInFlight = false;
      });
  }, POLL_MS);
}

void main();
