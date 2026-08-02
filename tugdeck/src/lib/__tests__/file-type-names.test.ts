/**
 * file-type-names.test.ts — what a kind of file is called, and which files
 * count as the same kind.
 */

import { describe, expect, test } from "bun:test";
import { VIEWABLE_EXTENSIONS } from "@/lib/file-kinds";
import { countedFileType, fileTypeName } from "@/lib/file-type-names";

describe("fileTypeName", () => {
  test("a named extension gets its own word, not its extension", () => {
    expect(fileTypeName("/x/notes.md").one).toBe("Markdown");
    expect(fileTypeName("/x/main.rs").one).toBe("Rust");
    expect(fileTypeName("/x/AppDelegate.swift").one).toBe("Swift");
    expect(fileTypeName("/x/paper.pdf").one).toBe("PDF");
  });

  test("every viewable image is one kind, whatever its format", () => {
    const keys = new Set(
      Object.entries(VIEWABLE_EXTENSIONS)
        .filter(([, kind]) => kind === "image")
        .map(([ext]) => fileTypeName(`/x/a.${ext}`).key),
    );
    expect([...keys]).toEqual(["image"]);
    // SVG is not in the viewer allowlist (it opens as text) but it is still an
    // image to a reader counting a folder.
    expect(fileTypeName("/x/logo.svg").key).toBe("image");
  });

  test("spellings of one language share a bucket", () => {
    expect(fileTypeName("/x/a.ts").key).toBe(fileTypeName("/x/b.tsx").key);
    expect(fileTypeName("/x/a.yml").key).toBe(fileTypeName("/x/b.yaml").key);
    expect(fileTypeName("/x/a.cpp").key).toBe(fileTypeName("/x/b.hpp").key);
    expect(fileTypeName("/x/a.cpp").key).not.toBe(fileTypeName("/x/b.c").key);
  });

  test("the extension's case never reaches the reader", () => {
    expect(fileTypeName("/x/READ.MD")).toEqual(fileTypeName("/x/read.md"));
  });

  test("no extension, and no path at all, are both text", () => {
    expect(fileTypeName("/x/Makefile").key).toBe("text");
    expect(fileTypeName("/x/.env").key).toBe("text");
    expect(fileTypeName(null).key).toBe("text");
  });

  test("an unnamed extension keeps itself, uppercased", () => {
    expect(fileTypeName("/x/data.parquet")).toEqual({
      key: "parquet",
      one: "PARQUET",
      many: "PARQUET",
    });
  });
});

describe("countedFileType", () => {
  test("only the types with a real plural take one", () => {
    expect(countedFileType(fileTypeName("/x/a.png"), 1)).toBe("1 Image");
    expect(countedFileType(fileTypeName("/x/a.png"), 4)).toBe("4 Images");
    expect(countedFileType(fileTypeName("/x/a.pdf"), 2)).toBe("2 PDFs");
    // A mass noun stays as it is — "4 Markdowns" is not a thing anyone says.
    expect(countedFileType(fileTypeName("/x/a.md"), 4)).toBe("4 Markdown");
    expect(countedFileType(fileTypeName("/x/a.txt"), 3)).toBe("3 Text");
  });
});
