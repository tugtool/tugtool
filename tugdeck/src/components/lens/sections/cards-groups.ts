/**
 * cards-groups.ts — which group a card's pane row files under in the Lens.
 *
 * The Lens's Cards section is a mirror of the deck canvas, and it buckets pane
 * rows into three groups: Sessions, Files, Tools. The bucket is read off the
 * card registry rather than from a table kept here, so a card type declares its
 * own Lens home the same way it declares its type-picker category.
 *
 * Resolution runs in three steps, first hit wins:
 *
 *   1. an explicit `lensGroup` on the registration
 *   2. `category.label === "Files"` → `"files"` (the type-picker taxonomy
 *      already says so — the Diff card is registered exactly this way)
 *   3. `"tools"`
 *
 * The final fallback makes coverage total by construction: a card type cannot
 * be registered without resolving somewhere. `__tests__/cards-groups.test.ts`
 * then pins the specific mapping for every registration so drift is caught.
 *
 * @module components/lens/sections/cards-groups
 */

import type { CardRegistration } from "@/card-registry";

/** A group in the Lens's Cards section. */
export type LensCardsGroup = "sessions" | "files" | "tools";

/**
 * The order groups render in. Sessions above Files reproduces the order the
 * two retired sections stood in, so the section reads as a refinement of what
 * was there rather than a rearrangement.
 */
export const GROUP_ORDER: readonly LensCardsGroup[] = [
  "sessions",
  "files",
  "tools",
];

/** Display titles for the group header rows. */
export const GROUP_TITLES: Readonly<Record<LensCardsGroup, string>> = {
  sessions: "Sessions",
  files: "Files",
  tools: "Tools",
};

/**
 * The group `reg`'s cards file under, or `"none"` for a card that has no Lens
 * representation at all (the Lens itself — the mirror does not reflect itself).
 */
export function resolveLensGroup(
  reg: CardRegistration,
): LensCardsGroup | "none" {
  if (reg.lensGroup !== undefined) return reg.lensGroup;
  if (reg.category?.label === "Files") return "files";
  return "tools";
}
