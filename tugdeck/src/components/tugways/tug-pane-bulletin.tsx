/**
 * TugPaneBulletin — pane-scoped, non-blocking notifications.
 *
 * The per-pane analog of the deck-global {@link bulletin} (`tug-bulletin.tsx`).
 * Both are thin wrappers over **Sonner** — there is no reason to re-implement
 * the stacking, hover-to-persist, swipe/close, and smooth enter/exit/reflow
 * that Sonner already does well. The only difference is *scope*: Sonner 2.x
 * routes a toast to a specific `<Toaster>` by id (a Toaster with an `id` shows
 * only toasts whose `toasterId` matches; the deck's id-less Toaster shows only
 * id-less toasts). So each `TugPaneBulletinProvider` mounts a `<Toaster>` with
 * a unique per-pane id and raises toasts addressed to it — and one card's
 * bulletins never appear over another's.
 *
 * The Toaster renders inline (Sonner does not portal) and positions itself with
 * container-relative offsets (`bottom`/`left`); `tug-pane-bulletin.css`
 * overrides Sonner's `position: fixed` to `absolute` within the provider's
 * relative, isolated root, which is what anchors the stack to the pane rather
 * than the viewport. Appearance is CSS-only via `unstyled` toasts ([L06]),
 * mirroring the deck bulletin.
 *
 * Laws: [L06] appearance via CSS/DOM, [L14] Sonner owns enter/exit animation,
 * [L19] component authoring.
 *
 * @module components/tugways/tug-pane-bulletin
 */

import "./tug-pane-bulletin.css";

import React, { createContext, useContext, useId, useMemo } from "react";
import { Toaster, toast } from "sonner";

/* ---------------------------------------------------------------------------
 * Options + imperative API
 * ---------------------------------------------------------------------------*/

/** Options for a pane bulletin — mirrors the deck `BulletinOptions`. */
export interface PaneBulletinOptions {
  description?: string;
  /** Auto-dismiss delay in ms (Sonner default when omitted). */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /**
   * Persist until the user dismisses it (no auto-dismiss), showing a
   * bottom-right dismiss button. Use for outcomes the user should
   * acknowledge rather than glance at. Composes with any tone helper
   * (`success`/`danger`/…). Overrides `duration` / `action`.
   */
  sticky?: boolean;
  /**
   * Label for the sticky dismiss button.
   * @default "OK"
   */
  okLabel?: string;
}

function mapOptions(
  toasterId: string,
  options?: PaneBulletinOptions,
): Record<string, unknown> {
  const result: Record<string, unknown> = { toasterId };
  if (options?.description !== undefined) result.description = options.description;
  if (options?.sticky === true) {
    // Persist-until-dismissed: never auto-dismiss, and render an OK button.
    // Sonner dismisses the toast itself when its action is clicked, so the
    // handler is a no-op. The marker class right-aligns the button (CSS).
    result.duration = Infinity;
    result.className = "tug-pane-bulletin-sticky";
    result.action = { label: options.okLabel ?? "OK", onClick: () => {} };
  } else {
    if (options?.duration !== undefined) result.duration = options.duration;
    if (options?.action !== undefined) {
      result.action = {
        label: options.action.label,
        onClick: options.action.onClick,
      };
    }
  }
  return result;
}

/**
 * Fire-and-forget bulletin function returned by {@link useTugPaneBulletin},
 * with tone helpers — the pane-scoped sibling of the deck `bulletin()`.
 */
export interface TugPaneBulletinApi {
  (message: string, options?: PaneBulletinOptions): void;
  success: (message: string, options?: PaneBulletinOptions) => void;
  danger: (message: string, options?: PaneBulletinOptions) => void;
  caution: (message: string, options?: PaneBulletinOptions) => void;
}

/** The per-pane Sonner toaster id, provided by {@link TugPaneBulletinProvider}. */
const PaneToasterIdContext = createContext<string | null>(null);

/* ---------------------------------------------------------------------------
 * Provider
 * ---------------------------------------------------------------------------*/

export interface TugPaneBulletinProviderProps {
  /** Where the stack anchors within the pane. @default "bottom" */
  placement?: "top" | "bottom";
  /** Merged onto the relative root (e.g. `flex: 1` sizing from a host card). */
  className?: string;
  /** Merged onto the relative root. */
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * Mounts a pane-scoped Sonner toaster around its children. The root is
 * `position: relative; isolation: isolate` so the toaster anchors to — and
 * stacks within — *this* pane. Pass `className` / `style` to size it (a card
 * body typically makes it fill the card).
 */
export function TugPaneBulletinProvider({
  placement = "bottom",
  className,
  style,
  children,
}: TugPaneBulletinProviderProps): React.ReactElement {
  // Stable, unique per provider instance — the Sonner toaster id that scopes
  // this pane's bulletins.
  const toasterId = useId();

  const rootClassName = className
    ? `tug-pane-bulletin-root ${className}`
    : "tug-pane-bulletin-root";

  return (
    <PaneToasterIdContext.Provider value={toasterId}>
      <div className={rootClassName} style={style}>
        {children}
        <Toaster
          id={toasterId}
          position={placement === "top" ? "top-center" : "bottom-center"}
          toastOptions={{ className: "tug-pane-bulletin", unstyled: true }}
          gap={8}
        />
      </div>
    </PaneToasterIdContext.Provider>
  );
}

/**
 * Returns the imperative bulletin function for the nearest
 * `TugPaneBulletinProvider`. Throws outside one.
 *
 * @example
 * ```tsx
 * const paneBulletin = useTugPaneBulletin();
 * paneBulletin("Most recent message copied");
 * paneBulletin.danger("Copy failed");
 * ```
 */
export function useTugPaneBulletin(): TugPaneBulletinApi {
  const toasterId = useContext(PaneToasterIdContext);
  if (toasterId === null) {
    throw new Error(
      "useTugPaneBulletin must be used within a TugPaneBulletinProvider",
    );
  }
  return useMemo(() => {
    const fn = ((message: string, options?: PaneBulletinOptions) => {
      toast(message, mapOptions(toasterId, options));
    }) as TugPaneBulletinApi;
    fn.success = (message, options) =>
      void toast.success(message, mapOptions(toasterId, options));
    fn.danger = (message, options) =>
      void toast.error(message, mapOptions(toasterId, options));
    fn.caution = (message, options) =>
      void toast.warning(message, mapOptions(toasterId, options));
    return fn;
  }, [toasterId]);
}
