/**
 * ShellSessionStore — folds SHELL_OUTPUT into session state and mirrors each
 * exchange into CodeSessionStore ([P12]). Drives the real store's fold + the
 * real CodeSessionStore reducer via a minimal feed double (the sibling
 * side-question-store test's pattern) — no DOM, no mock-store assertions.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

// Capture SHELL_INPUT frames `exec`/`kill` send. Mocked before importing the store.
let sentFrames: Array<{ feedId: number; payload: string }> = [];
mock.module("../connection-singleton", () => ({
  getConnection: () => ({
    send: (feedId: number, payload: Uint8Array) => {
      sentFrames.push({ feedId, payload: new TextDecoder().decode(payload) });
    },
    onFrame: () => () => {},
  }),
}));

import { FeedId } from "../../protocol";
import { ShellSessionStore, applyRestoredShellExchanges } from "../shell-session-store";
import { CodeSessionStore } from "../code-session-store";
import type { TugConnection } from "../../connection";
import { ConnectionLifecycle } from "../connection-lifecycle";
import { TestFrameChannel } from "../code-session-store/testing/mock-feed-store";
import { FIXTURE_IDS } from "../code-session-store/testing/golden-catalog";
import type { ShellExchangeMessage } from "../code-session-store/types";

class MockFeedStore {
  private _data = new Map<number, unknown>();
  private _listeners: Array<() => void> = [];
  subscribe(listener: () => void): () => void {
    this._listeners.push(listener);
    return () => {
      const i = this._listeners.indexOf(listener);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }
  getSnapshot(): Map<number, unknown> {
    return this._data;
  }
  emit(feedId: number, payload: unknown): void {
    const next = new Map(this._data);
    next.set(feedId, payload);
    this._data = next;
    for (const l of this._listeners) l();
  }
}

function setup() {
  const code = new CodeSessionStore({
    conn: new TestFrameChannel() as unknown as TugConnection,
    lifecycle: new ConnectionLifecycle(),
    tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
    sessionMode: "new",
  });
  const feed = new MockFeedStore();
  const store = new ShellSessionStore(
    feed as unknown as ConstructorParameters<typeof ShellSessionStore>[0],
    FeedId.SHELL_OUTPUT,
    "sess-1",
    "/proj",
    code,
  );
  return { store, feed, code };
}

function shellTurns(code: CodeSessionStore) {
  return code.getSnapshot().transcript.filter((t) => t.origin === "shell");
}

beforeEach(() => {
  sentFrames = [];
});

describe("ShellSessionStore — fold + mirror", () => {
  test("seeds cwd to the project dir before any frame", () => {
    const { store } = setup();
    expect(store.getSnapshot().cwd).toBe("/proj");
    expect(store.getSnapshot().live).toBe(false);
  });

  test("shell_state updates live + cwd", () => {
    const { store, feed } = setup();
    feed.emit(FeedId.SHELL_OUTPUT, { type: "shell_state", live: true, cwd: "/tmp" });
    expect(store.getSnapshot().live).toBe(true);
    expect(store.getSnapshot().cwd).toBe("/tmp");
  });

  test("exchange_started mints an in-flight shell turn in the transcript", () => {
    const { feed, code } = setup();
    feed.emit(FeedId.SHELL_OUTPUT, {
      type: "exchange_started",
      exchange_id: "e1",
      command: "ls",
      cwd: "/proj",
      started_at: 1000,
    });
    const turns = shellTurns(code);
    expect(turns.length).toBe(1);
    const m = turns[0].messages[0] as ShellExchangeMessage;
    expect(m.command).toBe("ls");
    expect(m.exitCode).toBeNull();
  });

  test("exchange_complete settles the turn and updates cwd", () => {
    const { store, feed, code } = setup();
    feed.emit(FeedId.SHELL_OUTPUT, {
      type: "exchange_started",
      exchange_id: "e1",
      command: "cd /tmp",
      cwd: "/proj",
      started_at: 1000,
    });
    feed.emit(FeedId.SHELL_OUTPUT, {
      type: "exchange_complete",
      exchange_id: "e1",
      command: "cd /tmp",
      output: "",
      exit_code: 0,
      cwd: "/proj",
      cwd_after: "/tmp",
      started_at: 1000,
      settled_at: 1010,
    });
    const m = shellTurns(code)[0].messages[0] as ShellExchangeMessage;
    expect(m.exitCode).toBe(0);
    expect(m.cwdAfter).toBe("/tmp");
    // The store's cwd tracked the command's cwd_after.
    expect(store.getSnapshot().cwd).toBe("/tmp");
  });

  // Frames sent on SHELL_INPUT (excludes the constructor's list_shell_exchanges
  // restore fetch, which rides FeedId.CONTROL).
  const shellInput = () => sentFrames.filter((f) => f.feedId === FeedId.SHELL_INPUT);

  test("exec sends a SHELL_INPUT exec frame and marks in-flight; kill sends a kill frame", () => {
    const { store } = setup();
    store.exec("echo hi");
    expect(store.getSnapshot().inflight?.command).toBe("echo hi");
    expect(shellInput().length).toBe(1);
    const exec = JSON.parse(shellInput()[0].payload);
    expect(exec.type).toBe("exec");
    expect(exec.command).toBe("echo hi");
    expect(exec.tug_session_id).toBe("sess-1");

    store.kill();
    const kill = JSON.parse(shellInput()[1].payload);
    expect(kill.type).toBe("kill");
    expect(kill.tug_session_id).toBe("sess-1");
  });

  test("exec is serial — a second exec while in-flight is refused", () => {
    const { store } = setup();
    store.exec("first");
    store.exec("second");
    expect(shellInput().length).toBe(1);
    expect(store.getSnapshot().inflight?.command).toBe("first");
  });

  test("the constructor sends a list_shell_exchanges restore fetch on CONTROL", () => {
    setup();
    const control = sentFrames.filter((f) => f.feedId === FeedId.CONTROL);
    expect(control.length).toBe(1);
    const req = JSON.parse(control[0].payload);
    expect(req.action).toBe("list_shell_exchanges");
    expect(req.tug_session_id).toBe("sess-1");
  });

  test("exchange_complete clears the in-flight slot for the running exchange", () => {
    const { store, feed } = setup();
    store.exec("sleep 5"); // mints inflight sh-1
    const id = store.getSnapshot().inflight?.exchangeId;
    feed.emit(FeedId.SHELL_OUTPUT, {
      type: "exchange_complete",
      exchange_id: id,
      command: "sleep 5",
      output: "",
      exit_code: null,
      cwd: "/proj",
      cwd_after: "/proj",
      started_at: 1,
      settled_at: 2,
    });
    expect(store.getSnapshot().inflight).toBeNull();
  });
});

describe("applyRestoredShellExchanges — restore interleave ([P07])", () => {
  function code() {
    return new CodeSessionStore({
      conn: new TestFrameChannel() as unknown as TugConnection,
      lifecycle: new ConnectionLifecycle(),
      tugSessionId: FIXTURE_IDS.TUG_SESSION_ID,
      sessionMode: "new",
    });
  }
  function row(id: number, cmd: string, startedAt: number): Record<string, unknown> {
    return {
      id,
      tug_session_id: "s1",
      seq: id,
      command: cmd,
      output: `out:${cmd}\n`,
      exit_code: 0,
      cwd: "/proj",
      cwd_after: "/proj",
      started_at_ms: startedAt,
      settled_at_ms: startedAt + 5,
    };
  }

  test("ledger rows mint settled shell turns keyed `restored-<id>`, in timestamp order", () => {
    const c = code();
    // Deliberately out of order — the interleave sorts by started_at_ms.
    applyRestoredShellExchanges(c, [row(2, "second", 200), row(1, "first", 100)]);
    const turns = c.getSnapshot().transcript.filter((t) => t.origin === "shell");
    expect(turns.map((t) => t.turnKey)).toEqual(["shell-restored-1", "shell-restored-2"]);
    const m0 = turns[0].messages[0];
    expect(m0.kind === "shell_exchange" && m0.command).toBe("first");
    expect(m0.kind === "shell_exchange" && m0.exitCode).toBe(0);
  });

  test("re-applying the same rows is idempotent — no duplicate turns (reload)", () => {
    const c = code();
    applyRestoredShellExchanges(c, [row(1, "a", 100), row(2, "b", 200)]);
    applyRestoredShellExchanges(c, [row(1, "a", 100), row(2, "b", 200)]);
    const turns = c.getSnapshot().transcript.filter((t) => t.origin === "shell");
    expect(turns.length).toBe(2);
  });

  test("an empty response is a no-op", () => {
    const c = code();
    applyRestoredShellExchanges(c, []);
    expect(c.getSnapshot().transcript.filter((t) => t.origin === "shell").length).toBe(0);
  });
});

describe("share slot ([P08])", () => {
  test("requestShare parks the text; consumePendingShare clears it", () => {
    const { store } = setup();
    expect(store.getSnapshot().pendingShare).toBeNull();
    store.requestShare("```\n$ ls\n[exit 0]\n```\n");
    expect(store.getSnapshot().pendingShare).toEqual({ text: "```\n$ ls\n[exit 0]\n```\n" });
    store.consumePendingShare();
    expect(store.getSnapshot().pendingShare).toBeNull();
  });

  test("a second share before consume overwrites — newest gesture wins", () => {
    const { store } = setup();
    store.requestShare("first");
    store.requestShare("second");
    expect(store.getSnapshot().pendingShare).toEqual({ text: "second" });
  });

  test("consume on an empty slot is a ref-stable no-op (no notification)", () => {
    const { store } = setup();
    const before = store.getSnapshot();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.consumePendingShare();
    expect(store.getSnapshot()).toBe(before);
    expect(notified).toBe(0);
    unsubscribe();
  });
});
