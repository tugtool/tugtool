/**
 * Pure-logic coverage for the annotator's URL admission gate.
 *
 * Link *detection* belongs to linkifyjs and the anchors it produces are
 * verified in the real app (project policy: no fake-DOM render tests).
 * What this file pins is the gate layered on top of it — the reason the
 * annotator does not turn every dotted filename in transcript ink into a
 * link. Without it, `tuglaws.md` linkifies as a `.md` domain.
 */

import { describe, expect, test } from "bun:test";

import { hasUrlScheme } from "../url-grammar";

describe("hasUrlScheme — admits explicit schemes", () => {
  const admitted = [
    "https://status.claude.com",
    "http://localhost:8787/api/fs/stat",
    "https://example.com/a/b?c=d#e",
    "file:///Users/kocienda/x.txt",
    "HTTPS://SHOUTING.EXAMPLE.COM",
    "vscode-insiders://open",
  ] as const;

  for (const input of admitted) {
    test(input, () => {
      expect(hasUrlScheme(input)).toBe(true);
    });
  }
});

describe("hasUrlScheme — rejects the bare hosts linkify would claim", () => {
  const rejected = [
    ["a prose filename", "tuglaws.md"],
    ["a path-shaped filename", "tuglaws/tuglaws.md"],
    ["a source file", "foo.ts"],
    ["a bare registered TLD host", "example.com"],
    ["a www host with no scheme", "www.example.com"],
    ["a scheme with no authority", "mailto:kocienda@pobox.com"],
    ["a colon that is not a scheme separator", "lib/foo.ts:212"],
    ["empty string", ""],
  ] as const;

  for (const [label, input] of rejected) {
    test(label, () => {
      expect(hasUrlScheme(input)).toBe(false);
    });
  }
});
