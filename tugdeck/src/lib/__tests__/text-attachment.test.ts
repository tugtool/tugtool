/**
 * `text-attachment` — unit tests for the text-source classifier and
 * read pipeline.
 *
 * The classifier (`isTextSource`) and error-formatter
 * (`describeTextAttachmentError`) are pure functions — covered here
 * exhaustively. `readTextAttachment` is async and reads from the
 * platform's `File.text()`; we cover the size-cap and error-shape
 * paths through synthetic `File` blobs which Bun supports natively.
 */

import { describe, expect, test } from "bun:test";

import {
  MAX_TEXT_BYTE_SIZE,
  describeTextAttachmentError,
  isTextSource,
  readTextAttachment,
} from "../text-attachment";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFile(name: string, type: string, body = "x"): File {
  // Bun's global `File` constructor mirrors the WHATWG File API.
  return new File([body], name, { type });
}

// ---------------------------------------------------------------------------
// isTextSource — MIME prefix match
// ---------------------------------------------------------------------------

describe("isTextSource — text/* MIME prefix", () => {
  test("text/plain → true", () => {
    expect(isTextSource(makeFile("note.txt", "text/plain"))).toBe(true);
  });

  test("text/markdown → true", () => {
    expect(isTextSource(makeFile("README.md", "text/markdown"))).toBe(true);
  });

  test("text/html → true", () => {
    expect(isTextSource(makeFile("page.html", "text/html"))).toBe(true);
  });

  test("text/csv → true", () => {
    expect(isTextSource(makeFile("data.csv", "text/csv"))).toBe(true);
  });

  test("text/x-python (unusual subtype) → true", () => {
    expect(isTextSource(makeFile("script.py", "text/x-python"))).toBe(true);
  });

  test("uppercase MIME accepted (TEXT/PLAIN)", () => {
    expect(isTextSource(makeFile("note.txt", "TEXT/PLAIN"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTextSource — application/* exact match
// ---------------------------------------------------------------------------

describe("isTextSource — application/* exact matches", () => {
  test("application/json → true", () => {
    expect(isTextSource(makeFile("data.json", "application/json"))).toBe(true);
  });

  test("application/javascript → true", () => {
    expect(isTextSource(makeFile("app.js", "application/javascript"))).toBe(
      true,
    );
  });

  test("application/typescript → true", () => {
    expect(
      isTextSource(makeFile("app.ts", "application/typescript")),
    ).toBe(true);
  });

  test("application/yaml → true", () => {
    expect(isTextSource(makeFile("config.yaml", "application/yaml"))).toBe(
      true,
    );
  });

  test("application/xml → true", () => {
    expect(isTextSource(makeFile("data.xml", "application/xml"))).toBe(true);
  });

  test("application/graphql → true", () => {
    expect(
      isTextSource(makeFile("schema.graphql", "application/graphql")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTextSource — extension fallback for empty MIME
// ---------------------------------------------------------------------------

describe("isTextSource — extension fallback (empty MIME)", () => {
  test(".ts with empty MIME → true (extension fallback)", () => {
    expect(isTextSource(makeFile("snippet.ts", ""))).toBe(true);
  });

  test(".rs with empty MIME → true", () => {
    expect(isTextSource(makeFile("main.rs", ""))).toBe(true);
  });

  test(".go with empty MIME → true", () => {
    expect(isTextSource(makeFile("server.go", ""))).toBe(true);
  });

  test(".swift with empty MIME → true", () => {
    expect(isTextSource(makeFile("View.swift", ""))).toBe(true);
  });

  test(".sql with empty MIME → true", () => {
    expect(isTextSource(makeFile("migration.sql", ""))).toBe(true);
  });

  test("uppercase extension (.JSON) accepted via lowercase fallback", () => {
    expect(isTextSource(makeFile("data.JSON", ""))).toBe(true);
  });

  test("bare 'Dockerfile' (no extension) → true", () => {
    expect(isTextSource(makeFile("Dockerfile", ""))).toBe(true);
  });

  test("bare 'Makefile' (no extension) → true", () => {
    expect(isTextSource(makeFile("Makefile", ""))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isTextSource — rejects
// ---------------------------------------------------------------------------

describe("isTextSource — rejects binary / unsupported", () => {
  test("image/png → false (image branch handles)", () => {
    expect(isTextSource(makeFile("photo.png", "image/png"))).toBe(false);
  });

  test("image/svg+xml → false (image branch rasterizes)", () => {
    expect(
      isTextSource(makeFile("vector.svg", "image/svg+xml")),
    ).toBe(false);
  });

  test("application/pdf → false (binary; deferred)", () => {
    expect(isTextSource(makeFile("doc.pdf", "application/pdf"))).toBe(false);
  });

  test("application/zip → false", () => {
    expect(isTextSource(makeFile("archive.zip", "application/zip"))).toBe(
      false,
    );
  });

  test("application/octet-stream → false", () => {
    expect(
      isTextSource(makeFile("blob.bin", "application/octet-stream")),
    ).toBe(false);
  });

  test("video/mp4 → false", () => {
    expect(isTextSource(makeFile("clip.mp4", "video/mp4"))).toBe(false);
  });

  test("empty MIME + unknown extension → false", () => {
    expect(isTextSource(makeFile("blob.xyz", ""))).toBe(false);
  });

  test("empty MIME + no extension + non-allowlisted name → false", () => {
    expect(isTextSource(makeFile("random", ""))).toBe(false);
  });

  test("empty MIME + filename ending with '.' → false (no extension)", () => {
    expect(isTextSource(makeFile("trailing.", ""))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readTextAttachment — happy path
// ---------------------------------------------------------------------------

describe("readTextAttachment — happy paths", () => {
  test("plain text body → ok with content, mediaType, byteSize", async () => {
    const file = makeFile("note.txt", "text/plain", "hello, world");
    const out = await readTextAttachment(file);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.content).toBe("hello, world");
    expect(out.result.mediaType).toBe("text/plain");
    expect(out.result.byteSize).toBe(12);
  });

  test("non-ASCII content byte-counted via UTF-8", async () => {
    const file = makeFile("emoji.txt", "text/plain", "🚀✨");
    const out = await readTextAttachment(file);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // 🚀 = U+1F680 = 4 UTF-8 bytes; ✨ = U+2728 = 3 UTF-8 bytes; total 7.
    expect(out.result.byteSize).toBe(7);
    expect(out.result.content).toBe("🚀✨");
  });

  test("empty file MIME defaults to text/plain on output", async () => {
    const file = makeFile("config.ts", "", "export const x = 1;");
    const out = await readTextAttachment(file);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.mediaType).toBe("text/plain");
    expect(out.result.content).toBe("export const x = 1;");
  });

  test("application/json preserves source MIME on output", async () => {
    const file = makeFile("data.json", "application/json", "{}");
    const out = await readTextAttachment(file);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.mediaType).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// readTextAttachment — size cap
// ---------------------------------------------------------------------------

describe("readTextAttachment — size cap", () => {
  test("file just under cap accepted", async () => {
    // Build a payload that is exactly cap bytes of ASCII (1 byte per char).
    const payload = "a".repeat(MAX_TEXT_BYTE_SIZE);
    const file = makeFile("big.txt", "text/plain", payload);
    const out = await readTextAttachment(file);
    expect(out.ok).toBe(true);
  });

  test("file just over cap rejected", async () => {
    const payload = "a".repeat(MAX_TEXT_BYTE_SIZE + 1);
    const file = makeFile("toobig.txt", "text/plain", payload);
    const out = await readTextAttachment(file);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.kind).toBe("too-large");
    if (out.error.kind !== "too-large") return;
    expect(out.error.byteSize).toBe(MAX_TEXT_BYTE_SIZE + 1);
    expect(out.error.cap).toBe(MAX_TEXT_BYTE_SIZE);
  });
});

// ---------------------------------------------------------------------------
// describeTextAttachmentError
// ---------------------------------------------------------------------------

describe("describeTextAttachmentError", () => {
  test("too-large message includes filename and MB figures", () => {
    const msg = describeTextAttachmentError(
      { kind: "too-large", byteSize: 2 * 1024 * 1024, cap: MAX_TEXT_BYTE_SIZE },
      "huge.txt",
    );
    expect(msg).toContain("huge.txt");
    expect(msg).toMatch(/2\.\d+ MB/);
    expect(msg).toContain("1 MB");
  });

  test("read-failed message includes filename and reason", () => {
    const msg = describeTextAttachmentError(
      { kind: "read-failed", reason: "filesystem error" },
      "broken.md",
    );
    expect(msg).toContain("broken.md");
    expect(msg).toContain("filesystem error");
  });
});
