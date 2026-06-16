// tugcode/src/__tests__/turn-corpus-contract.test.ts
//
// Contract test ([P01] authority, [P07] no client recompute, Spec S01,
// Risk R01/R07): tugcode's segmenter is the canonical turn authority, so
// the `totalTurns` it reports must equal the hand-verified expected count in
// the shared golden corpus for every fixture — the SAME numbers the tugcast
// Rust scanner contract test asserts. The corpus lives on the tugcast side
// (tugrust/.../tests/fixtures/turns/); both languages read one manifest so
// the rule can never silently diverge between them.
//
// Each fixture is replayed with a load-all window so `replay_complete`
// carries `totalTurns` — the authority value, which must equal the manifest
// (the same numbers the Rust scanner asserts).
//
// Note `totalTurns` is NOT the count of `turn_complete` frames: a wake turn
// commits as `wake_started`, and a turn left open at the EOF edge (an
// interrupted final turn) is counted by the boundary locator but emits no
// terminal. The faithful intra-tugcode lockstep is therefore
// `totalTurns == openers`, where openers are the `add_user_message` +
// `wake_started` frames the emit path produced — one per opened turn. If the
// dry-run boundary locator (`computeTurnStartIndices`) and the emit path
// drifted, this equality would break.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { translateJsonlSession } from "../replay.ts";
import type { OutboundMessage, ReplayComplete } from "../types.ts";

const FIXTURES_DIR = join(
  import.meta.dir,
  "../../../tugrust/crates/tugcast/tests/fixtures/turns",
);

interface FixtureSpec {
  file: string;
  expected_turns: number;
  notes?: string;
}

const manifest = JSON.parse(
  readFileSync(join(FIXTURES_DIR, "manifest.json"), "utf8"),
) as { fixtures: FixtureSpec[] };

async function replayLoadAll(jsonl: string): Promise<OutboundMessage[]> {
  const out: OutboundMessage[] = [];
  for await (const msg of translateJsonlSession(
    { kind: "ok", jsonl },
    // Load-all window: emits every committed turn and reports totalTurns.
    { disableYield: true, window: { lastTurns: Number.MAX_SAFE_INTEGER } },
  )) {
    out.push(msg);
  }
  return out;
}

describe("turn-corpus contract — tugcode totalTurns matches the golden corpus", () => {
  for (const fx of manifest.fixtures) {
    test(`${fx.file}: totalTurns == ${fx.expected_turns}`, async () => {
      const jsonl = readFileSync(join(FIXTURES_DIR, fx.file), "utf8");
      const out = await replayLoadAll(jsonl);

      const complete = out.find(
        (m): m is ReplayComplete => m.type === "replay_complete",
      );
      expect(complete).toBeDefined();
      expect(complete!.error).toBeUndefined();

      // The authority value — equals the manifest (and the Rust scanner).
      expect(complete!.totalTurns).toBe(fx.expected_turns);

      // Intra-tugcode lockstep: the emit path opened exactly as many turns
      // (one opener frame each) as the dry-run boundary count claims. A wake
      // opener is an `add_user_message`? No — it is a `wake_started`; a
      // genuine submission is an `add_user_message`. Their sum is the opener
      // count, which must equal totalTurns.
      const openers = out.filter(
        (m) => m.type === "add_user_message" || m.type === "wake_started",
      ).length;
      expect(openers).toBe(fx.expected_turns);
    });
  }
});

describe("lastTurns window — selects the most recent N turns", () => {
  async function replay(
    jsonl: string,
    window: { lastTurns: number },
  ): Promise<OutboundMessage[]> {
    const out: OutboundMessage[] = [];
    for await (const msg of translateJsonlSession(
      { kind: "ok", jsonl },
      { disableYield: true, window },
    )) {
      out.push(msg);
    }
    return out;
  }

  test("lastTurns: 5 over the 22-turn fixture loads the trailing 5", async () => {
    const jsonl = readFileSync(join(FIXTURES_DIR, "windowed.jsonl"), "utf8");
    const out = await replay(jsonl, { lastTurns: 5 });
    const complete = out.find(
      (m): m is ReplayComplete => m.type === "replay_complete",
    );
    expect(complete).toBeDefined();
    // totalTurns is the whole-session count (the authority), unchanged by
    // the window; firstLoadedTurnIndex is the clamped start (22 - 5).
    expect(complete!.totalTurns).toBe(22);
    expect(complete!.firstLoadedTurnIndex).toBe(17);
    expect(complete!.hasOlder).toBe(true);
    // Exactly the windowed turns emit an opener.
    const openers = out.filter(
      (m) => m.type === "add_user_message" || m.type === "wake_started",
    ).length;
    expect(openers).toBe(5);
  });

  test("lastTurns ≥ totalTurns loads the whole session (no older)", async () => {
    const jsonl = readFileSync(join(FIXTURES_DIR, "windowed.jsonl"), "utf8");
    const out = await replay(jsonl, { lastTurns: 1000 });
    const complete = out.find(
      (m): m is ReplayComplete => m.type === "replay_complete",
    );
    expect(complete!.totalTurns).toBe(22);
    expect(complete!.firstLoadedTurnIndex).toBe(0);
    expect(complete!.hasOlder).toBe(false);
  });
});
