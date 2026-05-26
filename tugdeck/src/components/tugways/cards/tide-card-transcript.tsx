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
 *  - [L02] `CodeRowCell` reads `pendingApproval` / `pendingQuestion`
 *    via `useSyncExternalStore`; the host reads its lifecycle `state`
 *    via `useLifecycleState`.
 *  - [L06] the [DT10] transcript-replay paint gate suppresses the
 *    host's visible render across the JSONL replay window via a
 *    `data-replaying` attribute + a `visibility: hidden` CSS rule —
 *    the subtree is never unmounted, only painted dark.
 *  - [L22] `TugMarkdownBlock` observes the `PropertyStore` directly
 *    and writes the DOM imperatively per delta.
 *  - [L23] preserves scroll position across what was previously a
 *    teardown event (the in-flight → committed transition).
 *  - [L26] stable React-reconciliation identity (key + component
 *    type + renderer reference) across that same transition is the
 *    upstream invariant L23 rides on here; the [DT10] gate likewise
 *    keeps the host's DOM container mounted across the replay window.
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
import { X } from "lucide-react";
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
import { TideZ1B } from "@/components/tugways/cards/tide-card-z1b";
import { TideZ1C } from "@/components/tugways/cards/tide-card-z1c";
import {
  dispatch as dispatchRenderInput,
  dispatchToolCallState,
} from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import { turnEntryToMarkdown } from "@/components/tugways/cards/turn-entry-markdown";
import { TideJumpToBottomButton } from "@/components/tugways/cards/tide-jump-to-bottom-button";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugTranscriptEntry } from "@/components/tugways/tug-transcript-entry";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import type { ActionHandlerResult } from "@/components/tugways/responder-chain";
import { useResponder } from "@/components/tugways/use-responder";
import { useTextSurfaceContextMenu } from "@/components/tugways/use-text-surface-context-menu";
import type { CodeSessionStore } from "@/lib/code-session-store";
import { useLifecycleState } from "@/lib/code-session-store/hooks/use-lifecycle-state";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { ResponseSettingsStore } from "@/lib/response-settings-store";
import {
  TideTranscriptDataSource,
  readUserMessage,
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

interface UserRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  renderTurnTrailing?: TurnTrailingRenderer;
}

const UserRowCell: React.FC<UserRowCellProps> = ({
  index,
  dataSource,
  renderTurnTrailing,
}) => {
  const row = dataSource.rowAt(index);
  // Read the user submission from the `user_message` Message at the
  // head of `turn.messages` (committed) or `activeTurn.messages`
  // (in-flight). The data source only emits a `user` row when one is
  // present, so this is always defined for cells that actually paint;
  // the defensive `?? ""` covers an out-of-range read.
  const committedUser = row.turn !== undefined ? readUserMessage(row.turn.messages) : undefined;
  const activeUser = row.activeTurn !== undefined ? readUserMessage(row.activeTurn.messages) : undefined;
  const rawText = committedUser?.text ?? activeUser?.text ?? "";
  const text = stripUserBodyPrefix(rawText);
  // User-row timestamp is the submit time, not the turn's end time —
  // the user's row "posts" the moment they hit submit, regardless of
  // whether the assistant has replied yet. Both committed and active
  // surfaces carry `submitAt` on the user_message Message itself.
  const submitAt = committedUser?.submitAt ?? activeUser?.submitAt;
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
              // Z1B — always-mounted status / end-state row. The
              // user half shows its end-state immediately: a static
              // "OK" badge plus COPY, in-flight and committed alike,
              // because the user's submission is complete the
              // instant it posts. The badge never reflects
              // `turn.turnEndReason` — an interrupt / error belongs
              // to the *response*, not the act of submitting.
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
// `GhostRowCell` — a queued send awaiting dispatch.
//
// One ghost row per `queuedSends` entry, painted de-emphasized at the
// transcript foot so a mid-turn submit reads as "queued, not yet
// sent." It carries a ✕ that un-sends that one queued message — a
// targeted cancel, distinct from the Stop / Esc pop-interactive gesture.
// When the queued send flushes, the reducer promotes it to the
// in-flight pair and this ghost row unmounts — see
// {@link TideTranscriptCellKind} for the key/kind transition.
// ---------------------------------------------------------------------------

interface GhostRowCellProps
  extends TugListViewCellProps<TideTranscriptDataSource> {
  codeSessionStore: CodeSessionStore;
}

const GhostRowCell: React.FC<GhostRowCellProps> = ({
  index,
  dataSource,
  codeSessionStore,
}) => {
  const row = dataSource.rowAt(index);
  const queued = row.queued;
  // The adapter only emits a `ghost` kind alongside a `queued`
  // payload; this guard is defensive against an out-of-range read.
  if (queued === undefined) return null;
  const text = stripUserBodyPrefix(queued.text);
  const turnKey = queued.turnKey;
  return (
    <div
      className="tide-card-transcript-ghost-row"
      data-slot="tide-transcript-ghost-row"
    >
      <TugTranscriptEntry
        participant="user"
        identifier={USER_IDENTIFIER}
        body={
          <span className="tide-card-transcript-user-body">{text}</span>
        }
        controls={
          // `TugIconButton` is focus-refusing — un-sending a queued
          // message must not steal focus from an editor the user may
          // be composing in. `cancelQueuedSend` removes this one entry
          // and routes its text back through `pendingDraftRestore`.
          <TugIconButton
            icon={<X size={14} strokeWidth={2.5} />}
            aria-label="Cancel queued message"
            tone="danger"
            size="sm"
            onClick={() => codeSessionStore.cancelQueuedSend(turnKey)}
          />
        }
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// `CodeRowCell` — single renderer for the assistant row.
//
// Handles both the in-flight phase (data flowing from the live
// `streamingDocument` / `pendingApproval` / `pendingQuestion`) AND
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

// ---------------------------------------------------------------------------
// `CodeRowBody` — iterate the turn's Message sequence ([D07]).
//
// Renders each Message kind to its inline surface in arrival order.
// Lives outside `CodeRowCell` so the component reference is stable
// across re-renders ([L26]) and the iteration logic stays close to
// the dispatch.
// ---------------------------------------------------------------------------

interface CodeRowBodyProps {
  messages: ReadonlyArray<import("@/lib/code-session-store").Message>;
  turnKey: string;
  streamingStore: PropertyStore;
  session: CodeSessionStore;
}

const CodeRowBody: React.FC<CodeRowBodyProps> = ({
  messages,
  turnKey,
  streamingStore,
  session,
}) => {
  // Partition tool_use Messages into top-level vs nested per
  // `parentToolUseId` ([#step-17-5]). Subagent children render
  // inside their parent's `AgentTranscriptBlock` and must NOT also
  // appear as transcript siblings. The map threads through every
  // top-level tool dispatch so the parent can resolve its own
  // children via the same dispatch.
  const childrenByParent = useMemo(() => {
    const map = new Map<string, import("@/lib/code-session-store").ToolUseMessage[]>();
    for (const m of messages) {
      if (m.kind !== "tool_use") continue;
      const parentId = m.parentToolUseId;
      if (parentId === undefined) continue;
      const siblings = map.get(parentId);
      if (siblings === undefined) map.set(parentId, [m]);
      else siblings.push(m);
    }
    return map;
  }, [messages]);

  const elements: React.ReactNode[] = [];
  for (const message of messages) {
    if (message.kind === "user_message") {
      // Rendered separately by the user row — skip in the code body.
      continue;
    }
    if (message.kind === "system_note") {
      // Step 8 will land the renderer. Today: no instances exist; if
      // one shows up early via a future tugcode emit, skip silently
      // rather than crashing.
      continue;
    }
    if (message.kind === "assistant_thinking") {
      const path = `turn.${turnKey}.message.${message.messageKey}.text`;
      elements.push(
        <TideThinkingBlock
          key={message.messageKey}
          streamingStore={streamingStore}
          streamingPath={path}
        />,
      );
      continue;
    }
    if (message.kind === "assistant_text") {
      const path = `turn.${turnKey}.message.${message.messageKey}.text`;
      elements.push(
        <TugMarkdownBlock
          key={message.messageKey}
          streamingStore={streamingStore}
          streamingPath={path}
          className="tide-card-transcript-code-body"
        />,
      );
      continue;
    }
    // tool_use — render top-level calls only; subagent children are
    // resolved inside their parent's wrapper.
    if (message.parentToolUseId !== undefined) continue;
    const { Component, props } = dispatchToolCallState(
      message,
      0,
      childrenByParent,
      session,
    );
    elements.push(<Component key={message.messageKey} {...props} />);
  }

  return <>{elements}</>;
};

interface CodeRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  /**
   * Per-card `SessionMetadataStore`. Each `CodeRowCell` subscribes
   * to it directly via `useSessionModelName` rather than receiving
   * `modelName` as a prop. The subscription is per-cell because
   * threading `modelName` through the renderer lambda would tie the
   * lambda's identity to the metadata snapshot — and a single
   * lambda-identity flip remounts every cell in the window (per
   * the [L26] note on this file's `cellRenderers` map), restarting
   * any in-flight `TugProgressIndicator` wave animation in the assistant
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
  // Committed-ness is "a TurnEntry exists for this row" — derived
  // from data, not from a separate kind enum. Using `row.turn` keeps
  // the branching tied to the actual payload the cell needs, so
  // there's no opportunity for kind and payload to disagree.
  const turn = row.turn;
  const isCommitted = turn !== undefined;
  // [D07] sequence substrate — the body iterates this Message
  // sequence and dispatches each kind to its inline renderer.
  // Committed turns read `turn.messages`; in-flight reads
  // `row.activeTurn.messages` (the snapshot's `activeTurn` projection).
  const messages = turn?.messages ?? row.activeTurn?.messages ?? [];
  // Full-turn markdown for the Z1B COPY affordance — every tool
  // call's input/output followed by the assistant prose. Serialized
  // once per committed turn (the turn is frozen post-commit, so the
  // memo runs a single time). `undefined` for the in-flight row,
  // which keeps COPY suppressed until the turn commits.
  const copyMarkdown = useMemo(
    () => (turn !== undefined ? turnEntryToMarkdown(turn) : undefined),
    [turn],
  );
  const timestamp =
    turn !== undefined ? formatTranscriptTimestamp(turn.endedAt) : undefined;

  // Permission + question slots — both are *pending-only* live input
  // forms rendered at the body foot. Permissions leave no committed
  // record (Step 3.5 removed the recorded chrome — see
  // `#step-3-5` in `roadmap/archive/tide-interactive-dialogs.md` — because
  // JSONL has no durable artifact to reconstruct one from); questions
  // round-trip through tool_use/tool_result so their recorded state
  // lives in the `AskUserQuestionToolBlock` at the tool_use position,
  // not here. Both subscriptions GATE on `isCommitted`: a committed
  // cell never hosts a live dialog of either kind, so the closure
  // returns stable `null` and `useSyncExternalStore`'s Object.is
  // comparison skips the re-render entirely after commit.
  const pendingApproval = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () =>
        isCommitted ? null : codeSessionStore.getSnapshot().pendingApproval,
      [codeSessionStore, isCommitted],
    ),
  );
  const pendingQuestion = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () =>
        isCommitted ? null : codeSessionStore.getSnapshot().pendingQuestion,
      [codeSessionStore, isCommitted],
    ),
  );

  // Build the dialog elements *every render* (no `useMemo` over the
  // React element). Caching React elements inside `useMemo` freezes
  // the `Component` reference returned by `dispatchRenderInput` — so
  // when Vite's Fast Refresh swaps `PermissionDialog` /
  // `QuestionDialog` for a new function, the cached element's `type`
  // would still point at the *old* component and the chrome would
  // stop surviving HMR. The inline build pattern mirrors what
  // `TranscriptToolCalls` does for tool blocks.
  //
  // The SDK only opens one `control_request_forward` at a time, so at
  // most one of the two slots is ever non-null on the same render.
  let permissionSlot: React.ReactNode = null;
  if (
    !isCommitted &&
    pendingApproval !== null &&
    !pendingApproval.is_question
  ) {
    const { Component, props } = dispatchRenderInput(
      { kind: "permission", request: pendingApproval },
      { store: streamingStore, session: codeSessionStore },
    );
    permissionSlot = (
      <Component
        key={pendingApproval.request_id || "permission"}
        {...props}
      />
    );
  }
  let questionSlot: React.ReactNode = null;
  if (!isCommitted && pendingQuestion !== null) {
    const { Component, props } = dispatchRenderInput(
      { kind: "question", request: pendingQuestion },
      { store: streamingStore, session: codeSessionStore },
    );
    questionSlot = (
      <Component key={pendingQuestion.request_id || "question"} {...props} />
    );
  }

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
            // Body order — per [D07] sequence substrate, the wire's
            // arrival order drives the visual order. The renderer
            // iterates `messages` (committed or in-flight) and
            // dispatches each kind to its inline surface:
            //
            //   - `assistant_thinking` → `TideThinkingBlock`,
            //     subscribed to the Message's per-Message streaming
            //     path (`turn.${turnKey}.message.${messageKey}.text`).
            //   - `tool_use` (top-level only — subagent children are
            //     resolved inside their parent's `AgentTranscriptBlock`
            //     via the `childToolCallsByParent` map) → tool block
            //     resolved via `dispatchToolCallState`.
            //   - `assistant_text` → `TugMarkdownBlock`, subscribed to
            //     the same per-Message path shape.
            //   - `user_message` is rendered by the separate user row;
            //     skipped here.
            //   - `system_note` lands in Step 8 (no instances yet).
            //
            // After the message list, the live-only permission slot
            // and question slot sit at the body foot — at most one is
            // ever non-null on the same render (the SDK only opens
            // one `control_request_forward` at a time). Slot keys
            // (`request.request_id`) are stable, so
            // React-reconciliation mount identity ([L26]) is
            // preserved across the dialog's pending → null
            // transition without remount.
            //
            // Subagent nesting ([#step-17-5]): the iteration skips
            // tool_use Messages whose `parentToolUseId` is set — they
            // render inside their parent's `AgentTranscriptBlock`.
            // `childToolCallsByParent` is the partition map threaded
            // into every top-level tool dispatch.
            <div ref={(el) => { bodyRef.current = el; }}>
              <CodeRowBody
                messages={messages}
                turnKey={turnKey}
                streamingStore={streamingStore}
                session={codeSessionStore}
              />
              {permissionSlot}
              {questionSlot}
            </div>
          }
          inflightFooter={
            // TideZ1C — in-flight indicator zone per [D19]. Mounted
            // only on the in-flight code row (`!isCommitted`); every
            // other row passes `null` and the `inflightFooter` slot
            // doesn't render. The component subscribes via
            // `useSyncExternalStore` to phase + interruptInFlight;
            // only this one row holds that subscription so other
            // rows don't wake on each snapshot dispatch.
            !isCommitted ? (
              <TideZ1C codeSessionStore={codeSessionStore} />
            ) : null
          }
          controls={
            (() => {
              // Z1B — committed-end-state aggregate per [D19].
              // Rendered only when the turn has committed; the
              // in-flight indicator (TideZ1C) lives in the
              // `inflightFooter` slot above this one and has its
              // own lifecycle. Trailing chrome (placement-
              // experiment renderer) still renders alongside Z1B
              // for both phases.
              const trailing =
                renderTurnTrailing !== undefined && row.turnKey !== undefined
                  ? renderTurnTrailing({
                      turnKey: row.turnKey,
                      half: "assistant",
                      turn: row.turn,
                    })
                  : null;
              const hasTrailing = trailing !== null && trailing !== undefined;
              if (!isCommitted && !hasTrailing) {
                // Nothing to render in the controls slot — return
                // `undefined` so the primitive doesn't even render
                // the wrapper (no margin-top consumed).
                return undefined;
              }
              return (
                <>
                  {isCommitted ? (
                    <TideZ1B
                      participant="code"
                      turn={turn}
                      perTurnTokens={row.perTurnTokens}
                      bodyText={copyMarkdown}
                    />
                  ) : null}
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

  /**
   * Scroll the transcript so the row at `index` is in view. Thin
   * pass-through to the inner `TugListView`'s `scrollToIndex`. The
   * Z2 telemetry popovers drive this to jump to a turn the user
   * clicked by its `#NNNN` number; out-of-range indices clamp to
   * first / last (the list view's own tolerance).
   */
  scrollToIndex(
    index: number,
    options?: { block?: ScrollLogicalPosition; animated?: boolean },
  ): void;
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

  // [DT10] transcript-replay paint gate. While the card's lifecycle
  // `state` is REPLAYING — the JSONL replay window bracketed by
  // `replay_started` / `replay_complete` — the reducer keeps
  // committing replayed turns to the data source one `turn_complete`
  // at a time, and the inner `TugListView` re-renders as usual. What
  // changes is purely visual: a `data-replaying` attribute on the
  // host root drives a `visibility: hidden` CSS rule that holds the
  // pane's paint dark across the whole window, so the user never
  // watches the transcript accumulate turn-by-turn while the viewport
  // chases the live edge (the restore FOUC). At `replay_complete` the
  // state leaves `replaying`, the attribute drops, and the
  // fully-reconstructed transcript paints exactly once, at the
  // restored scroll anchor. The subtree is never unmounted — only
  // paint is gated ([L06]) — so the host keeps mount identity ([L26])
  // and the inner list view's height index stays measured (the gate
  // is `visibility`, not `display`, precisely so `ResizeObserver`
  // keeps sizing cells underneath). `state` is read from the
  // lifecycle hook, never `phase` directly ([L02]).
  const lifecycle = useLifecycleState(codeSessionStore);
  const isReplaying = lifecycle.state === "replaying";

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
  // any in-flight `TugProgressIndicator` wave animation. Per-cell metadata
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
  // `codeSessionStore` is stable for the card's lifetime (same as the
  // `codeRenderer` deps note above), so `ghostRenderer` stays a stable
  // reference — the [L26] discipline the `user` / `code` renderers
  // follow.
  const ghostRenderer = useCallback<
    TugListViewCellRenderer<TideTranscriptDataSource>
  >(
    (p) => <GhostRowCell {...p} codeSessionStore={codeSessionStore} />,
    [codeSessionStore],
  );
  const cellRenderers = useMemo<
    Record<string, TugListViewCellRenderer<TideTranscriptDataSource>>
  >(
    () => ({
      "user": userRenderer,
      "code": codeRenderer,
      "ghost": ghostRenderer,
    }),
    [userRenderer, codeRenderer, ghostRenderer],
  );

  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      estimatedHeightForKind: (kind: string) =>
        kind === "code" ? ESTIMATED_HEIGHT_CODE : ESTIMATED_HEIGHT_USER,
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
      scrollToIndex(
        index: number,
        options?: { block?: ScrollLogicalPosition; animated?: boolean },
      ): void {
        listViewRef.current?.scrollToIndex(index, options);
      },
    }),
    [],
  );

  // Floating "scroll to latest" button. It is always mounted ([L26]);
  // its visibility is appearance state ([L06]) — `handleFollowBottom
  // Change` writes a `data-visible` attribute straight onto the button
  // DOM node as the list view's SmartScroll engages / disengages
  // follow-bottom. The follow-bottom intent never enters React state.
  const jumpButtonRef = useRef<HTMLButtonElement | null>(null);
  const handleFollowBottomChange = useCallback((following: boolean): void => {
    const btn = jumpButtonRef.current;
    if (btn !== null) btn.dataset.visible = String(!following);
  }, []);
  const handleJumpToBottom = useCallback((): void => {
    // Non-animated clamp — the same definite jump to the true bottom
    // the End key performs. The animated path eases toward a sentinel
    // offset and lands short of a tall transcript's end.
    listViewRef.current?.scrollToBottom();
  }, []);

  return (
    <div
      ref={rootRef}
      className="tide-card-transcript"
      data-slot="tide-card-transcript"
      data-testid="tide-card-transcript"
      data-replaying={isReplaying || undefined}
    >
      <TugListView
        ref={listViewRef}
        dataSource={dataSource}
        delegate={delegate}
        cellRenderers={cellRenderers}
        scrollKey="tide-card-transcript"
        followBottom
        onFollowBottomChange={handleFollowBottomChange}
        inline
        pageByEntry
      />
      <TideJumpToBottomButton ref={jumpButtonRef} onClick={handleJumpToBottom} />
    </div>
  );
});
