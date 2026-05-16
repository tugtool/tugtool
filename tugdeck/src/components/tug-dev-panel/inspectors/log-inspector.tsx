/**
 * `LogInspector` — second inspector tab. Renders the in-app log
 * buffer surfaced by `tugDevLogStore` with level / source / free-text
 * filters, a clear affordance, and "Copy filtered log as JSON / text"
 * actions.
 *
 * Auto-scroll-to-head: when the user is at the top of the list
 * (`scrollTop <= 8px`), new appends keep the head pinned to 0. When
 * the user has scrolled away, new appends leave the scroll alone so
 * the user can read history without being yanked. The scroll write
 * is DOM-only (per [L06]) and rAF-batched (per [L13]) so a burst of
 * appends in one frame produces one scroll write.
 *
 * Conformance:
 *   - [L02] reads `tugDevLogStore` via `useSyncExternalStore`.
 *   - [L06] auto-scroll writes `scrollTop` directly on the DOM node;
 *     no React state mediates it.
 *   - [L13] scroll writes are rAF-batched.
 *   - [L19] decomposed into focused components (`LogRow`).
 *   - [L20] reads only `--tugx-devlog-*` slots declared in the paired
 *     `log-inspector.css` file.
 *   - Free-text filter ownership: lives on `tugDevLogStore.filters.text`
 *     so it survives tab switch.
 *
 * @module components/tug-dev-panel/inspectors/log-inspector
 */

import "./log-inspector.css";

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Check, ChevronDown, Copy, Eraser } from "lucide-react";

import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";
import {
  TUG_DEV_LOG_LEVELS,
  type TugDevLogLevel,
} from "@/lib/tug-dev-log-store/types";
import {
  extractSources,
  filterEntries,
  stringifyDataForSearch,
} from "@/lib/tug-dev-log-store/filter";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugInput } from "@/components/tugways/tug-input";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugOptionGroup } from "@/components/tugways/tug-option-group";
import type { TugOptionItem } from "@/components/tugways/tug-option-group";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import type { TugPopupMenuItem } from "@/components/tugways/internal/tug-popup-menu";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";

import { copyAsJson } from "../copy-as-json";
import { LogRow } from "./log-row";

/** Sentinel id meaning "show all sources." */
const ALL_SOURCES_ID = "__tugdevlog_all_sources__";

/** Threshold (in px) below which we consider the user "at the head"
 * and auto-scroll new appends. Above the threshold, scroll is left
 * alone so the user can read history. */
const AT_HEAD_THRESHOLD_PX = 8;

function isLogLevel(v: string): v is TugDevLogLevel {
  return v === "debug" || v === "info" || v === "warn" || v === "error";
}

/** Format a log entry for plain-text copy. Mirrors the visual row
 * but on one line. */
function formatEntryForText(
  entry: import("@/lib/tug-dev-log-store/types").TugDevLogEntry,
): string {
  const ts = new Date(entry.timestamp).toISOString();
  const dataStr = stringifyDataForSearch(entry);
  const dataPart = dataStr.length > 0 ? ` ${dataStr}` : "";
  return `${ts} ${entry.level.padEnd(5)} [${entry.source}] ${entry.message}${dataPart}`;
}

export const LogInspector: React.FC = () => {
  const snapshot = useSyncExternalStore(
    tugDevLogStore.subscribe,
    tugDevLogStore.getSnapshot,
  );

  const visible = useMemo(
    () => filterEntries(snapshot.entries, snapshot.filters),
    // Re-derive whenever the entries reference or filters reference
    // changes. The reducer only allocates new references on actual
    // changes (see reducer.ts), so the memo is tight.
    [snapshot.entries, snapshot.filters],
  );

  // Sources for the source-filter popup. Derived from the FULL buffer
  // (not the filtered view), so the popup keeps the same options when
  // a different filter is in play.
  const sources = useMemo(
    () => extractSources(snapshot.entries),
    [snapshot.entries],
  );

  // ── Auto-scroll-to-head ───────────────────────────────────────────────
  // The container is column-reverse: index 0 (newest) renders at the
  // top, so "at head" means scrollTop near 0. We snapshot the
  // pre-paint scrollTop in a layout effect and, if it was at-head,
  // write 0 back inside a rAF after the paint to keep the head pinned.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasAtHeadRef = useRef(true);
  const rafIdRef = useRef<number | null>(null);

  // Update wasAtHeadRef on scroll. DOM-only — no React state.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      wasAtHeadRef.current = el.scrollTop <= AT_HEAD_THRESHOLD_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!wasAtHeadRef.current) return;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    });
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
    // version increments on every reducer mutation; we depend on it
    // rather than `entries` so even a same-length replacement (e.g.
    // when the buffer is at cap and one rolls off) still triggers
    // the head-pin pass.
  }, [snapshot.version]);

  // ── Level filter via TugOptionGroup ────────────────────────────────────
  // One multi-select option group with four items (one per level).
  // TugOptionGroup dispatches `setValue` with the new `string[]` of
  // active values through the responder chain — we bind it via
  // `useResponderForm` and route into `tugDevLogStore.setLevels(new Set(...))`.
  // The `string[]` ↔ `Set<TugDevLogLevel>` adapter narrows + validates
  // each value so a corrupted payload (e.g. from a future renamed
  // level) doesn't silently land in the filter set.
  const levelGroupSenderId = useId();
  const handleSetLevels = useCallback((nextValues: string[]) => {
    const narrowed = new Set<TugDevLogLevel>();
    for (const v of nextValues) {
      if (isLogLevel(v)) narrowed.add(v);
    }
    tugDevLogStore.setLevels(narrowed);
  }, []);

  const { ResponderScope, responderRef } = useResponderForm({
    // `setValueStringArray` is the slot for `setValue` payloads of
    // shape `string[]` — see `use-responder-form.tsx`. `TugOptionGroup`
    // dispatches its new active set through this slot.
    setValueStringArray: { [levelGroupSenderId]: handleSetLevels },
  });

  const activeLevelValues = useMemo<string[]>(
    () => TUG_DEV_LOG_LEVELS.filter((l) => snapshot.filters.levels.has(l)),
    [snapshot.filters.levels],
  );

  const levelItems = useMemo<TugOptionItem[]>(
    () => TUG_DEV_LOG_LEVELS.map((level) => ({ value: level, label: level })),
    [],
  );

  // ── Source filter ─────────────────────────────────────────────────────
  const handleSelectSource = useCallback((id: string) => {
    tugDevLogStore.setSource(id === ALL_SOURCES_ID ? null : id);
  }, []);

  const sourceItems: TugPopupMenuItem[] = useMemo(() => {
    const items: TugPopupMenuItem[] = [
      { id: ALL_SOURCES_ID, label: "All sources" },
    ];
    for (const s of sources) {
      items.push({ id: s, label: s });
    }
    return items;
  }, [sources]);

  const sourceTriggerLabel =
    snapshot.filters.source === null ? "All sources" : snapshot.filters.source;

  // ── Free-text filter ───────────────────────────────────────────────────
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      tugDevLogStore.setText(e.target.value);
    },
    [],
  );

  // ── Toolbar actions ────────────────────────────────────────────────────
  const [cleared, setCleared] = useState(false);
  const clearedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (clearedTimerRef.current !== null) {
        window.clearTimeout(clearedTimerRef.current);
        clearedTimerRef.current = null;
      }
    };
  }, []);

  const handleClear = useCallback(() => {
    tugDevLogStore.clear();
    setCleared(true);
    if (clearedTimerRef.current !== null) {
      window.clearTimeout(clearedTimerRef.current);
    }
    clearedTimerRef.current = window.setTimeout(() => {
      setCleared(false);
      clearedTimerRef.current = null;
    }, 1500);
  }, []);

  const [copiedJson, setCopiedJson] = useState(false);
  const copiedJsonTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copiedJsonTimerRef.current !== null) {
        window.clearTimeout(copiedJsonTimerRef.current);
        copiedJsonTimerRef.current = null;
      }
    };
  }, []);

  const handleCopyJson = useCallback(async () => {
    const ok = await copyAsJson(visible);
    if (!ok) return;
    setCopiedJson(true);
    if (copiedJsonTimerRef.current !== null) {
      window.clearTimeout(copiedJsonTimerRef.current);
    }
    copiedJsonTimerRef.current = window.setTimeout(() => {
      setCopiedJson(false);
      copiedJsonTimerRef.current = null;
    }, 1500);
  }, [visible]);

  const [copiedText, setCopiedText] = useState(false);
  const copiedTextTimerRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTextTimerRef.current !== null) {
        window.clearTimeout(copiedTextTimerRef.current);
        copiedTextTimerRef.current = null;
      }
    };
  }, []);

  const handleCopyText = useCallback(async () => {
    const text = visible.map(formatEntryForText).join("\n");
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) return;
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.warn("[devpanel] copyText failed:", err);
      return;
    }
    setCopiedText(true);
    if (copiedTextTimerRef.current !== null) {
      window.clearTimeout(copiedTextTimerRef.current);
    }
    copiedTextTimerRef.current = window.setTimeout(() => {
      setCopiedText(false);
      copiedTextTimerRef.current = null;
    }, 1500);
  }, [visible]);

  // Render newest-at-top: iterate the buffer in reverse so the most
  // recent append is the first child. (Column-reverse would invert
  // the visual order, but column-reverse + auto-scroll-to-bottom
  // combine awkwardly across browsers — reversing the array and
  // pinning scrollTop to 0 is simpler.)
  const visibleNewestFirst = useMemo(() => {
    const out = [...visible];
    out.reverse();
    return out;
  }, [visible]);

  return (
    <ResponderScope>
      <div
        ref={responderRef as (el: HTMLDivElement | null) => void}
        className="tug-devlog-inspector"
      >
        <div className="tug-devlog-filters">
          <div className="tug-devlog-source">
            <TugLabel
              size="3xs"
              color="muted"
              className="tug-devlog-source-label"
            >
              Source
            </TugLabel>
            <TugPopupMenu
              trigger={
                <TugButton
                  emphasis="outlined"
                  role="option"
                  size="xs"
                  trailingIcon={<ChevronDown size={10} />}
                  className="tug-devlog-source-trigger"
                  aria-label="Filter by source"
                  disabled={sources.length === 0}
                >
                  {sourceTriggerLabel}
                </TugButton>
              }
              items={sourceItems}
              onSelect={handleSelectSource}
            />
          </div>
          <TugInput
            size="sm"
            placeholder="Filter text…"
            value={snapshot.filters.text}
            onChange={handleTextChange}
            className="tug-devlog-text"
            aria-label="Free-text filter"
          />
        </div>

        <div className="tug-devlog-toolbar">
          <TugOptionGroup
            size="xs"
            emphasis="default"
            role="action"
            items={levelItems}
            value={activeLevelValues}
            senderId={levelGroupSenderId}
            aria-label="Filter by level"
            className="tug-devlog-levels"
          />
          <div className="tug-devlog-toolbar-actions">
            <TugPushButton
              size="xs"
              emphasis="outlined"
              role="action"
              subtype="icon-text"
              icon={<Eraser size={12} />}
              onClick={handleClear}
              disabled={snapshot.entries.length === 0}
              confirmation={{ icon: <Check size={12} />, label: "Cleared" }}
              isConfirming={cleared}
              widthStabilize={{ alternateLabel: "Clear" }}
            >
              Clear
            </TugPushButton>
            <TugPushButton
              size="xs"
              emphasis="outlined"
              role="action"
              subtype="icon-text"
              icon={<Copy size={12} />}
              onClick={handleCopyJson}
              disabled={visible.length === 0}
              confirmation={{ icon: <Check size={12} />, label: "Copied" }}
              isConfirming={copiedJson}
              widthStabilize={{ alternateLabel: "Copy as JSON" }}
            >
              Copy as JSON
            </TugPushButton>
            <TugPushButton
              size="xs"
              emphasis="outlined"
              role="action"
              subtype="icon-text"
              icon={<Copy size={12} />}
              onClick={handleCopyText}
              disabled={visible.length === 0}
              confirmation={{ icon: <Check size={12} />, label: "Copied" }}
              isConfirming={copiedText}
              widthStabilize={{ alternateLabel: "Copy as text" }}
            >
              Copy as text
            </TugPushButton>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="tug-devlog-list"
          data-empty={visibleNewestFirst.length === 0 ? "true" : "false"}
        >
          {visibleNewestFirst.length === 0 ? (
            <TugLabel
              size="xs"
              color="muted"
              className="tug-devlog-empty"
            >
              {snapshot.entries.length === 0
                ? "No log entries yet."
                : "No entries match the current filters."}
            </TugLabel>
          ) : (
            visibleNewestFirst.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </div>
    </ResponderScope>
  );
};
LogInspector.displayName = "LogInspector";
