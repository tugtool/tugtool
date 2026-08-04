/**
 * pane-title.ts — the one place a pane's title-bar string is produced.
 *
 * A pane's title is not any single stored field. It is composed from three
 * sources, and every surface that names a pane has to compose them the same
 * way or it will name the same pane differently:
 *
 *   1. the **registry title** of the pane's active card (`CardMeta.title`) —
 *      the static label baked in at card-type definition time ("File",
 *      "Diff", "Chain Actions"), which is the empty string for card types
 *      whose identity is entirely dynamic (the Session card);
 *   2. the **pane title** (`TugPaneState.title`), the group name a multi-tab
 *      pane carries, which prefixes the registry title;
 *   3. the **live override** a card publishes on {@link cardTitleStore} once
 *      its identity resolves — the Session card's bound project path, for
 *      instance — which is the whole title when there is no static base.
 *
 * Before this module existed the composition lived inside `CardTitleBar`'s
 * render and a *different*, simpler rule (`CardState.title` with a fallback
 * chain) lived in the menu-state projection. They disagreed exactly where it
 * was most visible: a Session card's title bar read `test-repo/petit-thaw`
 * while every list naming that same pane read `Untitled`, because only the
 * title bar consulted the override store.
 *
 * So the rule lives here once, in two layers:
 *
 *   - {@link composePaneTitleBarText} is the rule itself, pure, over the
 *     three parts. `CardTitleBar` calls this, because it already holds all
 *     three (it resolves its own meta and subscribes to its own override).
 *   - {@link paneTitleBarTextFor} is the same rule for callers *outside* the
 *     pane, which hold a `TugPaneState` and the deck's cards rather than
 *     resolved parts. It does the registry lookup and the override read, then
 *     delegates.
 *
 * **Laws:** the override read makes {@link paneTitleBarTextFor} a function of
 * store state as well as its arguments, so a React caller must subscribe to
 * `cardTitleStore` for its rows to repaint when an override lands — the
 * store's `version()` exists for exactly that, and reading it through
 * `useSyncExternalStore` is what keeps [L02] intact. A non-React caller (the
 * menu-state projection) re-projects from its own subscription instead.
 *
 * @module lib/pane-title
 */

import type { CardState, TugPaneState } from "../layout-tree";
import { getRegistration } from "../card-registry";
import { cardTitleStore } from "./card-title-store";

/** Shown when a pane resolves to no name at all. */
const UNTITLED = "Untitled";

/**
 * The exact string a pane's title bar renders, from its three parts.
 *
 * - `metaTitle` alone when nothing else is present.
 * - `"<paneTitle> : <metaTitle>"` when the pane carries a group name.
 * - `"<base> : <override>"` when a card has published an override, or the
 *   override alone when there is no static base to prefix it with.
 */
export function composePaneTitleBarText(args: {
  /** The active card's registry title. May be empty. */
  metaTitle: string;
  /** The pane's own group name — multi-tab panes only. May be empty. */
  paneTitle?: string | undefined;
  /** The active card's live title override, when it has published one. */
  titleOverride?: string | null | undefined;
}): string {
  const { metaTitle, paneTitle, titleOverride } = args;
  const base = paneTitle ? `${paneTitle} : ${metaTitle}` : metaTitle;
  if (!titleOverride) return base;
  return base ? `${base} : ${titleOverride}` : titleOverride;
}

/**
 * The same string, resolved for a caller that holds deck state rather than
 * the composed parts — the deck canvas building a slot-stack picker, or the
 * host menu-state projection naming panes for the Window menu.
 *
 * Falls back to `"Untitled"` only when the composition yields nothing at all,
 * which is a pane whose active card has neither a registry title nor an
 * override. A title bar in that state renders empty; a *list* cannot, because
 * a nameless row is unpickable.
 */
export function paneTitleBarTextFor(
  pane: TugPaneState,
  cardsById: ReadonlyMap<string, CardState>,
): string {
  const activeCard = cardsById.get(pane.activeCardId);
  const registration = activeCard
    ? getRegistration(activeCard.componentId)
    : undefined;
  return (
    composePaneTitleBarText({
      metaTitle: registration?.defaultMeta.title ?? "",
      // Only a multi-tab pane's group name prefixes the title, matching
      // what `CardTitleBar` is handed.
      paneTitle: pane.cardIds.length > 1 ? pane.title : undefined,
      titleOverride: cardTitleStore.get(pane.activeCardId),
    }) || UNTITLED
  );
}
