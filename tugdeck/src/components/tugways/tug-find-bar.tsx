/**
 * `TugFindBar` — the deck's find face: one bar, mounted by any card that has
 * something to search.
 *
 * The bar composes the shared pieces — {@link TugEntryShell} (the entry panel
 * + toolbar shell), a {@link TugTextEditor} CM6 substrate as the query field,
 * and one trailing group holding the shared {@link TugFindCluster} (the count
 * badge, then Case / Word / Grep) beside the ↑ / ↓ pair (outlined "Find
 * previous" beside filled "Find next"). It docks immediately above the host's
 * status bar; ⌘F summons and dismisses it, Escape dismisses — there is no ✕.
 *
 * Keys: Enter → next, Shift-Enter → previous, Escape → dismiss — a dedicated
 * find field follows the universal find-bar convention. Bound as a
 * `Prec.high` keymap through the substrate's `extensions` seam; the query
 * mirrors out of the CM6 doc via an `updateListener`, so there is no
 * controlled-input round-trip.
 *
 * **The host owns the session.** {@link FindSession} construction, its engine
 * delegate, and its lifetime are the host's business — the Text card's
 * session is bar-scoped and cleared on unmount, the Session card's is
 * card-scoped and outlives the bar. The bar reads and drives the session it
 * is handed; it never clears one.
 *
 * Laws: [L02] the surface snapshot is `Object.is`-stable between refreshes;
 * [L06] match painting is engine-owned (CM6 decorations / CSS Custom
 * Highlights), never React state; [L11] the cluster's toggles emit `setValue`
 * and this bar's responder applies it; [L22]-adjacent: the query lives in the
 * CM6 doc, mirrored imperatively.
 *
 * @module components/tugways/tug-find-bar
 */

import "./tug-find-bar.css";

import React, { useEffect, useMemo, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { TugEntryShell } from "@/components/tugways/tug-entry-shell";
import { FindWrapOverlay } from "@/components/tugways/chrome/find-wrap-overlay";
import { TugFindCluster } from "@/components/tugways/tug-find-cluster";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  TugTextEditor,
  type TugTextEditorDelegate,
} from "@/components/tugways/tug-text-editor";
import { useOptionalResponder } from "@/components/tugways/use-responder";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import type { FindSession } from "@/lib/find-session";

/** The bar's four Tab stops, in reading order, as offsets from the host's
 *  `focusOrderBase`. The query field leads because it is where ⌘F lands and
 *  what every other control is about. */
const FIND_STOP_QUERY = 0;
const FIND_STOP_OPTIONS = 1;
const FIND_STOP_PREVIOUS = 2;
const FIND_STOP_NEXT = 3;

export interface TugFindBarProps {
  /** The host's find session — the bar drives it, the host owns it. */
  session: FindSession;
  /** Dismiss gesture (Escape). The host closes the bar. */
  onClose: () => void;
  /**
   * The card's root element — the shared {@link FindWrapOverlay}'s
   * containment box (the wrap graphic anchors to the card).
   */
  cardRootRef: React.RefObject<HTMLElement | null>;
  /** Query-field placeholder, which doubles as its accessible name. */
  placeholder: string;
  /** Host class on the bar root, alongside the shared `tug-find-bar`. */
  className?: string;
  /** `data-slot` on the bar root (defaults to `"tug-find-bar"`). */
  dataSlot?: string;
  /** `data-testid` on the query field. */
  inputTestId?: string;
  /**
   * Seeds the query field at mount and selects it whole, so reopening the
   * bar resumes the previous search and the next keystroke replaces it —
   * the standard macOS find behavior. Hosts whose session dies with the bar
   * (the Text card) pass nothing.
   */
  initialQuery?: string;
  /**
   * Authors the bar's four controls — query field, option group, Previous,
   * Next — into the host's Tab walk ([P02]), at `focusOrderBase + 0…3`. A find
   * bar is a surface a keyboard user has to be able to *work*, not just type
   * into: the option toggles change what the query means and the ↑ / ↓ pair is
   * the gesture Return duplicates. Omitted by hosts that have not authored a
   * walk for it, which leaves the controls plain pointer targets.
   */
  focusGroup?: string;
  /** First of the four consecutive orders in {@link focusGroup}. Defaults to 0. */
  focusOrderBase?: number;
}

/** Imperative surface the host drives: ⌘F on an already-open bar must put
 *  the caret back in the query field, unconditionally; and a find navigation
 *  performed OUTSIDE the bar refreshes the count badge through
 *  `refreshCount`. */
export interface TugFindBarHandle {
  focusQuery(): void;
  refreshCount(): void;
  /**
   * Whether the keyboard is currently inside the bar — the caret in the query
   * field, or the engine's key view on one of its controls (which parks
   * `document.activeElement` on the key sink OUTSIDE the bar, so containment
   * alone cannot answer this). The host asks before dismissing: a bar that
   * holds the keyboard owes it somewhere to land.
   */
  holdsKeyboard(): boolean;
}

export const TugFindBar = React.forwardRef<TugFindBarHandle, TugFindBarProps>(
  function TugFindBar(
    {
      session,
      onClose,
      cardRootRef,
      placeholder,
      className,
      dataSlot = "tug-find-bar",
      inputTestId,
      initialQuery,
      focusGroup,
      focusOrderBase = 0,
    }: TugFindBarProps,
    ref,
  ): React.ReactElement {
    const barResponderId = React.useId();
    const substrateRef = useRef<TugTextEditorDelegate | null>(null);
    const barRootRef = useRef<HTMLDivElement | null>(null);

    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // The seed is a mount-time value, not a live prop: once the bar is open
    // the CM6 doc is the query's only home.
    const initialQueryRef = useRef(initialQuery ?? "");

    // Substrate extensions — captured at mount (the substrate's `extensions`
    // contract), so every callback reads through stable refs. `Prec.high`
    // puts the find keys ahead of the substrate's own Enter handling.
    const findBarExtensions = useMemo(
      () => [
        Prec.high(
          keymap.of([
            {
              key: "Enter",
              run: () => {
                session.next();
                return true;
              },
            },
            {
              key: "Shift-Enter",
              run: () => {
                session.previous();
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                onCloseRef.current();
                return true;
              },
            },
          ]),
        ),
        // The query is the CM6 doc — mirror every edit into the session
        // (search-as-you-type; the engine selects + reveals the first result).
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          session.setQuery(update.state.doc.toString());
        }),
      ],
      [session],
    );

    // Summoned: seed the remembered query (selected whole, so typing replaces
    // it) and take the caret. The `updateListener` above mirrors the seeded
    // doc into the session, which re-runs the search. ⌘F on an already-open
    // bar re-summons through the same imperative seam.
    useEffect(() => {
      const seed = initialQueryRef.current;
      const view = substrateRef.current?.view() ?? null;
      if (view !== null && seed.length > 0) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: seed },
          selection: { anchor: 0, head: seed.length },
        });
      }
      substrateRef.current?.focus();
    }, []);
    React.useImperativeHandle(
      ref,
      (): TugFindBarHandle => ({
        focusQuery: () => {
          substrateRef.current?.focus();
        },
        refreshCount: () => {
          session.refresh();
        },
        holdsKeyboard: () => {
          const root = barRootRef.current;
          if (root === null) return false;
          // Two registers, because the engine uses two ([P01]): a caret in the
          // query field is real DOM focus (`dom-granted`), while a ring on the
          // options or the ↑ / ↓ pair is `engine-routed` and parks
          // `activeElement` on the key sink outside the bar — for those the
          // projected `data-key-view` mark is the only local evidence.
          return (
            root.contains(document.activeElement) ||
            root.querySelector("[data-key-view]") !== null
          );
        },
      }),
      [session],
    );

    // The bar is the responder for find NAVIGATION while it is open: with the
    // caret in the query field, ⌘G / ⇧⌘G walk field → bar and land here (the
    // host's own handlers are a sibling branch the walk from the field can
    // never reach). FIND re-summons the caret into the field. The bar drives
    // the search session (query, options, count) — it is the responder for
    // the actions that mutate it ([L11]).
    const { ResponderScope, responderRef } = useOptionalResponder({
      id: barResponderId,
      actions: {
        [TUG_ACTIONS.FIND]: () => {
          substrateRef.current?.focus();
        },
        [TUG_ACTIONS.FIND_NEXT]: () => {
          session.next();
        },
        [TUG_ACTIONS.FIND_PREVIOUS]: () => {
          session.previous();
        },
        // Escape dismisses from ANYWHERE in the bar, not just the query
        // field. The field's own `Prec.high` keymap covers the caret case
        // (and gets there first); this covers the ring — an option toggle or
        // the ↑ / ↓ pair — where there is no CM6 to catch the key. A surface
        // with one dismissal gesture that works from three of its four stops
        // is a surface that reads as stuck.
        [TUG_ACTIONS.CANCEL_DIALOG]: () => {
          onCloseRef.current();
        },
      },
    });

    // One callback into the responder registration and the local root ref,
    // which `holdsKeyboard` reads to answer "is the keyboard in here?".
    const shellRef = React.useCallback(
      (el: HTMLDivElement | null) => {
        barRootRef.current = el;
        (responderRef as (node: HTMLDivElement | null) => void)(el);
      },
      [responderRef],
    );

    return (
      <ResponderScope>
        <TugEntryShell
          ref={shellRef}
          className={className ? `tug-find-bar ${className}` : "tug-find-bar"}
          data-slot={dataSlot}
          toolbarTrailing={
            <>
              {/* Everything about the search reads as one trailing group:
                  what the search found, what it is searching FOR, and the
                  two buttons that walk it. Centring the cluster instead put
                  a card's width of empty toolbar between the count and the
                  ↑/↓ pair that changes it. */}
              <TugFindCluster
                surface={session}
                focusGroup={focusGroup}
                focusOrder={focusOrderBase + FIND_STOP_OPTIONS}
              />
              <TugPushButton
                subtype="icon"
                size="lg"
                // Outlined, not filled: Previous is the secondary of the
                // Next/Previous pair — the filled button is "next" (the
                // Return gesture's twin), this outlined one is "previous".
                emphasis="outlined"
                role="action"
                onClick={() => session.previous()}
                aria-label="Find previous"
                icon={<ChevronUp size={18} strokeWidth={2.5} />}
                focusGroup={focusGroup}
                focusOrder={focusOrderBase + FIND_STOP_PREVIOUS}
              />
              <TugPushButton
                subtype="icon"
                size="lg"
                emphasis="filled"
                role="action"
                onClick={() => session.next()}
                aria-label="Find next"
                icon={<ChevronDown size={18} strokeWidth={2.5} />}
                focusGroup={focusGroup}
                focusOrder={focusOrderBase + FIND_STOP_NEXT}
              />
            </>
          }
        >
          <TugTextEditor
            ref={substrateRef}
            borderless
            maxRows={6}
            placeholder={placeholder}
            aria-label={placeholder}
            data-testid={inputTestId}
            /* The host owns its card-state-preservation slot; a transient
               find field must not stash editor state into the card bag. */
            preserveState={false}
            /* An empty query has nothing to indent, so Tab is spent moving
               the keyboard on through the bar's own stops instead. */
            tabMovesFocusWhenEmpty
            focusGroup={focusGroup}
            focusOrder={focusOrderBase + FIND_STOP_QUERY}
            extensions={findBarExtensions}
          />
        </TugEntryShell>
        <FindWrapOverlay findSession={session} cardRef={cardRootRef} />
      </ResponderScope>
    );
  },
);
