/**
 * Shell share gesture ([P08]) — the prompt-entry side, pinned through the
 * pure `applyShellShare` helper: the share text lands as an end-of-doc
 * insertion (as-is on an empty editor, appended on its own line over a
 * mid-compose draft). Code is the only resting mode now, so the gesture no
 * longer flips any route — it just computes the editor insertion.
 */
import { describe, expect, test } from "bun:test";

import { applyShellShare } from "@/components/tugways/tug-prompt-entry";

const SHARE_TEXT = "```\n$ ls\nout\n[exit 0]\n```\n";

describe("applyShellShare", () => {
  test("empty editor: the share text is the insertion, at offset 0", () => {
    const insertion = applyShellShare(SHARE_TEXT, {
      length: 0,
      isEffectivelyEmpty: true,
    });
    expect(insertion).toEqual({ from: 0, insert: SHARE_TEXT });
  });

  test("mid-compose draft: appended at end of doc on its own line, never clobbered", () => {
    const insertion = applyShellShare(SHARE_TEXT, {
      length: 12,
      isEffectivelyEmpty: false,
    });
    expect(insertion).toEqual({ from: 12, insert: `\n${SHARE_TEXT}` });
  });

  test("zero-length but not flagged empty still inserts as-is at offset 0", () => {
    const insertion = applyShellShare(SHARE_TEXT, {
      length: 0,
      isEffectivelyEmpty: false,
    });
    expect(insertion).toEqual({ from: 0, insert: SHARE_TEXT });
  });
});
