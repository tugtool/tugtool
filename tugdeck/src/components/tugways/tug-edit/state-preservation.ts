/**
 * tug-edit/state-preservation.ts — [L23] state preservation for the
 * `tug-edit` substrate.
 *
 * Three primitives plus a hook:
 *   - `restoreEditState(view, state)` — replace doc + atoms + selection
 *      in one transaction and write `scrollTop` directly. Companion to
 *      `applyEditState` (history nav, in `keymap.ts`); this function
 *      honors saved scroll position and intentionally does NOT focus
 *      so the active / inactive paint channels can decide that
 *      separately.
 *   - `paintMirrorAsActive(view, state?)` — claim focus, assert
 *      selection (when state is supplied), assert scrollTop. The only
 *      paint path that legitimately writes the global Selection. Used
 *      by exactly one editor per page at a time — the deck-level
 *      first responder.
 *   - `paintMirrorAsInactive(view, publish, state?)` — build a DOM
 *      Range from `view.state.selection` (or the supplied state's
 *      selection) over the live `cm-content` node and route it
 *      through the caller's `publish` callback (typically
 *      `selectionGuard.updateCardDomSelection(cardId, range)`).
 *      Selection paints via the `inactive-selection` CSS Custom
 *      Highlight; no focus claim, no `window.getSelection()`
 *      mutation.
 *   - `useEditStatePreservation` — the React hook that registers
 *      save / restore / activate / deactivate callbacks with the
 *      enclosing `CardHost`, mirroring the
 *      `TugPromptInputStatePreservation` pattern.
 *
 * Why active-paint dispatches selection through `view.dispatch`
 * rather than writing `window.getSelection()` directly: CM6 owns the
 * `cm-content` node and reconciles browser Selection with
 * `view.state.selection` on every transaction; bypassing CM6 risks
 * the next reconcile pass overwriting whatever the direct write
 * placed. `view.dispatch({ selection })` is the supported way to set
 * caret + selection inside CM6, and `view.focus()` triggers CM6's
 * own selection-to-browser sync. ([R02])
 *
 * Why inactive-paint reads `view.contentDOM` at fire time: CM6's
 * content node identity may change across reconfigure (e.g., theme
 * switch). The Range we hand to `publish` anchors to nodes inside
 * whatever `view.contentDOM` resolves to NOW. selectionGuard's
 * full-rebuild branch already drops Ranges whose nodes are no longer
 * connected, so a subsequent reconfigure is recovered safely on the
 * next paint. ([R02])
 *
 * Laws: [L02] CM6 state (doc, atoms, selection) is the source of
 *        truth — never copied into React state, [L03] hook registers
 *        in `useLayoutEffect`, [L06] selection paint flows through
 *        the inactive-selection CSS Custom Highlight (declared
 *        globally in `tug-pane.css`), [L07] `viewRef.current` and
 *        `cardIdRef.current` are read at call time, [L10] the
 *        substrate doesn't know about deck/card IDs — the publish
 *        callback is the seam that hands selection routing to the
 *        deck layer, [L12] selection painted on inactive cards is
 *        confined to `selectionGuard.cardRanges[cardId]`, [L22] the
 *        save/restore stream is direct DOM observation through the
 *        CardHost protocol, [L23] active-paint runs after every
 *        inactive-paint via the CardHost ordering invariant; the
 *        consumer here only chooses the channel based on `isActive`,
 *        [L24] no React state for selection / scrollTop — both axes
 *        live in CM6 (`view.state.selection`, `view.scrollDOM.scrollTop`).
 */

import React, { useLayoutEffect, useRef, useState } from "react";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { selectionGuard } from "@/components/tugways/selection-guard";
import {
  useCardId,
  useCardStatePreservation,
} from "@/components/tugways/use-card-state-preservation";
import type { TugTextEditingState } from "@/lib/tug-text-engine";
import { buildEditStateTransaction, captureEditState } from "./keymap";

// ---------------------------------------------------------------------------
// Pure view helpers — no React, no card-context coupling
// ---------------------------------------------------------------------------

/**
 * Apply the supplied state's scroll axes to `view.scrollDOM`.
 *
 * Each axis is honored independently: a number on `state.scrollTop`
 * writes vertical, a number on `state.scrollLeft` writes horizontal,
 * `null`/`undefined` on either skips that axis. This per-axis
 * independence matters because legacy on-disk bags written before
 * `scrollLeft` was added carry `undefined` for the horizontal axis;
 * those payloads must still round-trip the vertical axis they did
 * carry.
 *
 * Comparison-then-write avoids a no-op DOM mutation that would
 * otherwise fire a `scroll` event and re-trigger any listener
 * watching `view.scrollDOM`.
 */
function applyScrollAxes(view: EditorView, state: TugTextEditingState): void {
  if (
    typeof state.scrollTop === "number"
    && view.scrollDOM.scrollTop !== state.scrollTop
  ) {
    view.scrollDOM.scrollTop = state.scrollTop;
  }
  if (
    typeof state.scrollLeft === "number"
    && view.scrollDOM.scrollLeft !== state.scrollLeft
  ) {
    view.scrollDOM.scrollLeft = state.scrollLeft;
  }
}

/**
 * Restore a serialized editing state into a `tug-edit` view without
 * claiming focus.
 *
 * Dispatches one transaction that replaces doc + atom decorations +
 * selection (via `buildEditStateTransaction` with `scrollIntoView:
 * false` so the saved scroll position isn't overridden). Then
 * writes `scrollTop` and `scrollLeft` directly on `view.scrollDOM`
 * (the `.cm-scroller` element CM6 owns). Skips silently when
 * `view.contentDOM` is disconnected — the `paintMirror*` callers
 * also skip on disconnected views, so the restore + paint pair is
 * symmetric.
 *
 * Distinct from `applyEditState` in `keymap.ts`:
 *   - `applyEditState` is the history-nav restore — focuses the
 *     editor, scrolls the cursor into view, ignores
 *     `state.scrollTop` / `state.scrollLeft`.
 *   - `restoreEditState` is the state-preservation restore — does
 *     not focus, honors both saved scroll axes. The consumer
 *     chooses the paint channel afterward via `paintMirrorAsActive`
 *     or `paintMirrorAsInactive`, which makes `restoreEditState`
 *     safe to call on inactive cards (no focus theft).
 */
export function restoreEditState(
  view: EditorView,
  state: TugTextEditingState,
): void {
  if (!view.contentDOM.isConnected) return;
  view.dispatch(buildEditStateTransaction(view, state, { scrollIntoView: false }));
  applyScrollAxes(view, state);
}

/**
 * Paint the editor as the deck-level first responder.
 *
 * When `state` carries a selection, dispatch it first so
 * `view.state.selection` matches the saved value before focus claims
 * the global Selection. Then `view.focus()` — CM6's own
 * selection-to-browser sync writes `window.getSelection()` from
 * `view.state.selection`. When `state.scrollTop` is a number, write
 * it on `view.scrollDOM`.
 *
 * Skips silently on disconnected views.
 *
 * The [L23] restore-ordering invariant — every inactive card's paint
 * completes before the active card's — is enforced by `CardHost`,
 * not here. This function only chooses the active channel; the
 * consumer wires it into `onCardActivated` / the active branch of
 * `onRestore`.
 *
 * Source selection:
 *   - `state` supplied (cold-boot restore): read selection +
 *     scrollTop from the just-loaded bag verbatim.
 *   - `state` omitted (cmd-tab return): rely on the live
 *     `view.state.selection` and `view.scrollDOM.scrollTop`, which
 *     CM6 has been maintaining; `view.focus()` syncs the global
 *     Selection from `view.state.selection`.
 */
export function paintMirrorAsActive(
  view: EditorView,
  state?: TugTextEditingState,
): void {
  if (!view.contentDOM.isConnected) return;
  if (state?.selection) {
    view.dispatch({
      selection: EditorSelection.range(
        state.selection.start,
        state.selection.end,
      ),
    });
  }
  view.focus();
  if (state !== undefined) applyScrollAxes(view, state);
}

/**
 * Paint the editor as a non-first-responder card.
 *
 * Builds a DOM `Range` from the editor's selection (the supplied
 * state, or `view.state.selection` if no state was supplied) over
 * the live `view.contentDOM` and hands it to `publish`. Routes
 * through `view.domAtPos` so the offset → DOM-node resolution uses
 * CM6's own atom-aware mapping — atom widgets are `Decoration.replace`
 * spans, so `domAtPos` returns the parent line element with an
 * offset that lands at the widget boundary, exactly what
 * `selectionGuard`'s inactive highlight needs to render the dim
 * selection band.
 *
 * If the offset → DOM mapping throws (e.g., the saved offsets exceed
 * the current document length), publish `null` so the inactive
 * highlight clears — better than rendering against dead nodes.
 *
 * Does **not** call `view.focus()`. Does **not** touch
 * `window.getSelection()`. The card stays unfocused; the document's
 * active selection belongs to whichever card is the deck-level first
 * responder — its `paintMirrorAsActive` writes that.
 *
 * `scrollTop`: per-element, not racy across cards. Inactive cards
 * still need their scroll position preserved — the user expects to
 * find the editor at the same scroll offset when it later activates.
 */
export function paintMirrorAsInactive(
  view: EditorView,
  publish: (range: Range | null) => void,
  state?: TugTextEditingState,
): void {
  if (!view.contentDOM.isConnected) return;
  let selection: { start: number; end: number } | null;
  if (state !== undefined) {
    selection = state.selection ?? null;
  } else {
    const sel = view.state.selection.main;
    selection = { start: sel.from, end: sel.to };
  }
  if (selection !== null) {
    try {
      const startDom = view.domAtPos(selection.start);
      const endDom = view.domAtPos(selection.end);
      const range = document.createRange();
      range.setStart(startDom.node, startDom.offset);
      range.setEnd(endDom.node, endDom.offset);
      publish(range);
    } catch {
      publish(null);
    }
  } else {
    publish(null);
  }
  if (state !== undefined) applyScrollAxes(view, state);
}

// ---------------------------------------------------------------------------
// React hook + nested wrapper
// ---------------------------------------------------------------------------

/**
 * Buffer slot for the rare case where `onRestore` fires before the
 * editor's mount effect creates the `EditorView`. React fires child
 * effects before parent effects, so a sibling state-preservation
 * registration that lives "above" the editor's mount in the tree can
 * dispatch onRestore one tick earlier than the EditorView is born.
 * The mount effect replays the buffered restore through the
 * appropriate paint channel as soon as the view is constructed —
 * the `isActive` snapshot CardHost computed at the original
 * `onRestore` call time is preserved verbatim so the routing
 * decision matches what the live restore would have made. [L23].
 */
export interface PendingEditRestore {
  state: TugTextEditingState;
  isActive: boolean;
}

/**
 * Options for {@link useEditStatePreservation}.
 *
 * Both refs are written by the parent `TugEdit` component and read
 * here at fire time per [L07]. The hook never owns the EditorView —
 * it only orchestrates save / restore / activate / deactivate flows
 * around it.
 */
export interface UseEditStatePreservationOptions {
  /**
   * The live `EditorView`, or `null` between unmount and re-mount.
   * Read at fire time inside every callback so the hook works
   * correctly across StrictMode's mount → cleanup → mount cycle.
   */
  viewRef: React.RefObject<EditorView | null>;
  /**
   * Buffer for an `onRestore` payload that arrived before the
   * EditorView was constructed. The mount effect in `TugEdit`
   * inspects this ref after creating the view and replays any
   * buffered restore. The hook writes this ref; `TugEdit` reads
   * and clears it.
   */
  pendingRestoreRef: React.RefObject<PendingEditRestore | null>;
}

/**
 * Register tugdeck state-preservation callbacks for a `tug-edit`
 * substrate.
 *
 * Mirrors `TugPromptInputStatePreservation` from `tug-prompt-input.tsx`:
 * registers `onSave` / `onRestore` / `onCardActivated` /
 * `onCardWillDeactivate` with the enclosing `CardHost` via
 * `useCardStatePreservation`, then routes each event through the
 * primitives above.
 *
 * Branching by `isActive` in `onRestore` is the [L23] enforcement
 * point: every inactive card writes through `paintMirrorAsInactive`
 * (selectionGuard.cardRanges, no focus claim, no global Selection
 * mutation); the active card writes through `paintMirrorAsActive`
 * (focus + global Selection). The CardHost ordering invariant
 * guarantees this consumer sees the inactive `onRestore` calls
 * before the active one.
 *
 * Returns no value. Side effects flow through the registered
 * callbacks and the `setRestoreCount` re-render that lets the
 * no-deps `useLayoutEffect` in `useCardStatePreservation` fire
 * `onContentReady` after a successful restore.
 */
export function useEditStatePreservation(
  options: UseEditStatePreservationOptions,
): void {
  const { viewRef, pendingRestoreRef } = options;

  // Enclosing card's id from `CardStatePreservationContext`. Held
  // in a ref because `useCardStatePreservation` registers callbacks
  // in a `useLayoutEffect` whose closure must read the current
  // value at fire time, not the mount-time capture (cross-pane
  // moves preserve cardId in practice but the ref keeps the
  // contract safe under any future identity-semantics change). [L07]
  const cardId = useCardId();
  const cardIdRef = useRef(cardId);
  useLayoutEffect(() => {
    cardIdRef.current = cardId;
  }, [cardId]);

  // Re-render trigger so the no-deps `useLayoutEffect` inside
  // `useCardStatePreservation` fires `onContentReady` after a
  // successful restore. Without this re-render the cold-boot path
  // commits the editor's content but the visibility:hidden gate on
  // the host stays in place. Mirrors `tug-prompt-input`'s
  // `setRestoreCount`.
  const [, setRestoreCount] = useState(0);

  // Publish helper: route the editor's selection Range through
  // selectionGuard for the inactive-paint channel. Reads
  // `cardIdRef.current` at fire time per [L07].
  const publishToSelectionGuard = (range: Range | null): void => {
    const id = cardIdRef.current;
    if (id === null) return;
    selectionGuard.updateCardDomSelection(id, range);
  };

  useCardStatePreservation<TugTextEditingState>({
    onCardActivated: () => {
      // Activation gesture lands on this card. Claim focus + global
      // Selection. The deactivation hook for the previously-active
      // card has already routed its selection into the inactive-paint
      // channel — so this card's focus claim has nothing else's
      // global Selection to destroy. [L23]
      const view = viewRef.current;
      if (view === null) return;
      paintMirrorAsActive(view);
    },
    onCardWillDeactivate: () => {
      // [L23] enforcement: hand the selection over to the
      // inactive-paint channel before the new active card claims
      // focus + global Selection. `paintMirrorAsInactive` builds a
      // Range from the live `view.state.selection` over
      // `view.contentDOM` and routes it through
      // `publishToSelectionGuard`, which writes
      // `selectionGuard.cardRanges[cardId]`. selectionGuard adds
      // the range to the `inactive-selection` CSS Custom Highlight;
      // the editor stays unfocused. NO global Selection mutation.
      const view = viewRef.current;
      if (view === null) return;
      paintMirrorAsInactive(view, publishToSelectionGuard);
    },
    onSave: () => {
      const empty: TugTextEditingState = {
        text: "",
        atoms: [],
        selection: null,
      };
      const view = viewRef.current;
      if (view === null) return empty;
      return captureEditState(view);
    },
    onRestore: (state, { isActive }) => {
      // [L23] restore-ordering invariant: CardHost fires onRestore
      // for every card on cold-mount; this consumer branches on
      // `isActive` to choose the paint channel. The active card
      // (deck-level first responder) writes through
      // `paintMirrorAsActive` (focus + global Selection). Every
      // inactive card writes through `paintMirrorAsInactive(publish)`
      // (selectionGuard.cardRanges, no focus, no global Selection).
      // The ordering invariant — every inactive card's restore
      // completes before the active card's — is enforced by
      // CardHost; this consumer just picks the right channel.
      //
      // Pass `state` through to the paint methods so they read
      // selection + scrollTop from the just-loaded bag rather than
      // from the live view (the view's mirror is the bag at this
      // point, but cmd-tab paths trust the in-memory mirror; cold
      // boot trusts the bag).
      const view = viewRef.current;
      if (view !== null) {
        restoreEditState(view, state);
        if (isActive) {
          paintMirrorAsActive(view, state);
        } else {
          paintMirrorAsInactive(view, publishToSelectionGuard, state);
        }
      } else {
        // EditorView not yet constructed (rare — child-before-parent
        // effect ordering). The mount effect in `TugEdit` will
        // replay this buffered payload through the same paint
        // channel chosen here.
        pendingRestoreRef.current = { state, isActive };
      }
      setRestoreCount((c) => c + 1);
    },
  });
}

/**
 * Thin wrapper component that calls {@link useEditStatePreservation}.
 *
 * Conditionally rendered by `TugEdit` based on its `preserveState`
 * prop so the hook (and its registration with the enclosing
 * `CardHost`) is opt-in. When omitted, no callbacks are registered
 * and the editor is invisible to CardHost's save / restore protocol
 * — useful for stand-alone harnesses (storybook, unit tests) that
 * mount `TugEdit` outside a deck.
 *
 * Returns `null` (no DOM); the hook is the work.
 */
export function TugEditStatePreservation(
  props: UseEditStatePreservationOptions,
): null {
  useEditStatePreservation(props);
  return null;
}
