/**
 * `TugMessageEditor` — a small reusable multi-line message field over the
 * {@link TugTextEditor} CM6 substrate.
 *
 * One borderless CM6 field for short authored messages (the Changeset card's
 * commit-message composer is the first consumer). It composes the substrate
 * exactly as {@link TextCardFindBar} composes it for its query field: a
 * `borderless`, `preserveState={false}` mount with an
 * `EditorView.updateListener` that mirrors the document text back out — no
 * controlled-input round-trip. Because the substrate IS the editor, the
 * clipboard/undo responders (CUT / COPY / PASTE / SELECT_ALL / UNDO / REDO)
 * come for free through `TugTextEditor`'s own `useOptionalResponder`
 * registration ([L11], [P26]); the field wires none of its own.
 *
 * ## onChange fires for USER edits only
 *
 * The mirror `updateListener` fires `onChange` only for user-originated
 * document changes (typing, delete, paste, undo/redo) — NOT for the
 * programmatic {@link TugMessageEditorHandle.restoreState} /
 * {@link TugMessageEditorHandle.clear} seams, which dispatch non-user
 * transactions (restore carries no `userEvent`; clear carries the internal
 * `delete.tug-clear` marker, filtered out). This is what lets a consumer seed
 * a draft into a pristine field via `restoreState()` WITHOUT that seed reading
 * as a user edit — the [P28] pinning contract: a new draft streams in silently,
 * the field pins only when the human actually edits it.
 *
 * Keys: `returnAction="newline"` (Enter inserts a newline — this is a
 * multi-line message, not a submit-on-Enter input); Cmd-Enter fires `onSubmit`
 * regardless of `returnAction`, per the substrate contract.
 *
 * Laws: [L02] the document lives in CM6, mirrored out imperatively — never a
 * controlled React value; [L06] appearance via the substrate's CSS/DOM; [L11]
 * editing responders ride the composed substrate; [L19] `.tsx` + `.css` pair,
 * exported props interface, `data-slot`; [L20] composes the real
 * `TugTextEditor` — no borrowed CSS.
 *
 * @module components/tugways/tug-message-editor
 */

import "./tug-message-editor.css";

import React, { useMemo, useRef } from "react";
import { EditorView } from "@codemirror/view";

import { cn } from "@/lib/utils";
import {
  TugTextEditor,
  type TugTextEditorDelegate,
} from "@/components/tugways/tug-text-editor";

/**
 * Resting/maximum visible rows before the field scrolls. The 3-row resting
 * height (≈ the retired `TugTextarea`'s `rows={3}`) is reserved by the CSS
 * `--tug-text-editor-min-height` floor; this cap lets a longer message grow to
 * a comfortable height before it scrolls.
 */
const DEFAULT_MAX_ROWS = 12;

/**
 * Imperative surface a consumer drives: seed a draft into a pristine field
 * (`restoreState`) and empty it (`clear`). Both are PROGRAMMATIC — they do not
 * fire `onChange`, so seeding a draft never reads as a user edit (the [P28]
 * pinning contract).
 */
export interface TugMessageEditorHandle {
  /** Replace the field's text without claiming focus or firing `onChange`. */
  restoreState(text: string): void;
  /** Empty the field without firing `onChange`. */
  clear(): void;
  /** Move keyboard focus into the field. */
  focus(): void;
}

export interface TugMessageEditorProps {
  /**
   * Initial document text, seeded once at mount. Later prop changes do NOT
   * round-trip into the field (no controlled input) — a consumer pushes new
   * text through {@link TugMessageEditorHandle.restoreState} instead.
   */
  value?: string;
  /**
   * Fired with the mirrored document text on every USER edit (typing, paste,
   * delete, undo/redo). NOT fired for the programmatic `restoreState` / `clear`
   * seams — see the module docstring.
   */
  onChange?: (text: string) => void;
  /** Fired on Cmd-Enter (regardless of `returnAction`). */
  onSubmit?: () => void;
  /** Empty-state hint shown while the document is empty. */
  placeholder?: string;
  /** Maximum visible rows before the field scrolls. @default 12 */
  maxRows?: number;
  /**
   * Soft-wrap long lines instead of scrolling horizontally. Forwarded to the
   * substrate (`EditorView.lineWrapping` + `data-wrap`). @default false
   */
  lineWrap?: boolean;
  /**
   * Light markdown token styling (heading / emphasis / code colors and
   * weights, raw syntax always visible). Forwarded to the substrate's
   * `markdownTextStyling`. @default false
   */
  markdownTextStyling?: boolean;
  /**
   * Editor font size (a CSS length; drives `--tug-font-size-editor` on the
   * substrate). Omit to keep the substrate default.
   */
  fontSize?: string;
  /** Read-only + non-editable when true. */
  disabled?: boolean;
  /**
   * Let Tab move keyboard focus out of the field instead of indenting.
   * Forwarded to the substrate. Use in a dialog whose action buttons must stay
   * keyboard-reachable from the message field. @default false
   */
  tabMovesFocus?: boolean;
  /** Forwarded to the host wrapper. */
  className?: string;
  /** Test hook, forwarded to the host wrapper. */
  "data-testid"?: string;
  /** Accessible label, forwarded to the host wrapper. */
  "aria-label"?: string;
}

export const TugMessageEditor = React.forwardRef<
  TugMessageEditorHandle,
  TugMessageEditorProps
>(function TugMessageEditor(
  {
    value,
    onChange,
    onSubmit,
    placeholder,
    maxRows = DEFAULT_MAX_ROWS,
    lineWrap,
    markdownTextStyling,
    fontSize,
    disabled = false,
    tabMovesFocus = false,
    className,
    "data-testid": dataTestid,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const substrateRef = useRef<TugTextEditorDelegate | null>(null);

  // Callbacks read through refs so the mount-captured extension always sees
  // the latest handler without rebuilding ([L07], the find-bar's technique).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Seed `value` once — the mount-time initial text. Applied via the substrate
  // delegate's programmatic restore (no `onChange`). A ref guard keeps it a
  // one-shot even across a Fast-Refresh effect re-run.
  const seededRef = useRef(false);

  // The doc-mirror extension, captured at mount (the substrate reads
  // `extensions` once). Fires `onChange` only for genuine user edits — the
  // programmatic restore/clear paths carry no matching `userEvent`, so a
  // seeded draft never reads as a user edit ([P28] pinning). `delete.tug-clear`
  // is the substrate's own `clear()` marker and is excluded explicitly.
  const messageEditorExtensions = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const userEdit = update.transactions.some(
          (t) =>
            (t.isUserEvent("input") ||
              t.isUserEvent("delete") ||
              t.isUserEvent("undo") ||
              t.isUserEvent("redo")) &&
            !t.isUserEvent("delete.tug-clear"),
        );
        if (!userEdit) return;
        onChangeRef.current?.(update.state.doc.toString());
      }),
    [],
  );

  const seed = (text: string): void => {
    substrateRef.current?.restoreState({ text, atoms: [], selection: null });
  };

  // Seed `value` once, from a layout effect — NOT from the substrate ref
  // callback. `TugTextEditor` declares its `useImperativeHandle` (the delegate
  // this ref receives) BEFORE its view-creation `useLayoutEffect`, so the
  // delegate lands while `viewRef.current` is still null and a seed from the
  // ref callback restores into a view that does not exist yet — a silent no-op
  // that drops the initial text (a real data-loss path when the field opens an
  // existing document). A parent layout effect runs AFTER the child's
  // view-creation effect, so the view is live by the time this fires; the
  // delegate reads `viewRef.current` at call time, so the restore lands.
  const valueRef = useRef(value);
  valueRef.current = value;
  React.useLayoutEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const initial = valueRef.current;
    if (initial !== undefined && initial !== "") seed(initial);
    // Mount-only seed; later `value` changes go through `restoreState`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useImperativeHandle(
    ref,
    (): TugMessageEditorHandle => ({
      restoreState: (text) => seed(text),
      clear: () => substrateRef.current?.clear(),
      focus: () => substrateRef.current?.focus(),
    }),
    [],
  );

  return (
    <TugTextEditor
      ref={(delegate) => {
        substrateRef.current = delegate;
      }}
      className={cn("tug-message-editor", className)}
      data-slot="tug-message-editor"
      data-testid={dataTestid}
      aria-label={ariaLabel}
      borderless
      preserveState={false}
      returnAction="newline"
      maxRows={maxRows}
      lineWrap={lineWrap}
      markdownTextStyling={markdownTextStyling}
      fontSize={fontSize}
      placeholder={placeholder}
      disabled={disabled}
      tabMovesFocus={tabMovesFocus}
      onSubmit={onSubmit}
      extensions={messageEditorExtensions}
    />
  );
});
