/**
 * `TextCardFindBar` — the Text card's bottom-docked find bar.
 *
 * The document twin of the Dev card's Find route: a query field, the shared
 * {@link TugFindCluster} (Case / Word / Grep + the width-stabilized
 * "N of M" chip), and the Previous / Next pair styled like the Dev entry's
 * Z5 buttons (outlined ↑ beside filled ↓). It docks between the editor and
 * the status bar; ⌘F summons it (the card's `onFindRequested`), Escape (or
 * ✕) dismisses.
 *
 * The engine is the editor's own CodeMirror search, reached through
 * `TugTextCardEditorDelegate` — CM6 works off the document, so counting and
 * match painting are virtualization-proof. This bar owns the query (a
 * controlled input) and the option toggles (seeded from the GLOBAL find
 * options at `dev.tugtool.find`/`options` and written back through
 * `putFindOptions` — one preference shared by every find surface); the
 * {@link FindSurface} it feeds the cluster is a thin snapshot cache over
 * `delegate.getMatchInfo()`, re-read after every query / option / navigation
 * action (parity note: like the previous find strip, the count refreshes on
 * find actions, not on document edits made while the bar is open).
 *
 * Laws: [L02] the surface snapshot is `Object.is`-stable between refreshes;
 * [L06] match painting is CM6 decoration state, never React state; [L11]
 * the cluster's toggles emit `setValue` and this bar's responder applies it.
 *
 * @module components/tugways/cards/text-card-find-bar
 */

import "./text-card-find-bar.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { TugFindCluster } from "@/components/tugways/tug-find-cluster";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugInput } from "@/components/tugways/tug-input";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { readFindOptions, putFindOptions } from "@/settings-api";
import { DEFAULT_FIND_OPTIONS } from "@/lib/dev-find-session";
import type { FindSurface, FindSurfaceSnapshot } from "@/lib/find-surface";
import type { FindOptions } from "@/lib/transcript-search";
import type { TugTextCardEditorDelegate } from "@/components/tugways/tug-text-card-editor";

/** Mutable find-surface over the editor delegate's `getMatchInfo`. */
class TextCardFindSurface implements FindSurface {
  private listeners = new Set<() => void>();
  private snapshot: FindSurfaceSnapshot;

  constructor(
    private readonly getDelegate: () => TugTextCardEditorDelegate | null,
    private readonly onSetOptions: (next: FindOptions) => void,
    initialOptions: FindOptions,
  ) {
    this.snapshot = {
      options: initialOptions,
      count: 0,
      activeOrdinal: null,
      capped: false,
      hasQuery: false,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FindSurfaceSnapshot => this.snapshot;

  setOptions = (next: FindOptions): void => {
    this.onSetOptions(next);
  };

  /** Re-read the delegate's match info into a fresh snapshot and notify. */
  refresh(options: FindOptions, hasQuery: boolean): void {
    const info = hasQuery
      ? (this.getDelegate()?.getMatchInfo() ?? {
          count: 0,
          activeOrdinal: null,
          capped: false,
        })
      : { count: 0, activeOrdinal: null, capped: false };
    this.snapshot = { options, hasQuery, ...info };
    for (const listener of this.listeners) listener();
  }
}

export interface TextCardFindBarProps {
  /** Resolve the live editor delegate (null while unmounted). */
  getDelegate: () => TugTextCardEditorDelegate | null;
  /** Dismiss gesture (Escape / ✕). The host clears the search + refocuses. */
  onClose: () => void;
}

export function TextCardFindBar({
  getDelegate,
  onClose,
}: TextCardFindBarProps): React.ReactElement {
  const [query, setQuery] = useState("");
  // Seeded from the global find-options preference; written back on toggle.
  const [options, setOptions] = useState<FindOptions>(() => {
    const client = getTugbankClient();
    return (client ? readFindOptions(client) : null) ?? DEFAULT_FIND_OPTIONS;
  });
  const inputRef = useRef<HTMLInputElement | null>(null);

  const getDelegateRef = useRef(getDelegate);
  getDelegateRef.current = getDelegate;

  const runSearch = useCallback(
    (nextQuery: string, nextOptions: FindOptions): void => {
      getDelegateRef.current()?.setSearchQuery({
        search: nextQuery,
        caseSensitive: nextOptions.caseSensitive,
        regexp: nextOptions.grep,
        wholeWord: nextOptions.wholeWord,
      });
    },
    [],
  );

  const surfaceRef = useRef<TextCardFindSurface | null>(null);
  const handleSetOptions = useCallback(
    (next: FindOptions): void => {
      setOptions(next);
      putFindOptions(next);
    },
    [],
  );
  if (surfaceRef.current === null) {
    surfaceRef.current = new TextCardFindSurface(
      () => getDelegateRef.current(),
      handleSetOptions,
      options,
    );
  }
  const surface = surfaceRef.current;

  // Re-run the live query when the options change (toggle click), then
  // refresh the chip from the new decoration state.
  const optionsRef = useRef(options);
  useEffect(() => {
    if (optionsRef.current === options) return;
    optionsRef.current = options;
    runSearch(query, options);
    surface.refresh(options, query.length > 0);
    // `query` is deliberately read from state without re-running on its own
    // changes — the input's onChange already re-ran the search for those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  // Summoned: take the caret.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleQueryChange = useCallback(
    (value: string): void => {
      setQuery(value);
      runSearch(value, optionsRef.current);
      surface.refresh(optionsRef.current, value.length > 0);
    },
    [runSearch, surface],
  );

  const navigate = useCallback(
    (direction: "next" | "previous"): void => {
      const delegate = getDelegateRef.current();
      if (delegate === null) return;
      if (direction === "next") delegate.findNext();
      else delegate.findPrevious();
      surface.refresh(optionsRef.current, query.length > 0);
    },
    [surface, query],
  );

  const clusterSurface = useMemo(() => surface, [surface]);

  return (
    <div className="text-card-find-bar" data-slot="text-card-find-bar">
      <TugInput
        ref={inputRef}
        size="sm"
        value={query}
        placeholder="Find in file"
        aria-label="Find in file"
        data-testid="text-card-find-input"
        className="text-card-find-bar-input"
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            navigate(e.shiftKey ? "previous" : "next");
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
      />
      <span className="text-card-find-bar-spacer" aria-hidden="true" />
      <TugFindCluster surface={clusterSurface} />
      <span className="text-card-find-bar-spacer" aria-hidden="true" />
      <div className="text-card-find-bar-nav" data-slot="text-card-find-nav">
        <TugIconButton
          icon={<ChevronUp />}
          aria-label="Previous match"
          onClick={() => navigate("previous")}
        />
        <TugIconButton
          icon={<ChevronDown />}
          aria-label="Next match"
          onClick={() => navigate("next")}
        />
        <TugIconButton icon={<X />} aria-label="Close find" onClick={onClose} />
      </div>
    </div>
  );
}
