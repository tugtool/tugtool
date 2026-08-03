/**
 * `TextCardFindBar` — the Text card's bottom-docked find bar.
 *
 * The bar itself is the shared {@link TugFindBar}; this wrapper supplies the
 * two things that are genuinely the Text card's own: the {@link FindSession}
 * and the CM6 engine behind it.
 *
 * One find CONTROLLER across the deck: the wrapper instantiates the shared
 * {@link FindSession} (query, options, wrap bookkeeping, the cluster face)
 * and supplies the Text card's {@link FindEngineDelegate} — a thin object
 * over the editor's own CodeMirror search (`TugTextCardEditorDelegate`),
 * which is virtualization-proof because CM6 works off the document. Options
 * seed from the GLOBAL find preference and persist back through the session's
 * `onOptionsChanged` hook (`putFindOptions`) — identical wiring to the
 * Session card. (Parity note: the count refreshes on find actions, not on
 * document edits made while the bar is open.)
 *
 * The session's lifetime is the bar's here: it is created on mount and
 * cleared on unmount, so dismissing the bar ends the search.
 *
 * @module components/tugways/cards/text-card-find-bar
 */

import React, { useEffect, useRef } from "react";

import {
  TugFindBar,
  type TugFindBarHandle,
} from "@/components/tugways/tug-find-bar";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { readFindOptions, putFindOptions } from "@/settings-api";
import { FindSession, type FindEngineDelegate } from "@/lib/find-session";
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
   * The card's root element — the shared find-wrap overlay's containment box
   * (the wrap graphic anchors to the card).
   */
  cardRootRef: React.RefObject<HTMLElement | null>;
}

/** The Text card drives the shared bar's imperative surface directly. */
export type TextCardFindBarHandle = TugFindBarHandle;

export const TextCardFindBar = React.forwardRef<
  TextCardFindBarHandle,
  TextCardFindBarProps
>(function TextCardFindBar(
  { getDelegate, onClose, cardRootRef }: TextCardFindBarProps,
  ref,
): React.ReactElement {
  const getDelegateRef = useRef(getDelegate);
  getDelegateRef.current = getDelegate;

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

  return (
    <TugFindBar
      ref={ref}
      session={session}
      onClose={onClose}
      cardRootRef={cardRootRef}
      placeholder="Find in file"
      className="text-card-find-bar"
      dataSlot="text-card-find-bar"
      inputTestId="text-card-find-input"
    />
  );
});
