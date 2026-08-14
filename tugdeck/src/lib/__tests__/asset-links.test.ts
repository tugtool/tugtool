import { describe, expect, test } from "bun:test";

import {
  decodeLinkDestination,
  directoryOf,
  encodeLinkDestination,
  parseAssetLinks,
  resolveAssetPath,
  resolveRelativePath,
} from "../asset-links";

describe("parseAssetLinks", () => {
  test("parses bare, angle-bracketed, and percent-encoded destinations", () => {
    // All three forms name the same file. The percent-encoded one is what the
    // shipped version wrote, and documents holding it must keep working.
    const text = [
      "![a](assets/photo.png)",
      "![b](<assets/my photo.png>)",
      "![c](assets/my%20photo.png)",
    ].join("\n");

    const refs = parseAssetLinks(text);

    expect(refs.map((r) => r.destination)).toEqual([
      "assets/photo.png",
      "assets/my photo.png",
      "assets/my photo.png",
    ]);
  });

  test("an image link and a plain link are distinguished", () => {
    const refs = parseAssetLinks("![pic](assets/a.png) and [notes](assets/n.zip)");

    expect(refs.map((r) => ({ label: r.label, isImage: r.isImage }))).toEqual([
      { label: "pic", isImage: true },
      { label: "notes", isImage: false },
    ]);
  });

  test("reports the range the whole link occupies", () => {
    const text = "before ![pic](assets/a.png) after";
    const [ref] = parseAssetLinks(text);

    expect(text.slice(ref.from, ref.to)).toBe("![pic](assets/a.png)");
  });

  test("a destination that is not valid percent-encoding is left alone", () => {
    // `decodeURIComponent` throws on a bare `%`; a filename with one in it must
    // not take the whole strip down with it.
    const [ref] = parseAssetLinks("[deal](<assets/50% off.png>)");

    expect(ref.destination).toBe("assets/50% off.png");
  });

  test("an empty destination is not a link to anything", () => {
    expect(parseAssetLinks("[nothing]()")).toEqual([]);
  });
});

describe("encodeLinkDestination", () => {
  test("round-trips a name with spaces without percent-escapes", () => {
    const name = "assets/Screenshot 2026-08-14 at 6.54.47 AM.png";
    const encoded = encodeLinkDestination(name);

    expect(encoded).not.toContain("%");
    expect(encoded).toBe("<assets/Screenshot 2026-08-14 at 6.54.47 AM.png>");
    expect(decodeLinkDestination(encoded)).toBe(name);
    expect(parseAssetLinks(`![s](${encoded})`)[0].destination).toBe(name);
  });

  test("leaves an ordinary name bare", () => {
    expect(encodeLinkDestination("assets/photo.png")).toBe("assets/photo.png");
  });

  test("wraps a name holding parentheses, which would close the link early", () => {
    const encoded = encodeLinkDestination("assets/photo (2).png");

    expect(encoded).toBe("<assets/photo (2).png>");
    expect(parseAssetLinks(`![p](${encoded})`)[0].destination).toBe(
      "assets/photo (2).png",
    );
  });

  test("percent-encodes only the two characters angle brackets cannot hold", () => {
    const encoded = encodeLinkDestination("assets/a<b>c.png");

    expect(encoded).toBe("<assets/a%3Cb%3Ec.png>");
    expect(decodeLinkDestination(encoded)).toBe("assets/a<b>c.png");
  });
});

describe("resolveRelativePath", () => {
  test("resolves a plain relative destination against the base", () => {
    expect(resolveRelativePath("/u/docs", "assets/photo.png")).toBe(
      "/u/docs/assets/photo.png",
    );
    // Not `assets/`-scoped, and that is fine here — Cmd-click follows any
    // in-tree relative link.
    expect(resolveRelativePath("/u/docs", "images/diagram.png")).toBe(
      "/u/docs/images/diagram.png",
    );
  });

  test("refuses urls, anchors, absolute paths, and dot-dot destinations", () => {
    for (const destination of [
      "https://example.com/a.png",
      "mailto:someone@example.com",
      "#heading",
      "/etc/passwd",
      "../assets/photo.png",
      "assets/../../escape.png",
      "assets//photo.png",
      "./assets/photo.png",
      "",
    ]) {
      expect(resolveRelativePath("/u/docs", destination)).toBeNull();
    }
  });

  test("has no answer without a base", () => {
    expect(resolveRelativePath(null, "assets/photo.png")).toBeNull();
    expect(resolveRelativePath("", "assets/photo.png")).toBeNull();
  });
});

describe("resolveAssetPath", () => {
  test("only assets-scoped destinations resolve", () => {
    expect(resolveAssetPath("/u/docs", "assets/photo.png")).toBe(
      "/u/docs/assets/photo.png",
    );
    // These are ordinary relative links between documents, not attachments —
    // projecting them would fill the strip with tiles that are not files this
    // feature put anywhere.
    expect(resolveAssetPath("/u/docs", "other/x.png")).toBeNull();
    expect(resolveAssetPath("/u/docs", "../assets/x.png")).toBeNull();
    expect(resolveAssetPath("/u/docs", "assets")).toBeNull();
    expect(resolveAssetPath("/u/docs", "notes.md")).toBeNull();
  });

  test("a nested path under assets still resolves", () => {
    expect(resolveAssetPath("/u/docs", "assets/sub/photo.png")).toBe(
      "/u/docs/assets/sub/photo.png",
    );
  });
});

describe("directoryOf", () => {
  test("names the directory holding a file", () => {
    expect(directoryOf("/u/docs/notes.md")).toBe("/u/docs");
    expect(directoryOf("/notes.md")).toBeNull();
    expect(directoryOf("notes.md")).toBeNull();
  });
});
