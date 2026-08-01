/**
 * Section-`kind` migration on hydrate. When a section is renamed, a user's
 * persisted arrangement state (order / collapsed) is keyed by the
 * OLD kind string in tugbank. `LensStore` remaps known-renamed kinds as it
 * hydrates so that state is not silently lost.
 *
 * Drives the real `_hydrateFromTugbank` path by injecting a fake tugbank
 * client that returns persisted `"changeset"` values, then asserts the
 * hydrated snapshot is keyed by the new `"sessions"` kind.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { lensStore } from "@/lib/lens-store/lens-store";
import { LENS_DOMAIN, LENS_KEYS } from "@/lib/lens-store/types";
import {
  setTugbankClient,
  getTugbankClient,
} from "@/lib/tugbank-singleton";
import type { TugbankClient, TaggedValue } from "@/lib/tugbank-client";

function jsonArray(value: string[]): TaggedValue {
  return { kind: "json", value } as TaggedValue;
}

/** A minimal tugbank client returning fixed persisted values for the lens
 *  domain — only `get` / `onDomainChanged` are touched during hydrate. */
function fakeClient(stored: Record<string, TaggedValue>): TugbankClient {
  return {
    get(domain: string, key: string): TaggedValue | undefined {
      if (domain !== LENS_DOMAIN) return undefined;
      return stored[key];
    },
    onDomainChanged(): () => void {
      return () => {};
    },
  } as unknown as TugbankClient;
}

let originalClient: TugbankClient | null;

beforeEach(() => {
  originalClient = getTugbankClient();
  (lensStore as unknown as { _disposeForTest: () => void })._disposeForTest();
});

afterEach(() => {
  setTugbankClient(originalClient);
  (lensStore as unknown as { _disposeForTest: () => void })._disposeForTest();
});

describe("LensStore — section-kind migration", () => {
  it("remaps a persisted 'changeset' kind straight to 'cards' on hydrate", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.SECTION_ORDER]: jsonArray(["changeset", "log", "telemetry"]),
        [LENS_KEYS.COLLAPSED_SECTIONS]: jsonArray(["changeset"]),
      }),
    );

    // getSnapshot triggers lazy _ensureInitialized -> _hydrateFromTugbank.
    const snap = lensStore.getSnapshot();

    expect(snap.sectionOrder).toEqual(["cards", "log", "telemetry"]);
    expect(snap.collapsedSections).toEqual(["cards"]);
  });

  it("remaps a persisted 'text-files' kind straight to 'cards' on hydrate", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.SECTION_ORDER]: jsonArray([
          "sessions",
          "snippets",
          "text-files",
          "layouts",
        ]),
        [LENS_KEYS.COLLAPSED_SECTIONS]: jsonArray(["text-files"]),
      }),
    );

    const snap = lensStore.getSnapshot();

    // Both the old Sessions kind and the old Text Files kind land on "cards";
    // `resolveSectionRenderOrder` dedupes the doubled entry.
    expect(snap.sectionOrder).toEqual([
      "cards",
      "snippets",
      "cards",
      "layouts",
    ]);
    expect(snap.collapsedSections).toEqual(["cards"]);
  });

  it("leaves unknown kinds untouched", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.SECTION_ORDER]: jsonArray(["log", "telemetry", "git_history"]),
      }),
    );

    const snap = lensStore.getSnapshot();
    expect(snap.sectionOrder).toEqual(["log", "telemetry", "git_history"]);
  });
});

describe("LensStore — cardsRowOrder seeding from the legacy keys", () => {
  it("a fresh install starts with every group empty", () => {
    setTugbankClient(fakeClient({}));

    const snap = lensStore.getSnapshot();

    expect(snap.cardsRowOrder).toEqual({
      sessions: [],
      files: [],
      tools: [],
    });
  });

  it("seeds sessions and files from the two lists it supersedes", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.SESSION_ORDER]: jsonArray(["s2", "s1"]),
        [LENS_KEYS.TEXT_FILE_ORDER]: jsonArray(["card-b", "card-a"]),
      }),
    );

    const snap = lensStore.getSnapshot();

    expect(snap.cardsRowOrder).toEqual({
      sessions: ["s2", "s1"],
      files: ["card-b", "card-a"],
      tools: [],
    });
  });

  it("seeds from whichever legacy list exists alone", () => {
    setTugbankClient(
      fakeClient({ [LENS_KEYS.SESSION_ORDER]: jsonArray(["s1"]) }),
    );

    const snap = lensStore.getSnapshot();

    expect(snap.cardsRowOrder).toEqual({
      sessions: ["s1"],
      files: [],
      tools: [],
    });
  });

  it("a stored cardsRowOrder wins over the legacy keys", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.SESSION_ORDER]: jsonArray(["legacy"]),
        [LENS_KEYS.TEXT_FILE_ORDER]: jsonArray(["legacy-file"]),
        [LENS_KEYS.CARDS_ROW_ORDER]: {
          kind: "json",
          value: { sessions: ["s9"], files: ["f9"], tools: ["t9"] },
        } as TaggedValue,
      }),
    );

    const snap = lensStore.getSnapshot();

    expect(snap.cardsRowOrder).toEqual({
      sessions: ["s9"],
      files: ["f9"],
      tools: ["t9"],
    });
  });

  it("a stored record missing a group reads that group as empty", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.CARDS_ROW_ORDER]: {
          kind: "json",
          value: { sessions: ["s9"] },
        } as TaggedValue,
      }),
    );

    const snap = lensStore.getSnapshot();

    expect(snap.cardsRowOrder).toEqual({
      sessions: ["s9"],
      files: [],
      tools: [],
    });
  });

  it("a malformed group list rejects the whole record and falls back to the legacy seed", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.SESSION_ORDER]: jsonArray(["s1"]),
        [LENS_KEYS.CARDS_ROW_ORDER]: {
          kind: "json",
          value: { sessions: ["ok"], files: [7], tools: [] },
        } as TaggedValue,
      }),
    );

    const snap = lensStore.getSnapshot();

    expect(snap.cardsRowOrder).toEqual({
      sessions: ["s1"],
      files: [],
      tools: [],
    });
  });

  it("hydrates the collapsed-group list", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.CARDS_COLLAPSED_GROUPS]: jsonArray(["tools"]),
      }),
    );

    expect(lensStore.getSnapshot().collapsedCardGroups).toEqual(["tools"]);
  });
});
