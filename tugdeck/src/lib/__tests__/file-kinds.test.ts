/**
 * file-kinds.test.ts — the extension allowlist that decides whether a path
 * opens into a Text card or a viewer card, and the blob URL viewer cards
 * point at.
 */

import { describe, expect, test } from "bun:test";
import {
  VIEWABLE_EXTENSIONS,
  blobUrl,
  classifyFileKind,
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
