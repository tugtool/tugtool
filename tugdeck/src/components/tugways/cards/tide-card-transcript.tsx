/**
 * tide-card-transcript.tsx — multi-turn transcript host for the Tide
 * card top pane.
 *
 * Mounts a `TugListView` against a `TideTranscriptDataSource` and
 * registers two cell renderers, one per row kind:
 *
 *   - `user` — `TugTranscriptEntry participant="user"` whose body is a
 *     plain `<span>` carrying `userMessage.text`. Per [D11], v1 user
 *     bodies are plain text; atom-aware rendering lands once the
 *     prompt-entry's atom flow reaches transcript form.
 *   - `code` — `TugTranscriptEntry participant="code"` rendered by a
 *     single `CodeRowCell` component for the assistant row's entire
 *     life (both in-flight and committed). `TugMarkdownBlock` (and
 *     siblings `TideThinkingBlock` / `TranscriptToolCalls`) stay in
 *     streaming mode forever, observing per-turn PropertyStore paths
 *     derived from `row.turnKey`: `turn.${turnKey}.assistant` /
 *     `.thinking` / `.tools`. After `turn_complete` those paths
 *     retain their final values (no other turn writes to them), so
 *     the same streaming subscription keeps surfacing the right
 *     content without any prop change or remount.
 *
 * **One kind per row identity, one renderer per kind** ([L26]).
 * Earlier revisions split the assistant row into `code-streaming` /
 * `code-committed` kinds with two separate `cellRenderers` entries.
 * At `turn_complete` React swapped component types — the cell
 * wrapper unmounted, `TugMarkdownBlock` died with it, the
 * scrollport's `scrollHeight` collapsed below `clientHeight` for a
 * frame, and the browser silently clamped `scrollTop` to 0. The
 * user saw this as the transcript jumping to the top right when the
 * assistant's reply was committed. The single-kind data source
 * (see {@link TideTranscriptCellKind}) makes the `cellRenderers`
 * map structurally hold only one entry for the assistant row, so
 * the L26 violation that produced that bug cannot recur.
 *
 * Identifier resolution: the `code` row's identifier is the active
 * model name from `SessionMetadataStore` (e.g. `"claude-3.7-sonnet"`),
 * falling back to `"Code"` when the metadata store has no model field
 * set yet (cold-start, replay-only fixtures, etc.).
 *
 * Persistence axis: the inner `TugListView` mounts with
 * `scrollKey="tide-card-transcript"` so the [A9] state-preservation
 * protocol picks the right slot in `bag.regionScroll[]`. The key is
 * unique within the Tide card's subtree per [L23] / [#public-api].
 *
 * Token sovereignty: `.tide-card-transcript .tug-list-view { ... }`
 * cascade-scoped overrides live in `tide-card.css` per [D12]. The
 * primitive's token surface stays untouched.
 *
 * Tuglaws:
 *  - [L02] `CodeRowCell` reads `pendingApproval` / `controlRequestLog`
 *    via `useSyncExternalStore`.
 *  - [L22] `TugMarkdownBlock` observes the `PropertyStore` directly
 *    and writes the DOM imperatively per delta.
 *  - [L23] preserves scroll position across what was previously a
 *    teardown event (the in-flight → committed transition).
 *  - [L26] stable React-reconciliation identity (key + component
 *    type + renderer reference) across that same transition is the
 *    upstream invariant L23 rides on here.
 */
 
import React, {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { HighlightSelectionAdapter, type TextSelectionAdapter } from "@/components/tugways/text-selection-adapter";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDelegate,
  type TugListViewHandle,
} from "@/components/tugways/tug-list-view";
import { TideThinkingBlock } from "@/components/tugways/chrome/tide-thinking-block";
import { TranscriptToolCalls } from "@/components/tugways/cards/tide-card-transcript-tool-calls";
import { TideZ1B } from "@/components/tugways/cards/tide-card-z1b";
import { dispatch as dispatchRenderInput } from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugTranscriptEntry } from "@/components/tugways/tug-transcript-entry";
import type { ActionHandlerResult } from "@/components/tugways/responder-chain";
import { useResponder } from "@/components/tugways/use-responder";
import { useTextSurfaceContextMenu } from "@/components/tugways/use-text-surface-context-menu";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  ControlRequestForward,
  ControlRequestRecord,
} from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { ResponseSettingsStore } from "@/lib/response-settings-store";
import {
  TideTranscriptDataSource,
  useTideTranscriptDataSource,
} from "@/lib/tide-transcript-data-source";
import type { PropertyStore } from "@/components/tugways/property-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  });
  // Replace the locale-emitted ASCII colon with U+2236 RATIO.
  // Locales that use a non-colon separator (some European locales
  // use `.`) pass through unchanged — only the ASCII `:` is
  // substituted.
  return raw.replace(/:/g, "∶");
}

/**
 * Strip the `>` Code route prefix from a user-row body for display.
 * Shell (`$`) and command (`:`) prefixes pass through unchanged — only
 * `>` is suppressed because the row's icon and identifier already
 * convey "this is a user prompt to the assistant", and the `>` glyph
 * adds visual noise without information.
 */
function stripUserBodyPrefix(text: string): string {
  if (text.startsWith("> ")) return text.slice(2);
  if (text.startsWith(">")) return text.slice(1);
  return text;
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
 * The cell uses a `HighlightSelectionAdapter` scoped to its body
 * element. The adapter handles the smart-click pipeline that fixed
 * the "right-click selects a word but Copy then fails" bug —
 * `prepareSelectionForRightClick` JS-commits the selection so it
 * survives the contextmenu's `preventDefault`, regardless of whether
 * the user had a prior selection or relied on WebKit's smart-click.
 *
 * `useTextSurfaceContextMenu` requires a non-null adapter at
 * hook-call time to set up the right-click pipeline, but our cell's
 * body element isn't available until after the cell mounts. We hold
 * the adapter in a ref that a layout-effect populates from the body
 * ref, and pass `adapterRef.current` to the hook. On the first
 * render the adapter is `null` (no body yet) — `useTextSurfaceContextMenu`
 * tolerates that and skips the pipeline; by the time the user can
 * right-click, the body has rendered and the layout-effect has
 * filled the adapter ref.
 */
interface TranscriptCellProps {
  ref: (node: Element | null) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onPointerDown: (event: React.PointerEvent) => void;
  /**
   * `tabIndex={-1}` makes the cell click-focusable (programmatically
   * focusable, not in the tab order). This matters because the
   * surrounding `TugListView` cell wrapper carries `tabIndex={0}`,
   * and the browser's mousedown-default focus walks up from the
   * click target looking for the deepest focusable ancestor. Without
   * this, the focus lands on the list-view's wrapper, fires a
   * `focusin` whose target sits ABOVE our cell's `data-responder-id`,
   * and the chain's focusin promoter walks UP from the wrapper
   * (skipping our cell entirely) to the card-content responder —
   * un-promoting the cell and routing subsequent ⌘C / ⌘A to the
   * card instead of to this entry. With `tabIndex={-1}` here, the
   * cell-div is the deepest focusable element in the chain, so the
   * mousedown focus lands on it, the resulting focusin re-confirms
   * the cell as first responder (no-op transition), and the cell
   * stays promoted across the menu lifetime. Keyboard Tab order is
   * preserved (`-1` excludes the cell from sequential navigation).
   */
  tabIndex: -1;
}

function useTranscriptCellMenu(): {
  ResponderScope: React.FC<{ children: React.ReactNode }>;
  cellProps: TranscriptCellProps;
  bodyRef: React.MutableRefObject<HTMLElement | null>;
  menu: React.ReactNode;
} {
  const bodyRef = useRef<HTMLElement | null>(null);
  const adapterRef = useRef<TextSelectionAdapter | null>(null);

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
    const text = sel.toString();
    if (text === "") return;
    void navigator.clipboard?.writeText(text);
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
    onPointerDown: hookPointerDown,
    onContextMenu: hookContextMenu,
    menu,
  } = useTextSurfaceContextMenu({
    adapter: adapterRef.current,
    capabilities: { canEdit: false },
  });

  // The hook returns native-event handlers; the cell wires them
  // through React event props. `onContextMenu` calls
  // `event.preventDefault` inside, so the system menu is suppressed
  // even when no adapter is attached yet.
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      hookContextMenu(event.nativeEvent);
    },
    [hookContextMenu],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      hookPointerDown(event.nativeEvent);
    },
    [hookPointerDown],
  );

  return {
    ResponderScope,
    cellProps: {
      ref: responderRef as (node: Element | null) => void,
      onContextMenu: handleContextMenu,
      onPointerDown: handlePointerDown,
      tabIndex: -1,
    },
    bodyRef,
    menu,
  };
}

// ---------------------------------------------------------------------------
// Cell renderer components
// ---------------------------------------------------------------------------

/**
 * Default identifier shown for `code` rows when no model name is
 * available from `SessionMetadataStore`. Matches the placeholder the
 * picker shows before a session has reported metadata.
 */
const CODE_DEFAULT_IDENTIFIER = "Code";

/** Default identifier shown for `user` rows. */
const USER_IDENTIFIER = "You";

/**
 * Stable-reference empty control-request log handed to committed
 * cells' `useSyncExternalStore` so React's Object.is comparison
 * skips re-renders on every snapshot tick. Allocated once at module
 * load; every committed cell shares the same reference. The
 * `ReadonlyArray` type discourages accidental mutation.
 */
const EMPTY_CONTROL_LOG: ReadonlyArray<ControlRequestRecord> = [];

interface UserRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  renderTurnTrailing?: TurnTrailingRenderer;
}

const UserRowCell: React.FC<UserRowCellProps> = ({
  index,
  dataSource,
  renderTurnTrailing,
}) => {
  const row = dataSource.rowAt(index);
  // Either committed turn (`turn.userMessage.text`) or in-flight user
  // message (`inflight.text`). The wrapper renders nothing when both
  // are missing — defensive against an out-of-range read that
  // shouldn't happen given the adapter's contract but is cheap to
  // guard.
  const rawText = row.turn?.userMessage.text ?? row.inflight?.text ?? "";
  const text = stripUserBodyPrefix(rawText);
  // User-row timestamp is the submit time, not the turn's end time —
  // the user's row "posts" the moment they hit submit, regardless of
  // whether the assistant has replied yet. For committed rows the
  // submit time is captured on `userMessage.submitAt`; for in-flight
  // rows it lives on `inflight.submitAt`.
  const submitAt = row.turn?.userMessage.submitAt ?? row.inflight?.submitAt;
  const timestamp = submitAt !== undefined
    ? formatTranscriptTimestamp(submitAt)
    : undefined;
  const hasBody = text.length > 0;
  const { ResponderScope, cellProps, bodyRef, menu } =
    useTranscriptCellMenu();
  // Z1 — invoke the per-turn trailing renderer for this row half.
  // `row.turnKey` is set by the data source on every row (committed
  // and in-flight); the user row carries no `turn` payload while
  // in-flight, so `turn` is undefined there.
  const trailing =
    renderTurnTrailing !== undefined && row.turnKey !== undefined
      ? renderTurnTrailing({
          turnKey: row.turnKey,
          half: "user",
          turn: row.turn,
        })
      : null;
  const hasTrailing = trailing !== null && trailing !== undefined;
  return (
    <ResponderScope>
      <div {...cellProps}>
        <TugTranscriptEntry
          participant="user"
          identifier={USER_IDENTIFIER}
          timestamp={timestamp === "" ? undefined : timestamp}
          sequenceNumber={index + 1}
          body={
            <span
              ref={(el) => { bodyRef.current = el; }}
              className="tide-card-transcript-user-body"
              data-testid="tide-card-transcript-user-body"
            >
              {text}
            </span>
          }
          controls={
            (() => {
              // Z1B — always-mounted status / end-state row driven
              // by `row.turn`. In-flight (turn === undefined) the
              // user-half renders nothing inside the slot but keeps
              // the slot div mounted ([L26]); the slot's
              // `min-height: 0` rule collapses the empty footer so
              // no phantom strip sits below the user's just-
              // submitted message. Terminal (turn defined) shows
              // `[badge] :: [COPY]` driven by the same
              // `endStateBadgeFor(turn.turnEndReason)` dispatch the
              // asst-half uses — so the two halves of one turn
              // always show the same outcome glyph + text + tone.
              //
              // Optional Z1 placement-experiment renderer trails
              // Z1B when the experiment maps an alt-datum onto the
              // user row.
              return (
                <>
                  <TideZ1B
                    participant="user"
                    turn={row.turn}
                    bodyText={hasBody ? text : undefined}
                  />
                  {hasTrailing ? trailing : null}
                </>
              );
            })()
          }
        />
      </div>
      {menu}
    </ResponderScope>
  );
};

// ---------------------------------------------------------------------------
// `CodeRowCell` — single renderer for the assistant row.
//
// Handles both the in-flight phase (data flowing from the live
// `streamingDocument` / `controlRequestLog` / `pendingApproval`) AND
// the committed phase (data on `row.turn`) inside one component
// instance. The cell wrapper React keys by `turnKey`, which is
// byte-identical inflight + committed, so the wrapper survives
// `turn_complete` without an unmount. Its in-place children stay
// subscribed to the SAME per-turn PropertyStore paths
// (`turn.${turnKey}.assistant` etc.), `scrollHeight` does not
// collapse, and the browser has nothing to clamp.
//
// All streaming children (`TideThinkingBlock`,
// `TranscriptToolCalls`, `TugMarkdownBlock`) render in
// streaming-mode regardless of phase, pointed at the turn's
// per-turn paths. After commit, those paths retain their final
// values forever (no new writes from any source), so the same
// `TugMarkdownBlock` instance that streamed the response continues
// to display the final text — no prop change, no remount. The DOM
// diff React performs across the transition is therefore minimal:
// only the conditional chrome (timestamp, copy button, interrupted
// badge for committed; live-dialog vs resolved-record source for
// the permission slot) changes.
// ---------------------------------------------------------------------------

interface CodeRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  /**
   * Per-card `SessionMetadataStore`. Each `CodeRowCell` subscribes
   * to it directly via `useSessionModelName` rather than receiving
   * `modelName` as a prop. The subscription is per-cell because
   * threading `modelName` through the renderer lambda would tie the
   * lambda's identity to the metadata snapshot — and a single
   * lambda-identity flip remounts every cell in the window (per
   * the [L26] note on this file's `cellRenderers` map), restarting
   * any in-flight `TugThinkingIndicator` animation in the assistant
   * row's Z1B chrome. See [Step 20.4.16] Sub-step A for the full
   * diagnosis.
   */
  sessionMetadataStore: SessionMetadataStore;
  codeSessionStore: CodeSessionStore;
  streamingStore: PropertyStore;
  renderTurnTrailing?: TurnTrailingRenderer;
}

const CodeRowCell: React.FC<CodeRowCellProps> = ({
  index,
  dataSource,
  sessionMetadataStore,
  codeSessionStore,
  streamingStore,
  renderTurnTrailing,
}) => {
  // Subscribe to the metadata store HERE in the cell — not at the
  // host — so the model-name read does not flow through the
  // `codeRenderer` lambda's dependency array. The renderer stays
  // identity-stable across metadata updates, which keeps every
  // cell mounted across the (one-time at session-init, occasional
  // mid-session) `modelName` resolution. [L02] / [L26].
  const modelName = useSessionModelName(sessionMetadataStore);
  const row = dataSource.rowAt(index);
  // `turnKey` is set for every code row by `rowAt`. The fallback
  // throws in dev (data-source contract violation) and falls back to
  // an index-scoped string in prod so different rows can't
  // cross-pollinate per-turn paths if the contract is silently
  // violated downstream.
  if (row.turnKey === undefined && process.env.NODE_ENV !== "production") {
    throw new Error(
      `CodeRowCell: row.turnKey missing at index=${index}. ` +
        `TideTranscriptDataSource.rowAt must set turnKey on every code row.`,
    );
  }
  const turnKey = row.turnKey ?? `missing-${index}`;
  const assistantPath = `turn.${turnKey}.assistant`;
  const thinkingPath = `turn.${turnKey}.thinking`;
  const toolsPath = `turn.${turnKey}.tools`;
  // Committed-ness is "a TurnEntry exists for this row" — derived
  // from data, not from a separate kind enum. Using `row.turn` keeps
  // the branching tied to the actual payload the cell needs, so
  // there's no opportunity for kind and payload to disagree.
  const turn = row.turn;
  const isCommitted = turn !== undefined;
  const assistantText = turn?.assistant ?? "";
  const timestamp =
    turn !== undefined ? formatTranscriptTimestamp(turn.endedAt) : undefined;

  // Permission slot — built from committed `turn.controlRequests` when
  // the cell is past `turn_complete`, otherwise from the live
  // `controlRequestLog` + `pendingApproval` pair the streaming row
  // observes. Both code paths emit the SAME `<Component key=request_id />`
  // shape, so React reconciles per-record in place across the
  // transition: each dialog instance survives the inflight → committed
  // boundary even as the source of truth swaps.
  //
  // The two `useSyncExternalStore` subscriptions below GATE on
  // `isCommitted`: once a cell is committed, its `permissionSlot`
  // depends on `turn.controlRequests` only, so re-rendering on every
  // pending/log change in a *later* turn would be wasted work. The
  // getSnapshot closures return stable values (`null` /
  // `EMPTY_CONTROL_LOG`) for committed cells, so `useSyncExternalStore`'s
  // Object.is comparison skips the re-render entirely after commit.
  const pendingApproval = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () =>
        isCommitted
          ? null
          : codeSessionStore.getSnapshot().pendingApproval,
      [codeSessionStore, isCommitted],
    ),
  );
  const controlRequestLog = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () =>
        isCommitted
          ? EMPTY_CONTROL_LOG
          : codeSessionStore.getSnapshot().controlRequestLog,
      [codeSessionStore, isCommitted],
    ),
  );
  const permissionSlot = useMemo<React.ReactNode>(() => {
    type SlotEntry = {
      request: ControlRequestForward;
      resolvedDecision?: "allow" | "deny";
    };
    let entries: SlotEntry[];
    if (isCommitted) {
      const records = turn?.controlRequests ?? [];
      entries = records.map((record) => ({
        request: record.request,
        resolvedDecision: record.decision,
      }));
    } else {
      entries = controlRequestLog.map((record) => ({
        request: record.request,
        resolvedDecision: record.decision ?? undefined,
      }));
      if (pendingApproval !== null && !pendingApproval.is_question) {
        const dup = entries.some(
          (e) => e.request.request_id === pendingApproval.request_id,
        );
        if (!dup) entries.push({ request: pendingApproval });
      }
    }
    if (entries.length === 0) return null;
    return entries.map((entry, idx) => {
      const { Component, props } = dispatchRenderInput(
        {
          kind: "permission",
          request: entry.request,
          resolvedDecision: entry.resolvedDecision,
        },
        { store: streamingStore, session: codeSessionStore },
      );
      return (
        <Component
          key={entry.request.request_id || `permission-${idx}`}
          {...props}
        />
      );
    });
  }, [
    isCommitted,
    turn,
    controlRequestLog,
    pendingApproval,
    codeSessionStore,
    streamingStore,
  ]);

  // In-flight `msg_id` threaded onto streaming tool wrappers. For
  // committed rows we already have the canonical `turn.msgId`.
  const inflightMsgId = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().activeMsgId ?? "",
      [codeSessionStore],
    ),
  );
  const toolMsgId = isCommitted ? (turn?.msgId ?? "") : inflightMsgId;

  const { ResponderScope, cellProps, bodyRef, menu } =
    useTranscriptCellMenu();
  return (
    <ResponderScope>
      <div {...cellProps}>
        <TugTranscriptEntry
          participant="code"
          identifier={modelName ?? CODE_DEFAULT_IDENTIFIER}
          timestamp={
            timestamp === "" || timestamp === undefined ? undefined : timestamp
          }
          sequenceNumber={index + 1}
          body={
            <div ref={(el) => { bodyRef.current = el; }}>
              <TideThinkingBlock
                streamingStore={streamingStore}
                streamingPath={thinkingPath}
              />
              {permissionSlot}
              <TranscriptToolCalls
                streamingStore={streamingStore}
                streamingPath={toolsPath}
                msgId={toolMsgId}
              />
              <TugMarkdownBlock
                streamingStore={streamingStore}
                streamingPath={assistantPath}
                className="tide-card-transcript-code-body"
              />
            </div>
          }
          controls={
            (() => {
              // Z1B — always-mounted status / end-state row driven by
              // the live session `phase`. The slot div is rendered
              // unconditionally so the indicator → end-state swap
              // preserves DOM identity ([L26]); only the child node
              // inside swaps. The terminal end-state surfaces the
              // tone-coded badge for all four `TurnEndReason` values,
              // so the pre-promotion body-internal "Interrupted"
              // badge is no longer needed (Z1B's `interrupted` badge
              // covers that case).
              //
              // Optional Z1 placement-experiment renderer trails Z1B
              // when the experiment maps an alt-datum (per-turn cost,
              // ttft, etc.) onto the assistant row. Default
              // production wiring leaves `renderTurnTrailing`
              // undefined and Z1B is the sole footer.
              const trailing =
                renderTurnTrailing !== undefined && row.turnKey !== undefined
                  ? renderTurnTrailing({
                      turnKey: row.turnKey,
                      half: "assistant",
                      turn: row.turn,
                    })
                  : null;
              const hasTrailing = trailing !== null && trailing !== undefined;
              return (
                <>
                  <TideZ1B
                    participant="code"
                    turn={turn}
                    bodyText={isCommitted ? assistantText : undefined}
                  />
                  {hasTrailing ? trailing : null}
                </>
              );
            })()
          }
        />
      </div>
      {menu}
    </ResponderScope>
  );
};


// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/**
 * Estimated heights per kind, in CSS pixels. Used by the height index
 * before any cell has been measured by `ResizeObserver`. The estimates
 * are intentionally rough — the height index swaps in measured values
 * as soon as a cell mounts and the observer fires.
 */
const ESTIMATED_HEIGHT_USER = 56;
const ESTIMATED_HEIGHT_CODE = 120;

export interface TideTranscriptHostProps {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Per-card response-settings store. The host binds it to the
   * `.tide-card-transcript` root via `useLayoutEffect` so the store's
   * CSS custom properties cascade onto every entry header and content
   * body without round-tripping through React state ([L06] / [L22]).
   */
  responseStore: ResponseSettingsStore;
  /**
   * Z1 — per-turn trailing slot renderer. Invoked once per row half:
   *   - on the user row at the trailing edge (next to the copy button)
   *   - on the assistant row at the trailing edge (next to the copy button)
   * The renderer is placement-agnostic; the host wires the same
   * callback twice per turn, keyed by `half`. Returning `null` from
   * either invocation leaves the corresponding row's trailing edge
   * unchanged.
   */
  renderTurnTrailing?: TurnTrailingRenderer;
}

/**
 * Signature of the Z1 per-turn trailing slot renderer. The same
 * callback is invoked once per row half per turn; consumers branch
 * on `half` to vary content between user / assistant rows.
 */
export type TurnTrailingRenderer = (
  context: TurnTrailingContext,
) => React.ReactNode;

/**
 * Context handed to the Z1 per-turn trailing slot renderer. `turn` is
 * `undefined` for in-flight rows and for the live user row submitted
 * but not yet committed; consumers that need committed-only data
 * branch on `turn !== undefined`.
 */
export interface TurnTrailingContext {
  /** Stable per-turn key — matches `row.turnKey` in the data source. */
  turnKey: string;
  /** Which half of the turn is asking for trailing content. */
  half: "user" | "assistant";
  /** Committed turn entry, when present. */
  turn?: import("@/lib/code-session-store").TurnEntry;
}

/**
 * Imperative handle exposed via `forwardRef`. The tide-card holds this
 * to drive a deliberate "jump to latest" on submit — the transcript is
 * a split-pane *sibling* of the prompt entry, so a bubbling DOM event
 * can't reach the inner list view; the parent threads the gesture
 * through this handle instead.
 */
export interface TideTranscriptHandle {
  /**
   * Scroll the transcript to the bottom of content and re-engage
   * follow-bottom. Thin pass-through to the inner `TugListView`'s
   * `scrollToBottom`.
   */
  scrollToBottom(options?: { animated?: boolean }): void;
}

export const TideTranscriptHost = forwardRef<
  TideTranscriptHandle,
  TideTranscriptHostProps
>(function TideTranscriptHost(
  {
    codeSessionStore,
    sessionMetadataStore,
    responseStore,
    renderTurnTrailing,
  },
  ref,
) {
  const dataSource = useTideTranscriptDataSource(codeSessionStore);
  const streamingStore = codeSessionStore.streamingDocument;

  // One renderer per kind ([L26] — renderer reference is the third
  // identity input React reconciles against; distinct lambdas count
  // as distinct component types). With the data source unified to a
  // single `"code"` kind for assistant rows (no separate
  // `"code-streaming"` / `"code-committed"`), this map structurally
  // cannot hold two entries for the same row — eliminating the
  // lambda-identity trap that would otherwise re-mount the cell
  // wrapper at `turn_complete` and trigger a user-visible scroll
  // jump. The `useCallback` is what keeps the reference stable
  // across re-renders of this component; rebuilding it inline in the
  // `cellRenderers` literal would defeat L26 just as surely as a
  // second lambda for a second kind would. The `CodeRowCell`
  // component branches internally on `row.turn !== undefined` for
  // the chrome differences that genuinely vary by phase (timestamp,
  // copy button, interrupted badge, permission-record vs
  // live-dialog source).
  //
  // **Deps discipline ([Step 20.4.16] Sub-step A).** The four store
  // refs (`codeSessionStore`, `sessionMetadataStore`, `streamingStore`,
  // `renderTurnTrailing`) are all stable for the card's lifetime:
  //   - `codeSessionStore` / `sessionMetadataStore` come from
  //     `useTideCardServices`, scoped to the card mount.
  //   - `streamingStore` is `codeSessionStore.streamingDocument`,
  //     `readonly` and assigned once in the store's constructor.
  //   - `renderTurnTrailing` is memoized by the placement-experiment
  //     hook and only churns on `mapping.Z1` changes — a deliberate
  //     user-driven event, not a streaming-time churn.
  // The renderer therefore never re-creates in steady state. Adding a
  // dep that DOES churn (the pre-20.4.16 `modelName` was exactly such
  // a dep — flipped from `null` to the resolved value on `system_init`)
  // would remount every cell in the window on each churn, restarting
  // any in-flight `TugThinkingIndicator` animation. Per-cell metadata
  // reads happen INSIDE `CodeRowCell` via `useSessionModelName` so the
  // renderer lambda stays inert.
  const codeRenderer = useCallback<
    TugListViewCellRenderer<TideTranscriptDataSource>
  >(
    (p) => (
      <CodeRowCell
        {...p}
        sessionMetadataStore={sessionMetadataStore}
        codeSessionStore={codeSessionStore}
        streamingStore={streamingStore}
        renderTurnTrailing={renderTurnTrailing}
      />
    ),
    [sessionMetadataStore, codeSessionStore, streamingStore, renderTurnTrailing],
  );
  const userRenderer = useCallback<
    TugListViewCellRenderer<TideTranscriptDataSource>
  >(
    (p) => <UserRowCell {...p} renderTurnTrailing={renderTurnTrailing} />,
    [renderTurnTrailing],
  );
  const cellRenderers = useMemo<
    Record<string, TugListViewCellRenderer<TideTranscriptDataSource>>
  >(
    () => ({
      "user": userRenderer,
      "code": codeRenderer,
    }),
    [userRenderer, codeRenderer],
  );

  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      estimatedHeightForKind: (kind: string) =>
        kind === "user" ? ESTIMATED_HEIGHT_USER : ESTIMATED_HEIGHT_CODE,
    }),
    [],
  );

  // Bind the transcript root for response-settings CSS variable
  // cascade. The store sets inline custom properties (header /
  // content typography + entry margin); descendant rules in
  // `tide-card.css` consume them on entry headers, markdown content,
  // and the inner list view's row gap.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    responseStore.bind(el);
    return () => responseStore.unbind();
  }, [responseStore]);

  // Inner `TugListView` handle — the parent reaches `scrollToBottom`
  // through the `TideTranscriptHandle` exposed below.
  const listViewRef = useRef<TugListViewHandle | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom(options?: { animated?: boolean }): void {
        listViewRef.current?.scrollToBottom(options);
      },
    }),
    [],
  );

  return (
    <div
      ref={rootRef}
      className="tide-card-transcript"
      data-slot="tide-card-transcript"
      data-testid="tide-card-transcript"
    >
      <TugListView
        ref={listViewRef}
        dataSource={dataSource}
        delegate={delegate}
        cellRenderers={cellRenderers}
        scrollKey="tide-card-transcript"
        followBottom
        inline
      />
    </div>
  );
});
