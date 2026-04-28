/**
 * TugEdit — CodeMirror 6-backed text editing substrate.
 *
 * The lower-level editing primitive that backs higher-level tug
 * components. Built on an `EditorView` from CodeMirror 6: the
 * React shell owns mount and dispose, observes via
 * `EditorView.updateListener`, and exposes an imperative delegate
 * via `ref`.
 *
 * Owns the document, caret, and selection — the state that editing
 * actions (cut, copy, paste, selectAll, undo, redo, submit) mutate.
 * Per [L11], `TugEdit` is the responder that registers handlers
 * for those actions on its owned state.
 *
 * Laws: [L01] one root.render() at mount; CM6 manages its own DOM
 *        tree internally and is never re-rendered through React,
 *        [L03] mount and dispose run in `useLayoutEffect`,
 *        [L06] all editor appearance flows through CSS and direct
 *        DOM, never React state, [L07] delegate methods read
 *        `viewRef.current` at call time, [L11] responder for
 *        editing actions on the owned document and selection,
 *        [L15] token-driven control states, [L19] component
 *        authoring guide, [L21] CodeMirror 6 (MIT) — see
 *        `THIRD_PARTY_NOTICES.md`, [L24] `viewRef`/`hostRef`
 *        local-data, CM6 owns document and selection, appearance
 *        via CSS / DOM.
 *
 * StrictMode lifecycle: the `EditorView` is constructed inside a
 * `useLayoutEffect` with empty deps, stored on `viewRef`, and
 * disposed in the cleanup. React 19 StrictMode runs mount →
 * cleanup → mount in dev; each pass constructs a fresh view, the
 * prior cleanup destroys the prior view, and `viewRef.current`
 * is `null` between passes so callers see `view() === null`
 * rather than a destroyed view. Pattern matches the standard CM6
 * + React integration used by `@uiw/react-codemirror` and similar
 * wrappers.
 */

import "./tug-edit.css";

import React, { useLayoutEffect, useRef, useImperativeHandle } from "react";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cn } from "@/lib/utils";
import { tugTheme } from "./tug-edit/theme";
import { hostFocusMirror } from "./tug-edit/host-state";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default focus indication when `focusStyle` is not supplied. */
const DEFAULT_FOCUS_STYLE = "background" as const;

// ---------------------------------------------------------------------------
// TugEditDelegate
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed via `ref`.
 *
 * Exposes the underlying `EditorView`. Consumers that need to
 * dispatch transactions, query state, or reach into extension
 * data hold this handle and call `view()` at use time.
 *
 * `view()` returns `null` between unmount and re-mount — for
 * example during React 19 StrictMode's dev double-mount, or after
 * the component has been disposed. See the lifecycle note in the
 * module docstring.
 */
export interface TugEditDelegate {
  /**
   * Return the live `EditorView`, or `null` if no view is
   * currently mounted.
   */
  view(): EditorView | null;
}

// ---------------------------------------------------------------------------
// TugEditProps
// ---------------------------------------------------------------------------

/**
 * Focus indication variants for the host wrapper.
 *
 *   `"background"` — focused state shifts the editor surface to a
 *                    subtle focus tint and the host border to the
 *                    field's active border color.
 *   `"ring"`        — focused state draws an accent-colored ring
 *                    around the host wrapper.
 */
export type TugEditFocusStyle = "background" | "ring";

/**
 * Props for `TugEdit`. The component renders a host `<div>`
 * around the live `EditorView`; standard `<div>` props
 * (`className`, `style`, `data-*`, etc.) flow through to the
 * host.
 */
export interface TugEditProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  /**
   * Optional className applied to the host wrapper. Composed with
   * the component's own `tug-edit` base class.
   */
  className?: string;
  /**
   * Focus indication style for the host wrapper.
   * @default "background"
   * @selector .tug-edit[data-focus-style]
   */
  focusStyle?: TugEditFocusStyle;
  /**
   * Suppress the host wrapper's border. For embedding in compound
   * components where the parent owns the border treatment.
   * @default false
   * @selector .tug-edit[data-borderless]
   */
  borderless?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Build the CM6 extension set used at mount. The host element is
 * captured so the focus-mirror extension can reach it directly.
 *
 * Kept as a free function so the extension list is easy to grow
 * without disturbing the lifecycle code.
 */
function buildExtensions(host: HTMLElement): readonly Extension[] {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    // `drawSelection` emits the styled `.cm-cursor` and
    // `.cm-selectionBackground` DOM that `tugTheme` paints. Without
    // it, CM6 falls back to the browser-native caret (suppressed by
    // our theme's `caret-color: transparent`) and the caret would
    // be invisible.
    drawSelection(),
    tugTheme,
    hostFocusMirror(host),
  ];
}

export const TugEdit = React.forwardRef<TugEditDelegate, TugEditProps>(
  function TugEdit(
    {
      className,
      focusStyle = DEFAULT_FOCUS_STYLE,
      borderless = false,
      ...rest
    }: TugEditProps,
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    // Expose the imperative delegate. The closure reads `viewRef.current`
    // at call time so consumers see the live view across StrictMode's
    // mount/unmount/mount cycle [L07].
    useImperativeHandle(ref, () => ({
      view() {
        return viewRef.current;
      },
    }), []);

    // Mount the EditorView. Cleanup destroys it; re-mount creates
    // a fresh one. See module docstring for the StrictMode rationale [L03].
    useLayoutEffect(() => {
      const host = hostRef.current;
      if (host === null) return;

      const state = EditorState.create({
        doc: "",
        extensions: buildExtensions(host),
      });
      const view = new EditorView({
        state,
        parent: host,
      });
      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    return (
      <div
        ref={hostRef}
        data-slot="editor"
        data-focus-style={focusStyle}
        data-borderless={borderless ? "" : undefined}
        className={cn("tug-edit", className)}
        {...rest}
      />
    );
  },
);
