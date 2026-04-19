/**
 * TugCardBanner — Card-scoped modal banner for card-level error / attention states.
 *
 * Combines TugBanner's visual language (strip at top + detail panel) with
 * TugSheet's scoping mechanics (portal into the card, `inert` on .tugcard-body,
 * positioned below the title bar). Unlike TugBanner, TugCardBanner does not
 * block the app — only the card it's mounted in. Other cards on the deck remain
 * fully interactive.
 *
 * Two variants:
 * - "error": strip (label + message) + centered detail panel (children) with
 *   pinned footer. The card body gets a dim backdrop so the detail panel reads
 *   as a modal overlay. `role="alert"` / `aria-live="assertive"`.
 * - "status": strip only, no detail panel, no backdrop. `role="status"` /
 *   `aria-live="polite"`.
 *
 * Both variants slide the strip down from the title-bar edge on enter and
 * reverse on exit; the error variant additionally fades the detail panel.
 * `inert` is applied to `.tugcard-body` while the banner is mounted and
 * released only after the exit animation's `.finished` so interaction
 * returns in sync with the visuals.
 *
 * Lifecycle is self-managed (consumer drives `visible`). Animation uses
 * TugAnimator per L13; CSS keyframes are the wrong regime here because the
 * library doesn't own mount/unmount (L14).
 *
 * The banner itself is not a responder. Footer buttons are controls owned by
 * the consumer — dismiss is the consumer's responsibility per L11 (no
 * onDismiss callback prop). Pass a <TugPushButton> or equivalent in `footer`
 * whose onClick routes through the chain or updates local state.
 *
 * Laws: [L06] appearance via CSS/DOM,
 *       [L11] controls emit actions; responders handle them,
 *       [L13] TugAnimator for self-managed programmatic motion,
 *       [L14] no CSS keyframes for self-managed lifecycle,
 *       [L16] pairings declared,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty (composes consumer-supplied footer controls)
 */

import "./tug-card-banner.css";

import React, {
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import * as FocusScopeRadix from "@radix-ui/react-focus-scope";
import { icons } from "lucide-react";
import { cn } from "@/lib/utils";
import { TugcardPortalContext } from "./tug-card";
import { group } from "@/components/tugways/tug-animator";

/* ---------------------------------------------------------------------------
 * Props
 * ---------------------------------------------------------------------------*/

export interface TugCardBannerProps {
  /** Whether the banner is shown. @selector [data-visible="true"] | [data-visible="false"] */
  visible: boolean;
  /** Layout variant. @selector [data-variant="error"] | [data-variant="status"] @default "error" */
  variant?: "error" | "status";
  /** Visual severity. @selector [data-tone="danger"] | [data-tone="caution"] | [data-tone="default"] @default "danger" */
  tone?: "danger" | "caution" | "default";
  /** Short high-contrast strip label (e.g. "Connection lost"). Rendered bold, left of the message. */
  label?: string;
  /** Strip message text. */
  message: string;
  /** Optional Lucide icon name for the strip (most useful for status variant). */
  icon?: string;
  /**
   * Optional Lucide icon name rendered in the detail panel (error variant
   * only). Rendered large (48px) on the left of the TugAlert-style layout.
   */
  detailIcon?: string;
  /**
   * Optional bold title rendered above the detail body (error variant only).
   * Matches TugAlert's title shape.
   */
  detailTitle?: string;
  /** Detail panel body content (error variant only). */
  children?: React.ReactNode;
  /** Pinned footer content for the detail panel (error variant only). */
  footer?: React.ReactNode;
  /**
   * Disables the `inert` application on `.tugcard-body` — for gallery demos
   * that render the banner inside a preview without blocking interaction.
   * The visual strip and detail panel still render normally.
   * @default false
   */
  contained?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

/* ---------------------------------------------------------------------------
 * TugCardBanner
 * ---------------------------------------------------------------------------*/

export const TugCardBanner = React.forwardRef<HTMLDivElement, TugCardBannerProps>(
  function TugCardBanner(
    {
      visible,
      variant = "error",
      tone = "danger",
      label,
      message,
      icon,
      detailIcon,
      detailTitle,
      children,
      footer,
      contained = false,
      className,
    },
    ref,
  ) {
    const cardEl = useContext(TugcardPortalContext);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const stripRef = useRef<HTMLDivElement | null>(null);
    const detailRef = useRef<HTMLDivElement | null>(null);

    // Presence: keep the portal mounted across the exit animation. `mounted`
    // becomes true when visible first goes true; it only becomes false after
    // the exit animation's `.finished` resolves.
    const [mounted, setMounted] = useState(false);

    // Combined ref: internal rootRef + caller's forwarded ref.
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref],
    );

    // Promote to mounted on first visible=true. Exit flips mounted back to
    // false in the exit-animation effect below.
    useLayoutEffect(() => {
      if (visible) setMounted(true);
    }, [visible]);

    // Inert management keyed on `mounted`. When the banner is in the DOM the
    // card body is inert; when the exit animation finishes and mounted goes
    // back to false, inert is released in the same React commit. Cleanup on
    // unmount always clears — we never want to leak an `inert` attribute
    // after the component goes away.
    useLayoutEffect(() => {
      if (contained) return;
      if (!cardEl) return;
      const body = cardEl.querySelector(".tugcard-body");
      if (!body) return;
      if (mounted) {
        body.setAttribute("inert", "");
      } else {
        body.removeAttribute("inert");
      }
      return () => {
        body.removeAttribute("inert");
      };
    }, [mounted, cardEl, contained]);

    // Enter animation: runs when (visible && mounted). The first mount with
    // visible=true pipeline is: (render null) → effect sets mounted=true →
    // re-render with DOM present → this effect runs on the DOM.
    useLayoutEffect(() => {
      if (!visible || !mounted) return;
      const strip = stripRef.current;
      const detail = detailRef.current;
      if (!strip) return;

      const g = group({ duration: "--tug-motion-duration-moderate" });
      g.animate(
        strip,
        [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }],
        { key: "card-banner-strip", easing: "ease-out" },
      );
      if (detail) {
        g.animate(detail, [{ opacity: 0 }, { opacity: 1 }], {
          key: "card-banner-detail",
        });
      }
    }, [visible, mounted]);

    // Exit animation: runs when (!visible && mounted). Unmounts the portal
    // content only after `.finished` resolves so the exit animation plays
    // to completion.
    useLayoutEffect(() => {
      if (visible || !mounted) return;
      const strip = stripRef.current;
      const detail = detailRef.current;
      if (!strip && !detail) {
        setMounted(false);
        return;
      }

      const g = group({ duration: "--tug-motion-duration-moderate" });
      if (strip) {
        g.animate(
          strip,
          [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }],
          { key: "card-banner-strip", easing: "ease-in" },
        );
      }
      if (detail) {
        g.animate(detail, [{ opacity: 1 }, { opacity: 0 }], {
          key: "card-banner-detail",
        });
      }
      g.finished
        .then(() => setMounted(false))
        .catch(() => {
          // Animation interrupted — unmount anyway so we don't stick.
          setMounted(false);
        });
    }, [visible, mounted]);

    if (!mounted) return null;
    // Contained mode (gallery demos) renders inline inside the caller's
    // positioned parent; no portal, no .tugcard-body lookup. Real usage
    // requires a portal target from TugcardPortalContext.
    if (!contained && !cardEl) return null;

    // Shared strip markup used by both variants.
    const strip = (
      <div ref={stripRef} className="tug-card-banner-strip">
        {icon && (
          <span className="tug-card-banner-icon" aria-hidden="true">
            <BannerIcon name={icon} />
          </span>
        )}
        {label && <span className="tug-card-banner-label">{label}</span>}
        <span className="tug-card-banner-message">{message}</span>
      </div>
    );

    const statusContent = (
      <div
        ref={setRef}
        data-slot="tug-card-banner"
        data-variant="status"
        data-visible={String(visible)}
        data-tone={tone}
        data-contained={contained ? "true" : undefined}
        role="status"
        aria-live="polite"
        className={cn("tug-card-banner", className)}
      >
        <div className="tug-card-banner-clip">{strip}</div>
      </div>
    );

    const errorContent = (
      <FocusScopeRadix.FocusScope trapped={visible} loop>
        <div
          ref={setRef}
          data-slot="tug-card-banner"
          data-variant="error"
          data-visible={String(visible)}
          data-tone={tone}
          data-contained={contained ? "true" : undefined}
          role="alert"
          aria-live="assertive"
          className={cn("tug-card-banner", className)}
        >
          <div className="tug-card-banner-clip">
            {strip}
            <div ref={detailRef} className="tug-card-banner-detail-panel">
              <div className="tug-card-banner-detail-body">
                {detailIcon && (
                  <div className="tug-card-banner-detail-icon" aria-hidden="true">
                    <DetailIcon name={detailIcon} />
                  </div>
                )}
                <div className="tug-card-banner-detail-text">
                  {detailTitle && (
                    <h2 className="tug-card-banner-detail-title">{detailTitle}</h2>
                  )}
                  {children !== undefined && (
                    <div className="tug-card-banner-detail-message">{children}</div>
                  )}
                </div>
              </div>
              {footer !== undefined && (
                <div className="tug-card-banner-detail-actions">{footer}</div>
              )}
            </div>
          </div>
        </div>
      </FocusScopeRadix.FocusScope>
    );

    const content = variant === "status" ? statusContent : errorContent;
    if (contained) return content;
    return createPortal(content, cardEl!);
  },
);

/* ---------------------------------------------------------------------------
 * Icon helpers — render a Lucide icon by kebab-case name
 * ---------------------------------------------------------------------------*/

function resolveLucideIcon(name: string): React.ComponentType<{ size?: number }> | null {
  const pascalName = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("") as keyof typeof icons;
  const IconComponent = icons[pascalName] as
    | React.ComponentType<{ size?: number }>
    | undefined;
  return IconComponent ?? null;
}

/** Strip-sized (16px) icon shown in the attention strip. */
function BannerIcon({ name }: { name: string }) {
  const IconComponent = resolveLucideIcon(name);
  if (!IconComponent) return null;
  return <IconComponent size={16} />;
}

/** Detail-panel-sized (48px) icon shown in the TugAlert-style layout. */
function DetailIcon({ name }: { name: string }) {
  const IconComponent = resolveLucideIcon(name);
  if (!IconComponent) return null;
  return <IconComponent size={48} />;
}
