/**
 * file-kinds.test.ts — the extension allowlist that decides whether a path
 * opens into a Text card or a viewer card, and the blob URL viewer cards
 * point at.
 */

import { describe, expect, test } from "bun:test";
import {
  VIEWABLE_EXTENSIONS,
  blobUrl,
  bytesUrl,
  classifyFileKind,
  elideFileName,
  isViewableFile,
} from "@/lib/file-kinds";

/**
 * The canonical list, mirrored in tugcast's `fs_blob.rs` MIME table and
 * `AppDelegate.viewableContentTypes`. A type added to one side and missed
 * here fails this test.
 */
const EXPECTED: ReadonlyArray<readonly [string, "image" | "pdf"]> = [
  ["png", "image"],
  ["jpg", "image"],
  ["jpeg", "image"],
  ["jfif", "image"],
  ["gif", "image"],
  ["webp", "image"],
  ["heic", "image"],
  ["heif", "image"],
  ["avif", "image"],
  ["tiff", "image"],
  ["tif", "image"],
  ["bmp", "image"],
  ["ico", "image"],
  ["pdf", "pdf"],
];

describe("classifyFileKind", () => {
  test("the table holds exactly the expected extensions", () => {
    expect(Object.keys(VIEWABLE_EXTENSIONS).sort()).toEqual(
      EXPECTED.map(([ext]) => ext).sort(),
    );
  });

  test("every viewable extension classifies to its kind, either case", () => {
    for (const [ext, kind] of EXPECTED) {
      expect(classifyFileKind(`/tmp/shot.${ext}`)).toBe(kind);
      expect(classifyFileKind(`/tmp/shot.${ext.toUpperCase()}`)).toBe(kind);
      expect(isViewableFile(`/tmp/shot.${ext}`)).toBe(true);
    }
  });

  test("unlisted, extensionless, and dotfile paths are text", () => {
    for (const path of [
      "/tmp/drawing.svg",
      "/tmp/main.rs",
      "/tmp/README",
      "/tmp/.env",
      "/tmp/archive.PNG.bak",
      "/tmp/notes.txt",
      "/tmp/raw.nef",
    ]) {
      expect(classifyFileKind(path)).toBe("text");
      expect(isViewableFile(path)).toBe(false);
    }
  });

  test("a dot in a directory name does not become the extension", () => {
    expect(classifyFileKind("/tmp/v1.2/README")).toBe("text");
    expect(classifyFileKind("/tmp/v1.2/shot.png")).toBe("image");
  });
});

describe("blobUrl", () => {
  test("percent-encodes the path into the blob route", () => {
    expect(blobUrl("/tmp/my shot.png")).toBe(
      "/api/fs/blob?path=%2Ftmp%2Fmy%20shot.png",
    );
  });
});

describe("elideFileName", () => {
  test("a name that fits is untouched", () => {
    expect(elideFileName("p.txt", 16)).toBe("p.txt");
    expect(elideFileName("image-1", 16)).toBe("image-1");
    // Exactly at the budget is still a fit.
    expect(elideFileName("0123456789abcdef", 16)).toBe("0123456789abcdef");
  });

  test("the cut is in the middle, and both ends survive", () => {
    const elided = elideFileName("Screenshot 2026-08-14 at 10.45.35 AM.png", 16);

    expect(elided).toHaveLength(16);
    // The subject at the front and the extension at the back — the two things
    // an end-ellipsis would have thrown away.
    expect(elided.startsWith("Screen")).toBe(true);
    expect(elided.endsWith(".png")).toBe(true);
    expect(elided).toBe("Screens…5 AM.png");
  });

  test("degenerate budgets do not produce nonsense", () => {
    expect(elideFileName("photograph.png", 1)).toBe("…");
    expect(elideFileName("photograph.png", 0)).toBe("…");
    expect(elideFileName("photograph.png", 2)).toBe("…g");
  });

  test("an astral character is never split into half a surrogate pair", () => {
    // Cutting by code unit would leave a lone surrogate here, which renders as
    // a replacement glyph rather than the emoji the file is named with.
    const elided = elideFileName("🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉 party.png", 12);

    expect(Array.from(elided)).toHaveLength(12);
    expect(elided).not.toContain("�");
    expect(elided.endsWith("ty.png")).toBe(true);
  });
});

describe("bytesUrl", () => {
  test("percent-encodes the path into the bytes route", () => {
    expect(bytesUrl("/tmp/my notes.txt")).toBe(
      "/api/fs/bytes?path=%2Ftmp%2Fmy%20notes.txt",
    );
  });

  test("it is a different route from blobUrl, for a different question", () => {
    // The distinction is load-bearing: `blob` types its response from an
    // extension table and refuses anything outside it, which is right for an
    // `<img src>` and wrong for reading an attachment's bytes to copy it.
    // Collapsing the two is how a `.txt` attachment became uncopyable.
    for (const path of ["/tmp/a.png", "/tmp/a.txt", "/tmp/a"]) {
      expect(bytesUrl(path)).not.toBe(blobUrl(path));
    }
  });
});
