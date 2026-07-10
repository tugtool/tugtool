/**
 * recent-documents.ts — the deck's Open Recent list.
 *
 * A most-recently-used list of absolute file paths, persisted in tugbank
 * (`dev.tugtool.file-editor` / `recent-documents`) so it survives across
 * launches, and mirrored to the Swift host for the File ▸ Open Recent
 * submenu. The deck owns ordering and de-duplication; the host filters
 * the list to files that still exist and shows the top
 * {@link RECENT_DOCUMENTS_MENU_LIMIT} when the menu opens (so a deleted
 * file drops off without the deck having to stat anything).
 *
 * Every real file-open flows through {@link openFileInCard}, which calls
 * {@link noteRecentDocument} — one chokepoint, so the menu, drops, and
 * Open Quickly all feed the same list.
 *
 * @module lib/recent-documents
 */

import { getTugbankClient } from "./tugbank-singleton";
import { FILE_EDITOR_DEFAULTS_DOMAIN } from "./file-editor-settings";
import { publishRecentDocuments } from "./host-menu-state";

/** tugbank key under {@link FILE_EDITOR_DEFAULTS_DOMAIN} for the MRU list. */
export const RECENT_DOCUMENTS_KEY = "recent-documents";

/**
 * How many paths the deck retains. The host shows at most 10 that still
 * exist; keeping a few more in the store means a run of just-deleted
 * files doesn't starve the visible menu.
 */
export const RECENT_DOCUMENTS_STORE_LIMIT = 20;

/**
 * Hard byte ceiling on the persisted list. This value rides the boot
 * DEFAULTS frame (it's a tugbank default), so — belt-and-suspenders on top
 * of the count cap — the serialized list is never allowed past a few KB no
 * matter how long individual paths are. Well under tugbank's per-entry
 * write limit; a pathological run of very long paths trims to fit rather
 * than growing the boot frame.
 */
export const RECENT_DOCUMENTS_MAX_BYTES = 16 * 1024;

/** In-memory MRU, newest first. The tugbank value is the durable copy. */
let recents: string[] = [];

/**
 * Trim `paths` (already de-duped, newest first) to both the count cap and
 * the byte cap — whichever binds first — keeping the newest entries.
 */
function capRecentDocuments(paths: string[]): string[] {
  const out: string[] = [];
  let bytes = 2; // the enclosing "[]"
  for (const path of paths) {
    if (out.length >= RECENT_DOCUMENTS_STORE_LIMIT) break;
    // JSON-encoded size of this element, plus a comma separator.
    const encoded = JSON.stringify(path).length + 1;
    if (bytes + encoded > RECENT_DOCUMENTS_MAX_BYTES) break;
    out.push(path);
    bytes += encoded;
  }
  return out;
}

/** Coerce a stored tugbank value into a clean, capped string[] (defensive). */
export function coerceRecentDocuments(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item === "" || seen.has(item)) continue;
    seen.add(item);
    cleaned.push(item);
  }
  return capRecentDocuments(cleaned);
}

/**
 * Seed the list from tugbank and push it to the host. Called once at
 * boot, after the tugbank client is set and its first DEFAULTS frame has
 * populated the cache.
 */
export function initRecentDocuments(): void {
  let raw: unknown;
  try {
    raw = getTugbankClient()?.getValue(FILE_EDITOR_DEFAULTS_DOMAIN, RECENT_DOCUMENTS_KEY);
  } catch (err) {
    console.warn("[recent-documents] read failed:", err);
  }
  recents = coerceRecentDocuments(raw);
  publishRecentDocuments(recents);
}

/** The current MRU snapshot (newest first). */
export function getRecentDocuments(): string[] {
  return recents.slice();
}

/**
 * Record `path` as the most-recent document: move it to the front,
 * de-dupe, cap, persist, and re-publish to the host.
 */
export function noteRecentDocument(path: string): void {
  if (path === "") return;
  const next = capRecentDocuments([path, ...recents.filter((p) => p !== path)]);
  if (next.length === recents.length && next.every((p, i) => p === recents[i])) {
    return; // Already newest — nothing changed.
  }
  recents = next;
  persist();
  publishRecentDocuments(recents);
}

/** Empty the list (File ▸ Open Recent ▸ Clear Menu). */
export function clearRecentDocuments(): void {
  if (recents.length === 0) return;
  recents = [];
  persist();
  publishRecentDocuments(recents);
}

/**
 * Write the list through tugbank (optimistic cache + durable PUT).
 * Defensive: persistence is best-effort, and the in-memory list already
 * drives the live menu — a cache/transport failure must never propagate
 * into the open flow that triggered it.
 */
function persist(): void {
  try {
    getTugbankClient()?.setLocalValue(
      FILE_EDITOR_DEFAULTS_DOMAIN,
      RECENT_DOCUMENTS_KEY,
      { kind: "json", value: recents },
    );
    void fetch(
      `/api/defaults/${FILE_EDITOR_DEFAULTS_DOMAIN}/${RECENT_DOCUMENTS_KEY}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "json", value: recents }),
      },
    ).catch((err) => {
      console.warn("[recent-documents] PUT failed:", err);
    });
  } catch (err) {
    console.warn("[recent-documents] persist failed:", err);
  }
}
