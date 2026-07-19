/**
 * useInlineDialogScope -- the cross-cutting open concerns of a **card-modal**
 * inline Permission/Question dialog ([P16]).
 *
 * An inline dialog renders in the transcript flow while the prompt entry sits
 * below it, but it is **card-modal in focus**: while pending it keeps its own
 * trapped focus mode (`useFocusTrap`, pushed by the component) and authors its
 * controls into that mode as ordinary focusables — Deny/Allow (or
 * Cancel/Submit/Back/Next) leaf buttons plus a scope/option item-group ([P17]).
 * Tab cycles only those; the prompt deactivates (its own concern, off the
 * session's pending state) and the card content around the dialog is scrimmed
 * ([P19]).
 *
 * This hook carries only what the controls themselves don't own:
 *
 *  - a `CANCEL_DIALOG` responder so Escape / Cmd-. cancel the dialog (Deny /
 *    `popInteractive`); the responder sits on the dialog's outer element, the
 *    ancestor of every control, so the cancel-action walks up to it;
 *  - seeding the engine key view onto the recommended default on open
 *    ({@link useSeedKeyView}), so the default rests ringed and Return commits —
 *    and re-seeding it when the card (re)gains key status while the dialog is
 *    still open ([P20]/[P21]), so a dialog that popped while its card was in the
 *    background (or behind a non-frontmost pane) lands focus on the default the
 *    moment the user activates the card, not on a stray Tab into Cancel/Deny;
 *  - releasing the enclosing list's follow-bottom and scrolling the ENTIRE
 *    dialog into view on open — anchored to its bottom so the whole card-modal
 *    shows at once (usually a scroll to the bottom), or to its header at the top
 *    when the dialog is taller than the viewport (so the header is never pushed
 *    off the top by the live edge); re-engaging on close.
 *
 * It replaces the retired modal-for-keys shell (a single flat item-container
 * that mashed every button + option row into one cursor) — the source of the
 * card-modal redesign's defects ([P16]/[P17]/[P18]).
 *
 * Laws: [L03] registration / subscription in layout effects (inside the composed
 * hooks); [L26] tolerant of a null manager (no-op outside a provider).
 */

import { useCallback, useContext, useId, useLayoutEffect, useRef } from "react";

import { CardIdContext } from "@/lib/card-id-context";
import { FocusManagerContext } from "./focus-manager";
import { useSeedKeyView } from "./use-focusable";
import { useKeyCardId } from "./use-key-card";
import { useOptionalResponder } from "./use-responder";
import { useScroller } from "./internal/scroller-context";
import { TUG_ACTIONS } from "./action-vocabulary";

export interface InlineDialogScopeOptions {
  /** Whether the dialog is open (pending). The seed + scroll fire while true. */
  active: boolean;
  /**
   * The `group:order` focus key of the control to seed as the key view on open
   * (the recommended default — Allow / Submit), so Return commits and the ring
   * lands home. Null to seed nothing.
   */
  defaultFocusKey: string | null;
  /** Cancel-action (Escape / Cmd-.) — Deny for permission, popInteractive for question. */
  onCancel: () => void;
}

export interface InlineDialogScopeResult {
  /**
   * Ref callback for the dialog's outer element. Wires the cancel-action
   * responder so Escape / Cmd-. routes up to it from any focused control, and
   * holds the element so the open effect can scroll the dialog header into view.
   */
  attachRoot: (el: HTMLElement | null) => void;
  /**
   * The id of the dialog's cancel-action responder. Pass as the `parentId` of any
   * nested responder the dialog hosts (e.g. a `TugRadioGroup`'s `useResponderForm`)
   * so an unhandled `CANCEL_DIALOG` from inside that responder walks up the chain
   * to this one (Escape / Cmd-. → cancel) instead of escaping past the dialog.
   */
  responderId: string;
}

/**
 * Drive a **card-modal** inline dialog ([P16]). See the module docstring for the
 * model; this hook supplies the cancel-action responder, the on-open default
 * seed, and the follow-bottom release + header scroll-into-view.
 */
export function useInlineDialogScope(
  opts: InlineDialogScopeOptions,
): InlineDialogScopeResult {
  const scroller = useScroller();
  const id = useId();
  const onCancelRef = useRef(opts.onCancel);
  onCancelRef.current = opts.onCancel;

  const { responderRef } = useOptionalResponder({
    id,
    actions: {
      [TUG_ACTIONS.CANCEL_DIALOG]: () => onCancelRef.current(),
    },
  });

  const rootElRef = useRef<HTMLElement | null>(null);
  const attachRoot = useCallback(
    (el: HTMLElement | null) => {
      rootElRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  // Seed the engine key view onto the default control on open ([P12]).
  const { active, defaultFocusKey } = opts;
  useSeedKeyView(active ? defaultFocusKey : null);

  // Re-seed the default key view when this card (re)gains key status while the
  // dialog is open ([P20]/[P21]). `useSeedKeyView` arms the default exactly once
  // on mount — but a dialog that POPS while its card is in the background (a
  // request arriving for a non-key card, or one in a non-frontmost pane) can't
  // land DOM focus then, and a pointer activation that brings the card forward
  // can coarsen the key view off the default before it ever resolves. So on the
  // background→key transition we re-place the keyboard focus-key target, which lands the
  // ring (and now DOM focus, the card being active) back on the recommended
  // default — the answer options for a question, Allow/Submit for a permission —
  // instead of stranding the user on a bare Tab that starts at Cancel/Deny.
  const manager = useContext(FocusManagerContext);
  const cardId = useContext(CardIdContext);
  const keyCardId = useKeyCardId();
  const isKeyCard = cardId !== null && keyCardId === cardId;
  const wasKeyCardRef = useRef(isKeyCard);
  useLayoutEffect(() => {
    const was = wasKeyCardRef.current;
    wasKeyCardRef.current = isKeyCard;
    if (
      active &&
      isKeyCard &&
      !was &&
      defaultFocusKey !== null &&
      manager !== null
    ) {
      manager.place(cardId, { kind: "focus-key", focusKey: defaultFocusKey }, { modality: "keyboard" });
    }
  }, [active, isKeyCard, defaultFocusKey, manager, cardId]);

  // While open, release the enclosing list's follow-bottom and bring the ENTIRE
  // dialog into view; re-engage on close.
  //
  // The dialog is the live edge, so this is usually a scroll to the bottom: anchor
  // the dialog's bottom to the viewport bottom so the whole card-modal shows at
  // once (the bug this fixes: on present the dialog landed with only its header
  // peeking at the bottom, the body below the fold). If the dialog is TALLER than
  // the scroll viewport it cannot all fit — anchor its header to the top instead,
  // so reading starts at the top and the remainder scrolls down (the header is
  // never pushed off the top by the live edge).
  useLayoutEffect(() => {
    if (!active) return;
    scroller.disengage("inline-dialog");
    const root = rootElRef.current;
    if (root !== null) {
      const scrollEl = root.closest<HTMLElement>("[data-tug-scroll-key]");
      const fitsInView =
        scrollEl === null ||
        root.getBoundingClientRect().height <=
          scrollEl.getBoundingClientRect().height;
      if (fitsInView) {
        root.scrollIntoView({ block: "end", inline: "nearest" });
      } else {
        const header =
          root.querySelector('[data-slot="tug-inline-dialog-row"]') ?? root;
        header.scrollIntoView({ block: "start", inline: "nearest" });
      }
    }
    return () => {
      scroller.engage("inline-dialog");
    };
  }, [active, scroller]);

  return { attachRoot, responderId: id };
}
