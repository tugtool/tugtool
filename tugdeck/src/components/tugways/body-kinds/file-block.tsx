/**
 * `FileBlock` — Layer-1 body kind for read-only file viewing.
 *
 * A thin chrome around `TugCodeView`. FileBlock owns the framed look
 * (header strip with path / language pill / line counts / `Search` and
 * `Collapse` icon buttons), the long-file collapse-by-default behavior,
 * the embedded-mode variant for `ReadToolBlock` composition, and
 * nothing else. The CM6 substrate that actually renders the file
 * lives in `TugCodeView`; the bespoke per-line renderer that this
 * file used to ship was retired because it reimplemented features
 * the project already owns through `tug-text-editor`'s CM6
 * integration — and reimplemented them badly (per-line scrollbars,
 * stale search overlay, parallel-engine drift).
 *
 * Composition:
 *  - Header (chrome strip) — `path basename` + optional language pill
 *    + "N lines" / "Showing N of M lines" counts + a trailing
 *    affordances area (fold cue + `Search` `<TugIconButton>`). Hidden
 *    when `embedded=true` because the host wrapper (e.g.
 *    `ToolWrapperChrome`) owns identity in those cases; the affordances
 *    portal into the host's actions slot instead so they survive into
 *    the embedded composition.
 *  - Fold cue — a chevron `<button>` rendered whenever the file is
 *    `overThreshold`, in both states. Icon + label swap by state
 *    (chevron-down + "N lines folded" vs chevron-up icon-only). This
 *    is the persistent toggle handle: embedded-mode hosts hide the
 *    header, so the cue must also portal into the host's actions slot
 *    or the user could expand but not collapse back.
 *  - Find row — `<TugBlockFindRow>` mounted with `.tugx-file-find`
 *    appended to its root (the FileBlock-side className binds the
 *    row's `--tugx-block-find-top` to the local sticky-stack
 *    composition). The row mounts only while `findSession.state.open`
 *    is true; sticky beneath the chrome / identity header. State,
 *    focus discipline, reload-survival slot, and the
 *    `data-tug-focus-key` axis live in `useBlockFindSession`
 *    (a consumer of the framework focus axis per [D95]).
 *  - Body — `<TugCodeView>` (expanded) or nothing (collapsed). CM6
 *    isn't mounted while collapsed so a huge file doesn't pay the
 *    mount cost until the user reveals it.
 *
 * Long-file collapse:
 *  - Lines above `collapseThreshold` (default 80, per audit §5.1) fold
 *    by default. The fold cue invites the user to reveal. The
 *    threshold is visual policy; the audit measured Read P50 at 50
 *    lines, so the 80-line threshold catches the upper ~40% — long
 *    enough to scan-or-skip, short enough not to fold the average
 *    file.
 *  - The toggle dispatches a bubbling `tug-disengage-follow-bottom`
 *    `CustomEvent` *before* the React state update. A host like
 *    `TugListView` listens on its scroll container and calls
 *    `SmartScroll.disengageFollowBottom()`, so the ResizeObserver
 *    flush triggered by the cell-height change does not call
 *    `pinToBottom` (the post-commit pin effect bails on
 *    `!isFollowingBottom`). Without this, expanding a file inside a
 *    `followBottom` list scrolls the cue off-screen — violating
 *    "interacting with a control does not move that control out of
 *    view."
 *
 * Embedded mode:
 *  - `embedded=true` drops the standalone frame (background, border,
 *    radius, outer margin) and the header strip. The host wrapper
 *    owns identity and affordances. CM6 still renders the body, so
 *    the embedded host gets line wrapping + selection + a find UI
 *    for free.
 *
 * What this body kind does NOT do (and never will):
 *  - Render text with a bespoke DOM tree. CM6 is the canonical text
 *    engine for any file-based content (`tuglaws/component-authoring.md`
 *    §Text content); FileBlock composes the substrate, not bytes.
 *  - Implement its own find / Cmd-F bar. The substrate ships
 *    `@codemirror/search`; the header's `Search` button opens that
 *    panel via the viewer delegate.
 *  - Implement click-line-to-copy. CM6's native selection + Cmd-C
 *    handles region copy more naturally and consistently across the
 *    rest of the codebase. (The bespoke per-line click gesture used
 *    to exist; it has been retired with the rest of the bespoke
 *    renderer.)
 *  - Implement syntax highlighting. The substrate is wired today
 *    with the prop, and a follow-up step bridges Shiki (or a
 *    Lezer-based grammar) into CM6 decorations without changing
 *    this file's API.
 *
 * Laws:
 *  - [L06] all FileBlock-visible state (collapse) lives in React
 *    state because it controls *what* is rendered (one of two
 *    branches), not *how* a rendered element looks. The substrate's
 *    own appearance state lives in CM6 per its module docstring.
 *  - [L11] FileBlock owns the find session via `useBlockFindSession`
 *    and the codeViewRef delegate, and is therefore the responder for
 *    `FIND`, `FIND_NEXT`, and `FIND_PREVIOUS`. The session's action
 *    map is spread into FileBlock's responder so each Cmd-F / Cmd-G /
 *    Shift-Cmd-G keystroke arrives via the static keybinding map →
 *    responder-chain dispatch; no document-level listeners.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="file-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns the `--tugx-file-*`
 *    slot family; consumes `--tugx-block-*` directly for the shared
 *    block-surface scaffold. Position-coordination tokens
 *    (`--tugx-pin-stack-top`, `--tugx-toolblock-header-height`) are
 *    read but never overridden, per the L20 carve-out documented in
 *    `tuglaws/component-authoring.md`.
 *
 * Decisions:
 *  - [D05] two-layer split: body kind (this file) vs. tool wrapper
 *    (`read-tool-block.tsx`).
 *  - CM6 is the canonical engine for file-based text content
 *    (`tuglaws/component-authoring.md` §Text content).
 *
 * @module components/tugways/body-kinds/file-block
 */

import "./file-block.css";

import React from "react";
import { createPortal } from "react-dom";
import type { SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { useOptionalResponder } from "@/components/tugways/use-responder";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import {
  TugCodeView,
  type TugCodeViewDelegate,
} from "@/components/tugways/tug-code-view";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-wrappers/tool-wrapper-chrome";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { attachOuterScrollOnModifierWheel } from "@/components/tugways/internal/use-outer-scroll-on-modifier-wheel";
import { useBlockFindSession } from "@/components/tugways/internal/use-block-find-session";
import { TugBlockFindRow } from "@/components/tugways/internal/tug-block-find-row";
import {
  useComponentStatePreservation,
  useSavedComponentState,
  useSavedRegionScroll,
} from "@/components/tugways/use-component-state-preservation";
import {
  BlockCopyButton,
  BlockFindButton,
  BlockFoldCue,
} from "./affordances";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured file-view data — the body's render input.
 *
 * `content` is the literal text of the (possibly windowed) file
 * region the producer wants to show. `startLine` (1-based) and
 * `numLines` describe what region of the source file this content
 * came from; `totalLines` (when known) drives the "Showing N of M"
 * header. All three are optional because they aren't always
 * meaningful (e.g., a generated paste has no source-file extent).
 */
export interface FileData {
  /**
   * Source path, used for language detection and the (consumer-owned)
   * header label. May be empty — "" disables both.
   */
  filePath: string;

  /** File contents to render, as a single newline-separated string. */
  content: string;

  /**
   * 1-based line number of the first line of `content`. Reserved for
   * future use by the substrate (e.g. seeding `lineNumbers()`'s
   * starting index). Defaults to 1.
   */
  startLine?: number;

  /**
   * Number of lines this view actually shows. When omitted, computed
   * from `content`. Mostly redundant with the parsed line count, but
   * useful when the producer knows the count up front (e.g., a Read
   * with `limit` set).
   */
  numLines?: number;

  /**
   * Total lines in the source file (not just the rendered window).
   * Drives the "Showing N of M lines" header. When equal to or less
   * than `numLines`, the header simplifies to "N lines" — a partial
   * window is the only case where M is interesting.
   */
  totalLines?: number;
}

export interface FileBlockProps {
  /**
   * The file data to render. When undefined, the block renders
   * nothing visible (empty `data-slot="file-body"` for layout
   * consistency).
   */
  data?: FileData;

  /**
   * Initial collapse state ([Spec S02]). When undefined, the
   * component picks the default from `collapseThreshold`: collapsed
   * if the line count exceeds the threshold, expanded otherwise.
   */
  collapsed?: boolean;

  /**
   * Notification callback fired when the user toggles the collapsed
   * state. Stateless when omitted (the component still tracks local
   * state internally — this is uncontrolled mode).
   */
  onToggleCollapsed?: (next: boolean) => void;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;

  /**
   * Threshold for default-folded behavior. Defaults to
   * `DEFAULT_COLLAPSE_THRESHOLD` (80, per audit §5.1). Files at or
   * below this many lines render expanded by default; files above it
   * fold by default.
   */
  collapseThreshold?: number;

  /**
   * Opt-in key for the [A9] Component State Preservation Protocol.
   * When set, FileBlock persists its uncontrolled `collapsed` flag
   * into `bag.components` so a Developer > Reload restores the fold.
   *
   * The CM6 inner scroller's `scrollTop` is persisted independently
   * via the [A9] region-scroll axis — FileBlock writes
   * `data-tug-scroll-key={componentStatePreservationKey}/file-scroll`
   * onto `view.scrollDOM` so CardHost's region-scroll capture/restore
   * loop picks it up. The two axes are split deliberately: fold is
   * React-state (component-owned, not DOM-authority); inner scroll is
   * DOM-authority (the scrollTop lives on the scroll element).
   *
   * Undefined opts out of both axes (gallery, standalone).
   */
  componentStatePreservationKey?: string;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolWrapperChrome` in
   * `ReadToolBlock`). When `true`:
   *
   *   - The standalone frame (background / border / radius / outer
   *     margin) is dropped so the body sits flush with the host.
   *   - FileBlock's own header (basename + lang badge + line counts)
   *     is hidden — the wrapper owns the file's identity in its own
   *     header.
   *   - The resting affordances (fold cue, Search trigger) portal
   *     into the host's chrome actions slot via
   *     `ChromeActionsTargetContext`. This is the load-bearing
   *     contract: `embedded={true}` MUST be used under a
   *     `ToolWrapperChrome` so the affordances have somewhere to
   *     surface. Using `embedded={true}` outside a chrome is
   *     unsupported — the affordances have no host and the user
   *     loses access to Search and the fold toggle.
   *
   * Default `false` — standalone usage (gallery, RenderInput-routed)
   * keeps its frame and header.
   *
   * @default false
   */
  embedded?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default-collapse threshold in lines. 80 per the session-audit
 * §5.1: Read P50 = 50 so the previous threshold of 50 folded half of
 * every file by default — too aggressive. 80 lines catches the upper
 * ~40% — long enough to scan-or-skip, short enough not to fold the
 * average file.
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 80;

const DATA_SLOT_ROOT = "file-body";
const DATA_SLOT_HEADER = "file-header";

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/**
 * Map filename extension → language identifier. Covers the common
 * languages used in `tugcode` sessions. Returns `undefined` when the
 * extension is unknown — the substrate then renders plain monospace,
 * which per audit §5.4 is the dominant case anyway (84% of fenced
 * blocks have no language).
 *
 * The identifiers match Shiki's vocabulary (kept so the future
 * Shiki-via-CM6 bridge can map directly), and a forward subset
 * matches Lezer's grammar names.
 */
const EXT_TO_LANG: Readonly<Record<string, string>> = Object.freeze({
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  fs: "fsharp",
  ml: "ocaml",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  cljs: "clojure",
  scala: "scala",
  groovy: "groovy",
  lua: "lua",
  php: "php",
  pl: "perl",
  pm: "perl",
  r: "r",
  jl: "julia",
  zig: "zig",
  v: "v",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "shellscript",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  sql: "sql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  proto: "proto",
  graphql: "graphql",
  gql: "graphql",
  tex: "latex",
  diff: "diff",
  patch: "diff",
});

/**
 * Detect the language identifier for a file path, by extension.
 * Returns `undefined` when the extension is unknown.
 *
 * Special-cases bare filenames whose name is itself the language hint
 * (`Dockerfile`, `Makefile`) since they have no extension.
 */
export function detectLanguage(filePath: string): string | undefined {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (base === "") return undefined;
  if (base === "Dockerfile") return "dockerfile";
  if (base === "Makefile" || base === "makefile") return "makefile";

  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext];
}

/**
 * Split content into an array of lines. The trailing newline (if
 * present) does NOT produce a final empty line — the editor
 * convention. An empty string returns `[]`.
 */
export function splitContentLines(content: string): string[] {
  if (content.length === 0) return [];
  const parts = content.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Compose the "Showing N of M lines" header label.
 *  - When `totalLines` is unknown or equals `numLines`, returns
 *    "N lines".
 *  - When `totalLines > numLines`, returns "Showing N of M lines".
 */
export function composeLineCountLabel(
  numLines: number,
  totalLines: number | undefined,
): string {
  if (totalLines === undefined || totalLines <= numLines) {
    return `${numLines} ${numLines === 1 ? "line" : "lines"}`;
  }
  return `Showing ${numLines} of ${totalLines} lines`;
}

/** Last segment of a path, with leading "/" stripped. Empty input → "". */
export function basename(filePath: string): string {
  if (filePath.length === 0) return "";
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export const FileBlock: React.FC<FileBlockProps> = ({
  data,
  collapsed: collapsedProp,
  onToggleCollapsed,
  className,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  embedded = false,
  componentStatePreservationKey,
}) => {
  // Derived display state — line count + language detection drive
  // the header label and the collapse default.
  const lines = React.useMemo(
    () => (data === undefined ? [] : splitContentLines(data.content)),
    [data?.content],
  );
  const language = React.useMemo(
    () => (data === undefined ? undefined : detectLanguage(data.filePath)),
    [data?.filePath],
  );
  const numLines = data?.numLines ?? lines.length;
  const headerLabel = composeLineCountLabel(numLines, data?.totalLines);

  const overThreshold = lines.length > collapseThreshold;

  // Computed-value collapse pattern. Mirrors the existing `viewMode`
  // resolution in DiffBlock: the parent's prop wins when provided,
  // local state covers the uncontrolled case. No `useEffect` syncs a
  // prop into state — that pattern would create a "controlled prop
  // says X, local state says Y" divergence after a click in
  // uncontrolled mode. Reading the prop directly on every render keeps
  // controlled and uncontrolled cleanly separable.
  //
  // Mount-in-saved-state: the saved fold (if any) seeds `useState`'s
  // initializer so the first paint reflects the user's last-saved
  // state. See `tuglaws/state-preservation.md` → "Restoring saved
  // state at mount".
  const savedComponentState = useSavedComponentState<{ collapsed?: boolean }>(
    componentStatePreservationKey,
  );
  const [localCollapsed, setLocalCollapsed] = React.useState<boolean>(
    () =>
      typeof savedComponentState?.collapsed === "boolean"
        ? savedComponentState.collapsed
        : overThreshold,
  );
  const collapsed = collapsedProp !== undefined ? collapsedProp : localCollapsed;

  // Root ref — used to dispatch the disengage-follow-bottom event so
  // the host (e.g. `TugListView`) releases its auto-pin lock before
  // the cell height change. Without that, the user clicks "expand",
  // the cell grows, `ResizeObserver` requests a bottom pin, and the
  // click target scrolls off-screen — violating "interacting with a
  // control does not move that control out of view."
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Header ref — used by the telescoping-pin ResizeObserver below to
  // write the visible header's measured height into
  // `--tugx-file-header-height` on the root so the find row can pin
  // BELOW the identity header in standalone mode. Null when
  // `embedded={true}` (no header rendered — affordances portal into
  // the host's chrome instead).
  const headerRef = React.useRef<HTMLDivElement | null>(null);

  // Telescoping pin — write the live measured identity-header height
  // into `--tugx-file-header-height` on the root so the find row can
  // pin at `top: calc(var(--tugx-pin-stack-top, 0px)
  //          + var(--tugx-toolblock-header-height, 0px)
  //          + var(--tugx-file-header-height, 0px))`.
  // In embedded mode the header isn't rendered, so the ref is null
  // and the variable stays unset (`0px` via the `calc()` fallback) —
  // the find row then telescopes under the chrome's
  // `--tugx-toolblock-header-height` only.
  //
  // [L03] `useLayoutEffect` so the variable is set before paint —
  // first sticky pass uses the correct offset rather than a value
  // one frame late.
  // [L06] DOM write, never React state.
  // [L20] FileBlock owns `--tugx-file-*` (this is in that family);
  // the chrome's `--tugx-toolblock-header-height` is read but never
  // written from here.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (root === null) return;
    if (header === null) {
      // Embedded mode (or empty data) — clear any stale value so
      // the calc() fallback to 0 takes effect.
      root.style.removeProperty("--tugx-file-header-height");
      return;
    }
    const write = (px: number): void => {
      root.style.setProperty("--tugx-file-header-height", `${px}px`);
    };
    write(header.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const boxes = entry.borderBoxSize;
      const next =
        boxes !== undefined && boxes.length > 0
          ? boxes[0].blockSize
          : entry.contentRect.height;
      write(next);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, [embedded, data === undefined]);

  // Chrome actions target — non-null when this FileBlock is composed
  // inside a `ToolWrapperChrome` that has rendered its actions slot.
  // The resting affordance row lives INSIDE the chrome / identity
  // header rather than rendering as a separate sticky strip beneath.
  // When the target is present (embedded composition),
  // the affordance node portals into it; when absent (standalone),
  // affordances render inside `.tugx-file-header` directly. The body
  // kind never depends on this being non-null — `embedded={false}` and
  // a missing chrome both fall through to the inline-in-header path.
  const chromeActionsTarget = useChromeActionsTarget();

  // Dev-mode misconfiguration check — `embedded={true}` is a contract
  // that the body kind sits inside a `ToolWrapperChrome` so resting
  // affordances have a portal target. If `embedded` is set but no
  // chrome is above us, the affordances vanish silently: the
  // identity header is suppressed AND the portal target is `null`,
  // so the fold cue / Find trigger never appear. The user notices
  // a missing button; the author doesn't notice the misconfiguration.
  // Surface it at mount so it fails loud in dev and stays free in
  // production (the early-return tree-shakes when `NODE_ENV` is
  // statically `"production"`).
  //
  // The check is deferred one tick because `ToolWrapperChrome`
  // publishes its `actionsTarget` via a `useState`-tracked ref
  // callback. On the body kind's FIRST render under a chrome, the
  // chrome's ref hasn't fired yet, so the context value is still
  // `null`. A naive synchronous warn would fire even in the legal
  // composition. The setTimeout defers past React's reconciliation;
  // if the target becomes non-null on the next render, the effect's
  // cleanup cancels the pending warn before it fires.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!embedded) return;
    if (chromeActionsTarget !== null) return;
    const handle = window.setTimeout(() => {
      console.warn(
        "FileBlock: `embedded={true}` requires a parent `ToolWrapperChrome`. " +
          "Without one, the body kind's identity header is suppressed AND its " +
          "affordances (fold cue, Find trigger) have nowhere to portal — the " +
          "user loses access to them silently. Either compose under a chrome " +
          "or set `embedded={false}`.",
      );
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [embedded, chromeActionsTarget]);

  // Stable id for FileBlock's own responder — declared up here so the
  // find form below can register as its child (see `parentId` below)
  // and so the `toggleCollapsed` callback can promote FileBlock to
  // first-responder after the user clicks a focus-refusing
  // affordance. Sibling hook calls in the same component all read the
  // same outer `ResponderParentContext` value at hook-call time, so
  // without the explicit parentId the find form would register as a
  // SIBLING of fileBlockResponder, not a child. Chain walks from the
  // find input would then skip past fileBlockResponder entirely and
  // Cmd-G / Shift-Cmd-G would not reach the FIND_NEXT / FIND_PREVIOUS
  // handlers.
  const fileBlockResponderId = React.useId();

  // Chain manager — used to programmatically promote
  // `fileBlockResponder` to first-responder after the user clicks one
  // of the in-block focus-refusing affordances (fold cue, Find
  // button). Those buttons carry `data-tug-focus="refuse"`, so the
  // chain provider's pointerdown listener skips chain promotion
  // entirely on their clicks — correct for buttons in outer chrome
  // (no focus theft from active editors), but leaves first-responder
  // pointing at wherever it was BEFORE the user touched the block.
  // Cmd-F afterward then walks from a stale responder and misses
  // our FIND handler. Promoting `fileBlockResponder` after the toggle
  // lands keystrokes on the block the user is clearly interacting
  // with. The manager is `null` outside a `ResponderChainProvider`
  // (gallery cards, unit tests); the promote calls below short-
  // circuit via `?.`.
  const chainManager = useResponderChain();

  // Position-stable click is now encapsulated inside each affordance
  // (BlockCopyButton, BlockFindButton, BlockFoldCue) — they each
  // call `useOuterScrollport` + `usePositionStableClick` internally
  // against their own button refs. The fold cue's combination with
  // the scrollport-level `tailSpacer` (wired by tide-card-transcript)
  // still applies: the spacer raises `maxScrollTop` so a collapse
  // doesn't hit a hard clamp, and the position-stable hook inside
  // BlockFoldCue writes the exact `scrollTop` that holds the
  // cluster under the user's cursor across the height change.

  // Fold-cue toggle callback. The `BlockFoldCue` affordance already
  // dispatched the `tug-disengage-follow-bottom` event before
  // invoking this; this callback owns the block-specific concerns:
  //  - First-responder promotion (the cue carries
  //    `data-tug-focus="refuse"`, so the chain provider's
  //    pointerdown skipped chain promotion on its own — promote
  //    explicitly so Cmd-F afterward walks from FileBlock and
  //    reaches its FIND handler).
  //  - State mutation (controlled vs uncontrolled).
  //  - Host notification (`onToggleCollapsed`).
  const handleFoldToggle = React.useCallback((next: boolean) => {
    chainManager?.makeFirstResponder(fileBlockResponderId);
    if (collapsedProp === undefined) {
      setLocalCollapsed(next);
    }
    onToggleCollapsed?.(next);
  }, [chainManager, collapsedProp, fileBlockResponderId, onToggleCollapsed]);

  // Ref to the embedded TugCodeView so the Find UI can drive the
  // substrate's search state imperatively (set-query / next /
  // previous / select-all).
  const codeViewRef = React.useRef<TugCodeViewDelegate | null>(null);

  // ---- Component-state preservation (fold state only) -----------------
  //
  // Persist the uncontrolled `collapsed` flag through the [A9] component-
  // state-preservation axis so Developer > Reload (and cross-pane mount
  // paths that route through CardHost) restore the fold. CM6 inner scroll
  // position is preserved separately, via the [A9] region-scroll axis —
  // a `data-tug-scroll-key` attribute on `view.scrollDOM` lands in
  // `bag.regionScroll`, restored by CardHost's MutationObserver loop on
  // mount. The two axes are deliberately split: fold is React-state
  // (component-owned, not DOM-authority), inner scroll is DOM-authority
  // (the scrollTop lives on the scroll element).
  //
  useComponentStatePreservation<{ collapsed?: boolean }>({
    componentStatePreservationKey,
    captureState: () => ({ collapsed }),
  });

  // ---- Cmd/Ctrl-wheel routing to the outer scrollport ----------------
  //
  // CM6's `.cm-scroller` captures wheel events when the cursor is
  // over the file viewer. For a user skimming a long transcript, the
  // inner capture stutters the outer scroll. Holding Cmd/Ctrl while
  // wheeling forwards the delta straight to the outer card
  // scrollport. The hook attaches its non-passive capture-phase
  // listener; `useLayoutEffect` keys on `collapsed` so the listener
  // re-attaches whenever the CM6 view mounts/unmounts (the view
  // disappears entirely when collapsed).
  //
  // We attach imperatively (not via the `useOuterScrollOnModifierWheel`
  // hook) because the inner scroller — CM6's `.cm-scroller` — is the
  // CM6 EditorView's internal `scrollDOM`, not a React-tracked
  // element. We resolve it through the delegate at mount time and
  // bundle the detach into the effect's cleanup.
  const outerScrollport = useOuterScrollport();
  const outerScrollportRef = React.useRef<HTMLElement | null>(outerScrollport);
  React.useLayoutEffect(() => {
    outerScrollportRef.current = outerScrollport;
  }, [outerScrollport]);
  React.useLayoutEffect(() => {
    if (collapsed) return;
    const delegate = codeViewRef.current;
    if (delegate === null) return;
    const view = delegate.view();
    if (view === null) return;
    return attachOuterScrollOnModifierWheel(
      view.scrollDOM,
      () => outerScrollportRef.current,
    );
  }, [collapsed]);

  // ---- Outer scroll-into-view for find matches -----------------------
  //
  // `TugCodeView` consumes every CM6 `scrollIntoView` request (the
  // viewer is sized to its content, so the inner `.cm-scroller` has
  // nothing to scroll). This callback runs in the consume path and
  // scrolls the OUTER transcript scrollport so the match lands in the
  // unobstructed viewport BELOW the stacked sticky chrome (transcript
  // entry header → toolblock chrome → file header → find row).
  //
  // Sticky chrome height is read from:
  //   - `--tugx-pin-stack-top` (transcript entry header)
  //   - `--tugx-toolblock-header-height` (embedded chrome wrapper)
  //   - `.tugx-file-header` (rendered height; suppressed in embedded
  //     mode where the variable above accounts for it)
  //   - `.tugx-file-find` (rendered height; present only while the
  //     find row is open)
  //
  // The scrollport is mutated directly per [L06] — scroll position is
  // DOM authority, not React state. The SmartScroll state machine
  // listens for the resulting `scroll` event and ticks through its
  // normal phases.
  const handleScrollMatchIntoView = React.useCallback(
    (view: EditorView, range: SelectionRange) => {
      const scrollport = outerScrollportRef.current;
      const root = rootRef.current;
      if (scrollport === null || root === null) return;

      // Use `lineBlockAt` + `contentDOM.getBoundingClientRect()` rather
      // than `view.coordsAtPos`. The latter walks the rendered DOM and
      // returns `null` for positions outside CM6's current viewport —
      // exactly the case we care about (the target is OFFSCREEN, that's
      // why we need to scroll). The height map underneath `lineBlockAt`
      // always covers the full document, so we get the line's
      // cm-content-relative offset whether or not the line is currently
      // rendered. Combined with the live `contentDOM` rect, that gives
      // a viewport-relative band for the target line.
      const block = view.lineBlockAt(range.head);
      const contentRect = view.contentDOM.getBoundingClientRect();
      const matchTop = contentRect.top + block.top;
      const matchBottom = contentRect.top + block.bottom;

      const outerRect = scrollport.getBoundingClientRect();

      // Stacked sticky chrome above the file body. Variables are
      // read from the file root because that's where the telescoping-
      // pin writer (further down this file) and the outer pin context
      // both stamp their measured heights.
      const rootStyle = getComputedStyle(root);
      const parsePx = (name: string): number => {
        const raw = rootStyle.getPropertyValue(name).trim();
        if (raw === "") return 0;
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : 0;
      };
      let stickyTop = parsePx("--tugx-pin-stack-top");
      stickyTop += parsePx("--tugx-toolblock-header-height");

      const headerEl = root.querySelector<HTMLElement>(".tugx-file-header");
      if (headerEl !== null && headerEl.offsetParent !== null) {
        stickyTop += headerEl.getBoundingClientRect().height;
      }
      const findEl = root.querySelector<HTMLElement>(".tugx-file-find");
      if (findEl !== null) {
        stickyTop += findEl.getBoundingClientRect().height;
      }

      const yMargin = 8;
      const visibleTop = outerRect.top + stickyTop;
      const visibleBottom = outerRect.bottom;

      let delta = 0;
      if (matchTop < visibleTop + yMargin) {
        delta = matchTop - (visibleTop + yMargin);
      } else if (matchBottom > visibleBottom - yMargin) {
        delta = matchBottom - (visibleBottom - yMargin);
      }
      if (delta === 0) return;

      const max = scrollport.scrollHeight - scrollport.clientHeight;
      const next = Math.max(0, Math.min(max, scrollport.scrollTop + delta));
      scrollport.scrollTop = next;
    },
    [],
  );

  // ---- [A9] region-scroll axis: CM6 inner scrollport ------------------
  //
  // Stamp `data-tug-scroll-key={key}/file-scroll` onto CM6's
  // `view.scrollDOM` whenever the view is mounted. CardHost's
  // `captureRegionScrolls` walks all `[data-tug-scroll-key]` elements
  // in the card subtree on every capture moment ([A9] save).
  //
  // Mount-in-saved-state. Two write paths:
  //
  //  - **Line-relative restore (preferred).** When the saved bag
  //    carries `meta.line = { number, offsetPx }` (the writer
  //    effect below serializes this on every commit), the first
  //    mount of CM6's view computes
  //    `lineBlockAtPos(state.doc.line(number).from).top + offsetPx`
  //    and writes that as `scrollDOM.scrollTop`. Content-anchored,
  //    so a brief font-load reflow leaves the *same line* at the
  //    viewport top — sub-pixel font-metric drift is the worst
  //    case.
  //
  //  - **Pixel fallback.** When the bag has no `meta.line` (legacy
  //    sessions, or future tools whose scroll state is too granular
  //    for a line anchor), the raw saved `y` is written directly.
  //
  // The `initialFileScrollConsumedRef` one-shot keeps the write
  // tied to the FIRST mount per CM6 view instance. A later
  // collapse→expand cycle remounts the view; the new instance's
  // ref is fresh and the saved value applies again (correct: the
  // user wants to land back at the same place after expanding).
  // The element-identity-gated MutationObserver pass in
  // `card-host.tsx` covers any later scroller-rebuild path; the
  // saved value flows from `bag.regionScroll[key].y` either way.
  const fileScrollKey =
    componentStatePreservationKey === undefined
      ? undefined
      : `${componentStatePreservationKey}/file-scroll`;
  const savedFileScroll = useSavedRegionScroll(fileScrollKey);
  const savedFileScrollYRef = React.useRef<number | undefined>(
    savedFileScroll?.y,
  );
  // Snapshot the saved line at component mount so the write below
  // sees a stable value even if a later save updates the bag while
  // the component is still mid-mount.
  const savedFileLineRef = React.useRef<
    { number: number; offsetPx: number } | undefined
  >(undefined);
  if (savedFileLineRef.current === undefined) {
    const meta = savedFileScroll?.meta;
    if (meta !== null && typeof meta === "object") {
      const line = (meta as { line?: unknown }).line;
      if (line !== null && typeof line === "object" && "number" in line && "offsetPx" in line) {
        const ln = (line as { number: unknown }).number;
        const off = (line as { offsetPx: unknown }).offsetPx;
        if (
          typeof ln === "number" &&
          typeof off === "number" &&
          Number.isFinite(ln) &&
          Number.isFinite(off)
        ) {
          savedFileLineRef.current = {
            number: Math.max(1, Math.floor(ln)),
            offsetPx: off,
          };
        }
      }
    }
  }
  const initialFileScrollConsumedRef = React.useRef(false);
  React.useLayoutEffect(() => {
    if (collapsed) return;
    if (fileScrollKey === undefined) return;
    const delegate = codeViewRef.current;
    if (delegate === null) return;
    const view = delegate.view();
    if (view === null) return;
    const scrollDOM = view.scrollDOM;
    scrollDOM.setAttribute("data-tug-scroll-key", fileScrollKey);
    if (!initialFileScrollConsumedRef.current) {
      initialFileScrollConsumedRef.current = true;
      // Prefer the line-relative payload when present — it survives
      // font-load reflow because the right LINE shows up at the
      // viewport top regardless of how the font metric resolves.
      const savedLine = savedFileLineRef.current;
      if (
        savedLine !== undefined &&
        savedLine.number >= 1 &&
        savedLine.number <= view.state.doc.lines
      ) {
        const linePos = view.state.doc.line(savedLine.number).from;
        const block = view.lineBlockAt(linePos);
        scrollDOM.scrollTop = Math.max(0, block.top + savedLine.offsetPx);
      } else {
        // Pixel fallback (legacy bags, or no line meta).
        const y = savedFileScrollYRef.current;
        if (typeof y === "number" && y > 0) {
          scrollDOM.scrollTop = y;
        }
      }
    }

    // Line-relative writer. On every scroll, serialize the
    // current viewport-top line + intra-line pixel offset onto
    // `data-tug-scroll-state`. `captureRegionScrolls` reads the
    // attribute at every save trigger; the next cold-boot uses
    // `meta.line` for line-anchored restore — robust to font-load
    // reflow because the saved LINE is what we restore to, not a
    // pixel position that depends on font metrics.
    //
    // `scrollHeight` ride-along is a validation field; documented
    // in `layout-tree.ts`'s schema prose. Not consumed at restore.
    //
    // `lineBlockAtHeight` reads CM6's measured layout. If the
    // measurement plugin has not run yet the call throws; we swallow
    // defensively so the attribute write is optional rather than a
    // render-blocking dependency.
    const writeScrollState = (): void => {
      try {
        const top = scrollDOM.scrollTop;
        const block = view.lineBlockAtHeight(top);
        const lineInfo = view.state.doc.lineAt(block.from);
        const offsetPx = Math.max(0, top - block.top);
        const meta = {
          line: { number: lineInfo.number, offsetPx },
          scrollHeight: scrollDOM.scrollHeight,
        };
        scrollDOM.setAttribute("data-tug-scroll-state", JSON.stringify(meta));
      } catch {
        // CM6 layout not measured yet (typically test-env). The
        // next real scroll event re-fires this; production paths
        // settle quickly.
      }
    };
    writeScrollState();
    scrollDOM.addEventListener("scroll", writeScrollState, { passive: true });
    return () => {
      scrollDOM.removeEventListener("scroll", writeScrollState);
      scrollDOM.removeAttribute("data-tug-scroll-key");
      scrollDOM.removeAttribute("data-tug-scroll-state");
    };
  }, [collapsed, fileScrollKey]);

  // ---- Copy text source -----------------------------------------------
  //
  // `fileTextRef` carries the live file content so the
  // `BlockCopyButton`'s `getText` closure reads the freshest string
  // at fire time. The ref is written in a `useLayoutEffect` so a
  // click in the same frame as a `data.content` prop change sees
  // the new content ([L07]). The affordance owns the rest of the
  // Copy contract (confirmation flash, timer cleanup, clipboard
  // call, width-stabilize) — see `affordances/block-copy-button.tsx`.
  const fileTextRef = React.useRef<string>(data?.content ?? "");
  React.useLayoutEffect(() => {
    fileTextRef.current = data?.content ?? "";
  }, [data?.content]);
  const getFileText = React.useCallback(() => fileTextRef.current, []);

  // ---- Find UI session ----------------------------------------------------
  //
  // Single source for the find-row state machine, focus discipline,
  // reload-survival slot, and `data-tug-focus-key` composition. The hook
  // (consumer of the framework focus axis per [D95]) owns the row's
  // internal lifecycle; FileBlock contributes the CM6-specific glue:
  // pre-open work (uncollapse + disengage-follow-bottom + first-responder
  // promotion) and the substrate query push / navigation calls.
  const findSession = useBlockFindSession({
    scope: "file-block-find",
    componentStatePreservationKey,
    parentResponderId: fileBlockResponderId,
    navigation: {
      findNext: () => codeViewRef.current?.findNext(),
      findPrevious: () => codeViewRef.current?.findPrevious(),
      clearSearch: () => codeViewRef.current?.clearSearch(),
    },
    onBeforeOpen: () => {
      if (collapsed) {
        // Reveal the body so the substrate is mounted and the search
        // state has somewhere to apply. Disengage the host list's
        // bottom-pin in the same beat (mirrors `toggleCollapsed`).
        rootRef.current?.dispatchEvent(
          new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
        );
        if (collapsedProp === undefined) {
          setLocalCollapsed(false);
        }
        onToggleCollapsed?.(false);
      }
      // Promote FileBlock to first-responder. The Search button (when
      // invoked by click) carries `data-tug-focus="refuse"`, so the
      // chain provider's pointerdown skipped chain promotion. Promoting
      // here guarantees Cmd-F dispatches arriving while the chain is
      // still settling find their way home. Idempotent if we already
      // own first-responder.
      chainManager?.makeFirstResponder(fileBlockResponderId);
    },
  });

  // Push query + options to CM6 whenever the user types or toggles an
  // option, then read back the live match count so the row's count
  // display reflects the current query. Empty query is a valid state —
  // CM6 clears highlights when it sees an empty search string, and
  // `getMatchCount` returns 0 for invalid queries.
  //
  // `useLayoutEffect` so the match-highlight repaint lands in the same
  // paint as the input update. With `useEffect` the effect would run
  // AFTER the browser paints, producing a one-frame lag.
  const {
    open: findOpen,
    query: findQuery,
    caseSensitive: findCaseSensitive,
    regexp: findRegexp,
    wholeWord: findWholeWord,
  } = findSession.state;
  const { setMatchCount: setFindMatchCount } = findSession;
  React.useLayoutEffect(() => {
    if (!findOpen) return;
    const delegate = codeViewRef.current;
    if (delegate === null) return;
    delegate.setSearchQuery({
      search: findQuery,
      caseSensitive: findCaseSensitive,
      regexp: findRegexp,
      wholeWord: findWholeWord,
    });
    setFindMatchCount(delegate.getMatchCount());
  }, [
    findOpen,
    findQuery,
    findCaseSensitive,
    findRegexp,
    findWholeWord,
    setFindMatchCount,
  ]);

  // ---- Responder registration ------------------------------------------------
  //
  // FileBlock owns the find session through `findSession` and is the
  // responder for the find-related actions per [L11]. The action map
  // comes from the session — Cmd-F / Cmd-G / Shift-Cmd-G dispatched
  // through the chain reach the session's handlers, which in turn call
  // `findSession.open` / the substrate-specific navigation supplied
  // above. Registered ONCE at mount with stable handlers ([L07]: the
  // session's action map is memoized and the handlers read live state
  // through refs).
  const fileBlockResponder = useOptionalResponder({
    id: fileBlockResponderId,
    actions: findSession.actions,
  });

  // Composed root ref — forwards to both the local `rootRef` (used to
  // dispatch the disengage-follow-bottom event) and the responder
  // chain's ref-callback (writes `data-responder-id` on the same
  // element). Stable across renders so neither side tears down and
  // re-attaches on every render.
  const composedRootRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      fileBlockResponder.responderRef(el);
    },
    [fileBlockResponder.responderRef],
  );

  // Empty data: render an empty marker for layout consistency. Same
  // contract as before — consumers may depend on the data-empty
  // attribute (e.g. for CSS rules that suppress the frame).
  if (data === undefined || lines.length === 0) {
    return (
      <div
        ref={composedRootRef}
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        data-embedded={embedded ? "true" : undefined}
        className={
          className === undefined ? "tugx-file" : `tugx-file ${className}`
        }
      />
    );
  }

  const langClass =
    language === undefined ? "" : ` tugx-file--lang-${language}`;
  const rootClass =
    `tugx-file${langClass}` +
    (className === undefined ? "" : ` ${className}`);

  // Fold cue label. Library-side affordance (`BlockFoldCue`) owns
  // the chevron, position-stable click, and disengage-follow-bottom
  // event; FileBlock just formats the count.
  const showCue = overThreshold;
  const cueCountWord = lines.length === 1 ? "line" : "lines";
  const cueLabel = `${lines.length.toLocaleString()} ${cueCountWord}`;

  // Compose the affordances node ONCE. It renders either inline at
  // the trailing edge of `.tugx-file-header` (standalone) or via a
  // portal into the host's chrome actions slot (embedded). Phase
  // E.3 / E.4 ordering: features (Find → Copy) → fold cue
  // (rightmost). All three affordances come from the block
  // affordance library (`body-kinds/affordances/`), so the contract
  // (position-stable click, ghost typography, 2xs scale, focus-
  // refuse) is uniform across body kinds.
  const affordances = (
    <>
      <BlockFindButton
        className="tugx-file-search"
        data-slot="file-search"
        disabled={collapsed}
        aria-label="Search in file"
        onClick={findSession.open}
      />
      <BlockCopyButton
        className="tugx-file-copy"
        data-slot="file-copy"
        disabled={collapsed}
        aria-label="Copy file contents"
        getText={getFileText}
      />
      {showCue ? (
        <BlockFoldCue
          className="tugx-file-fold-cue"
          data-slot="file-fold-cue"
          collapsed={collapsed}
          onToggle={handleFoldToggle}
          label={cueLabel}
          ariaLabelCollapse="Collapse file"
          ariaLabelExpand="Expand file"
        />
      ) : null}
    </>
  );

  // Embedded composition with a published chrome target: portal the
  // affordances into the chrome's actions slot. The chrome's slot has
  // its own layout (flex cluster); we wrap in a `data-slot` fragment
  // owner so tests can still locate "the file block's affordances"
  // unambiguously even when they live elsewhere in the DOM tree.
  const portaledAffordances =
    embedded && chromeActionsTarget !== null && affordances !== null
      ? createPortal(
          <span
            className="tugx-file-actions-cluster"
            data-slot="file-actions"
          >
            {affordances}
          </span>,
          chromeActionsTarget,
        )
      : null;

  return (
    <fileBlockResponder.ResponderScope>
    <div
      ref={composedRootRef}
      data-slot={DATA_SLOT_ROOT}
      data-empty="false"
      data-language={language ?? "plain"}
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : undefined}
      className={rootClass}
      tabIndex={-1}
    >
      {embedded ? null : (
        <div
          ref={headerRef}
          className="tugx-file-header"
          data-slot={DATA_SLOT_HEADER}
        >
          <span
            className="tugx-file-path"
            data-slot="file-path"
            title={data.filePath}
          >
            {basename(data.filePath)}
          </span>
          {language !== undefined ? (
            <span className="tugx-file-lang" data-slot="file-lang">
              {language}
            </span>
          ) : null}
          <span className="tugx-file-counts" data-slot="file-counts">
            {headerLabel}
          </span>
          <span className="tugx-file-header-spacer" />
          {affordances !== null ? (
            <span
              className="tugx-file-actions-cluster"
              data-slot="file-actions"
            >
              {affordances}
            </span>
          ) : null}
        </div>
      )}
      {portaledAffordances}

      {findOpen && !collapsed ? (
        <TugBlockFindRow
          findSession={findSession}
          ariaLabel="Find in file"
          className="tugx-file-find"
        />
      ) : null}

      {collapsed ? null : (
        <TugCodeView
          ref={codeViewRef}
          value={data.content}
          language={language}
          onFindRequested={findSession.open}
          onScrollIntoView={handleScrollMatchIntoView}
          // File viewer defaults: wrap on, line numbers on. The CM6
          // substrate handles the per-line scrollbar bug by
          // construction — `lineWrapping` puts wide lines on their
          // own visual rows inside a single scroll container.
          wrap
          lineNumbers
        />
      )}
    </div>
    </fileBlockResponder.ResponderScope>
  );
};
