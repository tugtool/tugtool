/**
 * open-quickly-overlay.tsx — the deck-global Open Quickly popup.
 *
 * Mounted once at the deck level. It watches {@link getOpenQuicklyOpen}
 * ([L02] via `useSyncExternalStore`); while open it stands up a live
 * {@link FileTreeStore} against the real connection — the same file-search
 * backend the composer's `@` completion uses — and feeds its provider to a
 * {@link TugCompletionPopup}. Choosing a row opens that file through the
 * one {@link openFileInCard} entry point (so it also lands in Open Recent);
 * dismissing just closes the popup.
 *
 * The FileTreeStore is built and torn down per open session: the inner
 * body mounts only while open, so its `useEffect` owns the store's
 * lifetime and no WebSocket subscription lingers when the popup is closed.
 *
 * @module components/chrome/open-quickly-overlay
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

import { TugCompletionPopup } from "@/components/tugways/tug-completion-popup";
import { FeedStore, type FeedStoreFilter } from "@/lib/feed-store";
import { FeedId } from "@/protocol";
import { FileTreeStore } from "@/lib/filetree-store";
import { getConnection } from "@/lib/connection-singleton";
import { getDeckStore } from "@/lib/deck-store-registry";
import { frontmostProjectBinding } from "@/lib/frontmost-project";
import { openFileInCard } from "@/lib/open-file-in-card";
import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";
import {
  closeOpenQuickly,
  getOpenQuicklyOpen,
  subscribeOpenQuickly,
} from "@/lib/open-quickly-store";

/** Provider that returns nothing — no project, or the connection is down. */
const EMPTY_PROVIDER = ((_q: string) => []) as CompletionProvider;

/**
 * Join the project root with a FILETREE result. FILETREE indexes
 * project-relative POSIX paths, so an absolute path — what
 * {@link openFileInCard} needs — is `root` + `/` + the result.
 */
function resolveAgainstRoot(root: string, relative: string): string {
  const base = root.replace(/\/+$/, "");
  const rel = relative.replace(/^\/+/, "");
  return `${base}/${rel}`;
}

/** FILETREE feed filter scoping frames to one workspace. */
function workspaceFilter(workspaceKey: string): FeedStoreFilter {
  return (_feedId, decoded) =>
    typeof decoded === "object" &&
    decoded !== null &&
    "workspace_key" in decoded &&
    (decoded as { workspace_key: unknown }).workspace_key === workspaceKey;
}

/** The open-session body: builds the file-search stack while mounted. */
function OpenQuicklyBody(): React.ReactElement {
  // The frontmost card's project, captured once when the popup opens:
  // its `projectDir` is the search root (and the base for absolute paths)
  // and its `workspaceKey` scopes the FILETREE feed. Null → no project;
  // the popup shows nothing (the menu gate normally prevents this).
  const bindingRef = useRef(frontmostProjectBinding());
  const projectDir = bindingRef.current?.projectDir ?? null;

  const stackRef = useRef<{
    feedStore: FeedStore;
    fileTreeStore: FileTreeStore;
    provider: CompletionProvider;
  } | null>(null);

  if (stackRef.current === null && bindingRef.current !== null) {
    const connection = getConnection();
    if (connection) {
      const feedStore = new FeedStore(
        connection,
        [FeedId.FILETREE],
        undefined,
        workspaceFilter(bindingRef.current.workspaceKey),
      );
      const fileTreeStore = new FileTreeStore(
        feedStore,
        FeedId.FILETREE,
        bindingRef.current.projectDir,
      );
      stackRef.current = {
        feedStore,
        fileTreeStore,
        provider: fileTreeStore.getFileCompletionProvider(),
      };
    }
  }

  useEffect(() => {
    return () => {
      const stack = stackRef.current;
      if (stack) {
        stack.fileTreeStore.dispose();
        stack.feedStore.dispose();
        stackRef.current = null;
      }
    };
  }, []);

  const commit = (item: CompletionItem): void => {
    const relative = item.atom.value;
    const store = getDeckStore();
    if (
      store !== null &&
      projectDir !== null &&
      typeof relative === "string" &&
      relative !== ""
    ) {
      openFileInCard(store, resolveAgainstRoot(projectDir, relative));
    }
    closeOpenQuickly();
  };

  // The project's leaf directory name — "Open Quickly in tugtool" reads
  // cleaner than the whole absolute path.
  const projectLeaf =
    projectDir !== null
      ? (projectDir.replace(/\/+$/, "").split("/").pop() ?? "")
      : "";

  return (
    <TugCompletionPopup
      placeholder={
        projectLeaf !== "" ? `Open Quickly in ${projectLeaf}` : "Open Quickly"
      }
      provider={stackRef.current?.provider ?? EMPTY_PROVIDER}
      onCommit={commit}
      onDismiss={closeOpenQuickly}
    />
  );
}

/** Deck-global mount: renders the popup only while Open Quickly is open. */
export function OpenQuicklyOverlay(): React.ReactElement | null {
  const open = useSyncExternalStore(subscribeOpenQuickly, getOpenQuicklyOpen);
  if (!open) return null;
  return <OpenQuicklyBody />;
}
