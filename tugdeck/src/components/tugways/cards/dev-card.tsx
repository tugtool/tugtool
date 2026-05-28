/**
 * dev-card.tsx — Dev card (Unified Command Surface).
 *
 * Mounts `TugPromptEntry` inside a horizontal `TugSplitPane`. The top
 * pane (`DevTranscriptHost`) renders the multi-turn transcript and
 * absorbs all height growth as the card grows. The bottom pane (the
 * prompt entry) is pinned to a pixel size — defaults to 240px, floored
 * at 180px, capped at 90% of the card — and uses
 * `groupResizeBehavior="preserve-pixel-size"` so the entry stays the
 * same number of visible rows regardless of card height. The card
 * wires:
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
 *     the entry-pane TugBox down to the input editor. The tools panel
 *     (toggled via the button on the status row) exposes font-family,
 *     font-size, tracking, and leading popup buttons that write back to
 *     the store.
 *
 * The entry is mounted inside a `TugBox` with `inset={false}` so the
 * pane fills edge-to-edge. The split pane's grip pill is suppressed via
 * `showHandle={false}` — the sash line remains draggable.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import { TugPromptEntry, type TugPromptEntryDelegate } from "../tug-prompt-entry";
import { DevTranscriptHost, type DevTranscriptHandle } from "./dev-card-transcript";
import { DevCardSashGrip } from "./dev-card-sash-grip";
import { useDevPlacementSlots } from "./dev-card-placement-experiment";
import { DevRouteIndicatorBadge } from "../chrome/dev-route-indicator-badge";
import { DevSessionIdBadge } from "../chrome/dev-session-id-badge";
import { TugPaneBanner } from "../tug-pane-banner";
import { TugSplitPane, TugSplitPanel, type TugSplitPanelHandle } from "../tug-split-pane";
import { useContentDrivenPanelSize } from "../use-content-driven-panel-size";
import { group } from "../tug-animator";
import { TugBox } from "../tug-box";
import { TugBadge } from "../tug-badge";
import { TugInput } from "../tug-input";
import { TugPushButton } from "../tug-push-button";
import { Maximize2, Minimize2 } from "lucide-react";
import { TugLabel } from "../tug-label";
import {
  TugConfirmPopover,
  type TugConfirmPopoverHandle,
} from "../tug-confirm-popover";
import { TugPopupButton } from "../tug-popup-button";
import type { TugPopupButtonItem } from "../tug-popup-button";
import { TugSwitch } from "../tug-switch";
import { TugSlider } from "../tug-slider";
import {
  TugListView,
  type TugListViewDelegate,
} from "../tug-list-view";
import { useTugSheet } from "../tug-sheet";
import { useCardSettings } from "../use-card-settings";
import { useResponderChain } from "../responder-chain-provider";
import { useResponderForm } from "../use-responder-form";
import { useResponder } from "../use-responder";
import type { ActionEvent } from "../responder-chain";
import { useCardDelegate, useCardLifecycle } from "@/lib/card-lifecycle";
import { deckTrace } from "@/deck-trace";
import { useSheetDelegate } from "@/lib/sheet-lifecycle";
import { useBannerDelegate } from "@/lib/banner-lifecycle";
import { TUG_ACTIONS } from "../action-vocabulary";
import type { CodeSessionSnapshot, CodeSessionStore } from "@/lib/code-session-store";
import { deriveDevCardBannerSpec } from "./dev-card-banner-spec";
import { deriveColdRestoreActive } from "./dev-card-restore-gate";
import { REPLAY_SOFT_BUDGET_MS } from "@/lib/code-session-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import type { EditorSettingsStore } from "@/lib/editor-settings-store";
import type { ResponseSettingsStore } from "@/lib/response-settings-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getConnection } from "@/lib/connection-singleton";
import { registerCard } from "@/card-registry";
import { FeedId } from "@/protocol";
import type { CompletionProvider } from "@/lib/tug-text-types";
import {
  cardSessionBindingStore,
  type CardSessionMode,
} from "@/lib/card-session-binding-store";
import { sendSpawnSession } from "@/lib/session-lifecycle";
import { TugProgressIndicator } from "../tug-progress-indicator";
import {
  tideRestoreRegistry,
  cancelDevRestore,
  fireRestore,
  getRestoreStartedAt,
  clearRestoreStartedAt,
  restorePassGate,
} from "@/lib/dev-session-restore";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { pickerNoticeStore, type PickerNotice } from "@/lib/picker-notice-store";
import {
  useSpawnError,
  spawnErrorMessage,
  tideSpawnErrorStore,
  type SpawnError,
} from "@/lib/dev-spawn-error-store";
import { cardServicesStore, type CardServices } from "@/lib/card-services-store";
import { useDevCardObserver } from "./use-dev-card-observer";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import {
  useSessionLedger,
  getDevSessionLedgerStore,
} from "@/lib/dev-session-ledger-store";
import type { SessionRow } from "@/protocol";
import type { TaggedValue } from "@/lib/tugbank-client";
import { wrapPositionZero } from "./completion-providers/position-zero";
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

const EDITOR_FONT_OPTIONS: TugPopupButtonItem<string>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: "plex-sans", label: "IBM Plex Sans" },
  { action: TUG_ACTIONS.SET_VALUE, value: "inter", label: "Inter" },
  { action: TUG_ACTIONS.SET_VALUE, value: "hack", label: "Hack (mono)" },
];

const FONT_SIZE_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 11, label: "11 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 12, label: "12 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 13, label: "13 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 14, label: "14 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 15, label: "15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 16, label: "16 px" },
];

const LETTER_SPACING_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: -0.35, label: "-0.35 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.25, label: "-0.25 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.15, label: "-0.15 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.10, label: "-0.10 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: -0.05, label: "-0.05 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0, label: "Normal" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0.05, label: "+0.05 px" },
  { action: TUG_ACTIONS.SET_VALUE, value: 0.10, label: "+0.10 px" },
];

/** Percentage the entry panel pegs to when the user clicks Maximize.
 *  Mirrors the panel's `maxSize="90%"` upper bound — keep them in sync. */
const ENTRY_PANEL_MAX_PCT = 90;

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
 * Placeholder copy for the prompt entry, keyed by the active route
 * value (`❯` Code / `$` Shell — see `ROUTE_ITEMS` in
 * `tug-prompt-entry.tsx`). Forwarded as `placeholderByRoute`; the
 * entry shows the match for the active route and falls back to no
 * placeholder for any unlisted route. Dev-specific — the gallery
 * prompt-entry passes nothing.
 */
const TIDE_PROMPT_PLACEHOLDER_BY_ROUTE: Readonly<Record<string, string>> = {
  "❯": "Ask Claude to build, fix, or explain",
  "$": "Run a shell command",
};

const LINE_HEIGHT_OPTIONS: TugPopupButtonItem<number>[] = [
  { action: TUG_ACTIONS.SET_VALUE, value: 1.0, label: "1.0" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.1, label: "1.1" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.2, label: "1.2" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.3, label: "1.3" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.4, label: "1.4" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.5, label: "1.5" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.6, label: "1.6" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.7, label: "1.7" },
  { action: TUG_ACTIONS.SET_VALUE, value: 1.8, label: "1.8" },
];

/** Stable empty completion provider for the unbound / no-connection window. */
const EMPTY_FILE_COMPLETION_PROVIDER = ((_q: string) => []) as CompletionProvider;

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
// Shared singletons
// ---------------------------------------------------------------------------

/**
 * Module-scoped `PromptHistoryStore`. Shared across every Dev card,
 * constructed lazily on first access, never disposed — the singleton
 * outlives any individual card so history survives close + reopen.
 *
 * The store is internally keyed by session id (see
 * `lib/prompt-history-store.ts`); per-session persistence via
 * `getPromptHistory` / `putPromptHistory` is already baked in and
 * runs on every `push()`. Cross-card-reuse of history for the same
 * project arrives once a stable per-workspace session id exists.
 */
let _tidePromptHistoryStore: PromptHistoryStore | null = null;
function getDevPromptHistoryStore(): PromptHistoryStore {
  if (_tidePromptHistoryStore === null) {
    _tidePromptHistoryStore = new PromptHistoryStore();
  }
  return _tidePromptHistoryStore;
}

// ---------------------------------------------------------------------------
// useDevCardServices
// ---------------------------------------------------------------------------

/**
 * Per-card services consumed by `DevCardContent`. Constructed once a
 * binding for this card appears in `cardSessionBindingStore`, torn
 * down when the binding clears or the card unmounts. The hook
 * returns `null` while the card is unbound — the caller renders the
 * project-picker (arriving in sub-step 4c) in that state.
 */
export interface DevCardServices {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  historyStore: PromptHistoryStore;
  completionProviders: Record<string, CompletionProvider>;
  editorStore: EditorSettingsStore;
  responseStore: ResponseSettingsStore;
  /**
   * Delegate handle for the embedded `TugPromptEntry`. Owned by the
   * hook because the `/` completion provider's position-0 gate reads
   * `entryDelegateRef.current`; the component passes this same ref to
   * `<TugPromptEntry ref={...}>` and to the atom-regenerate callback.
   */
  entryDelegateRef: RefObject<TugPromptEntryDelegate | null>;
}

export function useDevCardServices(cardId: string): DevCardServices | null {
  // Read services from the module-scope `cardServicesStore` via
  // `useSyncExternalStore` ([L02]). The store handles all lifecycle:
  // it subscribes to `cardSessionBindingStore` and constructs/disposes
  // services in response to binding events. React only reads.
  //
  // Earlier this hook stored services in `useState` and populated them
  // via `useLayoutEffect` keyed on the binding. That violated [L02]
  // and produced a class of bugs where any React-side dep change tore
  // services down, sent a stray `close_session` frame, and remounted
  // the picker mid-session. The wire close is now sent only by
  // explicit `cardServicesStore.closeCard(cardId)` calls from the
  // deck-canvas's user-close handler.
  const services = useSyncExternalStore<CardServices | null>(
    cardServicesStore.subscribe,
    useCallback(() => cardServicesStore.getServices(cardId), [cardId]),
  );

  // True ref: the delegate instance arrives after the child
  // TugPromptEntry commits, so it cannot be initialized eagerly. Kept
  // here so the `/` position-0 gate (in `completionProviders`) reads
  // the same identity the component passes to `<TugPromptEntry ref>`.
  const entryDelegateRef = useRef<TugPromptEntryDelegate | null>(null);

  // Completion providers. Null-safe on `services` so this can be
  // memoized unconditionally (rules of hooks); the caller only reads
  // it when `services` is non-null. The `@` provider falls back to
  // an empty stable closure when services aren't ready, so the
  // trigger stays wired regardless of timing. The `/` provider is
  // wrapped with the position-0 gate so `/` mid-text yields an empty
  // popup.
  const completionProviders = useMemo<Record<string, CompletionProvider>>(
    () => ({
      "@": services?.fileCompletionProvider ?? EMPTY_FILE_COMPLETION_PROVIDER,
      "/": services
        ? wrapPositionZero(
            entryDelegateRef,
            services.sessionMetadataStore.getCommandCompletionProvider(),
          )
        : EMPTY_FILE_COMPLETION_PROVIDER,
    }),
    [services],
  );

  return useMemo<DevCardServices | null>(() => {
    if (services === null) return null;
    return {
      codeSessionStore: services.codeSessionStore,
      sessionMetadataStore: services.sessionMetadataStore,
      historyStore: getDevPromptHistoryStore(),
      completionProviders,
      editorStore: services.editorStore,
      responseStore: services.responseStore,
      entryDelegateRef,
    };
  }, [services, completionProviders]);
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
    tideRestoreRegistry.subscribe,
    tideRestoreRegistry.getSnapshot,
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
 * Routes between `DevCardBody` and `DevRestoring`. The body renders
 * once the card is genuinely ready; until then the single
 * `DevRestoring` placeholder holds.
 *
 * Two restore windows route to the placeholder:
 *
 *   - **transport-restoring** — `transportState === "restoring"`
 *     ([D01]), between `transport_open` and `transport_settled`. A
 *     hard-stop with Cancel; the wire is being re-asserted.
 *   - **cold restore** — on a relaunch, a resume-mode card walks
 *     replay preflight → `phase === "replaying"` → `replay_complete`
 *     before its body has ever mounted. `deriveColdRestoreActive`
 *     is true across that window; the body is held unmounted so it
 *     mounts exactly once, against a fully reconstructed transcript,
 *     and reveals in a single paint.
 *
 * The cold-restore branch is gated on a one-shot `revealed` latch:
 * once the body has mounted, a *later* `phase === "replaying"` (a
 * mid-session transport reconnect) must NOT route back to the
 * placeholder — that path stays on [DT10]'s in-body transcript-paint
 * gate, body mounted. The latch flips the first render the cold
 * restore is no longer active and never flips back.
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

  // One-shot reveal latch — see the component docstring. The cold
  // restore is over the moment `deriveColdRestoreActive` is false;
  // from then on the body owns the card for this services instance.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!coldRestoreActive && !revealed) {
      setRevealed(true);
      // The restore is done — drop the restore-start stamp so a much-
      // later reconnect can't read a stale "began at" and flash the
      // placeholder panel open immediately.
      clearRestoreStartedAt(cardId);
    }
  }, [coldRestoreActive, revealed, cardId]);

  // Transport-restoring is a hard-stop backdrop with Cancel; it
  // applies whether or not the body has revealed before (a reconnect
  // re-asserts the wire). The cold-restore branch applies only before
  // the first reveal.
  if (transportState === "restoring" || (!revealed && coldRestoreActive)) {
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
  // An unbound tide card that lives in an inactive tab must wait —
  // otherwise its sheet drops on top of the sibling card the user is
  // actually looking at (reload symptom: restart with hello-world
  // front and a sibling tide tab → tide's picker covers hello).
  //
  // `observeCardDidActivate` fires an initial-sync synchronously at
  // subscribe time when the card is already the focused card — so a
  // fresh `addCard("tide")` (tide IS the new FR) presents the sheet
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
          onOpen={(projectDir, sessionMode, sessionId) => {
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
                fireRestore(cardId, sessionId, projectDir, connection);
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
  // `action-dispatch` records it in `tideSpawnErrorStore` keyed by
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
  useEffect(() => () => tideSpawnErrorStore.clear(cardId), [cardId]);

  // Banner recovery: clear the error and re-present the picker sheet
  // so the user can choose a directory that exists.
  const handleSpawnErrorRetry = useCallback(() => {
    tideSpawnErrorStore.clear(cardId);
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
            emphasis="filled"
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
 * Pure parser for the `dev.tugtool.tide / recent-projects` tagged-value
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

function DevProjectPickerForm({
  notice,
  onOpen,
  onCancel,
  onRetryRestore,
}: DevProjectPickerFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Form's outer DOM node — used to scope the anchor querySelector for
  // the form-owned trash-confirmation popover so the lookup never
  // walks outside the picker form's own subtree.
  const formRootRef = useRef<HTMLDivElement | null>(null);
  const formResponderId = useId();

  // External state via `useSyncExternalStore` per [L02]. Recents
  // ride on tugbank; sessions flow through the tugcast-side
  // `DevSessionLedgerStore` keyed on the user-typed path.
  const recents = useTugbankValue(
    "dev.tugtool.tide",
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

  // One-shot seed: if the picker mounts with an empty input AND no
  // Recent Project Paths to auto-fill from, pre-populate with the
  // Swift-provided hint so the user has a Project Path they can hit
  // Open on without typing. Skipped once any of these conditions are
  // resolved (typed value, recents arrived, seed applied) so later
  // tugbank ticks can't overwrite a user edit.
  const didSeedPathRef = useRef(false);
  useLayoutEffect(() => {
    if (didSeedPathRef.current) return;
    if (path !== "" || recents.length > 0) {
      didSeedPathRef.current = true;
      return;
    }
    if (initialProjectPath === "") return;
    didSeedPathRef.current = true;
    setPath(initialProjectPath);
  }, [path, recents.length, initialProjectPath]);

  // Two data sources for the master/detail layout: Recents (always
  // visible — clicking one fills the input but the list does not
  // collapse) above Sessions (always visible — placeholder when no
  // path / ledger pending).
  const recentsDataSource = useDevRecentsDataSource(recents, trimmedPath);
  const sessionsDataSource = useDevSessionsDataSource(
    trimmedPath,
    sessionLedger,
  );

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
      if (row === undefined || row.state === "live") return;
      void store.trashSession(sessionId);
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

  const { ResponderScope: PickerFormResponderScope, responderRef: pickerFormResponderRef } =
    useResponder({
      id: formResponderId,
      actions: {
        [TUG_ACTIONS.REQUEST_TRASH_SESSION]: handleRequestTrashSession,
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

      if (effectiveSelection?.kind === "session-resume") {
        resumeCandidateId = effectiveSelection.sessionId;
        const row = ledgerRows.find(
          (r) => r.session_id === effectiveSelection.sessionId,
        );
        if (row !== undefined && row.state !== "live") {
          mode = "resume";
          sessionId = row.session_id;
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
      onOpen(trimmed, mode, sessionId);
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

  // [D10] Arrow-key navigation across the Sessions list's selectable
  // rows. Builds the list of selectables (session-new + non-live
  // session-resume) and steps through with wrap.
  const handleArrowKey = useCallback(
    (direction: "up" | "down"): void => {
      const selectables: Array<{ sel: PickerSelection }> = [];
      for (let i = 0; i < sessionsDataSource.numberOfItems(); i += 1) {
        const row = sessionsDataSource.rowAt(i);
        if (row.kind === "session-new") {
          selectables.push({ sel: { kind: "session-new" } });
        } else if (
          row.kind === "session-resume" &&
          row.row.state !== "live"
        ) {
          selectables.push({
            sel: {
              kind: "session-resume",
              sessionId: row.row.session_id,
            },
          });
        }
      }
      if (selectables.length === 0) return;

      let currentIdx = -1;
      if (selection !== null) {
        currentIdx = selectables.findIndex(({ sel }) => {
          if (sel.kind !== selection.kind) return false;
          if (
            sel.kind === "session-resume" &&
            selection.kind === "session-resume"
          ) {
            return sel.sessionId === selection.sessionId;
          }
          return true;
        });
      }

      const nextIdx =
        currentIdx === -1
          ? direction === "down"
            ? 0
            : selectables.length - 1
          : (currentIdx + (direction === "down" ? 1 : -1) + selectables.length) %
            selectables.length;

      setSelection(selectables[nextIdx].sel);
    },
    [sessionsDataSource, selection],
  );

  // Form-level keyboard handling. ArrowUp/Down moves selection across
  // selectable session rows. Enter is handled by the responder chain
  // — the Open button registers itself as the default button (via
  // `emphasis="filled" role="action"` on `TugPushButton`), and the
  // chain's bubble-phase Stage-2 listener clicks it for any Enter
  // pressed outside an editable. Trash is mouse-driven via the
  // per-row trash button + confirm popover.
  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      const target = e.target;
      const inInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (inInput) return;
        e.preventDefault();
        handleArrowKey(e.key === "ArrowDown" ? "down" : "up");
        return;
      }
    },
    [handleArrowKey],
  );

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
      selection,
      pendingTrashSessionId,
    }),
    [selection, pendingTrashSessionId],
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

  return (
    <PickerFormResponderScope>
      <div
        ref={setFormRootRef}
        className="dev-card-picker-form"
        onKeyDown={handleFormKeyDown}
      >
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
        <TugInput
          ref={inputRef}
          type="text"
          className="dev-card-picker-path-input"
          value={path}
          onChange={(e) => setPath((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="/path/to/project"
          autoFocus
        />
      </label>
      <PickerCellProvider value={cellContextValue}>
        <div className="dev-card-picker-section">
          <span className="dev-card-picker-label">Recent Project Paths</span>
          <div className="dev-card-picker-recents-host">
            {recents.length > 0 ? (
              <TugListView
                dataSource={recentsDataSource}
                selectionRequired
                rowLayout="flush"
                delegate={recentsDelegate}
                onSelectionChange={applyRecentPath}
                cellRenderers={RECENTS_CELL_RENDERERS}
                scrollKey="dev-card-picker-recents"
                className="dev-card-picker-recents-list"
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
          <span className="dev-card-picker-label">Sessions</span>
          <div className="dev-card-picker-sessions-host">
            {sessionsReady ? (
              <TugListView
                dataSource={sessionsDataSource}
                delegate={sessionsDelegate}
                cellRenderers={SESSIONS_CELL_RENDERERS}
                scrollKey="dev-card-picker-sessions"
                className="dev-card-picker-sessions-list dev-card-picker-list-view"
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
                emphasis="ghost"
                role="action"
                onClick={handleTrashAllClick}
                disabled={nonLiveCount === 0}
                data-testid="dev-card-picker-trash-all"
              >
                {nonLiveCount > 1
                  ? `Move all sessions to Trash for this path (${nonLiveCount})`
                  : "Move all sessions to Trash for this path"}
              </TugPushButton>
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
        <TugPushButton emphasis="outlined" role="action" onClick={onCancel}>
          Cancel
        </TugPushButton>
        <TugPushButton
          emphasis="filled"
          role="action"
          onClick={submit}
          disabled={openDisabled}
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
  if (spec.kind === "transport") {
    const isOffline = spec.state === "offline";
    return (
      <TugPaneBanner
        visible={true}
        variant="status"
        tone="caution"
        icon="unplug"
        label={isOffline ? "Reconnecting" : "Restoring session"}
        message={
          isOffline
            ? "Lost the connection to tugcast. Trying to reconnect…"
            : "The connection is back. Re-acknowledging your session…"
        }
      />
    );
  }
  if (spec.kind === "replay-timeout") {
    // Caution tone + alert icon signals a soft failure. The banner
    // dismisses on its own when `replayTimeoutDwellActive` flips
    // false (REPLAY_TIMEOUT_DWELL_MS after the replay_complete that
    // started the dwell).
    return (
      <TugPaneBanner
        visible={true}
        variant="status"
        tone="caution"
        icon="alert-triangle"
        label="Session history unavailable"
        message="Resuming with empty transcript"
      />
    );
  }
  // kind === "none" — banner runs its exit animation if it was
  // previously visible, then unmounts.
  return <TugPaneBanner visible={false} message="" />;
}

export function DevCardBody({
  cardId,
  services,
  headerContent,
  statusBarContent,
  renderTurnTrailing,
  footerContent,
}: DevCardBodyProps) {
  const { codeSessionStore, sessionMetadataStore, historyStore, completionProviders, editorStore, responseStore, entryDelegateRef } = services;

  useDevCardObserver(cardId, codeSessionStore);

  const entryPanelRef = useRef<TugSplitPanelHandle | null>(null);
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
  const tideCardRootRef = useRef<HTMLDivElement | null>(null);

  const codeSnap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );

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

  // --- Content-driven panel growth for the entry pane. ---
  // The bottom TugSplitPanel grows toward `maxSize` as the editor
  // overflows and snaps back to the user's library-resolved size on
  // the editor's `data-empty="true"` signal. The source element is
  // derived from the entry delegate at call time via a stable
  // useMemo'd shim — identity-stable so the hook's effect doesn't
  // re-install observers on every render. (`entryPanelRef` and
  // `entryDelegateRef` are declared earlier so `completionProviders`
  // can read them for the position-0 gate.)
  const editorSourceRef = useMemo(
    () => ({
      get current(): HTMLElement | null {
        // The legacy substrate's contentEditable was both the
        // content surface AND the scroll container, so reading
        // `scrollHeight`/`clientHeight` off it correctly reported
        // overflow. CM6 splits those two roles: `view.contentDOM`
        // grows freely, and `view.scrollDOM` (`.cm-scroller`) is
        // the bounded overflow element. Walk up from contentDOM to
        // hand the hook the scroller — that's where overflow
        // actually shows up. Falls through to the contentDOM if
        // the scroller isn't found (defensive for non-CM6 hosts of
        // the entry, e.g. the gallery's stand-alone harness).
        const contentEl = entryDelegateRef.current?.getEditorElement();
        if (contentEl === null || contentEl === undefined) return null;
        return contentEl.closest<HTMLElement>(".cm-scroller") ?? contentEl;
      },
    }),
    [],
  );
  // --- Maximize toggle. ---
  // When true, the entry panel is pegged to its declared max and the
  // split-pane handle is disabled. The content-driven sizer and the
  // submit-time restore both stand down so nothing fights the peg.
  // When false, the pane behaves exactly as if the toggle never
  // existed: saved size persists, transient size accommodates content.
  const [maximized, setMaximized] = useState(false);
  useLayoutEffect(() => {
    const panel = entryPanelRef.current;
    if (!panel) return;
    if (maximized) panel.setTransientSize(ENTRY_PANEL_MAX_PCT, { animated: true });
    else panel.restoreUserSize({ animated: true });
  }, [maximized]);

  useContentDrivenPanelSize({ panelRef: entryPanelRef, sourceRef: editorSourceRef, enabled: !maximized });

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
  // Pinned by `tests/app-test/at0051-dev-mount-focus.test.ts`. A
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
    entryDelegateRef.current?.focus();
  }, [cardLifecycle, cardId, entryDelegateRef]);

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
  // via `tideCardRootRef.current`, sets opacity to "0" synchronously
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
    const el = tideCardRootRef.current;
    if (el === null) return;
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

  // Snap-back-to-userSize on explicit user submit — not on any other
  // data-empty transition (manual delete, undo, etc.). Fires before
  // `input.clear()` so the restore commits to the library store
  // first; the content-driven hook's subsequent restore is a no-op
  // because the library store already matches the user size. Skip
  // while maximized — the maximize peg owns the size. No animation
  // here: the snap is paired with the user pressing Send and should
  // feel immediate, not show motion.
  const handleBeforeSubmit = useCallback(() => {
    if (maximized) return;
    entryPanelRef.current?.restoreUserSize();
  }, [maximized]);

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
  // tide card's body element; any keybinding with `scope: "key-card"`
  // (declared in keybinding-map.ts) is dispatched here when this is
  // the active card. The chain walks UP from this node, so
  // unhandled actions fall through to the card-level responder,
  // canvas, and root — same semantics as any other chain walk.
  //
  // Handlers:
  //   - FOCUS_PROMPT (⌘K): move keyboard focus to the prompt editor.
  //     Reads the delegate via the ref [L07] so the handler closure
  //     registered at mount never goes stale.
  // --- Stable senders for the settings sheet controls. Declared
  // here so both `useResponderForm` (below) and the sheet body
  // can reference them. The sheet now hosts two sections:
  // Response Settings (transcript pane) and Editor Settings (prompt
  // entry pane). Senders for each section share this scope. ---
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const letterSpacingPopupId = useId();
  const lineHeightPopupId = useId();
  const lineWrapId = useId();
  const lineNumbersId = useId();
  const activeLineGutterId = useId();
  const responseEntryMarginSliderId = useId();

  // --- Card settings (title-bar `…` button). ---
  //
  // `useCardSettings` registers a stable controller in
  // `cardSettingsStore` keyed by `cardId`. The pane's title bar
  // invokes `controller.toggle()` directly — no chain dispatch, no
  // ref gymnastics. The hook also writes the open / closed state
  // back to the store so the title bar's `…` button can paint as
  // highlighted while the sheet is up. [L02 / L24]
  const cardSettings = useCardSettings({
    cardId,
    title: "Settings",
    render: (close) => (
      <SettingsSheetBody
        editorStore={editorStore}
        responseStore={responseStore}
        fontPopupId={fontPopupId}
        fontSizePopupId={fontSizePopupId}
        letterSpacingPopupId={letterSpacingPopupId}
        lineHeightPopupId={lineHeightPopupId}
        lineWrapId={lineWrapId}
        lineNumbersId={lineNumbersId}
        activeLineGutterId={activeLineGutterId}
        responseEntryMarginSliderId={responseEntryMarginSliderId}
        onClose={close}
      />
    ),
    // Override Radix FocusScope's default first-focusable pick so
    // the OK button claims initial focus. With OK focused, Return
    // dismisses the sheet directly via the button's native click
    // semantics — no extra keymap needed.
    onOpenAutoFocus: (event) => {
      event.preventDefault();
      const okButton = document.querySelector<HTMLButtonElement>(
        '[data-slot="tug-sheet"] [data-tug-default-button="ok"]',
      );
      okButton?.focus();
    },
  });
  const { renderSheet } = cardSettings;

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
    },
  });

  // --- Responder scope for the settings controls. ---
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
      [letterSpacingPopupId]: (v: number) => editorStore.set({ letterSpacing: v }),
      [lineHeightPopupId]: (v: number) => editorStore.set({ lineHeight: v }),
      [responseEntryMarginSliderId]: (v: number) =>
        responseStore.set({ entryMargin: v }),
    },
    toggle: {
      [lineWrapId]: (v: boolean) => editorStore.set({ lineWrap: v }),
      [lineNumbersId]: (v: boolean) => editorStore.set({ lineNumbers: v }),
      [activeLineGutterId]: (v: boolean) =>
        editorStore.set({ highlightActiveLineGutter: v }),
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
  const projectStatusContent = projectDir !== null ? (
    <TugBadge size="sm" emphasis="tinted" role="inherit">
      Project: {projectDir}
    </TugBadge>
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
  // Project badge — sits between the Claude Code route badge and the
  // Session badge in the Z4B indicator cluster. The project-path
  // badge is the default; the placement-experiment harness overrides
  // it when its mapping assigns a datum to Z3.
  const effectivePromptStatusContent =
    experimentSlots.promptStatusContent ?? projectStatusContent;

  return (
    <CardContentResponderScope>
      <div
        ref={(el) => {
          // Compose two ref consumers onto a single DOM node:
          //   - `cardContentResponderRef` registers this element as
          //     the card-content responder for chain dispatch.
          //   - `tideCardRootRef` captures the same element for the
          //     first-mount fade-in `useLayoutEffect` declared above.
          // The composition is inline rather than `useCallback`-wrapped
          // because both consumers are reference-stable for this
          // component's lifetime; React calls this lambda on mount
          // (with the element) and on unmount (with `null`), and a
          // one-shot identity churn doesn't trigger any re-attach
          // observable from the consumers.
          tideCardRootRef.current = (el as HTMLDivElement | null);
          (cardContentResponderRef as (node: Element | null) => void)(el);
        }}
        className="dev-card"
        data-slot="dev-card"
        data-testid="dev-card"
      >
      <TugSplitPane
        orientation="horizontal"
        showHandle={false}
        disabled={maximized}
        // Per-card storage key. The entry-pane sash position is a
        // per-card preference: a single shared key would let every
        // tide card's mount-time layout write clobber every other
        // card's saved sash position, and on relaunch each card would
        // paint at whatever card last wrote the shared entry before
        // snapping to its own — a visible shift. `cardId` is stable
        // across relaunch (the ledger restore matches on it) and
        // across cross-pane moves, so the pref persists with the card.
        storageKey={`tide.prompt-entry.${cardId}`}
      >
        {/*
          Top pane: multi-turn transcript. `DevTranscriptHost` mounts a
          `TugListView` over a `DevTranscriptDataSource` that maps
          `codeSessionStore.transcript` (committed turns) and
          `inflightUserMessage` (the live submission) onto pairs of
          `(user, code)` rows. The streaming `code` cell observes
          `codeSessionStore.streamingDocument` directly per [D06] /
          [L22] — deltas don't round-trip through the data source. The
          old `TugMarkdownView` single-region wire-up is gone; the
          "sticky last turn" emergent side-effect goes with it.
        */}
        <TugSplitPanel id="dev-card-top" defaultSize="70%" minSize="10%">
          {/*
            Top-pane flex column — three rows (Z0 / transcript / Z2).
            Always rendered so `DevTranscriptHost`'s mount identity
            stays stable across slot-content changes ([L26]); empty
            Z0 / Z2 wrappers collapse to zero height via `flex: 0 0
            auto` + no intrinsic content.
          */}
          <div
            className="dev-card-top-column"
            data-slot="dev-card-top-column"
          >
            <div
              className="dev-card-header-content"
              data-slot="dev-card-header-content"
            >
              {effectiveHeaderContent}
            </div>
            <DevTranscriptHost
              ref={transcriptRef}
              codeSessionStore={codeSessionStore}
              sessionMetadataStore={sessionMetadataStore}
              responseStore={responseStore}
              renderTurnTrailing={effectiveRenderTurnTrailing}
            />
            <div
              className="dev-card-status-bar"
              data-slot="dev-card-status-bar"
            >
              {/*
                Z2 status content with a sash grip on the leading end
                and the maximize toggle on the trailing end. The grip
                resizes the split-pane sash directly below — the status
                bar would otherwise mask the sash's thin hit line.
                Rendered only when Z2 has content: an empty slot leaves
                the wrapper `:empty`, which collapses the whole strip
                (CSS) and restores the bare-sash layout.

                Per [D100] the row's TASKS cell carries the assembled
                task-list state plus a popover with the full list, so
                no separate pinned strip is needed.
              */}
              {effectiveStatusBarContent != null && (
                <>
                  <DevCardSashGrip
                    entryPanelRef={entryPanelRef}
                    side="start"
                    disabled={maximized}
                  />
                  <div className="dev-card-status-bar-main">
                    {effectiveStatusBarContent}
                  </div>
                  {/*
                    Maximize toggle — Z2's trailing control, in the
                    place the trailing sash grip used to hold. The sash
                    stays draggable from the leading grip.
                  */}
                  <TugPushButton
                    className="dev-card-maximize-toggle"
                    subtype="icon"
                    size="xs"
                    emphasis={maximized ? "filled" : "ghost"}
                    role={maximized ? "accent" : "action"}
                    aria-label={maximized ? "Restore size" : "Maximize"}
                    aria-pressed={maximized}
                    icon={
                      maximized
                        ? <Minimize2 strokeWidth={2} aria-hidden="true" />
                        : <Maximize2 strokeWidth={2} aria-hidden="true" />
                    }
                    onClick={() => setMaximized(!maximized)}
                  />
                </>
              )}
            </div>
          </div>
        </TugSplitPanel>
        <TugSplitPanel
          ref={entryPanelRef}
          id="dev-card-bottom"
          defaultSize="240px"
          minSize="180px"
          maxSize="90%"
          groupResizeBehavior="preserve-pixel-size"
        >
          <ResponderScope>
            <TugBox
              ref={(el) => {
                paneRef.current = el as HTMLDivElement | null;
                (responderRef as (node: Element | null) => void)(el as Element | null);
              }}
              variant="plain"
              inset={false}
              disabled={sessionErrored}
              className="dev-card-entry-pane"
            >
              <TugPromptEntry
                ref={entryDelegateRef}
                id={`${cardId}-entry`}
                codeSessionStore={codeSessionStore}
                sessionMetadataStore={sessionMetadataStore}
                historyStore={historyStore}
                completionProviders={completionProviders}
                onBeforeSubmit={handleBeforeSubmit}
                onAfterSubmit={handleAfterSubmit}
                indicatorsContent={
                  <>
                    <DevRouteIndicatorBadge
                      codeSessionStore={codeSessionStore}
                      sessionMetadataStore={sessionMetadataStore}
                    />
                    {effectivePromptStatusContent}
                    <DevSessionIdBadge cardId={cardId} />
                    {effectiveFooterContent}
                  </>
                }
                lineWrap={editorSettings.lineWrap}
                lineNumbers={editorSettings.lineNumbers}
                highlightActiveLineGutter={editorSettings.highlightActiveLineGutter}
                maximized={maximized}
                onMaximizeChange={setMaximized}
                placeholderByRoute={TIDE_PROMPT_PLACEHOLDER_BY_ROUTE}
              />
            </TugBox>
            {renderSheet()}
          </ResponderScope>
        </TugSplitPanel>
      </TugSplitPane>
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

// ---------------------------------------------------------------------------
// SettingsSheetBody — combined settings sheet for the title-bar `…` menu
// ---------------------------------------------------------------------------

/**
 * Props for {@link SettingsSheetBody}.
 *
 * Sender ids are provided by the enclosing `DevCardBody` so the form
 * bindings (registered there via `useResponderForm`) can target the
 * controls. Both stores are forwarded so the body can subscribe
 * directly via `useSyncExternalStore` and stay in sync without an
 * outer re-render of the sheet payload.
 */
interface SettingsSheetBodyProps {
  editorStore: EditorSettingsStore;
  responseStore: ResponseSettingsStore;
  fontPopupId: string;
  fontSizePopupId: string;
  letterSpacingPopupId: string;
  lineHeightPopupId: string;
  lineWrapId: string;
  lineNumbersId: string;
  activeLineGutterId: string;
  responseEntryMarginSliderId: string;
  /** Dismiss callback supplied by `useTugSheet`'s render closure. */
  onClose: () => void;
}

function letterSpacingLabel(value: number): string {
  if (value === 0) return "Normal";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} px`;
}

/**
 * Body of the combined settings sheet shown when the user taps the `…`
 * button in the Dev card's title bar.
 *
 * Two stacked sections:
 *   1. **Response** — the inter-entry vertical gap. Magnification
 *      moved to the macOS app's View menu so it scales the entire
 *      WebView uniformly via `WKWebView.pageZoom`.
 *   2. **Editor** — typography and view toggles for the prompt editor
 *      (the bottom pane).
 */
function SettingsSheetBody({
  editorStore,
  responseStore,
  fontPopupId,
  fontSizePopupId,
  letterSpacingPopupId,
  lineHeightPopupId,
  lineWrapId,
  lineNumbersId,
  activeLineGutterId,
  responseEntryMarginSliderId,
  onClose,
}: SettingsSheetBodyProps) {
  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );
  const responseSettings = useSyncExternalStore(
    responseStore.subscribe,
    responseStore.getSnapshot,
  );

  return (
    <div className="dev-card-settings">
      <TugBox
        label="Response"
        labelPosition="legend"
        variant="bordered"
        className="dev-card-settings-group"
      >
        {/* 2-column grid (label / slider). Magnification moved to the
            macOS app's View menu (Actual Size / Zoom In / Zoom Out)
            so it scales the entire app uniformly via
            `WKWebView.pageZoom`; Entry Gap remains a per-card
            response-pane control. The grid shape is preserved so a
            future second-row response setting drops in cleanly. */}
        <div className="dev-card-settings-slider-grid">
          <span className="dev-card-settings-slider-label">Entry Gap</span>
          <TugSlider
            className="dev-card-settings-slider"
            value={responseSettings.entryMargin}
            min={0}
            max={48}
            step={1}
            senderId={responseEntryMarginSliderId}
            size="md"
            valueWidth="3.5rem"
          />
        </div>
      </TugBox>

      <TugBox
        label="Editor"
        labelPosition="legend"
        variant="bordered"
        className="dev-card-settings-group"
      >
        <div className="dev-card-settings-row">
          <TugPopupButton
            className="dev-card-settings-popup dev-card-settings-popup-font"
            topLabel="Font"
            label={EDITOR_FONT_OPTIONS.find(f => f.value === editorSettings.fontId)?.label ?? "Font"}
            items={EDITOR_FONT_OPTIONS}
            senderId={fontPopupId}
            size="sm"
          />
          <TugPopupButton
            className="dev-card-settings-popup dev-card-settings-popup-size"
            topLabel="Size"
            label={`${editorSettings.fontSize}px`}
            items={FONT_SIZE_OPTIONS}
            senderId={fontSizePopupId}
            size="sm"
          />
          <TugPopupButton
            className="dev-card-settings-popup dev-card-settings-popup-line"
            topLabel="Line"
            label={editorSettings.lineHeight.toFixed(1)}
            items={LINE_HEIGHT_OPTIONS}
            senderId={lineHeightPopupId}
            size="sm"
          />
          <TugPopupButton
            className="dev-card-settings-popup dev-card-settings-popup-spacing"
            topLabel="Spacing"
            label={letterSpacingLabel(editorSettings.letterSpacing)}
            items={LETTER_SPACING_OPTIONS}
            senderId={letterSpacingPopupId}
            size="sm"
          />
        </div>

        <div className="dev-card-settings-switches">
          <TugSwitch
            label="Line wrap"
            checked={editorSettings.lineWrap}
            senderId={lineWrapId}
            size="md"
          />
          <TugSwitch
            label="Line numbers"
            checked={editorSettings.lineNumbers}
            senderId={lineNumbersId}
            size="md"
          />
          <TugSwitch
            label="Active line"
            checked={editorSettings.highlightActiveLineGutter}
            senderId={activeLineGutterId}
            size="md"
          />
        </div>
      </TugBox>

      <div className="tug-sheet-actions">
        <TugPushButton
          autoFocus
          emphasis="filled"
          role="action"
          onClick={onClose}
          data-tug-default-button="ok"
        >
          Done
        </TugPushButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerDevCard
// ---------------------------------------------------------------------------

/**
 * Register the Dev card in the global card registry.
 *
 * Per `roadmap/dev-to-dev-rename.md` [D08], during the Dev → Dev
 * transition two `componentId` registrations are live: `"dev"` (the
 * new canonical name, title "Dev") and `"tide"` (a back-compat alias
 * that preserves existing call sites). Both registrations share the
 * same `DevCardContent` component and lifecycle. Step 11 of the
 * rename plan drops the `"tide"` alias once all consumers swap.
 *
 * Must be called before `DeckManager.addCard("dev")` (or the legacy
 * `addCard("tide")`) is invoked. Call from `main.tsx` alongside
 * `registerGitCard()`.
 */
export function registerDevCard(): void {
  const shared = {
    contentFactory: (cardId: string) => <DevCardContent cardId={cardId} />,
    defaultFeedIds: [
      FeedId.CODE_INPUT,
      FeedId.CODE_OUTPUT,
      FeedId.SESSION_METADATA,
      FeedId.FILETREE,
    ],
    sizePolicy: {
      // The width floor is set by the Z2 status row, the card's
      // widest fixed-content surface: four 21ch instrument cells plus
      // inter-cell/edge gaps (≈ 674px) and a sash grip at each end
      // with its gaps + padding (≈ 96px) ≈ 770px, rounded to 800 for
      // breathing room. `getStackSizePolicy` lifts the hosting pane's
      // resize floor to this value (or higher, if a wider card shares
      // the pane), so the instrument readout never clips. The height
      // floor is comfortable for a few transcript turns.
      min: { width: 800, height: 240 },
      // Default size opens the card tall enough for an extended
      // transcript to read as a continuous column, not a porthole,
      // and wide enough to give the Choose Session sheet (caps at
      // 460px) room to breathe alongside the card body. Both
      // dimensions intentionally exceed many laptop canvases;
      // `addCard` clamps width AND height to 90% of the live canvas
      // at creation, so on a smaller screen the card opens at
      // canvas * 0.9 instead of pushing past the viewport.
      preferred: { width: 900, height: 1200 },
    },
    engineKind: "em" as const,
  };

  registerCard({
    componentId: "dev",
    ...shared,
    defaultMeta: { title: "Dev", icon: "MessageSquareText", closable: true, confirmClose: true },
  });

  // Back-compat alias per [D08]. Dropped in Step 11.
  registerCard({
    componentId: "tide",
    ...shared,
    defaultMeta: { title: "Dev", icon: "MessageSquareText", closable: true, confirmClose: true },
  });
}
