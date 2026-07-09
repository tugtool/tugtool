/**
 * card-resource-path.ts — resolve the filesystem resource a card is
 * bound to, for the Cmd-click title path menu.
 *
 * Keyed purely on `cardId`, so the title bar needs no `componentId`
 * plumbing: a Dev card exposes its project directory through the
 * session-binding store; a File card exposes its edited file through
 * the open-file registry. The first that yields a path wins (a card is
 * only ever one kind), and the kind tags whether the leaf segment is a
 * directory (Dev card project) or a file (File card).
 *
 * @module lib/card-resource-path
 */

import { cardSessionBindingStore } from "./card-session-binding-store";
import { getOpenFileCard } from "./file-card-open-registry";

export interface CardResourcePath {
  /** Absolute path to the bound resource. */
  path: string;
  /** Whether the leaf is a directory (Dev card) or a file (File card). */
  kind: "dir" | "file";
}

/** The resource `cardId` is bound to, or null when it has none. */
export function resolveCardResourcePath(
  cardId: string | null,
): CardResourcePath | null {
  if (cardId === null) return null;

  const projectDir = cardSessionBindingStore.getBinding(cardId)?.projectDir;
  if (projectDir !== undefined && projectDir !== "") {
    return { path: projectDir, kind: "dir" };
  }

  const filePath = getOpenFileCard(cardId)?.getPath() ?? null;
  if (filePath !== null && filePath !== "") {
    return { path: filePath, kind: "file" };
  }

  return null;
}
