/**
 * bang-commands.ts — registry + matcher for bang (routing) commands.
 *
 * A slash command is a *verb*: "do this thing" (`/model`, `/rewind`,
 * `/compact`). A bang command is a *routing*: "send what I'm typing down a
 * different path" — the four per-submission destinations demoted from sticky
 * routes ([P01]): `!shell`, `!btw`, `!find`, `!history`. They do nothing
 * themselves; they redirect the payload. That distinction gets its own
 * namespace and sigil so the slash inventory stays purely verbs, and the
 * chip / picker / `!` trigger present routings as what they are.
 *
 * Committing is deliberately NOT a routing: it is the composer's one
 * secondary resting mode (commit mode, `lib/commit-mode-controller`), entered
 * via ⇧⌘C / `/commit` / Session ▸ Commit…. `!changes` is not registered, so it
 * is just an unknown bang like any other — the shell escape hatch.
 *
 * `!` followed by anything that is NOT a registered bang name is the shell
 * escape hatch: `!git status` runs `git status` in the shell — the terminal's
 * (and claude code's own) leading-`!` bash idiom, honored here. `!` followed
 * by whitespace is prose ("! wow"), not a routing.
 *
 * Pure data + pure lookup — no React, no DOM, no store dependency, no
 * imports. Dispatch + surface ownership live in the session card, exactly
 * like slash commands ([D23]); the prompt entry's submit path reads
 * {@link matchBangCommandLine} on the reconstructed draft line.
 *
 * @module lib/bang-commands
 */

/** One bang command's static descriptor. Every bang command takes args —
 *  the args ARE the routed payload. */
export interface BangCommandSpec {
  /** Routing name without the leading bang, e.g. `"shell"`. */
  readonly name: string;
  /** One-line description (completion popup / picker menu / help). */
  readonly description: string;
  /** The ⌃⌘ chord that seeds this routing's chip — shown wherever the
   *  command is listed, so every surface teaches the shortcut. */
  readonly shortcut: string;
}

/**
 * Every bang command, in picker order. The `as const satisfies` shape both
 * validates the descriptors and narrows {@link BangCommandName} to the
 * literal union — which the session card's dispatch handler keys an
 * exhaustive map on, so a registry entry without a wired surface is a
 * compile error rather than a silently-swallowed routing.
 */
export const BANG_COMMANDS = [
  {
    name: "shell",
    description: "Run one shell command from here",
    shortcut: "⌃⌘S",
  },
  {
    name: "btw",
    description: "Ask a quick side question, answered from the conversation with no tools",
    shortcut: "⌃⌘B",
  },
  {
    name: "find",
    description: "Find in the transcript",
    shortcut: "⌃⌘G",
  },
  {
    name: "history",
    description: "View project history; ask about prior work",
    shortcut: "⌃⌘H",
  },
] as const satisfies readonly BangCommandSpec[];

/** A registered bang-command name. */
export type BangCommandName = (typeof BANG_COMMANDS)[number]["name"];

const BANG_NAME_SET: ReadonlySet<string> = new Set(
  BANG_COMMANDS.map((cmd) => cmd.name),
);

/** Whether `name` is a registered bang command (narrowing guard). */
export function isBangCommand(name: string): name is BangCommandName {
  return BANG_NAME_SET.has(name);
}

/** A recognized bang routing: its name plus the routed payload (`""` if none). */
export interface BangCommandMatch {
  readonly name: BangCommandName;
  readonly args: string;
}

/**
 * Recognize a draft line as a bang routing, or return `null`.
 *
 * The trimmed draft must lead with `!` glued to a non-whitespace character.
 * `!name [payload]` for a registered name routes there; `!<anything else>`
 * is the shell escape hatch — the entire remainder after the `!` is the
 * shell command (`!git status` → shell `git status`). A bare `!` routes to
 * shell with empty args (the surface shows its usage caution). `!` followed
 * by whitespace, or a draft not leading with `!`, returns `null` — prose,
 * sent to claude verbatim.
 *
 * Pure. The caller is responsible for reconstructing atom-bearing drafts
 * into a plain line first (see `buildSlashCommandLine`) — this matcher only
 * inspects the string.
 */
export function matchBangCommandLine(text: string): BangCommandMatch | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("!")) return null;
  const body = trimmed.slice(1);
  if (body.length > 0 && /^\s/.test(body)) return null;
  const headEnd = body.search(/\s|$/);
  const head = body.slice(0, headEnd);
  if (isBangCommand(head)) {
    return { name: head, args: body.slice(headEnd).trim() };
  }
  return { name: "shell", args: body.trim() };
}
