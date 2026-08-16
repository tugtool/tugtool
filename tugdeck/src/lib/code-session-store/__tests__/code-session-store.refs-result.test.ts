/**
 * CodeSessionStore — refs-run transcript ingest.
 *
 * `ingestRefs` mints a `refs`-origin turn on the run's first frame and
 * replaces it in place (same `turnKey`) as rows stream, so a run that emits
 * ten batches still owns exactly one row. Refs turns are the second ink
 * origin: disjoint from the Claude turn machinery, landing directly in the
 * committed transcript, ordered by timestamp.
 *
 * Pure-logic integration over the real store + reducer — no DOM.
 */
import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import { appendTurnInterleavingInk } from "@/lib/code-session-store/reducer";
import { isInkOrigin } from "@/lib/code-session-store/types";
import type {
  RefsResultMessage,
  TextRef,
  TurnEntry,
} from "@/lib/code-session-store/types";
import { countClaudeTurns } from "@/components/tugways/cards/session-load-control-bar-state";

function makeStore(): CodeSessionStore {
  return new CodeSessionStore({
    conn: new TestFrameChannel() as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    sessionMode: "new",
  });
}

function refsTurns(store: CodeSessionStore): TurnEntry[] {
  return store.getSnapshot().transcript.filter((t) => t.origin === "refs");
}

function refsMsg(turn: TurnEntry): RefsResultMessage {
  const m = turn.messages[0];
  if (m.kind !== "refs_result") throw new Error("not a refs result");
  return m;
}

function ref(index: number, path: string): TextRef {
  return { index, path, line: index, columns: [[0, 3]], preview: "foo bar" };
}

function publish(
  store: CodeSessionStore,
  refs: ReadonlyArray<TextRef>,
  opts?: { inFlight?: boolean; cancelled?: boolean; runId?: string },
): void {
  store.ingestRefs({
    runId: opts?.runId ?? "r1",
    opKind: "search",
    command: "/search foo",
    root: "/proj",
    refs,
    inFlight: opts?.inFlight ?? true,
    cancelled: opts?.cancelled ?? false,
    notice: null,
    startedAtMs: 1000,
    settledAtMs: opts?.inFlight === false ? 1200 : null,
  });
}

describe("ingestRefs — one row per run, replaced in place as it streams", () => {
  it("a run's frames build exactly one refs turn", () => {
    const store = makeStore();
    publish(store, []);
    publish(store, [ref(1, "a.ts")]);
    publish(store, [ref(1, "a.ts"), ref(2, "b.ts")]);
    publish(store, [ref(1, "a.ts"), ref(2, "b.ts")], { inFlight: false });

    const turns = refsTurns(store);
    expect(turns.length).toBe(1);
    expect(turns[0].turnKey).toBe("refs-r1");
    const m = refsMsg(turns[0]);
    expect(m.refs.length).toBe(2);
    expect(m.inFlight).toBe(false);
    expect(m.settledAtMs).toBe(1200);
  });

  it("the row keeps its mount identity across every streaming update", () => {
    const store = makeStore();
    publish(store, []);
    const firstKey = refsTurns(store)[0].turnKey;
    publish(store, [ref(1, "a.ts")]);
    publish(store, [ref(1, "a.ts"), ref(2, "b.ts")]);
    expect(refsTurns(store).map((t) => t.turnKey)).toEqual([firstKey]);
  });

  it("a cancelled run settles as interrupted, keeping what it found", () => {
    const store = makeStore();
    publish(store, [ref(1, "a.ts")]);
    publish(store, [ref(1, "a.ts")], { inFlight: false, cancelled: true });

    const turn = refsTurns(store)[0];
    expect(turn.turnEndReason).toBe("interrupted");
    expect(turn.result).toBe("interrupted");
    expect(refsMsg(turn).refs.length).toBe(1);
  });

  it("a second run is its own row, leaving the first standing", () => {
    const store = makeStore();
    publish(store, [ref(1, "a.ts")], { inFlight: false });
    publish(store, [ref(1, "c.ts")], { inFlight: false, runId: "r2" });
    expect(refsTurns(store).map((t) => t.turnKey)).toEqual(["refs-r1", "refs-r2"]);
  });

  it("carries the run's root, so the view can absolutize its relative paths", () => {
    const store = makeStore();
    publish(store, [ref(1, "src/a.ts")], { inFlight: false });
    const m = refsMsg(refsTurns(store)[0]);
    expect(m.root).toBe("/proj");
    expect(m.refs[0].path).toBe("src/a.ts");
  });
});

describe("ink origins — refs joins shell", () => {
  function turn(origin: "shell" | "refs" | "user", ts: number): TurnEntry {
    return {
      turnKey: `${origin}-${ts}`,
      msgId: `${origin}-${ts}`,
      origin,
      messages: [
        {
          kind: "system_note",
          messageKey: `${origin}-${ts}-m`,
          createdAt: ts,
          text: "",
          source: "other",
        },
      ],
      result: "success",
      endedAt: ts,
      wallClockMs: 0,
      awaitingApprovalMs: 0,
      transportDowntimeMs: 0,
      activeMs: 0,
      ttftMs: null,
      ttftcMs: null,
      reconnectCount: 0,
      maxStreamGapMs: 0,
      turnEndReason: "complete",
      cost: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalCostUsd: 0,
      },
    } as TurnEntry;
  }

  it("isInkOrigin covers both non-context origins and no others", () => {
    expect(isInkOrigin("shell")).toBe(true);
    expect(isInkOrigin("refs")).toBe(true);
    expect(isInkOrigin("user")).toBe(false);
    expect(isInkOrigin("assistant")).toBe(false);
  });

  it("a replayed Claude turn slides left past trailing refs rows", () => {
    // The reload race: `list_refs` restores a refs row before the JSONL
    // replay lands the Claude turn it chronologically follows.
    const restoredRefs = turn("refs", 5000);
    const replayed = turn("user", 1000);
    const out = appendTurnInterleavingInk([restoredRefs], replayed);
    expect(out.map((t) => t.turnKey)).toEqual(["user-1000", "refs-5000"]);
  });

  it("a Claude turn newer than the trailing ink rows still appends", () => {
    const out = appendTurnInterleavingInk(
      [turn("shell", 1000), turn("refs", 2000)],
      turn("user", 3000),
    );
    expect(out.map((t) => t.turnKey)).toEqual([
      "shell-1000",
      "refs-2000",
      "user-3000",
    ]);
  });

  it("the loaded-turn count excludes refs rows as well as shell rows", () => {
    // Counting ink rows is what makes the metadata row read "83 of 68".
    const transcript = [
      { origin: "user" },
      { origin: "shell" },
      { origin: "refs" },
      { origin: "assistant" },
    ];
    expect(countClaudeTurns(transcript)).toBe(2);
  });
});
