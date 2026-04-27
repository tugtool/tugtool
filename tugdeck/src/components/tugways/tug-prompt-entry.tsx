/**
 * TugPromptEntry — Compound composition: TugPromptInput + route indicator +
 * submit/stop button, driven by a CodeSessionStore snapshot.
 *
 * Composes TugPromptInput (editor + route detection), TugChoiceGroup (route
 * indicator), TugPushButton (submit/stop). Each composed child keeps its own
 * tokens [L20]. The entry reuses existing base-tier global/field/badge tokens
 * per [D11].
 *
 * The scaffold covers mount, store snapshot, responder scope, JSX,
 * and a no-op SUBMIT stub that keeps TugPushButton's chain-action mode
 * out of its aria-disabled fallback (Risk R04). Input-delegate
 * pass-throughs (`focus`, `clear`) and `handleInputChange` write
 * `data-empty` via `setAttribute`, bypassing React state on keystroke
 * [L06][L22]. Bidirectional route-indicator sync [D04]: typing a prefix
 * fires `onRouteChange` → `setRouteState`; selecting a segment
 * dispatches SELECT_VALUE → `setRouteState` + `setRoute`. SUBMIT
 * handler per [D05]: branches on
 * `snapRef.current.canInterrupt` to route to `codeSessionStore.interrupt()`
 * vs `codeSessionStore.send(text, atoms)`, threading `localCommandHandler`
 * as an optional [D06] synchronous interceptor; clears the input and
 * resets the route indicator after submit.
 *
 * Laws: [L02] useSyncExternalStore for store state, [L06] appearance via
 *       CSS/DOM, [L07] handlers read state via refs, [L11] controls emit
 *       actions, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty,
 *       [L22] direct DOM writes for high-frequency updates.
 * Decisions: [D-T3-01] route selection, [D-T3-06] submit is interrupt,
 *            [D-T3-07] queue during turn, [D-T3-09] 1:1 card↔store.
 */

import "./tug-prompt-entry.css";

import React, {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import { ArrowUp, Maximize2, Minimize2, Settings, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  AtomSegment,
  CompletionProvider,
  DropHandler,
  HistoryProvider,
  TugTextEditingState,
} from "@/lib/tug-text-engine";
import type { CodeSessionStore } from "@/lib/code-session-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { PromptHistoryStore } from "@/lib/prompt-history-store";

import { TugPromptInput, type TugPromptInputDelegate } from "./tug-prompt-input";
import { TugChoiceGroup, type TugChoiceItem } from "./tug-choice-group";
import { TugPushButton } from "./tug-push-button";
import { TugPopover, TugPopoverContent, TugPopoverTrigger } from "./tug-popover";
import { useResponder } from "./use-responder";
import type { ActionEvent } from "./responder-chain";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useCardStatePreservation, useCardId } from "./use-card-state-preservation";
import { useComponentStatePreservation } from "./use-component-state-preservation";
import { selectionGuard } from "./selection-guard";
import { deckTrace } from "@/deck-trace";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import type { HistoryEntry } from "@/lib/prompt-history-store";

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/**
 * The three route prefix characters surfaced in the indicator. Matches the
 * `routePrefixes` array passed to the underlying `TugPromptInput`. Declared
 * once at module scope so both the indicator `items` and the input prop
 * reference a single source of truth. Each segment pairs a descriptive
 * label (what the route does) with the prefix character rendered as a
 * leading icon so the control is both scannable and self-documenting.
 */
const ROUTE_ITEMS: ReadonlyArray<TugChoiceItem> = [
  { value: "❯", label: "Code",    icon: "❯" },
  { value: "$", label: "Shell",   icon: "$" },
  { value: ":", label: "Command", icon: ":" },
];

/**
 * Route prefix characters. When the user types one of these as the
 * first character of an otherwise atomless editor, the character is
 * consumed and the route flips to the matching value — mirrors the
 * engine's legacy `detectRoutePrefix` path without inserting a
 * route atom into the text flow.
 *
 * `>` is an ASCII alias for the Prompt route's display character `❯`.
 * The display surface (gutter, choice group) shows the chevron, but
 * the typed greater-than is keyboard-friendly and routes to the same
 * Prompt value.
 */
const ROUTE_PREFIX_ALIAS: Readonly<Record<string, string>> = {
  "❯": "❯",
  ">": "❯",
  "$": "$",
  ":": ":",
};

/**
 * Return-key semantics per route.
 *
 * - `❯` (Prompt): Return inserts a newline; Shift+Return submits. Prompts
 *   are long-form, so naïve Return should stay a newline and submit is
 *   a deliberate gesture.
 * - `$` (Shell): Return submits; Shift+Return inserts a newline. Shell
 *   invocations are typically a single line, so Return submits directly.
 * - `:` (Command): Return submits; Shift+Return inserts a newline.
 *   Commands are one-liners in practice.
 *
 * The engine's shift inversion (`shift ? (base === "submit" ? "newline"
 * : "submit") : base`) means we only need to declare the *unshifted*
 * action per route; Shift+Return is the opposite automatically.
 */
const RETURN_ACTION_BY_ROUTE: Readonly<Record<string, "submit" | "newline">> = {
  "❯": "newline",
  "$": "submit",
  ":": "submit",
};

/**
 * Preserved state payload for TugPromptEntry via `useCardStatePreservation`.
 *
 * - `currentRoute` is the active prefix at save time. On restore, the
 *   indicator snaps back to this route and the input displays the
 *   matching saved snapshot.
 * - `perRoute` maps route → `TugTextEditingState`, giving each route
 *   its own draft that survives route switches and card/tab reloads.
 *
 * JSON-serializable (no DOM, no functions) — round-trips through
 * tugbank via the TugPane state preservation pipeline [L23].
 */
interface TugPromptEntryState {
  currentRoute: string;
  perRoute: Record<string, TugTextEditingState>;
  /**
   * Latest known maximize state of the entry's pane. Optional so older
   * persisted snapshots (predating the maximize toggle) restore as
   * "not maximized" without a migration. The entry doesn't own this
   * state itself — it's a controlled-component prop — so on save it
   * snapshots the current `maximized` prop and on restore it re-emits
   * via `onMaximizeChange` so the parent's state matches the snapshot.
   */
  maximized?: boolean;
}

/**
 * Default route at initial mount when no persisted state restores a
 * prior selection. One of the three segments must always be active —
 * there is no "no route" state in the indicator. Prompt (`❯`) is the
 * sensible default: it's what the user most often wants (talking to
 * Claude). Route selection is sticky and is owned by the entry's
 * `route` state — the gutter renders the current route's icon next
 * to the editor, and only the choice group (or restore) ever changes
 * it.
 */
const DEFAULT_ROUTE = "❯";

// ---------------------------------------------------------------------------
// Effective-empty helper
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the input has no user content. Thin wrapper
 * around the input's own `isEmpty()` — there are no structural atoms
 * in the text flow to discount now that the route indicator lives in
 * the gutter. Kept as a named helper so callers read symmetrically
 * with the submit gate ("submit when not effectively empty").
 */
function isEffectivelyEmpty(input: TugPromptInputDelegate | null): boolean {
  return input?.isEmpty() ?? true;
}

/**
 * Persistence migration: strip legacy `type: "route"` atoms from a
 * restored editing-state snapshot.
 *
 * Pre-gutter drafts stored the route indicator as an inline atom at
 * position 0. The gutter refactor renders the route outside the text
 * flow, so any persisted payload that still carries a route atom would
 * render as an orphan `❯`/`$`/`:` image inside the editor on reload.
 *
 * One forward pass: collect surviving atoms and the offset shifts
 * introduced by removing each route-atom's `\uFFFC` placeholder from
 * `text`. Atom positions and selection offsets past a removed char are
 * shifted left by the number of route-atom placeholders that preceded
 * them.
 *
 * Returns a fresh `TugTextEditingState`. Safe on inputs that contain no
 * route atoms (identity-equivalent output up to object identity).
 */
function stripRouteAtoms(state: TugTextEditingState): TugTextEditingState {
  // Positions of the `\uFFFC` placeholders to remove from `text`.
  const removedPositions: number[] = [];
  const survivingAtoms: TugTextEditingState["atoms"] = [];
  for (const atom of state.atoms) {
    if (atom.type === "route") {
      removedPositions.push(atom.position);
    } else {
      survivingAtoms.push(atom);
    }
  }
  if (removedPositions.length === 0) {
    return state;
  }
  // Build the stripped text by skipping the recorded positions.
  const removeSet = new Set(removedPositions);
  let stripped = "";
  for (let i = 0; i < state.text.length; i++) {
    if (!removeSet.has(i)) stripped += state.text[i];
  }
  // Count how many removed positions precede a given offset — the shift
  // to apply to any atom position or selection offset at/past that point.
  const sorted = [...removedPositions].sort((a, b) => a - b);
  const shiftFor = (offset: number): number => {
    // Number of sorted entries strictly less than `offset`.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const shiftedAtoms = survivingAtoms.map((a) => ({
    ...a,
    position: a.position - shiftFor(a.position),
  }));
  const shiftedSelection = state.selection
    ? {
        start: state.selection.start - shiftFor(state.selection.start),
        end: state.selection.end - shiftFor(state.selection.end),
      }
    : null;
  return { text: stripped, atoms: shiftedAtoms, selection: shiftedSelection };
}

// ---------------------------------------------------------------------------
// Props / delegate
// ---------------------------------------------------------------------------

/**
 * TugPromptEntry props interface.
 *
 * Data attributes written on the root element (all documented below with
 * `@selector` annotations):
 *
 * @selector [data-slot="tug-prompt-entry"]         — stable slot selector
 * @selector [data-responder-id]                    — from `id` (written by useResponder)
 * @selector [data-phase="idle" | "submitting" | "awaiting_first_token" |
 *                         "streaming" | "tool_work" | "awaiting_approval" |
 *                         "errored"]                — from snap.phase (React-rendered)
 * @selector [data-can-interrupt="true" | "false"]  — from snap.canInterrupt (React-rendered)
 * @selector [data-can-submit="true" | "false"]     — from snap.canSubmit (React-rendered)
 * @selector [data-queued]                          — presence when snap.queuedSends > 0
 * @selector [data-errored]                         — presence when snap.lastError !== null
 * @selector [data-pending-approval]                — presence when snap.pendingApproval !== null
 * @selector [data-pending-question]                — presence when snap.pendingQuestion !== null
 * @selector [data-empty="true" | "false"]          — direct DOM write from input's onChange (Step 3)
 */
export interface TugPromptEntryProps {
  /**
   * Stable responder id. Typically `${cardId}-entry`.
   * @selector [data-responder-id]
   */
  id: string;
  /** Store owning Claude Code turn state for this card. */
  codeSessionStore: CodeSessionStore;
  /** Session metadata (model name, version). Accepted for T3.4.c; unused in T3.4.b. */
  sessionMetadataStore: SessionMetadataStore;
  /** Prompt history (recall on arrow up/down). Forwarded to TugPromptInput. */
  historyStore: PromptHistoryStore;
  /**
   * Completion providers keyed by trigger character, forwarded to the
   * underlying `TugPromptInput`. Example: `{ "@": fileProvider, "/": commandProvider }`.
   * Mirrors `TugPromptInput`'s own `completionProviders` prop — the entry
   * is a pass-through. Leave undefined to disable all trigger completions.
   */
  completionProviders?: Record<string, CompletionProvider>;
  /** Drop handler for dragging files from Finder. Forwarded to TugPromptInput. */
  dropHandler?: DropHandler;
  /**
   * Optional synchronous interceptor for local `:`-surface commands. Called
   * before `codeSessionStore.send(...)` on every submission. Returning `true`
   * suppresses the store send; returning `false` or omitting the prop falls
   * through. The input is cleared on either path. [D06]
   */
  localCommandHandler?: (
    route: string | null,
    atoms: ReadonlyArray<AtomSegment>,
  ) => boolean;
  /**
   * Fires synchronously just before the input is cleared on a successful
   * submit (after `canSubmit` / `canInterrupt` / `localCommandHandler`
   * checks, after `codeSessionStore.send`, before `input.clear()`).
   *
   * Distinguishes a genuine user submit from incidental empty states
   * (manual delete, undo-to-empty). Hosts use this hook to drive
   * effects that should happen ONLY on explicit submits — e.g.,
   * animating a content-sized panel back to the user's dragged size
   * via `TugSplitPanelHandle.restoreUserSize({ animated: true })`.
   *
   * Does not fire on the `canInterrupt` branch (no submit happens),
   * nor on blocked submits, nor on the user clearing the input by
   * other means.
   */
  onBeforeSubmit?: () => void;
  /**
   * Optional callback fired AFTER a successful submit has cleared the
   * input. "Successful" means the submit path reached `input.clear()` —
   * either the store's `send()` was invoked or `localCommandHandler`
   * intercepted it. Does NOT fire on the `canInterrupt` Stop branch,
   * on `canSubmit=false`, or on the empty-input guard.
   *
   * Host use case: re-focus the editor so the user can type the next
   * prompt without clicking. The entry clears the content, the host
   * returns the caret.
   */
  onAfterSubmit?: () => void;
  /**
   * Optional content rendered in the status row above the input — e.g. the
   * current project path, session model name, or a live status indicator.
   * The row also hosts the tools-toggle button on the trailing edge when
   * `toolsContent` is provided. If both `statusContent` and `toolsContent`
   * are undefined, the status row is omitted entirely.
   */
  statusContent?: React.ReactNode;
  /**
   * Optional content rendered inside a `TugPopover` anchored to a
   * toggle button on the trailing edge of the status row. The popover's
   * internal open state is owned by `TugPopover`. When undefined, the
   * toggle button is not rendered.
   */
  toolsContent?: React.ReactNode;
  /**
   * When defined, renders a maximize toggle on the leading edge of the
   * status row (left of `statusContent`). The entry is a controlled
   * component for this state — the parent owns `maximized` and reflects
   * any size/handle adjustments on the surrounding `TugSplitPane`. The
   * button itself is a single-icon toggle (Maximize2 ↔ Minimize2),
   * mirroring the macOS Finder green-button affordance. When `maximized`
   * is undefined, the toggle is not rendered.
   */
  maximized?: boolean;
  /** Fires when the user clicks the maximize toggle. */
  onMaximizeChange?: (next: boolean) => void;
  /**
   * Caller-supplied className merged with the root.
   * @selector standard
   */
  className?: string;
  /**
   * Opt the entry into the Component State Preservation Protocol
   * ([D13], [A9]) for its chrome state. When provided (and rendered
   * inside a card), `{ toolsOpen }` is captured into
   * `bag.components[componentStatePreservationKey]` at every save
   * trigger and reapplied on the next mount.
   *
   * Only `toolsOpen` (the tools popover open/closed flag) is preserved
   * via this hook. The active route + per-route engine drafts continue
   * to live in `bag.content` via the existing `useCardStatePreservation`
   * registration — they're semantically tied (the route is the index
   * into `perRoute`) and splitting them would require a two-phase
   * restore that violates [L23]. Closes [AT0031]'s `toolsOpen` axis;
   * route survival is gated by [AT0024].
   *
   * Absence means "not preserved" — gallery demos and standalone tests
   * that render the entry outside a card stay unaffected.
   */
  componentStatePreservationKey?: string;
}

/**
 * Serialized shape of TugPromptEntry's chrome state via
 * `useComponentStatePreservation`. Engine content + active route live
 * in `bag.content` (see `TugPromptEntryState`); only the
 * popover open flag rides this axis.
 */
interface TugPromptEntryChromeState {
  toolsOpen: boolean;
}

/**
 * Imperative handle exposed via `forwardRef`. Used by the Tide card (T3.4.c)
 * to drive focus from global keyboard shortcuts.
 *
 * Both methods are thin pass-throughs to the composed `TugPromptInput`'s
 * delegate. The entry does not own text state — keeping the pass-through
 * semantics honest avoids divergence between the entry's imperative
 * surface and the input's actual behavior.
 */
export interface TugPromptEntryDelegate {
  /** Move keyboard focus to the underlying input's editor element. */
  focus(): void;
  /** Remove keyboard focus from the underlying input's editor element. */
  blur(): void;
  /** Clear the input's content. */
  clear(): void;
  /**
   * The underlying editor element (the contentEditable div inside the
   * composed `TugPromptInput`). Used by `useContentDrivenPanelSize` as
   * the scroll-source signal for content-driven panel growth.
   */
  getEditorElement(): HTMLElement | null;
  /**
   * Regenerate atom glyphs — needed when the editor font or theme tokens
   * change so the SVG-rendered atom chips pick up the new family/size.
   * Forwards to the underlying `TugPromptInput`'s `regenerateAtoms`.
   */
  regenerateAtoms(): void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TugPromptEntry = React.forwardRef<
  TugPromptEntryDelegate,
  TugPromptEntryProps
>(function TugPromptEntry(props, ref) {
  const {
    id,
    codeSessionStore,
    // sessionMetadataStore — accepted for T3.4.c, unused in T3.4.b.
    historyStore,
    completionProviders,
    dropHandler,
    localCommandHandler,
    onBeforeSubmit,
    onAfterSubmit,
    statusContent,
    toolsContent,
    maximized,
    onMaximizeChange,
    className,
    componentStatePreservationKey,
  } = props;

  // [L02] external store state enters React through useSyncExternalStore only.
  const snap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );

  // Refs for the composed input, the root element (direct DOM writes per
  // [L06] — Step 3 writes `data-empty` here), and a live snapshot mirror
  // for responder handlers [L07].
  const promptInputRef = useRef<TugPromptInputDelegate | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const snapRef = useRef(snap);
  useLayoutEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  // Stable sender id for the route indicator. Derived from `id` so parent
  // cards can predict it for integration tests and multi-entry forms if
  // they ever land. Step 4 uses this in the SELECT_VALUE handler body to
  // narrow on `event.sender`.
  const routeIndicatorSenderId = `${id}-route-indicator`;

  // Per-route input snapshots. When the user switches routes, the
  // current route's editing state is captured here; switching back
  // restores it. In-memory only (no persistence across reloads).
  // Entries are created lazily on the first switch-away from a route.
  const savedContentByRouteRef = useRef<Record<string, TugTextEditingState>>({});

  // [D04] the route value is React state — TugChoiceGroup is a controlled
  // component that derives its pill position from `value`. L06 explicitly
  // allows React state for "selected item in a list" — the route is data
  // (user-readable semantics), not appearance.
  //
  // There is no "no route selected" state: one of the three segments is
  // always active. The input itself may or may not carry a leading prefix
  // atom — if it doesn't, the indicator reflects the default (`DEFAULT_ROUTE`,
  // Prompt). If it does, the indicator mirrors that prefix.
  const [route, setRouteState] = React.useState<string>(DEFAULT_ROUTE);

  // Live route ref so the submit handler in Step 5 can read the current
  // value without closing over a stale `route` closure variable [L07].
  const routeRef = useRef(route);
  useLayoutEffect(() => {
    routeRef.current = route;
  }, [route]);

  // Per-route history providers. One provider per route — each holds
  // its own cursor + in-memory "return to draft" cache, so the user's
  // browsing position in history survives route switches. Providers
  // are created lazily on first use and persist for the lifetime of
  // the entry mount. Unified-timeline model: the provider's `_draft`
  // slot is the "top of history" for this route, and submitted entries
  // are index 1..N.
  // Subscribe to historyStore so the component re-renders when an
  // async `loadSession` settles. The provider's `back()` reads
  // `_sessions[id]` synchronously; without this subscription, an
  // arrow-up pressed during the load window returns null and a
  // subsequent successful load is invisible until something else
  // re-renders the editor.
  useSyncExternalStore(
    historyStore.subscribe,
    historyStore.getSnapshot,
  );

  // History keys on the session's id, which the picker decided at
  // bind time and which is the same id everywhere in the system —
  // tugcast's routing key, claude's `--session-id` / `--resume`
  // argument, the sessions-record key, and the prompt-history key.
  // Available immediately on mount via `snap.tugSessionId`; no waiting
  // on a separate `session_init` confirmation.
  //
  // The provider cache is keyed by `${sessionId}\u0000${route}` so a
  // route change for the same session reuses the cached provider
  // (preserving its cursor + draft state).
  const historyProvidersRef = useRef<Record<string, HistoryProvider>>({});
  const currentHistoryProvider = useMemo<HistoryProvider>(() => {
    const sessionId = snap.tugSessionId;
    const cacheKey = `${sessionId}\u0000${route}`;
    const cached = historyProvidersRef.current[cacheKey];
    if (cached) return cached;
    const fresh = historyStore.createRouteProvider(sessionId, route);
    historyProvidersRef.current[cacheKey] = fresh;
    logSessionLifecycle("history.provider_create", {
      session_id: sessionId,
      route,
    });
    return fresh;
  }, [historyStore, route, snap.tugSessionId]);

  // Live ref for the optional localCommandHandler so `performSubmit` (the
  // shared submit closure) can read the latest callback without rebuilding
  // on every render. The chain-action handler registered via `useResponder`
  // is a stable closure — we read policy through refs per [L07].
  const localCommandHandlerRef = useRef(localCommandHandler);
  useLayoutEffect(() => {
    localCommandHandlerRef.current = localCommandHandler;
  }, [localCommandHandler]);

  // Live ref for `onBeforeSubmit` (same rationale as above — the submit
  // closure must read the latest callback without rebuilding on every
  // render). Fires once per successful submit, between store.send and
  // input.clear (see performSubmit).
  const onBeforeSubmitRef = useRef(onBeforeSubmit);
  useLayoutEffect(() => {
    onBeforeSubmitRef.current = onBeforeSubmit;
  }, [onBeforeSubmit]);
  // Live ref for the optional `onAfterSubmit` host hook. Kept out of
  // `performSubmit`'s deps so its stable identity isn't invalidated
  // when callers pass an inline closure. [L07]
  const onAfterSubmitRef = useRef(onAfterSubmit);
  useLayoutEffect(() => {
    onAfterSubmitRef.current = onAfterSubmit;
  }, [onAfterSubmit]);

  // Live refs for the maximize controlled-pair so the chain-action
  // handler (registered once at mount via `useResponder.actions`) sees
  // the current values per [L07]. The handler can't close over `props`
  // directly: `useResponder`'s actions map is captured at mount and
  // would freeze whatever values the first render had.
  const maximizedRef = useRef(props.maximized);
  const onMaximizeChangeRef = useRef(props.onMaximizeChange);
  useLayoutEffect(() => {
    maximizedRef.current = props.maximized;
  }, [props.maximized]);
  useLayoutEffect(() => {
    onMaximizeChangeRef.current = props.onMaximizeChange;
  }, [props.onMaximizeChange]);

  // Shared submit logic. Invoked by both the SUBMIT chain-action handler
  // (button click, Cmd+Enter, etc.) and the Return/Shift+Return keyboard
  // path (via `onSubmit` on TugPromptInput). Keeping a single performSubmit
  // means keyboard and pointer converge on the same interrupt-vs-send
  // decision, the same localCommandHandler intercept, and the same
  // clear-and-reset-route teardown.
  //
  // Stable identity (`useCallback` with deps that are themselves stable —
  // `codeSessionStore` is a prop reference, not regenerated each render);
  // policy is read through refs so the closure never goes stale [L07].
  const performSubmit = useCallback(() => {
    const input = promptInputRef.current;
    const snap = snapRef.current;
    if (!input) return;
    // [D05] Submit is interrupt: the single SUBMIT action routes to
    // `interrupt()` during an in-flight turn and to `send()` otherwise.
    if (snap.canInterrupt) {
      codeSessionStore.interrupt();
      return;
    }
    // [D-T3-08] awaiting_approval / awaiting_question block the submit
    // path. `canSubmit` captures both.
    if (!snap.canSubmit) return;
    // Empty-input guard — a bare route atom isn't meaningful content
    // and shouldn't submit. Same helper that drives `data-empty`, read
    // through the input ref at submit time [L07].
    if (isEffectivelyEmpty(input)) return;
    const atoms = input.getAtoms();
    const text = input.getText();
    // [D06] localCommandHandler seam — called BEFORE the store send so
    // local `:`-surface commands can intercept.
    const currentRoute = routeRef.current || null;
    const handled =
      localCommandHandlerRef.current?.(currentRoute, atoms) ?? false;
    if (!handled) {
      codeSessionStore.send(text, atoms);
    }
    // Record the submission in per-session history, keyed by the
    // session's id (the same id the picker chose — set on the
    // CodeSessionStore at construction time, available from the
    // first render of the entry). The route field is what lets
    // `RouteHistoryProvider` filter this entry into the current
    // route's timeline. Captured before `input.clear()` so the live
    // state is still the submitted content.
    const sessionId = snapRef.current.tugSessionId;
    const state = input.captureState();
    historyStore.push({
      id: `${sessionId}-${Date.now()}`,
      sessionId,
      projectPath: "",
      route: currentRoute ?? "",
      text: state.text,
      atoms: state.atoms.map((a) => ({
        position: a.position,
        type: a.type,
        label: a.label,
        value: a.value,
      })),
      timestamp: Date.now(),
    });
    // Fire the pre-clear hook so hosts can drive submit-specific
    // effects (e.g., animated snap-back of a content-sized panel)
    // BEFORE `input.clear()` sets `data-empty="true"` and triggers
    // the content-driven hook's automatic instant restoration.
    onBeforeSubmitRef.current?.();
    input.clear();
    // Fire AFTER clear so host hooks (e.g., refocus) act on the
    // already-empty editor, not on the mid-submit snapshot.
    onAfterSubmitRef.current?.();
    // Route is a sticky user preference. Do not reset it on submit —
    // if the user switched to Shell, subsequent prompts stay on Shell
    // until they choose otherwise.
  }, [codeSessionStore, historyStore]);

  // [L07] Register the responder node. Both handler bodies are now
  // real: SELECT_VALUE runs the defensive sender/value narrowing +
  // `setRouteState` + `setRoute` round-trip per (Step 4);
  // SUBMIT branches on `snapRef.current.canInterrupt` to route to
  // `interrupt()` vs `send()` per [D05] (Step 5).
  const { ResponderScope, responderRef } = useResponder({
    id,
    actions: {
      [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
        // Narrow on sender first — this responder should only react
        // to events from its own route indicator [L11]. Other senders
        // (different card's indicator, a gallery harness, etc.) must
        // be ignored so state doesn't cross-contaminate.
        if (event.sender !== routeIndicatorSenderId) return;
        // Defensive value-shape narrowing [L11]. ActionEvent.value is
        // `unknown`; a test or future caller could dispatch a number
        // or object. Drop anything that isn't the string the
        // indicator normally sends.
        if (typeof event.value !== "string") return;
        const prevRoute = routeRef.current;
        const nextRoute = event.value;
        if (prevRoute === nextRoute) return;

        const input = promptInputRef.current;
        const root = rootRef.current;

        // Save the outgoing route's content so we can restore it the
        // next time the user switches back to that route.
        if (input) {
          savedContentByRouteRef.current[prevRoute] = input.captureState();
        }

        // Update the controlled indicator's `value` prop source of
        // truth. [D04]
        setRouteState(nextRoute);

        // Swap the input content to the incoming route: restore a
        // previously-saved snapshot if one exists, otherwise clear
        // the input. The route itself is rendered by the gutter, not
        // the text flow, so there is nothing to install inside the
        // editor on a fresh route switch.
        if (input) {
          const savedForNext = savedContentByRouteRef.current[nextRoute];
          if (savedForNext) {
            input.restoreState(savedForNext);
          } else {
            input.clear();
          }
        }

        // Sync `data-empty` on the root: neither restoreState nor
        // setRoute flow through handleInputChange, so the attribute
        // would otherwise lag until the next keystroke.
        if (root) {
          root.setAttribute("data-empty", String(isEffectivelyEmpty(input)));
        }

        // Move keyboard focus to the editor so the user can start
        // typing immediately — the route segment button had focus
        // from the click; this hands it back to the input.
        input?.focus();
      },
      [TUG_ACTIONS.SUBMIT]: (_event: ActionEvent) => {
        performSubmit();
      },
      [TUG_ACTIONS.TOGGLE_MAXIMIZE]: (_event: ActionEvent) => {
        // Controlled-component routing per [L11]: the entry doesn't own
        // `maximized` itself — the parent does — so the handler reads
        // the current value through a ref [L07] and re-emits via the
        // controlled callback. The button is the *control*; the parent
        // is the *responder* whose state mutates. The intermediate hop
        // through this handler is necessary because the button lives
        // inside the entry's responder scope, so the chain dispatch
        // hits this node first.
        const next = !maximizedRef.current;
        onMaximizeChangeRef.current?.(next);
      },
    },
  });

  // Input onChange callback. Writes `data-empty` to the root element
  // directly via `rootRef` — no React state update, no re-render of the
  // entry on every keystroke [L06][L22]. Reads freshness from
  // `promptInputRef.current?.isEmpty()`; refs are always current, so the
  // empty-deps `useCallback` is safe.
  //
  // Also implements route-prefix eating: when the user types (or pastes)
  // one of the route prefix characters as the first character of an
  // otherwise atomless editor, the character is consumed and the route
  // flips to that prefix. Mirrors the engine's legacy `detectRoutePrefix`
  // behavior without inserting a route atom — the gutter renders the
  // route. The caret and any trailing text survive the strip.
  const handleInputChange = useCallback(() => {
    const root = rootRef.current;
    const input = promptInputRef.current;
    if (!root) return;
    if (input) {
      const atoms = input.getAtoms();
      if (atoms.length === 0) {
        const text = input.getText();
        const route = text.length > 0 ? ROUTE_PREFIX_ALIAS[text[0]] : undefined;
        if (route !== undefined) {
          const state = input.captureState();
          const sel = state.selection;
          input.restoreState({
            text: state.text.slice(1),
            atoms: [],
            selection: sel
              ? {
                  start: Math.max(0, sel.start - 1),
                  end: Math.max(0, sel.end - 1),
                }
              : null,
          });
          if (route !== routeRef.current) {
            setRouteState(route);
          }
        }
      }
    }
    root.setAttribute(
      "data-empty",
      String(isEffectivelyEmpty(promptInputRef.current)),
    );
  }, []);

  // Seed `data-empty` from the actual input state once the input ref
  // is wired [L03]. The JSX defaults `data-empty="true"` at render, but
  // on a browser reload / HMR refresh the editor may already carry
  // preserved content — the submit button would then stay disabled
  // until the user typed. Running the same effectively-empty check
  // once at mount closes that gap.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const input = promptInputRef.current;
    if (!root) return;
    root.setAttribute("data-empty", String(isEffectivelyEmpty(input)));
  }, []);

  // Card id for diagnostic deck-trace events. Held in a ref so the
  // onRestore closure (registered through useCardStatePreservation) reads
  // the current value at fire time.
  const cardIdForTrace = useCardId();
  const cardIdForTraceRef = useRef(cardIdForTrace);
  cardIdForTraceRef.current = cardIdForTrace;


  // TugPane state preservation [L23]. TugPromptEntry is the sole
  // preserver for this compound — the composed `TugPromptInput` is
  // explicitly opted out via `preserveState={false}` below so there's
  // no competing registration. Payload carries the active route + a
  // per-route
  // editing-state map, so each route's draft survives route switches
  // *and* card/tab deactivation *and* full reloads.
  //
  // onSave merges the live input state (for the active route) with the
  // in-memory map of drafts for inactive routes. onRestore seeds the
  // map, sets the route state, and rehydrates the input to whatever
  // draft was last saved for the active route (or installs a fresh
  // route atom if none). TugPane's orchestration guarantees both refs
  // (`promptInputRef`, `rootRef`) are populated by the time onRestore
  // fires — parent effects run after child mounts.
  // Helper: route the embedded input's mirror selection through
  // selectionGuard for the inactive-paint channel. The closure reads
  // `cardIdForTraceRef.current` at fire time per [L07] (mandatory
  // cardIdRef pattern — cross-pane moves preserve
  // cardId in practice but the ref keeps the contract safe under any
  // future identity-semantics change).
  const publishToSelectionGuard = (range: Range | null): void => {
    const id = cardIdForTraceRef.current;
    if (id === null) return;
    selectionGuard.updateCardDomSelection(id, range);
  };
  useCardStatePreservation<TugPromptEntryState>({
    onCardActivated: () => {
      // Row 6 of the activation taxonomy: when this EM card
      // becomes the destination of an activation gesture, the
      // framework dispatches here. The delegate's `focus()` runs
      // `paintMirrorAsActive` (focus + global Selection + scroll)
      // via the imperative handle. The framework's own
      // `engine-activation-dispatched` deck-trace event is
      // recorded in `DeckManager.invokeActivationCallback` ahead
      // of this call. This is the
      // single legitimate `focus()` claim per page; the
      // deactivation hook for the previously-active card has
      // already routed its selection into the inactive-paint
      // channel before this fires. [L23].
      promptInputRef.current?.focus();
    },
    onCardWillDeactivate: () => {
      // [L23] enforcement. Hand the
      // input's selection over to selectionGuard via
      // `paintMirrorAsInactive(publish)` before the new active
      // card's `setSelectedRange` runs `removeAllRanges()` on the
      // global Selection. NO focus claim.
      promptInputRef.current?.paintMirrorAsInactive(publishToSelectionGuard);
    },
    onSave: () => {
      const input = promptInputRef.current;
      const perRoute = { ...savedContentByRouteRef.current };
      if (input) {
        perRoute[routeRef.current] = input.captureState();
      }
      return {
        currentRoute: routeRef.current,
        perRoute,
        maximized: maximizedRef.current ?? false,
      };
    },
    onRestore: (state, { isActive }) => {
      // Defensive shape check. Before commit 99809d06 the child
      // `TugPromptInput` owned state preservation and wrote a flat
      // `TugTextEditingState` payload. After the upgrade, an old
      // payload restored from tugbank is still the previous shape —
      // reading `state.perRoute[state.currentRoute]` on that shape
      // crashes the mount. Treat any payload missing the expected
      // fields as a legacy value and fall back to defaults rather
      // than destructuring blindly.
      const rawPerRoute =
        state && typeof state === "object" && state.perRoute &&
        typeof state.perRoute === "object"
          ? state.perRoute
          : {};
      const currentRoute =
        state && typeof state === "object" && typeof state.currentRoute === "string"
          ? state.currentRoute
          : DEFAULT_ROUTE;
      // Migrate legacy route atoms out of each per-route snapshot.
      // Pre-gutter drafts stored the route as an inline atom at
      // position 0; the gutter renders the route outside the text
      // flow, so restoring such a payload verbatim would leave an
      // orphan route atom in the editor.
      const perRoute: Record<string, TugTextEditingState> = {};
      for (const [key, snapshot] of Object.entries(rawPerRoute)) {
        perRoute[key] = stripRouteAtoms(snapshot);
      }
      savedContentByRouteRef.current = { ...perRoute };
      setRouteState(currentRoute);
      const input = promptInputRef.current;
      if (input) {
        const saved = perRoute[currentRoute];
        if (saved) {
          // restoreState updates the engine's mirror but does NOT
          // touch DOM Selection or focus (mirror-only restore). The
          // paint method below — chosen by `isActive`
          // — is what writes selection to the DOM. The active card
          // gets `paintMirrorAsActive` (focus + global Selection);
          // every inactive card gets `paintMirrorAsInactive(publish)`
          // (selectionGuard publish, no focus claim, no global
          // Selection mutation). [L23] enforcement.
          input.restoreState(saved);
          // Pass the just-loaded bag (`saved`) so
          // the engine reads selection + scrollTop from it directly.
          // Cold-boot restore trusts the bag verbatim; the in-memory
          // mirror is for cmd-tab return paths where the bag has not
          // been re-read.
          if (isActive) {
            input.paintMirrorAsActive(saved);
          } else {
            input.paintMirrorAsInactive(publishToSelectionGuard, saved);
          }
          // Diagnostic for the cold-boot selection-paint gap
          // (inactive-paint gap).
          if (cardIdForTraceRef.current !== null) {
            deckTrace.record({
              kind: "engine-restore-applied",
              cardId: cardIdForTraceRef.current,
              engine: "gallery-prompt-entry",
              selectionApplied: saved.selection ?? null,
              domSelectionAfter: input.getSelectedRange() ?? null,
            });
          }
        } else {
          input.clear();
        }
      }
      const root = rootRef.current;
      if (root) {
        root.setAttribute("data-empty", String(isEffectivelyEmpty(input)));
      }
      // Re-emit the persisted maximize state so the parent's controlled
      // value matches the snapshot. Reading defensively because older
      // payloads may not carry the field.
      const persistedMaximized =
        state && typeof state === "object" && typeof state.maximized === "boolean"
          ? state.maximized
          : false;
      onMaximizeChangeRef.current?.(persistedMaximized);
    },
  });

  // Expose the imperative delegate. Pass-throughs to the underlying input
  // delegate — the entry does not own text state.
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        promptInputRef.current?.focus();
      },
      blur() {
        promptInputRef.current?.blur();
      },
      clear() {
        promptInputRef.current?.clear();
      },
      getEditorElement() {
        return promptInputRef.current?.getEditorElement() ?? null;
      },
      regenerateAtoms() {
        promptInputRef.current?.regenerateAtoms();
      },
    }),
    [],
  );

  // Compose rootRef + responderRef onto the same DOM element. useResponder's
  // `responderRef` writes `data-responder-id` there; `rootRef` is the
  // direct-DOM handle Step 3 writes `data-empty` to.
  const composedRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  // Render the status row only when there is something to put in it.
  // Otherwise the row collapses to nothing and the input + toolbar stay
  // flush against the top of the entry, matching pre-polish behavior.
  const hasStatusRow =
    statusContent !== undefined ||
    toolsContent !== undefined ||
    maximized !== undefined;

  // Tools popover open state. The entry is the single source of truth —
  // TugPopover runs in controlled mode via the `open` / `onOpenChange`
  // pair, so there is no internal popover state to sync with. Drives
  // both the popover's visibility AND the toggle button's emphasis +
  // role (accent-on-open).
  const [toolsOpen, setToolsOpen] = React.useState(false);

  // Component State Preservation Protocol opt-in for the popover's
  // open state. Hook no-ops when `componentStatePreservationKey` is
  // undefined or rendered outside a card. [A9] / [AT0031] toolsOpen
  // axis. Route + per-route engine drafts ride `bag.content` via
  // `useCardStatePreservation` above; this hook only carries the popover
  // flag.
  useComponentStatePreservation<TugPromptEntryChromeState>({
    componentStatePreservationKey,
    captureState: () => ({ toolsOpen }),
    restoreState: (saved) => {
      if (saved === null || typeof saved !== "object") return;
      const next = saved as Partial<TugPromptEntryChromeState>;
      if (typeof next.toolsOpen === "boolean") {
        setToolsOpen(next.toolsOpen);
      }
    },
  });

  return (
    <ResponderScope>
      <div
        ref={composedRootRef}
        data-slot="tug-prompt-entry"
        data-phase={snap.phase}
        data-can-interrupt={String(snap.canInterrupt)}
        data-can-submit={String(snap.canSubmit)}
        data-errored={snap.lastError ? "" : undefined}
        data-pending-approval={snap.pendingApproval ? "" : undefined}
        data-pending-question={snap.pendingQuestion ? "" : undefined}
        data-queued={snap.queuedSends > 0 ? "" : undefined}
        data-empty="true"
        className={cn("tug-prompt-entry", className)}
      >
        {hasStatusRow && (
          <div className="tug-prompt-entry-status">
            <div className="tug-prompt-entry-status-content">
              {statusContent}
            </div>
            {toolsContent !== undefined && (
              <TugPopover
                open={toolsOpen}
                onOpenChange={setToolsOpen}
                dismissOnChainActivity={false}
              >
                <TugPopoverTrigger>
                  <TugPushButton
                    className="tug-prompt-entry-tools-toggle"
                    subtype="icon"
                    size="xs"
                    emphasis={toolsOpen ? "filled" : "ghost"}
                    role={toolsOpen ? "accent" : "action"}
                    aria-label="Toggle tools"
                    icon={<Settings size={12} strokeWidth={2} aria-hidden="true" />}
                  />
                </TugPopoverTrigger>
                <TugPopoverContent
                  side="bottom"
                  align="end"
                  className="tug-prompt-entry-tools-popover"
                >
                  {toolsContent}
                </TugPopoverContent>
              </TugPopover>
            )}
            {maximized !== undefined && (
              <TugPushButton
                className="tug-prompt-entry-maximize-toggle"
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
                action={TUG_ACTIONS.TOGGLE_MAXIMIZE}
              />
            )}
          </div>
        )}
        <div className="tug-prompt-entry-input-area">
          <div
            className="tug-prompt-entry-gutter"
            aria-hidden="true"
            data-route={route}
          >
            {route}
          </div>
          <TugPromptInput
            ref={promptInputRef}
            borderless
            maximized
            completionProviders={completionProviders}
            dropHandler={dropHandler}
            historyProvider={currentHistoryProvider}
            returnAction={RETURN_ACTION_BY_ROUTE[route] ?? "submit"}
            onChange={handleInputChange}
            onSubmit={performSubmit}
            /* State preservation is owned by TugPromptEntry (per-route
               map). Disable the child's registration so only one
               component claims the single CardStatePreservationContext
               slot. */
            preserveState={false}
          />
        </div>
        <div className="tug-prompt-entry-toolbar">
          <TugChoiceGroup
            items={[...ROUTE_ITEMS]}
            value={route}
            senderId={routeIndicatorSenderId}
            size="xs"
            aria-label="Command route"
          />
          {snap.queuedSends > 0 && (
            <span
              className="tug-prompt-entry-queue-badge"
              aria-live="polite"
            >
              {snap.queuedSends}
            </span>
          )}
          <TugPushButton
            className="tug-prompt-entry-submit-button"
            action={TUG_ACTIONS.SUBMIT}
            subtype="icon"
            size="lg"
            emphasis="filled"
            role={snap.canInterrupt ? "danger" : "action"}
            disabled={!snap.canSubmit && !snap.canInterrupt}
            aria-label={snap.canInterrupt ? "Stop turn" : "Send prompt"}
            icon={
              snap.canInterrupt
                ? <Square size={14} strokeWidth={3} />
                : <ArrowUp size={16} strokeWidth={2.5} />
            }
          />
        </div>
      </div>
    </ResponderScope>
  );
});
