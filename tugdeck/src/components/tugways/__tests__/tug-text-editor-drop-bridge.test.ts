/**
 * `tug-text-editor-drop-bridge` — integration test for the
 * `dragOutcomeFromBridge` decision math.
 *
 * Pins the bridge-or-fallback contract that drives the three-state
 * `setDropActive` accept / reject ring during `dragenter` /
 * `dragover`. Stubs `window.__tugActiveDrag` to each variant and
 * asserts the outcome. The native push half (Swift
 * `TugDragDestination`) is exercised only manually in Tug.app; this
 * test exists so a regression in the JS-side decision math —
 * accidentally rejecting on empty arrays, missing the optimistic-
 * accept on null MIME, etc. — surfaces in `bun test`.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { dragOutcomeFromBridge } from "../tug-text-editor/drop-extension";

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

describe("dragOutcomeFromBridge — fallback paths", () => {
  test("absent global → accept (browser-only / pre-first-snapshot)", () => {
    clearSnapshot();
    expect(dragOutcomeFromBridge()).toBe("accept");
  });

  test("explicit null → accept (drag ended on native side)", () => {
    setSnapshot(null);
    expect(dragOutcomeFromBridge()).toBe("accept");
  });

  test("empty files array → accept (defensive against future native shape)", () => {
    setSnapshot({ files: [] });
    expect(dragOutcomeFromBridge()).toBe("accept");
  });

  test("malformed payload → accept (shape check fails, treated as no bridge)", () => {
    setSnapshot({ notFiles: "garbage" });
    expect(dragOutcomeFromBridge()).toBe("accept");
  });
});

describe("dragOutcomeFromBridge — supported types", () => {
  test("single PNG → accept", () => {
    setSnapshot({
      files: [{ name: "shot.png", mimeType: "image/png", size: 4096 }],
    });
    expect(dragOutcomeFromBridge()).toBe("accept");
  });

  test("missing mimeType → accept (optimistic; drop-time classifier decides)", () => {
    // Some Finder file URLs arrive without a registered MIME. The
    // bridge falls through to drop-time `File.type` classification
    // rather than rejecting at the cursor and over-rejecting an
    // image whose MIME the OS happened not to publish.
    setSnapshot({
      files: [{ name: "module.ts" }],
    });
    expect(dragOutcomeFromBridge()).toBe("accept");
  });

  test("empty-string mimeType → accept (same optimistic treatment)", () => {
    setSnapshot({
      files: [{ name: "module.ts", mimeType: "" }],
    });
    expect(dragOutcomeFromBridge()).toBe("accept");
  });
});

describe("dragOutcomeFromBridge — rejection", () => {
  test("single PDF → reject", () => {
    setSnapshot({
      files: [{ name: "doc.pdf", mimeType: "application/pdf", size: 99999 }],
    });
    expect(dragOutcomeFromBridge()).toBe("reject");
  });

  test("single plain-text file → reject (images-only)", () => {
    // Per the Option A image-only narrowing (see roadmap [D02]):
    // inline attachments are images only. A text/plain drag
    // rejects at the cursor.
    setSnapshot({
      files: [{ name: "notes.txt", mimeType: "text/plain", size: 256 }],
    });
    expect(dragOutcomeFromBridge()).toBe("reject");
  });

  test("two unsupported entries → reject", () => {
    setSnapshot({
      files: [
        { name: "a.zip", mimeType: "application/zip" },
        { name: "b.mp3", mimeType: "audio/mpeg" },
      ],
    });
    expect(dragOutcomeFromBridge()).toBe("reject");
  });

  test("ZIP + text-plain → reject (both non-image)", () => {
    setSnapshot({
      files: [
        { name: "archive.zip", mimeType: "application/zip" },
        { name: "notes.txt", mimeType: "text/plain" },
      ],
    });
    expect(dragOutcomeFromBridge()).toBe("reject");
  });
});

describe("dragOutcomeFromBridge — mixed", () => {
  test("PDF + PNG → accept (PNG is supported; drop-time skips PDF silently)", () => {
    setSnapshot({
      files: [
        { name: "doc.pdf", mimeType: "application/pdf" },
        { name: "shot.png", mimeType: "image/png" },
      ],
    });
    expect(dragOutcomeFromBridge()).toBe("accept");
  });

  test("MP3 + missing-MIME → accept (optimistic on the unknown entry)", () => {
    setSnapshot({
      files: [
        { name: "song.mp3", mimeType: "audio/mpeg" },
        { name: "module.ts" },
      ],
    });
    expect(dragOutcomeFromBridge()).toBe("accept");
  });
});
