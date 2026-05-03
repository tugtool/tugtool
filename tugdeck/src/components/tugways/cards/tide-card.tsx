/**
 * tide-card.tsx — Tide card (Unified Command Surface).
 *
 * Mounts `TugPromptEntry` inside a horizontal `TugSplitPane` (top 70% —
 * placeholder; bottom 30% — entry, clamped at 90%). The card wires:
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
import { TugMarkdownView } from "../tug-markdown-view";
import { TugPaneBanner } from "../tug-pane-banner";
import { TugSplitPane, TugSplitPanel, type TugSplitPanelHandle } from "../tug-split-pane";
import { useContentDrivenPanelSize } from "../use-content-driven-panel-size";
import { TugBox } from "../tug-box";
import { TugBadge } from "../tug-badge";
import { TugInput } from "../tug-input";
import { TugPushButton } from "../tug-push-button";
import { TugRadioGroup, TugRadioItem } from "../tug-radio-group";
import { TugPopupButton } from "../tug-popup-button";
import type { TugPopupButtonItem } from "../tug-popup-button";
import { TugSwitch } from "../tug-switch";
import { TugSeparator } from "../tug-separator";
import { Trash2 } from "lucide-react";
import { useTugSheet } from "../tug-sheet";
import { useResponderChain } from "../responder-chain-provider";
import { useResponderForm } from "../use-responder-form";
import { useResponder } from "../use-responder";
import type { ActionEvent } from "../responder-chain";
import { useCardDelegate, useCardLifecycle } from "@/lib/card-lifecycle";
import { TUG_ACTIONS } from "../action-vocabulary";
import type { CodeSessionSnapshot, CodeSessionStore } from "@/lib/code-session-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import type { EditorSettingsStore } from "@/lib/editor-settings-store";
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
import { TugProgress } from "../tug-progress";
import {
  tideRestoreRegistry,
  cancelTideRestore,
  fireRestore,
} from "@/lib/tide-session-restore";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { pickerNoticeStore, type PickerNotice } from "@/lib/picker-notice-store";
import { cardServicesStore, type CardServices } from "@/lib/card-services-store";
import { useTideCardObserver } from "./use-tide-card-observer";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import {
  useSessionLedger,
  getTideSessionLedgerStore,
} from "@/lib/tide-session-ledger-store";
import type { SessionRow } from "@/protocol";
import type { TaggedValue } from "@/lib/tugbank-client";
import { wrapPositionZero } from "./completion-providers/position-zero";

import "./tide-card.css";

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
 * absent — that cause is intercepted by `useTideCardObserver`, which
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
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TideCardContentProps {
  /**
   * Card instance id. Forwarded from the card registry's `contentFactory`
   * callback and used for per-card workspace binding (via
   * `useCardWorkspaceKey`) plus the responder scope id of the embedded
   * `TugPromptEntry`.
   */
  cardId: string;
}

// ---------------------------------------------------------------------------
// Shared singletons
// ---------------------------------------------------------------------------

/**
 * Module-scoped `PromptHistoryStore`. Shared across every Tide card,
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
function getTidePromptHistoryStore(): PromptHistoryStore {
  if (_tidePromptHistoryStore === null) {
    _tidePromptHistoryStore = new PromptHistoryStore();
  }
  return _tidePromptHistoryStore;
}

// ---------------------------------------------------------------------------
// useTideCardServices
// ---------------------------------------------------------------------------

/**
 * Per-card services consumed by `TideCardContent`. Constructed once a
 * binding for this card appears in `cardSessionBindingStore`, torn
 * down when the binding clears or the card unmounts. The hook
 * returns `null` while the card is unbound — the caller renders the
 * project-picker (arriving in sub-step 4c) in that state.
 */
export interface TideCardServices {
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  historyStore: PromptHistoryStore;
  completionProviders: Record<string, CompletionProvider>;
  editorStore: EditorSettingsStore;
  /**
   * Delegate handle for the embedded `TugPromptEntry`. Owned by the
   * hook because the `/` completion provider's position-0 gate reads
   * `entryDelegateRef.current`; the component passes this same ref to
   * `<TugPromptEntry ref={...}>` and to the atom-regenerate callback.
   */
  entryDelegateRef: RefObject<TugPromptEntryDelegate | null>;
}

export function useTideCardServices(cardId: string): TideCardServices | null {
  // Read services from the module-scope `cardServicesStore` via
  // `useSyncExternalStore` ([L02]). The store handles all lifecycle:
  // it subscribes to `cardSessionBindingStore` and constructs/disposes
  // services in response to binding events. React only reads.
  //
  // Earlier this hook stored services in `useState` and populated them
  // via `useLayoutEffect` keyed on the binding. That violated [L02]
  // and produced a class of bugs where any React-side dep change tore
  // services down, sent a stray `close_session` frame, and remounted
  // the picker mid-conversation. The wire close is now sent only by
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

  return useMemo<TideCardServices | null>(() => {
    if (services === null) return null;
    return {
      codeSessionStore: services.codeSessionStore,
      sessionMetadataStore: services.sessionMetadataStore,
      historyStore: getTidePromptHistoryStore(),
      completionProviders,
      editorStore: services.editorStore,
      entryDelegateRef,
    };
  }, [services, completionProviders]);
}

// ---------------------------------------------------------------------------
// TideCardContent
// ---------------------------------------------------------------------------

export function TideCardContent({ cardId }: TideCardContentProps) {
  const services = useTideCardServices(cardId);
  // Subscribe to the restore registry so `TideRestoring` mounts as
  // soon as `restoreTideSessions` fires a `spawn_session(resume)` for
  // this card, and unmounts the moment the binding lands (registry
  // entry cleared via the cardSessionBindingStore subscriber inside
  // `tide-session-restore`).
  const restoreMap = useSyncExternalStore(
    tideRestoreRegistry.subscribe,
    tideRestoreRegistry.getSnapshot,
  );
  if (services !== null) {
    return <TideCardServicesGate cardId={cardId} services={services} />;
  }
  const expectation = restoreMap.get(cardId);
  if (expectation !== undefined) {
    return (
      <TideRestoring
        cardId={cardId}
        projectDir={expectation.projectDir}
      />
    );
  }
  return <TideProjectPicker cardId={cardId} />;
}

// ---------------------------------------------------------------------------
// TideCardServicesGate — transportState routing
// ---------------------------------------------------------------------------

/**
 * Routes between `TideCardBody` and `TideRestoring` based on the
 * per-card store's `transportState` ([D01]). When the wire is `online`
 * the body renders normally; when it's `restoring` (between
 * `transport_open` and `transport_settled`) the same placeholder used
 * by the registry-driven path takes over until the binding is
 * re-acked. The hint text + Cancel button are still useful even when
 * the registry has no entry — the UI is honestly "we know the wire is
 * back; we don't yet know if your session survived."
 *
 * Why a wrapper rather than an early return inside `TideCardBody`:
 * `TideCardBody` calls many hooks after the snapshot read; an early
 * return there would change hook order between renders. Localizing
 * the transportState read in this thin gate keeps `TideCardBody`'s
 * hook list stable.
 *
 * The gate also reads `projectDir` reactively from the binding store
 * so the placeholder's project label keeps up with any rebind that
 * happens while transportState is in flight (rare; this is defensive
 * against the single notify per `setBinding`).
 */
function TideCardServicesGate({
  cardId,
  services,
}: TideCardBodyProps) {
  const transportState = useSyncExternalStore(
    services.codeSessionStore.subscribe,
    () => services.codeSessionStore.getSnapshot().transportState,
  );
  const projectDir = useSyncExternalStore(
    cardSessionBindingStore.subscribe,
    useCallback(
      () => cardSessionBindingStore.getBinding(cardId)?.projectDir ?? "",
      [cardId],
    ),
  );

  if (transportState === "restoring") {
    return <TideRestoring cardId={cardId} projectDir={projectDir} />;
  }

  return <TideCardBody cardId={cardId} services={services} />;
}

// ---------------------------------------------------------------------------
// TideRestoring — in-flight restore placeholder
// ---------------------------------------------------------------------------

/**
 * Renders inline in the card body while `tide-session-restore` has a
 * pending restore expectation for this card. Replaces the project
 * picker so the picker sheet never gets a chance to half-drop during
 * the restore → binding hand-off. The Cancel button clears the
 * expectation and drops to the picker with a `restore_canceled`
 * notice; server state is preserved so the next reload will retry.
 */
function TideRestoring({
  cardId,
  projectDir,
}: {
  cardId: string;
  projectDir: string;
}) {
  const handleCancel = useCallback(() => {
    cancelTideRestore(cardId);
  }, [cardId]);
  return (
    <div
      className="tide-card-restoring-backdrop"
      data-slot="tide-card-restoring"
      data-testid="tide-card-restoring"
    >
      <div className="tide-card-restoring-panel" role="status" aria-live="polite">
        <h2 className="tide-card-restoring-title">Restoring session</h2>
        <p
          className="tide-card-restoring-project"
          title={projectDir}
          data-testid="tide-card-restoring-project"
        >
          {projectDir}
        </p>
        <div className="tide-card-restoring-footer">
          <span className="tide-card-restoring-spinner">
            <TugProgress
              variant="spinner"
              size="sm"
              aria-label={`Restoring session from ${projectDir}`}
            />
          </span>
          <TugPushButton
            emphasis="outlined"
            onClick={handleCancel}
            data-testid="tide-card-restoring-cancel"
          >
            Cancel
          </TugPushButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TideProjectPicker
// ---------------------------------------------------------------------------

interface TideProjectPickerProps {
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
 *             `useTideCardServices` transitions from `null` to a ready
 *             services bag, flipping the card into its split-pane body.
 *   - Cancel → sheet closes; the card closes too (dispatch `close`
 *             through the responder chain to the first card responder).
 *   - Escape → same as Cancel.
 *
 * No "waiting" affordance in 4c. If `spawn_session_ok` never arrives,
 * the card is simply empty (sheet already dismissed). The `lastError`
 * banner arrives in Step 6.
 */
function TideProjectPicker({ cardId }: TideProjectPickerProps) {
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
    // `TideCardContent` can flip to `TideRestoring`).
    const noticeForRetry = noticeRef.current;
    const retryTugSessionId = noticeForRetry?.staleTugSessionId;
    const retryProjectDir = noticeForRetry?.staleProjectDir;
    const canRetry =
      retryTugSessionId !== undefined && retryProjectDir !== undefined;

    void showSheet({
      title: "Open Project",
      // Capture the cascade target at sheet-open time per
      // `tugplan-tide-overlay-framework.md` [D02]. `cardId` is the
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
        <TideProjectPickerForm
          notice={noticeRef.current}
          onOpen={(projectDir, sessionMode, sessionId) => {
            const connection = getConnection();
            if (!connection) {
              console.warn("TideProjectPicker: connection unavailable");
              return;
            }
            sendSpawnSession(
              connection,
              cardId,
              sessionId,
              projectDir,
              sessionMode,
            );
            close("open");
          }}
          onCancel={() => close("cancel")}
          onRetryRestore={
            canRetry
              ? () => {
                  const connection = getConnection();
                  if (!connection) {
                    console.warn(
                      "TideProjectPicker: connection unavailable for retry",
                    );
                    return;
                  }
                  fireRestore(
                    cardId,
                    retryTugSessionId as string,
                    retryProjectDir as string,
                    connection,
                  );
                  close("retry");
                }
              : null
          }
        />
      ),
      // Fire after the sheet's exit animation finishes so the card
      // close chains visibly after the sheet has disappeared rather
      // than unmounting underneath it. "open" leaves the card
      // mounted; the binding subscription flips it into the
      // split-pane body once `spawn_session_ok` arrives. "retry"
      // leaves the card mounted too — the retry path has already
      // fired a fresh `fireRestore` which registers a new
      // expectation, so `TideCardContent` will re-render into
      // `TideRestoring` and the close-chain must not fire.
      //
      // Cascade dispatch via `sendToTarget(cardId, …)` per [D02]:
      // first-responder state at this moment is fragile (it settles
      // via the unregister fallback after FocusScope unmount, focusin
      // handlers, and stale-focus re-promotion) and was the source of
      // the cancel-cascade bug fixed here. `sendToTarget` walks
      // `parentId` from a known node, independent of focus settling.
      onClosed: (result) => {
        if (result === "open" || result === "retry") return;
        manager?.sendToTarget(cardId, {
          action: TUG_ACTIONS.CLOSE,
          sender: senderId,
          phase: "discrete",
        });
      },
    });
  }, [showSheet, cardId, manager, senderId]);

  useLayoutEffect(() => {
    if (cardLifecycle === null) return;
    return cardLifecycle.observeCardDidActivate(cardId, () => presentSheet());
  }, [cardLifecycle, cardId, presentSheet]);

  return (
    <div
      className="tide-card-picker-backdrop"
      data-slot="tide-card-picker"
      data-testid="tide-card-picker"
      aria-hidden="true"
    >
      {renderSheet()}
    </div>
  );
}

interface TideProjectPickerFormProps {
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
   * `TideRestoring` and the whole cycle runs again. `null` on a
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
 * entry. Mirrors `readTideRecentProjects` in shape — split out so the
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

function TideProjectPickerForm({ notice, onOpen, onCancel, onRetryRestore }: TideProjectPickerFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // External state reaches React via `useSyncExternalStore` (per [L02]).
  // - `recents` still rides on tugbank (a small, mostly-static set of
  //   recent project paths).
  // - The session list now flows through the tugcast-side
  //   `TideSessionLedgerStore` via `useSessionLedger`. The store
  //   dispatches a `list_sessions` request keyed on the user-typed
  //   path; the response settles to a snapshot, and `session_updated`
  //   pushes patch the cache in place.
  const recents = useTugbankValue(
    "dev.tugtool.tide",
    "recent-projects",
    parseRecents,
    EMPTY_STRING_ARRAY as string[],
  );

  // Live path state drives the resume-option visibility. The input
  // is controlled; recents clicks call setPath so every path flows
  // through the Start-fresh / Resume choice rather than
  // spawning directly.
  const [path, setPath] = useState("");
  // Selected radio row. `"new"` is the synthetic Start-fresh row;
  // any other value is a `session_id` from the ledger snapshot. The
  // stored value is the wire identity of the chosen action — submit
  // forwards `"new"` → fresh + new uuid, anything else → resume with
  // that exact session id.
  const [selectedRow, setSelectedRow] = useState<string>("new");

  // The TugRadioGroup dispatches `selectValue` actions through the
  // responder chain per L11 — `useResponderForm` installs a handler
  // that routes the dispatch to `setSelectedRow` by sender id.
  const sessionRowSenderId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [sessionRowSenderId]: (next) => {
        // Accept "new" or any non-empty string (a session id). Empty
        // values are ignored as a defensive guard.
        if (typeof next === "string" && next.length > 0) {
          setSelectedRow(next);
        }
      },
    },
  });

  // Subscribe the picker to the session-ledger store keyed on the
  // user's typed path. Pre-typing: empty path → idle snapshot, no
  // request. Post-typing: pending → ready as the server's
  // `list_sessions_ok` lands. Live `session_updated` pushes during
  // the picker's lifetime patch the snapshot in place.
  const trimmedPath = path.trim();
  const sessionLedger = useSessionLedger(trimmedPath);

  // Non-live rows the picker offers as Resume targets. Live rows are
  // shown but disabled — they belong to another card and clicking them
  // would race the live-elsewhere rejection.
  const sessionRows: ReadonlyArray<SessionRow> =
    sessionLedger.status === "ready" ? sessionLedger.rows : [];

  // True while the ledger request is in flight (after the user types or
  // selects a recent, before `list_sessions_ok` lands). The picker shows
  // a subdued placeholder so the empty row list during pending doesn't
  // falsely advertise "no sessions to resume".
  const resumePending =
    trimmedPath.length > 0 && sessionLedger.status === "pending";

  // Track the currently-resolved resume candidate (the selected
  // session id, when not "new"). Used by `submit` to forward the right
  // session id on the wire.
  const resumeCandidate = useMemo<SessionRow | null>(() => {
    if (selectedRow === "new") return null;
    return sessionRows.find((r) => r.session_id === selectedRow) ?? null;
  }, [selectedRow, sessionRows]);

  // The selected row is "live elsewhere" when its `state === "live"` —
  // some other card is holding it. Submission is gated to prevent the
  // race; the server's `session_live_elsewhere` is the safety net.
  const selectedRowLiveElsewhere =
    resumeCandidate !== null && resumeCandidate.state === "live";

  // Revert the selection to "new" if the user edits the path into a
  // workspace where the previously-selected session id no longer
  // appears (e.g., they switched projects). Prevents a stale id from
  // silently being the active choice on submit.
  useLayoutEffect(() => {
    if (selectedRow === "new") return;
    const stillVisible = sessionRows.some((r) => r.session_id === selectedRow);
    if (!stillVisible) setSelectedRow("new");
  }, [selectedRow, sessionRows]);

  const submit = useCallback(() => {
    const trimmed = inputRef.current?.value.trim() ?? "";
    if (!trimmed) return;
    // Defense-in-depth: if selectedRow points at a session id but the
    // candidate vanished (race), downgrade to "new" on the wire.
    const effectiveMode: CardSessionMode =
      resumeCandidate !== null && !selectedRowLiveElsewhere ? "resume" : "new";
    const effectiveSessionId =
      effectiveMode === "resume" && resumeCandidate !== null
        ? resumeCandidate.session_id
        : crypto.randomUUID();
    logSessionLifecycle("picker.submit", {
      project_dir: trimmed,
      session_mode: effectiveMode,
      session_id: effectiveSessionId,
      resume_candidate_id: resumeCandidate?.session_id ?? null,
    });
    onOpen(trimmed, effectiveMode, effectiveSessionId);
  }, [onOpen, resumeCandidate, selectedRowLiveElsewhere]);

  // Forget actions go through the singleton ledger store. The store
  // dispatches the CONTROL request and the eventual `session_updated`
  // push patches the picker's snapshot — the row vanishes without
  // re-mount.
  const handleForgetSession = useCallback((sessionId: string): void => {
    const store = getTideSessionLedgerStore();
    if (store === null) return;
    void store.forgetSession(sessionId);
    // If the user was sitting on this row, fall back to Start-fresh.
    setSelectedRow((prev) => (prev === sessionId ? "new" : prev));
  }, []);

  const handleForgetAll = useCallback((): void => {
    const store = getTideSessionLedgerStore();
    if (store === null) return;
    // Forget by-typed-path is implemented client-side as N per-row
    // forget calls. The server's `forget_workspace_sessions` matches by
    // canonical workspace_key, which the picker doesn't have for an
    // arbitrary typed path; per-row forgets each match by session_id.
    for (const row of sessionRows) {
      if (row.state === "live") continue;
      void store.forgetSession(row.session_id);
    }
    setSelectedRow("new");
  }, [sessionRows]);

  const nonLiveRowCount = sessionRows.filter((r) => r.state !== "live").length;

  return (
    <ResponderScope>
      <div className="tide-card-picker-form" ref={responderRef}>
        {notice !== null && (
          <div
            className="tide-card-picker-notice"
            role="status"
            data-testid="tide-card-picker-notice"
            data-notice-category={notice.category}
          >
            {noticeText(notice)}
            {onRetryRestore !== null && (
              <div className="tide-card-picker-notice-actions">
                <TugPushButton
                  emphasis="outlined"
                  onClick={onRetryRestore}
                  data-testid="tide-card-picker-notice-retry"
                >
                  Retry
                </TugPushButton>
              </div>
            )}
          </div>
        )}
        <label className="tide-card-picker-field">
          <span className="tide-card-picker-label">Project path</span>
          <TugInput
            ref={inputRef}
            type="text"
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
        {recents.length > 0 && (
          <div className="tide-card-picker-recents">
            <span className="tide-card-picker-label">Recent</span>
            <div className="tide-card-picker-recents-list">
              {recents.map((p) => (
                // 4.5 regression from 4m: a recent click now fills the
                // input. Single-click spawn was removed so every path
                // goes through the Start-fresh / Resume-last radio
                // group below.
                <TugPushButton
                  key={p}
                  emphasis="ghost"
                  role="action"
                  onClick={() => setPath(p)}
                >
                  {p}
                </TugPushButton>
              ))}
            </div>
          </div>
        )}
        {/*
          Start-fresh is always present and selected by default. Resume
          rows render one per non-empty ledger row (newest first) once
          the snapshot is `ready`. Live rows are visible but disabled —
          another card holds them; the server's `session_live_elsewhere`
          rejection is the safety net.

          Each row keeps the user-facing detail (snippet + relative
          timestamp + turn count + state pill) inside the radio label so
          a single click both selects the radio and conveys what the row
          represents.

          Loading state: while the ledger request is in flight (typically
          <50ms after the user types or selects a recent), render a
          subdued "checking…" placeholder under the radio group. An empty
          row list during pending would falsely advertise "no sessions
          to resume"; the placeholder makes the loading state legible.
        */}
        {resumePending && (
          <div
            className="tide-card-picker-pending-placeholder"
            data-testid="tide-card-picker-pending-placeholder"
            role="status"
            aria-live="polite"
          >
            checking…
          </div>
        )}
        <TugRadioGroup
          aria-label="Session mode"
          value={selectedRow}
          senderId={sessionRowSenderId}
          size="md"
          orientation="vertical"
        >
          <TugRadioItem value="new">
            <span className="tide-card-picker-session-option">
              <span className="tide-card-picker-session-option-title">
                Start fresh
              </span>
              <span className="tide-card-picker-session-option-subtitle">
                New conversation
              </span>
            </span>
          </TugRadioItem>
          {sessionRows.map((row) => {
            const isLive = row.state === "live";
            const isFailed = row.state === "failed";
            const fullPrompt =
              row.first_user_prompt !== null && row.first_user_prompt.length > 0
                ? row.first_user_prompt
                : null;
            const snippet =
              fullPrompt !== null ? truncateForDisplay(fullPrompt, 64) : null;
            // Subtitle copy is state-driven so the user always understands
            // why a row is unavailable. Closed rows show the contextual
            // metadata (timestamp · turns · short id); live and failed
            // rows show the diagnostic from the plan's picker UX spec.
            const subtitleText = isLive
              ? "Live in another card"
              : isFailed
                ? "Couldn't resume — JSONL missing"
                : formatSessionRowSubtitle(row);
            const idShort = row.session_id.slice(0, 8);
            return (
              <TugRadioItem
                key={row.session_id}
                value={row.session_id}
                disabled={isLive}
              >
                <span
                  className="tide-card-picker-session-option"
                  data-state={row.state}
                >
                  {/* Title carries the truncated snippet for the row's
                      visual; the full text lives on `title` so a hover
                      tooltip reveals long prompts the truncation hid.
                      `aria-label` on the title lets screen readers
                      announce the full prompt rather than the truncated
                      span text. */}
                  <span
                    className="tide-card-picker-session-option-title"
                    title={fullPrompt ?? undefined}
                    aria-label={fullPrompt ?? undefined}
                  >
                    {snippet ?? <em>No prompts yet</em>}
                  </span>
                  <span
                    className="tide-card-picker-session-option-subtitle"
                    data-testid={
                      row === sessionRows[0]
                        ? "tide-card-picker-resume-subtitle"
                        : undefined
                    }
                  >
                    {subtitleText}
                  </span>
                </span>
                {!isLive && (
                  <button
                    type="button"
                    className="tide-card-picker-session-forget"
                    aria-label={`Forget session ${idShort}`}
                    title={`Forget session ${idShort}`}
                    onClick={(e) => {
                      // Stop the click from selecting the radio — the
                      // user is forgetting, not choosing this row.
                      e.stopPropagation();
                      e.preventDefault();
                      handleForgetSession(row.session_id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {/* Icon-only Forget per the plan's picker UX. The
                        accessible label is on the button itself; the
                        glyph is decorative. */}
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
                {isLive && (
                  <TugBadge emphasis="tinted" role="action">
                    live
                  </TugBadge>
                )}
                {isFailed && (
                  <TugBadge emphasis="tinted" role="danger">
                    failed
                  </TugBadge>
                )}
              </TugRadioItem>
            );
          })}
        </TugRadioGroup>
        {nonLiveRowCount > 0 && (
          <div className="tide-card-picker-forget-all">
            <TugPushButton
              emphasis="ghost"
              role="action"
              onClick={handleForgetAll}
              data-testid="tide-card-picker-forget-all"
            >
              Forget all sessions for this path
            </TugPushButton>
          </div>
        )}
        <div className="tug-sheet-actions">
          <TugPushButton emphasis="outlined" role="action" onClick={onCancel}>
            Cancel
          </TugPushButton>
          <TugPushButton emphasis="filled" role="action" onClick={submit}>
            Open
          </TugPushButton>
        </div>
      </div>
    </ResponderScope>
  );
}

/**
 * Truncate a single-line snippet for display in a picker row. Honors
 * Unicode-scalar boundaries (no mid-codepoint slice) and adds an
 * ellipsis when the source exceeds the budget.
 */
function truncateForDisplay(s: string, max: number): string {
  // Replace newlines + collapse whitespace so multi-line prompts read
  // as a single line in the row's title.
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  const chars = Array.from(flat);
  if (chars.length <= max) return flat;
  return chars.slice(0, max).join("") + "…";
}

/**
 * Build the subtitle line for a session row: relative timestamp, turn
 * count, and short identifier. The picker shows this under the snippet
 * to give the user enough context to recognize one session vs another.
 */
function formatSessionRowSubtitle(row: SessionRow): string {
  const turns =
    row.turn_count > 0
      ? `${row.turn_count} ${row.turn_count === 1 ? "turn" : "turns"}`
      : null;
  const ts = formatRelativeTimestamp(row.last_used_at, Date.now());
  const id = `id ${row.session_id.slice(0, 8)}…`;
  return [ts, turns, id].filter((p) => p !== null).join(" · ");
}

/**
 * Format `then` (unix millis) relative to `now`. Returns short forms:
 * "just now", "Nm ago", "Nh ago", "yesterday", "Nd ago", or a
 * locale-formatted date for anything older than a week.
 */
function formatRelativeTimestamp(then: number, now: number): string {
  const deltaMs = Math.max(0, now - then);
  const deltaSec = Math.floor(deltaMs / 1_000);
  if (deltaSec < 30) return "just now";
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay === 1) return "yesterday";
  if (deltaDay < 7) return `${deltaDay}d ago`;
  // Older than a week: locale-formatted short date. Stable across locales
  // for tests via toLocaleDateString without an explicit locale arg.
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface TideCardBodyProps {
  cardId: string;
  services: TideCardServices;
}

export function TideCardBody({ cardId, services }: TideCardBodyProps) {
  const { codeSessionStore, sessionMetadataStore, historyStore, completionProviders, editorStore, entryDelegateRef } = services;

  useTideCardObserver(cardId, codeSessionStore);

  const entryPanelRef = useRef<TugSplitPanelHandle | null>(null);

  const codeSnap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );

  // --- lastError banner state. ---
  // UI-only dismiss: track the `at` timestamp of the last-dismissed error.
  // A new error (different `at`) naturally reappears. The store owns the
  // clear semantics — on retry submit or turn_complete(success) the snapshot
  // transitions to `lastError: null` and the derivation drops the banner.
  // `resume_failed` is filtered out here because `useTideCardObserver` is
  // about to clear the binding and route that cause through the picker.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const bannerError =
    codeSnap.lastError !== null &&
    codeSnap.lastError.cause !== "resume_failed" &&
    codeSnap.lastError.at !== dismissedAt
      ? (codeSnap.lastError as NonNullable<CodeSessionSnapshot["lastError"]> & {
          cause: BannerErrorCause;
        })
      : null;

  // Once the session hits any non-recoverable error, disable the entry —
  // the dismiss gesture only hides the banner, the underlying session is
  // still dead. The user recovers by closing and reopening the card.
  // `resume_failed` is excluded here because the card observer unmounts
  // the bound body on that cause (the picker sheet re-renders instead).
  const sessionErrored =
    codeSnap.lastError !== null &&
    codeSnap.lastError.cause !== "resume_failed";

  // Transport-state banner — covers the case where the wire dropped on
  // an idle card. Non-idle phases set `lastError.cause = "transport_closed"`
  // ([D06]), which the error banner above already surfaces with full
  // detail; idle stays `lastError: null` so without this branch an idle
  // offline card would show no UI at all (just a disabled send button).
  // The error banner takes precedence to avoid two banners stacking;
  // restoring is unreachable here because `TideCardServicesGate`
  // routes that case to `TideRestoring`, but covering it keeps the
  // computation total.
  const showTransportBanner =
    bannerError === null && codeSnap.transportState !== "online";
  const transportBannerLabel =
    codeSnap.transportState === "offline"
      ? "Reconnecting"
      : "Restoring session";
  const transportBannerMessage =
    codeSnap.transportState === "offline"
      ? "Lost the connection to tugcast. Trying to reconnect…"
      : "The connection is back. Re-acknowledging your session…";

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
    cardDidActivate: () => entryDelegateRef.current?.focus(),
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
      entryDelegateRef.current?.focus();
    },
    cardDidResize: () => {
      if (cardLifecycle?.getFirstResponderCardId() !== cardId) return;
      entryDelegateRef.current?.focus();
    },
  });

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
  // can type the next prompt immediately. `onAfterSubmit` fires from
  // `performSubmit` only on the send/handled path — not on the Stop
  // (canInterrupt) branch, not on blocked submits — so failures that
  // surface later via `lastError` are inspectable without the caret
  // yanking back mid-read.
  const handleAfterSubmit = useCallback(() => {
    entryDelegateRef.current?.focus();
  }, [entryDelegateRef]);

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
  // --- Stable senders for the editor-settings controls. Declared
  // here so both `useResponderForm` (below) and the sheet body
  // can reference them. ---
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const letterSpacingPopupId = useId();
  const lineHeightPopupId = useId();
  const lineWrapId = useId();
  const lineNumbersId = useId();
  const activeLineGutterId = useId();

  // --- Editor-settings sheet (title-bar `…` button → OPEN_MENU). ---
  const { showSheet, renderSheet } = useTugSheet();
  // Each `showSheet()` mounts a fresh sheet body, but the body
  // subscribes to `editorStore` directly so it tracks live changes
  // (e.g. the user toggling a switch) without an outer re-render.
  const openEditorSettingsSheet = useCallback(() => {
    void showSheet({
      title: "Editor settings",
      content: (close) => (
        <EditorSettingsSheetBody
          editorStore={editorStore}
          fontPopupId={fontPopupId}
          fontSizePopupId={fontSizePopupId}
          letterSpacingPopupId={letterSpacingPopupId}
          lineHeightPopupId={lineHeightPopupId}
          lineWrapId={lineWrapId}
          lineNumbersId={lineNumbersId}
          activeLineGutterId={activeLineGutterId}
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
  }, [
    showSheet,
    editorStore,
    fontPopupId,
    fontSizePopupId,
    letterSpacingPopupId,
    lineHeightPopupId,
    lineWrapId,
    lineNumbersId,
    activeLineGutterId,
  ]);

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
      [TUG_ACTIONS.OPEN_MENU]: (_event: ActionEvent) => {
        openEditorSettingsSheet();
      },
    },
  });

  // --- Responder scope for the editor-settings controls. ---
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
      [letterSpacingPopupId]: (v: number) => editorStore.set({ letterSpacing: v }),
      [lineHeightPopupId]: (v: number) => editorStore.set({ lineHeight: v }),
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
  // handoff. Fallback to null is defensive: `TideCardBody` only renders
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
  const statusContent = projectDir !== null ? (
    <TugBadge size="sm" emphasis="tinted" role="data">
      Project: {projectDir}
    </TugBadge>
  ) : null;

  return (
    <CardContentResponderScope>
      <div
        ref={(el) => {
          (cardContentResponderRef as (node: Element | null) => void)(el);
        }}
        className="tide-card"
        data-slot="tide-card"
        data-testid="tide-card"
      >
      <TugSplitPane
        orientation="horizontal"
        showHandle={false}
        disabled={maximized}
        storageKey="tide.prompt-entry"
      >
        <TugSplitPanel id="tide-card-top" defaultSize="70%" minSize="10%">
          <TugMarkdownView
            className="tide-card-stream"
            streamingStore={codeSessionStore.streamingDocument}
            streamingPath={codeSnap.streamingPaths.assistant}
          />
        </TugSplitPanel>
        <TugSplitPanel
          ref={entryPanelRef}
          id="tide-card-bottom"
          defaultSize="30%"
          minSize="180px"
          maxSize="90%"
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
              className="tide-card-entry-pane"
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
                statusContent={statusContent}
                lineWrap={editorSettings.lineWrap}
                lineNumbers={editorSettings.lineNumbers}
                highlightActiveLineGutter={editorSettings.highlightActiveLineGutter}
                maximized={maximized}
                onMaximizeChange={setMaximized}
                componentStatePreservationKey="entry-chrome"
              />
            </TugBox>
            {renderSheet()}
          </ResponderScope>
        </TugSplitPanel>
      </TugSplitPane>
      <TugPaneBanner
        visible={bannerError !== null}
        variant="error"
        tone="danger"
        label={bannerError ? CAUSE_LABELS[bannerError.cause] : undefined}
        message={bannerError?.message ?? ""}
        detailIcon="unplug"
        detailTitle={bannerError ? CAUSE_LABELS[bannerError.cause] : undefined}
        footer={
          bannerError !== null ? (
            <TugPushButton
              emphasis="outlined"
              role="danger"
              onClick={() => setDismissedAt(bannerError.at)}
            >
              Dismiss
            </TugPushButton>
          ) : undefined
        }
      >
        <p>The card can&apos;t reach its session. Dismiss to continue; close and reopen the card to retry.</p>
      </TugPaneBanner>
      {/*
        Transport-state status banner. Shown when the wire is dropped
        on an idle card (where lastError stays null per [D06]) — non-
        idle phases already get the error banner above with cause
        `transport_closed`. The two banners are mutually exclusive at
        the source (see `showTransportBanner`); only one ever has
        `visible: true` at a time.

        The status variant + caution tone signal "transient,
        recoverable" rather than "errored, action required". No
        Dismiss button: the banner clears itself once the wire is
        back ([D04] reconnect path → store flips transportState back
        to `online` → banner unmounts via the visible flip).
      */}
      <TugPaneBanner
        visible={showTransportBanner}
        variant="status"
        tone="caution"
        icon="unplug"
        label={transportBannerLabel}
        message={transportBannerMessage}
      />
      </div>
    </CardContentResponderScope>
  );
}

// ---------------------------------------------------------------------------
// EditorSettingsSheetBody — sheet content for the title-bar `…` menu
// ---------------------------------------------------------------------------

/**
 * Props for {@link EditorSettingsSheetBody}.
 *
 * Sender ids are provided by the enclosing `TideCardBody` so the form
 * bindings (registered there via `useResponderForm`) can target the
 * controls. The store reference is forwarded so the body can subscribe
 * directly via `useSyncExternalStore` and stay in sync without an
 * outer re-render of the sheet payload.
 */
interface EditorSettingsSheetBodyProps {
  editorStore: EditorSettingsStore;
  fontPopupId: string;
  fontSizePopupId: string;
  letterSpacingPopupId: string;
  lineHeightPopupId: string;
  lineWrapId: string;
  lineNumbersId: string;
  activeLineGutterId: string;
  /** Dismiss callback supplied by `useTugSheet`'s render closure. */
  onClose: () => void;
}

/**
 * Body of the editor-settings sheet shown when the user taps the `…`
 * button in the Tide card's title bar.
 *
 * Sections:
 *   1. **Typography** — Font / Size / Line / Spacing popup buttons,
 *      all on one row.
 *   2. **View** — Line wrap / Line numbers / Active line, each on
 *      its own row with the label after the switch (TugSwitch's
 *      native layout convention).
 */
function EditorSettingsSheetBody({
  editorStore,
  fontPopupId,
  fontSizePopupId,
  letterSpacingPopupId,
  lineHeightPopupId,
  lineWrapId,
  lineNumbersId,
  activeLineGutterId,
  onClose,
}: EditorSettingsSheetBodyProps) {
  const editorSettings = useSyncExternalStore(
    editorStore.subscribe,
    editorStore.getSnapshot,
  );

  const letterSpacingLabel =
    editorSettings.letterSpacing === 0
      ? "Normal"
      : `${editorSettings.letterSpacing > 0 ? "+" : ""}${editorSettings.letterSpacing.toFixed(2)} px`;

  return (
    <div className="tide-card-settings">
      <div className="tide-card-settings-row">
        <TugPopupButton
          className="tide-card-settings-popup tide-card-settings-popup-font"
          topLabel="Font"
          label={EDITOR_FONT_OPTIONS.find(f => f.value === editorSettings.fontId)?.label ?? "Font"}
          items={EDITOR_FONT_OPTIONS}
          senderId={fontPopupId}
          size="sm"
        />
        <TugPopupButton
          className="tide-card-settings-popup tide-card-settings-popup-size"
          topLabel="Size"
          label={`${editorSettings.fontSize}px`}
          items={FONT_SIZE_OPTIONS}
          senderId={fontSizePopupId}
          size="sm"
        />
        <TugPopupButton
          className="tide-card-settings-popup tide-card-settings-popup-line"
          topLabel="Line"
          label={editorSettings.lineHeight.toFixed(1)}
          items={LINE_HEIGHT_OPTIONS}
          senderId={lineHeightPopupId}
          size="sm"
        />
        <TugPopupButton
          className="tide-card-settings-popup tide-card-settings-popup-spacing"
          topLabel="Spacing"
          label={letterSpacingLabel}
          items={LETTER_SPACING_OPTIONS}
          senderId={letterSpacingPopupId}
          size="sm"
        />
      </div>

      <TugSeparator />

      <div className="tide-card-settings-switches">
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

      <div className="tug-sheet-actions">
        <TugPushButton
          autoFocus
          emphasis="filled"
          role="action"
          onClick={onClose}
          data-tug-default-button="ok"
        >
          OK
        </TugPushButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// registerTideCard
// ---------------------------------------------------------------------------

/**
 * Register the Tide card in the global card registry.
 *
 * Must be called before `DeckManager.addCard("tide")` is invoked.
 * Call from `main.tsx` alongside `registerGitCard()`.
 */
export function registerTideCard(): void {
  registerCard({
    componentId: "tide",
    contentFactory: (cardId) => <TideCardContent cardId={cardId} />,
    defaultMeta: { title: "Tide", icon: "MessageSquareText", closable: true },
    defaultFeedIds: [
      FeedId.CODE_INPUT,
      FeedId.CODE_OUTPUT,
      FeedId.SESSION_METADATA,
      FeedId.FILETREE,
    ],
    sizePolicy: {
      min: { width: 320, height: 240 },
      preferred: { width: 720, height: 540 },
    },
    engineKind: "em",
  });
}
