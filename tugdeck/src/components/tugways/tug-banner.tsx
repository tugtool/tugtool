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
   * Pinned footer content for the error detail panel — stays fixed at
   * the bottom of the panel while `children` scrolls above it. Typically
   * the primary action (e.g. Reload). Error variant only.
   */
  footer?: React.ReactNode;
  /**
   * Disables the inert/scrim blocking behavior — use in gallery demos
   * to show the banner inside a contained preview without blocking the app.
   * @default false
   */
  contained?: boolean;
  /**
   * Floor on visibility duration in milliseconds for the status variant.
   * After the banner first slides in (`visible: true`), subsequent
   * `visible: false` requests defer the slide-out until at least this
   * many milliseconds have elapsed since the slide-in started, then the
   * existing exit animation runs.
   *
   * Once an exit is committed (deferral pending or animation in flight),
   * subsequent `visible: true` is ignored until the slide-out completes
   * and inert is released — matching the rule that an ordered-out banner
   * cannot be revived. After completion, a fresh `visible: true` starts
   * a new enter cycle.
   *
   * The gate has no effect on the `error` variant, which is rendered
   * conditionally by ErrorBoundary as terminal fallback UI and never
   * toggles. Pass `0` to opt out of the gate on the status variant.
   * @default 500
   */
  minMountedMs?: number;
  /**
   * Clock injection for tests. Defaults to `performance.now`. Production
   * code never needs to set this.
   * @internal
   */
  nowMs?: () => number;
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
      footer,
      contained = false,
      minMountedMs = 500,
      nowMs,
      className,
    },
    ref,
  ) {
    const rootRef = React.useRef<HTMLDivElement | null>(null);
    const scrimRef = React.useRef<HTMLDivElement | null>(null);
    const hasBeenVisibleRef = React.useRef(false);

    // Stable clock reference. Default is monotonic performance.now;
    // tests inject a controllable clock so dwell math is deterministic.
    const nowFnRef = React.useRef<() => number>(nowMs ?? (() => performance.now()));
    nowFnRef.current = nowMs ?? (() => performance.now());

    // ---- Min-mount-time gate state (status variant only) --------------
    // shownAtRef is recorded when the slide-in animation starts; the
    // exit branch reads it to compute remaining dwell. committedToExitRef
    // is set the first time visible: false fires while the banner is
    // visible — once true, parent visible toggles are ignored until
    // the slide-out completes. deferredExitTimerRef holds the pending
    // setTimeout handle so cleanup paths can clear it.
    const shownAtRef = React.useRef<number | null>(null);
    const committedToExitRef = React.useRef(false);
    const deferredExitTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Tracks the canvas element we currently hold an `inert` attribute
    // on, so the unmount-only cleanup below knows what to release.
    // Setting and clearing happen inline in the animation effect; the
    // ref + unmount-cleanup pattern avoids the previous design's
    // problem of re-run cleanups stripping inert mid-deferral.
    const inertOwnerRef = React.useRef<HTMLElement | null>(null);

    // Unmount-only safety net: if the component is destroyed while the
    // banner still owns an inert attribute on the canvas (e.g., torn
    // down mid-deferral or mid-exit-animation), release it so the
    // attribute doesn't leak past the component's lifetime. Empty
    // deps ensure this cleanup runs only once, on unmount.
    React.useEffect(() => {
      return () => {
        if (inertOwnerRef.current) {
          inertOwnerRef.current.removeAttribute("inert");
          inertOwnerRef.current = null;
        }
        if (deferredExitTimerRef.current !== null) {
          clearTimeout(deferredExitTimerRef.current);
          deferredExitTimerRef.current = null;
        }
      };
    }, []);

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

    // Animation + gate for status variant.
    // Animation always runs (including contained gallery demos).
    // Inert is only managed when NOT contained (real banner, not gallery).
    // Inert tracking lives on `inertOwnerRef`; the unmount-only effect
    // above releases it if the component is torn down while still
    // holding the attribute. This effect does NOT use cleanup to
    // release inert or clear the deferral timer — that pattern would
    // strip state mid-deferral when the parent re-asserts visible.
    //
    // Min-mount-time gate: if the banner has been visible for less than
    // `minMountedMs`, the slide-out is deferred until the floor is
    // reached. The deferral is binding — once committed, the exit runs
    // to completion regardless of subsequent visible toggles. Re-runs
    // while committed are no-ops.
    React.useLayoutEffect(() => {
      if (variant !== "status") return;

      // Already committed: the deferral or in-flight slide-out owns
      // the rest of this cycle. No-op until finishExit resets the gate.
      if (committedToExitRef.current) return;

      const root = rootRef.current;
      if (!root) return;

      const scrimEl = scrimRef.current;

      // Find deck canvas for inert management (null when contained — that's fine).
      let canvas: HTMLElement | null = null;
      if (!contained) {
        const parent = root.parentElement;
        if (parent) {
          canvas = parent.querySelector<HTMLElement>("[data-slot=\"deck-canvas\"]");
        }
      }

      if (visible) {
        hasBeenVisibleRef.current = true;

        // Record shownAt at the slide-in start. The null guard means
        // dependency-only re-runs (variant or contained changing under
        // a stable visible) don't reset the floor.
        if (shownAtRef.current === null) {
          shownAtRef.current = nowFnRef.current();
        }

        // Set inert immediately — banner blocks interaction as it enters.
        // Tracked via inertOwnerRef so the unmount-only effect can
        // release it if the component is destroyed before the slide-out
        // completes.
        if (canvas) {
          canvas.setAttribute("inert", "");
          inertOwnerRef.current = canvas;
        }

        animate(root, [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], {
          key: "banner-root",
          duration: "--tug-motion-duration-moderate",
          easing: "ease-out",
        });
        if (scrimEl) {
          animate(scrimEl, [{ opacity: 0 }, { opacity: 1 }], {
            key: "banner-scrim",
            duration: "--tug-motion-duration-moderate",
          });
        }
        return;
      }

      if (!hasBeenVisibleRef.current) return;

      // First visible: false edge after a visible: true cycle. Commit
      // to exit. The gate guard at the top of this effect makes
      // subsequent re-runs no-ops; the deferral is binding.
      committedToExitRef.current = true;

      const finishExit = () => {
        // Release inert AFTER the slide-out animation finishes —
        // visual and interaction stay in sync. Reset gate refs so a
        // fresh visible: true starts a clean cycle.
        if (inertOwnerRef.current) {
          inertOwnerRef.current.removeAttribute("inert");
          inertOwnerRef.current = null;
        }
        shownAtRef.current = null;
        committedToExitRef.current = false;
        deferredExitTimerRef.current = null;
      };

      const runSlideOut = () => {
        deferredExitTimerRef.current = null;
        // Only run exit animation if the banner was previously shown.
        // Skipping on initial mount prevents a flash: the exit animation starts
        // from translateY(0) which would briefly show the banner before hiding it.
        const exitAnim = animate(root, [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], {
          key: "banner-root",
          duration: "--tug-motion-duration-moderate",
          easing: "ease-in",
        });
        if (scrimEl) {
          animate(scrimEl, [{ opacity: 1 }, { opacity: 0 }], {
            key: "banner-scrim",
            duration: "--tug-motion-duration-moderate",
          });
        }
        exitAnim.finished.then(finishExit).catch(finishExit);
      };

      const shownAt = shownAtRef.current ?? nowFnRef.current();
      const remaining = Math.max(0, minMountedMs - (nowFnRef.current() - shownAt));

      if (remaining > 0) {
        deferredExitTimerRef.current = setTimeout(runSlideOut, remaining);
        return;
      }

      runSlideOut();
    }, [visible, variant, contained, minMountedMs]);

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
          data-contained={contained ? "true" : undefined}
          role="alert"
          aria-live="assertive"
          className={cn("tug-banner", className)}
        >
          {/* Strip — full-width, solid, high-urgency */}
          <div className="tug-banner-strip">
            <span className="tug-banner-message">{message}</span>
          </div>
          {/* Detail panel — centered, constrained, scrollable diagnostic
              area with an optional pinned footer that stays fixed while
              the body scrolls. */}
          <div className="tug-banner-detail-panel">
            <div className="tug-banner-detail-body">{children}</div>
            {footer !== undefined && (
              <div className="tug-banner-detail-footer">{footer}</div>
            )}
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
          <div className="tug-banner-strip">
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
 * Uses the static lucide-react `icons` map (same pattern as tug-pane.tsx).
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
