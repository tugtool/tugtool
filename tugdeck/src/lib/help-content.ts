/**
 * help-content.ts — pure content + command projection for the `/help` sheet
 * ([#step-13b2]).
 *
 * The `/help` sheet ([D16]) mirrors the Claude Code terminal's tabbed help:
 * a **General** tab (what Tide is + key shortcuts + a pointer to the
 * unsupported-commands doc), a **Commands** tab (the built-in slash commands),
 * and a **Custom commands** tab (plugin / user skills + agents). This module is
 * the pure, testable core: the static General-tab copy and a projection of the
 * session command catalog into the two browsable lists.
 *
 * The command projection is the same allowlist policy the slash popup applies
 * ([D14]): hidden commands ([#step-13a]) never appear, and the [D23]
 * local-command registry is always present (with its curated descriptions) so
 * the list is useful even before the `initialize` handshake catalog lands. The
 * result is "exactly what the popup offers," grouped built-in vs custom and
 * sorted alphabetically — matching the terminal's two browse sections.
 *
 * Pure data + a pure projection — no React, no DOM, no store dependency.
 *
 * @module lib/help-content
 */

import { LOCAL_SLASH_COMMANDS } from "./slash-commands";
import { isHiddenSlashCommand } from "./slash-supported";
import type { SlashCommandInfo } from "./session-metadata-store";

// ---------------------------------------------------------------------------
// General-tab copy — what Tide is, how routing works, the useful shortcuts
// ---------------------------------------------------------------------------

/** Lead paragraph at the top of the General tab. */
export const HELP_INTRO =
  "Tide unifies shell commands and AI conversations in one command surface — " +
  "talk to Claude, run shell commands, and inspect your project without leaving the prompt.";

/** One keyboard shortcut row on the General tab. */
export interface HelpShortcut {
  /** Rendered key combo, e.g. `"⇧⌘C"`. */
  readonly keys: string;
  /** What it does. */
  readonly label: string;
}

/**
 * The shortcuts worth surfacing, each verified against `keybinding-map.ts` — a
 * tight, true set, not the full binding table. (`⇧⌘C` / `⇧⌘S` select the route;
 * `⇧⇥` cycles the permission mode; `⌃\`` cycles the active card; `Esc` is the
 * shared CANCEL_DIALOG dismiss / interrupt.)
 */
export const HELP_SHORTCUTS: readonly HelpShortcut[] = [
  { keys: "/", label: "Slash commands" },
  { keys: "⇧⌘C", label: "Switch to the Code route" },
  { keys: "⇧⌘S", label: "Switch to the Shell route" },
  { keys: "⇧⇥", label: "Cycle the permission mode" },
  { keys: "⌃`", label: "Cycle the active card" },
  { keys: "Esc", label: "Dismiss a sheet, or interrupt Claude" },
];

/**
 * Path (relative to the project root) of the user-facing list of slash
 * commands that have no useful behavior over the bridge. The General tab links
 * to it; the dev card resolves it against the bound project dir to open it.
 */
export const UNSUPPORTED_COMMANDS_DOC_PATH =
  "tuglaws/dev-card-unsupported-slash-commands.md";

// ---------------------------------------------------------------------------
// Command projection — the Commands + Custom-commands tab lists
// ---------------------------------------------------------------------------

/** One command row in the help command list. */
export interface HelpCommandEntry {
  /** Command name without the leading slash. */
  readonly name: string;
  /** One-line description; `""` when the catalog reports none. */
  readonly description: string;
}

/**
 * Project a session command catalog into the help sheet's Commands list: the
 * **built-in** commands, applying the same allowlist the slash popup does
 * ([D14]).
 *
 * - **Hidden** commands ([#step-13a]) are dropped.
 * - The [D23] **local-command registry** seeds the list with its curated
 *   descriptions, so it is useful before the handshake catalog lands and the
 *   Tug-authored copy wins over claude's terminal-flavored text.
 * - Only `category: "local"` catalog entries join — claude's built-in commands.
 *   `skill` and `agent` entries are dropped: plugin / bundled-marketplace skills
 *   aren't this project's own commands, and an agent is not a slash command (the
 *   `/agents` sheet lists those).
 * - Only commands we **have help text for** are listed — an entry with no
 *   description is dropped. The [D23] registry always carries curated copy, so
 *   in practice this is the set of commands the dev card actually implements;
 *   claude's description-less catalog built-ins (`/clear`, `/init`, `/compact`,
 *   …) are left to the slash popup rather than listed here blank.
 *
 * Each name appears once (the registry's curated copy wins over a catalog
 * duplicate) and the list is sorted alphabetically.
 *
 * Pure: no side effects.
 */
export function projectHelpCommands(
  catalog: readonly SlashCommandInfo[],
): HelpCommandEntry[] {
  const builtin = new Map<string, HelpCommandEntry>();

  for (const cmd of LOCAL_SLASH_COMMANDS) {
    builtin.set(cmd.name, { name: cmd.name, description: cmd.description });
  }

  for (const cmd of catalog) {
    if (cmd.category !== "local") continue; // skills / agents aren't built-in commands
    if (isHiddenSlashCommand(cmd.name)) continue;
    // A curated registry description outranks a (possibly empty) catalog one.
    if (builtin.has(cmd.name)) continue;
    builtin.set(cmd.name, { name: cmd.name, description: cmd.description ?? "" });
  }

  return [...builtin.values()]
    .filter((e) => e.description !== "") // only commands we have help text for
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
