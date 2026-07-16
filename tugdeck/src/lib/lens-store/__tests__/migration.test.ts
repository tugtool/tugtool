/**
 * Section-`kind` migration on hydrate. When a section is renamed, a user's
 * persisted arrangement state (order / hidden / collapsed) is keyed by the
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
  it("remaps a persisted 'changeset' kind to 'sessions' on hydrate", () => {
    setTugbankClient(
      fakeClient({
        [LENS_KEYS.SECTION_ORDER]: jsonArray(["changeset", "log", "telemetry"]),
        [LENS_KEYS.HIDDEN_SECTIONS]: jsonArray(["changeset"]),
        [LENS_KEYS.COLLAPSED_SECTIONS]: jsonArray(["changeset"]),
      }),
    );

    // getSnapshot triggers lazy _ensureInitialized -> _hydrateFromTugbank.
    const snap = lensStore.getSnapshot();

    expect(snap.sectionOrder).toEqual(["sessions", "log", "telemetry"]);
    expect(snap.hiddenSections).toEqual(["sessions"]);
    expect(snap.collapsedSections).toEqual(["sessions"]);
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
