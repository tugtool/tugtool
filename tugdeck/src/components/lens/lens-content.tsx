/**
 * lens-content.tsx — the Lens card's content: a single vertical scroll
 * of reorderable, collapsible sections.
 *
 * Hosted by the normal `CardHost` inside an anchored pane (the Lens
 * rail). This file is the ordinary registered card's content component;
 * it owns nothing about geometry or chrome (those belong to the pane per
 * [L25]/[L09]).
 *
 * Responsibilities:
 *   - Derive the visible sections + order from `lensStore` over the
 *     registered sections ([L02] via `useSyncExternalStore`).
 *   - Drag-reorder sections from their grips: a DOM-only live preview
 *     (flex `order`) during the drag, committing `lensStore.setSectionOrder`
 *     only on drop ([P08], [L06]/[L08]).
 *   - Keep the FocusManager group-walk order in lock-step with the
 *     rendered order via `setGroupOrder` ([P08], [L22]).
 *   - Focus-out on Escape: a content-local `CANCEL_DIALOG` responder
 *     re-dispatches `FOCUS_LENS` (the deck-canvas toggle-out restores the
 *     stashed prior card, [P05]). It lives here, NOT at the deck-canvas
 *     level, so it is only in the chain when focus is actually inside the
 *     Lens — a deck-canvas `CANCEL_DIALOG` entry would consume every
 *     Escape (marking it handled → preventDefault), blocking unrelated
 *     Escape gestures such as a mid-drag abort.
 *
 * @module components/lens/lens-content
 */

import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { lensStore } from "@/lib/lens-store/lens-store";
import { paneTitleBarMenuStore } from "@/lib/pane-title-bar-menu-store";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { useResponder } from "@/components/tugways/use-responder";
import { dispatchAction } from "@/action-dispatch";
import {
  useFocusManager,
  useSeedKeyView,
} from "@/components/tugways/use-focusable";
import {
  getRegisteredLensSections,
  resolveSectionRenderOrder,
  sectionFocusGroup,
  type LensSectionDefinition,
  type LensSectionHost,
} from "./lens-section-registry";
import { LensSection } from "./lens-section-band";
import { useBlockReorder } from "./block-reorder";
import { BlockDropCaret } from "./block-drop-caret";
import {
  LensFollowedCardContext,
  useTrackLastNonLensKeyCard,
} from "./lens-followed-card";
import "./lens-content.css";

export interface LensContentProps {
  /** The Lens card's id (the registered `"lens"` singleton). */
  cardId: string;
}

export function LensContent({ cardId }: LensContentProps): React.ReactElement {
  const lens = useSyncExternalStore(lensStore.subscribe, lensStore.getSnapshot);
  const sections = getRegisteredLensSections();
  const registeredKinds = [...sections.keys()];
  const order = resolveSectionRenderOrder(
    registeredKinds,
    lens.sectionOrder,
    lens.hiddenSections,
  );
  const orderKey = order.join(" ");
  const collapsed = new Set(lens.collapsedSections);

  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const focusManager = useFocusManager();

  // Seed the opening key view onto the first *expanded* section's list, so the
  // first Cmd-L lands the movement cursor on a real Lens item ([P02], the
  // focus-language seed). A collapsed section unmounts its body (no
  // focusable), so it is skipped; a still-collapsed-everywhere Lens seeds
  // nothing until a section expands (`useSeedKeyView` re-arms while the key is
  // null). Subsequent Cmd-L presses (after a toggle-out) are handled by
  // `adoptKeyCard` restoring this card's stored key view — this seed is only
  // the first landing.
  const firstExpandedKind = order.find((k) => !collapsed.has(k)) ?? null;
  useSeedKeyView(
    firstExpandedKind !== null
      ? `${sectionFocusGroup(firstExpandedKind)}:0`
      : null,
  );

  // The card the Lens is contextually about — tracked once here (mounted
  // the whole time the pane is open) and shared with sections via context
  // so a section's body and collapsed-summary always agree ([P11]).
  const followedCardId = useTrackLastNonLensKeyCard(cardId);

  // Contribute the section-visibility items to the pane's title-bar `…`
  // menu (Spec S03): the menu mirrors the rail — visible sections first,
  // in their on-screen order (`order`), then hidden sections below,
  // alphabetically by title. Each item toggles `hiddenSections`. All the
  // section-visibility logic lives here in the lens layer; the pane just
  // renders what it's handed. Recomputed when the registry, order, or
  // hidden set changes; cleared on unmount.
  const hiddenKey = lens.hiddenSections.join(" ");
  useEffect(() => {
    const byKind = getRegisteredLensSections();
    const defFor = (kind: string): LensSectionDefinition | undefined =>
      byKind.get(kind);
    const isDef = (
      def: LensSectionDefinition | undefined,
    ): def is LensSectionDefinition => def !== undefined;

    // Visible sections, in the exact order the rail stacks them.
    const visibleItems = order
      .map(defFor)
      .filter(isDef)
      .map((def) => ({
        id: def.kind,
        label: def.title,
        checked: true,
        onSelect: () => lensStore.setHidden(def.kind, true),
      }));

    // Hidden sections (registered but not in `order`), sorted by title.
    const hiddenItems = registeredKinds
      .filter((kind) => !order.includes(kind))
      .map(defFor)
      .filter(isDef)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((def) => ({
        id: def.kind,
        label: def.title,
        checked: false,
        onSelect: () => lensStore.setHidden(def.kind, false),
      }));

    paneTitleBarMenuStore.set(cardId, [...visibleItems, ...hiddenItems]);
    return () => paneTitleBarMenuStore.set(cardId, null);
    // `orderKey`/`hiddenKey`/`registeredKinds` capture the inputs; the
    // `order` array and registry are read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, orderKey, hiddenKey, registeredKinds.join(" ")]);

  // Keep the FocusManager group-walk order in lock-step with the rendered
  // order ([P08]/[L22]) — group order is structure owned by the
  // FocusManager, driven off the store, never a parallel useState.
  useLayoutEffect(() => {
    if (focusManager === null) return;
    focusManager
      .contextFor(cardId)
      .setGroupOrder(order.map(sectionFocusGroup));
    // orderKey captures the rendered order; `order`/`focusManager`/`cardId`
    // are derived from it plus stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, focusManager, cardId]);

  // Drag-reorder from a section grip: FLIP visuals (ghost + close-up + drop
  // caret + settle), DOM/CSS only, committing the store on drop ([P08]).
  const { onGripPointerDown } = useBlockReorder({
    containerRef: sectionsRef,
    caretRef,
    getVisibleOrder: () =>
      resolveSectionRenderOrder(
        [...getRegisteredLensSections().keys()],
        lensStore.getSnapshot().sectionOrder,
        lensStore.getSnapshot().hiddenSections,
      ),
    commit: (newVisible) => {
      const registered = new Set(getRegisteredLensSections().keys());
      // Preserve currently-hidden kinds after the visible order so their
      // arrangement isn't lost when they're shown again.
      const hiddenTail = lensStore
        .getSnapshot()
        .hiddenSections.filter((k) => registered.has(k) && !newVisible.includes(k));
      lensStore.setSectionOrder([...newVisible, ...hiddenTail]);
    },
  });

  // Escape inside the Lens focuses back out: re-dispatch FOCUS_LENS via
  // the registry (the same path Cmd-L-again takes), which the deck-canvas
  // handler turns into a toggle-out restoring the stashed prior card. This
  // responder is only in the chain when focus is inside the Lens.
  const responderId = useId();
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.CANCEL_DIALOG]: () => {
        dispatchAction({ action: "focus-lens" });
      },
    },
  });

  return (
    <LensFollowedCardContext value={followedCardId}>
      <ResponderScope>
      <div
        ref={responderRef as (el: HTMLDivElement | null) => void}
        className="lens-content"
        data-testid="lens-content"
        data-lens-card-id={cardId}
        // Focusable root so `transferFocusForActivation` → `applyBagFocus`
        // has a target to land the ring on when the Lens is focused.
        tabIndex={-1}
      >
        <div className="lens-sections" data-testid="lens-sections" ref={sectionsRef}>
          {/* The reorder drop indicator — a persistently-mounted hairline the
              drag handler positions imperatively ([P08]); hidden at rest. */}
          <BlockDropCaret ref={caretRef} />
          {order.map((kind) => {
            const def = sections.get(kind);
            if (!def) return null;
            const host: LensSectionHost = {
              lensCardId: cardId,
              focusGroup: sectionFocusGroup(kind),
            };
            return (
              <LensSection
                key={kind}
                def={def}
                host={host}
                collapsed={collapsed.has(kind)}
                onGripPointerDown={onGripPointerDown}
              />
            );
          })}
        </div>
      </div>
      </ResponderScope>
    </LensFollowedCardContext>
  );
}
