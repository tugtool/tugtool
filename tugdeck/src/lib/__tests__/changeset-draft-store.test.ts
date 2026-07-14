/**
 * changeset-draft-store — the live draft overlay over the maintained-draft
 * engine's CONTROL frames (Spec S10, [P24]): drafting → deltas → ready/error,
 * keyed by (project_dir, owner_kind, owner_id).
 */

import { describe, test, expect, beforeEach } from "bun:test";

import {
  attachChangesetDraftStore,
  _resetChangesetDraftStoreForTest,
  _ingestDraftFrameForTest,
} from "../changeset-draft-store";

const fakeConn = { onFrame: () => () => {} } as never;

const KEY = { project_dir: "/p", owner_kind: "session", owner_id: "s1" };

beforeEach(() => _resetChangesetDraftStoreForTest());

describe("changeset draft overlay", () => {
  test("drafting → deltas accumulate → ready keeps the last text", () => {
    const store = attachChangesetDraftStore(fakeConn);
    _ingestDraftFrameForTest({ action: "changeset_draft_state", ...KEY, state: "drafting" });
    expect(store.overlay("/p", "session", "s1").phase).toBe("drafting");

    _ingestDraftFrameForTest({ action: "changeset_draft_delta", ...KEY, text: "Add" });
    _ingestDraftFrameForTest({ action: "changeset_draft_delta", ...KEY, text: "Add the widget" });
    expect(store.overlay("/p", "session", "s1").text).toBe("Add the widget");

    _ingestDraftFrameForTest({ action: "changeset_draft_state", ...KEY, state: "ready" });
    const ready = store.overlay("/p", "session", "s1");
    expect(ready.phase).toBe("ready");
    expect(ready.text).toBe("Add the widget");
  });

  test("a fresh drafting state resets the streamed text", () => {
    const store = attachChangesetDraftStore(fakeConn);
    _ingestDraftFrameForTest({ action: "changeset_draft_delta", ...KEY, text: "stale" });
    _ingestDraftFrameForTest({ action: "changeset_draft_state", ...KEY, state: "drafting" });
    expect(store.overlay("/p", "session", "s1").text).toBe("");
  });

  test("error carries the detail and keeps the last text", () => {
    const store = attachChangesetDraftStore(fakeConn);
    _ingestDraftFrameForTest({ action: "changeset_draft_delta", ...KEY, text: "partial" });
    _ingestDraftFrameForTest({
      action: "changeset_draft_state",
      ...KEY,
      state: "error",
      detail: "scribe timed out",
    });
    const overlay = store.overlay("/p", "session", "s1");
    expect(overlay.phase).toBe("error");
    expect(overlay.detail).toBe("scribe timed out");
    expect(overlay.text).toBe("partial");
  });

  test("unrelated entries stay idle", () => {
    const store = attachChangesetDraftStore(fakeConn);
    _ingestDraftFrameForTest({ action: "changeset_draft_state", ...KEY, state: "drafting" });
    expect(store.overlay("/other", "dash", "tugdash/x").phase).toBe("idle");
  });
});
