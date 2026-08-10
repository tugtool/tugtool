/**
 * text-card-save-text.test.ts — the Text card's save-state wording.
 *
 * Six wordings across two save contracts, and one displacement rule: an
 * unresolved conflict in manual mode outranks everything else the buffer
 * could say about itself.
 */

import { describe, test, expect } from "bun:test";

import { saveText } from "@/lib/text-card-save-text";

describe("saveText", () => {
  test("manual mode says Edited while dirty, automatic mode says Unsaved", () => {
    expect(saveText("manual", "editing", null, null)).toBe("Edited");
    expect(saveText("automatic", "editing", null, null)).toBe("Unsaved");
  });

  test("a write in flight says Saving… under either contract", () => {
    expect(saveText("manual", "writing", null, null)).toBe("Saving…");
    expect(saveText("automatic", "writing", null, null)).toBe("Saving…");
  });

  test("a clean buffer says Saved, and names the time once it has one", () => {
    expect(saveText("manual", "clean", null, null)).toBe("Saved");
    const at = new Date(2026, 7, 10, 12, 4, 11).getTime();
    expect(saveText("manual", "clean", null, at)).toBe(
      `Saved: ${new Date(at).toLocaleTimeString()}`,
    );
  });

  test("an unresolved manual conflict displaces the save state", () => {
    expect(saveText("manual", "editing", { reason: "hash" }, 1)).toBe(
      "File changed",
    );
    expect(saveText("manual", "clean", { reason: "missing" }, 1)).toBe(
      "File deleted",
    );
  });

  test("automatic mode has no conflict wording — its conflict is a banner", () => {
    expect(saveText("automatic", "clean", { reason: "hash" }, null)).toBe(
      "Saved",
    );
  });
});
