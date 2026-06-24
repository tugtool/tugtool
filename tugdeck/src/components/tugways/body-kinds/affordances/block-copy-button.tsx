/**
 * `BlockCopyButton` — reusable Copy affordance for body kinds.
 *
 * Standardizes the action-row Copy button across `FileBlock`,
 * `TerminalBlock`, `DiffBlock`, and any future body kinds that
 * surface a "copy this block's content" gesture. Encapsulates:
 *
 *  - Controlled-confirmation state (`copied` + `setTimeout` flash).
 *    Mirrors the honest-feedback contract: `isConfirming`
 *    flips to `true` ONLY inside the clipboard `.then()` callback
 *    after a successful write. A denied permission or missing
 *    clipboard API leaves the flag at `false` — the button never
 *    lies about success ([L23]).
 *  - Position-stable click (`usePositionStableClick`). Copy itself
 *    doesn't change document height, but the wrapper keeps the
 *    action-row contract that *every* affordance click routes
 *    through the hook, so a future side effect that does affect
 *    layout (e.g., a snackbar reveal) won't bypass it.
 *  - Width stabilization. Both the rest ("Copy") and confirm
 *    ("Copied") labels share the same grid cell so the button's
 *    intrinsic width is invariant across the swap — no
 *    sibling-jostling on click.
 *  - Lucide `Copy` / `Check` icon swap via `TugPushButton`'s
 *    `confirmation` prop. Subtype `"icon-text"`, emphasis
 *    `"ghost"` (overridable to `"outlined"`), size `"2xs"` — the
 *    established action-row affordance scale.
 *
 * The variable parts the consumer provides are minimal:
 *
 *  - `getText` — a function returning the text to copy at click
 *    time. Consumers typically pass a closure over a latest-ref
 *    (e.g., `() => fileTextRef.current` or `() => copyText`
 *    where `copyText` is a `useMemo` value) so the click captures
 *    the freshest content without re-creating the affordance.
 *  - `copyAction` — an optional async copy path that supersedes the
 *    `getText` → `writeText` default, for non-text payloads (e.g. an
 *    image blob written via `ClipboardItem`). It resolves `true` on a
 *    confirmed write to trigger the same flash; `false`/reject stays
 *    silent.
 *  - `disabled` — block-specific predicate. FileBlock disables
 *    when collapsed (body not mounted); TerminalBlock disables
 *    when there's no stdout/stderr; DiffBlock disables when
 *    `composeDiffCopyText` returns empty.
 *  - `aria-label` — the per-block phrasing ("Copy file contents",
 *    "Copy terminal output", "Copy diff"). The lib doesn't pick
 *    for the consumer; each block kind owns its own language.
 *
 * Laws: [L06] confirmation flash via the controlled `isConfirming`
 *       prop (the appearance toggle happens via `TugButton`'s own
 *       internal DOM mutation, not via React state-as-appearance
 *       in the consumer); [L07] click handler reads `getText`
 *       through a latest-ref so stable callbacks see the current
 *       closure; [L23] honest feedback — no flash on failure.
 *
 * @module components/tugways/body-kinds/affordances/block-copy-button
 */

import React from "react";
import { Copy as copyIconNode, Check as checkIconNode } from "lucide";

import {
  TugSpriteIcon,
  type LucideIconNode,
} from "@/components/tugways/tug-sprite-icon";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import type { TugButtonEmphasis } from "@/components/tugways/tug-push-button";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { usePositionStableClick } from "@/components/tugways/internal/use-position-stable-click";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Duration the Copy button's "Copied" confirmation flash is visible
 * (ms). Long enough to register as a positive signal, short enough
 * that the button is back at rest before the user moves on. Shared
 * across every body kind that surfaces Copy so the timing is
 * uniform.
 */
export const COPIED_FLASH_MS = 1200;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * The action-row affordance scale this button supports. `"2xs"` is
 * the established default for in-header copy affordances (FileBlock,
 * TerminalBlock, DiffBlock — buttons that sit alongside a path
 * label in a sticky strip and need to read as chips). `"xs"` is one
 * step up — for callsites whose surrounding text scale is larger
 * than the chip default, where `"2xs"`'s 10 px font reads visibly
 * smaller than its neighbours (the Z1B end-state row, whose
 * surrounding `TugLabel size="xs"` and `TugBadge size="md"` both
 * use 12 px).
 *
 * Constrained to the two-step set so the affordance can't be
 * accidentally promoted to a primary-CTA size (`sm` / `md` / `lg`)
 * — Copy is always a secondary action in an action row.
 */
export type BlockCopyButtonSize = "2xs" | "xs" | "sm" | "md";

export interface BlockCopyButtonProps {
  /**
   * Function returning the text to copy at click time. Consumers
   * typically pass a closure over a latest-ref or memoized value so
   * the click captures the freshest content. An empty-string return
   * is a no-op (the click handler returns early); set `disabled`
   * to also make the empty state visible to the user.
   *
   * Optional when {@link copyAction} is supplied — a non-text copy
   * (e.g. an image blob) drives the clipboard itself and has no text
   * to write.
   */
  getText?: () => string;
  /**
   * Custom async copy path that supersedes the default `getText` →
   * `writeText` write. Use it for non-text clipboard payloads — e.g.
   * writing an image blob via `ClipboardItem`. Resolve `true` on a
   * confirmed write (triggers the "Copied" flash), `false` (or a
   * rejection) on failure (no flash — the honest-feedback contract,
   * [L23]). When set, `getText` is ignored.
   */
  copyAction?: () => Promise<boolean>;
  /**
   * Disable the button. Block-specific reasons vary: collapsed
   * body, no copyable content, async source still loading. The
   * affordance doesn't try to guess — the parent passes the
   * predicate.
   */
  disabled?: boolean;
  /**
   * Accessible label. Per-block phrasing ("Copy file contents",
   * "Copy terminal output", "Copy diff") — the affordance doesn't
   * choose for the consumer.
   */
  "aria-label": string;
  /**
   * Optional `data-slot` for per-block test selectors and CSS
   * scoping. Falls back to `"block-copy"` when omitted, but most
   * consumers pass a block-specific slot (e.g., `"diff-copy"`,
   * `"file-copy"`) to keep their existing test queries working.
   */
  "data-slot"?: string;
  /**
   * Optional className for cascade-scoped customization. Forwarded
   * onto the underlying `TugPushButton`.
   */
  className?: string;
  /**
   * Affordance-scale override; see {@link BlockCopyButtonSize}.
   * Defaults to `"2xs"` so existing block-header callers are
   * unchanged; pass `"xs"` from a callsite whose surrounding type
   * is at the 12 px tier (Z1B end-state row) so the Copy chip
   * reads at the same scale as its neighbours.
   */
  size?: BlockCopyButtonSize;
  /**
   * Button shape. `"icon-text"` (default) is the action-row chip with a
   * "Copy"/"Copied" label beside the glyph. `"icon"` is glyph-only — for
   * compact affordance rows like the collapsed tool header's Copy, where
   * a label would crowd the line; its width stabilization is dropped since
   * there is no label to jostle. `"text"` is label-only (no glyph) — for a
   * button row where the Copy chip families with plain text buttons (the
   * image preview's header, alongside Delete / Done); the confirmation
   * swaps "Copy" → "Copied" and the width stabilizes across the swap.
   */
  subtype?: "icon-text" | "icon" | "text";
  /**
   * Visual weight — forwarded to the underlying `TugPushButton`.
   * Defaults to `"ghost"`, the action-row affordance default that sits
   * borderless alongside a path label. Pass `"outlined"` for callsites
   * where the Copy chip stands alone in a header bar and needs a bordered
   * edge that aligns with the surrounding margins (e.g. the image preview's
   * Copy button).
   */
  emphasis?: Extract<TugButtonEmphasis, "ghost" | "outlined">;
  /**
   * Focus group to author the button into (forwarded to the underlying
   * `TugPushButton`). Supply it where the Copy chip lives on a
   * keyboard-navigated surface — a dialog / sheet button row — so it
   * joins the `Tab` walk and the spatial plane rather than reading as a
   * skipped native stop. Omitted on plain block headers, which are
   * native-only affordances.
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. Defaults to 0. */
  focusOrder?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockCopyButton({
  getText,
  copyAction,
  disabled,
  "aria-label": ariaLabel,
  "data-slot": dataSlot = "block-copy",
  className,
  size = "2xs",
  subtype = "icon-text",
  emphasis = "ghost",
  focusGroup,
  focusOrder,
}: BlockCopyButtonProps): React.ReactElement {
  const [copied, setCopied] = React.useState<boolean>(false);
  const copiedTimerRef = React.useRef<number | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  // Latest-refs for `getText` / `copyAction` so the stable click
  // handler reads the current closure at fire time ([L07]). Consumers
  // that pass a fresh function on every render shouldn't have a stale
  // closure captured in a `useCallback([])` handler.
  const getTextRef = React.useRef(getText);
  const copyActionRef = React.useRef(copyAction);
  React.useLayoutEffect(() => {
    getTextRef.current = getText;
    copyActionRef.current = copyAction;
  }, [getText, copyAction]);

  // Position-stable click — the action-row contract carries through
  // every affordance, even ones (like Copy) whose mutator doesn't
  // currently affect layout. Self-contained: the affordance reads
  // the scrollport from context and assembles its own wrapping.
  const scrollport = useOuterScrollport();
  const scrollportRef = React.useRef<HTMLElement | null>(null);
  scrollportRef.current = scrollport;
  const { stableClick } = usePositionStableClick({
    targetRef: buttonRef,
    scrollportRef,
  });

  // Fire the "Copied" confirmation flash — only ever called after a
  // confirmed clipboard write, so the button never lies about success
  // ([L23]).
  const flashCopied = React.useCallback((): void => {
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, COPIED_FLASH_MS);
  }, []);

  const handleCopy = React.useCallback((): void => {
    // Custom copy path (e.g. an image blob) supersedes the text write.
    const action = copyActionRef.current;
    if (action !== undefined) {
      action()
        .then((ok) => {
          if (ok) flashCopied();
        })
        .catch(() => {
          // Silent failure — no false-positive flash.
        });
      return;
    }
    const writeText = navigator.clipboard?.writeText.bind(navigator.clipboard);
    if (writeText === undefined) return;
    const text = getTextRef.current?.() ?? "";
    if (text.length === 0) return;
    writeText(text)
      .then(() => flashCopied())
      .catch(() => {
        // Silent failure — no false-positive flash. The user can
        // re-click to retry.
      });
  }, [flashCopied]);

  // Clean up the pending timer on unmount so we never call setState
  // on a detached component.
  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  return (
    <TugPushButton
      ref={buttonRef}
      className={className}
      data-slot={dataSlot}
      icon={<TugSpriteIcon name="copy" node={copyIconNode as LucideIconNode} />}
      subtype={subtype}
      emphasis={emphasis}
      size={size}
      disabled={disabled}
      aria-label={ariaLabel}
      focusGroup={focusGroup}
      focusOrder={focusOrder}
      onClick={() => stableClick(handleCopy)}
      confirmation={{
        icon: <TugSpriteIcon name="check" node={checkIconNode as LucideIconNode} />,
        label: "Copied",
      }}
      isConfirming={copied}
      // Both rest ("Copy") and confirm ("Copied") labels share the same
      // grid cell so the button's intrinsic width is invariant across the
      // swap — no sibling-jostling on click. Only meaningful for the
      // labeled `icon-text` shape; the glyph-only `icon` shape has no
      // label to stabilize.
      widthStabilize={subtype === "icon" ? undefined : { alternateLabel: "Copied" }}
    >
      Copy
    </TugPushButton>
  );
}
