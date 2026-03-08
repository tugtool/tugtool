<!-- tugplan-skeleton v2 -->

## Tugbank CLI Binary (Phase 5e2) {#tugbank-cli}

**Purpose:** Ship a `defaults`-like command-line tool (`tugbank`) that wraps `tugbank-core` for debugging, scripting, and manual inspection of tugbank databases.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugbank-cli |
| Last updated | 2026-03-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 5e1 shipped `tugbank-core`, a SQLite-backed typed defaults store library. The library is fully tested and provides domain-scoped key-value storage with CAS generation counters. However, there is currently no way to interact with a tugbank database from the command line. Developers need a CLI tool for debugging defaults, scripting workflows, and manually inspecting database contents without writing Rust code.

Phase 5e2 creates the `tugbank` binary crate that wraps `tugbank-core` into a `defaults`-like CLI, following the same patterns established by the `tugcode` binary (clap-based CLI, `--json` flag for machine output, structured exit codes).

#### Strategy {#strategy}

- Build a single-file binary crate (`Cargo.toml` + `src/main.rs`) that depends on `tugbank-core` and `clap`.
- Expose seven subcommands matching the `tugbank-core` API surface: `domains`, `read`, `write`, `delete`, `keys`, `cas-write`, `generation`.
- Add a `delete_domain` method to `tugbank-core` (it does not exist yet) and expose it via `tugbank delete <domain>` (no key argument).
- Use human-readable text as the default output format; `--json` flag switches to machine-readable JSON (no `--pretty` flag, matching tugcode convention).
- Support database path resolution in precedence order: `--path` flag > `TUGBANK_PATH` env var > `~/.tugbank.db`.
- Define five exit code categories for scripting: 0=success, 2=not found, 3=conflict, 4=invalid usage, 5=busy/timeout, 1=other.
- Write integration-style CLI tests using `assert_cmd` and `tempfile`.

#### Success Criteria (Measurable) {#success-criteria}

- All seven subcommands (`domains`, `read`, `write`, `delete`, `keys`, `cas-write`, `generation`) work end-to-end (`cargo run -p tugbank -- <subcommand>` exits 0 for valid inputs) (verify: integration tests)
- `--json` output is valid JSON matching Spec S01 envelope for all subcommands (verify: integration tests parse JSON output)
- Exit codes match Table T01 for all error categories (verify: integration tests assert process exit codes)
- `delete_domain` method added to `tugbank-core` and passes unit tests (verify: `cargo nextest run -p tugbank-core`)
- `cargo nextest run -p tugbank` passes all integration tests with zero warnings (verify: CI)
- `cargo build -p tugbank` produces the `tugbank` binary with zero warnings (verify: `-D warnings` enforcement)

#### Scope {#scope}

1. New binary crate `tugcode/crates/tugbank/` with `Cargo.toml` and `src/main.rs`
2. Workspace `Cargo.toml` updated to include `crates/tugbank` in members
3. Seven subcommands: `domains`, `read`, `write`, `delete`, `keys`, `cas-write`, `generation`
4. Global flags: `--path <db-path>`, `--json`
5. Database path resolution: `--path` > `TUGBANK_PATH` env var > `~/.tugbank.db`
6. Exit code mapping per Table T01
7. `delete_domain` method added to `tugbank-core` (`DefaultsStore`)
8. Integration tests for all subcommands and error conditions

#### Non-goals (Explicitly out of scope) {#non-goals}

- GUI or TUI interface
- Batch import/export commands
- Schema migration tooling
- Network/HTTP access (that is Phase 5e3)
- `--pretty` flag (dropped per user decision; `--json` only)
- Shell completion generation

#### Dependencies / Prerequisites {#dependencies}

- `tugbank-core` crate must be complete and passing tests (Phase 5e1 is complete)
- `clap` workspace dependency available (already in workspace `Cargo.toml`)
- `dirs` workspace dependency available (already in workspace `Cargo.toml`)

#### Constraints {#constraints}

- Warnings are errors (`-D warnings` via `tugcode/.cargo/config.toml`)
- Binary crate must be minimal: `Cargo.toml` + `src/main.rs` only
- Must follow existing tugcode CLI conventions (clap derive, `--json` flag)

#### Assumptions {#assumptions}

- The `tugbank` binary will be a standalone tool, not integrated into the `tugcode` binary
- `assert_cmd` will be added as a workspace dev-dependency for integration testing
- The `base64` crate will be added as a workspace dependency for bytes input/output encoding
- `dirs::home_dir()` reliably returns the user's home directory on macOS

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions have been resolved via user answers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `dirs::home_dir()` returns `None` on some systems | med | low | Fall back to error with clear message suggesting `--path` or `TUGBANK_PATH` | User reports on non-standard system |
| `assert_cmd` adds compile-time overhead | low | med | Only in `[dev-dependencies]`; does not affect release binary | Build times become unacceptable |

**Risk R01: Home directory resolution failure** {#r01-home-dir}

- **Risk:** `dirs::home_dir()` returns `None` on headless or containerized systems where `$HOME` is not set.
- **Mitigation:** Print a clear error message explaining that neither `--path` nor `TUGBANK_PATH` was provided and the home directory could not be determined. Suggest using `--path` or setting `TUGBANK_PATH`.
- **Residual risk:** Users on edge-case systems must always specify an explicit path.

---

### Design Decisions {#design-decisions}

#### [D01] Single-file binary crate structure (DECIDED) {#d01-single-file-crate}

**Decision:** The `tugbank` binary crate consists of `Cargo.toml` and `src/main.rs` only, with no module splits.

**Rationale:**
- The CLI surface area is small (seven subcommands, each a few lines of logic)
- Matches the pattern described in the implementation strategy
- Keeps the crate simple to navigate

**Implications:**
- All CLI parsing, command dispatch, output formatting, and error handling live in `main.rs`
- If the CLI grows significantly in future phases, it can be refactored into modules then

#### [D02] Database path resolution order (DECIDED) {#d02-path-resolution}

**Decision:** Database path is resolved in this precedence order: `--path` CLI flag > `TUGBANK_PATH` environment variable > `~/.tugbank.db` default.

**Rationale:**
- CLI flags should always win (standard Unix convention)
- Environment variable provides a middle ground for scripting without repeating `--path`
- `~/.tugbank.db` is the canonical default from the implementation strategy

**Implications:**
- The `resolve_db_path` function checks all three sources in order
- Error exit (code 4) if no path can be determined (home dir unavailable and no override)

#### [D03] Human-readable text default, --json for machine output (DECIDED) {#d03-output-format}

**Decision:** Human-readable plain text is the default output format. The `--json` global flag switches to machine-readable JSON output. No `--pretty` flag.

**Rationale:**
- Matches the existing `tugcode` CLI convention
- Keeps the flag surface minimal
- JSON output uses a consistent envelope pattern for scripting

**Implications:**
- Every subcommand must implement both text and JSON output paths
- JSON output follows Spec S01 envelope format

#### [D04] Exit code categories (DECIDED) {#d04-exit-codes}

**Decision:** Five exit code categories: 0=success, 1=other/internal error, 2=not found, 3=CAS conflict, 4=invalid usage, 5=busy/timeout.

**Rationale:**
- Enables scripting with `$?` checks for specific error conditions
- Separates "not found" (recoverable) from "conflict" (retry-able) from "usage error" (fix arguments)
- Matches the spec from the implementation strategy

**Implications:**
- Error mapping function converts `tugbank_core::Error` variants to exit codes
- Clap argument validation errors (unknown flags, invalid enum variants) exit with code 2 via `Cli::parse()` — this matches the `tugcode` convention and happens before `main()` gains control
- Application-level usage errors (value parse failures, missing home dir) exit with code 4
- SQLite busy errors map to exit code 5

#### [D05] Bytes input via base64 and bytes-file (DECIDED) {#d05-bytes-input}

**Decision:** The `write` subcommand accepts bytes values as base64-encoded strings (`--type bytes <base64>`), and also supports `--bytes-file <path>` which reads the file and base64-encodes its contents automatically.

**Rationale:**
- Base64 is the standard encoding for binary data on the command line
- `--bytes-file` is a convenience for the common case of storing file contents
- Avoids shell escaping issues with raw binary data

**Implications:**
- The `base64` crate is added as a dependency for encoding/decoding
- `write` subcommand has a `--bytes-file` option that is mutually exclusive with positional value argument when type is `bytes`
- `read` subcommand outputs bytes values as base64 in both text and JSON modes

#### [D06] Add delete_domain to tugbank-core (DECIDED) {#d06-delete-domain}

**Decision:** Add a `delete_domain` method to `DefaultsStore` that deletes all entries for a domain and removes the domain row. Expose this via `tugbank delete <domain>` (without a key argument).

**Rationale:**
- The `delete` subcommand needs to support both key deletion and whole-domain deletion
- `delete <domain> <key>` deletes a single key; `delete <domain>` (no key) deletes the entire domain
- This requires a new method in `tugbank-core` since only per-key `remove` exists today

**Implications:**
- `DefaultsStore::delete_domain(&self, name: &str) -> Result<bool, Error>` is added
- Returns `true` if the domain existed, `false` otherwise
- Deletes all entries in the domain, then removes the domain row
- The domain generation counter is lost (intentional — the domain is gone)

---

### Specification {#specification}

#### Command-Line Interface {#cli-spec}

**Spec S01: JSON output envelope** {#s01-json-envelope}

All `--json` output uses this envelope:

```json
{
  "ok": true,
  "data": { ... }
}
```

On error:

```json
{
  "ok": false,
  "error": "<error message>"
}
```

**Spec S02: Subcommand signatures** {#s02-subcommands}

```
tugbank [--path <db-path>] [--json] <command>

tugbank domains                          # list all domains
tugbank read <domain> [<key>]            # read one key or all keys in domain
tugbank write <domain> <key> [--type <type>] <value>  # write a value
tugbank write <domain> <key> --bytes-file <path>      # write file as bytes
tugbank delete <domain> [<key>]          # delete key or entire domain
tugbank keys <domain>                    # list keys in a domain
tugbank cas-write <domain> <key> [--type <type>] <value> --generation <gen>  # CAS write
tugbank generation <domain>              # get domain generation counter
```

**Spec S03: Value type flags for write/cas-write** {#s03-value-types}

The `--type` flag specifies the value type. Default is `string`.

| `--type` value | Interpretation | Example |
|---------------|---------------|---------|
| `string` (default) | UTF-8 string | `tugbank write d k "hello"` |
| `bool` | `true` or `false` | `tugbank write d k --type bool true` |
| `int` | 64-bit signed integer | `tugbank write d k --type int 42` |
| `float` | 64-bit float | `tugbank write d k --type float 3.14` |
| `json` | JSON value | `tugbank write d k --type json '{"a":1}'` |
| `bytes` | Base64-encoded bytes | `tugbank write d k --type bytes aGVsbG8=` |
| `null` | Null value (no value arg) | `tugbank write d k --type null` |

**Spec S04: Text output formats** {#s04-text-output}

| Command | Text output |
|---------|-------------|
| `domains` | One domain name per line |
| `read <domain>` | `key\ttype\tvalue` per line, tab-separated |
| `read <domain> <key>` | Just the value (string/int/float/bool as literal, bytes as base64, json as JSON text, null as `null`) |
| `write` | No output on success |
| `delete` | No output on success |
| `keys <domain>` | One key per line |
| `cas-write` | No output on success |
| `generation <domain>` | The generation number as a plain integer |

**Table T01: Exit codes** {#t01-exit-codes}

| Code | Meaning | When |
|------|---------|------|
| 0 | Success | Operation completed |
| 1 | Internal/other error | Unexpected errors, SQLite errors (non-busy) |
| 2 | Not found / clap error | Key or domain does not exist (for `read <domain> <key>`); also used by clap for argument validation errors (unknown flags, missing required args, invalid enum variants) before `main()` gains control — this matches `tugcode` convention of using `Cli::parse()` |
| 3 | CAS conflict | `cas-write` generation mismatch |
| 4 | Invalid usage (app-level) | Application-level validation errors: value parse failures (e.g. `--type bool notabool`), missing home dir with no `--path` override, file read errors for `--bytes-file`, `Error::ValueTooLarge` (blob exceeds 10 MB), `Error::Serde` (malformed JSON input), `Error::InvalidDomain`, `Error::InvalidKey` |
| 5 | Busy/timeout | SQLite busy timeout exceeded |

#### Public API Surface (tugbank-core addition) {#api-surface}

**Spec S05: delete_domain method** {#s05-delete-domain}

```rust
impl DefaultsStore {
    /// Delete an entire domain: remove all entries and the domain row.
    /// Returns `true` if the domain existed, `false` if it did not.
    /// Returns `Error::InvalidDomain` if `name` is empty.
    pub fn delete_domain(&self, name: &str) -> Result<bool, Error>;
}
```

**Spec S06: Error::exit_code method** {#s06-error-exit-code}

```rust
impl Error {
    /// Map this error to a CLI exit code per Table T01.
    pub fn exit_code(&self) -> u8;
}
```

Mapping:
- `Error::Conflict` => 3
- `Error::InvalidDomain` | `Error::InvalidKey` | `Error::ValueTooLarge` | `Error::Serde` => 4
- `Error::Sqlite(rusqlite::Error::SqliteFailure(e, _))` where `e.code == rusqlite::ErrorCode::DatabaseBusy` => 5
- All other `Error::Sqlite` variants => 1

This method lives in `tugbank-core` so that busy-detection logic stays with the crate that owns `rusqlite` as a dependency. The `tugbank` binary crate calls `err.exit_code()` without needing `rusqlite` as a direct dependency.

Semantics:
- Uses `BEGIN IMMEDIATE` transaction
- Deletes the domain row from the `domains` table; the `entries` table has `ON DELETE CASCADE` on the `domain` foreign key, so all entries for that domain are removed automatically by SQLite
- The explicit `DELETE FROM entries` step is therefore unnecessary — deleting the domain row alone suffices. The implementation relies on CASCADE for correctness, keeping the code simple.
- Returns `true` if the domain row existed, `false` otherwise
- Does not bump generation (the domain is being removed entirely)

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates (if any) {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugbank` | Binary crate wrapping `tugbank-core` into a CLI tool |

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugcode/crates/tugbank/Cargo.toml` | Crate manifest for the tugbank binary |
| `tugcode/crates/tugbank/src/main.rs` | CLI entry point: clap parsing, command dispatch, output formatting |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `DefaultsStore::delete_domain` | fn | `tugbank-core/src/store.rs` | New method, see Spec S05 |
| `Error::exit_code` | fn | `tugbank-core/src/error.rs` | Maps error variants to CLI exit codes, see Spec S06 |
| `Cli` | struct (derive) | `tugbank/src/main.rs` | Top-level clap args (`--path`, `--json`) |
| `Commands` | enum (derive) | `tugbank/src/main.rs` | Subcommand dispatch enum |
| `ValueType` | enum | `tugbank/src/main.rs` | `--type` flag values |
| `resolve_db_path` | fn | `tugbank/src/main.rs` | Path resolution: flag > env > default |
| `json_ok` | fn | `tugbank/src/main.rs` | Prints JSON success envelope |
| `json_err` | fn | `tugbank/src/main.rs` | Prints JSON error envelope |

---

### Documentation Plan {#documentation-plan}

- [ ] Add `tugbank` to the repository README's CLI tools section
- [ ] Ensure `tugbank --help` and subcommand `--help` output is accurate and complete

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `delete_domain` in `tugbank-core` | New method on `DefaultsStore` |
| **Integration** | Test all CLI subcommands end-to-end via `assert_cmd` | Every subcommand, error paths, exit codes |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add delete_domain to tugbank-core {#step-1}

**Commit:** `feat(tugbank-core): add delete_domain method to DefaultsStore`

**References:** [D06] Add delete_domain to tugbank-core, [D04] Exit codes, Spec S05, Spec S06, (#api-surface)

**Artifacts:**
- Modified `tugcode/crates/tugbank-core/src/store.rs` — new `delete_domain` method
- Modified `tugcode/crates/tugbank-core/src/store.rs` (tests) — unit tests for delete_domain
- Modified `tugcode/crates/tugbank-core/src/error.rs` — new `exit_code` method on `Error`

**Tasks:**
- [ ] Implement `DefaultsStore::delete_domain(&self, name: &str) -> Result<bool, Error>` in `store.rs`
- [ ] Validate that `name` is non-empty (return `Error::InvalidDomain` for empty string)
- [ ] Use `BEGIN IMMEDIATE` transaction: delete the domain row (entries are removed via `ON DELETE CASCADE` on the foreign key)
- [ ] Return `true` if the domain row was deleted, `false` if it did not exist
- [ ] Implement `Error::exit_code(&self) -> u8` in `error.rs` per Spec S06: `Conflict => 3`, `InvalidDomain | InvalidKey | ValueTooLarge | Serde => 4`, `Sqlite(SqliteFailure(e, _))` where `e.code == DatabaseBusy` `=> 5`, all other `Sqlite => 1`

**Tests:**
- [ ] T01: `delete_domain` on a domain with entries returns `true` and removes all entries and the domain row
- [ ] T02: `delete_domain` on a non-existent domain returns `false`
- [ ] T03: `delete_domain` with empty string returns `Error::InvalidDomain`
- [ ] T04: After `delete_domain`, `list_domains` no longer includes the deleted domain
- [ ] T05: After `delete_domain`, `get` on former keys returns `None` (via a new domain handle)
- [ ] T05a: `Error::exit_code` returns correct codes for each error variant (Conflict=3, InvalidDomain=4, InvalidKey=4, ValueTooLarge=4, Serde=4, Sqlite(non-busy)=1)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`
- [ ] `cd tugcode && cargo build -p tugbank-core`

---

#### Step 2: Scaffold tugbank binary crate {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugbank): scaffold binary crate with clap CLI and path resolution`

**References:** [D01] Single-file binary crate structure, [D02] Database path resolution order, [D03] Human-readable text default, [D04] Exit codes, Spec S01, Spec S02, Table T01, (#cli-spec, #constraints)

**Artifacts:**
- New `tugcode/crates/tugbank/Cargo.toml`
- New `tugcode/crates/tugbank/src/main.rs`
- Modified `tugcode/Cargo.toml` — add `crates/tugbank` to workspace members

**Tasks:**
- [ ] Create `tugcode/crates/tugbank/Cargo.toml` with dependencies: `tugbank-core` (path), `clap` (workspace), `serde_json` (workspace), `dirs` (workspace), `base64` (add to workspace as `base64 = "0.22"`)
- [ ] Add `assert_cmd` and `tempfile` as workspace dev-dependencies (add `assert_cmd` to workspace Cargo.toml)
- [ ] Add `crates/tugbank` to `[workspace.members]` in `tugcode/Cargo.toml`
- [ ] Define `Cli` struct with `#[derive(Parser)]`: global `--path` option, `--json` flag, subcommand
- [ ] Define `Commands` enum with `#[derive(Subcommand)]`: all seven subcommands per Spec S02
- [ ] Define `ValueType` enum with `#[derive(ValueEnum)]` for `--type` flag per Spec S03
- [ ] Implement `resolve_db_path(cli_path: Option<&str>) -> Result<PathBuf, String>` per [D02]
- [ ] Implement error-to-exit-code mapping by calling `err.exit_code()` (provided by `tugbank_core::Error` per Spec S06). No `rusqlite` dependency needed in the binary crate — busy-detection is encapsulated in `tugbank-core`
- [ ] Implement `json_ok(data: &serde_json::Value)` and `json_err(msg: &str)` per Spec S01
- [ ] Implement `main()` with command dispatch skeleton (each command prints placeholder or calls tugbank-core)
- [ ] Implement `domains` subcommand: list all domains (text: one per line; JSON: `{"ok":true,"data":{"domains":[...]}}`)
- [ ] Implement `keys` subcommand: list keys in a domain (text: one per line; JSON: `{"ok":true,"data":{"keys":[...]}}`)
- [ ] Implement `generation` subcommand: print domain generation (text: plain number; JSON: `{"ok":true,"data":{"generation":N}}`)

**Tests:**
- [ ] T06: `tugbank --help` exits 0
- [ ] T07: `tugbank domains` on empty database prints nothing (text) or `{"ok":true,"data":{"domains":[]}}` (JSON)
- [ ] T08: `tugbank keys <domain>` on empty domain prints nothing (text) or `{"ok":true,"data":{"keys":[]}}` (JSON)
- [ ] T09: `tugbank generation <domain>` on unwritten domain prints `0`
- [ ] T10: Path resolution uses `--path` over env var over default

**Checkpoint:**
- [ ] `cd tugcode && cargo build -p tugbank`
- [ ] `cd tugcode && cargo nextest run -p tugbank`

---

#### Step 3: Implement write and read subcommands {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugbank): implement write and read subcommands with all value types`

**References:** [D03] Human-readable text default, [D05] Bytes input via base64 and bytes-file, Spec S02, Spec S03, Spec S04, Table T01, (#cli-spec, #s03-value-types)

**Artifacts:**
- Modified `tugcode/crates/tugbank/src/main.rs` — write and read command implementations

**Tasks:**
- [ ] Implement `write` subcommand: parse `--type` flag, convert CLI value to `tugbank_core::Value`, call `handle.set()`
- [ ] Handle `--type null` (no value argument required)
- [ ] Handle `--type bytes` with base64 decoding of the value argument
- [ ] Handle `--bytes-file <path>`: read file contents, store as `Value::Bytes`
- [ ] Handle `--type json`: parse the value argument as JSON
- [ ] Handle `--type bool`: parse `true`/`false` (case-insensitive)
- [ ] Handle `--type int`: parse as `i64`
- [ ] Handle `--type float`: parse as `f64`
- [ ] Handle `--type string` (default): store as `Value::String`
- [ ] Implement `read <domain> <key>`: print single value (text format per Spec S04, JSON envelope with value and type). Note: `tugbank_core::Value` does not derive `Serialize`, so implement a manual `value_to_json(v: &Value) -> serde_json::Value` conversion function that maps each variant to its JSON representation (bytes as base64 string, etc.)
- [ ] Implement `read <domain>` (no key): print all key-value pairs (text: tab-separated; JSON: object of key-value pairs with types), using the same manual `value_to_json` conversion
- [ ] Return exit code 2 when `read <domain> <key>` finds no value

**Tests:**
- [ ] T11: `write` then `read` roundtrip for each value type (string, bool, int, float, json, bytes, null)
- [ ] T12: `write --bytes-file <path>` stores file contents correctly
- [ ] T13: `read` with `--json` produces valid JSON envelope with type field
- [ ] T14: `read <domain> <key>` on nonexistent key exits with code 2
- [ ] T15: `read <domain>` lists all key-value pairs
- [ ] T16: `write --type bool invalid` exits with code 4
- [ ] T17: `write --type foobar value` exits with code 2 (clap rejects unknown `ValueEnum` variant before `main()` gains control, per Table T01)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank`

---

#### Step 4: Implement delete, cas-write, and domain deletion {#step-4}

**Depends on:** #step-3

**Commit:** `feat(tugbank): implement delete and cas-write subcommands`

**References:** [D04] Exit codes, [D06] Add delete_domain to tugbank-core, Spec S02, Spec S05, Table T01, (#t01-exit-codes)

**Artifacts:**
- Modified `tugcode/crates/tugbank/src/main.rs` — delete and cas-write command implementations

**Tasks:**
- [ ] Implement `delete <domain> <key>`: call `handle.remove(key)`, exit 0 if deleted, exit 2 if not found
- [ ] Implement `delete <domain>` (no key): call `store.delete_domain(domain)`, exit 0 if deleted, exit 2 if not found
- [ ] Implement `cas-write <domain> <key> --generation <gen> [--type <type>] <value>`: call `handle.set_if_generation()`
- [ ] On `SetOutcome::Conflict`, exit with code 3 and print conflict message (text: "conflict: generation is now N"; JSON: error envelope with current generation)
- [ ] Map SQLite busy errors to exit code 5

**Tests:**
- [ ] T18: `delete <domain> <key>` on existing key exits 0
- [ ] T19: `delete <domain> <key>` on nonexistent key exits 2
- [ ] T20: `delete <domain>` removes entire domain and exits 0
- [ ] T21: `delete <domain>` on nonexistent domain exits 2
- [ ] T22: `cas-write` with correct generation writes successfully (exit 0)
- [ ] T23: `cas-write` with stale generation exits 3 (conflict)
- [ ] T24: `cas-write --json` conflict output includes current generation
- [ ] T25: End-to-end workflow: create database, write values, read them back, delete them, verify domains empty
- [ ] T26: `TUGBANK_PATH` env var overrides default path
- [ ] T27: `--path` flag overrides `TUGBANK_PATH` env var

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank`

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Single-file binary crate structure, [D02] Database path resolution order, [D03] Human-readable text default, [D04] Exit codes, [D05] Bytes input via base64 and bytes-file, [D06] Add delete_domain to tugbank-core, Spec S01, Spec S02, Table T01, (#success-criteria)

**Tasks:**
- [ ] Verify all seven subcommands work end-to-end with both text and JSON output
- [ ] Verify exit codes match Table T01 for all error categories
- [ ] Verify `--path` flag, `TUGBANK_PATH` env var, and default path all work
- [ ] Verify `tugbank-core` tests still pass after `delete_domain` addition

**Tests:**
- [ ] T28: All tugbank-core and tugbank tests pass together (`cargo nextest run -p tugbank-core -p tugbank`)

**Checkpoint:**
- [ ] `cd tugcode && cargo nextest run -p tugbank-core`
- [ ] `cd tugcode && cargo nextest run -p tugbank`
- [ ] `cd tugcode && cargo build -p tugbank`
- [ ] `cd tugcode && cargo fmt --all --check`
- [ ] `cd tugcode && cargo clippy -p tugbank -- -D warnings`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `tugbank` CLI binary that provides `defaults`-like access to tugbank databases for debugging, scripting, and manual inspection.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `cargo build -p tugbank` succeeds with zero warnings
- [ ] `cargo nextest run -p tugbank` passes all integration tests
- [ ] `cargo nextest run -p tugbank-core` passes all tests (including new `delete_domain` tests)
- [ ] All seven subcommands produce correct text and JSON output
- [ ] Exit codes match Table T01 for all tested error conditions
- [ ] `cargo fmt --all --check` passes
- [ ] `cargo clippy -p tugbank -- -D warnings` passes

**Acceptance tests:**
- [ ] T25: End-to-end workflow roundtrip
- [ ] T26: Environment variable path override
- [ ] T27: CLI flag path override

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5e3: Tugcast HTTP bridge integration (wires tugbank into the web server)
- [ ] Phase 5e4: Settings migration (moves flat-file settings to tugbank)
- [ ] Shell completion generation for `tugbank`
- [ ] `tugbank export` / `tugbank import` for bulk operations

| Checkpoint | Verification |
|------------|--------------|
| `tugbank-core` with `delete_domain` | `cd tugcode && cargo nextest run -p tugbank-core` |
| `tugbank` binary builds cleanly | `cd tugcode && cargo build -p tugbank` |
| All CLI tests pass | `cd tugcode && cargo nextest run -p tugbank` |
| Code quality | `cd tugcode && cargo fmt --all --check && cargo clippy -p tugbank -- -D warnings` |
