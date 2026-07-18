import { describe, it, expect } from "bun:test";

import { PathCommandsStore } from "../path-commands-store";
import { FeedId } from "../../protocol";
import type { FeedStore } from "../feed-store";

// A minimal feed-store collaborator: the store only reads `subscribe` (to
// install its listener) and `getSnapshot` (to fold the latest frame). Frames
// arrive in these tests via the `_ingestForTest` seam, so the snapshot stays
// empty — this stub supplies just enough surface to construct the store.
function stubFeedStore(): FeedStore {
  return {
    subscribe: () => () => {},
    getSnapshot: () => new Map(),
  } as unknown as FeedStore;
}

describe("PathCommandsStore", () => {
  it("is null until a reply lands", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    expect(store.getSnapshot()).toBeNull();
  });

  it("folds a matching path_commands frame into a ReadonlySet", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store._ingestForTest({
      type: "path_commands",
      tug_session_id: "s1",
      commands: ["cargo", "git", "ls"],
    });
    const set = store.getSnapshot();
    expect(set).not.toBeNull();
    expect(set!.has("git")).toBe(true);
    expect(set!.size).toBe(3);
  });

  it("ignores a frame tagged for another session", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store._ingestForTest({
      type: "path_commands",
      tug_session_id: "other",
      commands: ["git"],
    });
    expect(store.getSnapshot()).toBeNull();
  });

  it("ignores non-path_commands frames", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store._ingestForTest({ type: "shell_state", tug_session_id: "s1", live: true });
    expect(store.getSnapshot()).toBeNull();
  });

  it("notifies subscribers on a fold", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    let fires = 0;
    store.subscribe(() => {
      fires += 1;
    });
    store._ingestForTest({ type: "path_commands", tug_session_id: "s1", commands: ["ls"] });
    expect(fires).toBe(1);
  });

  it("request is idempotent (no throw without a transport)", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store.request();
    store.request();
    // No connection in the test env → the sends no-op; the guard just must not
    // throw and the set stays null until a reply folds.
    expect(store.getSnapshot()).toBeNull();
  });
});
