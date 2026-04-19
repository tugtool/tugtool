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
import { TugSplitPane, TugSplitPanel, type TugSplitPanelHandle } from "../tug-split-pane";
import { useContentDrivenPanelSize } from "../use-content-driven-panel-size";
import { TugBox } from "../tug-box";
import { TugBadge } from "../tug-badge";
import { TugInput } from "../tug-input";
import { TugPushButton } from "../tug-push-button";
import { TugRadioGroup, TugRadioItem } from "../tug-radio-group";
import { TugPopupButton } from "../tug-popup-button";
import type { TugPopupButtonItem } from "../tug-popup-button";
import { useTugSheet } from "../tug-sheet";
import { useResponderChain } from "../responder-chain-provider";
import { useResponderForm } from "../use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";
import type { CodeSessionSnapshot, CodeSessionStore } from "@/lib/code-session-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import type { EditorSettingsStore } from "@/lib/editor-settings-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getConnection } from "@/lib/connection-singleton";
import { registerCard } from "@/card-registry";
import { FeedId } from "@/protocol";
import type { CompletionProvider } from "@/lib/tug-text-engine";
import {
  cardSessionBindingStore,
  type CardSessionMode,
} from "@/lib/card-session-binding-store";
import { sendSpawnSession } from "@/lib/session-lifecycle";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { pickerNoticeStore, type PickerNotice } from "@/lib/picker-notice-store";
import { cardServicesStore, type CardServices } from "@/lib/card-services-store";
import { useTideCardObserver } from "./use-tide-card-observer";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
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
 * project arrives once [4i](../../../../../roadmap/tugplan-tide-card.md#step-4i)
 * gives us a stable session id per workspace.
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
  if (services === null) {
    return <TideProjectPicker cardId={cardId} />;
  }
  return <TideCardBody cardId={cardId} services={services} />;
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

  useLayoutEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    void showSheet({
      title: "Open Project",
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
        />
      ),
      // Fire after the sheet's exit animation finishes so the card
      // close chains visibly after the sheet has disappeared rather
      // than unmounting underneath it. "open" leaves the card
      // mounted; the binding subscription flips it into the
      // split-pane body once `spawn_session_ok` arrives.
      onClosed: (result) => {
        if (result === "open") return;
        manager?.sendToFirstResponder({
          action: TUG_ACTIONS.CLOSE,
          sender: senderId,
          phase: "discrete",
        });
      },
    });
  }, [showSheet, cardId, manager, senderId]);

  return (
    <div
      className="tide-card-picker-backdrop"
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
   * after a session failure (e.g. a resume that didn't take). The
   * notice carries the reason so the user sees it in the same picker
   * that lets them choose what to do next. `null` when the picker is
   * opening fresh.
   */
  notice: PickerNotice | null;
  onOpen: (
    projectDir: string,
    sessionMode: CardSessionMode,
    sessionId: string,
  ) => void;
  onCancel: () => void;
}

/** One entry in the sessions record. */
interface SessionRecord {
  sessionId: string;
  projectDir: string;
  createdAt: number;
}

/**
 * Pure parser for the `dev.tugtool.tide / sessions` tagged-value entry.
 * Each entry is `{projectDir, createdAt}` keyed by the session id (the
 * single identifier claude uses as its own session id and tugcast
 * uses for feed routing). Returns `[]` for unset / malformed records.
 *
 * tugcode historically persisted the map as a JSON-stringified value
 * under `kind: "string"`; current writes go through tugbank as
 * `kind: "json"`. Both shapes are accepted.
 */
function parseAllSessions(entry: TaggedValue | undefined): SessionRecord[] {
  if (!entry) return [];
  let map: unknown;
  if (entry.kind === "json" && entry.value !== undefined) {
    map = entry.value;
  } else if (entry.kind === "string" && typeof entry.value === "string") {
    try {
      map = JSON.parse(entry.value);
    } catch {
      return [];
    }
  } else {
    return [];
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const out: SessionRecord[] = [];
  for (const [sessionId, raw] of Object.entries(map as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as { projectDir?: unknown; createdAt?: unknown };
    if (typeof rec.projectDir !== "string" || rec.projectDir.length === 0) continue;
    if (typeof rec.createdAt !== "number") continue;
    out.push({
      sessionId,
      projectDir: rec.projectDir,
      createdAt: rec.createdAt,
    });
  }
  return out;
}

/**
 * Pure parser for the `dev.tugtool.tide / live-sessions` tagged-value
 * entry. Returns the set of session ids currently bound to a card on
 * any tab/process talking to this tugcast. Tugcast maintains the set
 * in-memory and broadcasts it via the DEFAULTS feed; tugcast clears
 * it on startup so leftover ids from a prior process never leak.
 *
 * The picker uses this to grey out a "Resume last" row whose
 * candidate id is already in use by another card. The supervisor's
 * `session_live_elsewhere` rejection is the safety net for any
 * race where the picker's view is stale.
 */
function parseLiveSessions(entry: TaggedValue | undefined): Set<string> {
  const out = new Set<string>();
  if (!entry) return out;
  let raw: unknown;
  if (entry.kind === "json" && entry.value !== undefined) {
    raw = entry.value;
  } else if (entry.kind === "string" && typeof entry.value === "string") {
    try {
      raw = JSON.parse(entry.value);
    } catch {
      return out;
    }
  } else {
    return out;
  }
  if (!Array.isArray(raw)) return out;
  for (const id of raw) {
    if (typeof id === "string" && id.length > 0) out.add(id);
  }
  return out;
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
/** Stable empty `Set<string>` — same rationale. */
const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();
/** Stable empty `SessionRecord[]` reference. */
const EMPTY_SESSION_RECORDS: ReadonlyArray<SessionRecord> = [];

function TideProjectPickerForm({ notice, onOpen, onCancel }: TideProjectPickerFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // External state from tugbank reaches React via `useSyncExternalStore`
  // (per [L02]). The hooks below subscribe to the matching domain and
  // re-render on update. The picker is a short-lived sheet so live
  // updates rarely matter in practice, but a one-shot `useState` read
  // would copy external state into React state and violate L02.
  const recents = useTugbankValue(
    "dev.tugtool.tide",
    "recent-projects",
    parseRecents,
    EMPTY_STRING_ARRAY as string[],
  );
  const allSessions = useTugbankValue(
    "dev.tugtool.tide",
    "sessions",
    parseAllSessions,
    EMPTY_SESSION_RECORDS as SessionRecord[],
  );
  const liveSessions = useTugbankValue(
    "dev.tugtool.tide",
    "live-sessions",
    parseLiveSessions,
    EMPTY_STRING_SET as Set<string>,
  );

  // Live path state drives the resume-option visibility. The input
  // is controlled; recents clicks call setPath so every path flows
  // through the Start-fresh / Resume-last choice rather than
  // spawning directly.
  const [path, setPath] = useState("");
  const [sessionMode, setSessionMode] = useState<CardSessionMode>("new");

  // The TugRadioGroup dispatches `selectValue` actions through the
  // responder chain per L11 — `useResponderForm` installs a handler
  // that routes the dispatch to `setSessionMode` by sender id.
  const sessionModeSenderId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [sessionModeSenderId]: (next) => {
        if (next === "new" || next === "resume") {
          setSessionMode(next);
        }
      },
    },
  });

  // Resume is offered when the typed path has at least one record in
  // the sessions map. The picker presents the newest session's id on
  // the "Resume last session" row; the picker's Open handler forwards
  // it as-is on `spawn_session`. No per-card identifier translation.
  // Derives from `allSessions` (which is itself a `useSyncExternalStore`
  // value) so a fresh sessions write while the picker is open updates
  // the resume row without re-reading the tugbank cache here.
  const resumeCandidate = useMemo<SessionRecord | null>(() => {
    const trimmed = path.trim();
    if (trimmed.length === 0) return null;
    const candidates = allSessions
      .filter((r) => r.projectDir === trimmed)
      .sort((a, b) => b.createdAt - a.createdAt);
    return candidates[0] ?? null;
  }, [path, allSessions]);

  // The candidate is "live elsewhere" when its id appears in the
  // live-sessions broadcast from tugcast. The wire-side
  // `session_live_elsewhere` rejection in the supervisor is the
  // safety net if our read is stale.
  const candidateLiveElsewhere =
    resumeCandidate !== null && liveSessions.has(resumeCandidate.sessionId);
  const resumeDisabled = resumeCandidate === null || candidateLiveElsewhere;

  // Revert the selection to "new" if the user edits the path into a
  // workspace with no resume candidate (or where the candidate is
  // live elsewhere). Prevents a hidden radio from silently being the
  // active choice on submit.
  useLayoutEffect(() => {
    if (resumeDisabled && sessionMode === "resume") {
      setSessionMode("new");
    }
  }, [resumeDisabled, sessionMode]);

  const submit = useCallback(() => {
    const trimmed = inputRef.current?.value.trim() ?? "";
    if (!trimmed) return;
    // Defense-in-depth: if sessionMode is "resume" but the lookup
    // returned null (race between the state commit and submit click),
    // downgrade to "new" on the wire. For "new", always mint a brand-
    // new id so two concurrent Start-fresh clicks on the same project
    // get independent sessions. For "resume", use the candidate's id.
    const effectiveMode: CardSessionMode =
      sessionMode === "resume" && resumeCandidate !== null ? "resume" : "new";
    const effectiveSessionId =
      effectiveMode === "resume" && resumeCandidate !== null
        ? resumeCandidate.sessionId
        : crypto.randomUUID();
    logSessionLifecycle("picker.submit", {
      project_dir: trimmed,
      session_mode: effectiveMode,
      session_id: effectiveSessionId,
      resume_candidate_id: resumeCandidate?.sessionId ?? null,
    });
    onOpen(trimmed, effectiveMode, effectiveSessionId);
  }, [onOpen, resumeCandidate, sessionMode]);

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
            {notice.category === "resume_failed"
              ? "Couldn’t resume the previous session — it may have been deleted or is in use elsewhere. Pick a different option below."
              : notice.message}
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
          Both rows are always rendered. The Resume row is disabled
          when the typed workspace has no recorded session id — we do
          not hide it, because the user deserves to see every available
          option for this picker scenario (disabled rows communicate
          "this is a real choice, it just doesn't apply right now").
        */}
        <TugRadioGroup
          aria-label="Session mode"
          value={sessionMode}
          senderId={sessionModeSenderId}
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
          <TugRadioItem value="resume" disabled={resumeDisabled}>
            <span className="tide-card-picker-session-option">
              <span className="tide-card-picker-session-option-title">
                Resume last session
              </span>
              <span
                className="tide-card-picker-session-option-subtitle"
                data-testid="tide-card-picker-resume-subtitle"
              >
                {resumeCandidate === null
                  ? "No prior session for this path"
                  : candidateLiveElsewhere
                    ? `Session ${resumeCandidate.sessionId.slice(0, 8)}… is open in another card`
                    : `Session ${resumeCandidate.sessionId.slice(0, 8)}…`}
              </span>
            </span>
          </TugRadioItem>
        </TugRadioGroup>
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
        return entryDelegateRef.current?.getEditorElement() ?? null;
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

  // Animate the snap-back-to-userSize ONLY on explicit user submit —
  // not on any other data-empty transition (manual delete, undo, etc.).
  // Fires before `input.clear()` so the animated restore commits to
  // the library store first; the content-driven hook's subsequent
  // instant-restore is a no-op because the library store already
  // matches the user size. Skip while maximized — the maximize peg
  // owns the size.
  const handleBeforeSubmit = useCallback(() => {
    if (maximized) return;
    entryPanelRef.current?.restoreUserSize({ animated: true });
  }, [maximized]);

  // --- Responder scope for tools-panel popup buttons. ---
  const fontPopupId = useId();
  const fontSizePopupId = useId();
  const letterSpacingPopupId = useId();
  const lineHeightPopupId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    setValueString: {
      [fontPopupId]: (v: string) => editorStore.set({ fontId: v }),
    },
    setValueNumber: {
      [fontSizePopupId]: (v: number) => editorStore.set({ fontSize: v }),
      [letterSpacingPopupId]: (v: number) => editorStore.set({ letterSpacing: v }),
      [lineHeightPopupId]: (v: number) => editorStore.set({ lineHeight: v }),
    },
  });

  // --- Status row + tools panel content. ---
  const statusContent = (
    <TugBadge size="sm" emphasis="tinted" role="data">
      Project path /gallery/demo
    </TugBadge>
  );

  const letterSpacingLabel =
    editorSettings.letterSpacing === 0
      ? "Normal"
      : `${editorSettings.letterSpacing > 0 ? "+" : ""}${editorSettings.letterSpacing.toFixed(2)} px`;

  const toolsContent = (
    <>
      <TugPopupButton
        topLabel="Font"
        label={EDITOR_FONT_OPTIONS.find(f => f.value === editorSettings.fontId)?.label ?? "Font"}
        items={EDITOR_FONT_OPTIONS}
        senderId={fontPopupId}
        size="sm"
      />
      <TugPopupButton
        topLabel="Size"
        label={`${editorSettings.fontSize}px`}
        items={FONT_SIZE_OPTIONS}
        senderId={fontSizePopupId}
        size="sm"
      />
      <TugPopupButton
        topLabel="Tracking"
        label={letterSpacingLabel}
        items={LETTER_SPACING_OPTIONS}
        senderId={letterSpacingPopupId}
        size="sm"
      />
      <TugPopupButton
        topLabel="Leading"
        label={editorSettings.lineHeight.toFixed(1)}
        items={LINE_HEIGHT_OPTIONS}
        senderId={lineHeightPopupId}
        size="sm"
      />
    </>
  );

  return (
    <div className="tide-card" data-testid="tide-card">
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
          <div className="tide-card-bottom">
            {bannerError !== null && (
              <TideLastErrorBanner
                error={bannerError}
                onDismiss={() => setDismissedAt(bannerError.at)}
              />
            )}
            <ResponderScope>
              <TugBox
                ref={(el) => {
                  paneRef.current = el as HTMLDivElement | null;
                  (responderRef as (node: Element | null) => void)(el as Element | null);
                }}
                variant="plain"
                inset={false}
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
                  statusContent={statusContent}
                  toolsContent={toolsContent}
                  maximized={maximized}
                  onMaximizeChange={setMaximized}
                />
              </TugBox>
            </ResponderScope>
          </div>
        </TugSplitPanel>
      </TugSplitPane>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TideLastErrorBanner
// ---------------------------------------------------------------------------

interface TideLastErrorBannerProps {
  error: NonNullable<CodeSessionSnapshot["lastError"]> & {
    cause: BannerErrorCause;
  };
  onDismiss: () => void;
}

/**
 * Inline banner that surfaces `CodeSessionStore.lastError` above the
 * entry. Rendered as a thin full-width strip; dismiss is UI-only (the
 * store owns clear semantics — next successful turn or retry send
 * clears `lastError` and the banner disappears automatically).
 *
 * `resume_failed` never reaches this component; it's filtered in the
 * caller because `useTideCardObserver` routes that cause through the
 * picker-sheet instead.
 */
function TideLastErrorBanner({ error, onDismiss }: TideLastErrorBannerProps) {
  return (
    <div
      className="tide-card-error-banner"
      role="status"
      aria-live="polite"
      data-testid="tide-card-error-banner"
      data-cause={error.cause}
    >
      <span className="tide-card-error-banner-label">{CAUSE_LABELS[error.cause]}</span>
      <span className="tide-card-error-banner-message">{error.message}</span>
      <button
        type="button"
        className="tide-card-error-banner-dismiss"
        aria-label="Dismiss error"
        onClick={onDismiss}
      >
        ×
      </button>
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
  });
}
