/**
 * useInlineDialogModal -- drive an inline Permission/Question dialog as a
 * CFRunLoop-style **modal-for-keys** scope ([P06]).
 *
 * An inline dialog is not a floating overlay: it renders in the transcript flow
 * while the prompt entry sits below it. When one is pending the dialog must own
 * the keyboard — plain arrows move its selection, Return activates the
 * highlighted choice, Escape / Cmd-. cancel — and the prompt deactivates (its
 * own concern, off the session's pending state). This hook wires that takeover
 * from existing engine parts:
 *
 *  - `useItemGroupKeyboard` registers the dialog as a **single item-container**
 *    stop and owns the movement cursor (arrows / Home / End) + the act-dispatch
 *    `behavior` (Space/Enter -> `onActivate` against the current cursor item);
 *  - `useOptionalResponder` declares the scope's **cancel-action**: Escape /
 *    Cmd-. dispatch `CANCEL_DIALOG` (keybinding map), which walks first-responder
 *    up — promoting this dialog to first responder (below) makes its handler win
 *    over the card-level interrupt handler, so Escape cancels the *dialog*;
 *  - on activation it makes the dialog the **key view** (so the cursor lands and
 *    the act dispatch reads this behavior) and the **first responder with DOM
 *    focus** (so the arrow `onKeyDown` fires and the keybinding routes here; the
 *    deactivated prompt loses DOM focus as a result).
 *
 * The component supplies *what its choices are* (`collectItems`, in cursor
 * order), *where the highlight starts* (`initialIndex` — the default action),
 * and *what activate / cancel mean* (`onActivate` / `onCancel`). Must be called
 * from a component rendered inside the surface's `FocusModeScope` (from
 * `useFocusTrap`) so its focusable joins the pushed mode.
 *
 * Laws: [L03] registration in layout effects (inside the composed hooks); [L06]
 * the cursor is appearance, projected as DOM by `useFocusCursor`; [L26] tolerant
 * of a null manager (no-op outside a provider).
 */

import {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { FocusManagerContext } from "./focus-manager";
import { useResponderChain } from "./responder-chain-provider";
import { useItemGroupKeyboard } from "./use-item-group-keyboard";
import { useOptionalResponder } from "./use-responder";
import { TUG_ACTIONS } from "./action-vocabulary";

export interface InlineDialogModalOptions {
  /** Collect the arrow-navigable choice elements, in cursor order. */
  collectItems: () => ReadonlyArray<Element | null>;
  /**
   * The cursor index to land on when the dialog takes the key view — the
   * default highlight (e.g. the Allow button / the primary action).
   */
  initialIndex: () => number;
  /** Activate the highlighted choice (Return / Space). */
  onActivate: (element: Element | null, index: number) => void;
  /**
   * Fires as the cursor moves over a choice (every arrow move). Lets the dialog
   * keep a secondary selection (e.g. the scope radio) in sync with the cursor.
   */
  onMove?: (element: Element | null, index: number) => void;
  /**
   * Cancel-action (Escape / Cmd-.). Deny for a Permission dialog, Cancel (`n`)
   * for a Question dialog.
   */
  onCancel: () => void;
}

export interface InlineDialogModalResult {
  /**
   * Ref callback for the dialog's scope-root element. Wires the focusable +
   * responder so the dialog can become the key view / first responder and the
   * cursor can project onto its items.
   */
  attachRoot: (el: HTMLElement | null) => void;
  /** Movement key handler (arrows / Home / End) for the root's `onKeyDown`. */
  onKeyDown: (event: ReactKeyboardEvent) => void;
  /** Re-sync the cursor's item range (call when the rendered choices change). */
  syncItems: () => void;
}

export function useInlineDialogModal(
  opts: InlineDialogModalOptions,
): InlineDialogModalResult {
  const manager = useContext(FocusManagerContext);
  const chain = useResponderChain();
  // One id for both axes: the scope root carries `data-tug-focusable` AND
  // `data-responder-id` under this id, so the key view, the cursor projection,
  // and the first-responder promotion all resolve to the same element.
  const id = useId();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { attachRoot: attachFocusable, onKeyDown, syncItems } =
    useItemGroupKeyboard({
      id,
      group: id,
      order: 0,
      register: true,
      // `live` so `onMove` fires on every arrow move (the radio follows the
      // cursor); the actual decision still commits only on activate.
      commit: "live",
      collectItems: () => optsRef.current.collectItems(),
      initialIndex: () => optsRef.current.initialIndex(),
      onSelect: (el, i) => optsRef.current.onActivate(el, i),
      onAct: (el, i) => optsRef.current.onActivate(el, i),
      onMove: (el, i) => optsRef.current.onMove?.(el, i),
    });

  const { responderRef } = useOptionalResponder({
    id,
    actions: {
      [TUG_ACTIONS.CANCEL_DIALOG]: () => optsRef.current.onCancel(),
    },
  });

  const rootElRef = useRef<HTMLElement | null>(null);
  const attachRoot = useCallback(
    (el: HTMLElement | null) => {
      rootElRef.current = el;
      attachFocusable(el);
      responderRef(el);
    },
    [attachFocusable, responderRef],
  );

  // Take over the keyboard once mounted. The composed hooks register the
  // focusable + responder in their own layout effects (which run before this,
  // declared last); by now the root carries both attributes.
  //  - `el.focus()` lands DOM focus on the scope root so the arrow `onKeyDown`
  //    fires and the deactivating prompt's blur becomes a no-op (it no longer
  //    holds focus). The root is `tabIndex=0`, so it is focusable.
  //  - `focusResponder` makes it first responder so Escape/Cmd-. -> CANCEL_DIALOG
  //    walks to this scope's cancel handler.
  //  - `setKeyView(id, true)` pins the key view (keyboard modality, so the ring
  //    + cursor show) — last, so a focusin re-seed cannot leave it elsewhere.
  useLayoutEffect(() => {
    if (manager === null) return;
    rootElRef.current?.focus();
    chain?.focusResponder(id);
    manager.setKeyView(id, true);
  }, [manager, chain, id]);

  return { attachRoot, onKeyDown, syncItems };
}
