/**
 * `TextCardFindBar` — the Text card's bottom-docked find bar: the Dev
 * entry's find face, minus the route popup and the status row.
 *
 * One find face across the deck: the bar composes the same real components
 * the prompt entry mounts on its ⌕ route — {@link TugEntryShell} (the shared
 * entry panel + toolbar shell), a {@link TugTextEditor} CM6 substrate as the
 * query field, the shared {@link TugFindCluster} (Case / Word / Grep + the
 * count badge) centred in the toolbar, and the Z5 pair at the trailing edge
 * (outlined ↑ "Find previous" beside filled ↓ "Find next"). It docks between
 * the editor and the status bar; ⌘F summons it (the card's
 * `onFindRequested`), Escape dismisses — there is no ✕.
 *
 * Keys: Enter → next, Shift-Enter → previous, Escape → dismiss — a
 * dedicated find field follows the universal find-bar convention (the Dev
 * ⌕ editor maps Return to newline because it doubles as the multi-line
 * prompt editor; this field does not). Bound as a `Prec.high` keymap
 * through the substrate's `extensions` seam; the query mirrors out of the
 * CM6 doc via an `updateListener` (the same technique the prompt entry
 * uses for its ⌕ query mirror), so there is no controlled-input
 * round-trip.
 *
 * One find CONTROLLER across the deck: the bar instantiates the shared
 * {@link FindSession} (query, options, wrap bookkeeping, the cluster face)
 * and supplies the Text card's {@link FindEngineDelegate} — a thin object
 * over the editor's own CodeMirror search (`TugTextCardEditorDelegate`),
 * which is virtualization-proof because CM6 works off the document. The
 * session is what the shared cluster and the shared {@link FindWrapOverlay}
 * read; options seed from the GLOBAL find preference and persist back
 * through the session's `onOptionsChanged` hook (`putFindOptions`) —
 * identical wiring to the Dev card. (Parity note: the count refreshes on
 * find actions, not on document edits made while the bar is open.)
 *
 * Laws: [L02] the surface snapshot is `Object.is`-stable between refreshes;
 * [L06] match painting is CM6 decoration state, never React state; [L11]
 * the cluster's toggles emit `setValue` and this bar's responder applies it;
 * [L22]-adjacent: the query lives in the CM6 doc, mirrored imperatively.
 *
 * @module components/tugways/cards/text-card-find-bar
 */

import "./text-card-find-bar.css";

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
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { readFindOptions, putFindOptions } from "@/settings-api";
import {
  FindSession,
  DEFAULT_FIND_OPTIONS,
  type FindEngineDelegate,
} from "@/lib/find-session";
import type { TugTextCardEditorDelegate } from "@/components/tugways/tug-text-card-editor";

/**
 * The Text card's find engine: CM6 search behind the shared
 * {@link FindEngineDelegate} protocol. Search-as-you-type lands on the
 * first result (select + reveal — vertical centre, horizontal pan); the
 * session owns everything else.
 */
function documentFindEngine(
  getDelegate: () => TugTextCardEditorDelegate | null,
): FindEngineDelegate {
  return {
    searchDidChange: (query, options) => {
      const delegate = getDelegate();
      if (delegate === null) return;
      delegate.setSearchQuery({
        search: query,
        caseSensitive: options.caseSensitive,
        regexp: options.grep,
        wholeWord: options.wholeWord,
      });
      if (query.length > 0) delegate.selectFirstMatch();
    },
    findNext: () => getDelegate()?.findNext(),
    findPrevious: () => getDelegate()?.findPrevious(),
    matchInfo: () =>
      getDelegate()?.getMatchInfo() ?? {
        count: 0,
        activeOrdinal: null,
        capped: false,
      },
    clear: () => getDelegate()?.clearSearch(),
  };
}

export interface TextCardFindBarProps {
  /** Resolve the live editor delegate (null while unmounted). */
  getDelegate: () => TugTextCardEditorDelegate | null;
  /** Dismiss gesture (Escape). The host clears the search + refocuses. */
  onClose: () => void;
  /**
   * The card's root element — the shared {@link FindWrapOverlay}'s
   * containment box (the wrap graphic anchors to the card, exactly as it
   * does over the Dev card).
   */
  cardRootRef: React.RefObject<HTMLElement | null>;
}

/** Imperative surface the Text card drives: ⌘F on an already-open bar must
 *  put the caret back in the query field, unconditionally; and a find
 *  navigation performed OUTSIDE the bar (the document editor's own ⌘G
 *  handler) refreshes the count badge through `refreshCount`. */
export interface TextCardFindBarHandle {
  focusQuery(): void;
  refreshCount(): void;
}

export const TextCardFindBar = React.forwardRef<
  TextCardFindBarHandle,
  TextCardFindBarProps
>(function TextCardFindBar(
  { getDelegate, onClose, cardRootRef }: TextCardFindBarProps,
  ref,
): React.ReactElement {
  const barResponderId = React.useId();
  const substrateRef = useRef<TugTextEditorDelegate | null>(null);

  const getDelegateRef = useRef(getDelegate);
  getDelegateRef.current = getDelegate;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // ONE shared find controller ([lib/find-session]): options seed from the
  // global preference and persist back through the session hook; the Text
  // card supplies its CM6 engine as the session's delegate. The session is
  // both the cluster's FindSurface and the wrap overlay's source.
  const sessionRef = useRef<FindSession | null>(null);
  if (sessionRef.current === null) {
    const client = getTugbankClient();
    const seeded = client ? readFindOptions(client) : null;
    const session = new FindSession(seeded ?? undefined, {
      onOptionsChanged: putFindOptions,
    });
    session.setDelegate(documentFindEngine(() => getDelegateRef.current()));
    sessionRef.current = session;
  }
  const session = sessionRef.current;
  useEffect(() => () => session.clear(), [session]);

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

  // Summoned: take the caret. ⌘F on an already-open bar re-summons through
  // the same imperative seam.
  useEffect(() => {
    substrateRef.current?.focus();
  }, []);
  React.useImperativeHandle(
    ref,
    (): TextCardFindBarHandle => ({
      focusQuery: () => {
        substrateRef.current?.focus();
      },
      refreshCount: () => {
        session.refresh();
      },
    }),
    [session],
  );

  // The bar is the responder for find NAVIGATION while it is open: with the
  // caret in the query field, ⌘G / ⇧⌘G walk field → bar and land here (the
  // document editor's own handlers are a sibling branch the walk from the
  // field can never reach). FIND re-summons the caret into the field. The
  // bar owns the search session state (query, options, count) — it is the
  // responder for the actions that mutate it ([L11]).
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
    },
  });

  return (
    <ResponderScope>
    <TugEntryShell
      ref={responderRef as (el: HTMLDivElement | null) => void}
      className="text-card-find-bar"
      data-slot="text-card-find-bar"
      toolbarCenter={<TugFindCluster surface={session} />}
      toolbarTrailing={
        <>
          <TugPushButton
            subtype="icon"
            size="lg"
            // Outlined, not filled: Previous is the secondary of the
            // Next/Previous pair — the filled button is "next" (the Return
            // gesture's twin), this outlined one is "previous". Mirrors the
            // Dev entry's ⌕-route Z5 pair.
            emphasis="outlined"
            role="action"
            onClick={() => session.previous()}
            aria-label="Find previous"
            icon={<ChevronUp size={18} strokeWidth={2.5} />}
          />
          <TugPushButton
            subtype="icon"
            size="lg"
            emphasis="filled"
            role="action"
            onClick={() => session.next()}
            aria-label="Find next"
            icon={<ChevronDown size={18} strokeWidth={2.5} />}
          />
        </>
      }
    >
      <TugTextEditor
        ref={substrateRef}
        borderless
        maxRows={6}
        placeholder="Find in file"
        aria-label="Find in file"
        data-testid="text-card-find-input"
        /* The Text card owns its card-state-preservation slot; a transient
           find field must not stash editor state into the card bag. */
        preserveState={false}
        extensions={findBarExtensions}
      />
    </TugEntryShell>
      <FindWrapOverlay findSession={session} cardRef={cardRootRef} />
    </ResponderScope>
  );
});
