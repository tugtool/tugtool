/**
 * TugBanner — app-modal state barrier for system conditions.
 *
 * Two variants: "status" (compact horizontal strip, always mounted, visibility
 * driven by the `visible` prop) and "error" (full-viewport panel, conditionally
 * rendered by ErrorBoundary as its fallback UI). No user action can dismiss it —
 * the `visible` prop or React unmount controls presence.
 *
 * Status variant: scrim + `inert` on the deck canvas sibling block interaction
 * while visible. Exit animation plays, then `inert` is removed. Error variant:
 * composes TugPushButton for the reload action [L20] — button keeps its own tokens.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide,
 *       [L20] token sovereignty (error variant composes TugPushButton)
 */

import "./tug-banner.css";

import React from "react";
import { icons } from "lucide-react";
import { cn } from "@/lib/utils";

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
  /** Rich content (error variant) */
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
    const animEndListenerRef = React.useRef<(() => void) | null>(null);

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

      // Clean up any previous animationend listener
      if (animEndListenerRef.current) {
        root.removeEventListener("animationend", animEndListenerRef.current);
        animEndListenerRef.current = null;
      }

      if (visible) {
        // Apply inert immediately on show
        canvas.setAttribute("inert", "");
      } else {
        // Remove inert after the exit animation completes
        const onAnimEnd = () => {
          canvas.removeAttribute("inert");
          root.removeEventListener("animationend", onAnimEnd);
          animEndListenerRef.current = null;
        };
        animEndListenerRef.current = onAnimEnd;
        root.addEventListener("animationend", onAnimEnd, { once: true });
      }

      return () => {
        // On unmount ensure inert is always removed
        canvas.removeAttribute("inert");
        if (animEndListenerRef.current) {
          root.removeEventListener("animationend", animEndListenerRef.current);
          animEndListenerRef.current = null;
        }
      };
    }, [visible, variant, contained]);

    // Error variant: conditionally rendered — always show as visible, no scrim.
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
          <div className="tug-banner-error-header">
            <span className="tug-banner-message">{message}</span>
          </div>
          <div className="tug-banner-error-body">{children}</div>
        </div>
      );
    }

    // Status variant: always mounted, visibility controlled by data-visible.
    return (
      <>
        {/* Scrim — only rendered for status variant */}
        {!contained && (
          <div
            className="tug-banner-scrim"
            data-visible={String(visible)}
            aria-hidden="true"
          />
        )}
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
          {icon && (
            <span className="tug-banner-icon" aria-hidden="true">
              {/* Icon rendered as text — caller passes Lucide icon name as string */}
              <BannerIcon name={icon} />
            </span>
          )}
          <span className="tug-banner-message">{message}</span>
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
