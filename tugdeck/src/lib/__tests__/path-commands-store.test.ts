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

  it("hands out the union of the PATH set and the shell's own words", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store._ingestForTest({
      type: "path_commands",
      tug_session_id: "s1",
      commands: ["git", "ls"],
    });
    store._ingestForTest({
      type: "shell_words",
      tug_session_id: "s1",
      names: ["gs", "setopt", "ls"],
    });
    const set = store.getSnapshot()!;
    expect(set.has("git")).toBe(true);
    // A function on no PATH, and a builtin that is not a file anywhere.
    expect(set.has("gs")).toBe(true);
    expect(set.has("setopt")).toBe(true);
    // `ls` is in both and appears once.
    expect(set.size).toBe(4);
  });

  it("stays null when only the shell words have landed", () => {
    // The classifier's "still loading → answer Code" net needs one trigger, so
    // whichever frame arrives first, the command set is what opens the gate.
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store._ingestForTest({ type: "shell_words", tug_session_id: "s1", names: ["gs"] });
    expect(store.getSnapshot()).toBeNull();

    store._ingestForTest({ type: "path_commands", tug_session_id: "s1", commands: ["git"] });
    const set = store.getSnapshot()!;
    expect(set.has("gs")).toBe(true);
    expect(set.has("git")).toBe(true);
  });

  it("keeps the shell words when a pushed PATH set replaces the old one", () => {
    // tugcast re-emits `path_commands` when the set changes under a running
    // session — a `brew install` becoming routable must not cost the words.
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store._ingestForTest({ type: "path_commands", tug_session_id: "s1", commands: ["git"] });
    store._ingestForTest({ type: "shell_words", tug_session_id: "s1", names: ["gs"] });
    store._ingestForTest({
      type: "path_commands",
      tug_session_id: "s1",
      commands: ["git", "brandnew"],
    });
    const set = store.getSnapshot()!;
    expect(set.has("brandnew")).toBe(true);
    expect(set.has("gs")).toBe(true);
  });

  it("ignores a shell_words frame for another session or with a malformed body", () => {
    const store = new PathCommandsStore(stubFeedStore(), FeedId.SHELL_OUTPUT, "s1");
    store._ingestForTest({ type: "path_commands", tug_session_id: "s1", commands: ["git"] });
    store._ingestForTest({ type: "shell_words", tug_session_id: "other", names: ["nope"] });
    store._ingestForTest({ type: "shell_words", tug_session_id: "s1", names: "not-an-array" });
    store._ingestForTest({ type: "shell_words", tug_session_id: "s1", names: [1, null, "gs"] });
    const set = store.getSnapshot()!;
    expect(set.has("nope")).toBe(false);
    expect(set.has("gs")).toBe(true);
    expect(set.size).toBe(2);
  });
});
