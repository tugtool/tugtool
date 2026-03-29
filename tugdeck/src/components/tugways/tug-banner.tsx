/**
 * TugBanner — app-modal state barrier for system conditions.
 *
 * Two variants: "status" (compact horizontal strip, always mounted, visibility
 * driven by the `visible` prop) and "error" (strip at top + centered detail panel,
 * conditionally rendered by ErrorBoundary as its fallback UI). No user action can
 * dismiss it — the `visible` prop or React unmount controls presence.
 *
 * Status variant: scrim + `inert` on the deck canvas sibling block interaction
 * while visible. Exit animation plays, then `inert` is removed. Error variant:
 * composes TugPushButton for the reload action [L20] — button keeps its own tokens.
 *
 * Both variants share a .tug-banner-strip element that renders as a bold, full-width,
 * solid-color attention strip. The error variant adds a .tug-banner-detail-panel
 * below the strip for the stack trace and reload action.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide,
 *       [L20] token sovereignty (error variant composes TugPushButton)
 */

import "./tug-banner.css";

import React from "react";
import { icons } from "lucide-react";
import { cn } from "@/lib/utils";
import { animate } from "@/components/tugways/tug-animator";

/* ---------------------------------------------------------------------------
 * TugBanner
 * ---------------------------------------------------------------------------*/

export interface TugBannerProps {
  /** Whether the banner is shown. @selector [data-visible="true"] | [data-visible="false"] */
  visible: boolean;
  /** Banner layout variant. @selector [data-variant="status"] | [data-variant="error"] @default "status" */
  variant?: "status" | "error";
  /** Visual severity. @selector [data-tone="danger"] | [data-tone="caution"] | [data-tone="default"] @default "danger" */
  tone?: "danger" | "caution" | "default";
  /** Banner heading/message text */
  message: string;
  /** Optional Lucide icon name (status variant) */
  icon?: string;
  /** Rich content for the error detail panel (error variant only) */
  children?: React.ReactNode;
  /**
   * Disables the inert/scrim blocking behavior — use in gallery demos
   * to show the banner inside a contained preview without blocking the app.
   * @default false
   */
  contained?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugBanner = React.forwardRef<HTMLDivElement, TugBannerProps>(
  function TugBanner(
    {
      visible,
      variant = "status",
      tone = "danger",
      message,
      icon,
      children,
      contained = false,
      className,
    },
    ref,
  ) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const stripRef = React.useRef<HTMLDivElement | null>(null);
    const scrimRef = React.useRef<HTMLDivElement | null>(null);

    // Combine forwarded ref with our internal ref
    const setRef = React.useCallback(
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

    // Status variant only: manage inert on deck canvas sibling when visible changes.
    // TugAnimator's .finished promise replaces the fragile animationend listener dance.
    React.useLayoutEffect(() => {
      if (contained || variant !== "status") return;

      const root = rootRef.current;
      if (!root) return;

      // Find the deck canvas sibling: first sibling with data-slot="deck-canvas"
      // or fall back to the next sibling element.
      const parent = root.parentElement;
      if (!parent) return;

      const canvas = parent.querySelector<HTMLElement>("[data-slot=\"deck-canvas\"]");
      if (!canvas) return;

      const stripEl = stripRef.current;
      const scrimEl = scrimRef.current;

      if (visible) {
        // Apply inert immediately on show — banner blocks interaction as it enters.
        canvas.setAttribute("inert", "");
        // Animate strip in.
        if (stripEl) {
          animate(stripEl, [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], {
            key: "banner-strip",
            duration: "--tug-motion-duration-moderate",
            easing: "ease-out",
          });
        }
        // Animate scrim in.
        if (scrimEl) {
          animate(scrimEl, [{ opacity: 0 }, { opacity: 1 }], {
            key: "banner-scrim",
            duration: "--tug-motion-duration-moderate",
          });
        }
      } else {
        // Animate strip out.
        if (stripEl) {
          animate(stripEl, [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], {
            key: "banner-strip",
            duration: "--tug-motion-duration-moderate",
            easing: "ease-in",
          });
        }
        // Animate scrim out; remove inert after scrim animation completes.
        if (scrimEl) {
          const scrimAnim = animate(scrimEl, [{ opacity: 1 }, { opacity: 0 }], {
            key: "banner-scrim",
            duration: "--tug-motion-duration-moderate",
          });
          scrimAnim.finished.then(() => {
            canvas.removeAttribute("inert");
          }).catch(() => {
            // Animation interrupted (e.g. rapid toggle) — ensure inert is removed.
            canvas.removeAttribute("inert");
          });
        } else {
          canvas.removeAttribute("inert");
        }
      }

      return () => {
        // On unmount ensure inert is always removed.
        canvas.removeAttribute("inert");
      };
    }, [visible, variant, contained]);

    // Error variant: strip at top + detail panel centered below.
    // Conditionally rendered — always shown as visible, no exit animation.
    if (variant === "error") {
      return (
        <div
          ref={setRef}
          data-slot="tug-banner"
          data-variant="error"
          data-visible="true"
          data-tone={tone}
          role="alert"
          aria-live="assertive"
          className={cn("tug-banner", className)}
        >
          {/* Strip — full-width, solid, high-urgency */}
          <div className="tug-banner-strip">
            <span className="tug-banner-message">{message}</span>
          </div>
          {/* Detail panel — centered, constrained, scrollable diagnostic area */}
          <div className="tug-banner-detail-panel">
            <div className="tug-banner-detail-body">{children}</div>
          </div>
        </div>
      );
    }

    // Status variant: always mounted, visibility controlled by data-visible.
    return (
      <>
        {/* Scrim — always rendered for status variant (contained only skips inert, not scrim) */}
        <div
          ref={scrimRef}
          className="tug-banner-scrim"
          data-visible={String(visible)}
          data-contained={contained ? "true" : undefined}
          aria-hidden="true"
        />
        <div
          ref={setRef}
          data-slot="tug-banner"
          data-variant="status"
          data-visible={String(visible)}
          data-tone={tone}
          role="status"
          aria-live="polite"
          className={cn("tug-banner", className)}
        >
          {/* Strip — full-width, solid, bold attention strip */}
          <div ref={stripRef} className="tug-banner-strip">
            {icon && (
              <span className="tug-banner-icon" aria-hidden="true">
                {/* Icon rendered as text — caller passes Lucide icon name as string */}
                <BannerIcon name={icon} />
              </span>
            )}
            <span className="tug-banner-message">{message}</span>
          </div>
        </div>
      </>
    );
  },
);

/* ---------------------------------------------------------------------------
 * BannerIcon — internal helper, renders a Lucide icon by name
 * ---------------------------------------------------------------------------*/

/**
 * Internal helper that renders a Lucide icon by name string.
 * Only status variant uses this. App code passes e.g. icon="wifi-off".
 * Uses the static lucide-react `icons` map (same pattern as tug-card.tsx).
 */
function BannerIcon({ name }: { name: string }) {
  // Convert kebab-case to PascalCase for Lucide icons map lookup
  const pascalName = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("") as keyof typeof icons;

  const IconComponent = icons[pascalName];
  if (!IconComponent) return null;
  return <IconComponent size={16} />;
}
