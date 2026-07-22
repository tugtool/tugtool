/**
 * lens-content.tsx — the Lens card's content: a fixed, non-scrolling stack
 * of reorderable, collapsible sections. Every registered section always
 * renders (there is no hidden-sections set and no title-bar `…` menu);
 * each section's BODY scrolls internally when its list outgrows the
 * section's flex share, so every band stays on-screen. The stack itself
 * never scrolls — a section can scroll its own rows out of view, but never
 * another section's header.
 *
 * Hosted by the normal `CardHost` inside an anchored pane (the Lens
 * rail). This file is the ordinary registered card's content component;
 * it owns nothing about geometry or chrome (those belong to the pane per
 * [L25]/[L09]).
 *
 * Responsibilities:
 *   - Derive the section order from `lensStore` over the registered
 *     sections ([L02] via `useSyncExternalStore`).
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
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { lensStore } from "@/lib/lens-store/lens-store";
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
  type LensSectionHost,
} from "./lens-section-registry";
import { LensSection } from "./lens-section-band";
import {
  getSectionContentVersion,
  sectionHasContent,
  subscribeSectionContent,
} from "./lens-section-content";
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
  const order = resolveSectionRenderOrder(registeredKinds, lens.sectionOrder);
  const orderKey = order.join(" ");
  const collapsed = new Set(lens.collapsedSections);

  const sectionsRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const focusManager = useFocusManager();

  // Seed the opening key view onto the first *expanded* section that has
  // navigable content, so the first Cmd-L lands the movement cursor on a real
  // Lens item ([P02], the focus-language seed) — never on an empty band (an
  // empty list is not a focus stop; seeding it would arm a pending restore that
  // shows a ring on emptiness). A collapsed section unmounts its body (no
  // focusable), so it is skipped; a Lens with no content anywhere seeds nothing
  // until a section gains content (`useSeedKeyView` re-arms while the key is
  // null). Subsequent Cmd-L presses (after a toggle-out) are handled by
  // `adoptKeyCard` restoring this card's stored key view — this seed is only
  // the first landing.
  useSyncExternalStore(subscribeSectionContent, getSectionContentVersion);
  const seedKind =
    order.find(
      (k) => !collapsed.has(k) && sectionHasContent(sectionFocusGroup(k)),
    ) ?? null;
  useSeedKeyView(
    seedKind !== null ? `${sectionFocusGroup(seedKind)}:0` : null,
  );

  // The card the Lens is contextually about — tracked once here (mounted
  // the whole time the pane is open) and shared with sections via context
  // so a section's body and collapsed-summary always agree ([P11]).
  const followedCardId = useTrackLastNonLensKeyCard(cardId);

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

  // Slack ownership — the Lens is always full. Exactly one expanded section is
  // "flexible" (`data-lens-flex`) and absorbs the stack's free height, so no
  // void ever trails below the last band. The winner: the section holding an
  // open snippet editor (space follows the edit — and because the editor lives
  // in the tallest section's standing share, opening it doesn't reshape the
  // panel), else the expanded section with the tallest intrinsic list content
  // (the one that can actually show more rows), else Snippets (the writing
  // surface, so `+` always has room to open into). Measurement → DOM attribute
  // only, the pin-stack pattern ([L06]); CSS turns the attribute into
  // `flex-grow: 1`.
  useLayoutEffect(() => {
    const rootEl = sectionsRef.current;
    if (rootEl === null) return;
    let raf = 0;
    const assign = (): void => {
      const bands = [
        ...rootEl.querySelectorAll<HTMLElement>(":scope > .lens-section"),
      ];
      const expanded = bands.filter((s) => s.dataset.collapsed !== "true");
      let winner =
        expanded.find((s) => s.querySelector(".snippet-editor") !== null) ??
        null;
      if (winner === null) {
        let max = 0;
        for (const s of expanded) {
          const h =
            s.querySelector<HTMLElement>(".tug-list-view")?.scrollHeight ?? 0;
          if (h > max) {
            max = h;
            winner = s;
          }
        }
      }
      winner ??=
        expanded.find((s) => s.dataset.lensSection === "snippets") ??
        expanded[0] ??
        null;
      for (const s of bands) {
        if (s === winner) s.dataset.lensFlex = "true";
        else delete s.dataset.lensFlex;
      }
    };
    const schedule = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(assign);
    };
    // Re-measure when the Lens resizes, when any section body or list content
    // changes size (a list's WINDOW resizes with content even while the list
    // scroller's own box holds still), and when rows / editors mount or unmount
    // (the mutation observer also re-hooks the resize observer onto the new
    // elements).
    const ro = new ResizeObserver(schedule);
    const observeAll = (): void => {
      ro.disconnect();
      ro.observe(rootEl);
      for (const el of rootEl.querySelectorAll<HTMLElement>(
        ".lens-section-body, .tug-list-view-window, .snippet-editor",
      )) {
        ro.observe(el);
      }
    };
    const mo = new MutationObserver(() => {
      observeAll();
      schedule();
    });
    mo.observe(rootEl, { childList: true, subtree: true });
    observeAll();
    assign();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // Drag-reorder from a section grip: FLIP visuals (ghost + close-up + drop
  // caret + settle), DOM/CSS only, committing the store on drop ([P08]).
  const { onGripPointerDown } = useBlockReorder({
    containerRef: sectionsRef,
    caretRef,
    getVisibleOrder: () =>
      resolveSectionRenderOrder(
        [...getRegisteredLensSections().keys()],
        lensStore.getSnapshot().sectionOrder,
      ),
    commit: (newVisible) => {
      lensStore.setSectionOrder([...newVisible]);
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
