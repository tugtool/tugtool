/**
 * tug-prompt-entry — submit-strip + persistence migration unit tests.
 *
 * Two pure helpers exposed by `tug-prompt-entry.tsx`:
 *
 *   - `computeSubmitText(text, route, aliasMap)` — strips a single
 *     leading prefix character iff it maps to the active route per
 *     [Q09]=a.
 *   - `coerceRestorePayload(raw)` — accepts a restored bag, narrows
 *     it to the canonical `{ route, draft, maximized? }` shape, and
 *     migrates legacy `{ currentRoute, perRoute }` payloads forward
 *     by mapping `perRoute[currentRoute]` onto `draft` and dropping
 *     drafts for other routes per [Q07]=a.
 *
 * Pure helpers — no mounting required.
 */
import { describe, it, expect } from "bun:test";

import {
  coerceRestorePayload,
  computeSubmitText,
} from "@/components/tugways/tug-prompt-entry";
import type { TugTextEditingState } from "@/lib/tug-text-types";

const ALIAS_MAP = {
  "❯": "❯",
  ">": "❯",
  "$": "$",
  ":": ":",
} as const;

// ---------------------------------------------------------------------------
// computeSubmitText — strip-on-match per [Q09]=a
// ---------------------------------------------------------------------------

describe("computeSubmitText — strip-on-match", () => {
  it("doc=`> hello`, route=`❯` → strips the `>` prefix", () => {
    expect(computeSubmitText("> hello", "❯", ALIAS_MAP)).toBe(" hello");
  });

  it("doc=`> hello`, route=`$` → returns text verbatim", () => {
    expect(computeSubmitText("> hello", "$", ALIAS_MAP)).toBe("> hello");
  });

  it("doc=`hello`, route=`❯` → returns text verbatim (no leading prefix)", () => {
    expect(computeSubmitText("hello", "❯", ALIAS_MAP)).toBe("hello");
  });

  it("doc=``, route=`❯` → returns empty string verbatim", () => {
    expect(computeSubmitText("", "❯", ALIAS_MAP)).toBe("");
  });

  it("doc=`$ ls`, route=`$` → strips the `$`", () => {
    expect(computeSubmitText("$ ls", "$", ALIAS_MAP)).toBe(" ls");
  });

  it("doc=`:save`, route=`:` → strips the `:`", () => {
    expect(computeSubmitText(":save", ":", ALIAS_MAP)).toBe("save");
  });

  it("doc=`❯ hi`, route=`❯` → strips the `❯` (display character also matches)", () => {
    expect(computeSubmitText("❯ hi", "❯", ALIAS_MAP)).toBe(" hi");
  });

  it("strip removes ONLY the first character (no recursion)", () => {
    // `>>foo` strips one `>` → `>foo`. The remaining `>` stays put.
    expect(computeSubmitText(">>foo", "❯", ALIAS_MAP)).toBe(">foo");
  });
});

// ---------------------------------------------------------------------------
// coerceRestorePayload — migration from legacy `perRoute` shape
// ---------------------------------------------------------------------------

describe("coerceRestorePayload — new shape", () => {
  it("passes a well-formed new payload through unchanged", () => {
    const draft: TugTextEditingState = {
      text: "hello",
      atoms: [],
      selection: { start: 5, end: 5 },
    };
    const result = coerceRestorePayload({
      route: "$",
      draft,
      maximized: true,
    });
    expect(result.route).toBe("$");
    expect(result.draft).toEqual(draft);
    expect(result.maximized).toBe(true);
  });

  it("defaults maximized to false when omitted", () => {
    const result = coerceRestorePayload({
      route: ":",
      draft: null,
    });
    expect(result.maximized).toBe(false);
  });

  it("treats a malformed draft as null", () => {
    const result = coerceRestorePayload({
      route: "$",
      draft: { text: 42 } as unknown,
    });
    expect(result.draft).toBeNull();
  });
});

describe("coerceRestorePayload — legacy `perRoute` migration", () => {
  it("maps perRoute[currentRoute] onto draft and drops other drafts", () => {
    const codeDraft: TugTextEditingState = {
      text: "code text",
      atoms: [],
      selection: null,
    };
    const shellDraft: TugTextEditingState = {
      text: "shell text",
      atoms: [],
      selection: null,
    };
    const result = coerceRestorePayload({
      currentRoute: "$",
      perRoute: {
        "❯": codeDraft,
        "$": shellDraft,
        ":": { text: "cmd", atoms: [], selection: null },
      },
      maximized: false,
    });
    expect(result.route).toBe("$");
    expect(result.draft).toEqual(shellDraft);
    // The Code and Command drafts are dropped per [Q07]=a; only the
    // current-route draft survives migration.
    expect(result.maximized).toBe(false);
  });

  it("returns a null draft when perRoute has no entry for currentRoute", () => {
    const result = coerceRestorePayload({
      currentRoute: "$",
      perRoute: {
        "❯": { text: "code", atoms: [], selection: null },
      },
    });
    expect(result.route).toBe("$");
    expect(result.draft).toBeNull();
  });
});

describe("coerceRestorePayload — defaults", () => {
  it("returns the default shape for null", () => {
    const result = coerceRestorePayload(null);
    expect(result.route).toBe("❯");
    expect(result.draft).toBeNull();
    expect(result.maximized).toBe(false);
  });

  it("returns the default shape for a non-object", () => {
    const result = coerceRestorePayload(42);
    expect(result.route).toBe("❯");
    expect(result.draft).toBeNull();
  });

  it("returns the default shape for an empty object", () => {
    const result = coerceRestorePayload({});
    expect(result.route).toBe("❯");
    expect(result.draft).toBeNull();
  });
});
