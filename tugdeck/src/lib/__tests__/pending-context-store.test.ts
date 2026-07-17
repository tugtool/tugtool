import { describe, expect, it } from "bun:test";

import {
  PendingContextStore,
  composeBtwContextBody,
  composeContextPrefix,
  splitLeadingContext,
} from "@/lib/pending-context-store";

describe("composeContextPrefix / splitLeadingContext — the sentinel round-trip", () => {
  it("returns null for an empty queue", () => {
    expect(composeContextPrefix([])).toBeNull();
  });

  it("round-trips a single shell block ahead of the user prose", () => {
    const prefix = composeContextPrefix([
      { source: "shell", ref: "sh-3", body: "```\n$ ls\nfoo\n[exit 0]\n```" },
    ]);
    expect(prefix).not.toBeNull();
    const message = `${prefix}what does this mean?`;
    const { blocks, rest } = splitLeadingContext(message);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("shell");
    expect(blocks[0].ref).toBe("sh-3");
    expect(blocks[0].body).toContain("$ ls");
    expect(rest).toBe("what does this mean?");
  });

  it("round-trips several stacked blocks in order", () => {
    const prefix = composeContextPrefix([
      { source: "shell", ref: "sh-1", body: "one" },
      { source: "btw", ref: "btw-2", body: composeBtwContextBody("q?", "a.") },
    ]);
    const { blocks, rest } = splitLeadingContext(`${prefix}go`);
    expect(blocks.map((b) => b.source)).toEqual(["shell", "btw"]);
    expect(blocks[1].body).toContain("Side question:");
    expect(rest).toBe("go");
  });

  it("leaves a plain user message untouched (no sentinel)", () => {
    const { blocks, rest } = splitLeadingContext("just a normal message");
    expect(blocks).toEqual([]);
    expect(rest).toBe("just a normal message");
  });

  it("a body containing the literal close tag cannot false-close the block", () => {
    const prefix = composeContextPrefix([
      { source: "shell", ref: "sh-9", body: "printed </tug-context> in output\nmore" },
    ]);
    const { blocks, rest } = splitLeadingContext(`${prefix}tail`);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toContain("more");
    expect(rest).toBe("tail");
  });

  it("only consumes LEADING blocks — a sentinel-looking string mid-prose is left alone", () => {
    const text = "hello <tug-context source=\"shell\" ref=\"x\">not real</tug-context>";
    const { blocks, rest } = splitLeadingContext(text);
    expect(blocks).toEqual([]);
    expect(rest).toBe(text);
  });
});

describe("PendingContextStore", () => {
  const item = (ref: string) => ({ source: "shell" as const, ref, label: `#${ref}`, body: ref });

  it("stages, de-dupes by source+ref, and reports staged state", () => {
    const store = new PendingContextStore();
    store.stage(item("a"));
    store.stage(item("a")); // duplicate — no-op
    store.stage(item("b"));
    expect(store.getSnapshot().items).toHaveLength(2);
    expect(store.has("shell", "a")).toBe(true);
    expect(store.has("shell", "z")).toBe(false);
  });

  it("un-stages by id and by ref", () => {
    const store = new PendingContextStore();
    store.stage(item("a"));
    store.stage(item("b"));
    const idA = store.getSnapshot().items[0].id;
    store.unstage(idA);
    expect(store.has("shell", "a")).toBe(false);
    store.unstageRef("shell", "b");
    expect(store.getSnapshot().items).toHaveLength(0);
  });

  it("takePrefix composes the sentinel and clears the queue", () => {
    const store = new PendingContextStore();
    store.stage(item("a"));
    const prefix = store.takePrefix();
    expect(prefix).not.toBeNull();
    expect(splitLeadingContext(prefix ?? "").blocks).toHaveLength(1);
    expect(store.getSnapshot().items).toHaveLength(0);
    expect(store.takePrefix()).toBeNull();
  });

  it("carries per-route VISIBILITY independently", () => {
    const store = new PendingContextStore();
    expect(store.isContext("shell")).toBe(false);
    store.setContext("shell", true);
    expect(store.isContext("shell")).toBe(true);
    expect(store.isContext("btw")).toBe(false);
    expect(store.getSnapshot().shellContext).toBe(true);
    expect(store.getSnapshot().btwContext).toBe(false);
  });

  it("notifies subscribers on stage and visibility changes", () => {
    const store = new PendingContextStore();
    let ticks = 0;
    const unsub = store.subscribe(() => { ticks += 1; });
    store.stage(item("a"));
    store.setContext("btw", true);
    expect(ticks).toBe(2);
    unsub();
  });
});
