/**
 * DevNotificationContext — React context for developer notifications.
 *
 * Replaces td-dev-notification, td-dev-build-progress, and td-dev-badge
 * CustomEvent channels. The provider exposes a ref-based setter so non-React
 * code (action-dispatch.ts) can push notifications into the React tree without
 * being a React component itself.
 *
 * Spec S06
 * [D05] DevNotificationContext replaces CustomEvent bridges
 */

import React, { createContext, useContext, useRef, useState, useCallback } from "react";

// ---- Types ----

export interface DevNotification {
  id: string;
  message: string;
  level: "info" | "warning" | "error";
  timestamp: number;
  /** The raw payload passed to notify(), for consumers that need structured fields. */
  payload: Record<string, unknown>;
}

export interface BuildProgressPayload {
  stage: string;
  status: string;
  error?: string;
}

export interface DevNotificationState {
  notifications: DevNotification[];
  buildProgress: BuildProgressPayload | null;
  badgeCounts: Map<string, number>;
}

export interface DevNotificationContextValue {
  state: DevNotificationState;
  notify: (payload: Record<string, unknown>) => void;
  updateBuildProgress: (payload: Record<string, unknown>) => void;
  setBadge: (componentId: string, count: number) => void;
}

/** Ref-based setter exposed to non-React code (e.g., action-dispatch.ts). */
export interface DevNotificationRef {
  notify: (payload: Record<string, unknown>) => void;
  updateBuildProgress: (payload: Record<string, unknown>) => void;
  setBadge: (componentId: string, count: number) => void;
}

// ---- Context ----

const defaultState: DevNotificationState = {
  notifications: [],
  buildProgress: null,
  badgeCounts: new Map(),
};

const defaultContextValue: DevNotificationContextValue = {
  state: defaultState,
  notify: () => {},
  updateBuildProgress: () => {},
  setBadge: () => {},
};

export const DevNotificationContext =
  createContext<DevNotificationContextValue>(defaultContextValue);

// ---- Provider props ----

export interface DevNotificationProviderProps {
  /** Ref that non-React code can use to call notify/updateBuildProgress/setBadge. */
  controlRef?: React.RefObject<DevNotificationRef | null>;
  children: React.ReactNode;
}

// ---- Provider component ----

export function DevNotificationProvider({
  controlRef,
  children,
}: DevNotificationProviderProps) {
  const [notifications, setNotifications] = useState<DevNotification[]>([]);
  const [buildProgress, setBuildProgressState] = useState<BuildProgressPayload | null>(null);
  const [badgeCounts, setBadgeCounts] = useState<Map<string, number>>(new Map());

  const notify = useCallback((payload: Record<string, unknown>) => {
    const notification: DevNotification = {
      id: String(Date.now()) + Math.random(),
      message: typeof payload["message"] === "string" ? payload["message"] : JSON.stringify(payload),
      level:
        payload["level"] === "warning"
          ? "warning"
          : payload["level"] === "error"
            ? "error"
            : "info",
      timestamp: typeof payload["timestamp"] === "number" ? payload["timestamp"] : Date.now(),
      payload,
    };
    setNotifications((prev) => [...prev, notification]);
  }, []);

  const updateBuildProgress = useCallback((payload: Record<string, unknown>) => {
    if (!payload || (typeof payload["stage"] !== "string" && typeof payload["status"] !== "string")) {
      setBuildProgressState(null);
    } else {
      setBuildProgressState({
        stage: typeof payload["stage"] === "string" ? payload["stage"] : "",
        status: typeof payload["status"] === "string" ? payload["status"] : "",
        error: typeof payload["error"] === "string" ? payload["error"] : undefined,
      });
    }
  }, []);

  const setBadge = useCallback((componentId: string, count: number) => {
    setBadgeCounts((prev) => {
      const next = new Map(prev);
      if (count === 0) {
        next.delete(componentId);
      } else {
        next.set(componentId, count);
      }
      return next;
    });
  }, []);

  // Expose ref-based setter for non-React code
  const refValue: DevNotificationRef = { notify, updateBuildProgress, setBadge };
  if (controlRef) {
    (controlRef as React.MutableRefObject<DevNotificationRef | null>).current = refValue;
  }

  const value: DevNotificationContextValue = {
    state: { notifications, buildProgress, badgeCounts },
    notify,
    updateBuildProgress,
    setBadge,
  };

  return (
    <DevNotificationContext.Provider value={value}>
      {children}
    </DevNotificationContext.Provider>
  );
}

// ---- Hook ----

export function useDevNotification(): DevNotificationContextValue {
  return useContext(DevNotificationContext);
}
