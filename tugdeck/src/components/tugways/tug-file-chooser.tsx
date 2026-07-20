/**
 * TugFileChooser — a path field with filesystem completion + a native picker.
 *
 * The path-specific preset of {@link TugComboBox}: it wires the generic combo
 * box's async source to tugcast's `/api/fs/complete` (so typing completes
 * filesystem paths), slots a square "Browse…" button that opens the macOS
 * `NSOpenPanel` as the trailing escape accessory, descends into directories,
 * and strips a directory's transient trailing slash on close. Behavior mirrors
 * the prompt-entry `@`-mention menu:
 *   - typing fetches completions (debounced) from `/api/fs/complete`;
 *   - ↑/↓ move the highlight, the mouse follows it;
 *   - Enter accepts the highlighted match; Tab accepts, and a directory then
 *     descends (the list stays open on its children);
 *   - Escape closes the list; Enter with the list closed calls `onSubmit`.
 *
 * `kind` selects what's offered + what the picker returns: `directory` (default)
 * lists only directories; `file` lists files too (directories still appear so
 * the user can descend toward a file).
 *
 * A caller may pass `seed` + `menuMode` to make the field a full combo box over
 * a caller-owned item set (the session picker seeds it with recent projects) —
 * those items merge *above* the filesystem completions. Without them the field
 * is a plain completing path input, unchanged from before.
 *
 * Compositional component — composes {@link TugComboBox} + `TugPushButton`; its
 * mono overlay borrows `tug-completion-menu.css`. Laws: [L02] (n/a — local UI
 * state), [L06] appearance via CSS, [L20] composed children keep their own tokens.
 *
 * @module components/tugways/tug-file-chooser
 */

import "./tug-file-chooser.css";

import React, { useCallback } from "react";
import { FolderOpen } from "lucide-react";

import { TugComboBox, type TugComboBoxItem } from "./tug-combo-box";
import { TugPushButton } from "./tug-push-button";
import {
  fetchPathCompletions,
  type CompletionKind,
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
  /** Fired on Enter when the completion list is closed — the consumer's commit. */
  onSubmit?: () => void;
  /** Fired when the completion list opens / closes (e.g. to hide a sibling list). */
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
   * A caller-owned seed source (e.g. recent project paths), rendered by the
   * caller and merged ABOVE the filesystem completions, de-duped by value.
   * Pair with {@link menuMode} to open it as a dropdown. Absent ⇒ the field is
   * a plain completing path input.
   */
  seed?: (query: string) => TugComboBoxItem[];
  /** Enable dropdown-menu affordances (click / chevron / ArrowDown open the seed). */
  menuMode?: boolean;
  /**
   * Author the field into a focus group ([P02]) — the standard `useFocusable`
   * opt-in. When set, the input registers as one stop in the surrounding
   * surface's Tab walk. The field owns Tab only while its completion list is
   * open (Tab then accepts the highlighted match); closed, Tab leaves the field.
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. Defaults to 0. */
  focusOrder?: number;
  /**
   * Author the native "Browse…" button into {@link focusGroup} as its own focus
   * stop ([P02]), at this order. Omitted ⇒ the button stays outside the walk.
   * Only honored when {@link focusGroup} is also set.
   */
  browseFocusOrder?: number;
}

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
    return <>{label}</>;
  }
  return (
    <>
      <span className="tug-completion-match">{label.slice(0, prefixLen)}</span>
      {label.slice(prefixLen)}
    </>
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
      seed,
      menuMode,
      focusGroup,
      focusOrder = 0,
      browseFocusOrder,
    },
    forwardedRef,
  ) {
    const showPicker = showBrowse && isPathPickerAvailable();

    // Async source: filesystem completions, mapped to combo-box items with the
    // matched prefix bolded. Directories are descendable; files commit + close.
    const asyncItems = useCallback(
      async (query: string): Promise<TugComboBoxItem[]> => {
        const prefixLen = queryPrefix(query).length;
        const matches = await fetchPathCompletions(base, query, kind);
        return matches.map((m) => ({
          value: m.value,
          label: <MatchedLabel label={m.label} prefixLen={prefixLen} />,
          descendable: m.isDir,
        }));
      },
      [base, kind],
    );

    // A trailing slash is a transient navigation aid (it lets you descend into a
    // directory); once the list is dismissed the value should be canonical so
    // `/x/` and `/x` are treated as the same. Root "/" is preserved.
    const normalizeOnClose = useCallback((v: string): string => {
      if (v.length > 1 && v.endsWith("/")) return v.replace(/\/+$/, "") || "/";
      return v;
    }, []);

    const browse = useCallback(() => {
      const hint = value.trim() !== "" ? value.trim() : base;
      void pickPath(kind, hint).then((path) => {
        if (path !== null) onChange(path);
      });
    }, [value, base, kind, onChange]);

    const accessory = showPicker ? (
      <TugPushButton
        size={size}
        emphasis="ghost"
        aria-label={kind === "file" ? "Browse for a file" : "Browse for a directory"}
        data-slot="tug-file-chooser-browse"
        disabled={disabled}
        onClick={browse}
        // A leaf focus stop when the host authors a browse order ([P02]); the
        // engine lands the key view on the button and Return / Space fires the
        // native picker through the button's own click path.
        focusGroup={browseFocusOrder !== undefined ? focusGroup : undefined}
        focusOrder={browseFocusOrder}
      >
        <FolderOpen aria-hidden="true" size={14} />
      </TugPushButton>
    ) : undefined;

    return (
      <TugComboBox
        ref={forwardedRef}
        value={value}
        onChange={onChange}
        seed={seed}
        asyncItems={asyncItems}
        menuMode={menuMode}
        accessory={accessory}
        normalizeOnClose={normalizeOnClose}
        onSubmit={onSubmit}
        onOpenChange={onOpenChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        size={size}
        autoFocus={autoFocus}
        disabled={disabled}
        className={`tug-file-chooser${className !== undefined ? ` ${className}` : ""}`}
        inputClassName="tug-file-chooser-input"
        overlaySlot="tug-file-chooser-overlay"
        focusGroup={focusGroup}
        focusOrder={focusOrder}
      />
    );
  },
);
