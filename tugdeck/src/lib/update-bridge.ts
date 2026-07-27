/**
 * update-bridge.ts — receives the macOS host's "an update is available"
 * push and announces it as a bulletin.
 *
 * Sparkle's scheduled checks run in the host. When one finds a new
 * version, `UpdateController`'s gentle-reminder delegate declines to show
 * Sparkle's own alert window and the host calls
 * `window.__tugBridge.onUpdateAvailable({ version, build })` instead
 * (emit site: `MainWindow.bridgeUpdateAvailable` — keep the callback name
 * in lockstep). The bulletin's action posts back to the host's
 * `checkForUpdates` handler, which brings Sparkle's standard update flow
 * into focus; the download, release notes, install and relaunch are all
 * Sparkle's.
 *
 * User-initiated checks (the Check for Updates… menu item) never come
 * through here — Sparkle always shows those itself.
 *
 * The `__tugBridge` object is shared with other host callbacks, so the
 * receiver is merged in with `??=` — never replace the object wholesale.
 *
 * The notice is pure appearance: a transient toast with no store, no
 * React state, and nothing persisted ([L06]; Sonner owns the animation
 * per [L14]). A repeat push after a reconnect simply shows the bulletin
 * again.
 *
 * @module lib/update-bridge
 */

import { bulletin } from "@/components/tugways/tug-bulletin";

/** The host→web bridge object; only the update callback concerns us here. */
interface TugBridge {
  onUpdateAvailable?: (update: { version?: unknown; build?: unknown }) => void;
}

interface WebkitHandles {
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (value: unknown) => void } | undefined>;
  };
  __tugBridge?: TugBridge;
}

/**
 * Ask the host to bring Sparkle's update flow into focus. A no-op outside
 * Tug.app, and the host itself no-ops when the updater never started.
 */
function requestUpdateFlow(): void {
  const w = globalThis as unknown as WebkitHandles;
  w.webkit?.messageHandlers?.checkForUpdates?.postMessage({});
}

/**
 * Install `__tugBridge.onUpdateAvailable`. Called once from deck boot;
 * safe to call again (the receiver is installed only when absent).
 */
export function installUpdateBridge(): void {
  const w = globalThis as unknown as WebkitHandles;
  const bridge = (w.__tugBridge ??= {});
  if (bridge.onUpdateAvailable !== undefined) return;

  bridge.onUpdateAvailable = (update) => {
    const version = typeof update?.version === "string" ? update.version : "";
    const title = version === "" ? "A Tug update is available" : `Tug ${version} is available`;
    bulletin(title, {
      description: "Restart into the new version when you're ready.",
      duration: 30_000,
      action: { label: "Update...", onClick: requestUpdateFlow },
    });
  };
}
