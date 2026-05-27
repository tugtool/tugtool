/**
 * `native-drag-bridge` — unit tests for the typed reader over the
 * native-pushed `window.__tugActiveDrag` global.
 *
 * Pure-logic coverage of the JS side of the cursor-level drag-reject
 * bridge introduced in [Step 3.5.7](roadmap/tide-atoms.md#step-3-5-7).
 * The native push half (Swift `TugDragDestination`) is exercised in
 * Xcode unit tests and live in Tug.app; this file only pins the
 * shape-tolerance contract of the JS reader.
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
  getCurrentDragFiles,
  getNativeDragSnapshot,
} from "../native-drag-bridge";

const SNAPSHOT_KEY = "__tugActiveDrag";

function setSnapshot(value: unknown): void {
  (globalThis as Record<string, unknown>)[SNAPSHOT_KEY] = value;
}

function clearSnapshot(): void {
  delete (globalThis as Record<string, unknown>)[SNAPSHOT_KEY];
}

afterEach(() => {
  clearSnapshot();
});

// ---------------------------------------------------------------------------
// Absent / null snapshot
// ---------------------------------------------------------------------------

describe("getNativeDragSnapshot — absent or null", () => {
  test("returns null when the global is unset", () => {
    clearSnapshot();
    expect(getNativeDragSnapshot()).toBeNull();
    expect(getCurrentDragFiles()).toBeNull();
  });

  test("returns null when the global is explicitly null", () => {
    setSnapshot(null);
    expect(getNativeDragSnapshot()).toBeNull();
    expect(getCurrentDragFiles()).toBeNull();
  });

  test("returns null when the global is undefined", () => {
    setSnapshot(undefined);
    expect(getNativeDragSnapshot()).toBeNull();
    expect(getCurrentDragFiles()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Well-formed snapshots
// ---------------------------------------------------------------------------

describe("getNativeDragSnapshot — well-formed", () => {
  test("returns the parsed snapshot for a one-file PNG drag", () => {
    setSnapshot({
      files: [{ name: "screenshot.png", mimeType: "image/png", size: 4096 }],
    });
    const snapshot = getNativeDragSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.files).toHaveLength(1);
    expect(snapshot!.files[0]).toEqual({
      name: "screenshot.png",
      mimeType: "image/png",
      size: 4096,
    });
  });

  test("returns multiple entries in payload order", () => {
    setSnapshot({
      files: [
        { name: "a.txt", mimeType: "text/plain", size: 12 },
        { name: "b.png", mimeType: "image/png", size: 4096 },
        { name: "c.pdf", mimeType: "application/pdf", size: 99999 },
      ],
    });
    const files = getCurrentDragFiles();
    expect(files).not.toBeNull();
    expect(files).toHaveLength(3);
    expect(files![0]!.name).toBe("a.txt");
    expect(files![1]!.name).toBe("b.png");
    expect(files![2]!.name).toBe("c.pdf");
  });

  test("treats missing mimeType as undefined", () => {
    setSnapshot({
      files: [{ name: "unknown.xyz" }],
    });
    const files = getCurrentDragFiles();
    expect(files).not.toBeNull();
    expect(files![0]).toEqual({
      name: "unknown.xyz",
      mimeType: undefined,
      size: undefined,
    });
  });

  test("returns an empty files array when the native side cleared it", () => {
    setSnapshot({ files: [] });
    const snapshot = getNativeDragSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Malformed snapshots — defensive shape checks
// ---------------------------------------------------------------------------

describe("getNativeDragSnapshot — malformed", () => {
  test("returns null when the global is a primitive", () => {
    setSnapshot(42);
    expect(getNativeDragSnapshot()).toBeNull();
    setSnapshot("not an object");
    expect(getNativeDragSnapshot()).toBeNull();
    setSnapshot(true);
    expect(getNativeDragSnapshot()).toBeNull();
  });

  test("returns null when files is missing", () => {
    setSnapshot({});
    expect(getNativeDragSnapshot()).toBeNull();
  });

  test("returns null when files is not an array", () => {
    setSnapshot({ files: "screenshot.png" });
    expect(getNativeDragSnapshot()).toBeNull();
  });

  test("filters entries without a valid name string", () => {
    setSnapshot({
      files: [
        { name: "good.png", mimeType: "image/png" },
        { mimeType: "image/png" },
        { name: 42, mimeType: "image/png" },
        null,
        "not an object",
      ],
    });
    const files = getCurrentDragFiles();
    expect(files).not.toBeNull();
    expect(files).toHaveLength(1);
    expect(files![0]!.name).toBe("good.png");
  });

  test("treats non-string mimeType as undefined", () => {
    setSnapshot({
      files: [{ name: "bad.png", mimeType: 42 }],
    });
    const files = getCurrentDragFiles();
    expect(files).not.toBeNull();
    expect(files![0]!.mimeType).toBeUndefined();
  });

  test("treats non-number size as undefined", () => {
    setSnapshot({
      files: [{ name: "ok.png", mimeType: "image/png", size: "huge" }],
    });
    const files = getCurrentDragFiles();
    expect(files).not.toBeNull();
    expect(files![0]!.size).toBeUndefined();
  });
});
