/**
 * The annotation kind registry — what each entity kind *does*.
 *
 * This is the library's central promise: the transcript owns one
 * delegated click listener and one context-menu provider, and both ask
 * the registry what to do with whatever annotation the gesture landed on.
 * Adding an entity kind is therefore a detector plus an entry here, with
 * no edit to any transcript, cell, or menu surface.
 *
 * Two things a kind declares:
 *
 *  - `primaryClick` — what a plain click does, or nothing at all. URLs
 *    and email addresses deliberately have none: they are real anchors,
 *    and native navigation (routed to the system browser by the host's
 *    navigation delegate) is already the correct behavior. Intercepting
 *    it in JS would be regression risk for no gain.
 *  - `menuEntries` + `suppressStandardItems` — what a right-click offers,
 *    and whether those items *replace* the standard text-menu block or
 *    sit below it. Commands replace it: a selection-scoped Copy beside
 *    Copy-the-command would copy whatever sub-word the browser
 *    smart-selected, which is never what the user meant. Kinds whose
 *    entries don't collide with Copy append instead, so right-clicking an
 *    annotation inside a selection keeps Copy and Select All.
 *
 * @module lib/annotator/registry
 */

import type { TugAction } from "@/components/tugways/action-vocabulary";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { dispatchAction } from "@/action-dispatch";
import { openUrlInOS, revealDirectoryInFinder } from "@/lib/os-open";
import { openAttachmentPreview } from "@/lib/attachment-preview-open";

import type { CodeSessionStore } from "@/lib/code-session-store";
import type { AnnotationPayload } from "./payloads";
import type { AnnotationKind } from "./types";

/**
 * One context-menu item a kind contributes. Structurally the action-item
 * shape `TugEditorContextMenu` renders; the action stays typed against
 * the vocabulary so a misspelling is a compile error at the entry
 * definition rather than a dead dispatch at runtime ([L11]).
 */
export interface AnnotationMenuEntry {
  action: TugAction;
  label: string;
}

/**
 * What a registry handler is allowed to reach. Deliberately narrow: the
 * card-activation gesture as a thunk (the caller already knows which card
 * it is) and the session store a command seeds into. A kind that needs
 * more says so by widening this, which keeps the blast radius of a new
 * capability visible.
 */
export interface AnnotationDispatchContext {
  /** Bring the annotation's own card forward before acting on it. */
  activateCard: () => void;
  /** The composer/transcript store a command or snippet is seeded into. */
  codeSessionStore: CodeSessionStore;
}

/** The behavior registered for one annotation kind. */
export interface AnnotationKindEntry {
  /**
   * What a plain primary click does. Omitted when the DOM's own default
   * is already correct (anchors).
   */
  primaryClick?: (payload: AnnotationPayload, ctx: AnnotationDispatchContext) => void;
  /** Context-menu items offered for an annotation of this kind. */
  menuEntries: (payload: AnnotationPayload) => AnnotationMenuEntry[];
  /**
   * Whether a menu hit on this kind replaces the standard text-menu block
   * rather than appending below it.
   */
  suppressStandardItems: boolean;
}

const REGISTRY = new Map<AnnotationKind, AnnotationKindEntry>();

/** Register (or replace) the behavior for one annotation kind. */
export function registerAnnotationKind(
  kind: AnnotationKind,
  entry: AnnotationKindEntry,
): void {
  REGISTRY.set(kind, entry);
}

/** The behavior registered for `kind`, or `null` when none is. */
export function annotationEntryFor(
  kind: AnnotationKind,
): AnnotationKindEntry | null {
  return REGISTRY.get(kind) ?? null;
}

/**
 * Seed a command into the composer as a ready-to-run draft: bring the
 * card forward, then park the draft. A slash command seeds itself; a
 * shell command seeds into the Code route as a one-shot `/shell <cmd>`.
 */
function seedCommand(
  payload: AnnotationPayload,
  ctx: AnnotationDispatchContext,
): void {
  if (payload.kind === "slash-command") {
    ctx.activateCard();
    ctx.codeSessionStore.insertCommandDraft(payload.name, payload.args);
    return;
  }
  if (payload.kind === "shell-command") {
    ctx.activateCard();
    ctx.codeSessionStore.insertCommandDraft("shell", payload.command);
  }
}

/**
 * Send this annotation's value back into the conversation. Every kind
 * offers it — that is the point of having one vocabulary: whatever the
 * transcript mentions, the user can pick it up and talk about it.
 */
const INSERT_ENTRY: AnnotationMenuEntry = {
  action: TUG_ACTIONS.INSERT_INTO_COMPOSER,
  label: "Insert into Composer",
};

/** Copy / Copy as Plain Text — the pair both command families offer. */
const COMMAND_MENU_ENTRIES: AnnotationMenuEntry[] = [
  { action: TUG_ACTIONS.COPY_COMMAND, label: "Copy" },
  {
    action: TUG_ACTIONS.COPY_COMMAND_AS_PLAIN_TEXT,
    label: "Copy as Plain Text",
  },
  INSERT_ENTRY,
];

registerAnnotationKind("slash-command", {
  primaryClick: seedCommand,
  menuEntries: () => COMMAND_MENU_ENTRIES,
  suppressStandardItems: true,
});

registerAnnotationKind("shell-command", {
  primaryClick: seedCommand,
  menuEntries: () => COMMAND_MENU_ENTRIES,
  suppressStandardItems: true,
});

const URL_MENU_ENTRIES: AnnotationMenuEntry[] = [
  { action: TUG_ACTIONS.COPY_ANNOTATION_VALUE, label: "Copy Link" },
  INSERT_ENTRY,
];

const EMAIL_MENU_ENTRIES: AnnotationMenuEntry[] = [
  { action: TUG_ACTIONS.COPY_ANNOTATION_VALUE, label: "Copy Address" },
  INSERT_ENTRY,
];

const FILE_PATH_MENU_ENTRIES: AnnotationMenuEntry[] = [
  { action: TUG_ACTIONS.OPEN_FILE, label: "Open in Editor" },
  { action: TUG_ACTIONS.REVEAL_IN_FINDER, label: "Show in Finder" },
  { action: TUG_ACTIONS.COPY_ANNOTATION_VALUE, label: "Copy Path" },
  INSERT_ENTRY,
];

registerAnnotationKind("file-path", {
  // A cited range wins over a bare line, so a click on an edit's header
  // lands on (and flashes) exactly the lines that changed.
  primaryClick: (payload) => {
    if (payload.kind !== "file-path") return;
    const action: Record<string, unknown> = {
      action: TUG_ACTIONS.OPEN_FILE,
      path: payload.path,
    };
    if (payload.line !== undefined) action.line = payload.line;
    if (payload.endLine !== undefined) action.endLine = payload.endLine;
    dispatchAction(action);
  },
  menuEntries: () => FILE_PATH_MENU_ENTRIES,
  suppressStandardItems: false,
});

registerAnnotationKind("url", {
  // Only reached for a url annotation that is NOT an anchor — a link chip
  // the user attached. A real anchor navigates itself, and the host's
  // navigation delegate routes it to the browser; the delegated listener
  // leaves those alone rather than opening them twice.
  primaryClick: (payload) => {
    if (payload.kind !== "url") return;
    openUrlInOS(payload.url);
  },
  menuEntries: () => URL_MENU_ENTRIES,
  suppressStandardItems: false,
});

registerAnnotationKind("email", {
  menuEntries: () => EMAIL_MENU_ENTRIES,
  suppressStandardItems: false,
});

const DIRECTORY_MENU_ENTRIES: AnnotationMenuEntry[] = [
  { action: TUG_ACTIONS.REVEAL_IN_FINDER, label: "Show in Finder" },
  { action: TUG_ACTIONS.COPY_ANNOTATION_VALUE, label: "Copy Path" },
  INSERT_ENTRY,
];

registerAnnotationKind("directory", {
  // A directory has no editor to open into, so the click does what the
  // menu's first item does — the gesture and the menu agree, which is the
  // rule every other kind follows.
  primaryClick: (payload) => {
    if (payload.kind !== "directory") return;
    revealDirectoryInFinder(payload.path);
  },
  menuEntries: () => DIRECTORY_MENU_ENTRIES,
  suppressStandardItems: false,
});

const IMAGE_MENU_ENTRIES: AnnotationMenuEntry[] = [
  { action: TUG_ACTIONS.OPEN_IMAGE_PREVIEW, label: "Open Image" },
  { action: TUG_ACTIONS.COPY_ANNOTATION_VALUE, label: "Copy Name" },
  INSERT_ENTRY,
];

const COMMIT_SHA_MENU_ENTRIES: AnnotationMenuEntry[] = [
  { action: TUG_ACTIONS.OPEN_DIFF, label: "Open Diff" },
  { action: TUG_ACTIONS.COPY_ANNOTATION_VALUE, label: "Copy Sha" },
  INSERT_ENTRY,
];

registerAnnotationKind("commit-sha", {
  // The sha was verified by asking the repository which files the commit
  // touched, so the descriptor is already scoped to exactly those files —
  // the diff opens showing the commit, not the whole tree.
  primaryClick: (payload) => {
    if (payload.kind !== "commit-sha") return;
    dispatchAction({
      action: TUG_ACTIONS.OPEN_DIFF,
      descriptor: {
        kind: "commit",
        root: payload.root,
        sha: payload.sha,
        paths: payload.paths,
      },
    });
  },
  menuEntries: () => COMMIT_SHA_MENU_ENTRIES,
  suppressStandardItems: false,
});

registerAnnotationKind("image", {
  // A pasted image is bytes under an id, with no file to open — the strip
  // that holds those bytes owns the only full-size view of it.
  primaryClick: (payload) => {
    if (payload.kind !== "image") return;
    openAttachmentPreview(payload.atomId);
  },
  menuEntries: () => IMAGE_MENU_ENTRIES,
  suppressStandardItems: false,
});
