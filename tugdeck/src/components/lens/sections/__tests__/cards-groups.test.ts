/**
 * Coverage for the Lens group taxonomy.
 *
 * The Cards section's promise is that *every* card on the deck has a Lens
 * representation. That promise is only as good as the resolution being total,
 * so this file registers the whole app's card set — the same entry points
 * `main.tsx` calls — and then asserts two things:
 *
 *   - **Totality.** Every registration resolves to a group or to the explicit
 *     `"none"` exclusion, and `lens` is the only exclusion.
 *   - **The mapping.** Each known componentId lands in the group it should.
 *     Totality alone would be satisfied by resolving everything to `"tools"`;
 *     these pins are what catch a card drifting into the wrong bucket.
 *
 * A new card type added without thought still resolves (the `"tools"`
 * fallback), but it fails the mapping assertion below until someone decides
 * where it belongs — which is the point.
 */

import { beforeAll, describe, expect, test } from "bun:test";

import {
  _resetForTest,
  getAllRegistrations,
  getRegistration,
} from "@/card-registry";
import { registerHelloWorldCard } from "@/components/tugways/cards/hello-world-card";
import { registerSessionCard } from "@/components/tugways/cards/session-card-registration";
import { registerAboutCard } from "@/components/tugways/cards/about-card";
import { registerSettingsCard } from "@/components/tugways/cards/settings-card";
import { registerDevtoolsCard } from "@/components/devtools/devtools-card";
import { registerLensCard } from "@/components/lens/lens-register-card";
import { registerTextCard } from "@/components/tugways/cards/text-card-registration";
import { registerFileViewCard } from "@/components/tugways/cards/file-view-card-registration";
import { registerDiffCard } from "@/components/tugways/cards/diff-card";
import { registerGalleryCards } from "@/components/tugways/cards/gallery-registrations";

import { GROUP_ORDER, GROUP_TITLES, resolveLensGroup } from "../cards-groups";

// bun shares module state across test files, so register from scratch.
beforeAll(() => {
  _resetForTest();
  registerHelloWorldCard();
  registerSessionCard();
  registerAboutCard();
  registerSettingsCard();
  registerDevtoolsCard();
  registerLensCard();
  registerTextCard();
  registerFileViewCard();
  registerDiffCard();
  registerGalleryCards();
});

/** componentId → the group it must resolve to, and how it gets there. */
const PINS: ReadonlyArray<{
  componentId: string;
  group: string;
  via: string;
}> = [
  { componentId: "session", group: "sessions", via: "explicit lensGroup" },
  { componentId: "text", group: "files", via: "explicit lensGroup" },
  { componentId: "file-view", group: "files", via: "explicit lensGroup" },
  { componentId: "diff", group: "files", via: "category.label" },
  { componentId: "settings", group: "tools", via: "fallback" },
  { componentId: "about", group: "tools", via: "fallback" },
  { componentId: "devtools", group: "tools", via: "fallback" },
  { componentId: "hello", group: "tools", via: "fallback" },
  { componentId: "lens", group: "none", via: "explicit lensGroup" },
];

describe("resolveLensGroup — the mapping", () => {
  for (const pin of PINS) {
    test(`${pin.componentId} → ${pin.group} (${pin.via})`, () => {
      const reg = getRegistration(pin.componentId);
      expect(reg).toBeDefined();
      expect(resolveLensGroup(reg!)).toBe(pin.group as never);
    });
  }

  test("diff resolves through its type-picker category, not a declaration", () => {
    const reg = getRegistration("diff")!;
    expect(reg.lensGroup).toBeUndefined();
    expect(reg.category?.label).toBe("Files");
  });

  test("every gallery card lands in tools", () => {
    const gallery = [...getAllRegistrations().values()].filter((reg) =>
      reg.componentId.startsWith("gallery-"),
    );
    expect(gallery.length).toBeGreaterThan(0);
    for (const reg of gallery) {
      expect(resolveLensGroup(reg)).toBe("tools");
    }
  });
});

describe("resolveLensGroup — totality", () => {
  test("every registration resolves to a group or to none", () => {
    const registrations = [...getAllRegistrations().values()];
    expect(registrations.length).toBeGreaterThan(0);
    const legal = new Set<string>([...GROUP_ORDER, "none"]);
    for (const reg of registrations) {
      expect(legal.has(resolveLensGroup(reg))).toBe(true);
    }
  });

  test("the Lens is the only card excluded from its own mirror", () => {
    const excluded = [...getAllRegistrations().values()]
      .filter((reg) => resolveLensGroup(reg) === "none")
      .map((reg) => reg.componentId);
    expect(excluded).toEqual(["lens"]);
  });
});

describe("group order and titles", () => {
  test("groups render sessions, files, tools", () => {
    expect(GROUP_ORDER).toEqual(["sessions", "files", "tools"]);
  });

  test("every group has a title", () => {
    for (const group of GROUP_ORDER) {
      expect(GROUP_TITLES[group].length).toBeGreaterThan(0);
    }
  });
});
