/**
 * TugEdit — CodeMirror 6-backed text editing substrate.
 *
 * The lower-level editing primitive that backs higher-level tug
 * components. Built on an `EditorView` from CodeMirror 6: the
 * React shell owns mount and dispose, observes via
 * `EditorView.updateListener`, and exposes an imperative delegate
 * via `ref`.
 *
 * Owns the document, caret, selection, and embedded atoms — the state
 * that editing actions (cut, copy, paste, selectAll, undo, redo,
 * insertAtom, submit) mutate. Per [L11], `TugEdit` is the responder
 * that registers handlers for those actions on its owned state.
 *
 * Laws: [L01] one root.render() at mount; CM6 manages its own DOM
 *        tree internally and is never re-rendered through React,
 *        [L02] atom segments and decoration set live in CM6's
 *        StateField, never in React state, [L03] mount and dispose
 *        run in `useLayoutEffect`, [L06] all editor appearance flows
 *        through CSS and direct DOM, never React state, [L07] delegate
 *        methods read `viewRef.current` at call time, [L11] responder
 *        for editing actions (including atom insert / clipboard) on
 *        the owned document, selection, and atom set, [L15] token-
 *        driven control states, [L19] component authoring guide,
 *        [L21] CodeMirror 6 (MIT) — see `THIRD_PARTY_NOTICES.md`,
 *        [L22] theme-change subscription writes through a CM6
 *        transaction, never round-tripping through React, [L24]
 *        `viewRef`/`hostRef` local-data, CM6 owns document, selection,
 *        and atom-decoration state, appearance via CSS / DOM.
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
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { cn } from "@/lib/utils";
import { subscribeThemeChange, unsubscribeThemeChange } from "@/theme-tokens";
import type { AtomSegment } from "@/lib/tug-atom-img";
import { tugTheme } from "./tug-edit/theme";
import { hostFocusMirror } from "./tug-edit/host-state";
import {
  atomDecorationField,
  insertAtomAtSelection,
  regenerateAtomsEffect,
} from "./tug-edit/atom-decoration";
import { atomicRangesExt } from "./tug-edit/atomic-ranges";
import { clipboardExt } from "./tug-edit/clipboard-filters";
import { tugSelectionLayer } from "./tug-edit/selection-layer";

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
  /**
   * Insert an atom at the current selection head, replacing any
   * non-empty selection. The transaction inserts the U+FFFC text
   * marker and the matching decoration in a single step, so the
   * editor never observes a partially-applied atom. After the
   * insertion the caret lands immediately after the new atom.
   *
   * No-op when the editor is not mounted.
   */
  insertAtom(segment: AtomSegment): void;
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
    // Selection painted by `tugSelectionLayer` — a custom layer that
    // emits `.cm-selectionBackground` divs covering every non-empty
    // range in the editor's selection. We deliberately do NOT use
    // `drawSelection`: drawSelection bundles a styled `.cm-cursor`
    // (which sizes itself from `coordsAtPos`'s glyph rect and
    // wobbles between text and atom positions) and a `Prec.highest`
    // theme that forces `caret-color: transparent !important` and
    // `::selection: transparent !important` (which we cannot
    // override from outside). Building our own selection layer lets
    // us keep CM6's atom-aware selection paint while leaving the
    // native caret intact — the native caret is sized by the
    // line-box, which the `.cm-line::before` ghost in `tugTheme`
    // pins to a uniform line-height.
    tugSelectionLayer,
    tugTheme,
    hostFocusMirror(host),
    // Atom support: the decoration field is the data layer; the
    // atomic-ranges provider lifts that data into CM6's motion /
    // deletion machinery; clipboard filters round-trip the atoms
    // through copy / cut / paste.
    atomDecorationField,
    atomicRangesExt,
    clipboardExt,
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
      insertAtom(segment: AtomSegment) {
        const view = viewRef.current;
        if (view === null) return;
        insertAtomAtSelection(view, segment);
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

      // Atom SVGs bake their colors at construction time (`tug-atom-img.ts`
      // resolves token values via `getTokenValue` at the moment the
      // `<img>` is built). When the application theme changes, those
      // colors are stale, so we dispatch a `regenerateAtomsEffect` to
      // force every widget to be reconstructed [D05]. Subscription is
      // direct DOM observation per [L22] — no React state round-trip.
      const onThemeChange = (): void => {
        view.dispatch({ effects: regenerateAtomsEffect.of(null) });
      };
      subscribeThemeChange(onThemeChange);

      return () => {
        unsubscribeThemeChange(onThemeChange);
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
