/**
 * TugPromptEntry — Compound composition: TugTextEditor + route popup
 * + submit/stop button, driven by a CodeSessionStore snapshot.
 *
 * Composes TugTextEditor (CM6-backed editor + atom + completion +
 * drop), TugPopupMenu (the Z4A route popup), TugPushButton
 * (submit/stop). Each composed child keeps its own tokens [L20]; the
 * entry reuses existing base-tier global / field / badge tokens per
 * [D11].
 *
 * Route model — simplified per [D08]:
 *   - One active route at a time, owned by a per-prompt-entry
 *     `RouteLifecycle` ([D02]). Default is `❯` (Prompt).
 *   - The route popup is the canonical control: picking an item
 *     dispatches SELECT_VALUE → `routeLifecycle.setRoute`.
 *   - One-shot prefix detection: typing / pasting `>` `$` (or the
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
  useContext,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronUp,
  MessageSquareDashed,
  Plus,
  Search,
  Shell,
  Square,
} from "lucide-react";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { cn } from "@/lib/utils";
import type {
  AtomSegment,
  CompletionProvider,
  DropHandler,
  HistoryProvider,
  TugTextEditingState,
} from "@/lib/tug-text-types";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import type {
  CardSessionMode,
  CodeSessionPhase,
  CodeSessionStore,
} from "@/lib/code-session-store";
import { useLifecycleState } from "@/lib/code-session-store/hooks/use-lifecycle-state";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { PromptHistoryStore } from "@/lib/prompt-history-store";

import {
  TugTextEditor,
  type TugTextEditorDelegate,
} from "./tug-text-editor";
import type {
  ArgumentHintRefreshSource,
  ArgumentHintResolver,
} from "./tug-text-editor/argument-hint-extension";
import type { PastedCommandResolver } from "./tug-text-editor/clipboard-filters";
import {
  clearDropCaret,
  dropOffsetAtCoords,
  markEditorDropActive,
  paintDropCaret,
  processAttachmentFiles,
} from "./tug-text-editor/drop-extension";
import type { InlineCommandMatcher } from "@/lib/inline-command-ghost";
import {
  getAtomsInState,
  regenerateAtomsEffect,
  removeAtomById,
  replaceAtomsEffect,
  type PositionedAtom,
} from "./tug-text-editor/atom-decoration";
import { TugAttachmentPreview } from "./cards/tug-attachment-preview";
import { createRoutePrefixExtension } from "./tug-prompt-entry/route-prefix-extension";
import { TugButton } from "./internal/tug-button";
import { TugPopupMenu } from "./internal/tug-popup-menu";
import { TugPushButton } from "./tug-push-button";
import { resolveSubmitButtonView } from "./tug-prompt-entry-submit-button";
import type { DevSubmitButtonMode } from "@/lib/code-session-store/lifecycle-state";
import type { ShellSessionStore } from "@/lib/shell-session-store";
import { useResponder } from "./use-responder";
import { useFocusable } from "./use-focusable";
import type { ActionEvent } from "./responder-chain";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useResponderChain } from "./responder-chain-provider";
import {
  buildSlashCommandLine,
  type CommandLineAtom,
  matchLocalSlashCommand,
  slashCommandName,
} from "@/lib/slash-commands";
import {
  isHiddenSlashCommand,
  isUnknownRemoteCommand,
  resolveRemoteCommand,
  canonicalizeBareCommandLine,
} from "@/lib/slash-supported";
import { useCardStatePreservation, useCardId } from "./use-card-state-preservation";
import { useCardDirty } from "../chrome/tug-pane";
import { DeckManagerContext } from "@/deck-manager-context";
import { selectionGuard } from "./selection-guard";
import { deckTrace } from "@/deck-trace";
import { getDeckStore } from "@/lib/deck-store-registry";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";
import { tugDevLogStore } from "@/lib/tug-dev-log-store/tug-dev-log-store";
import type { HistoryEntry } from "@/lib/prompt-history-store";
import { RouteLifecycle, RouteLifecycleContext } from "@/lib/route-lifecycle";
import type { DevFindSession } from "@/lib/dev-find-session";

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/** One selectable route in the Z4A popup: its stored value character,
 * display name, and the lucide gutter glyph shown on the trigger and in
 * the menu. */
interface RouteItem {
  value: string;
  label: string;
  icon: React.ReactNode;
}

/**
 * The three routes surfaced in the route popup — the recipients a
 * submission targets: `❯` Code (Claude on the record), `$` Shell (the
 * machine), `?` btw (Claude off the record — a native side question).
 * Each entry is `[icon][gap][name]` — a lucide gutter glyph (matching
 * the participant iconography in `TugTranscriptEntry`) plus the route's
 * display name. The route prefix character (`>` / `$` / `?`) is not
 * painted in the label; it lives on as a hidden power-user feature,
 * since `route-prefix-extension` still flips the route when the user
 * types one of those characters at offset 0 of the editor. The visible
 * affordances are the trigger icon + name and the keyboard shortcuts
 * wired in `keybinding-map.ts` (⇧⌘C → Code, ⇧⌘S → Shell, ⇧⌘B → btw),
 * which dispatch `SELECT_ROUTE` to this entry's responder.
 */
const ROUTE_ITEMS: ReadonlyArray<RouteItem> = [
  { value: "❯", label: "Code",  icon: <Bot size={14} /> },
  { value: "$", label: "Shell", icon: <Shell size={14} /> },
  { value: "?", label: "btw",   icon: <MessageSquareDashed size={14} /> },
  { value: "⌕", label: "Find",  icon: <Search size={14} /> },
];

/**
 * The widest route label, used to width-stabilize the popup trigger so it
 * never changes size as the route flips. `TugButton`'s `widthStabilize`
 * overlays the active cluster with an alternate sized to this label, so the
 * trigger always reserves the widest route's footprint. Derived from
 * `ROUTE_ITEMS` (longest label wins) so it tracks the labels automatically.
 */
const WIDEST_ROUTE_LABEL = ROUTE_ITEMS.reduce(
  (widest, item) => (item.label.length > widest.length ? item.label : widest),
  "",
);

/**
 * Map of prefix character → route value.
 *
 * `>` is an ASCII alias for the Prompt route's display character `❯`.
 * The segment control shows the chevron, but the typed greater-than is
 * keyboard-friendly and routes to the same Prompt value. `$` flips to
 * Shell, `?` flips to btw. All act as the strip-on-match lookup at
 * submit time per [Q09]=a.
 */
const ROUTE_PREFIX_ALIAS: Readonly<Record<string, string>> = {
  "❯": "❯",
  ">": "❯",
  "$": "$",
  "?": "?",
};

/**
 * Return-key semantics per route.
 *
 * - `❯` (Prompt): Return inserts a newline; Shift+Return submits.
 *   Prompts are long-form, so naïve Return should stay a newline.
 * - `$` (Shell): Return submits; Shift+Return inserts a newline.
 *   Shell invocations are typically a single line.
 * - `?` (btw): Return submits; Shift+Return inserts a newline.
 *   Side questions are single-line asks.
 *
 * The substrate's shift inversion means we only need to declare the
 * unshifted action per route; Shift+Return is the opposite
 * automatically.
 */
const RETURN_ACTION_BY_ROUTE: Readonly<Record<string, "submit" | "newline">> = {
  "❯": "newline",
  "$": "submit",
  "?": "submit",
  // Find mirrors `❯`: the submit gesture advances the match, newline stays
  // available for multi-line queries. Membership also admits ⇧⌘F SELECT_ROUTE.
  "⌕": "newline",
};

/**
 * Default route at initial mount when no persisted state restores a
 * prior selection. Prompt (`❯`) is the sensible default: it's the
 * most common conversation surface.
 */
const DEFAULT_ROUTE = "❯";

/** Canonical route values — shared by the dispatch and the route popup. */
const ROUTE_SHELL = "$";
const ROUTE_BTW = "?";
const ROUTE_FIND = "⌕";

/** Stable no-op `useSyncExternalStore` subscribe for an absent shell store. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/**
 * Route-aware Z5 submit-button mode ([P13]). On the `❯` / `?` routes the Z5
 * button follows the Claude session lifecycle unchanged. On the `$` route it
 * is driven by the shell session: an exchange in flight → `stop` (fires
 * `kill`), otherwise `submit` (never inert — the empty-draft gating rides the
 * separate `data-empty` attribute). Pure — the button's DOM node and its
 * `resolveSubmitButtonView` projection are untouched; only the input mode is
 * route-conditional, so Z5 stays one node ([L26]).
 */
export function routeAwareSubmitButtonMode(
  route: string | null,
  claudeMode: DevSubmitButtonMode,
  shellInflight: boolean,
): DevSubmitButtonMode {
  // Find: Z5 is the always-live "next match" button — never stop, never inert
  // (an empty query just makes `next()` a no-op). The render swaps its glyph to
  // a down chevron; the click rides the SUBMIT action into `performSubmit`,
  // whose Find branch advances the match.
  if (route === ROUTE_FIND) return { kind: "submit", disabled: false };
  if (route !== ROUTE_SHELL) return claudeMode;
  return shellInflight ? { kind: "stop" } : { kind: "submit", disabled: false };
}

/**
 * Empty editing state — the draft a freshly-cleared editor holds.
 * Passed to `HistoryProvider.resetToDraft` after a submit so the
 * history cursor returns to the end of the list. Read-only; never
 * mutated, so a single shared instance is safe.
 */
const EMPTY_EDIT_STATE: TugTextEditingState = {
  text: "",
  atoms: [],
  selection: null,
};

/**
 * Separator joining `sessionId` + `route` into the in-memory
 * history-provider cache key. U+001F (ASCII Unit Separator) — a
 * control character that cannot occur in a session id, so the two
 * fields can never collide on a different split. An escape sequence,
 * never a raw byte, so the source file stays plain text.
 */
const HISTORY_KEY_SEP = "\u001f";

/**
 * Upper bound, in milliseconds, between two Escape presses for them to
 * count as a double-Escape gesture. Sized for a deliberate double-tap,
 * not a key-repeat stream.
 */
const ESCAPE_DOUBLE_PRESS_MS = 400;

/**
 * Lower bound, in milliseconds, between two Escape keydowns. Presses
 * spaced tighter than this are auto-repeat from a held key, not a human
 * double-tap, and are ignored so holding Escape never fires the
 * double-Escape gesture.
 */
const ESCAPE_REPEAT_FLOOR_MS = 60;

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
   * Snapshot of the per-card `AtomBytesStore` — base64 image bytes
   * for atoms currently in the draft. Round-trips through the
   * `useCardStatePreservation` bag so a card that is deactivated,
   * cmd-tab'd away, or cold-booted from disk restores its in-flight
   * image attachments with bytes intact (no need to re-drop the
   * file). Optional so older persisted snapshots restore with no
   * attachment bytes (the corresponding atoms become unsubmittable
   * skeletons rather than crashes).
   *
   * Per [D03](roadmap/dev-atoms.md#d03-atom-bytes-store) and
   * [L23](../../tuglaws/tuglaws.md#l23).
   */
  attachmentBytes?: Record<string, { content: string; mediaType: string }>;
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
  };
  if (raw === null || typeof raw !== "object") return fallback;
  const obj = raw as Partial<TugPromptEntryState> & LegacyTugPromptEntryState;
  const attachmentBytes = coerceAttachmentBytes(obj.attachmentBytes);

  // New shape — `route` + `draft` are both present.
  if (typeof obj.route === "string") {
    const draft = pruneOrphanedImageAtoms(
      isEditingState(obj.draft) ? obj.draft : null,
      attachmentBytes,
    );
    return { route: obj.route, draft, attachmentBytes };
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
    const draft = pruneOrphanedImageAtoms(
      isEditingState(candidate) ? candidate : null,
      attachmentBytes,
    );
    return { route: obj.currentRoute, draft, attachmentBytes };
  }

  return fallback;
}

/**
 * Drop image atoms whose bytes did not ride along in the same restore
 * payload, splicing out their `TUG_ATOM_CHAR` placeholders and shifting the
 * surviving atom positions + selection to match.
 *
 * Image-attachment bytes live only in the in-memory cache: HMR Fast Refresh
 * carries them, but `capDurableCardState` strips them from the durable bag
 * (`settings-api.ts`), so a reload or relaunch restores the draft with
 * `attachmentBytes` absent. Without this prune the editor would mount a
 * placeholder chip with no payload — a chip that ships no image on resubmit.
 * The user accepts losing attachments across a cold boot; what they keep is
 * their typed text and every self-contained atom (text/file/command/doc,
 * whose `value` IS the payload and so are never pruned here). [L23].
 *
 * Returns the draft unchanged when nothing is orphaned (the HMR path), and
 * `null` straight through. Exported-via-coerce; a self-consistent payload
 * where every surviving image atom has bytes is the postcondition.
 */
function pruneOrphanedImageAtoms(
  draft: TugTextEditingState | null,
  attachmentBytes:
    | Record<string, { content: string; mediaType: string }>
    | undefined,
): TugTextEditingState | null {
  if (draft === null) return null;
  const hasBytes = (id: string | undefined): boolean =>
    id !== undefined && attachmentBytes !== undefined && id in attachmentBytes;
  const dropPositions = draft.atoms
    .filter((a) => a.type === "image" && !hasBytes(a.id))
    .map((a) => a.position)
    .sort((x, y) => x - y);
  if (dropPositions.length === 0) return draft;

  const dropSet = new Set(dropPositions);
  let text = "";
  for (let i = 0; i < draft.text.length; i += 1) {
    if (!dropSet.has(i)) text += draft.text.charAt(i);
  }
  // Shift a surviving offset left by the count of dropped chars before it.
  const shift = (offset: number): number => {
    let n = 0;
    for (const p of dropPositions) {
      if (p < offset) n += 1;
      else break;
    }
    return offset - n;
  };
  const atoms = draft.atoms
    .filter((a) => !dropSet.has(a.position))
    .map((a) => ({ ...a, position: shift(a.position) }));
  const selection =
    draft.selection === null
      ? null
      : {
          start: shift(draft.selection.start),
          end: shift(draft.selection.end),
        };
  return { ...draft, text, atoms, selection };
}

/**
 * Defensive coercion for the persisted `attachmentBytes` map. Filters
 * out non-object payloads (corrupt persistence, schema drift) and
 * entries missing the required `content` / `mediaType` shape. Returns
 * `undefined` when the input contains zero valid entries — that
 * value round-trips through the snapshot pipeline cleanly and gates
 * `restore` from being called with an empty object.
 */
function coerceAttachmentBytes(
  value: unknown,
): Record<string, { content: string; mediaType: string }> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const out: Record<string, { content: string; mediaType: string }> = {};
  let any = false;
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as { content?: unknown; mediaType?: unknown };
    if (typeof e.content !== "string" || typeof e.mediaType !== "string") {
      continue;
    }
    out[id] = { content: e.content, mediaType: e.mediaType };
    any = true;
  }
  return any ? out : undefined;
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

/**
 * Build the side-question argument for a `?`-route ([P02]) submission from
 * the raw editor draft: expand atoms to their values (so an `@plan.md`
 * mention survives as its path — `buildSlashCommandLine`), strip a leading
 * `?` the power-user may have typed, and trim. An empty result means a bare
 * submit — the caller opens the overlay without asking. Pure; exported for
 * the unit tests.
 */
export function computeSideQuestionArg(
  draftText: string,
  draftAtoms: readonly CommandLineAtom[],
  aliasMap: Readonly<Record<string, string>> = ROUTE_PREFIX_ALIAS,
): string {
  const expanded = buildSlashCommandLine(draftText, draftAtoms);
  return computeSubmitText(expanded, ROUTE_BTW, aliasMap).trim();
}

/** Disposition of a submit that arrives while the store can't accept it. */
export type BlockedSubmitDisposition = "drop" | "defer";

/**
 * Classify a *blocked* submit — one that reached `performSubmit` with
 * `canSubmit === false` and `canInterrupt === false`.
 *
 * `performSubmit` only reaches this branch in two store states:
 *  - `replaying` — the JSONL bracket owns the card. For a `resume`-mode
 *    card there is real prior content the user is watching replay; a
 *    deferred send that committed *after* replay finished would surprise
 *    them with a dispatch they don't remember initiating, so drop it
 *    (mirrors the reducer's own `handleSend` guard). → `"drop"`.
 *    A `new`-mode card has no prior content: it still flashes through
 *    `replaying` because the spawn fires `request_replay` against an
 *    absent JSONL (`replay_started → replay_complete{jsonl_missing}`),
 *    and on a cold first launch tugcode's boot widens that window. A
 *    first Shift+Return that lands inside it is a valid submission with
 *    nothing to surprise — defer it like the settling case below. → `"defer"`.
 *  - `idle` / `errored` but the transport is not yet `online` — the
 *    brief settling window on a freshly-created or reconnecting card.
 *    The submission is valid; it just landed a beat early. → `"defer"`,
 *    so the entry can re-fire it the instant `canSubmit` flips true
 *    and Shift+Return (or the button) never silently no-ops.
 *
 * Pure: keyed only on the snapshot phase + session mode. Exported for the
 * unit tests.
 */
export function classifyBlockedSubmit(
  phase: CodeSessionPhase,
  sessionMode: CardSessionMode,
): BlockedSubmitDisposition {
  return phase === "replaying" && sessionMode === "resume" ? "drop" : "defer";
}

/**
 * Build a {@link TugTextEditingState} from a `(text, atoms)` pair
 * carried on `CodeSessionSnapshot.pendingDraftRestore`. The snapshot
 * shape stores atoms positionally-implicit: `text` contains
 * {@link TUG_ATOM_CHAR} (`U+FFFC`) at each atom's spot, and `atoms` is
 * the parallel sequence of segments in document order. The substrate's
 * `restoreState` consumes the positional shape — `{ position, type,
 * label, value, id? }` per atom — so we walk `text` for placeholder
 * indices and zip them with `atoms`.
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
      // Carry the bytes-store key so a restored image atom re-resolves
      // its bytes (thumbnail in the editor, payload on re-submit). The
      // bytes survive a queued-send cancel — only this linkage was lost.
      // Self-contained atoms have no `id`; the field stays undefined.
      id: segment.id,
    };
  });
  return {
    text,
    atoms: positionedAtoms,
    selection: null,
  };
}

/**
 * The document insertion a consumed shell share applies ([P08]) —
 * `insert` at offset `from` (end of the current doc).
 */
export interface ShellShareInsertion {
  from: number;
  insert: string;
}

/**
 * Apply a shell share gesture ([P08]): flip the route to the code
 * route (`❯`) — the shared text is Claude's to receive once the user
 * edits and sends — and compute the editor insertion. An effectively
 * empty editor takes the share text as-is; a mid-compose draft gets it
 * appended on its own line, never clobbered.
 *
 * Pure over `(routeLifecycle, doc facts)` and exported so the unit
 * tests pin the route flip + insertion without a live editor.
 */
export function applyShellShare(
  routeLifecycle: RouteLifecycle,
  shareText: string,
  doc: { length: number; isEffectivelyEmpty: boolean },
): ShellShareInsertion {
  routeLifecycle.setRoute(DEFAULT_ROUTE);
  const insert =
    doc.isEffectivelyEmpty || doc.length === 0 ? shareText : `\n${shareText}`;
  return { from: doc.length, insert };
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
  /**
   * Responder id that owns this entry's local slash commands — the
   * card's command-handling scope (typically `${cardId}-card-content`).
   * When a typed `/command` matches the local registry, the entry routes
   * `RUN_SLASH_COMMAND` here via `manager.sendToTarget` (by identity, so
   * it reaches the owning card regardless of where first responder sits —
   * the pane-modality contract [D15]). Omit for hosts with no local
   * commands (e.g. the gallery prompt entry); a matched command then
   * falls through to `send()` unchanged.
   */
  localCommandTargetId?: string;
  /** Store owning Claude Code turn state for this card. */
  codeSessionStore: CodeSessionStore;
  /**
   * `$`-route shell session store ([P12]/[P13]). Drives the shell-route submit
   * (`exec`), the route-aware Z5 (`stop` while an exchange is in flight →
   * `kill`), and the live cwd. Optional so hosts that never surface the shell
   * route (the gallery) can omit it.
   */
  shellSessionStore?: ShellSessionStore;
  /**
   * `⌕`-route Find session store. Holds the live query, options, match set,
   * and active index for transcript search. While the Find route is active the
   * editor doc is mirrored into `findSession.setQuery`; Return advances the
   * active match; leaving the route clears it. Optional so hosts without a
   * transcript (the gallery) can omit it.
   */
  findSession?: DevFindSession;
  /**
   * Host handler for an attachment that could not be accepted (drop or
   * paste of an unsupported / oversize / undecodable image, or a submit
   * attempted while an attachment is still processing). The message is
   * user-facing and names the file. Hosts surface it as a calm,
   * card-scoped notice — the Dev card raises a pane bulletin — never the
   * session-error banner. Omit for standalone hosts (the gallery); the
   * message is then routed to the dev log.
   */
  onAttachmentError?: (message: string) => void;
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
  /**
   * Resolver for the post-acceptance argument placeholder, forwarded to
   * `TugTextEditor` ({@link TugTextEditorProps.argumentHintResolver}). Maps an
   * accepted command atom's value to its placeholder, or `null` for no-arg
   * commands.
   */
  argumentHintResolver?: ArgumentHintResolver;
  /**
   * Refresh source for the argument placeholder, forwarded to `TugTextEditor`
   * ({@link TugTextEditorProps.argumentHintRefresh}). Lets a slot upgrade from
   * the generic hint to the explicit one when the catalog lands late.
   */
  argumentHintRefresh?: ArgumentHintRefreshSource;
  /**
   * Resolver recognizing a slash command at the start of pasted text, forwarded
   * to `TugTextEditor` ({@link TugTextEditorProps.pastedCommandResolver}).
   */
  pastedCommandResolver?: PastedCommandResolver;
  /**
   * Matcher for the mid-text inline ghost completion, forwarded to
   * `TugTextEditor` ({@link TugTextEditorProps.inlineCommandMatcher}). Maps a
   * mid-text `/query` to the full command name it completes to, or `null`.
   */
  inlineCommandMatcher?: InlineCommandMatcher;
  /** Drop handler for dragging files from Finder. Forwarded to TugTextEditor. */
  dropHandler?: DropHandler;
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
   * Fires when the user presses Escape while the editor is *empty*
   * (`doc.length === 0`). A host-effect hook: the entry owns no pane
   * geometry, so it just surfaces the gesture and lets the host decide
   * — the Dev card collapses the entry pane to its minimum height.
   *
   * Only fires on the idle path. When a turn is in flight the entry's
   * conditional `CANCEL_DIALOG` handler claims Escape upstream (Stop ≡
   * Esc) and the keystroke never reaches the editor's keymap, so a
   * minimize can never race an interrupt. A non-empty editor falls
   * through to the editor's own Escape semantics (e.g. autocomplete
   * dismiss). Omit to disable the gesture (the gallery harness does).
   */
  onEscapeWhenEmpty?: () => void;
  /**
   * Fires on a double-Escape (two presses within
   * `ESCAPE_DOUBLE_PRESS_MS`) while the editor is *empty*. The entry
   * owns no rewind surface, so it just surfaces the gesture and lets the
   * host open it — the Dev card raises the same sheet as `/rewind`.
   *
   * The single-press empty-Escape (`onEscapeWhenEmpty`) still fires on
   * the first press; this only adds the second-press action. Omit to
   * disable the gesture (the gallery harness does). Auto-repeat from a
   * held key never reaches here (see `ESCAPE_REPEAT_FLOOR_MS`).
   */
  onDoubleEscapeWhenEmpty?: () => void;
  /**
   * Optional content rendered in the status row above the input.
   */
  statusContent?: React.ReactNode;
  /**
   * Optional caution content rendered on the trailing edge of the
   * status row, between the leading `statusContent` and the tools
   * toggle. Intended for a small caution affordance (e.g. the Dev
   * card's aggregate drift-caution chip). The wrapper slot collapses
   * to nothing when the content renders empty, so a
   * conditionally-visible chip leaves no gap when it has nothing to
   * show.
   */
  cautionContent?: React.ReactNode;
  /**
   * `Z4B` — the indicator slot. Optional content rendered in the
   * toolbar between the route popup (`Z4A`) and the submit
   * button (`Z5`), floated to the centre of the gap between them by a
   * pair of equal flex spacers ([D05]). Content-sized; `undefined`
   * renders an empty slot, leaving `Z4A` and `Z5` at the row's edges.
   */
  indicatorsContent?: React.ReactNode;
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
   * Prompt route and submit on Shell). When omitted, the
   * per-route default applies.
   *
   * Numpad Enter is always "submit" inside `tug-prompt-entry` — the
   * underlying `TugTextEditor` keeps both options as a separate
   * prop, but the entry pins it to the typical Dev use case.
   */
  returnAction?: "submit" | "newline";
  /**
   * Numpad-Enter key action — the policy for the separate numpad Enter
   * key, independent of the main Return key. `"submit"` (Enter submits,
   * Shift+Enter inserts a newline) or `"newline"` (the inverse).
   * Forwarded to `TugTextEditor`'s `numpadEnterAction`; when omitted the
   * editor's default (`"submit"`) applies.
   */
  numpadEnterAction?: "submit" | "newline";
  /**
   * Per-route placeholder text for the embedded editor, keyed by the
   * route value (`❯` Code / `$` Shell — see
   * `ROUTE_ITEMS`). The entry looks up the active route and forwards
   * the match to `TugTextEditor`; routes absent from the map — or an
   * undefined prop entirely — render no placeholder. The dev-card
   * supplies route-specific copy; the gallery prompt-entry omits it.
   */
  placeholderByRoute?: Readonly<Record<string, string>>;
  /**
   * Genuinely deactivate the entry's editor — the editor goes read-only
   * (`EditorState.readOnly`) and is blurred so the caret stops blinking.
   * Used while an inline Permission/Question dialog is visible: the
   * dialog is modal for keys ([P06]), so the prompt must visibly stand
   * down rather than appear to still accept input. This is *real*
   * deactivation driven off the host's pending-dialog state, not a
   * cosmetic caret hack ([L06] appearance follows real state). The entry
   * reactivates (and the host re-focuses it) when the flag clears.
   */
  deactivated?: boolean;
  /**
   * Disable the ENTIRE entry — the root subtree goes `inert` (no
   * mouse, no keyboard, no focus for the editor, route toggle, chips,
   * and submit alike) and dims via `data-disabled`. Implies the
   * {@link deactivated} editor stand-down. Used while a session
   * restore replays history: nothing in the entry can act on a
   * session that does not exist yet. Distinct from `deactivated`,
   * which must leave the chips keyboard-reachable for the cycling
   * mode's walk.
   * @selector [data-slot="tug-prompt-entry"][data-disabled]
   */
  disabled?: boolean;
  /**
   * Authors the `Z5` submit button into a focus group ([P02]) — the
   * existing `TugPushButton.focusGroup` opt-in, surfaced on the entry so
   * the host that owns the Tab order can register the submit as a walk
   * stop without the entry knowing why. Omitted by default: the submit is
   * a plain native focus stop (the editor owns Tab) and never joins a walk.
   *
   * The Dev card supplies this (under its keyboard-focus-cycling
   * `CycleScope`, so the registration lands in that mode, not the base
   * one) to make the submit the cycle's commit-home; the gallery and
   * card-host hosts omit it, so their submit behaves exactly as before.
   */
  submitFocusGroup?: string;
  /** Order of the submit within {@link submitFocusGroup}. Defaults to 0. */
  submitFocusOrder?: number;
  /**
   * Authors the `Z4A` route popup trigger into a focus group ([P02]) —
   * forwarded to the trigger `TugButton`'s `focusGroup`, surfaced on the
   * entry like {@link submitFocusGroup}. The trigger is one Tab stop;
   * activating it opens the route menu. Omitted by default (the route is
   * not a walk stop). Supplied by the Dev card under its `CycleScope` so
   * the route joins the cycle as the stop after the commit-home.
   */
  routeFocusGroup?: string;
  /** Order of the route within {@link routeFocusGroup}. Defaults to 0. */
  routeFocusOrder?: number;
  /**
   * Authors the **editor input area** itself into a focus group ([P02]) as a
   * **text stop** — the last stop of the dev card's keyboard-focus cycle
   * ([P10]/[P11]). When set, the input-area wrapper registers a focusable: the
   * cycle can land the ring on it (the editor stays blurred via `deactivated`),
   * and Return "descends" into the editor — `onResumeTyping` fires to drop the
   * user back into typing (the host exits cycling). Omitted by non-cycling
   * hosts. The editor is a responder (caret), so this is the *only* way it joins
   * the walk; it never becomes a plain Tab stop.
   */
  editorFocusGroup?: string;
  /** Order of the editor text-stop within {@link editorFocusGroup}. */
  editorFocusOrder?: number;
  /**
   * Fired when the cycle's Return-into-text gesture lands on the editor stop
   * ([P11]): the host should exit cycling so the editor reactivates and the
   * caret returns. Paired with {@link editorFocusGroup}.
   */
  onResumeTyping?: () => void;
  /**
   * Authors the `Z4C` compose-phase attachment tiles into a focus group
   * ([P02]) — forwarded to `TugAttachmentPreview` so each image-attachment
   * tile registers as a leaf cycle stop (Return / Space opens its preview
   * sheet). Supplied by the Dev card under its `CycleScope`; omitted by
   * non-cycling hosts, where the tiles stay plain native focus stops.
   */
  attachmentFocusGroup?: string;
  /**
   * Order of the FIRST attachment tile within {@link attachmentFocusGroup};
   * the tiles take consecutive orders left→right in document order. Defaults
   * to 0.
   */
  attachmentFocusOrderBase?: number;
  /**
   * Fired whenever the number of compose-phase image attachments changes,
   * surfacing the live tile count to the host. The Dev card uses it to size
   * the attachment row of its keyboard-cycle spatial grid to exactly the
   * registered tiles. Omit when the host does not author the tiles into a
   * cycle.
   */
  onAttachmentCountChange?: (count: number) => void;
}

/**
 * Imperative handle exposed via `forwardRef`. Used by the Dev card
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
   * The underlying editor element (CM6's `cm-content` div). Exposed for
   * callers that need to reach the live editor DOM (measurement, focus
   * diagnostics, harness assertions).
   */
  getEditorElement(): HTMLElement | null;
  /**
   * Regenerate atom widgets — needed when the editor font or theme
   * tokens change so the baked atom chips pick up the new
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
    localCommandTargetId,
    codeSessionStore,
    shellSessionStore,
    findSession,
    onAttachmentError,
    sessionMetadataStore,
    historyStore,
    completionProviders,
    argumentHintResolver,
    argumentHintRefresh,
    pastedCommandResolver,
    inlineCommandMatcher,
    dropHandler,
    onBeforeSubmit,
    onAfterSubmit,
    onEscapeWhenEmpty,
    onDoubleEscapeWhenEmpty,
    statusContent,
    cautionContent,
    indicatorsContent,
    className,
    lineWrap,
    lineNumbers,
    highlightActiveLineGutter,
    returnAction: returnActionOverride,
    numpadEnterAction,
    placeholderByRoute,
    deactivated: deactivatedProp = false,
    disabled = false,
    submitFocusGroup,
    submitFocusOrder,
    routeFocusGroup,
    routeFocusOrder,
    editorFocusGroup,
    editorFocusOrder,
    onResumeTyping,
    attachmentFocusGroup,
    attachmentFocusOrderBase,
    onAttachmentCountChange,
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

  // Deactivation: when a modal inline dialog takes over the keyboard
  // ([P06]), the editor goes read-only (`disabled` above) *and* blurs so
  // the caret stops blinking — the prompt visibly stands down. The host
  // re-focuses the entry when `deactivated` clears (its single focus
  // destination), so no re-focus is needed here. [L06] real state, not a
  // caret paint-over.
  // `disabled` (whole-entry inert) implies the editor stand-down.
  const deactivated = deactivatedProp || disabled;
  useLayoutEffect(() => {
    if (deactivated) textEditorRef.current?.blur();
  }, [deactivated]);

  // Editor-as-text-stop ([P10]/[P11]). When a host authors the editor into a
  // cycle (`editorFocusGroup`), the input-area wrapper registers a focusable so
  // the cycle can land the ring on it (the editor itself stays blurred via
  // `deactivated`). Its key-view `behavior` declares the input descendable: a
  // Return resolves to `descend` (intercepted, so the scope's default button
  // never fires) and fires `onResumeTyping`, dropping the user back into the
  // editor. Read through a ref ([L07]) so the behavior closure (captured by the
  // engine at registration) never goes stale. The wrapper takes `tabIndex={-1}`
  // so the engine can land DOM focus on it without putting it in the native Tab
  // order; the real caret is the editor inside.
  const onResumeTypingRef = useRef(onResumeTyping);
  useLayoutEffect(() => {
    onResumeTypingRef.current = onResumeTyping;
  }, [onResumeTyping]);
  const editorStopId = useId();
  const { focusableRef: editorStopRef } = useFocusable({
    id: editorStopId,
    group: editorFocusGroup ?? "",
    order: editorFocusOrder ?? 0,
    register: editorFocusGroup !== undefined,
    behavior: () => ({
      container: "none",
      currentItemDescendable: true,
      onDescend: () => onResumeTypingRef.current?.(),
    }),
  });

  // Inline-attachment wiring. The per-card bytes-store and the
  // attachment-error publisher come from `codeSessionStore`; both are
  // stable across renders for a given store instance, so memoizing on
  // `[codeSessionStore]` is sufficient. The store handle and bound
  // callback flow through to `TugTextEditor` so the drop / paste
  // extensions can populate the side-table at insert time and surface
  // downsample-rejection messages via the existing banner channel.
  // Per [D03](roadmap/dev-atoms.md#d03-atom-bytes-store) and
  // [Table T01](roadmap/dev-atoms.md#t01-failure-modes).
  const attachmentBytesStore = useMemo(
    () => codeSessionStore.getAtomBytesStore(),
    [codeSessionStore],
  );
  // Attachment rejection is transient input validation, not a session
  // fault: it must never write `lastError` (that lights the entry's red
  // errored ring and routes the session-lost banner). Hand the message to
  // the host, which surfaces a calm card-scoped notice (the Dev card
  // raises a pane bulletin). Standalone hosts that omit the handler get a
  // dev-log line so the message is never silently swallowed.
  const publishAttachmentError = useCallback(
    (message: string): void => {
      if (onAttachmentError !== undefined) {
        onAttachmentError(message);
      } else {
        tugDevLogStore.warn("prompt-entry", message);
      }
    },
    [onAttachmentError],
  );

  // Z4C — the compose-phase attachment-preview zone. The image atoms in
  // the editor are external state (CodeMirror's atom field); they enter
  // React here so the preview strip below the editor reflects every
  // drop / paste / delete. The `editorExtensions` updateListener
  // recomputes this on any doc change ([L02] — the bridge from CM state
  // into React is the listener; the strip itself is a pure projection).
  const [composeImageAtoms, setComposeImageAtoms] = useState<
    ReadonlyArray<AtomSegment>
  >([]);
  // Structural key of the current image-atom list (ids + labels) so the
  // listener only re-renders the strip when the set actually changes,
  // not on every keystroke. Held in a ref because the listener closes
  // over it once (the extension array is built with empty deps).
  const composeAtomsKeyRef = useRef("");
  const syncComposeImageAtoms = useCallback(
    (atoms: ReadonlyArray<AtomSegment>): void => {
      // The strip is always contiguous: derive `image-N` from the image's
      // position in document order, independent of the atom's stored label.
      // So the Z4C strip reads correct the instant an attachment is added
      // or removed, even before the editor's inline chips are relabeled by
      // the renumber pass below.
      const images = atoms
        .filter((a) => a.type === "image")
        .map((a, i) => {
          const name = `image-${i + 1}`;
          return a.label === name && a.value === name
            ? a
            : { ...a, label: name, value: name };
        });
      let key = "";
      for (const a of images) key += `${a.id ?? ""}|${a.label}|`;
      if (key === composeAtomsKeyRef.current) return;
      composeAtomsKeyRef.current = key;
      setComposeImageAtoms(images);
    },
    [],
  );
  // Surface the live attachment-tile count to the host ([L07] via ref so a
  // fresh inline callback never re-fires the effect). The Dev card sizes its
  // keyboard-cycle spatial-grid attachment row from this, so the count must
  // track every drop / paste / delete — the same `composeImageAtoms` set the
  // Z4C strip renders.
  const onAttachmentCountChangeRef = useRef(onAttachmentCountChange);
  useLayoutEffect(() => {
    onAttachmentCountChangeRef.current = onAttachmentCountChange;
  }, [onAttachmentCountChange]);
  useLayoutEffect(() => {
    onAttachmentCountChangeRef.current?.(composeImageAtoms.length);
  }, [composeImageAtoms.length]);
  // Keep the editor's inline image chips numbered `image-1..N` in document
  // order. The Z4C strip derives its own contiguous numbering, but the
  // inline chips store their label in the atom field, so a delete or a
  // mid-insert can leave them stale; this corrects them in one follow-up
  // transaction. Idempotent — re-reads fresh state and dispatches only
  // when a label is actually wrong, so it never loops.
  const renumberImageChips = useCallback((view: EditorView): void => {
    if (!view.dom.isConnected) return;
    const positioned = getAtomsInState(view.state);
    let n = 0;
    let changed = false;
    const corrected: PositionedAtom[] = positioned.map((p) => {
      if (p.segment.type !== "image") return p;
      n += 1;
      const name = `image-${n}`;
      if (p.segment.label === name && p.segment.value === name) return p;
      changed = true;
      return {
        position: p.position,
        segment: { ...p.segment, label: name, value: name },
      };
    });
    if (changed) view.dispatch({ effects: replaceAtomsEffect.of(corrected) });
  }, []);
  // Remove a draft attachment by atom id: drop its atom from the editor
  // doc (the updateListener then refreshes the strip) and free its
  // bytes-store entry. The bytes `delete` is the store's documented
  // pre-submit cleanup path. This is the responder side of [L11] — the
  // prompt-entry owns the editor document and bytes store, so it handles
  // the `REMOVE_ATTACHMENT` action the preview's controls dispatch.
  const handleRemoveAttachmentById = useCallback(
    (atomId: string): void => {
      const view = textEditorRef.current?.view();
      if (view !== null && view !== undefined) {
        removeAtomById(view, atomId);
      }
      attachmentBytesStore.delete(atomId);
    },
    [attachmentBytesStore],
  );

  // The WHOLE prompt entry is ONE continuous drop surface. The editor
  // substrate claims drags over its own host (`drop-extension.ts` attaches
  // host-level listeners, so the blank band below short content accepts
  // too); these entry-level handlers catch everything else — the
  // attachment strip, the toolbar, the status row, the gaps — and route
  // the drop through the same editor pipeline, mirroring the image-paste
  // path. Events the substrate already claimed arrive here with
  // `defaultPrevented` set and are left alone, so the two layers compose
  // without double handling. The visual cues are the editor's own: the
  // drop ring on the editor host (`markEditorDropActive`) plus the drop
  // caret at the resolved position — the coordinate clamps to the nearest
  // document position, so a drop over the toolbar lands at the bottom
  // row. All DOM writes, no React state ([L06]).
  const handleEntryDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (event.defaultPrevented) return;
      if (!event.dataTransfer.types.includes("Files")) return;
      const view = textEditorRef.current?.view();
      if (view === null || view === undefined) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      markEditorDropActive(view, true);
      paintDropCaret(view, event.clientX, event.clientY);
    },
    [],
  );
  const clearEntryDropState = useCallback((): void => {
    const view = textEditorRef.current?.view();
    if (view === null || view === undefined) return;
    markEditorDropActive(view, false);
    clearDropCaret(view);
  }, []);
  const handleEntryDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      // Ignore leave events that merely cross into a descendant — only
      // clear when the pointer truly exits the entry. A native
      // Escape-cancel fires dragleave with a null relatedTarget, so this
      // also tears down the caret on cancel.
      const next = event.relatedTarget as Node | null;
      if (next !== null && event.currentTarget.contains(next)) return;
      clearEntryDropState();
    },
    [clearEntryDropState],
  );
  const handleEntryDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (event.defaultPrevented) return;
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      const view = textEditorRef.current?.view();
      if (view === null || view === undefined) return;
      event.preventDefault();
      // Resolve the drop against the editor's measured layout, same as a
      // drop on the editor itself. The chrome sits outside the document,
      // so the coordinate clamps to the nearest position — the bottom row
      // — letting the user target it instead of dumping at a stale caret.
      const pos =
        dropOffsetAtCoords(view, event.clientX, event.clientY) ??
        view.state.doc.length;
      clearEntryDropState();
      void processAttachmentFiles(
        view,
        files,
        pos,
        attachmentBytesStore,
        publishAttachmentError,
      );
    },
    [attachmentBytesStore, publishAttachmentError, clearEntryDropState],
  );

  // Z5 submit-button state machine. The button's whole view — label,
  // icon, `disabled`, `data-mode` — is a pure function of the
  // lifecycle-derived `submitButtonMode` (six kinds: submit / stop /
  // awaiting-user / stopping / reconnecting / restoring). Reading it
  // through `useLifecycleState` keeps the matrix the single source of
  // truth ([L02]); `resolveSubmitButtonView` is the pure projection.
  // The mode is mirrored to a ref so `performSubmit` — the shared
  // keyboard + pointer submit path — can gate on it without going
  // stale ([L07]).
  // Claude-lifecycle mode + shell in-flight; combined into the route-aware Z5
  // mode below, once the subscribed `route` is available ([P13]).
  const claudeSubmitButtonMode =
    useLifecycleState(codeSessionStore).submitButtonMode;
  const shellInflight = useSyncExternalStore(
    shellSessionStore?.subscribe ?? NOOP_SUBSCRIBE,
    () => shellSessionStore?.getSnapshot().inflight != null,
  );

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

  // Stable sender id for the route control. Derived from `id` so
  // parent cards can predict it for integration tests.
  const routeIndicatorSenderId = `${id}-route-indicator`;

  // [D02] The route is owned by a per-prompt-entry RouteLifecycle, not
  // React state. The instance is constructed once and stays stable for
  // the component's lifetime ([D01]) — a `useRef` lazy-init is the
  // canonical stable-instance pattern. Every route trigger (the popup
  // pick, the route-prefix extension, the SELECT_ROUTE keybinding,
  // and restore) funnels through `routeLifecycle.setRoute`.
  const routeLifecycleRef = useRef<RouteLifecycle | null>(null);
  if (routeLifecycleRef.current === null) {
    routeLifecycleRef.current = new RouteLifecycle(DEFAULT_ROUTE);
  }
  const routeLifecycle = routeLifecycleRef.current;

  // Shell share ([P08]). A Share click on an exchange row parks its
  // composed text on the shell store; this effect observes the slot,
  // flips the route to `❯`, seeds/appends the editor, and consumes.
  // Mirrors the draft-restore effect above: [L02] the slot enters via
  // useSyncExternalStore; [L03] useLayoutEffect so the doc change and
  // route flip land in the same paint; the slot survives until an
  // editor exists to take it (no consume on a missing view), so a
  // share is never silently dropped. Unlike draft restore, a
  // mid-compose draft is appended to, not skipped — the user asked
  // for this content explicitly.
  const pendingShellShare = useSyncExternalStore(
    shellSessionStore?.subscribe ?? NOOP_SUBSCRIBE,
    () => shellSessionStore?.getSnapshot().pendingShare ?? null,
  );
  useLayoutEffect(() => {
    if (pendingShellShare === null || shellSessionStore === undefined) return;
    const editor = textEditorRef.current;
    const view = editor?.view() ?? null;
    if (editor === null || view === null) return;
    const { from, insert } = applyShellShare(
      routeLifecycle,
      pendingShellShare.text,
      {
        length: view.state.doc.length,
        isEffectivelyEmpty: isEffectivelyEmpty(view),
      },
    );
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
    });
    shellSessionStore.consumePendingShare();
    editor.focus();
  }, [pendingShellShare, shellSessionStore, routeLifecycle]);

  // [L02] The route is external state once the Z4B indicator reads it,
  // so it enters React through `useSyncExternalStore` only. Submit and
  // extension closures read the live value via `routeLifecycle.getRoute()`
  // off the stable instance — no mirror ref, no stale capture ([L07]).
  const route = useSyncExternalStore(
    routeLifecycle.subscribe,
    routeLifecycle.getRoute,
  );

  // The route the Z4A popup trigger paints (icon + name). Falls back to
  // the first route if the stored value is somehow unknown.
  const currentRouteItem =
    ROUTE_ITEMS.find((item) => item.value === route) ?? ROUTE_ITEMS[0];

  // Route-aware Z5 submit-button mode ([P13]): Claude lifecycle on `❯`/`?`, a
  // shell-derived `submit`/`stop` on `$`. `resolveSubmitButtonView` (the pure
  // projection) and the button DOM node are unchanged — only the input mode
  // is route-conditional ([L26]).
  const submitButtonMode = routeAwareSubmitButtonMode(
    route,
    claudeSubmitButtonMode,
    shellInflight === true,
  );
  const submitView = resolveSubmitButtonView(submitButtonMode);
  const submitButtonModeRef = useRef(submitButtonMode);
  useLayoutEffect(() => {
    submitButtonModeRef.current = submitButtonMode;
  }, [submitButtonMode]);

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

  // Re-seed the per-card bytes store from durable history thumbnails so a
  // recalled prompt shows its image previews even after a cold launch —
  // the full bytes are ephemeral and per-card, but the baked thumbnail
  // rode the history entry into tugbank. This is structure-zone store→store
  // wiring ([L24]): observe the history store's own subscription directly
  // and mutate the bytes store in the callback ([L22]) — not a
  // `useSyncExternalStore` → `useEffect` round-trip. The effect re-subscribes
  // on a session change, so the callback never reads a stale id ([L07]).
  // Gaps only: a live id whose full bytes are still present is never
  // clobbered. An image atom with no stored thumbnail gets an empty marker
  // so it recalls as a broken-image tile rather than inert text.
  useLayoutEffect(() => {
    const sessionId = snap.tugSessionId;
    if (sessionId.length === 0) return;
    const reseed = (): void => {
      for (const entry of historyStore.getSessionEntries(sessionId)) {
        for (const atom of entry.atoms) {
          if (atom.type !== "image" || atom.id === undefined) continue;
          if (attachmentBytesStore.get(atom.id) !== null) continue;
          attachmentBytesStore.put(atom.id, {
            content: "",
            mediaType: "",
            thumbnailDataUrl: atom.thumbnailDataUrl,
          });
        }
      }
    };
    reseed();
    return historyStore.subscribe(reseed);
  }, [historyStore, attachmentBytesStore, snap.tugSessionId]);

  // Live ref to the active route's history provider so `performSubmit`
  // can reset its cursor without taking `currentHistoryProvider` as a
  // dep (which would churn `performSubmit`'s identity on every route
  // switch). [L07]
  const currentHistoryProviderRef = useRef(currentHistoryProvider);
  useLayoutEffect(() => {
    currentHistoryProviderRef.current = currentHistoryProvider;
  }, [currentHistoryProvider]);

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
  // Live ref for the empty-Escape gesture. The editor keymap below is
  // captured at mount (empty-deps memo), so it must read the current
  // callback through a ref rather than closing over the prop. [L07]
  const onEscapeWhenEmptyRef = useRef(onEscapeWhenEmpty);
  useLayoutEffect(() => {
    onEscapeWhenEmptyRef.current = onEscapeWhenEmpty;
  }, [onEscapeWhenEmpty]);
  const onDoubleEscapeWhenEmptyRef = useRef(onDoubleEscapeWhenEmpty);
  useLayoutEffect(() => {
    onDoubleEscapeWhenEmptyRef.current = onDoubleEscapeWhenEmpty;
  }, [onDoubleEscapeWhenEmpty]);
  // Timestamp (performance.now) of the previous Escape keydown, used by
  // the editor keymap to recognise a double-Escape and reject auto-repeat.
  const lastEscapePressAtRef = useRef(0);
  // Forces the just-cleared draft durable the moment a double-Escape
  // empties the editor. Held in a ref because the mount-time keymap memo
  // is captured before `persistClearedDraft` is defined [L07].
  const persistClearedDraftRef = useRef<() => void>(() => {});

  // Card id for diagnostic deck-trace events. Held in a ref so the
  // onRestore closure (registered through useCardStatePreservation)
  // reads the current value at fire time per [L07].
  const cardIdForTrace = useCardId();
  const cardIdForTraceRef = useRef(cardIdForTrace);
  cardIdForTraceRef.current = cardIdForTrace;

  // Dirty-pipeline participation. `useCardDirtyState` only marks the card
  // dirty on host-level `scroll` / `selectionchange`; the editor must mark
  // itself on every doc change so a typed character, a dropped/pasted atom,
  // or an undo schedules the debounced durable save — rather than relying
  // on an incidental selection event to do it. Stable callback (no-op
  // outside a `CardHost`, e.g. the gallery); held in a ref so the mount-time
  // editor extension reads the live value at fire time [L07].
  const markDirty = useCardDirty();
  const markDirtyRef = useRef(markDirty);
  markDirtyRef.current = markDirty;

  // Deck store + card id, read at submit time to force the cleared draft
  // durable the instant a turn is sent (see `performSubmit`). Held through
  // refs so the `performSubmit` closure never goes stale [L07]. Both are
  // absent in the gallery / unit-test mounts, where submit just skips the
  // forced flush.
  const deckStore = useContext(DeckManagerContext);
  const deckStoreRef = useRef(deckStore);
  deckStoreRef.current = deckStore;

  // Find session, held in a ref so the mount-time editor extension (which
  // mirrors the query on every doc change while in the Find route) reads the
  // live value at fire time [L07]. Absent in hosts without a transcript.
  const findSessionRef = useRef(findSession);
  findSessionRef.current = findSession;

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
        // Every doc change is a draft edit — schedule the debounced durable
        // save. This is the editor's entry into the dirty pipeline; without
        // it the draft is only persisted when an incidental scroll /
        // selectionchange happens to fire (e.g. a programmatic atom insert
        // that doesn't move the global selection would otherwise not save).
        markDirtyRef.current();
        const root = rootRef.current;
        if (root !== null) {
          root.setAttribute(
            "data-empty",
            String(update.state.doc.length === 0),
          );
        }
        // Z4C bridge: refresh the compose-phase attachment strip from the
        // editor's live atom set. Cheap structural-key gate inside.
        const positioned = getAtomsInState(update.state);
        syncComposeImageAtoms(positioned.map((p) => p.segment));
        // Renumber inline image chips if a delete / mid-insert left them
        // out of document order. Cheap synchronous check; the correcting
        // dispatch is deferred to a microtask so it doesn't re-enter the
        // in-flight update.
        let ord = 0;
        let mismatch = false;
        for (const p of positioned) {
          if (p.segment.type !== "image") continue;
          ord += 1;
          if (p.segment.label !== `image-${ord}`) {
            mismatch = true;
            break;
          }
        }
        if (mismatch) {
          const view = update.view;
          queueMicrotask(() => renumberImageChips(view));
        }
      }),
      // Find-query mirror: while the Find route is active, every doc edit feeds
      // the editor text into the Find session as the live query. A direct store
      // write, not React state — search-on-type never re-renders the entry per
      // keystroke ([L02] store surface / [L22]). Gated on the route so the other
      // routes' drafts are never treated as queries.
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const session = findSessionRef.current;
        if (session === undefined) return;
        if (routeLifecycle.getRoute() !== ROUTE_FIND) return;
        session.setQuery(update.state.doc.toString());
      }),
      // Empty-Escape gesture. On an empty editor, Escape surfaces
      // `onEscapeWhenEmpty` so the host can collapse the entry pane.
      // Gated on `doc.length === 0`: a non-empty editor returns `false`
      // so Escape falls through to the editor's own handlers
      // (autocomplete dismiss, etc.). Host-supplied extensions sit
      // below the substrate's keymap precedence, so by the time Escape
      // reaches here the typeahead / completion layers have already
      // had their turn — and none of those can be open on an empty
      // doc, which is why the empty gate is sufficient.
      keymap.of([
        {
          key: "Escape",
          run: (view) => {
            const now = performance.now();
            const sinceLast = now - lastEscapePressAtRef.current;
            lastEscapePressAtRef.current = now;

            // Reject auto-repeat from a held key: presses tighter than the
            // floor are the OS key-repeat stream, never a human double-tap.
            // Fall through inertly — the first (non-repeat) press already
            // ran its single-press action, and nothing else owns Escape on
            // the now-settled doc.
            if (sinceLast < ESCAPE_REPEAT_FLOOR_MS) return false;

            const isEmpty = view.state.doc.length === 0;
            const isDoublePress = sinceLast <= ESCAPE_DOUBLE_PRESS_MS;

            if (isDoublePress) {
              // Reset so a third press can't pair with this second one.
              lastEscapePressAtRef.current = 0;
              if (!isEmpty) {
                // Double-Escape on a non-empty editor clears the draft.
                // The clear is a normal transaction (undoable via Cmd+Z),
                // and the emptied draft is forced durable at once so a
                // relaunch can't restore the just-cleared text.
                textEditorRef.current?.clear();
                persistClearedDraftRef.current();
                return true;
              }
              // Double-Escape on an empty editor surfaces the rewind
              // gesture (the Dev card raises the same sheet as `/rewind`).
              const onDoubleEscape = onDoubleEscapeWhenEmptyRef.current;
              if (onDoubleEscape === undefined) return false;
              onDoubleEscape();
              return true;
            }

            // Single press. On an empty editor, surface `onEscapeWhenEmpty`
            // so the host can collapse the entry pane. A non-empty editor
            // returns `false` so Escape falls through to the editor's own
            // handlers (autocomplete dismiss, etc.) — none of which can be
            // open on an empty doc, which is why the empty gate is enough.
            if (!isEmpty) return false;
            const onEscape = onEscapeWhenEmptyRef.current;
            if (onEscape === undefined) return false;
            onEscape();
            return true;
          },
        },
      ]),
      // Lowest-precedence Escape catch-all. The handlers above return
      // `false` on the paths that should fall through (a single non-empty
      // Escape lets the completion layer dismiss; an auto-repeat tick is
      // ignored). When nothing downstream claims Escape either, the
      // keystroke would reach the OS unhandled and WebKit sounds the
      // system beep. Swallowing it here — after the completion keymap has
      // had its turn — keeps Escape silent without stealing the
      // completion-dismiss gesture.
      Prec.lowest(keymap.of([{ key: "Escape", run: () => true }])),
    ],
    [],
  );

  // A submit that landed during the transport-settling window is
  // armed here and flushed by the effect below the moment `canSubmit`
  // flips true. See `classifyBlockedSubmit` + `performSubmit`'s
  // blocked-submit branch.
  const pendingSubmitRef = useRef(false);

  // Card-scoped dispatch for locally-handled slash commands. A bare
  // `/command` matching the local registry is routed to the host-supplied
  // `localCommandTargetId` responder — THIS card's command-owning scope —
  // so the owning card opens the command's surface, instead of being sent
  // to claude. The prompt entry stays generic: it knows the command
  // *shape* via the pure matcher and the target *by id*, not what any
  // command does ([D23], [#step-1c]).
  //
  // Routing to a captured target id via `sendToTarget` — NOT
  // `sendToKeyCard` — is load-bearing for pane modality ([D15]): the key
  // card is derived from the GLOBAL first responder, so a pane-modal sheet
  // open in another pane (which holds first responder there) makes that
  // pane's card the key card. A `/rewind` typed here would then be handled
  // by the OTHER pane's card, hijacking its sheet. The prompt entry
  // belongs to exactly one card; the command must run on THAT card, by
  // identity, regardless of where focus sits app-wide. (The card-content
  // responder is reached by DOM-subtree search from the key card, not by
  // the prompt entry's parentId chain — it is a registry *sibling*, not an
  // ancestor — so a parent-targeted control dispatch can't reach it; the
  // host hands us its id explicitly. See responder-chain.md §"The four
  // dispatch shapes" → cascade-target pattern.)
  const manager = useResponderChain();
  const localCommandTargetIdRef = useRef(localCommandTargetId);
  localCommandTargetIdRef.current = localCommandTargetId;

  // Open the `/btw` side-question panel the MOMENT the route flips to `?`
  // ([P02]) — not at submit. Every selection path (route popup, ⇧⌘B, typed
  // `?` prefix) funnels through `routeLifecycle.setRoute`, so observing the
  // lifecycle's did-change ([L03]) catches them all uniformly. It reuses the
  // shipped `/btw` local surface via `RUN_SLASH_COMMAND` with empty args — a
  // bare open, no ask — exactly as a bare `/btw` submit does. The panel is
  // pinned, so flipping the route AWAY never closes it (only its `×` does).
  useLayoutEffect(() => {
    return routeLifecycle.observeRouteDidChange((_prev, next) => {
      if (next !== ROUTE_BTW) return;
      const targetId = localCommandTargetIdRef.current;
      if (
        manager !== null &&
        targetId !== undefined &&
        manager.nodeCanHandle(targetId, TUG_ACTIONS.RUN_SLASH_COMMAND)
      ) {
        manager.sendToTarget(targetId, {
          action: TUG_ACTIONS.RUN_SLASH_COMMAND,
          value: { name: "btw", args: "" },
          phase: "discrete",
        });
      }
    });
  }, [routeLifecycle, manager]);

  // Tear down the Find session the moment the route leaves `⌕` ([L03]): clear
  // the query + match set so no stale search state (or highlight) survives into
  // another route.
  useLayoutEffect(() => {
    return routeLifecycle.observeRouteWillChange((prev, next) => {
      if (prev === ROUTE_FIND && next !== ROUTE_FIND) {
        findSessionRef.current?.clear();
      }
    });
  }, [routeLifecycle]);

  // Re-seed the query from the editor draft on ENTERING Find ([L03]). Routes
  // share a single draft ([Q07]=a), so switching away and back does not fire a
  // doc change — the query-mirror `updateListener` only runs on edits, so the
  // text is still in the editor but the search never re-runs. Reading the doc
  // on the route's did-change re-runs the search against whatever is already
  // typed, instead of stranding a stale empty result until the user twiddles
  // the string. Leaving Find cleared the query above, so this is a real change
  // and the search effect fires; a genuinely empty draft is a no-op.
  useLayoutEffect(() => {
    return routeLifecycle.observeRouteDidChange((_prev, next) => {
      if (next !== ROUTE_FIND) return;
      const doc = textEditorRef.current?.view()?.state.doc.toString() ?? "";
      findSessionRef.current?.setQuery(doc);
    });
  }, [routeLifecycle]);

  // Force the just-cleared draft durable immediately after a submit.
  // `editor.clear()` empties the doc, but the debounced save that would
  // persist the cleared state is up to SAVE_DEBOUNCE_MS out, and WKWebView
  // fires no `beforeunload` / `visibilitychange` on quit — so a relaunch in
  // that window would otherwise restore the just-submitted message from the
  // stale pre-submit bag. Flushing here closes the window regardless of the
  // quit path. No-op in the gallery / unit-test mounts (no deck store or
  // card id). [L23].
  const persistClearedDraft = useCallback(() => {
    const store = deckStoreRef.current;
    const cardId = cardIdForTraceRef.current;
    if (store?.flushCardStateNow !== undefined && cardId !== null) {
      store.flushCardStateNow(cardId);
    }
  }, []);
  persistClearedDraftRef.current = persistClearedDraft;

  // Shared submit logic. Invoked by both the SUBMIT chain-action
  // handler (button click, Cmd+Enter, etc.) and the Return /
  // Shift+Return keyboard path (via the substrate's `onSubmit`).
  // Single closure means keyboard and pointer converge on the same
  // interrupt-vs-send decision and the same clear-and-route teardown.
  //
  // Stable identity (`useCallback` with deps that are themselves
  // stable — `codeSessionStore` is a prop reference); policy is read
  // through refs so the closure never goes stale [L07].
  const performSubmit = useCallback(() => {
    const editor = textEditorRef.current;
    const view = editor?.view() ?? null;
    const snap = snapRef.current;
    if (editor === null || view === null) return;

    // Submit-while-completing: if the completion popup is open with a
    // highlighted item, accept it FIRST so a submit made via the button or
    // Shift+Return commits the *completed* command / `@`-mention, not the
    // typed fragment (e.g. `/re` + Enter would otherwise send `/re`, not
    // `/rewind`). The keyboard accept (plain Enter / Tab) lives in the
    // completion keymap; this is the seam for submit paths that bypass it.
    // The accept dispatches synchronously, so the draft reads below see the
    // inserted atom. Applies uniformly to `/` commands and `@` mentions.
    editor.acceptActiveCompletion();

    // Find-route dispatch. On the `⌕` route the submit gesture is "find next",
    // never a turn: advance the active match and let the transcript host react
    // to the active-index change (scroll + flash). Intercept before every send
    // gate.
    if ((routeLifecycle.getRoute() || null) === ROUTE_FIND) {
      findSessionRef.current?.next();
      return;
    }

    // btw-route dispatch ([P02]). On the `?` route the whole submission is a
    // side question — Claude off the record ([P01]) — regardless of content,
    // so it intercepts BEFORE the local-command split (the route IS the
    // recipient, not the leading token). It reuses the shipped `/btw` local
    // surface via `RUN_SLASH_COMMAND`, inheriting mid-turn dispatch — this
    // runs ahead of the send-readiness gates, exactly like the local-command
    // path ([D108]). A bare submit (empty draft) opens the overlay without
    // asking, matching bare `/btw`.
    if ((routeLifecycle.getRoute() || null) === ROUTE_BTW) {
      const draftAtoms = getAtomsInState(view.state);
      const draftText = editor.captureState().text;
      const question = computeSideQuestionArg(draftText, draftAtoms);
      const targetId = localCommandTargetIdRef.current;
      if (
        manager !== null &&
        targetId !== undefined &&
        manager.nodeCanHandle(targetId, TUG_ACTIONS.RUN_SLASH_COMMAND)
      ) {
        manager.sendToTarget(targetId, {
          action: TUG_ACTIONS.RUN_SLASH_COMMAND,
          value: { name: "btw", args: question },
          phase: "discrete",
        });
        // Record the RAW question (NOT a synthesized `/btw …` line) so ↑
        // recall on the `?` route returns what the user typed. A bare
        // overlay-open (empty ask) is not a history entry.
        if (question.length > 0) {
          const sessionId = snapRef.current.tugSessionId;
          historyStore.push({
            id: `${sessionId}-${Date.now()}`,
            sessionId,
            projectPath: "",
            route: ROUTE_BTW,
            text: question,
            atoms: [],
            timestamp: Date.now(),
          });
        }
        editor.clear();
        currentHistoryProviderRef.current.resetToDraft(EMPTY_EDIT_STATE);
        persistClearedDraft();
        return;
      }
      // No responder (e.g. the gallery host) — fall through so the draft is
      // not lost.
    }

    // Slash-command interception ([D23], [#step-1c]). Accepting any
    // slash-command suggestion inserts a `type:"command"` atom and dismisses
    // the popup — uniform for every command. The local-vs-remote split is
    // made HERE, at submit: a command whose name is in the local registry
    // opens its surface (dispatch `RUN_SLASH_COMMAND` to the key card's
    // card-content responder); everything else (a claude command atom, plain
    // text) flows on to `send()` unchanged. The command line is recognized in
    // either form — a bare `/name` typed without the popup, or a lone
    // accepted command atom (the U+FFFC placeholder is the only text). Runs
    // BEFORE the send-readiness gates (matching `Shift+Tab`, not gated on
    // `canSubmit`); if no responder handles the dispatch (a host with no
    // card-content handler, e.g. the gallery), fall through to `send()`.
    if (!isEffectivelyEmpty(view)) {
      const draftAtoms = getAtomsInState(view.state);
      const draftText = editor.captureState().text;
      // Reconstruct a plain `/command …` line even when the draft carries
      // atoms — a leading command atom or `@`/file mentions in the argument
      // (e.g. `/compact prepare @plan.md`) — by expanding each atom in place
      // (command → `/name`, file/doc/link → its path/value, image dropped).
      // A draft that doesn't lead with a slash command won't match the
      // registry, so non-command drafts are unaffected.
      const commandLine: string = buildSlashCommandLine(draftText, draftAtoms);
      const localCommand = matchLocalSlashCommand(commandLine);
      const targetId = localCommandTargetIdRef.current;
      if (
        localCommand !== null &&
        manager !== null &&
        targetId !== undefined &&
        // Guard the `sendToTarget` throw-on-unregistered contract, and
        // confirm the target actually owns RUN_SLASH_COMMAND before we
        // route (else fall through to send, never silently swallow).
        manager.nodeCanHandle(targetId, TUG_ACTIONS.RUN_SLASH_COMMAND)
      ) {
        const handled = manager.sendToTarget(targetId, {
          action: TUG_ACTIONS.RUN_SLASH_COMMAND,
          value: localCommand,
          phase: "discrete",
        });
        if (handled) {
          // Record the command in per-session history so ↑ recalls it,
          // exactly like a sent message (the dispatch consumed the draft,
          // but the user still typed and submitted a line).
          const sessionId = snapRef.current.tugSessionId;
          historyStore.push({
            id: `${sessionId}-${Date.now()}`,
            sessionId,
            projectPath: "",
            route: routeLifecycle.getRoute() || "",
            text: commandLine,
            atoms: [],
            timestamp: Date.now(),
          });
          editor.clear();
          // Submitting (even a recalled entry) returns the history
          // cursor to the end of the list — next ↑ starts from the most
          // recent entry, including this one.
          currentHistoryProviderRef.current.resetToDraft(EMPTY_EDIT_STATE);
          persistClearedDraft();
          return;
        }
      }

      // [D14] notice for a typed `/command` the dev card will not run
      // ([#step-13a]). Two cases: a *hidden* (known-unsupported) command —
      // never sent to claude — and a *genuine unknown* (catalog populated,
      // name absent) that would otherwise burn a turn on a typo. Either way,
      // surface a client-side `SHOW_SLASH_COMMAND_NOTICE` alert via the card's
      // responder with the matching `reason`, instead of silently dropping or
      // bouncing off claude. Recorded in history (↑ recalls it), mirroring the
      // local-command path. A local command was already dispatched above.
      const name = slashCommandName(commandLine);
      if (name !== null) {
        const hidden = isHiddenSlashCommand(name);
        const unknown =
          !hidden &&
          isUnknownRemoteCommand(
            name,
            sessionMetadataStore.getSnapshot().slashCommands.map((c) => c.name),
          );
        if (hidden || unknown) {
          const target = localCommandTargetIdRef.current;
          const notified =
            manager !== null &&
            target !== undefined &&
            manager.nodeCanHandle(
              target,
              TUG_ACTIONS.SHOW_SLASH_COMMAND_NOTICE,
            ) &&
            manager.sendToTarget(target, {
              action: TUG_ACTIONS.SHOW_SLASH_COMMAND_NOTICE,
              value: { name, commandLine, reason: hidden ? "unsupported" : "unknown" },
              phase: "discrete",
            });
          // A hidden command is always swallowed (never reaches claude). A
          // genuine unknown is swallowed only when a notice was actually
          // shown — with no responder (e.g. the gallery host), fall through to
          // `send()` so claude still sees it.
          if (hidden || notified) {
            const sessionId = snapRef.current.tugSessionId;
            historyStore.push({
              id: `${sessionId}-${Date.now()}`,
              sessionId,
              projectPath: "",
              route: routeLifecycle.getRoute() || "",
              text: commandLine,
              atoms: [],
              timestamp: Date.now(),
            });
            editor.clear();
            currentHistoryProviderRef.current.resetToDraft(EMPTY_EDIT_STATE);
            return;
          }
        }
      }
    }

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
    // a `send` dispatched while a turn runs ([D-T3-07], superseded by
    // [P06]/[P07] mid-turn steering: the queued message is held
    // client-side and retractable, then picked up at the next agent-loop
    // boundary and merged into the running turn, rather than only at
    // `turn_complete`). The earlier "submit is interrupt" branch is
    // retired: the primary Stop button interrupts through the SUBMIT
    // action handler; editor Return and the `+` button queue.
    // `performSubmit` is now uniformly "submit the editor draft" —
    // `codeSessionStore.send()` below, which the reducer routes to a
    // turn start (idle) or the queue (mid-turn).
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
        classifyBlockedSubmit(snap.phase, snap.sessionMode) === "defer" &&
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

    // Attachment pending-gate: any atom carrying an id but no
    // bytes-store entry is mid-processing (drop inserted the
    // skeleton; async byte-fill hasn't completed yet). Submitting
    // now would ship the filename as text only, dropping the bytes
    // silently — confusing UX. Surface a banner via the existing
    // attachment-error channel and bail; the user retries once the
    // pulsing pending chips settle. Per
    // [D02](roadmap/dev-atoms.md#d02-image-attach-text-rest)'s
    // pending-atom contract.
    const pendingAttachmentCount = positionedAtoms.filter(
      (a) =>
        a.segment.id !== undefined &&
        attachmentBytesStore.get(a.segment.id) === null,
    ).length;
    if (pendingAttachmentCount > 0) {
      publishAttachmentError(
        pendingAttachmentCount === 1
          ? "Attachment is still processing — wait for it to finish before submitting."
          : `${pendingAttachmentCount} attachments are still processing — wait for them to finish before submitting.`,
      );
      return;
    }

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
    // Trim whitespace from both ends of the submitted command. Atoms
    // ride as `￼` placeholder characters — never whitespace — so
    // trimming only removes surrounding spaces / newlines and never
    // touches an atom, keeping the placeholder count aligned with
    // `sendAtoms`.
    const submitText = strippedText.trim();
    // Atom positions shift left by 1 when the leading prefix is stripped.
    // The prefix character is plain text — never an atom — so the
    // filter on `position >= 1` only matters defensively.
    const atomsAdjusted: PositionedAtom[] = stripped
      ? positionedAtoms
        .filter((a) => a.position >= 1)
        .map((a) => ({ position: a.position - 1, segment: a.segment }))
      : positionedAtoms;
    const sendAtoms: AtomSegment[] = atomsAdjusted.map((a) => a.segment);
    // A whitespace-only draft (no atoms) trims to nothing — treat it like
    // the empty-input guard and don't send a blank turn.
    if (submitText.length === 0 && sendAtoms.length === 0) return;
    // Canonicalize a lone plugin command to its qualified `/<plugin>:<leaf>`
    // form so the wire and transcript use the name claude expands — even when
    // the user typed (or accepted) the bare leaf. An exact catalog match is
    // left untouched (conflict / shadowing → exact typed wins). The catalog
    // here is the same turn-free `slashCommands` the popup reads.
    const catalogNames = sessionMetadataStore
      .getSnapshot()
      .slashCommands.map((c) => c.name);
    let wireText = submitText;
    let wireAtoms = sendAtoms;
    if (sendAtoms.length === 1 && sendAtoms[0].type === "command") {
      const canonical = resolveRemoteCommand(sendAtoms[0].value, catalogNames);
      if (canonical !== null && canonical !== sendAtoms[0].value) {
        wireAtoms = [
          { ...sendAtoms[0], value: canonical, label: canonical },
        ];
      }
    } else if (sendAtoms.length === 0) {
      const canonical = canonicalizeBareCommandLine(submitText, catalogNames);
      if (canonical !== null) wireText = canonical;
    }

    // Shell-route dispatch ([P02]/[P12]). The `$` route runs the command
    // against the card's shell session — the exchange threads into the
    // transcript via `ShellSessionStore` → `ingestShellExchange`, never to
    // Claude. History records the raw command (↑ recall). A host with no
    // shell store (the gallery) falls through to `send()` so nothing is lost.
    if (currentRoute === ROUTE_SHELL && shellSessionStore !== undefined) {
      shellSessionStore.exec(submitText);
      const sessionId = snapRef.current.tugSessionId;
      historyStore.push({
        id: `${sessionId}-${Date.now()}`,
        sessionId,
        projectPath: "",
        route: ROUTE_SHELL,
        text: strippedText,
        atoms: [],
        timestamp: Date.now(),
      });
      onBeforeSubmitRef.current?.();
      editor.clear();
      onAfterSubmitRef.current?.();
      currentHistoryProviderRef.current.resetToDraft(EMPTY_EDIT_STATE);
      persistClearedDraft();
      return;
    }

    codeSessionStore.send(wireText, wireAtoms);
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
        id: a.segment.id,
        // Persist the baked thumbnail so the preview survives a cold
        // launch (the full bytes live only in the ephemeral per-card
        // store). Read straight off the bytes store at submit time.
        thumbnailDataUrl:
          a.segment.id !== undefined
            ? attachmentBytesStore.get(a.segment.id)?.thumbnailDataUrl
            : undefined,
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
    // Submitting returns the history cursor to the end of the list, so
    // the next ↑ starts from the most recent entry (this submission)
    // rather than wherever the user had browsed to. The draft is the
    // now-empty editor.
    currentHistoryProviderRef.current.resetToDraft(EMPTY_EDIT_STATE);
    // Force the cleared draft durable now so a relaunch can't restore the
    // message we just sent (see `persistClearedDraft`).
    persistClearedDraft();
    // Route is a sticky user preference. Do not reset on submit.
  }, [
    codeSessionStore,
    historyStore,
    manager,
    sessionMetadataStore,
    persistClearedDraft,
    attachmentBytesStore,
  ]);

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
  // `popInteractive()` — the unified Stop ≡ Esc gesture: pop the
  // newest cancellable thing, a queued send first (LIFO), then the
  // running turn once the queue is empty. Identical to clicking the
  // red Stop button (the SUBMIT handler's stop branch calls the same
  // `popInteractive()`).
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
  // is nothing left to pop — and the Stop button is itself already
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
        // Focus restoration is owned by the popup's focus trap
        // (`onCloseAutoFocus`), NOT this handler: on close it returns focus
        // to whatever held it when the menu opened — the editor caret for a
        // mouse pick, or the trigger button (ring intact) for a keyboard
        // pick made while cycling. An explicit `focus()` here would fight
        // that restore and strand the trigger without its focus ring.
      },
      [TUG_ACTIONS.SELECT_ROUTE]: (event: ActionEvent) => {
        // Keyboard-shortcut path (⇧⌘C / ⇧⌘S). The keymap puts
        // the canonical route character on `event.value`; we narrow
        // to string and gate against unknown values. Same semantics
        // as the route-popup select path above, minus the focus
        // handoff (the editor already has focus when the shortcut
        // fires, since the dispatch is `first-responder` scoped).
        if (typeof event.value !== "string") return;
        const nextRoute = event.value;
        if (!Object.prototype.hasOwnProperty.call(RETURN_ACTION_BY_ROUTE, nextRoute)) return;
        // `setRoute` is a no-op when `nextRoute` equals the current route.
        routeLifecycle.setRoute(nextRoute);
      },
      // ⌘G / ⇧⌘G within the Find route — advance / retreat the active match.
      // The transcript host reacts to the active-index change (scroll + flash).
      // No-ops outside Find (the session holds no matches there).
      [TUG_ACTIONS.FIND_NEXT]: () => {
        if (routeLifecycle.getRoute() === ROUTE_FIND) {
          findSessionRef.current?.next();
        }
      },
      [TUG_ACTIONS.FIND_PREVIOUS]: () => {
        if (routeLifecycle.getRoute() === ROUTE_FIND) {
          findSessionRef.current?.previous();
        }
      },
      [TUG_ACTIONS.REMOVE_ATTACHMENT]: (event: ActionEvent) => {
        // The preview's ✕ / Delete controls dispatch the atom id of the
        // attachment to drop; the prompt-entry owns the editor doc +
        // bytes store, so it performs the removal here ([L11]).
        if (typeof event.value !== "string") return;
        handleRemoveAttachmentById(event.value);
      },
      [TUG_ACTIONS.SUBMIT]: (_event: ActionEvent) => {
        // The primary Z5 button dispatches SUBMIT in every mode. When
        // a turn is running the button is Stop — it pops the newest
        // cancellable thing (a queued send first, LIFO; the running
        // turn once the queue is empty), the same `popInteractive()`
        // gesture Esc invokes. In any submit-family mode it runs the
        // submit. Editor Return reaches `performSubmit` directly
        // (never via this action), so an in-flight Return queues
        // rather than popping.
        if (submitButtonModeRef.current.kind === "stop") {
          // On the `$` route the Stop pose reaps the running shell command
          // ([P13]); everywhere else it interrupts the Claude turn.
          if (routeLifecycle.getRoute() === ROUTE_SHELL) {
            shellSessionStore?.kill();
          } else {
            codeSessionStore.popInteractive();
          }
        } else {
          performSubmit();
        }
      },
      ...(snap.canInterrupt && !snap.interruptInFlight
        ? {
            [TUG_ACTIONS.CANCEL_DIALOG]: (_event: ActionEvent) => {
              // A visible slash-command / file completion popup owns Escape
              // first: dismiss it and bail. The capture-phase keybinding
              // routes Escape here BEFORE the editor's bubble-phase keymap
              // runs (because a turn is in flight, this CANCEL_DIALOG handler
              // is registered and claims the event), so without this check
              // Escape would interrupt the turn while leaving the popup open.
              // When no popup is open this is a no-op and we fall through to
              // the interrupt — Escape ≡ the Stop button.
              if (textEditorRef.current?.cancelActiveCompletion() === true) {
                return;
              }
              codeSessionStore.popInteractive();
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
  // Last draft this entry captured or restored. `onSave` forwards it when
  // `textEditorRef.current` is null (a save fired in a window where the
  // substrate isn't mounted) — returning `draft: null` there would clobber
  // a previously-good persisted draft with nothing. [L23]
  const lastKnownDraftRef = useRef<TugTextEditingState | null>(null);

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
      // No live substrate: forward the last draft this entry saw rather
      // than writing `draft: null` over a good persisted draft. [L23]
      const liveDraft =
        editor !== null ? editor.captureState() : lastKnownDraftRef.current;
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
      // Snapshot the bytes-store alongside the draft so a card that
      // restores from disk (or HMR cycle) rehydrates its in-flight
      // image attachments with bytes intact. The store's `snapshot`
      // returns a fresh plain object — JSON-serializable. Omitted
      // when empty so persisted payloads stay small. Per [L23].
      const bytesSnap = attachmentBytesStore.snapshot();
      const attachmentBytes = Object.keys(bytesSnap).length > 0
        ? bytesSnap
        : undefined;
      lastKnownDraftRef.current = draft;
      return {
        route: routeLifecycle.getRoute(),
        draft,
        attachmentBytes,
      };
    },
    onRestore: (raw, { isActive }) => {
      const restored = coerceRestorePayload(raw);
      routeLifecycle.setRoute(restored.route);
      lastKnownDraftRef.current = restored.draft;
      // Rehydrate the bytes-store BEFORE the editor restores its
      // draft so the moment the substrate reads atom-ids back, the
      // corresponding bytes are already there for buildWirePayload
      // (Step 3) to read at submit. Additive on existing keys per
      // [Spec S02] — if the live store has accumulated unrelated
      // entries from drops that happened after the snapshot was
      // taken (rare), they survive the restore.
      if (restored.attachmentBytes !== undefined) {
        attachmentBytesStore.restore(restored.attachmentBytes);
      }
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
          // Whole-entry stand-down: `inert` blocks mouse, keyboard,
          // and focus for the entire subtree — the route toggle,
          // chips, and submit included — while a restore replays.
          // React 19 boolean prop; dimming rides `data-disabled`
          // ([L06]).
          inert={disabled || undefined}
          data-disabled={disabled ? "" : undefined}
          className={cn("tug-prompt-entry", className)}
          // One continuous drop surface (see the handlers above): a file
          // drag anywhere over the entry — chrome included — accepts and
          // lands in the editor. The substrate's own host-level handlers
          // claim drags over the editor first; these catch the rest.
          onDragOver={handleEntryDragOver}
          onDragLeave={handleEntryDragLeave}
          onDragEnd={clearEntryDropState}
          onDrop={handleEntryDrop}
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
          <div
            className="tug-prompt-entry-input-area"
            ref={editorStopRef as (el: HTMLDivElement | null) => void}
            tabIndex={editorFocusGroup !== undefined ? -1 : undefined}
          >
            <TugTextEditor
              ref={textEditorRef}
              borderless
              // Auto-height: opens at the host's `--tug-text-editor-min-height`
              // (the Dev card sets 200px), grows with content up to its
              // height cap, then scrolls. The cap is `maxRows` rows by
              // default; a host may override the scroller's `max-height`
              // (the Dev card caps by card height instead — see
              // `dev-card.css` — so the gallery prompt keeps the 20-row cap
              // while the Dev prompt scrolls at a fraction of the card).
              maxRows={20}
              disabled={deactivated}
              placeholder={placeholderByRoute?.[route] ?? ""}
              completionProviders={completionProviders}
              argumentHintResolver={argumentHintResolver}
              argumentHintRefresh={argumentHintRefresh}
              pastedCommandResolver={pastedCommandResolver}
              inlineCommandMatcher={inlineCommandMatcher}
              dropHandler={dropHandler}
              attachmentBytesStore={attachmentBytesStore}
              onAttachmentError={publishAttachmentError}
              historyProvider={currentHistoryProvider}
              returnAction={
                returnActionOverride ?? RETURN_ACTION_BY_ROUTE[route] ?? "submit"
              }
              numpadEnterAction={numpadEnterAction}
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
          {/*
            Z4C — the compose-phase attachment-preview zone. A flow sibling
            between the editor's scroll viewport and the toolbar (Z4), so it
            stays pinned below the scrolling text and directly above the
            toolbar, and grows the entry's height like added text rows.
            Rendered only when the editor holds image atoms; the preview
            component itself short-circuits to null when empty, but gating
            here keeps the zone wrapper out of the DOM entirely so it adds
            no padding to an attachment-free entry. The ✕ / Delete delete
            affordance is live here ([compose phase] — `onDelete` supplied),
            unlike the read-only transcript strip.
          */}
          {composeImageAtoms.length > 0 && (
            <div
              className="tug-prompt-entry-attachments"
              data-slot="tug-prompt-entry-attachments"
              // Chrome, like the toolbar: a click on a tile or its ✕ must
              // not steal first-responder / DOM focus from the editor.
              // Descendant controls that need focus (none here — the tile
              // opens a sheet, the ✕ refuses) are unaffected.
              data-tug-focus="refuse"
              // Drops on the strip ride the entry-root drop surface (the
              // handlers on `.tug-prompt-entry` above) — no zone-local
              // handlers, one continuous target.
            >
              <TugAttachmentPreview
                atoms={composeImageAtoms}
                bytesStore={attachmentBytesStore}
                deletable
                focusGroup={attachmentFocusGroup}
                focusOrderBase={attachmentFocusOrderBase}
              />
            </div>
          )}
          <div
            className="tug-prompt-entry-toolbar"
            // The toolbar is chrome: clicking anywhere in it — a badge, the
            // route toggle, the spacers, the empty gaps — must not steal
            // first-responder or DOM focus from the editor. `data-tug-focus`
            // is ancestor-matched (`closest`), so marking the row refuses
            // focus for every descendant that doesn't already (the TugBadge
            // chips and the empty spacers); TugButton children already refuse
            // on their own. [L11 / responder-chain-provider focus-refusal]
            data-tug-focus="refuse"
          >
            {/* Z4A — leading-fixed slot; the route popup. A filled TugButton
              trigger (icon + name of the current route + chevron), tinted in
              the theme selection color to match the old choice-group's
              selected pill (see `tug-prompt-entry-route-trigger` in the CSS),
              opens a TugPopupMenu of the three routes, the current one
              check-marked. It is width-stabilized to the widest route label
              so flipping routes never resizes it. It is a control ([L11]):
              the menu's `onSelect` dispatches SELECT_VALUE through the chain
              (see `routeIndicatorSenderId` above), reusing this entry's
              existing route handler. `side="top"` opens the menu upward — the
              toolbar sits at the card's bottom edge. The single-button
              footprint frees width for the Z4B indicator cluster's margins. */}
            <TugPopupMenu
              side="top"
              align="start"
              trigger={
                <TugButton
                  className="tug-prompt-entry-route-trigger"
                  emphasis="filled"
                  role="accent"
                  size="sm"
                  subtype="icon-text"
                  icon={currentRouteItem.icon}
                  trailingIcon={<ChevronDown size={12} />}
                  widthStabilize={{ alternateLabel: WIDEST_ROUTE_LABEL }}
                  aria-label="Route"
                  focusGroup={routeFocusGroup}
                  focusOrder={routeFocusOrder}
                >
                  {currentRouteItem.label}
                </TugButton>
              }
              items={ROUTE_ITEMS.map((item) => ({
                id: item.value,
                label: item.label,
                icon: item.icon,
                selected: item.value === route,
              }))}
              onSelect={(nextRoute) => {
                // Dispatch to this entry's own responder ([L11]) so the
                // SELECT_VALUE handler below applies the route — the same
                // sink the ⇧⌘C/⇧⌘S/⇧⌘B shortcuts reach. The popup runs its
                // onSelect from the entry's render scope, so we target `id`
                // by identity rather than routing through the parent.
                if (manager === null) return;
                manager.sendToTarget(id, {
                  action: TUG_ACTIONS.SELECT_VALUE,
                  value: nextRoute,
                  sender: routeIndicatorSenderId,
                  phase: "discrete",
                });
              }}
            />
            {/*
              Z4B — centred-floating slot; currently the indicator
              cluster. Two equal flex spacers flank it, so the free
              width splits evenly and Z4B's centre lands at the midpoint
              of the Z4A–Z5 gap ([D05]). Z4A / Z4B are layout positions
              — the occupant placed in each is free to change.
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
              Find route: the "previous match" secondary button, mounted to the
              left of the Z5 "next" button (reusing the queue slot's placement).
              Direct `onClick` → `findSession.previous()`, never the SUBMIT
              action — the transcript host reacts to the active-index change
              (scroll + flash). ⇧⌘G is the keyboard twin.
            */}
            {route === ROUTE_FIND && (
              <TugPushButton
                className="tug-prompt-entry-queue-button"
                subtype="icon"
                size="lg"
                // Outlined, not filled: Previous is the secondary of the
                // Next/Previous pair, so the two buttons don't read as identical
                // twins — the filled Z5 button below is "next" (the Return
                // gesture's twin), this outlined one is "previous".
                emphasis="outlined"
                role="action"
                onClick={() => findSessionRef.current?.previous()}
                aria-label="Find previous"
                icon={<ChevronUp size={18} strokeWidth={2.5} />}
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
              focusGroup={submitFocusGroup}
              focusOrder={submitFocusOrder}
              role={submitView.danger ? "danger" : "action"}
              disabled={submitView.disabled}
              aria-label={route === ROUTE_FIND ? "Find next" : submitView.ariaLabel}
              icon={
                route === ROUTE_FIND ? (
                  <ChevronDown size={18} strokeWidth={2.5} />
                ) : submitView.icon === "stop" ? (
                  <Square size={14} strokeWidth={3} />
                ) : (
                  <ArrowUp size={16} strokeWidth={2.5} />
                )
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
