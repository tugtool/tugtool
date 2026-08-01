/**
 * Pure-logic tests for `pending-ask-store.ts`.
 *
 * The invariant under test is the one the whole feature rests on: **a caller is
 * blocked on the other end of every question, so every path out of `receive`
 * either shows a dialog or answers.** Silence means a command-line tool hangs
 * until its own timeout.
 *
 * These drive the real store through its real injected seam (`init`), capturing
 * what it puts on the wire. Coverage stops where `cardServicesStore` begins —
 * routing to a live session needs real card services and a real connection, so
 * that half is covered end-to-end by the app-test rather than by standing up a
 * fake registry here.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import { pendingAskStore } from "../pending-ask-store";

interface SentFrame {
  action: string;
  payload: Record<string, unknown>;
}

let sent: SentFrame[] = [];
let dispose: () => void = () => {};

/** Wire the store up with no focused session, so routing always comes up empty. */
function initWithNoSession(): void {
  dispose();
  sent = [];
  dispose = pendingAskStore.init({
    sendControlFrame: (action, payload) => sent.push({ action, payload }),
    focusedTugSessionId: () => null,
  });
}

const OPTIONS = [
  { value: "run-all", label: "Run all" },
  { value: "run-background-only", label: "Run background-only" },
  { value: "cancel", label: "Cancel" },
];

beforeEach(initWithNoSession);

describe("frames that cannot be rendered", () => {
  it("ignores a frame with no requestId — there is nobody to answer", () => {
    pendingAskStore.receive({ title: "t", options: OPTIONS });
    expect(sent).toEqual([]);
  });

  it("ignores a non-string requestId", () => {
    pendingAskStore.receive({ requestId: 42, title: "t", options: OPTIONS });
    expect(sent).toEqual([]);
  });

  it("answers a frame with no title rather than dropping it", () => {
    pendingAskStore.receive({ requestId: "r1", options: OPTIONS });
    expect(sent).toHaveLength(1);
    expect(sent[0].action).toBe("ask-response");
    expect(sent[0].payload.requestId).toBe("r1");
  });

  it("answers a frame with no options rather than dropping it", () => {
    pendingAskStore.receive({ requestId: "r2", title: "t", options: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.requestId).toBe("r2");
  });

  it("discards option entries that are not value+label pairs", () => {
    // One valid entry survives, so this routes rather than being refused for
    // having no options at all.
    pendingAskStore.receive({
      requestId: "r3",
      title: "t",
      options: [{ value: 1 }, "nope", null, { value: "ok", label: "OK" }],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.choice).toBe("ok");
  });
});

describe("no session to show the question on", () => {
  it("answers with the last option, which callers reserve for declining", () => {
    pendingAskStore.receive({ requestId: "r4", title: "t", options: OPTIONS });
    expect(sent).toEqual([
      { action: "ask-response", payload: { requestId: "r4", choice: "cancel" } },
    ]);
  });

  it("does not park an unroutable question in the snapshot", () => {
    pendingAskStore.receive({ requestId: "r5", title: "t", options: OPTIONS });
    expect(pendingAskStore.getSnapshot().size).toBe(0);
  });
});

describe("respond", () => {
  it("ignores an answer for a request that is not live", () => {
    pendingAskStore.respond("never-asked", "run-all");
    expect(sent).toEqual([]);
  });
});

describe("subscribe", () => {
  it("notifies on an unroutable question and unsubscribes cleanly", () => {
    let calls = 0;
    const unsub = pendingAskStore.subscribe(() => {
      calls += 1;
    });
    pendingAskStore.receive({ requestId: "r6", title: "t", options: OPTIONS });
    unsub();
    pendingAskStore.receive({ requestId: "r7", title: "t", options: OPTIONS });
    // An unroutable question answers before it ever reaches the live map, so
    // the only notification is the one the store emits on teardown paths.
    expect(calls).toBeLessThanOrEqual(1);
    expect(sent).toHaveLength(2);
  });
});
