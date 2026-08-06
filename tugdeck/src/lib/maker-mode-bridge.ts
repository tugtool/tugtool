/**
 * maker-mode-bridge.ts — read-only client for the macOS host's settings
 * bridge (the `getSettings` `WKScriptMessageHandler`).
 *
 * Maker mode is not a setting: the host derives it from the build profile
 * (on in debug bundles, absent from release ones), so this side only ever
 * reads it. The menu-state layer needs the fact because a hidden Maker
 * menu's chords must fall through to the web view.
 *
 * The host responds by calling `window.__tugBridge.onSettingsLoaded(
 * { makerMode, sourceTree })` (an emit string in `MainWindow.swift` — keep
 * the callback name in lockstep). The callback carries no request id, so
 * pending resolvers queue FIFO; the host evaluates responses in request
 * order.
 *
 * The `__tugBridge` object is shared with other host callbacks (the
 * path picker's `onPathChosen`), so receivers are merged in with `??=`
 * — never replace the object wholesale.
 *
 * Graceful degradation: outside the host (browser dev) the handler is
 * absent and the call resolves `null`.
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

/** The host→web bridge object; only the settings callback concerns us here. */
interface TugBridge {
  onSettingsLoaded?: (settings: { makerMode?: unknown; sourceTree?: unknown }) => void;
}

interface WebkitHandles {
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (value: unknown) => void } | undefined>;
  };
  __tugBridge?: TugBridge;
}

/** FIFO resolvers awaiting `onSettingsLoaded`. */
const pendingSettings: Array<(settings: HostSettings) => void> = [];

/**
 * The maker-mode gate as last reported by the host, or `null` before any
 * reply has arrived. Constant for a page lifetime — the host derives it
 * from the build profile — so one boot-time `getSettings` round trip
 * settles it. The menu-state layer reads it to decide whether the Maker
 * menu's chords claim their keys (a hidden menu's chords fall through).
 */
let knownMakerMode: boolean | null = null;

/** See {@link knownMakerMode}. */
export function lastKnownMakerMode(): boolean | null {
  return knownMakerMode;
}

function handler(
  name: "getSettings",
): { postMessage: (value: unknown) => void } | undefined {
  const w = globalThis as unknown as WebkitHandles;
  return w.webkit?.messageHandlers?.[name] ?? undefined;
}

/** Install the settings callback once, preserving sibling bridge keys. */
function ensureBridge(): void {
  const w = globalThis as unknown as WebkitHandles;
  const bridge = (w.__tugBridge ??= {});
  if (bridge.onSettingsLoaded === undefined) {
    bridge.onSettingsLoaded = (settings) => {
      knownMakerMode = settings?.makerMode === true;
      const resolve = pendingSettings.shift();
      if (resolve === undefined) return;
      resolve({
        makerMode: settings?.makerMode === true,
        sourceTree:
          typeof settings?.sourceTree === "string" ? settings.sourceTree : null,
      });
    };
  }
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
