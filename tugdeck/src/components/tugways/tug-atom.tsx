/**
 * TugAtom — inline token for resolved references in text input surfaces.
 *
 * Compact rectangular token (file, command, doc, image, link, etc.) that
 * sits inline with text. Two rendering paths produce identical DOM:
 *
 * 1. **React path**: `<TugAtom type="file" label="main.ts" value="/src/main.ts" />`
 * 2. **DOM path**: `createAtomDOM(seg)` — imperative builder for TugTextEngine reconciler
 *
 * The DOM path omits the dismiss affordance — the engine handles deletion
 * via two-step backspace and click-select. The React path shows an icon
 * that flips to X on hover for mouse-driven dismissal.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *        [L19] component authoring guide
 */

import "./tug-atom.css";

import React from "react";
import {
  FileText,
  Terminal,
  BookOpen,
  Image,
  Link,
  X,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Types ----

/** Segment type used by TugTextEngine and shared with tug-atom. */
export interface AtomSegment {
  kind: "atom";
  type: string;
  label: string;
  value: string;
}

/** Known atom types with dedicated icons. Open-ended — unknown types get a default icon. */
export type KnownAtomType = "file" | "command" | "doc" | "image" | "link";

/**
 * TugAtom props interface.
 */
export interface TugAtomProps extends Omit<React.ComponentPropsWithoutRef<"span">, "children"> {
  /**
   * Atom type — determines icon. Known types get specific icons; unknown types
   * get a default indicator.
   * @selector [data-atom-type="{type}"]
   */
  type: string;
  /**
   * Display label — the visible text. Caller decides truncation/format.
   */
  label: string;
  /**
   * Full canonical value — absolute path, full URL, etc. Shown in tooltip.
   */
  value: string;
  /**
   * Whether the atom is selected (engine two-step delete / click-select).
   * @selector .tug-atom-selected
   * @default false
   */
  selected?: boolean;
  /**
   * Whether the atom is highlighted (search match, typeahead preview).
   * @selector .tug-atom-highlighted
   * @default false
   */
  highlighted?: boolean;
  /**
   * Whether the atom is disabled (references something unavailable).
   * @selector .tug-atom-disabled
   * @default false
   */
  disabled?: boolean;
  /**
   * Dismiss callback. When provided, the icon flips to X on hover for
   * mouse-driven dismissal.
   */
  onDismiss?: () => void;
}

// ---- Icon map ----

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  file: FileText,
  command: Terminal,
  doc: BookOpen,
  image: Image,
  link: Link,
};

const DEFAULT_ICON = CircleDot;

/** DOM-path icon SVGs — raw SVG strings matching Lucide output for known types. */
const DOM_ICON_SVGS: Record<string, string> = {
  file: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  command: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>',
  doc: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>',
  image: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
  link: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
};

const DOM_DEFAULT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>';

// ---- React component ----

export const TugAtom = React.forwardRef<HTMLSpanElement, TugAtomProps>(
  function TugAtom({
    type,
    label,
    value,
    selected = false,
    highlighted = false,
    disabled = false,
    onDismiss,
    className,
    ...rest
  }: TugAtomProps, ref) {
    const IconComponent = ICON_MAP[type] ?? DEFAULT_ICON;

    return (
      <span
        ref={ref}
        data-slot="tug-atom"
        data-atom-type={type}
        data-atom-label={label}
        contentEditable={false}
        role="img"
        aria-label={`${type}: ${label}`}
        title={value}
        className={cn(
          "tug-atom",
          selected && "tug-atom-selected",
          highlighted && "tug-atom-highlighted",
          disabled && "tug-atom-disabled",
          onDismiss && "tug-atom-dismissible",
          className,
        )}
        {...rest}
      >
        <span className="tug-atom-icon tug-atom-type-icon">
          <IconComponent />
        </span>
        {onDismiss && (
          <span
            className="tug-atom-icon tug-atom-dismiss-icon"
            role="button"
            aria-label="Remove"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
          >
            <X />
          </span>
        )}
        <span className="tug-atom-label">{label}</span>
      </span>
    );
  }
);

// ---- DOM path (for TugTextEngine reconciler) ----

/**
 * Build a tug-atom DOM element imperatively. Produces the same DOM structure,
 * classes, data attributes, and accessibility as the React component.
 *
 * No dismiss button — the engine handles deletion via two-step backspace.
 * No event handlers — the engine attaches its own click handler.
 */
/**
 * Create the visual badge element for an atom.
 * This is a contentEditable="false" inline-block element that renders
 * the atom's icon and label. It takes up space in the flow but is
 * completely invisible to the browser's caret navigation.
 *
 * The atom character (U+FFFC) lives in the adjacent text node, NOT
 * inside this element. This separation is what makes navigation work:
 * the caret traverses the text node (including U+FFFC as one character)
 * and skips the badge element entirely.
 */
export function createAtomBadgeDOM(seg: AtomSegment): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "tug-atom";
  el.contentEditable = "false";
  el.dataset.slot = "tug-atom";
  el.dataset.atomType = seg.type;
  el.dataset.atomLabel = seg.label;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${seg.type}: ${seg.label}`);
  el.title = seg.value;

  // NO text children — the label renders via CSS ::after (content: attr(data-atom-label)).
  // Text children inside a ce=false span create extra caret stops during
  // keyboard navigation, causing asymmetric left/right arrow behavior.
  // The icon renders via CSS ::before with a background-image SVG data URI.
  const iconSvg = DOM_ICON_SVGS[seg.type] ?? DOM_DEFAULT_ICON_SVG;
  const encodedSvg = encodeURIComponent(iconSvg);
  el.style.setProperty("--tug-atom-icon-url", `url("data:image/svg+xml,${encodedSvg}")`);

  return el;
}

/** @deprecated Use createAtomBadgeDOM — kept for backward compatibility during migration. */
export const createAtomDOM = createAtomBadgeDOM;

// ---- Label formatting utility ----

export type AtomLabelMode = "filename" | "relative" | "absolute";

/**
 * Format an atom value for display as a label.
 *
 * - `"filename"`: last path component (e.g., "main.ts")
 * - `"relative"`: project-relative path (e.g., "src/main.ts")
 * - `"absolute"`: full path as-is
 *
 * For non-path values (URLs, commands), returns the value unchanged.
 */
export function formatAtomLabel(value: string, mode: AtomLabelMode): string {
  if (mode === "absolute") return value;

  // URLs — return as-is for filename mode, or strip protocol for relative
  if (value.startsWith("http://") || value.startsWith("https://")) {
    if (mode === "filename") {
      const url = value.split("?")[0].split("#")[0];
      const lastSlash = url.lastIndexOf("/");
      const filename = lastSlash >= 0 ? url.slice(lastSlash + 1) : url;
      return filename || value;
    }
    return value;
  }

  // Commands — return as-is
  if (value.startsWith("/")) {
    if (mode === "filename") {
      const lastSlash = value.lastIndexOf("/");
      return lastSlash >= 0 && lastSlash < value.length - 1
        ? value.slice(lastSlash + 1)
        : value;
    }
  }

  // File paths
  if (mode === "filename") {
    const lastSlash = value.lastIndexOf("/");
    return lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
  }

  // "relative" — strip leading slash if present
  return value.startsWith("/") ? value.slice(1) : value;
}
