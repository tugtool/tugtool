import { describe, it, expect } from "bun:test";

import { CLASSIFY_REQUEST_TIMEOUT_MS, ShellClassifyStore } from "../shell-classify-store";
import { FeedId } from "../../protocol";
import type { FeedStore } from "../feed-store";

// A minimal feed-store collaborator: the store only reads `subscribe` (to
// install its listener) and `getSnapshot` (to fold the latest frame). Frames
// arrive in these tests via the `_ingestForTest` seam.
function stubFeedStore(): FeedStore {
  return {
    subscribe: () => () => {},
    getSnapshot: () => new Map(),
  } as unknown as FeedStore;
}

function store(): ShellClassifyStore {
  return new ShellClassifyStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
}

function reply(
  line: string,
  withGrammar: boolean,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "shell_classify",
    tug_session_id: "s1",
    line,
    with_grammar: withGrammar,
    ...body,
  };
}

describe("ShellClassifyStore", () => {
  it("knows nothing about a line until its reply lands", () => {
    expect(store().get("ls -la")).toBeUndefined();
  });

  it("folds both verdicts", () => {
    for (const verdict of ["shell", "prompt"] as const) {
      const s = store();
      s._ingestForTest(reply("ls -la", false, { ok: true, verdict }));
      expect(s.get("ls -la")).toBe(verdict);
    }
  });

  // The correlation key is the pair, not the line. The same text asked with
  // and without documentation is two different questions, and a reply to one
  // must never answer the other.
  it("keeps the documented and undocumented questions apart", () => {
    const s = store();
    s._ingestForTest(reply("curl -sS x", true, { ok: true, verdict: "shell" }));
    expect(s.get("curl -sS x", "usage: curl")).toBe("shell");
    expect(s.get("curl -sS x")).toBeUndefined();

    s._ingestForTest(reply("curl -sS x", false, { ok: true, verdict: "prompt" }));
    expect(s.get("curl -sS x")).toBe("prompt");
    expect(s.get("curl -sS x", "usage: curl")).toBe("shell");
  });

  // Every failure shape is one answer to the caller, because the caller does
  // the same thing with all of them: send the line to Claude.
  it("resolves every failure shape to no opinion", () => {
    for (const body of [
      { ok: false, verdict: null, error: "shared agent unavailable" },
      { ok: false, verdict: null, error: "classification did not name a label" },
      { ok: true, verdict: "maybe" },
      { ok: true },
    ]) {
      const s = store();
      s._ingestForTest(reply("make it pretty", false, body));
      expect(s.get("make it pretty")).toBeNull();
    }
  });

  it("ignores another session's reply and a malformed frame", () => {
    const s = store();
    s._ingestForTest({
      type: "shell_classify",
      tug_session_id: "s2",
      line: "ls -la",
      with_grammar: false,
      ok: true,
      verdict: "shell",
    });
    expect(s.get("ls -la")).toBeUndefined();

    // No `with_grammar` means no correlation key, so there is nothing to file.
    s._ingestForTest({
      type: "shell_classify",
      tug_session_id: "s1",
      line: "ls -la",
      ok: true,
      verdict: "shell",
    });
    expect(s.get("ls -la")).toBeUndefined();

    s._ingestForTest(reply("ls -la", false, { ok: true, verdict: "shell" }));
    expect(s.get("ls -la")).toBe("shell");
  });

  // With no transport there is no request to park, so the answer is immediate
  // rather than a wait that could only ever expire.
  it("answers at once when there is nothing to ask over", async () => {
    expect(await store().request("ls -la")).toBeNull();
  });

  it("hands back a cached answer without asking again", async () => {
    const s = store();
    s._ingestForTest(reply("ls -la", false, { ok: true, verdict: "shell" }));
    expect(await s.request("ls -la")).toBe("shell");
    expect(await s.requestWithin("ls -la", 0)).toBe("shell");
  });

  it("clears its cache with the grade cache on draft teardown", () => {
    const s = store();
    s._ingestForTest(reply("ls -la", false, { ok: true, verdict: "shell" }));
    s.clear();
    expect(s.get("ls -la")).toBeUndefined();
  });

  it("notifies subscribers when a verdict lands, and stops after dispose", () => {
    const s = store();
    let seen = 0;
    const unsubscribe = s.subscribe(() => {
      seen += 1;
    });
    s._ingestForTest(reply("ls -la", false, { ok: true, verdict: "shell" }));
    expect(seen).toBe(1);
    s.dispose();
    s._ingestForTest(reply("git status", false, { ok: true, verdict: "shell" }));
    expect(seen).toBe(1);
    unsubscribe();
  });

  // The triad: this constant, the classify JobSpec ceiling in tugcast, and the
  // composer's submit wait bound the same pause and must agree.
  it("waits the triad's two seconds", () => {
    expect(CLASSIFY_REQUEST_TIMEOUT_MS).toBe(2000);
  });
});
