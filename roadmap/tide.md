# Tide — The Unified Command Surface

*Replace the terminal. Keep the commands.*

**Codename:** Tide
**Reference:** [tide-conversation-log.md](tide-conversation-log.md), [tide-conversation-summary.md](tide-conversation-summary.md) — design conversation
**Prior work:** [tug-conversation.md](tug-conversation.md) — Claude Code transport exploration and UI phases (Phases 1-2c, 3A-3A.7 remain authoritative for completed work)

---

## Vision

### Why now

The command line traces its lineage to 19th-century teleprinters. The modern reimagining is the DEC VT100 — a 1978 terminal that could address cursor positions on a character grid. Typing clipped text commands and getting minimally-formatted text responses was the outside limit of what the hardware could do. Over time, this `tty` model became a standard so successful and so durable that every Linux, Mac, and Unix-like computer still offers pseudo-terminals (`pty`) as a primary interface, and millions of people use shells like Bash and Zsh to get work done every day.

Anthropic took the curious step of adopting the terminal as the user interface for Claude Code — and this turned out to be a brilliant choice. The terminal is all about text, and so are LLMs. Text-only usage patterns and conventions proved to be an excellent way to bring AI assistance to complex software development work.

Two things converged that didn't exist five years ago. First, LLMs made "talk to your computer in natural language" a genuine daily workflow. Claude Code proved that a text-based command interface can orchestrate sophisticated multi-step work — reading files, editing code, running builds, managing git — over a structured protocol that happens to run inside a terminal but doesn't need one. Second, the commands developers actually run have quietly grown structured output capabilities. `git status --porcelain` has existed for years. `cargo --message-format=json` shipped in 2017. Docker, kubectl, npm, aws CLI — all speak JSON now. The ecosystem moved toward machine-readable output because CI/CD pipelines need it. But nobody built a *human-facing* surface that takes advantage of this.

A structured AI protocol on one side. Structured command output on the other. Both being flattened through a 1978 display device.

But the terminal bundles two things we don't typically separate in our minds: the **rendering surface** (the tty/pty/VT100 character grid) and the **command interpreter** (the shell or tool that accepts commands and produces output). The rendering surface is the part stuck in 1978. The command interpreters — shells, compilers, version control, AI assistants — have evolved enormously. They're held back by a display device that can only paint characters into a grid.

We can divide these. Leave the tty/pty behind. Provide a graphical foundation layer for command interpreters — both the shells (Bash, Zsh) and Claude Code.

### What Tide is

Tide is a graphical command surface where humans and AI both issue commands and see results, rendered at the full fidelity of a graphical UI. There is no terminal pane and no AI pane — one surface, one stream of command blocks, each rendered with purpose-built graphical components.

The programs people use most — git, cargo, ls, grep, curl — produce structured or line-oriented output that was only ever flattened into ANSI escape sequences because the terminal was the only display available. Tide provides a better display. For recognized commands, it renders rich graphical components: sortable file listings, clickable commit timelines, syntax-highlighted diffs, build output with source links. For everything else, it renders styled monospace text. The VT100 character grid never appears.

Claude Code already broke free of the terminal with `--output-format stream-json`. It speaks a typed protocol: structured JSON events with semantic meaning. The transport exploration (35 tests) documented this protocol. The tugcast WebSocket layer carries it to tugdeck. This is the proof of concept — a post-terminal command experience that already works.

Tide extends this approach to the shell. The same method — investigate inputs and outputs, define structured events, render graphically — applied to bash, zsh, and the ~20 commands that cover 80% of developer shell usage. The adapter registry auto-detects known commands and produces structured data without the user asking for it. This is the gap nobody else fills: Nushell, PowerShell, and Jupyter all treat external commands as opaque text. Tide recognizes them and renders them richly.

### Why this approach works

Previous attempts at graphical shells failed because they broke compatibility. TermKit (2011) tried to replace everything at once and couldn't run real commands. Tide's approach avoids this through three design choices:

**We're paying the rendering cost anyway.** The Claude Code transport exploration proved that a graphical UI must rebuild ~30 features from scratch (U1-U23, C1-C15) because terminal-only commands produce nothing in stream-json mode. That's not a bug — it's evidence that the terminal was always doing two jobs (interpreting commands *and* rendering output) and when you strip the terminal, you have to replace both. If you're building that rendering layer for Claude Code, extending it to shell commands is incremental. The marginal cost of a git status adapter is small compared to the cost of the conversation rendering engine.

**The method is the same for both halves.** The Claude Code side was built by investigating the stream-json protocol — mapping every event type, documenting inputs and outputs, then building renderers for each. The shell side uses the same method: for each command we want on the surface, investigate its structured output modes, define the adapter, build the renderer. Expand the "UI Must Build" set to encompass the most-used shell commands. Do for each what we did for each Claude Code event type.

**Full compatibility via hidden pty means nothing breaks.** Tide runs unmodified bash/zsh. Every command works on day one. The worst case for an unrecognized command is styled monospace text — which is already better than most terminal emulators' rendering. You can paste any command from Stack Overflow and it runs. Adapters add progressive richness without ever sacrificing compatibility.

**The adapter model is incremental — focus on the fat part of the curve.** You don't need 20 adapters to ship. Git alone covers 15-25% of developer shell usage. Add cargo and you have the two tools a Rust developer uses most. Each adapter makes the surface meaningfully better for some slice of daily work, and the fallback handles everything else. The long tail of obscure commands never goes away, but the fat part under the curve — the 20 commands that cover 80% of usage — isn't daunting. The registry grows over time, and the fallback (styled monospace with SGR color mapping) is genuinely good for everything else.

---

## What We're Replacing

Understanding the pty architecture explains why the terminal is limited and what Tide must do differently.

### The pty abstraction

A pty (pseudo-terminal) is a kernel-level bidirectional byte pipe with a **line discipline** in the middle. `posix_openpt()` creates a master/slave pair. The terminal emulator holds the master fd; the shell gets the slave fd as its stdin/stdout/stderr.

The line discipline handles: character echo, line editing (backspace, Ctrl-U), and signal generation (Ctrl-C → SIGINT, Ctrl-Z → SIGTSTP). When a program calls `cfmakeraw()`, the discipline passes bytes through unprocessed — this is how full-screen programs (vim, htop, Claude Code's TUI) work.

Data flowing master→slave: keystrokes, encoded as raw bytes or escape sequences (`\x1b[A` for arrow-up). Data flowing slave→master: UTF-8 text interleaved with ANSI/xterm escape sequences. The core sequences: `CSI n;m H` (cursor position), `CSI n m` (SGR color/style), `CSI 2 J` (clear screen), `OSC` sequences (title, hyperlinks). The terminal emulator parses these and paints pixels.

### Why this is limiting

**No schema, no types, no versioning.** The protocol is implicit — accreted over decades with no coordination body. Feature detection relies on the `TERM` environment variable and terminfo databases. Each terminal invents its own extensions (Kitty graphics, iTerm2's OSC 1337, sixel) with fragile detection via query-and-timeout.

**Everything must serialize into one byte stream.** There's no out-of-band channel. Text, colors, cursor positioning, images, hyperlinks, clipboard access — all encoded as escape sequences interleaved with content. A program cannot send structured data alongside its output. A terminal emulator cannot ask "what kind of output is this?"

**Fixed-size kernel buffer** (typically 4096 bytes on macOS). Writes block when full. This creates backpressure that affects program behavior — fast output from `cat` of a large file stalls differently than slow output from a network tool.

**Terminal multiplexers (tmux, screen) are lowest-common-denominator filters.** They sit between shell and terminal, maintaining a virtual screen buffer for detach/reattach. But they must parse and re-emit escape sequences, which means advanced features (Kitty graphics, custom OSC sequences) don't pass through. Passthrough modes exist but are fragile.

**Modern extensions hit the ceiling.** Kitty's graphics protocol embeds raster images via escape sequences (base64-encoded or shared memory). Sixel encodes pixels inline. These prove the desire for rich output — but they're hacks built on a text-only transport. There's no layout model, no component system, no interactivity beyond "emit bytes and hope the terminal understands."

### What Claude Code already proved

Claude Code's `--output-format stream-json` mode bypasses the entire pty model. It communicates via **typed JSON events over stdio** — no escape sequences, no character grid, no terminal emulation. A graphical host spawns it as a child process, reads/writes its stdio, and renders its output with full fidelity.

The architectural lesson is not just that a structured protocol is *possible* — it's that it's *better*. Permission dialogs with allow/deny buttons. Tool use blocks showing name, input, output, and duration. Streaming text with delta accumulation. Cost tracking with per-turn token breakdowns. Subagent activity with nested tool calls. None of these would be possible through the pty. The terminal version of Claude Code works *despite* the terminal, not because of it. Tugtalk exists specifically to bridge Claude Code's structured protocol onto the terminal. Tide eliminates the need for that bridge — the structured protocol goes directly to a surface that can render it natively.

This is the template for Tide's shell side: instead of parsing a byte stream that flattens everything into characters, communicate via typed events and render with purpose-built components.

### What we keep, what we discard

| Layer | Status | Rationale |
|-------|--------|-----------|
| **Kernel pty** | Hidden — and often bypassed | bash/zsh check `isatty()` — they need a tty to run interactively. Tugshell holds the master fd internally. But for recognized commands, the adapter doesn't even read the pty output. The git adapter runs `git status --porcelain=v2` directly. The ls adapter calls `stat()` on directory entries. The pty exists to keep the shell happy and to capture output from *unrecognized* commands. For recognized commands, it's bypassed entirely. |
| **Line discipline** | Active (hidden) | Signal generation (Ctrl-C → SIGINT) works through the pty. We need this. |
| **ANSI SGR sequences** | Mapped to CSS | Bold, italic, underline, 256-color, true-color → mapped to CSS properties in the monospace fallback renderer. SGR is the one piece of the VT100 legacy that works well for our purposes — it's text style annotation, not hardware simulation. A large percentage of command output uses SGR and nothing else: `grep --color`, `git diff` with color, `cargo` warnings in yellow, errors in red. The fallback renderer that correctly maps SGR to CSS handles this output *better than most terminals render it*. The fallback is a genuine product, not a concession. |
| **VT100 cursor addressing** | Discarded | No `CSI n;m H`, no `CSI 2 J`. Programs that rely on cursor-addressable screens (vim, htop, less) are excluded from the unified surface — available via the separate terminal card. |
| **Terminal multiplexer** | Not needed | Tide's shell bridge (tugshell) holds the pty directly — no tmux/screen in the middle. This is simpler than the existing tugcast terminal path, which goes through tmux. No passthrough filtering, no lowest-common-denominator constraints. |
| **Escape sequence extensions** | Discarded | No Kitty graphics, no sixel, no OSC 1337. These are heroic engineering in service of a fundamentally wrong abstraction — encoding pixels as escape sequences injected into a text stream. Tide has a real graphics layer and doesn't need them. Their existence is evidence that the terminal community wants what we're building. |

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
│  │  Claude Code → tugcode      │                         │
│  │  Shell → tugshell           │                         │
│  └──┬──────────┬───────────────┘                         │
│     │          │                                         │
│  ┌──▼────┐  ┌──▼──────────────────┐                      │
│  │tugcode│  │tugshell             │                      │
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

Shells have used a tiered dispatch model for decades: built-in commands (`cd`, `export`) are handled by the shell itself without spawning a process; functions and aliases expand within the shell; external commands fork and exec a binary. This pattern is proven and well-understood. Tide adopts the same model with three tiers — surface built-ins, Claude Code pass-through, and shell pass-through.

The surface built-ins are the exact analog of shell built-ins. `cd` in bash doesn't spawn a process — it modifies the shell's own state. Tide's `:model` switcher doesn't talk to Claude Code or the shell — it modifies the surface's own state (and sends a `model_change` message as a side effect). The surface built-ins form a **stable layer that exists regardless of whether Claude Code or the shell is connected**. You can display cost, switch themes, manage sessions, and navigate history even if both backends are down. This is exactly how shell built-ins work — `cd`, `echo`, `export` all work even if PATH is empty and no external commands are available.

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

Routed to Claude Code via tugcode/tugcast stream-json protocol. Full event stream returns.

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

Tugshell is the analog of tugcode. Tugcode bridges Claude Code's stream-json to tugcast. Tugshell bridges bash/zsh to tugcast.

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

**Design principle: prefer structured invocation over pty parsing.** Parsing pty output is fragile — column positions shift between versions, ANSI color codes confuse parsers, locale settings change number and date formatting, and wide characters break column alignment. Structured invocation is reliable: JSON is JSON, porcelain format is a stable contract. Where a command offers a machine-readable output mode, the adapter should use it rather than parsing the human-readable output. The user typed `git status`; the adapter fulfills that *intent* by running `git status --porcelain=v2`. The raw command is the intent; the adapter chooses the best means to produce structured data from it.

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

## Tugcast: The Multiplexer

### One pipe, one multiplexer, many backends

There is one WebSocket connection between tugdeck and tugcast. Every frame, in both directions, flows over that single connection. FeedIds are routing labels inside the pipe — not separate connections. This is the same pattern as HTTP/2 streams over a single TCP connection.

```
                    ONE WebSocket (bidirectional)
                    ════════════════════════════
tugdeck ◄──────────────────────────────────────────────► tugcast
                    
        Outbound frames (tugdeck → tugcast):
          [0x41] CodeInput  → routed to tugcode
          [0x61] ShellInput → routed to tugshell
          
        Inbound frames (tugcast → tugdeck):
          [0x40] CodeOutput  ← from tugcode
          [0x60] ShellOutput ← from tugshell
          [0x10] Filesystem  ← from file watcher
          [0x20] Git         ← from git watcher
          [0x30] Stats       ← from stats collector
          [0x50] Defaults    ← from tugbank
          [0x70] TugFeed     ← from feed capture
          [0xFF] Heartbeat   ← from tugcast
```

Tugcast is the single point of contact for tugdeck. Behind it, tugcast manages N backend processes. Each backend is a **bridge** — a process that speaks a service-specific protocol on one side and emits/receives typed JSON events via tugcast on the other. Bridges have independent lifecycles and failure modes: if Claude Code crashes, the shell keeps working; if the shell hangs, Claude Code still responds.

### Bridge naming convention

Each bridge is named `tug{suffix}` where the suffix identifies the service it bridges to. The bridge speaks the service's native protocol on one side and emits/receives typed JSON events via tugcast on the other.

| Bridge | Service | Protocol | FeedIds |
|--------|---------|----------|---------|
| **tugcode** (currently tugtalk — rename in Phase T0) | Claude Code | stream-json over stdio | 0x40/0x41 |
| **tugshell** | bash/zsh | hidden pty + shell hooks | 0x60/0x61 |
| *(future)* | Another LLM, service, or tool | TBD | next available pair |

### Feed ID table

| FeedId | Feed | Direction | Backend | Status |
|--------|------|-----------|---------|--------|
| 0x00 | TerminalOutput | server → client | tmux (terminal card) | Existing |
| 0x10 | Filesystem | server → client | file watcher | Existing |
| 0x20 | Git | server → client | git watcher | Existing |
| 0x30-0x33 | Stats | server → client | stats collector | Existing |
| 0x40 | CodeOutput | server → client | tugcode | Existing |
| 0x41 | CodeInput | client → server | tugcode | Existing |
| 0x50 | Defaults | server → client | tugbank | Existing |
| **0x60** | **ShellOutput** | **server → client** | **tugshell** | **New** |
| **0x61** | **ShellInput** | **client → server** | **tugshell** | **New** |
| 0x70 | TugFeed | server → client | feed capture | Planned |

### Extensibility

The FeedId namespace is an open byte range (0x00-0xFF). Adding a new backend service means:

1. Write a `tug{service}` bridge process that speaks the service's protocol and emits typed JSON events
2. Assign the next available FeedId pair
3. Register in tugcast's router
4. Tugdeck starts rendering events from the new FeedId — using existing block components or new ones if the service has unique event types

Nothing else changes. No tugcast refactoring, no protocol changes, no tugdeck rewiring. This is what makes the architecture flexible enough to accommodate a new LLM provider (Gemini, a future model), a new developer tool, or a service that doesn't exist today. The protocol contract — binary framing with FeedId routing, typed JSON payloads — is the stable layer. What's behind each FeedId can change independently.

**Critical design constraint:** Tugcast must route opaquely. It forwards frames by FeedId without interpreting the JSON payloads. Event type semantics live in tugdeck and the bridge processes, not in the multiplexer. If tugcast needs to understand payload contents to route correctly, the abstraction is leaking.

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

The shell and Claude Code environments are **parallel but synchronized** — not unified. They are separate OS processes, each with their own environment, and they can't share memory. The surface keeps them in sync: shell `cd` → surface updates its cwd → Claude Code's next turn inherits the new cwd. Environment variables exported in the shell are available to Claude Code's Bash tool calls (tugshell can snapshot the current environment and pass it through). This is the pragmatic model — full fidelity for each process, with the surface as the synchronization point.

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

## Research Findings

These findings are from five research threads conducted during the initial Tide design conversation. They are the evidence base for the design decisions above. The Research Agenda (later in this document) tracks what still needs to be verified in practice.

### Shell integration hooks

**zsh** provides `preexec(command, fullcommand, fullcommand_expanded)` — called before each command execution. The three arguments give: the command collapsed to one line, the full multi-line text, and the alias-expanded version. For `ls | grep foo`, you get the literal string `"ls | grep foo"`. There is no parsed argv array. `precmd()` fires after the command completes — `$?` holds the exit code, `$PWD` is the current directory. `chpwd()` fires on directory changes. `$pipestatus` gives per-stage exit codes for pipelines.

**bash** provides the `DEBUG` trap, which fires before **every simple command** in a pipeline — more granular than zsh's `preexec` but noisier, requiring deduplication logic. `$BASH_COMMAND` contains the current simple command text. `PROMPT_COMMAND` fires after completion (equivalent to `precmd`). Bash does **not** provide alias-expanded text.

**OSC 133 markers** are the industry-standard technique for delimiting command boundaries. iTerm2, Warp, and VS Code terminal all use the same protocol: `OSC 133;A` (prompt start), `OSC 133;B` (command start), `OSC 133;C` (output start), `OSC 133;D;{exit_code}` (command finished). The shell integration scripts inject these via `precmd`/`preexec` hooks. This is a solved, battle-tested pattern.

**What we get reliably:** full command line as typed, exit code (including per-stage via `pipestatus`), duration (timestamp in `preexec` vs. `precmd`), working directory before and after.

**What we don't get:** a parsed AST. Detecting pipes, redirections, and subshells requires parsing the command string ourselves. This is doable for common cases (splitting on `|`, detecting `>`, `2>&1`) and gets fragile at the edges (heredocs, nested quoting, multi-line commands). The pragmatic path: parse what we can, fall back gracefully when we can't.

**Zsh's `preexec` is cleaner for our model** than bash's DEBUG trap — one call per command line rather than one per pipeline stage. Zsh is the default shell on macOS, which is our primary target.

### Command coverage

Data from published shell history analyses (~250K histories from commands.dev, multiple GitHub repos analyzing `.bash_history`/`.zsh_history`):

- **git alone is 15-25% of all commands.** Git has excellent structured output: `--porcelain`, `--format=<custom>`, and JSON-compatible formats for many subcommands. This is the highest-value adapter by far.
- **Top 10 commands** (git, cd, ls, cat, grep, docker, npm/yarn, cargo, make, vim) cover roughly **55-65% of usage**.
- **~19-22 commands** with structured adapters would cover **80%+ of developer shell interactions**.

The commands break into categories that directly map to adapter strategy:

| Category | Commands | Adapter Strategy |
|----------|----------|-----------------|
| **A: Native JSON** | git (some), docker, npm, cargo, kubectl, brew, aws, terraform, curl | Pass `--json` or equivalent. Lowest effort, highest fidelity. |
| **B: Stable parseable** | git (porcelain), ls, grep/rg, find, ps, diff, wc, du/df | Parse well-known text formats, or bypass the pty entirely (ls adapter calls `stat()` directly). |
| **C: No output** | cd, rm, cp, mv, mkdir, chmod | Show status confirmation. No output to parse. |
| **D: Free-form text** | make, echo, python, cat, tail/head | Styled monospace fallback with SGR→CSS mapping. |
| **E: Full-screen** | vim, htop, less, top, ssh | Excluded from unified surface. Terminal card only. |

**Key insight:** We don't need to parse VT100 output for any of these. For A, we ask for JSON. For B, we parse stable text or bypass the pty. For C, there's nothing to parse. For D, we render the text with color. For E, we punt to the terminal card.

**Parsing libraries (all MIT/Apache-2.0):** `serde_json` (JSON), `git2` (git structured access), `nom` (custom parsers), `csv` (columnar text), `strip-ansi-escapes` (ANSI removal), `tree-sitter` (syntax highlighting).

### Structured shell precedents

Four systems were studied. Each makes a different tradeoff at the external-command boundary — the seam where structured internal data meets unstructured external program output. Understanding these tradeoffs is what makes Tide's approach defensible.

**Nushell** (MIT): The purest model. Every command returns typed data (`Value` enum: Bool, Int, String, Record, List, etc.). Tables are `List<Record>`. Pipelines pass structured data end-to-end. But external commands produce `ByteStream` — raw bytes with no structure. The user must explicitly convert: `^git status | lines` or `^curl url | from json`. No auto-detection. The boundary is clean but requires user action. *Lesson: the explicit `from`/`to` boundary is principled but creates friction.*

**PowerShell** (MIT): Object pipeline internally. Cmdlets emit .NET objects. `Get-Process` returns `Process[]`. The formatter picks a view based on the object type — `Format-Table`, `Format-List`, `Format-Wide` — selected via declarative `.ps1xml` definitions keyed by type name. But external commands produce `[string]` — one per line, no structure. Same explicit boundary as Nushell. *Lesson: the type-to-default-view mapping is directly relevant to our renderer dispatch. If our system knows a command returns "git status" data, it selects the right renderer without user action.*

**Jupyter** (BSD-3-Clause): The multi-representation pattern. A single `display_data` message carries a dict of representations: `{"text/plain": "...", "text/html": "<table>...", "image/png": "base64...", "application/json": {...}}`. The frontend picks the richest format it can render. *Lesson: this is the strongest design pattern for our output model. Command output as a bundle of typed representations lets different consumers pick the best format.*

**Warp** (proprietary — concepts only, no code): Block model where each command is a discrete object with metadata (command text, exit code, timing, cwd). Shell integration scripts inject OSC 133 escape sequences around boundaries. AI agent operates on blocks — it can see structured command history, not just a text buffer. *Lesson: proves command-as-object works commercially. The OSC 133 pattern is standard.*

**The gap nobody fills:** Every system treats external commands as opaque text at the boundary. Nushell requires `from json`. PowerShell requires `ConvertFrom-Json`. Jupyter requires the kernel to produce structured output. None auto-detect known external command output and produce structured data from it. Tide's adapter registry is the first to bridge this gap — recognizing `git status` and producing structured data automatically.

### Pipe and redirection semantics

**The hybrid approach:** Run full pipelines natively through the hidden pty. Don't intercept intermediate stages. Parse the command string from `preexec` to understand the pipeline topology — what commands are involved, what the user was trying to do. Render the final output with knowledge of the full pipeline.

This preserves full Unix compatibility. Every existing pipeline works. But recognized patterns get progressive enhancement — `git log | head` can be recognized as "git log output, truncated" and rendered as a commit timeline with a note.

**For redirections** (`> file.txt`, `2>&1`), detect by parsing the command string. When stdout is redirected to a file, show an annotation ("Output written to file.txt" with a link) rather than rendering nothing.

**`pipestatus`/`PIPESTATUS`** gives per-stage exit codes. On pipeline failure, show which stage failed — e.g., "grep exited 1" in a `find | grep | wc` pipeline.

**Subshells and command substitution** (`$(command)`, `(cmd1; cmd2)`) are handled transparently by the real shell. The graphical surface doesn't need to understand them — let the shell resolve them.

**The Nushell contrast:** Nushell's structured pipeline is more powerful (structured data flows between stages) but breaks compatibility — native Unix commands need wrappers. Tide's approach is the opposite: full compatibility first, progressive richness on top. A user can paste any command from Stack Overflow and it works.

### Shell concepts from decades of development

**Startup file sequence** matters for correctness. Zsh loads: `/etc/zshenv` → `~/.zshenv` → `~/.zprofile` → `~/.zshrc` (for login interactive). Bash loads: `~/.bash_profile` (which typically sources `~/.bashrc`). Users put PATH modifications in `.zprofile`/`.bash_profile` and aliases/functions in `.zshrc`/`.bashrc`. If the shell bridge doesn't source the right files, users' environments are broken. The safest approach: launch as login interactive (`zsh -li`).

**The alias→function→builtin→external lookup order** is how the shell resolves commands. Aliases are text substitution at parse time. Functions are proper callable units with arguments and local variables. Builtins (`cd`, `export`, `source`) must run in the shell process because they modify its state. External commands are looked up via `$PATH`. The adapter registry operates after alias expansion (using `preexec`'s third argument in zsh) to see the resolved command, not the alias.

**The completion system is an untapped treasure.** Zsh's compsys and bash-completion contain machine-readable descriptions of command interfaces — argument types, subcommands, flags, file-type filters, dynamic completions (like git branch names from the repo). These specs describe what a command *accepts*. A graphical surface could use them for contextual help, argument suggestions, or structured input forms. This is richer than Fig/Amazon Q CLI specs (MIT) and it's already installed on every developer's machine.

**Job control** manages foreground/background process groups. Ctrl-Z sends SIGTSTP; `fg`/`bg` resume. The `jobs` list is state users expect to see. A graphical surface could make this *visible* — showing running/stopped jobs as tiles or tabs — which would be a genuine improvement over the invisible jobs list in traditional shells.

**History** is append-to-file (`~/.zsh_history`), searchable via Ctrl-R, with expansion (`!!` = last command, `!$` = last argument, `^old^new` = quick substitution). Zsh supports shared history across sessions and timestamped entries. Ctrl-R search is non-negotiable muscle memory. `!!` and `!$` are deeply ingrained. Per-directory history would be a graphical surface win that traditional shells struggle to provide.

**Line editing keybindings** that must be replicated: Ctrl-A/E (home/end), Ctrl-W (delete word back), Alt-B/F (word movement), Ctrl-R (history search), Ctrl-C (interrupt). These ~15 bindings cover 99% of users. The graphical input can be richer than readline (multi-line, rich text, inline suggestions) but must not break these keybindings.

**Parameter expansion** (`${var:-default}`, `${var##*/}`, `${var%.*}`) is heavily used in scripts but rarely typed interactively beyond `$VAR`. This is a scripting concern, not an interactive one — the graphical surface doesn't need to handle it specially.

---

## Phases

Tide builds on completed foundation work (Phases 1-3A.7) documented in [tug-conversation.md](tug-conversation.md). This section is the authoritative forward-looking roadmap — it integrates the Claude Code UI work (formerly Phases 3B-7) with the shell and unified surface work.

```
─── FOUNDATION (DONE) ─────────────────────────────────────
Phase 1: Transport Exploration           — DONE (35 tests)
Phase 2: Transport Hardening             — DONE (T1-T7)
Phase 2b: WebSocket Verification         — DONE (4 issues found, all fixed)
Phase 2c: WebSocket Fixes                — DONE (T8-T11)
Phase 3A: Markdown Rendering Core        — DONE
Phase 3A.1-3A.4: Worker/WASM Pipeline    — DONE
Phase 3A.5: Region Model + API           — DONE
Phase 3A.6: SmartScroll                  — DONE
Phase 3A.7: SmartScroll Hardening        — DONE

─── TIDE: FOUNDATION ──────────────────────────────────────
Phase T0: Naming Cleanup                 — rename binaries, crates, directories for Tide
Phase T0.5: Protocol Hardening           — open FeedId, dynamic router, lag recovery, extensibility

─── TIDE: INPUT ───────────────────────────────────────────
Phase T3: Prefix Router + Prompt Input   — text model spike, atoms, completions, routing, history
  T3.0: Text Model Spike                   — DONE — contentEditable as input surface + own document model
  T3.1: tug-atom                           — inline token pill component
  T3.2: tug-prompt-input                   — rich input with atoms, prefix detection, completions
  T3.3: Stores                             — SessionMetadataStore + PromptHistoryStore
  T3.4: tug-prompt-entry                   — composition surface: input + route indicator + submit
  T3.5: Integration + Polish               — wire into Tide, end-to-end, CJK, a11y

─── TIDE: RENDERING ───────────────────────────────────────
Phase T1: Content Block Types            — markdown, code, thinking, tool use, monospace

─── TIDE: SHELL INTEGRATION ───────────────────────────────
Phase T4: Shell Bridge (tugshell)        — spawn shell, hooks, command capture
Phase T2: Shell Command Blocks           — git, cargo, file listing, build output renderers
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

### Foundation: What's Been Proved {#foundation}

Full exploration journals: [transport-exploration.md](transport-exploration.md) (35 tests), [ws-verification.md](ws-verification.md) (WebSocket probe). Detailed phase writeups: [tug-conversation.md](tug-conversation.md) (Phases 1-3A.7).

#### Phase 1: Transport Exploration (DONE)

35 tests probing Claude Code's `stream-json` protocol via probe scripts (currently in `tugtalk/`, moving to `tugcode/` in Phase T0). Key discoveries that directly inform Tide's Claude Code adapter:

- **Streaming model**: `assistant_text` partials are **deltas** (not accumulated). Final `complete` event has full text. UI must accumulate.
- **Thinking**: `thinking_text` is a separate event type arriving before `assistant_text`. Same delta model. Same `msg_id`.
- **Tool use**: `tool_use` streams incrementally (empty input → full input). `tool_result` has text output. `tool_use_structured` has typed data (file viewer, bash stdout/stderr, etc.). Events interleave for concurrent tool calls.
- **Permissions & questions**: Both are `control_request_forward`. Dispatch on `is_question`. Permissions respond with `tool_approval`; questions respond with `question_answer`.
- **Interrupt**: Produces `turn_complete(result: "error")`, not `turn_cancelled`. Final `assistant_text` complete event still arrives with accumulated text.
- **Slash commands**: ALL go through `user_message`. Skills produce full event streams. Terminal-only commands (`/status`, `/model`, `/cost`) return "Unknown skill" — the UI must build its own versions (now Tide surface built-ins, Phase T10).
- **Message queueing**: Sending `user_message` mid-stream does NOT interrupt — it queues. Use `interrupt` to cancel.
- **Subagents**: `tool_use: Agent` brackets subagent lifetime. Nested tool calls visible. `system:task_started/progress/completed` provide lifecycle tracking.
- **`system_metadata`**: Sent every turn. Contains model, tools, slash_commands, skills, plugins, agents, mcp_servers, version, permissionMode. The source for all UI chrome.

**Outbound events (Claude Code → UI):**

| Event | When | Key Fields |
|-------|------|-----------|
| `protocol_ack` | After handshake | `version`, `session_id`, `ipc_version` |
| `session_init` | After claude spawns | `session_id` (may be `"pending"`) |
| `system_metadata` | Start of every turn | tools, model, slash_commands, skills, plugins, agents, mcp_servers, version, permissionMode |
| `thinking_text` | Before response | `msg_id`, `seq`, `text` (delta), `is_partial`, `status` |
| `assistant_text` | During response | `msg_id`, `seq`, `text` (delta on partial, full on complete), `is_partial`, `status` |
| `tool_use` | Tool invoked | `msg_id`, `seq`, `tool_name`, `tool_use_id`, `input` (streams empty→full) |
| `tool_result` | Tool completed | `tool_use_id`, `output`, `is_error` |
| `tool_use_structured` | Tool completed | `tool_use_id`, `structured_result` (typed: file, bash, etc.) |
| `control_request_forward` | Permission or question | `request_id`, `tool_name`, `input`, `decision_reason`, `is_question` |
| `cost_update` | Near end of turn | `total_cost_usd`, `num_turns`, `duration_ms`, `duration_api_ms`, `usage` (input/output/cache tokens) |
| `turn_complete` | End of turn | `msg_id`, `seq`, `result` (`"success"` or `"error"`) |
| `error` | Error occurred | `message`, `recoverable` |

**Inbound messages (UI → Claude Code):**

| Type | Purpose | Key Fields |
|------|---------|-----------|
| `protocol_init` | Handshake | `version: 1` |
| `user_message` | Send prompt | `text`, `attachments: []` |
| `tool_approval` | Answer permission | `request_id`, `decision: "allow"\|"deny"`, `updatedInput?`, `message?` |
| `question_answer` | Answer question | `request_id`, `answers: { key: value }` |
| `interrupt` | Stop turn | *(empty)* |
| `permission_mode` | Change mode | `mode` |
| `model_change` | Switch model | `model` |
| `session_command` | Session mgmt | `command: "fork"\|"continue"\|"new"` |
| `stop_task` | Stop a task | `task_id` |

**Session command behavior:**

| Command | Process | `session_init` ID | Readiness | Context |
|---------|---------|-------------------|-----------|---------|
| `"new"` | Kill + respawn | `"pending"` | **Gap — must wait for real ID** | Fresh |
| `"continue"` | In-place | `"pending-cont..."` | **Immediate** | Preserved |
| `"fork"` | Kill + respawn | `"pending-fork"` | **Gap — must wait for real ID** | Preserved (copy) |

#### Phase 2: Transport Hardening (DONE)

Seven fixes to make the transport production-ready. All committed:

| # | Fix | Commit |
|---|-----|--------|
| T1 | `--plugin-dir` points to `tugplug/` (skills/agents now visible) | `ec7fad06` |
| T2 | Synthetic assistant text forwarded (`/cost`, `/compact` output) | `923a655c` |
| T3 | `api_retry` events forwarded | `f3ac0249` |
| T4 | Process lifecycle: process groups, parent-death watchdog, kill_on_drop | `67c22ad1` |
| T5 | Session command readiness signaling | `314a13cc` |
| T6 | `--no-auth` flag for tugcast (dev/testing) | `ac3cdf54` |
| T7 | Tugtalk compiled to standalone binary (no Bun runtime dependency) | `70e8733e` |

#### Phase 2b: WebSocket Verification (DONE)

Probe (currently `tugtalk/probe-websocket.ts`, moving in Phase T0) verified the full WebSocket path through tugcast. See [ws-verification.md](ws-verification.md).

**Wire protocol**: All WebSocket messages are binary frames:
```
[1 byte: FeedId] [4 bytes: payload length, big-endian u32] [N bytes: payload]
```

**Feed IDs (current):**

| FeedId | Name | Direction | Payload |
|--------|------|-----------|---------|
| 0x00 | TerminalOutput | server → client | raw bytes |
| 0x10 | Filesystem | server → client | JSON |
| 0x20 | Git | server → client | JSON |
| 0x30 | Stats | server → client | JSON |
| 0x31 | StatsProcessInfo | server → client | JSON |
| 0x32 | StatsTokenUsage | server → client | JSON |
| 0x33 | StatsBuildStatus | server → client | JSON |
| 0x40 | CodeOutput | server → client | JSON-line |
| 0x41 | CodeInput | client → server | JSON-line |
| 0xFF | Heartbeat | bidirectional | empty |

**Key findings:**
- Full round-trip works: WebSocket connect → snapshot feeds → `user_message` → streamed response → `turn_complete`
- All snapshot feeds (filesystem, git, stats, project_info) delivered immediately on connect
- Reconnection works: fresh snapshot feeds on reconnect
- Heartbeat frames every 15 seconds

**Issues discovered and fixed in Phase 2c:**

| # | Issue | Fix | Commit |
|---|-------|-----|--------|
| T8 | `session_init` race — broadcast before client connects, missed on fresh launch | Dedicated watch channel, delivered as snapshot on connect | `e0174373` |
| T9 | Double delivery — snapshot feeds sent twice on connect | `borrow_and_update()` in router | `e0174373` |
| T10 | Five touchpoints to add a watch channel | `AgentBridgeHandles` encapsulation, one-file change | `e0174373` |
| T11 | `.tugtool/.session` dirties working tree | Session ID moved to tugbank | `e0174373` |

#### Phases 3A-3A.7: Markdown Rendering (DONE)

See [tug-conversation.md](tug-conversation.md) for detailed writeups. Summary of what was built:

- **3A**: Virtualized markdown rendering — BlockHeightIndex (prefix sum, binary search), RenderedBlockWindow (sliding DOM window), two-path rendering (static + streaming).
- **3A.1-3A.3**: Worker pipeline (built, then found to be unnecessary after WASM benchmarks).
- **3A.4**: pulldown-cmark WASM pipeline — 1MB in 14ms, 10MB in 132ms on JSC. Workers removed entirely. Synchronous lex + parse, no async chains.
- **3A.5**: Region model — ordered keyed content regions, imperative handle API (`setRegion`, `removeRegion`, `clear`). Ready for conversation rendering where messages arrive with IDs and are updated after display.
- **3A.6**: SmartScroll — six-phase scroll state machine (idle, tracking, dragging, settling, decelerating, programmatic). Modeled after UIScrollView/UIScrollViewDelegate. Follow-bottom, all user input methods detected.
- **3A.7**: SmartScroll hardening — settling phase, wheel/keyboard exit paths, all-key coverage, dead code removal.

**What exists and is ready for Tide phases:**
- `BlockHeightIndex` + `RenderedBlockWindow` — proven virtual scroll infrastructure
- `TugMarkdownView` with `TugMarkdownViewHandle` (setRegion/removeRegion/clear) — the rendering surface
- pulldown-cmark WASM — synchronous lex and parse
- `SmartScroll` — scroll management with follow-bottom
- `RegionMap` — ordered keyed content for conversation messages

---

### Phase T0: Naming Cleanup {#naming-cleanup}

**Goal:** Rename binaries, crates, and directories to align with the Tide architecture. The current names predate the unified surface vision and create confusion — most critically, `tugcode` (the CLI utility) occupies the name that should belong to the Claude Code bridge.

**Naming convention:** `tug{suffix}` where the suffix names the facility. Four-letter suffixes are the aspiration for primary binaries (`tugcast`, `tugdeck`, `tugcode`, `tugutil`, `tugbank`); longer suffixes are acceptable when clarity demands it (`tugshell`, `tugplug`).

**Rename table:**

| Current | New | Type | What changes |
|---------|-----|------|-------------|
| `tugcode` (Rust CLI) | **tugutil** | Binary + crate | Crate `tugcode/crates/tugcode/` → `tugrust/crates/tugutil/`. Cargo.toml `name`, `[[bin]]` target, all `use tugcode::` imports. Symlinks in `~/.local/bin/`. |
| `tugtool-core` (Rust lib) | **tugutil-core** | Library crate | Crate `tugcode/crates/tugtool-core/` → `tugrust/crates/tugutil-core/`. Cargo.toml `name`, all `use tugtool_core::` imports across workspace. |
| `tugtalk` (TypeScript) | **tugcode** | Binary + package | Directory `tugtalk/` → `tugcode/`. `package.json` name. `bun build --compile` output name. Justfile build recipe. tugapp binary copy. |
| `tugtool` (Rust launcher) | **`tugutil serve`** | Subcommand | Merge launcher logic into tugutil as `serve` subcommand. Delete `tugcode/crates/tugtool/` crate. Remove standalone binary from justfile and tugapp bundle. |
| `tugcode/` (workspace dir) | **tugrust/** | Directory | Rename workspace directory. Update `Cargo.toml` workspace path, justfile paths, tugapp build scripts, CI config. |

**What stays unchanged:**
- `tugcast`, `tugcast-core` — the WebSocket multiplexer
- `tugdeck` — the browser frontend
- `tugbank`, `tugbank-core` — the defaults database
- `tugrelaunch` — macOS app relaunch helper (internal, users never see it)
- `tugapp` — macOS app (product name: "Tug")
- `tugplug` — Claude Code plugin/agents
- `tuglaws` — design docs
- `tugmark-wasm` — WASM markdown module
- `tugshell` — shell bridge (not yet built, but name is decided)

**Scope:** ~400 occurrences across ~60 non-archive files. The heaviest areas are tugplug (174 occurrences across 20 files — every skill and agent references `tugcode` CLI commands), the Rust workspace, tugapp, CI, and documentation.

**Approach:** Interactive, one step at a time. Each step is a self-contained rename that can be verified before moving to the next. Build and test after each step to catch breakage immediately.

**Ordering rationale:** Rename the thing vacating a name before renaming the thing moving into that name. The `tugcode` name must be freed (CLI → tugutil) before it can be claimed (tugtalk → tugcode). Group each rename with all its reference updates so nothing is half-done.

**Note on archives:** Files in `.tugtool/archive/` (~1,250 occurrences) are historical records referencing names that were current when the work was done. Leave them as-is throughout.

**Steps:**

1. **Rename workspace directory `tugcode/` → `tugrust/`.**
   - `git mv tugcode tugrust`
   - Update workspace-level `tugrust/Cargo.toml` if it has self-referential paths
   - Update justfile: every `tugcode/` path → `tugrust/`
   - Update tugapp build scripts: `tugrust/scripts/build-app.sh`, Xcode project (`project.pbxproj`)
   - Update CI: `.github/workflows/ci.yml`, `.github/workflows/nightly.yml`
   - Update CLAUDE.md repository structure table
   - **Verify:** `just build` succeeds (the binaries still have their old names — only the directory moved)

2. **Rename `tugcode` crate → `tugutil` and `tugtool-core` → `tugutil-core`.**
   These are coupled — the CLI crate depends on the core library. Do them together.
   - `git mv tugrust/crates/tugcode tugrust/crates/tugutil`
   - `git mv tugrust/crates/tugtool-core tugrust/crates/tugutil-core`
   - Update `tugrust/Cargo.toml` workspace members
   - Update `tugrust/crates/tugutil/Cargo.toml`: package name → `tugutil`, bin name → `tugutil`
   - Update `tugrust/crates/tugutil/src/main.rs`: CLI struct name, `--help` description → "Tug utility — project management, state tracking, and developer tools"
   - Update `tugrust/crates/tugutil-core/Cargo.toml`: package name → `tugutil-core`
   - Find and replace across the Rust workspace: `tugtool-core` → `tugutil-core` in all `Cargo.toml` dependency declarations, `use tugtool_core::` → `use tugutil_core::` in all `.rs` files
   - Find and replace across the Rust workspace: dependency on `tugcode` → `tugutil` where other crates depend on the CLI crate (if any)
   - Update justfile: symlink names, build references
   - **Verify:** `cd tugrust && cargo build` succeeds. Binary is now named `tugutil`. `tugutil --help` works.

3. **Fold `tugtool` launcher into `tugutil serve`.**
   - Read `tugrust/crates/tugtool/src/main.rs` — extract the launcher logic
   - Add a `serve` subcommand to `tugrust/crates/tugutil/src/main.rs` with that logic
   - Remove `tugtool` from `tugrust/Cargo.toml` workspace members
   - Delete `tugrust/crates/tugtool/` directory
   - Update justfile: `dev` and `dev-watch` recipes to use `tugutil serve` instead of `tugtool`
   - Remove tugtool from justfile build recipe and tugapp bundle copy
   - **Verify:** `just build` succeeds. `tugutil serve --help` works. No `tugtool` binary produced.

4. **Rename `tugtalk/` → `tugcode/`.**
   The name `tugcode` is now free (the CLI is `tugutil`). The directory name `tugcode/` is free (the workspace is `tugrust/`).
   - `git mv tugtalk tugcode`
   - Update `tugcode/package.json`: name → `tugcode`
   - Update justfile: `tugtalk` → `tugcode` in build recipe (bun build --compile output name, source path)
   - Update `tugrust/crates/tugcast/src/feeds/agent_bridge.rs`: tugtalk binary name → `tugcode` in path resolution
   - Update tugapp: `Sources/AppDelegate.swift`, `Sources/ProcessManager.swift`, `Sources/TugConfig.swift` — tugtalk binary references → `tugcode`
   - Update tugapp `Tug.xcodeproj/project.pbxproj` if it references tugtalk
   - Update tugapp build script (`tugrust/scripts/build-app.sh`): tugtalk binary copy → tugcode
   - **Verify:** `just build` succeeds. `tugcode` binary exists (the Claude Code bridge). No `tugtalk` binary produced.

5. **Update tugplug skills and agents** (174 occurrences, 20 files).
   Every reference to the CLI tool `tugcode` in skill and agent files must become `tugutil`. These are the orchestrator commands (`tugutil dash`, `tugutil worktree`, `tugutil state`, etc.) — NOT the bridge binary.
   - `tugplug/skills/dash/SKILL.md` — 26 occurrences: `tugcode` → `tugutil`
   - `tugplug/skills/implement/SKILL.md` — 41 occurrences: `tugcode` → `tugutil`
   - `tugplug/skills/merge/SKILL.md` — 19 occurrences
   - `tugplug/skills/plan/SKILL.md` — 4 occurrences
   - All 12 agent .md files — references to `tugcode` subcommands → `tugutil`
   - `tugplug/hooks/ensure-init.sh` — 4 occurrences
   - `tugplug/hooks/auto-approve-tug.sh` — 1 occurrence
   - `tugplug/CLAUDE.md` — 1 occurrence
   - `tugplug/.claude-plugin/plugin.json` — 1 occurrence
   - **Verify:** grep confirms no remaining `tugcode` references in tugplug (all CLI references are now `tugutil`).

6. **Update tugapp references to the renamed CLI.**
   Step 4 handled tugtalk→tugcode. This step handles tugcode→tugutil for the CLI binary.
   - `Sources/AppDelegate.swift`: `tugcode` CLI references → `tugutil` (careful: distinguish from the bridge binary which IS now called `tugcode`)
   - `Sources/ProcessManager.swift`: same
   - `Sources/TugConfig.swift`: same
   - `Info.plist` if applicable
   - **Verify:** `just app` builds successfully. Tug.app bundles `tugutil`, `tugcode` (bridge), `tugcast`, `tugrelaunch`, `tugbank`.

7. **Update tugdeck.**
   - `src/main.tsx` — any `tugtalk` or old `tugcode` references
   - `vite.config.ts` — path references
   - **Verify:** `cd tugdeck && bun run build` succeeds.

8. **Update project-level files.**
   - `CLAUDE.md` — repository structure table, any references to old names
   - `.tugtool/config.toml` — if it references binary names or paths
   - `README.md` — if it references old names
   - `.claude-plugin/plugin.json` — if applicable
   - **Verify:** read each file, confirm no stale names.

9. **Update CI.**
   - `.github/workflows/ci.yml` — paths, binary names
   - `.github/workflows/nightly.yml` — same
   - **Verify:** read each file, confirm no stale names. (Full CI verification happens on push.)

10. **Final verification.**
    - `just build` — all binaries compile
    - `just test` — all tests pass
    - `just app` — Tug.app bundles correctly with renamed binaries
    - `just dev` — launches via `tugexec`
    - Grep entire repo (excluding archives) for stale `tugtalk`, stale `tugtool` (as binary name, not repo name), and `tugcode` references that should be `tugutil`
    - Smoke test: `/tugplug:dash` and `/tugplug:implement` to verify skills reference the right binary

**Exit criteria:**
- `tugutil` binary exists with all current `tugcode` subcommands
- `tugexec` binary exists, replacing `tugtool` to launch
- `tugcode` binary exists and is the Claude Code bridge (formerly tugtalk)
- No binary named `tugtool` or `tugtalk` exists
- Workspace directory is `tugrust/`
- All tugplug skills and agents reference `tugutil` (not `tugcode`) for CLI commands
- `just build && just test && just app` all succeed
- `/tugplug:dash` and `/tugplug:implement` run without "command not found" errors
- No stale references to old names in non-archive source code, config, or docs

---

### Phase T0.5: Protocol Hardening {#protocol-hardening}

**Goal:** Harden the tugcast WebSocket protocol and router to support Tide's requirements: multiple backends, opaque routing, extensibility, and robust event delivery. The current implementation was built for a single terminal + Claude Code bridge; Tide needs a general-purpose multiplexer.

**Context:** A thorough audit of the tugcast codebase (tugcast-core protocol, router, feed system, agent bridge, auth) identified 11 issues ranging from structural blockers to future-proofing concerns. All are addressed in this phase to establish the protocol as a solid foundation before building Tide's rendering and shell layers.

#### P1: Open FeedId — the extensibility gate (HIGH)

**Problem:** `FeedId` is a closed Rust enum. `from_byte()` returns `None` for unknown bytes, which becomes `ProtocolError::InvalidFeedId`. Adding a new FeedId requires modifying tugcast-core and recompiling. This directly contradicts the "opaque routing" design decision — a new `tuggemini` bridge assigning itself FeedId 0x70 would be rejected.

**Fix:** Make `FeedId` an open `u8` newtype with known variants as associated constants:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FeedId(pub u8);

impl FeedId {
    pub const TERMINAL_OUTPUT: Self = Self(0x00);
    pub const TERMINAL_INPUT: Self = Self(0x01);
    pub const TERMINAL_RESIZE: Self = Self(0x02);
    pub const FILESYSTEM: Self = Self(0x10);
    pub const GIT: Self = Self(0x20);
    // ... etc
    pub const HEARTBEAT: Self = Self(0xFF);
}
```

Frame decoding accepts any byte. Routing decisions move to the router, not the protocol layer. Code that matches on known FeedIds uses the constants; unknown FeedIds pass through without error.

**Scope:** tugcast-core `protocol.rs`, all `match` statements on `FeedId` across tugcast (add `_ =>` arms or use if/else), tests.

#### P2: Dynamic router — the multi-backend gate (HIGH)

**Problem:** `FeedRouter` has hardcoded named fields (`terminal_tx`, `code_tx`, `code_input_tx`) and a hardcoded `select!` loop. Adding tugshell means adding fields, modifying the select!, modifying bootstrap logic. Every new backend is a code change in the router.

**Fix:** Replace named channel fields with dynamic maps:

```rust
pub struct FeedRouter {
    /// FeedId → broadcast::Sender for stream feeds (server→client)
    stream_outputs: HashMap<FeedId, broadcast::Sender<Frame>>,
    /// FeedId → mpsc::Sender for input feeds (client→server)
    input_sinks: HashMap<FeedId, mpsc::Sender<Frame>>,
    /// All snapshot watch receivers (sent to every client on connect)
    snapshot_watches: Vec<watch::Receiver<Frame>>,
    /// Shared state
    auth: SharedAuthState,
    dev_state: SharedDevState,
    shutdown_tx: mpsc::Sender<u8>,
    client_action_tx: broadcast::Sender<Frame>,
}
```

Client input dispatch becomes a map lookup: `if let Some(tx) = self.input_sinks.get(&frame.feed_id) { tx.send(frame).await; }`. The select! loop subscribes to all `stream_outputs` receivers dynamically.

Registration is: insert a channel pair keyed by FeedId. Main.rs builds the router by registering each backend's channels, not by passing named arguments.

**Scope:** tugcast `router.rs` (major rewrite of `FeedRouter` and `handle_client`), `main.rs` (registration pattern), `server.rs` (if it references router fields directly).

#### P3: FeedId slot collision (LOW)

**Problem:** Tide.md proposed ShellOutput=0x50, ShellInput=0x51. But `Defaults = 0x50` already exists in the code. The roadmap's FeedId table is wrong.

**Fix:** Update the FeedId assignments:

| FeedId | Feed | Status |
|--------|------|--------|
| 0x50 | Defaults | Existing (keep) |
| 0x60 | ShellOutput | New |
| 0x61 | ShellInput | New |
| 0x70 | TugFeed | Planned |

Update tide.md's FeedId tables and all references.

#### P4: CodeOutput lag recovery (MEDIUM)

**Problem:** Broadcast channel capacity is 4096 frames. If a client lags behind on CodeOutput, events are silently lost — no bootstrap, no recovery. The client's conversation state corrupts (missed `assistant_text` deltas, `tool_use` blocks, or `turn_complete`).

Terminal output has bootstrap via `tmux capture-pane`. CodeOutput has nothing.

**Fix:** Add a CodeOutput replay buffer. The agent bridge maintains a bounded ring buffer of recent CodeOutput frames (e.g., last 1000 frames or last 60 seconds). When the router detects CodeOutput lag, it replays from the buffer instead of just logging a warning. The client receives a `lag_recovery` control frame indicating that replay is occurring, then the replayed frames, then live streaming resumes.

If the lag exceeds the buffer, send a `lag_unrecoverable` control frame. The client must request a full session resync (which the UI can handle by clearing and re-requesting state).

**Scope:** Agent bridge (add ring buffer), router (add CodeOutput lag handling parallel to terminal bootstrap), new control frame types.

#### P5: Multi-client input guard (LOW)

**Problem:** All clients' `CodeInput` frames go to the same `mpsc::Sender`. Two browser tabs sending competing `user_message` to Claude Code would interleave unpredictably.

**Fix:** Enforce single-writer-per-backend. When a client sends its first input frame for a given FeedId, it claims that input channel. Subsequent clients attempting to send on the same input FeedId receive an error frame. Read-only access (receiving output) remains open to all clients.

For Tide, where each backend has one active session, this is the right model. Multi-client collaboration (shared editing) would need a different design — defer that.

**Scope:** Router `handle_client` input dispatch (add ownership tracking per FeedId input channel).

#### P6: Protocol version documentation (LOW)

**Problem:** No version field in the frame format. No negotiation mechanism.

**Fix:** Don't change the wire format. Instead:
1. Document the current format as "Tugcast Binary Protocol v1" in tugcast-core.
2. Add a one-time handshake at WebSocket connection open: client sends a text frame `{"protocol":"tugcast","version":1}`, server responds `{"protocol":"tugcast","version":1,"capabilities":[]}`. If versions don't match, close with an appropriate WebSocket close code.
3. The capabilities array is empty for v1 but provides the extension point for future features (compression, fragmentation, subscription filtering).

**Scope:** tugcast-core (documentation), router.rs (handshake before entering feed loop), tugdeck protocol.ts (send handshake on connect).

#### P7: Raise max payload size (MEDIUM)

**Problem:** `MAX_PAYLOAD_SIZE` is 1 MB. `assistant_text` complete events contain full conversation text — observed at multi-MB in real sessions. Shell output from `cat large-file` could easily exceed 1 MB.

**Fix:** Raise to 16 MB. This is still a safety limit — it prevents a runaway feed from consuming unbounded memory. 16 MB accommodates the largest realistic single-frame payloads (full conversation text, large file contents) while remaining bounded.

If larger payloads are eventually needed (e.g., streaming a binary file), add frame fragmentation as a future protocol extension — not now.

**Scope:** tugcast-core `protocol.rs` (one constant change), tests (update boundary tests).

#### P12: Flags byte in frame header (HIGH)

**Problem:** The wire format is `[1 byte FeedId][4 byte BE u32 length][payload]`. Every frame is implicitly "data." But P4 and P11 introduce meta-frames (lag recovery, bootstrap requests) that ride on existing FeedIds. Without a framing-level way to distinguish data from control, receivers must parse JSON to tell whether a CodeOutput frame is real conversation data or a lag recovery signal. This is fragile and forces both Rust and TypeScript parsers to handle protocol-level concerns in application-level code.

**Fix:** Expand the header from 5 bytes to 6 bytes by adding a flags byte:

```
[1 byte FeedId][1 byte flags][4 byte BE u32 length][payload]
```

Flags byte layout (v1):
- Bit 0: frame kind — `0` = data, `1` = control (meta-frame about this feed)
- Bits 1–7: reserved, must be 0. Receivers ignore unknown flags for forward compatibility.

This means a lag recovery frame is `FeedId=0x40, flags=0x01, payload={"type":"lag_recovery"}` — the framing layer tells you it's not conversation data before you touch the JSON. Future uses for reserved bits: compression indicator, fragmentation, priority, etc.

The cost is 1 extra byte per frame — negligible at any realistic throughput. The benefit is that this is the last opportunity to change the wire format cleanly before external clients exist.

**Scope:** tugcast-core `protocol.rs` (Frame struct, encode/decode, HEADER_SIZE 5→6, tests), tugdeck `protocol.ts` (mirror changes), tugdeck `connection.ts` (decode path), all golden-byte tests.

#### P8: Auth for remote use (LOW)

**Problem:** Session cookie + origin validation for localhost only. The "remote use comes for free" architecture works at the transport level, but auth doesn't survive network deployment.

**Fix:** Add a token-based auth mode alongside the existing cookie mode:
1. Server generates a long-lived API token (stored in tugbank).
2. Client sends token via `Authorization: Bearer TOKEN` header on WebSocket upgrade.
3. Server validates token. No origin check in token mode (the token IS the credential).
4. Cookie mode remains for local browser use. Token mode enables remote CLIs, scripts, and non-browser clients.

Don't implement TLS in tugcast — run it behind a reverse proxy (nginx, caddy) for HTTPS in remote deployments. The proxy terminates TLS; tugcast sees plain HTTP.

**Scope:** tugcast `auth.rs` (add token validation path), tugbank (store tokens), tugdeck (send token header when configured for remote).

#### P9: Optional compression (LOW)

**Problem:** JSON payloads sent raw. Not a problem on localhost. Matters for remote use.

**Fix:** Add WebSocket `permessage-deflate` support. The `tokio-tungstenite` crate supports this as a configuration option on the WebSocket upgrade. No changes to the frame format — compression is transparent at the WebSocket layer.

Enable by default. Disable via flag if CPU overhead is a concern on low-power devices.

**Scope:** tugcast `server.rs` (WebSocket upgrade configuration). Small change.

#### P10: Feed subscription filtering (LOW)

**Problem:** All snapshot feeds go to all clients. No per-client filtering.

**Fix:** Add an optional subscription message after the protocol handshake: `{"type":"subscribe","feeds":[0x20,0x40]}`. If sent, the router only forwards snapshots for the listed FeedIds. If not sent, all feeds are forwarded (backward compatible).

This becomes useful when specialized clients (e.g., a CLI tool that only cares about CodeOutput, or a monitoring dashboard that only wants Stats) connect and don't want irrelevant traffic.

**Scope:** Router `handle_client` (filter snapshot list based on subscription), protocol (new message type).

#### P11: Generalized bootstrap / lag recovery (LOW)

**Problem:** The BOOTSTRAP state captures tmux pane content. This is terminal-specific. Tugshell won't have a tmux pane; its "current state" is different (last command output, cwd, environment). Each backend may need its own bootstrap strategy.

**Fix:** Make bootstrap a per-backend concern, not a router concern. When the router detects lag on a stream feed:
1. Send a `lag_detected` control frame to the client with the FeedId that lagged.
2. The client requests a bootstrap: `{"type":"bootstrap_request","feed_id":0x00}`.
3. The router forwards the request to the backend.
4. The backend sends its bootstrap data (terminal: captured pane; shell: last N command results; code: recent event buffer from P4).

The router doesn't know what bootstrap means for each backend — it just brokers the request. The backend decides what to send.

**Scope:** Router (replace terminal-specific BOOTSTRAP with generic lag_detected + bootstrap_request), agent bridge (implement code bootstrap from P4 buffer), terminal feed (refactor current bootstrap into the new pattern). Tugshell implements its own bootstrap in Phase T4.

**Work order:**

The fixes have dependencies. Organized into dashes:

**Dash 1A — Protocol foundation (wire format, types, handshake):**

1. **P1** (open FeedId) — newtype struct, unblocks everything
2. **P7** (raise max payload) — trivial constant change, do alongside P1
3. **P3** (FeedId collision) — fix slot assignments, add Shell/TugFeed constants
4. **P12** (flags byte) — expand header 5→6 bytes, data/control bit
5. **P6** (protocol version handshake) — document as v1, handshake on connect

**Dash 1B — Dynamic router (the big rewrite):**

6. **P2** (dynamic router) — `StreamMap` fan-in, `HashMap<FeedId, Sender>` input dispatch, router-internal handling for Control/Heartbeat

**Dash 2 — Robustness (depends on P2):**

7. **P4** (CodeOutput lag recovery) — ring buffer, replay, uses P12 flags for control frames
8. **P11** (generalized bootstrap) — per-backend bootstrap, uses P12 flags
9. **P5** (multi-client input guard) — single-writer-per-FeedId enforcement

**Dash 3 — Polish (all deferred):**

10. ~~**P9** (compression)~~ — deferred; `permessage-deflate` not available in tungstenite 0.28/axum 0.8 stack. Revisit when remote use is on the horizon or if tungstenite restores the feature.
11. ~~**P8** (remote auth)~~ — deferred until remote use is on the horizon
12. ~~**P10** (subscription filtering)~~ — deferred until remote use is on the horizon

**Exit criteria:**
- [x] Wire format is v1: `[FeedId:1][flags:1][length:4][payload:N]`, documented
- [x] `FeedId` is an open `u8` newtype; unknown bytes don't produce errors
- [x] Protocol handshake on WebSocket connect; version and capabilities negotiated
- [x] Router dispatches input frames via dynamic map lookup, not hardcoded fields
- [x] Adding a new backend is: register channel pair by FeedId, spawn bridge process. No router code changes.
- [x] CodeOutput lag triggers replay from ring buffer, not silent event loss
- [x] Multi-client input guarded: first writer claims, others get error
- [x] Max payload raised to 16 MB
- [x] FeedId slot assignments corrected (Defaults=0x50, Shell=0x60/0x61, TugFeed=0x70)
- [x] `cargo build && cargo nextest run` pass (912 Rust tests, 1782 TypeScript tests)
- [ ] End-to-end verification pending (tugdeck + tugcast live session)
- P8 (remote auth), P9 (compression), and P10 (subscription filtering) deferred — not needed for local Tide development path

---

### Phase T3: Prefix Router + Prompt Input {#prefix-router-prompt-input}

**Goal:** The unified command input — where every interaction begins. A rich prompt surface with inline atoms, prefix routing, typeahead completions, and history. Combines the prompt input layer (formerly Phase 4) with the prefix routing system. Addresses U12, U13, U19 from tug-conversation.md.

**Rationale for ordering:** T3 comes first because the input surface is needed to test everything downstream. Without a prompt, you can't send a `>` message to Claude Code (needed to test T1 rendering) or a `$` command to a shell (needed to test T4). T1 rendering with only mock/gallery data is synthetic; T3 makes it real.

**Components built in this phase:**

| Component | Kind | Description |
|-----------|------|-------------|
| tug-atom | Original | Inline token pill: resolved file, slash command, or doc reference. Pill with icon + label + dismiss. Deletable as unit. Draggable into prompt. |
| tug-prompt-input | Original | Rich input field with atom support, prefix detection, typeahead/tab-completion, history navigation. The text model is mixed: runs of plain text interspersed with atom nodes. |
| tug-prompt-entry | Composition | Composes tug-prompt-input + submit button + route indicator (tug-choice-group) + progress/disabled state. The complete "enter a prompt" experience. |
| SessionMetadataStore | Store (L02) | Captures `system_metadata` from CODE_OUTPUT feed. Provides slash commands, skills, and model info for typeahead. |
| PromptHistoryStore | Store (L02) | Per-route, per-card command history. IndexedDB backing. |

**Design decisions:**

- **D-T3-01: Route selection.** Three routes: `>` (Claude Code), `$` (Shell), `:` (Surface built-ins). Route is set by either (a) typing the prefix character as the first character of input, or (b) clicking the route indicator (tug-choice-group in tug-prompt-entry). The two are bidirectionally synced. `/` as first character is an implicit `>` (slash command mode). No "default" route — the route indicator always shows the active route, and the user explicitly selects it.
- **D-T3-02: `@` is route-independent.** Typing `@` anywhere in any route triggers file completion. The `@` trigger may also offer doc links in the future.
- **D-T3-03: Atoms.** Inline token pills embedded in the text stream (like Apple Mail address tokens or Cursor file references). An atom is inserted when a completion resolves (e.g., `@file` tab-completes to a file atom pill). Atoms are atomic — backspace deletes the whole pill. Atoms can be inserted via drag-and-drop (files from Finder). Atoms contribute structured data to the submitted message (file paths, slash command names) separately from the plain text.

---

#### T3.0: Text Model Spike {#t3-text-model-spike}

**Status:** COMPLETE. See [t3-text-model-spike.md](t3-text-model-spike.md) for full findings.

**Goal:** Determine the correct implementation strategy for tug-prompt-input's mixed text+atom model.

**Spike summary:** Tested three approaches in a Component Gallery card:
- **Approach A (Textarea + overlay):** Non-functional. Arrow keys can't navigate past atoms — spatial correspondence between placeholder chars and rendered pills breaks with proportional fonts.
- **Approach B (Thin contentEditable):** Best surface-level result. Japanese IME, VoiceOver, auto-resize, drag-and-drop, and paste all worked. But deep failures: spurious marked text on US keyboard (macOS/WebKit treats contentEditable as active input session), Cmd+A escapes to page, cursor enters atom interior, undo repositions atoms instead of removing them, Enter during IME composition fires submit instead of accepting text, SelectionGuard conflicts with native selection.
- **Approach C (Hidden textarea + rendered div):** Correct architecture but needs proper implementation — no insertion point without a real document model.

**Decision:** Build a proper text input engine (Approach C done right), inspired by UITextInput concepts. contentEditable is used as an **input capture surface only** — not the document model. All three reference implementations (ProseMirror, CodeMirror 6, Lexical — all MIT licensed) converge on this architecture.

**Architecture** (validated by engine-based spike):
1. **Document Model** — `segments: (TextSegment | AtomSegment)[]` with **text-atom-text invariant**: text segments always exist between atoms and at boundaries. Cursor is always in a Text node. Flat offsets as universal position type (text chars = 1, atoms = 1).
2. **Input Capture** — contentEditable div as input device. Normal text typing flows through the browser; MutationObserver reads changes back to model ("let the browser mutate, diff afterward" — CM6 pattern). Everything else (delete, paste, undo, Enter) is intercepted in `keydown`/`beforeinput` and handled via model operations + reconcile.
3. **Selection/Cursor** — Native browser caret. We do NOT render our own cursor. `sel.collapse(node, offset)` positions it. Selection saved/restored as flat offsets across reconciliation (L23). `selectAll` respects first responder (fixed in tug-card.tsx).
4. **Composition (IME)** — `composingIndex` tracks which segment is being composed. Reconciler skips during composition. `compositionEndedAt` timestamp + 100ms window catches the WebKit bug where `compositionend` fires before Enter keydown. `hasMarkedText` exposed in delegate API.
5. **Undo** — Own stack with immutable segment snapshots. `cloneSegments()` before mutations. Merge heuristic: consecutive same-type edits within 300ms. Browser `historyUndo`/`historyRedo` intercepted and redirected.
6. **Return vs Enter** — `e.code === "Enter"` (Return) vs `"NumpadEnter"` (Enter). Independently configurable actions. Shift inverts. `hasMarkedText === true` → key goes to IME.
7. **CSS** — `::selection` re-enabled inside editor; `::highlight(card-selection)` suppressed. `-webkit-user-modify: read-write-plaintext-only` prevents spurious composition markers.

**Two-layer design:**
- **Layer 1 (Engine):** `TugTextEngine` class — segments, reconciler, MutationObserver, composition tracking, undo. Inspired by Lexical (DecoratorNode, composition key) and CM6 (browser mutate + diff, native caret).
- **Layer 2 (API):** `TugTextInputDelegate` interface — UITextInput-inspired: `selectedRange`, `hasMarkedText`, `insertText()`, `insertAtom()`, `deleteBackward()`, `undo()`/`redo()`, Return vs Enter. The contract between engine and component.

**Spike reference:** Gallery card `gallery-text-model-spike.tsx` contains the working engine and diagnostics panel. Preserved until T3.2 replaces it.

---

#### T3.1: tug-atom Component {#t3-atom}

**Goal:** Build the tug-atom component — the inline token. Two rendering paths: React for standalone/gallery use, DOM for engine reconciler.

**Prerequisites:** T3.0 (architecture decision — atoms are `contentEditable="false"` spans built by the engine reconciler).

**Governing documents:**
- [Component Authoring Guide](../tuglaws/component-authoring.md) — file structure, TSX/CSS conventions, `@tug-pairings`, `@tug-renders-on`, checklist
- [Token Naming](../tuglaws/token-naming.md) — seven-slot `--tug7-` convention for atom-specific theme tokens
- Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared, [L19] component authoring guide

**Work:**

Dual rendering paths:
- **React path**: `<TugAtom type="file" label="src/main.ts" />` — standalone component, used in gallery card and anywhere React owns the DOM (e.g., atom tray, suggestion list)
- **DOM path**: `createAtomDOM(seg: AtomSegment)` — exported function that builds identical DOM imperatively, used by TugTextEngine's reconciler inside contentEditable
- Both paths produce the same DOM structure, same CSS classes (`tug-atom`), same `data-slot`, same accessibility attributes. The CSS is shared.

Component features:
- Compact rectangular token (Apple Mail / Cursor style, not a rounded pill): icon + label
- Atom type is an open string — known types (file, command, doc, image, link) get specific Lucide icons; unknown types get a default. The set grows over time.
- Visual design: squared-off rectangle (`border-radius: 3px`), subtle tinted background with outline border, slightly reduced font size via `--tug-atom-font-scale` CSS custom property (default `0.85em`), baseline-aligned with surrounding text
- Atom data model: `AtomSegment { kind: "atom", type, label, value }` — same type used by the text engine
- Full state set: rest, hover, selected (two-step delete), highlighted (search/typeahead), disabled
- Hover: tooltip shows full `value`; for dismissible atoms, type icon flips to X for mouse-driven deletion
- Dismiss: icon-to-X on hover (React path) or engine's two-step backspace/click-select (DOM path)
- Label formatting: `formatAtomLabel(value, mode)` utility — `"filename"` / `"relative"` / `"absolute"` — caller decides, component just renders
- Accessibility: `role="img"`, `aria-label="${type}: ${label}"`, keyboard-selectable (engine handles navigation)
- Theme tokens: `--tug7-*-atom-*` tokens defined in both theme files (brio.css, harmony.css) per seven-slot convention
- Gallery card for isolated testing of both rendering paths, click-to-select, dismissal, label modes

**Exit criteria:**
- `<TugAtom />` renders correctly in gallery card (React path)
- `createAtomDOM()` produces identical DOM (verified visually in gallery)
- All known atom types visually distinct with appropriate icons; unknown types get default icon
- Tooltip shows full value on hover
- All states render correctly: rest, hover, selected, highlighted, disabled
- Dismiss icon-to-X flip works on hover in React path
- Token-compliant styling: `@tug-pairings` (compact + expanded), `@tug-renders-on` on all foreground rules
- Accessibility: VoiceOver announces atom label
- Conforms to component authoring guide checklist

---

#### T3.2: tug-prompt-input {#t3-prompt-input}

**Goal:** The rich input field. A proper tugways component wrapping the TugTextEngine with atom support, prefix detection, and completions.

**Prerequisites:** T3.0 (architecture validated), T3.1 (tug-atom with DOM rendering path).

**Governing documents:**
- [Component Authoring Guide](../tuglaws/component-authoring.md) — file structure, TSX/CSS conventions, `@tug-pairings`, `@tug-renders-on`, input value management, checklist
- [Token Naming](../tuglaws/token-naming.md) — seven-slot `--tug7-` convention for prompt-input theme tokens
- Laws: [L01] single mount, [L06] appearance via CSS, [L07] stable refs, [L15] token-driven states, [L16] pairings declared, [L19] component authoring guide

**Work:**

Engine extraction and integration:
- Extract `TugTextEngine` from the spike gallery card into `lib/tug-text-engine.ts` as a standalone module
- Define `TugTextInputDelegate` interface in `lib/tug-text-input-delegate.ts` (the UITextInput-inspired API)
- tug-prompt-input creates the engine in `useLayoutEffect` (L01), accesses via ref (L07), all updates in DOM zone (L06)
- Engine reconciler uses `TugAtom.createDOM()` (T3.1 DOM path) for atom rendering
- `selectionAffinity` support for multiline: track upstream/downstream at soft line breaks
- Auto-resize: 1 row default, grows to maxRows (8), Apple Messages style [L06]
- Return vs Enter: independently configurable actions via delegate API. Shift inverts. `hasMarkedText === true` → key goes to IME.
- `-webkit-user-modify: read-write-plaintext-only` for plain-text editing mode
- `::selection` re-enabled, `::highlight(card-selection)` suppressed inside editor
- `data-td-select="custom"` to exempt from SelectionGuard clipping

Prefix detection:
- First character `>`, `$`, `:` sets the active route
- `/` as first character implies `>` route (slash command mode)
- Route change emits an event/callback so tug-prompt-entry can sync the route indicator
- Visual: prefix character is styled distinctly (e.g., dimmed or colored) to indicate it's structural, not content

Atom insertion:
- `@` trigger: typing `@` opens a file completion popup. Typing further filters results. Tab or Enter resolves the selection to a tug-atom pill inserted inline. Escape cancels.
- `/` trigger (in `>` route): opens slash command completion popup. Same tab/enter/escape behavior.
- Drag-and-drop: files dragged from Finder onto the input create file atoms. **Drop handler must be configurable** — accepted file types (extensions, MIME types) are set by the component consumer, not hardcoded.
- Atoms in the submitted text are serialized as structured attachments, not inline text

Typeahead and completion:
- Completion popup positioned near the cursor (or at the bottom of the input area)
- Fuzzy matching on file paths, command names
- Tab-completion: Tab accepts the top suggestion
- Arrow keys navigate the popup; Enter selects
- **Completion data source is a service, not a hardcoded list.** The component accepts a completion provider (callback or interface): `(query: string) => Promise<CompletionItem[]>`. For `@` file completion, this calls a file index service (TBD — may need a new file listing API on tugcast, or a local directory scan). For `/` commands, this reads from SessionMetadataStore (slash commands + skills). The spike used a hardcoded file list; the real component must not.
- Completion data sources: SessionMetadataStore (slash commands, skills) and a file completion service (architecture TBD — may be a new tugcast feed, a local scan, or a combination)

History:
- Up/down arrows when cursor is at the start/end of input navigate history
- History is per-route (Claude Code history separate from shell history)
- History state comes from PromptHistoryStore

**Exit criteria:**
- Text input with atoms works per the chosen text model
- Auto-resize works (1 row → 8 rows)
- Prefix detection correctly identifies route from first character
- `@` file completion works: trigger → filter → resolve to atom
- `/` slash command completion works in `>` route
- Drag-and-drop file → atom works
- History navigation works
- IME composition (Japanese, Chinese) works correctly
- Undo works (including undo of atom insertion)
- Token-compliant styling: `@tug-pairings` (compact + expanded), `@tug-renders-on` on all foreground rules
- Conforms to component authoring guide checklist
- Gallery card for isolated testing

---

#### T3.3: Stores — SessionMetadataStore + PromptHistoryStore {#t3-stores}

**Goal:** The data sources that feed tug-prompt-input's completions and history.

**Prerequisites:** None (can be built in parallel with T3.1).

**Work:**

SessionMetadataStore:
- Subscribes to CODE_OUTPUT feed via FeedStore
- Captures `session_init` and `system_metadata` events
- Extracts: `slash_commands[]`, `skills[]`, `model`, `session_id`, `permission_mode`
- L02: exposes `subscribe` + `getSnapshot` for `useSyncExternalStore`
- Merges slash commands + skills into a unified completion list (skills use `tugplug:` prefix per U12)

PromptHistoryStore:
- Per-route, per-card history
- IndexedDB backing for persistence across sessions
- L02: `subscribe` + `getSnapshot`
- API: `push(route, cardId, text)`, `navigate(route, cardId, direction)`, `current(route, cardId)`
- History entries store the raw text (not atoms — atoms are resolved references, not reproducible)

**Exit criteria:**
- SessionMetadataStore receives and stores metadata from a live CODE_OUTPUT feed
- PromptHistoryStore persists history to IndexedDB
- Both stores are L02 compliant
- Unit tests for both

---

#### T3.4: tug-prompt-entry {#t3-prompt-entry}

**Goal:** The complete prompt composition surface.

**Prerequisites:** T3.2 (tug-prompt-input), T3.3 (stores).

**Governing documents:**
- [Component Authoring Guide](../tuglaws/component-authoring.md) — compound composition pattern, token sovereignty [L20], `@tug-pairings`, checklist
- [Token Naming](../tuglaws/token-naming.md) — seven-slot `--tug7-` convention for prompt-entry theme tokens
- Laws: [L06] appearance via CSS, [L11] controls emit actions, [L15] token-driven states, [L16] pairings declared, [L19] component authoring guide, [L20] token sovereignty

**Work:**

Composition:
- Layout: tug-prompt-input fills the width. Below (or beside) the input: route indicator (tug-choice-group with `>` `$` `:` segments), submit button, utility area
- Route indicator bidirectionally synced with tug-prompt-input's prefix detection
- Submit button: enabled when input is non-empty and no active turn. Disabled + spinner during active Claude Code turn (U19)
- Interrupt: during active turn, submit button becomes "Stop" (sends `interrupt` to CODE_INPUT)

Message dispatch:
- On submit, serialize the input: plain text content + atom attachments (file paths, etc.)
- Route to the correct feed: `>` route → CODE_INPUT as `user_message`, `$` route → SHELL_INPUT (future), `:` route → local surface command handler
- Clear input after successful send
- `/` commands in `>` route: may need special handling (some slash commands are local, some are remote)

Turn state:
- Observe CODE_OUTPUT for `turn_complete` / streaming indicators
- During active turn: disable send, show progress indicator, optionally allow message queueing (U19)

**Exit criteria:**
- Complete prompt entry with route indicator, submit, and input
- Route switching works via indicator and prefix
- Submit dispatches to correct feed per route
- Send disabled during active Claude Code turn
- Interrupt (stop) works during active turn
- End-to-end: type `> hello` → message arrives at Claude Code via CODE_INPUT
- Token-compliant styling: own tokens scoped to `prompt` component; no descendant restyling of composed children [L20]
- Conforms to component authoring guide checklist
- Gallery card + live integration test

---

#### T3.5: Integration + Polish {#t3-integration}

**Goal:** Wire tug-prompt-entry into the live Tide UI and polish the end-to-end experience.

**Prerequisites:** T3.4.

**Governing documents:**
- [Component Authoring Guide](../tuglaws/component-authoring.md) — accessibility audit criteria, testing requirements
- [Token Naming](../tuglaws/token-naming.md) — verify all T3 components use properly-scoped `--tug7-` tokens

**Work:**
- Mount tug-prompt-entry in the Tide card (replacing any existing input stub)
- End-to-end test: type a prompt → Claude Code receives it → response streams back
- CJK end-to-end test
- Keyboard shortcut discovery: Cmd+K or similar to focus the prompt from anywhere
- Atom drag-and-drop from Finder end-to-end
- Performance: ensure no jank during typeahead with large file lists
- Accessibility audit: VoiceOver navigation through atoms, route indicator, submit button

**Exit criteria (overall T3):**
- Prefix routing works: `>`, `$`, `:` dispatch to correct handler
- Route indicator (tug-choice-group) syncs with prefix character
- `@` file completion works in all routes, resolves to inline atom
- `/` slash command completion works in `>` route
- Atoms display correctly, delete as units, support drag-and-drop
- History navigation works per-route
- Send disabled during active Claude Code turn; interrupt works
- IME composition (Japanese, Chinese) works correctly
- CJK input end-to-end verified
- Undo works including atom insertion/deletion
- VoiceOver reads atoms and route indicator correctly
- All T3 components pass component authoring guide checklist
- All T3 tokens conform to seven-slot naming convention
- `bun run audit:tokens lint` exits 0

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

### Phase T4: Shell Bridge (Tugshell) {#shell-bridge}

**Goal:** Build tugshell — the process that bridges bash/zsh to tugcast, analogous to tugcode for Claude Code.

**Work:**
1. Shell process spawning with hidden pty, login interactive mode (`zsh -li`)
2. Shell integration hook injection (preexec/precmd for zsh, PROMPT_COMMAND/DEBUG for bash)
3. OSC 133 marker emission for command boundary detection
4. Command string capture, exit code, duration, cwd tracking
5. Raw stdout/stderr capture from pty
6. Event emission to tugcast via new ShellOutput feed (0x60)
7. ShellInput feed (0x61) for receiving commands from the UI
8. Process lifecycle management (kill on tugcast shutdown, no zombies)

**Exit criteria:**
- User types a command in tugdeck, it executes in a real shell
- `command_start` / `command_output` / `command_complete` events arrive in tugdeck with correct metadata
- Raw stdout captured and delivered as text blocks
- Shell environment (PATH, aliases, functions) fully loaded from user's startup files
- cwd tracking works across cd commands
- No orphaned shell processes on quit

---

### Phase T2: Shell Command Blocks {#shell-command-blocks}

**Goal:** The graphical components for the highest-value shell command adapters. These are the renderers that make `$ git status` look like a purpose-built app, not terminal text. Built after T4 delivers real shell events — until then, raw output is dumped unformatted.

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

**Goal:** Full pipeline and redirection semantics in the unified surface. Pipes and redirects are the credibility test — the feature that determines whether experienced developers treat Tide as a real shell environment or a toy. `ls | grep foo`, `cargo build 2>&1 | tee build.log`, `git log --oneline | head -20` must work naturally and render well.

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
| F3: Feed CLI + Tugcast | `tugutil feed` + browser delivery | Rust CLI + tugcast feed (0x60) |
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

7. ~~**Tugcast vs. local for the shell bridge**~~: **Resolved — tugcast for everything, always.** One architecture, one implementation of tugshell. The WebSocket connection between tugdeck and tugcast is already network-transparent — tugdeck doesn't know or care whether tugcast is on localhost or across the internet. If tugshell goes through tugcast the same way tugtalk does, then remote use comes for free: tugcast, tugtalk, and tugshell run on a remote machine (or cloud VM, or dev container); tugdeck in the browser connects over the network; everything works the same. The latency concern is overstated — the localhost hop (tugshell → tugcast → WebSocket → tugdeck) adds microseconds on top of commands that take tens of milliseconds. Interactive typing and tab completion are handled by the surface itself, not round-tripped through tugshell.

---

## Risks

### Adapter edge cases

The adapter model assumes you can reliably identify what command is running and intercept its output. For simple commands (`git status`, `cargo build`) this is straightforward. It gets harder with:

- **Aliases**: `alias gst='git status'` — the adapter sees `gst`, not `git status`, unless it resolves aliases. Zsh's `preexec` third argument provides alias-expanded text, which helps. Bash does not.
- **Pipelines**: `git status | head` — is this a git command or a head command? The adapter must parse the pipeline string and decide which stage to recognize. The pragmatic answer (recognize the *first* command in the pipeline, render the *final* output) handles most cases.
- **Shell functions**: User-defined functions that wrap commands. The adapter sees the function name, not the underlying commands. Similar to the alias problem.
- **Complex command lines**: Heredocs, nested quoting, subshells, command substitution — the command string from `preexec` is unparsed text, not an AST. Parsing it correctly for all edge cases is hard.

**Mitigation**: Invest heavily in the fallback path. Styled monospace text with ANSI color support must be genuinely good — not an afterthought. When the adapter can't figure out what a command is, the fallback should render the output attractively and usefully. If the fallback is good, adapter edge cases are cosmetic annoyances, not broken experiences.

### Scope

The roadmap has 13 Tide phases plus 5 feed phases. The Claude Code side alone (T1, T3, T9-T11) is substantial. The shell side (T4-T8) is a new codebase. The unification (T12-T13) is where the magic happens but also where the integration complexity lives.

**Mitigation**: The phasing is designed so that a Claude Code-only surface (T1 + T3 + T9) is shippable on its own. The shell side can come later. The full vision requires both halves, but value accrues incrementally.

### Shell integration compatibility

Shell hooks (preexec/precmd) must coexist with existing shell frameworks: oh-my-zsh, powerlevel10k, starship, direnv, nvm, conda. Any of these could conflict with our hook injection. The OSC 133 marker technique is battle-tested (iTerm2, Warp, VS Code all use it), but each environment adds variables.

**Mitigation**: Research item R1 specifically targets this. Test with real-world shell configurations before committing to the hook injection approach.

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
8. **Project codename** — "Tide" for the unified command surface vision. Tugdeck remains the rendering implementation. Rejected alternatives: "tug-conversation" (too narrow — was right when scope was just Claude Code chat), "single surface" (describes the concept, not the thing), "graphical terminal" (contradictory — the whole point is shedding the terminal), "tugdeck" (it's a bigger concept, keep them separate — Tide is the vision, tugdeck is the implementation), "helm" (overloaded — Kubernetes), "tug-bridge" (confuses with software bridge pattern).
9. **Tugcast for everything** — All backends go through tugcast. One architecture, one WebSocket. Network-transparent by default, so remote use comes for free. Localhost latency overhead is negligible.
10. **Naming cleanup** — Rename plan finalized. tugtalk → **tugcode** (Claude Code bridge). tugcode (CLI) → **tugutil** (all-purpose utility). tugtool (launcher) → **`tugutil serve`** subcommand. tugtool-core → **tugutil-core**. Workspace directory `tugcode/` → **`tugrust/`**. Convention: `tug{suffix}` where suffix names the facility. Phase T0 tracks the work.
11. **Tugcast routes opaquely** — Tugcast forwards frames by FeedId without interpreting JSON payloads. Event type semantics live in tugdeck and the bridge processes, not in the multiplexer. This is what makes the architecture extensible — adding a new service is a new bridge + new FeedId pair, not a tugcast change.

---

## Relationship to Existing Work

| Component | Role in Tide | Status |
|-----------|-------------|--------|
| **tugcast** | WebSocket multiplexer, binary framing, opaque feed routing | Existing, needs new FeedIds |
| **tugcode** (currently tugtalk) | Claude Code bridge (stream-json ↔ tugcast) | Existing, proven. Rename in Phase T0. |
| **tugshell** | Shell bridge (bash/zsh ↔ tugcast) | **New** |
| **tugutil** (currently tugcode CLI) | All-purpose utility: state, worktree, validate, serve | Existing. Rename in Phase T0. Absorbs tugtool launcher. |
| **tugdeck** | Graphical rendering surface | Existing, needs unified output stream |
| **tugapp** | macOS app (product name: "Tug") | Existing |
| **tug-feed** | Agent progress event layer | Planned, integrates with Tide |
| **tugplug** | Claude Code plugin (skills, agents) | Existing, unchanged |
| **tugbank** | SQLite defaults database + CLI | Existing, unchanged |
| **tugrust/** (currently tugcode/) | Rust workspace directory containing all crates | Existing. Rename in Phase T0. |

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
