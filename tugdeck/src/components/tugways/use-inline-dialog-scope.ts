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
 *    ({@link useSeedKeyView}), so the default rests ringed and Return commits;
 *  - releasing the enclosing list's follow-bottom and scrolling the dialog
 *    header into view while open (a tall dialog must not have its header pushed
 *    off the top by the live edge), re-engaging on close.
 *
 * It replaces the retired modal-for-keys shell (a single flat item-container
 * that mashed every button + option row into one cursor) — the source of the
 * card-modal redesign's defects ([P16]/[P17]/[P18]).
 *
 * Laws: [L03] registration / subscription in layout effects (inside the composed
 * hooks); [L26] tolerant of a null manager (no-op outside a provider).
 */

import { useCallback, useId, useLayoutEffect, useRef } from "react";

import { useSeedKeyView } from "./use-focusable";
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

  // While open, release the enclosing list's follow-bottom and bring the dialog
  // header into view; re-engage on close (mirrors the retired modal shell).
  useLayoutEffect(() => {
    if (!active) return;
    scroller.disengage("inline-dialog");
    const root = rootElRef.current;
    const header =
      root?.querySelector('[data-slot="tug-inline-dialog-row"]') ?? root;
    header?.scrollIntoView({ block: "nearest", inline: "nearest" });
    return () => {
      scroller.engage("inline-dialog");
    };
  }, [active, scroller]);

  return { attachRoot, responderId: id };
}
