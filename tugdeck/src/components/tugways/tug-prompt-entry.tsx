/**
 * TugPromptEntry — Compound composition: TugTextEditor + route segment
 * control + submit/stop button, driven by a CodeSessionStore snapshot.
 *
 * Composes TugTextEditor (CM6-backed editor + atom + completion +
 * drop), TugChoiceGroup (route segment control), TugPushButton
 * (submit/stop). Each composed child keeps its own tokens [L20]; the
 * entry reuses existing base-tier global / field / badge tokens per
 * [D11].
 *
 * Route model — simplified per [D08]:
 *   - One active route at a time, owned by a per-prompt-entry
 *     `RouteLifecycle` ([D02]). Default is `❯` (Prompt).
 *   - The segment control is the canonical control: clicks dispatch
 *     SELECT_VALUE → `routeLifecycle.setRoute`.
 *   - One-shot prefix detection: typing / pasting `>` `$` `:` (or the
 *     chevron alias) at offset 0 fires `routeLifecycle.setRoute(matched)` once.
 *     The character stays in the doc as plain text per [Q05]=a.
 *     Deletion of the leading prefix is NOT a route flip per [Q06]=b.
 *   - Submit-time strip: when `doc[0]` matches the active route's
 *     prefix character, that single character is stripped from the
 *     submitted text per [Q09]=a. Otherwise the doc text is sent
 *     verbatim.
 *   - Per-route drafts are gone per [Q07]=a — one draft per entry,
 *     persisted across reloads via the existing tugbank pipeline.
 *
 * Laws: [L02] useSyncExternalStore for store state, [L06] appearance
 *       via CSS/DOM, [L07] handlers read state via refs, [L11]
 *       controls emit actions, [L15] token-driven states, [L16]
 *       pairings declared, [L19] component authoring guide, [L20]
 *       token sovereignty, [L22] direct DOM writes for high-frequency
 *       updates, [L23] [L24] state preservation lives on the entry,
 *       not the substrate.
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

import { ArrowUp, Bot, Command, Plus, Shell, Square } from "lucide-react";
import { EditorView } from "@codemirror/view";

import { cn } from "@/lib/utils";
import type {
  AtomSegment,
  CompletionProvider,
  DropHandler,
  HistoryProvider,
  TugTextEditingState,
} from "@/lib/tug-text-types";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import type { CodeSessionPhase, CodeSessionStore } from "@/lib/code-session-store";
import { useLifecycleState } from "@/lib/code-session-store/hooks/use-lifecycle-state";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { PromptHistoryStore } from "@/lib/prompt-history-store";

import {
  TugTextEditor,
  type TugTextEditorDelegate,
} from "./tug-text-editor";
import {
  getAtomsInState,
  regenerateAtomsEffect,
  type PositionedAtom,
} from "./tug-text-editor/atom-decoration";
import { createRoutePrefixExtension } from "./tug-prompt-entry/route-prefix-extension";
import { TugChoiceGroup, type TugChoiceItem } from "./tug-choice-group";
import { TugPushButton } from "./tug-push-button";
import { resolveSubmitButtonView } from "./tug-prompt-entry-submit-button";
import { useResponder } from "./use-responder";
import type { ActionEvent } from "./responder-chain";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useCardStatePreservation, useCardId } from "./use-card-state-preservation";
import { selectionGuard } from "./selection-guard";
import { deckTrace } from "@/deck-trace";
import { getDeckStore } from "@/lib/deck-store-registry";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import type { HistoryEntry } from "@/lib/prompt-history-store";
import { RouteLifecycle, RouteLifecycleContext } from "@/lib/route-lifecycle";

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/**
 * The three routes surfaced in the segment control. Each segment is
 * `[icon][gap][name]` — a lucide gutter glyph (matching the
 * participant iconography in `TugTranscriptEntry`) plus the route's
 * display name. The route prefix character (`>` / `$` / `:`) is no
 * longer painted in the segment label; it lives on as a hidden
 * power-user feature, since `route-prefix-extension` still flips the
 * route when the user types one of those characters at offset 0 of
 * the editor. The visible affordances are the segment icon + name
 * and the keyboard shortcuts wired in `keybinding-map.ts`
 * (⇧⌘C → Code, ⇧⌘S → Shell, ⇧⌘: → Command), which dispatch
 * `SELECT_ROUTE` to this entry's responder.
 */
const ROUTE_ITEMS: ReadonlyArray<TugChoiceItem> = [
  { value: "❯", label: "Code",    icon: <Bot /> },
  { value: "$", label: "Shell",   icon: <Shell /> },
  { value: ":", label: "Command", icon: <Command /> },
];

/**
 * Map of prefix character → route value.
 *
 * `>` is an ASCII alias for the Prompt route's display character `❯`.
 * The segment control shows the chevron, but the typed greater-than is
 * keyboard-friendly and routes to the same Prompt value. Both characters
 * also act as the strip-on-match lookup at submit time per [Q09]=a.
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
 * - `❯` (Prompt): Return inserts a newline; Shift+Return submits.
 *   Prompts are long-form, so naïve Return should stay a newline.
 * - `$` (Shell): Return submits; Shift+Return inserts a newline.
 *   Shell invocations are typically a single line.
 * - `:` (Command): Return submits; Shift+Return inserts a newline.
 *   Commands are one-liners in practice.
 *
 * The substrate's shift inversion means we only need to declare the
 * unshifted action per route; Shift+Return is the opposite
 * automatically.
 */
const RETURN_ACTION_BY_ROUTE: Readonly<Record<string, "submit" | "newline">> = {
  "❯": "newline",
  "$": "submit",
  ":": "submit",
};

/**
 * Default route at initial mount when no persisted state restores a
 * prior selection. Prompt (`❯`) is the sensible default: it's the
 * most common conversation surface.
 */
const DEFAULT_ROUTE = "❯";

/**
 * Separator joining `sessionId` + `route` into the in-memory
 * history-provider cache key. U+001F (ASCII Unit Separator) — a
 * control character that cannot occur in a session id, so the two
 * fields can never collide on a different split. An escape sequence,
 * never a raw byte, so the source file stays plain text.
 */
const HISTORY_KEY_SEP = "\u001f";

// ---------------------------------------------------------------------------
// Preserved state shape + migration
// ---------------------------------------------------------------------------

/**
 * Preserved state payload via `useCardStatePreservation`.
 *
 * Simplified per [D08] / [Q07]=a: one route + one draft. Older payloads
 * carrying the legacy `perRoute: Record<route, TugTextEditingState>`
 * shape are migrated forward in `coerceRestorePayload`: the snapshot
 * for the persisted active route becomes `draft`, and the rest is
 * dropped.
 *
 * JSON-serializable (no DOM, no functions) — round-trips through
 * tugbank via the TugPane state preservation pipeline [L23].
 */
interface TugPromptEntryState {
  route: string;
  draft: TugTextEditingState | null;
  /**
   * Latest known maximize state of the entry's pane. Optional so
   * older persisted snapshots restore as "not maximized" without a
   * migration. The entry doesn't own this state itself — it's a
   * controlled-component prop — so on save it snapshots the current
   * `maximized` prop and on restore it re-emits via `onMaximizeChange`.
   */
  maximized?: boolean;
}

/**
 * Legacy payload shape — prior to Step 15. Kept as an interpretive
 * type for the one-shot migration in `coerceRestorePayload`. New
 * payloads always write the simplified shape; reading the legacy
 * shape is best-effort.
 */
interface LegacyTugPromptEntryState {
  currentRoute?: string;
  perRoute?: Record<string, TugTextEditingState>;
  maximized?: boolean;
}

/**
 * Coerce a restored payload (which may be the new simplified shape, an
 * older `{ currentRoute, perRoute }` shape, or arbitrary garbage) into
 * the canonical {@link TugPromptEntryState}.
 *
 * Migration rules:
 *   - New shape: passed through (with defensive shape narrowing).
 *   - Legacy `perRoute` shape: `perRoute[currentRoute]` becomes
 *     `draft`. Drafts for other routes are dropped per [Q07]=a.
 *   - Anything else: defaulted to `{ route: DEFAULT_ROUTE, draft: null }`.
 *
 * Exported for the unit-tests that exercise the migration path
 * without standing up the full component.
 */
export function coerceRestorePayload(raw: unknown): TugPromptEntryState {
  const fallback: TugPromptEntryState = {
    route: DEFAULT_ROUTE,
    draft: null,
    maximized: false,
  };
  if (raw === null || typeof raw !== "object") return fallback;
  const obj = raw as Partial<TugPromptEntryState> & LegacyTugPromptEntryState;
  const maximized = typeof obj.maximized === "boolean" ? obj.maximized : false;

  // New shape — `route` + `draft` are both present.
  if (typeof obj.route === "string") {
    const draft = isEditingState(obj.draft) ? obj.draft : null;
    return { route: obj.route, draft, maximized };
  }

  // Legacy shape — `currentRoute` + `perRoute`.
  if (
    typeof obj.currentRoute === "string"
    && obj.perRoute !== undefined
    && typeof obj.perRoute === "object"
    && obj.perRoute !== null
  ) {
    const perRoute = obj.perRoute as Record<string, unknown>;
    const candidate = perRoute[obj.currentRoute];
    const draft = isEditingState(candidate) ? candidate : null;
    return { route: obj.currentRoute, draft, maximized };
  }

  return fallback;
}

/**
 * Defensive runtime check: does `value` look enough like a
 * `TugTextEditingState` to feed into `delegate.restoreState` without
 * crashing? Validates only the shape, not the content — a truly
 * malformed atom will surface inside the substrate's own restore
 * path.
 */
function isEditingState(value: unknown): value is TugTextEditingState {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { text?: unknown; atoms?: unknown };
  return typeof candidate.text === "string" && Array.isArray(candidate.atoms);
}

// ---------------------------------------------------------------------------
// Effective-empty helper
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the editor has no user content (zero-length
 * doc). Atoms in the editor occupy a single placeholder character
 * each, so a non-empty editor with only atoms is correctly reported
 * as non-empty by `doc.length > 0`.
 */
function isEffectivelyEmpty(view: EditorView | null): boolean {
  if (view === null) return true;
  return view.state.doc.length === 0;
}

/**
 * Strip a single leading prefix character from `text` iff it matches
 * the active route per [Q09]=a.
 *
 * The aliasMap is the same map the route-prefix extension uses for
 * one-way detection. Stripping at submit reuses it so the inverse
 * (route → prefix-characters-that-map-to-it) doesn't have to be
 * computed separately.
 */
function stripLeadingRoutePrefix(
  text: string,
  activeRoute: string,
  aliasMap: Readonly<Record<string, string>>,
): string {
  if (text.length === 0) return text;
  const first = text[0]!;
  if (aliasMap[first] === activeRoute) return text.slice(1);
  return text;
}

/**
 * Submit-text computation, exported for the submit-strip unit tests.
 * Combines the substrate's text capture with the active route's
 * prefix strip rule. Pure: takes only the captured shape and the
 * route + alias map; no DOM access.
 */
export function computeSubmitText(
  rawText: string,
  activeRoute: string,
  aliasMap: Readonly<Record<string, string>> = ROUTE_PREFIX_ALIAS,
): string {
  return stripLeadingRoutePrefix(rawText, activeRoute, aliasMap);
}

/** Disposition of a submit that arrives while the store can't accept it. */
export type BlockedSubmitDisposition = "drop" | "defer";

/**
 * Classify a *blocked* submit — one that reached `performSubmit` with
 * `canSubmit === false` and `canInterrupt === false`.
 *
 * `performSubmit` only reaches this branch in two store states:
 *  - `replaying` — the JSONL bracket owns the card; a deferred send
 *    that committed *after* replay finished would surprise the user
 *    with a dispatch they don't remember initiating. Mirrors the
 *    reducer's own `handleSend` guard. → `"drop"`.
 *  - `idle` / `errored` but the transport is not yet `online` — the
 *    brief settling window on a freshly-created or reconnecting card.
 *    The submission is valid; it just landed a beat early. → `"defer"`,
 *    so the entry can re-fire it the instant `canSubmit` flips true
 *    and Shift+Return (or the button) never silently no-ops.
 *
 * Pure: keyed only on the snapshot phase. Exported for the unit tests.
 */
export function classifyBlockedSubmit(
  phase: CodeSessionPhase,
): BlockedSubmitDisposition {
  return phase === "replaying" ? "drop" : "defer";
}

/**
 * Build a {@link TugTextEditingState} from a `(text, atoms)` pair
 * carried on `CodeSessionSnapshot.pendingDraftRestore`. The snapshot
 * shape stores atoms positionally-implicit: `text` contains
 * {@link TUG_ATOM_CHAR} (`U+FFFC`) at each atom's spot, and `atoms` is
 * the parallel sequence of segments in document order. The substrate's
 * `restoreState` consumes the positional shape — `{ position, type,
 * label, value }` per atom — so we walk `text` for placeholder indices
 * and zip them with `atoms`.
 *
 * Defensive against shape mismatches: if the placeholder count and
 * `atoms.length` don't agree, we trust the shorter sequence so a
 * malformed snapshot can't crash the editor's restore path. Selection
 * is omitted (`null`) — the caret will land at end-of-doc on restore,
 * which is the natural place for the user to continue editing after
 * an interrupted submission.
 *
 * Exported so the unit tests can pin the conversion without standing
 * up the full component.
 */
export function buildEditingStateFromDraftRestore(
  text: string,
  atoms: ReadonlyArray<AtomSegment>,
): TugTextEditingState {
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) === TUG_ATOM_CHAR) {
      positions.push(i);
    }
  }
  const pairCount = Math.min(positions.length, atoms.length);
  const positionedAtoms = Array.from({ length: pairCount }, (_, i) => {
    const segment = atoms[i]!;
    return {
      position: positions[i]!,
      type: segment.type,
      label: segment.label,
      value: segment.value,
    };
  });
  return {
    text,
    atoms: positionedAtoms,
    selection: null,
  };
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
 * @selector [data-errored]                         — presence when snap.lastError !== null
 * @selector [data-pending-approval]                — presence when snap.pendingApproval !== null
 * @selector [data-pending-question]                — presence when snap.pendingQuestion !== null
 * @selector [data-empty="true" | "false"]          — written from a substrate update listener
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
  /** Prompt history (recall on arrow up/down). Forwarded to TugTextEditor. */
  historyStore: PromptHistoryStore;
  /**
   * Completion providers keyed by trigger character, forwarded to the
   * underlying `TugTextEditor`. Example: `{ "@": fileProvider, "/": commandProvider }`.
   * Leave undefined to disable all trigger completions.
   */
  completionProviders?: Record<string, CompletionProvider>;
  /** Drop handler for dragging files from Finder. Forwarded to TugTextEditor. */
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
   * submit. Distinguishes a genuine user submit from incidental empty
   * states (manual delete, undo-to-empty). Hosts use this hook to drive
   * effects that should happen ONLY on explicit submits.
   */
  onBeforeSubmit?: () => void;
  /**
   * Optional callback fired AFTER a successful submit has cleared the
   * input. Does NOT fire on the `canInterrupt` Stop branch, on
   * `canSubmit=false`, or on the empty-input guard.
   */
  onAfterSubmit?: () => void;
  /**
   * Optional content rendered in the status row above the input.
   */
  statusContent?: React.ReactNode;
  /**
   * Optional caution content rendered on the trailing edge of the
   * status row, between the leading `statusContent` and the tools /
   * maximize toggles. Intended for a small caution affordance (e.g.
   * the Tide card's aggregate drift-caution chip). The wrapper slot
   * collapses to nothing when the content renders empty, so a
   * conditionally-visible chip leaves no gap when it has nothing to
   * show.
   */
  cautionContent?: React.ReactNode;
  /**
   * `Z4B` — the indicator slot. Optional content rendered in the
   * toolbar between the route choice group (`Z4A`) and the submit
   * button (`Z5`), floated to the centre of the gap between them by a
   * pair of equal flex spacers ([D05]). Content-sized; `undefined`
   * renders an empty slot, leaving `Z4A` and `Z5` at the row's edges.
   */
  indicatorsContent?: React.ReactNode;
  /**
   * The entry pane's maximize state, owned by the host card. The entry
   * renders no maximize control itself — the host card does, in its own
   * chrome — but it persists this value in its editing-state snapshot
   * and re-emits it through `onMaximizeChange` on restore.
   */
  maximized?: boolean;
  /**
   * Called on restore to re-emit the persisted maximize state to the
   * host card, which owns the live `maximized` state.
   */
  onMaximizeChange?: (next: boolean) => void;
  /** Caller-supplied className merged with the root. */
  className?: string;
  /**
   * Soft-wrap long lines at the editor's width. Forwarded verbatim
   * to the substrate.
   * @default false
   */
  lineWrap?: boolean;
  /**
   * Show the line-numbers gutter in the embedded editor. Forwarded
   * verbatim to the substrate.
   * @default false
   */
  lineNumbers?: boolean;
  /**
   * Highlight the gutter cell of the line containing the cursor.
   * Forwarded verbatim to the substrate.
   * @default false
   */
  highlightActiveLineGutter?: boolean;
  /**
   * Manual Return-key override. When set, wins over the entry's
   * per-route default (which makes Return insert a newline on the
   * Prompt route and submit on Shell / Command). When omitted, the
   * per-route default applies.
   *
   * Numpad Enter is always "submit" inside `tug-prompt-entry` — the
   * underlying `TugTextEditor` keeps both options as a separate
   * prop, but the entry pins it to the typical Tide use case.
   */
  returnAction?: "submit" | "newline";
  /**
   * Per-route placeholder text for the embedded editor, keyed by the
   * route value (`❯` Code / `$` Shell / `:` Command — see
   * `ROUTE_ITEMS`). The entry looks up the active route and forwards
   * the match to `TugTextEditor`; routes absent from the map — or an
   * undefined prop entirely — render no placeholder. The tide-card
   * supplies route-specific copy; the gallery prompt-entry omits it.
   */
  placeholderByRoute?: Readonly<Record<string, string>>;
}

/**
 * Imperative handle exposed via `forwardRef`. Used by the Tide card
 * to drive focus from global keyboard shortcuts.
 *
 * Methods are thin pass-throughs to the composed `TugTextEditor`'s
 * delegate. The entry does not own text state — keeping the
 * pass-through semantics honest avoids divergence between the entry's
 * imperative surface and the substrate's actual behavior.
 */
export interface TugPromptEntryDelegate {
  /** Move keyboard focus to the underlying editor element. */
  focus(): void;
  /** Remove keyboard focus from the underlying editor element. */
  blur(): void;
  /** Clear the input's content. */
  clear(): void;
  /**
   * The underlying editor element (CM6's `cm-content` div). Used by
   * `useContentDrivenPanelSize` as the scroll-source signal for
   * content-driven panel growth.
   */
  getEditorElement(): HTMLElement | null;
  /**
   * Regenerate atom widgets — needed when the editor font or theme
   * tokens change so the SVG-rendered atom chips pick up the new
   * family/size. Forwards to the substrate's
   * `regenerateAtomsEffect` dispatch.
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
    cautionContent,
    indicatorsContent,
    maximized,
    onMaximizeChange,
    className,
    lineWrap,
    lineNumbers,
    highlightActiveLineGutter,
    returnAction: returnActionOverride,
    placeholderByRoute,
  } = props;

  // [L02] external store state enters React through useSyncExternalStore only.
  const snap = useSyncExternalStore(
    codeSessionStore.subscribe,
    codeSessionStore.getSnapshot,
  );

  // Substrate delegate, root, and live snapshot mirror.
  const textEditorRef = useRef<TugTextEditorDelegate | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const snapRef = useRef(snap);
  useLayoutEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  // Z5 submit-button state machine. The button's whole view — label,
  // icon, `disabled`, `data-mode` — is a pure function of the
  // lifecycle-derived `submitButtonMode` (six kinds: submit / stop /
  // awaiting-user / stopping / reconnecting / restoring). Reading it
  // through `useLifecycleState` keeps the matrix the single source of
  // truth ([L02]); `resolveSubmitButtonView` is the pure projection.
  // The mode is mirrored to a ref so `performSubmit` — the shared
  // keyboard + pointer submit path — can gate on it without going
  // stale ([L07]).
  const submitButtonMode = useLifecycleState(codeSessionStore).submitButtonMode;
  const submitView = resolveSubmitButtonView(submitButtonMode);
  const submitButtonModeRef = useRef(submitButtonMode);
  useLayoutEffect(() => {
    submitButtonModeRef.current = submitButtonMode;
  }, [submitButtonMode]);

  // Draft restore. Two store actions populate `pendingDraftRestore`:
  // a CASE A interrupt pulling a pre-content turn back to re-edit, and
  // a queued-send cancel un-sending a mid-turn submission. Either way
  // the store captures the prompt onto `snap.pendingDraftRestore`;
  // this effect observes the slot's identity, seeds the editor, and
  // dispatches `consumePendingDraftRestore` so the slot clears in the
  // next snapshot — the restore applies exactly once even if the
  // parent re-renders.
  //
  // The editor is seeded ONLY when it is empty: a cancel must never
  // clobber a draft the user is composing. A CASE A pull-down always
  // lands on an empty editor (it was cleared at submit), so the guard
  // is a no-op there; a queued-send cancel can fire while the user is
  // mid-compose, and there the slot is dropped — consumed but not
  // applied.
  //
  // [L02] state enters via the snap from useSyncExternalStore.
  // [L03] useLayoutEffect ensures the doc replacement is visible in
  // the same paint as the snapshot transition (no flash of an empty
  // editor between cancel and restore).
  // [L07] the effect reads the substrate delegate via the ref so a
  // late mount doesn't lose its restore — the slot survives until
  // consumed, so a re-mount after the slot was set still seeds the
  // editor on its first effect tick.
  const restoreSlot = snap.pendingDraftRestore;
  useLayoutEffect(() => {
    if (restoreSlot === null) return;
    const editor = textEditorRef.current;
    if (editor === null) return;
    if (isEffectivelyEmpty(editor.view() ?? null)) {
      editor.restoreState(
        buildEditingStateFromDraftRestore(restoreSlot.text, restoreSlot.atoms),
      );
    }
    codeSessionStore.consumePendingDraftRestore();
  }, [restoreSlot, codeSessionStore]);

  // Stable sender id for the segment control. Derived from `id` so
  // parent cards can predict it for integration tests.
  const routeIndicatorSenderId = `${id}-route-indicator`;

  // [D02] The route is owned by a per-prompt-entry RouteLifecycle, not
  // React state. The instance is constructed once and stays stable for
  // the component's lifetime ([D01]) — a `useRef` lazy-init is the
  // canonical stable-instance pattern. Every route trigger (the choice
  // group, the route-prefix extension, the SELECT_ROUTE keybinding,
  // and restore) funnels through `routeLifecycle.setRoute`.
  const routeLifecycleRef = useRef<RouteLifecycle | null>(null);
  if (routeLifecycleRef.current === null) {
    routeLifecycleRef.current = new RouteLifecycle(DEFAULT_ROUTE);
  }
  const routeLifecycle = routeLifecycleRef.current;

  // [L02] The route is external state once the Z4B indicator reads it,
  // so it enters React through `useSyncExternalStore` only. Submit and
  // extension closures read the live value via `routeLifecycle.getRoute()`
  // off the stable instance — no mirror ref, no stale capture ([L07]).
  const route = useSyncExternalStore(
    routeLifecycle.subscribe,
    routeLifecycle.getRoute,
  );

  // Per-route history providers. One provider per route — each holds
  // its own cursor + in-memory "return to draft" cache, so the user's
  // browsing position in history survives route switches. Providers
  // are created lazily and persist for the lifetime of the entry mount.
  useSyncExternalStore(
    historyStore.subscribe,
    historyStore.getSnapshot,
  );

  // History keys on the session's id. The provider cache is keyed by
  // `${sessionId}${HISTORY_KEY_SEP}${route}` so a route change for the same
  // session reuses the cached provider (preserving its cursor + draft
  // state).
  const historyProvidersRef = useRef<Record<string, HistoryProvider>>({});
  const currentHistoryProvider = useMemo<HistoryProvider>(() => {
    const sessionId = snap.tugSessionId;
    const cacheKey = `${sessionId}${HISTORY_KEY_SEP}${route}`;
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

  // Live ref for the optional localCommandHandler so `performSubmit`
  // (the shared submit closure) reads the latest callback without
  // rebuilding on every render. [L07]
  const localCommandHandlerRef = useRef(localCommandHandler);
  useLayoutEffect(() => {
    localCommandHandlerRef.current = localCommandHandler;
  }, [localCommandHandler]);

  // Live refs for `onBeforeSubmit` / `onAfterSubmit` so an inline
  // closure passed by the host doesn't churn `performSubmit`'s
  // identity. [L07]
  const onBeforeSubmitRef = useRef(onBeforeSubmit);
  useLayoutEffect(() => {
    onBeforeSubmitRef.current = onBeforeSubmit;
  }, [onBeforeSubmit]);
  const onAfterSubmitRef = useRef(onAfterSubmit);
  useLayoutEffect(() => {
    onAfterSubmitRef.current = onAfterSubmit;
  }, [onAfterSubmit]);

  // Live refs for the maximize controlled-pair so the chain-action
  // handler (registered once at mount via `useResponder.actions`)
  // sees the current values per [L07]. The handler can't close over
  // `props` directly — `useResponder`'s actions map is captured at
  // mount and would freeze whatever values the first render had.
  const maximizedRef = useRef(props.maximized);
  const onMaximizeChangeRef = useRef(props.onMaximizeChange);
  useLayoutEffect(() => {
    maximizedRef.current = props.maximized;
  }, [props.maximized]);
  useLayoutEffect(() => {
    onMaximizeChangeRef.current = props.onMaximizeChange;
  }, [props.onMaximizeChange]);

  // Card id for diagnostic deck-trace events. Held in a ref so the
  // onRestore closure (registered through useCardStatePreservation)
  // reads the current value at fire time per [L07].
  const cardIdForTrace = useCardId();
  const cardIdForTraceRef = useRef(cardIdForTrace);
  cardIdForTraceRef.current = cardIdForTrace;

  // Helper: route the embedded substrate's selection through
  // selectionGuard for the inactive-paint channel.
  const publishToSelectionGuard = useCallback((range: Range | null): void => {
    const id = cardIdForTraceRef.current;
    if (id === null) return;
    selectionGuard.updateCardDomSelection(id, range);
  }, []);

  // Substrate-level extensions installed at mount time. The
  // route-prefix detector reads `routeLifecycle.getRoute()` at fire
  // time per [L07], so the same extension instance stays correct as the
  // route changes. The data-empty sync writes through a ref-tracked
  // root element — also stable across renders. Extension array is
  // captured by the substrate at mount; subsequent identity changes
  // don't propagate (per the substrate's `extensions` prop contract),
  // so we wrap in `useMemo` with empty deps to avoid churn.
  const editorExtensions = useMemo(
    () => [
      createRoutePrefixExtension({
        aliasMap: ROUTE_PREFIX_ALIAS,
        getCurrentRoute: () => routeLifecycle.getRoute(),
        // `setRoute` is idempotent on a same-route value, and the
        // extension already guards that case — no wrapper guard needed.
        setRoute: (next: string) => routeLifecycle.setRoute(next),
      }),
      // data-empty bridge: keep the entry root's `data-empty`
      // attribute in sync with `view.state.doc.length === 0`.
      // Direct DOM write per [L06] / [L22] — no React re-render on
      // every keystroke.
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const root = rootRef.current;
        if (root === null) return;
        root.setAttribute(
          "data-empty",
          String(update.state.doc.length === 0),
        );
      }),
    ],
    [],
  );

  // A submit that landed during the transport-settling window is
  // armed here and flushed by the effect below the moment `canSubmit`
  // flips true. See `classifyBlockedSubmit` + `performSubmit`'s
  // blocked-submit branch.
  const pendingSubmitRef = useRef(false);

  // Shared submit logic. Invoked by both the SUBMIT chain-action
  // handler (button click, Cmd+Enter, etc.) and the Return /
  // Shift+Return keyboard path (via the substrate's `onSubmit`).
  // Single closure means keyboard and pointer converge on the same
  // interrupt-vs-send decision, the same localCommandHandler
  // intercept, and the same clear-and-route teardown.
  //
  // Stable identity (`useCallback` with deps that are themselves
  // stable — `codeSessionStore` is a prop reference); policy is read
  // through refs so the closure never goes stale [L07].
  const performSubmit = useCallback(() => {
    const editor = textEditorRef.current;
    const view = editor?.view() ?? null;
    const snap = snapRef.current;
    if (editor === null || view === null) return;
    // Z5 disabled-mode gate. When `submitButtonMode` is one of the
    // four inert kinds (awaiting-user / stopping / reconnecting /
    // restoring) the button is `disabled` — a native-disabled button
    // already rejects click + the chain dispatch, but the editor's
    // Return key reaches `performSubmit` directly, so it is gated
    // here too. A disabled mode does not fire on Enter.
    if (resolveSubmitButtonView(submitButtonModeRef.current).disabled) {
      return;
    }
    // A mid-turn submit queues — the reducer's `handleSend` enqueues
    // a `send` dispatched while a turn runs ([D-T3-07]). The earlier
    // "submit is interrupt" branch is retired: the primary Stop button
    // interrupts through the SUBMIT action handler; editor Return and
    // the `+` button queue. `performSubmit` is now uniformly "submit
    // the editor draft" — `codeSessionStore.send()` below, which the
    // reducer routes to a turn start (idle) or the queue (mid-turn).
    //
    // Blocked submit ([D-T3-08]): `canSubmit` AND `canInterrupt` both
    // false means the card is `replaying` (drop — a deferred send
    // committing post-replay would surprise the user) or the
    // transport is still settling on a fresh / reconnecting card
    // (defer — the submission is valid, it just landed a beat early).
    // Deferral arms `pendingSubmitRef`; the flush effect below
    // re-fires `performSubmit` the instant `canSubmit` flips true. A
    // turn in flight is NOT blocked — it falls through to `send()`
    // and queues.
    if (!snap.canSubmit && !snap.canInterrupt) {
      if (
        classifyBlockedSubmit(snap.phase) === "defer" &&
        !isEffectivelyEmpty(view)
      ) {
        pendingSubmitRef.current = true;
      }
      return;
    }
    // Empty-input guard — reads the live view per [L07].
    if (isEffectivelyEmpty(view)) return;
    const captured = editor.captureState();
    const positionedAtoms: PositionedAtom[] = getAtomsInState(view.state);
    const currentRoute = routeLifecycle.getRoute() || null;
    // Strip the leading prefix character iff it maps to the active
    // route per [Q09]=a. Atoms ride along verbatim — they sit in the
    // doc as `￼` placeholders and the strip never touches one
    // (no prefix character maps to a route via `￼`).
    const strippedText = computeSubmitText(
      captured.text,
      currentRoute ?? "",
      ROUTE_PREFIX_ALIAS,
    );
    const stripped = strippedText !== captured.text;
    // Atom positions shift left by 1 when the leading prefix is stripped.
    // The prefix character is plain text — never an atom — so the
    // filter on `position >= 1` only matters defensively.
    const atomsAdjusted: PositionedAtom[] = stripped
      ? positionedAtoms
        .filter((a) => a.position >= 1)
        .map((a) => ({ position: a.position - 1, segment: a.segment }))
      : positionedAtoms;
    const sendAtoms: AtomSegment[] = atomsAdjusted.map((a) => a.segment);
    // [D06] localCommandHandler seam — called BEFORE the store send
    // so local `:`-surface commands can intercept. Receives the
    // post-strip atoms list as plain `AtomSegment[]` (no positions).
    const handled =
      localCommandHandlerRef.current?.(currentRoute, sendAtoms) ?? false;
    if (!handled) {
      codeSessionStore.send(strippedText, sendAtoms);
    }
    // Record the submission in per-session history, keyed by the
    // session's id. The route field is what lets
    // `RouteHistoryProvider` filter this entry into the current
    // route's timeline. Captured before clear so the live state is
    // still the submitted content.
    const sessionId = snapRef.current.tugSessionId;
    historyStore.push({
      id: `${sessionId}-${Date.now()}`,
      sessionId,
      projectPath: "",
      route: currentRoute ?? "",
      text: strippedText,
      atoms: atomsAdjusted.map((a) => ({
        position: a.position,
        type: a.segment.type,
        label: a.segment.label,
        value: a.segment.value,
      })),
      timestamp: Date.now(),
    });
    // Fire the pre-clear hook so hosts can drive submit-specific
    // effects BEFORE `editor.clear()` flips `data-empty="true"`.
    onBeforeSubmitRef.current?.();
    editor.clear();
    // Fire AFTER clear so host hooks (e.g., refocus) act on the
    // already-empty editor.
    onAfterSubmitRef.current?.();
    // Route is a sticky user preference. Do not reset on submit.
  }, [codeSessionStore, historyStore]);

  // Flush a deferred submit. When a submit landed during the
  // transport-settling window, `performSubmit`'s blocked-submit branch
  // armed `pendingSubmitRef`; re-fire it the instant `canSubmit` flips
  // true so Shift+Return (or the button) submits without the user
  // having to retry. `performSubmit` re-captures the editor live, so
  // any edits made while waiting are included — and an editor emptied
  // in the meantime no-ops cleanly.
  //
  // `useLayoutEffect` keyed on `snap.canSubmit` runs after the
  // `snapRef` mirror above (declared earlier, so it commits first),
  // so `performSubmit` reads the fresh snapshot. [L03]
  useLayoutEffect(() => {
    if (!snap.canSubmit) return;
    if (!pendingSubmitRef.current) return;
    pendingSubmitRef.current = false;
    performSubmit();
  }, [snap.canSubmit, performSubmit]);

  // [L07] Register the responder node. SELECT_VALUE narrows on
  // sender + value shape and updates the route directly —
  // there's no per-route draft to swap into the editor anymore
  // ([Q07]=a), so the handler is a single routeLifecycle.setRoute +
  // refocus-the-editor.
  //
  // CANCEL_DIALOG is conditionally registered — only when a turn is in
  // flight AND no interrupt is already in flight (`canInterrupt &&
  // !interruptInFlight`), i.e. exactly when there is still something
  // cancellable. Both Escape and Cmd-. map to CANCEL_DIALOG in
  // `keybinding-map.ts`; the chain walks from first responder upward so
  // any visible popover / sheet / alert dismisses first via its own
  // CANCEL_DIALOG handler ([DT07]). When nothing dialog-like is in the
  // chain and a turn is in flight, the walk reaches us and we
  // `peelNewest()` — the unified Stop ≡ Esc gesture: peel the newest
  // cancellable thing, a queued send first (LIFO), then the running
  // turn once the queue is empty. Identical to clicking the red Stop
  // button (the SUBMIT handler's stop branch calls the same
  // `peelNewest()`).
  //
  // Conditional registration matters: the chain marks an action as
  // handled iff its key exists in the responder's actions map
  // (`lookupHandler` is `node.actions[action]`). Registering
  // CANCEL_DIALOG unconditionally would suppress the bubble-phase
  // event (preventDefault + stopImmediatePropagation) even when there
  // is nothing to cancel — and that would break editor-internal
  // Escape semantics (CodeMirror's autocomplete dismiss). The
  // `useResponder` hook's R5 live-lookup proxy reads
  // `optionsRef.current.actions` on every dispatch, so the conditional
  // spread reflects the current snapshot at dispatch time.
  //
  // The `!interruptInFlight` clause closes the Esc-during-INTERRUPTING
  // gap: once a CASE B interrupt is in flight the turn is already
  // being torn down and `handleInterrupt` cleared its queue, so there
  // is nothing left to peel — and the Stop button is itself already
  // disabled (`submitButtonMode` is `stopping`), so dropping the Esc
  // handler too keeps Esc ≡ the Stop button. Without it, a second Esc
  // would re-fire `interrupt()` on a turn already interrupting (a
  // redundant wire frame + a clobbered interrupt-segment timestamp).
  //
  // The handler lives at THIS responder (TugPromptEntry's) rather
  // than further up the chain (card-content) because the chain walk
  // reaches us first — closer to the first responder is the natural
  // place for a behavior that's semantically owned by the prompt
  // entry (which already owns the submit / peel branching for the
  // Stop button via the SUBMIT action handler).
  const { ResponderScope, responderRef } = useResponder({
    id,
    actions: {
      [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
        if (event.sender !== routeIndicatorSenderId) return;
        if (typeof event.value !== "string") return;
        const prevRoute = routeLifecycle.getRoute();
        const nextRoute = event.value;
        if (prevRoute === nextRoute) return;
        routeLifecycle.setRoute(nextRoute);
        // Move keyboard focus back to the editor so the user can
        // start typing immediately — the segment button had focus
        // from the click; this hands it back.
        textEditorRef.current?.focus();
      },
      [TUG_ACTIONS.SELECT_ROUTE]: (event: ActionEvent) => {
        // Keyboard-shortcut path (⇧⌘C / ⇧⌘S / ⇧⌘:). The keymap puts
        // the canonical route character on `event.value`; we narrow
        // to string and gate against unknown values. Same semantics
        // as the segment-control click path above, minus the focus
        // handoff (the editor already has focus when the shortcut
        // fires, since the dispatch is `first-responder` scoped).
        if (typeof event.value !== "string") return;
        const nextRoute = event.value;
        if (!Object.prototype.hasOwnProperty.call(RETURN_ACTION_BY_ROUTE, nextRoute)) return;
        // `setRoute` is a no-op when `nextRoute` equals the current route.
        routeLifecycle.setRoute(nextRoute);
      },
      [TUG_ACTIONS.SUBMIT]: (_event: ActionEvent) => {
        // The primary Z5 button dispatches SUBMIT in every mode. When
        // a turn is running the button is Stop — it peels the newest
        // cancellable thing (a queued send first, LIFO; the running
        // turn once the queue is empty), the same `peelNewest()`
        // gesture Esc invokes. In any submit-family mode it runs the
        // submit. Editor Return reaches `performSubmit` directly
        // (never via this action), so an in-flight Return queues
        // rather than peeling.
        if (submitButtonModeRef.current.kind === "stop") {
          codeSessionStore.peelNewest();
        } else {
          performSubmit();
        }
      },
      ...(snap.canInterrupt && !snap.interruptInFlight
        ? {
            [TUG_ACTIONS.CANCEL_DIALOG]: (_event: ActionEvent) => {
              codeSessionStore.peelNewest();
            },
          }
        : {}),
    },
  });

  // Seed `data-empty` from the actual view state once the substrate
  // ref is wired [L03]. The JSX defaults `data-empty="true"` at
  // render, but on a browser reload / HMR refresh the editor may
  // already carry preserved content — the submit button would then
  // stay disabled until the user typed. Running the same check once
  // at mount closes that gap.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const view = textEditorRef.current?.view() ?? null;
    if (root === null) return;
    root.setAttribute("data-empty", String(isEffectivelyEmpty(view)));
  }, []);

  // Snapshot the substrate's scroll position the moment the card
  // deactivates. The framework hides inactive cards via `display:
  // none`, which collapses `.cm-scroller`'s scrollable extent and
  // (on Safari/WebKit) wipes its `scrollTop`. Subsequent `onSave`
  // calls fired while the card is inactive (deactivation-time
  // flush, debounced auto-save, `saveState` RPC) would otherwise
  // capture `scrollTop: 0` and overwrite the user's saved scroll
  // position. The snapshot is cleared on re-activation so the live
  // `view.scrollDOM.scrollTop` resumes as the source of truth while
  // the card is interactive. [L23] enforcement — an internal
  // teardown (display:none) must not destroy user-visible state.
  const inactiveDraftSnapshotRef = useRef<TugTextEditingState | null>(null);
  // Pending draft to re-apply when the card next activates. Set by
  // `onRestore` when the card mounts inactive (`isActive === false`):
  // the substrate's `restoreState` runs against the hidden card,
  // and its `view.scrollDOM.scrollTop` write is wiped by
  // `display: none`. The user's saved scroll therefore needs to be
  // RE-applied when the card transitions to active (the activation
  // moment is when `.cm-scroller` regains real `clientHeight` and
  // can honour the scroll write). Cleared on activation.
  const pendingActivationDraftRef = useRef<TugTextEditingState | null>(null);

  // Phase E.11 Step 4e — engine-hook registration channel.
  //
  // Register `paintMirrorAsActive` / `paintMirrorAsInactive` hooks
  // with the deck-manager-store so `applyBagFocus` can drive the
  // engine through the framework's single channel. The closures
  // read `textEditorRef.current` and `pendingActivationDraftRef`
  // live at fire time per [L07].
  //
  // The active hook consumes `pendingActivationDraftRef` — set by
  // `onRestore` during cold-boot for the inactive-mount case so
  // the engine's scroll-axes write lands against the live (post-
  // activation) viewport. For runtime cmd-tab return (no pending
  // draft), the hook calls `paintMirrorAsActive(undefined)` which
  // trusts the engine's live state.
  //
  // Registration runs in `useLayoutEffect` keyed on `[cardIdForTrace]`
  // so it's complete before any framework event that could invoke
  // the hook fires ([L03]). When no `cardIdForTrace` is present
  // (standalone use outside a `CardStatePreservationContext`), we
  // skip — the imperative-API surface (`textEditorRef.paintMirrorAsActive`)
  // still allows ad-hoc callers.
  //
  // At Step 4e, the engine hook is REGISTERED but the autonomous
  // `paintMirrorAsActive` claim in `useCardStatePreservation`'s
  // `onCardActivated` / `onRestore` is still in place (retired at
  // Step 4f). During the migration window both fire; both are
  // idempotent. Once 4f retires the autonomous claim, the hook is
  // the only path that calls `paintMirrorAsActive`.
  useLayoutEffect(() => {
    if (cardIdForTrace === null) return;
    const store = getDeckStore();
    if (store === null) return;
    const unregister = store.registerEngineHooks(cardIdForTrace, {
      paintMirrorAsActive: () => {
        const editor = textEditorRef.current;
        if (editor === null) return;
        const pending = pendingActivationDraftRef.current;
        pendingActivationDraftRef.current = null;
        deckTrace.record({
          kind: "engine-paint-mirror-active",
          cardId: cardIdForTrace,
          caller: "via-engine-hook",
        });
        editor.paintMirrorAsActive(pending ?? undefined);
      },
      paintMirrorAsInactive: () => {
        const editor = textEditorRef.current;
        if (editor === null) return;
        deckTrace.record({
          kind: "engine-paint-mirror-inactive",
          cardId: cardIdForTrace,
        });
        editor.paintMirrorAsInactive(publishToSelectionGuard);
      },
    });
    return unregister;
  }, [cardIdForTrace, publishToSelectionGuard]);

  // TugPane state preservation [L23]. TugPromptEntry is the sole
  // preserver for this compound — the embedded `TugTextEditor` is
  // explicitly opted out via `preserveState={false}` below so there's
  // no competing registration. Payload carries the active route + a
  // single draft snapshot.
  useCardStatePreservation<TugPromptEntryState>({
    onCardActivated: () => {
      // Phase E.11 Step 4f — autonomous focus claim retired.
      // The framework's single-channel `applyBagFocus` dispatcher
      // invokes the engine via the registered engine hook
      // (registered in the useLayoutEffect above) when
      // `bag.focus.kind === "engine"`. The engine hook consumes
      // `pendingActivationDraftRef` and calls
      // `paintMirrorAsActive(pending ?? undefined)` — the same
      // call this handler used to make autonomously. See
      // `tuglaws/state-preservation.md` [Focus dispatch model].
      //
      // This handler keeps only the deactivation-time draft
      // snapshot reset: the substrate's live `view.scrollDOM.scrollTop`
      // is the authoritative value again now that the card is
      // interactive.
      inactiveDraftSnapshotRef.current = null;
    },
    onCardWillDeactivate: () => {
      // [L23] enforcement: hand the substrate's selection over to
      // selectionGuard via `paintMirrorAsInactive(publish)` before
      // the new active card claims focus + global Selection. NO
      // focus claim.
      //
      // Snapshot the substrate's full editing state — the live scroll
      // axes are still authoritative here (the React commit that
      // applies `display: none` has not run yet — `transferFocusFor
      // Activation` saves and deactivates outgoing BEFORE the commit
      // mutation flush). Any subsequent `onSave` while the card is
      // inactive returns this snapshot's scroll values verbatim
      // instead of reading the wiped live scroller.
      const editor = textEditorRef.current;
      if (editor !== null) {
        inactiveDraftSnapshotRef.current = editor.captureState();
      }
      editor?.paintMirrorAsInactive(publishToSelectionGuard);
    },
    onSave: () => {
      const editor = textEditorRef.current;
      const liveDraft = editor !== null ? editor.captureState() : null;
      const snap = inactiveDraftSnapshotRef.current;
      // Card is inactive: prefer the snapshot's scroll axes (the
      // live scroller has been zeroed by display:none). Selection,
      // text, atoms come from the live capture — selection-guard's
      // paintMirrorAsInactive has already routed the user's range
      // into selectionGuard.cardRanges, so the engine's live state
      // is still the right source for those axes.
      let draft = liveDraft;
      if (draft !== null && snap !== null) {
        draft = {
          ...draft,
          scrollTop: snap.scrollTop,
          scrollLeft: snap.scrollLeft,
          scrollAnchor: snap.scrollAnchor ?? null,
        };
      }
      return {
        route: routeLifecycle.getRoute(),
        draft,
        maximized: maximizedRef.current ?? false,
      };
    },
    onRestore: (raw, { isActive }) => {
      const restored = coerceRestorePayload(raw);
      routeLifecycle.setRoute(restored.route);
      const editor = textEditorRef.current;
      if (editor !== null) {
        if (restored.draft !== null) {
          // restoreState updates the substrate's doc + atoms +
          // selection without touching DOM Selection or focus
          // (mirror-only restore). [L23].
          //
          // Phase E.11 Step 4f — for the `isActive` branch, the
          // autonomous `paintMirrorAsActive(restored.draft)` claim
          // is retired. The framework's `applyBagFocus` dispatcher
          // (CardHost cold-boot RESTORE for the active card)
          // invokes the registered engine hook (4e), which reads
          // `pendingActivationDraftRef` for the saved draft and
          // calls `paintMirrorAsActive`. Stash the draft for BOTH
          // active and inactive paths so the engine hook has a
          // uniform read source.
          editor.restoreState(restored.draft);
          pendingActivationDraftRef.current = restored.draft;
          if (!isActive) {
            // Inactive mount: also publish the saved selection
            // through the inactive-paint channel so selectionGuard
            // can render the dim selection band on the hidden
            // card. The pendingActivationDraftRef stashed above
            // covers the active-side re-apply when the card later
            // becomes active (engine hook reads it).
            editor.paintMirrorAsInactive(
              publishToSelectionGuard,
              restored.draft,
            );
          }
          // Diagnostic for the cold-boot selection-paint gap. Engine
          // string preserved from the legacy entry for
          // forward-compatible app-test matchers.
          if (cardIdForTraceRef.current !== null) {
            const view = editor.view();
            const domRange = readDomSelectionInside(view);
            deckTrace.record({
              kind: "engine-restore-applied",
              cardId: cardIdForTraceRef.current,
              engine: "gallery-prompt-entry",
              selectionApplied: restored.draft.selection ?? null,
              domSelectionAfter: domRange,
            });
          }
        } else {
          editor.clear();
        }
      }
      const root = rootRef.current;
      if (root !== null) {
        const view = editor?.view() ?? null;
        root.setAttribute("data-empty", String(isEffectivelyEmpty(view)));
      }
      // Re-emit the persisted maximize state so the parent's
      // controlled value matches the snapshot.
      onMaximizeChangeRef.current?.(restored.maximized ?? false);
    },
  });

  // Expose the imperative delegate. Pass-throughs to the substrate;
  // the entry does not own text state.
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        textEditorRef.current?.focus();
      },
      blur() {
        const view = textEditorRef.current?.view();
        view?.contentDOM.blur();
      },
      clear() {
        textEditorRef.current?.clear();
      },
      getEditorElement() {
        const view = textEditorRef.current?.view();
        return (view?.contentDOM as HTMLElement | undefined) ?? null;
      },
      regenerateAtoms() {
        const view = textEditorRef.current?.view();
        view?.dispatch({ effects: regenerateAtomsEffect.of(null) });
      },
    }),
    [],
  );

  // Compose rootRef + responderRef onto the same DOM element.
  const composedRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  // Render the status row only when there is something to put in it.
  // The maximize control no longer lives here — the host card renders
  // it in its own chrome — so `maximized` does not gate the row.
  const hasStatusRow =
    statusContent !== undefined || cautionContent !== undefined;

  return (
    <RouteLifecycleContext.Provider value={routeLifecycle}>
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
          data-empty="true"
          className={cn("tug-prompt-entry", className)}
        >
          {hasStatusRow && (
            <div className="tug-prompt-entry-status">
              <div className="tug-prompt-entry-status-content">
                {statusContent}
              </div>
              {cautionContent !== undefined && (
                <div
                  className="tug-prompt-entry-status-caution"
                  data-slot="tug-prompt-entry-status-caution"
                >
                  {cautionContent}
                </div>
              )}
            </div>
          )}
          <div className="tug-prompt-entry-input-area">
            <TugTextEditor
              ref={textEditorRef}
              borderless
              maximized
              placeholder={placeholderByRoute?.[route] ?? ""}
              completionProviders={completionProviders}
              dropHandler={dropHandler}
              historyProvider={currentHistoryProvider}
              returnAction={
                returnActionOverride ?? RETURN_ACTION_BY_ROUTE[route] ?? "submit"
              }
              lineWrap={lineWrap}
              lineNumbers={lineNumbers}
              highlightActiveLineGutter={highlightActiveLineGutter}
              onSubmit={performSubmit}
              extensions={editorExtensions}
              /* State preservation is owned by TugPromptEntry. Disable
                 the substrate's registration so only one component
                 claims the single CardStatePreservationContext slot. */
              preserveState={false}
            />
          </div>
          <div className="tug-prompt-entry-toolbar">
            {/* Z4A — route choice-group, fixed at the leading edge. */}
            <TugChoiceGroup
              items={[...ROUTE_ITEMS]}
              value={route}
              senderId={routeIndicatorSenderId}
              size="xs"
              aria-label="Command route"
            />
            {/*
              Z4B floats centred between Z4A and Z5 via two equal flex
              spacers — the free width splits evenly, so Z4B's centre
              lands at the midpoint of the Z4A–Z5 gap ([D05]).
            */}
            <div className="tug-prompt-entry-toolbar-spacer" aria-hidden="true" />
            <div
              className="tug-prompt-entry-indicators"
              data-slot="tug-prompt-entry-indicators"
            >
              {indicatorsContent}
            </div>
            <div className="tug-prompt-entry-toolbar-spacer" aria-hidden="true" />
            {/*
              Z5 `+` queue button — mounted alongside the primary Stop
              button while a turn runs (mode `stop`). CSS-gated on the
              entry root's `data-empty` attribute: hidden until the
              editor holds a draft, so a plain submit → wait → submit
              flow never surfaces it ([L06] / [L22] — no per-keystroke
              React state). Click queues the draft — the pointer twin of
              editor Return — via a direct `onClick` on `performSubmit`,
              never the SUBMIT action, so it does not route through the
              Stop branch of the SUBMIT handler.
            */}
            {submitView.dataMode === "stop" && (
              <TugPushButton
                className="tug-prompt-entry-queue-button"
                subtype="icon"
                size="lg"
                emphasis="filled"
                role="action"
                onClick={performSubmit}
                aria-label="Queue prompt"
                icon={<Plus size={16} strokeWidth={2.5} />}
              />
            )}
            {/*
              ONE button node across every mode ([L26]) — only
              `data-mode` / `disabled` / `aria-label` / the icon glyph
              change. `data-mode` drives the per-mode visual via CSS
              ([L06]); `submitView` is the pure projection of the
              lifecycle `submitButtonMode`.
            */}
            <TugPushButton
              className="tug-prompt-entry-submit-button"
              data-mode={submitView.dataMode}
              action={TUG_ACTIONS.SUBMIT}
              subtype="icon"
              size="lg"
              emphasis="filled"
              role={submitView.danger ? "danger" : "action"}
              disabled={submitView.disabled}
              aria-label={submitView.ariaLabel}
              icon={
                submitView.icon === "stop"
                  ? <Square size={14} strokeWidth={3} />
                  : <ArrowUp size={16} strokeWidth={2.5} />
              }
            />
          </div>
        </div>
      </ResponderScope>
    </RouteLifecycleContext.Provider>
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the live DOM Selection's range as a `{ start, end }` pair if
 * it falls inside `view.contentDOM`, otherwise `null`. Used by the
 * `engine-restore-applied` deck-trace event to compare what the
 * restore *intended* against what landed in the DOM.
 *
 * `selectionApplied` carries flat offsets; the DOM Selection echo
 * here is the substrate's own view of the post-restore selection
 * (which goes through the focus / global-Selection path on active
 * cards). Returning a flat-offset pair keeps the two values
 * comparable.
 */
function readDomSelectionInside(
  view: EditorView | null,
): { start: number; end: number } | null {
  if (view === null) return null;
  // CM6 keeps `view.state.selection` in sync with the DOM Selection
  // when the view is the focused element; reading from it is the
  // canonical way to expose "what the substrate now believes is
  // selected" without fighting the contentDOM's `Selection` object
  // directly.
  const main = view.state.selection.main;
  return { start: main.from, end: main.to };
}

// HistoryEntry import is exercised through the historyStore.push
// shape above; keep the import-side only by re-exporting the type
// here — TypeScript drops the import otherwise and the dev-build
// import-checker complains.
export type { HistoryEntry };
