/**
 * TugPromptInput — rich text input with inline atom support.
 *
 * Wraps TugTextEngine in a React-compliant shell. The contentEditable
 * div is internal — the consumer interacts via props and imperative handle.
 * Atoms are rendered by TugTextEngine using tug-atom's createAtomDOM (T3.1).
 *
 * Laws: [L01] single mount, [L03] useLayoutEffect for registrations,
 *        [L06] appearance via CSS, [L07] stable refs,
 *        [L15] token-driven states, [L16] pairings declared,
 *        [L19] component authoring guide, [L22] direct DOM updates,
 *        [L23] editing state persists across reload/quit via tugbank
 */

import "./tug-prompt-input.css";

import React, { useRef, useLayoutEffect, useImperativeHandle, useCallback } from "react";
import { cn } from "@/lib/utils";
import { TugTextEngine } from "@/lib/tug-text-engine";
import type {
  AtomSegment,
  InputAction,
  CompletionItem,
  CompletionProvider,
  DropHandler,
  TugTextInputDelegate,
} from "@/lib/tug-text-engine";

// Re-export for consumers that import from the component module
export type { TugTextInputDelegate } from "@/lib/tug-text-engine";

/**
 * TugPromptInput props interface.
 */
export interface TugPromptInputProps extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  /**
   * Placeholder text shown when the input is empty.
   * @default ""
   */
  placeholder?: string;
  /**
   * Maximum visible rows before scrolling.
   * @default 8
   */
  maxRows?: number;
  /**
   * Action for the Return key (main keyboard).
   * @default "submit"
   */
  returnAction?: InputAction;
  /**
   * Action for the Enter key (numpad).
   * @default "submit"
   */
  numpadEnterAction?: InputAction;
  /**
   * Called when the user submits (Return/Enter with submit action).
   */
  onSubmit?: () => void;
  /**
   * Called when content changes (typing, atom insertion, deletion, undo).
   */
  onChange?: () => void;
  /**
   * Called when the engine logs a debug event.
   */
  onLog?: (msg: string) => void;
  /**
   * Completion provider for @-trigger typeahead.
   */
  completionProvider?: CompletionProvider;
  /**
   * Called when typeahead state changes — parent renders the popup.
   */
  onTypeaheadChange?: (active: boolean, filtered: CompletionItem[], selectedIndex: number) => void;
  /**
   * Drop handler for file drag-and-drop → atom conversion.
   */
  dropHandler?: DropHandler;
  /**
   * Whether the input is disabled.
   * @selector .tug-prompt-input-disabled
   * @default false
   */
  disabled?: boolean;
}

// ---- Constants ----

const DEFAULT_MAX_ROWS = 8;
const LINE_HEIGHT = 21;
const PADDING_Y = 14;

// ---- Component ----

export const TugPromptInput = React.forwardRef<TugTextInputDelegate, TugPromptInputProps>(
  function TugPromptInput({
    placeholder = "",
    maxRows = DEFAULT_MAX_ROWS,
    returnAction = "submit",
    numpadEnterAction = "submit",
    onSubmit,
    onChange,
    onLog,
    completionProvider,
    onTypeaheadChange,
    dropHandler,
    disabled = false,
    className,
    ...rest
  }: TugPromptInputProps, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<TugTextEngine | null>(null);

    // Expose TugTextInputDelegate — the UITextInput-inspired API [L07]
    useImperativeHandle(ref, () => ({
      getText() { return engineRef.current?.getText() ?? ""; },
      getAtoms() { return engineRef.current?.getAtoms() ?? []; },
      isEmpty() { return engineRef.current?.isEmpty() ?? true; },
      getSelectedRange() { return engineRef.current?.getSelectedRange() ?? null; },
      setSelectedRange(start: number, end?: number) { engineRef.current?.setSelectedRange(start, end); },
      get hasMarkedText() { return engineRef.current?.hasMarkedText ?? false; },
      insertText(text: string) { engineRef.current?.insertText(text); },
      insertAtom(atom: AtomSegment) {
        const engine = engineRef.current;
        if (engine) { engine.root.focus(); engine.insertAtom(atom); }
      },
      deleteBackward() { engineRef.current?.deleteBackward(); },
      deleteForward() { engineRef.current?.deleteForward(); },
      selectAll() { engineRef.current?.selectAll(); },
      clear() { engineRef.current?.clear(); },
      get canUndo() { return engineRef.current?.canUndo ?? false; },
      get canRedo() { return engineRef.current?.canRedo ?? false; },
      undo() { engineRef.current?.undo(); },
      redo() { engineRef.current?.redo(); },
      focus() { engineRef.current?.root.focus(); },
      getEditorElement() { return engineRef.current?.root ?? null; },
    }), []);

    // Stable callback refs — engine reads these via closure over refs [L07]
    const onSubmitRef = useRef(onSubmit);
    const onChangeRef = useRef(onChange);
    const onLogRef = useRef(onLog);
    const onTypeaheadChangeRef = useRef(onTypeaheadChange);
    useLayoutEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
    useLayoutEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    useLayoutEffect(() => { onLogRef.current = onLog; }, [onLog]);
    useLayoutEffect(() => { onTypeaheadChangeRef.current = onTypeaheadChange; }, [onTypeaheadChange]);

    // Mount engine once [L01, L03]
    useLayoutEffect(() => {
      const el = editorRef.current;
      if (!el || engineRef.current) return;

      const engine = new TugTextEngine(el);
      engine.maxHeight = LINE_HEIGHT * maxRows + PADDING_Y;
      engine.completionProvider = completionProvider ?? null;
      engine.dropHandler = dropHandler ?? null;
      engine.returnAction = returnAction;
      engine.numpadEnterAction = numpadEnterAction;

      // Wire callbacks through refs so they always call the latest prop
      engine.onSubmit = () => onSubmitRef.current?.();
      engine.onChange = () => onChangeRef.current?.();
      engine.onLog = (msg) => onLogRef.current?.(msg);
      engine.onTypeaheadChange = (active, filtered, selectedIndex) =>
        onTypeaheadChangeRef.current?.(active, filtered, selectedIndex);

      engineRef.current = engine;

      return () => {
        engine.teardown();
        engineRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync mutable config to engine [L07]
    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.returnAction = returnAction;
      }
    }, [returnAction]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.numpadEnterAction = numpadEnterAction;
      }
    }, [numpadEnterAction]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.maxHeight = LINE_HEIGHT * maxRows + PADDING_Y;
      }
    }, [maxRows]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.completionProvider = completionProvider ?? null;
      }
    }, [completionProvider]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.dropHandler = dropHandler ?? null;
      }
    }, [dropHandler]);

    // Prevent interaction when disabled
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      if (disabled) e.preventDefault();
    }, [disabled]);

    return (
      <div
        data-slot="tug-prompt-input"
        className={cn(
          "tug-prompt-input",
          disabled && "tug-prompt-input-disabled",
          className,
        )}
        onPointerDown={handlePointerDown}
        {...rest}
      >
        <div
          ref={editorRef}
          className="tug-prompt-input-editor"
          contentEditable={!disabled}
          role="textbox"
          aria-multiline="true"
          aria-disabled={disabled || undefined}
          data-placeholder={placeholder}
          data-empty="true"
          data-td-select="custom"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          suppressContentEditableWarning
        />
      </div>
    );
  }
);
