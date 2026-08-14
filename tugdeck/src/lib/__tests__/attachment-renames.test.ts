/**
 * The buffer rewrite Save As applies when a migrated asset had to change name.
 *
 * The route resolves collisions at the destination — a `photo.png` already
 * sitting beside the saved document belongs to that document and is not ours
 * to overwrite — and reports what it renamed. This is the half that carries
 * that back into the document, and it is pure string work.
 */

import { describe, expect, test } from "bun:test";

import { applyAssetRenames } from "../attachment-upload";

describe("applyAssetRenames", () => {
  test("rewrites the destination and leaves the label alone", () => {
    const before = "Here it is: ![photo](assets/photo.png)\n";

    const after = applyAssetRenames(before, [
      { from: "assets/photo.png", to: "assets/photo-2.png" },
    ]);

    expect(after).toBe("Here it is: ![photo](assets/photo-2.png)\n");
    // The label is the name the user gave the file. A document that suddenly
    // says `photo-2` about a picture they know as `photo` is this feature's
    // collision bookkeeping leaking into their prose.
    expect(after).toContain("![photo]");
  });

  test("rewrites an angle-bracketed destination too", () => {
    const after = applyAssetRenames(
      "![my photo](<assets/my photo.png>)\n",
      [{ from: "assets/my photo.png", to: "assets/my photo-2.png" }],
    );

    expect(after).toBe("![my photo](<assets/my photo-2.png>)\n");
  });

  test("applies every rename, and leaves untouched links untouched", () => {
    const before =
      "![a](assets/a.png)\n![b](assets/b.png)\n![c](assets/c.png)\n";

    const after = applyAssetRenames(before, [
      { from: "assets/a.png", to: "assets/a-2.png" },
      { from: "assets/c.png", to: "assets/c-3.png" },
    ]);

    expect(after).toBe(
      "![a](assets/a-2.png)\n![b](assets/b.png)\n![c](assets/c-3.png)\n",
    );
  });

  test("an empty rename list is the common case and changes nothing", () => {
    // The relative link is stable across the move by construction, so the
    // document usually does not change at all.
    const before = "![photo](assets/photo.png)\n";
    expect(applyAssetRenames(before, [])).toBe(before);
  });

  test("prose that merely mentions the name is not rewritten", () => {
    // The rewrite is anchored on the link's parentheses, so a filename
    // discussed in the text survives.
    const before =
      "I put assets/photo.png in there.\n\n![photo](assets/photo.png)\n";

    const after = applyAssetRenames(before, [
      { from: "assets/photo.png", to: "assets/photo-2.png" },
    ]);

    expect(after).toBe(
      "I put assets/photo.png in there.\n\n![photo](assets/photo-2.png)\n",
    );
  });
});
