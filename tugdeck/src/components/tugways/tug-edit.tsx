/**
 * TugEdit — CodeMirror 6-backed text editing substrate.
 *
 * The lower-level editing primitive that will eventually back
 * `TugPromptInput`, `TugPromptEntry`, and the live tide-card. Built on
 * an `EditorView` from CodeMirror 6; the React shell owns mount and
 * dispose, observes via `EditorView.updateListener`, and exposes an
 * imperative delegate. The substrate is text-only at this step —
 * atoms, theme, keymap, completion, history, drop, and state
 * preservation arrive in later spike steps (see
 * `roadmap/text-editing-base.md`).
 *
 * `TugEdit` owns its content document, caret, and selection — those
 * are user-data state that lives only inside the component, so it is
 * a *responder* (per [L11]) for the editing actions that operate on
 * that state (cut / copy / paste / selectAll / undo / redo, plus
 * domain submit/newline). Step 1 wires the substrate; the action
 * registrations land in subsequent spike steps as keymap, completion,
 * and selection-adapter extensions arrive.
 *
 * Laws this component obeys:
 *
 *   [L01] One `root.render()` at mount — the React shell mounts once;
 *         CM6's `EditorView` manages its own DOM tree internally and
 *         is never re-rendered through React after construction.
 *   [L03] Mount and dispose run in `useLayoutEffect` so the live
 *         `EditorView` is in place before any keyboard or pointer
 *         events can fire against it.
 *   [L06] All editor appearance — caret blink, selection paint,
 *         hover, focus indication — flows through CSS and direct DOM
 *         (CM6's own DOM mutations and our token-driven theme), never
 *         through React state.
 *   [L07] The `useImperativeHandle` delegate methods read
 *         `viewRef.current` at call time so consumers see the live
 *         view across React 19 StrictMode's mount/unmount/mount cycle
 *         and across cross-pane moves.
 *   [L11] `TugEdit` owns the document and selection state for its
 *         content; it is the responder for editing actions that
 *         mutate that state. Step 4 wires the keymap; later steps
 *         wire completion, history, and clipboard handlers.
 *   [L19] Component authoring guide — file pair (`tug-edit.tsx` +
 *         `tug-edit.css`), module docstring, props interface,
 *         `data-slot="editor"`, CSS organization. Token pairings
 *         (`@tug-pairings`, `@tug-renders-on`) arrive in Step 2 when
 *         the theme extension lands.
 *   [L21] CodeMirror 6 (MIT) is the third-party substrate. Use is
 *         logged in `THIRD_PARTY_NOTICES.md` under the existing
 *         "CodeMirror 6" entry.
 *   [L24] State zones — `viewRef` and `hostRef` live in the
 *         local-data zone (`useRef`); `viewRef.current` is itself the
 *         CM6 state-zone source of truth for document and selection;
 *         all editor appearance is appearance-zone (CSS / DOM).
 *
 * Resolution of plan question [Q03] — CM6 lifecycle vs React StrictMode:
 *
 *   The `EditorView` is constructed inside a `useLayoutEffect` with
 *   an empty dep array, stored on `viewRef`, and disposed in the
 *   cleanup. Under React 19 StrictMode the dev double-invocation
 *   pattern runs the effect twice (mount → cleanup → mount); each
 *   pass constructs a fresh view and the previous cleanup destroys
 *   the prior one. No leaks, no orphaned views, no surviving DOM.
 *   `viewRef` is set to `null` in the cleanup so any imperative
 *   caller that reaches into the delegate between unmount and
 *   re-mount sees `view() === null` rather than a destroyed view.
 *   This pattern matches the standard CM6/React integration shape
 *   used by `@uiw/react-codemirror` and similar wrappers.
 */

import "./tug-edit.css";

import React, { useLayoutEffect, useRef, useImperativeHandle } from "react";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// TugEditDelegate
// ---------------------------------------------------------------------------

/**
 * Imperative handle exposed via `ref`.
 *
 * The Step 1 surface is intentionally minimal — just the underlying
 * `EditorView`, which lets tests and future spike steps reach into the
 * substrate. Subsequent spike steps widen this interface as features
 * land (atoms, selection, completion, state preservation, etc.) until
 * it converges on the full shape documented in the plan's
 * `Public API Surface` section.
 */
export interface TugEditDelegate {
  /**
   * Return the live `EditorView`, or `null` between unmount and
   * re-mount (e.g., during React StrictMode's dev double-invocation,
   * or after the component has been unmounted).
   */
  view(): EditorView | null;
}

// ---------------------------------------------------------------------------
// TugEditProps
// ---------------------------------------------------------------------------

/**
 * Props for `TugEdit`. The Step 1 surface inherits standard
 * `<div>` props (className, style, data-* attributes, etc.) and
 * applies them to the host wrapper. Substrate-specific props
 * (placeholder, maxRows, returnAction, completion providers,
 * history provider, drop handler, route prefixes, state
 * preservation, …) arrive in later spike steps.
 */
export interface TugEditProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  /**
   * Optional className applied to the host wrapper. Composed with
   * the component's own `tug-edit` base class.
   */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Build the initial CM6 extension set used at mount.
 *
 * Kept as a free function so the extension list is easy to extend in
 * later steps (atoms, theme, keymap, completion, …) without disturbing
 * the lifecycle code.
 */
function buildInitialExtensions(): readonly Extension[] {
  return [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
  ];
}

export const TugEdit = React.forwardRef<TugEditDelegate, TugEditProps>(
  function TugEdit({ className, ...rest }: TugEditProps, ref) {
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
        extensions: buildInitialExtensions(),
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
        className={cn("tug-edit", className)}
        {...rest}
      />
    );
  },
);
