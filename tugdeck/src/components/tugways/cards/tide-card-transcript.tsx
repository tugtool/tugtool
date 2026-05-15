/**
 * tide-card-transcript.tsx — multi-turn transcript host for the Tide
 * card top pane.
 *
 * Mounts a `TugListView` against a `TideTranscriptDataSource` and
 * registers three cell renderers:
 *
 *   - `user` — `TugTranscriptEntry participant="user"` whose body is a
 *     plain `<span>` carrying `userMessage.text`. Per [D11], v1 user
 *     bodies are plain text; atom-aware rendering lands once the
 *     prompt-entry's atom flow reaches transcript form.
 *   - `code-committed` — `TugTranscriptEntry participant="code"` whose
 *     body is `<TugMarkdownBlock initialText={turn.assistant} />`. The
 *     block paints synchronously on mount per the [#md-block-api]
 *     mount-render contract — there is no empty intermediate render
 *     between the streaming cell unmount and the committed cell mount.
 *   - `code-streaming` — `TugTranscriptEntry participant="code"` whose
 *     body is `<TugMarkdownBlock streamingStore=... streamingPath=...
 *     />`. The block observes the streaming document directly per
 *     [D06] / [L22]; deltas do NOT round-trip through the data source.
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
import { Check, Copy, OctagonX } from "lucide-react";

import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { TugBadge } from "@/components/tugways/tug-badge";
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
import { dispatch as dispatchRenderInput } from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugTranscriptEntry } from "@/components/tugways/tug-transcript-entry";
import type { ActionHandlerResult } from "@/components/tugways/responder-chain";
import { useResponder } from "@/components/tugways/use-responder";
import { useTextSurfaceContextMenu } from "@/components/tugways/use-text-surface-context-menu";
import type { CodeSessionStore } from "@/lib/code-session-store";
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

interface UserRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {}

const UserRowCell: React.FC<UserRowCellProps> = ({ index, dataSource }) => {
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
  const handleCopyButton = useCallback(() => {
    if (text.length === 0) return;
    void navigator.clipboard?.writeText(text);
  }, [text]);
  const hasBody = text.length > 0;
  const { ResponderScope, cellProps, bodyRef, menu } =
    useTranscriptCellMenu();
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
            hasBody ? (
              <TugPushButton
                subtype="icon"
                emphasis="ghost"
                role="action"
                size="sm"
                icon={<Copy size={12} />}
                confirmation={{
                  icon: <Check size={12} />,
                  ariaLabel: "Copied",
                }}
                aria-label="Copy"
                onClick={handleCopyButton}
              />
            ) : null
          }
        />
      </div>
      {menu}
    </ResponderScope>
  );
};

interface CodeCommittedRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  modelName: string | null;
  codeSessionStore: CodeSessionStore;
}

const CodeCommittedRowCell: React.FC<CodeCommittedRowCellProps> = ({
  index,
  dataSource,
  modelName,
  codeSessionStore,
}) => {
  const row = dataSource.rowAt(index);
  const turn = row.turn;
  // Same defensive guard as `UserRowCell` — out-of-range row reads
  // should never happen, but if one slips through (e.g. a stale
  // re-render against a shrunk transcript) we render an empty body
  // rather than crash on `undefined.assistant`.
  const assistantText = turn?.assistant ?? "";
  const thinkingText = turn?.thinking ?? "";
  const isInterrupted = turn?.result === "interrupted";
  const timestamp = turn !== undefined
    ? formatTranscriptTimestamp(turn.endedAt)
    : undefined;
  const handleCopyButton = useCallback(() => {
    if (assistantText.length === 0) return;
    void navigator.clipboard?.writeText(assistantText);
  }, [assistantText]);
  // No copy affordance when there's nothing to copy — e.g. CASE A
  // interrupts where the turn ended before any assistant content
  // landed leave the body as just the "Interrupted" badge.
  const hasBody = assistantText.length > 0;

  // Permission prompts the user answered during this turn — the
  // permanent transcript artifact per [D13]. Each resolved record is
  // routed through the assistant renderer dispatch ([D01]) carrying
  // its `resolvedDecision`, so the dialog mounts straight into its
  // collapsed static record. Renders ABOVE the tool calls so a
  // committed turn reads in chronological order: approval → tool
  // ran → output → assistant summary. The live streaming row mirrors
  // this placement so the slot is consistent before and after commit.
  const controlRequests = turn?.controlRequests ?? [];
  const permissionRecords =
    controlRequests.length > 0
      ? controlRequests.map((record, recordIndex) => {
          const { Component, props } = dispatchRenderInput(
            {
              kind: "permission",
              request: record.request,
              resolvedDecision: record.decision,
            },
            {
              store: codeSessionStore.streamingDocument,
              session: codeSessionStore,
            },
          );
          return (
            <Component key={record.request.request_id || recordIndex} {...props} />
          );
        })
      : null;

  const { ResponderScope, cellProps, bodyRef, menu } =
    useTranscriptCellMenu();
  return (
    <ResponderScope>
      <div {...cellProps}>
        <TugTranscriptEntry
          participant="code"
          identifier={modelName ?? CODE_DEFAULT_IDENTIFIER}
          timestamp={timestamp === "" ? undefined : timestamp}
          sequenceNumber={index + 1}
          body={
            // The committed body is the assistant markdown followed (when
            // the turn was interrupted) by a trailing "Interrupted" badge.
            // Mirrors the trailing-indicator placement in Claude Code's
            // terminal output — the indicator sits AFTER any partial
            // content the assistant produced before being cut off, and is
            // the only visible body for a CASE A interrupt where no
            // content ever landed (assistantText === "").
            //
            // The thinking strip (when present) renders above the
            // assistant markdown per Table T03 ("inline at top of code
            // row") with default-collapsed-on-complete chrome per [D14].
            //
            // Tool calls render between thinking and assistant per
            // [#step-6-5] (the natural conversation order: tool runs,
            // then the assistant summarizes). `<TranscriptToolCalls>`
            // self-hides for tool-free turns.
            <div ref={(el) => { bodyRef.current = el; }}>
              {thinkingText !== "" ? (
                <TideThinkingBlock initialText={thinkingText} />
              ) : null}
              {permissionRecords}
              {turn !== undefined && turn.toolCalls.length > 0 ? (
                <TranscriptToolCalls
                  toolCalls={turn.toolCalls}
                  msgId={turn.msgId}
                />
              ) : null}
              <TugMarkdownBlock
                initialText={assistantText}
                className="tide-card-transcript-code-body"
              />
              {isInterrupted ? (
                <div
                  className="tide-card-transcript-code-interrupted"
                  data-slot="tide-card-transcript-interrupted"
                >
                  <TugBadge
                    size="sm"
                    emphasis="tinted"
                    role="danger"
                    icon={<OctagonX size={12} aria-hidden="true" />}
                  >
                    Interrupted
                  </TugBadge>
                </div>
              ) : null}
            </div>
          }
          controls={
            hasBody ? (
              <TugPushButton
                subtype="icon"
                emphasis="ghost"
                role="action"
                size="sm"
                icon={<Copy size={12} />}
                confirmation={{
                  icon: <Check size={12} />,
                  ariaLabel: "Copied",
                }}
                aria-label="Copy"
                onClick={handleCopyButton}
              />
            ) : null
          }
        />
      </div>
      {menu}
    </ResponderScope>
  );
};

interface CodeStreamingRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  modelName: string | null;
  codeSessionStore: CodeSessionStore;
  streamingStore: PropertyStore;
  streamingPath: string;
  thinkingStreamingPath: string;
  toolsStreamingPath: string;
  /**
   * In-flight `msg_id` for the streaming turn. Threaded onto each
   * tool wrapper's props via `<TranscriptToolCalls>`. Empty string
   * is acceptable while `activeMsgId` is null (cold start of a turn
   * before the first event arrives) — wrapper visual output doesn't
   * depend on `msgId` identity.
   */
  inflightMsgId: string;
}

const CodeStreamingRowCell: React.FC<CodeStreamingRowCellProps> = ({
  index,
  modelName,
  codeSessionStore,
  streamingStore,
  streamingPath,
  thinkingStreamingPath,
  toolsStreamingPath,
  inflightMsgId,
}) => {
  const { ResponderScope, cellProps, bodyRef, menu } =
    useTranscriptCellMenu();

  // A `control_request_forward` (is_question:false) lands on the
  // snapshot's `pendingApproval` and parks the turn in
  // `awaiting_approval` — the streaming row stays mounted, so this is
  // where the inline PermissionDialog renders ([D13]). Subscribed via
  // `useSyncExternalStore` ([L02]); routed through the assistant
  // renderer dispatch ([D01]) so the chrome kind goes through the same
  // seam as every other rendered event. QuestionDialog
  // (`is_question:true`) is #step-19 — not yet wired, so a question
  // forward renders nothing here for now.
  const pendingApproval = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().pendingApproval,
      [codeSessionStore],
    ),
  );
  let permissionDialog: React.ReactNode = null;
  if (pendingApproval !== null && !pendingApproval.is_question) {
    const { Component, props } = dispatchRenderInput(
      { kind: "permission", request: pendingApproval },
      { store: streamingStore, session: codeSessionStore },
    );
    permissionDialog = <Component {...props} />;
  }

  return (
    <ResponderScope>
      <div {...cellProps}>
        <TugTranscriptEntry
          participant="code"
          identifier={modelName ?? CODE_DEFAULT_IDENTIFIER}
          sequenceNumber={index + 1}
          body={
            // Thinking strip subscribes to `streamingPaths.thinking`
            // and self-hides until non-empty content arrives — a turn
            // that produces no thinking shows no chrome. On
            // `turn_complete`, this streaming row unmounts and the
            // committed row above mounts a fresh `TideThinkingBlock`
            // in static mode (default-collapsed per [D14]).
            //
            // Tool calls render between thinking and assistant per
            // [#step-6-5]. `<TranscriptToolCalls>` subscribes to
            // `inflight.tools` directly via `useSyncExternalStore`
            // ([L02]); each emission re-routes through the dispatch.
            // The same wrapper instance reconciles in place across a
            // `pending → done` transition (keyed by `toolUseId`).
            <div ref={(el) => { bodyRef.current = el; }}>
              <TideThinkingBlock
                streamingStore={streamingStore}
                streamingPath={thinkingStreamingPath}
              />
              {permissionDialog}
              <TranscriptToolCalls
                streamingStore={streamingStore}
                streamingPath={toolsStreamingPath}
                msgId={inflightMsgId}
              />
              <TugMarkdownBlock
                streamingStore={streamingStore}
                streamingPath={streamingPath}
                className="tide-card-transcript-code-body"
              />
            </div>
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
  { codeSessionStore, sessionMetadataStore, responseStore },
  ref,
) {
  const dataSource = useTideTranscriptDataSource(codeSessionStore);
  const modelName = useSessionModelName(sessionMetadataStore);
  const streamingStore = codeSessionStore.streamingDocument;
  // The streaming-path tokens are literals on the snapshot's
  // `streamingPaths.{assistant,thinking,tools}`; read once per store
  // binding so the values participate in the `cellRenderers` memo
  // without churning identity on every snapshot tick.
  const streamingPath = useMemo(
    () => codeSessionStore.getSnapshot().streamingPaths.assistant,
    [codeSessionStore],
  );
  const thinkingStreamingPath = useMemo(
    () => codeSessionStore.getSnapshot().streamingPaths.thinking,
    [codeSessionStore],
  );
  const toolsStreamingPath = useMemo(
    () => codeSessionStore.getSnapshot().streamingPaths.tools,
    [codeSessionStore],
  );

  // In-flight `msg_id` for the streaming row's tool-call props
  // ([#step-6-5]). `activeMsgId` is null until the first event of a
  // turn lands; the streaming card is allowed to render with an
  // empty msgId in that window — wrapper visual output doesn't
  // depend on identity. Subscribed via `useSyncExternalStore` ([L02])
  // so the streaming row picks up the id the moment the reducer
  // populates it.
  const inflightMsgId = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().activeMsgId ?? "",
      [codeSessionStore],
    ),
  );

  const cellRenderers = useMemo<
    Record<string, TugListViewCellRenderer<TideTranscriptDataSource>>
  >(
    () => ({
      "user": (p) => <UserRowCell {...p} />,
      "code-committed": (p) => (
        <CodeCommittedRowCell
          {...p}
          modelName={modelName}
          codeSessionStore={codeSessionStore}
        />
      ),
      "code-streaming": (p) => (
        <CodeStreamingRowCell
          {...p}
          modelName={modelName}
          codeSessionStore={codeSessionStore}
          streamingStore={streamingStore}
          streamingPath={streamingPath}
          thinkingStreamingPath={thinkingStreamingPath}
          toolsStreamingPath={toolsStreamingPath}
          inflightMsgId={inflightMsgId}
        />
      ),
    }),
    [
      modelName,
      codeSessionStore,
      streamingStore,
      streamingPath,
      thinkingStreamingPath,
      toolsStreamingPath,
      inflightMsgId,
    ],
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
        // Tail spacer: 80% of the SCROLLPORT's height, not the
        // window's. The tide-card's transcript pane is a split-pane
        // child, so `vh`/`svh` units (window-relative) overshoot —
        // they'd extend the spacer well beyond the actual transcript
        // pane and let the user scroll all content off the top. The
        // `cqh` (container query height) unit resolves against the
        // nearest `container-type: size` ancestor, which is the
        // `.tug-list-view` scrollport itself (set in
        // `tug-list-view.css`). 80cqh therefore means "80% of the
        // transcript pane's clientHeight" — exactly the user's
        // intent. SmartScroll's `trailingInertOffset` reads the
        // spacer's live `offsetHeight` so follow-bottom and
        // isAtBottom calculations exclude this region.
        tailSpacer="80cqh"
      />
    </div>
  );
});
