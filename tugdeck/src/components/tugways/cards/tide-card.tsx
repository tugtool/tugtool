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
import { CodeSessionStore } from "@/lib/code-session-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { FeedStore, type FeedStoreFilter } from "@/lib/feed-store";
import { EditorSettingsStore } from "@/lib/editor-settings-store";
import { SessionMetadataStore } from "@/lib/session-metadata-store";
import { getConnection } from "@/lib/connection-singleton";
import { presentWorkspaceKey, registerCard } from "@/card-registry";
import { FeedId } from "@/protocol";
import type { CompletionProvider } from "@/lib/tug-text-engine";
import { useCardWorkspaceKey } from "@/components/tugways/hooks/use-card-workspace-key";
import {
  cardSessionBindingStore,
  type CardSessionBinding,
  type CardSessionMode,
} from "@/lib/card-session-binding-store";
import { sendCloseSession, sendSpawnSession } from "@/lib/session-lifecycle";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { pickerNoticeStore, type PickerNotice } from "@/lib/picker-notice-store";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import {
  insertTideRecentProject,
  putTideRecentProjects,
  readTideRecentProjects,
} from "@/settings-api";
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

interface InternalServices {
  codeSessionStore: CodeSessionStore;
  editorStore: EditorSettingsStore;
  sessionMetadataStack: {
    feedStore: FeedStore;
    store: SessionMetadataStore;
  };
  fileTreeStack: {
    feedStore: FeedStore;
    fileTreeStore: FileTreeStore;
    provider: CompletionProvider;
  } | null;
}

export function useTideCardServices(cardId: string): TideCardServices | null {
  // Subscribe to the per-card binding. `binding` drives the services
  // lifecycle: services construct when a binding appears, tear down
  // when it clears.
  const binding = useSyncExternalStore<CardSessionBinding | null>(
    cardSessionBindingStore.subscribe,
    useCallback(() => cardSessionBindingStore.getBinding(cardId) ?? null, [cardId]),
  );

  const workspaceKey = useCardWorkspaceKey(cardId);
  const workspaceFilter: FeedStoreFilter = useMemo(
    () =>
      workspaceKey
        ? (_feedId, decoded) =>
            typeof decoded === "object" &&
            decoded !== null &&
            "workspace_key" in decoded &&
            (decoded as { workspace_key: unknown }).workspace_key === workspaceKey
        : presentWorkspaceKey,
    [workspaceKey],
  );

  // True ref: the delegate instance arrives after the child
  // TugPromptEntry commits, so it cannot be initialized eagerly. Kept
  // here so the `/` position-0 gate (in `completionProviders`) reads
  // the same identity the component passes to `<TugPromptEntry ref>`.
  const entryDelegateRef = useRef<TugPromptEntryDelegate | null>(null);

  // Filter changes are captured via a ref so the construction effect
  // below depends only on binding identity, not on filter identity —
  // workspace-key flips must not tear services down. The ref is
  // updated in a layout pass before the propagation effect reads it.
  const workspaceFilterRef = useRef(workspaceFilter);
  useLayoutEffect(() => {
    workspaceFilterRef.current = workspaceFilter;
  }, [workspaceFilter]);

  // Services are held in React state so renders reflect lifecycle
  // transitions (null → ready → null).
  const [services, setServices] = useState<InternalServices | null>(null);

  // Construct services when a binding appears; dispose when it clears
  // or the card unmounts. `CodeSessionStore` is backed by the live
  // `TugConnection`, bound to the session id the supervisor echoed in
  // the `spawn_session_ok` ack. `PromptHistoryStore` is the
  // module-scoped singleton (`getTidePromptHistoryStore`), shared
  // across cards; it is read in the services-return memo below, not
  // constructed here.
  useLayoutEffect(() => {
    if (binding === null) {
      setServices(null);
      return;
    }
    const connection = getConnection();
    if (!connection) {
      console.warn("useTideCardServices: connection not available when binding appeared");
      return;
    }
    const codeSessionStore = new CodeSessionStore({
      conn: connection,
      tugSessionId: binding.tugSessionId,
    });
    const editorStore = new EditorSettingsStore();
    // No workspace filter on the SESSION_METADATA feed: the payload
    // is Claude's raw `system_metadata` event
    // (`{"type":"system_metadata","session_id":...,"slash_commands":...}`)
    // and carries neither `workspace_key` nor `tug_session_id`.
    // Applying the workspace filter here drops every frame and leaves
    // the completion popup empty. Single-session-mode (sub-step 4h)
    // enforces one active Tide session at a time, so the unfiltered
    // broadcast reaches only this card. Post-P2 multi-session will
    // need per-session routing on the tugcast side.
    const sessionMetadataFeedStore = new FeedStore(
      connection,
      [FeedId.SESSION_METADATA],
    );
    const sessionMetadataStack: InternalServices["sessionMetadataStack"] = {
      feedStore: sessionMetadataFeedStore,
      store: new SessionMetadataStore(sessionMetadataFeedStore, FeedId.SESSION_METADATA),
    };
    const fileTreeFeedStore = new FeedStore(
      connection,
      [FeedId.FILETREE],
      undefined,
      workspaceFilterRef.current,
    );
    const fileTreeStore = new FileTreeStore(fileTreeFeedStore, FeedId.FILETREE);
    const fileTreeStack: InternalServices["fileTreeStack"] = {
      feedStore: fileTreeFeedStore,
      fileTreeStore,
      provider: fileTreeStore.getFileCompletionProvider(),
    };
    const next: InternalServices = {
      codeSessionStore,
      editorStore,
      sessionMetadataStack,
      fileTreeStack,
    };
    setServices(next);

    // Bind success → prepend this card's project path to the tide
    // recent-projects list (dedup, cap). The path is the *same*
    // identifier tugcode keys its session-id persistence by, so the
    // picker's next resume lookup can read `session-id-by-workspace`
    // with the typed path directly — no translation table, no drift.
    // Roadmap step 4.5 + step 4m.
    const tugbank = getTugbankClient();
    if (tugbank) {
      const current = readTideRecentProjects(tugbank);
      const updated = insertTideRecentProject(current, binding.projectDir);
      if (updated[0] !== current[0] || updated.length !== current.length) {
        putTideRecentProjects(updated);
      }
    }

    return () => {
      // Close the supervisor-side session before disposing local
      // stores: server-side resource release first, subscription
      // teardown second. Skip when the binding was already cleared
      // externally (e.g., another caller invoked `sendCloseSession`
      // for this card) — that path already sent the frame and
      // cleared the binding, so re-sending would leak a duplicate
      // close to the supervisor.
      const stillBound = cardSessionBindingStore.getBinding(cardId);
      if (stillBound !== undefined) {
        const conn = getConnection();
        if (conn) sendCloseSession(conn, cardId, stillBound.tugSessionId);
      }
      next.codeSessionStore.dispose();
      next.sessionMetadataStack.store.dispose();
      next.sessionMetadataStack.feedStore.dispose();
      if (next.fileTreeStack) {
        next.fileTreeStack.fileTreeStore.dispose();
        next.fileTreeStack.feedStore.dispose();
      }
      setServices(null);
    };
  }, [binding, cardId]);

  // Propagate workspace-filter changes to the FILETREE feed store.
  // SESSION_METADATA does not carry `workspace_key` on the wire, so
  // it is constructed unfiltered and stays unfiltered — see the
  // construction effect above.
  useLayoutEffect(() => {
    services?.fileTreeStack?.feedStore.setFilter(workspaceFilter);
  }, [services, workspaceFilter]);

  // Completion providers. Null-safe on `services` so this can be
  // memoized unconditionally (rules of hooks); the caller only reads
  // it when `services` is non-null.
  //
  //   `@`: live `FileTreeStore` against the real connection. Falls
  //        back to `EMPTY_FILE_COMPLETION_PROVIDER` when the
  //        connection was null at first render so the trigger stays
  //        wired regardless of timing.
  //
  //   `/`: per-card live `SessionMetadataStore` against
  //        `FeedId.SESSION_METADATA`, wrapped with the position-0
  //        gate so `/` mid-text yields an empty popup.
  const completionProviders = useMemo<Record<string, CompletionProvider>>(
    () => ({
      "@": services?.fileTreeStack?.provider ?? EMPTY_FILE_COMPLETION_PROVIDER,
      "/": services
        ? wrapPositionZero(
            entryDelegateRef,
            services.sessionMetadataStack.store.getCommandCompletionProvider(),
          )
        : EMPTY_FILE_COMPLETION_PROVIDER,
    }),
    [services],
  );

  return useMemo<TideCardServices | null>(() => {
    if (services === null) return null;
    return {
      codeSessionStore: services.codeSessionStore,
      sessionMetadataStore: services.sessionMetadataStack.store,
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

  // One-shot notice from a prior session attempt for this card. Phase B
  // stashes a `resume_failed` notice when it clears the binding so the
  // re-presented picker can surface the reason. `consume` reads-and-clears,
  // so a remount that's not preceded by a failure shows nothing. Captured
  // once at picker construction; subsequent renders inside this picker
  // session keep showing the same notice until the form is submitted.
  const noticeRef = useRef(pickerNoticeStore.consume(cardId));

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
   * Notice surfaced above the form. Phase B passes a `resume_failed`
   * notice when the picker is re-presented after a failed resume so
   * the user sees the reason in the same picker that lets them choose
   * what to do next. `null` when the picker is opening fresh.
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
 * Read the `dev.tugtool.tide / sessions` map synchronously from the
 * tugbank cache. Each entry is `{projectDir, createdAt}` keyed by the
 * session id (the single identifier claude uses as its own session id
 * and tugcast uses for feed routing).
 *
 * Returns `[]` for unset / malformed records. Parsing failures degrade
 * gracefully to "no known sessions" rather than blocking the picker.
 */
function readAllSessions(): SessionRecord[] {
  const client = getTugbankClient();
  if (!client) return [];
  const entry = client.get("dev.tugtool.tide", "sessions");
  if (!entry) return [];
  // tugcode persists the map as a JSON *string* via `tb.set(domain, key,
  // JSON.stringify(map))` — tugbank writes those through as `kind: "json"`
  // with the parsed value, or (for older / raw writes) `kind: "string"`.
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
 * Resume candidates for `projectDir`, newest first. The picker's
 * "Resume last session" row points at the head of this list; future
 * multi-session UX can surface the whole list.
 */
function readSessionsForProject(projectDir: string): SessionRecord[] {
  return readAllSessions()
    .filter((r) => r.projectDir === projectDir)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function TideProjectPickerForm({ notice, onOpen, onCancel }: TideProjectPickerFormProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Recent projects are loaded once when the form mounts. The list is
  // short-lived UI (the sheet disappears on submit/cancel), so a
  // tugbank-cache read on mount is sufficient — no subscription
  // needed. A stale list is OK: whoever bound most recently wrote it,
  // and the worst case is that a path added between mount and first
  // render is missing for this single picker session.
  const [recents] = useState<string[]>(() => {
    const client = getTugbankClient();
    return client ? readTideRecentProjects(client) : [];
  });

  // Live path state drives the resume-option visibility. The input is
  // controlled; recents clicks call setPath. Roadmap step 4.5 — the
  // recents click fills the input rather than spawning directly so
  // every path flows through the Start-fresh / Resume-last choice.
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
  const resumeCandidate = useMemo<SessionRecord | null>(() => {
    const trimmed = path.trim();
    if (trimmed.length === 0) return null;
    const candidates = readSessionsForProject(trimmed);
    return candidates[0] ?? null;
  }, [path]);

  // Revert the selection to "new" if the user edits the path into a
  // workspace with no resume candidate. Prevents a hidden radio from
  // silently being the active choice on submit.
  useLayoutEffect(() => {
    if (resumeCandidate === null && sessionMode === "resume") {
      setSessionMode("new");
    }
  }, [resumeCandidate, sessionMode]);

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
          <TugRadioItem value="resume" disabled={resumeCandidate === null}>
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

function TideCardBody({ cardId, services }: TideCardBodyProps) {
  const { codeSessionStore, sessionMetadataStore, historyStore, completionProviders, editorStore, entryDelegateRef } = services;

  // Phase B (Step 4.5.5): when the bound session reports a `resume_failed`
  // lastError, stash a one-shot notice keyed by this card and clear the
  // binding. The cleared binding makes `useTideCardServices` return null
  // → `TideCardContent` re-renders the picker, which reads the notice
  // and surfaces it above the radio group. We deliberately do NOT call
  // `sendCloseSession` here: the bridge has already torn down via the
  // `RelayOutcome::ResumeFailed` path, so the supervisor side is clean.
  // Track the `at` timestamp of the consumed error so we react exactly
  // once per failure (lastError stays populated across renders).
  const consumedLastErrorAtRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    return codeSessionStore.subscribe(() => {
      const snap = codeSessionStore.getSnapshot();
      const err = snap.lastError;
      if (
        err === null ||
        err.cause !== "resume_failed" ||
        consumedLastErrorAtRef.current === err.at
      ) {
        return;
      }
      consumedLastErrorAtRef.current = err.at;
      logSessionLifecycle("card.unbind_on_resume_failed", {
        card_id: cardId,
        message: err.message,
      });
      pickerNoticeStore.set(cardId, {
        category: "resume_failed",
        message: err.message,
      });
      cardSessionBindingStore.clearBinding(cardId);
    });
  }, [cardId, codeSessionStore]);

  const entryPanelRef = useRef<TugSplitPanelHandle | null>(null);

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
          <div className="tide-card-placeholder" aria-hidden="true" />
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
        </TugSplitPanel>
      </TugSplitPane>
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
