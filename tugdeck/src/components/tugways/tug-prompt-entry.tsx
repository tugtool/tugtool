/**
 * TugPromptEntry — Compound composition: TugTextEditor + the Z4A leading
 * slot (the command picker) + submit/stop button, driven by a
 * CodeSessionStore snapshot.
 *
 * Composes TugTextEditor (CM6-backed editor + atom + completion + drop),
 * the Z4A command-picker slot, and TugPushButton (submit/stop). Each
 * composed child keeps its own tokens [L20]; the entry reuses existing
 * base-tier global / field / badge tokens per [D11].
 *
 * Input model ([P01] route demotion): Code is the only resting mode. The
 * prompt entry always targets Claude on the record; every other
 * destination (shell, btw, find, changes, history) is reached
 * per-submission via a slash command, a chord, or a chrome affordance.
 * Return inserts a newline; Shift+Return (or the Z5 button) submits. One
 * draft per entry, persisted across reloads via the existing tugbank
 * pipeline; the persisted `route` field is pinned to Code so the Code
 * history provider recalls it ([P11]).
 *
 * Laws: [L02] useSyncExternalStore for store state, [L06] appearance
 *       via CSS/DOM, [L07] handlers read state via refs, [L11]
 *       controls emit actions, [L15] token-driven states, [L16]
 *       pairings declared, [L19] component authoring guide, [L20]
 *       token sovereignty, [L22] direct DOM writes for high-frequency
 *       updates, [L23] [L24] state preservation lives on the entry,
 *       not the substrate.
 * Decisions: [D-T3-06] submit is interrupt, [D-T3-07] queue during turn,
 *            [D-T3-09] 1:1 card↔store.
 */

import "./tug-prompt-entry.css";

import { TugEntryShell } from "./tug-entry-shell";

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
  History as HistoryIcon,
  MessageSquareDashed,
  PencilSparkles,
  Plus,
  Search,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";

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
  addAtomsEffect,
  getAtomsInState,
  regenerateAtomsEffect,
  removeAtomById,
  replaceAtomsEffect,
  type PositionedAtom,
} from "./tug-text-editor/atom-decoration";
import {
  setWaveCaretActive,
  waveCaretExtension,
} from "./tug-text-editor/wave-caret";
import { TugAttachmentPreview } from "./cards/tug-attachment-preview";
import { TugButton } from "./internal/tug-button";
import { TugPopupMenu } from "./internal/tug-popup-menu";
import { TugPushButton } from "./tug-push-button";
import { TugConfirmPopover } from "./tug-confirm-popover";
import { resolveSubmitButtonView } from "./tug-prompt-entry-submit-button";
import type { SessionSubmitButtonMode } from "@/lib/code-session-store/lifecycle-state";
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
import { DEFAULT_ROUTE } from "@/lib/route-constants";
import type { PathCommandsStore } from "@/lib/path-commands-store";
import { autoShellOpener, classifyShellLine } from "@/lib/shell-line-classifier";
import { BANG_COMMANDS, matchBangCommandLine } from "@/lib/bang-commands";
import type { FindSession } from "@/lib/find-session";
import type { CommitModeController } from "@/lib/commit-mode-controller";

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/** Stable no-op `useSyncExternalStore` subscribe for an absent shell store. */
const NOOP_SUBSCRIBE = (): (() => void) => () => {};

/** Per-routing menu icons for the Z4A picker — presentation only; names,
 *  descriptions, and chords come from the {@link BANG_COMMANDS} registry. */
const BANG_PICKER_ICONS: Record<string, React.ReactNode> = {
  shell: <SquareTerminal size={14} />,
  btw: <MessageSquareDashed size={14} />,
  find: <Search size={14} />,
  history: <HistoryIcon size={14} />,
};

/**
 * The Z4A picker's roster ([P06], revised): the bang-command registry —
 * ONLY the four routings demoted from sticky routes, each labeled in its
 * typed `!name` form with its ⌃⌘ chord, so the menu teaches both the
 * shortcut and the typeable syntax as it is used. Picking one seeds its
 * `!name` chip. Deliberately NOT the `/` completion catalog — routings are
 * a different species from slash commands (`lib/bang-commands.ts`).
 */
const COMMAND_PICKER_ITEMS: ReadonlyArray<{
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}> = BANG_COMMANDS.map((cmd) => ({
  id: cmd.name,
  label: `!${cmd.name}`,
  icon: BANG_PICKER_ICONS[cmd.name],
  shortcut: cmd.shortcut,
}));

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

/**
 * Debounce, in milliseconds, between a commit-message keystroke and the
 * durable `persistMessage` write ([P05]). Sized so ordinary typing coalesces
 * into a settled write, not one CONTROL frame per key.
 */
const COMMIT_PERSIST_DEBOUNCE_MS = 500;

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
 * Build the side-question argument for a `?`-route ([P02]) submission from
 * the raw editor draft: expand atoms to their values (so an `@plan.md`
 * mention survives as its path — `buildSlashCommandLine`) and trim. An
 * empty result means a bare submit — the caller opens the overlay without
 * asking. Pure; exported for the unit tests.
 */
export function computeSideQuestionArg(
  draftText: string,
  draftAtoms: readonly CommandLineAtom[],
): string {
  return buildSlashCommandLine(draftText, draftAtoms).trim();
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
 * Compute the editing state after inserting or replacing the leading command
 * chip ([P07]). If the draft already leads with a command atom, its name is
 * swapped in place and the typed args are preserved; otherwise a `name`
 * command atom + a trailing space is inserted at document position 0 and the
 * whole existing draft becomes the args. The seed shape matches a typed /
 * completed command byte-for-byte (`TUG_ATOM_CHAR` + a space), so submit-time
 * recognition is identical. Pure; exported for unit tests.
 */
export function computeCommandChipInsert(
  current: TugTextEditingState,
  name: string,
): TugTextEditingState {
  const head = current.atoms[0];
  if (head !== undefined && head.position === 0 && head.type === "command") {
    // Replace the head command atom in place; args (the rest of the draft)
    // and the caret are untouched.
    return {
      ...current,
      atoms: [
        { ...head, label: name, value: name, id: undefined },
        ...current.atoms.slice(1),
      ],
    };
  }
  // Insert "<atom> " at position 0; shift every existing atom + the caret
  // right by the two inserted characters. The caret lands just after the
  // chip + space when the draft had no selection.
  const SHIFT = 2;
  const commandAtom = { position: 0, type: "command", label: name, value: name };
  return {
    text: `${TUG_ATOM_CHAR} ${current.text}`,
    atoms: [
      commandAtom,
      ...current.atoms.map((a) => ({ ...a, position: a.position + SHIFT })),
    ],
    selection:
      current.selection === null
        ? { start: SHIFT, end: SHIFT }
        : {
            start: current.selection.start + SHIFT,
            end: current.selection.end + SHIFT,
          },
  };
}

/**
 * Build the editor state for commit mode ([P03]): the message text, nothing
 * else — the mode lives in the entry's chrome (Z4A commit chip, Z5 rail),
 * never as a token inside the document. Pure; exported for unit tests.
 */
export function buildCommitModeState(message: string): TugTextEditingState {
  return buildEditingStateFromDraftRestore(message, []);
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
 * Apply a shell share gesture ([P08]): compute the editor insertion for
 * the shared text — Claude's to receive once the user edits and sends. An
 * effectively empty editor takes the share text as-is; a mid-compose draft
 * gets it appended on its own line, never clobbered. (Code is the only
 * resting mode now, so the gesture no longer flips any route — it just
 * seeds the editor.)
 *
 * Pure over the doc facts and exported so the unit tests pin the insertion
 * without a live editor.
 */
export function applyShellShare(
  shareText: string,
  doc: { length: number; isEffectivelyEmpty: boolean },
): ShellShareInsertion {
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
   * The card's shell session store ([P12]/[P13]). Runs a shell exchange for a
   * `/shell` accelerator, a shared row's seed, or a classifier auto-route, and
   * drives the live cwd. Optional so hosts without a shell (the gallery) omit it.
   */
  shellSessionStore?: ShellSessionStore;
  /**
   * The login-PATH command set for the submit-time shell-line classifier
   * ([P08]/[P09]). Null-until-loaded → the classifier answers Code. Optional so
   * hosts without a shell (the gallery) omit it — the classifier is then a no-op.
   */
  pathCommandsStore?: PathCommandsStore;
  /**
   * `⌕`-route Find session store. Holds the live query, options, match set,
   * and active index for transcript search. While the Find route is active the
   * editor doc is mirrored into `findSession.setQuery`; Return advances the
   * active match; leaving the route clears it. Optional so hosts without a
   * transcript (the gallery) can omit it.
   */
  findSession?: FindSession;
  /**
   * Commit mode ([P03]): when active, this entry becomes the commit-message
   * editor — the editor content swaps to the changeset draft, Z5 shows
   * cancel / auto-message / commit, and submit lands the commit instead of
   * sending to Claude. Optional; hosts without a changeset (the gallery) omit it
   * and the entry behaves exactly as before.
   */
  commitMode?: CommitModeController;
  /**
   * Host handler for an attachment that could not be accepted (drop or
   * paste of an unsupported / oversize / undecodable image, or a submit
   * attempted while an attachment is still processing). The message is
   * user-facing and names the file. Hosts surface it as a calm,
   * card-scoped notice — the Session card raises a pane bulletin — never the
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
   * — the Session card collapses the entry pane to its minimum height.
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
   * host open it — the Session card raises the same sheet as `/rewind`.
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
   * Placeholder text for the embedded editor, forwarded to
   * `TugTextEditor`. The session card supplies the Code prompt copy; the
   * gallery prompt-entry omits it (no placeholder).
   */
  placeholder?: string;
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
   * The Session card supplies this (under its keyboard-focus-cycling
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
   * not a walk stop). Supplied by the Session card under its `CycleScope` so
   * the route joins the cycle as the stop after the commit-home.
   */
  routeFocusGroup?: string;
  /** Order of the route within {@link routeFocusGroup}. Defaults to 0. */
  routeFocusOrder?: number;
  /**
   * Authors the **editor input area** itself into a focus group ([P02]) as a
   * **text stop** — the last stop of the session card's keyboard-focus cycle
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
   * sheet). Supplied by the Session card under its `CycleScope`; omitted by
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
   * surfacing the live tile count to the host. The Session card uses it to size
   * the attachment row of its keyboard-cycle spatial grid to exactly the
   * registered tiles. Omit when the host does not author the tiles into a
   * cycle.
   */
  onAttachmentCountChange?: (count: number) => void;
}

/**
 * Imperative handle exposed via `forwardRef`. Used by the Session card
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
   * Whether the editor holds no user content (zero-length doc). The Session
   * card reads this to gate the ⇧⌘C commit-mode entry ([P03]): ⇧⌘C on an
   * empty composer enters the route; on a non-empty one it shows the read-only
   * glance only, leaving the in-progress prompt untouched.
   */
  isEmpty(): boolean;
  /**
   * Insert (or replace) the leading `/<name>` command chip ([P07]): the
   * ⌃⌘ chords and the command picker call this. A head command atom is
   * swapped in place, preserving typed args; otherwise a command atom +
   * trailing space is inserted at document position 0. Focuses the editor.
   */
  insertCommandChip(name: string): void;
  /**
   * Open the command picker ([P06]): focus the editor and, unless the draft
   * already leads with a `/` or a command atom, seed a leading `/` at
   * document position 0 so the standard completion popup opens.
   */
  openCommandPicker(): void;
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
    pathCommandsStore,
    findSession,
    commitMode,
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
    placeholder,
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
  // the host, which surfaces a calm card-scoped notice (the Session card
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
  // fresh inline callback never re-fires the effect). The Session card sizes its
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

  // Code is the only resting mode ([P01]); prompt history keys entries by
  // this scalar and the Code provider recalls only these ([P11]).
  const route = DEFAULT_ROUTE;

  // ── Commit mode ([P03]) ─────────────────────────────────────────────────
  // While active this entry is the commit-message editor — the document IS
  // the message (no routing chip; the mode lives in the chrome), Z5 shows
  // cancel / auto-message / commit, and submit lands the commit. The whole
  // mode rides one subscribable snapshot ([L02]); the live message is read on
  // demand (submit / cancel / auto-message / debounced save) rather than
  // mirrored, so no per-keystroke React state is introduced ([L22]).
  const commitSnap = useSyncExternalStore(
    commitMode?.subscribe ?? NOOP_SUBSCRIBE,
    () => commitMode?.getSnapshot() ?? null,
  );
  const commitActive = commitSnap?.active === true;
  const commitDrafting = commitActive && commitSnap?.draftPhase === "drafting";
  const inCommitModeRef = useRef(false);
  const prevCommitActiveRef = useRef(false);
  const commitModeRef = useRef(commitMode);
  commitModeRef.current = commitMode;
  const commitSnapRef = useRef(commitSnap);
  commitSnapRef.current = commitSnap;
  const commitDraftingRef = useRef(commitDrafting);
  commitDraftingRef.current = commitDrafting;
  const [commitConfirmOpen, setCommitConfirmOpen] = useState(false);

  // Read the live commit message — the document verbatim.
  const readCommitMessage = useCallback((): string => {
    const view = textEditorRef.current?.view() ?? null;
    if (view === null) return "";
    return view.state.doc.toString();
  }, []);

  // Debounced durable save of the in-progress message ([P05]): every genuine
  // user edit schedules a `persistMessage` write, so uncommitted edits survive
  // a card deactivation / reload (the write rides the changeset draft engine,
  // whose `entry.draft.message` is the source of truth). Fired from the editor
  // update listener, so it lives outside React ([L22]).
  const commitPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCommitPersistTimer = useCallback(() => {
    if (commitPersistTimerRef.current !== null) {
      clearTimeout(commitPersistTimerRef.current);
      commitPersistTimerRef.current = null;
    }
  }, []);
  const scheduleCommitPersist = useCallback(() => {
    clearCommitPersistTimer();
    commitPersistTimerRef.current = setTimeout(() => {
      commitPersistTimerRef.current = null;
      const controller = commitModeRef.current;
      if (controller === undefined || !inCommitModeRef.current) return;
      controller.persistMessage(readCommitMessage());
    }, COMMIT_PERSIST_DEBOUNCE_MS);
  }, [clearCommitPersistTimer, readCommitMessage]);
  const commitPersistRef = useRef(scheduleCommitPersist);
  commitPersistRef.current = scheduleCommitPersist;
  useLayoutEffect(() => clearCommitPersistTimer, [clearCommitPersistTimer]);

  // Editor swap on the active transition ([L03] so the doc change lands in
  // the same paint as the mode flip). Enter: replace the (empty) composer
  // with the seed message — the message alone; the mode's dress is chrome,
  // not document content. Exit: clear back to empty. The message itself is
  // durable in the changeset draft store, so a cancel/re-enter resumes it.
  // (Entry is gated on an empty composer by the session card, so nothing is
  // clobbered here.)
  useLayoutEffect(() => {
    const editor = textEditorRef.current;
    if (editor === null) return;
    const prev = prevCommitActiveRef.current;
    prevCommitActiveRef.current = commitActive;
    if (commitActive && !prev) {
      inCommitModeRef.current = true;
      const seed =
        commitSnapRef.current?.seedMessage ??
        commitSnapRef.current?.persistedMessage ??
        "";
      editor.restoreState(buildCommitModeState(seed));
      // Seed the `data-commit-empty` gate explicitly: an empty seed over an
      // empty doc fires no update, so the listener alone can't be trusted to
      // refresh it on entry.
      rootRef.current?.setAttribute(
        "data-commit-empty",
        String(seed.trim().length === 0),
      );
      editor.focus();
    } else if (!commitActive && prev) {
      inCommitModeRef.current = false;
      clearCommitPersistTimer();
      editor.restoreState(EMPTY_EDIT_STATE);
      rootRef.current?.setAttribute("data-commit-empty", "true");
      editor.view()?.dispatch({ effects: setWaveCaretActive.of(false) });
      editor.focus();
    }
  }, [commitActive, clearCommitPersistTimer]);

  // Auto-Message stream ([P06]): the scribe's draft fills the editor live while
  // `drafting`. The editor is read-only
  // for the duration (so the user can't interfere), and a wave caret rides the
  // stream's tail in place of the (suppressed) native caret. On settle
  // (`drafting → ready`) the generated message becomes editable; on a cancel
  // (`→ idle`) or failure (`→ error`) the field reverts to the persisted
  // pre-draft message. Either way the caret is re-claimed and the wave cleared.
  const prevCommitDraftPhaseRef = useRef(commitSnap?.draftPhase ?? "idle");
  // The message being replaced, captured at drafting start so the whole
  // generation collapses to one undo step ([P06]).
  const preDraftMessageRef = useRef("");
  useLayoutEffect(() => {
    const phase = commitSnap?.draftPhase ?? "idle";
    const prevPhase = prevCommitDraftPhaseRef.current;
    prevCommitDraftPhaseRef.current = phase;
    if (!commitActive) return;
    const editor = textEditorRef.current;
    if (editor === null) return;
    const streamState = buildCommitModeState(commitSnap?.draftText ?? "");
    if (phase === "drafting") {
      // Stream ephemerally — no per-delta undo events; the settle folds the
      // whole generation into one. On the first delta, remember what we're
      // replacing and light the wave caret.
      if (prevPhase !== "drafting") {
        preDraftMessageRef.current = readCommitMessage();
        editor.restoreState(streamState, { addToHistory: false });
        editor.view()?.dispatch({ effects: setWaveCaretActive.of(true) });
      } else {
        editor.restoreState(streamState, { addToHistory: false });
      }
      // Follow the wave caret at the tail so the newest text stays in view as
      // it streams (a no-op while the message fits). Reset to the top on settle.
      const view = editor.view();
      if (view !== null) view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    } else if (prevPhase === "drafting") {
      editor.view()?.dispatch({ effects: setWaveCaretActive.of(false) });
      if (phase === "ready") {
        // One undo for the whole thing: revert to the pre-draft message with no
        // history event, then apply the final message as the single recorded
        // edit — so ⌘Z removes the generated message and ⌘⇧Z restores it.
        editor.restoreState(buildCommitModeState(preDraftMessageRef.current), {
          addToHistory: false,
        });
        editor.restoreState(buildCommitModeState(commitSnap?.draftText ?? ""));
        // Show the START of the generated message, not its tail.
        const view = editor.view();
        if (view !== null) view.scrollDOM.scrollTop = 0;
      } else {
        // Cancel / error: revert to the persisted message, leaving no undo
        // trace (the ephemeral stream never entered history).
        editor.restoreState(buildCommitModeState(commitSnap?.persistedMessage ?? ""), {
          addToHistory: false,
        });
      }
      editor.focus();
    }
  }, [
    commitActive,
    commitSnap?.draftPhase,
    commitSnap?.draftText,
    commitSnap?.persistedMessage,
    readCommitMessage,
  ]);

  // Exit commit mode (Cancel button, the Z4A commit chip, Escape): persist the
  // typed message so a re-entry resumes it, then exit. Land-success exits
  // through the controller's own path (which clears the draft first), so it
  // never routes here — the persist below only ever runs on a user cancel.
  const exitCommitMode = useCallback(() => {
    const controller = commitModeRef.current;
    if (controller === undefined) return;
    const message = readCommitMessage();
    if (message.trim().length > 0) controller.persistMessage(message);
    controller.exit();
  }, [readCommitMessage]);

  // Auto-Message ([P06]): a typed message is protected by the Replace confirm;
  // an empty field drafts straight away. Read the editor live rather than the
  // persisted `edited` flag so unsaved typing is guarded too.
  const handleCommitAutoMessage = useCallback(() => {
    const controller = commitModeRef.current;
    if (controller === undefined) return;
    // Already streaming — the button is lit but inert; ignore a re-trigger.
    if (commitDraftingRef.current) return;
    // A non-empty message is guarded by the Replace confirm; an empty field
    // regenerates straight away — and always FORCES, so the [P03] edited-gate
    // (a prior edit pins `edited=true`) never swallows a repeat request. This
    // is what makes Auto-Message repeatable across edit/clear/redo cycles.
    if (readCommitMessage().trim().length > 0) setCommitConfirmOpen(true);
    else controller.requestDraft(true);
  }, [readCommitMessage]);

  // Cancel an in-flight Auto-Message draft ([P06]) — the Z5 cancel button,
  // Escape, or Cmd-. while the scribe streams. Aborts only the scribe child
  // (never the session's turn); the terminal `cancelled` state reverts the
  // composer and drops the wave caret. Distinct from `exitCommitMode`, which
  // exits the whole mode when nothing is drafting.
  const cancelCommitDraft = useCallback(() => {
    commitModeRef.current?.cancelDraft();
  }, []);

  // In commit mode, a bare Escape exits the mode ([P03]) — captured on
  // the entry root before the editor's own keymap sees it, mirroring the retired
  // dialog's Escape ownership. A modified Escape is left alone.
  //
  // While the Auto-Message scribe streams ([P06]) the same capture-phase listener
  // takes over Escape AND Cmd-. and routes them to a DRAFT cancel — never the
  // mode exit and, crucially, never the session-turn interrupt. When a turn is
  // in flight the window-level keybinding claims CANCEL_DIALOG before this
  // listener runs; that path is handled inside the CANCEL_DIALOG responder below
  // (it also cancels the draft first). This listener is the backstop for the
  // no-turn case, where CANCEL_DIALOG is unregistered and the event reaches here.
  useLayoutEffect(() => {
    if (!commitActive) return;
    const el = rootRef.current;
    if (el === null) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      const bareEscape =
        e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const cmdPeriod =
        (e.key === "." || e.key === "Period") &&
        e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey;
      if (commitDraftingRef.current) {
        if (bareEscape || cmdPeriod) {
          e.preventDefault();
          e.stopPropagation();
          cancelCommitDraft();
        }
        return;
      }
      if (bareEscape) {
        e.preventDefault();
        e.stopPropagation();
        exitCommitMode();
      }
    };
    el.addEventListener("keydown", onKeyDown, true);
    return () => el.removeEventListener("keydown", onKeyDown, true);
  }, [commitActive, exitCommitMode, cancelCommitDraft]);

  // Shell share ([P08]). A Share click on an exchange row parks its
  // composed text on the shell store; this effect observes the slot,
  // seeds/appends the editor, and consumes. Mirrors the draft-restore
  // effect above: [L02] the slot enters via useSyncExternalStore; [L03]
  // useLayoutEffect so the doc change lands in the same paint; the slot
  // survives until an editor exists to take it (no consume on a missing
  // view), so a share is never silently dropped. Unlike draft restore, a
  // mid-compose draft is appended to, not skipped — the user asked for this
  // content explicitly.
  const pendingShellShare = useSyncExternalStore(
    shellSessionStore?.subscribe ?? NOOP_SUBSCRIBE,
    () => shellSessionStore?.getSnapshot().pendingShare ?? null,
  );
  useLayoutEffect(() => {
    if (pendingShellShare === null || shellSessionStore === undefined) return;
    const editor = textEditorRef.current;
    const view = editor?.view() ?? null;
    if (editor === null || view === null) return;
    const { from, insert } = applyShellShare(pendingShellShare.text, {
      length: view.state.doc.length,
      isEffectivelyEmpty: isEffectivelyEmpty(view),
    });
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
    });
    shellSessionStore.consumePendingShare();
    editor.focus();
  }, [pendingShellShare, shellSessionStore]);

  // Command insert ([P03]/[P04]). A click on a known slash command in the
  // transcript parks `{ name, args }` on the code-session store; this
  // effect observes the slot, seeds the editor with the atomized command —
  // a leading command atom (`name`) plus the trailing argument text —
  // focuses, and consumes. Unlike draft restore, the seed is UNCONDITIONAL
  // (no empty-guard): a click is an explicit intent to run this command,
  // and a command atom must lead at document position 0 to expand as a user
  // invocation, so `restoreState` replaces any in-progress draft. The seed
  // shape matches a typed command — `TUG_ATOM_CHAR` + a trailing space
  // (+ args) — so a clicked command is byte-identical to one accepted from
  // the `/` completion. Mirrors the share effect: [L02] slot via
  // useSyncExternalStore; [L03] useLayoutEffect so the doc change lands in
  // one paint; the slot survives until an editor exists (no consume on a
  // missing view) so a click is never silently dropped.
  const pendingCommandInsert = snap.pendingCommandInsert;
  useLayoutEffect(() => {
    if (pendingCommandInsert === null) return;
    const editor = textEditorRef.current;
    if (editor === null) return;
    const { name, args } = pendingCommandInsert;
    editor.restoreState(
      buildEditingStateFromDraftRestore(`${TUG_ATOM_CHAR} ${args}`, [
        { kind: "atom", type: "command", label: name, value: name },
      ]),
    );
    editor.focus();
    codeSessionStore.consumePendingCommandInsert();
  }, [pendingCommandInsert, codeSessionStore]);

  // Snippet insert ([P05]). A snippet dragged from the Lens onto the prompt
  // entry (or double-clicked) parks `{ text, at }` here; this effect inserts
  // the text — at the drop offset when `at` resolves, else appended (empty
  // editor takes it as-is, non-empty on a new line, the `applyShellShare`
  // rule) — then consumes. Mirrors the share effect: [L02] slot via the
  // snapshot; [L03] useLayoutEffect so the doc change lands in one paint; the
  // slot survives until an editor exists (no consume on a missing view) so a
  // drop is never silently dropped.
  const pendingSnippetInsert = snap.pendingSnippetInsert;
  useLayoutEffect(() => {
    if (pendingSnippetInsert === null) return;
    const editor = textEditorRef.current;
    const view = editor?.view() ?? null;
    if (editor === null || view === null) return;
    const { text, at } = pendingSnippetInsert;
    const offset = at !== null ? dropOffsetAtCoords(view, at.x, at.y) : null;
    let from: number;
    let insert: string;
    if (offset !== null) {
      from = offset;
      insert = text;
    } else {
      const share = applyShellShare(text, {
        length: view.state.doc.length,
        isEffectivelyEmpty: isEffectivelyEmpty(view),
      });
      from = share.from;
      insert = share.insert;
    }
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
    });
    codeSessionStore.consumePendingSnippetInsert();
    editor.focus();
  }, [pendingSnippetInsert, codeSessionStore]);

  // Code's Z5 button follows the Claude session lifecycle unchanged.
  const submitButtonMode = claudeSubmitButtonMode;
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

  // Live `!shell` auto-insert latches ([P09] companion). One flag pair per
  // draft: `inserted` marks that THIS draft's chip came from the auto path
  // (a menu/chord-seeded chip never sets it), `declined` latches once the
  // user deletes an auto-inserted chip — one backspace (or ⌘Z) means "this
  // is prose", and the chip must not nag on the next space. Both reset when
  // the editor empties (clear / submit / select-all-delete).
  const autoShellFlagsRef = useRef({ inserted: false, declined: false });

  // Substrate-level extensions installed at mount time. The
  // data-empty sync writes through a ref-tracked root element —
  // stable across renders. Extension array is captured by the
  // substrate at mount; subsequent identity changes don't propagate
  // (per the substrate's `extensions` prop contract), so we wrap in
  // `useMemo` with empty deps to avoid churn.
  const editorExtensions = useMemo(
    () => [
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
        // Commit mode ([P03]): the document is the message. Mirror its
        // emptiness to the root (`data-commit-empty` CSS-gates the Commit
        // button, [L22]) and schedule a debounced durable save of real edits —
        // skipping our own programmatic seeds / scribe stream (guarded on a
        // user event + non-drafting phase).
        if (inCommitModeRef.current) {
          const message = update.state.doc.toString();
          if (root !== null) {
            root.setAttribute(
              "data-commit-empty",
              String(message.trim().length === 0),
            );
          }
          const drafting = commitSnapRef.current?.draftPhase === "drafting";
          const userEdit = update.transactions.some(
            (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"),
          );
          if (!drafting && userEdit) commitPersistRef.current();
        }
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
        // Live `!shell` auto-insert: the moment a typed draft becomes
        // `<unambiguous PATH command><space>`, materialize the `!shell`
        // routing chip at the head — the routing decision is visible (and
        // vetoable) while the user types, instead of decided silently at
        // submit. The submit-time classifier stays as the backstop for what
        // this deliberately won't touch (ambiguous openers, env-assignment
        // prefixes, pasted lines).
        {
          const flags = autoShellFlagsRef.current;
          const doc = update.state.doc;
          if (doc.length === 0) {
            flags.inserted = false;
            flags.declined = false;
          } else if (
            flags.inserted &&
            (positioned.length === 0 ||
              positioned[0]!.position !== 0 ||
              positioned[0]!.segment.type !== "command")
          ) {
            // The auto-inserted chip is gone but the draft lives on — the
            // user deleted it (backspace or ⌘Z). Latch the decline.
            flags.inserted = false;
            flags.declined = true;
          }
          if (
            !flags.inserted &&
            !flags.declined &&
            positioned.length === 0 &&
            update.transactions.some((tr) => tr.isUserEvent("input.type")) &&
            autoShellOpener(
              doc.toString(),
              update.state.selection.main.head,
              pathCommandsStoreRef.current?.getSnapshot() ?? null,
            ) !== null
          ) {
            flags.inserted = true;
            const view = update.view;
            // Deferred dispatch — never re-enter the in-flight update. Its
            // own isolated undo step, so ⌘Z peels just the chip (and the
            // decline latch above reads that as "no, this is prose").
            queueMicrotask(() => {
              view.dispatch({
                changes: { from: 0, insert: `${TUG_ATOM_CHAR} ` },
                effects: addAtomsEffect.of([
                  {
                    position: 0,
                    segment: {
                      kind: "atom",
                      type: "command",
                      label: "shell",
                      value: "shell",
                    },
                  },
                ]),
                annotations: isolateHistory.of("full"),
                userEvent: "input.tug-atom",
              });
            });
          }
        }
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
              // gesture (the Session card raises the same sheet as `/rewind`).
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
            // One-shot `/find` highlights own the first empty-editor Escape:
            // dissolve them BEFORE the pane-collapse gesture, so Escape reads
            // as "dismiss find" while a search is live and only then as
            // "collapse the entry".
            {
              const oneShot = findSessionRef.current;
              if (oneShot !== undefined && oneShot.getSnapshot().query !== "") {
                oneShot.clear();
                return true;
              }
            }
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
      // Auto-Message wave caret ([P06]): inert until `setWaveCaretActive`
      // toggles it while the scribe streams the commit draft.
      waveCaretExtension,
    ],
    [],
  );

  // A submit that landed during the transport-settling window is
  // armed here and flushed by the effect below the moment `canSubmit`
  // flips true. See `classifyBlockedSubmit` + `performSubmit`'s
  // blocked-submit branch.
  const pendingSubmitRef = useRef(false);

  // Live refs so `performSubmit` (a stable callback) reads the shell + PATH
  // stores without widening its dep list ([L07]).
  const shellSessionStoreRef = useRef(shellSessionStore);
  shellSessionStoreRef.current = shellSessionStore;
  const pathCommandsStoreRef = useRef(pathCommandsStore);
  pathCommandsStoreRef.current = pathCommandsStore;

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

    // Commit mode ([P03]): submit lands the commit instead of sending to
    // Claude. The message is the document verbatim. `land` re-checks the gate
    // (turn / pending / empty), so an empty message or a running turn no-ops
    // here and the draft is left intact; success clears the draft and exits
    // the mode (the active-transition effect clears the editor). Nothing else
    // in this function runs.
    if (inCommitModeRef.current) {
      commitModeRef.current?.land(view.state.doc.toString());
      return;
    }

    // Submit-while-completing: if the completion popup is open with a
    // highlighted item, accept it FIRST so a submit made via the button or
    // Shift+Return commits the *completed* command / `@`-mention, not the
    // typed fragment (e.g. `/re` + Enter would otherwise send `/re`, not
    // `/rewind`). The keyboard accept (plain Enter / Tab) lives in the
    // completion keymap; this is the seam for submit paths that bypass it.
    // The accept dispatches synchronously, so the draft reads below see the
    // inserted atom. Applies uniformly to `/` commands and `@` mentions.
    editor.acceptActiveCompletion();

    // A submission dissolves any lingering one-shot `/find` highlights BEFORE
    // dispatch — a fresh `/find` re-seeds the session in the same submit
    // (clear, then the local-command surface sets the new query), so stale
    // highlights never outlive a new submission.
    {
      const oneShot = findSessionRef.current;
      if (oneShot !== undefined && oneShot.getSnapshot().query !== "") {
        oneShot.clear();
      }
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
      // Bang routings (`lib/bang-commands.ts`): a line leading with `!`
      // — a `!name` chip or typed text — routes its payload per-submission
      // (`!shell`, `!btw`, `!find`, `!history`), with `!<anything else>` the
      // shell escape hatch (`!git status` runs in the shell — and so does an
      // unregistered `!changes`). Then the local slash-command registry
      // (`/model`, `/rewind`, …). Both dispatch through the same card
      // responder; an arbitrary claude slash command falls through to
      // `send()`, and a non-command draft matches neither, so plain prose is
      // untouched.
      const localCommand =
        matchBangCommandLine(commandLine) ?? matchLocalSlashCommand(commandLine);
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
            route,
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

      // [D14] notice for a typed `/command` the session card will not run
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
              route,
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

    // Trim whitespace from both ends of the submitted command. Atoms
    // ride as `￼` placeholder characters — never whitespace — so
    // trimming only removes surrounding spaces / newlines and never
    // touches an atom, keeping the placeholder count aligned with
    // `sendAtoms`.
    const submitText = captured.text.trim();
    const sendAtoms: AtomSegment[] = positionedAtoms.map((a) => a.segment);
    // A whitespace-only draft (no atoms) trims to nothing — treat it like
    // the empty-input guard and don't send a blank turn.
    if (submitText.length === 0 && sendAtoms.length === 0) return;

    // PATH classifier ([P09]): a command-shaped, atom-free, single-line draft
    // silently routes to the shell instead of Claude — runs after the
    // slash-command intercepts, before `send`. The auto-routed row renders a
    // visible `→ shell` attribution with a one-click "send to Claude instead",
    // so a rare misroute is undoable. A null command set (not yet loaded) makes
    // the classifier answer Code — the safety net keeps the first line of a
    // session from misrouting while the set warms.
    const shellStore = shellSessionStoreRef.current;
    if (
      shellStore !== undefined &&
      sendAtoms.length === 0 &&
      !submitText.includes("\n") &&
      classifyShellLine(submitText, pathCommandsStoreRef.current?.getSnapshot() ?? null)
    ) {
      shellStore.exec(submitText, { origin: "auto" });
      // Auto-routed submissions were typed as Code input, so record the raw
      // line under the Code route ([P11]).
      const sessionId = snapRef.current.tugSessionId;
      historyStore.push({
        id: `${sessionId}-${Date.now()}`,
        sessionId,
        projectPath: "",
        route,
        text: captured.text,
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

    codeSessionStore.send(wireText, wireAtoms);
    // Record the submission in per-session history, keyed by the
    // session's id. The route field pins to Code so the Code provider
    // recalls it ([P11]). Captured before clear so the live state is
    // still the submitted content.
    const sessionId = snapRef.current.tugSessionId;
    historyStore.push({
      id: `${sessionId}-${Date.now()}`,
      sessionId,
      projectPath: "",
      route,
      text: captured.text,
      atoms: positionedAtoms.map((a) => ({
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

  // [L07] Register the responder node.
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
      // ⌘G / ⇧⌘G — advance / retreat the active match. Gated on the SESSION
      // holding matches (not on the ⌕ route): a one-shot `/find` leaves live
      // matches on the Code route and ⌘G keeps cycling them. The transcript
      // host reacts to the active-index change (scroll + flash).
      [TUG_ACTIONS.FIND_NEXT]: () => {
        const session = findSessionRef.current;
        if (session !== undefined && session.getSnapshot().count > 0) {
          session.next();
        }
      },
      [TUG_ACTIONS.FIND_PREVIOUS]: () => {
        const session = findSessionRef.current;
        if (session !== undefined && session.getSnapshot().count > 0) {
          session.previous();
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
          codeSessionStore.popInteractive();
        } else {
          performSubmit();
        }
      },
      ...(snap.canInterrupt && !snap.interruptInFlight
        ? {
            [TUG_ACTIONS.CANCEL_DIALOG]: (_event: ActionEvent) => {
              // While the Auto-Message scribe streams ([P06]), Escape / Cmd-.
              // cancel the DRAFT — never the running turn. This handler is
              // reached first (a turn is in flight, so the window keybinding
              // claims CANCEL_DIALOG here), so intercepting drafting BEFORE
              // `popInteractive` is what keeps the cancel from leaking into the
              // session. The backend aborts only the scribe child.
              if (commitDraftingRef.current) {
                cancelCommitDraft();
                return;
              }
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
        route,
        draft,
        attachmentBytes,
      };
    },
    onRestore: (raw, { isActive }) => {
      const restored = coerceRestorePayload(raw);
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
  // Seed (or replace) the leading command chip ([P07]) — the shared sink for
  // the ⌃⌘ chords, the picker menu, and the delegate method.
  const seedCommandChip = useCallback((name: string) => {
    const editor = textEditorRef.current;
    if (editor === null) return;
    editor.restoreState(computeCommandChipInsert(editor.captureState(), name));
    editor.focus();
  }, []);

  // Command picker ([P06], revised): open the Z4A menu of the four demoted
  // commands. The menu is a `TugPopupMenu` whose trigger is the Z4A button; ⌘/
  // opens it by focusing that trigger and dispatching a bubbling `Enter`
  // keydown — the Radix trigger opens on Enter/Space/Arrow, not on a bare
  // programmatic `.click()` (which fires no pointerdown). The menu shows each
  // command's ⌃⌘ chord so it teaches the shortcuts over time.
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openCommandPicker = useCallback(() => {
    const trigger = pickerTriggerRef.current;
    if (trigger === null) return;
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        textEditorRef.current?.focus();
      },
      openCommandPicker() {
        openCommandPicker();
      },
      blur() {
        const view = textEditorRef.current?.view();
        view?.contentDOM.blur();
      },
      clear() {
        textEditorRef.current?.clear();
      },
      isEmpty() {
        return isEffectivelyEmpty(textEditorRef.current?.view() ?? null);
      },
      insertCommandChip(name: string) {
        seedCommandChip(name);
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
    [openCommandPicker, seedCommandChip],
  );

  // Compose rootRef + responderRef onto the same DOM element.
  const composedRootRef = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  /*
   * Shell-slot occupants, hoisted so the {@link TugEntryShell} tag below
   * stays readable. Zone semantics (Z4C accessory strip, Z4A route popup,
   * Z4B indicators, Z5 buttons) are unchanged — the shell owns only the
   * layout positions.
   */
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
  const entryAccessoryRow =
    composeImageAtoms.length > 0 ? (

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
    ) : undefined;

  // Z4A leading slot — the routing picker ([P06], revised): a `!`-glyph
  // `TugPopupMenu` trigger. The `!` is the honest sigil — this button picks a
  // *routing* (where the input goes), not a slash command (what to do) — and
  // matches the `!name` chips picking one seeds. The menu lists ONLY the four
  // bang routings with their ⌃⌘ chord labels (the teaching surface). `⌘/`
  // opens the same menu by activating this trigger. Keeps the leading-slot
  // focus-group registration so the keyboard cycle's walk is unchanged; sets
  // no persistent state.
  //
  // In commit mode ([P03]) the button stays in place — the slot must not
  // shift — but disabled: routings are meaningless while composing a commit
  // message, and the Z5 ✕ is the mode's way out, so Z4A carries no exit of
  // its own.
  const entryRoutePopup = (
    <TugPopupMenu
      side="top"
      align="start"
      items={COMMAND_PICKER_ITEMS.map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        shortcut: item.shortcut,
      }))}
      onSelect={seedCommandChip}
      trigger={
        <TugButton
          ref={pickerTriggerRef}
          className="tug-prompt-entry-command-picker"
          emphasis="filled"
          role="accent"
          size="lg"
          subtype="icon"
          disabled={commitActive}
          icon={
            <span className="tug-prompt-entry-bang-glyph" aria-hidden="true">
              !
            </span>
          }
          aria-label="Route this input"
          focusGroup={routeFocusGroup}
          focusOrder={routeFocusOrder}
        />
      }
    />
  );

  const entryToolbarTrailing = (
    <>
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
              focusGroup={submitFocusGroup}
              focusOrder={submitFocusOrder}
              role={submitView.danger ? "danger" : "action"}
              disabled={submitView.disabled}
              aria-label={submitView.ariaLabel}
              icon={
                submitView.icon === "stop" ? (
                  <Square size={14} strokeWidth={3} />
                ) : (
                  <ArrowUp size={16} strokeWidth={2.5} />
                )
              }
            />
    </>
  );

  // ── Commit-mode chrome ([P03], Z5 icon rail) ─────────────────────────────
  // Z5: cancel / auto-message / commit, all icons ([P03]). Cancel exits the
  // mode (danger), Auto-Message drafts (pencil-sparkles; a spinner + disabled
  // while drafting), Commit lands — JS-disabled on the turn/pending/changeset
  // gate, and additionally dimmed by CSS when the message is empty
  // (`data-empty`, so no per-keystroke React state, [L22]).
  const commitPending = commitSnap?.commitPhase === "pending";
  const commitToolbarTrailing = (
    <>
      <TugPushButton
        className="tug-prompt-entry-commit-cancel"
        subtype="icon"
        size="lg"
        emphasis="outlined"
        role="danger"
        // While drafting, the X cancels the Auto-Message (not the whole mode);
        // otherwise it exits commit mode ([P06]).
        onClick={commitDrafting ? cancelCommitDraft : exitCommitMode}
        aria-label={commitDrafting ? "Cancel auto-message" : "Cancel commit"}
        title={commitDrafting ? "Cancel auto-message" : undefined}
        icon={<X size={16} strokeWidth={2.5} />}
      />
      <TugPushButton
        className="tug-prompt-entry-commit-auto"
        subtype="icon"
        size="lg"
        // Stays lit for the whole composition ([P06]): the button becomes a
        // real filled accent button while the scribe streams (its own tokens,
        // not a hand-rolled pose), and `data-drafting` neutralizes pointer
        // input (CSS) so a click can't re-request.
        emphasis={commitDrafting ? "filled" : "outlined"}
        role="accent"
        data-drafting={commitDrafting ? "" : undefined}
        aria-pressed={commitDrafting || undefined}
        onClick={handleCommitAutoMessage}
        aria-label="Auto-message"
        title={commitDrafting ? "Composing…" : "Generate a commit message"}
        data-testid="tug-prompt-entry-commit-auto"
        icon={<PencilSparkles size={16} strokeWidth={2} />}
      />
      <TugPushButton
        className="tug-prompt-entry-commit-button"
        subtype="icon"
        size="lg"
        emphasis="filled"
        role="action"
        disabled={
          commitDrafting ||
          commitPending ||
          commitSnap === null ||
          !commitSnap.canLandIgnoringMessage
        }
        onClick={performSubmit}
        aria-label="Commit"
        title={
          commitSnap !== null && !commitSnap.canLandIgnoringMessage
            ? "Unavailable while a turn is running or the changeset is empty"
            : undefined
        }
        data-testid="tug-prompt-entry-commit-button"
        icon={<ArrowUp size={16} strokeWidth={2.5} />}
      />
    </>
  );

  // Render the status row only when there is something to put in it.
  const hasStatusRow =
    statusContent !== undefined || cautionContent !== undefined;

  return (
      <ResponderScope>
        <TugEntryShell
          // The shell's forwarded root ref carries BOTH the entry's own
          // rootRef (the substrate's `data-empty` bridge writes through it
          // per [L22]) and the responder-chain registration.
          ref={composedRootRef}
          data-slot="tug-prompt-entry"
          data-snippet-drop-target=""
          data-phase={snap.phase}
          data-can-interrupt={String(snap.canInterrupt)}
          data-can-submit={String(snap.canSubmit)}
          data-errored={snap.lastError ? "" : undefined}
          data-pending-approval={snap.pendingApproval ? "" : undefined}
          data-pending-question={snap.pendingQuestion ? "" : undefined}
          data-empty="true"
          data-commit-empty="true"
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
          statusRow={
            hasStatusRow ? (
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
            ) : undefined
          }
          inputAreaClassName="tug-prompt-entry-input-area"
          inputAreaRef={editorStopRef as (el: HTMLDivElement | null) => void}
          inputAreaTabIndex={editorFocusGroup !== undefined ? -1 : undefined}
          accessoryRow={entryAccessoryRow}
          toolbarClassName="tug-prompt-entry-toolbar"
          toolbarLeading={entryRoutePopup}
          toolbarCenter={indicatorsContent}
          toolbarTrailing={commitActive ? commitToolbarTrailing : entryToolbarTrailing}
        >
            <TugTextEditor
              ref={textEditorRef}
              borderless
              // Auto-height: opens at the host's `--tug-text-editor-min-height`
              // (the Session card sets 200px), grows with content up to its
              // height cap, then scrolls. The cap is `maxRows` rows by
              // default; a host may override the scroller's `max-height`
              // (the Session card caps by card height instead — see
              // `session-card.css` — so the gallery prompt keeps the 20-row cap
              // while the Dev prompt scrolls at a fraction of the card).
              maxRows={20}
              // In commit mode the field is a plain-prose message editor:
              // read-only while the scribe streams a draft, and the slash / bang
              // / mention / argument machinery stands down (submit lands the
              // commit; a `/` popup would be nonsense).
              disabled={deactivated || commitDrafting}
              placeholder={
                commitActive
                  ? "Write a commit message, or use Auto-Message."
                  : placeholder ?? ""
              }
              completionProviders={commitActive ? undefined : completionProviders}
              argumentHintResolver={commitActive ? undefined : argumentHintResolver}
              argumentHintRefresh={argumentHintRefresh}
              pastedCommandResolver={commitActive ? undefined : pastedCommandResolver}
              inlineCommandMatcher={commitActive ? undefined : inlineCommandMatcher}
              dropHandler={dropHandler}
              attachmentBytesStore={attachmentBytesStore}
              onAttachmentError={publishAttachmentError}
              historyProvider={currentHistoryProvider}
              // Code Return semantics: Return inserts a newline; Shift+Return
              // (or the Z5 button) submits. A host override wins when supplied.
              returnAction={returnActionOverride ?? "newline"}
              numpadEnterAction={numpadEnterAction}
              lineWrap={lineWrap}
              lineNumbers={lineNumbers}
              highlightActiveLineGutter={highlightActiveLineGutter}
              // Code is prose to Claude, so light markdown styling stays on.
              markdownTextStyling
              onSubmit={performSubmit}
              extensions={editorExtensions}
              /* State preservation is owned by TugPromptEntry. Disable
                 the substrate's registration so only one component
                 claims the single CardStatePreservationContext slot. */
              preserveState={false}
            />
        </TugEntryShell>
        {/* Replace-message confirm ([P03]): guards a typed commit message from
            an Auto-Message overwrite, anchored on the pencil-sparkles button. */}
        {commitActive ? (
          <TugConfirmPopover
            open={commitConfirmOpen}
            anchorEl={
              rootRef.current?.querySelector<HTMLElement>(
                '[data-testid="tug-prompt-entry-commit-auto"]',
              ) ?? rootRef.current
            }
            // Pop above the Auto-Message button with a pointer aimed at it, so
            // the confirm reads as belonging to that control ([P06]).
            side="top"
            arrow
            message="Replace message?"
            confirmLabel="OK"
            confirmRole="danger"
            onConfirm={() => {
              setCommitConfirmOpen(false);
              commitModeRef.current?.requestDraft(true);
            }}
            onCancel={() => setCommitConfirmOpen(false)}
          />
        ) : null}
      </ResponderScope>
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
