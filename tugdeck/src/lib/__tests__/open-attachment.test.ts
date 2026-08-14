/**
 * open-attachment.test.ts — the text-or-binary call behind ⌘-clicking a link.
 *
 * This decides whether a file opens in a Text card or bounces the user to the
 * Finder, so both failure directions are real: calling a `.zip` text paints its
 * bytes as mojibake in an editor, and calling a source file binary makes an
 * ordinary link stop opening.
 *
 * The fixtures are real bytes — actual file headers, actual encodings — not
 * strings chosen to satisfy the rule being tested.
 */

import { describe, expect, test } from "bun:test";

import { looksTextual } from "@/lib/open-attachment";

/** A file's real leading bytes. */
function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("looksTextual", () => {
  test("an empty file is text", () => {
    // An empty `.txt` should open in an editor, not bounce to the Finder.
    expect(looksTextual(new Uint8Array())).toBe(true);
  });

  test("ordinary documents are text", () => {
    expect(looksTextual(utf8("# Notes\n\nSome prose.\n"))).toBe(true);
    expect(looksTextual(utf8("a,b,c\r\n1,2,3\r\n"))).toBe(true);
    // Tabs and CRLF are text, and a file of them must not read as binary.
    expect(looksTextual(utf8("func\tmain() {\r\n\treturn\r\n}\r\n"))).toBe(true);
  });

  test("non-ASCII text is text", () => {
    // The reason this is a byte heuristic and not a UTF-8 validation: the
    // probe cuts at a fixed offset, so a multi-byte character straddling the
    // cut must not turn a document into a binary.
    expect(looksTextual(utf8("日本語のメモ\nEmoji: 🎉\n"))).toBe(true);
    const japanese = utf8("日本語のメモ");
    expect(looksTextual(japanese.slice(0, japanese.length - 1))).toBe(true);
  });

  test("real binary headers are binary", () => {
    // PK\3\4 — a zip, which is what prompted all of this.
    expect(looksTextual(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00))).toBe(
      false,
    );
    // \x89PNG\r\n\x1a\n
    expect(
      looksTextual(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe(false);
    // A Mach-O executable's magic, then a run of control bytes.
    expect(
      looksTextual(bytes(0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01)),
    ).toBe(false);
  });

  test("a NUL anywhere in the probe settles it", () => {
    // UTF-16 text is a document to its own editor and a binary to this app's:
    // the Text card reads UTF-8, so opening one would paint interleaved NULs.
    const utf16 = new Uint8Array(utf8("hello").length * 2);
    utf8("hello").forEach((byte, i) => {
      utf16[i * 2] = byte;
    });
    expect(looksTextual(utf16)).toBe(false);

    // Even far into an otherwise clean block.
    const mostlyText = utf8("x".repeat(4000) + "\0" + "y".repeat(4000));
    expect(looksTextual(mostlyText)).toBe(false);
  });

  test("a few control bytes do not condemn a text file", () => {
    // Form feeds and escapes appear in real text — a page-broken document, a
    // log with colour codes. Sparse ones must stay text.
    const withEscapes = utf8(
      "[32mgreen[0m\nnext page\n" +
        "ordinary prose ".repeat(40),
    );
    expect(Array.from(withEscapes)).toContain(0x1b);
    expect(Array.from(withEscapes)).toContain(0x0c);
    expect(looksTextual(withEscapes)).toBe(true);
  });

  test("a dense run of control bytes is binary even with no NUL", () => {
    // The second signal, on its own. Without it a binary format that happens
    // to carry no NUL in its first block would be handed to an editor.
    const dense = new Uint8Array(600);
    for (let i = 0; i < dense.length; i += 1) {
      // 0x01…0x08 cycling, printable bytes between, and never a NUL.
      dense[i] = i % 3 === 0 ? 0x41 : (i % 8) + 1;
    }
    expect(dense.includes(0)).toBe(false);
    expect(looksTextual(dense)).toBe(false);
  });
});
