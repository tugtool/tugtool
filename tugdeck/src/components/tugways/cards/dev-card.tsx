/**
 * dev-card.tsx — Dev card (Unified Command Surface).
 *
 * The card body is a plain **flex column** ([L06]/[L13] — no JS sizing).
 * The transcript region (`DevTranscriptHost` + Z2 status bar) flexes into
 * all remaining height (never below `--dev-transcript-min`); the prompt-entry
 * region below is **content-sized** and pinned to the card bottom. Its text
 * area opens at `--tug-text-editor-min-height` and grows with content up to
 * `--dev-entry-max-height` (a fraction of the card height), then scrolls — so
 * the Z4/Z5 toolbar is never pushed off the card. A stray submit collapses
 * the entry back toward the opening height because the cleared editor
 * shrinks. There is no split pane, no sash, and no content-sizing JS — this
 * replaced an earlier `TugSplitPane` + `useContentDrivenPanelSize` machine.
 * The card wires:
 *
 *   • A live `CodeSessionStore` bound to the supervisor-issued
 *     `tugSessionId` via the card-session binding store.
 *   • Live `@` file completion via `FileTreeStore` against the real
 *     connection-singleton. When no live connection is available (tests,
 *     first paint before `getConnection()` resolves), the `@` provider
 *     falls back to an empty stable closure so the engine's typeahead
 *     trigger stays wired regardless of timing.
 *   • Live `/` slash-command completion via a per-card `SessionMetadataStore`,
 *     wrapped in a position-0 gate so `/` mid-text produces an empty popup.
 *   • A shared `PromptHistoryStore` singleton for arrow-up/down recall.
 *   • A per-card `EditorSettingsStore` whose CSS variables cascade from
 *     the entry-pane TugBox down to the input editor. The store reads
 *     the global tugbank domain edited by the Settings card's Dev Card
 *     tab and tracks it live via `onDomainChanged`.
 *
 * The entry is mounted inside a `TugBox` with `inset={false}` so it
 * fills the entry region edge-to-edge.
 */

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import { TugPromptEntry, type TugPromptEntryDelegate } from "../tug-prompt-entry";
import { DevTranscriptHost, type DevTranscriptHandle } from "./dev-card-transcript";
import { useDevPlacementSlots } from "./dev-card-placement-experiment";
import type { DevTelemetryStatusRowHandle } from "./dev-card-telemetry-renderers";
import { DevRouteIndicatorBadge } from "../chrome/dev-route-indicator-badge";
import { DevSessionIdBadge } from "../chrome/dev-session-id-badge";
import { PermissionModeChip, usePermissionSheet } from "./permission-mode-chip";
import { ModelChip } from "./model-chip";
import { useModelPicker } from "./model-picker-sheet";
import { useRewindSheet } from "./rewind-sheet";
import { useDiffSheet } from "./diff-sheet";
import { useSkillsSheet } from "./skills-sheet";
import { useAgentsSheet } from "./agents-sheet";
import { useMemorySheet } from "./memory-sheet";
import { useHooksSheet } from "./hooks-sheet";
import { useHelpSheet } from "./help-sheet";
import { useRenameSessionSheet } from "./rename-session-sheet";
import { useResumeSheet } from "./resume-sheet";
import { EffortChip } from "./effort-chip";
import { useEffortPicker } from "./effort-picker-sheet";
import { useEffort } from "@/lib/use-effort";
import { useRoute } from "@/lib/route-lifecycle";
import { usePermissionRulesSheet } from "./permission-rules-editor";
import { useDevCardServices } from "./use-dev-card-services";
import { type LocalCommandName } from "@/lib/slash-commands";
import type { ArgumentHintResolver } from "@/components/tugways/tug-text-editor/argument-hint-extension";
import type { InlineCommandMatcher } from "@/lib/inline-command-ghost";
import type { PastedCommandResolver } from "@/components/tugways/tug-text-editor/clipboard-filters";
import { usePermissionMode } from "@/lib/use-permission-mode";
import { isPermissionMode } from "@/lib/permission-mode";
import { openPathInOS } from "@/lib/os-open";
import { TugPaneBanner } from "../tug-pane-banner";
import { group } from "../tug-animator";
import { TugBox } from "../tug-box";
import { TugFileChooser } from "../tug-file-chooser";
import { TugPushButton } from "../tug-push-button";
import { AlertTriangle, Trash2 } from "lucide-react";

import { DevPulseStrip } from "./dev-pulse-strip";
import { usePulseEnabled } from "@/lib/pulse-store";
import { TugLabel } from "../tug-label";
import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "../tug-confirm-popover";
import {
  TugListView,
  type TugListViewDelegate,
} from "../tug-list-view";
import { useTugSheet } from "../tug-sheet";
import { presentAlertSheet } from "../tug-alert-sheet";
import { useResponderChain } from "../responder-chain-provider";
import { useResponderForm } from "../use-responder-form";
import { useResponder } from "../use-responder";
import { useCopyableButton } from "../use-copyable-text";
import { useFocusManager } from "../use-focusable";
import { useCycleMode } from "../use-cycle-mode";
import { rowGridOrder, type SpatialOrder } from "../spatial-order";
import { useSpatialOrder } from "../use-spatial-order";
import type { ActionEvent } from "../responder-chain";
import { useCardDelegate, useCardLifecycle } from "@/lib/card-lifecycle";
import { deckTrace } from "@/deck-trace";
import { useSheetDelegate } from "@/lib/sheet-lifecycle";
import { useBannerDelegate } from "@/lib/banner-lifecycle";
import { TUG_ACTIONS } from "../action-vocabulary";
import type { CodeSessionSnapshot, CodeSessionStore } from "@/lib/code-session-store";
import type { GitDiffStore } from "@/lib/git-diff-store";
import type { SkillsInventoryStore } from "@/lib/skills-inventory-store";
import type { HooksInventoryStore } from "@/lib/hooks-inventory-store";
import { deriveDevCardBannerSpec } from "./dev-card-banner-spec";
import { TransientNoticeController } from "./transient-notice-controller";
import { deriveColdRestoreActive } from "./dev-card-restore-gate";
import { REPLAY_SOFT_BUDGET_MS } from "@/lib/code-session-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import type { EditorSettingsStore } from "@/lib/editor-settings-store";
import type { ResponseSettingsStore } from "@/lib/response-settings-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getConnection } from "@/lib/connection-singleton";
import type { CompletionProvider } from "@/lib/tug-text-types";
import {
  cardSessionBindingStore,
  type CardSessionMode,
} from "@/lib/card-session-binding-store";
import {
  sendCloseSessionKeepingBinding,
  sendSpawnSession,
} from "@/lib/session-lifecycle";
import { exportSession, isExportAvailable } from "@/lib/os-export";
import {
  exportBaseName,
  transcriptToJsonl,
  transcriptToMarkdown,
} from "@/lib/transcript-export";
import { isPathPickerAvailable, pickPath } from "@/lib/native-path-picker";
import { TugProgressIndicator } from "../tug-progress-indicator";
import {
  devRestoreRegistry,
  cancelDevRestore,
  fireRestore,
  getRestoreStartedAt,
  clearRestoreStartedAt,
  restorePassGate,
  type ResumeDisplayMetadata,
} from "@/lib/dev-session-restore";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { pickerNoticeStore, type PickerNotice } from "@/lib/picker-notice-store";
import {
  useSpawnError,
  spawnErrorMessage,
  devSpawnErrorStore,
  type SpawnError,
} from "@/lib/dev-spawn-error-store";
import { cardServicesStore, type CardServices } from "@/lib/card-services-store";
import { cardTitleStore } from "@/lib/card-title-store";
import { useDevCardObserver } from "./use-dev-card-observer";
import { useMenuStatePublication } from "./use-menu-state-publication";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import { putDevRecentProjects } from "@/settings-api";
import {
  useSessionLedger,
  getDevSessionLedgerStore,
} from "@/lib/dev-session-ledger-store";
import type { SessionRow } from "@/protocol";
import type { TaggedValue } from "@/lib/tugbank-client";
import {
  TugPaneBulletinProvider,
  useTugPaneBulletin,
  type TugPaneBulletinApi,
} from "../tug-pane-bulletin";
import { assistantProseFromMessages, lastAssistantCopyText } from "./turn-entry-markdown";
import { buildSummarizationPrompt } from "@/lib/compaction-request";
import { pendingCompactionStore } from "@/lib/pending-compaction-store";
import { compactionProgressStore } from "@/lib/compaction-progress-store";
import { CompactionProgressSheet } from "./compaction-progress-sheet";
import {
  useDevRecentsDataSource,
  useDevSessionsDataSource,
} from "@/lib/dev-picker-data-source";
import {
  PickerCellProvider,
  RECENTS_CELL_RENDERERS,
  SESSIONS_CELL_RENDERERS,
  type PickerSelection,
} from "./dev-picker-cells";
import "./dev-card.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The picker sheet's exit animation duration, in milliseconds. Used
 * by the Open / Retry paths in `DevProjectPicker` to defer the
 * binding-mutating wire frame until after the sheet has finished
 * animating out, so the resulting card-body flip doesn't unmount the
 * picker mid-animation.
 *
 * Mirrors `--tug-motion-duration-moderate` (~200ms) plus a small
 * buffer so we wait for the animation to fully settle before the
 * binding update lands.
 */
const SHEET_EXIT_ANIMATION_MS = 220;

/**
 * Backstop for `/compact`'s respawn phase: the summarization finished but
 * the fresh session must still spawn, bind, and seed. That handshake is
 * normally milliseconds; if it never lands, fail the run after this long so
 * the progress sheet can't hang (the phase has no Cancel).
 */
const COMPACTION_RESPAWN_TIMEOUT_MS = 15_000;

/**
 * Placeholder copy for the prompt entry, keyed by the active route
 * value (`❯` Code / `$` Shell — see `ROUTE_ITEMS` in
 * `tug-prompt-entry.tsx`). Forwarded as `placeholderByRoute`; the
 * entry shows the match for the active route and falls back to no
 * placeholder for any unlisted route. Dev-specific — the gallery
 * prompt-entry passes nothing.
 */
const DEV_PROMPT_PLACEHOLDER_BY_ROUTE: Readonly<Record<string, string>> = {
  "❯": "Ask Claude to build, fix, or explain",
  "$": "Run a shell command",
};

/** Shell route value — mirrors `ROUTE_ITEMS` in `tug-prompt-entry.tsx`. */
const ROUTE_SHELL = "$";

/**
 * Focus group the dev card authors its keyboard-focus-cycling stops
 * into ([P02]/[P10]). One group per card mode — the per-card
 * `CycleScope` keys each card's stops into its own focus mode, so a
 * constant group string is safe across mounts. The lowest order (the
 * route) is what `focusFirstInMode` seeds on entry.
 */
const DEV_CYCLE_GROUP = "dev-prompt-cycle";
// Cycle order ([P10], revised): the cycle reads the card bottom toolbar
// left→right, then up to the status cells and the PULSE strip, then into the
// editor and its compose-phase attachment tiles, and **seeds at the route**
// (order 0). Forward Tab: route → Claude Code → Session → Project → Mode →
// Model → Effort → submit → STATE → TIME → TOKENS → CONTEXT → TASKS → JOBS →
// PULSE → editor → attachment-1 … attachment-N → wrap; Shift+Tab reverses.
// Every Z4B chip (the route indicator, Session / Project badges, and the
// Mode / Model / Effort pickers), the six Z2 status cells, and the PULSE
// label are independent leaf stops (no arrow-roving); the editor is a text
// stop (Return resumes typing); each Z4C attachment tile is a leaf stop
// (Return / Space opens its preview). PULSE exists only while the strip is
// shown (status bar present AND the `pulse/enabled` default on); attachment
// stops exist only while the editor holds image atoms — when neither is
// present the walk runs … JOBS → editor → wrap. A disabled stop (the empty
// submit, or the chips on the Shell route) drops out of the walk via the
// engine's interactivity filter, so the seed lands on the next live stop.
const DEV_CYCLE_ORDER_ROUTE = 0;
const DEV_CYCLE_ORDER_CLAUDE_CODE = 1;
const DEV_CYCLE_ORDER_SESSION = 2;
const DEV_CYCLE_ORDER_PROJECT = 3;
const DEV_CYCLE_ORDER_MODE = 4;
const DEV_CYCLE_ORDER_MODEL = 5;
const DEV_CYCLE_ORDER_EFFORT = 6;
const DEV_CYCLE_ORDER_SUBMIT = 7;
// The Z2 status cells are six independent leaf stops ([P10] revised —
// no arrow-roving): STATE / TIME / TOKENS / CONTEXT / TASKS / JOBS take
// orders 8…13 (base + 0…5). The PULSE label follows at 14 (its own one-node
// grid row beneath the status cells); the editor (the text body) at 15; and
// the Z4C compose-phase attachment tiles — one leaf stop each — the orders
// from 16 upward (base + tile index), so they Tab right after the editor.
const DEV_CYCLE_ORDER_STATUS_BASE = 8;
const DEV_CYCLE_ORDER_PULSE = 14;
const DEV_CYCLE_ORDER_EDITOR = 15;
const DEV_CYCLE_ORDER_ATTACHMENT_BASE = 16;

// What committing a Z4B settings picker (effort / model / permission mode) opened
// from a cycle stop does to the cycle ([P15]). Both behaviors are first-class
// framework features (see `TugSheet`'s `onCommitDisposition` and the engine's
// `relinquishFocusMode`); this is the dev card's chosen value — flip it to feel
// each:
//   "relinquish" — commit exits focus-cycling; the caret returns to the prompt.
//   "retain"     — commit keeps cycling; the ring returns to the originating chip.
const DEV_CYCLE_PICKER_COMMIT_DISPOSITION: "retain" | "relinquish" = "retain";

/** Max characters the Z4B Project chip shows before it falls back to the
 *  leaf directory name. */
const PROJECT_CHIP_MAX_CHARS = 16;

/**
 * Display text for the Z4B Project chip. If the whole path fits within
 * {@link PROJECT_CHIP_MAX_CHARS}, it is shown verbatim. Otherwise the chip
 * shows just the leaf directory name; a leaf that is itself too long is
 * mid-truncated with an ellipsis. The full path always travels in the chip's
 * `title` (tooltip) when the shown text differs from it.
 */
function formatProjectChipText(dir: string): string {
  if (dir.length <= PROJECT_CHIP_MAX_CHARS) return dir;
  const leaf = dir.replace(/\/+$/, "").split("/").pop() ?? dir;
  if (leaf.length <= PROJECT_CHIP_MAX_CHARS) return leaf;
  // Mid-truncate the leaf, reserving one char for the ellipsis.
  const keep = PROJECT_CHIP_MAX_CHARS - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${leaf.slice(0, head)}…${leaf.slice(leaf.length - tail)}`;
}

/**
 * Reads the active route from `RouteLifecycle` and yields whether it is the
 * Shell route to a render callback. Mounted inside the prompt entry's
 * indicator slot (where the provider is in scope), so the Z4B chips can pick
 * up each component's own `disabled` feature on the Shell route — the
 * Session / Mode / Model / Effort chips drive a Claude Code session, which
 * Shell has none of. The route indicator and Project chips apply to both
 * routes and stay live.
 */
function DevRouteShellGate({
  children,
}: {
  children: (isShell: boolean) => React.ReactNode;
}): React.ReactElement {
  return <>{children(useRoute() === ROUTE_SHELL)}</>;
}


/**
 * Human-readable labels for the `lastError` causes the card surfaces as
 * an inline banner above the entry. `resume_failed` is intentionally
 * absent — that cause is intercepted by `useDevCardObserver`, which
 * clears the binding and routes the notice through the picker-sheet
 * instead.
 */
type BannerErrorCause = Exclude<
  NonNullable<CodeSessionSnapshot["lastError"]>["cause"],
  "resume_failed"
>;
const CAUSE_LABELS: Record<BannerErrorCause, string> = {
  session_state_errored: "Session errored",
  transport_closed: "Connection lost",
  wire_error: "Protocol error",
  session_unknown: "Session unknown",
  session_not_owned: "Session not owned",
  attachment_rejected: "Attachment rejected",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DevCardContentProps {
  /**
   * Card instance id. Forwarded from the card registry's `contentFactory`
   * callback and used for per-card workspace binding (via
   * `useCardWorkspaceKey`) plus the responder scope id of the embedded
   * `TugPromptEntry`.
   */
  cardId: string;
  /**
   * Z0 — top-of-card content slot. A content-sized row at the very top
   * of the top split-panel, above the transcript. When `undefined`
   * (the default) the row collapses to zero height — the slot exists
   * in the contract but costs nothing visually until content arrives.
   * Reserved for future card-level metadata (session name, model
   * badge, pinned status, etc.).
   */
  headerContent?: React.ReactNode;
  /**
   * Z2 — status-bar content slot. A content-sized row at the BOTTOM of
   * the top split-panel, OUTSIDE the scrolling transcript list view.
   * Collapses to zero height when `undefined`. Layout shift on
   * telemetry update is contained (the row grows into space the
   * transcript ceded; no scroll repositioning). Per [D100] this slot
   * houses `DevTelemetryStatusRow`, which carries a `TASKS` cell
   * (TugProgressIndicator ring + `N/M`) and an associated popover —
   * superseding the prior Z2A/Z2B split.
   */
  statusBarContent?: React.ReactNode;
  /**
   * Z1 — per-turn trailing slot. Invoked once per row half, keyed by
   * `half`. The user half wires next to the user-row trailing copy
   * button (currently empty by default); the assistant half wires
   * next to the assistant-row's copy button.
   */
  renderTurnTrailing?: DevTurnTrailingRenderer;
  /**
   * Z4 — prompt-entry footer slot. Renders inside the prompt-entry
   * toolbar between the route choice group and the submit button.
   * When `undefined` the toolbar collapses to its pre-Z4 layout.
   */
  footerContent?: React.ReactNode;
}

/**
 * Signature of the Z1 per-turn trailing slot renderer. Receives a
 * minimal projection (turn key, half, optional `TurnEntry` for
 * committed rows) so renderers can subscribe to the right per-turn
 * data without leaking the transcript's data-source contract.
 */
export type DevTurnTrailingRenderer = (
  context: DevTurnTrailingContext,
) => React.ReactNode;

/**
 * Context passed to the Z1 per-turn trailing slot renderer. The same
 * renderer is invoked for both halves of each turn; consumers branch
 * on `half` to vary content. `turn` is `undefined` for in-flight rows
 * (no `TurnEntry` exists yet) and for the live user row.
 */
export interface DevTurnTrailingContext {
  /** Stable per-turn key — matches `row.turnKey` in the data source. */
  turnKey: string;
  /** Which half of the turn is asking for trailing content. */
  half: "user" | "assistant";
  /** Committed turn entry, when present (assistant half post-commit). */
  turn?: import("@/lib/code-session-store").TurnEntry;
}


// ---------------------------------------------------------------------------
// DevCardServices
// ---------------------------------------------------------------------------

/**
 * Per-card services consumed by `DevCardContent`. Constructed once a
 * binding for this card appears in `cardSessionBindingStore`, torn
 * down when the binding clears or the card unmounts. The consuming hook
 * `useDevCardServices` lives in `./use-dev-card-services`; it returns
 * `null` while the card is unbound — the caller renders the
 * project-picker in that state.
 */
export interface DevCardServices {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  historyStore: PromptHistoryStore;
  completionProviders: Record<string, CompletionProvider>;
  /**
   * Resolves an accepted command atom's value to its argument placeholder
   * (`/devise ┆ type arguments…`), reading the live command catalog + local
   * registry. Forwarded to `TugPromptEntry`.
   */
  argumentHintResolver: ArgumentHintResolver;
  /**
   * Maps a mid-text `/query` to the full command name it completes to (the
   * inline ghost suffix), or `null`. Forwarded to `TugPromptEntry`.
   */
  inlineCommandMatcher: InlineCommandMatcher;
  /**
   * Recognizes a slash command at the start of pasted text and returns the atom
   * to chip it as (full name or unqualified leaf), or `null`. Forwarded to
   * `TugPromptEntry`.
   */
  pastedCommandResolver: PastedCommandResolver;
  editorStore: EditorSettingsStore;
  responseStore: ResponseSettingsStore;
  /** Single-shot `/diff` request/response store ([#step-10b]). */
  gitDiffStore: GitDiffStore;
  /** Single-shot `/skills` request/response store ([#step-12d]). */
  skillsInventoryStore: SkillsInventoryStore;
  /** Single-shot `/hooks` request/response store ([#step-12c]). */
  hooksInventoryStore: HooksInventoryStore;
  /**
   * Delegate handle for the embedded `TugPromptEntry`. Owned by the
   * hook because the `/` completion provider's position-0 gate reads
   * `entryDelegateRef.current`; the component passes this same ref to
   * `<TugPromptEntry ref={...}>` and to the atom-regenerate callback.
   */
  entryDelegateRef: RefObject<TugPromptEntryDelegate | null>;
}

// ---------------------------------------------------------------------------
// DevCardContent
// ---------------------------------------------------------------------------

export function DevCardContent({
  cardId,
  headerContent,
  statusBarContent,
  renderTurnTrailing,
  footerContent,
}: DevCardContentProps) {
  const services = useDevCardServices(cardId);
  // Subscribe to the restore registry so `DevRestoring` mounts as
  // soon as `restoreDevSessions` fires a `spawn_session(resume)` for
  // this card, and unmounts the moment the binding lands (registry
  // entry cleared via the cardSessionBindingStore subscriber inside
  // `dev-session-restore`).
  const restoreMap = useSyncExternalStore(
    devRestoreRegistry.subscribe,
    devRestoreRegistry.getSnapshot,
  );
  // Has the startup restore pass settled? Until it has, an unbound
  // card cannot tell "fresh card" from "restore not yet registered"
  // — see `restorePassGate`. Holding the picker behind this keeps
  // the project-picker sheet from flashing during the
  // `list_card_bindings` round-trip.
  const restorePassSettled = useSyncExternalStore(
    restorePassGate.subscribe,
    restorePassGate.getSnapshot,
  );
  if (services !== null) {
    return (
      <DevCardServicesGate
        cardId={cardId}
        services={services}
        headerContent={headerContent}
        statusBarContent={statusBarContent}
        renderTurnTrailing={renderTurnTrailing}
        footerContent={footerContent}
      />
    );
  }
  const expectation = restoreMap.get(cardId);
  if (expectation !== undefined) {
    return (
      <DevRestoring
        variant="binding"
        cardId={cardId}
        projectDir={expectation.projectDir}
      />
    );
  }
  if (!restorePassSettled) {
    // Restore pass still in flight — this unbound card may yet have a
    // ledger binding. Hold the quiet `pass-pending` placeholder
    // rather than flashing the picker; once the pass settles this
    // re-renders to either `DevRestoring` (a registry entry landed)
    // or the picker (genuinely a fresh card).
    return (
      <DevRestoring
        variant="pass-pending"
        cardId={cardId}
        projectDir=""
      />
    );
  }
  return <DevProjectPicker cardId={cardId} />;
}

// ---------------------------------------------------------------------------
// DevCardServicesGate — transportState routing
// ---------------------------------------------------------------------------

/**
 * Routes between `DevCardBody` and `DevRestoring`. Only ONE window
 * routes to the placeholder now:
 *
 *   - **transport-restoring** — `transportState === "restoring"`
 *     ([D01]), between `transport_open` and `transport_settled`. A
 *     hard-stop with Cancel; the wire is being re-asserted.
 *
 * The cold-restore replay window — preflight → `phase === "replaying"`
 * → `replay_complete` — mounts the BODY instead (progressive reveal,
 * [P03] of the resume-performance plan): under windowed mounting the
 * transcript paints progressively as fold flushes commit, anchored at
 * the live edge by follow-bottom, with the `Z0` `TugControlBar`
 * carrying restore progress. The previous all-or-nothing reveal
 * (body held unmounted until `replay_complete`, then one giant mount
 * commit) was the measured blank-window mechanism on every corpus
 * class — see the plan's baseline waterfalls.
 *
 * `deriveColdRestoreActive` is still read here, but only to settle the
 * restore bookkeeping (drop the restore-start stamp + resume display
 * metadata once the window closes).
 *
 * Why a wrapper rather than an early return inside `DevCardBody`:
 * `DevCardBody` calls many hooks after the snapshot read; an early
 * return there would change hook order between renders. Localizing
 * the routing read in this thin gate keeps `DevCardBody`'s hook list
 * stable.
 *
 * The gate also reads `projectDir` reactively from the binding store
 * so the placeholder's project label keeps up with any rebind that
 * happens while transportState is in flight (rare; this is defensive
 * against the single notify per `setBinding`).
 */
function DevCardServicesGate({
  cardId,
  services,
  headerContent,
  statusBarContent,
  renderTurnTrailing,
  footerContent,
}: DevCardBodyProps) {
  // Two narrow selectors, not the whole snapshot: each returns a
  // primitive, so the gate re-renders only when the routing decision
  // could actually change — not on every `turn_complete` that ticks
  // the snapshot during the replay window ([L02]).
  const transportState = useSyncExternalStore(
    services.codeSessionStore.subscribe,
    () => services.codeSessionStore.getSnapshot().transportState,
  );
  const coldRestoreActive = useSyncExternalStore(
    services.codeSessionStore.subscribe,
    () => deriveColdRestoreActive(services.codeSessionStore.getSnapshot()),
  );
  const projectDir = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    useCallback(
      () => cardSessionBindingStore.getBinding(cardId)?.projectDir ?? "",
      [cardId],
    ),
  );

  // Restore-settled bookkeeping. The body now mounts THROUGH the cold
  // restore (deferred-content reveal: the transcript host holds its
  // list unmounted while the replay progress strip carries the
  // window), so there is no reveal latch holding it back anymore.
  // What remains is pure cleanup: on the active → settled transition,
  // drop the restore-start stamp and the resume display metadata so a
  // much-later reconnect can't read stale values. A ref records the
  // transition edge — nothing renders from it, so this is local
  // bookkeeping ([L24] local data), not external state mirrored into
  // React ([L02] would forbid that).
  const sawColdRestoreRef = useRef(false);
  useEffect(() => {
    if (coldRestoreActive) {
      sawColdRestoreRef.current = true;
    } else if (sawColdRestoreRef.current) {
      sawColdRestoreRef.current = false;
      clearRestoreStartedAt(cardId);
    }
  }, [coldRestoreActive, cardId]);

  // Transport-restoring is a hard-stop backdrop with Cancel; it
  // applies whether or not the body has revealed before (a reconnect
  // re-asserts the wire). The cold-restore replay window deliberately
  // does NOT route here — the body owns it (progressive reveal).
  if (transportState === "restoring") {
    return (
      <DevRestoring
        variant="binding"
        cardId={cardId}
        projectDir={projectDir}
      />
    );
  }

  return (
    <DevCardBody
      cardId={cardId}
      services={services}
      headerContent={headerContent}
      statusBarContent={statusBarContent}
      renderTurnTrailing={renderTurnTrailing}
      footerContent={footerContent}
    />
  );
}

// ---------------------------------------------------------------------------
// DevRestoring — in-flight restore placeholder
// ---------------------------------------------------------------------------

/**
 * The single loading affordance for a dev-card restore — shown while
 * a persisted session is being re-asserted: the registry has a pending
 * restore expectation, `transportState === "restoring"`, or the
 * cold-restore replay window is still in progress.
 *
 * **Delay-gated.** The backdrop fills the card for the whole window,
 * but the centered panel (title, project, spinner, Cancel) appears
 * only once the restore has run longer than `RESTORE_PLACEHOLDER_DELAY_MS`.
 * A fast restore therefore shows only a quiet empty backdrop, sub-
 * perceptibly, before the body reveals; a slow one explains itself.
 * The delay is measured from the restore-start stamp
 * (`getRestoreStartedAt`) so it spans the whole window — pre-services
 * spawn, preflight, and replay alike — and survives this component's
 * remount at the `services`-null boundary, which a component-local
 * timer could not.
 *
 * Restore is a hard-stop beat: the `binding` variant's panel carries
 * Cancel so a genuinely stuck restore can drop to the picker via
 * `cancelDevRestore`.
 *
 * Two variants:
 *   - `binding` — a specific session is being restored (a registry
 *     expectation, transport-restoring, or the cold-restore replay
 *     window). Backdrop + the delay-gated centered panel.
 *   - `pass-pending` — the startup restore pass has not settled yet,
 *     so it is not yet known whether this unbound card has a session
 *     to restore. Backdrop only — no panel: there is no project to
 *     name and nothing to Cancel.
 *
 * The discriminator drives `data-variant` so CSS and tests can target
 * each surface unambiguously.
 */
type DevRestoringVariant = "binding" | "pass-pending";

interface DevRestoringProps {
  variant: DevRestoringVariant;
  /** The Cancel button calls `cancelDevRestore(cardId)`. */
  cardId: string;
  /** Path label rendered under the title. */
  projectDir: string;
}

/**
 * Delay before `DevRestoring` reveals its centered panel — mirrors
 * `REPLAY_SOFT_BUDGET_MS` so "the restore is taking long enough to
 * explain itself" is one threshold across the codebase. Under it, the
 * restore shows only the quiet backdrop.
 */
const RESTORE_PLACEHOLDER_DELAY_MS = REPLAY_SOFT_BUDGET_MS;

function DevRestoring({
  variant,
  cardId,
  projectDir,
}: DevRestoringProps) {
  const handleCancel = useCallback(() => {
    cancelDevRestore(cardId);
  }, [cardId]);

  // Delay gate. The restore-start stamp persists across this
  // component's remount at the `services`-null boundary, so each
  // mount recomputes the elapsed time against the same reference and
  // the panel reveal lands at a stable wall-clock moment. A missing
  // stamp means "treat as just started" — arm the full delay.
  const [panelVisible, setPanelVisible] = useState<boolean>(() => {
    const startedAt = getRestoreStartedAt(cardId);
    return (
      startedAt !== undefined &&
      Date.now() - startedAt >= RESTORE_PLACEHOLDER_DELAY_MS
    );
  });
  useEffect(() => {
    // The `pass-pending` variant never renders the panel — no timer.
    if (variant !== "binding" || panelVisible) return;
    const startedAt = getRestoreStartedAt(cardId);
    const elapsed = startedAt === undefined ? 0 : Date.now() - startedAt;
    const remaining = RESTORE_PLACEHOLDER_DELAY_MS - elapsed;
    if (remaining <= 0) {
      setPanelVisible(true);
      return;
    }
    const handle = setTimeout(() => setPanelVisible(true), remaining);
    return () => clearTimeout(handle);
  }, [variant, panelVisible, cardId]);

  const title = "Restoring session";
  const spinnerLabel = `Restoring session from ${projectDir}`;

  return (
    <div
      className="dev-card-restoring-backdrop"
      data-slot="dev-card-restoring"
      data-testid="dev-card-restoring"
      data-variant={variant}
    >
      {/*
        Backdrop always; the centered panel only on the `binding`
        variant and only past the delay. The panel is conditionally
        rendered (not opacity-hidden) so a fast restore — and the
        `pass-pending` variant, which never has a panel — neither
        animates an unseen spinner nor announces "Restoring session"
        through `aria-live`. When it does mount, a CSS keyframe fades
        it in ([L06] — appearance via CSS).
      */}
      {variant === "binding" && panelVisible ? (
        <div
          className="dev-card-restoring-panel"
          data-testid="dev-card-restoring-panel"
          role="status"
          aria-live="polite"
        >
          <h2
            className="dev-card-restoring-title"
            data-testid="dev-card-restoring-title"
          >
            {title}
          </h2>
          <p
            className="dev-card-restoring-project"
            title={projectDir}
            data-testid="dev-card-restoring-project"
          >
            {projectDir}
          </p>
          <div className="dev-card-restoring-footer">
            <span className="dev-card-restoring-spinner">
              <TugProgressIndicator
                variant="spinner"
                size={14}
                aria-label={spinnerLabel}
              />
            </span>
            <TugPushButton
              emphasis="outlined"
              onClick={handleCancel}
              data-testid="dev-card-restoring-cancel"
            >
              Cancel
            </TugPushButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DevProjectPicker
// ---------------------------------------------------------------------------

interface DevProjectPickerProps {
  cardId: string;
}

/**
 * Picker shown while the card is unbound. The project-path form lives
 * inside a `TugSheet` that drops from the title bar on mount and
 * disappears when the user picks a path or cancels.
 *
 * Sheet outcomes:
 *   - Open  → `spawn_session` frame is sent; the sheet closes. When
 *             `spawn_session_ok` arrives, `cardSessionBindingStore`
 *             populates the binding for `cardId` and
 *             `useDevCardServices` transitions from `null` to a ready
 *             services bag, flipping the card into its split-pane body.
 *   - Cancel → sheet closes; the card closes too (dispatch `close`
 *             through the responder chain to the first card responder).
 *   - Escape → same as Cancel.
 *
 * No "waiting" affordance in 4c. If `spawn_session_ok` never arrives,
 * the card is simply empty (sheet already dismissed). The `lastError`
 * banner arrives in Step 6.
 */
function DevProjectPicker({ cardId }: DevProjectPickerProps) {
  const { showSheet, renderSheet } = useTugSheet();
  const manager = useResponderChain();
  const senderId = useId();
  const shownRef = useRef(false);

  // One-shot notice from a prior session attempt. The card observer
  // stashes a notice when it clears the binding after a failure so
  // the re-presented picker can surface the reason. `consume` reads-
  // and-clears, so a remount that's not preceded by a failure shows
  // nothing. Captured once at picker construction; subsequent renders
  // inside this picker session keep showing the same notice until the
  // form is submitted.
  const noticeRef = useRef<PickerNotice | null>(null);
  if (noticeRef.current === null) {
    noticeRef.current = pickerNoticeStore.consume(cardId);
  }

  // Present the sheet only when this card becomes first responder.
  // An unbound dev card that lives in an inactive tab must wait —
  // otherwise its sheet drops on top of the sibling card the user is
  // actually looking at (reload symptom: restart with hello-world
  // front and a sibling dev tab → dev's picker covers hello).
  //
  // `observeCardDidActivate` fires an initial-sync synchronously at
  // subscribe time when the card is already the focused card — so a
  // fresh `addCard("dev")` (dev IS the new FR) presents the sheet
  // on mount without waiting for a macrotask drain.
  const cardLifecycle = useCardLifecycle();
  const presentSheet = useCallback(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    // The notice carries retry context (`stale{TugSessionId,ProjectDir}`)
    // only for the three retryable categories. When present, the
    // picker renders a Retry button that re-fires the restore and
    // closes the sheet; "retry" is treated like "open" in `onClosed`
    // below (no CLOSE dispatch — the card stays mounted so
    // `DevCardContent` can flip to `DevRestoring`).
    const noticeForRetry = noticeRef.current;
    const retryTugSessionId = noticeForRetry?.staleTugSessionId;
    const retryProjectDir = noticeForRetry?.staleProjectDir;
    const canRetry =
      retryTugSessionId !== undefined && retryProjectDir !== undefined;

    void showSheet({
      title: "Choose Session",
      icon: "FolderOpen",
      displayWidth: "md",
      // Capture the cascade target at sheet-open time per
      // `tugplan-dev-overlay-framework.md` [D02]. `cardId` is the
      // card-host's responder id; the chain walk from `cardId`
      // traverses `parentId` → the host pane's `stackId`, where
      // `TUG_ACTIONS.CLOSE` is registered (`tug-pane.tsx`). We use
      // `cardId` rather than the pane's `stackId` because:
      //   1. `cardId` is in scope here without extra plumbing.
      //   2. `cardId` is stable across cross-pane moves; pane
      //      `stackId` changes on move (see `card-host.tsx:1412`).
      // The cascade walk is dynamic (re-reads `parentId` at dispatch
      // time), so a moved card still reaches its current pane's
      // CLOSE handler. The hook itself doesn't consume this option;
      // the consumer reads `cardId` from its own closure inside
      // `onClosed` below — that's what makes the dispatch robust.
      cascadeTargetId: cardId,
      content: (close) => (
        <DevProjectPickerForm
          notice={noticeRef.current}
          onOpen={(projectDir, sessionMode, sessionId, display) => {
            const connection = getConnection();
            if (!connection) {
              console.warn("DevProjectPicker: connection unavailable");
              return;
            }
            // Start the sheet's exit animation FIRST. Defer the wire
            // send until after the animation has played:
            // `spawn_session_ok` arrives in single-digit milliseconds
            // in-process, and the resulting binding update flips this
            // card from picker → body, unmounting the picker (and its
            // sheet host) mid-animation. The user-visible symptom is
            // the sheet "just disappearing" on Open while Cancel
            // animates correctly. Deferring the wire send by the
            // sheet's exit duration lets the sheet play its exit
            // cleanly before the binding flip cascades through the
            // card.
            close("open");
            window.setTimeout(() => {
              if (sessionMode === "resume") {
                // A `resume` can be rejected by the server (e.g.
                // `session_live_elsewhere` when the session's ledger
                // entry is still bound to another card). Route it
                // through `fireRestore` so it registers a restore
                // expectation: the card shows `DevRestoring` while
                // in flight, and a rejection (the `SESSION_STATE`
                // errored frame) clears the registry and sets a
                // picker notice — which re-presents the picker with
                // the failure reason. Calling `sendSpawnSession`
                // directly here would leave an empty card when
                // `spawn_session_ok` never arrives: the sheet has
                // already dismissed with `result: "open"` and the
                // picker's `shownRef` guard blocks a re-present.
                fireRestore(cardId, sessionId, projectDir, connection, display);
              } else {
                sendSpawnSession(
                  connection,
                  cardId,
                  sessionId,
                  projectDir,
                  sessionMode,
                );
              }
            }, SHEET_EXIT_ANIMATION_MS);
          }}
          onCancel={() => close("cancel")}
          onRetryRestore={
            canRetry
              ? () => {
                  const connection = getConnection();
                  if (!connection) {
                    console.warn(
                      "DevProjectPicker: connection unavailable for retry",
                    );
                    return;
                  }
                  // Same exit-animation deferral as Open above —
                  // `fireRestore` triggers a binding restore that can
                  // unmount this picker.
                  close("retry");
                  window.setTimeout(() => {
                    fireRestore(
                      cardId,
                      retryTugSessionId as string,
                      retryProjectDir as string,
                      connection,
                    );
                  }, SHEET_EXIT_ANIMATION_MS);
                }
              : null
          }
        />
      ),
      // Fire after the sheet's exit animation finishes so the card
    });
  }, [showSheet, cardId]);

  useLayoutEffect(() => {
    if (cardLifecycle === null) return;
    return cardLifecycle.observeCardDidActivate(cardId, () => presentSheet());
  }, [cardLifecycle, cardId, presentSheet]);

  // Cancel-cascade dispatch when the picker closes with no
  // success result (Escape / Cmd+. / Cancel button →
  // `result === undefined`). Cancellation should dismiss the host
  // card via the chain. Migrated from the legacy
  // `useTugSheet().showSheet({ onClosed })` closure-callback to
  // the per-card `sheetDidReturnResult` lifecycle event so the
  // dispatch composes with other lifecycle subscribers (e.g.,
  // `DevCardBody`'s `sheetDidHide` focus claim) on a single
  // observable pipe.
  //
  // Cascade dispatch via `sendToTarget(cardId, …)` per [D02]:
  // first-responder state at this moment is fragile (it settles
  // via the unregister fallback after FocusScope unmount, focusin
  // handlers, and stale-focus re-promotion) and was the source of
  // the cancel-cascade bug fixed here. `sendToTarget` walks
  // `parentId` from a known node, independent of focus settling.
  //
  // `result === "open"` and `"retry"` leave the card mounted (the
  // binding subscription flips into the split-pane body when
  // `spawn_session_ok` arrives, or `fireRestore` triggers a
  // re-render into `DevRestoring`); only the implicit
  // `undefined` result and any other future cancel-class result
  // close the card.
  //
  // `CLOSE_TAB` (not `CLOSE`): a picker cancel has nothing to save —
  // the card hasn't opened a session yet — so it must bypass Dev's
  // `confirmClose: true` policy that `CLOSE` would trigger. The
  // pane's `CLOSE_TAB` handler removes the card directly, and
  // `_removeCard` cascades to `_closePane` when removing the last
  // card.
  useSheetDelegate(cardId, {
    sheetDidReturnResult: (_id, result) => {
      if (result === "open" || result === "retry") return;
      manager?.sendToTarget(cardId, {
        action: TUG_ACTIONS.CLOSE_TAB,
        value: cardId,
        sender: senderId,
        phase: "discrete",
      });
    },
  });

  // Spawn-rejection banner. When tugcast rejects this card's
  // `spawn_session` (e.g. the project directory no longer exists),
  // `action-dispatch` records it in `devSpawnErrorStore` keyed by
  // `cardId`. The picker is already mounted and waiting, so the
  // `useSyncExternalStore` subscription re-renders it here — the card
  // has no `CodeSessionStore` yet (the session never came up), so this
  // is the surface for the failure.
  const spawnError = useSpawnError(cardId);
  // Hold the last error so the banner's content stays stable through
  // its exit animation after `spawnError` clears.
  const lastSpawnErrorRef = useRef<SpawnError | null>(null);
  if (spawnError !== null) lastSpawnErrorRef.current = spawnError;
  const shownSpawnError = lastSpawnErrorRef.current;

  // Drop the card's spawn-error when the picker unmounts (the card
  // bound or closed) so a later card reusing this id starts clean.
  useEffect(() => () => devSpawnErrorStore.clear(cardId), [cardId]);

  // Banner recovery: clear the error and re-present the picker sheet
  // so the user can choose a directory that exists.
  const handleSpawnErrorRetry = useCallback(() => {
    devSpawnErrorStore.clear(cardId);
    shownRef.current = false;
    presentSheet();
  }, [cardId, presentSheet]);

  return (
    <div
      className="dev-card-picker-backdrop"
      data-slot="dev-card-picker"
      data-testid="dev-card-picker"
      aria-hidden="true"
    >
      {renderSheet()}
      <TugPaneBanner
        visible={spawnError !== null}
        variant="error"
        tone="danger"
        minMountedMs={0}
        label="Can't open project"
        message={
          shownSpawnError !== null
            ? spawnErrorMessage(shownSpawnError.reason)
            : ""
        }
        detailIcon="folder-x"
        detailTitle="Can't open project"
        footer={
          <TugPushButton
            emphasis="primary"
            role="action"
            onClick={handleSpawnErrorRetry}
            data-testid="dev-card-spawn-error-retry"
          >
            Choose Directory
          </TugPushButton>
        }
      >
        <p>
          Dev couldn&apos;t start a session here. Choose a directory that
          exists and try again.
        </p>
      </TugPaneBanner>
    </div>
  );
}

interface DevProjectPickerFormProps {
  /**
   * Notice surfaced above the form when the picker is re-presented
   * after a session failure (e.g. a resume that didn't take, a
   * canceled restore, or a restore timeout). The notice carries the
   * reason so the user sees it in the same picker that lets them
   * choose what to do next. `null` when the picker is opening fresh.
   */
  notice: PickerNotice | null;
  onOpen: (
    projectDir: string,
    sessionMode: CardSessionMode,
    sessionId: string,
    /**
     * Resume display metadata from the selected ledger row (Spec S03
     * of the resume-performance plan) — what the replay progress
     * affordance can say from t=0. `undefined` for new-mode opens.
     */
    display?: ResumeDisplayMetadata,
  ) => void;
  onCancel: () => void;
  /**
   * Invoked when the user clicks Retry on a notice that carries
   * `staleTugSessionId` + `staleProjectDir`. Re-fires the restore via
   * `fireRestore` — the card flips from picker back to
   * `DevRestoring` and the whole cycle runs again. `null` on a
   * fresh-picker notice that doesn't carry retry context.
   */
  onRetryRestore: (() => void) | null;
}

/** One entry in the sessions record. */
interface SessionRecord {
  sessionId: string;
  projectDir: string;
  createdAt: number;
}

/**
 * Pure parser for the `dev.tugtool.dev / recent-projects` tagged-value
 * entry. Mirrors `readDevRecentProjects` in shape — split out so the
 * picker can subscribe to live updates via `useTugbankValue` instead of
 * reading once into `useState` (an L02 violation when external state
 * is copied into React state, even via a lazy initial value).
 */
function parseRecents(entry: TaggedValue | undefined): string[] {
  if (!entry || entry.kind !== "json" || entry.value === undefined) return [];
  const raw = entry.value as { paths?: unknown } | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.paths)) return [];
  return raw.paths.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/**
 * Parse a tugbank string value. The Swift host writes
 * `dev.tugtool.app/initial-project-path` as `{ kind: "string" }` via
 * `TugbankClient.setString` — empty string when the key is missing
 * or shaped unexpectedly.
 */
function parseString(entry: TaggedValue | undefined): string {
  if (!entry || entry.kind !== "string" || typeof entry.value !== "string") return "";
  return entry.value;
}

/** Stable `[]` reference — useTugbankValue's `fallback` must be reference-stable. */
const EMPTY_STRING_ARRAY: ReadonlyArray<string> = [];

/** `formatValue` for the picker's scan-progress bar — "465 of 1,022". */
function formatScanProgressValue(value: number, max: number): string {
  return `${value.toLocaleString()} of ${max.toLocaleString()}`;
}

/**
 * Map a picker notice to user-facing copy. `resume_failed` uses a
 * generic sentence; `restore_canceled` and `restore_timed_out`
 * include the project path from `staleProjectDir` so the user sees
 * which card's restore was affected. Falls back to the raw
 * `notice.message` on unexpected shapes.
 */
function noticeText(notice: PickerNotice): string {
  switch (notice.category) {
    case "resume_failed":
      return "Couldn’t resume the previous session — it may have been deleted or is in use elsewhere. Pick a different option below.";
    case "restore_canceled":
      return notice.staleProjectDir !== undefined
        ? `Canceled restoring the previous session for ${notice.staleProjectDir}.`
        : notice.message;
    case "restore_timed_out":
      return notice.staleProjectDir !== undefined
        ? `Restoring the previous session for ${notice.staleProjectDir} took too long. The server may be unreachable — you can Retry or start a new session below.`
        : notice.message;
    default:
      return notice.message;
  }
}

/**
 * Persistent-cycling focus group for the session picker ([P13] persistent —
 * [#step-picker-keys]). The picker lives inside a `TugSheet`, which already
 * pushes a trapped engine focus mode (`useFocusTrap`); authoring the picker's
 * controls into this one group makes them stops in that mode's Tab walk, read
 * top-to-bottom: path field → Recents → Sessions → Move-all-to-Trash → Cancel →
 * Open. There is no toggle — the sheet's mode IS the picker's base mode (unlike
 * the connected card's toggleable ⌥⇥ cycle). Conditionally-rendered lists (empty
 * Recents / not-ready Sessions) and a disabled stop (Move-all-to-Trash with
 * nothing to trash, Open with no valid path) simply drop out of the walk via the
 * engine's rendered/interactive filters; the order leaves a gap the walk skips.
 */
const PICKER_CYCLE_GROUP = "dev-picker-cycle";
const PICKER_ORDER_PATH = 0;
// The native "Browse…" folder button sits just after the path field in reading
// order. It takes a fractional order so it slots between PATH (0) and RECENTS
// (1) in the Tab walk WITHOUT renumbering the stops below it — their authored
// focus-keys (`dev-picker-cycle:1…5`) are a stable contract the app-tests and a
// baked corpus snapshot address by string, so they must not shift.
const PICKER_ORDER_BROWSE = 0.5;
const PICKER_ORDER_RECENTS = 1;
const PICKER_ORDER_SESSIONS = 2;
const PICKER_ORDER_TRASH_ALL = 3;
const PICKER_ORDER_CANCEL = 4;
const PICKER_ORDER_OPEN = 5;
/**
 * Stable focus-key (`group:order`) of a picker stop. The smart-latch seed lands
 * the ring on a specific stop by this key via `armKeyboardRestore` — the picker's
 * commit-home (Open) is LAST in reading order, so the dev-card "seed = first
 * stop" convention (`focusFirstInMode`) doesn't fit; seeding by key does.
 */
const pickerFocusKey = (order: number): string =>
  `${PICKER_CYCLE_GROUP}:${order}`;

function DevProjectPickerForm({
  notice,
  onOpen,
  onCancel,
  onRetryRestore,
}: DevProjectPickerFormProps) {
  const focusManager = useFocusManager();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Per-state default focus for the picker ([P12] Picker → Open). The Open
  // button is the destination so Return opens the seeded path — but Open is
  // `disabled` until a valid path settles, and the path seed is async, so the
  // placement is a deliberate smart latch (below) that seeds the engine key view
  // by focus-key once Open settles enabled, else the path field; never yanked
  // once the user has engaged the field. Both stops are addressed by their stable
  // `group:order`, so no element ref is needed for the seed.
  const defaultFocusPlacedRef = useRef(false);
  const userTouchedFieldRef = useRef(false);
  // True while the path field's completion menu is open — the Recent Project
  // Paths list steps aside (keeps its layout space) so the floating overlay
  // never visually collides with it.
  const [pathMenuOpen, setPathMenuOpen] = useState(false);
  // Form's outer DOM node — used to scope the anchor querySelector for
  // the form-owned trash-confirmation popover so the lookup never
  // walks outside the picker form's own subtree.
  const formRootRef = useRef<HTMLDivElement | null>(null);
  const formResponderId = useId();

  // External state via `useSyncExternalStore` per [L02]. Recents
  // ride on tugbank; sessions flow through the tugcast-side
  // `DevSessionLedgerStore` keyed on the user-typed path.
  const recents = useTugbankValue(
    "dev.tugtool.dev",
    "recent-projects",
    parseRecents,
    EMPTY_STRING_ARRAY as string[],
  );

  // Suggested project path the Swift host refreshes at every launch
  // (the repo source tree for debug builds, `$HOME` for release).
  // Used to seed the input when the user has no Recent Project Paths
  // yet so first launch isn't a dead-end.
  const initialProjectPath = useTugbankValue(
    "dev.tugtool.app",
    "initial-project-path",
    parseString,
    "",
  );

  const [path, setPath] = useState("");
  const trimmedPath = path.trim();
  const sessionLedger = useSessionLedger(trimmedPath);

  // Re-validate the session list once per picker open. The ledger
  // store's snapshot is fetched once per connection, but terminal
  // sessions and other out-of-band JSONL writers never push
  // `session_updated` — without this the list freezes at whatever the
  // first open saw. Stale-while-revalidate: cached rows stay on screen
  // while the refresh scan runs ([L02] — the store owns the state; this
  // is an event kick, not a state mirror).
  const didRefreshLedgerRef = useRef(false);
  useLayoutEffect(() => {
    if (didRefreshLedgerRef.current || trimmedPath === "") return;
    didRefreshLedgerRef.current = true;
    getDevSessionLedgerStore()?.refresh(trimmedPath);
  }, [trimmedPath]);

  // One-shot input seed — the effect lives just below the data sources (the
  // Recents data source must be in scope to read the most-recent path).
  const didSeedPathRef = useRef(false);

  // Two data sources for the master/detail layout: Recents (always
  // visible — clicking one fills the input but the list does not
  // collapse) above Sessions (always visible — placeholder when no
  // path / ledger pending).
  const recentsDataSource = useDevRecentsDataSource(recents, trimmedPath);
  const sessionsDataSource = useDevSessionsDataSource(
    trimmedPath,
    sessionLedger,
  );

  // One-shot seed so first open isn't a dead-end: if the input is empty,
  // prefer the most-recent project (what the Recents list's old
  // `selectionRequired` mode filled in on mount), else the Swift-provided
  // hint. Skipped once a value is present so later tugbank ticks can't
  // overwrite a user edit.
  useLayoutEffect(() => {
    if (didSeedPathRef.current) return;
    if (path !== "") {
      didSeedPathRef.current = true;
      return;
    }
    if (recents.length > 0) {
      const first = recentsDataSource.rowAt(0);
      if (first.kind === "path-recent") {
        didSeedPathRef.current = true;
        setPath(first.path);
      }
      return;
    }
    if (initialProjectPath === "") return;
    didSeedPathRef.current = true;
    setPath(initialProjectPath);
  }, [path, recents.length, initialProjectPath, recentsDataSource]);

  // Session selection. Owned here, read by cells via context. Open
  // resolves submission per [Spec S02].
  const [selection, setSelection] = useState<PickerSelection | null>(null);

  // [Spec S03] selection invalidation — sessions only. Auto-default
  // to `session-new` on first SESSIONS visibility per [D06]; clear
  // when sessions go away; snap-back when the selected resume row
  // vanishes from the ledger.
  const sessionsReady = sessionsDataSource.isReady();
  const ledgerRows = sessionLedger.rows;
  useLayoutEffect(() => {
    if (!sessionsReady) {
      if (selection !== null) setSelection(null);
      return;
    }
    if (selection === null) {
      setSelection({ kind: "session-new" });
      return;
    }
    if (selection.kind === "session-resume") {
      const stillVisible = ledgerRows.some(
        (r) => r.session_id === selection.sessionId,
      );
      if (!stillVisible) setSelection({ kind: "session-new" });
    }
  }, [sessionsReady, ledgerRows, selection]);

  // Trash actions — the picker form owns the confirmation flow per
  // [tugplan-dev-picker-redesign §D14] (no per-cell popovers).
  //
  // Per-row trash: the trash `TugIconButton` in `SessionResumeCell`
  // dispatches `request-trash-session` with `{ sessionId }` payload.
  // The chain handler below populates `pendingTrashSessionId`. A
  // single anchored `TugConfirmPopover` rendered at the form level
  // confirms, and its `onConfirm` callback unconditionally moves the
  // session to trash.
  //
  // Trash-all: the picker-level button uses the imperative-mode
  // `TugConfirmPopover` API (legacy). It does not need the chain-
  // dispatch path because the button is always visible at a fixed
  // location, not anchored to a specific row.

  const trashSession = useCallback(
    (sessionId: string): void => {
      const store = getDevSessionLedgerStore();
      if (store === null) return;
      const row = ledgerRows.find((r) => r.session_id === sessionId);
      // Live-in-Tug and terminal-live rows are untrashable (the cell
      // hides the control; this is the defensive backstop — the
      // supervisor refuses both anyway).
      if (row === undefined || row.state === "live" || row.terminal_live !== null)
        return;
      // Always pass the project dir: external rows (no ledger row
      // server-side) need it to locate the JSONL; ledger rows ignore it.
      void store.trashSession(sessionId, row.project_dir);
      setSelection((prev) =>
        prev?.kind === "session-resume" && prev.sessionId === sessionId
          ? { kind: "session-new" }
          : prev,
      );
    },
    [ledgerRows],
  );

  // ---- Form-owned trash confirmation ----
  //
  // `pendingTrashSessionId` is `null` when no trash is in flight.
  // The chain handler for `request-trash-session` (registered below)
  // sets it; the popover's `onConfirm` and `onCancel` both clear it.
  // The anchor is resolved in a layout effect by querying the trash
  // icon's DOM node within this form's own subtree — the cell's
  // `data-session-id="<id>"` attribute on the row + the
  // `data-slot="tug-icon-button"` on the trash button form a stable
  // selector that survives row reordering and virtualization recycle.
  const [pendingTrashSessionId, setPendingTrashSessionId] = useState<
    string | null
  >(null);
  const [pendingTrashAnchorEl, setPendingTrashAnchorEl] =
    useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (pendingTrashSessionId === null) {
      setPendingTrashAnchorEl(null);
      return;
    }
    const root = formRootRef.current;
    if (root === null) return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(pendingTrashSessionId)
        : pendingTrashSessionId;
    const selector =
      `[data-session-id="${escaped}"] [data-slot="tug-icon-button"]`;
    const el = root.querySelector<HTMLElement>(selector);
    setPendingTrashAnchorEl(el ?? null);
  }, [pendingTrashSessionId]);

  // Chain handler for `request-trash-session` dispatched by the per-
  // row trash button. The cell carries the sessionId on the event's
  // `value`; we narrow defensively per [L07] and ignore malformed
  // payloads. Setting `pendingTrashSessionId` triggers the layout
  // effect above (anchor resolution) and the popover render below.
  const handleRequestTrashSession = useCallback((event: ActionEvent) => {
    const v = event.value;
    if (
      v !== null &&
      typeof v === "object" &&
      "sessionId" in v &&
      typeof (v as { sessionId: unknown }).sessionId === "string"
    ) {
      setPendingTrashSessionId((v as { sessionId: string }).sessionId);
    }
  }, []);

  // Recents trash request — mirrors the sessions handler. Declared here (above
  // `useResponder`) so it's in scope for the action binding; the rest of the
  // recents-trash flow (anchor, remove, confirm) lives just below the sessions
  // block.
  const [pendingTrashRecentPath, setPendingTrashRecentPath] = useState<
    string | null
  >(null);
  const handleRequestTrashRecent = useCallback((event: ActionEvent) => {
    const v = event.value;
    if (
      v !== null &&
      typeof v === "object" &&
      "path" in v &&
      typeof (v as { path: unknown }).path === "string"
    ) {
      setPendingTrashRecentPath((v as { path: string }).path);
    }
  }, []);

  const { ResponderScope: PickerFormResponderScope, responderRef: pickerFormResponderRef } =
    useResponder({
      id: formResponderId,
      actions: {
        [TUG_ACTIONS.REQUEST_TRASH_SESSION]: handleRequestTrashSession,
        [TUG_ACTIONS.REQUEST_TRASH_RECENT]: handleRequestTrashRecent,
      },
    });

  // Merged ref: the form's root div carries BOTH the form responder's
  // `data-responder-id` (so the chain DOM walk lands here) AND our
  // own `formRootRef` (so the anchor querySelector is scoped to the
  // form's subtree). React calls function refs with the element on
  // mount and `null` on unmount, so the merge mirrors the same
  // calling shape both ways.
  const setFormRootRef = useCallback(
    (el: HTMLDivElement | null): void => {
      formRootRef.current = el;
      pickerFormResponderRef(el);
    },
    [pickerFormResponderRef],
  );

  // Confirm / cancel callbacks for the form-owned popover. Both
  // unconditionally clear `pendingTrashSessionId`, which flips the
  // popover's controlled `open` to `false`. Confirm additionally runs
  // the move-to-trash via the existing `trashSession` helper.
  const handleConfirmTrash = useCallback(() => {
    if (pendingTrashSessionId !== null) {
      trashSession(pendingTrashSessionId);
    }
    setPendingTrashSessionId(null);
  }, [pendingTrashSessionId, trashSession]);

  const handleCancelTrash = useCallback(() => {
    setPendingTrashSessionId(null);
  }, []);

  // The pending row's prompt would compose a richer message here, but
  // the picker UX uses the short, generic prompt "Move to Trash?" for
  // both single-row and bottom-button paths.
  const pendingTrashMessage = "Move to Trash?";

  // ---- Recent Project Paths trash (mirrors the sessions per-row flow) ----
  //
  // `pendingTrashRecentPath` + `handleRequestTrashRecent` are declared above
  // (next to `useResponder`). Here: anchor resolution, the remove action, and
  // the confirm/cancel callbacks.
  const [pendingTrashRecentAnchorEl, setPendingTrashRecentAnchorEl] =
    useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (pendingTrashRecentPath === null) {
      setPendingTrashRecentAnchorEl(null);
      return;
    }
    const root = formRootRef.current;
    if (root === null) return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(pendingTrashRecentPath)
        : pendingTrashRecentPath;
    const selector = `[data-recent-path="${escaped}"] [data-slot="tug-icon-button"]`;
    const el = root.querySelector<HTMLElement>(selector);
    setPendingTrashRecentAnchorEl(el ?? null);
  }, [pendingTrashRecentPath]);

  // Remove one path from the recents list. Optimistically updates the tugbank
  // cache (so the list re-renders immediately) then persists via PUT.
  const trashRecent = useCallback(
    (path: string): void => {
      const next = recents.filter((p) => p !== path);
      const client = getTugbankClient();
      client?.setLocalValue("dev.tugtool.dev", "recent-projects", {
        kind: "json",
        value: { paths: next },
      });
      putDevRecentProjects(next);
    },
    [recents],
  );

  const handleConfirmTrashRecent = useCallback(() => {
    if (pendingTrashRecentPath !== null) {
      trashRecent(pendingTrashRecentPath);
    }
    setPendingTrashRecentPath(null);
  }, [pendingTrashRecentPath, trashRecent]);

  const handleCancelTrashRecent = useCallback(() => {
    setPendingTrashRecentPath(null);
  }, []);

  const trashAll = useCallback((): void => {
    const store = getDevSessionLedgerStore();
    if (store === null) return;
    let any = false;
    for (const row of ledgerRows) {
      if (row.state === "live") continue;
      void store.trashSession(row.session_id);
      any = true;
    }
    if (any) setSelection({ kind: "session-new" });
  }, [ledgerRows]);

  // Imperative handle for the trash-all confirm popover anchored to
  // the Move-all-to-Trash button. Click flow: open popover → await
  // confirmation → run `trashAll`.
  const trashAllConfirmRef = useRef<TugConfirmPopoverHandle>(null);
  const handleTrashAllClick = useCallback(async (): Promise<void> => {
    const ok = await trashAllConfirmRef.current?.confirm();
    if (ok === true) trashAll();
  }, [trashAll]);

  // Submit per [Spec S02] — resolves `(mode, sessionId)` from the
  // effective selection. The override parameter lets the form-level
  // Enter handler pass a synchronously-resolved selection from a
  // focused cell wrapper, since `setSelection` calls in the same
  // event don't reach state until the next render.
  const submitWith = useCallback(
    (effectiveSelection: PickerSelection | null): void => {
      const trimmed = inputRef.current?.value.trim() ?? "";
      if (!trimmed) return;

      let mode: CardSessionMode;
      let sessionId: string;
      let resumeCandidateId: string | null = null;
      let display: ResumeDisplayMetadata | undefined;

      if (effectiveSelection?.kind === "session-resume") {
        resumeCandidateId = effectiveSelection.sessionId;
        const row = ledgerRows.find(
          (r) => r.session_id === effectiveSelection.sessionId,
        );
        if (row !== undefined && row.state !== "live") {
          mode = "resume";
          sessionId = row.session_id;
          display = {
            title: row.name ?? row.last_user_prompt ?? null,
            turnCount: row.turn_count,
          };
        } else {
          mode = "new";
          sessionId = crypto.randomUUID();
        }
      } else {
        mode = "new";
        sessionId = crypto.randomUUID();
      }

      logSessionLifecycle("picker.submit", {
        project_dir: trimmed,
        session_mode: mode,
        session_id: sessionId,
        resume_candidate_id: resumeCandidateId,
      });
      onOpen(trimmed, mode, sessionId, display);
    },
    [onOpen, ledgerRows],
  );

  const submit = useCallback((): void => {
    submitWith(selection);
  }, [submitWith, selection]);

  // Set the project-path input from the recent at `index`. Shared by
  // the Recents `TugListView`'s two activation surfaces so the path
  // the user sees can never drift between them:
  //
  //  - `onSelectionChange` — `TugListView`'s de-duplicated selection
  //    mirror. Fires the mount-time seed (the list runs in
  //    `selectionRequired` mode and seeds its owned selection to the
  //    first recent, filling the input before any click) and again
  //    when the owned selected index moves to a different row. It
  //    does NOT fire on a re-activation of the already-selected row —
  //    the index did not change.
  //  - `delegate.onSelect` — fires on EVERY activation (click /
  //    Space / Enter), the already-selected row included. This is the
  //    surface that makes the fill unconditional: once the user has
  //    hand-edited the input, clicking the highlighted recent still
  //    restores that recent's path.
  const applyRecentPath = useCallback(
    (index: number): void => {
      const row = recentsDataSource.rowAt(index);
      if (row.kind === "path-recent") setPath(row.path);
    },
    [recentsDataSource],
  );

  // Recents list delegate — routes every activation back through
  // `applyRecentPath`. Memoized for a stable identity across renders,
  // matching `sessionsDelegate` below.
  const recentsDelegate = useMemo<TugListViewDelegate>(
    () => ({ onSelect: applyRecentPath }),
    [applyRecentPath],
  );

  // Sessions list delegate — onSelect updates the session selection
  // (or no-ops on live / loading rows).
  const sessionsDelegate = useMemo<TugListViewDelegate>(
    () => ({
      onSelect: (index) => {
        const row = sessionsDataSource.rowAt(index);
        switch (row.kind) {
          case "session-new":
            setSelection({ kind: "session-new" });
            return;
          case "session-resume":
            if (row.row.state === "live") return;
            setSelection({
              kind: "session-resume",
              sessionId: row.row.session_id,
            });
            return;
          case "loading":
            return;
        }
      },
    }),
    [sessionsDataSource],
  );

  // Arrow navigation over the two lists is owned by the focus engine: each
  // `TugListView` is authored as one single-select cycle stop, so ↑/↓ move the
  // cursor within whichever list holds the key view AND select the landed row —
  // the recent path / session selection follows the cursor (no separate Space
  // step). A single-select list does not consume Return: it falls through to the
  // picker's default action (Open, which keeps its ring the whole time via
  // `persistentDefaultRing`), so arrowing to a row and pressing Return opens it.
  // Per-row trash stays mouse-driven (the row trash icons are focus-refusing
  // pointer affordances); keyboard users trash via the Move-all-to-Trash stop.

  // Cell-context value — `currentPath` drives path-recent's
  // `data-selected`; `selection` drives session cells' selection
  // state; `pendingTrashSessionId` drives the matching row's
  // `data-pending-trash="true"` marker so its trash icon stays
  // visible + highlighted while the form-owned confirm popover is
  // up. The per-row trash flow does NOT pass a callback through
  // context; the trash button dispatches `request-trash-session`
  // through the chain, and the form's chain handler above owns the
  // response.
  const cellContextValue = useMemo(
    () => ({
      currentPath: trimmedPath,
      selection,
      pendingTrashSessionId,
      pendingTrashRecentPath,
    }),
    [trimmedPath, selection, pendingTrashSessionId, pendingTrashRecentPath],
  );

  // Master/detail layout: project-path input → Recents list →
  // Sessions list (+ Move-all-to-Trash button) → Cancel/Open.
  const sessionsPending = sessionsDataSource.isPending();
  const nonLiveCount = sessionsDataSource.nonLiveCount();
  // The `list_sessions` round-trip carries a filesystem existence check
  // for the typed path. An explicit `false` (path confirmed missing)
  // disables Open so a doomed `spawn_session` is never sent; `undefined`
  // (still checking) leaves Open enabled — the spawn-error banner is the
  // backstop for the race window.
  const dirMissing = sessionsDataSource.dirExists() === false;
  const openDisabled = trimmedPath.length === 0 || dirMissing;

  // Smart-latch default focus ([P12] Picker → New session). Re-evaluated as the
  // async path seed settles `openDisabled` and the sessions list becomes ready:
  //   - Open enabled + sessions ready → seed the Sessions list, which rests its
  //     cursor on the "New session" row (the selection defaults to
  //     `session-new`). A single-select list does not consume Return, so it
  //     falls through to the persistent-default Open: one Return spawns a new
  //     session at the seeded (most-recent) path. Latch.
  //   - Open enabled but sessions not ready yet → keep the caret in the path
  //     field so a still-loading picker is never ringless; do NOT latch, so the
  //     seed promotes to the Sessions list the moment the list mounts.
  //   - Open disabled → keep the ring/caret in the path field so typing starts
  //     immediately; do NOT latch, so a seed that later enables Open
  //     (before the user types) promotes the ring on the next run.
  //   - The user has touched the field → that field is the default;
  //     latch without moving so typing is never interrupted.
  // The picker is persistent-cycling ([P13]) — the seed is the engine KEY VIEW
  // (ring + DOM focus), not a bare `.focus()`, so the focus engine stays the
  // single owner and the ring rests on the seed at open. `armKeyboardRestore`
  // resolves the stop by its stable focus-key now (the field is already
  // registered) or re-lights it the instant it mounts. [L03] layout effect
  // (seed before paint).
  useLayoutEffect(() => {
    if (focusManager === null) return;
    if (defaultFocusPlacedRef.current) return;
    if (userTouchedFieldRef.current) {
      defaultFocusPlacedRef.current = true;
      return;
    }
    if (openDisabled || !sessionsReady) {
      focusManager.armKeyboardRestore(pickerFocusKey(PICKER_ORDER_PATH));
      return;
    }
    defaultFocusPlacedRef.current = true;
    focusManager.armKeyboardRestore(pickerFocusKey(PICKER_ORDER_SESSIONS));
  }, [openDisabled, sessionsReady, focusManager]);

  return (
    <PickerFormResponderScope>
      <div ref={setFormRootRef} className="dev-card-picker-form">
      {notice !== null && (
        <div
          className="dev-card-picker-notice"
          role="status"
          data-testid="dev-card-picker-notice"
          data-notice-category={notice.category}
        >
          {noticeText(notice)}
          {onRetryRestore !== null && (
            <div className="dev-card-picker-notice-actions">
              <TugPushButton
                emphasis="outlined"
                onClick={onRetryRestore}
                data-testid="dev-card-picker-notice-retry"
              >
                Retry
              </TugPushButton>
            </div>
          )}
        </div>
      )}
      <label className="dev-card-picker-field">
        <span className="dev-card-picker-label">Project path</span>
        <TugFileChooser
          ref={inputRef}
          value={path}
          onChange={(next) => {
            // A user edit (typing / completion pick) — not the programmatic
            // seed, which calls `setPath` directly — claims the field as the
            // default focus so the smart latch never yanks it to Open.
            userTouchedFieldRef.current = true;
            setPath(next);
          }}
          base={path !== "" ? path : "/"}
          kind="directory"
          onSubmit={submit}
          onOpenChange={setPathMenuOpen}
          placeholder="/path/to/project"
          focusGroup={PICKER_CYCLE_GROUP}
          focusOrder={PICKER_ORDER_PATH}
          browseFocusOrder={PICKER_ORDER_BROWSE}
        />
      </label>
      <PickerCellProvider value={cellContextValue}>
        <div
          className="dev-card-picker-section"
          data-completing={pathMenuOpen ? "true" : undefined}
        >
          <span className="dev-card-picker-label">Recent Project Paths</span>
          <div className="dev-card-picker-recents-host">
            {recents.length > 0 ? (
              <TugListView
                dataSource={recentsDataSource}
                rowLayout="flush"
                delegate={recentsDelegate}
                cellRenderers={RECENTS_CELL_RENDERERS}
                scrollKey="dev-card-picker-recents"
                className="dev-card-picker-recents-list"
                focusGroup={PICKER_CYCLE_GROUP}
                focusOrder={PICKER_ORDER_RECENTS}
                singleSelect
              />
            ) : (
              <div
                className="dev-card-picker-empty"
                data-testid="dev-card-picker-recents-empty"
              >
                No recent projects
              </div>
            )}
          </div>
        </div>
        <div className="dev-card-picker-section">
          <span className="dev-card-picker-label">
            Sessions
            {sessionsReady && sessionLedger.scanning === true ? (
              <span
                className="dev-card-picker-scanning"
                role="status"
                aria-live="polite"
                data-testid="dev-card-picker-scanning"
              >
                {sessionLedger.scanProgress !== undefined &&
                sessionLedger.scanProgress.total > 0 ? (
                  // Determinate ticks from the host's scan: the same
                  // labeled-bar recipe as the restore strip, sized for
                  // the section header.
                  <TugProgressIndicator
                    variant="bar"
                    size={6}
                    role="action"
                    state="running"
                    label="Scanning…"
                    glyphPosition="right"
                    value={Math.min(
                      sessionLedger.scanProgress.parsed,
                      sessionLedger.scanProgress.total,
                    )}
                    max={sessionLedger.scanProgress.total}
                    showValue
                    formatValue={formatScanProgressValue}
                    className="dev-card-picker-scanning-bar"
                    aria-label="Scanning sessions"
                  />
                ) : (
                  "scanning sessions…"
                )}
              </span>
            ) : null}
          </span>
          <div className="dev-card-picker-sessions-host">
            {sessionsReady ? (
              <TugListView
                dataSource={sessionsDataSource}
                delegate={sessionsDelegate}
                cellRenderers={SESSIONS_CELL_RENDERERS}
                scrollKey="dev-card-picker-sessions"
                rowLayout="flush"
                className="dev-card-picker-sessions-list dev-card-picker-list-view"
                focusGroup={PICKER_CYCLE_GROUP}
                focusOrder={PICKER_ORDER_SESSIONS}
                singleSelect
              />
            ) : sessionsPending ? (
              <div
                className="dev-card-picker-empty"
                role="status"
                aria-live="polite"
                data-testid="dev-card-picker-pending-placeholder"
              >
                checking…
              </div>
            ) : (
              <div
                className="dev-card-picker-empty"
                data-testid="dev-card-picker-sessions-empty"
              >
                Type or select a project path to see sessions
              </div>
            )}
          </div>
          <div className="dev-card-picker-trash-all">
            <TugLabel emphasis="proposal" data-testid="dev-card-picker-trash-all-label">
              {nonLiveCount > 1
                ? `Move all sessions to Trash for this path (${nonLiveCount})`
                : "Move all sessions to Trash for this path"}
            </TugLabel>
            <TugConfirmPopover
              ref={trashAllConfirmRef}
              message={
                nonLiveCount > 1
                  ? `Move all ${nonLiveCount} sessions to Trash?`
                  : "Move to Trash?"
              }
              confirmLabel="Trash"
              confirmRole="danger"
              side="top"
            >
              <TugPushButton
                subtype="icon"
                emphasis="ghost"
                role="danger"
                icon={<Trash2 size={16} aria-hidden="true" />}
                onClick={handleTrashAllClick}
                disabled={nonLiveCount === 0}
                aria-label="Move all sessions to Trash for this path"
                data-testid="dev-card-picker-trash-all"
                focusGroup={PICKER_CYCLE_GROUP}
                focusOrder={PICKER_ORDER_TRASH_ALL}
              />
            </TugConfirmPopover>
          </div>
        </div>
      </PickerCellProvider>
      <div className="tug-sheet-actions">
        {dirMissing && (
          <TugLabel
            className="dev-card-picker-dir-warning"
            emphasis="calm"
            data-testid="dev-card-picker-dir-warning"
          >
            {"Directory doesn't exist"}
          </TugLabel>
        )}
        <TugPushButton
          emphasis="outlined"
          role="action"
          onClick={onCancel}
          focusGroup={PICKER_CYCLE_GROUP}
          focusOrder={PICKER_ORDER_CANCEL}
        >
          Cancel
        </TugPushButton>
        <TugPushButton
          emphasis="primary"
          role="action"
          onClick={submit}
          disabled={openDisabled}
          focusGroup={PICKER_CYCLE_GROUP}
          focusOrder={PICKER_ORDER_OPEN}
          persistentDefaultRing
        >
          Open
        </TugPushButton>
      </div>
      {/*
        Form-owned trash-session confirmation popover. Driven by
        `pendingTrashSessionId` state set by the chain handler on
        `request-trash-session`. Anchored to the requesting row's
        trash icon via a virtualRef populated in the layout effect.
        One instance, N anchor targets — see [D14] / [D15].
      */}
      <TugConfirmPopover
        open={pendingTrashSessionId !== null}
        anchorEl={pendingTrashAnchorEl}
        message={pendingTrashMessage}
        confirmLabel="Trash"
        confirmRole="danger"
        side="left"
        onConfirm={handleConfirmTrash}
        onCancel={handleCancelTrash}
      />
      {/* Form-owned confirm popover for removing a Recent Project Path,
          anchored to the requesting row's trash icon. Mirrors the sessions
          popover above. */}
      <TugConfirmPopover
        open={pendingTrashRecentPath !== null}
        anchorEl={pendingTrashRecentAnchorEl}
        message="Remove from recent paths?"
        confirmLabel="Remove"
        confirmRole="danger"
        side="left"
        onConfirm={handleConfirmTrashRecent}
        onCancel={handleCancelTrashRecent}
      />
      </div>
    </PickerFormResponderScope>
  );
}


interface DevCardBodyProps {
  cardId: string;
  services: DevCardServices;
  /** Z0 — top-of-card content; null collapses the row. */
  headerContent?: React.ReactNode;
  /** Z2 — status-bar content; null collapses the row. */
  statusBarContent?: React.ReactNode;
  /** Z1 — per-turn trailing renderer; invoked once per row half. */
  renderTurnTrailing?: DevTurnTrailingRenderer;
  /** Z4 — prompt-entry footer content; null collapses the slot. */
  footerContent?: React.ReactNode;
}

/**
 * Render the consolidated `<TugPaneBanner>` from a derived spec.
 * The body calls this once with the spec from
 * `deriveDevCardBannerSpec` and the `setDismissedAt` setter the
 * Dismiss footer wires up for the `error` kind. Centralized here so
 * the JSX stays close to its presentation siblings without burying
 * the precedence-chain mapping inside the body's render tree.
 *
 * `kind === "none"` still renders the banner with `visible: false`
 * — the component runs its exit animation and unmounts via its
 * internal `mounted` state, so a switch from kind="error" to "none"
 * (e.g. from a successful retry) animates out cleanly.
 *
 * Reconciliation invariant: every branch returns `<TugPaneBanner>` at
 * the same JSX position with no `key`. React reconciles the branches
 * as a single instance, so the banner can hold props through cross-kind
 * transitions and gate min-mount-time on the way out. Do not key these
 * branches by `spec.kind`; keying would unmount the prior banner
 * instance on every kind change, silently disabling the min-mount-time
 * gate (the new instance has no `shownAtRef` to compare against) and
 * losing the `lastVisiblePropsRef` hold that keeps content stable
 * during exit.
 */
function renderDevCardBanner(
  spec: ReturnType<typeof deriveDevCardBannerSpec>,
  setDismissedAt: (at: number) => void,
): React.ReactElement {
  if (spec.kind === "error") {
    return (
      <TugPaneBanner
        visible={true}
        variant="error"
        tone="danger"
        // Opt out of the min-mount-time gate. A user-visible failure
        // should exit on dismiss without an artificial 500ms hold;
        // dismissal is an explicit user action and any delay reads as
        // unresponsive UI.
        minMountedMs={0}
        label={CAUSE_LABELS[spec.cause]}
        message={spec.message}
        detailIcon="unplug"
        detailTitle={CAUSE_LABELS[spec.cause]}
        footer={
          <TugPushButton
            emphasis="outlined"
            role="danger"
            onClick={() => setDismissedAt(spec.at)}
          >
            Dismiss
          </TugPushButton>
        }
      >
        <p>The card can&apos;t reach its session. Dismiss to continue; close and reopen the card to retry.</p>
      </TugPaneBanner>
    );
  }
  // kind === "none" — banner runs its exit animation if it was
  // previously visible, then unmounts.
  return <TugPaneBanner visible={false} message="" />;
}

/**
 * Bridges the card-scoped `TugPaneBulletin` into the card body's imperative
 * handlers. `useTugPaneBulletin()` must run inside the provider, but `/copy`'s
 * `RUN_SLASH_COMMAND` handler lives in the card body (the provider's parent), so
 * this zero-render child captures the bulletin API onto a ref the handler reads
 * — the same handle-ref pattern the status row uses for `/context`.
 */
const PaneBulletinAnchor = forwardRef<TugPaneBulletinApi>(
  function PaneBulletinAnchor(_props, ref) {
    const paneBulletin = useTugPaneBulletin();
    useImperativeHandle(ref, () => paneBulletin, [paneBulletin]);
    return null;
  },
);

export function DevCardBody({
  cardId,
  services,
  headerContent,
  statusBarContent,
  renderTurnTrailing,
  footerContent,
}: DevCardBodyProps) {
  const { codeSessionStore, sessionMetadataStore, historyStore, completionProviders, argumentHintResolver, inlineCommandMatcher, pastedCommandResolver, editorStore, responseStore, gitDiffStore, skillsInventoryStore, hooksInventoryStore, entryDelegateRef } = services;

  useDevCardObserver(cardId, codeSessionStore);
  useMenuStatePublication(cardId, codeSessionStore, sessionMetadataStore);

  // Imperative handle to the transcript pane. `handleAfterSubmit`
  // reads it to jump the transcript back to the live edge on submit
  // (the transcript is a split-pane sibling of the prompt entry, so
  // the gesture can't bubble through the DOM).
  const transcriptRef = useRef<DevTranscriptHandle | null>(null);
  // Captured by the JSX's composed ref below for the first-mount
  // fade-in animation. Read by a useLayoutEffect with empty deps —
  // the effect runs once when this card first acquires services
  // (binding flip from picker → body, or initial mount on a session
  // restore), animates `.dev-card` opacity 0 → 1 via TugAnimator,
  // and never re-runs. CardHost portals into the host pane and is
  // never remounted across cross-pane moves ([L23] minimal mutation),
  // so empty-deps semantics correctly maps to "once per fresh
  // session bind."
  const devCardRootRef = useRef<HTMLDivElement | null>(null);

  const codeSnap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );

  // An inline dialog is modal for keys ([P06]): while one is pending the prompt
  // entry deactivates (read-only + blurred, no caret) so the dialog owns the
  // keyboard and the prompt visibly stands down. Derived from real store state
  // ([L06]); reactivates when the dialog resolves. Both Permission and Question
  // dialogs are modal-for-keys.
  const inlineDialogPending =
    Boolean(codeSnap.pendingApproval) || Boolean(codeSnap.pendingQuestion);

  // The resume replay window deactivates the prompt the same way — a
  // session mid-reconstruction can't accept input, so no blinking
  // caret until the transcript settles. Same predicate the transcript
  // host's deferred-content hold reads.
  const replayHoldActive =
    codeSnap.phase === "replaying" || deriveColdRestoreActive(codeSnap);

  // When the dialog resolves — or the replay window closes — return focus to
  // the prompt: the card's single focus destination, which reactivates the
  // instant `deactivated` clears. Without this the caret would not come back
  // until the user clicked.
  const entryStoodDown = inlineDialogPending || replayHoldActive;
  const prevEntryStoodDownRef = useRef(false);
  useLayoutEffect(() => {
    if (prevEntryStoodDownRef.current && !entryStoodDown) {
      entryDelegateRef.current?.focus();
    }
    prevEntryStoodDownRef.current = entryStoodDown;
  }, [entryStoodDown]);

  // `/rewind` ([#step-7-3]): when a conversation/both rewind is applied, rewind
  // the prompt history alongside the transcript so Cmd-Up/Down stops recalling
  // the rewound-away prompts. The history is keyed by the stable `tugSessionId`
  // (a fork doesn't change it), so we truncate it to the retained user-prompt
  // count — recomputed from the just-truncated transcript, so it's idempotent
  // and can never drop a prompt the user sent AFTER the rewind. The ref keeps
  // it to one apply per ack. This is a cross-store coordination effect reacting
  // to a store transition (not React-state copying — [L02]); `codeSnap` is read
  // fresh at fire time, which is why it's intentionally out of the deps.
  const processedRewindRef = useRef<CodeSessionSnapshot["lastRewindResult"]>(null);
  const lastRewindResult = codeSnap.lastRewindResult;
  useEffect(() => {
    if (
      lastRewindResult === null ||
      lastRewindResult === processedRewindRef.current
    ) {
      return;
    }
    processedRewindRef.current = lastRewindResult;
    if (
      !lastRewindResult.canRewind ||
      (lastRewindResult.scope !== "conversation" &&
        lastRewindResult.scope !== "both")
    ) {
      return;
    }
    const retainedPrompts = codeSnap.transcript.filter(
      (t) => t.messages[0]?.kind === "user_message",
    ).length;
    historyStore.truncateSession(codeSnap.tugSessionId, retainedPrompts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- codeSnap read fresh at fire time
  }, [lastRewindResult, historyStore]);

  // --- Banner derivation. ---
  // UI-only dismiss: track the `at` timestamp of the last-dismissed error.
  // A new error (different `at`) naturally reappears. The store owns the
  // clear semantics — on retry submit or turn_complete(success) the snapshot
  // transitions to `lastError: null` and the derivation drops the banner.
  // `resume_failed` is filtered out by the helper because
  // `useDevCardObserver` is about to clear the binding and route that
  // cause through the picker.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const bannerSpec = deriveDevCardBannerSpec(codeSnap, { dismissedAt });

  // Once the session hits any non-recoverable error, disable the entry —
  // the dismiss gesture only hides the banner, the underlying session is
  // still dead. The user recovers by closing and reopening the card.
  // Two causes are excluded from this dead-session classification:
  //  - `resume_failed`: the card observer unmounts the bound body on
  //    that cause (the picker sheet re-renders instead).
  //  - `attachment_rejected`: transient input-validation feedback
  //    (drop / paste of an unsupported file, oversize image, etc.).
  //    The session is otherwise healthy; the next submit can proceed
  //    without retry. Escalating it to the session-dead overlay was a
  //    Step 3 v1 defect surfaced by live testing (Step 3.5.1 in
  //    `roadmap/dev-atoms.md`).
  const sessionErrored =
    codeSnap.lastError !== null &&
    codeSnap.lastError.cause !== "resume_failed" &&
    codeSnap.lastError.cause !== "attachment_rejected";

  // Keyboard-focus-cycling ([P09]/[P10]). ⌥⇥ trades the editor's Tab for
  // a trapped tour of the card's chrome zones (the submit is the
  // commit-home seed). Only the connected body cycles — the picker never
  // mounts this — and a dead session is ineligible so the toggle can't
  // strand a useless ring. `cycling` is engine-derived in the hook
  // ([L02]); the toggle is wired to `CYCLE_FOCUS_MODE` on the
  // card-content responder below, `CycleScope` wraps the prompt entry,
  // and `data-cycling` rides the card root for the fill-suppression CSS.
  // The cycle's resting destination ([P12]): a connected card's resting focus is
  // the prompt entry — a responder (caret), not a focus-group stop. The cycle
  // lands the caret here on every relinquish (⌥⇥ toggle-off, the editor stop's
  // Return-descend, or a sub-surface commit that relinquishes the cycle, [P15]),
  // skipping a mouse exit. Owning this in `useCycleMode` makes the relinquish
  // landing first-class, not bespoke per-card glue.
  const cycle = useCycleMode({
    enabled: !sessionErrored,
    restingFocus: () => entryDelegateRef.current?.focus(),
  });

  // Count of Z4C compose-phase attachment tiles, surfaced from the prompt
  // entry's image-atom set so the spatial grid can size the attachment row to
  // exactly the live tiles. The navigator's liveliness net ([#step-7-8]) makes
  // a brief count↔registration mismatch harmless (an absent ring target falls
  // through to the linear walk, never a beep or a dead-arrow warning), so this
  // does not have to be frame-perfect with the tile registrations.
  const [attachmentCount, setAttachmentCount] = useState(0);

  // Whether the PULSE label is a live cycle stop: the strip renders (and so
  // registers its leaf) exactly while the `pulse/enabled` default is on AND a
  // status bar is present — and the status bar always is in the real card
  // (`effectiveZ2` falls back to the status row). A narrow boolean selector so
  // this re-renders only when the kill switch flips, not per pulse line.
  const pulseStopPresent = usePulseEnabled();

  // Spatial arrow order for the cycle ([P22] / [P23]). Tab walks the cycle stops
  // linearly; arrows give them a 2D feel: horizontal rings — the bottom toolbar
  // (route → mode → model → effort → submit), the Z2 status cells, and (while
  // composing with attachments) the Z4C tiles — with a vertical seam cycle
  // between the rows. The editor (the text body) is reached by Tab / typing, not
  // arrows: it is deactivated while cycling and a focused editor keeps its caret
  // arrows ([P25] editing-host yield), so it is deliberately left OUT of the grid.
  // The chips disable on the Shell route; the navigator skips a disabled ring
  // target onto the next live stop, so this grid needs no per-route membership.
  // The attachment row is sized to the live tile count (an empty row is dropped
  // by rowGridOrder, so a no-attachment compose runs as the two-row grid).
  // Declared under the cycle scope so it is consulted exactly while cycling. All
  // leaf stops — no delegated group, so no list-as-handle or edge-landing
  // primitive is needed here.
  const cycleSpatialOrder = useMemo<SpatialOrder>(() => {
    const k = (order: number) => `${DEV_CYCLE_GROUP}:${order}`;
    return rowGridOrder([
      [
        k(DEV_CYCLE_ORDER_ROUTE),
        k(DEV_CYCLE_ORDER_CLAUDE_CODE),
        k(DEV_CYCLE_ORDER_SESSION),
        k(DEV_CYCLE_ORDER_PROJECT),
        k(DEV_CYCLE_ORDER_MODE),
        k(DEV_CYCLE_ORDER_MODEL),
        k(DEV_CYCLE_ORDER_EFFORT),
        k(DEV_CYCLE_ORDER_SUBMIT),
      ],
      [
        k(DEV_CYCLE_ORDER_STATUS_BASE + 0),
        k(DEV_CYCLE_ORDER_STATUS_BASE + 1),
        k(DEV_CYCLE_ORDER_STATUS_BASE + 2),
        k(DEV_CYCLE_ORDER_STATUS_BASE + 3),
        k(DEV_CYCLE_ORDER_STATUS_BASE + 4),
        k(DEV_CYCLE_ORDER_STATUS_BASE + 5),
      ],
      // PULSE — a one-node row beneath the status cells (rowGridOrder drops it
      // when the strip is hidden, so Down from a status cell reaches the editor
      // / attachments instead). A lone node gets no horizontal ring; the seams
      // carry Up / Down across it.
      pulseStopPresent ? [k(DEV_CYCLE_ORDER_PULSE)] : [],
      Array.from({ length: attachmentCount }, (_, i) =>
        k(DEV_CYCLE_ORDER_ATTACHMENT_BASE + i),
      ),
    ]);
  }, [attachmentCount, pulseStopPresent]);
  useSpatialOrder(cycle.scopeId, cycleSpatialOrder);


  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );

  // Bind the pane element for CSS variable cascade
  // (`--tug-font-family-editor` / `--tug-font-size-editor` /
  // `--tug-letter-spacing-editor` / `--tug-line-height-editor`). The
  // `regenerateAtoms` callback re-renders SVG atom glyphs when the
  // editor font changes, so atoms track the editor's chosen font.
  const paneRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    // `regenerateAtoms` re-renders the SVG atom glyphs when the editor
    // font changes via the tools popover — atoms must track the editor
    // font so a chosen monospace actually reaches the atom chip labels.
    editorStore.bind(el, () => entryDelegateRef.current?.regenerateAtoms());
    return () => editorStore.unbind();
  }, [editorStore]);

  // Focus the prompt editor at meaningful moments:
  //
  //   - Construction: fires once when the card body first mounts.
  //     Guarantees a caret the moment the editor appears.
  //
  //   - Activation: fires on every path that makes this card the
  //     active card — click, Ctrl+`, programmatic activation, and
  //     post-close-of-active (auto-activate new top). By definition
  //     the card is active when this fires.
  //
  //   - Will-deactivate: fires when this card is about to lose
  //     active status (another card is being activated, including
  //     via new-card creation). Blur the editor here so the caret
  //     doesn't linger on a background card.
  //
  //   - Move / Resize: fires whenever this card's geometry commits.
  //     Cmd-drag and Cmd-resize move/resize a card WITHOUT activating
  //     it (a deliberate convenience for rearranging background cards
  //     without disturbing focus). We therefore guard the focus
  //     re-assertion with `getFirstResponderCardId() === cardId` so a
  //     background-card Cmd-drag does not steal focus from whatever
  //     card the user is actually working in.
  //
  // The focus paths route through `entryDelegate.focus()`, which is
  // idempotent if the editor already holds focus and places a caret
  // if the Selection has been cleared (e.g., by the selection guard).
  // `cardDidActivate` / `cardWillDeactivate` are the sole focus-management
  // path. The construction focus call is dropped — construction alone
  // does not make a card first responder (it may mount inside an
  // inactive stack). The follow-on `_flipFirstResponder` fires
  // `cardDidActivate` when the new card actually becomes FR, which
  // drives focus via the delegate handler below.
  //
  // `cardDidMove` / `cardDidResize` re-assert focus only when this card
  // is the deck's composite first responder — top-of-z-order can
  // drift from the composite bit when `activePaneId` does not match
  // the top pane (post-detach or post-move edge cases).
  const cardLifecycle = useCardLifecycle();

  useCardDelegate(cardId, {
    cardDidActivate: () => {
      // Phase E.11 Step 4h — macrotask focus claim retired.
      // The single-channel `applyBagFocus` dispatcher (called
      // synchronously from `transferFocusForActivation`) is now
      // the only path that writes activation focus, and it
      // invokes the engine via the registered engine hook (4e)
      // for engine kinds — no macrotask, no MessageChannel
      // deferral. The previous `entryDelegateRef.current?.focus()`
      // here drained AFTER the framework's claim and clobbered
      // framework-axis targets like the find input ([L05]
      // timing-derived ordering violation; [L23] single-channel
      // violation). See `tuglaws/state-preservation.md`
      // [Focus dispatch model] and
      // `docs/notes/focus-gesture-lock-investigation.md`.
      //
      // `cardDidMove` / `cardDidResize` keep their delegate focus
      // claims — those handlers fire on gestures that already
      // moved the card's DOM identity (cross-pane move, resize)
      // and re-asserting focus on the editor is the only path
      // that recovers from the inherent re-mount.
    },
    // `cardWillDeactivate` deliberately does NOT call
    // `entryDelegateRef.current?.blur()`. Calling .blur() on the
    // contenteditable here clears any non-collapsed selection the
    // user has placed. When the cascade
    // fires from `applicationWillResignActive` (cmd-tab away), the
    // OS already removes focus from the WKWebView; an additional
    // explicit blur destroys the selection BEFORE the
    // window-blur save flushes the bag, so on cmd-tab back the
    // engine's `getSelectedRange()` returns null and the
    // refocus-on-activation places a caret at end-of-content
    // instead of restoring the user's selected span.
    cardDidMove: () => {
      if (cardLifecycle?.getFirstResponderCardId() !== cardId) return;
      deckTrace.record({
        kind: "macrotask-focus-claim",
        cardId,
        delegate: "cardDidMove",
      });
      entryDelegateRef.current?.focus();
    },
    cardDidResize: () => {
      if (cardLifecycle?.getFirstResponderCardId() !== cardId) return;
      deckTrace.record({
        kind: "macrotask-focus-claim",
        cardId,
        delegate: "cardDidResize",
      });
      entryDelegateRef.current?.focus();
    },
  });

  // ── Editor focus contract — `inert` / `didHide` invariant ───────────────
  //
  // **Contract** ([L24] structure-zone events drive structure-zone
  // effects): every overlay that sets `inert` on this card's
  // `.tug-pane-body` MUST emit a per-card `xxxDidHide` lifecycle event
  // after `inert` is cleared, and `DevCardBody` MUST subscribe with
  // an idempotent focus claim gated on this card being first
  // responder. Adding a new overlay that violates the contract
  // silently breaks the editor's caret on dismissal.
  //
  // Why it matters: the browser strips focus from any element inside
  // an `inert` subtree, and CodeMirror's caret layer paints only
  // while `view.hasFocus`. Without a re-focus after `inert` clears,
  // the editor is reachable but unfocused — the user clicks the
  // pane, sees no caret, and types into a void. The
  // `<overlay>DidHide` event fires from inside the same React commit
  // that clears `inert` (see `tug-pane-banner.tsx` /
  // `tug-sheet.tsx`), so claiming focus here lands DOM focus the
  // moment the body becomes interactive again — no race window.
  //
  // **Today's overlays satisfying the contract:**
  //
  //   - `TugSheet` → `sheetDidHide`. Covers the picker → "Open" →
  //     bind → editor-mount path; also covers the editor-settings
  //     sheet's open/close cycle for an already-mounted body.
  //   - `TugPaneBanner` → `bannerDidHide`. Covers status banners
  //     (resume-loading, transport-restoring) that mount during
  //     session-init, set inert, blur the editor, then unmount
  //     when their triggering condition resolves.
  //
  // The focus call is idempotent — `manager.focusResponder(editorId)`
  // against an already-focused editor is a no-op for chain state
  // AND for DOM focus when contentDOM is already `activeElement`.
  // Composing two emitters (sheet + banner) costs one stale call
  // per cycle; the cost is bounded and worth the simpler invariant.
  //
  // Pinned by `tests/app-test/at0175-dev-mount-focus.test.ts`. A
  // future overlay that sets `inert` without emitting `didHide`
  // breaks at0051; the test exists exactly so the contract isn't
  // re-discovered the hard way. See
  // `roadmap/tugplan-dev-session-init-orchestration.md` [V03] for
  // the bug history.
  //
  // [L11] the banner / sheet are status surfaces that emit lifecycle
  //       events; this card is the responder that re-claims focus.
  // [L23] focus + caret are user-visible state — preserved across
  //       every overlay show/hide cycle by this contract.
  // [L24] structure-zone (`inert` clearing) drives structure-zone
  //       (focus reclaim) via the per-overlay event pipe.
  // Dev-card's one focus destination is its `tug-prompt-entry`.
  // Several lifecycle triggers need to re-claim it; each is gated on
  // this card being first responder so a background-card event never
  // steals focus from the card the user is actually in. The
  // guard-and-claim is consolidated here so it is one named thing,
  // not a copy per trigger. (`cardDidMove` / `cardDidResize` keep
  // their own inline form — they additionally emit a
  // `macrotask-focus-claim` trace event.)
  const reclaimEntryFocus = useCallback((): void => {
    if (cardLifecycle?.getFirstResponderCardId() !== cardId) return;
    // While cycling, the cycle owns focus — a sheet opened from a cycle stop
    // returns to its stop (the retain disposition) or relinquishes via the engine
    // (the cycle's `restingFocus` lands the caret). Either way the card must NOT
    // also reclaim the editor here, or it would clobber the chip restore on a
    // retain close ([P15]). This reclaim is for sheets/banners closed outside a
    // cycle (a slash-command picker, a banner).
    if (cycle.cycling) return;
    entryDelegateRef.current?.focus();
  }, [cardLifecycle, cardId, entryDelegateRef, cycle]);

  useSheetDelegate(cardId, {
    sheetDidHide: () => {
      reclaimEntryFocus();
    },
  });
  useBannerDelegate(cardId, {
    bannerDidHide: () => {
      reclaimEntryFocus();
    },
  });

  // Picker → body handoff focus claim. The picker sheet's `didHide`
  // fires when its exit animation finishes; the body only mounts a
  // few milliseconds later, once `spawn_session_ok` flips the
  // binding. So the `sheetDidHide` subscription above is registered
  // too late to catch the picker's dismissal — by the time this
  // body exists, the event has already passed. Claim focus once on
  // mount instead, through the same first-responder-gated helper
  // (the body can also mount inside an inactive stack on cold-boot /
  // restore, where the cold-boot RESTORE path owns focus).
  useLayoutEffect(() => {
    reclaimEntryFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── First-mount fade-in ─────────────────────────────────────────────────
  //
  // Coordinate the picker → body handoff: the picker sheet is in the
  // last frames of its exit translate when binding lands and this
  // body mounts. Without an enter animation the body snaps in
  // abruptly while the sheet is still translating — the two motions
  // don't share a beat. A brief opacity fade lets the body materialize
  // alongside the sheet's exit so the transition reads as a single
  // gesture rather than a hard appearance.
  //
  // Mechanics: empty-deps `useLayoutEffect` runs exactly once when
  // this card first acquires services. It captures the root element
  // via `devCardRootRef.current`, sets opacity to "0" synchronously
  // (so the first paint after commit shows the start state without a
  // flash), then opens a TugAnimator group that animates opacity
  // 0 → 1 over `--tug-motion-duration-moderate` with `ease-out`. The
  // group's `commitStyles()` lands the final value (opacity 1) on
  // the element when the animation finishes; `cancel()` removes the
  // animation handle. Reduced-motion users opt out automatically via
  // `isTugMotionEnabled()` inside `tug-animator` (the spatial-strip
  // path doesn't apply here — opacity has no spatial component — but
  // duration shortens to `--tug-motion-duration-fast`).
  //
  // [L13] TugAnimator owns programmatic motion that coordinates with
  //       React mount; CSS keyframes would require a parallel "first-
  //       mount-only" attribute, which is needless complexity for a
  //       one-shot animation.
  // [L14] Radix Presence is not in play here — the body's mount is
  //       driven by the binding flip, not a Radix `data-state`
  //       transition, so we are firmly in TugAnimator's lane.
  // [L23] opacity is appearance-zone state and the animation does
  //       not touch focus, selection, or scroll position. The
  //       editor's caret-layer paints behind the fade and ramps in
  //       with the rest of the body. The focus contract documented
  //       above is unaffected — the fade does not set `inert` and
  //       does not interfere with `view.hasFocus`.
  // [L24] structure-zone (`DevCardBody` mount) drives appearance-
  //       zone (opacity ramp); the WAAPI animation writes directly
  //       to the DOM, never round-tripping through React state ([L02]
  //       does not apply because this is appearance, not data).
  //
  // No cleanup is registered: if the body unmounts mid-fade, the
  // WAAPI animation is garbage-collected with the detached element.
  // `commitStyles()` inside tug-animator catches the
  // `InvalidStateError` thrown when the element is no longer
  // rendered, so the late `.finished` resolution is harmless.
  useLayoutEffect(() => {
    const el = devCardRootRef.current;
    if (el === null) return;
    // No materialize fade on a restore-mount (Developer ▸ Reload /
    // cold-boot rehydration). The fade exists only to coordinate the
    // picker → body handoff (share a beat with the picker sheet's
    // exit); a restore has no picker to coordinate with, so the fade
    // reads as a gratuitous flash on top of the reveal. Skip it when
    // the card mounts into the cold-restore / replay window; keep it
    // for a genuine picker → new-card creation. The signal is read
    // fresh from the store at mount ([L02] effects may read stores
    // directly), the same predicate `replayHoldActive` derives.
    const snap = codeSessionStore.getSnapshot();
    if (snap.phase === "replaying" || deriveColdRestoreActive(snap)) return;
    // Set the start state inline so the first paint after commit
    // shows opacity:0 — WAAPI's pending-phase doesn't apply the
    // first keyframe with the default `fill: forwards`. Cleared on
    // animation completion via tug-animator's commitStyles() path.
    el.style.opacity = "0";
    const g = group({ duration: "--tug-motion-duration-moderate" });
    g.animate(
      el,
      [{ opacity: 0 }, { opacity: 1 }],
      { key: "dev-card-enter", easing: "ease-out" },
    );
    // Run once on first mount; never re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Return focus to the editor after a successful submit so the user
  // can type the next prompt immediately, and pull the transcript
  // back to the live edge. `onAfterSubmit` fires from `performSubmit`
  // only on the send/handled path — not on the Stop (canInterrupt)
  // branch, not on blocked submits — so failures that surface later
  // via `lastError` are inspectable without the caret yanking back
  // mid-read.
  //
  // `scrollToBottom` re-engages follow-bottom: if the user had
  // scrolled up to read history, their fresh submit jumps the
  // transcript down so the new turn (and the response streaming into
  // it) is in view. Once follow-bottom is re-engaged the new turn row
  // pins automatically via the list's post-commit pin.
  //
  // Submitting always collapses the entry: the cleared editor drives the
  // content sizer back to the opening floor. Keeps the transcript readable
  // after every send.
  const handleAfterSubmit = useCallback(() => {
    transcriptRef.current?.scrollToBottom();
    entryDelegateRef.current?.focus();
  }, [entryDelegateRef]);

  // Z2 telemetry popovers → transcript scroll. The Time / Tokens
  // popovers render each turn's `#NNNN` entry pair as buttons;
  // clicking one lands here with that entry's transcript row index.
  // `block: "start"` pins the entry's top flush to the viewport top.
  // The handle is read at call time ([L07]) so a not-yet-mounted
  // transcript is a safe no-op.
  const handleScrollToRow = useCallback((rowIndex: number): void => {
    transcriptRef.current?.scrollToIndex(rowIndex, {
      block: "start",
      animated: true,
    });
  }, []);

  // Card-content responder scope for key-card-routed keyboard
  // shortcuts. Registers a `kind: "card-content"` node under the
  // dev card's body element; any keybinding with `scope: "key-card"`
  // (declared in keybinding-map.ts) is dispatched here when this is
  // the active card. The chain walks UP from this node, so
  // unhandled actions fall through to the card-level responder,
  // canvas, and root — same semantics as any other chain walk.
  //
  // Handlers:
  //   - FOCUS_PROMPT (⌘K): move keyboard focus to the prompt editor.
  //     Reads the delegate via the ref [L07] so the handler closure
  //     registered at mount never goes stale.
  // Permission-mode cycle + per-card persistence/restore ([D02], [D03],
  // [D07]). `cycle` advances default → acceptEdits → plan → auto → … and
  // sends the `permission_mode` frame; the Z4B chip reflects the result
  // from the next `system_metadata`. Bound to ⇧⇥ below.
  const permissionMode = usePermissionMode({
    cardId,
    codeSessionStore,
    sessionMetadataStore,
  });

  // The single permission sheet, owned at the card level so the chip click
  // and the `/permissions` slash command present the same sheet ([#step-1c]).
  // One shared sheet host for the card's pickers, so opening one (chip or
  // slash command) replaces any other open picker instead of stacking a
  // second sheet on top of it ([#step-2b]).
  const cardPickerSheet = useTugSheet();

  const permissionSheet = usePermissionSheet({
    cardId,
    sessionMetadataStore,
    onSelectMode: permissionMode.setMode,
    showSheet: cardPickerSheet.showSheet,
    commitDisposition: DEV_CYCLE_PICKER_COMMIT_DISPOSITION,
  });

  // The `/permissions` rules editor, owned at the card level so the slash
  // command opens it card-scoped ([D15]). Reads the session `cwd` fresh at
  // open time; a no-op until session metadata reports a cwd.
  const permissionRulesSheet = usePermissionRulesSheet({
    cardId,
    sessionMetadataStore,
    codeSessionStore,
    showSheet: cardPickerSheet.showSheet,
  });

  const modelPicker = useModelPicker({
    codeSessionStore,
    sessionMetadataStore,
    showSheet: cardPickerSheet.showSheet,
    commitDisposition: DEV_CYCLE_PICKER_COMMIT_DISPOSITION,
  });

  // `/rewind` turn picker + restore confirm ([#step-7-3]), card-scoped per
  // [D15]. Reads the transcript fresh at open time; the popup already gates
  // the command on having a rewind target, and `openRewindSheet` no-ops if
  // there is none.
  const rewindSheet = useRewindSheet({
    codeSessionStore,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/resume` focused sessions overlay ([#step-8]), card-scoped per [D15].
  // Reads the bound project from the binding store and lists its sessions;
  // picking one rebinds this card to that conversation. Distinct from the
  // full-card `DevProjectPicker` (unbound state) and from `/rewind`.
  const resumeSheet = useResumeSheet({
    cardId,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/diff` uncommitted-changes sheet ([#step-10b]), card-scoped per [D15].
  // Fires `git_diff_request` for this card's project dir on open; the response
  // renders as a per-file `TugAccordion`. Single-shot, not a feed ([D21]).
  const diffSheet = useDiffSheet({
    gitDiffStore,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/skills` listing sheet ([#step-12d]), card-scoped per [D15]. Fires
  // `skills_inventory_query` on open; the response renders as a read-only
  // `TugListView`. Single-shot, not a feed.
  const skillsSheet = useSkillsSheet({
    skillsInventoryStore,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/agents` listing sheet ([#step-12b]), card-scoped per [D15]. A simple
  // read-only directory of the subagents Claude can delegate to — projected
  // from the agent names already in `SessionMetadataStore.slashCommands`.
  const agentsSheet = useAgentsSheet({
    sessionMetadataStore,
    codeSessionStore,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/memory` listing sheet ([#step-12a]), card-scoped per [D15]. Lists the
  // project / user / auto-memory destinations; a row hands its path to the OS
  // (file → editor, folder → Finder) via the host `openPath` bridge.
  const memorySheet = useMemorySheet({
    sessionMetadataStore,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/hooks` listing sheet ([#step-12c]), card-scoped per [D15]. Fires
  // `hooks_query` on open; the response renders as a read-only `TugAccordion`
  // of hook events. Single-shot, not a feed.
  const hooksSheet = useHooksSheet({
    hooksInventoryStore,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/help` tabbed sheet ([#step-13b2]) per [D16], card-scoped per [D15]. A
  // General tab (Dev + shortcuts + the unsupported-commands doc link) over a
  // Commands / Custom-commands browse of the session catalog, projected through
  // the [D14] allowlist so it lists exactly what the slash popup offers.
  const helpSheet = useHelpSheet({
    cardId,
    sessionMetadataStore,
    showSheet: cardPickerSheet.showSheet,
  });

  // `/rename` session name ([#step-13d]). `/rename <text>` sets it directly;
  // bare `/rename` opens a one-field dialog seeded with the current name. Both
  // optimistically update the Z4B chip and send `rename_session` to tugcast.
  const renameSheet = useRenameSessionSheet({
    cardId,
    showSheet: cardPickerSheet.showSheet,
  });

  // Reasoning-effort set path + per-card persistence/restore ([#step-4],
  // [D07]). `setEffort` sends `effort_change` (tugcode respawns with
  // `--effort` + `--resume`, [R07]); the effort chip + picker funnel through
  // it. The shared picker (chip press / future `/effort`) reads the active
  // model's supported levels fresh at open time.
  const effort = useEffort({
    cardId,
    codeSessionStore,
    sessionMetadataStore,
  });

  const effortPicker = useEffortPicker({
    sessionMetadataStore,
    onSelectEffort: effort.setEffort,
    showSheet: cardPickerSheet.showSheet,
    commitDisposition: DEV_CYCLE_PICKER_COMMIT_DISPOSITION,
  });

  // Surface for each local slash command, keyed by command name. The
  // `as const satisfies` registry narrows `LocalCommandName` to the literal
  // union, so this `Record` is exhaustive — a registered command without a
  // wired surface is a compile error ([#step-1c] / [D23]).
  // Handle on the Z2 status row so `/context` can pop its CONTEXT
  // popover — the breakdown is already a click on that cell; the slash
  // command just opens the same surface (no separate sheet). Null while
  // the row isn't the current Z2 datum, in which case the call no-ops.
  const statusRowRef = useRef<DevTelemetryStatusRowHandle>(null);
  // Pane-scoped bulletin API, captured from inside the provider by
  // `PaneBulletinAnchor` (rendered below) so `/copy` can raise its
  // confirmation toast in this card.
  const paneBulletinRef = useRef<TugPaneBulletinApi>(null);

  // Close out a `/compact` run: when the progress store reaches a terminal
  // outcome, clear the store — which dismisses the progress sheet (it watches
  // the same store). Success is self-evident (the fresh session swaps in with
  // its Compaction Summary), so it raises no bulletin; cancel / failure DO,
  // since nothing visible changed. [L02] store state via `useSyncExternalStore`.
  const compactionProgress = useSyncExternalStore(
    compactionProgressStore.subscribe,
    compactionProgressStore.getSnapshot,
  );
  useEffect(() => {
    if (
      compactionProgress === null ||
      compactionProgress.outcome === null ||
      compactionProgress.cardId !== cardId
    ) {
      return;
    }
    const notify = paneBulletinRef.current;
    if (compactionProgress.outcome === "succeeded") {
      // The fresh session has already swapped in behind the (still-steady)
      // scrim. Hold the sheet for a couple of frames so the new transcript
      // paints and settles before we dismiss — otherwise the scrim lifts in
      // the same beat the session swaps, and the swap reads as a flash.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => compactionProgressStore.clear());
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (raf2 !== 0) cancelAnimationFrame(raf2);
      };
    }
    if (compactionProgress.outcome === "canceled") {
      notify?.caution("Compaction canceled — session left intact");
    } else {
      notify?.danger(compactionProgress.failureReason ?? "Compaction failed");
    }
    // Cancel / failure leave the session unchanged — no swap to mask, so
    // dismiss immediately.
    compactionProgressStore.clear();
  }, [compactionProgress, cardId]);

  const slashCommandSurfaces: Record<LocalCommandName, (args: string) => void> = {
    permissions: () => permissionRulesSheet.openRulesSheet(),
    model: () => modelPicker.openModelPicker(),
    effort: () => effortPicker.openEffortPicker(),
    mode: () => permissionSheet.openPermissionSheet(),
    rewind: () => rewindSheet.openRewindSheet(),
    resume: () => resumeSheet.openResumeSheet(),
    diff: () => diffSheet.openDiffSheet(),
    context: () => statusRowRef.current?.openContextPopover(),
    skills: () => skillsSheet.openSkillsSheet(),
    agents: () => agentsSheet.openAgentsSheet(),
    memory: () => memorySheet.openMemorySheet(),
    hooks: () => hooksSheet.openHooksSheet(),
    // Copy the most recent assistant message (committed transcript only, read
    // live at click time per [L07]) to the clipboard, with a pane-scoped
    // confirmation bulletin. No message yet → caution; clipboard failure →
    // danger; both surface in this card, not the deck.
    copy: () => {
      const notify = paneBulletinRef.current;
      const text = lastAssistantCopyText(
        codeSessionStore.getSnapshot().transcript,
      );
      const writeText = navigator.clipboard?.writeText.bind(navigator.clipboard);
      if (text === null || writeText === undefined) {
        notify?.caution("No message to copy yet");
        return;
      }
      void writeText(text).then(
        () => notify?.success("Most recent message copied"),
        () => notify?.danger("Copy failed"),
      );
    },
    help: () => helpSheet.openHelpSheet(),
    // Start a fresh session in this card ([#step-13b3]). Spawn a new session
    // (the spawn ack flips this card's binding → `cardServicesStore` swaps in
    // a fresh, empty store: the transcript resets without ever wiping it,
    // [L23]), then close the old subprocess. The card stays bound throughout
    // (old → new), so the project picker never flashes. The previous session
    // persists on disk and is resumable via `/resume` if it had committed
    // turns. No-op when the card isn't bound (nothing to clear). Reads the
    // binding live at click time ([L07]).
    clear: () => {
      const binding = cardSessionBindingStore.getBinding(cardId);
      const connection = getConnection();
      if (binding === undefined || connection === null) return;
      const newSessionId = crypto.randomUUID();
      sendSpawnSession(
        connection,
        cardId,
        newSessionId,
        binding.projectDir,
        "new",
      );
      sendCloseSessionKeepingBinding(connection, cardId, binding.tugSessionId);
    },
    // `/compact [focus]` — real compaction over the bridge (claude exposes
    // no native trigger). Summarize the current session, then continue in
    // a *fresh* session seeded with the summary (spike-verified). A
    // pane-modal progress sheet covers the card for the duration, with a
    // Cancel button that interrupts the summarization.
    //
    // The summarization turn is sent *suppressed*: it never enters the
    // transcript, so the user never sees a raw recap streaming and a
    // Cancel / failure leaves the session pristine (nothing committed).
    // The summary is captured from the in-flight `ActiveTurnSnapshot`'s
    // live messages instead of a committed turn. On success the fresh
    // session is spawned (the `/clear` path); the `dev-session-restore`
    // live-hook delivers the summary as a suppressed seed, sets the
    // compaction divider, and calls `compactionProgressStore.succeed()`.
    // Reads live ([L07]).
    compact: (args) => {
      const notify = paneBulletinRef.current;
      const binding = cardSessionBindingStore.getBinding(cardId);
      const connection = getConnection();
      if (binding === undefined || connection === null) return;
      const snap0 = codeSessionStore.getSnapshot();
      if (!snap0.canSubmit) {
        notify?.caution("Can't compact while a turn is in flight");
        return;
      }
      const focus = args.trim();
      const oldTugSessionId = binding.tugSessionId;
      const projectDir = binding.projectDir;

      // Run-local state shared by the turn watcher, the Cancel button, and
      // the sheet's close-on-Escape path.
      let sawActive = false;
      let canceled = false;
      let failed = false;
      let interrupted = false;
      let latestProse = "";

      const onCancel = (): void => {
        if (canceled) return;
        canceled = true;
        // Stop the suppressed summarization turn. Nothing was committed, so
        // the session is intact; the watcher just unsubscribes when the
        // turn ends. The card raises the "canceled" bulletin off the store.
        codeSessionStore.interrupt();
        compactionProgressStore.cancel();
      };

      // Watch the in-flight summarization turn. While it streams, tick the
      // progress bar off the assistant prose so far (a streamed-volume
      // proxy — there is no true total to report) and keep the latest prose
      // as the captured summary. When the turn ends, decide success vs.
      // abort. A suppressed turn commits nothing, so the end is detected by
      // the `activeTurn` non-null → null transition, not transcript growth.
      const unsubscribe = codeSessionStore.subscribe(() => {
        const snap = codeSessionStore.getSnapshot();
        const active = snap.activeTurn;
        if (active !== null) {
          // The summarization turn was interrupted by *some* path — the
          // Cancel button, the menu's Stop, or Escape's interrupt ladder.
          // Whatever the trigger, treat it as a cancel: never spawn a fresh
          // session from a half-finished summary. Latched here (the turn is
          // still in-flight during the interrupt round-trip) and acted on at
          // the active → null transition below.
          if (snap.interruptInFlight) interrupted = true;
          // The summarization turn runs suppressed, so an approval/question
          // prompt it draws has no surface to answer — that would deadlock
          // the card. Fail safe instead: interrupt and leave the session
          // intact. The `failed` flag settles the run once so the ensuing
          // active → null transition doesn't also take the success path.
          if (snap.phase === "awaiting_approval") {
            if (failed || canceled) return;
            failed = true;
            unsubscribe();
            codeSessionStore.interrupt();
            compactionProgressStore.fail(
              "Compaction failed — session left intact",
            );
            return;
          }
          sawActive = true;
          const prose = assistantProseFromMessages(active.messages);
          if (prose.length > 0) latestProse = prose;
          compactionProgressStore.setProgress(
            "summarizing",
            Math.min(0.9, prose.length / (prose.length + 1800)),
          );
          return;
        }
        if (!sawActive) return; // turn hasn't started yet
        unsubscribe();
        if (canceled) return; // user stopped it — store already settled
        if (interrupted) {
          // Interrupted by Escape/Stop (not the Cancel button, which already
          // settled the store): treat it exactly like Cancel — settle the run
          // canceled and leave the session intact. NEVER spawn from the
          // partial summary.
          compactionProgressStore.cancel();
          return;
        }
        if (snap.lastError !== null || snap.phase === "errored") {
          compactionProgressStore.fail(
            "Compaction failed — session left intact",
          );
          return;
        }
        if (latestProse.length === 0) {
          compactionProgressStore.fail(
            "Compaction failed — no summary produced",
          );
          return;
        }
        compactionProgressStore.setProgress("respawning", 0.95);
        const newSessionId = crypto.randomUUID();
        pendingCompactionStore.set(newSessionId, {
          summary: latestProse,
          preTokens: null,
        });
        sendSpawnSession(connection, cardId, newSessionId, projectDir, "new");
        sendCloseSessionKeepingBinding(connection, cardId, oldTugSessionId);
        // Watchdog: the fresh session must still spawn, bind, and seed
        // (the `dev-session-restore` hook calls `succeed()`). This phase
        // can't be canceled, so if that handshake never lands, fail rather
        // than leave the sheet spinning forever. Cleared the instant this
        // run settles.
        const watchdog = setTimeout(() => {
          if (compactionProgressStore.getSnapshot()?.outcome === null) {
            compactionProgressStore.fail(
              "Compaction failed — could not start a fresh session",
            );
          }
        }, COMPACTION_RESPAWN_TIMEOUT_MS);
        const unsubWatchdog = compactionProgressStore.subscribe(() => {
          const st = compactionProgressStore.getSnapshot();
          if (st === null || st.outcome !== null) {
            clearTimeout(watchdog);
            unsubWatchdog();
          }
        });
      });

      // Open the run, present the modal sheet, then send the suppressed
      // turn. If the sheet is dismissed (Escape / Cmd-.) while still
      // *summarizing*, treat that as Cancel. Once respawning there is
      // nothing to cancel — let the run finish and surface its own bulletin.
      compactionProgressStore.begin(cardId);
      void cardPickerSheet
        .showSheet({
          title: "Compacting",
          icon: "Archive",
          hideHeaderRule: true,
          content: (close) => (
            <CompactionProgressSheet close={close} onCancel={onCancel} />
          ),
        })
        .then(() => {
          const st = compactionProgressStore.getSnapshot();
          if (st !== null && st.outcome === null && st.phase === "summarizing") {
            onCancel();
          }
        });
      codeSessionStore.send(
        buildSummarizationPrompt(focus.length > 0 ? focus : undefined),
        [],
        { suppress: true },
      );
    },
    // Export the committed transcript ([#step-13c]). The content (both
    // Markdown + JSON Lines renderings) is built client-side from the
    // transcript we already hold; the host `NSSavePanel` owns format choice +
    // file write. Read live at click time ([L07]). Outcomes surface in this
    // card's pane bulletin; a cancel is silent.
    export: () => {
      const notify = paneBulletinRef.current;
      const transcript = codeSessionStore.getSnapshot().transcript;
      if (transcript.length === 0) {
        notify?.caution("Nothing to export yet");
        return;
      }
      if (!isExportAvailable()) {
        notify?.caution("Export needs the Tug app");
        return;
      }
      const sessionId =
        cardSessionBindingStore.getBinding(cardId)?.tugSessionId ?? null;
      void exportSession({
        baseName: exportBaseName(sessionId),
        markdown: transcriptToMarkdown(transcript),
        jsonl: transcriptToJsonl(transcript),
      }).then((result) => {
        if (result === "saved") notify?.success("Session exported");
        else if (result === "unavailable") notify?.caution("Export needs the Tug app");
        // "canceled" → no bulletin.
      });
    },
    // Add a working directory ([#step-13c]). The native directory picker
    // supplies the path; `addDirectory` sends an `add_directory` CODE_INPUT
    // frame and tugcode respawns claude with the dir in `--add-dir` (+
    // `--resume`) — claude has no live add-directory verb over the bridge, so
    // it applies on respawn like an effort change. No-op on cancel, or when the
    // picker is unavailable.
    "add-dir": () => {
      const notify = paneBulletinRef.current;
      if (!isPathPickerAvailable()) {
        notify?.caution("Directory picker needs the Tug app");
        return;
      }
      void pickPath("directory").then((dir) => {
        if (dir === null) return; // canceled
        codeSessionStore.addDirectory(dir);
        notify?.success("Working directory added");
      });
    },
    // `/rename <text>` names the session directly (with a pane-bulletin
    // confirmation, since there's no dialog to signal success); bare `/rename`
    // opens the one-field dialog seeded with the current name ([#step-13d]).
    rename: (args) => {
      const name = args.trim();
      if (name.length === 0) {
        renameSheet.openRenameSheet();
        return;
      }
      renameSheet.renameTo(name);
      paneBulletinRef.current?.success(`Session renamed to “${name}”`);
    },
  };

  const {
    ResponderScope: CardContentResponderScope,
    responderRef: cardContentResponderRef,
  } = useResponder({
    id: `${cardId}-card-content`,
    kind: "card-content",
    actions: {
      [TUG_ACTIONS.FOCUS_PROMPT]: (_event: ActionEvent) => {
        entryDelegateRef.current?.focus();
      },
      // ⌥⇥ toggles keyboard-focus-cycling: the editor's Tab gives way to a
      // trapped tour of the card's chrome zones, seeded on the submit
      // commit-home; toggling again restores the editor caret ([P09]).
      [TUG_ACTIONS.CYCLE_FOCUS_MODE]: (_event: ActionEvent) => {
        cycle.toggle();
      },
      // ⌥⌘↑ / ⌥⌘↓ — step the transcript one turn back / forward. The
      // card-content responder owns this because the transcript is the
      // card's content; routing the chord here (rather than a listener
      // on the transcript's scroll container) is what makes it work from
      // anywhere focus sits in the card, prompt editor included. The
      // step routes through `DevTranscriptHandle.pageByEntry`, which
      // keeps the [D07] follow-bottom intent coherent.
      [TUG_ACTIONS.PREVIOUS_TURN]: (_event: ActionEvent) => {
        transcriptRef.current?.pageByEntry("up");
      },
      [TUG_ACTIONS.NEXT_TURN]: (_event: ActionEvent) => {
        transcriptRef.current?.pageByEntry("down");
      },
      // ⌥⇧⌘↑ / ⌥⇧⌘↓ — jump the transcript to the very top / bottom.
      [TUG_ACTIONS.FIRST_TURN]: (_event: ActionEvent) => {
        transcriptRef.current?.scrollToTop();
      },
      [TUG_ACTIONS.LAST_TURN]: (_event: ActionEvent) => {
        transcriptRef.current?.scrollToBottom();
      },
      // ⇧⇥ cycles the permission mode. Only the dev card registers this
      // handler, so on any other card ⇧⇥ falls through to reverse-tab
      // navigation (Risk R02). `cycle` reads the current mode fresh from
      // the metadata store [L07].
      [TUG_ACTIONS.CYCLE_PERMISSION_MODE]: (_event: ActionEvent) => {
        permissionMode.cycle();
      },
      // A Session ▸ Permission Mode menu pick, round-tripped through the
      // `set-permission-mode` control frame. Commits through the same
      // mode-set path the chip and sheet use (frame + optimistic
      // metadata + per-card persistence), so all entry points agree.
      // action-dispatch already validated against the menu mode set;
      // the narrow here is defensive against other dispatchers.
      [TUG_ACTIONS.SET_PERMISSION_MODE]: (event: ActionEvent) => {
        const mode = event.value;
        if (typeof mode !== "string" || !isPermissionMode(mode)) return;
        permissionMode.setMode(mode);
      },
      // Session ▸ Stop. Always means interrupt — the menu deliberately
      // bypasses Escape's dismiss-priority walk (popover > drag >
      // interrupt); the menu item's `canInterrupt` enablement is the
      // only gate, and a stray dispatch while idle is a no-op.
      [TUG_ACTIONS.INTERRUPT_SESSION]: (_event: ActionEvent) => {
        codeSessionStore.interrupt();
      },
      // A typed local slash command, dispatched key-card-scoped by the
      // prompt entry. Open the command's surface; an unknown name is a
      // no-op (the matcher only dispatches registered names, so this is
      // defensive against registry/handler drift) ([#step-1c] / [D23]).
      [TUG_ACTIONS.RUN_SLASH_COMMAND]: (event: ActionEvent) => {
        const payload = event.value as
          | { name: LocalCommandName; args: string }
          | undefined;
        if (payload === undefined) return;
        const open = slashCommandSurfaces[payload.name];
        if (open !== undefined) open(payload.args);
      },
      // A typed `/command` the dev card will not run, dispatched by the prompt
      // entry ([#step-13a]). `unknown` = a typo (not in claude's catalog);
      // `unsupported` = a real Claude Code command we hide (no meaning over the
      // bridge). Present a pane-modal alert with reason-appropriate text rather
      // than burning a turn (unknown) or silently dropping it (unsupported).
      [TUG_ACTIONS.SHOW_SLASH_COMMAND_NOTICE]: (event: ActionEvent) => {
        const payload = event.value as
          | { name: string; reason: "unknown" | "unsupported" }
          | undefined;
        if (payload === undefined) return;
        const { title, message } =
          payload.reason === "unsupported"
            ? {
                title: "Command not available",
                message: `The /${payload.name} command is not available in the dev card. Type / to see the available commands.`,
              }
            : {
                title: "Unknown command",
                message: `There is no /${payload.name} command in this project. Type / to see the available commands.`,
              };
        void presentAlertSheet(cardPickerSheet.showSheet, {
          title,
          // Match the canonical TugAlert icon sizing (the `.tug-alert-icon`
          // box is 48×48; the default glyph is `size={48}`).
          icon: <AlertTriangle size={48} aria-hidden="true" />,
          message,
        });
      },
    },
  });

  // --- Status row + tools panel content. ---
  // The status badge shows the card's bound `projectDir` — the cwd that
  // Claude is running against. Subscribed via L02 so a rebind (when
  // picker → spawn_session completes) repaints without an extra prop
  // handoff. Fallback to null is defensive: `DevCardBody` only renders
  // when services are non-null, which implies a binding, but during the
  // narrow window between binding clear and services teardown we render
  // nothing rather than a stale path.
  const projectDir = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    useCallback(
      () => cardSessionBindingStore.getBinding(cardId)?.projectDir ?? null,
      [cardId],
    ),
  );

  // Publish the bound project path to the pane chrome's title bar
  // via `cardTitleStore`. The title bar composes it as
  // `"Dev — <projectDir>"`. Cleared on unmount or when the binding
  // goes away so the title bar falls back to the registry default.
  useEffect(() => {
    if (projectDir !== null) {
      cardTitleStore.set(cardId, projectDir);
    } else {
      cardTitleStore.clear(cardId);
    }
    return () => {
      cardTitleStore.clear(cardId);
    };
  }, [cardId, projectDir]);

  const projectChipText =
    projectDir !== null ? formatProjectChipText(projectDir) : null;
  // Right-click → Copy the full project path (not the ellipsized chip face).
  const projectCopy = useCopyableButton(`Project: ${projectDir ?? ""}`);
  const projectStatusContent = projectDir !== null ? (
    <>
      <TugPushButton
        ref={projectCopy.ref as React.Ref<HTMLButtonElement>}
        onContextMenu={projectCopy.onContextMenu}
        size="sm"
        emphasis="tinted"
        role="action"
        layout="label-top"
        label="Project"
        data-slot="project-chip"
        focusGroup={DEV_CYCLE_GROUP}
        focusOrder={DEV_CYCLE_ORDER_PROJECT}
        aria-label="Open project folder in Finder"
        title={`Open in Finder: ${projectDir}`}
        onClick={() => openPathInOS(projectDir, "folder")}
      >
        {projectChipText}
      </TugPushButton>
      {projectCopy.contextMenu}
    </>
  ) : null;

  // Dev-only placement-experiment slots. In production this returns
  // an object with every slot undefined (the harness is gated behind
  // the empty-default tugbank mapping); in dev, the slots resolve
  // whichever datum the current `window.tugDevPlacement` mapping
  // selects. Explicit props on `DevCardBody` win over experiment
  // content — the harness only fills slots the caller left unset.
  const experimentSlots = useDevPlacementSlots({
    codeSessionStore,
    sessionMetadataStore,
    onScrollToRow: handleScrollToRow,
    statusRowRef,
    // Author the Z2 status cells into the card's cycle as five leaf stops
    // ([P10] revised) starting at order 5; the status-bar region is
    // wrapped in a second `cycle.CycleScope` (below) sharing this card's
    // mode id.
    statusRowFocusGroup: DEV_CYCLE_GROUP,
    statusRowFocusOrderBase: DEV_CYCLE_ORDER_STATUS_BASE,
  });
  const effectiveHeaderContent = headerContent ?? experimentSlots.headerContent;
  const effectiveStatusBarContent =
    statusBarContent ?? experimentSlots.statusBarContent;
  const effectiveRenderTurnTrailing =
    renderTurnTrailing ?? experimentSlots.renderTurnTrailing;
  // Z4B — prompt-entry indicator slot. Step 6 fills it with the badge
  // cluster; until then an explicit `footerContent` prop (tests /
  // gallery) or a dev placement-experiment Z4B assignment fills it.
  const effectiveFooterContent =
    footerContent ?? experimentSlots.promptIndicatorsContent;
  // Project button — sits after the Session badge in the Z4B indicator
  // cluster, grouped with the Mode/Model/Effort controls. Clicking it
  // opens the bound project folder in Finder. The project-path button
  // is the default; the placement-experiment harness overrides it when
  // its mapping assigns a datum to Z3.
  const effectivePromptStatusContent =
    experimentSlots.promptStatusContent ?? projectStatusContent;

  return (
    <CardContentResponderScope>
      <div
        ref={(el) => {
          // Compose two ref consumers onto a single DOM node:
          //   - `cardContentResponderRef` registers this element as
          //     the card-content responder for chain dispatch.
          //   - `devCardRootRef` captures the same element for the
          //     first-mount fade-in `useLayoutEffect` declared above.
          // The composition is inline rather than `useCallback`-wrapped
          // because both consumers are reference-stable for this
          // component's lifetime; React calls this lambda on mount
          // (with the element) and on unmount (with `null`), and a
          // one-shot identity churn doesn't trigger any re-attach
          // observable from the consumers.
          devCardRootRef.current = (el as HTMLDivElement | null);
          (cardContentResponderRef as (node: Element | null) => void)(el);
        }}
        className="dev-card"
        data-slot="dev-card"
        data-testid="dev-card"
        // Keyboard-focus-cycling signal ([P12]). Set while the card's
        // cycle mode is on; the fill-suppression CSS keys on this ancestor
        // so the submit's standing fill stands down to outlined and the
        // promoted fill follows the focused stop instead. Engine-derived
        // ([L02]); appearance via the attribute, never React state ([L06]).
        // `"true"` while cycling; `"false"` while resting on the editor (the
        // focus-ring suppression that hides the card's resting cycle-stop rings).
        // While an inline dialog is pending the card is **card-modal** ([P16]) —
        // neither cycling nor resting-on-editor — so the attribute is REMOVED,
        // which lifts the `[data-cycling="false"]` suppression off the trapped
        // dialog's own rings (its Allow ring must show on open, not after a Tab).
        data-cycling={
          cycle.cycling ? "true" : inlineDialogPending ? undefined : "false"
        }
        // Card-modal scrim signal ([P19]). Set while an inline dialog
        // (permission / question) is pending; the scrim CSS keys on this
        // ancestor to dim the card content around the dialog so the modality is
        // felt. Engine-derived from the store ([L02]); appearance via the
        // attribute, never React state ([L06]).
        data-inline-dialog-pending={inlineDialogPending ? "true" : undefined}
      >
        {/*
          Card body is a plain flex column ([L06]/[L13] — no JS sizing).
          The transcript region (this `dev-card-top-column`: header +
          multi-turn transcript + Z2 status bar) flexes into all remaining
          height (floored at `--dev-transcript-min`); the prompt-entry region
          below is content-sized and grows with the editor (auto-height,
          capped at `--dev-entry-max-height` so the Z4/Z5 toolbar stays
          pinned). This replaces the old `TugSplitPane` +
          `useContentDrivenPanelSize` machine wholesale.

          `DevTranscriptHost` mounts a `TugListView` over a
          `DevTranscriptDataSource` mapping `codeSessionStore.transcript`
          (committed turns) + `inflightUserMessage` onto `(user, code)`
          rows; the streaming `code` cell observes
          `codeSessionStore.streamingDocument` directly ([D06]/[L22]). The
          column is always rendered so the transcript's mount identity
          stays stable across slot-content changes ([L26]).
        */}
          <div
            className="dev-card-top-column"
            data-slot="dev-card-top-column"
          >
            {/*
              Two pane-bulletin scopes share the top column as sibling Sonner
              toasters (distinct `useId` ids). The OUTER provider anchors
              top-right and carries transient interruption notices (retry,
              transport, replay-timeout, unknown-event) driven by
              `TransientNoticeController`; the INNER provider anchors bottom for
              command confirmations (`/copy`). Nesting — not two roots — keeps
              each consumer reading the right `PaneToasterIdContext`: the
              controller sees the outer (top-right), `PaneBulletinAnchor` sees
              the inner (bottom). [P02]
            */}
            <TugPaneBulletinProvider
              placement="top-right"
              className="dev-card-notice-host"
            >
            <TransientNoticeController store={codeSessionStore} />
            <TugPaneBulletinProvider
              placement="bottom"
              className="dev-card-bulletin-host"
            >
            <div
              className="dev-card-header-content"
              data-slot="dev-card-header-content"
            >
              {effectiveHeaderContent}
            </div>
            <DevTranscriptHost
              ref={transcriptRef}
              cardId={cardId}
              codeSessionStore={codeSessionStore}
              sessionMetadataStore={sessionMetadataStore}
              responseStore={responseStore}
              renderTurnTrailing={effectiveRenderTurnTrailing}
            />
            <PaneBulletinAnchor ref={paneBulletinRef} />
            </TugPaneBulletinProvider>
            </TugPaneBulletinProvider>
            <div
              className="dev-card-status-bar"
              data-slot="dev-card-status-bar"
            >
              {/*
                Z2 status content. Rendered only when Z2 has content: an
                empty slot leaves the wrapper `:empty`, which collapses the
                whole strip (CSS).

                Per [D100] the row's TASKS cell carries the assembled
                task-list state plus a popover with the full list, so
                no separate pinned strip is needed.
              */}
              {effectiveStatusBarContent != null && (
                <div
                  className="dev-card-status-bar-main"
                  // Z2 status content is chrome: clicking a status cell, its
                  // popover trigger, or an empty gap must not pull focus off
                  // the editor. Ancestor-matched `data-tug-focus="refuse"`
                  // covers the cells + gaps. Keeping first-responder on the
                  // editor also lets a status popover restore editor focus on
                  // Escape / Cmd-. via the service-popup binding.
                  data-tug-focus="refuse"
                >
                  {/*
                    Second cycle scope, sharing this card's mode id, so
                    each Z2 status cell's `useFocusable` registers into
                    the same cycle as the prompt-entry stops ([P10]
                    revised — the cells are leaf stops at orders 5…9).
                    The row is rendered in the transcript pane — outside
                    the prompt entry's own `CycleScope` — so it needs its
                    own here.
                  */}
                  <cycle.CycleScope>
                    {effectiveStatusBarContent}
                  </cycle.CycleScope>
                </div>
              )}
            </div>
            {/*
              The PULSE strip — one ambient line of commentary beneath the
              Z2 status row, filtered to THIS card's session (one app-wide
              commentator, per-card display). Gated like the status bar (no
              Z2 content → no strip); the component additionally hides itself
              while the `pulse/enabled` default is off.
            */}
            {effectiveStatusBarContent != null && (
              // Wrapped in a cycle scope (sharing this card's mode id, like the
              // status row above) so the PULSE label's `useFocusable` registers
              // into the same cycle as the prompt-entry stops ([P10] revised —
              // a leaf stop at order 14, its own one-node grid row).
              <cycle.CycleScope>
                <DevPulseStrip
                  codeSessionStore={codeSessionStore}
                  focusGroup={DEV_CYCLE_GROUP}
                  focusOrder={DEV_CYCLE_ORDER_PULSE}
                />
              </cycle.CycleScope>
            )}
          </div>
        {/*
          Prompt-entry region — content-sized and pinned to the card bottom.
          The text area grows with the editor up to `--dev-entry-max-height`
          then scrolls; the transcript above yields.
        */}
        <div
          className="dev-card-entry-region"
          data-slot="dev-card-entry-region"
        >
          <TugBox
            ref={(el) => {
              paneRef.current = el as HTMLDivElement | null;
            }}
            variant="plain"
            inset={false}
            disabled={sessionErrored}
            className="dev-card-entry-pane"
          >
            {/*
              CycleScope keys the prompt entry's authored focus stops
              into this card's cycle mode (not the base mode), so the
              submit registers as a cycle stop that is inert while typing
              and walked only while cycling ([P09]/[P10]). The editor
              itself is a responder (caret), not a focus-group stop, so
              it is untouched. Z2 / Z4A stops join in later slices via
              additional `CycleScope`s sharing this same mode id.
            */}
            <cycle.CycleScope>
            <TugPromptEntry
              ref={entryDelegateRef}
              id={`${cardId}-entry`}
              // The editor stands down (read-only + caret off + dimmed)
              // while an inline dialog owns the keyboard and while cycling
              // (the cycling-mode indicator, [P12] revised: reuse the
              // deactivated path as the "blur") — cycling needs the chips
              // keyboard-reachable, so these must NOT inert the subtree.
              deactivated={inlineDialogPending || cycle.cycling}
              // A resume replay disables the WHOLE entry — route toggle,
              // chips, and submit included — via the inert subtree: nothing
              // here can act on a session that is still reconstructing. It
              // reactivates when the window closes (the stood-down effect
              // re-focuses the editor).
              disabled={replayHoldActive}
              submitFocusGroup={DEV_CYCLE_GROUP}
              submitFocusOrder={DEV_CYCLE_ORDER_SUBMIT}
              routeFocusGroup={DEV_CYCLE_GROUP}
              routeFocusOrder={DEV_CYCLE_ORDER_ROUTE}
              editorFocusGroup={DEV_CYCLE_GROUP}
              editorFocusOrder={DEV_CYCLE_ORDER_EDITOR}
              attachmentFocusGroup={DEV_CYCLE_GROUP}
              attachmentFocusOrderBase={DEV_CYCLE_ORDER_ATTACHMENT_BASE}
              onAttachmentCountChange={setAttachmentCount}
              onResumeTyping={() => cycle.exit()}
              localCommandTargetId={`${cardId}-card-content`}
              codeSessionStore={codeSessionStore}
              sessionMetadataStore={sessionMetadataStore}
              historyStore={historyStore}
              completionProviders={completionProviders}
              argumentHintResolver={argumentHintResolver}
              argumentHintRefresh={sessionMetadataStore}
              pastedCommandResolver={pastedCommandResolver}
              inlineCommandMatcher={inlineCommandMatcher}
              onAfterSubmit={handleAfterSubmit}
              indicatorsContent={
                <>
                  <DevRouteIndicatorBadge
                    codeSessionStore={codeSessionStore}
                    sessionMetadataStore={sessionMetadataStore}
                    focusGroup={DEV_CYCLE_GROUP}
                    focusOrder={DEV_CYCLE_ORDER_CLAUDE_CODE}
                  />
                  <DevRouteShellGate>
                    {(isShell) => (
                      <>
                        <DevSessionIdBadge
                          cardId={cardId}
                          sessionMetadataStore={sessionMetadataStore}
                          disabled={isShell}
                          focusGroup={DEV_CYCLE_GROUP}
                          focusOrder={DEV_CYCLE_ORDER_SESSION}
                        />
                        {effectivePromptStatusContent}
                        <PermissionModeChip
                          cardId={cardId}
                          sessionMetadataStore={sessionMetadataStore}
                          onOpenSheet={permissionSheet.openPermissionSheet}
                          disabled={isShell}
                          focusGroup={DEV_CYCLE_GROUP}
                          focusOrder={DEV_CYCLE_ORDER_MODE}
                        />
                        <ModelChip
                          sessionMetadataStore={sessionMetadataStore}
                          onOpenPicker={modelPicker.openModelPicker}
                          disabled={isShell}
                          focusGroup={DEV_CYCLE_GROUP}
                          focusOrder={DEV_CYCLE_ORDER_MODEL}
                        />
                        <EffortChip
                          sessionMetadataStore={sessionMetadataStore}
                          onOpenPicker={effortPicker.openEffortPicker}
                          disabled={isShell}
                          focusGroup={DEV_CYCLE_GROUP}
                          focusOrder={DEV_CYCLE_ORDER_EFFORT}
                        />
                      </>
                    )}
                  </DevRouteShellGate>
                  {effectiveFooterContent}
                </>
              }
              lineWrap={editorSettings.lineWrap}
              lineNumbers={editorSettings.lineNumbers}
              highlightActiveLineGutter={editorSettings.highlightActiveLineGutter}
              returnAction={editorSettings.returnKeyAction}
              numpadEnterAction={editorSettings.numpadEnterAction}
              placeholderByRoute={DEV_PROMPT_PLACEHOLDER_BY_ROUTE}
            />
            </cycle.CycleScope>
          </TugBox>
          {cardPickerSheet.renderSheet()}
        </div>
      {/*
        Single TugPaneBanner driven by `deriveDevCardBannerSpec`.
        The precedence chain (error > transport > none) is enforced
        in the helper; this JSX maps the spec's discriminated kind
        to TugPaneBanner props. Mutual exclusion by construction —
        no two visible flags racing on the portal slot.

        The error variant carries the Dismiss footer + detail
        copy ("The card can't reach its session…"). Status variants
        are strip-only with copy keyed off the transport state.
        When `kind === "none"` the banner renders with `visible:
        false`; the component runs its exit animation and then
        unmounts via its internal `mounted` state.
      */}
      {renderDevCardBanner(bannerSpec, setDismissedAt)}
      </div>
    </CardContentResponderScope>
  );
}

