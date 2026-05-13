/**
 * `useBlockFindSession` — find-row state for body-kind blocks.
 *
 * A consumer of the framework focus axis ([D95] engine-vs-framework
 * focus boundary), not a primitive. Encapsulates the state machine,
 * focus discipline, reload-survival slot, and `data-tug-focus-key`
 * composition that any block with a "Find in body" row would
 * otherwise hand-roll. FileBlock, DiffBlock, and TerminalBlock all
 * use this hook so the row's behavior is single-sourced; future
 * block authors who need an in-card find UI follow the same pattern.
 *
 * What this hook owns:
 *
 *   - **State.** `{ open, query, caseSensitive, regexp, wholeWord }`.
 *     `matchCount` is a separate axis the host writes via
 *     `setMatchCount` after pushing the query to its substrate (CM6
 *     for FileBlock, the diff editor for DiffBlock, etc.) — the hook
 *     stays substrate-agnostic.
 *   - **Reload survival.** When the host passes a
 *     `componentStatePreservationKey`, the hook registers a slot in
 *     `bag.components` via `useComponentStatePreservation` and seeds
 *     `useState` from the saved value via `useSavedComponentState`
 *     ([A9] mount-in-saved-state). After Developer > Reload the row
 *     re-mounts in the same `open` / `query` / options state the user
 *     left it in.
 *   - **Focus discipline.** Two paths, matching the in-main behavior
 *     of `5f840431`:
 *       1. **First open** (open flips false→true). The input doesn't
 *          exist yet at the moment `open()` fires; a
 *          `useLayoutEffect` keyed on `open` lands focus + select on
 *          the freshly-mounted input.
 *       2. **Repeated Cmd-F** (open already true). The effect dep
 *          doesn't change, so `open()` calls `focus()` + `select()`
 *          directly on the live input ref. Same behavior Safari /
 *          VS Code / Xcode ship.
 *     Both paths are synchronous to the keystroke ([L05] no rAF, no
 *     setTimeout) and read the live ref at fire time ([L07]).
 *   - **`data-tug-focus-key` composition.** The input's stamped key
 *     is `"<scope>/<componentStatePreservationKey>"` when the host
 *     supplies a preservation key; just `"<scope>"` otherwise. The
 *     namespace lets two FileBlocks in the same card (different
 *     `componentStatePreservationKey` values) have distinct
 *     focus-survival targets without colliding on the bare scope.
 *   - **Action handlers.** Returns a `Partial<Record<TugAction,
 *     ActionHandler>>` covering `FIND` / `FIND_NEXT` /
 *     `FIND_PREVIOUS`. The host spreads this into its
 *     `useResponder`-style registration (typically the block's own
 *     responder so the chain walk from inside the find row reaches
 *     these handlers).
 *   - **Form responder.** A `useResponderForm` instance binds the
 *     three option checkboxes (`caseSensitive` / `regexp` /
 *     `wholeWord`) to setters, declared as a child of the host's
 *     responder (`parentResponderId`) so chain walks from inside the
 *     find row reach `FIND_NEXT` / `FIND_PREVIOUS`.
 *
 * What the host owns (and the hook deliberately does NOT touch):
 *
 *   - **Substrate query push.** Pushing `{ search, caseSensitive,
 *     regexp, wholeWord }` into the block's editor / scroller / grid
 *     is substrate-specific. The host watches `session.state` in its
 *     own `useLayoutEffect`, pushes to the substrate, reads back the
 *     match count, and calls `session.setMatchCount(n)`.
 *   - **Navigation impls.** The hook owns the empty-query guard
 *     (Next/Prev with no query is a silent no-op) but delegates the
 *     actual match-advance to the host via `navigation.findNext` /
 *     `navigation.findPrevious`. CM6's `findNext` / a diff editor's
 *     search-extension call stays out of this file.
 *   - **Close-side substrate cleanup.** When the row closes the hook
 *     calls `navigation.clearSearch?.()` so the host can drop its
 *     substrate-side query + highlights. The hook does not assume
 *     the substrate even has a clear concept.
 *   - **Pre-open work.** Some hosts (FileBlock) need to disengage
 *     follow-bottom and uncollapse before the row mounts. The hook
 *     exposes `onBeforeOpen` for those pre-actions; the action
 *     handler and the `open()` callback both invoke it before
 *     flipping the open flag.
 *   - **Responder registration.** The hook calls `useResponderForm`
 *     for the checkbox bindings but the host registers its own
 *     responder (typically with the same `parentResponderId`) so
 *     `actions` flow from the chain to the host. The host's
 *     responder owns the bigger lifecycle (e.g. opening the row when
 *     `FIND` arrives from Cmd-F).
 *
 * Tuglaws cross-check:
 *
 *   - [L02] no external store enters via this hook; saved state
 *     reads route through `useSavedComponentState`'s built-in
 *     `useSyncExternalStore`.
 *   - [L03] focus discipline uses `useLayoutEffect`, not
 *     `useEffect`, so the focus call lands before the browser paints.
 *   - [L06] open / query / options are React state because they
 *     control *what* is rendered (the row mounts conditionally on
 *     `open`); appearance changes (hover, focus-within) stay in CSS.
 *   - [L11] controls inside the find row dispatch actions to the
 *     host's responder via the form's `useResponderForm` binding
 *     ([L07]: handlers register once at mount, read state through
 *     refs).
 *   - [L19] file pair with the component (`tug-block-find-row.tsx`),
 *     module docstring, exported types.
 *   - [L20] the hook itself touches no CSS tokens; the row component
 *     owns the `--tugx-block-find-*` family.
 *   - [D95] engine-vs-framework focus boundary — the
 *     `data-tug-focus-key` axis the hook composes is the framework
 *     axis; the host's content-owning card's engine focus rides
 *     `bag.content` separately.
 *
 * @module components/tugways/internal/use-block-find-session
 */

import React from "react";

import { TUG_ACTIONS, type TugAction } from "@/components/tugways/action-vocabulary";
import type {
  ActionHandler,
} from "@/components/tugways/responder-chain";
import {
  useResponderForm,
  type UseResponderFormResult,
} from "@/components/tugways/use-responder-form";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "@/components/tugways/use-component-state-preservation";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The literal query payload a host pushes into its substrate. All
 * four fields move together; the host serializes them in whatever
 * shape its substrate expects (CM6's `setSearchQuery`, a diff
 * editor's `setQuery`, etc.).
 */
export interface BlockFindQuery {
  /** The user-typed search string. Empty string clears the query. */
  search: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

/**
 * Reload-survival shape for `bag.components`. Everything except
 * `matchCount` (which is substrate-derived) is captured.
 */
interface PreservedFindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

/** Host-supplied navigation hooks. */
export interface BlockFindNavigation {
  /** Advance to the next match. Called after the hook's empty-query guard. */
  findNext: () => void;
  /** Retreat to the previous match. Called after the hook's empty-query guard. */
  findPrevious: () => void;
  /**
   * Optional. Called when the row closes so the host can drop its
   * substrate-side search state (CM6's `clearSearch`, a diff editor's
   * `clearQuery`, etc.). Omitted for substrates with no clear concept.
   */
  clearSearch?: () => void;
}

/** Options the host passes to the hook. */
export interface UseBlockFindSessionOptions {
  /**
   * Scope identifier — composes into `data-tug-focus-key` so two
   * blocks with distinct scopes can't collide on the bare key. e.g.
   * `"file-block-find"`, `"diff-block-find"`,
   * `"terminal-block-find"`.
   */
  scope: string;

  /**
   * Component-state-preservation key the host (FileBlock,
   * DiffBlock, etc.) is using for its own slot. When supplied:
   *
   *   - The hook registers `<key>/<scope>` in `bag.components` so
   *     `{ open, query, caseSensitive, regexp, wholeWord }` survive
   *     Developer > Reload via [A9] mount-in-saved-state.
   *   - The composed `data-tug-focus-key` becomes
   *     `"<scope>/<componentStatePreservationKey>"`, namespacing per
   *     block instance so two FileBlocks in the same card don't
   *     collide.
   *
   * When `undefined` the hook stays a pure-React state machine —
   * the row's `open` state is React-only (no preservation), and the
   * focus-key falls back to bare `<scope>`. Gallery / standalone
   * usage routes through this branch.
   */
  componentStatePreservationKey?: string;

  /**
   * Stable id of the host's own responder. The hook's
   * `useResponderForm` (for the option checkboxes) registers as a
   * child of this responder so chain walks from inside the row
   * reach the host's `FIND_NEXT` / `FIND_PREVIOUS` handlers.
   *
   * Pass `null` to register the form at the same level as the host's
   * `ResponderParentContext` — appropriate when the host has no
   * dedicated responder and the chain walks past the row directly to
   * an ancestor.
   */
  parentResponderId?: string | null;

  /** Substrate-specific navigation. See {@link BlockFindNavigation}. */
  navigation: BlockFindNavigation;

  /**
   * Optional pre-open work the host wants to run synchronously
   * before the row mounts. FileBlock uses this to disengage
   * follow-bottom on the host scrollport, uncollapse the body so the
   * substrate is mounted (the query has somewhere to apply), and
   * promote the host's responder to first-responder so Cmd-F-after-
   * click walks from the right node.
   *
   * Fires from both `session.open()` and the `FIND` action handler.
   * Idempotent if the row is already open.
   */
  onBeforeOpen?: () => void;
}

/** Live state the host reads. */
export interface BlockFindSessionState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

/** Return value from the hook — everything the row component and host need. */
export interface BlockFindSession {
  /** Live state. Read this in render and effects. */
  state: BlockFindSessionState;
  /** Substrate-derived match count. The host writes this via {@link setMatchCount}. */
  matchCount: number;
  /**
   * Set the match count after pushing the query to the substrate.
   * The host typically does this in a `useLayoutEffect` keyed on
   * `state.open` + query / options fields.
   */
  setMatchCount: (n: number) => void;

  /**
   * Open the row. Fires `onBeforeOpen` (if supplied), flips `open`
   * to true, and focuses + selects the input (covers both the
   * first-open and repeated-Cmd-F paths).
   */
  open: () => void;
  /**
   * Close the row. Resets `{ query, caseSensitive, regexp,
   * wholeWord, matchCount }` to defaults so the next open is a fresh
   * session. Calls `navigation.clearSearch?.()` so the host can drop
   * substrate-side search state.
   */
  close: () => void;
  /**
   * Wipe the query but keep the row open and refocus the input.
   * Mirrors the first-stage of the two-step Escape semantics.
   */
  clear: () => void;
  /**
   * Find next match (empty-query guard applied; no-op when query is
   * empty so a Next keystroke doesn't accidentally seed a query from
   * the surrounding selection via the substrate's panel-from-selection
   * fallback).
   */
  next: () => void;
  /** Find previous match (same empty-query guard). */
  previous: () => void;

  /**
   * Action map for the host's responder. Spread into the host's
   * `useResponder({ actions: { ...session.actions, ... } })` so
   * Cmd-F / Cmd-G / Shift-Cmd-G keystrokes reach the find row.
   */
  actions: Partial<Record<TugAction, ActionHandler>>;

  /**
   * Form responder for the option checkboxes. Wrap the row's JSX in
   * `<session.findForm.ResponderScope>` and attach
   * `session.findForm.responderRef` to the row's root.
   */
  findForm: UseResponderFormResult;

  // ---- *Props spreads for the row component --------------------------------

  /** Spread onto the find input. Includes the focus-key, ref, value, change, keydown handlers. */
  inputProps: {
    ref: React.RefCallback<HTMLInputElement>;
    value: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    "data-tug-focus-key": string;
    "aria-label"?: string;
  };

  /** Whether the inline clear-X button should render (true iff query is non-empty). */
  showClear: boolean;
  /** onClick for the clear-X button. */
  clearButtonProps: {
    onClick: () => void;
  };

  /** Spread onto the previous-match icon button. */
  previousButtonProps: {
    onClick: () => void;
    disabled: boolean;
  };
  /** Spread onto the next-match icon button. */
  nextButtonProps: {
    onClick: () => void;
    disabled: boolean;
  };
  /** Spread onto the Done push button. */
  doneButtonProps: {
    onClick: () => void;
  };

  /** Spread onto the case-sensitive checkbox. */
  caseSensitiveCheckboxProps: {
    senderId: string;
    checked: boolean;
  };
  /** Spread onto the regex checkbox. */
  regexpCheckboxProps: {
    senderId: string;
    checked: boolean;
  };
  /** Spread onto the whole-word checkbox. */
  wholeWordCheckboxProps: {
    senderId: string;
    checked: boolean;
  };

  /**
   * Keydown handler to attach to the row's root. Catches Escape at
   * the row level so any focused descendant (checkboxes, buttons)
   * can dismiss with the two-step semantics (clear-then-close).
   */
  rowKeyDownHandler: (event: React.KeyboardEvent) => void;

  /**
   * The composed `data-tug-focus-key` value. Exposed so tests and
   * the row can assert / cross-reference what the input is stamped
   * with.
   */
  focusKey: string;

  /** Pre-formatted match-count label ("", "no matches", "1 match", "N matches"). */
  matchCountLabel: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const DEFAULT_PRESERVED_STATE: PreservedFindState = {
  open: false,
  query: "",
  caseSensitive: false,
  regexp: false,
  wholeWord: false,
};

/**
 * Compose the `data-tug-focus-key` value.
 *
 *  - With a preservation key: `"<scope>/<key>"`. Two instances under
 *    the same card with different preservation keys get distinct
 *    focus targets — the framework axis can resolve each
 *    independently on cmd-tab / card-switch / reload.
 *  - Without a preservation key: bare `<scope>`. Two instances in
 *    the same card without preservation keys would collide; this
 *    degradation is acceptable in gallery and standalone usage where
 *    only one instance exists in practice.
 */
function composeFocusKey(scope: string, key: string | undefined): string {
  if (key === undefined || key === "") return scope;
  return `${scope}/${key}`;
}

export function useBlockFindSession(
  options: UseBlockFindSessionOptions,
): BlockFindSession {
  const {
    scope,
    componentStatePreservationKey,
    parentResponderId,
    navigation,
    onBeforeOpen,
  } = options;

  // ---- Mount-in-saved-state ([A9]) -----------------------------------------
  //
  // Read the saved find session at mount via useSyncExternalStore inside
  // `useSavedComponentState`. The slot key is the host's preservation key
  // suffixed with `/${scope}` so the host's own preservation slot and the
  // find row's preservation slot don't collide.
  const findSessionStateKey =
    componentStatePreservationKey === undefined
      ? undefined
      : `${componentStatePreservationKey}/${scope}`;
  const saved = useSavedComponentState<PreservedFindState>(findSessionStateKey);

  // Snapshot the saved value at mount so it doesn't drift if a later
  // capture re-writes it while the row is still mid-mount. After the
  // first render the React state below is the source of truth ([D72]).
  const initial = saved ?? DEFAULT_PRESERVED_STATE;

  const [open, setOpen] = React.useState<boolean>(initial.open);
  const [query, setQuery] = React.useState<string>(initial.query);
  const [caseSensitive, setCaseSensitive] = React.useState<boolean>(
    initial.caseSensitive,
  );
  const [regexp, setRegexp] = React.useState<boolean>(initial.regexp);
  const [wholeWord, setWholeWord] = React.useState<boolean>(initial.wholeWord);
  const [matchCount, setMatchCount] = React.useState<number>(0);

  // Register the preservation slot. captureState always reads the
  // freshest values via closure-over-React-state — the framework
  // re-evaluates the callback at every save trigger.
  useComponentStatePreservation<PreservedFindState>({
    componentStatePreservationKey: findSessionStateKey,
    captureState: () => ({ open, query, caseSensitive, regexp, wholeWord }),
  });

  // ---- Refs for stable callbacks ------------------------------------------
  //
  // The input ref backs the focus-discipline `useLayoutEffect` and the
  // direct focus calls in `open()`. Refs to `query` and `matchCount`
  // are NOT needed — handlers below close over them and React's
  // useCallback dep arrays handle the freshness. Only the input ref
  // is truly imperative.
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // RefCallback so the host's row component can compose the input's
  // ref with whatever it spreads in. Stable across renders so React
  // doesn't re-attach on every render.
  const inputRefCallback = React.useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
  }, []);

  // ---- Open / close / clear ------------------------------------------------
  //
  // open() handles both paths (first open + repeated Cmd-F):
  //  - First open: setOpen(true) commits; the row mounts; the
  //    useLayoutEffect below fires and lands focus + select on the
  //    freshly-mounted input.
  //  - Already open: setOpen(true) is a no-op; the effect doesn't
  //    re-run; the direct focus + select calls below land the cursor
  //    back on the live input ref (matching Safari / VS Code / Xcode).
  // Both paths fire onBeforeOpen first (uncollapse, follow-bottom
  // release, first-responder promotion — all host-specific).
  const open_ = React.useCallback(() => {
    onBeforeOpen?.();
    setOpen(true);
    // Synchronous focus + select for the already-open path. The
    // first-open path picks this up too — the input ref is null,
    // the optional chaining no-ops, and the useLayoutEffect below
    // covers it after commit.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [onBeforeOpen]);

  // useLayoutEffect runs after commit but before paint, so the
  // input ref is set by the time we focus. The early-return on
  // !open guards the close path so we don't focus a stale ref or
  // an unmounted node.
  React.useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setCaseSensitive(false);
    setRegexp(false);
    setWholeWord(false);
    setMatchCount(0);
    navigation.clearSearch?.();
  }, [navigation]);

  const clear = React.useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  // ---- Navigation with empty-query guard ---------------------------------
  //
  // Empty query → no-op. Substrate-side search panels (CM6's
  // openSearchPanel fallback) re-seed the query from the surrounding
  // selection when given an invalid query, which would resurrect the
  // prior query the user just cleared. Guarding here gives intuitive
  // no-op behavior.
  const next = React.useCallback(() => {
    if (query.length === 0) return;
    navigation.findNext();
  }, [navigation, query.length]);
  const previous = React.useCallback(() => {
    if (query.length === 0) return;
    navigation.findPrevious();
  }, [navigation, query.length]);

  // ---- Action handlers (responder chain) ---------------------------------
  //
  // The host registers its own responder with these handlers spread
  // into its `actions` map. Stable identities for [L07]: the responder
  // is registered ONCE at mount with stable handler references; the
  // refs below carry the live closures.
  const openRef = React.useRef(open_);
  const nextRef = React.useRef(next);
  const previousRef = React.useRef(previous);
  React.useLayoutEffect(() => {
    openRef.current = open_;
    nextRef.current = next;
    previousRef.current = previous;
  }, [open_, next, previous]);

  const actions = React.useMemo<Partial<Record<TugAction, ActionHandler>>>(
    () => ({
      [TUG_ACTIONS.FIND]: () => {
        openRef.current();
      },
      [TUG_ACTIONS.FIND_NEXT]: () => {
        nextRef.current();
      },
      [TUG_ACTIONS.FIND_PREVIOUS]: () => {
        previousRef.current();
      },
    }),
    [],
  );

  // ---- Form responder for the option checkboxes -------------------------
  //
  // The three checkboxes dispatch `toggle` actions through the
  // responder chain to the form's setters. Registered as a child of
  // the host's responder (`parentResponderId`) so chain walks from
  // inside the row reach the host's `FIND_NEXT` / `FIND_PREVIOUS`
  // handlers via the parent.
  const caseId = React.useId();
  const regexpId = React.useId();
  const wordId = React.useId();
  const findForm = useResponderForm({
    parentId: parentResponderId,
    toggle: {
      [caseId]: setCaseSensitive,
      [regexpId]: setRegexp,
      [wordId]: setWholeWord,
    },
  });

  // ---- Keyboard handlers ------------------------------------------------
  //
  // Two-step Escape semantics on the input:
  //  1. First press with non-empty query → clear (keep row open).
  //  2. Second press with empty query → close the row.
  // Matches VS Code / Xcode. Enter / Shift-Enter advance with the
  // empty-query guard.
  const handleInputKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (query.length > 0) {
          clear();
        } else {
          close();
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (query.length === 0) return;
        if (event.shiftKey) {
          previousRef.current();
        } else {
          nextRef.current();
        }
      }
    },
    [clear, close, query.length],
  );

  // Row-level keydown catches Escape from any descendant (checkboxes,
  // buttons) so the user can dismiss with Esc no matter where focus
  // landed. Same two-step semantics.
  const rowKeyDownHandler = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (query.length > 0) {
        clear();
      } else {
        close();
      }
    },
    [clear, close, query.length],
  );

  // ---- Match count label ------------------------------------------------
  const matchCountLabel = React.useMemo<string>(() => {
    if (query.length === 0) return "";
    if (matchCount === 0) return "no matches";
    if (matchCount === 1) return "1 match";
    return `${matchCount.toLocaleString()} matches`;
  }, [matchCount, query.length]);

  // ---- Compose return value --------------------------------------------
  const focusKey = composeFocusKey(scope, componentStatePreservationKey);

  const inputProps = React.useMemo(
    () => ({
      ref: inputRefCallback,
      value: query,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(event.target.value);
      },
      onKeyDown: handleInputKeyDown,
      "data-tug-focus-key": focusKey,
    }),
    [focusKey, handleInputKeyDown, inputRefCallback, query],
  );

  const showClear = query.length > 0;
  const clearButtonProps = React.useMemo(() => ({ onClick: clear }), [clear]);
  const nextDisabled = matchCount === 0;
  const previousButtonProps = React.useMemo(
    () => ({ onClick: previous, disabled: nextDisabled }),
    [previous, nextDisabled],
  );
  const nextButtonProps = React.useMemo(
    () => ({ onClick: next, disabled: nextDisabled }),
    [next, nextDisabled],
  );
  const doneButtonProps = React.useMemo(() => ({ onClick: close }), [close]);

  const caseSensitiveCheckboxProps = React.useMemo(
    () => ({ senderId: caseId, checked: caseSensitive }),
    [caseId, caseSensitive],
  );
  const regexpCheckboxProps = React.useMemo(
    () => ({ senderId: regexpId, checked: regexp }),
    [regexp, regexpId],
  );
  const wholeWordCheckboxProps = React.useMemo(
    () => ({ senderId: wordId, checked: wholeWord }),
    [wholeWord, wordId],
  );

  return {
    state: { open, query, caseSensitive, regexp, wholeWord },
    matchCount,
    setMatchCount,
    open: open_,
    close,
    clear,
    next,
    previous,
    actions,
    findForm,
    inputProps,
    showClear,
    clearButtonProps,
    previousButtonProps,
    nextButtonProps,
    doneButtonProps,
    caseSensitiveCheckboxProps,
    regexpCheckboxProps,
    wholeWordCheckboxProps,
    rowKeyDownHandler,
    focusKey,
    matchCountLabel,
  };
}
