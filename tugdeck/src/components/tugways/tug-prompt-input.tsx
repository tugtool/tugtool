/**
 * TugPromptInput — rich text input with inline atom support.
 *
 * Wraps TugTextEngine in a React-compliant shell. The contentEditable
 * div is internal — the consumer interacts via props and imperative handle.
 * Atoms are <img> elements with SVG data URIs (see lib/tug-atom-img.ts).
 *
 * Laws: [L01] single mount, [L03] useLayoutEffect for registrations,
 *        [L06] appearance via CSS, [L07] stable refs,
 *        [L15] token-driven states, [L16] pairings declared,
 *        [L19] component authoring guide, [L22] direct DOM updates,
 *        [L23] editing state persists across reload/quit via tugbank
 */

import "./tug-prompt-input.css";
import "./tug-completion-menu.css";

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
  TugTextEditingState,
} from "@/lib/tug-text-engine";
import { useTugcardPersistence } from "@/components/tugways/use-tugcard-persistence";
import { subscribeThemeChange, unsubscribeThemeChange } from "@/theme-tokens";

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
   * Completion provider for @-trigger typeahead.
   */
  completionProvider?: CompletionProvider;
  /**
   * Called when typeahead state changes. The popup is rendered internally;
   * this callback is for external observers of typeahead state.
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
  /**
   * Direction the completion popup opens relative to the trigger.
   * @default "up"
   */
  completionDirection?: "up" | "down";
  /**
   * Whether to persist editing state via tugbank [L23].
   * Set to false for test harness editors or transient inputs.
   * @default true
   */
  persistState?: boolean;
}

// ---- Persistence helper ----

/**
 * Internal component that registers tugcard persistence for TugPromptInput.
 * Conditionally rendered (only when persistState=true) so the hook isn't
 * called for test harness editors, avoiding registration collisions.
 */
function TugPromptInputPersistence({ engineRef }: { engineRef: React.RefObject<TugTextEngine | null> }) {
  useTugcardPersistence<TugTextEditingState>({
    onSave: () => {
      const empty: TugTextEditingState = { text: "", atoms: [], selection: null };
      const engine = engineRef.current;
      if (!engine) return empty;
      return engine.captureState();
    },
    onRestore: (state) => {
      engineRef.current?.restoreState(state);
    },
  });
  return null;
}

// ---- Constants ----

const DEFAULT_MAX_ROWS = 8;
const LINE_HEIGHT = 24;
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
    completionProvider,
    completionDirection = "up",
    onTypeaheadChange,
    dropHandler,
    disabled = false,
    persistState = true,
    className,
    ...rest
  }: TugPromptInputProps, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const completionRef = useRef<HTMLDivElement>(null);
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
      insertAtom(atom: AtomSegment) { engineRef.current?.insertAtom(atom); },
      deleteRange(start: number, end: number) { return engineRef.current?.deleteRange(start, end) ?? start; },
      deleteBackward() { engineRef.current?.deleteBackward(); },
      deleteForward() { engineRef.current?.deleteForward(); },
      deleteWordBackward() { engineRef.current?.deleteWordBackward(); },
      deleteWordForward() { engineRef.current?.deleteWordForward(); },
      deleteParagraphBackward() { engineRef.current?.deleteParagraphBackward(); },
      deleteParagraphForward() { engineRef.current?.deleteParagraphForward(); },
      selectAll() { engineRef.current?.selectAll(); },
      clear() { engineRef.current?.clear(); },
      killLine() { engineRef.current?.killLine(); },
      yank() { engineRef.current?.yank(); },
      transpose() { engineRef.current?.transpose(); },
      openLine() { engineRef.current?.openLine(); },
      undo() { engineRef.current?.undo(); },
      redo() { engineRef.current?.redo(); },
      focus() { engineRef.current?.root.focus(); },
      get isTypeaheadActive() { return engineRef.current?.isTypeaheadActive ?? false; },
      acceptTypeahead(index?: number) { engineRef.current?.acceptTypeahead(index); },
      cancelTypeahead() { engineRef.current?.cancelTypeahead(); },
      typeaheadNavigate(direction: "up" | "down") { engineRef.current?.typeaheadNavigate(direction); },
      restoreState(state: TugTextEditingState) { engineRef.current?.restoreState(state); },
      getEditorElement() { return engineRef.current?.root ?? null; },
    }), []);

    // Stable callback/config refs — engine reads these via closure over refs [L07]
    const onSubmitRef = useRef(onSubmit);
    const onChangeRef = useRef(onChange);
    const onTypeaheadChangeRef = useRef(onTypeaheadChange);
    const completionDirectionRef = useRef(completionDirection);
    useLayoutEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
    useLayoutEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    useLayoutEffect(() => { onTypeaheadChangeRef.current = onTypeaheadChange; }, [onTypeaheadChange]);
    useLayoutEffect(() => { completionDirectionRef.current = completionDirection; }, [completionDirection]);

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
      engine.onTypeaheadChange = (active, filtered, selectedIndex) => {
        onTypeaheadChangeRef.current?.(active, filtered, selectedIndex);
        // Direct DOM update for completion popup [L06]
        const popup = completionRef.current;
        const container = containerRef.current;
        if (!popup) return;
        if (!active || filtered.length === 0) {
          popup.style.display = "none";
          return;
        }
        popup.style.display = "block";
        popup.innerHTML = "";
        filtered.forEach((item, i) => {
          const div = document.createElement("div");
          div.className = "tug-completion-menu-item" +
            (i === selectedIndex ? " tug-completion-menu-item-selected" : "");
          const label = document.createElement("span");
          label.className = "tug-completion-menu-label";
          label.textContent = item.label;
          div.appendChild(label);
          div.addEventListener("pointerdown", (e) => {
            e.preventDefault(); // Don't steal focus from editor
            engine.acceptTypeahead(i);
          });
          popup.appendChild(div);
        });
        // Position at the @ anchor rect
        const anchorRect = engine.typeaheadAnchorRect;
        if (anchorRect && container) {
          const containerRect = container.getBoundingClientRect();
          popup.style.left = `${anchorRect.left - containerRect.left}px`;
          if (completionDirectionRef.current === "down") {
            popup.style.bottom = "";
            popup.style.top = `${anchorRect.bottom - containerRect.top + 4}px`;
          } else {
            popup.style.top = "";
            popup.style.bottom = `${containerRect.bottom - anchorRect.top + 4}px`;
          }
        }
      };

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

    // Regenerate atom images on theme change — direct DOM update [L06, L22]
    useLayoutEffect(() => {
      const onThemeChange = () => { engineRef.current?.regenerateAtoms(); };
      subscribeThemeChange(onThemeChange);
      return () => { unsubscribeThemeChange(onThemeChange); };
    }, []);

    // Prevent interaction when disabled
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      if (disabled) e.preventDefault();
    }, [disabled]);

    return (
      <div
        ref={containerRef}
        data-slot="tug-prompt-input"
        className={cn(
          "tug-prompt-input",
          disabled && "tug-prompt-input-disabled",
          className,
        )}
        onPointerDown={handlePointerDown}
        {...rest}
      >
        {persistState && <TugPromptInputPersistence engineRef={engineRef} />}
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
        <div
          ref={completionRef}
          data-slot="tug-completion-menu"
          className="tug-completion-menu"
          style={{ display: "none" }}
        />
      </div>
    );
  }
);
