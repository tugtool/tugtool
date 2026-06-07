/**
 * TugFileChooser — a path input with filesystem completion + a native picker.
 *
 * A controlled text field that completes filesystem paths as you type, showing
 * matches in a floating overlay (the `tug-completion-menu` look, portaled into
 * the canvas overlay tier so it's never clipped and reserves no layout space),
 * plus a square "Browse…" button that opens the macOS `NSOpenPanel`.
 *
 * Behavior mirrors the prompt-entry `@`-mention menu:
 *   - typing fetches completions (debounced) from tugcast's `/api/fs/complete`;
 *   - ↑/↓ move the highlight, the mouse follows it (single highlight);
 *   - Enter / Tab accept the highlighted match;
 *   - accepting a **directory** descends into it (keeps the menu open, fetches
 *     its children); accepting a **file** commits and closes;
 *   - Escape closes the menu (and only the menu — it stops there);
 *   - Enter with the menu closed calls `onSubmit` (the consumer's commit).
 *
 * `kind` selects what's offered + what the picker returns: `directory` (default)
 * lists only directories; `file` lists files too (directories still appear so
 * the user can descend toward a file).
 *
 * Compositional component — composes `TugInput` + `TugPushButton`; its overlay
 * borrows `tug-completion-menu.css`. Laws: [L02] (n/a — local UI state), [L06]
 * appearance via CSS, [L20] composed children keep their own tokens.
 *
 * @module components/tugways/tug-file-chooser
 */

import "./tug-completion-menu.css";
import "./tug-file-chooser.css";

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FolderOpen } from "lucide-react";

import { TugInput } from "./tug-input";
import { TugPushButton } from "./tug-push-button";
import { useFocusable } from "./use-focusable";
import { TAB_CONSUME_ATTRIBUTE } from "./focus-manager";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import {
  fetchPathCompletions,
  type CompletionKind,
  type PathCompletion,
} from "@/lib/fs-complete";
import { isPathPickerAvailable, pickPath } from "@/lib/native-path-picker";

/** Props for {@link TugFileChooser}. */
export interface TugFileChooserProps {
  /** Controlled input value (the path text). */
  value: string;
  /** Called when the value changes — typing, accepting a match, or the picker. */
  onChange: (value: string) => void;
  /** Working directory that relative completions + the picker resolve under. */
  base: string;
  /** What to choose: `directory` (default) or `file` (files + descendable dirs). */
  kind?: CompletionKind;
  /** Fired on Enter when the completion menu is closed — the consumer's commit. */
  onSubmit?: () => void;
  /** Fired when the completion menu opens / closes (e.g. to hide a sibling list). */
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  "aria-label"?: string;
  /** Input + button size. Defaults to `sm`. */
  size?: "sm" | "md" | "lg";
  /** Show the native "Browse…" picker button (default true; auto-hidden off-host). */
  showBrowse?: boolean;
  /** Focus the input on mount. */
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  /**
   * Author the field into a focus group ([P02]) — the standard `useFocusable`
   * opt-in every other interactive control exposes. When set, the input
   * registers as one stop in the surrounding surface's Tab walk (the engine
   * lands the key view on the real `<input>` caret, so typing works), and a
   * host that owns the Tab order (e.g. the session picker's persistent walk)
   * can place it. Omitted by default — the field is an ordinary native stop and
   * never joins an authored walk. The field never *owns* Tab except while its
   * completion menu is open (see {@link TAB_CONSUME_ATTRIBUTE} below): Tab then
   * accepts the highlighted match; with the menu closed Tab leaves the field.
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. Defaults to 0. */
  focusOrder?: number;
}

const DEBOUNCE_MS = 120;

/** The basename prefix being completed — the text after the last `/`. */
function queryPrefix(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash === -1 ? value : value.slice(slash + 1);
}

/**
 * Render a completion label with its matched leading prefix bolded (completion
 * is prefix-based, so the first `prefixLen` chars matched).
 */
function MatchedLabel({ label, prefixLen }: { label: string; prefixLen: number }): React.ReactElement {
  if (prefixLen <= 0 || prefixLen > label.length) {
    return <span className="tug-completion-menu-label">{label}</span>;
  }
  return (
    <span className="tug-completion-menu-label">
      <span className="tug-completion-match">{label.slice(0, prefixLen)}</span>
      {label.slice(prefixLen)}
    </span>
  );
}

/**
 * A path field with filesystem completion + a native picker. See the module doc
 * for the full interaction model.
 */
export const TugFileChooser = React.forwardRef<HTMLInputElement, TugFileChooserProps>(
  function TugFileChooser(
    {
      value,
      onChange,
      base,
      kind = "directory",
      onSubmit,
      onOpenChange,
      placeholder,
      "aria-label": ariaLabel,
      size = "sm",
      showBrowse = true,
      autoFocus,
      className,
      disabled,
      focusGroup,
      focusOrder = 0,
    },
    forwardedRef,
  ) {
    const [completions, setCompletions] = useState<readonly PathCompletion[]>([]);
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLUListElement | null>(null);
    const focusedRef = useRef(false);
    // The menu opens only as a result of the user *typing* (or descending into a
    // directory) — never on focus or from an initial/programmatic value. Without
    // this, a pre-filled field (e.g. the session chooser's seeded path) would pop
    // the menu on mount, before the input is positioned, rendering it adrift.
    const armedRef = useRef(false);
    // Bumped per fetch so a slow earlier response can't overwrite a newer one.
    const reqSeqRef = useRef(0);

    const overlayRoot = useCanvasOverlay();
    const showPicker = showBrowse && isPathPickerAvailable();

    // Standard focus-stop opt-in ([P02]). The focusable is the `<input>` itself,
    // so the engine lands the key view on the real caret. `consumesTab` is read
    // live by the walk only when the field is the key view; the DOM marker below
    // is the robust signal while the user is actually typing in the field. Both
    // say the same thing: the field owns Tab iff its completion menu is open.
    const focusableId = useId();
    const { focusableRef } = useFocusable({
      id: focusableId,
      group: focusGroup ?? "",
      order: focusOrder,
      register: focusGroup !== undefined,
      consumesTab: () => open,
    });

    const setInputRef = useCallback(
      (el: HTMLInputElement | null) => {
        inputRef.current = el;
        // Project the focus-stop attribute onto the input (no-op when
        // un-authored); the engine resolves + lands focus on this element.
        focusableRef(el);
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      },
      [forwardedRef, focusableRef],
    );

    // Tab-consumption marker ([Q02], the editor's pattern). While the completion
    // menu is open the field owns Tab — it accepts the highlighted match — so the
    // document-level focus walk must yield. The marker rides the `<input>` (the
    // active element while editing) so the walk's `closest([data-tug-tab-consume])`
    // check sees it; cleared when the menu closes so Tab then leaves the field.
    // Appearance-zone DOM write ([L06]), never React state.
    useLayoutEffect(() => {
      const el = inputRef.current;
      if (el === null) return;
      if (open) el.setAttribute(TAB_CONSUME_ATTRIBUTE, "true");
      else el.removeAttribute(TAB_CONSUME_ATTRIBUTE);
    }, [open]);

    // Measure the input so the portaled overlay can anchor under it.
    const measure = useCallback(() => {
      const el = inputRef.current;
      if (el === null) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom, left: r.left, width: r.width });
    }, []);

    // Debounced completion fetch on value / kind / base change. Opens the menu
    // only when armed (the change came from user typing / descending) and
    // focused with matches; closes it otherwise.
    useEffect(() => {
      const handle = setTimeout(() => {
        const seq = (reqSeqRef.current += 1);
        void fetchPathCompletions(base, value, kind).then((items) => {
          if (seq !== reqSeqRef.current) return; // a newer fetch superseded us
          setCompletions(items);
          setActiveIndex(0);
          if (armedRef.current && focusedRef.current && items.length > 0) {
            measure();
            setOpen(true);
          } else {
            setOpen(false);
          }
        });
      }, DEBOUNCE_MS);
      return () => clearTimeout(handle);
    }, [value, kind, base, measure]);

    // Keep the overlay anchored while it's open (the sheet/page can scroll).
    useLayoutEffect(() => {
      if (!open) return;
      measure();
      const onScrollOrResize = (): void => measure();
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize);
      return () => {
        window.removeEventListener("scroll", onScrollOrResize, true);
        window.removeEventListener("resize", onScrollOrResize);
      };
    }, [open, measure]);

    // Keep the highlighted row in view during keyboard navigation.
    useEffect(() => {
      if (!open) return;
      const list = listRef.current;
      const row = list?.children[activeIndex] as HTMLElement | undefined;
      row?.scrollIntoView({ block: "nearest" });
    }, [open, activeIndex]);

    const closeMenu = useCallback(() => {
      setOpen(false);
      armedRef.current = false;
      reqSeqRef.current += 1; // drop any in-flight fetch's open
    }, []);

    const acceptItem = useCallback(
      (item: PathCompletion) => {
        if (item.isDir) {
          // Descend: stay armed so the value-change effect refetches the new
          // directory's children and re-opens. Keep focus for navigation.
          armedRef.current = true;
          onChange(item.value);
          inputRef.current?.focus();
        } else {
          armedRef.current = false;
          onChange(item.value);
          closeMenu();
        }
      },
      [onChange, closeMenu],
    );

    // Notify the consumer when the menu opens/closes (so a sibling list can
    // step aside while completions are showing).
    useEffect(() => {
      onOpenChange?.(open);
    }, [open, onOpenChange]);

    // Normalize the resting value when the menu closes: a trailing slash is a
    // transient navigation aid (it's what lets you descend into a directory),
    // but once the menu is dismissed the value should be the canonical path so
    // `/x/` and `/x` are treated as the same — no duplicate-with-slash entries
    // downstream. Root "/" is preserved.
    const prevOpenRef = useRef(open);
    useEffect(() => {
      const wasOpen = prevOpenRef.current;
      prevOpenRef.current = open;
      if (wasOpen && !open && value.length > 1 && value.endsWith("/")) {
        onChange(value.replace(/\/+$/, "") || "/");
      }
    }, [open, value, onChange]);

    // While the menu is open, swallow Escape at the window capture phase so it
    // closes ONLY the menu — ahead of the sheet/dialog's own Escape handler
    // (a document/chrome-level listener), which would otherwise dismiss the
    // whole sheet. Bubble-phase stopPropagation can't beat a capture handler;
    // a window-capture listener fires first in the event path.
    useEffect(() => {
      if (!open) return;
      const onCaptureKeyDown = (e: KeyboardEvent): void => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeMenu();
      };
      window.addEventListener("keydown", onCaptureKeyDown, true);
      return () => window.removeEventListener("keydown", onCaptureKeyDown, true);
    }, [open, closeMenu]);

    const onKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (open && completions.length > 0) {
          switch (event.key) {
            case "ArrowDown":
              event.preventDefault();
              setActiveIndex((i) => (i + 1) % completions.length);
              return;
            case "ArrowUp":
              event.preventDefault();
              setActiveIndex((i) => (i - 1 + completions.length) % completions.length);
              return;
            case "Enter": {
              // Accept the highlighted match AND dismiss the menu. Enter
              // commits the selection (the close-normalizer strips any trailing
              // slash) — distinct from Tab, which descends to keep navigating.
              const item = completions[activeIndex];
              if (item !== undefined) {
                event.preventDefault();
                onChange(item.value);
                closeMenu();
              }
              return;
            }
            case "Tab": {
              // Complete to the highlighted match; for a directory this descends
              // (the menu stays open on its children) so the user can keep going.
              const item = completions[activeIndex];
              if (item !== undefined) {
                event.preventDefault();
                acceptItem(item);
              }
              return;
            }
            default:
              return;
          }
        }
        // Menu closed: Enter is the consumer's commit.
        if (event.key === "Enter") {
          event.preventDefault();
          onSubmit?.();
        }
      },
      [open, completions, activeIndex, acceptItem, closeMenu, onChange, onSubmit],
    );

    // Focus alone does not open the menu — only typing does (see armedRef).
    const onFocus = useCallback(() => {
      focusedRef.current = true;
    }, []);

    const onBlur = useCallback(() => {
      focusedRef.current = false;
      armedRef.current = false;
      // Items accept on mousedown (which preventDefaults blur), so a blur here
      // means focus genuinely left the field — close the menu.
      setOpen(false);
    }, []);

    // User typed in the field — arm the menu so the fetch opens it.
    const handleType = useCallback(
      (next: string) => {
        armedRef.current = true;
        onChange(next);
      },
      [onChange],
    );

    const browse = useCallback(() => {
      const hint = value.trim() !== "" ? value.trim() : base;
      void pickPath(kind, hint).then((path) => {
        if (path !== null) {
          // A deliberate pick — fill the field without popping the menu.
          armedRef.current = false;
          onChange(path);
          inputRef.current?.focus();
        }
      });
    }, [value, base, kind, onChange]);

    const prefixLen = queryPrefix(value).length;

    return (
      <div className={`tug-file-chooser${className !== undefined ? ` ${className}` : ""}`}>
        <TugInput
          ref={setInputRef}
          size={size}
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          className="tug-file-chooser-input"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          spellCheck={false}
          onChange={(event) => handleType(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {showPicker && (
          <TugPushButton
            size={size}
            emphasis="ghost"
            aria-label={kind === "file" ? "Browse for a file" : "Browse for a directory"}
            data-slot="tug-file-chooser-browse"
            disabled={disabled}
            onClick={browse}
          >
            <FolderOpen aria-hidden="true" size={14} />
          </TugPushButton>
        )}
        {open &&
          pos !== null &&
          completions.length > 0 &&
          createPortal(
            <ul
              ref={listRef}
              className="tug-completion-menu"
              data-slot="tug-file-chooser-overlay"
              role="listbox"
              style={{
                position: "fixed",
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                minWidth: `${pos.width}px`,
              }}
            >
              {completions.map((item, i) => (
                <li
                  key={item.value}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={
                    i === activeIndex
                      ? "tug-completion-menu-item tug-completion-menu-item-selected"
                      : "tug-completion-menu-item"
                  }
                  // mousedown (not click) so the input never blurs out from
                  // under the selection — keeps focus + the menu alive to descend.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    acceptItem(item);
                  }}
                  onMouseMove={() => setActiveIndex(i)}
                >
                  <MatchedLabel label={item.label} prefixLen={prefixLen} />
                </li>
              ))}
            </ul>,
            overlayRoot,
          )}
      </div>
    );
  },
);
