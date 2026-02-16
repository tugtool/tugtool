## Phase 6.0: tugcode Launcher {#phase-tugcode-launcher}

**Purpose:** Deliver a single Rust binary (`tugcode`) that starts tugcast as a child process, parses the auth URL from its stdout, opens the system browser automatically, and manages the full lifecycle via SIGINT/SIGTERM signal handling. After this phase, users run one command to launch the entire dashboard experience.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | -- |
| Last updated | 2026-02-16 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phases 4 and 5 modernized the build toolchain (Bun Pivot, commit `b98163a`) and established the styling foundation (Design Tokens, Icons & Terminal Polish, commit `6594359`). The tugcast server works well -- it attaches to a tmux session, serves the tugdeck dashboard over WebSocket, and supports auth-token-based browser opening via its `--open` flag. However, the user experience requires running `tugcast` directly and managing its lifecycle manually.

The design document at `roadmap/component-roadmap-2.md` Section 6 specifies a launcher binary (`tugcode`) that wraps tugcast: start it as a child process, parse the auth URL from stdout, open the browser, and manage shutdown via signal propagation. This is the "one command, one experience" principle from the design document. tugcode also establishes the parent-process architecture that Phase 7 will extend when tugcast spawns tugtalk as its own child.

#### Strategy {#strategy}

- **New crate, minimal scope.** Create `crates/tugcode` as a new workspace member with a single `main.rs`. Keep the binary small -- its job is process orchestration, not business logic.
- **Reuse existing browser-open logic pattern.** tugcast already has `server::open_browser()` with platform-specific commands. tugcode will implement the same pattern (macOS `open`, Linux `xdg-open`) independently, since tugcode does not link against tugcast.
- **Stdout piping for URL extraction.** tugcode captures tugcast's stdout, scans for the `tugcast: http://...` line using regex, extracts the auth URL, and opens the browser. Remaining stdout is forwarded to tugcode's own stdout so the user sees tugcast's log output.
- **Signal-first lifecycle.** tugcode installs a tokio signal handler for SIGINT (Ctrl-C) and SIGTERM, then sends SIGTERM to the tugcast child process on receipt. No idle timeout, no automatic shutdown on browser disconnect -- the user controls lifetime explicitly.
- **Remove `--open` from tugcast.** Since tugcode now owns browser opening, the `--open` flag on tugcast becomes redundant. Remove it to avoid confusion about which binary opens the browser.
- **Compile-clean at every step.** Each step produces a `cargo build`-clean workspace. No step leaves broken references.

#### Stakeholders / Primary Customers {#stakeholders}

1. End users running tugdeck sessions (the primary audience -- they type `tugcode` instead of `tugcast`)
2. Phase 7 implementers (tugcode establishes the parent-process architecture that tugtalk integration extends)

#### Success Criteria (Measurable) {#success-criteria}

- `cargo build -p tugcode` succeeds and produces a `tugcode` binary (verified by `cargo build -p tugcode && ls target/debug/tugcode`)
- `tugcode` starts tugcast, opens the browser, and the dashboard loads (manual verification)
- Closing the browser tab does not kill tugcast -- page can be reopened by navigating to the URL (manual verification)
- Ctrl-C on tugcode sends SIGTERM to tugcast and both processes exit cleanly (manual verification)
- `tugcode --session`, `--port`, and `--dir` flags pass through to tugcast correctly (unit tests + manual verification)
- `cargo nextest run` passes for the entire workspace with zero regressions
- tugcast's `--open` flag is removed and no longer referenced anywhere

#### Scope {#scope}

1. Create `crates/tugcode/` with `Cargo.toml` and `src/main.rs`
2. Add `tugcode` to workspace members in root `Cargo.toml`
3. Implement CLI argument parsing with clap (session, port, dir flags)
4. Implement child process spawning of tugcast with stdout piped
5. Implement auth URL parsing from tugcast stdout via regex
6. Implement platform-specific browser opening (macOS `open`, Linux `xdg-open`)
7. Implement SIGINT/SIGTERM signal handling with SIGTERM propagation to tugcast
8. Forward tugcast's remaining stdout/stderr to tugcode's own output
9. Remove `--open` flag from tugcast CLI
10. Add unit tests for CLI parsing and URL regex extraction

#### Non-goals (Explicitly out of scope) {#non-goals}

- tugtalk integration (Phase 7 Step 2 scope -- tugcast spawns tugtalk, not tugcode)
- Automatic restart of tugcast if it crashes (simple exit propagation only for now)
- Configuration file support for tugcode (CLI flags only)
- Windows support (design doc specifies macOS and Linux only)
- Idle timeout or automatic shutdown on browser disconnect

#### Dependencies / Prerequisites {#dependencies}

- Phase 4 (Bun Pivot) completed: commit `b98163a`
- Phase 5 (Design Tokens, Icons & Terminal Polish) completed: commit `6594359`
- tugcast binary must be on PATH or discoverable relative to tugcode
- tokio, clap, and regex are already workspace dependencies

#### Constraints {#constraints}

- Must compile with `-D warnings` (project-wide policy in `.cargo/config.toml`)
- tugcode must not link against tugcast or tugcast-core crates -- it spawns tugcast as a subprocess
- Signal handling must use tokio's signal API (`tokio::signal::unix::signal`) for async compatibility
- The auth URL regex must match the exact format tugcast prints: `tugcast: http://127.0.0.1:<port>/auth?token=<hex>`

#### Assumptions {#assumptions}

- The `tugcast` binary is available on PATH when `tugcode` is invoked (both are installed from the same workspace)
- tugcast will continue to print the auth URL on stdout in the format `tugcast: <URL>` (the `println!("\ntugcast: {}\n", auth_url)` call in tugcast's `main()` function)
- tokio's `signal::unix::signal(SignalKind::interrupt())` and `signal::unix::signal(SignalKind::terminate())` are the correct async signal handling approach
- The `libc::kill(pid, libc::SIGTERM)` call is sufficient to propagate shutdown to the tugcast child process
- Phase 7 will extend tugcast (not tugcode) to spawn and manage tugtalk as a child process

---

### 6.0.0 Design Decisions {#design-decisions}

#### [D01] tugcode is a separate binary crate, not a wrapper script (DECIDED) {#d01-separate-binary}

**Decision:** tugcode lives at `crates/tugcode/` as a new Rust binary crate in the workspace, separate from tugcast.

**Rationale:**
- Proper signal handling (SIGTERM/SIGINT propagation) requires a real process manager, not a shell script
- Cross-platform browser opening with error handling is better expressed in Rust
- Parsing tugcast's stdout reliably for the auth URL benefits from regex support
- Consistent with the existing workspace pattern (`crates/tugcast`, `crates/tugtool`)

**Implications:**
- tugcode does not link against tugcast or tugcast-core -- it spawns tugcast as a child process via `tokio::process::Command`
- Both binaries must be installed/available on PATH for the system to work
- The `cargo install` or release workflow must include both binaries

#### [D02] Parse auth URL from tugcast stdout using regex (DECIDED) {#d02-url-regex}

**Decision:** tugcode pipes tugcast's stdout and scans each line for the pattern `tugcast: (http://\S+)` to extract the auth URL.

**Rationale:**
- tugcast already prints the auth URL in a well-defined format in its `main()` function: `println!("\ntugcast: {}\n", auth_url)`
- Regex parsing is simple, reliable, and does not require modifying tugcast's output protocol
- No structured IPC (JSON, socket) is needed for this single piece of data

**Implications:**
- If tugcast changes its output format, the regex must be updated
- tugcode must handle the case where the URL line never appears (timeout or tugcast crash)
- Lines that do not match the regex are forwarded to tugcode's stdout as-is

#### [D03] Remove --open flag from tugcast (DECIDED) {#d03-remove-open-flag}

**Decision:** Remove the `--open` CLI flag from tugcast since tugcode now owns browser opening.

**Rationale:**
- Having two ways to open the browser (tugcast `--open` and tugcode) creates confusion about which is canonical
- tugcode is now the user-facing entry point; tugcast becomes an internal implementation detail
- Simplifies tugcast's CLI surface and removes dead code

**Implications:**
- The `open_browser` function in `crates/tugcast/src/server.rs` is removed
- The `open` field is removed from `crates/tugcast/src/cli.rs`
- The `if cli.open { server::open_browser(&auth_url); }` block in `main.rs` is removed
- Tests referencing the `--open` flag must be updated

#### [D04] Use tokio signal handling for async-compatible shutdown (DECIDED) {#d04-tokio-signals}

**Decision:** tugcode uses `tokio::signal::unix::signal(SignalKind::interrupt())` and `SignalKind::terminate()` to handle SIGINT and SIGTERM asynchronously.

**Rationale:**
- tugcode's main loop is async (tokio runtime), so signal handling must integrate with the async event loop
- tokio's signal API is already available as a workspace dependency
- The select! macro cleanly combines "wait for child exit" and "wait for signal" in a single loop

**Implications:**
- On signal receipt, tugcode sends SIGTERM to the tugcast child process via `libc::kill(child_pid, libc::SIGTERM)`
- tugcode then waits for the child to exit (with a brief timeout) before exiting itself
- If the child does not exit within 3 seconds after SIGTERM, tugcode sends SIGKILL as a fallback

#### [D05] Forward tugcast stdout/stderr after URL extraction (DECIDED) {#d05-forward-output}

**Decision:** After extracting the auth URL, tugcode continues reading tugcast's stdout and forwarding all lines to its own stdout. tugcast's stderr is inherited directly.

**Rationale:**
- Users benefit from seeing tugcast's log output (tracing messages) for debugging
- stderr inheritance is the simplest approach -- no piping or buffering needed
- The URL line itself is also forwarded (not consumed) so it appears in tugcode's output

**Implications:**
- stdout is piped (for URL extraction), stderr is inherited (direct passthrough)
- A background task reads tugcast's stdout line-by-line and prints to tugcode's stdout
- If tugcast produces binary output on stdout, the line reader may behave unexpectedly (not a concern given tugcast only prints text)

---

### 6.0.1 Specification {#specification}

#### 6.0.1.1 CLI Interface {#cli-interface}

**Spec S01: tugcode CLI** {#s01-tugcode-cli}

```
tugcode [OPTIONS]

Options:
  --session <NAME>    Tmux session name (default: cc0)
  --port <PORT>       Port for tugcast HTTP server (default: 7890)
  --dir <PATH>        Working directory for the tmux session (default: .)
  --help              Print help information
  --version           Print version information
```

All options are passed through to the tugcast child process as corresponding `--session`, `--port`, and `--dir` flags.

#### 6.0.1.2 Startup Sequence {#startup-sequence}

**Spec S02: tugcode Startup Sequence** {#s02-startup-sequence}

1. Parse CLI arguments
2. Spawn `tugcast --session <session> --port <port> --dir <dir>` as child process with stdout piped, stderr inherited
3. Read child stdout line-by-line
4. For each line, check against regex `tugcast:\s+(http://\S+)`
5. On first match: extract URL, open system browser, continue forwarding
6. If child exits before URL is found: print error, exit with child's exit code
7. If URL not found within 10 seconds: print timeout warning (continue waiting -- do not kill tugcast)
8. Enter signal-wait loop: `tokio::select!` on child exit and signal receipt

#### 6.0.1.3 Signal Handling {#signal-handling}

**Spec S03: Signal Handling** {#s03-signal-handling}

| Signal | Action |
|--------|--------|
| SIGINT (Ctrl-C) | Send SIGTERM to tugcast child, wait up to 3 seconds, then SIGKILL if still alive |
| SIGTERM | Same as SIGINT |
| Child exits | tugcode exits with the child's exit code |

The signal-wait loop runs after the URL is extracted and the browser is opened. tugcode does not exit until either a signal is received or the child process exits.

#### 6.0.1.4 Browser Opening {#browser-opening}

**Spec S04: Browser Opening** {#s04-browser-opening}

| Platform | Command |
|----------|---------|
| macOS (`target_os = "macos"`) | `open <url>` |
| Linux (`target_os = "linux"`) | `xdg-open <url>` |
| Other | Print URL to stdout with instructions to open manually |

Browser opening is fire-and-forget. If the command fails, tugcode prints a warning but continues running -- the user can manually navigate to the URL.

---

### 6.0.2 Symbol Inventory {#symbol-inventory}

#### 6.0.2.1 New crates {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugcode` | Launcher binary -- starts tugcast, opens browser, manages lifecycle |

#### 6.0.2.2 New files {#new-files}

| File | Purpose |
|------|---------|
| `crates/tugcode/Cargo.toml` | Crate manifest with clap, tokio, regex, libc dependencies |
| `crates/tugcode/src/main.rs` | Entry point: CLI parsing, child process management, signal handling, browser opening |

#### 6.0.2.3 Symbols to add / modify {#symbols}

**New symbols in `crates/tugcode/src/main.rs`:**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Cli` | struct | `main.rs` | Clap-derived CLI argument struct (session, port, dir) |
| `main` | fn | `main.rs` | Async entry point with `#[tokio::main]` |
| `spawn_tugcast` | fn | `main.rs` | Spawns tugcast as child process with piped stdout |
| `extract_auth_url` | fn | `main.rs` | Reads lines from stdout, returns URL on regex match |
| `open_browser` | fn | `main.rs` | Platform-specific browser opening |
| `wait_for_shutdown` | fn | `main.rs` | Signal-wait loop with SIGTERM propagation |
| `AUTH_URL_REGEX` | static (LazyLock) | `main.rs` | Compiled regex for `tugcast:\s+(http://\S+)` |

**Modified symbols in tugcast:**

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Cli::open` | field (remove) | `crates/tugcast/src/cli.rs` | Remove `--open` flag |
| `open_browser` | fn (remove) | `crates/tugcast/src/server.rs` | Remove browser-open function |

---

### 6.0.3 Documentation Plan {#documentation-plan}

- [ ] Update `CLAUDE.md` common commands section to list `tugcode` as the primary user-facing command
- [ ] Add `tugcode --help` output to show available flags

---

### 6.0.4 Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test CLI parsing, URL regex extraction | Core logic in isolation |
| **Integration** | Test tugcode spawning tugcast, full startup sequence | End-to-end lifecycle (manual, requires tmux) |

#### Unit Tests {#unit-tests}

- CLI argument parsing: default values, overrides for each flag, version/help flags
- Auth URL regex: matches the expected `tugcast: http://...` format
- Auth URL regex: extracts the URL correctly from a multi-line output
- Auth URL regex: does not match unrelated lines
- Auth URL regex: handles different port numbers and token lengths

#### Integration Tests (Manual) {#integration-tests-manual}

- `tugcode` starts, browser opens, dashboard loads
- Closing browser tab does not kill tugcast
- Refreshing browser reconnects WebSocket
- Ctrl-C on tugcode sends SIGTERM to tugcast
- `tugcode --session custom --port 8080 --dir /tmp` passes flags correctly
- tmux session survives after tugcode exits

---

### 6.0.5 Execution Steps {#execution-steps}

#### Step 0: Scaffold tugcode crate and add to workspace {#step-0}

**Commit:** `feat(tugcode): scaffold crate with CLI argument parsing`

**References:** [D01] tugcode is a separate binary crate, Spec S01, (#new-crates, #new-files, #cli-interface)

**Artifacts:**
- `crates/tugcode/Cargo.toml` with clap, tokio, regex, libc dependencies
- `crates/tugcode/src/main.rs` with Cli struct and basic argument parsing
- Updated root `Cargo.toml` workspace members list

**Tasks:**
- [ ] Create `crates/tugcode/Cargo.toml` with workspace dependencies: `clap`, `tokio` (full features), `regex`, `libc`, `tracing`, `tracing-subscriber`
- [ ] Create `crates/tugcode/src/main.rs` with `Cli` struct derived from clap: `--session` (default `cc0`), `--port` (default `7890`), `--dir` (default `.`)
- [ ] Add `"crates/tugcode"` to the workspace members array in the root `Cargo.toml`
- [ ] Add a minimal `#[tokio::main] async fn main()` that parses CLI args and prints them (placeholder)
- [ ] Implement `--version` and `--help` support via clap derive macros

**Tests:**
- [ ] Unit test: default CLI values (`session=cc0`, `port=7890`, `dir=.`)
- [ ] Unit test: override each flag individually
- [ ] Unit test: all flags combined
- [ ] Unit test: `--version` flag returns `DisplayVersion` error kind
- [ ] Unit test: `--help` flag returns `DisplayHelp` error kind

**Checkpoint:**
- [ ] `cargo build -p tugcode` succeeds with zero warnings
- [ ] `cargo nextest run -p tugcode` passes all tests
- [ ] `cargo nextest run` passes for the entire workspace

**Rollback:**
- Revert commit, remove `crates/tugcode/` directory, remove workspace member entry

**Commit after all checkpoints pass.**

---

#### Step 1: Implement child process spawning and auth URL extraction {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugcode): spawn tugcast child process and extract auth URL`

**References:** [D02] Parse auth URL from tugcast stdout using regex, [D05] Forward tugcast stdout/stderr after URL extraction, Spec S02, (#startup-sequence, #symbols)

**Artifacts:**
- `spawn_tugcast` function in `main.rs`
- `extract_auth_url` function in `main.rs`
- `AUTH_URL_REGEX` constant in `main.rs`
- Stdout forwarding background task

**Tasks:**
- [ ] Define `AUTH_URL_REGEX` as a `LazyLock<Regex>` matching `tugcast:\s+(http://\S+)`
- [ ] Implement `spawn_tugcast` function: builds `tokio::process::Command` for `tugcast` with `--session`, `--port`, `--dir` flags, stdout piped, stderr inherited
- [ ] Implement `extract_auth_url` function: reads stdout lines via `BufReader`, checks each against regex, returns the captured URL on first match
- [ ] After URL extraction, spawn a background tokio task that continues reading remaining stdout lines and prints them to tugcode's stdout
- [ ] Handle the case where tugcast exits before the URL line appears: print an error message and exit with the child's exit code
- [ ] Wire the main function to call `spawn_tugcast`, then `extract_auth_url`, then print the extracted URL

**Tests:**
- [ ] Unit test: `AUTH_URL_REGEX` matches `tugcast: http://127.0.0.1:7890/auth?token=abc123def456`
- [ ] Unit test: `AUTH_URL_REGEX` captures the full URL correctly
- [ ] Unit test: `AUTH_URL_REGEX` does not match `INFO tugcast starting` or other log lines
- [ ] Unit test: `AUTH_URL_REGEX` matches URLs with various port numbers (80, 8080, 7890)

**Checkpoint:**
- [ ] `cargo build -p tugcode` succeeds with zero warnings
- [ ] `cargo nextest run -p tugcode` passes all tests
- [ ] `cargo nextest run` passes for the entire workspace

**Rollback:**
- Revert commit; Step 0 artifacts remain intact

**Commit after all checkpoints pass.**

---

#### Step 2: Implement browser opening and signal handling {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugcode): add browser opening and SIGINT/SIGTERM signal handling`

**References:** [D04] Use tokio signal handling for async-compatible shutdown, Spec S03, Spec S04, (#signal-handling, #browser-opening)

**Artifacts:**
- `open_browser` function in `main.rs`
- `wait_for_shutdown` function in `main.rs`
- Complete main function wiring all components together

**Tasks:**
- [ ] Implement `open_browser` function with `cfg(target_os)` conditionals: macOS uses `open`, Linux uses `xdg-open`, other platforms print the URL with manual instructions
- [ ] Implement `wait_for_shutdown` function using `tokio::select!` on: (a) child process exit via `child.wait()`, (b) SIGINT via `tokio::signal::unix::signal(SignalKind::interrupt())`, (c) SIGTERM via `tokio::signal::unix::signal(SignalKind::terminate())`
- [ ] On signal receipt: send SIGTERM to child via `libc::kill(child_pid as i32, libc::SIGTERM)`, then `tokio::time::timeout(Duration::from_secs(3), child.wait())`, and SIGKILL if timeout
- [ ] On child exit: tugcode exits with the child's exit code
- [ ] Wire the complete main function: parse CLI -> spawn tugcast -> extract URL -> open browser -> wait for shutdown
- [ ] Add tracing initialization with `RUST_LOG` support (same pattern as tugcast)

**Tests:**
- [ ] Unit test: verify `open_browser` function compiles on the current platform (cfg-gated)
- [ ] Unit test: `wait_for_shutdown` logic is testable via mock child process (or defer to integration test)

**Checkpoint:**
- [ ] `cargo build -p tugcode` succeeds with zero warnings
- [ ] `cargo nextest run -p tugcode` passes all tests
- [ ] `cargo nextest run` passes for the entire workspace
- [ ] Manual test: `cargo run -p tugcode` starts tugcast, opens browser, dashboard loads
- [ ] Manual test: Ctrl-C on tugcode causes both processes to exit

**Rollback:**
- Revert commit; Steps 0-1 artifacts remain intact

**Commit after all checkpoints pass.**

---

#### Step 3: Remove --open flag from tugcast {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugcast): remove --open flag (browser opening moved to tugcode)`

**References:** [D03] Remove --open flag from tugcast, (#symbols)

**Artifacts:**
- Modified `crates/tugcast/src/cli.rs` (remove `open` field and `--open` arg)
- Modified `crates/tugcast/src/server.rs` (remove `open_browser` function)
- Modified `crates/tugcast/src/main.rs` (remove `--open` usage)
- Updated tests in `crates/tugcast/src/cli.rs`

**Tasks:**
- [ ] Remove the `open: bool` field and its `#[arg(long, ...)]` attribute from `Cli` in `crates/tugcast/src/cli.rs`
- [ ] Remove `open = cli.open,` from the `info!` tracing macro in `crates/tugcast/src/main.rs` (the startup log that prints session, port, dir, open)
- [ ] Remove the `if cli.open { server::open_browser(&auth_url); }` block from `crates/tugcast/src/main.rs`
- [ ] Remove the `pub fn open_browser(url: &str)` function from `crates/tugcast/src/server.rs`
- [ ] Update the `long_about` string in `crates/tugcast/src/cli.rs` to remove the `tugcast --open` usage example line
- [ ] Update CLI tests in `crates/tugcast/src/cli.rs`: remove `test_open_flag`, update `test_default_values` to remove `assert!(!cli.open)`, update `test_all_overrides` to not include `--open` and remove `assert!(cli.open)`, update `test_help_contains_flags` to not assert `--open`
- [ ] Verify no remaining references to `--open` or `open_browser` in the tugcast crate

**Tests:**
- [ ] Unit test: `Cli::try_parse_from(["tugcast", "--open"])` now returns an error (flag no longer recognized)
- [ ] Existing tests updated to pass without the `--open` flag

**Checkpoint:**
- [ ] `cargo build -p tugcast` succeeds with zero warnings
- [ ] `cargo nextest run -p tugcast` passes all tests
- [ ] `cargo nextest run` passes for the entire workspace
- [ ] `grep -r "open_browser\|--open" crates/tugcast/src/` returns no matches (except test asserting it is gone)

**Rollback:**
- Revert commit; tugcast's `--open` flag is restored

**Commit after all checkpoints pass.**

---

### 6.0.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `tugcode` binary that provides a single-command launch experience for the tugdeck dashboard -- starting tugcast, opening the browser, and managing shutdown via signal propagation.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugcode` produces a working `tugcode` binary
- [ ] `tugcode` starts tugcast as a child process and the dashboard loads in the browser
- [ ] Ctrl-C on tugcode cleanly shuts down both tugcode and tugcast
- [ ] Closing the browser tab does not kill tugcast (page can be reopened)
- [ ] `tugcode --session`, `--port`, `--dir` flags pass through to tugcast correctly
- [ ] tugcast's `--open` flag is removed
- [ ] `cargo nextest run` passes for the entire workspace with zero regressions
- [ ] Zero compiler warnings across all crates

**Acceptance tests:**
- [ ] Unit: CLI argument parsing for tugcode (defaults, overrides, version, help)
- [ ] Unit: Auth URL regex matches expected format and rejects non-matching lines
- [ ] Integration (manual): Full startup-to-shutdown lifecycle with browser opening

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 7 Step 2: tugcast spawns tugtalk as a child process, extending the process tree to tugcode -> tugcast -> tugtalk
- [ ] Automatic tugcast restart on crash (not in scope for Phase 6)
- [ ] Configuration file support for tugcode defaults

| Checkpoint | Verification |
|------------|--------------|
| tugcode binary builds | `cargo build -p tugcode` exits 0 |
| All workspace tests pass | `cargo nextest run` exits 0 |
| tugcode launches dashboard | Manual: `cargo run -p tugcode`, browser opens, dashboard loads |
| Signal handling works | Manual: Ctrl-C, verify both processes exit |
| --open removed from tugcast | `grep -r "open_browser\|--open" crates/tugcast/src/` returns nothing |

**Commit after all checkpoints pass.**
