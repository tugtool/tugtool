/**
 * slash-supported.ts — the [D14] slash-command allowlist: a three-tier
 * classifier over command names.
 *
 * In stream-json / print mode claude has no interactive UI, so a command's
 * fate in the dev card is one of three things ([D14] refinement,
 * #slash-cmd-audit):
 *
 * - **`supported-local`** — a [D23] local command with a Tug surface
 *   (`lib/slash-commands.ts` registry). Typed, it dispatches to its surface;
 *   it is offered in the popup.
 * - **`pass-through`** — a name that is neither local nor hidden. By name
 *   alone this is the default, so a new/unknown command is never *silently*
 *   swallowed. At submit, the dev card refines it against claude's reported
 *   command catalog (see {@link isUnknownRemoteCommand}): a pass-through name
 *   claude actually reports (`/init`, `/insights`, `/recap`, a skill or
 *   agent command) is **sent to claude verbatim** and runs a real turn; a
 *   pass-through name claude does *not* report is a genuine unknown (a typo)
 *   and is reported to the user client-side instead of burning a turn.
 *   Pass-throughs are offered in the popup.
 * - **`hidden`** — a known command with no useful behavior over the bridge
 *   (terminal-only UI flags, account/host surfaces, device/teleport,
 *   automation/plugin config deferred to a future plan, MCP). Absent from the
 *   popup, and **swallowed at submit** (silent drop, never sent to claude).
 *   The canonical user-facing list of these lives in
 *   `tuglaws/dev-card-unsupported-slash-commands.md`, kept in sync with
 *   {@link HIDDEN_SLASH_COMMANDS} below.
 *
 * Two consumers read this module: the dev-card completion layer filters
 * claude's reported commands through it (drop the `hidden` tier — see
 * `filterCommandProvider` in `completion-providers/local-commands.ts`), and
 * the prompt entry's submit path swallows a typed `hidden` command before it
 * reaches claude. Both are dev-card / bridge policy, so the filter is applied
 * at the dev-card composition layer rather than inside the generic
 * `SessionMetadataStore` — same reasoning that keeps the local-command merge
 * out of the store ([#step-1c]).
 *
 * Pure data + pure lookup — no React, no DOM, no store dependency.
 *
 * @module lib/slash-supported
 */

import { LOCAL_SLASH_COMMANDS } from "./slash-commands";

/** How a slash command is treated in the dev card. */
export type SlashSupport = "supported-local" | "pass-through" | "hidden";

/**
 * Every command with a Tug surface — the [D23] registry, by name. Derived
 * from {@link LOCAL_SLASH_COMMANDS} so a command added there (e.g. `/copy`,
 * `/help` in a later sub-step) becomes `supported-local` automatically,
 * without a second edit here.
 */
const SUPPORTED_LOCAL: ReadonlySet<string> = new Set(
  LOCAL_SLASH_COMMANDS.map((cmd) => cmd.name),
);

/**
 * The known-unsupported set ([D14]): commands hidden from the popup and
 * swallowed at submit. Grouped by *why* — the same grouping the user-facing
 * `tuglaws/dev-card-unsupported-slash-commands.md` uses. Names are without
 * the leading slash.
 *
 * Not in this set and not a local command ⇒ `pass-through` (sent to claude),
 * so genuine pass-throughs (`/init`, `/insights`, `/recap`),
 * skill/agent commands, and unknown names are all visible and reach claude.
 */
export const HIDDEN_SLASH_COMMANDS: ReadonlySet<string> = new Set<string>([
  // Terminal-only UI flags / view preferences — render Ink components or set
  // TUI state; nothing happens over a headless stream-json bridge.
  "vim",
  "theme",
  "color",
  "tui",
  "keybindings",
  "terminal-setup",
  "chrome",
  "focus",
  "fast",
  "status", // typed /status is a no-op — the Z4B chrome already shows it.

  // Conversation-structure / automation deferred to a future plan — no
  // surface this pass.
  "branch",
  "plan",
  "goal",
  "loop",
  "tasks",
  "autofix-pr",

  // Plugin / advisor / dev-loop config — host-app or a future plan.
  "advisor",
  "plugin",
  "reload-plugins",
  "reload-skills",

  // Account / auth / subscription / novelty — the Tug.app host's concern.
  "login",
  "logout",
  "privacy-settings",
  "config",
  "feedback",
  "install-github-app",
  "install-slack-app",
  "passes",
  "powerup",
  "radio",
  "stickers",
  "sandbox",
  "usage",
  "usage-credits",
  "extra-usage",
  "team-onboarding",

  // Device / cross-app / teleport — not the dev card's concern.
  "ide",
  "desktop",
  "mobile",
  "remote-control",
  "remote-env",
  "background",
  "teleport",

  // Diagnostics / info / process control.
  "doctor",
  "release-notes",
  "heapdump",
  "version",
  "quit",
  "exit",

  // Out of scope by prior decision.
  "mcp", // MCP fully out of scope ([Q06]).
  "bug", // files feedback to Anthropic — no meaning over the bridge.
]);

/**
 * Classify a command name (without the leading slash). `supported-local` and
 * `hidden` are explicit sets; everything else is `pass-through` — the safe
 * default that keeps unknown / new claude commands reaching claude rather
 * than being silently swallowed.
 */
export function classifySlashCommand(name: string): SlashSupport {
  if (SUPPORTED_LOCAL.has(name)) return "supported-local";
  if (HIDDEN_SLASH_COMMANDS.has(name)) return "hidden";
  return "pass-through";
}

/** Whether a command name is in the hidden tier (absent from popup, swallowed). */
export function isHiddenSlashCommand(name: string): boolean {
  return HIDDEN_SLASH_COMMANDS.has(name);
}

/**
 * Whether a typed `/name` is a *genuine unknown* — a command claude does not
 * recognize — given the names claude reports in its command catalog
 * (`slash_commands` ∪ `skills` ∪ `agents`). True only when:
 *
 * - the catalog is **non-empty** — before the `initialize` handshake lands we
 *   have no catalog to check against, so we must not reject (a valid command
 *   typed early would fall through to claude); and
 * - the name is a `pass-through` (not a local command, not hidden) — a local
 *   command is dispatched to its surface and a hidden one is swallowed
 *   silently, neither is "unknown"; and
 * - the catalog does not contain the name.
 *
 * The dev card uses this at submit to surface an "unknown command" alert
 * instead of sending the line to claude (which would waste a turn and reply
 * with a terminal-flavored error that may even suggest a command we hide).
 */
export function isUnknownRemoteCommand(
  name: string,
  catalogNames: readonly string[],
): boolean {
  if (catalogNames.length === 0) return false;
  if (classifySlashCommand(name) !== "pass-through") return false;
  return !catalogNames.includes(name);
}
