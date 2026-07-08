/**
 * version-bridge.ts — request/response client for the macOS host's
 * NSFileVersion surface (the document revision store behind TextEdit's
 * Versions).
 *
 * Three handlers on the host (`MainWindow.swift`):
 *
 *   - `checkpointVersion { id, path }` → `onVersionCheckpointed(id, ok)`
 *     deposits a copy of the file's CURRENT content into the store.
 *     The File card calls this before its first autosave write of an
 *     editing session and on every explicit ⌘S, making Tug's
 *     write-through autosave non-destructive.
 *   - `listVersions { id, path }` → `onVersionsListed(id, entries|null)`
 *     enumerates other versions for the restore sheet.
 *   - `restoreVersion { id, path, versionId }` → `onVersionRestored(id, ok)`
 *     replaces the file with a chosen version; the caller treats
 *     success as an external change (re-read + revert in place).
 *
 * `versionId` is opaque (the host's archived persistentIdentifier).
 * Graceful degradation: outside the host every call resolves to the
 * "unavailable" value (`false` / `null`) so versions read as simply
 * absent — never an error. Same bridge conventions as
 * `native-path-picker.ts` (unique ids, `__tugBridge` callbacks merged
 * with `??=`).
 *
 * @module lib/version-bridge
 */

/** One revision-store entry. */
export interface FileVersionEntry {
  /** Opaque host-side identifier; pass back to `restoreFileVersion`. */
  versionId: string;
  /** Version modification time, ms since the Unix epoch. */
  modificationDate: number;
}

interface TugBridge {
  onVersionCheckpointed?: (id: string, ok: boolean) => void;
  onVersionsListed?: (id: string, entries: unknown) => void;
  onVersionRestored?: (id: string, ok: boolean) => void;
}

interface WebkitHandles {
  webkit?: {
    messageHandlers?: Record<
      string,
      { postMessage: (value: unknown) => void } | undefined
    >;
  };
  __tugBridge?: TugBridge;
}

const pendingCheckpoints = new Map<string, (ok: boolean) => void>();
const pendingLists = new Map<string, (entries: FileVersionEntry[] | null) => void>();
const pendingRestores = new Map<string, (ok: boolean) => void>();

/** Monotonic request-id counter (no Date/random — unique enough). */
let nextId = 0;

function handler(
  name: "checkpointVersion" | "listVersions" | "restoreVersion",
): { postMessage: (value: unknown) => void } | undefined {
  const w = globalThis as unknown as WebkitHandles;
  return w.webkit?.messageHandlers?.[name] ?? undefined;
}

function coerceEntries(raw: unknown): FileVersionEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: FileVersionEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.versionId !== "string") continue;
    entries.push({
      versionId: obj.versionId,
      modificationDate:
        typeof obj.modificationDate === "number" ? obj.modificationDate : 0,
    });
  }
  // Newest first for the restore sheet.
  entries.sort((a, b) => b.modificationDate - a.modificationDate);
  return entries;
}

/** Install the bridge callbacks once, preserving sibling bridge keys. */
function ensureBridge(): void {
  const w = globalThis as unknown as WebkitHandles;
  const bridge = (w.__tugBridge ??= {});
  bridge.onVersionCheckpointed ??= (id, ok) => {
    const resolve = pendingCheckpoints.get(id);
    if (resolve !== undefined) {
      pendingCheckpoints.delete(id);
      resolve(ok === true);
    }
  };
  bridge.onVersionsListed ??= (id, entries) => {
    const resolve = pendingLists.get(id);
    if (resolve !== undefined) {
      pendingLists.delete(id);
      resolve(coerceEntries(entries));
    }
  };
  bridge.onVersionRestored ??= (id, ok) => {
    const resolve = pendingRestores.get(id);
    if (resolve !== undefined) {
      pendingRestores.delete(id);
      resolve(ok === true);
    }
  };
}

/** Whether the version bridge is reachable (running inside Tug.app). */
export function isVersionBridgeAvailable(): boolean {
  return handler("checkpointVersion") !== undefined;
}

/**
 * Deposit the file's current content as a version. Resolves `false`
 * when the bridge is unavailable or the deposit failed (both non-fatal
 * by contract — versions are a net, not a gate).
 */
export function checkpointFileVersion(path: string): Promise<boolean> {
  const post = handler("checkpointVersion");
  if (post === undefined) return Promise.resolve(false);
  ensureBridge();
  const id = `ver-${(nextId += 1)}`;
  return new Promise<boolean>((resolve) => {
    pendingCheckpoints.set(id, resolve);
    post.postMessage({ id, path });
  });
}

/** List other versions of `path`, newest first; `null` when unavailable. */
export function listFileVersions(
  path: string,
): Promise<FileVersionEntry[] | null> {
  const post = handler("listVersions");
  if (post === undefined) return Promise.resolve(null);
  ensureBridge();
  const id = `ver-${(nextId += 1)}`;
  return new Promise<FileVersionEntry[] | null>((resolve) => {
    pendingLists.set(id, resolve);
    post.postMessage({ id, path });
  });
}

/** Replace `path`'s content with `versionId`. Resolves success. */
export function restoreFileVersion(
  path: string,
  versionId: string,
): Promise<boolean> {
  const post = handler("restoreVersion");
  if (post === undefined) return Promise.resolve(false);
  ensureBridge();
  const id = `ver-${(nextId += 1)}`;
  return new Promise<boolean>((resolve) => {
    pendingRestores.set(id, resolve);
    post.postMessage({ id, path, versionId });
  });
}
