/**
 * maker-mode-bridge.ts — request/response client for the macOS host's
 * settings bridge (`getSettings` / `setMakerMode`
 * `WKScriptMessageHandler`s), used by the Settings card's App tab.
 *
 * The host responds by calling `window.__tugBridge.onSettingsLoaded(
 * { makerMode, sourceTree })` and `window.__tugBridge.onMakerModeChanged(
 * confirmed)` (emit strings in `MainWindow.swift` — keep the callback
 * names in lockstep). Neither callback carries a request id, so pending
 * resolvers queue FIFO; the host evaluates responses in request order.
 *
 * The `__tugBridge` object is shared with other host callbacks (the
 * path picker's `onPathChosen`), so receivers are merged in with `??=`
 * — never replace the object wholesale.
 *
 * Graceful degradation: outside the host (browser dev) the handlers are
 * absent, {@link isMakerModeBridgeAvailable} is `false`, and both calls
 * resolve `null`, so callers can disable the affordance with a hint.
 *
 * @module lib/maker-mode-bridge
 */

/** The host's reply to a `getSettings` request. */
export interface HostSettings {
  /** The maker-mode gate (Maker menu + dev serving). */
  makerMode: boolean;
  /** Configured source-tree path, or null when unset. */
  sourceTree: string | null;
}

/** The host→web bridge object; only the settings callbacks concern us here. */
interface TugBridge {
  onSettingsLoaded?: (settings: { makerMode?: unknown; sourceTree?: unknown }) => void;
  onMakerModeChanged?: (confirmed: unknown) => void;
}

interface WebkitHandles {
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (value: unknown) => void } | undefined>;
  };
  __tugBridge?: TugBridge;
}

/** FIFO resolvers awaiting `onSettingsLoaded` / `onMakerModeChanged`. */
const pendingSettings: Array<(settings: HostSettings) => void> = [];
const pendingSetMakerMode: Array<(confirmed: boolean) => void> = [];

function handler(name: "getSettings" | "setMakerMode"):
  | { postMessage: (value: unknown) => void }
  | undefined {
  const w = globalThis as unknown as WebkitHandles;
  return w.webkit?.messageHandlers?.[name] ?? undefined;
}

/** Install the settings callbacks once, preserving sibling bridge keys. */
function ensureBridge(): void {
  const w = globalThis as unknown as WebkitHandles;
  const bridge = (w.__tugBridge ??= {});
  if (bridge.onSettingsLoaded === undefined) {
    bridge.onSettingsLoaded = (settings) => {
      const resolve = pendingSettings.shift();
      if (resolve === undefined) return;
      resolve({
        makerMode: settings?.makerMode === true,
        sourceTree:
          typeof settings?.sourceTree === "string" ? settings.sourceTree : null,
      });
    };
  }
  if (bridge.onMakerModeChanged === undefined) {
    bridge.onMakerModeChanged = (confirmed) => {
      const resolve = pendingSetMakerMode.shift();
      if (resolve === undefined) return;
      resolve(confirmed === true);
    };
  }
}

/** Whether the settings bridge is reachable (running inside Tug.app). */
export function isMakerModeBridgeAvailable(): boolean {
  return handler("getSettings") !== undefined && handler("setMakerMode") !== undefined;
}

/**
 * Read the host's current settings. Resolves `null` when the bridge is
 * unavailable (browser dev).
 */
export function getSettings(): Promise<HostSettings | null> {
  const h = handler("getSettings");
  if (h === undefined) return Promise.resolve(null);
  ensureBridge();
  return new Promise<HostSettings | null>((resolve) => {
    pendingSettings.push(resolve as (settings: HostSettings) => void);
    h.postMessage({});
  });
}

/**
 * Commit the maker-mode gate. Resolves the host-confirmed value, or
 * `null` when the bridge is unavailable. Outside the app-test harness,
 * flipping the gate also flips dev serving — the host reloads the page,
 * so the resolution may never be observed; callers must not depend on it.
 */
export function setMakerMode(enabled: boolean): Promise<boolean | null> {
  const h = handler("setMakerMode");
  if (h === undefined) return Promise.resolve(null);
  ensureBridge();
  return new Promise<boolean | null>((resolve) => {
    pendingSetMakerMode.push(resolve as (confirmed: boolean) => void);
    h.postMessage({ enabled });
  });
}
