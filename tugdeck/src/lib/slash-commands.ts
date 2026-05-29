/**
 * slash-commands.ts — registry + matcher for locally-handled slash
 * commands.
 *
 * Some slash commands are *claude's* (`/commit`, `/compact`, skills,
 * agents): typing one sends it to claude, which runs it and streams a
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
