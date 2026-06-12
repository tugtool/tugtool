/**
 * Pin the `PulseStore` external-store contract:
 *
 *   - First `getSnapshot` kicks the one-shot `list_pulse_lines` tail
 *     request and returns pending.
 *   - `list_pulse_lines_ok` settles to ready with decoded lines.
 *   - Live PULSE frames fold (including while pending), dedupe against
 *     the tail by line identity, and the log caps at 20 oldest-out.
 *   - Snapshots are referentially stable between folds.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  PULSE_LINES_CAP,
  PulseStore,
  latestLineForScope,
  publishListPulseLinesOk,
  type PulseLineEntry,
} from "@/lib/pulse-store";
import type { TugConnection } from "@/connection";
import { FeedId, type FeedIdValue } from "@/protocol";

type FrameCallback = (payload: Uint8Array) => void;

class FakeConnection {
  readonly frames: Array<{ feedId: FeedIdValue; payload: Uint8Array }> = [];
  readonly frameSubscribers = new Map<number, FrameCallback[]>();
  send(feedId: FeedIdValue, payload: Uint8Array): void {
    this.frames.push({ feedId, payload });
  }
  onFrame(feedId: number, callback: FrameCallback): void {
    const list = this.frameSubscribers.get(feedId) ?? [];
    list.push(callback);
    this.frameSubscribers.set(feedId, list);
  }
  pushPulseFrame(line: Record<string, unknown>): void {
    const payload = new TextEncoder().encode(JSON.stringify(line));
    for (const cb of this.frameSubscribers.get(FeedId.PULSE) ?? []) {
      cb(payload);
    }
  }
}

function makeStore(): { store: PulseStore; conn: FakeConnection } {
  const conn = new FakeConnection();
  const store = new PulseStore(conn as unknown as TugConnection);
  return { store, conn };
}

function wireRow(beat: number, text: string): Record<string, unknown> {
  return { id: beat, at_ms: 1_000 + beat, beat, text, scopes: ["s1"] };
}

function liveLine(beat: number, text: string): Record<string, unknown> {
  return { type: "pulse", text, scopes: ["s1"], beat, at: 1_000 + beat };
}

const stores: PulseStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose();
});

describe("PulseStore", () => {
  it("first snapshot kicks exactly one tail request and reads pending", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    const first = store.getSnapshot();
    expect(first.status).toBe("pending");
    expect(first.lines.length).toBe(0);
    expect(first.enabled).toBe(true); // no tugbank client → default on
    store.getSnapshot();
    expect(conn.frames.length).toBe(1);
    expect(conn.frames[0].feedId).toBe(FeedId.CONTROL);
    const decoded = JSON.parse(new TextDecoder().decode(conn.frames[0].payload));
    expect(decoded.action).toBe("list_pulse_lines");
  });

  it("the tail response settles to ready, oldest-first, latest set", () => {
    const { store } = makeStore();
    stores.push(store);
    store.getSnapshot();
    publishListPulseLinesOk({
      lines: [wireRow(1, "first"), wireRow(2, "second")] as never,
    });
    const snap = store.getSnapshot();
    expect(snap.status).toBe("ready");
    expect(snap.lines.map((l) => l.text)).toEqual(["first", "second"]);
    expect(snap.latest?.text).toBe("second");
    expect(snap.latest?.key).toBe("1002:2");
  });

  it("live frames fold, dedupe against the tail, and survive pending", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    // A live line lands while the tail load is still pending…
    conn.pushPulseFrame(liveLine(2, "second"));
    expect(store.getSnapshot().lines.map((l) => l.text)).toEqual(["second"]);
    // …then the tail arrives carrying the SAME line plus history.
    publishListPulseLinesOk({
      lines: [wireRow(1, "first"), wireRow(2, "second")] as never,
    });
    expect(store.getSnapshot().lines.map((l) => l.text)).toEqual([
      "first",
      "second",
    ]);
    // A fresh live line appends; a duplicate re-delivery does not.
    conn.pushPulseFrame(liveLine(3, "third"));
    conn.pushPulseFrame(liveLine(3, "third"));
    expect(store.getSnapshot().lines.map((l) => l.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(store.getSnapshot().latest?.text).toBe("third");
  });

  it("the rolling log caps oldest-out", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    store.getSnapshot();
    for (let beat = 1; beat <= PULSE_LINES_CAP + 5; beat++) {
      conn.pushPulseFrame(liveLine(beat, `line ${beat}`));
    }
    const snap = store.getSnapshot();
    expect(snap.lines.length).toBe(PULSE_LINES_CAP);
    expect(snap.lines[0].text).toBe("line 6");
    expect(snap.latest?.text).toBe(`line ${PULSE_LINES_CAP + 5}`);
  });

  it("latestLineForScope shows own-session, app-wide, and woven lines only", () => {
    const entry = (
      key: string,
      text: string,
      scopes: string[],
    ): PulseLineEntry => ({ key, text, scopes, beat: 0, atMs: 0 });
    const lines = [
      entry("1", "about session A", ["sess-a"]),
      entry("2", "ambience for everyone", ["app"]),
      entry("3", "A and B weave", ["sess-a", "sess-b"]),
      entry("4", "about session B", ["sess-b"]),
    ];
    // Card B sees its own newest line — never A's.
    expect(latestLineForScope(lines, "sess-b")?.text).toBe("about session B");
    // Card A's newest match is the woven line (it covers A).
    expect(latestLineForScope(lines, "sess-a")?.text).toBe("A and B weave");
    // A brand-new session never wears another session's line; its
    // newest match is the app-wide ambience (tugcode never emits
    // "app"-scoped lines, so in practice a fresh session reads None).
    expect(latestLineForScope(lines, "sess-new")?.text).toBe(
      "ambience for everyone",
    );
    expect(latestLineForScope([lines[0], lines[3]], "sess-new")).toBeNull();
    // No bound session → nothing.
    expect(latestLineForScope(lines, "")).toBeNull();
    // Scope-less lines are ambience.
    expect(latestLineForScope([entry("5", "bare", [])], "sess-x")?.text).toBe("bare");
  });

  it("snapshots are referentially stable between folds", () => {
    const { store, conn } = makeStore();
    stores.push(store);
    const a = store.getSnapshot();
    const b = store.getSnapshot();
    expect(a).toBe(b);
    conn.pushPulseFrame(liveLine(1, "one"));
    const c = store.getSnapshot();
    expect(c).not.toBe(b);
    expect(store.getSnapshot()).toBe(c);
    // Malformed / foreign frames change nothing.
    conn.pushPulseFrame({ type: "not_pulse" });
    expect(store.getSnapshot()).toBe(c);
  });
});
