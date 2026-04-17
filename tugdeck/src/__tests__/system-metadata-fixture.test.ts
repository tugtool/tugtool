/**
 * Unit tests for system-metadata-fixture (D5).
 *
 * Reads the actual shipped `capabilities/<LATEST>/system-metadata.jsonl`
 * from disk and exercises the pure factory + position-0 gate helper. The
 * singleton `getFixtureSessionMetadataStore` is deliberately not tested
 * here — it depends on the Vite virtual module which bun-test can't
 * resolve.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type React from "react";

import {
  createFixtureSessionMetadataStore,
  wrapPositionZero,
} from "../components/tugways/cards/completion-fixtures/system-metadata-fixture";
import type { CompletionProvider } from "../lib/tug-text-engine";
import type { TugPromptEntryDelegate } from "../components/tugways/tug-prompt-entry";

// ---------------------------------------------------------------------------
// Load the shipped capture.
// ---------------------------------------------------------------------------

const CAPABILITIES_ROOT = join(import.meta.dir, "..", "..", "..", "capabilities");
const latestVersion = readFileSync(
  join(CAPABILITIES_ROOT, "LATEST"),
  "utf-8",
).trim();
const rawJsonl = readFileSync(
  join(CAPABILITIES_ROOT, latestVersion, "system-metadata.jsonl"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// createFixtureSessionMetadataStore
// ---------------------------------------------------------------------------

describe("createFixtureSessionMetadataStore", () => {
  it("parses the captured payload and surfaces all commands via the provider", () => {
    const store = createFixtureSessionMetadataStore(rawJsonl);
    const snapshot = store.getSnapshot();

    // Payload counts for the shipped v2.1.112 capture:
    //   slash_commands: 23  (13 upgrade to "skill", 10 stay "local")
    //   agents: 16
    //   total after dedup: 39
    expect(snapshot.slashCommands.length).toBe(39);

    const byCategory = new Map<string, number>();
    for (const cmd of snapshot.slashCommands) {
      byCategory.set(cmd.category, (byCategory.get(cmd.category) ?? 0) + 1);
    }
    expect(byCategory.get("local")).toBe(10);
    expect(byCategory.get("skill")).toBe(13);
    expect(byCategory.get("agent")).toBe(16);
  });

  it("narrows `tug` to the 16 tugplug-prefixed entries", () => {
    const store = createFixtureSessionMetadataStore(rawJsonl);
    const provider = store.getCommandCompletionProvider();
    const hits = provider("tug");
    expect(hits.length).toBe(16);
    for (const h of hits) {
      expect(h.atom.type).toBe("command");
      expect(h.label.startsWith("tugplug:")).toBe(true);
    }
  });

  it("narrows `com` to commit + compact + tugplug:committer-agent", () => {
    const store = createFixtureSessionMetadataStore(rawJsonl);
    const provider = store.getCommandCompletionProvider();
    const names = provider("com").map((h) => h.label).sort();
    expect(names).toEqual([
      "commit",
      "compact",
      "tugplug:committer-agent",
    ]);
  });

  it("rejects empty JSONL", () => {
    expect(() => createFixtureSessionMetadataStore("")).toThrow(/empty/);
  });
});

// ---------------------------------------------------------------------------
// wrapPositionZero
// ---------------------------------------------------------------------------

function makeEntryRef(text: string): React.RefObject<TugPromptEntryDelegate | null> {
  const editor = { textContent: text } as unknown as HTMLElement;
  const delegate = {
    getEditorElement: () => editor,
  } as unknown as TugPromptEntryDelegate;
  return { current: delegate };
}

describe("wrapPositionZero", () => {
  const inner: CompletionProvider = ((q: string) => [
    {
      label: `hit:${q}`,
      atom: { kind: "atom", type: "command", label: q, value: q },
    },
  ]) as CompletionProvider;

  it("returns [] when the editor is empty", () => {
    const gated = wrapPositionZero(makeEntryRef(""), inner);
    expect(gated("x")).toEqual([]);
  });

  it("returns [] when the first character is not `/`", () => {
    const gated = wrapPositionZero(makeEntryRef("hello /world"), inner);
    expect(gated("world")).toEqual([]);
  });

  it("passes through when the first character is `/`", () => {
    const gated = wrapPositionZero(makeEntryRef("/tugplug:plan"), inner);
    const hits = gated("plan");
    expect(hits.length).toBe(1);
    expect(hits[0].label).toBe("hit:plan");
  });

  it("returns [] when the ref is null (pre-mount)", () => {
    const ref: React.RefObject<TugPromptEntryDelegate | null> = { current: null };
    const gated = wrapPositionZero(ref, inner);
    expect(gated("x")).toEqual([]);
  });
});
