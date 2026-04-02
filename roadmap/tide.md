# Tide — The Unified Command Surface

*Replace the terminal. Keep the commands.*

**Codename:** Tide
**Reference:** [tide-conversation-log.md](tide-conversation-log.md) — full design conversation
**Prior work:** [tug-conversation.md](tug-conversation.md) — Claude Code transport exploration and UI phases

---

## Vision

Tide is a graphical command surface where humans and AI both issue commands and see results, rendered at the full fidelity of a graphical UI. There is no terminal pane and no AI pane — one surface, one stream of command blocks, each rendered with purpose-built graphical components.

The VT100 character grid is an output device we no longer need. The pty byte stream is an encoding we no longer need. The programs people use most — git, cargo, ls, grep, curl — produce structured or line-oriented output that was only ever flattened into ANSI escape sequences because the terminal was the only display available. Tide provides a better display.

Claude Code already broke free of the terminal with `--output-format stream-json`. It speaks a typed protocol: structured JSON events with semantic meaning. The transport exploration (35 tests) documented this protocol. The tugcast WebSocket layer carries it to tugdeck. This is the proof of concept: a post-terminal command experience.

Tide extends this to the shell. The same approach — investigate inputs/outputs, define structured events, render graphically — applied to bash, zsh, and the ~20 commands that cover 80% of developer shell usage.

---

## Core Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  TIDE — Graphical Surface                │
│                                                          │
│  ┌─────────────────────────────┐                         │
│  │    Unified Command Input    │                         │
│  │                             │                         │
│  │  > natural language → AI    │                         │
│  │  $ shell command → shell    │                         │
│  │  : surface command → tide   │                         │
│  └─────────────┬───────────────┘                         │
│                │                                         │
│  ┌─────────────▼───────────────┐                         │
│  │    Three-Tier Dispatch      │                         │
│  │                             │                         │
│  │  Surface built-in → handle  │                         │
│  │  Claude Code → tugtalk      │                         │
│  │  Shell → tugshell           │                         │
│  └──┬──────────┬───────────────┘                         │
│     │          │                                         │
│  ┌──▼────┐  ┌──▼──────────────────┐                      │
│  │tugtalk│  │tugshell             │                      │
│  │       │  │                     │                      │
│  │stream │  │hidden pty + hooks   │                      │
│  │json   │  │command adapters     │                      │
│  │over   │  │structured output    │                      │
│  │stdio  │  │                     │                      │
│  └──┬────┘  └──┬──────────────────┘                      │
│     │          │                                         │
│  ┌──▼────┐  ┌──▼──────────────────┐                      │
│  │Claude │  │bash / zsh           │                      │
│  │Code   │  │(unmodified)         │                      │
│  └───────┘  └─────────────────────┘                      │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Unified Output Stream                  │ │
│  │                                                     │ │
│  │  ┌─ $ git status ───────────────────────────────┐   │ │
│  │  │  GitStatusBlock: branch main, 2 staged, ...  │   │ │
│  │  └──────────────────────────────────────────────┘   │ │
│  │  ┌─ > fix the build error in lib.rs ────────────┐   │ │
│  │  │  AssistantTextBlock: streaming markdown...   │   │ │
│  │  │  ToolUseBlock: Edit src/lib.rs               │   │ │
│  │  │  AssistantTextBlock: "Fixed the lifetime..." │   │ │
│  │  └──────────────────────────────────────────────┘   │ │
│  │  ┌─ $ cargo test ──────────────────────────────┐    │ │
│  │  │  BuildOutputBlock: 47 passed, 0 failed      │    │ │
│  │  └─────────────────────────────────────────────┘    │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## Command Input: Prefix Routing

The unified command input uses a single-character prefix to route commands:

| Prefix | Route | Example |
|--------|-------|---------|
| `>` | Claude Code | `> which files need updating for the foo feature` |
| `$` | Shell | `$ git status` |
| `:` | Surface built-in | `:model sonnet` `:theme dark` `:cost` |

The prefix is clear, learnable, and type-ahead friendly. It mirrors conventions developers already know: `>` evokes a prompt/quote (natural language), `$` is the shell prompt, `:` is the vim command prefix.

Open design questions:
- Default when no prefix is typed? Context-dependent (last-used route) or require prefix always?
- Auto-detection as fallback? If text looks like a shell command, route to shell; if natural language, route to Claude Code.
- Can the prefix be implicit via UI context (e.g., a mode indicator or toggle)?

---

## Three-Tier Command Dispatch

Paralleling how shells handle built-ins:

### Tier 1: Surface Built-Ins

Handled entirely by the graphical surface. Never reach shell or Claude Code. Modify surface state.

| Command | What It Does | Data Source |
|---------|-------------|-------------|
| `:model [name]` | Switch Claude Code model | Send `model_change` message |
| `:permission [mode]` | Switch permission mode | Send `permission_mode` message |
| `:cost` | Show cost/token display | Cached `cost_update` events |
| `:status` | Show session/model/context | Cached `system_metadata` |
| `:clear` | Start new session | Send `session_command: "new"` |
| `:theme [name]` | Switch visual theme | Surface state |
| `:session [cmd]` | Session management (list, resume, fork) | Filesystem + session state |
| `:export` | Export conversation | Accumulated event history |
| `:help` | Show help | Surface state |

These are the "UI Must Build" items from tug-conversation.md (U9-U11, C1-C15), reframed as surface built-ins.

### Tier 2: Claude Code Pass-Through

Routed to Claude Code via tugtalk/tugcast stream-json protocol. Full event stream returns.

- Natural language prompts (`> fix the bug in...`)
- Slash commands (`> /plan`, `> /implement`, `> /compact`)
- All Claude Code interaction: streamed markdown, tool use, permissions, questions

The protocol is fully documented in [transport-exploration.md](transport-exploration.md). The rendering pipeline is designed in [tug-conversation.md](tug-conversation.md) Phases 3-7.

### Tier 3: Shell Pass-Through

Routed to bash/zsh via tugshell. Command adapters produce structured output.

- Any shell command (`$ git status`, `$ cargo build`, `$ ls -la`)
- Pipelines (`$ ls | grep foo | wc -l`)
- Shell built-ins (`$ cd src`, `$ export FOO=bar`)
- Aliases and functions from user's shell configuration

---

## The Shell Bridge: Tugshell

Tugshell is the analog of tugtalk. Tugtalk bridges Claude Code's stream-json to tugcast. Tugshell bridges bash/zsh to tugcast.

### Layer 1: Shell Process Management

- Spawns bash/zsh as login interactive (`zsh -li`) to load full user environment
- Hidden pty for OS compatibility — the shell requires a tty, but the pty never renders as a character grid
- Injects shell integration hooks via precmd/preexec (zsh) or PROMPT_COMMAND/DEBUG trap (bash)
- Uses OSC 133 markers to delimit command boundaries (same pattern as iTerm2, VS Code, Warp)

**What the hooks capture**:
- Full command line as typed (preexec `$1`)
- Exit code (`$?` in precmd, `$pipestatus` for pipelines)
- Duration (timestamp in preexec vs. precmd)
- Working directory before and after
- Raw stdout/stderr bytes from the hidden pty

### Layer 2: Command Adapter Registry

Maps `(command_name, args)` to an adapter function. The adapter receives the command context and produces a typed output event.

```
Adapter receives:
  - command: "git status"
  - args: ["status"]
  - raw_stdout: bytes from pty
  - exit_code: 0
  - cwd: "/src/tugtool"

Adapter produces:
  - format: "git_status"
  - data: { branch: "main", staged: [...], unstaged: [...], untracked: [...] }
```

Three adapter strategies:

| Strategy | When | Example |
|----------|------|---------|
| **Structured invocation** | Command has JSON/porcelain mode | Run `git status --porcelain=v2` instead of parsing pty output |
| **Output parsing** | Command has stable text format | Parse `ls -la` column output; parse unified diff format |
| **Raw passthrough** | Unknown command or unstable output | Emit format="text" with raw stdout |

Some adapters bypass the pty entirely. The git adapter can run `git status --porcelain=v2` directly and produce structured data without ever looking at what the pty captured. The pty output is a fallback, not the primary source.

**Fallback behavior**: Unknown commands get their stdout rendered as styled monospace text. Simple ANSI SGR sequences (bold, colors) are mapped to CSS styles. No VT100 cursor addressing, no character grid, no terminal emulation. Expandable and revisable as we learn.

### Layer 3: Protocol Events

Shell events follow the same pattern as Claude Code events — typed JSON over tugcast's WebSocket:

```json
{ "type": "command_start", "id": "cmd-42", "command": "git status",
  "cwd": "/src/tugtool", "timestamp": "2026-04-02T10:30:00Z" }

{ "type": "command_output", "id": "cmd-42", "format": "git_status",
  "data": { "branch": "main", "staged": [...], "unstaged": [...] } }

{ "type": "command_complete", "id": "cmd-42", "exit_code": 0,
  "duration_ms": 45, "pipestatus": [0] }
```

For pipelines:
```json
{ "type": "command_start", "id": "cmd-43", "command": "ls | grep foo",
  "pipeline": ["ls", "grep foo"], "cwd": "/src/tugtool" }

{ "type": "command_output", "id": "cmd-43", "format": "text",
  "data": { "text": "foo.rs\nfoobar.txt\n" } }

{ "type": "command_complete", "id": "cmd-43", "exit_code": 0,
  "pipestatus": [0, 0] }
```

For redirections:
```json
{ "type": "command_start", "id": "cmd-44", "command": "cargo build > build.log 2>&1",
  "redirects": [{ "fd": 1, "target": "build.log" }, { "fd": 2, "target": "&1" }] }

{ "type": "command_output", "id": "cmd-44", "format": "redirect_notice",
  "data": { "message": "Output written to build.log", "path": "build.log" } }

{ "type": "command_complete", "id": "cmd-44", "exit_code": 0 }
```

---

## Command Adapters: Priority List

Based on usage frequency analysis. ~20 adapters cover 80%+ of developer shell usage.

### Tier A — Native Structured Output (highest value, lowest effort)

| Command | Structured Source | Graphical Rendering |
|---------|------------------|-------------------|
| `git status` | `--porcelain=v2` | Staged/unstaged file lists with status icons, action buttons |
| `git log` | `--format=<json-ish>` | Commit timeline with clickable hashes, author avatars, branch refs |
| `git diff` | Unified diff format (stable) | Side-by-side diff viewer with syntax highlighting |
| `docker ps` | `--format '{{json .}}'` | Sortable container table with status badges |
| `docker images` | `--format '{{json .}}'` | Image table with size, age, tags |
| `npm ls` / `yarn list` | `--json` | Interactive dependency tree with version badges |
| `cargo build` | `--message-format=json` | Build output with clickable error locations, warning counts |
| `cargo test` | `--message-format=json` | Test results with pass/fail/skip counts, failure details |
| `kubectl get` | `-o json` | Resource tables with status indicators |
| `brew info` | `--json=v2` | Package info cards |
| `aws` (all) | JSON by default | Structured response viewer |
| `curl` | `-w '%{json}'` for metadata | Response viewer with headers, formatted body |

### Tier B — Stable Parseable Output (moderate effort)

| Command | Parsing Strategy | Graphical Rendering |
|---------|-----------------|-------------------|
| `ls` / `eza` | Direct filesystem stat (bypass pty) | Icon-rich file grid with metadata columns, sorting, thumbnails |
| `grep` / `rg` | `rg --json` or parse match format | Grouped results with highlighted matches, clickable file:line |
| `find` / `fd` | One path per line | File tree or flat list with icons |
| `ps` | `-o` custom format | Process table, sortable |
| `diff` | Unified diff format | Side-by-side viewer |
| `du` / `df` | Columnar output, stable | Treemap or bar chart visualization |
| `wc` | Numeric columns | Formatted count display |
| `env` / `export` | KEY=VALUE per line | Searchable/filterable variable table |

### Tier C — Monospace Fallback (no adapter needed)

`make`, `echo`, `python`, `cat`, `head`/`tail`, `chmod`, `mkdir`, `rm`, `cp`/`mv`, `tar`, `swift`/`swiftc`

Rendered as styled monospace text blocks. ANSI SGR colors (bold, red, green, etc.) mapped to CSS. No VT100 emulation.

### Tier D — Terminal Card Only (excluded from unified surface)

`vim`/`nvim`, `htop`/`top`, `less`/`more`, `ssh`, `tmux`

Available via the separate terminal card in tugdeck. Not part of Tide's unified surface.

---

## Tugcast Integration

Tugcast already multiplexes feeds over one WebSocket with binary framing. Tide adds shell feeds:

| FeedId | Feed | Direction | Status |
|--------|------|-----------|--------|
| 0x00 | TerminalOutput | server → client | Existing (for terminal card) |
| 0x10 | Filesystem | server → client | Existing |
| 0x20 | Git | server → client | Existing |
| 0x30-0x33 | Stats | server → client | Existing |
| 0x40 | CodeOutput | server → client | Existing |
| 0x41 | CodeInput | client → server | Existing |
| **0x50** | **ShellOutput** | **server → client** | **New — shell command events** |
| **0x51** | **ShellInput** | **client → server** | **New — commands to shell** |
| 0x60 | TugFeed | server → client | Planned (tug-feed.md) |

ShellOutput carries the same JSON event types as CodeOutput — typed, structured, renderable. The graphical surface treats them as peers in the unified output stream.

---

## Environment Model

### Working Directory

The shell's cwd is the source of truth. When the user types `$ cd src`, the shell's cwd changes. The surface updates its cwd display. The next Claude Code turn inherits the new cwd.

### Variables and Export

The shell bridge runs a real shell. `export FOO=bar` works as expected. Tools that depend on environment mutation — direnv, nvm, conda, pyenv, homebrew — work because the real shell process manages the environment.

### Aliases and Functions

Loaded from the user's startup files. `alias gst='git status'`, user-defined functions — all work because the real shell executes them. The adapter registry recognizes the resolved command (after alias expansion), not the alias itself.

### Startup Files

Full sequence honored via login interactive launch:
- zsh: `/etc/zshenv` → `~/.zshenv` → `~/.zprofile` → `~/.zshrc`
- bash: `~/.bash_profile` (which typically sources `~/.bashrc`)

### Claude Code Environment Sync

Shell environment changes (cd, export) propagate to Claude Code's context. The surface tracks shell cwd and passes it to tugtalk, which sets Claude Code's working directory. Environment variables exported in the shell are available to Claude Code's Bash tool calls (since tugshell can pass the current environment snapshot).

---

## Design Laws

### Existing Laws of Tug (apply to Tide)

All existing Laws of Tug apply to Tide's rendering. L01 (one render), L02 (useSyncExternalStore), L06 (CSS/DOM for appearance), etc.

### Proposed New Law

> **[Lxx] The pty is opaque.** The graphical surface never exposes terminal emulation artifacts to the user. No VT100 character grids, no ANSI cursor addressing, no escape-sequence-driven screen painting. A hidden pty may exist as OS-level plumbing for shell compatibility, but its byte stream is consumed by adapters that produce typed, structured output. If a program's output cannot be meaningfully adapted, it renders as styled monospace text — not as a terminal emulator viewport. The terminal card is a separate, explicit opt-in outside the unified surface.

### Shell UX Laws (must not violate)

These conventions are so deeply ingrained that violating them would make the surface unusable:

1. **Ctrl-C always interrupts.** Maps to both shell SIGINT and Claude Code `interrupt`.
2. **The prompt means "ready for input."** The command input must show a clear readiness signal.
3. **Commands are text.** Users paste commands from docs and Stack Overflow. The input must accept raw pasted text.
4. **The environment is sacred.** PATH, HOME, direnv mutations, nvm, conda — all must work.
5. **Output is a stream.** Even though we render richly, raw text must remain accessible for copy-paste.
6. **Failure is normal.** Non-zero exit codes are information, not errors to hide.

---

## Phases

Tide builds on the existing tug-conversation.md phases. Phases 1-2c (transport) are complete. Phases 3A-3A.7 (markdown rendering) are in progress. The new phases below extend the roadmap to encompass the shell side and the unified surface.

```
─── EXISTING (Claude Code) ────────────────────────────────
Phase 1: Transport Exploration           — DONE (35 tests)
Phase 2: Transport Hardening             — DONE (T1-T7)
Phase 2b: WebSocket Verification         — DONE (4 issues found)
Phase 2c: WebSocket Fixes                — DONE (T8-T11)
Phase 3A: Markdown Rendering Core        — DONE
Phase 3A.1-3A.4: Worker/WASM Pipeline    — DONE
Phase 3A.5: Region Model + API           — DONE
Phase 3A.6: SmartScroll                  — In progress
Phase 3A.7: SmartScroll Hardening

─── CLAUDE CODE UI (continues from tug-conversation.md) ───
Phase 3B: Markdown Content Types         — code, thinking, tool use, streaming
Phase 4: Prompt Input                    — input layer, slash commands, @ files
Phase 5: Conversation Wiring             — core conversation loop
Phase 6: Chrome & Status                 — switchers, indicators, cost
Phase 7: Session & Commands              — terminal commands, images, sessions

─── TIDE: SHELL INTEGRATION ───────────────────────────────
Phase S1: Shell Bridge (tugshell)        — spawn shell, hooks, command capture
Phase S2: Adapter Registry + Fallback    — command routing, monospace fallback
Phase S3: Core Adapters (Tier A)         — git, cargo, docker, npm
Phase S4: Filesystem Adapters (Tier B)   — ls, grep, find, file operations
Phase S5: Pipe & Redirect Support        — pipeline parsing, pipestatus, redirect notices

─── TIDE: UNIFIED SURFACE ─────────────────────────────────
Phase U1: Prefix Router                  — > $ : dispatch, unified input
Phase U2: Unified Output Stream          — interleaved command + conversation blocks
Phase U3: Surface Built-Ins              — :model, :cost, :status, :theme, :session
Phase U4: Environment Sync               — cwd, env vars shared between shell and Claude
Phase U5: Cross-Surface Interactions     — shell output → Claude context, AI tool output → rich rendering

─── FEED LAYER (from tug-feed.md) ─────────────────────────
Phase 8: Hook Capture                    — agent lifecycle events
Phase 9: Feed Correlation                — semantic enrichment
Phase 10: Feed CLI + Tugcast             — events reach browser
Phase 11: Agent-Internal Events          — file/command detail
Phase 12: Custom Block Renderers         — rich UI for agent output
```

### Phase Descriptions

#### Phase S1: Shell Bridge (Tugshell)

**Goal**: Build tugshell — the process that bridges bash/zsh to tugcast, analogous to tugtalk for Claude Code.

**Work**:
1. Shell process spawning with hidden pty, login interactive mode
2. Shell integration hook injection (preexec/precmd for zsh, PROMPT_COMMAND/DEBUG for bash)
3. OSC 133 marker emission for command boundary detection
4. Command string capture, exit code, duration, cwd tracking
5. Raw stdout/stderr capture from pty
6. Event emission to tugcast via new ShellOutput feed (0x50)
7. ShellInput feed (0x51) for sending commands from the UI

**Exit criteria**:
- User types a command in tugdeck, it executes in a real shell
- Command start/complete events arrive in tugdeck with correct metadata
- Raw stdout captured and delivered as text blocks
- Shell environment (PATH, aliases, functions) fully loaded from user's startup files
- cwd tracking works across cd commands

#### Phase S2: Adapter Registry + Fallback

**Goal**: Build the adapter dispatch system and the monospace text fallback renderer.

**Work**:
1. Adapter registry: maps command names to adapter functions
2. Command string parser: extract command name, detect pipes, detect redirections
3. Monospace text renderer: styled text blocks with ANSI SGR → CSS mapping
4. Redirect detection: show "output written to file.txt" annotations
5. Exit code display: non-zero codes highlighted, pipestatus shown

**Exit criteria**:
- Every command produces output in the unified surface (no silent failures)
- Unknown commands render as styled monospace with color support
- Redirected commands show redirect annotations
- Pipeline exit codes shown per-stage

#### Phase S3: Core Adapters (Tier A)

**Goal**: Rich graphical rendering for the highest-value commands.

**Priority order** (by usage frequency × rendering value):
1. `git status` — porcelain parsing → staged/unstaged file lists
2. `git log` — structured format → commit timeline
3. `git diff` — unified diff → side-by-side viewer
4. `cargo build` / `cargo test` — JSON messages → build/test results
5. `docker ps` / `docker images` — JSON format → sortable tables
6. `npm ls` / `npm test` — JSON output → dependency tree, test results
7. `curl` — response formatting, header/body separation

**Exit criteria**:
- Each adapter renders a purpose-built graphical component
- Components are interactive where appropriate (sortable, clickable, filterable)
- Fallback to monospace if adapter parsing fails (never a blank or broken display)

#### Phase S4: Filesystem Adapters (Tier B)

**Goal**: Rich rendering for filesystem and search commands.

1. `ls` / `eza` — direct filesystem stat → icon-rich file grid
2. `grep` / `rg` — match parsing → grouped results with highlighted matches
3. `find` / `fd` — path list → file tree
4. `cat` / `bat` — file content → syntax-highlighted viewer
5. `du` / `df` — disk usage → treemap or bar chart

#### Phase S5: Pipe & Redirect Support

**Goal**: Full pipeline and redirection semantics in the unified surface.

**Work**:
1. Pipeline command string parsing (split on `|`, handle quoting)
2. Per-stage adapter awareness (recognize `git log | head` as git output, truncated)
3. pipestatus array display on failure
4. Redirect detection and annotation
5. Subshell/background job awareness (display running jobs)

#### Phase U1: Prefix Router

**Goal**: The unified command input with `>` / `$` / `:` prefix routing.

**Work**:
1. Input parser: detect prefix, strip it, route to appropriate handler
2. Visual indicators: prefix character highlighted/styled differently
3. Default routing logic (when no prefix typed)
4. History: per-route history (shell history separate from Claude Code history)
5. Completion: route-aware tab completion (shell completions for `$`, slash commands for `>`)

#### Phase U2: Unified Output Stream

**Goal**: Interleaved shell command blocks and Claude Code conversation blocks in one scrollable surface.

**Work**:
1. Block model: every command (shell or Claude Code) is a discrete block with metadata
2. Block header: shows the command/prompt, route indicator, timestamp
3. Block body: rendered by the appropriate component (adapter output or conversation events)
4. Block footer: exit code/duration (shell) or cost/tokens (Claude Code)
5. Scroll management: new blocks appear at bottom, auto-scroll, manual scroll preserved

#### Phase U3: Surface Built-Ins

**Goal**: Implement all `:` commands — the UI-handled functionality.

Maps directly to the "UI Must Build" and "Terminal-Only Commands" sections from tug-conversation.md (U9-U11, C1-C15), now accessed via `:` prefix instead of `/`.

#### Phase U4: Environment Sync

**Goal**: Shell and Claude Code share working directory and environment context.

**Work**:
1. cwd tracking: shell cd → update surface → inform Claude Code next turn
2. Environment variable snapshot: make shell exports available to Claude Code tool calls
3. Display: current cwd always visible in surface chrome
4. Bidirectional: Claude Code's Bash tool calls execute in the shell's environment

#### Phase U5: Cross-Surface Interactions

**Goal**: The interactions that make the unified surface more than the sum of its parts.

1. Shell output → Claude context: select shell command output, send as context to Claude Code
2. Claude tool output → rich rendering: when Claude Code calls Bash, render the output with the same adapter pipeline as direct shell commands
3. Suggested commands: Claude Code can suggest shell commands; user clicks to execute
4. Error assistance: shell command fails → offer "ask Claude about this error"

---

## Research Agenda

Investigations needed before or during implementation:

### R1: Shell Hook Depth (before Phase S1)

- Verify zsh preexec/precmd capture works in practice across macOS zsh versions
- Test with complex startup files (oh-my-zsh, powerlevel10k, starship)
- Measure hook injection overhead
- Test interaction with direnv, nvm, conda environment managers

### R2: Command String Parsing (before Phase S2)

- Survey existing MIT-licensed shell parsers that can extract pipeline structure
- Define the subset of shell syntax we need to parse (commands, pipes, redirects)
- Test edge cases: heredocs, quoting, multi-line commands, subshells

### R3: Adapter Feasibility (before Phase S3)

- For each Tier A command: verify structured output mode, document exact invocation
- Test that structured output matches what users expect (e.g., `git status --porcelain=v2` captures everything `git status` shows)
- Measure latency of structured invocation vs. raw command

### R4: Nushell/PowerShell Patterns (informing Phase S2)

- Study Nushell's command-to-Value mapping for adapter design patterns
- Study PowerShell's type-to-view declarative mapping for renderer dispatch
- Study Jupyter's multi-representation (MIME-type) model for output format negotiation
- **License constraint**: MIT/Apache-2.0/BSD only. No GPL.

### R5: Completion System (informing Phase U1)

- Can we leverage zsh compsys completion specs for command-aware input suggestions?
- Can we use Fig/Amazon Q CLI specs (MIT) for argument structure?
- What does route-aware completion look like in practice?

---

## Open Design Questions

1. **Default route when no prefix**: Should the surface infer intent (natural language → Claude, command-like → shell), or require an explicit prefix? Inference is convenient but error-prone. Explicit is unambiguous but adds friction.

2. **Claude Code Bash tool rendering**: When Claude Code runs a Bash tool call, should the output go through the adapter pipeline? This would make `cargo build` look the same whether the human or Claude ran it. But it means the adapter must handle raw stdout from the tool result, not from tugshell's pty.

3. **Job control**: Background jobs (`$ sleep 100 &`) need representation. A job list panel? Inline status? How does this interact with Claude Code's background agents?

4. **Session model**: Is a Tide session one shell + one Claude Code session? Can you have multiple of each? How does session persistence work — resume both shell history and Claude Code conversation?

5. **Remote execution**: Tide surfaces could connect to remote machines. The shell bridge could spawn an SSH session instead of a local shell. How does this affect the adapter model?

6. **Mobile/tablet**: Is the prefix routing model usable on mobile where typing special characters is harder?

---

## Relationship to Existing Work

| Component | Role in Tide | Status |
|-----------|-------------|--------|
| **tugcast** | WebSocket server, binary framing, feed multiplexing | Existing, needs new FeedIds |
| **tugtalk** | Claude Code bridge (stream-json ↔ tugcast) | Existing, proven |
| **tugshell** | Shell bridge (bash/zsh ↔ tugcast) | **New** |
| **tugdeck** | Graphical rendering surface | Existing, needs unified output stream |
| **tugapp** | macOS app hosting tugdeck | Existing |
| **tug-feed** | Agent progress event layer | Planned, integrates with Tide |
| **tugplug** | Claude Code plugin (skills, agents) | Existing, unchanged |
| **tugcode** | Rust CLI (state, bank, worktree) | Existing, unchanged |

---

## Sources

- [tide-conversation-log.md](tide-conversation-log.md) — Full design conversation (2026-04-02)
- [tug-conversation.md](tug-conversation.md) — Claude Code transport exploration, UI phases, protocol documentation
- [transport-exploration.md](transport-exploration.md) — 35 tests documenting stream-json protocol
- [ws-verification.md](ws-verification.md) — WebSocket path verification
- [tug-feed.md](tug-feed.md) — Structured progress reporting architecture
- Nushell (MIT) — Structured pipeline patterns
- PowerShell (MIT) — Object pipeline, type-to-view mapping
- Jupyter kernel protocol (BSD) — Multi-representation output model
- Fig/Amazon Q CLI specs (MIT) — Command interface descriptions
