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
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { Copy } from "lucide-react";

import { TugBadge } from "@/components/tugways/tug-badge";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugTranscriptEntry } from "@/components/tugways/tug-transcript-entry";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
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
 * Returns the empty string for the special sentinel `0` so a callsite
 * can pass `entry.endedAt` unconditionally without fabricating a
 * "Jan 1 1970" timestamp on rows whose end-time was never recorded.
 */
export function formatTranscriptTimestamp(ms: number): string {
  if (ms === 0 || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
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
  return (
    <TugTranscriptEntry
      participant="user"
      identifier={USER_IDENTIFIER}
      timestamp={timestamp === "" ? undefined : timestamp}
      body={
        <span
          className="tide-card-transcript-user-body"
          data-testid="tide-card-transcript-user-body"
        >
          {text}
        </span>
      }
    />
  );
};

interface CodeCommittedRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  modelName: string | null;
}

const CodeCommittedRowCell: React.FC<CodeCommittedRowCellProps> = ({
  index,
  dataSource,
  modelName,
}) => {
  const row = dataSource.rowAt(index);
  const turn = row.turn;
  // Same defensive guard as `UserRowCell` — out-of-range row reads
  // should never happen, but if one slips through (e.g. a stale
  // re-render against a shrunk transcript) we render an empty body
  // rather than crash on `undefined.assistant`.
  const assistantText = turn?.assistant ?? "";
  const timestamp = turn !== undefined
    ? formatTranscriptTimestamp(turn.endedAt)
    : undefined;
  const handleCopy = useCallback(() => {
    if (assistantText.length === 0) return;
    void navigator.clipboard?.writeText(assistantText);
  }, [assistantText]);
  return (
    <TugTranscriptEntry
      participant="code"
      identifier={modelName ?? CODE_DEFAULT_IDENTIFIER}
      timestamp={timestamp === "" ? undefined : timestamp}
      body={
        <TugMarkdownBlock
          initialText={assistantText}
          className="tide-card-transcript-code-body"
        />
      }
      controls={
        <>
          {modelName !== null ? (
            <TugBadge size="sm" emphasis="tinted" role="agent">
              {modelName}
            </TugBadge>
          ) : null}
          <TugPushButton
            subtype="icon"
            emphasis="ghost"
            role="action"
            size="sm"
            icon={<Copy size={12} />}
            aria-label="Copy"
            onClick={handleCopy}
          />
        </>
      }
    />
  );
};

interface CodeStreamingRowCellProps extends TugListViewCellProps<TideTranscriptDataSource> {
  modelName: string | null;
  streamingStore: PropertyStore;
  streamingPath: string;
}

const CodeStreamingRowCell: React.FC<CodeStreamingRowCellProps> = ({
  modelName,
  streamingStore,
  streamingPath,
}) => {
  return (
    <TugTranscriptEntry
      participant="code"
      identifier={modelName ?? CODE_DEFAULT_IDENTIFIER}
      body={
        <TugMarkdownBlock
          streamingStore={streamingStore}
          streamingPath={streamingPath}
          className="tide-card-transcript-code-body"
        />
      }
    />
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
}

export const TideTranscriptHost: React.FC<TideTranscriptHostProps> = ({
  codeSessionStore,
  sessionMetadataStore,
}) => {
  const dataSource = useTideTranscriptDataSource(codeSessionStore);
  const modelName = useSessionModelName(sessionMetadataStore);
  const streamingStore = codeSessionStore.streamingDocument;
  // The streaming-path token is a literal on the snapshot's
  // `streamingPaths.assistant`; read once per store binding so the
  // value participates in the `cellRenderers` memo without churning
  // identity on every snapshot tick.
  const streamingPath = useMemo(
    () => codeSessionStore.getSnapshot().streamingPaths.assistant,
    [codeSessionStore],
  );

  const cellRenderers = useMemo<
    Record<string, TugListViewCellRenderer<TideTranscriptDataSource>>
  >(
    () => ({
      "user": (p) => <UserRowCell {...p} />,
      "code-committed": (p) => <CodeCommittedRowCell {...p} modelName={modelName} />,
      "code-streaming": (p) => (
        <CodeStreamingRowCell
          {...p}
          modelName={modelName}
          streamingStore={streamingStore}
          streamingPath={streamingPath}
        />
      ),
    }),
    [modelName, streamingStore, streamingPath],
  );

  const delegate = useMemo<TugListViewDelegate>(
    () => ({
      estimatedHeightForKind: (kind: string) =>
        kind === "user" ? ESTIMATED_HEIGHT_USER : ESTIMATED_HEIGHT_CODE,
    }),
    [],
  );

  return (
    <div
      className="tide-card-transcript"
      data-slot="tide-card-transcript"
      data-testid="tide-card-transcript"
    >
      <TugListView
        dataSource={dataSource}
        delegate={delegate}
        cellRenderers={cellRenderers}
        scrollKey="tide-card-transcript"
        followBottom
      />
    </div>
  );
};
