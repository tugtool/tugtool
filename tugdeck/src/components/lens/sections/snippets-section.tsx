/**
 * snippets-section.tsx — the Lens **Snippets** section: a keyboard-navigable
 * `TugListView` of reusable prompt fragments backed by the machine-global
 * `snippets.json` (`snippetsStore`).
 *
 * The list is authored into the section's focus group (`host.focusGroup`), so
 * it is one Tab stop in the Lens. The grammar (Spec S01):
 *  - **Arrows** rove the cursor and carry the selection with it
 *    (`selectionFollowsCursor`) — the green fill is always on the row the
 *    keyboard is on, which is also the row the section verbs act on;
 *    **ArrowRight** descends onto the row's Copy / ✕, which the horizontal
 *    arrows then walk; **Enter** opens the cursor row's editor
 *    (`onActivate` → `beginEdit`), which mounts a `TugMessageEditor` (the
 *    `TugTextEditor` CM6 substrate, markdown-styled) inside a focusable
 *    wrapper authored into the row's descend scope; the row claims the CM6
 *    caret itself (the engine's ladder yields keys to a focused editor).
 *    **Escape** ascends the row scope (the wrapper's handler — the surface
 *    owns its Escape) and the resulting **blur** commits; **⌘Return**
 *    commits and chains a new snippet. **Space** selects only.
 *  - Section verbs while the list holds the key view (delivered via the
 *    list's `onKeyViewKey` delegate — the [P05] channel): **Space** creates
 *    below the cursor, **Delete** removes the cursor row (read from the
 *    projected `data-key-cursor`) and lands the cursor on the surviving
 *    neighbor, **⌘Z / ⇧⌘Z** undo/redo (via a chain responder, active only
 *    in list mode so the editor's CM6 undo wins while typing). Each display
 *    row also carries a hover-reveal delete button for the pointer.
 *  - A row's incipit is draggable into a session prompt (native HTML5 drag,
 *    `snippetDragStart`); dragging the row VERTICALLY reorders instead
 *    (commit on drop, [Q02]). One surface, two drags, told apart by axis in
 *    `block-reorder`.
 *
 * One cell kind (`"snippet"`) branches display/editor on `editingId` — never
 * two kinds for one row ([L26]). Laws: [L02] store via `useSyncExternalStore`;
 * [L06] cursor/selection appearance is CSS on engine attributes; [L22] the
 * FocusManager owns the cursor and the descend scope; [L11] the editor's
 * CUT/COPY/PASTE/SELECT_ALL/UNDO/REDO responders ride the composed substrate.
 *
 * @module components/lens/sections/snippets-section
 */

import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Copy, Plus, TextQuote, X } from "lucide-react";

import { PLACEMENT_POLICY_ATTRIBUTE } from "@/gesture-interpreter";
import { getSnippetsStore } from "@/lib/snippets-store";
import { snippetIncipit, type Snippet } from "@/lib/snippets-doc";
import { snippetDragStart } from "@/lib/snippet-drag";
import { renderPulseLine } from "@/lib/pulse-line/render-pulse-line";
import {
  hasNativeClipboardBridge,
  writeClipboardViaNative,
} from "@/lib/tug-native-clipboard";
import { animate } from "@/components/tugways/tug-animator";
import { TugListView } from "@/components/tugways/tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDelegate,
  TugListViewHandle,
} from "@/components/tugways/tug-list-view";
import {
  TugMessageEditor,
  type TugMessageEditorHandle,
} from "@/components/tugways/tug-message-editor";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
import { LENS_LIST_PRESENTATION } from "@/components/lens/lens-list-presentation";
import { BlockDropCaret } from "@/components/lens/block-drop-caret";
import { useBlockReorder } from "@/components/lens/block-reorder";
import {
  useFocusable,
  useFocusManager,
} from "@/components/tugways/use-focusable";
import { useResponder } from "@/components/tugways/use-responder";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { renderFilterHighlight } from "@/components/tugways/filter-highlight";
import { setSectionContent } from "@/components/lens/lens-section-content";
import {
  getFilterQuery,
  getFilterVersion,
  subscribeFilterQuery,
} from "@/components/lens/lens-filter-store";
import { registerLensSection } from "../lens-section-registry";
import type { LensSectionHost } from "../lens-section-registry";
import {
  LensSnippetsDataSource,
  useLensSnippetsDataSource,
} from "./snippets-data-source";
import "./snippets-section.css";

const ROW_SELECTOR = ".snippet-row-content[data-snippet-id]";
const ROW_KIND_ATTR = "data-snippet-id";

// Space is reserved so the section's key-view delegate can create a new
// snippet below the cursor (Things-style) rather than the engine's default
// item-container select.
const SNIPPETS_CAPTURE_KEYS: readonly string[] = [" "];

// The section's remembered selection — the last-touched snippet id, mapped to
// a cursor seed on the next Cmd-L / Tab into the section ([P10]). Module-level
// so it outlives the section body's unmount across a collapse toggle; valid
// while the Lens is a singleton card.
let lastSelectedSnippetId: string | null = null;

/** Unwrap the single enclosing `<p>…</p>` the block markdown renderer wraps a
 *  one-line string in, so a snippet incipit renders as INLINE markdown (its text
 *  reads on the row's baseline, not as a block paragraph). A multi-block or
 *  non-paragraph render is left as-is. */
function inlineMarkdownHtml(html: string): string {
  const match = /^<p>([\s\S]*)<\/p>$/.exec(html.trim());
  return match !== null ? match[1] : html;
}

/** Copy a snippet's raw text to the clipboard — native bridge in Tug.app (no
 *  permission popup), the async Clipboard API in browser-dev. */
function copySnippetText(text: string): void {
  if (text === "") return;
  if (hasNativeClipboardBridge()) {
    writeClipboardViaNative(text, "");
    return;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => {});
  }
}

/** Row verbs provided by the section body to the module-level cell. */
interface SnippetsCellContextValue {
  onRowPointerDown: (id: string, event: React.PointerEvent) => void;
  /** Open the destructive-delete confirm popover anchored to the row. */
  onRequestDelete: (id: string, anchorEl: HTMLElement) => void;
}
const SnippetsCellContext =
  React.createContext<SnippetsCellContextValue | null>(null);

function useSnippets() {
  const store = getSnippetsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, snapshot };
}

/** This section's kind — the key its filter query lives under. */
const SECTION_KIND = "snippets";

/** The band's live filter query, read straight from the store ([L02]). */
function useSnippetsFilterQuery(): string {
  useSyncExternalStore(subscribeFilterQuery, getFilterVersion);
  return getFilterQuery(SECTION_KIND);
}

/** Live one-line summary: the snippet count. */
function SnippetsCollapsedSummary(): React.ReactElement {
  const { snapshot } = useSnippets();
  const n = snapshot.doc.snippets.length;
  return <>{n === 0 ? "No snippets" : `${n} snippet${n === 1 ? "" : "s"}`}</>;
}

/** The header `+`: create a snippet and open it (the store sets `editingId`,
 *  the body's descend effect focuses it). `TugIconButton` carries the standard
 *  ghost hover / focus / active treatment the fold chevron wears. */
function SnippetsHeaderActions(): React.ReactElement {
  const store = getSnippetsStore();
  return (
    <TugIconButton
      icon={<Plus size={14} />}
      size="xs"
      aria-label="New snippet"
      title="New snippet"
      onClick={() => store.createSnippet(null)}
    />
  );
}

/**
 * Focus group for a display row's copy / delete accessories. The rows render
 * inside `TugListView`'s per-row `FocusModeContext`, so the buttons register
 * into their own row's descend scope — the mode scopes the walk, this constant
 * is only the within-row ordering. ArrowRight on the cursor row lands on Copy;
 * the trailing cluster is already revealed by the row's keyboard cursor, so the
 * affordance is on screen before the descend reaches it. Same authoring as the
 * session picker's row trash button.
 */
const ROW_ACTION_FOCUS_GROUP = "lens-snippet-row-actions";

/** The display row on the shared `TugListRow` chrome: the draggable incipit is
 *  the content column and a hover-reveal copy / delete pair is the trailing
 *  accessory. The row is also its own reorder handle. Row padding / hover /
 *  divider / caret come from the row + the enclosing flush `TugListView`. */
function SnippetDisplayRow({
  snippet,
  selected,
}: {
  snippet: Snippet;
  selected: boolean;
}): React.ReactElement {
  const ctx = React.useContext(SnippetsCellContext);
  const filterQuery = useSnippetsFilterQuery();
  const incipit = snippetIncipit(snippet);
  const empty = incipit.length === 0;
  // The incipit renders INLINE markdown (`*hello*` → italic) via the same
  // sanitized one-line renderer the pulse strip uses, unwrapped to inline. An
  // empty `html` is its plain-text signal (no markup, or a parse fallback).
  // While a filter is active the row shows PLAIN text instead, so the match can
  // be marked: highlight ranges are offsets into the incipit string, which
  // rendered markup would not agree with.
  const rendered = empty || filterQuery !== "" ? null : renderPulseLine(incipit);
  const incipitHtml =
    rendered !== null && rendered.html.length > 0
      ? inlineMarkdownHtml(rendered.html)
      : null;
  return (
    <TugListRow
      className="snippet-row-content"
      data-snippet-id={snippet.id}
      selected={selected}
      // The row is its own reorder handle. A VERTICAL drag carries it; a
      // horizontal one is left to the incipit's native drag-out below, which
      // is why the two can share the same surface ([P08]).
      onPointerDown={(e) => ctx?.onRowPointerDown(snippet.id, e)}
      trailing={
        ctx !== null ? (
          <>
            <TugIconButton
              icon={<Copy size={12} />}
              size="xs"
              aria-label="Copy snippet"
              title="Copy snippet"
              focusGroup={ROW_ACTION_FOCUS_GROUP}
              focusOrder={0}
              onClick={(e) => {
                // A copy is not a row activation — stop it reaching the cell.
                e?.stopPropagation();
                copySnippetText(snippet.text);
              }}
            />
            <TugIconButton
              className="snippet-row-delete"
              icon={<X size={12} />}
              size="xs"
              tone="danger"
              aria-label="Delete snippet"
              title="Delete snippet"
              focusGroup={ROW_ACTION_FOCUS_GROUP}
              focusOrder={1}
              onClick={(e) => {
                // Never let the delete read as a row activation (open) on the
                // cell wrapper above.
                e?.stopPropagation();
                // Anchor the confirm to the ROW, not to this button. The ✕ is
                // a hover reveal, and the popover takes the pointer off the row
                // the moment it opens — the button then unmounts out from under
                // its own popover, which re-anchors to whatever is left and
                // visibly hops. The row is present for as long as the question
                // it is asking about.
                const cell = e?.currentTarget?.closest?.(".tug-list-view-cell");
                if (cell instanceof HTMLElement) {
                  ctx.onRequestDelete(snippet.id, cell);
                }
              }}
            />
          </>
        ) : undefined
      }
      trailingReveal="claim"
    >
      <span
        className={
          empty ? "snippet-row-label snippet-row-label-empty" : "snippet-row-label"
        }
        // An empty snippet has nothing to carry, so it isn't a drag source.
        draggable={!empty}
        onDragStart={(e) => snippetDragStart(e, snippet.text)}
      >
        {empty ? (
          "New snippet"
        ) : incipitHtml !== null ? (
          <span
            className="snippet-row-incipit"
            dangerouslySetInnerHTML={{ __html: incipitHtml }}
          />
        ) : (
          renderFilterHighlight(incipit, filterQuery)
        )}
      </span>
    </TugListRow>
  );
}

/**
 * The in-place editor — a `TugMessageEditor` (CM6 substrate, markdown-styled)
 * inside a wrapper registered as the row's descend-scope focusable. The engine
 * lands DOM focus on the wrapper (`tabIndex={-1}`); the wrapper forwards it
 * into the CM6 caret. Escape ascends (engine) and the resulting blur commits;
 * ⌘Return (the substrate's `onSubmit`) commits + chains a new snippet.
 */
/**
 * One animator slot for the editor well's open AND close. Sharing the slot is
 * what makes the two loops exclusive: whichever starts second cancels the first
 * on the same element rather than compositing against it.
 */
const SNIPPET_WELL_MOTION_SLOT = "snippet-editor-well";

function SnippetEditorRow({
  snippet,
  store,
}: {
  snippet: Snippet;
  store: ReturnType<typeof getSnippetsStore>;
}): React.ReactElement {
  const manager = useFocusManager();
  const editorRef = useRef<TugMessageEditorHandle | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const wellRef = useRef<HTMLDivElement | null>(null);
  const focusableId = useId();

  // Slide the editor OPEN — the WELL grows from zero to its natural height so
  // the card visibly opens rather than snapping ([L06] via WAAPI, not React
  // state; reduced-motion honored by the animator). The clip + grow ride the
  // WELL, never the `.snippet-editor` wrapper: the wrapper must stay
  // `overflow: visible` so the sticky header can pin against the LIST scroller
  // (an `overflow: hidden` ancestor would capture the sticky as its own scroll
  // context and the header would scroll away with the body). The header shows
  // at full height from the first frame; the well opens beneath it.
  useLayoutEffect(() => {
    const el = wellRef.current;
    if (el === null) return;
    const target = el.getBoundingClientRect().height;
    if (target <= 0) return;
    const prevOverflow = el.style.overflow;
    el.style.overflow = "hidden";
    const restore = (): void => {
      el.style.overflow = prevOverflow;
      // The animator commits the final keyframe as inline styles (`height`,
      // `opacity`). Release them so the well returns to auto height and keeps
      // growing line-by-line as the snippet is typed — a committed `height`
      // would clamp the well at its open size.
      el.style.height = "";
      el.style.opacity = "";
    };
    animate(
      el,
      [
        { height: "0px", opacity: 0 },
        { height: `${target}px`, opacity: 1 },
      ],
      {
        duration: "--tug-motion-duration-moderate",
        easing: "cubic-bezier(0.2, 0, 0, 1)",
        key: SNIPPET_WELL_MOTION_SLOT,
      },
    ).finished.then(restore, restore);
  }, []);

  // Slide the editor SHUT — the mirror of the open above, and the reason every
  // close routes through here.
  //
  // There is no exit animation to run after the fact: closing clears the
  // store's `editingId`, the cell swaps back to the display row, and React
  // tears this subtree down inside that same commit. So the collapse has to run
  // BEFORE the commit — play the well to zero, then commit, and the unmount
  // lands on a well that is already closed, which is why the swap is invisible.
  //
  // Both loops share one motion slot with the open, so a close that catches an
  // open still in flight cancels it (snap-to-end, which runs the open's own
  // `restore` and releases its committed inline height) instead of racing it.
  const closingRef = useRef(false);
  const closeWithCollapse = useCallback((): void => {
    // Re-entrancy: ✕ ascends, and the ascend's blur arrives right behind it.
    if (closingRef.current) return;
    closingRef.current = true;
    const el = wellRef.current;
    const commit = (): void => {
      if (store.getSnapshot().editingId === snippet.id) {
        store.commitEdit();
        return;
      }
      // Editing moved on without us (a second snippet opened mid-collapse) —
      // this row is staying, so hand its well back its natural height.
      if (el !== null) {
        el.style.overflow = "";
        el.style.height = "";
        el.style.opacity = "";
      }
      closingRef.current = false;
    };
    if (el === null) {
      commit();
      return;
    }
    const from = el.getBoundingClientRect().height;
    el.style.overflow = "hidden";
    animate(
      el,
      [
        { height: `${from}px`, opacity: 1 },
        { height: "0px", opacity: 0 },
      ],
      {
        duration: "--tug-motion-duration-moderate",
        // Accelerating out, against the open's decelerating in: a card settles
        // into place when it arrives and leaves briskly when dismissed.
        easing: "cubic-bezier(0.4, 0, 1, 1)",
        key: SNIPPET_WELL_MOTION_SLOT,
      },
    ).finished.then(commit, commit);
  }, [store, snippet.id]);
  // Registers into the cell's per-row FocusModeContext, so `descendIntoRow`
  // finds this wrapper as the row's inner focusable. No key-view behavior:
  // a behavior-less leaf keeps Enter as a newline in the editor and leaves
  // Escape to the engine's ascend.
  const { focusableRef } = useFocusable({
    id: focusableId,
    group: "snippet-row-editor",
    order: 0,
  });

  // Claim the CM6 caret on open. The editor row only ever mounts from an
  // explicit open gesture (Enter / + / ⌘N via `editingId`), so taking focus
  // here is always the user's intent. The engine's `focusKeyView` cannot
  // land it: its generic DOM walk refuses a `tabIndex={-1}` wrapper and
  // cannot focus a contenteditable caret, and the substrate's responder
  // focus contract is keyed to the editor's responder id, not this wrapper's
  // focusable id. The delegate's `focus()` routes through `focusResponder`,
  // so first-responder state tracks the caret ([L11]).
  //
  // Deferred to a microtask deliberately: this child layout effect runs
  // BEFORE the section body's descend effect, and the focus claim must run
  // AFTER it — the descend's `pushFocusMode` captures the current key view
  // as the scope's Escape-restore target, and claiming first would make the
  // chain reflection coarsen the key view onto the editor's responder, so
  // Escape would "restore" focus straight back into the caret it should be
  // leaving. The microtask runs after the whole commit's effects, before
  // paint; the CM6 view exists by then.
  useLayoutEffect(() => {
    queueMicrotask(() => editorRef.current?.focus());
  }, []);

  // A pointerdown on the card's own CHROME (the sticky header, the well padding
  // around the text — anything that is NOT the editor's contenteditable) is not
  // a departure from the editor. Left alone, the engine's pointer placement
  // resolves such a click to the row's plain wrapper focusable, which is
  // engine-routed: it parks focus at the key sink, blurring the caret and
  // committing (closing) the snippet. The wrapper declares itself
  // placement-suppressing and the editor re-declares itself placeable
  // (`PLACEMENT_POLICY_ATTRIBUTE`, nearest marker wins), so the gesture
  // interpreter classifies a chrome click as `placement: "suppressed"` and the
  // caret stays put. A pointerdown in the text, in another row, or outside the
  // Lens is untouched, so those still place / commit as before.
  //
  // Timestamp of the last card-chrome pointerdown, read by `onBlur` as a
  // last-resort net. A recency window (not a one-shot boolean) is robust to the
  // blur firing either synchronously in the gesture OR a tick later — both land
  // inside the window. A non-chrome pointerdown or any keydown resets it to 0,
  // so clicking a different row / Escape / Tab still commits.
  const chromeClickTsRef = useRef(0);

  // The editor's own contenteditable is placeable — the marker on the wrapper
  // above would otherwise suppress placement for the text too, and a click in
  // the text must still resolve to the editor's dom-granted responder. Stamped
  // on the mounted CM6 root, which `TugMessageEditor` owns.
  useLayoutEffect(() => {
    wellRef.current
      ?.querySelector(".cm-editor")
      ?.setAttribute(PLACEMENT_POLICY_ATTRIBUTE, "place");
  }, []);

  useLayoutEffect(() => {
    const inChrome = (t: EventTarget | null): boolean => {
      const el = wrapRef.current;
      return (
        el !== null &&
        t instanceof Node &&
        el.contains(t) &&
        (!(t instanceof Element) || t.closest(".cm-editor") === null)
      );
    };
    // On a chrome pointerdown: stamp the recency window. Any other pointerdown
    // clears it.
    const onDown = (e: PointerEvent): void => {
      chromeClickTsRef.current = inChrome(e.target) ? Date.now() : 0;
    };
    // Stop the browser's OWN mousedown focus default too: the chrome is not
    // focusable, so the native default would pull DOM focus off the caret
    // (toward the nearest focusable ancestor, or clear it to the body), blurring
    // and committing the editor. `preventDefault` keeps the caret put; the click
    // still fires, so the header's buttons (copy / ✕) keep working.
    const onMouseDown = (e: MouseEvent): void => {
      if (inChrome(e.target)) e.preventDefault();
    };
    // A keyboard departure (Escape / Tab) is never a chrome click: close the
    // window so its blur commits.
    const onKey = (): void => {
      chromeClickTsRef.current = 0;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [manager]);

  const onFocus = useCallback((e: React.FocusEvent<HTMLDivElement>): void => {
    // A later engine focus lands on the wrapper itself; forward into the CM6
    // caret. Focus arriving already inside the editor passes through.
    if (e.target === e.currentTarget) editorRef.current?.focus();
  }, []);

  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>): void => {
      // Commit when focus leaves the row entirely (Escape-ascend, Tab,
      // click-away) — the single close path. Focus moves within the row
      // (wrapper → CM6) are not an exit.
      if (
        e.relatedTarget instanceof Node &&
        e.currentTarget.contains(e.relatedTarget)
      ) {
        return;
      }
      // Last-resort net for a blur that a chrome click still produced (the
      // engine placement was suppressed, so the caret can be restored without a
      // watchdog re-park fighting it). A blur within the recency window of a
      // chrome pointerdown is that click's — keep the editor and restore the
      // caret. The window is closed by a non-chrome pointerdown / keydown, so a
      // genuine departure still commits.
      if (Date.now() - chromeClickTsRef.current < 500) {
        queueMicrotask(() => editorRef.current?.focus());
        return;
      }
      closeWithCollapse();
    },
    [closeWithCollapse],
  );

  // ⌘Return commits and chains a new snippet; the new row's editor opens via
  // the store's `editingId` + the descend effect. Deliberately NOT routed
  // through `closeWithCollapse`: this is a typing gesture, and the caret has to
  // land in the next snippet on the same beat the key is pressed — a collapse
  // would hold it for the duration first. Closing is what animates; chaining is
  // what stays instant.
  const onSubmit = useCallback((): void => {
    manager?.ascend();
    store.commitEdit();
    store.createSnippet(snippet.id);
  }, [manager, store, snippet.id]);

  // Keep the caret in view as the snippet is edited. The editor grows uncapped
  // and the Lens list is the single scroller (see `snippets-section.css`), so a
  // snippet taller than the Lens makes the LIST scroll — nothing auto-follows
  // the caret there. On each user edit, reveal the caret element into the list
  // (`scrollIntoView` walks up to the list scroller); deferred a frame so CM6
  // has laid the caret at its new position first. This is why the edit can never
  // scroll off, even when the content dwarfs the Lens.
  const onChange = useCallback(
    (text: string): void => {
      store.updateSnippet(snippet.id, text);
      requestAnimationFrame(() => {
        wrapRef.current
          ?.querySelector<HTMLElement>(".tug-text-editor-caret")
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    },
    [store, snippet.id],
  );

  // Escape closes the editor. The engine's Escape ladder yields to a focused
  // CM6 editor (`data-tug-tab-consume` marks it as owning its keys), so the
  // ascend is this surface's to perform: CM6's completion keymap consumes
  // Escape first when a popup is open (arriving here `defaultPrevented`);
  // a bare Escape ascends the row scope, and the resulting blur commits.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      manager?.ascend();
    },
    [manager],
  );

  // The ✕ closes the open card: ascend (restores the list's key view) and the
  // resulting blur commits — the same path Escape takes.
  const onClose = useCallback(
    (e?: React.MouseEvent): void => {
      e?.stopPropagation();
      manager?.ascend();
      closeWithCollapse();
    },
    [manager, closeWithCollapse],
  );

  // The card header's title is the snippet's LIVE incipit — it re-renders with
  // every keystroke (the store update round-trips through the list), so the
  // header always names what the first line currently says. Same inline-
  // markdown rendering as the display row.
  const ctx = React.useContext(SnippetsCellContext);
  const incipit = snippetIncipit(snippet);
  const empty = incipit.length === 0;
  const rendered = empty ? null : renderPulseLine(incipit);
  const incipitHtml =
    rendered !== null && rendered.html.length > 0
      ? inlineMarkdownHtml(rendered.html)
      : null;

  // The open card: the snippet's own row stays as the card HEADER (selection
  // fill, copy / close), and the editor is the WELL beneath it. The two
  // compose as one full-width card whose edges are the list's existing lines —
  // no border of its own, so no nested rectangles are possible.
  return (
    <div
      className="snippet-editor"
      ref={(el) => {
        wrapRef.current = el;
        focusableRef(el);
      }}
      {...{ [PLACEMENT_POLICY_ATTRIBUTE]: "suppress" }}
      tabIndex={-1}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <TugListRow
        className="snippet-editor-header"
        data-snippet-id={snippet.id}
        selected
        onPointerDown={(e) => ctx?.onRowPointerDown(snippet.id, e)}
        trailing={
          <>
            <TugIconButton
              icon={<Copy size={12} />}
              size="xs"
              aria-label="Copy snippet"
              title="Copy snippet"
              onClick={(e) => {
                e?.stopPropagation();
                copySnippetText(snippet.text);
              }}
            />
            <TugIconButton
              icon={<X size={12} />}
              size="xs"
              aria-label="Close editor"
              title="Close editor"
              onClick={onClose}
            />
          </>
        }
      >
        <span
          className={
            empty
              ? "snippet-row-label snippet-row-label-empty"
              : "snippet-row-label"
          }
        >
          {empty ? (
            "New snippet"
          ) : incipitHtml !== null ? (
            <span
              className="snippet-row-incipit"
              dangerouslySetInnerHTML={{ __html: incipitHtml }}
            />
          ) : (
            incipit
          )}
        </span>
      </TugListRow>
      <div className="snippet-editor-well" ref={wellRef}>
        <TugMessageEditor
          ref={editorRef}
          value={snippet.text}
          placeholder="Type a snippet…"
          // A transient, in-list editor — NOT the card's primary text surface.
          // Registering the card's engine hooks as it mounts / unmounts churns
          // the card's hooks set, which re-fires the card's `applyBagFocus`
          // restore and yanks the keyboard key view off the Snippets list to the
          // Lens's default section on close. Opt out.
          suppressCardEngineHooks
          markdownTextStyling
          lineWrap
          fontSize="var(--tugx-snippet-editor-font-size)"
          maxRows={120}
          onChange={onChange}
          onSubmit={onSubmit}
          aria-label="Snippet text"
          data-testid="snippet-editor-field"
        />
      </div>
    </div>
  );
}

/** The `"snippet"` cell — one kind, branching display/editor on `editingId`.
 *  `selected` is the list-view-owned selection state; thread it to the display
 *  row so `TugListRow` paints its real selection fill (the picker look). */
const SnippetCell: TugListViewCellRenderer<LensSnippetsDataSource> = ({
  index,
  dataSource,
  selected,
}: TugListViewCellProps<LensSnippetsDataSource>) => {
  const snippet = dataSource.rowAt(index);
  const store = getSnippetsStore();
  const editingId = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().editingId,
  );
  return editingId === snippet.id ? (
    <SnippetEditorRow snippet={snippet} store={store} />
  ) : (
    <SnippetDisplayRow snippet={snippet} selected={selected} />
  );
};

const SNIPPETS_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<LensSnippetsDataSource>
> = { snippet: SnippetCell };

function SnippetsBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const { store, snapshot } = useSnippets();
  const snippets = snapshot.doc.snippets;
  const editingId = snapshot.editingId;
  const filterQuery = useSnippetsFilterQuery();
  const dataSource = useLensSnippetsDataSource(snippets, filterQuery, editingId);
  const filtering = filterQuery.trim().length > 0;
  // Content is what the list actually SHOWS: a section filtered to zero is not
  // a focus stop and drops out of the ⌘L seed, exactly like an empty one. The
  // band's filter field registers independently, so it stays reachable.
  const hasContent = dataSource.numberOfItems() > 0;
  // …and what it holds BEFORE the filter, the separate question the band's
  // filter field turns on: a section filtered to zero still has items.
  const hasItems = dataSource.unfilteredCount() > 0;

  // Publish both: `navigable` so the Lens skips this band for the Cmd-L seed /
  // Tab walk when the list shows nothing, `populated` so the band knows
  // whether there is anything to filter at all.
  useLayoutEffect(() => {
    setSectionContent(host.focusGroup, {
      navigable: hasContent,
      populated: hasItems,
    });
    return () =>
      setSectionContent(host.focusGroup, {
        navigable: false,
        populated: false,
      });
  }, [host.focusGroup, hasContent, hasItems]);

  const listRef = useRef<TugListViewHandle>(null);
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const focusManager = useFocusManager();

  // Descend into a row when it opens for editing ([P06]/[R01]): the editor cell
  // mounts in the same commit that set `editingId`; this parent layout effect
  // runs after the child editor has registered its focusable, so the descend
  // finds it. Guarded so it fires once per open (not on every keystroke).
  const prevEditingRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (editingId !== null && editingId !== prevEditingRef.current) {
      const index = dataSource.indexForId(editingId);
      if (index >= 0) listRef.current?.descendIntoRow(index);
    }
    prevEditingRef.current = editingId;
  }, [editingId, dataSource]);

  const initialSelectedIndex = useMemo(() => {
    if (lastSelectedSnippetId === null) return undefined;
    const i = dataSource.indexForId(lastSelectedSnippetId);
    return i >= 0 ? i : undefined;
    // Recompute when membership changes (the version bump re-runs on length).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, snippets.length]);

  // The Things model on the list view's own `selectionRequired` shape: the list
  // owns a never-null selected row and stamps `data-selected`, so the REAL
  // `TugListRow` selection fill paints (the session-picker look — no hand-rolled
  // styling). A single click (`onSelect`) SELECTS + focuses the row but NEVER
  // opens it; the row OPENS only on Enter (`onActivate`, via `commitOnEnter`) or
  // a double-click (`onActivate`, via `activateOnDoubleClick`) — the first click
  // of the pair selects, the second opens. Both remember the snippet for the
  // next Cmd-L / Tab seed ([P10]).
  const delegate = useMemo<TugListViewDelegate>(() => {
    const remember = (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row !== undefined) lastSelectedSnippetId = row.id;
    };
    const open = (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row === undefined) return;
      lastSelectedSnippetId = row.id;
      store.beginEdit(row.id);
    };
    return { onSelect: remember, onActivate: open };
  }, [dataSource, store]);

  // State-mirror for the list-view-owned selection ([L24]) — keep the remembered
  // snippet id in step with the selection as it moves (seed, click).
  const onSelectionChange = useCallback(
    (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row !== undefined) lastSelectedSnippetId = row.id;
    },
    [dataSource],
  );

  // Destructive-delete confirmation ([D15] controlled `TugConfirmPopover`): the
  // row ✕ opens the popover anchored to itself instead of deleting immediately.
  // Local UI state ([L24]) — the pending row id + its anchor element.
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    anchorEl: HTMLElement;
  } | null>(null);

  // Delete `id` and land the cursor on the surviving neighbor (same index,
  // clamped) so the keyboard position never vanishes with the row. Shared by
  // the keyboard Delete verb and the row's pointer delete button.
  const deleteSnippetKeepingCursor = useCallback(
    (id: string): void => {
      const index = dataSource.indexForId(id);
      if (index < 0) return;
      const survivorCount = dataSource.numberOfItems() - 1;
      // The survivor is read from the PROJECTION before the delete — under a
      // filter the doc's neighbor is not the list's neighbor, and indexing the
      // doc by a list index would remember the wrong snippet.
      const survivor = dataSource.rowAt(index + 1) ?? dataSource.rowAt(index - 1);
      store.deleteSnippet(id);
      if (survivorCount <= 0) return;
      const landing = Math.min(index, survivorCount - 1);
      if (survivor !== undefined) lastSelectedSnippetId = survivor.id;
      listRef.current?.moveCursorTo(landing);
    },
    [dataSource, store],
  );

  // Reorder by carrying the row: commit on drop ([Q02]). Rows are matched by
  // their stable `data-snippet-id`; the FLIP animates the row content, the
  // store commit reorders the document.
  const { onRowPointerDown: beginRowReorder } = useBlockReorder({
    containerRef: listWrapRef,
    caretRef,
    getVisibleOrder: () => snapshot.doc.snippets.map((s) => s.id),
    commit: (order) => store.setOrder([...order]),
    selector: ROW_SELECTOR,
    kindAttr: ROW_KIND_ATTR,
    // The incipit is a native drag source into a session prompt, so the arm
    // must not cancel the press the browser starts that drag from.
    nativeDragSource: true,
    // Hand the keyboard to the row that was set down. A row's press normally
    // places it here itself; the drop swallows the trailing click so a carry
    // never reads as an activation, and this is that landing handed back.
    // Both registers move — the list takes the key view through `place()`
    // ([L22]), the movement cursor parks on the row — and the remembered
    // selection follows, so a later Cmd-L returns to the row the user moved
    // rather than to whatever it was before the drag.
    landKeyboard: (id) => {
      const index = dataSource.indexForId(id);
      if (index < 0) return;
      lastSelectedSnippetId = id;
      focusManager?.place(
        host.lensCardId,
        { kind: "focus-key", focusKey: `${host.focusGroup}:0` },
        { modality: "keyboard" },
      );
      listRef.current?.moveCursorTo(index);
    },
  });
  // Reorder is unavailable while a filter is active: the drop order the drag
  // computes describes the VISIBLE rows, and `store.setOrder` expects the whole
  // document — there is no coherent way to splice a partial order back in. The
  // gesture is simply never armed while the filter is on.
  const onRowPointerDown = useCallback(
    (id: string, event: React.PointerEvent): void => {
      if (filtering) return;
      beginRowReorder(id, event);
    },
    [filtering, beginRowReorder],
  );
  const cellContext = useMemo<SnippetsCellContextValue>(
    () => ({
      onRowPointerDown,
      onRequestDelete: (id, anchorEl) => setPendingDelete({ id, anchorEl }),
    }),
    [onRowPointerDown],
  );

  // The keyboard's current row — the movement cursor's cell (`data-key-cursor`),
  // projected by the engine ([L06]). In `selectionRequired` mode a click also
  // commits selection here, so the cursor row and the selected (`data-selected`)
  // fill coincide under the pointer; the section verbs (create-below / delete)
  // act on the cursor row.
  const cursorCell = useCallback(
    (): HTMLElement | null =>
      listWrapRef.current?.querySelector<HTMLElement>("[data-key-cursor]") ?? null,
    [],
  );
  const cursorSnippetId = useCallback((): string | null => {
    const idxAttr = cursorCell()?.getAttribute("data-tug-list-cell-index");
    if (idxAttr === null || idxAttr === undefined) return null;
    const idx = Number.parseInt(idxAttr, 10);
    // A list index names a row in the PROJECTION, never a position in the doc.
    return dataSource.rowAt(idx)?.id ?? null;
  }, [cursorCell, dataSource]);

  // Section verbs — Space / ⌘N create a new snippet below the cursor (the
  // Things-style gesture), Delete removes the cursor row. Delivered through
  // the list's key-view delegate (`onKeyViewKey` — the [P05] channel): in
  // engine-routed mode keydown lands on the key sink, never in this
  // subtree, so a bubble-phase container `onKeyDown` is structurally dead.
  // The list reserves Space via `captureKeys` (otherwise it would resolve
  // to the item-container select before reaching this delegate). Only in
  // list mode; the editor owns keys while open (dom-granted — the delegate
  // never fires — plus the `editingId` guard for the descended-scope
  // fallback delivery).
  const onSectionKeyViewKey = useCallback(
    (e: KeyboardEvent): boolean => {
      if (editingId !== null) return false; // the editor owns keys while open
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // `createSnippet(afterId)` inserts after `afterId` and opens the new
        // row for editing (its descend effect focuses the caret). A null
        // cursor (empty list / no landing) appends at the end.
        store.createSnippet(cursorSnippetId());
        return true;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const id = cursorSnippetId();
        const anchor = cursorCell();
        if (id === null || anchor === null) return false;
        // Destructive — raise the SAME confirm popover the mouse ✕ does, anchored
        // to the cursor row. Confirm deletes (keeping the cursor on a neighbor).
        setPendingDelete({ id, anchorEl: anchor });
        return true;
      }
      return false;
    },
    [editingId, store, cursorSnippetId, cursorCell],
  );
  // ⌘/⌃ chords never reach the key-view delegate (they belong to the
  // bindings tier), so the old ⌘N-in-list-mode alias does not ride it;
  // Space and the band's + button are the create gestures.

  // ⌘Z / ⇧⌘Z route through the responder chain as UNDO/REDO. Handle them only
  // in list mode: while editing, omit the handlers so the chain walks past to
  // the editor's own undo responder ([the KeyZ binding does not preventDefault]).
  const responderId = useId();
  const responderActions = useMemo(
    () =>
      editingId === null
        ? {
            [TUG_ACTIONS.UNDO]: () => store.undo(),
            [TUG_ACTIONS.REDO]: () => store.redo(),
          }
        : undefined,
    [editingId, store],
  );
  const { ResponderScope, responderRef } = useResponder({
    id: responderId,
    actions: responderActions,
  });

  return (
    <ResponderScope>
      <div
        ref={responderRef as (el: HTMLDivElement | null) => void}
        className="snippets-section"
      >
        {snapshot.error !== null ? (
          <div className="snippets-error" role="status">
            Snippets are read-only: {snapshot.error}
          </div>
        ) : null}
        {snippets.length === 0 ? (
          // Empty label instead of the list — an empty `flex: 1` list would grow
          // and open a gap under the band (see the Sessions section).
          <div className="lens-section-empty snippets-empty">None</div>
        ) : dataSource.numberOfItems() === 0 ? (
          // Distinct from "None": there ARE snippets, the filter is hiding them.
          <div
            className="lens-section-empty snippets-empty"
            data-testid="lens-snippets-no-matches"
          >
            No matches
          </div>
        ) : (
          <div
            className="snippets-list-wrap"
            ref={listWrapRef}
            data-filter-active={filtering ? "true" : undefined}
          >
            <BlockDropCaret ref={caretRef} />
            <SnippetsCellContext value={cellContext}>
              <TugListView<LensSnippetsDataSource>
                ref={listRef}
                dataSource={dataSource}
                delegate={delegate}
                cellRenderers={SNIPPETS_CELL_RENDERERS}
                scrollKey="lens-snippets"
                ringPlacement="inset"
                inline
                rowLayout="flush"
                focusGroup={hasContent ? host.focusGroup : undefined}
                commitOnEnter="act"
                activateOnDoubleClick
                selectionRequired
                selectionFollowsCursor
                captureKeys={SNIPPETS_CAPTURE_KEYS}
                onKeyViewKey={onSectionKeyViewKey}
                onSelectionChange={onSelectionChange}
                initialSelectedIndex={initialSelectedIndex}
                {...LENS_LIST_PRESENTATION}
                className="lens-oneline-list lens-snippets-list"
              />
            </SnippetsCellContext>
          </div>
        )}
        {/* One controlled confirm popover serves every row — it anchors to the
            ROW the question is about (never to the hover-revealed ✕, which
            unmounts under its own popover), centered over it and pointing down
            at it. Confirm deletes (keeping the cursor on a surviving neighbor);
            cancel / outside-click / Escape dismisses. */}
        <TugConfirmPopover
          open={pendingDelete !== null}
          anchorEl={pendingDelete?.anchorEl ?? null}
          message="Delete this snippet?"
          confirmLabel="Delete"
          confirmRole="danger"
          side="top"
          align="center"
          arrow
          onConfirm={() => {
            if (pendingDelete !== null) deleteSnippetKeepingCursor(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      </div>
    </ResponderScope>
  );
}

/** Register the Snippets section. Called once at boot from `main.tsx`. */
export function registerSnippetsSection(): void {
  registerLensSection({
    kind: SECTION_KIND,
    title: "Snippets",
    filterable: true,
    glyph: <TextQuote size={14} />,
    collapsedSummary: () => <SnippetsCollapsedSummary />,
    headerActions: () => <SnippetsHeaderActions />,
    body: (host) => <SnippetsBody host={host} />,
  });
}
