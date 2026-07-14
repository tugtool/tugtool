/**
 * dev-card-transcript.tsx — multi-turn transcript host for the Dev
 * card top pane.
 *
 * Mounts a `TugListView` against a `DevTranscriptDataSource` and
 * registers two cell renderers, one per row kind:
 *
 *   - `user` — `TugTranscriptEntry participant="user"` whose body is a
 *     `TugAtomMarkdownBody`. The submitted prompt renders as markdown
 *     (static `TugMarkdownBlock`), so the transcript shows bold / lists
 *     / code / headings exactly as the assistant body and the Claude
 *     Code TUI do, and the prompt's inline atom chips (`@`-mentions,
 *     file / command refs, pasted-image chips) are grafted back into
 *     that rendered markdown at their original `U+FFFC` positions via
 *     the same `TugAtomChip` every other surface uses. The prompt
 *     *editor* stays plain text — this is the display surface only.
 *   - `assistant` — `TugTranscriptEntry participant="assistant"` rendered by a
 *     single `AssistantTurnCell` component for the assistant row's entire
 *     life (both in-flight and committed). `TugMarkdownBlock` (and
 *     siblings `DevThinkingBlock` / `TranscriptToolCalls`) stay in
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
 * (see {@link DevTranscriptCellKind}) makes the `cellRenderers`
 * map structurally hold only one entry for the assistant row, so
 * the L26 violation that produced that bug cannot recur.
 *
 * Identifier resolution: the `assistant` row's identifier is the active
 * model name from `SessionMetadataStore` (e.g. `"claude-3.7-sonnet"`),
 * falling back to `"Code"` when the metadata store has no model field
 * set yet (cold-start, replay-only fixtures, etc.).
 *
 * Persistence axis: the inner `TugListView` mounts with
 * `scrollKey="dev-card-transcript"` so the [A9] state-preservation
 * protocol picks the right slot in `bag.regionScroll[]`. The key is
 * unique within the Dev card's subtree per [L23] / [#public-api].
 *
 * Token sovereignty: `.dev-card-transcript .tug-list-view { ... }`
 * cascade-scoped overrides live in `dev-card.css` per [D12]. The
 * primitive's token surface stays untouched.
 *
 * Tuglaws:
 *  - [L02] `AssistantTurnCell` reads `pendingApproval` / `pendingQuestion`
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
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AlarmClock,
  Bell,
  CircleDashed,
  ClipboardCheck,
  ClipboardList,
  Cog,
  Search,
  X,
} from "lucide-react";
import {
  useSessionModelName,
  useKnownSlashCommand,
  formatTranscriptTimestamp,
  useTranscriptCellMenu,
  type CopyMarkdownResolver,
} from "./transcript-host-helpers";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewHandle,
} from "@/components/tugways/tug-list-view";
import { useDeckManager } from "@/deck-manager-context";
import { DevThinkingBlock } from "@/components/tugways/chrome/dev-thinking-block";
import { DevZ1B } from "@/components/tugways/cards/dev-card-z1b";
import { useFootHeightReservation } from "@/components/tugways/cards/dev-card-transcript-foot-reservation";
import { formatAtomTextForCopy } from "@/components/tugways/cards/tug-atom-text-body";
import { TugAtomMarkdownBody } from "@/components/tugways/cards/tug-atom-markdown-body";
import { TugAttachmentPreview } from "@/components/tugways/cards/tug-attachment-preview";
import type { AtomSegment } from "@/lib/tug-atom-img";
import { formatModelLabel } from "@/lib/model-label";
import { DevZ1C } from "@/components/tugways/cards/dev-card-z1c";
import {
  dispatch as dispatchRenderInput,
  dispatchToolCallState,
} from "@/components/tugways/cards/dev-assistant-renderer-dispatch";
// Side-effect import: runs the tool-block registration loop so every
// bespoke wrapper is in the registry before the first resolveToolBlock.
import "@/components/tugways/cards/dev-assistant-renderer-registrations";
import {
  classifyRunBody,
  EMPTY_RUN_PLACEHOLDER,
} from "@/components/tugways/cards/dev-transcript-run-body";
import {
  ToolBlockExpansionContext,
  ToolBlockHistoryCollapse,
  ToolUseIdContext,
  ToolCallMetaProvider,
} from "@/components/tugways/blocks/collapse-context";
import { collapseDefaultForMessage } from "@/components/tugways/cards/blocks/tool-collapse-defaults";
import {
  ToolBlockExpansionState,
  type PersistedExpansionState,
} from "@/components/tugways/blocks/expansion-state";
import type { FindSession } from "@/lib/find-session";
import { TranscriptFindEngine } from "@/lib/transcript-find-engine";
import { buildTranscriptSearchSegments } from "@/lib/transcript-search-index";
import { TranscriptFindHighlighter } from "@/components/tugways/transcript-find-highlighter";
import {
  FindTargetRegistry,
  FindTargetRegistryContext,
} from "@/components/tugways/blocks/find-target-registry";
import "@/components/tugways/transcript-find.css";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "@/components/tugways/use-component-state-preservation";
import {
  toolCallToMarkdown,
  turnEntryToMarkdown,
} from "@/components/tugways/cards/turn-entry-markdown";
import { selectionToTranscriptMarkdown } from "@/lib/markdown/serialize-selection";
import { SLASH_COMMAND_CLASS } from "@/lib/markdown/enhance-slash-commands";
import { compactionNoteText } from "@/lib/code-session-store/compaction";
import { DevJumpToBottomButton } from "@/components/tugways/cards/dev-jump-to-bottom-button";
import {
  DevTranscriptTopRow,
  DevLoadOverlay,
} from "@/components/tugways/cards/dev-load-control-bar";
import { deriveColdRestoreActive } from "@/components/tugways/cards/dev-card-restore-gate";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugQuietLine } from "@/components/tugways/tug-quiet-line";
import { TugTranscriptEntry } from "@/components/tugways/tug-transcript-entry";
import { resolveCommandBlock } from "./dev-command-block-registry";
import { composeShellShareText } from "./shell-exchange-view";
import type { ShellSessionStore } from "@/lib/shell-session-store";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import type { CodeSessionStore } from "@/lib/code-session-store";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { openPathInOS } from "@/lib/os-open";
import {
  snapshotRowParseCounters,
  type RowParseCountersSnapshot,
} from "@/lib/markdown/parse-counters";
import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";
import type { Message, ToolUseMessage } from "@/lib/code-session-store/types";
import { useLifecycleState } from "@/lib/code-session-store/hooks/use-lifecycle-state";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { ResponseSettingsStore } from "@/lib/response-settings-store";
import {
  DevTranscriptDataSource,
  transcriptCellPropsEqual,
  useDevTranscriptDataSource,
  type DevRowDescriptor,
} from "@/lib/dev-transcript-data-source";
import type { PropertyStore } from "@/components/tugways/property-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The absolute turn-number offset for the loaded window — the count of
 * older turns that precede the first loaded turn. Added to a row's
 * window-relative turn index so every row is addressed by its true session
 * turn rather than its position within the loaded slice. `0` when the whole
 * session is loaded (no recency window). Enters React via
 * `useSyncExternalStore` ([L02]); updates (e.g. after a prepend shifts the
 * window) re-number every visible row.
 */
function useTurnNumberBase(codeSessionStore: CodeSessionStore): number {
  return useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () =>
        codeSessionStore.getSnapshot().replayWindow?.firstLoadedTurnIndex ?? 0,
      [codeSessionStore],
    ),
  );
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
const ASSISTANT_DEFAULT_IDENTIFIER = "Code";

/** Default identifier shown for `user` rows. */
const USER_IDENTIFIER = "You";
const SHELL_IDENTIFIER = "Shell";

/**
 * Stable empty-atoms reference for the ghost-row defensive fallback —
 * a fresh `[]` would defeat the `useMemo` identity gate that derives
 * `imageAtoms`.
 */
const EMPTY_ATOMS: ReadonlyArray<AtomSegment> = [];

interface UserMessageCellProps extends TugListViewCellProps<DevTranscriptDataSource> {
  /**
   * Typed row descriptor, resolved by the host's renderer lambda
   * (`dataSource.rowAt(index)`) and passed as a prop so the memo gate
   * ({@link transcriptCellPropsEqual}) can compare the PREVIOUS
   * render's row data against the current row's — an imperative
   * `rowAt` read inside the comparator would see only live state on
   * both sides and could never detect a change.
   */
  row: DevRowDescriptor;
  renderTurnTrailing?: TurnTrailingRenderer;
  codeSessionStore: CodeSessionStore;
}

const UserMessageCell = React.memo(function UserMessageCell({
  index,
  row,
  dataSource,
  renderTurnTrailing,
  codeSessionStore,
}: UserMessageCellProps) {
  // Address the row by its true session turn: the window's turn offset plus
  // the row's window-relative turn index ([L02]/[P04]). The user row carries
  // the `#u{turn}` address on its attribution row; image-atom captions carry
  // the same turn number so the inline chip and the attachment-strip tile
  // agree.
  const turnNumber =
    useTurnNumberBase(codeSessionStore) +
    dataSource.localTurnIndexForRow(index) +
    1;
  // Durable badge address ([P09]): session-true turn + within-turn ordinal.
  // A merged turn's steered user rows get `.2`, `.3`; the opener stays `#u{turn}`.
  const address = {
    speaker: "user" as const,
    turn: turnNumber,
    sub: dataSource.withinTurnOrdinalForRow(index),
  };
  // The data source resolves the specific `user_message` this row
  // renders (the turn opener, or a merged/steered mid-turn message —
  // never re-derived from `messages[0]`, Spec S01/[P04]). It is set on
  // every `user` row that paints; the defensive `?? ""` covers an
  // out-of-range read.
  const userMessage = row.userMessage;
  const rawText = userMessage?.text ?? "";
  const strippedText = stripUserBodyPrefix(rawText);
  // Parallel atoms array — N atoms in `attachments` pair with the
  // N `U+FFFC` characters in `text`. `stripUserBodyPrefix` only
  // strips the `>` route prefix; it never touches a `U+FFFC`, so
  // index alignment between `strippedText` and `attachments` is
  // preserved.
  const rawAtoms = userMessage?.attachments ?? [];

  // Atoms in the substrate render as chips verbatim — every U+FFFC
  // position pairs with its atom entry whether the assistant has
  // acted on it yet or not. Earlier drafts ran the (text, atoms)
  // pair through a `demoteUnverifiedMentions` gate that hid chips
  // until a tool call corroborated the mention; that hid the user's
  // own intentional chips for the entire in-flight window and added
  // a flicker when the model didn't tool-action the path. Removed
  // — the substrate is the authority.
  const text = strippedText;
  const atoms = rawAtoms;
  // Clipboard text — atoms become `[label](value)` markdown links so
  // the copied content carries an honest representation of each atom
  // (pasting into a markdown surface renders as a link; pasting into
  // plain text shows the link syntax, still legible). The body span
  // renders the SAME atoms as `<img>` chips via `TugAtomTextBody`;
  // the two surfaces walk the same substrate via the same helper, so
  // they can't disagree on what's there.
  const copyText = formatAtomTextForCopy(text, atoms);
  // Per-message thumbnail strip ([Step 6]). Image atoms only; the
  // strip itself filters to images-only by contract, but doing the
  // filter here keeps the prop shape tight and the reference stable
  // when the substrate has no image atoms (the strip then short-
  // circuits to null and consumes no row height).
  const imageAtoms = React.useMemo(
    () => atoms.filter((a) => a.type === "image"),
    [atoms],
  );
  const bytesStore = codeSessionStore.getAtomBytesStore();
  // User-row timestamp is the submit time, not the turn's end time —
  // the user's row "posts" the moment they hit submit, regardless of
  // whether the assistant has replied yet. `submitAt` rides the
  // `user_message` Message itself (committed or in-flight).
  const submitAt = userMessage?.submitAt;
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
          address={address}
          body={
            <>
              {/* The submitted prompt renders as markdown (like the
                  assistant body and the Claude Code TUI), with the
                  prompt's inline atom chips grafted back into the rendered
                  markdown at their original positions — see
                  `TugAtomMarkdownBody`. The root div carries the
                  menu-anchor `bodyRef`. The prompt *editor* is unaffected;
                  this is the display surface only. */}
              <TugAtomMarkdownBody
                ref={(el) => { bodyRef.current = el; }}
                className="dev-card-transcript-user-markdown"
                data-testid="dev-card-transcript-user-body"
                text={text}
                atoms={atoms}
                address={address}
              />
              <TugAttachmentPreview
                address={address}
                atoms={imageAtoms}
                bytesStore={bytesStore}
                data-testid="dev-card-transcript-attachment-strip"
              />
            </>
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
                  <DevZ1B
                    participant="user"
                    turn={row.turn}
                    bodyText={hasBody ? copyText : undefined}
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
}, transcriptCellPropsEqual);

// ---------------------------------------------------------------------------
// `GhostRowCell` — a queued send awaiting dispatch.
//
// One ghost row per `queuedSends` entry, painted de-emphasized at the
// transcript foot so a mid-turn submit reads as "queued, not yet
// sent." It carries a ✕ that un-sends that one queued message — a
// targeted cancel, distinct from the Stop / Esc pop-interactive gesture.
// When the queued send flushes, the reducer promotes it to the
// in-flight pair and this ghost row unmounts — see
// {@link DevTranscriptCellKind} for the key/kind transition.
// ---------------------------------------------------------------------------

interface GhostRowCellProps
  extends TugListViewCellProps<DevTranscriptDataSource> {
  /** Resolved row descriptor — see {@link UserMessageCellProps.row}. */
  row: DevRowDescriptor;
  codeSessionStore: CodeSessionStore;
}

const GhostRowCell = React.memo(function GhostRowCell({
  row,
  codeSessionStore,
}: GhostRowCellProps) {
  const queued = row.queued;
  // A queued send carries the same synthesized `(text, atoms)` pair a
  // committed user message does (minted at `handleSend` enqueue time),
  // so the ghost row paints its prompt — inline atom chips AND the
  // image-thumbnail strip — exactly as `UserMessageCell` does. The
  // ghost omits the `#u{turn}` address badge (it has no committed turn
  // yet), so the atom captions likewise carry no `#u{turn}-` prefix:
  // `address` is left undefined and the chip/strip share the
  // atom's bare `image-N` label. Hooks run unconditionally above the
  // defensive `queued === undefined` guard so the hook order is stable.
  const rawText = queued?.text ?? "";
  const text = stripUserBodyPrefix(rawText);
  const atoms = queued?.atoms ?? EMPTY_ATOMS;
  const turnKey = queued?.turnKey ?? "";
  const imageAtoms = React.useMemo(
    () => atoms.filter((a) => a.type === "image"),
    [atoms],
  );
  const bytesStore = codeSessionStore.getAtomBytesStore();
  // The adapter only emits a `ghost` kind alongside a `queued`
  // payload; this guard is defensive against an out-of-range read.
  if (queued === undefined) return null;
  return (
    <div
      className="dev-card-transcript-ghost-row"
      data-slot="dev-transcript-ghost-row"
    >
      <TugTranscriptEntry
        participant="user"
        identifier={USER_IDENTIFIER}
        body={
          <>
            <TugAtomMarkdownBody
              className="dev-card-transcript-user-markdown"
              data-testid="dev-card-transcript-user-body"
              text={text}
              atoms={atoms}
            />
            <TugAttachmentPreview
              atoms={imageAtoms}
              bytesStore={bytesStore}
            />
          </>
        }
        controls={
          // `TugIconButton` is focus-refusing — un-sending a queued
          // message must not steal focus from an editor the user may
          // be composing in. `cancelQueuedSend` removes this one entry
          // and routes its text back through `pendingDraftRestore`.
          <TugIconButton
            icon={<X size={11} strokeWidth={2.5} />}
            aria-label="Cancel queued message"
            tone="danger"
            size="2xs"
            emphasis="filled"
            onClick={() => codeSessionStore.cancelQueuedSend(turnKey)}
          />
        }
      />
    </div>
  );
}, transcriptCellPropsEqual);

// ---------------------------------------------------------------------------
// `ShellTurnCell` — the `$`-route exchange row ([P06]). One row per
// `shell`-origin turn, its sole `shell_exchange` Message rendered as
// non-context ink ([P11]) inside a `participant="shell"` transcript entry.
// ---------------------------------------------------------------------------
interface ShellTurnCellProps {
  index: number;
  row: DevRowDescriptor;
  dataSource: DevTranscriptDataSource;
  codeSessionStore: CodeSessionStore;
  shellSessionStore: ShellSessionStore;
}
const ShellTurnCell = React.memo(function ShellTurnCell({
  index,
  row,
  dataSource,
  shellSessionStore,
}: ShellTurnCellProps) {
  // The `#s{n}` badge is its own session-wide shell counter ([P09]) —
  // `#s1`, `#s2`, … independent of the Claude `#u`/`#a` turn numbers
  // interleaved among the shell rows. The data source assigns it in
  // flat-row order across the whole (always fully loaded) shell ledger.
  const shellNumber = dataSource.shellOrdinalForRow(index);
  const turn = row.turn;
  const message = turn?.messages[0];
  if (message === undefined || message.kind !== "shell_exchange") return null;
  // One row, no within-turn ordinal — `#s{n}` never grows a `.2` suffix.
  const address = { speaker: "shell" as const, turn: shellNumber };
  // Timestamp is the exec time (`startedAtMs`), the shell analog of the
  // user row's submit time — the command "posts" the moment it runs.
  const startedAt = message.startedAtMs;
  const timestamp =
    startedAt !== undefined ? formatTranscriptTimestamp(startedAt) : undefined;
  // Command-block registry ([P05]): a bespoke renderer claims the
  // command family it understands; everything else renders through
  // the generic exchange block. Resolution is total.
  const CommandBlock = resolveCommandBlock(message.command);
  return (
    <div
      className="dev-card-transcript-shell-row"
      data-slot="dev-transcript-shell-row"
    >
      <TugTranscriptEntry
        participant="shell"
        identifier={SHELL_IDENTIFIER}
        // Time • cwd — the exec time paired with the directory the
        // command ran in (`message.cwd`, the per-exchange cwd, not the
        // live session cwd), bulleted like the shell Z1B end-state row.
        // The cwd is a clickable affordance: hover-underlined, it opens
        // that directory in Finder via the host bridge — the same
        // `openPathInOS(dir, "folder")` gesture the Project / Cwd chips use.
        timestamp={
          <>
            {timestamp !== undefined && timestamp !== "" ? timestamp : null}
            {timestamp !== undefined && timestamp !== "" ? " • " : null}
            <button
              type="button"
              className="dev-card-transcript-shell-cwd"
              title={`Open in Finder: ${message.cwd}`}
              aria-label={`Open ${message.cwd} in Finder`}
              // Focus-refusing ([mousedown focus default]): a cwd click
              // opens Finder, it must never pull focus off an editor the
              // user is composing in. `tabIndex={-1}` keeps it out of the
              // transcript's tab order; the capture-phase `preventDefault`
              // suppresses WebKit's mousedown focus default so the click
              // fires without the button ever claiming focus.
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openPathInOS(message.cwd, "folder")}
            >
              {message.cwd}
            </button>
          </>
        }
        address={address}
        body={
          // The same whole-block collapse a Bash block wears ([P02]): the
          // chrome renders the header expand/collapse chevron, and fold-
          // suppression opens the embedded terminal fully (no double-dip),
          // so long output is collapsible from the header. Keyed on the
          // exchange id so the user's expand/collapse choice persists across
          // windowed remounts. Defaults expanded — the user just ran it.
          <ToolBlockHistoryCollapse
            toolUseId={message.exchangeId}
            defaultCollapsed={false}
          >
            <CommandBlock
              message={message}
              // Share ([P08]): compose the fenced text at click time and
              // park it on the shell store; the prompt entry consumes it
              // (route flip + editor seed) — never auto-sent.
              onShare={() =>
                shellSessionStore.requestShare(composeShellShareText(message))
              }
            />
          </ToolBlockHistoryCollapse>
        }
        // Z1B end-state row ([D111]) — the exchange's exit badge + duration,
        // beneath the block, exactly where a Claude turn shows its OK/Error
        // badge + timing.
        controls={<DevZ1B participant="shell" turn={turn} />}
      />
    </div>
  );
}, transcriptCellPropsEqual);

// ---------------------------------------------------------------------------
// `AssistantTurnCell` — single renderer for the assistant row.
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
// All streaming children (`DevThinkingBlock`,
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
// `StreamedTextGate` — suppress the DOM of a closed-and-empty streamed
// block.
//
// A thinking / text Message mints on `content_block_start` with no text;
// its block self-hides (`data-empty` → `display: none`) until deltas
// arrive. But a block that CLOSES empty stays a real DOM sibling forever,
// and the transcript's follower-position spacing rules (`* + .tool-block-
// chrome` etc.) can't skip hidden siblings — the invisible node opens a
// phantom run gap above whatever follows it (visibly: extra air between
// an attribution header and a first tool block whenever the turn minted
// an empty thinking block). The gate removes the node instead: when the
// message is closed (a later Message exists — blocks stream strictly in
// order, so a non-last block receives no further deltas) and its streamed
// text is empty, it renders nothing at all.
//
// The turn's LAST message always mounts (`alwaysMount`): it may still be
// streaming, and the block's own subscription + `data-empty` chrome
// handle the pre-first-delta hidden state. Nothing follows it, so its
// hidden node affects no spacing.
//
// [L02]: the store enters React through `useSyncExternalStore`. [L26]:
// the message key rides the gate, so mount identity is preserved across
// re-renders for blocks the gate keeps.
// ---------------------------------------------------------------------------

interface StreamedTextGateProps {
  streamingStore: PropertyStore;
  streamingPath: string;
  /** Turn's last message — may still be streaming; always mount. */
  alwaysMount: boolean;
  children: React.ReactNode;
}

const StreamedTextGate: React.FC<StreamedTextGateProps> = ({
  streamingStore,
  streamingPath,
  alwaysMount,
  children,
}) => {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) =>
      streamingStore.observe(streamingPath, onStoreChange),
    [streamingStore, streamingPath],
  );
  const hasText = React.useSyncExternalStore(subscribe, () => {
    const value = streamingStore.get(streamingPath);
    return typeof value === "string" && value.length > 0;
  });
  if (!alwaysMount && !hasText) return null;
  return <>{children}</>;
};

// ---------------------------------------------------------------------------
// `CodeRowBody` — iterate the turn's Message sequence ([D07]).
//
// Renders each Message kind to its inline surface in arrival order.
// Lives outside `AssistantTurnCell` so the component reference is stable
// across re-renders ([L26]) and the iteration logic stays close to
// the dispatch.
// ---------------------------------------------------------------------------

interface CodeRowBodyProps {
  messages: ReadonlyArray<import("@/lib/code-session-store").Message>;
  turnKey: string;
  streamingStore: PropertyStore;
  session: CodeSessionStore;
  /**
   * `tool_use_id` of the call a permission/question dialog is currently
   * blocked on, or `undefined` when nothing is awaiting. The matching
   * tool row paints its lifecycle dot `awaiting` ([Q01], #step-6).
   * Live only — a committed turn never has a pending dialog.
   */
  awaitingToolUseId?: string;
  /**
   * True when this turn committed with a non-`complete` end reason
   * (the user pressed Stop, or the turn errored / lost transport
   * mid-run). Any tool call still `pending` at that point never got a
   * result, so its lifecycle dot must read `interrupted` rather than
   * stay stuck `in_flight` ([D03]). Threaded into `dispatchToolCallState`.
   */
  turnInterrupted?: boolean;
  /**
   * True for a committed row (a `TurnEntry` exists). Gates the empty-run
   * fallback (`classifyRunBody`): a live/in-flight row is skipped so a
   * turn mid-stream — which may transiently hold only a tool call before
   * its text arrives — never flashes a plumbing marker or placeholder.
   */
  committed?: boolean;
  /**
   * Clickability gate for inline slash-command spans in this turn's
   * `assistant_text` prose — forwarded to `TugMarkdownBlock`. See
   * `useKnownSlashCommand`.
   */
  isKnownSlashCommand?: (name: string) => boolean;
}

/**
 * Per-run-marker glyph. The `plumbing` phrases are the fixed set from
 * `dev-transcript-run-body.ts`; an unrecognised phrase ("Ran <tool>")
 * and the `empty` placeholder fall to a generic icon.
 */
const RUN_MARKER_ICON_SIZE = 16;
const RUN_MARKER_ICONS: Readonly<Record<string, React.ReactNode>> = {
  "Scheduled a wake-up": <AlarmClock size={RUN_MARKER_ICON_SIZE} aria-hidden="true" />,
  "Searched for tools": <Search size={RUN_MARKER_ICON_SIZE} aria-hidden="true" />,
  "Entered plan mode": <ClipboardList size={RUN_MARKER_ICON_SIZE} aria-hidden="true" />,
  "Exited plan mode": <ClipboardCheck size={RUN_MARKER_ICON_SIZE} aria-hidden="true" />,
  "Sent a notification": <Bell size={RUN_MARKER_ICON_SIZE} aria-hidden="true" />,
};
function runMarkerIcon(variant: "plumbing" | "empty", label: string): React.ReactNode {
  if (variant === "empty")
    return <CircleDashed size={RUN_MARKER_ICON_SIZE} aria-hidden="true" />;
  return (
    RUN_MARKER_ICONS[label] ?? <Cog size={RUN_MARKER_ICON_SIZE} aria-hidden="true" />
  );
}

/**
 * Subtle inline marker rendered in place of an assistant run's empty
 * body — either a `plumbing` trace for a hidden-tool-only run (e.g.
 * "Scheduled a wake-up") or the `empty` placeholder for a blank turn.
 * The Voice-3 quiet-line register: a leading glyph + the phrase. The
 * plumbing phrase is short (rides the nowrap `label` slot); the empty
 * placeholder is a full sentence (rides the wrapping `subject` slot).
 */
const TranscriptRunMarker: React.FC<{
  variant: "plumbing" | "empty";
  label: string;
}> = ({ variant, label }) => (
  <div
    className="dev-card-transcript-run-marker"
    data-variant={variant}
    data-slot={`run-marker-${variant}`}
    role="note"
  >
    <TugQuietLine
      icon={runMarkerIcon(variant, label)}
      label={variant === "empty" ? undefined : label}
      subject={variant === "empty" ? label : undefined}
      tone="quiet"
    />
  </div>
);

const CodeRowBody: React.FC<CodeRowBodyProps> = ({
  messages,
  turnKey,
  streamingStore,
  session,
  awaitingToolUseId,
  turnInterrupted = false,
  committed = false,
  isKnownSlashCommand,
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
  const lastMessage = messages[messages.length - 1];
  for (const message of messages) {
    if (message.kind === "user_message") {
      // Rendered separately by the user row — skip in the assistant body.
      continue;
    }
    if (message.kind === "system_note") {
      if (message.source === "compact") {
        // Compaction divider — a soft separator matching the terminal's
        // compaction indicator (the raw summary block stays hidden, as
        // in Claude Code's own UI). Appearance is CSS-only ([L06]).
        elements.push(
          <div
            key={message.messageKey}
            className="dev-card-transcript-compaction"
            role="separator"
            data-slot="compaction-divider"
          >
            <span
              className="dev-card-transcript-compaction-label"
              data-tugx-findable=""
            >
              {message.text}
            </span>
          </div>,
        );
        continue;
      }
      if (message.source === "scheduled") {
        // Wake-trigger chip — a subdued marker above the wake turn's
        // assistant content naming what scheduled it, seeded by the
        // reducer from `wake_started.wake_trigger.summary`. A scheduled
        // wake ("loop pacing", a cron's prompt) carries a short label; a
        // background-agent completion carries the agent's full answer,
        // which is markdown. Route the text through `TugMarkdownBlock`
        // so that rich content renders formatted rather than as literal
        // `##`/backtick source — a short label renders identically as a
        // single paragraph. Appearance is CSS-only ([L06]).
        elements.push(
          <div
            key={message.messageKey}
            className="dev-card-transcript-wake-trigger"
            data-slot="wake-trigger-chip"
          >
            <TugQuietLine
              icon={<AlarmClock size={16} aria-hidden="true" />}
              subject={
                <TugMarkdownBlock
                  key={`md-${message.text.length}`}
                  initialText={message.text}
                  className="dev-card-transcript-wake-trigger-md"
                  findable
                />
              }
              tone="quiet"
            />
          </div>,
        );
        continue;
      }
      // Other system_note sources (`other`) have no renderer yet —
      // skip silently rather than crashing.
      continue;
    }
    if (message.kind === "assistant_thinking") {
      const path = `turn.${turnKey}.message.${message.messageKey}.text`;
      elements.push(
        <StreamedTextGate
          key={message.messageKey}
          streamingStore={streamingStore}
          streamingPath={path}
          alwaysMount={message === lastMessage}
        >
          <DevThinkingBlock
            streamingStore={streamingStore}
            streamingPath={path}
          />
        </StreamedTextGate>,
      );
      continue;
    }
    if (message.kind === "assistant_text") {
      const path = `turn.${turnKey}.message.${message.messageKey}.text`;
      elements.push(
        <StreamedTextGate
          key={message.messageKey}
          streamingStore={streamingStore}
          streamingPath={path}
          alwaysMount={message === lastMessage}
        >
          <TugMarkdownBlock
            streamingStore={streamingStore}
            streamingPath={path}
            className="dev-card-transcript-code-body"
            findable
            isKnownSlashCommand={isKnownSlashCommand}
          />
        </StreamedTextGate>,
      );
      continue;
    }
    // shell_exchange messages never appear inside a Claude (user/assistant)
    // turn — they are the sole content of a separate `shell`-origin turn,
    // rendered by the data source's shell row kind ([P06]). Skip defensively
    // so this Claude-turn loop's fall-through narrows cleanly to `tool_use`.
    if (message.kind === "shell_exchange") continue;
    // tool_use — render top-level calls only; subagent children are
    // resolved inside their parent's wrapper.
    if (message.parentToolUseId !== undefined) continue;
    const awaiting =
      awaitingToolUseId !== undefined &&
      message.toolUseId === awaitingToolUseId;
    const { Component, props } = dispatchToolCallState(
      message,
      0,
      childrenByParent,
      session,
      awaiting,
      turnInterrupted,
    );
    // EVERY tool block is collapsible — the header's whole-block chevron
    // is the single fold and the header owns Copy in both states, so a
    // run of tool calls reads uniformly. The per-tool table ([P06]/[P07])
    // governs only the DEFAULT (noisy file/shell tools mount header-only;
    // content tools mount open); the collapse provider owns the boolean
    // (seeded from the card's expansion overrides), so the chrome withholds
    // the body subtree while collapsed and the header keeps tracking phase
    // via its lifecycle dot. The wrap policy is derived from the tool kind,
    // which never changes for a given call, so it is stable across the
    // live→committed transition and mount identity holds ([L26]).
    //
    // The `ToolUseIdContext` provider carries the stable React key
    // (preserving mount identity, [L26]) and a fallback id; the collapse
    // handle also carries `toolUseId`, which the chrome prefers.
    const collapseByDefault = collapseDefaultForMessage(message);
    elements.push(
      <ToolUseIdContext.Provider
        key={message.messageKey}
        value={message.toolUseId}
      >
        <ToolCallMetaProvider
          toolUseId={message.toolUseId}
          toolName={message.toolName}
          status={message.status}
          startedAtMs={message.createdAt}
          toolWallMs={message.toolWallMs}
        >
          <ToolBlockHistoryCollapse
            toolUseId={message.toolUseId}
            defaultCollapsed={collapseByDefault}
            copyText={() => toolCallToMarkdown(message, childrenByParent)}
          >
            <Component {...props} />
          </ToolBlockHistoryCollapse>
        </ToolCallMetaProvider>
      </ToolUseIdContext.Provider>,
    );
  }

  // Empty-run fallback ([D14] — thinking is supplementary, hidden tools
  // paint zero ink [D101]). A committed run that produced no user-facing
  // content would otherwise be attribution chrome over a blank body. A
  // `plumbing` run (only hidden-policy tools) gets a marker per tool so
  // the invisible work reads as a trace; a truly `empty` run gets the
  // canned placeholder. Live rows are skipped — a mid-stream turn may
  // hold only a tool call before its text arrives.
  if (committed) {
    const { fallback, markers } = classifyRunBody(messages);
    if (fallback === "plumbing") {
      for (const label of markers) {
        elements.push(
          <TranscriptRunMarker
            key={`run-marker-${label}`}
            variant="plumbing"
            label={label}
          />,
        );
      }
    } else if (fallback === "empty") {
      elements.push(
        <TranscriptRunMarker
          key="run-marker-empty"
          variant="empty"
          label={EMPTY_RUN_PLACEHOLDER}
        />,
      );
    }
  }

  return <>{elements}</>;
};

interface AssistantTurnCellProps extends TugListViewCellProps<DevTranscriptDataSource> {
  /** Resolved row descriptor — see {@link UserMessageCellProps.row}. */
  row: DevRowDescriptor;
  /**
   * Per-card `SessionMetadataStore`. Each `AssistantTurnCell` subscribes
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

const AssistantTurnCell = React.memo(function AssistantTurnCell({
  index,
  row,
  dataSource,
  sessionMetadataStore,
  codeSessionStore,
  streamingStore,
  renderTurnTrailing,
}: AssistantTurnCellProps) {
  // Subscribe to the metadata store HERE in the cell — not at the
  // host — so the model-name read does not flow through the
  // `assistantRenderer` lambda's dependency array. The renderer stays
  // identity-stable across metadata updates, which keeps every
  // cell mounted across the (one-time at session-init, occasional
  // mid-session) `modelName` resolution. [L02] / [L26].
  const modelName = useSessionModelName(sessionMetadataStore);
  // Known-command gate for clickable slash commands in this turn's prose
  // ([L02] via the metadata store's catalog). Subscribed HERE in the cell,
  // like `modelName`, so the host renderer lambda stays identity-stable.
  const isKnownSlashCommand = useKnownSlashCommand(sessionMetadataStore);
  // Address the row by its true session turn ([L02]/[P04]). The assistant
  // row carries one `#a{turn}` address on its attribution row (a wake/cron
  // turn is the assistant speaking, so it is `#a` too); the inline messages
  // of the turn carry none.
  const turnNumber =
    useTurnNumberBase(codeSessionStore) +
    dataSource.localTurnIndexForRow(index) +
    1;
  // Durable badge address ([P09]): session-true turn + within-turn run ordinal.
  // A merged turn's later assistant runs get `.2`, `.3`; the first stays `#a{turn}`.
  const address = {
    speaker: "assistant" as const,
    turn: turnNumber,
    sub: dataSource.withinTurnOrdinalForRow(index),
  };
  // `turnKey` is set for every assistant row by `rowAt`. The fallback
  // throws in dev (data-source contract violation) and falls back to
  // an index-scoped string in prod so different rows can't
  // cross-pollinate per-turn paths if the contract is silently
  // violated downstream.
  if (row.turnKey === undefined && process.env.NODE_ENV !== "production") {
    throw new Error(
      `AssistantTurnCell: row.turnKey missing at index=${index}. ` +
        `DevTranscriptDataSource.rowAt must set turnKey on every assistant row.`,
    );
  }
  const turnKey = row.turnKey ?? `missing-${index}`;
  // Committed-ness is "a TurnEntry exists for this row" — derived
  // from data, not from a separate kind enum. Using `row.turn` keeps
  // the branching tied to the actual payload the cell needs, so
  // there's no opportunity for kind and payload to disagree.
  const turn = row.turn;
  const isCommitted = turn !== undefined;
  // This assistant row renders one maximal non-user run of its turn
  // (Spec S01) — a single-assistant turn has one run spanning the whole
  // turn; a merged turn splits into a run per `user_message` boundary.
  // The data source hands us the stable full-array reference plus the
  // `[messageStart, messageEnd)` slice indices, so we slice here
  // (memoized on the array + bounds) rather than carry a fresh array on
  // the descriptor — keeping the memo gate reference-stable for
  // committed rows.
  const allMessages = turn?.messages ?? row.activeTurn?.messages ?? [];
  const messageStart = row.messageStart ?? 0;
  const messageEnd = row.messageEnd ?? allMessages.length;
  const messages = useMemo(
    () => allMessages.slice(messageStart, messageEnd),
    [allMessages, messageStart, messageEnd],
  );
  // The bracket's last assistant run is the per-turn end-state / badge /
  // live-indicator anchor ([P02]): committed end-state chrome (Z1B), the
  // in-flight indicator (Z1C), the pending-dialog slots, and the foot
  // height reservation all ride this one row, so a merged turn shows
  // them once (after the continuation), not per run.
  const isLastAssistant = row.isLastAssistantOfTurn ?? false;
  // Full-turn markdown for the Z1B COPY affordance — every tool
  // call's input/output followed by the assistant prose. Serialized
  // once per committed turn (the turn is frozen post-commit, so the
  // memo runs a single time). `undefined` for the in-flight row,
  // which keeps COPY suppressed until the turn commits.
  // Lazy: build the full-turn markdown only when Copy is pressed,
  // never eagerly at render. `undefined` keeps Copy suppressed for the
  // in-flight row.
  const copyMarkdown = useMemo(
    () => (turn !== undefined ? () => turnEntryToMarkdown(turn) : undefined),
    [turn],
  );
  const timestamp =
    turn !== undefined ? formatTranscriptTimestamp(turn.endedAt) : undefined;

  // Permission + question slots — both are *pending-only* live input
  // forms rendered at the body foot. Permissions leave no committed
  // record (Step 3.5 removed the recorded chrome — see
  // `#step-3-5` in `roadmap/archive/dev-interactive-dialogs.md` — because
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
    isLastAssistant &&
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
  // A pending QUESTION no longer renders at the body foot — the
  // `AskUserQuestionToolBlock` owns its live surface in place at the
  // tool_use position (it morphs the same `BlockChrome` from the live
  // wizard to the durable Q&A artifact on answer). `pendingQuestion` is
  // still read above, but only to id-join the live row's `awaiting`
  // lifecycle dot (see `awaitingToolUseId` below). Only the permission
  // forward still mounts a foot-slot dialog.

  // Reserve the dismissed dialog's height as a `min-height` floor on
  // the cell-entry wrapper so a PermissionDialog / QuestionDialog
  // unmount can't collapse `scrollHeight`, clamp `scrollTop`, and jump
  // the transcript backward. The floor wraps the WHOLE entry (body +
  // inflight footer), so the thinking indicator stays directly after
  // the content and the reserved gap sits below it. Driven by observing
  // `codeSessionStore` directly [L22] — the floor is set in the
  // synchronous store-notify callback while the dialog is still
  // mounted. See `dev-card-transcript-foot-reservation`.
  const { floorRef: footFloorRef } = useFootHeightReservation(
    codeSessionStore,
    !isCommitted && isLastAssistant,
  );

  // Reconstruct markdown for any selection in this row ([P03]). The
  // closure captures the row's live messages + streaming store; the
  // hook live-refs it so COPY always runs the latest one without
  // destabilizing the handler identity.
  const resolveCopyMarkdown = useCallback<CopyMarkdownResolver>(
    (bodyEl, selection) => selectionToTranscriptMarkdown(selection, bodyEl),
    [],
  );
  const { ResponderScope, cellProps, bodyRef, menu } =
    useTranscriptCellMenu(resolveCopyMarkdown);

  return (
    <ResponderScope>
      <div {...cellProps}>
        {/* Foot height-reservation floor [L22/L06/L23] — wraps the whole
            entry so the inflight footer (thinking indicator) is held
            inside the floor, not below the reserved gap. */}
        <div ref={footFloorRef}>
          <TugTranscriptEntry
            participant="assistant"
            identifier={
              modelName ? formatModelLabel(modelName) : ASSISTANT_DEFAULT_IDENTIFIER
            }
            timestamp={
              timestamp === "" || timestamp === undefined ? undefined : timestamp
            }
            address={address}
            body={
              // Body order — per [D07] sequence substrate, the wire's
              // arrival order drives the visual order. The renderer
              // iterates `messages` (committed or in-flight) and
              // dispatches each kind to its inline surface:
              //
              //   - `assistant_thinking` → `DevThinkingBlock`,
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
                  isKnownSlashCommand={isKnownSlashCommand}
                  awaitingToolUseId={
                    // Id-join the live pending dialog to its tool row so
                    // that row's lifecycle dot reads `awaiting` ([Q01]).
                    // Permission and question forwards both carry
                    // `tool_use_id`; whichever is live wins.
                    pendingApproval?.tool_use_id ??
                    pendingQuestion?.tool_use_id ??
                    undefined
                  }
                  turnInterrupted={
                    // A committed turn that didn't end `complete` (Stop,
                    // error, transport-lost) left any still-`pending` tool
                    // call without a result — its dot must read
                    // `interrupted`, not stay stuck `in_flight` ([D03]).
                    // The in-flight row (`turn === undefined`) is never
                    // interrupted: it's genuinely still running.
                    turn !== undefined && turn.turnEndReason !== "complete"
                  }
                  committed={isCommitted}
                />
                {permissionSlot}
              </div>
            }
            inflightFooter={
              // DevZ1C — in-flight indicator zone per [D19]. Mounted
              // only on the in-flight assistant row (`!isCommitted`); every
              // other row passes `null` and the `inflightFooter` slot
              // doesn't render. The component subscribes via
              // `useSyncExternalStore` to phase + interruptInFlight;
              // only this one row holds that subscription so other
              // rows don't wake on each snapshot dispatch.
              !isCommitted && isLastAssistant ? (
                <DevZ1C codeSessionStore={codeSessionStore} />
              ) : null
            }
            controls={
              (() => {
                // Z1B — committed-end-state aggregate per [D19].
                // Rendered only when the turn has committed; the
                // in-flight indicator (DevZ1C) lives in the
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
                // Z1B is the committed-turn end-state aggregate — it
                // rides only the bracket's last assistant row ([P02]), so
                // a merged turn shows it once (after the continuation).
                const showZ1B = isCommitted && isLastAssistant;
                if (!showZ1B && !hasTrailing) {
                  // Nothing to render in the controls slot — return
                  // `undefined` so the primitive doesn't even render
                  // the wrapper (no margin-top consumed).
                  return undefined;
                }
                return (
                  <>
                    {showZ1B ? (
                      <DevZ1B
                        participant="assistant"
                        turn={turn}
                        perTurnTokens={row.perTurnTokens}
                        agentTokens={row.agentTokens}
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
      </div>
      {menu}
    </ResponderScope>
  );
}, transcriptCellPropsEqual);


// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/**
 * Complete a find reveal for a mounted `dom`-segment active match: re-issue
 * the reveal through the list's exact-rect path (which also clears the
 * pending estimated-jump correction that would otherwise re-align the row a
 * commit later and undo the nudges), then nudge the scroll region until the
 * active range lies inside the visible band — below the pinned chrome
 * (`--tugx-pin-stack-top`) at the top, above the scroller's own bottom edge
 * at the bottom (overscan-mounted rows resolve Ranges below that edge, which
 * reads as "under the prompt entry"). Bottom edge first, then top, so a rect
 * taller than the band keeps its top visible; live Ranges track the scroll,
 * so the rect is re-read between nudges and the flash lands at the settled
 * position.
 *
 * Returns `false` when the active range is not yet paintable (row still
 * unmounted) — the caller retries or waits for the next windowing commit.
 */
function settleFindReveal(
  highlighter: TranscriptFindHighlighter,
  root: HTMLElement | null,
  listView: TugListViewHandle | null,
  activeRow: number,
): boolean {
  let rect = highlighter.activeRangeRect();
  if (rect === null) return false;
  listView?.scrollToIndex(activeRow, { block: "nearest" });
  rect = highlighter.activeRangeRect() ?? rect;
  const scroller =
    root?.querySelector<HTMLElement>(
      '[data-tug-scroll-key="dev-card-transcript"]',
    ) ?? null;
  if (scroller !== null) {
    // The pin stack is per-ENTRY — each entry root carries its live header
    // height as `--tugx-pin-stack-top` (the card CSS provides a static
    // fallback below the host root) — so it must be read from an element
    // inside the active match's entry, never from the transcript host root,
    // which sits above every setter and computes 0.
    const stickyEl = highlighter.activeRangeElement() ?? scroller;
    const stickyTop =
      parseFloat(
        getComputedStyle(stickyEl).getPropertyValue("--tugx-pin-stack-top"),
      ) || 0;
    const scrollerRect = scroller.getBoundingClientRect();
    const bandTop = scrollerRect.top + stickyTop + 8;
    const bandBottom = scrollerRect.bottom - 8;
    if (rect.bottom > bandBottom) {
      scroller.scrollTop += rect.bottom - bandBottom;
    }
    const settled = highlighter.activeRangeRect();
    if (settled !== null && settled.top < bandTop) {
      scroller.scrollTop -= bandTop - settled.top;
    }
  }
  highlighter.flashActive();
  return true;
}

export interface DevTranscriptHostProps {
  /**
   * Owning card id — keys the replay progress strip's resume display
   * metadata read (`getResumeDisplayMetadata`).
   */
  cardId: string;
  codeSessionStore: CodeSessionStore;
  /** Per-card shell session — the shell rows' Share gesture parks its
   *  composed text here for the prompt entry to consume ([P08]). */
  shellSessionStore: ShellSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  /**
   * Per-card response-settings store. The host binds it to the
   * `.dev-card-transcript` root via `useLayoutEffect` so the store's
   * CSS custom properties cascade onto every entry header and content
   * body without round-tripping through React state ([L06] / [L22]).
   */
  responseStore: ResponseSettingsStore;
  /**
   * `⌕`-route Find session (shared with the prompt entry). The host owns the
   * whole-transcript index, runs the search over it, paints matches via the
   * Custom-Highlight painter, and scrolls + flashes the active match.
   */
  findSession: FindSession;
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
 * Imperative handle exposed via `forwardRef`. The dev-card holds this
 * to drive a deliberate "jump to latest" on submit — the transcript is
 * a split-pane *sibling* of the prompt entry, so a bubbling DOM event
 * can't reach the inner list view; the parent threads the gesture
 * through this handle instead.
 */
export interface DevTranscriptHandle {
  /**
   * Scroll the transcript to the bottom of content and re-engage
   * follow-bottom. Thin pass-through to the inner `TugListView`'s
   * `scrollToBottom`.
   */
  scrollToBottom(options?: { animated?: boolean }): void;

  /**
   * Scroll the transcript to the very top (Home). Thin pass-through to
   * the inner `TugListView`'s `scrollToTop`, which disengages
   * follow-bottom before landing at the top.
   */
  scrollToTop(): void;

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

  /**
   * Step the transcript one turn (one entry) up or down. Thin
   * pass-through to the inner `TugListView`'s `pageByEntry`. The dev
   * card binds Opt-Cmd-Up / Opt-Cmd-Down at the card root to this, so
   * turn navigation works from anywhere focus sits in the card — the
   * transcript region, the prompt editor, the status bar.
   */
  pageByEntry(direction: "up" | "down"): void;
}

export const DevTranscriptHost = forwardRef<
  DevTranscriptHandle,
  DevTranscriptHostProps
>(function DevTranscriptHost(
  {
    cardId,
    codeSessionStore,
    shellSessionStore,
    sessionMetadataStore,
    responseStore,
    findSession,
    renderTurnTrailing,
  },
  ref,
) {
  const dataSource = useDevTranscriptDataSource(codeSessionStore);
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

  // A load-previous bracket is also `replaying`, but the existing
  // content must stay visible (older turns prepend above it) — so the
  // [DT10] blank-and-reveal gate is suppressed for it. [L02]
  const loadingPrevious = useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().loadingPrevious,
  );

  // Batch-load freeze for the inner list's per-commit scroll battery
  // ([L04] settle handshake). `loadActive` mirrors the Z0 load-control
  // bar's own flag — true across the restore replay window and every
  // "load previous" bracket. It drops at `replay_complete`, but the list
  // then mounts the whole batch and settles every cell's measured height
  // over the next few commits; running the pin / anchor-writer on each of
  // those forces a full-transcript layout repeatedly. `settlingAfterLoad`
  // bridges from `loadActive` falling until the list raises `onFirstSettle`
  // (its ResizeObserver has delivered the batch's heights), so the freeze
  // spans the load *and* its settle. The union is handed to the list as
  // `batchLoading`.
  const loadActive = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(() => {
      const s = codeSessionStore.getSnapshot();
      return s.loadingPrevious || deriveColdRestoreActive(s);
    }, [codeSessionStore]),
  );
  const [settlingAfterLoad, setSettlingAfterLoad] = useState(false);
  const prevLoadActiveRef = useRef(loadActive);
  useLayoutEffect(() => {
    if (prevLoadActiveRef.current && !loadActive) setSettlingAfterLoad(true);
    prevLoadActiveRef.current = loadActive;
  }, [loadActive]);
  // Settle-phase timer ([L04] handshake). `replay_render` measures the
  // backend replay window (`replay_started` → `replay_complete`) and stops
  // BEFORE the list mounts and settles its heights — exactly the phase that
  // dominates the felt cost. `settleStartRef` is stamped at the reveal (the
  // commit where the list first mounts; see `listMounted` below) and read
  // when the list raises `onFirstSettle`, surfacing the reveal→settled
  // duration in the dev panel so the post-reveal settle is measurable.
  const settleStartRef = useRef<number | null>(null);
  const handleFirstSettle = useCallback(() => {
    setSettlingAfterLoad(false);
    const start = settleStartRef.current;
    if (start !== null) {
      settleStartRef.current = null;
      const ms = Date.now() - start;
      const tugSessionId = codeSessionStore.getSnapshot().tugSessionId;
      const summary = { tug_session_id: tugSessionId, ms };
      logSessionLifecycle("perf.transcript_settle", summary);
      tugDevLogStore.info("perf", "transcript_settle", summary);
    }
  }, [codeSessionStore]);
  const batchLoading = loadActive || settlingAfterLoad;

  // Suspend per-card state persistence for the WHOLE load — the replay
  // window (`isReplaying`, before the list even mounts) through the
  // post-reveal settle (`batchLoading`). The card's debounced [A9] save
  // fires as scroll / region-scroll / content churn, and
  // `flushDirtyCardStates` would `fetch` per dirty card on the same thread
  // the load needs — pure waste, since the position is being restored, not
  // authored. Spanning from `isReplaying` matters: a save SCHEDULED during
  // the replay window would otherwise fire its flush ungated after the gate
  // (held only across the settle) released. The dirty state persists on the
  // next ungated `setCardState` or the will-phase sync flush.
  const deck = useDeckManager();
  const cardSaveGateActive = isReplaying || batchLoading;
  useLayoutEffect(() => {
    if (!cardSaveGateActive) return;
    const resume = deck.suspendCardStateSaves?.();
    return resume;
  }, [cardSaveGateActive, deck]);

  // Perf instrumentation — pure observability, no behavior. On the
  // commit where the [DT10] replay gate drops (`isReplaying` flips
  // false), this layout effect runs synchronously post-commit: the
  // wall-clock delta from the store's replay-window start IS the
  // "Open → transcript committed" number, and the parse-counter
  // delta across the window is the `perf.row_parse` replay leg. The
  // effect reads the store's dev accessor imperatively (effects may
  // read stores directly; [L02] governs render-path reads) and emits
  // to the session-lifecycle grep stream + the dev-panel log.
  const wasReplayingRef = useRef(false);
  const parseBaselineRef = useRef<RowParseCountersSnapshot | null>(null);
  useLayoutEffect(() => {
    const was = wasReplayingRef.current;
    wasReplayingRef.current = isReplaying;
    if (!was && isReplaying) {
      parseBaselineRef.current = snapshotRowParseCounters();
      return;
    }
    if (was && !isReplaying) {
      const lastReplay = codeSessionStore._getPerfForDevPanel().lastReplay;
      const tugSessionId = codeSessionStore.getSnapshot().tugSessionId;
      const renderSummary = {
        tug_session_id: tugSessionId,
        ms: lastReplay !== null ? Date.now() - lastReplay.startedAtMs : -1,
        rows: dataSource.numberOfItems(),
      };
      logSessionLifecycle("perf.replay_render", renderSummary);
      tugDevLogStore.info("perf", "replay_render", renderSummary);
      const base = parseBaselineRef.current;
      parseBaselineRef.current = null;
      const now = snapshotRowParseCounters();
      const parseSummary = {
        tug_session_id: tugSessionId,
        parses: now.parses - (base?.parses ?? 0),
        cacheHits: now.cacheHits - (base?.cacheHits ?? 0),
        memoHits: now.memoHits - (base?.memoHits ?? 0),
        maxParsesPerIdentity: now.maxParsesPerIdentity,
      };
      logSessionLifecycle("perf.row_parse", parseSummary);
      tugDevLogStore.info("perf", "row_parse", parseSummary);
    }
  }, [isReplaying, codeSessionStore, dataSource]);

  // One renderer per kind ([L26] — renderer reference is the third
  // identity input React reconciles against; distinct lambdas count
  // as distinct component types). With the data source unified to a
  // single `"assistant"` kind for assistant rows (no separate
  // `"code-streaming"` / `"code-committed"`), this map structurally
  // cannot hold two entries for the same row — eliminating the
  // lambda-identity trap that would otherwise re-mount the cell
  // wrapper at `turn_complete` and trigger a user-visible scroll
  // jump. The `useCallback` is what keeps the reference stable
  // across re-renders of this component; rebuilding it inline in the
  // `cellRenderers` literal would defeat L26 just as surely as a
  // second lambda for a second kind would. The `AssistantTurnCell`
  // component branches internally on `row.turn !== undefined` for
  // the chrome differences that genuinely vary by phase (timestamp,
  // copy button, interrupted badge, permission-record vs
  // live-dialog source).
  //
  // **Deps discipline ([Step 20.4.16] Sub-step A).** The four store
  // refs (`codeSessionStore`, `sessionMetadataStore`, `streamingStore`,
  // `renderTurnTrailing`) are all stable for the card's lifetime:
  //   - `codeSessionStore` / `sessionMetadataStore` come from
  //     `useDevCardServices`, scoped to the card mount.
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
  // reads happen INSIDE `AssistantTurnCell` via `useSessionModelName` so the
  // renderer lambda stays inert.
  // Each renderer resolves the typed row descriptor HERE (`rowAt` is
  // memoized per snapshot, so the per-render cost is a binary search)
  // and passes it as a prop. The prop is what makes the cells'
  // `React.memo` gate work: the comparator sees the PREVIOUS render's
  // row data against the new row's — an imperative `rowAt` read
  // inside the cell could never expose that delta to a comparator.
  const assistantRenderer = useCallback<
    TugListViewCellRenderer<DevTranscriptDataSource>
  >(
    (p) => {
      const row = p.dataSource.rowAt(p.index);
      return (
        <AssistantTurnCell
          {...p}
          row={row}
          sessionMetadataStore={sessionMetadataStore}
          codeSessionStore={codeSessionStore}
          streamingStore={streamingStore}
          renderTurnTrailing={renderTurnTrailing}
        />
      );
    },
    [sessionMetadataStore, codeSessionStore, streamingStore, renderTurnTrailing],
  );
  const userRenderer = useCallback<
    TugListViewCellRenderer<DevTranscriptDataSource>
  >(
    (p) => {
      const row = p.dataSource.rowAt(p.index);
      return (
        <UserMessageCell
          {...p}
          row={row}
          renderTurnTrailing={renderTurnTrailing}
          codeSessionStore={codeSessionStore}
        />
      );
    },
    [codeSessionStore, renderTurnTrailing],
  );
  // `codeSessionStore` is stable for the card's lifetime (same as the
  // `assistantRenderer` deps note above), so `ghostRenderer` stays a stable
  // reference — the [L26] discipline the `user` / `code` renderers
  // follow.
  const ghostRenderer = useCallback<
    TugListViewCellRenderer<DevTranscriptDataSource>
  >(
    (p) => {
      const row = p.dataSource.rowAt(p.index);
      return (
        <GhostRowCell
          {...p}
          row={row}
          codeSessionStore={codeSessionStore}
        />
      );
    },
    [codeSessionStore],
  );
  const shellRenderer = useCallback<
    TugListViewCellRenderer<DevTranscriptDataSource>
  >(
    (p) => {
      const row = p.dataSource.rowAt(p.index);
      return (
        <ShellTurnCell
          {...p}
          row={row}
          codeSessionStore={codeSessionStore}
          shellSessionStore={shellSessionStore}
        />
      );
    },
    [codeSessionStore, shellSessionStore],
  );
  const cellRenderers = useMemo<
    Record<string, TugListViewCellRenderer<DevTranscriptDataSource>>
  >(
    () => ({
      "user": userRenderer,
      "assistant": assistantRenderer,
      "ghost": ghostRenderer,
      "shell": shellRenderer,
    }),
    [userRenderer, assistantRenderer, ghostRenderer, shellRenderer],
  );


  // Bind the transcript root for response-settings CSS variable
  // cascade. The store sets inline custom properties (header /
  // content typography + entry margin); descendant rules in
  // `dev-card.css` consume them on entry headers, markdown content,
  // and the inner list view's row gap.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    responseStore.bind(el);
    return () => responseStore.unbind();
  }, [responseStore]);

  // Clickable slash commands ([P03]/[P06]). A click on a `.tugx-md-slashcmd`
  // span — tagged by `enhance-slash-commands` when its inline `<code>`
  // parsed as a *known* command — activates this card and parks the command
  // on the code-session store; the prompt entry seeds it as a ready-to-run
  // draft. Delegated on the transcript root so it covers every rendered
  // markdown block with a single listener. [L03] — the listener must be
  // live before any click it services.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const span = target.closest<HTMLElement>(`.${SLASH_COMMAND_CLASS}`);
      if (span === null) return;
      // Ignore a click that is the tail of a text drag-selection over the
      // span — only a plain, collapsed-selection click seeds the command.
      const selection = window.getSelection();
      if (selection !== null && !selection.isCollapsed) return;
      const name = span.dataset.slashCommand;
      if (name === undefined) return;
      const args = span.dataset.slashArgs ?? "";
      deck.activateCard(cardId);
      codeSessionStore.insertCommandDraft(name, args);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [cardId, codeSessionStore, deck]);

  // Deferred-content hold ([P03] as amended: progressive AFFORDANCE,
  // deferred CONTENT). While the INITIAL resume replay window is open
  // — preflight through the first `replay_complete` — the
  // `TugListView` is not mounted at all: a live list subscriber would
  // force a full windowed-list commit at every fold flush, and that
  // render work runs on the same thread the ingest needs (measured:
  // 255ms → 7.5s ingest on the 12MB motivating session when the list
  // rode along). The `Z0` `DevLoadOverlay` owns the surface during the
  // hold: it shows determinate restore progress and holds the card modal
  // (region inert + scrim) until the reconstructed content reveals once.
  // Once the initial window closes the list mounts ONCE against the
  // fully reconstructed transcript (a single bounded windowed commit)
  // and never unmounts again: `replayEverCompleted` is MONOTONIC in
  // the store, so a later reconnect catch-up window can never
  // re-engage the hold — that case keeps the mounted list and rides
  // the narrowed [DT10] visibility gate instead. The whole decision
  // is store-derived through `useSyncExternalStore` ([L02]); no
  // component state, no effect.
  const listMounted = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(() => {
      const s = codeSessionStore.getSnapshot();
      return s.replayEverCompleted || !deriveColdRestoreActive(s);
    }, [codeSessionStore]),
  );

  // Stamp the reveal moment for the settle timer the first time the list
  // mounts — the next paint shows the transcript, and the heights settle
  // from here until `onFirstSettle`. Ref-in-render lazy capture (idempotent).
  if (listMounted && settleStartRef.current === null) {
    settleStartRef.current = Date.now();
  }

  // Reveal edge: arm `settlingAfterLoad` so `batchLoading` (the scroll-battery
  // freeze AND the card-save gate) spans the post-reveal settle even when the
  // cold-restore `loadActive` signal never engaged (its falling edge is the
  // other arm, for load-previous). Cleared on `onFirstSettle`.
  const prevListMountedRef = useRef(listMounted);
  useLayoutEffect(() => {
    if (listMounted && !prevListMountedRef.current) setSettlingAfterLoad(true);
    prevListMountedRef.current = listMounted;
  }, [listMounted]);

  // Z0 gutter fill. The inner list permanently reserves a scrollbar gutter
  // (`overflow-y: scroll`, dev-card.css), so the
  // Z0 strip's full-bleed background stops one gutter-width short of the card
  // edge — invisible while a scrollbar occupies that gutter, a visible gap when
  // the transcript fits and no scrollbar shows. The strip lives inside the
  // scroll container's clip (it's the list's leading content) and so cannot
  // paint into the gutter, which sits outside the padding box. Measure the
  // overflow + gutter width here and drive a CSS cap on the transcript root —
  // OUTSIDE that clip — that paints the Z0 surface into the empty gutter, but
  // only when there is no scrollbar (see `dev-load-control-bar.css`). The
  // scroll element already rewrites `data-tug-scroll-state` on every
  // content/scroll commit (tug-list-view.tsx); observe that plus its own
  // resize and recompute. [L03] registration; [L06] appearance via a DOM
  // attribute + CSS var, never React state.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null || !listMounted) return;
    const scroll = root.querySelector<HTMLElement>(".tug-list-view");
    if (scroll === null) return;
    let frame: number | null = null;
    const recompute = (): void => {
      frame = null;
      const overflowing = scroll.scrollHeight - scroll.clientHeight > 1;
      const gutter = scroll.offsetWidth - scroll.clientWidth;
      if (overflowing || gutter <= 0) {
        delete root.dataset.z0Fill;
      } else {
        root.style.setProperty("--tugx-z0-gutter", `${gutter}px`);
        root.dataset.z0Fill = "";
      }
    };
    const schedule = (): void => {
      if (frame === null) frame = requestAnimationFrame(recompute);
    };
    recompute();
    const ro = new ResizeObserver(schedule);
    ro.observe(scroll);
    const mo = new MutationObserver(schedule);
    mo.observe(scroll, {
      attributes: true,
      attributeFilter: ["data-tug-scroll-state"],
    });
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      delete root.dataset.z0Fill;
    };
  }, [listMounted]);

  // History-collapse expansion overrides ([P02], Spec S02). ONE
  // instance per card, owned HERE because the host never unmounts
  // under windowed mounting — per-block [A9] keys could not survive a
  // windowed unmount (capture harvests only mounted components), so
  // the host persists the whole sparse override map under a single
  // key and blocks read/write through it via context. Seeded once at
  // mount from the saved value; captured on every [A9] save.
  const savedExpansion = useSavedComponentState<PersistedExpansionState>(
    "tool-block-expansion",
  );
  const [toolBlockExpansion] = useState<ToolBlockExpansionState>(() => {
    const state = new ToolBlockExpansionState();
    state.seed(savedExpansion);
    return state;
  });
  useComponentStatePreservation<PersistedExpansionState | undefined>({
    componentStatePreservationKey: "tool-block-expansion",
    captureState: () => toolBlockExpansion.toPersisted(),
  });

  // Inner `TugListView` handle — the parent reaches `scrollToBottom`
  // through the `DevTranscriptHandle` exposed below.
  const listViewRef = useRef<TugListViewHandle | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom(options?: { animated?: boolean }): void {
        listViewRef.current?.scrollToBottom(options);
      },
      scrollToTop(): void {
        listViewRef.current?.scrollToTop();
      },
      scrollToIndex(
        index: number,
        options?: { block?: ScrollLogicalPosition; animated?: boolean },
      ): void {
        listViewRef.current?.scrollToIndex(index, options);
      },
      pageByEntry(direction: "up" | "down"): void {
        listViewRef.current?.pageByEntry(direction);
      },
    }),
    [],
  );

  // ── Find route: whole-transcript index → search → paint ([P02]/[P03]) ────
  // The row→text index is query-independent: it rebuilds only when the
  // transcript changes (a new `codeSessionStore` snapshot), reading through the
  // shared parse cache so it costs cache hits, not re-parses. The search runs
  // over that finished index on query/options change. Painting resolves DOM
  // Ranges for the mounted matches via the Custom-Highlight painter — all
  // imperative appearance ([L06]), never React state ([L02] only for the
  // session snapshot that drives it).
  const findSnap = useSyncExternalStore(
    findSession.subscribe,
    findSession.getSnapshot,
  );
  const codeSnapshot = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );
  // Expansion changes re-project tool/shell content in and out of the index
  // ([L02]: the expansion state is a subscribable store; its `version` is the
  // snapshot the memo keys on).
  const expansionVersion = useSyncExternalStore(
    toolBlockExpansion.subscribe,
    () => toolBlockExpansion.version,
  );
  const searchIndex = useMemo(
    () => buildTranscriptSearchSegments(dataSource, streamingStore, toolBlockExpansion),
    // `codeSnapshot` changes identity on every transcript mutation;
    // `expansionVersion` bumps on every expand/collapse toggle.
    [dataSource, streamingStore, toolBlockExpansion, codeSnapshot, expansionVersion],
  );
  // The transcript's find ENGINE — the session's delegate: the session owns
  // query/options/wrap semantics; this engine owns the index search, the
  // match set, and the active index.
  // The host consumes the engine's own store ([L02]) to paint and reveal.
  const findEngineRef = useRef<TranscriptFindEngine | null>(null);
  if (findEngineRef.current === null) {
    findEngineRef.current = new TranscriptFindEngine();
  }
  const findEngine = findEngineRef.current;
  useLayoutEffect(() => {
    findSession.setDelegate(findEngine);
    return () => {
      findSession.setDelegate(null);
      findEngine.dispose();
    };
  }, [findSession, findEngine]);
  useEffect(() => {
    findEngine.setIndex(searchIndex);
  }, [findEngine, searchIndex]);
  const engineSnap = useSyncExternalStore(
    findEngine.subscribe,
    findEngine.getSnapshot,
  );

  const findHighlighterRef = useRef<TranscriptFindHighlighter | null>(null);
  if (findHighlighterRef.current === null) {
    findHighlighterRef.current = new TranscriptFindHighlighter();
  }
  // Card-scoped find-target registry: body kinds with internal folds /
  // embedded editors register themselves so navigation can unfold a hidden
  // match and the painter can drive an embedded editor's search ([L07]
  // stable instance; registrations ride [L03] layout effects).
  const findTargetsRef = useRef<FindTargetRegistry | null>(null);
  if (findTargetsRef.current === null) {
    findTargetsRef.current = new FindTargetRegistry();
  }
  const findTargets = findTargetsRef.current;
  useEffect(() => {
    const highlighter = findHighlighterRef.current;
    return () => highlighter?.dispose();
  }, []);

  // The previously-revealed active match, by IDENTITY — `(row, segment,
  // start)` plus the session's monotonic `wrapSeq` — not by index. While a
  // narrowing query keeps the user's match alive, `setMatches` preserves it
  // and the key is unchanged (stay put); the moment the active match becomes
  // a *different* match — typically the refined query's first hit, whose
  // index is still 0 — the key changes and the transcript follows it
  // (scroll-as-you-type). `wrapSeq` in the key re-reveals on a wrap even when
  // the wrap lands back on the same match (a one-match set).
  const findPrevActiveRef = useRef<string | null>(null);
  // Armed when a reveal is issued and cleared when it completes (band-settled
  // + flashed, or handed to CM6). A far jump's target row can mount after the
  // reveal loop's frame budget — the rendered-range-change handler checks
  // this flag and finishes the reveal at mount time.
  const findPendingRevealRef = useRef<boolean>(false);
  useEffect(() => {
    const highlighter = findHighlighterRef.current;
    if (highlighter === null) return;
    const { query, options } = findSnap;
    const { matches, activeIndex } = engineSnap;
    if (matches.length === 0 || query === "") {
      findPrevActiveRef.current = null;
      findPendingRevealRef.current = false;
      highlighter.clear();
      return;
    }
    const getElementForIndex = (index: number): HTMLElement | null =>
      listViewRef.current?.getElementForIndex(index) ?? null;
    const activeMatch = activeIndex >= 0 ? matches[activeIndex] : undefined;
    const activeKey =
      activeMatch !== undefined
        ? `${activeMatch.row}:${activeMatch.segment}:${activeMatch.start}:${findSnap.wrapSeq}`
        : null;
    const activeChanged = activeKey !== findPrevActiveRef.current;
    findPrevActiveRef.current = activeKey;
    const activeRow = activeMatch?.row;
    const input = {
      matches,
      activeIndex,
      query,
      options,
      getElementForIndex,
      findTargets,
      scroller:
        rootRef.current?.querySelector<HTMLElement>(
          '[data-tug-scroll-key="dev-card-transcript"]',
        ) ?? null,
    };
    if (activeChanged && activeRow !== undefined) {
      // Bring the active match on-screen (mounting it), then paint + reveal
      // on the next frame once the row is in the DOM. A match hidden by a
      // body kind's INTERNAL fold (a terminal preview's tail, a folded file
      // body whose editor is unmounted) unfolds through the find-target
      // registry — the unfold commits over the following frames, so the
      // paint retries a bounded handful of times. A far jump can outlive the
      // frame budget entirely (the estimated scroll mounts the target row on
      // a later windowing commit), so the reveal stays ARMED
      // (`findPendingRevealRef`) and the rendered-range-change handler
      // completes it the moment the row mounts.
      //
      // A reveal owns the scroll position: break follow-bottom first, or a
      // streaming turn's next content-growth pin would slam the view back to
      // the live edge out from under the match. Once the user is finding,
      // the find is what the scroller favors; the jump-to-latest affordance
      // remains one click away.
      findPendingRevealRef.current = true;
      listViewRef.current?.disengageFollowBottom("find-reveal");
      listViewRef.current?.scrollToIndex(activeRow, { block: "nearest" });
      const paintAndReveal = (attempt: number): void => {
        if (!findPendingRevealRef.current) return;
        highlighter.paint(input);
        const key = activeMatch?.segmentKey;
        if (activeMatch === undefined) {
          findPendingRevealRef.current = false;
          return;
        }
        if (activeMatch.segmentKind === "editor") {
          // The editor's own search selects + reveals the match
          // (`.cm-searchMatch-selected`); the transcript-level ring and
          // band nudges are DOM-walk affordances and don't apply inside
          // CM6. A folded file body's editor is unmounted — unfold and
          // retry until the delegate appears.
          const mounted =
            key !== undefined &&
            (findTargets.resolve(key)?.codeView?.() ?? null) !== null;
          if (!mounted) {
            if (key !== undefined) findTargets.resolve(key)?.unfold();
            if (attempt < 8) {
              requestAnimationFrame(() => paintAndReveal(attempt + 1));
              return;
            }
          }
          findPendingRevealRef.current = false;
          return;
        }
        if (
          settleFindReveal(
            highlighter,
            rootRef.current,
            listViewRef.current,
            activeMatch.row,
          )
        ) {
          findPendingRevealRef.current = false;
          return;
        }
        // Row not mounted yet — unfold a fold owner (a terminal tail's
        // match) and retry; past the budget the rendered-range-change
        // handler finishes the reveal when the row mounts.
        if (key !== undefined) findTargets.resolve(key)?.unfold();
        if (attempt < 8) {
          requestAnimationFrame(() => paintAndReveal(attempt + 1));
        }
      };
      requestAnimationFrame(() => paintAndReveal(0));
    } else {
      highlighter.paint(input);
    }
  }, [findSnap, engineSnap, findTargets]);

  // Repaint when the list's mounted window turns over (hand-scroll, resize):
  // rows that mount as they enter the viewport get their matches painted, and
  // rows that leave drop cleanly. The count is authoritative from the index and
  // never changes here — only the paint follows the mounted set (Risk R01). No
  // flash for the repaint itself — but when a reveal is still ARMED (a far
  // jump whose target row outlived the reveal loop's frame budget), this is
  // the moment the row exists: finish the reveal here (band nudge + flash).
  const handleFindRenderedRangeChange = useCallback((): void => {
    const highlighter = findHighlighterRef.current;
    if (highlighter === null) return;
    const { query, options } = findSession.getSnapshot();
    const { matches, activeIndex } = findEngine.getSnapshot();
    if (matches.length === 0 || query === "") {
      highlighter.clear();
      return;
    }
    highlighter.paint({
      matches,
      activeIndex,
      query,
      options,
      getElementForIndex: (index) =>
        listViewRef.current?.getElementForIndex(index) ?? null,
      findTargets: findTargetsRef.current,
      scroller:
        rootRef.current?.querySelector<HTMLElement>(
          '[data-tug-scroll-key="dev-card-transcript"]',
        ) ?? null,
    });
    if (findPendingRevealRef.current) {
      const active = activeIndex >= 0 ? matches[activeIndex] : undefined;
      if (active !== undefined && active.segmentKind === "dom") {
        if (
          settleFindReveal(
            highlighter,
            rootRef.current,
            listViewRef.current,
            active.row,
          )
        ) {
          findPendingRevealRef.current = false;
        }
      } else {
        findPendingRevealRef.current = false;
      }
    }
  }, [findSession, findEngine]);

  // Floating "scroll to latest" button. It is always mounted ([L26]);
  // its visibility is appearance state ([L06]) — `handleFollowBottom
  // Change` writes a `data-visible` attribute straight onto the button
  // DOM node as the list view's SmartScroll engages / disengages
  // follow-bottom. The follow-bottom intent never enters React state.
  const jumpButtonRef = useRef<HTMLButtonElement | null>(null);
  // The permanent Z0 strip ([P09]). It derives its own mode + modality from
  // the store and is always present, so the host no longer feeds it scroll
  // edges to summon/dismiss it. `regionEl` (the transcript scroll region) is
  // the strip's inert + scrim target when modal — held as state so the strip
  // gets a stable element once it mounts.
  const [regionEl, setRegionEl] = useState<HTMLDivElement | null>(null);
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
    // [DT10] paint gate: every row renders inline at its real height,
    // so the single-reveal gate applies for the whole replay window
    // (avoiding accumulation FOUC), with the `Z0` `DevLoadOverlay`
    // carrying restore progress (modal) over the region until reveal.
    <div
      ref={rootRef}
      className="dev-card-transcript"
      data-slot="dev-card-transcript"
      data-testid="dev-card-transcript"
      data-replaying={(isReplaying && !loadingPrevious) || undefined}
    >
      {listMounted ? (
        // The transcript region: the load overlay's inert + scrim target
        // when modal. The overlay is an absolute sibling layered *over* it.
        <div className="tug-control-bar-region" ref={setRegionEl}>
          <ToolBlockExpansionContext.Provider value={toolBlockExpansion}>
            <FindTargetRegistryContext.Provider value={findTargets}>
            <TugListView
              ref={listViewRef}
              dataSource={dataSource}
              cellRenderers={cellRenderers}
              scrollKey="dev-card-transcript"
              followBottom
              onRenderedRangeChange={handleFindRenderedRangeChange}
              // Z0 ([D97]) is the list's permanent leading row — it scrolls
              // with the content (off-screen when scrolled down, first at the
              // top) and stays topmost as older turns prepend below it.
              leadingContent={
                <DevTranscriptTopRow
                  codeSessionStore={codeSessionStore}
                  cardId={cardId}
                />
              }
              // Freeze the per-commit scroll battery across the restore
              // replay, each load-previous bracket, and the post-reveal
              // height settle ([L04] via `onFirstSettle`) — the heavy
              // forced-layout reads stand down while loading, then place
              // the bottom + serialize the anchor once on the settled edge.
              batchLoading={batchLoading}
              onFirstSettle={handleFirstSettle}
              onFollowBottomChange={handleFollowBottomChange}
              // Inline render: every row is mounted at its real,
              // measured height — no windowing, no spacers, no cheap
              // tier. The scroll height is the true sum of row heights,
              // so the scrollbar never shifts and a thumb-drag never
              // lands on an unmounted or unpainted row.
              inline
              pageByEntry
              // The transcript is a read-only stream surface: its rows are
              // prose and tool blocks, not pickable list items. Without this,
              // the un-authored default makes every row wrapper (and the
              // scroll container) a native focus target, so any click on
              // transcript content moves DOM focus onto the row and steals
              // the caret from the prompt entry — including the activation
              // click that brings a background dev card forward.
              interactive={false}
            />
            </FindTargetRegistryContext.Provider>
          </ToolBlockExpansionContext.Provider>
          <DevJumpToBottomButton
            ref={jumpButtonRef}
            onClick={handleJumpToBottom}
          />
        </div>
      ) : null}
      {/* Z0 load overlay ([D97]/[P09]): the determinate restore /
          load-previous progress + modal scrim. An absolute overlay over the
          transcript area (last sibling, so it layers on top), shown only
          while loading — it never shifts the content and works during a cold
          restore, before the list above is mounted. */}
      <DevLoadOverlay codeSessionStore={codeSessionStore} regionEl={regionEl} />
    </div>
  );
});
