/**
 * `TugBlockFindRow` — UI for a block's in-body find row.
 *
 * The visual half of the find-row primitive pair. State, focus
 * discipline, key composition, and action handlers live in
 * `useBlockFindSession`; this component renders the row's markup
 * composed from Tug primitives (`TugInput`, `TugIconButton`,
 * `TugCheckbox`, `TugPushButton`) and ships the
 * `--tugx-block-find-*` token slot family.
 *
 * Markup contract:
 *
 *   - Sticky container (`position: sticky` keyed off
 *     `--tugx-block-find-top` so the host can compose its own
 *     telescoping-pin chain — for FileBlock that's
 *     `pin-stack-top + toolblock-header-height + file-header-height`,
 *     for DiffBlock / TerminalBlock the host writes its own stack).
 *   - `<TugInput>` (borderless, sm) wrapped in `.tugx-block-find-input-wrap`
 *     so the inline clear-X button can sit inside the field bounds.
 *   - prev / next icon buttons (ChevronUp / ChevronDown) using
 *     `TugIconButton`.
 *   - Three option `<TugCheckbox>`es (case-sensitive / regex /
 *     whole-word).
 *   - Match count `<span aria-live="polite">` so screen readers
 *     announce changes without focus thrashing.
 *   - Done `<TugPushButton>` (ghost / sm).
 *
 * All controls are driven by the session — the component takes a
 * single `findSession: BlockFindSession` prop and spreads its
 * `*Props` slots. The host owns the session; the row owns nothing
 * stateful.
 *
 * Tuglaws cross-check:
 *
 *   - [L02] no external store enters here. State subscribes happen
 *     via the hook ([A9] mount-in-saved-state).
 *   - [L06] visibility is structural — the host conditionally
 *     mounts `<TugBlockFindRow>` based on `session.state.open`.
 *     Appearance (focus paint, hover, sticky-top) is CSS.
 *   - [L11] checkboxes dispatch `toggle` actions to the session's
 *     form responder; nav / clear / done call session callbacks
 *     directly (they have no chain semantics — the action
 *     vocabulary doesn't include them and the host already owns
 *     `FIND_NEXT` / `FIND_PREVIOUS`).
 *   - [L19] file pair with `.css`, module docstring on this `.tsx`,
 *     `data-slot="tug-block-find-row"` on the root.
 *   - [L20] owns the `--tugx-block-find-*` token family; consumes
 *     shared `--tugx-block-strip-bg` for the strip background so
 *     the row reads as a continuation of the host's chrome.
 *
 * @module components/tugways/internal/tug-block-find-row
 */

import "./tug-block-find-row.css";

import React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { TugInput } from "@/components/tugways/tug-input";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugPushButton } from "@/components/tugways/tug-push-button";

import type { BlockFindSession } from "./use-block-find-session";

export interface TugBlockFindRowProps {
  /**
   * Live find session from `useBlockFindSession`. The row reads
   * `session.state` and spreads `session.*Props` onto its primitives.
   */
  findSession: BlockFindSession;
  /**
   * Optional aria-label override forwarded to the input — distinct
   * across blocks for screen-reader clarity ("Find in file" / "Find
   * in diff" / "Find in terminal output"). Defaults to "Find".
   */
  ariaLabel?: string;
  /**
   * Optional class name appended to the row root. Hosts use this to
   * bind the row's `--tugx-block-find-top` to their local sticky-stack
   * composition.
   */
  className?: string;
}

const DATA_SLOT_ROOT = "tug-block-find-row";

export const TugBlockFindRow: React.FC<TugBlockFindRowProps> = ({
  findSession,
  ariaLabel = "Find",
  className,
}) => {
  const {
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
    matchCountLabel,
  } = findSession;

  const rootClass =
    className === undefined
      ? "tugx-block-find"
      : `tugx-block-find ${className}`;

  return (
    <findForm.ResponderScope>
      <div
        ref={findForm.responderRef}
        className={rootClass}
        data-slot={DATA_SLOT_ROOT}
        onKeyDown={rowKeyDownHandler}
      >
        <div className="tugx-block-find-input-wrap">
          <TugInput
            ref={inputProps.ref}
            type="text"
            placeholder="Find"
            value={inputProps.value}
            onChange={inputProps.onChange}
            onKeyDown={inputProps.onKeyDown}
            data-tug-focus-key={inputProps["data-tug-focus-key"]}
            aria-label={ariaLabel}
            className="tugx-block-find-input"
            focusStyle="background"
            borderless
            size="sm"
          />
          {showClear ? (
            <button
              type="button"
              className="tugx-block-find-clear"
              data-slot="block-find-clear"
              aria-label="Clear search"
              onClick={clearButtonProps.onClick}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <TugIconButton
          icon={<ChevronUp />}
          aria-label="Previous match"
          disabled={previousButtonProps.disabled}
          onClick={previousButtonProps.onClick}
        />
        <TugIconButton
          icon={<ChevronDown />}
          aria-label="Next match"
          disabled={nextButtonProps.disabled}
          onClick={nextButtonProps.onClick}
        />

        <div className="tugx-block-find-options">
          <TugCheckbox
            senderId={caseSensitiveCheckboxProps.senderId}
            checked={caseSensitiveCheckboxProps.checked}
            label="match case"
            aria-label="Match case"
            size="sm"
          />
          <TugCheckbox
            senderId={regexpCheckboxProps.senderId}
            checked={regexpCheckboxProps.checked}
            label="regex"
            aria-label="Regular expression"
            size="sm"
          />
          <TugCheckbox
            senderId={wholeWordCheckboxProps.senderId}
            checked={wholeWordCheckboxProps.checked}
            label="word"
            aria-label="Whole word"
            size="sm"
          />
        </div>

        <span className="tugx-block-find-spacer" />
        <span
          className="tugx-block-find-count"
          data-slot="block-find-count"
          aria-live="polite"
        >
          {matchCountLabel}
        </span>
        <span className="tugx-block-find-spacer" />

        <TugPushButton
          size="sm"
          emphasis="ghost"
          onClick={doneButtonProps.onClick}
          aria-label="Close find"
        >
          Done
        </TugPushButton>
      </div>
    </findForm.ResponderScope>
  );
};
