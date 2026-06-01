/**
 * os-open.ts — hand a filesystem path to the macOS host to open ([#step-12a]).
 *
 * The Tug.app host registers an `openPath` `WKScriptMessageHandler`
 * (`MainWindow.swift`) that expands a leading `~` and routes the path through
 * `NSWorkspace` by `kind`: a `"file"` opens in its default editor (created
 * with its parent dirs if absent, so a not-yet-written memory file still opens
 * to edit), and a `"folder"` opens in Finder (or reveals its parent if
 * missing — never auto-created). This is the web → host half: `/memory` calls
 * it to open a memory file / folder in the OS, since editing happens in the OS
 * app (no in-app editor, no write-back).
 *
 * Outside the host (browser dev / tests) the `webkit` bridge is absent and
 * this no-ops after a debug log — the caller needs no capability check.
 *
 * @module lib/os-open
 */

/** Whether the path opens in an editor (`file`) or Finder (`folder`). */
export type OsOpenKind = "file" | "folder";

/**
 * Ask the host to open `path` in the OS. `path` may be absolute or
 * `~`-relative (the host expands the tilde — the web layer has no home dir).
 * `kind` decides routing: a `file` opens in the default editor (created if
 * absent), a `folder` opens in Finder. No-op when the host bridge is
 * unavailable.
 */
export function openPathInOS(path: string, kind: OsOpenKind = "file"): void {
  const webkit = (globalThis as unknown as Record<string, unknown>).webkit as
    | Record<string, unknown>
    | undefined;
  const handlers = webkit?.messageHandlers as Record<string, unknown> | undefined;
  const handler = handlers?.openPath as
    | { postMessage: (v: unknown) => void }
    | undefined;
  if (handler) {
    handler.postMessage({ path, kind });
  } else {
    console.info(`os-open: host bridge unavailable, cannot open ${path}`);
  }
}
