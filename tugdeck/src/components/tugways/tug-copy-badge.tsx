/**
 * TugCopyBadge — a click-to-copy `TugBadge`.
 *
 * The interactive sibling of {@link TugBadge}. A plain badge is
 * display-only (with right-click → Copy as an intrinsic affordance);
 * this wraps one in a `<button>` so a *left click* copies `value` to the
 * clipboard and the badge flashes a check in place of its trailing copy
 * glyph. Built for short identifiers a user reaches for repeatedly — a
 * commit hash, a session id, a PR number.
 *
 * It composes `TugBadge` rather than reimplementing it: the emphasis ×
 * role × size visuals, and the inner badge's own right-click → Copy, all
 * come from `TugBadge` unchanged. This component adds only the button
 * shell, the click handler, and the copy → check icon swap.
 *
 * Laws:
 *  - [L06] the "copied" flash is appearance state — it rides a
 *    `data-copied` attribute written straight onto the button DOM node,
 *    never React state; CSS swaps the glyph on the attribute.
 *  - [L11] the button is a control: a click performs the copy directly
 *    (a self-contained clipboard write, the same call `useCopyableText`
 *    makes); the inner badge keeps the right-click → Copy responder path.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tug-copy-badge"`.
 *  - [L20] no new tokens — geometry is a button reset; all color /
 *    typography is the composed `TugBadge`'s, the check tint reuses the
 *    shared success tone.
 *
 * @module components/tugways/tug-copy-badge
 */

import "./tug-copy-badge.css";

import React from "react";
import { Copy, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { TugBadge } from "./tug-badge";
import type { TugBadgeEmphasis, TugBadgeRole, TugBadgeSize } from "./tug-badge";

/** How long the check-flash stays up after a copy, in ms. */
const COPIED_FLASH_MS = 1100;

export interface TugCopyBadgeProps {
  /** The exact string written to the clipboard on click (and right-click). */
  value: string;
  /**
   * Display content. Defaults to `value` — pass `children` when the
   * shown text should differ from the copied text.
   */
  children?: React.ReactNode;
  /** Forwarded to the composed `TugBadge`. @default "tinted" */
  emphasis?: TugBadgeEmphasis;
  /** Forwarded to the composed `TugBadge`. @default "accent" */
  role?: TugBadgeRole;
  /** Forwarded to the composed `TugBadge`. @default "sm" */
  size?: TugBadgeSize;
  /**
   * Accessible-label verb prefix — the button's `aria-label` is
   * `${copyLabel} ${value}` (e.g. "Copy 450d6b28"). @default "Copy"
   */
  copyLabel?: string;
  /** Forwarded class name (lands on the inner badge). */
  className?: string;
}

/**
 * A `TugBadge` that copies `value` on click and flashes a check. See the
 * module docstring for the composition rationale.
 */
export function TugCopyBadge({
  value,
  children,
  emphasis = "tinted",
  role = "accent",
  size = "sm",
  copyLabel = "Copy",
  className,
}: TugCopyBadgeProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCopy = React.useCallback(() => {
    void navigator.clipboard?.writeText(value);
    const el = buttonRef.current;
    if (el === null) return;
    // Appearance flash via a DOM attribute, not React state ([L06]).
    el.dataset.copied = "true";
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (buttonRef.current !== null) delete buttonRef.current.dataset.copied;
      timerRef.current = null;
    }, COPIED_FLASH_MS);
  }, [value]);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      data-slot="tug-copy-badge"
      className="tug-copy-badge"
      onClick={onCopy}
      aria-label={`${copyLabel} ${value}`}
    >
      <TugBadge
        emphasis={emphasis}
        role={role}
        size={size}
        copyText={value}
        className={cn("tug-copy-badge-inner", className)}
      >
        <span className="tug-copy-badge-text">{children ?? value}</span>
        <Copy className="tug-copy-badge-icon tug-copy-badge-icon--idle" aria-hidden="true" />
        <Check className="tug-copy-badge-icon tug-copy-badge-icon--done" aria-hidden="true" />
      </TugBadge>
    </button>
  );
}
