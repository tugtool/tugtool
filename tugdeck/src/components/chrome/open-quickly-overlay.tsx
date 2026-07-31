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
 * The search root is the frontmost card's project when one is bound. With
 * nothing bound — an empty deck, or a deck of picker-state cards — it is the
 * user's default project directory, acquired as a browse hold through
 * {@link acquireDefaultWorkspace} so tugcast will route FILETREE queries to
 * it. That acquisition is asynchronous: the popup opens immediately with the
 * empty provider and fills in when it lands. A bound card never waits.
 *
 * The query passes through {@link parseFileLocationQuery} on its way to the
 * provider: `tug-list-view.tsx:123` searches for the path and opens on line
 * 123, and an absolute path inside the project collapses to the relative
 * form the index keys on.
 *
 * The FileTreeStore is built and torn down per open session: the inner
 * body mounts only while open, so its `useEffect` owns the store's
 * lifetime and no WebSocket subscription lingers when the popup is closed.
 *
 * @module components/chrome/open-quickly-overlay
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  TugCompletionPopup,
  COMPLETION_POPUP_FOCUS_GROUP,
  COMPLETION_POPUP_ACCESSORY_ORDER,
} from "@/components/tugways/tug-completion-popup";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { probeDirs } from "@/lib/dir-existence";
import type { TugbankClient } from "@/lib/tugbank-client";
import { FeedStore } from "@/lib/feed-store";
import { FeedId } from "@/protocol";
import {
  FileTreeStore,
  resolveAgainstRoot,
  workspaceFeedFilter,
} from "@/lib/filetree-store";
import { getConnection } from "@/lib/connection-singleton";
import { parseFileLocationQuery } from "@/lib/file-location-query";
import { getDeckStore } from "@/lib/deck-store-registry";
import { frontmostProjectBinding } from "@/lib/frontmost-project";
import { openFileInCard } from "@/lib/open-file-in-card";
import { useHostFacts } from "@/lib/host-facts-store";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import {
  resolveDefaultProjectPath,
  readSessionRecentProjects,
} from "@/settings-api";
import {
  acquireDefaultWorkspace,
  acquireWorkspace,
  getWorkspace,
  subscribeWorkspaces,
  type AcquiredWorkspace,
} from "@/lib/default-workspace-store";
import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";
import {
  closeOpenQuickly,
  getOpenQuicklyOpen,
  subscribeOpenQuickly,
} from "@/lib/open-quickly-store";

/** Provider that returns nothing — no project, or the connection is down. */
const EMPTY_PROVIDER = ((_q: string) => []) as CompletionProvider;

/**
 * How many directories the switcher lists. Enough for the project you are in,
 * your default, and the handful you were in recently — past that the menu
 * stops being a switcher and starts being a history.
 */
const MAX_ROOT_CANDIDATES = 7;

/** `data-testid` on the switcher's menu content; its presence is "menu open". */
const SWITCHER_MENU = "open-quickly-switcher-menu";

/** A path's last component — what the bar and the switcher name it by. */
function leafName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

/**
 * Menu labels for `paths`, one per path, in order.
 *
 * A leaf name alone is the right label right up until two candidates share
 * one — `~/src/tugtool` beside a worktree's `tugtool` reads as the same place
 * twice. When leaves collide, every colliding entry grows parent segments
 * until it is distinct, so the menu never shows two identical rows that go
 * somewhere different. Entries whose leaf is already unique keep the short
 * label — disambiguation is paid for only where it is needed.
 */
export function switcherLabels(paths: readonly string[]): string[] {
  const trimmed = paths.map((p) => p.replace(/\/+$/, ""));
  const leaves = trimmed.map(leafName);
  const collides = leaves.map(
    (leaf, i) => leaves.some((other, j) => j !== i && other === leaf),
  );
  return trimmed.map((path, i) => {
    if (!collides[i]) return leaves[i];
    const segments = path.split("/").filter((s) => s !== "");
    // Grow leftward until this label is unlike every other colliding one.
    for (let take = 2; take <= segments.length; take += 1) {
      const label = segments.slice(-take).join("/");
      const unique = trimmed.every((other, j) => {
        if (j === i || !collides[j]) return true;
        const otherSegments = other.split("/").filter((s) => s !== "");
        return otherSegments.slice(-take).join("/") !== label;
      });
      if (unique) return label;
    }
    // Identical tails all the way up: the full path is the only honest label.
    return path;
  });
}

/**
 * The directories the switcher offers, in order: the frontmost card's
 * project, the default project directory, then recent projects. Deduped by
 * path and capped, so the menu stays a short list of places rather than a
 * history. Built once per popup open — see Risk R01.
 */
function rootCandidates(
  bindingDir: string | null,
  defaultPath: string | null,
  client: TugbankClient | null,
): string[] {
  const out: string[] = [];
  const add = (path: string | null): void => {
    if (path !== null && path !== "" && !out.includes(path)) out.push(path);
  };
  add(bindingDir);
  add(defaultPath);
  if (client !== null) {
    for (const path of readSessionRecentProjects(client)) {
      if (out.length >= MAX_ROOT_CANDIDATES) break;
      add(path);
    }
  }
  return out.slice(0, MAX_ROOT_CANDIDATES);
}

/**
 * The frontmost card's project as a search root, or null when nothing is
 * bound. A picker-state card carries a binding with no project yet — that
 * reads as unbound, exactly as it did to the old menu gate.
 */
function frontmostProjectRoot(): AcquiredWorkspace | null {
  const binding = frontmostProjectBinding();
  return binding !== null && binding.projectDir !== "" ? binding : null;
}

/** The open-session body: builds the file-search stack while mounted. */
function OpenQuicklyBody(): React.ReactElement {
  // The frontmost card's project, captured once when the popup opens:
  // its `projectDir` is the search root (and the base for absolute paths)
  // and its `workspaceKey` scopes the FILETREE feed. Null → nothing is bound,
  // and the default project directory stands in.
  const bindingRef = useRef(frontmostProjectRoot());

  // The default project directory, resolved (explicit setting, else
  // `<home>/tug`) because this one has to be a real directory to search, not
  // a preference tier. Available whether or not a card is bound — the
  // switcher offers it either way.
  const hostFacts = useHostFacts();
  const client = getTugbankClient();
  const defaultPath =
    client === null
      ? null
      : resolveDefaultProjectPath(client, hostFacts?.home ?? null);

  // The directory picked in the switcher, or null while the popup is still on
  // whatever it opened with. Component-local: it is this popup instance's UI
  // state and means nothing once it closes.
  const [pickedPath, setPickedPath] = useState<string | null>(null);

  // What the popup is searching right now.
  const activePath =
    pickedPath ?? bindingRef.current?.projectDir ?? defaultPath;
  const activeIsBinding =
    bindingRef.current !== null &&
    activePath === bindingRef.current.projectDir;

  // tugcast has to register a directory before FILETREE will route queries to
  // it. The bound card's project already is; anything else needs a browse
  // hold. The hold outlives the popup, so a later ⇧⌘O on the same directory
  // shows results on the first keystroke. Only the default is created if
  // missing — a recent project the user picked is never conjured up.
  useEffect(() => {
    if (activePath === null || activeIsBinding) return;
    if (activePath === defaultPath) acquireDefaultWorkspace(activePath);
    else acquireWorkspace(activePath);
  }, [activePath, activeIsBinding, defaultPath]);

  const acquired = useSyncExternalStore(
    subscribeWorkspaces,
    useCallback(
      (): AcquiredWorkspace | null =>
        activePath === null || activeIsBinding ? null : getWorkspace(activePath),
      [activePath, activeIsBinding],
    ),
  );

  // Whichever root is live. Until an acquisition lands this is null and the
  // popup renders with the empty provider — a bound card never waits.
  const root: AcquiredWorkspace | null = activeIsBinding
    ? bindingRef.current
    : acquired;
  const projectDir = root?.projectDir ?? null;

  const stackRef = useRef<{
    workspaceKey: string;
    feedStore: FeedStore;
    fileTreeStore: FileTreeStore;
    provider: CompletionProvider;
  } | null>(null);

  if (root !== null && stackRef.current?.workspaceKey !== root.workspaceKey) {
    const connection = getConnection();
    if (connection) {
      const previous = stackRef.current;
      const feedStore = new FeedStore(
        connection,
        [FeedId.FILETREE],
        undefined,
        workspaceFeedFilter(root.workspaceKey),
      );
      const fileTreeStore = new FileTreeStore(
        feedStore,
        FeedId.FILETREE,
        root.projectDir,
      );
      stackRef.current = {
        workspaceKey: root.workspaceKey,
        feedStore,
        fileTreeStore,
        provider: fileTreeStore.getFileCompletionProvider(),
      };
      if (previous !== null) {
        previous.fileTreeStore.dispose();
        previous.feedStore.dispose();
      }
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

  // The line carried by the current query's `file:line` suffix, if any.
  // Written by the provider wrapper below on every keystroke, read at commit.
  const lineRef = useRef<number | undefined>(undefined);

  // The popup owns the raw query; the file index only knows project-relative
  // paths. This wrapper sits between them: it splits off `:line` (and any
  // `:col`) and relativizes an absolute paste before the search, so the
  // clipboard forms people actually have — `tug-list-view.tsx:123`, a
  // compiler diagnostic, an absolute path from the shell — resolve to a row.
  // Rebuilt whenever the stack is — the wrapper closes over the live base
  // provider, so a root swap that leaves it stale would keep searching the
  // disposed workspace.
  const provider = useMemo<CompletionProvider>(() => {
    const base = stackRef.current?.provider ?? EMPTY_PROVIDER;
    const wrapped = ((raw: string) => {
      const { search, line } = parseFileLocationQuery(raw, projectDir);
      lineRef.current = line;
      return base(search);
    }) as CompletionProvider;
    if (base.subscribe !== undefined) {
      wrapped.subscribe = (listener: () => void) => base.subscribe!(listener);
    }
    return wrapped;
  }, [projectDir, root?.workspaceKey]);

  const commit = (item: CompletionItem): void => {
    const relative = item.atom.value;
    const store = getDeckStore();
    if (
      store !== null &&
      projectDir !== null &&
      typeof relative === "string" &&
      relative !== ""
    ) {
      openFileInCard(
        store,
        resolveAgainstRoot(projectDir, relative),
        lineRef.current,
      );
    }
    closeOpenQuickly();
  };

  // ---- The directory switcher ----
  //
  // The candidate list is built once, when the popup opens (Risk R01): the
  // frontmost binding, the default directory, then recent projects. Deriving
  // it per keystroke would race deck reordering under the user's hands.
  //
  // The one round trip does double duty. It drops directories that no longer
  // exist, and it collapses spellings that name the same directory: the same
  // tree reached through a mount and its symlink is two entries in recents but
  // one place, and the menu must not offer it twice. Only the server can say
  // they are the same ([L29]), so the answer comes back with the existence
  // check rather than being guessed here.
  const [candidates, setCandidates] = useState<string[]>(() =>
    rootCandidates(bindingRef.current?.projectDir ?? null, defaultPath, client),
  );
  const didFilterRef = useRef(false);
  useEffect(() => {
    if (didFilterRef.current) return;
    didFilterRef.current = true;
    let cancelled = false;
    void probeDirs(candidates).then(({ exists, canonical }) => {
      if (cancelled) return;
      setCandidates((prev) => {
        const seen = new Set<string>();
        return prev.filter((path) => {
          // Absent from the map means unknown (probe failure, or past the
          // server's batch cap) — keep those, like the picker does.
          if (exists[path] === false) return false;
          // Unresolved paths fall back to their own spelling as identity, so
          // a probe failure degrades to the old string dedup rather than
          // collapsing everything into one entry.
          const identity = canonical[path] ?? path.replace(/\/+$/, "");
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
      });
    });
    return () => {
      cancelled = true;
    };
    // Built once per popup open; `candidates` is the seed it reads, not a
    // dependency that should re-run it.
  }, []);

  const candidateLabels = useMemo(
    () => switcherLabels(candidates),
    [candidates],
  );

  const switcherId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: { [switcherId]: (path: string) => setPickedPath(path) },
  });

  // The popup's easy dismissal has to yield while the switcher's menu is up:
  // that menu is a Radix dropdown portalled outside the panel, so focus
  // landing in it reads as focus leaving the popup. The menu's presence in
  // the document IS its open state — it unmounts on close.
  const dismissGuard = useCallback(
    () => document.querySelector(`[data-testid="${SWITCHER_MENU}"]`) !== null,
    [],
  );

  const switcher =
    candidates.length > 1 ? (
      <ResponderScope>
        <div ref={responderRef as (el: HTMLDivElement | null) => void}>
          <TugPopupButton
            label={
              candidateLabels[candidates.indexOf(activePath ?? "")] ??
              leafName(activePath ?? "")
            }
            aria-label="Search directory"
            size="sm"
            senderId={switcherId}
            data-testid={SWITCHER_MENU}
            // Into the popup's own focus group, so the engine's Tab walk moves
            // the key view here from the field and Space/Return open the menu
            // through the key-view delegation channel.
            focusGroup={COMPLETION_POPUP_FOCUS_GROUP}
            focusOrder={COMPLETION_POPUP_ACCESSORY_ORDER}
            items={candidates.map((path, i) => ({
              action: TUG_ACTIONS.SELECT_VALUE,
              value: path,
              label: candidateLabels[i],
            }))}
          />
        </div>
      </ResponderScope>
    ) : undefined;

  // The active root's leaf directory name — "Open Quickly in tugtool" reads
  // cleaner than the whole absolute path. Taken from the path the popup is
  // pointed at rather than the acquired root, so the bar names the picked
  // directory while its acquisition is still in flight.
  const projectLeaf = leafName(activePath ?? projectDir ?? "");

  // What an empty result list means, answered at the moment it is rendered.
  // A directory Tug just created for you is genuinely empty, and a blank
  // panel there reads as a hang rather than as an answer — so say so. Before
  // the search backend has answered there is nothing to report yet, and the
  // panel stays bare rather than flashing "no files" at a directory that has
  // plenty.
  const emptyLabel = useCallback((): string | null => {
    const store = stackRef.current?.fileTreeStore;
    if (store === undefined || !store.hasResponded()) return null;
    if (store.getSnapshot().query !== "") return `No files matching that name`;
    return projectLeaf !== ""
      ? `No files in ${projectLeaf}`
      : "This folder is empty";
  }, [projectLeaf]);

  return (
    <TugCompletionPopup
      placeholder={
        projectLeaf !== "" ? `Open Quickly in ${projectLeaf}` : "Open Quickly"
      }
      provider={provider}
      onCommit={commit}
      onDismiss={closeOpenQuickly}
      accessory={switcher}
      dismissGuard={dismissGuard}
      emptyLabel={emptyLabel}
    />
  );
}

/** Deck-global mount: renders the popup only while Open Quickly is open. */
export function OpenQuicklyOverlay(): React.ReactElement | null {
  const open = useSyncExternalStore(subscribeOpenQuickly, getOpenQuicklyOpen);
  if (!open) return null;
  return <OpenQuicklyBody />;
}
