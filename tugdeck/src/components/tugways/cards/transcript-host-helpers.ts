/**
 * Transcript-host helpers — value exports split out of
 * `dev-card-transcript.tsx` so that file stays a component-only React Fast
 * Refresh boundary. A `.tsx` exporting hooks/functions alongside its
 * `DevTranscriptHost` component is "mixed" and non-accepting, so editing it
 * (or anything it transitively imports) full-reloads. This module owns the
 * model-name hook, the timestamp formatter, and the per-cell context-menu
 * wiring; `dev-card-transcript.tsx` and the copy-wiring gallery import them.
 *
 * **Laws:** [L02] — `useSessionModelName` reads the model through
 * `useSyncExternalStore` over `SessionMetadataStore` only. [L07] — the
 * cell-menu copy/select-all handlers sample the body element live from a ref
 * and close over the captured value, so a re-render during the menu blink
 * can't race the deferred operation. [L11] — the menu dispatches COPY /
 * SELECT_ALL via `useResponder` + targeted control dispatch, the canonical
 * tugway control shape.
 *
 * @module components/tugways/cards/transcript-host-helpers
 */

import React, { useCallback, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { LOCAL_SLASH_COMMANDS } from "@/lib/slash-commands";
import {
  HighlightSelectionAdapter,
  type TextSelectionAdapter,
} from "@/components/tugways/text-selection-adapter";
import { transcriptMarkdownToHtml } from "@/lib/markdown/transcript-copy-html";
import type { ActionHandlerResult } from "@/components/tugways/responder-chain";
import { useResponder } from "@/components/tugways/use-responder";
import { useTextSurfaceContextMenu } from "@/components/tugways/use-text-surface-context-menu";
import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";

/**
 * Read the active model name from a `SessionMetadataStore` via
 * `useSyncExternalStore` ([L02]). Returns `null` when the store has
 * not yet observed a `system_metadata` event for this session.
 */
export function useSessionModelName(
  sessionMetadataStore: SessionMetadataStore,
): string | null {
  return useSyncExternalStore(
    sessionMetadataStore.subscribe,
    useCallback(
      () => sessionMetadataStore.getSnapshot().model,
      [sessionMetadataStore],
    ),
  );
}

/**
 * Build a predicate over the *known* slash-command set: claude's live
 * catalog (`SessionMetadataStore.slashCommands`) unioned with the dev
 * card's locally-handled commands (`LOCAL_SLASH_COMMANDS`). The transcript
 * passes this to `TugMarkdownBlock` to gate which inline `<code>` command
 * spans become clickable (`enhance-slash-commands`) — the strict known-list
 * gate, not a loose regex.
 *
 * [L02] — the catalog is read through `useSyncExternalStore`. The predicate
 * identity is memoized on the catalog array (stable between store changes,
 * so unrelated metadata updates don't rebuild the set); a catalog change
 * yields a fresh predicate, which newly-mounting turn cells pick up.
 */
export function useKnownSlashCommand(
  sessionMetadataStore: SessionMetadataStore,
): (name: string) => boolean {
  const catalog = useSyncExternalStore(
    sessionMetadataStore.subscribe,
    useCallback(
      () => sessionMetadataStore.getSnapshot().slashCommands,
      [sessionMetadataStore],
    ),
  );
  return useMemo(() => {
    const set = new Set<string>();
    for (const cmd of catalog) set.add(cmd.name);
    for (const cmd of LOCAL_SLASH_COMMANDS) set.add(cmd.name);
    return (name: string) => set.has(name);
  }, [catalog]);
}

/**
 * Format an absolute millisecond timestamp as a short clock-style
 * string for display next to a transcript row's identifier.
 *
 * The hour-minute separator uses U+2236 RATIO (`∶`) rather than the
 * standard ASCII colon (U+003A `:`). The RATIO glyph is vertically
 * centered between the digits the way clock-display fonts render
 * the time separator — most text fonts paint the ASCII colon
 * anchored to the baseline, which reads as "too low" between
 * numerals. The substitution is portable across fonts (it's a
 * different character, not a font-feature-settings toggle that
 * many fonts don't ship), and pairs cleanly with the timestamp's
 * `font-variant-numeric: tabular-nums` so each digit cell + the
 * centered separator stays put as the time advances.
 *
 * Returns the empty string for the special sentinel `0` so a callsite
 * can pass `entry.endedAt` unconditionally without fabricating a
 * "Jan 1 1970" timestamp on rows whose end-time was never recorded.
 */
export function formatTranscriptTimestamp(ms: number): string {
  if (ms === 0 || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const raw = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  // Replace the locale-emitted ASCII colon with U+2236 RATIO.
  // Locales that use a non-colon separator (some European locales
  // use `.`) pass through unchanged — only the ASCII `:` is
  // substituted.
  return raw.replace(/:/g, "∶");
}

// ---------------------------------------------------------------------------
// Per-cell context-menu wiring
// ---------------------------------------------------------------------------

/**
 * Per-cell context menu + responder wiring for transcript entries.
 *
 * Each entry installs its own responder + right-click menu via the
 * shared `useTextSurfaceContextMenu` hook so the same code path that
 * powers the editor and markdown view drives transcript-cell
 * right-clicks. Per-entry scope follows from the responder model:
 * the document-level pointerdown listener in
 * `ResponderChainProvider` promotes whichever cell's responder owns
 * the click target to first responder, and `TugEditorContextMenu`
 * dispatches first-responder-targeted, so items from the menu reach
 * THIS cell's `COPY` / `SELECT_ALL` handlers — no
 * `makeFirstResponder` boilerplate needed.
 *
 * The cell uses a query-only `HighlightSelectionAdapter` scoped to its body
 * element (for the menu's Cut / Copy enablement). Selection preservation on a
 * secondary-click is handled by the hook's `onMouseDown` preventDefault guard
 * (wired to the cell's `onMouseDown`), so the selection is never collapsed and
 * there is no capture/restore. The adapter is held in a ref the hook reads
 * live; it is `null` until the body mounts (the hook tolerates that).
 */
interface TranscriptCellProps {
  ref: (node: Element | null) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMouseDown: (event: React.MouseEvent) => void;
}

/**
 * Resolve a live selection within the cell body to markdown. Returns
 * `null` when nothing copyable was touched (the hook then falls back to
 * plain text as a last-resort guard). The assistant cell supplies a
 * resolver that reconstructs markdown across the row's blocks ([P03]);
 * the user cell omits it and copies plain text.
 */
export type CopyMarkdownResolver = (
  bodyEl: HTMLElement,
  selection: Selection,
) => string | null;

/**
 * Write a copied selection to the clipboard in both flavors ([P05]):
 * `text/plain` (markdown for plain paste targets) and, when an HTML
 * rendering is available, `text/html` (rich paste targets). Built and
 * issued synchronously inside the copy gesture so transient activation
 * still holds. Degrades to `writeText` when `ClipboardItem` / async
 * `clipboard.write` is unavailable or the dual-format write rejects, so
 * copy never silently produces nothing ([P07]).
 */
function writeCopyClipboard(plain: string, html: string | null): void {
  const clip = navigator.clipboard;
  if (clip === undefined || clip === null) return;
  if (
    html !== null &&
    typeof ClipboardItem !== "undefined" &&
    typeof clip.write === "function"
  ) {
    try {
      const item = new ClipboardItem({
        "text/plain": new Blob([plain], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      void clip.write([item]).catch(() => {
        void clip.writeText?.(plain);
      });
      return;
    } catch {
      // ClipboardItem construction or write threw synchronously —
      // fall through to the plain-text path below.
    }
  }
  void clip.writeText?.(plain);
}

// Exported for the copy-wiring app-test fixture (`gallery-transcript-copy`),
// which mounts this exact hook over a static body so `just app-test` drives
// the real ⌘C / menu-Copy path. Not part of the card's public API otherwise.
export function useTranscriptCellMenu(resolveCopyMarkdown?: CopyMarkdownResolver): {
  ResponderScope: React.FC<{ children: React.ReactNode }>;
  cellProps: TranscriptCellProps;
  bodyRef: React.MutableRefObject<HTMLElement | null>;
  menu: React.ReactNode;
} {
  const bodyRef = useRef<HTMLElement | null>(null);
  const adapterRef = useRef<TextSelectionAdapter | null>(null);
  // Live-ref the resolver ([L07]) so `handleCopy` keeps a stable
  // identity while always invoking the latest closure (which captures
  // the current messages / store).
  const resolveCopyRef = useRef(resolveCopyMarkdown);
  resolveCopyRef.current = resolveCopyMarkdown;

  // Build the adapter once the body element is available. Re-runs
  // whenever the body element identity changes (rare for inline-rendered
  // transcript cells; the body element is stable for the cell's life).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    adapterRef.current = body !== null ? new HighlightSelectionAdapter(body) : null;
  });

  // Copy reads the live selection synchronously inside the menu's
  // mousedown gesture so `clipboard.writeText` is permitted.
  const handleCopy = useCallback((): ActionHandlerResult => {
    const sel = window.getSelection();
    if (sel === null || sel.rangeCount === 0 || sel.isCollapsed) return;
    // Reconstruct markdown for the selection ([P03] — no plain-text
    // fallback for the markdown path). The plain-text branch is only a
    // last-resort guard for an unexpected DOM shape or a cell with no
    // resolver (the user row).
    const body = bodyRef.current;
    const resolve = resolveCopyRef.current;
    let text: string | null = null;
    if (body !== null && resolve !== undefined) {
      try {
        text = resolve(body, sel);
      } catch (err) {
        tugDevLogStore.warn(
          "dev-card-transcript",
          "copy reconstruction threw; falling back to plain text",
          { error: String(err) },
        );
        text = null;
      }
      // A resolver was available but produced nothing — the markdown
      // path failed for this selection. Surface it ([P07]) rather than
      // silently degrading to plain text. (No resolver = the user row,
      // which is plain text by design and not logged.)
      if (text === null) {
        tugDevLogStore.warn(
          "dev-card-transcript",
          "copy reconstruction yielded no markdown; falling back to plain text",
        );
      }
    }
    // `text` is the reconstructed markdown when the resolver produced
    // it (the markdown path), or null for the plain-text guard. The
    // markdown path writes both flavors ([P05]): text/plain = markdown,
    // text/html = that markdown re-rendered ([Q04]). The plain guard
    // writes text/plain only.
    let html: string | null = null;
    if (text !== null) {
      try {
        const rendered = transcriptMarkdownToHtml(text);
        html = rendered === "" ? null : rendered;
      } catch (err) {
        tugDevLogStore.warn(
          "dev-card-transcript",
          "copy text/html render threw; writing plain text only",
          { error: String(err) },
        );
        html = null;
      }
    }
    if (text === null) text = sel.toString();
    if (text === "") return;
    writeCopyClipboard(text, html);
  }, []);

  // Select All returns a continuation so the selection change lands
  // AFTER the menu's activation blink. Per [L07], the body element
  // is sampled at handler-invocation time (Phase 1, inside the user
  // gesture, when the ref is reliably populated) and the continuation
  // closes over the captured value — not over `bodyRef.current` —
  // so a re-render during the blink that flickers the inline ref
  // through `null` can't race the deferred operation.
  const handleSelectAll = useCallback((): ActionHandlerResult => {
    const root = bodyRef.current;
    if (root === null) return;
    return () => {
      const range = document.createRange();
      range.selectNodeContents(root);
      const sel = window.getSelection();
      if (sel === null) return;
      sel.removeAllRanges();
      sel.addRange(range);
    };
  }, []);

  const responderId = useId();
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.COPY]: handleCopy,
      [TUG_ACTIONS.SELECT_ALL]: handleSelectAll,
    },
  });

  // The shared hook owns menuState, the contextmenu pipeline, and
  // the menu render. We feed it the adapter (read live from the ref
  // so it's whatever the latest layout-effect installed) and the
  // capabilities for a read-only surface. The menu's items dispatch
  // via `useControlDispatch` to the parent responder — i.e., this
  // cell's `<ResponderScope>`, which we render the menu inside
  // below. The cell may never have been promoted to first responder
  // (the editor often holds it across the right-click), but targeted
  // dispatch via `parentId` doesn't care: COPY and SELECT_ALL always
  // land on this cell's handlers regardless of first-responder
  // state. Same canonical L11 shape every other tugway control uses.
  const {
    onMouseDown: hookMouseDown,
    onContextMenu: hookContextMenu,
    menu,
  } = useTextSurfaceContextMenu({
    adapterRef,
    capabilities: { canEdit: false },
  });

  // The hook returns native-event handlers; the cell wires them
  // through React event props. `onContextMenu` calls
  // `event.preventDefault` inside, so the system menu is suppressed
  // even when no adapter is attached yet. `onMouseDown` preventDefaults a
  // secondary-click over a range so the selection isn't collapsed.
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      hookContextMenu(event.nativeEvent);
    },
    [hookContextMenu],
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      hookMouseDown(event.nativeEvent);
    },
    [hookMouseDown],
  );

  return {
    ResponderScope,
    // No tabIndex on the cell: the transcript renders inside a read-only
    // (`interactive={false}`) TugListView, so nothing in the click chain is
    // focusable and the browser's mousedown-default focus walk finds no
    // target — DOM focus (the prompt entry's caret) survives a click on
    // transcript content. First-responder promotion of this cell rides the
    // chain's pointerdown promoter, which needs no focusable element, so
    // ⌘C / ⌘A and the right-click menu still route to this entry.
    cellProps: {
      ref: responderRef as (node: Element | null) => void,
      onContextMenu: handleContextMenu,
      onMouseDown: handleMouseDown,
    },
    bodyRef,
    menu,
  };
}
