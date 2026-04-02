# Tide — The Unified Command Surface

*Replace the terminal. Keep the commands.*

**Codename:** Tide
**Reference:** [tide-conversation-log.md](tide-conversation-log.md), [tide-conversation-summary.md](tide-conversation-summary.md) — design conversation
**Prior work:** [tug-conversation.md](tug-conversation.md) — Claude Code transport exploration and UI phases (Phases 1-2c, 3A-3A.7 remain authoritative for completed work)

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

Tide builds on completed foundation work (Phases 1-3A.7) documented in [tug-conversation.md](tug-conversation.md). This section is the authoritative forward-looking roadmap — it integrates the Claude Code UI work (formerly Phases 3B-7) with the shell and unified surface work.

```
─── FOUNDATION (DONE) ─────────────────────────────────────
See tug-conversation.md for full details on completed phases.

Phase 1: Transport Exploration           — DONE (35 tests)
Phase 2: Transport Hardening             — DONE (T1-T7)
Phase 2b: WebSocket Verification         — DONE (4 issues found)
Phase 2c: WebSocket Fixes                — DONE (T8-T11)
Phase 3A: Markdown Rendering Core        — DONE
Phase 3A.1-3A.4: Worker/WASM Pipeline    — DONE
Phase 3A.5: Region Model + API           — DONE
Phase 3A.6: SmartScroll                  — DONE
Phase 3A.7: SmartScroll Hardening        — DONE

─── TIDE: RENDERING ───────────────────────────────────────
Phase T1: Content Block Types            — markdown, code, thinking, tool use, monospace
Phase T2: Shell Command Blocks           — git, cargo, file listing, build output renderers

─── TIDE: INPUT & ROUTING ─────────────────────────────────
Phase T3: Prefix Router + Prompt Input   — > $ : dispatch, history, completions, queueing

─── TIDE: SHELL INTEGRATION ───────────────────────────────
Phase T4: Shell Bridge (tugshell)        — spawn shell, hooks, command capture
Phase T5: Adapter Registry + Fallback    — command routing, ANSI→CSS, monospace fallback
Phase T6: Core Adapters (Tier A)         — git, cargo, docker, npm adapters
Phase T7: Filesystem Adapters (Tier B)   — ls, grep, find, cat adapters
Phase T8: Pipe & Redirect Support        — pipeline parsing, pipestatus, redirect notices

─── TIDE: CONVERSATION ────────────────────────────────────
Phase T9: Conversation Wiring            — Claude Code round-trip, permissions, questions, interrupt
Phase T10: Surface Built-Ins             — :model, :cost, :status, :theme, :session, :help
Phase T11: Session & Advanced            — session picker/fork/resume, images, /btw, permissions reset

─── TIDE: UNIFICATION ─────────────────────────────────────
Phase T12: Environment Sync              — cwd, env vars shared between shell and Claude Code
Phase T13: Cross-Surface Interactions    — shell↔Claude context sharing, error assistance

─── FEED LAYER (from tug-feed.md) ─────────────────────────
Phase F1: Hook Capture                   — agent lifecycle events to feed.jsonl
Phase F2: Feed Correlation               — semantic enrichment with step context
Phase F3: Feed CLI + Tugcast             — tugcode feed commands, events reach browser
Phase F4: Agent-Internal Events          — file/command detail from within agents
Phase F5: Custom Block Renderers         — rich UI for agent output
```

---

### Phase T1: Content Block Types {#content-block-types}

**Goal:** Rich rendering for all content types in the unified output stream. This is the block rendering engine that serves both Claude Code conversation content and shell command output. Built on the Phase 3A virtualization engine (BlockHeightIndex, RenderedBlockWindow, WASM pipeline, SmartScroll).

**Covers:** U1 (text accumulation), U5 (streaming indicator), U6 (thinking display), U7 (tool use display) from tug-conversation.md.

**Work:**

Markdown content types (extending the WASM pipeline):
- GFM markdown: paragraphs, headings, emphasis, links, images, lists, tables, blockquotes, horizontal rules. All pulldown-cmark block types.
- TugCodeBlock: syntax highlighting (evaluate Shiki WASM or lighter alternatives). Copy-to-clipboard, language label, line numbers, collapse/expand. Lazy — only highlight blocks in viewport.
- `--tugx-md-*` token aliases, `@tug-pairings` per L16/L19.
- `tug-*` custom block extension point for adapter-specific renderers.

Claude Code content types (rendering events from the stream-json protocol):
- Streaming text accumulation (U1): `assistant_text` deltas accumulated, verified on `complete`.
- Streaming cursor (U5): positioned at end of last block during partials, removed on `turn_complete`.
- Thinking block (U6): `thinking_text` events → collapsible block. "Thinking..." during stream, full text when complete.
- Tool use display (U7): `tool_use` → `tool_result` → `tool_use_structured`. Tool name, input, output, duration. Collapsible. Rich structured results for Read (file viewer), Bash (stdout/stderr separation), Edit (diff view).

Shell content types (rendering events from tugshell — stubs until Phase T4 delivers shell events):
- MonospaceBlock: styled text with ANSI SGR colors mapped to CSS. The fallback for unrecognized commands.
- Typed adapter blocks: GitStatusBlock, BuildOutputBlock, FileListBlock, etc. — component interfaces defined here, populated in Phases T6/T7.

**Exit criteria:**
- All standard GFM markdown renders correctly.
- Code blocks: syntax highlighting for top-20 languages. Lazy viewport-only highlighting.
- Thinking, tool use, and streaming blocks render correctly with Claude Code events.
- MonospaceBlock renders styled text with ANSI color support.
- Adapter block interfaces defined and rendering with stub/mock data.
- Gallery card demonstrates all content types.

---

### Phase T2: Shell Command Blocks {#shell-command-blocks}

**Goal:** The graphical components for the highest-value shell command adapters. These are the renderers that make `$ git status` look like a purpose-built app, not terminal text. Can be developed in parallel with Phase T4 (shell bridge) using mock data.

**Work:**

| Component | Renders | Interactive Features |
|-----------|---------|---------------------|
| GitStatusBlock | Staged/unstaged file lists, branch, ahead/behind | Status icons, clickable file paths |
| GitLogBlock | Commit timeline with author, date, message, refs | Clickable hashes, branch labels, scrollable |
| GitDiffBlock | Side-by-side or unified diff | Syntax highlighting, expand/collapse hunks |
| BuildOutputBlock | Compiler errors, warnings, test results | Clickable source locations, pass/fail counts |
| FileListBlock | Directory listing with icons, metadata | Sortable columns, size/date/permissions |
| SearchResultBlock | Grouped matches with context | Highlighted matches, clickable file:line |
| DiskUsageBlock | du/df output as bars or treemap | Sortable, drill-down |

Each component:
- Accepts typed structured data (not raw text)
- Has a clear data interface matching the adapter output schema from Phase T5/T6
- Falls back gracefully if data is malformed
- Respects theme tokens and Laws of Tug

**Exit criteria:**
- Each component renders correctly with mock structured data.
- Components are interactive where appropriate.
- Gallery card shows all components with representative data.

---

### Phase T3: Prefix Router + Prompt Input {#prefix-router-prompt-input}

**Goal:** The unified command input — where every interaction begins. Combines the prompt input layer (formerly Phase 4) with the prefix routing system. Addresses U12, U13, U19 from tug-conversation.md.

**Work:**

Core input:
- Enhanced `<textarea>`, 1 row default, grows to maxRows (8). L06.
- Keyboard: Enter submit, Shift+Enter newline, Cmd+Enter submit. IME-safe (CJK).
- Prefix detection: first character `>`, `$`, or `:` determines route. Visual indicator (prefix styled differently, route label).
- Default route when no prefix: design decision TBD (context-dependent vs. require prefix).

Per-route features:
- `>` (Claude Code): slash command popup merging `system_metadata.slash_commands` + `.skills` (U12). `@` file completion (U13). Message queueing during active turn — disable send, show indicator, use `interrupt` to cancel (U19).
- `$` (Shell): shell completion from zsh compsys / bash-completion (deferred to Phase T8 or later). Command history separate from Claude Code history.
- `:` (Surface): auto-complete surface built-in names.

History:
- `PromptHistoryStore`: per-route, per-card. IndexedDB. `useSyncExternalStore` (L02).
- Up/down arrows navigate history within the current route.

**Exit criteria:**
- Prefix routing works: `>`, `$`, `:` dispatch to correct handler.
- Slash command popup works for `>` route.
- `@` file completion works for `>` route.
- History navigation works per-route.
- Send disabled during active Claude Code turn.
- CJK input works.

---

### Phase T4: Shell Bridge (Tugshell) {#shell-bridge}

**Goal:** Build tugshell — the process that bridges bash/zsh to tugcast, analogous to tugtalk for Claude Code.

**Work:**
1. Shell process spawning with hidden pty, login interactive mode (`zsh -li`)
2. Shell integration hook injection (preexec/precmd for zsh, PROMPT_COMMAND/DEBUG for bash)
3. OSC 133 marker emission for command boundary detection
4. Command string capture, exit code, duration, cwd tracking
5. Raw stdout/stderr capture from pty
6. Event emission to tugcast via new ShellOutput feed (0x50)
7. ShellInput feed (0x51) for receiving commands from the UI
8. Process lifecycle management (kill on tugcast shutdown, no zombies)

**Exit criteria:**
- User types a command in tugdeck, it executes in a real shell
- `command_start` / `command_output` / `command_complete` events arrive in tugdeck with correct metadata
- Raw stdout captured and delivered as text blocks
- Shell environment (PATH, aliases, functions) fully loaded from user's startup files
- cwd tracking works across cd commands
- No orphaned shell processes on quit

---

### Phase T5: Adapter Registry + Fallback {#adapter-registry}

**Goal:** Build the command adapter dispatch system. This is the layer that transforms raw shell output into typed, structured events.

**Work:**
1. Adapter registry: maps `(command_name, args)` → adapter function
2. Command string parser: extract command name from preexec string, detect pipes, detect redirections
3. Adapter dispatch: before command runs, check registry. For recognized commands, may run structured variant (e.g., `git status --porcelain=v2`) instead of/alongside the raw command.
4. ANSI SGR → CSS mapping for the monospace fallback renderer
5. Redirect detection: parse command string for `>`, `>>`, `2>`, show annotation
6. Exit code display: non-zero codes highlighted, `pipestatus` per-stage on failure

**Exit criteria:**
- Recognized commands produce typed structured output events
- Unknown commands fall back to MonospaceBlock with ANSI color support
- Redirected commands show redirect annotations
- Pipeline exit codes shown per-stage
- Adapter parsing failures never produce blank output — always fall back to monospace

---

### Phase T6: Core Adapters (Tier A) {#core-adapters}

**Goal:** Adapters for commands with native structured output. Highest value, lowest effort.

**Priority order** (by usage frequency × rendering value):
1. `git status` — `--porcelain=v2` → GitStatusBlock
2. `git log` — `--format=<structured>` → GitLogBlock
3. `git diff` — unified diff parsing → GitDiffBlock
4. `cargo build` / `cargo test` — `--message-format=json` → BuildOutputBlock
5. `docker ps` / `docker images` — `--format '{{json .}}'` → sortable tables
6. `npm ls` / `npm test` — `--json` → dependency tree, test results
7. `curl` — `-w '%{json}'` → response viewer

**Exit criteria:**
- Each adapter invokes the structured variant and produces typed output
- Output renders via the corresponding component from Phase T2
- Fallback to monospace if structured invocation fails
- git adapter alone covers ~20% of typical shell usage

---

### Phase T7: Filesystem Adapters (Tier B) {#filesystem-adapters}

**Goal:** Adapters for filesystem and search commands. These bypass pty output and query the filesystem directly where possible.

1. `ls` / `eza` — direct stat() → FileListBlock (icon-rich grid, sortable)
2. `grep` / `rg` — `rg --json` or parse match format → SearchResultBlock
3. `find` / `fd` — path list → file tree or flat list
4. `cat` / `bat` — read file directly → syntax-highlighted viewer
5. `du` / `df` — parse columnar output → DiskUsageBlock

---

### Phase T8: Pipe & Redirect Support {#pipe-redirect}

**Goal:** Full pipeline and redirection semantics in the unified surface.

**Work:**
1. Pipeline command string parsing (split on `|`, handle quoting edge cases)
2. Run full pipeline natively through hidden pty — don't intercept intermediate stages
3. Per-stage adapter awareness: recognize `git log | head` as git output, truncated; `ls | grep foo` as filtered file listing
4. `pipestatus` array display on failure
5. Redirect detection and annotation ("Output written to build.log" with file link)
6. Background job awareness: `$ sleep 100 &` shows in a job list
7. Shell completion integration: leverage zsh compsys for contextual suggestions

---

### Phase T9: Conversation Wiring {#conversation-wiring}

**Goal:** Wire the Claude Code conversation loop end-to-end through the unified surface. Addresses U2, U3, U4, U8, U14, U23 from tug-conversation.md.

**Work:**
- Submit `>` prompts as `user_message` via CodeInput feed. Stop button sends `interrupt` (U4).
- Permission dialog (U2): `control_request_forward` with `is_question: false`. Show tool name, input, reason. Allow/deny buttons. Permission suggestions for "always allow."
- AskUserQuestion dialog (U3): `control_request_forward` with `is_question: true`. Render questions with options, single/multi-select. Respond with `question_answer`.
- Subagent activity display (U8): `tool_use: Agent` brackets subagent lifetime. Nested tool calls visible. Show agent type and progress.
- Session handling (U14): detect pending session IDs (`"pending"`, `"pending-fork"`). Wait for non-pending ID before enabling input.
- Task progress display (U23): `system:task_started/progress/completed` events for agent lifecycle indicators alongside U8.

**Exit criteria:**
- Full round-trip: type `>` prompt → streamed markdown response with thinking + tool use
- Permission and question dialogs work end-to-end
- Interrupt stops streaming, shows accumulated text
- Subagent activity visible
- Session new/fork handled cleanly

---

### Phase T10: Surface Built-Ins {#surface-built-ins}

**Goal:** Implement all `:` commands — the Tide surface's own built-in functionality. This is the unified replacement for tug-conversation.md items U9-U11, U16-U17, U20-U22, C1-C4, C10-C15.

**Work:**

| Command | What It Does | Data Source | Covers |
|---------|-------------|-------------|--------|
| `:model [name]` | Switch Claude Code model, show current | Send `model_change`; `system_metadata` | U9, C2 |
| `:permission [mode]` | Switch permission mode, cycle through | Send `permission_mode` | U10, C3 |
| `:cost` | Show cost/token display | Cached `cost_update` events | U11, C1 |
| `:status` | Show session, model, context, tools | Cached `system_metadata` + `cost_update.usage` | C1 |
| `:clear` | Start new Claude Code session | Send `session_command: "new"` | C4 |
| `:theme [name]` | Switch visual theme | Surface state | C14 |
| `:compact [focus]` | Trigger compaction with optional focus | Invoke `/compact` skill | C10 |
| `:help` | Show help, available commands | Surface state | C15 |
| `:vim` | Toggle vim keybinding mode in input | Surface state | C13 |

Additional indicators (not commands, but surface chrome):
- API retry indicator (U16): `api_retry` events — attempt count, delay, error type
- Compaction indicator (U17): `compact_boundary` events
- Plan mode choices (U20): approve/reject/keep-planning after `EnterPlanMode`
- Stop background task (U21): `{ type: "stop_task", task_id }` button
- Context window budget (U22): ~20% startup overhead in token counter

**Exit criteria:**
- All `:` commands work via the prefix router
- Model and permission mode switch correctly, surface reflects changes
- Cost and status display accurate and current
- Indicators visible when events arrive

---

### Phase T11: Session & Advanced {#session-advanced}

**Goal:** Session management, remaining command reimplementations, and advanced features. Covers C5-C9, C11-C12, U15, U18 from tug-conversation.md.

**Work:**
- `:session list` / `:session resume [id]` (C5): session picker — list, preview, rename, filter
- `:session fork` / `:session branch` (C12): fork current session via `session_command: "fork"`
- `:session rename [name]` (C11): update session metadata
- `:export` (C7): serialize conversation from accumulated events
- `:copy` (C8): copy last assistant response to clipboard
- `:btw [question]` (C9): side question — separate API call, no history impact. Renders as ephemeral overlay.
- `:diff` (C6): run git diff, render with GitDiffBlock from Phase T2
- Image attachments (U15): base64 in `user_message.attachments`. Drag-drop/paste into `>` prompt.
- Session-scoped permission reset (U18): re-prompt for permissions after session resume.

**Exit criteria:**
- Session picker works (list, resume, rename, fork)
- Image attachments work via drag-drop/paste
- Export and copy functional
- Side question (/btw) renders as ephemeral overlay
- Permissions re-prompt correctly after session resume

---

### Phase T12: Environment Sync {#environment-sync}

**Goal:** Shell and Claude Code share working directory and environment context — the glue that makes the unified surface feel like one environment, not two.

**Work:**
1. cwd tracking: shell `cd` → tugshell reports new cwd → surface updates display → Claude Code's next turn picks up new cwd
2. Environment variable snapshot: shell exports available to Claude Code's Bash tool calls (tugshell can snapshot the current environment)
3. Display: current cwd always visible in surface chrome
4. Bidirectional: Claude Code's Bash tool calls execute in the shell's environment context
5. Claude Code `cd` (via Bash tool): shell environment updated to match

**Exit criteria:**
- `$ cd src` in shell updates the surface cwd; next `>` prompt to Claude Code uses the new cwd
- Environment variables exported in shell visible to Claude Code tool calls
- cwd display always accurate

---

### Phase T13: Cross-Surface Interactions {#cross-surface}

**Goal:** The interactions that make the unified surface more than the sum of its parts.

1. **Shell output → Claude context**: select shell command output block, action to "send to Claude" — injects the output as context in the next `>` prompt.
2. **Claude tool output → rich rendering**: when Claude Code calls Bash (e.g., runs `cargo build`), the `tool_use_structured` output goes through the same adapter pipeline as `$ cargo build` — same BuildOutputBlock renderer.
3. **Suggested commands**: Claude Code can suggest shell commands in its response; user clicks to execute via `$` route.
4. **Error assistance**: shell command fails → surface offers "ask Claude about this error" action, pre-filling a `>` prompt with the error context.

**Exit criteria:**
- Shell output selectable and sendable to Claude Code as context
- Claude Code's Bash tool output renders with adapter components
- Click-to-execute for suggested shell commands
- Error assistance flow works end-to-end

---

### Phases F1-F5: Feed Layer {#feed-layer}

See [tug-feed.md](tug-feed.md) for full architecture. These phases add structured agent progress reporting to the unified surface.

| Phase | Goal | Scope |
|-------|------|-------|
| F1: Hook Capture | Agent lifecycle → `raw-events.jsonl` | Shell scripts + hooks.json |
| F2: Feed Correlation | Semantic enrichment → `feed.jsonl` | Correlation logic |
| F3: Feed CLI + Tugcast | `tugcode feed` + browser delivery | Rust CLI + tugcast feed (0x60) |
| F4: Agent-Internal Events | File/command detail within agents | Agent frontmatter hooks |
| F5: Custom Block Renderers | Rich agent output UI in Tide surface | React components |

---

## Research Agenda

Investigations needed before or during implementation:

### R1: Shell Hook Depth (before Phase T4)

- Verify zsh preexec/precmd capture works in practice across macOS zsh versions
- Test with complex startup files (oh-my-zsh, powerlevel10k, starship)
- Measure hook injection overhead
- Test interaction with direnv, nvm, conda environment managers
- Verify OSC 133 marker emission works through the hidden pty

### R2: Command String Parsing (before Phase T5)

- Survey existing MIT-licensed shell parsers that can extract pipeline structure
- Define the subset of shell syntax we need to parse (commands, pipes, redirects)
- Test edge cases: heredocs, quoting, multi-line commands, subshells

### R3: Adapter Feasibility (before Phase T6)

- For each Tier A command: verify structured output mode, document exact invocation
- Test that structured output matches what users expect (e.g., `git status --porcelain=v2` captures everything `git status` shows)
- Measure latency of structured invocation vs. raw command

### R4: Nushell/PowerShell Patterns (informing Phase T5)

- Study Nushell's command-to-Value mapping for adapter design patterns
- Study PowerShell's type-to-view declarative mapping for renderer dispatch
- Study Jupyter's multi-representation (MIME-type) model for output format negotiation
- **License constraint**: MIT/Apache-2.0/BSD only. No GPL.

### R5: Completion System (informing Phase T3/T8)

- Can we leverage zsh compsys completion specs for command-aware input suggestions?
- Can we use Fig/Amazon Q CLI specs (MIT) for argument structure?
- What does route-aware completion look like in practice?

---

## Item Coverage Map

Every forward-looking item from tug-conversation.md is accounted for in a Tide phase. Nothing is dropped.

### UI Must Build (U1-U23)

| Item | Description | Tide Phase |
|------|-------------|------------|
| U1 | Text accumulation (deltas → buffer) | T1 |
| U2 | Permission dialog | T9 |
| U3 | AskUserQuestion dialog | T9 |
| U4 | Interrupt button | T9 |
| U5 | Streaming indicator/cursor | T1 |
| U6 | Thinking/reasoning display | T1 |
| U7 | Tool use display | T1 |
| U8 | Subagent activity | T9 |
| U9 | Model switcher | T10 |
| U10 | Permission mode switcher | T10 |
| U11 | Cost/token display | T10 |
| U12 | Slash command popup | T3 |
| U13 | `@` file completion | T3 |
| U14 | Session new/fork handling | T9 |
| U15 | Image attachments | T11 |
| U16 | API retry indicator | T10 |
| U17 | Compaction indicator | T10 |
| U18 | Session-scoped permission reset | T11 |
| U19 | Message queueing during turn | T3 |
| U20 | Plan mode choices | T10 |
| U21 | Stop background task | T10 |
| U22 | Context window budget | T10 |
| U23 | Task progress events | T9 |

### Terminal-Only Commands (C1-C15)

| Item | Command | Tide Phase |
|------|---------|------------|
| C1 | `/status` | T10 (`:status`) |
| C2 | `/model` | T10 (`:model`) |
| C3 | `/permissions` | T10 (`:permission`) |
| C4 | `/clear` | T10 (`:clear`) |
| C5 | `/resume` | T11 (`:session resume`) |
| C6 | `/diff` | T11 (`:diff`) |
| C7 | `/export` | T11 (`:export`) |
| C8 | `/copy` | T11 (`:copy`) |
| C9 | `/btw` | T11 (`:btw`) |
| C10 | `/compact` | T10 (`:compact`) |
| C11 | `/rename` | T11 (`:session rename`) |
| C12 | `/branch`, `/rewind` | T11 (`:session fork`) |
| C13 | `/vim` | T10 (`:vim`) |
| C14 | `/color`, `/theme` | T10 (`:theme`) |
| C15 | `/help` | T10 (`:help`) |

### Exploration Areas (E1-E6)

| Item | Area | Status |
|------|------|--------|
| E1 | Slash command invocation | Resolved (T1, T2 in Phase 2) |
| E2 | Plugin system | Resolved |
| E3 | Hooks visibility | Deferred — non-blocking |
| E4 | Tugcast WebSocket layer | Resolved (Phase 2b/2c) |
| E5 | Session management | T11 |
| E6 | Advanced patterns (background, MCP) | Deferred — non-blocking |

---

## Open Design Questions

1. **Default route when no prefix**: Should the surface infer intent (natural language → Claude, command-like → shell), or require an explicit prefix? Inference is convenient but error-prone. Explicit is unambiguous but adds friction.

2. **Claude Code Bash tool rendering**: When Claude Code runs a Bash tool call, should the output go through the adapter pipeline? This would make `cargo build` look the same whether the human or Claude ran it. But it means the adapter must handle raw stdout from the tool result, not from tugshell's pty. (Addressed in T13 but design TBD.)

3. **Job control**: Background jobs (`$ sleep 100 &`) need representation. A job list panel? Inline status? How does this interact with Claude Code's background agents?

4. **Session model**: Is a Tide session one shell + one Claude Code session? Can you have multiple of each? How does session persistence work — resume both shell history and Claude Code conversation?

5. **Remote execution**: Tide surfaces could connect to remote machines. The shell bridge could spawn an SSH session instead of a local shell. How does this affect the adapter model?

6. **Mobile/tablet**: Is the prefix routing model usable on mobile where typing special characters is harder?

---

## Deferred

- **tug-rich-text** — Monaco editor wrapper. Future.
- **tug-search-bar** — TugInput + TugButton. Future.
- **Tiptap migration** for prompt input (@-mentions, ghost text). Future.
- **Mermaid, KaTeX** — markdown extensions via extension point. When needed.
- **E3 (hooks visibility)** — Hooks run silently. Non-blocking.
- **E6 (advanced patterns)** — Background tasks, MCP, elicitation. Non-blocking.
- **Learning height estimator** — converge on measured heights. Future enhancement.
- **Shell completion integration** — leveraging zsh compsys from the graphical surface. Research item R5.

---

## Resolved Questions

1. **Streaming text model** — Deltas on partials, full text on complete. UI accumulates. (Phase 1 finding)
2. **Slash command invocation** — Works via `user_message`. Fixed with T1+T2. (Phase 2 fix)
3. **Process lifecycle** — Process groups, parent-death watchdog, kill_on_drop. (Phase 2 fix)
4. **Production Bun dependency** — Eliminated. Tugtalk standalone binary. (Phase 2 fix)
5. **WebSocket path** — Fully verified. Wire protocol documented. Issues T8-T11 fixed. (Phase 2b/2c)
6. **Markdown performance** — pulldown-cmark WASM: 1MB in 14ms. Workers removed. (Phase 3A.4)
7. **Scroll management** — SmartScroll: six-phase state machine, follow-bottom, all input methods. (Phase 3A.6/3A.7)
8. **Project codename** — "Tide" for the unified command surface vision. Tugdeck remains the rendering implementation.

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
