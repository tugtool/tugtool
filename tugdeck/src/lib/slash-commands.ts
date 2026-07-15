/**
 * slash-commands.ts — registry + matcher for locally-handled slash
 * commands.
 *
 * Some slash commands are *claude's* (`/commit`, skills, agents): typing
 * one sends it to claude, which runs it and streams a
 * real turn. Others are *terminal-rendered-locally* (`/permissions`,
 * `/model`, `/rewind`, …): the terminal handles them itself and claude
 * never sees them. In stream-json / print mode claude has no interactive
 * UI, so a locally-rendered command sent to it bounces with "isn't
 * available in this environment." The dev-card reimplements those
 * commands as graphical surfaces — and this module is the single source
 * of truth for which commands are local and how a typed command line is
 * recognized.
 *
 * This is pure data + a pure lookup — no React, no DOM, no store
 * dependency. The completion layer reads {@link LOCAL_SLASH_COMMANDS} to
 * offer the commands in the slash popup ([#step-1c] dev-card composition
 * layer); the prompt entry's submit path reads {@link
 * matchLocalSlashCommand} to decide whether a draft is a local command
 * to dispatch or text to send to claude; later command steps ([#step-2b]
 * `/model`, [#step-7]+ etc.) extend the registry; [D14]'s allowlist
 * ([#step-13]) reads the same set.
 *
 * Dispatch + surface ownership live elsewhere: a matched command is
 * dispatched key-card-scoped as `RUN_SLASH_COMMAND` and the dev card's
 * card-content responder opens the surface (see [D23] and
 * `dev-card.tsx`). Keeping this module surface-agnostic is what lets the
 * matcher run inside the generic `TugPromptEntry` without coupling it to
 * dev-card concepts.
 *
 * @module lib/slash-commands
 */

import { TUG_ATOM_CHAR } from "./tug-atom-img";

/** One locally-handled slash command's static descriptor. */
export interface LocalSlashCommandSpec {
  /** Command name without the leading slash, e.g. `"permissions"`. */
  readonly name: string;
  /** One-line description (popup / docs); not rendered today. */
  readonly description: string;
  /**
   * Whether the command accepts trailing arguments after its name.
   * A no-arg command matches only a bare `/name`; an arg-accepting
   * command matches `/name` optionally followed by whitespace + args.
   * Defaults to `false`.
   */
  readonly takesArgs?: boolean;
  /**
   * Offered (and intercepted at submit) ONLY on the `❯` Code route.
   * One-shot accelerators — `/shell`, `/find`, `/btw` — act *as if* the
   * user were on another route while staying on Code; on the other
   * routes they are not offered, and a typed `/shell ls` on the `$`
   * route reaches the shell literally instead of being re-intercepted.
   * Defaults to `false` (offered everywhere the popup opens).
   */
  readonly codeRouteOnly?: boolean;
}

/**
 * Every command the dev-card handles locally, in popup order. The seed
 * is `/permissions` ([#step-1c]); each later command step appends its
 * entry. The `as const satisfies` shape both validates the descriptors
 * and narrows {@link LocalCommandName} to the literal union — which the
 * dev card's `RUN_SLASH_COMMAND` handler keys an exhaustive map on, so a
 * registry entry without a wired surface is a compile error rather than
 * a silently-swallowed command.
 */
// `/permissions` is the first live consumer: the tool-permission **rules**
// editor ([#step-1.6]) — distinct from the permission *mode* chip, which is a
// click + `Shift+Tab` control with no slash command. `/model` ([#step-2b]) is
// the next consumer. `as const satisfies` both validates each descriptor and
// narrows {@link LocalCommandName} to the literal union, so the dev card's
// `RUN_SLASH_COMMAND` handler keys an exhaustive `Record<LocalCommandName, …>`
// on it — a registry entry without a wired surface is a compile error.
export const LOCAL_SLASH_COMMANDS = [
  {
    name: "permissions",
    description: "Edit tool-permission rules (allow / ask / deny / workspace)",
  },
  {
    name: "model",
    description: "Switch the active model for this session",
  },
  {
    name: "effort",
    description: "Set the reasoning effort for this session",
  },
  {
    name: "mode",
    description: "Set the permission mode for this session",
  },
  {
    name: "rewind",
    description: "Rewind the conversation (and optionally code) to an earlier turn",
  },
  {
    name: "resume",
    description: "Resume a different session for this project in this card",
  },
  {
    name: "diff",
    description: "View uncommitted changes (git diff HEAD) for this project",
  },
  {
    name: "context",
    description: "Show the context-window breakdown in the status-bar popover",
  },
  {
    name: "tasks",
    description: "Show the session's work (goal, jobs, scheduled, checklist) in the WORK popover",
  },
  {
    name: "bashes",
    description: "Show the session's work in the WORK popover (alias of /tasks)",
  },
  {
    name: "skills",
    description: "List the project's plugin + user skills",
  },
  {
    name: "agents",
    description: "List the subagents Claude can delegate to",
  },
  {
    name: "memory",
    description: "Open this project's memory files in your editor",
  },
  {
    name: "hooks",
    description: "View the configured hooks for this session",
  },
  {
    name: "usage",
    description: "Show subscription usage limits and this session's cost",
  },
  {
    name: "btw",
    description: "Ask a quick side question, answered from the conversation with no tools",
    takesArgs: true,
    codeRouteOnly: true,
  },
  {
    name: "shell",
    description: "Run one shell command from here (the route stays Code)",
    takesArgs: true,
    codeRouteOnly: true,
  },
  {
    name: "find",
    description: "Find in the transcript from here (the route stays Code)",
    takesArgs: true,
    codeRouteOnly: true,
  },
  {
    name: "copy",
    description: "Copy the most recent assistant message to the clipboard",
  },
  {
    name: "help",
    description: "Show available commands, shortcuts, and help",
  },
  {
    name: "clear",
    description: "Start a fresh session in this card (the current one stays resumable)",
  },
  {
    name: "export",
    description: "Export the session transcript to a file (Markdown or JSON Lines)",
  },
  {
    name: "add-dir",
    description: "Add a working directory to this session",
  },
  {
    name: "rename",
    description: "Name this session (shown in the chip and session chooser)",
    takesArgs: true,
  },
  {
    name: "compact",
    description: "Compact the conversation in place to free up context",
    takesArgs: true,
  },
  {
    name: "logout",
    description: "Log out of Claude and return to setup",
  },
] as const satisfies readonly LocalSlashCommandSpec[];

/** A registered local-command name. */
export type LocalCommandName = (typeof LOCAL_SLASH_COMMANDS)[number]["name"];

/** A recognized local command: its name plus any trailing args (`""` if none). */
export interface LocalSlashCommandMatch {
  readonly name: LocalCommandName;
  readonly args: string;
}

const SPEC_BY_NAME: ReadonlyMap<string, LocalSlashCommandSpec> = new Map(
  LOCAL_SLASH_COMMANDS.map((cmd) => [cmd.name, cmd]),
);

// `/name` optionally followed by whitespace + the rest of the line.
// The name is a leading word (letters, then word chars / hyphens) — the
// shape of every local command. Claude's namespaced commands (e.g.
// `tugplug:plan`) are not local and simply miss the registry lookup.
const COMMAND_LINE = /^\/([a-zA-Z][a-zA-Z0-9-]*)(?:\s+([\s\S]*))?$/;

/**
 * Recognize a draft as a local slash command, or return `null`.
 *
 * The whole trimmed draft must be a single `/command` line. A no-arg
 * command matches only when nothing follows the name (`/permissions`,
 * not `/permissions foo`); an arg-accepting command (`takesArgs`)
 * captures the trimmed remainder as `args`. Anything else — a name not
 * in the registry, args on a no-arg command, or text that isn't a
 * command line — returns `null`, and the caller sends it to claude
 * verbatim.
 *
 * Pure: no side effects, no allocation beyond the result. The caller is
 * responsible for excluding drafts that carry atoms (a command line is
 * plain text) — this matcher only inspects the string.
 */
export function matchLocalSlashCommand(text: string): LocalSlashCommandMatch | null {
  const m = COMMAND_LINE.exec(text.trim());
  if (m === null) return null;
  const name = m[1];
  const args = (m[2] ?? "").trim();
  const spec = SPEC_BY_NAME.get(name);
  if (spec === undefined) return null;
  if (args.length > 0 && spec.takesArgs !== true) return null;
  return { name: name as LocalCommandName, args };
}

/**
 * One atom in an editor draft, reduced to what command-line reconstruction
 * needs: its document position (where its {@link TUG_ATOM_CHAR} placeholder
 * sits in the draft text) and its segment `type` / `value`. `PositionedAtom`
 * from the editor structurally satisfies this.
 */
export interface CommandLineAtom {
  readonly position: number;
  readonly segment: { readonly type: string; readonly value: string };
}

/**
 * Reconstruct a plain `/command …` line from an editor draft that may carry
 * atoms, so a slash command is recognized even when its argument contains
 * `@`/file mentions. Each atom placeholder ({@link TUG_ATOM_CHAR}) in `text`
 * is expanded in place by its segment type: a `command` atom → `/<value>`
 * (the leading command typed via the popup); `image` atoms are dropped (not
 * meaningful as a command argument); every other atom (file / doc / link /
 * …) contributes its `value` — the path or reference. Plain text passes
 * through unchanged, so a draft with no atoms returns verbatim.
 *
 * The caller runs {@link matchLocalSlashCommand} / {@link slashCommandName}
 * on the result: a draft that doesn't lead with a slash command simply
 * doesn't match, so non-command drafts are unaffected. Pure.
 */
export function buildSlashCommandLine(
  text: string,
  atoms: readonly CommandLineAtom[],
): string {
  if (atoms.length === 0) return text;
  const segByPos = new Map(atoms.map((a) => [a.position, a.segment]));
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== TUG_ATOM_CHAR) {
      out += ch;
      continue;
    }
    const seg = segByPos.get(i);
    if (seg === undefined) continue; // defensive: orphan placeholder
    if (seg.type === "command") out += `/${seg.value}`;
    else if (seg.type === "image") continue; // drop — not a focus argument
    else out += seg.value;
  }
  return out;
}

/**
 * Extract the command name (without the leading slash) from a draft that is
 * a single `/command` line, ignoring any trailing args; `null` for anything
 * that isn't a command line. Unlike {@link matchLocalSlashCommand} this does
 * not consult the registry — it answers "what `/name` did the user type?",
 * which the [D14] allowlist ([#step-13a]) reads to classify a typed command
 * that is *not* a local one (a known-unsupported name to swallow, a
 * pass-through to send to claude).
 *
 * Pure: no side effects.
 */
export function slashCommandName(text: string): string | null {
  const m = COMMAND_LINE.exec(text.trim());
  return m === null ? null : m[1];
}

/** Names of the Code-route-only one-shot commands (see `codeRouteOnly`). */
const CODE_ROUTE_ONLY_NAMES: ReadonlySet<string> = new Set(
  (LOCAL_SLASH_COMMANDS as readonly LocalSlashCommandSpec[])
    .filter((c) => c.codeRouteOnly === true)
    .map((c) => c.name),
);

/**
 * True when `name` is a Code-route-only one-shot command. The prompt entry
 * uses this to (a) filter the `/` completion popup on non-Code routes and
 * (b) skip the local-command submit intercept there, letting the draft fall
 * through to the route's native handling.
 */
export function isCodeRouteOnlyCommand(name: string): boolean {
  return CODE_ROUTE_ONLY_NAMES.has(name);
}
