/**
 * `RefsResultBlock` — the body of a `refs`-origin transcript turn ([P03]).
 *
 * Chrome only. A `/match` or `/search` run produces a numbered list of file
 * references, and the deck already has two body kinds that render exactly
 * that shape — `PathListBlock` for filenames, `SearchResultBlock` for
 * matched lines. This block composes one of them `embedded` under the shared
 * `BlockChrome` ([P08]) rather than growing a third list renderer: the
 * command in the header, the running count beside it, a Cancel while the run
 * is in flight, Share + Copy once it settles, and the body kind below.
 *
 * Streaming is the ordinary case, not a special one. The run's whole state
 * arrives on every frame, so this component is a pure function of the
 * message; the row it lives in keeps its mount identity across every batch
 * ([L26]), which is what lets the body kind's collapse set and sort mode
 * survive a growing list instead of resetting on each one.
 *
 * Refs are non-context ink ([P03]/[D111]) — Claude never sees this block.
 * Share is the single bridge, staging the run onto the pending-context queue
 * exactly as a shell row's Add-to-context does.
 *
 * Laws:
 *  - [L06] the in-flight signal is the chrome's `phase` — a CSS-driven
 *    lifecycle dot, not React state.
 *  - [L11] this block owns no responder. Cancel and Share are self-contained
 *    controls; the body kind's rows are annotations the transcript's
 *    delegated layer services.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="refs-result-block"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns `--tugx-refs-*` and
 *    cascade-tunes the body kinds' own tokens for this instance rather than
 *    reaching into them.
 *
 * @module components/tugways/cards/refs-result-block
 */

import type React from "react";
import {
  Check as checkIconNode,
  CloudUpload as addToContextIconNode,
  CircleStop as cancelIconNode,
} from "lucide";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import {
  TugSpriteIcon,
  type LucideIconNode,
} from "@/components/tugways/tug-sprite-icon";
import type { ToolCallPhase } from "@/lib/code-session-store/tool-call-phase-visual";
import type { RefsResultMessage } from "@/lib/code-session-store/types";
import { BlockChrome } from "../blocks/block-chrome";
import type { BlockNotice } from "../blocks/block-notice";
import { PathListBlock } from "../body-kinds/path-list-block";
import { SearchResultBlock } from "../body-kinds/search-result-block";
import {
  composeRefsCopyText,
  refsToPathListData,
  refsToSearchResultData,
} from "./refs-result-view";
import "./refs-result-block.css";

export interface RefsResultBlockProps {
  /** The run's whole current state — mint, every batch, and settle alike. */
  message: RefsResultMessage;
  /** Share toggle ([P03]) — omitted where there is no pending-context queue. */
  onToggleContext?: () => void;
  /** Whether this run is currently staged for the next submission. */
  staged?: boolean;
  /** Stop an in-flight run; the block settles with what it found. */
  onCancel?: () => void;
  /**
   * Opt-in key for the [A9] Component State Preservation Protocol, forwarded
   * to the body kind so its collapse set / sort mode survive a reload.
   */
  componentStatePreservationKey?: string;
}

/** Icon-only Share toggle — stage this run's refs to ride the next `❯`
 *  submission as attributed context, or un-stage them. The same glyph the
 *  shell row's Add-to-context wears, because it is the same gesture ([P03]). */
function RefsShareButton({
  staged,
  onToggle,
}: {
  staged: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <TugPushButton
      data-slot="refs-result-add-context"
      aria-pressed={staged}
      icon={
        <TugSpriteIcon
          name={staged ? "check" : "cloud-upload"}
          node={(staged ? checkIconNode : addToContextIconNode) as LucideIconNode}
        />
      }
      subtype="icon"
      emphasis="ghost"
      size="xs"
      aria-label={
        staged
          ? "Remove these refs from the next submission's context"
          : "Add these refs to the next submission's context"
      }
      title={staged ? "Staged for the next submission" : "Add to context"}
      onClick={onToggle}
    />
  );
}

/** Icon-only Cancel — visible only while the run is in flight. */
function RefsCancelButton({
  onCancel,
}: {
  onCancel: () => void;
}): React.ReactElement {
  return (
    <TugPushButton
      data-slot="refs-result-cancel"
      icon={<TugSpriteIcon name="circle-stop" node={cancelIconNode as LucideIconNode} />}
      subtype="icon"
      emphasis="ghost"
      size="xs"
      aria-label="Stop this search"
      title="Stop"
      onClick={onCancel}
    />
  );
}

export function RefsResultBlock({
  message,
  onToggleContext,
  staged = false,
  onCancel,
  componentStatePreservationKey,
}: RefsResultBlockProps): React.ReactElement {
  const inFlight = message.inFlight;

  // The command sits in the header (parity with the shell row): mono, the
  // line as the user typed it. `data-tugx-findable` opts it into transcript
  // Find — it rides the header, so it stays searchable while the block is
  // collapsed.
  const command = (
    <code
      className="refs-result-command tool-call-header-clamp"
      data-tugx-findable=""
    >
      <span className="refs-result-command-text">{message.command}</span>
    </code>
  );

  const cancelButton =
    inFlight && onCancel !== undefined ? (
      <RefsCancelButton onCancel={onCancel} />
    ) : null;
  // Share is a settled-run gesture ([P03]) — a list still growing would go
  // into context as whatever fraction had arrived when the user clicked.
  const shareButton =
    !inFlight && onToggleContext !== undefined ? (
      <RefsShareButton staged={staged} onToggle={onToggleContext} />
    ) : null;
  const headerActions =
    cancelButton !== null || shareButton !== null ? (
      <>
        {cancelButton}
        {shareButton}
      </>
    ) : null;

  // Lifecycle: pulse while running, then complete / interrupted.
  const phase: ToolCallPhase = inFlight
    ? "in_flight"
    : message.cancelled
      ? "interrupted"
      : "success";

  // A notice is the run explaining why it found what it found — an
  // unparseable pattern, a walk cap reached — not a failure of the block.
  const notice: BlockNotice | undefined =
    message.notice === null ? undefined : { tone: "info", text: message.notice };

  const body =
    message.opKind === "match" ? (
      <PathListBlock
        data={refsToPathListData(message.root, message.refs)}
        embedded
        findable
        // A refs list is numbered by position ([P12]): `/ref 5` is the fifth
        // row, so alphabetizing it would make the number on screen a lie.
        sortable={false}
        className="refs-result-list"
        componentStatePreservationKey={componentStatePreservationKey}
      />
    ) : (
      <SearchResultBlock
        data={refsToSearchResultData(message.root, message.refs)}
        embedded
        openable
        findable
        className="refs-result-list"
        componentStatePreservationKey={componentStatePreservationKey}
      />
    );

  return (
    <BlockChrome
      rootSlot="refs-result-block"
      toolName=""
      command={command}
      phase={phase}
      status={inFlight ? "streaming" : "ready"}
      // The running count — what has arrived so far while streaming, the
      // final total once settled. Same readout in both collapse states.
      resultSummary={{
        kind: "count",
        count: message.refs.length,
        noun: "ref",
        pluralNoun: "refs",
      }}
      notice={notice}
      headerActions={headerActions}
      copyText={() => composeRefsCopyText(message)}
      className="refs-result-chrome"
    >
      {body}
    </BlockChrome>
  );
}
