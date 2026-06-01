# Dev-card unsupported slash commands

*Why some of Claude Code's slash commands don't appear in the dev card's `/` popup.*

The dev card talks to `claude` over a **stream-json / print-mode** bridge — there
is no interactive terminal UI on the other end. Claude Code's slash commands fall
into three groups, and the popup shows only the first two:

- **Local commands with a Tug surface** — reimplemented graphically in the dev
  card (`/permissions`, `/model`, `/rewind`, `/resume`, `/diff`, `/context`,
  `/skills`, `/agents`, `/memory`, `/hooks`, …). Typing one opens its surface.
- **Pass-throughs** — commands that expand to a prompt and run a real model turn
  (`/init`, `/insights`, `/compact`, `/recap`), plus every skill and agent
  command. These are sent to `claude` verbatim. A typed command the dev card
  doesn't recognize locally is checked against the command catalogue `claude`
  reports for the session: if `claude` knows it, it is passed through; if not,
  it is a genuine unknown (usually a typo) and the dev card shows an *Unknown
  command* alert client-side instead of burning a turn. Nothing is silently
  dropped — local commands open a surface, hidden commands are no-ops (below),
  pass-throughs reach `claude`, and unknowns get an alert.
- **Unsupported (hidden)** — commands that do nothing useful over the bridge:
  they render terminal-only UI, set TUI state, or address an account / host /
  device concern that isn't the dev card's. These are **absent from the popup**,
  and typing one is a **silent no-op** (it is not sent to `claude`, which would
  only bounce it as unavailable).

The authoritative hidden set is `HIDDEN_SLASH_COMMANDS` in
`tugdeck/src/lib/slash-supported.ts`; this document mirrors it. The decision to
hide rather than grey-out, and to keep the list discoverable here, is [D14] in
[design-decisions.md](design-decisions.md).

## Hidden commands, by reason

### Terminal-only UI flags / view preferences
`/vim`, `/theme`, `/color`, `/tui`, `/keybindings`, `/terminal-setup`,
`/chrome`, `/focus`, `/fast`, `/status` — these render Ink components or set
terminal-local UI state; nothing happens over a headless bridge. (`/status` is a
no-op specifically because the Z4B chrome already shows session status.)

### Conversation-structure / automation
`/branch`, `/plan`, `/goal`, `/loop`, `/tasks`, `/autofix-pr` — conversation
branching, plan mode, agentic goal loops, and background-task / PR orchestration.
Out of conversational-parity scope; each is a substantial standalone feature for
a future plan.

### Plugin / advisor / dev-loop config
`/advisor`, `/plugin`, `/reload-plugins`, `/reload-skills` — plugin and
dev-loop configuration; a host-app or future-plan concern.

### Account / auth / subscription / novelty
`/login`, `/logout`, `/privacy-settings`, `/config`, `/feedback`,
`/install-github-app`, `/install-slack-app`, `/passes`, `/powerup`, `/radio`,
`/stickers`, `/sandbox`, `/usage`, `/usage-credits`, `/extra-usage`,
`/team-onboarding` — account, auth, settings, and subscription surfaces that
belong to the Tug.app host, not the dev card.

### Device / cross-app / teleport
`/ide`, `/desktop`, `/mobile`, `/remote-control`, `/remote-env`, `/background`,
`/teleport` — cross-app, device, and terminal-freeing commands that aren't the
dev card's concern.

### Diagnostics / info / process control
`/doctor`, `/release-notes`, `/heapdump`, `/version`, `/quit`, `/exit` — install
diagnostics, info display, and process control. Closing a card is the dev card's
quit affordance.

### Out of scope by prior decision
`/mcp` — MCP is fully out of scope ([Q06]); it returns when MCP is addressed in a
future plan. `/bug` — files feedback to Anthropic, which has no meaning over the
bridge.
