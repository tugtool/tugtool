/**
 * TugBulletin — Non-blocking notification system.
 *
 * Wraps Sonner for toast lifecycle management. Fire-and-forget imperative API
 * via the bulletin() function. TugBulletinProvider mounts once in the root tree,
 * wrapping its children and providing context for useTugBulletin().
 * Sonner owns enter/exit animations — CSS handles styling only [L14].
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide
 */

import "./tug-bulletin.css";

import React, { createContext, useContext } from "react";
import { Toaster, toast } from "sonner";

/* ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------*/

type SonnerPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "bottom-center";

function mapPosition(position: TugBulletinProviderProps["position"]): SonnerPosition {
  switch (position) {
    case "top-left":     return "top-left";
    case "bottom-right": return "bottom-right";
    case "bottom-left":  return "bottom-left";
    case "top-right":
    default:             return "top-right";
  }
}

function mapOptions(options?: BulletinOptions): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (options?.description !== undefined) result.description = options.description;
  if (options?.duration !== undefined) result.duration = options.duration;
  if (options?.action !== undefined) {
    result.action = {
      label: options.action.label,
      onClick: options.action.onClick,
    };
  }
  return result;
}

/* ---------------------------------------------------------------------------
 * TugBulletinProviderProps
 * ---------------------------------------------------------------------------*/

export interface TugBulletinProviderProps {
  /** Position of the bulletin stack. @default "top-right" */
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  /** Child components that need access to useTugBulletin(). */
  children?: React.ReactNode;
}

/* ---------------------------------------------------------------------------
 * TugBulletinContext + TugBulletinProvider + useTugBulletin
 * ---------------------------------------------------------------------------*/

/** Shape of the context value provided by TugBulletinProvider. */
interface TugBulletinContextValue {
  bulletin: typeof bulletin;
}

const TugBulletinContext = createContext<TugBulletinContextValue | null>(null);

/**
 * TugBulletinProvider — mounts once in the root render tree, wrapping children.
 *
 * Wraps Sonner's <Toaster> and provides TugBulletinContext so descendant
 * components can call useTugBulletin() to get the bulletin function.
 * All visual styling is handled by tug-bulletin.css via the `tug-bulletin`
 * className applied in toastOptions.
 */
export function TugBulletinProvider({ position = "top-right", children }: TugBulletinProviderProps) {
  const contextValue = React.useMemo(() => ({ bulletin }), []);

  return React.createElement(
    TugBulletinContext.Provider,
    { value: contextValue },
    children,
    React.createElement(Toaster, {
      position: mapPosition(position),
      toastOptions: {
        className: "tug-bulletin",
        unstyled: true,
      },
      gap: 8,
    }),
  );
}

/**
 * useTugBulletin — returns the bulletin function for fire-and-forget notifications.
 *
 * Must be used inside a TugBulletinProvider.
 *
 * @example
 * ```tsx
 * const showBulletin = useTugBulletin();
 * showBulletin("Card saved successfully");
 * showBulletin.success("Export complete", { description: "3 cards exported." });
 * ```
 */
export function useTugBulletin(): typeof bulletin {
  const ctx = useContext(TugBulletinContext);
  if (!ctx) {
    throw new Error("useTugBulletin must be used within a TugBulletinProvider");
  }
  return ctx.bulletin;
}

/* ---------------------------------------------------------------------------
 * BulletinOptions
 * ---------------------------------------------------------------------------*/

export interface BulletinOptions {
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

/* ---------------------------------------------------------------------------
 * bulletin() — imperative fire-and-forget API
 * ---------------------------------------------------------------------------*/

/**
 * bulletin() — fire-and-forget non-blocking notification.
 *
 * Maps to Sonner's toast() API. Use bulletin.success(), bulletin.danger(),
 * and bulletin.caution() for tone variants.
 *
 * @example
 * ```ts
 * bulletin("Card saved successfully");
 * bulletin.success("Export complete", { description: "3 cards exported." });
 * bulletin.danger("Upload failed", { action: { label: "Retry", onClick: handleRetry } });
 * ```
 */
export function bulletin(message: string, options?: BulletinOptions): void {
  toast(message, {
    description: options?.description,
    duration: options?.duration,
    action: options?.action
      ? { label: options.action.label, onClick: options.action.onClick }
      : undefined,
  });
}

bulletin.success = (message: string, options?: BulletinOptions): void => {
  toast.success(message, { ...mapOptions(options) });
};

bulletin.danger = (message: string, options?: BulletinOptions): void => {
  toast.error(message, { ...mapOptions(options) });
};

bulletin.caution = (message: string, options?: BulletinOptions): void => {
  toast.warning(message, { ...mapOptions(options) });
};
