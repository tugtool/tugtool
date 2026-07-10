/**
 * CodeSessionStore — shell-exchange transcript ingest ([P06]/[P12], Spec S04).
 *
 * `ingestShellExchange` mints an in-flight `shell`-origin turn on `started` and
 * settles it IN PLACE on `complete` (same `turnKey`), or mints-whole for a bare
 * complete (restore). Shell turns are disjoint from the Claude turn machinery —
 * they land directly in the committed transcript, ordered by timestamp.
 *
 * Pure-logic integration over the real store + reducer — no DOM.
 */
import { describe, it, expect } from "bun:test";

import { CodeSessionStore } from "@/lib/code-session-store";
import type { TugConnection } from "@/connection";
import { ConnectionLifecycle } from "@/lib/connection-lifecycle";
import { TestFrameChannel } from "@/lib/code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "@/lib/code-session-store/testing/golden-catalog";
import {
  appendTurnInterleavingShell,
  upsertShellTurn,
} from "@/lib/code-session-store/reducer";
import type {
  ShellExchangeMessage,
  TurnEntry,
} from "@/lib/code-session-store/types";

function makeStore(): CodeSessionStore {
  return new CodeSessionStore({
    conn: new TestFrameChannel() as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    sessionMode: "new",
  });
}

function shellTurns(store: CodeSessionStore): TurnEntry[] {
  return store.getSnapshot().transcript.filter((t) => t.origin === "shell");
}

function shellMsg(turn: TurnEntry): ShellExchangeMessage {
  const m = turn.messages[0];
  if (m.kind !== "shell_exchange") throw new Error("not a shell exchange");
  return m;
}

describe("ingestShellExchange — mint on started, settle in place on complete", () => {
  it("started mints an in-flight shell turn (exitCode null, no output)", () => {
    const store = makeStore();
    store.ingestShellExchange({
      phase: "started",
      exchangeId: "e1",
      command: "ls",
      cwd: "/proj",
      startedAtMs: 1000,
    });
    const turns = shellTurns(store);
    expect(turns.length).toBe(1);
    expect(turns[0].origin).toBe("shell");
    const m = shellMsg(turns[0]);
    expect(m.command).toBe("ls");
    expect(m.exitCode).toBeNull();
    expect(m.output).toBe("");
  });

  it("complete settles the same turn in place — same turnKey, output + exit code", () => {
    const store = makeStore();
    store.ingestShellExchange({
      phase: "started",
      exchangeId: "e1",
      command: "ls",
      cwd: "/proj",
      startedAtMs: 1000,
    });
    const keyBefore = shellTurns(store)[0].turnKey;
    store.ingestShellExchange({
      phase: "complete",
      exchangeId: "e1",
      command: "ls",
      output: "file-a\nfile-b\n",
      exitCode: 0,
      cwd: "/proj",
      cwdAfter: "/proj",
      startedAtMs: 1000,
      settledAtMs: 1012,
    });
    const turns = shellTurns(store);
    // Settled IN PLACE — one turn, same key (row keeps mount identity).
    expect(turns.length).toBe(1);
    expect(turns[0].turnKey).toBe(keyBefore);
    const m = shellMsg(turns[0]);
    expect(m.exitCode).toBe(0);
    expect(m.output).toContain("file-a");
  });

  it("a killed exchange settles with exitCode null", () => {
    const store = makeStore();
    store.ingestShellExchange({ phase: "started", exchangeId: "e1", command: "sleep 60", cwd: "/p", startedAtMs: 1 });
    store.ingestShellExchange({
      phase: "complete",
      exchangeId: "e1",
      command: "sleep 60",
      output: "",
      exitCode: null,
      cwd: "/p",
      cwdAfter: null,
      startedAtMs: 1,
      settledAtMs: 5,
    });
    expect(shellMsg(shellTurns(store)[0]).exitCode).toBeNull();
  });

  it("turnEndReason tracks the exit: 0 → complete, non-zero → error, kill → interrupted", () => {
    const store = makeStore();
    const settle = (id: string, exitCode: number | null) =>
      store.ingestShellExchange({
        phase: "complete",
        exchangeId: id,
        command: "cmd",
        output: "",
        exitCode,
        cwd: "/p",
        cwdAfter: "/p",
        startedAtMs: 100,
        settledAtMs: 110,
      });
    settle("ok", 0);
    settle("fail", 1);
    settle("killed", null);
    const byKey = (k: string) =>
      shellTurns(store).find((t) => t.turnKey === `shell-${k}`)!;
    expect(byKey("ok").turnEndReason).toBe("complete");
    expect(byKey("ok").result).toBe("success");
    expect(byKey("fail").turnEndReason).toBe("error");
    // A non-zero exit still ran to completion — coarse `result` stays success.
    expect(byKey("fail").result).toBe("success");
    expect(byKey("killed").turnEndReason).toBe("interrupted");
    expect(byKey("killed").result).toBe("interrupted");
  });

  it("an in-flight (unsettled) shell turn is `complete` until it settles", () => {
    const store = makeStore();
    store.ingestShellExchange({
      phase: "started",
      exchangeId: "e1",
      command: "ls",
      cwd: "/proj",
      startedAtMs: 1000,
    });
    // No exit yet — the Z1B is gated on `settledAtMs`, so the reason here is
    // the neutral placeholder, never a premature error/interrupt.
    expect(shellTurns(store)[0].turnEndReason).toBe("complete");
  });

  it("a bare complete with no prior started mints-and-settles whole (restore path)", () => {
    const store = makeStore();
    store.ingestShellExchange({
      phase: "complete",
      exchangeId: "restored-1",
      command: "git status",
      output: "clean\n",
      exitCode: 0,
      cwd: "/proj",
      cwdAfter: "/proj",
      startedAtMs: 500,
      settledAtMs: 520,
    });
    const turns = shellTurns(store);
    expect(turns.length).toBe(1);
    const m = shellMsg(turns[0]);
    expect(m.command).toBe("git status");
    expect(m.exitCode).toBe(0);
    expect(m.output).toContain("clean");
  });
});

describe("upsertShellTurn — timestamp interleave + settle-in-place", () => {
  function mkTurn(key: string, ts: number, origin: "shell" | "user" = "shell"): TurnEntry {
    return {
      turnKey: key,
      msgId: key,
      origin,
      messages: [
        {
          kind: "shell_exchange",
          messageKey: key,
          createdAt: ts,
          exchangeId: key,
          command: key,
          output: "",
          exitCode: null,
          cwd: "/p",
          cwdAfter: null,
          startedAtMs: ts,
          settledAtMs: null,
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
    };
  }

  it("inserts a new turn at its timestamp position (between existing turns)", () => {
    const a = mkTurn("a", 100);
    const c = mkTurn("c", 300);
    const b = mkTurn("b", 200);
    const out = upsertShellTurn([a, c], b);
    expect(out.map((t) => t.turnKey)).toEqual(["a", "b", "c"]);
  });

  it("a tie inserts AFTER existing turns (live append)", () => {
    const a = mkTurn("a", 100);
    const b = mkTurn("b", 100);
    const out = upsertShellTurn([a], b);
    expect(out.map((t) => t.turnKey)).toEqual(["a", "b"]);
  });

  it("replaces a same-turnKey turn in place (settle), preserving position", () => {
    const a = mkTurn("a", 100);
    const b = mkTurn("b", 200);
    const c = mkTurn("c", 300);
    const bSettled = mkTurn("b", 200);
    (bSettled.messages[0] as ShellExchangeMessage).exitCode = 0;
    const out = upsertShellTurn([a, b, c], bSettled);
    expect(out.map((t) => t.turnKey)).toEqual(["a", "b", "c"]);
    expect((out[1].messages[0] as ShellExchangeMessage).exitCode).toBe(0);
  });

  it("is idempotent — re-upserting the same settled turn does not duplicate", () => {
    const a = mkTurn("a", 100);
    const out1 = upsertShellTurn([], a);
    const out2 = upsertShellTurn(out1, a);
    expect(out2.length).toBe(1);
  });

  // Appending a Claude turn keeps it interleaved with shell turns the ledger
  // restore ([P07]) seated ahead of it. The real-corpus finding is that JSONL
  // arrival order — NOT timestamp — is the source of truth for the Claude
  // stream (39% of real sessions are non-monotonic in timestamp), so this
  // helper never reorders two non-shell turns; it only slides the appended
  // turn past a run of trailing *shell* turns with a greater timestamp.
  describe("appendTurnInterleavingShell — Claude append vs restored shell rows", () => {
    it("the reload race: shells restored first, a Claude turn replays behind them", () => {
      // Ledger restore seated three shell rows (later ts) into an empty
      // transcript; the JSONL replay's Claude turn (earlier ts) then appends.
      const s1 = mkTurn("s1", 200);
      const s2 = mkTurn("s2", 300);
      const claude = mkTurn("claude", 100, "user");
      const out = appendTurnInterleavingShell([s1, s2], claude);
      expect(out.map((t) => t.turnKey)).toEqual(["claude", "s1", "s2"]);
    });

    it("slots between shell rows it happened among", () => {
      const s1 = mkTurn("s1", 100);
      const s2 = mkTurn("s2", 300);
      const claude = mkTurn("claude", 200, "user");
      const out = appendTurnInterleavingShell([s1, s2], claude);
      expect(out.map((t) => t.turnKey)).toEqual(["s1", "claude", "s2"]);
    });

    it("never reorders two non-shell turns — the walk stops at the first non-shell tail entry", () => {
      // Even with an out-of-order timestamp, an existing Claude turn is never
      // passed: append order is truth for the Claude stream.
      const c1 = mkTurn("c1", 500, "user");
      const s1 = mkTurn("s1", 300);
      const c2 = mkTurn("c2", 100, "user");
      const out = appendTurnInterleavingShell([c1, s1], c2);
      // c2 slides past the trailing shell (300 > 100) but stops at c1.
      expect(out.map((t) => t.turnKey)).toEqual(["c1", "c2", "s1"]);
    });

    it("a live Claude turn (newest ts, no trailing shells) is a plain append", () => {
      const c1 = mkTurn("c1", 100, "user");
      const c2 = mkTurn("c2", 200, "user");
      const out = appendTurnInterleavingShell([c1], c2);
      expect(out.map((t) => t.turnKey)).toEqual(["c1", "c2"]);
    });

    it("a tie against a trailing shell stays after it (append-on-equal)", () => {
      const s1 = mkTurn("s1", 100);
      const claude = mkTurn("claude", 100, "user");
      const out = appendTurnInterleavingShell([s1], claude);
      expect(out.map((t) => t.turnKey)).toEqual(["s1", "claude"]);
    });
  });
});
