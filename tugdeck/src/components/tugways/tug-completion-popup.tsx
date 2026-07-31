/**
 * tug-completion-popup.tsx — a centered, floating search-and-pick popup
 * (the Xcode "Open Quickly" instrument).
 *
 * A self-contained overlay: a search field over a scrolling result list,
 * driven by any {@link CompletionProvider} — the same `(query) => items`
 * contract the `@`-file completion in the composer uses, so a live
 * `FileTreeStore` provider drops straight in. It renders no data source of
 * its own; the caller supplies the provider and handles commit.
 *
 * Dismissal is deliberately easy ([the popup is not a modal trap]): a
 * click anywhere outside the panel, moving focus off the field, or Escape
 * all dismiss. Return opens the highlighted row; ↑/↓ move the highlight;
 * a row click opens it directly. A caller that puts an `accessory` on the bar
 * whose own menu portals outside the panel passes a `dismissGuard` to hold
 * the popup open while that menu is up — the one seam in the easy-dismissal
 * rule, and Escape is exempt from it.
 *
 * It portals into the canvas overlay root ([L25]) so it floats above every
 * pane, escaping their `overflow: hidden`. The field owns focus while open —
 * so this is a lightweight popover, NOT a focus-mode trap
 * (`focus-language.md`): there is no key-view seed or spatial ring to
 * register; the field's own browser focus and blur drive open/commit/
 * dismiss.
 *
 * The field is a {@link TugInput}, not a bare `<input>`, so it registers as
 * a chain responder and carries the substrate CUT / COPY / PASTE /
 * SELECT_ALL / UNDO / REDO handlers plus the right-click editing menu. That
 * registration is load-bearing, not decorative: ⌘V is a capture-phase
 * global binding with `preventDefaultOnMatch`, dispatched to the first
 * responder. A bare `<input>` carries no `data-responder-id`, so focusing it
 * promotes nothing — the paste would be swallowed by whatever surface behind
 * the popup still held first responder.
 *
 * Laws: [L06] appearance via CSS + DOM, no React state for looks; [L19]
 * authoring guide (`data-slot`, tokens); [L25] mounted into the canvas
 * overlay, not a pane.
 *
 * @module components/tugways/tug-completion-popup
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

import "./tug-completion-popup.css";

import { TugInput } from "./tug-input";
import { TAB_CONSUME_ATTRIBUTE } from "./focus-manager";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";

export interface TugCompletionPopupProps {
  /** Placeholder shown in the empty search field. */
  placeholder?: string;
  /**
   * Completion source: `(query) => items`, optionally with a `subscribe`
   * for async result streams (a `FileTreeStore` provider has both).
   */
  provider: CompletionProvider;
  /** Open the chosen item (Return on the highlight, or a row click). */
  onCommit: (item: CompletionItem) => void;
  /** Dismiss without opening (Escape, outside click, focus leaving). */
  onDismiss: () => void;
  /**
   * Optional trailing control on the search bar — Open Quickly's directory
   * switcher. It renders inside the panel, so it is a natural Tab stop after
   * the field and focus reaching it does not dismiss.
   */
  accessory?: React.ReactNode;
  /**
   * Shown in place of the result list when the provider returns nothing — "no
   * files here", as opposed to the blank panel that reads as "still thinking".
   * Returning `null` renders nothing, which is what a caller that cannot yet
   * tell the two apart should do.
   *
   * A callback rather than a string because the answer depends on state the
   * popup does not own (has the search backend answered yet?) and is read at
   * render time — the same render the provider's notification triggers, so the
   * two can never disagree about whether results are in.
   */
  emptyLabel?: () => string | null;
  /**
   * Consulted before every non-Escape dismissal. Return `true` to hold the
   * popup open — what an {@link accessory} whose own menu is portalled
   * OUTSIDE the panel needs, since focus landing in that menu looks like
   * focus leaving the popup. Escape always dismisses.
   */
  dismissGuard?: () => boolean;
}

/**
 * Split `label` into matched / unmatched runs from a provider's
 * `[start, end)` match ranges, so matched characters can be emphasized
 * the way the composer's completion popup does.
 */
function renderLabel(
  label: string,
  matches: [number, number][] | undefined,
): React.ReactNode {
  if (!matches || matches.length === 0) return label;
  const ordered = [...matches].sort((a, b) => a[0] - b[0]);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ordered.forEach(([start, end], i) => {
    const s = Math.max(cursor, start);
    if (s > cursor) parts.push(label.slice(cursor, s));
    if (end > s) {
      parts.push(
        <strong key={i} className="tug-completion-popup-match">
          {label.slice(s, end)}
        </strong>,
      );
    }
    cursor = Math.max(cursor, end);
  });
  if (cursor < label.length) parts.push(label.slice(cursor));
  return parts;
}

/** The empty-result panel, or nothing when the caller has no answer to give. */
function renderEmpty(
  emptyLabel: (() => string | null) | undefined,
): React.ReactElement | null {
  const text = emptyLabel?.() ?? null;
  if (text === null) return null;
  return (
    <div
      className="tug-completion-popup-empty"
      data-slot="tug-completion-popup-empty"
    >
      {text}
    </div>
  );
}

export function TugCompletionPopup({
  placeholder = "Open Quickly",
  provider,
  onCommit,
  onDismiss,
  accessory,
  dismissGuard,
  emptyLabel,
}: TugCompletionPopupProps): React.ReactElement {
  const overlayRoot = useCanvasOverlay();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CompletionItem[]>([]);
  const [selected, setSelected] = useState(0);

  // Pull results for the current query. Kept in a ref so the async
  // subscription re-pulls the live query without re-subscribing.
  const queryRef = useRef(query);
  queryRef.current = query;
  const pull = useCallback(() => {
    const next = provider(queryRef.current);
    setItems(next);
    setSelected((prev) => (prev < next.length ? prev : 0));
  }, [provider]);

  // Re-query on keystroke.
  useEffect(() => {
    pull();
  }, [query, pull]);

  // Async provider results (FileTreeStore streams over the WebSocket):
  // re-pull when the store notifies. [L22]-style direct observation.
  useEffect(() => {
    if (provider.subscribe === undefined) return;
    return provider.subscribe(() => pull());
  }, [provider, pull]);

  // Claim focus on open so typing lands in the field immediately.
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted row in view as the selection moves.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const row = panel.querySelector<HTMLElement>(
      `[data-index="${selected}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const commit = useCallback(
    (item: CompletionItem | undefined) => {
      if (item !== undefined) onCommit(item);
    },
    [onCommit],
  );

  /** The accessory's focusable control, if the caller supplied one. */
  const accessoryControl = useCallback((): HTMLElement | null => {
    const slot = panelRef.current?.querySelector<HTMLElement>(
      '[data-slot="tug-completion-popup-accessory"]',
    );
    return (
      slot?.querySelector<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? null
    );
  }, []);

  // Tab opens the accessory's menu. It does NOT move DOM focus to the
  // accessory first, which is the shape this went through twice before
  // landing here:
  //
  //   - Native Tab is not an option. On macOS, WebKit's sequential focus
  //     navigation visits buttons only when Full Keyboard Access is on — off
  //     (the default), Tab walks straight past the accessory and off the end
  //     of the popup, and the field's blur dismisses it. The popup vanishes
  //     out from under anyone who reaches for Tab.
  //   - Focusing the accessory explicitly does not hold either. A control
  //     trigger carries `data-tug-focus="refuse"` — it sits outside the key
  //     loop by construction — so the engine reclaims DOM focus to the key
  //     sink the moment it lands there, and the trigger is focused for one
  //     frame and then is not.
  //
  // So Tab skips the intermediate stop entirely: one keystroke opens the
  // menu, whose own focus scope legitimately owns the keyboard while it is
  // up (arrows to move, Return to pick, Escape to close), and the field keeps
  // DOM focus the whole time. Radix opens its trigger on pointer-down, so
  // that is the gesture synthesized here.
  //
  // Handled on the panel rather than the field so it fires wherever focus
  // sits inside the popup. With no accessory, Tab is left alone.
  const onPanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
      const control = accessoryControl();
      if (control === null) return;
      e.preventDefault();
      for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        control.dispatchEvent(
          new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
          }),
        );
      }
      setAccessoryMenuOpen(true);
    },
    [accessoryControl],
  );

  // Take the keyboard back when the accessory's menu closes.
  //
  // The menu's focus scope restores focus to whatever owned it before the
  // menu opened — which, from the engine's point of view, is its key sink,
  // not this popup's field. Left alone the popup would still be on screen
  // with the keyboard somewhere else, and the next keystroke would go
  // nowhere. The reclaim is scoped to a menu we opened and armed only while
  // one is up, so it can never fight a real dismissal.
  const [accessoryMenuOpen, setAccessoryMenuOpen] = useState(false);
  useEffect(() => {
    if (!accessoryMenuOpen) return;
    const onFocusIn = (): void => {
      if (dismissGuard?.() === true) return; // menu still up
      setAccessoryMenuOpen(false);
      if (panelRef.current?.contains(document.activeElement) !== true) {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, [accessoryMenuOpen, dismissGuard]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelected((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelected((i) =>
            items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
          );
          break;
        case "Enter":
          e.preventDefault();
          commit(items[selected]);
          break;
        case "Escape":
          e.preventDefault();
          onDismiss();
          break;
        default:
          break;
      }
    },
    [items, selected, commit, onDismiss],
  );

  // Focus leaving the field dismisses — unless it moved to a control
  // inside the panel (the row-click path keeps focus via preventDefault,
  // so in practice this fires only on a real focus shift away), or the
  // guard is holding the popup open for an accessory's portalled menu.
  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next !== null && panelRef.current?.contains(next)) return;
      if (dismissGuard?.() === true) return;
      onDismiss();
    },
    [onDismiss, dismissGuard],
  );

  return createPortal(
    <div
      className="tug-completion-popup-backdrop"
      data-slot="tug-completion-popup-backdrop"
      // A press outside the panel dismisses. mousedown (not click) so it
      // beats the field's blur race and feels immediate.
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (dismissGuard?.() === true) return;
        onDismiss();
      }}
    >
      <div
        ref={panelRef}
        className="tug-completion-popup"
        data-slot="tug-completion-popup"
        role="dialog"
        aria-label={placeholder}
        // The popup owns Tab while it is up ({@link TAB_CONSUME_ATTRIBUTE}).
        // Without this the engine's capture-phase focus walk advances the key
        // view to a focusable BEHIND the popup, which pulls DOM focus out of
        // the field — and the blur dismisses the popup. Declaring the seam
        // yields Tab to this panel, which moves focus itself in
        // `onPanelKeyDown`.
        {...{ [TAB_CONSUME_ATTRIBUTE]: "true" }}
        onKeyDown={onPanelKeyDown}
      >
        <div className="tug-completion-popup-field">
          <Search className="tug-completion-popup-field-icon" aria-hidden />
          <TugInput
            ref={inputRef}
            className="tug-completion-popup-input"
            borderless
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          />
          {accessory !== undefined ? (
            <div
              className="tug-completion-popup-accessory"
              data-slot="tug-completion-popup-accessory"
            >
              {accessory}
            </div>
          ) : null}
        </div>
        {items.length > 0 ? (
          <ul
            className="tug-completion-popup-list"
            data-slot="tug-completion-popup-list"
            role="listbox"
          >
            {items.map((item, i) => (
              <li
                key={item.label + i}
                data-index={i}
                data-selected={i === selected ? "true" : undefined}
                className="tug-completion-popup-row"
                role="option"
                aria-selected={i === selected}
                onMouseMove={() => setSelected(i)}
                // Keep focus in the field so onBlur doesn't dismiss before
                // the click opens the row.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(item)}
              >
                {renderLabel(item.label, item.matches)}
              </li>
            ))}
          </ul>
        ) : (
          renderEmpty(emptyLabel)
        )}
      </div>
    </div>,
    overlayRoot,
  );
}
