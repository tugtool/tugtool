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
 * a row click opens it directly.
 *
 * It portals into the canvas overlay root ([L25]) so it floats above every
 * pane, escaping their `overflow: hidden`. A native `<input>` owns focus
 * while open — so this is a lightweight popover, NOT a focus-mode trap
 * (`focus-language.md`): there is no key-view seed or spatial ring to
 * register; the field's own browser focus and blur drive open/commit/
 * dismiss.
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

export function TugCompletionPopup({
  placeholder = "Open Quickly",
  provider,
  onCommit,
  onDismiss,
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
  // so in practice this fires only on a real focus shift away).
  const onBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const next = e.relatedTarget as Node | null;
      if (next !== null && panelRef.current?.contains(next)) return;
      onDismiss();
    },
    [onDismiss],
  );

  return createPortal(
    <div
      className="tug-completion-popup-backdrop"
      data-slot="tug-completion-popup-backdrop"
      // A press outside the panel dismisses. mousedown (not click) so it
      // beats the field's blur race and feels immediate.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        ref={panelRef}
        className="tug-completion-popup"
        data-slot="tug-completion-popup"
        role="dialog"
        aria-label={placeholder}
      >
        <div className="tug-completion-popup-field">
          <Search className="tug-completion-popup-field-icon" aria-hidden />
          <input
            ref={inputRef}
            className="tug-completion-popup-input"
            data-slot="tug-completion-popup-input"
            type="text"
            spellCheck={false}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          />
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
        ) : null}
      </div>
    </div>,
    overlayRoot,
  );
}
