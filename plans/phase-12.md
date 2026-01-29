## Phase 12: Agent-Focused CLI Redesign {#phase-12}

**Purpose:** Redesign the Tug CLI with a multi-level command structure (`tug <action> <language> <command>`) optimized for AI agent consumption, including a comprehensive file filter specification.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | TBD |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | TBD |
| Last updated | 2026-01-29 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tug is an AI-native code transformation engine. The current CLI evolved organically and contains vestiges of human-focused design: commands like `analyze rename` vs `rename`, format flags like `--format text`, and implicit behavioral defaults. AI agents do not benefit from these conveniences--they need a predictable, orthogonal command structure where the action (apply/emit/analyze) is explicit and the language is a first-class routing parameter.

### No Migration Required {#no-migration}

**IMPORTANT:** This is a brand new library with ZERO external users. There is no need for:
- Deprecation warnings
- Legacy API shims
- Migration guides for external consumers
- Backward compatibility

We simply delete the old CLI and replace it with the new one. Clean slate.

---

The current CLI has these commands:
- `tug rename --at <loc> --to <name>` (applies changes)
- `tug analyze rename --at <loc> --to <name>` (previews as diff)
- `tug session status`
- `tug verify <mode>`
- `tug clean --cache`
- `tug fixture {fetch,update,list,status}`
- `tug doctor`
- `tug snapshot`

The new structure unifies refactoring operations under a consistent `<action> <language> <command>` pattern while preserving utility commands (`session`, `fixture`, `doctor`) as top-level.

#### Strategy {#strategy}

- **Action-first**: Every refactoring command starts with an explicit action (`apply`, `emit`, `analyze`)
- **Language as router**: The language (`python`, future `rust`, `cpp`) determines available commands
- **Commands are operations**: `rename`, `extract-function`, `inline`, etc.
- **Options follow commands**: Command-specific flags come after the command name
- **File filters are trailing**: A uniform file filter spec can follow any command
- **Clean slate**: Delete old CLI entirely, replace with new structure
- **Utility commands preserved**: Non-refactoring commands (`doctor`, `fixture`, `session`) remain top-level

#### Stakeholders / Primary Customers {#stakeholders}

1. AI coding agents (Claude Code, Cursor, Aider)
2. Tool integrators building on tug CLI

#### Success Criteria (Measurable) {#success-criteria}

- `tug apply python rename --at src/lib.py:10:5 --to new_name` applies rename to all Python files
- `tug apply python rename --at src/lib.py:10:5 --to new_name -- 'src/**'` applies rename with filter
- `tug emit python rename --at src/lib.py:10:5 --to new_name` outputs unified diff
- `tug emit python rename --at src/lib.py:10:5 --to new_name --json` outputs JSON envelope (Spec S07)
- `tug analyze python rename --at src/lib.py:10:5 --to new_name` outputs JSON metadata
- File filter exclusions work: `-- '!tests/**'` excludes tests directory
- All existing tests pass
- Utility commands still work: `tug doctor`, `tug fixture list`, `tug session status`

#### Scope {#scope}

1. New multi-level CLI structure (`<action> <language> <command>`)
2. Three actions: `apply`, `emit`, `analyze`
3. Python language support with `rename` command
4. File filter specification design and implementation
5. Replace old command structure entirely
6. Update to all documentation

#### Non-goals (Explicitly out of scope) {#non-goals}

- Adding new refactoring operations (just `rename` for now)
- Rust language support (placeholder only)
- Interactive mode or prompts

#### Dependencies / Prerequisites {#dependencies}

- Phase 11E completion (current main branch)
- All existing tests passing

#### Constraints {#constraints}

- Must not break JSON output schemas (response format stays the same)
- File filter is optional; when omitted, all language-appropriate files are included
- File filter must support both inclusions and exclusions when specified
- All refactor outputs are JSON **except** `emit` default diff output (plain text); `emit --json` wraps diff in JSON envelope (Spec S07)

#### Assumptions {#assumptions}

- Agents will adapt to the new command structure
- The three-action model (apply/emit/analyze) covers all agent needs
- File filtering is rare but must be supported when needed

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Clap complexity with multi-level subcommands | med | low | Clap handles nested subcommands well; test incrementally | Parser edge cases emerge |
| File filter spec ambiguity | med | med | Use gitignore-style patterns with `!` prefix for exclusions | User confusion in practice |

**Risk R01: Parser Complexity** {#r01-parser-complexity}

- **Risk:** Nested subcommand structure may create clap configuration complexity
- **Mitigation:** Define each level as a separate enum; test parser behavior explicitly
- **Residual risk:** Edge cases with global options vs command options may need refinement

---

### Extensibility Principles {#extensibility-principles}

These rules are intended to keep the CLI expandable without redesigns as new languages and commands are added.

1. **Action-router stability**: `apply|emit|analyze` remain the only action tier; new behavior is added as new commands, not new actions.
2. **Per-language command registry**: Each language owns its own command enum and parser subtree; adding a command should not change other languages.
3. **Mutation vs query commands**: Commands that produce changes (`rename`, `extract-function`, `inline`, `move`) exist for all three actions. Query commands (`callers`, `references`) exist only for `analyze`.
4. **Uniform option naming**: Option names are consistent across languages when semantics match. However, options are command-specific—`--at`/`--to` are for `rename`, `--of` is for query commands, `--name` is for `extract-function`.
5. **Output contract stability**: JSON schemas remain stable; new outputs are added as new variants or envelopes without breaking existing schemas.
6. **Filter spec consistency**: All refactor commands accept optional file filters via the trailing `-- <patterns>` segment; parsing and validation live in one shared module.
7. **Clear error channel**: Keep `stdout` for success payloads and `stderr` for JSON errors to avoid ambiguity when piping diffs.
8. **Per-action, per-language enums**: Each action×language combination gets its own command enum in Clap. This is verbose but makes invalid states unrepresentable.

### 12.0 Design Decisions {#design-decisions}

#### [D01] Three Actions Only (DECIDED) {#d01-three-actions}

**Decision:** The CLI has exactly three actions for refactoring operations: `apply`, `emit`, `analyze`.

| Action | Behavior | Output |
|--------|----------|--------|
| `apply` | Execute the operation, modify files | JSON result with files_written |
| `emit` | Compute the operation, output diff | Unified diff (git-apply compatible) |
| `analyze` | Compute metadata about the operation | JSON with symbol info, references, impact |

**Rationale:**
- `apply` = "do it" (agent wants changes applied)
- `emit` = "show me the diff" (agent wants to review or apply elsewhere)
- `analyze` = "tell me about it" (agent wants metadata before deciding)

**Implications:**
- No `--dry-run` flag needed (use `emit` instead of `apply`)
- No `--format` flag on refactoring commands (action determines output)
- Format flags only needed on `analyze` for JSON variants

#### [D02] Language is a Required Positional (DECIDED) {#d02-language-positional}

**Decision:** Language is a required positional argument after the action.

**Syntax:** `tug <action> <language> <command> [options] [-- <file-filter-spec>...]`

**Rationale:**
- Makes language routing explicit
- Allows language-specific commands to exist
- Supports future languages (rust, cpp) cleanly

**Implications:**
- `python` is the only supported language initially
- Unsupported languages return a clear error
- Language determines which commands are available

#### [D03] File Filter Uses Gitignore Syntax (DECIDED) {#d03-file-filter-gitignore}

**Decision:** File filter spec uses gitignore-style patterns with `!` prefix for exclusions. **Filters are optional.**

**Syntax:** `tug apply python rename --at x:1:1 --to y [-- 'src/**/*.py' '!**/test_*.py']`

**Semantics:**
1. Patterns after `--` form the file filter spec
2. Patterns without `!` are inclusions
3. Patterns with `!` prefix are exclusions
4. **If no filter specified**: use all language-appropriate files (e.g., `**/*.py` for Python), respecting standard exclusions (`.git`, `__pycache__`, `venv`, `.venv`, `node_modules`, `target`)
5. **If only exclusions specified**: start from all language-appropriate files, then apply exclusions
6. Exclusions always apply (remove from inclusion set)
7. Patterns are relative to workspace root

**Rationale:**
- Gitignore syntax is widely understood
- `!` for negation is intuitive
- Trailing `--` separates filter from options clearly
- **Optional filters reduce verbosity** for the common "operate on everything" case

**Implications:**
- Need a glob matching library (e.g., `globset` or `ignore`)
- Filter applies before file collection, not after
- Default exclusions (`.git`, etc.) always apply even when filter is omitted

#### [D04] Verification Defaults to None for emit (DECIDED) {#d04-verify-defaults}

**Decision:** Verification behavior differs by action:
- `apply`: defaults to `--verify=syntax`
- `emit`: defaults to `--verify=none` (just compute diff)
- `analyze`: no verification (read-only operation)

**Rationale:**
- `apply` modifies files, so verification protects against broken output
- `emit` is for preview/review, verification can be done separately
- `analyze` doesn't produce code, nothing to verify

#### [D05] Utility Commands Stay Top-Level (DECIDED) {#d05-utility-commands}

**Decision:** Non-refactoring commands remain at the top level:
- `tug doctor`
- `tug session status`
- `tug fixture {fetch,update,list,status}`
- `tug clean`

**Rationale:**
- These commands don't fit the action/language/command pattern
- They're utilities, not refactoring operations
- Keeping them top-level avoids forcing awkward syntax

#### [D06] Snapshot and Verify Commands Removed (DECIDED) {#d06-commands-removed}

**Decision:** The `tug snapshot` and `tug verify` commands are removed (not deprecated—deleted).

**Rationale:**
- Snapshots are an internal implementation detail
- Verification is now an option on `apply` (`--verify=syntax`)
- Agents don't need these as separate commands

#### [D07] Output Formats (DECIDED) {#d07-json-only}

**Decision:** Refactor outputs are JSON by default, with a single exception:
- `emit` returns a plain unified diff by default
- `emit --json` returns a JSON envelope containing the diff

| Action | Output Format |
|--------|---------------|
| `apply` | JSON (RenameResponse) |
| `emit` | Plain text (unified diff) by default; JSON when `--json` |
| `analyze` | JSON (ImpactAnalysis or custom) |

**`emit --json` Schema (Spec S07):**
```json
{
  "format": "unified",
  "diff": "<unified diff content>",
  "files_affected": ["src/foo.py", "src/bar.py"],
  "metadata": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `format` | string | yes | Always `"unified"` for now; future formats possible |
| `diff` | string | yes | The unified diff content |
| `files_affected` | string[] | yes | List of files that would be modified |
| `metadata` | object | yes | Reserved for future use (empty object `{}` for now) |

**Exception:** `emit` outputs plain text diff by default because:
- Diffs are already structured text
- Agents can pass diff directly to `git apply`
- JSON-wrapping a diff is optional for agents that want metadata

**Rationale:**
- Agents parse JSON; they don't need human-readable text
- Keeps `emit` as a one-shot, token-efficient output
- Error responses are always JSON
- Schema is extensible via `metadata` field

#### [D08] Command Options Use Long Form Only (DECIDED) {#d08-long-options}

**Decision:** Command options use long form only (e.g., `--at`, `--to`). No short aliases.

**Rationale:**
- Agents don't benefit from short flags
- Long flags are self-documenting in logs
- Reduces ambiguity in complex commands

**Exception:** Global options may have short forms for human operators (e.g., `-h` for help).

---

### 12.1 Specification {#specification}

#### 12.1.1 Command Grammar {#command-grammar}

**Spec S01: Command Structure** {#s01-command-structure}

```
tug <global-options> <action> <language> <command> <command-options> [-- <file-filter-spec>...]
tug <global-options> <utility-command> <utility-options>
```

**Actions:**
- `apply` - Execute operation, modify files
- `emit` - Output diff without modifying files
- `analyze` - Output metadata without modifying files

**Languages:**
- `python` - Python language support (implemented)
- `rust` - Rust language support (placeholder, errors with "not yet implemented")

**Python Commands:**
- `rename` - Rename a symbol

**Utility Commands:**
- `doctor` - Environment diagnostics
- `session` - Session management (`session status`)
- `fixture` - Fixture management (`fixture fetch`, `fixture list`, etc.)
- `clean` - Clean session resources

**Global Options:**

| Option | Description |
|--------|-------------|
| `--workspace <path>` | Override workspace root (default: current directory or nearest parent with `.tug/`) |

**Note:** Refactor commands accept an optional file filter spec (`-- <patterns>`). When omitted, all language-appropriate files are included. Utility commands do not accept file filters.

#### 12.1.2 Rename Command Specification {#rename-spec}

**Spec S02: apply python rename** {#s02-apply-rename}

```
tug apply python rename --at <location> --to <new-name> [--verify <mode>] [--no-verify] [-- <filter>...]
```

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--at` | yes | - | Location: `path:line:col` |
| `--to` | yes | - | New name for the symbol |
| `--verify` | no | `syntax` | Verification mode: `none`, `syntax`, `tests`, `typecheck` |
| `--no-verify` | no | false | Skip verification (shorthand for `--verify=none`) |

**Note:** If both `--verify=<mode>` and `--no-verify` are specified, `--no-verify` wins.

**Output:** JSON `RenameResponse` (existing schema, unchanged)

**Exit codes:** Per existing Table T26 (0=success, 2=invalid args, 3=resolution error, 4=apply error, 5=verification failed)

**Spec S03: emit python rename** {#s03-emit-rename}

```
tug emit python rename --at <location> --to <new-name> [--json] [-- <filter>...]
```

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--at` | yes | - | Location: `path:line:col` |
| `--to` | yes | - | New name for the symbol |
| `--json` | no | false | Emit JSON envelope with diff (see Spec S07) |

**Output:**
- Default: unified diff (plain text, git-apply compatible)
- With `--json`: JSON envelope per Spec S07

**Note:** `emit` has no `--verify` option. Verification is a concern of `apply`.

**Spec S04: analyze python rename** {#s04-analyze-rename}

```
tug analyze python rename --at <location> --to <new-name> [--output <format>] [-- <filter>...]
```

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--at` | yes | - | Location: `path:line:col` |
| `--to` | yes | - | New name for the symbol |
| `--output` | no | `impact` | Output format: `impact`, `references`, `symbol` |

**Output formats:**
- `impact` - Full ImpactAnalysis JSON (default)
- `references` - Just the references array
- `symbol` - Just the symbol info

**Rationale:** Different analysis queries may want different slices of data.

#### 12.1.3 File Filter Specification {#file-filter-spec}

**Spec S05: File Filter Syntax** {#s05-filter-syntax}

File filter patterns are **optional** and appear after `--`:

```bash
# With explicit filter
tug apply python rename --at x:1:1 --to y -- 'src/**/*.py' '!tests/**'

# Without filter (uses all Python files)
tug apply python rename --at x:1:1 --to y

# With only exclusions (starts from all Python files)
tug apply python rename --at x:1:1 --to y -- '!tests/**' '!**/test_*.py'
```

**Pattern rules:**

1. **Glob syntax**: Patterns use gitignore-style globs
   - `*` matches any characters except `/`
   - `**` matches any path components (including none)
   - `?` matches any single character except `/`
   - `[abc]` matches any character in the set

2. **Inclusion vs exclusion**:
   - Patterns without `!` prefix are inclusions
   - Patterns with `!` prefix are exclusions

3. **Evaluation order**:
   - If no inclusions specified: start with all language-appropriate files (e.g., `**/*.py`)
   - If inclusions specified: start with files matching inclusion patterns
   - Apply default exclusions: `.git`, `__pycache__`, `venv`, `.venv`, `node_modules`, `target`
   - Apply user exclusions (patterns with `!` prefix)

   **Note:** `--` with no patterns is treated the same as no filter (start from all language-appropriate files).

4. **Path semantics**:
   - Patterns are relative to workspace root
   - Patterns match against relative file paths
   - Leading `/` anchors to workspace root
   - No leading `/` matches anywhere in path

**Table T01: File Filter Examples** {#t01-filter-examples}

| Filter | Effective Behavior |
|--------|-------------------|
| (none) | All `**/*.py` files, minus default exclusions |
| `-- 'src/**/*.py'` | Only files in `src/` |
| `-- '!tests/**'` | All `**/*.py` minus `tests/` directory |
| `-- 'src/**/*.py' '!**/test_*.py'` | Files in `src/`, excluding test files |
| `-- '**/*.py' '!tests/**' '!conftest.py'` | All Python files except tests and conftest |

**Edge cases:**

| Input | Behavior |
|-------|----------|
| `--` (separator with no patterns) | Same as no filter (all files) |
| `-- '!foo'` (only exclusions) | All files minus exclusions |

#### 12.1.4 Output Schemas {#output-schemas}

**Spec S06: Output Schema Unchanged** {#s06-output-unchanged}

All **existing** JSON output schemas remain unchanged from Phase 10/11:
- `RenameResponse` for `apply`
- `ImpactAnalysis` for `analyze`
- Error responses use existing `ErrorResponse`

The only new output formats are:
- `emit` default unified diff (plain text)
- `emit --json` envelope per Spec S07

**Note:** Spec S07 includes additional fields (`files_affected`, `metadata`) beyond `format` and `diff`.

#### 12.1.5 Error Handling {#error-handling}

**Table T02: Error Codes** {#t02-error-codes}

| Exit Code | Meaning | When |
|-----------|---------|------|
| 0 | Success | Operation completed |
| 2 | Invalid arguments | Bad syntax, missing required options, unsupported language |
| 3 | Resolution error | Symbol not found, ambiguous symbol |
| 4 | Apply error | Failed to write files |
| 5 | Verification failed | Post-apply verification failed |
| 10 | Internal error | Unexpected error |

**Note:** `tug apply rust rename ...` returns exit code 2 with message "rust language support not yet implemented".

**Error response format:** Unchanged JSON ErrorResponse.

**Output channels:**
- Success output goes to `stdout`
- Errors are written to `stderr` (JSON ErrorResponse) with non-zero exit code

---

### 12.2 Symbol Inventory {#symbol-inventory}

#### 12.2.1 New/Modified Enums {#new-enums}

**Table T03: CLI Enums** {#t03-cli-enums}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `Action` | enum | `main.rs` | `Apply`, `Emit`, `Analyze` |
| `Language` | enum | `main.rs` | `Python`, `Rust` (placeholder) |
| `PythonCommand` | enum | `main.rs` | `Rename { at, to, ... }` |
| `RustCommand` | enum | `main.rs` | Placeholder, errors on use |
| `AnalyzeOutput` | enum | `main.rs` | `Impact`, `References`, `Symbol` |
| `FileFilterSpec` | struct | `filter.rs` | Holds parsed filter patterns |

#### 12.2.2 New Files {#new-files}

**Table T04: New Files** {#t04-new-files}

| File | Purpose |
|------|---------|
| `crates/tugtool/src/filter.rs` | File filter parsing and matching |

#### 12.2.3 Modified Files {#modified-files}

**Table T05: Modified Files** {#t05-modified-files}

| File | Changes |
|------|---------|
| `crates/tugtool/src/main.rs` | New command structure, multi-level subcommands |
| `crates/tugtool/src/cli.rs` | Update function signatures to accept filter |
| `crates/tugtool-python/src/files.rs` | Add filter-aware file collection |

#### 12.2.4 Clap Derive Structure {#clap-structure}

The CLI uses per-action, per-language enums. This is verbose but makes invalid states unrepresentable.

```rust
use clap::{Parser, Subcommand, ValueEnum, Args};

#[derive(Parser)]
#[command(name = "tug")]
struct Cli {
    #[command(flatten)]
    global: GlobalArgs,

    #[command(subcommand)]
    command: TopLevelCommand,
}

#[derive(Args)]
struct GlobalArgs {
    #[arg(long, global = true)]
    workspace: Option<PathBuf>,
}

#[derive(Subcommand)]
enum TopLevelCommand {
    /// Apply a refactoring operation (modifies files).
    Apply {
        #[command(subcommand)]
        language: ApplyLanguage,
    },
    /// Emit a diff without modifying files.
    Emit {
        #[command(subcommand)]
        language: EmitLanguage,
    },
    /// Analyze operation metadata.
    Analyze {
        #[command(subcommand)]
        language: AnalyzeLanguage,
    },
    // Utility commands at top level
    Doctor,
    Session {
        #[command(subcommand)]
        action: SessionAction,
    },
    Fixture {
        #[command(subcommand)]
        action: FixtureAction,
    },
    Clean {
        #[arg(long)]
        cache: bool,
    },
}

// === Apply Action ===

#[derive(Subcommand)]
enum ApplyLanguage {
    Python {
        #[command(subcommand)]
        command: ApplyPythonCommand,
    },
    Rust {
        #[command(subcommand)]
        command: ApplyRustCommand,
    },
}

#[derive(Subcommand)]
enum ApplyPythonCommand {
    Rename {
        #[arg(long)]
        at: String,
        #[arg(long)]
        to: String,
        #[arg(long, default_value = "syntax")]
        verify: VerifyMode,
        #[arg(long)]
        no_verify: bool,
        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    // Future commands:
    // ExtractFunction { at, name, filter },
    // Inline { at, filter },
    // Move { symbol, to, filter },
}

#[derive(Subcommand)]
enum ApplyRustCommand {
    // Placeholder - all variants error with "not implemented"
    Rename {
        #[arg(long)]
        at: String,
        #[arg(long)]
        to: String,
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

// === Emit Action ===

#[derive(Subcommand)]
enum EmitLanguage {
    Python {
        #[command(subcommand)]
        command: EmitPythonCommand,
    },
    Rust {
        #[command(subcommand)]
        command: EmitRustCommand,
    },
}

#[derive(Subcommand)]
enum EmitPythonCommand {
    Rename {
        #[arg(long)]
        at: String,
        #[arg(long)]
        to: String,
        #[arg(long)]
        json: bool,
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

#[derive(Subcommand)]
enum EmitRustCommand {
    Rename {
        #[arg(long)]
        at: String,
        #[arg(long)]
        to: String,
        #[arg(long)]
        json: bool,
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

// === Analyze Action ===

#[derive(Subcommand)]
enum AnalyzeLanguage {
    Python {
        #[command(subcommand)]
        command: AnalyzePythonCommand,
    },
    Rust {
        #[command(subcommand)]
        command: AnalyzeRustCommand,
    },
}

#[derive(Subcommand)]
enum AnalyzePythonCommand {
    Rename {
        #[arg(long)]
        at: String,
        #[arg(long)]
        to: String,
        #[arg(long, default_value = "impact")]
        output: AnalyzeOutput,
        #[arg(last = true)]
        filter: Vec<String>,
    },
    // Future query-only commands (no Apply/Emit variants):
    // Callers { of: String, filter: Vec<String> },
    // References { of: String, filter: Vec<String> },
}

#[derive(Subcommand)]
enum AnalyzeRustCommand {
    Rename {
        #[arg(long)]
        at: String,
        #[arg(long)]
        to: String,
        #[arg(long, default_value = "impact")]
        output: AnalyzeOutput,
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

// === Shared Types ===

#[derive(Clone, Copy, ValueEnum)]
enum VerifyMode {
    None,
    Syntax,
    Tests,
    Typecheck,
}

#[derive(Clone, Copy, ValueEnum)]
enum AnalyzeOutput {
    Impact,
    References,
    Symbol,
}
```

**Key implementation notes:**

1. **`#[arg(last = true)]`** tells Clap to collect all remaining arguments after `--`, making filter optional
2. **Per-action enums** (`ApplyPythonCommand`, `EmitPythonCommand`, `AnalyzePythonCommand`) allow action-specific options without runtime validation
3. **Query commands** (`Callers`, `References`) will only exist in `AnalyzePythonCommand`, not in Apply/Emit variants
4. **Duplication is intentional** — each action's command struct specifies exactly what options it accepts

---

### 12.3 Command Reference {#command-reference}

**Table T06: New Commands** {#t06-new-commands}

| Command | Description |
|---------|-------------|
| `tug apply python rename --at X --to Y` | Apply rename to all Python files |
| `tug apply python rename --at X --to Y -- 'src/**'` | Apply rename with filter |
| `tug emit python rename --at X --to Y` | Output unified diff |
| `tug emit python rename --at X --to Y --json` | Output JSON diff envelope (Spec S07) |
| `tug analyze python rename --at X --to Y` | Output JSON metadata |
| `tug analyze python rename --at X --to Y --output references` | Output just references |
| `tug doctor` | Environment diagnostics |
| `tug session status` | Session information |
| `tug fixture list` | List available fixtures |
| `tug fixture fetch` | Fetch fixtures |

---

### 12.4 Test Plan {#test-plan}

#### Test Categories {#test-categories}

| Category | Purpose |
|----------|---------|
| Unit | Test filter parsing, pattern matching |
| Integration | Test full command execution |
| Golden | Verify output format stability |

#### Test Cases {#test-cases}

**Table T07: Test Cases** {#t07-test-cases}

| Test | Category | Description |
|------|----------|-------------|
| `test_apply_python_rename_no_filter` | integration | Verify `tug apply python rename` works on all files |
| `test_apply_python_rename_with_filter` | integration | Verify `tug apply python rename -- 'src/**'` restricts scope |
| `test_emit_python_rename` | integration | Verify `tug emit python rename` outputs diff |
| `test_emit_python_rename_json` | integration | Verify `tug emit python rename --json` outputs JSON envelope (Spec S07) |
| `test_analyze_python_rename` | integration | Verify `tug analyze python rename` outputs JSON |
| `test_analyze_output_variants` | integration | Verify `--output=references` and `--output=symbol` work |
| `test_filter_inclusion` | unit | Verify inclusion patterns work |
| `test_filter_exclusion_only` | unit | Verify exclusion-only filter starts from all files |
| `test_filter_combined` | unit | Verify inclusions + exclusions interact correctly |
| `test_filter_empty_after_separator` | unit | Verify `--` with no patterns = no filter (all files) |
| `test_filter_default_exclusions` | unit | Verify `.git`, `__pycache__`, `venv` always excluded |
| `test_invalid_action` | integration | Verify unknown action returns error |
| `test_invalid_language` | integration | Verify unknown language returns error |
| `test_rust_not_implemented` | integration | Verify `rust` language returns "not implemented" |
| `test_utility_commands_unchanged` | integration | Verify `doctor`, `session`, `fixture` still work |

---

### 12.5 Execution Steps {#execution-steps}

#### Step 0: Add File Filter Module {#step-0}

**Commit:** `feat(cli): add file filter parsing module`

**References:** [D03] File Filter Uses Gitignore Syntax, Spec S05, (#file-filter-spec)

**Artifacts:**
- New file: `crates/tugtool/src/filter.rs`

**Tasks:**
- [x] Create `FileFilterSpec` struct with `inclusions` and `exclusions` Vec<Pattern>
- [x] Implement `FileFilterSpec::parse(args: &[String]) -> Result<Self, Error>`
- [x] Implement `FileFilterSpec::matches(&self, path: &Path) -> bool`
- [x] Add dependency on `globset` crate for pattern matching
- [x] Export from `lib.rs`

**Tests:**
- [x] unit: `test_filter_parse_empty_returns_none`
- [x] unit: `test_filter_parse_inclusion`
- [x] unit: `test_filter_parse_exclusion`
- [x] unit: `test_filter_parse_mixed`
- [x] unit: `test_filter_matches_inclusion`
- [x] unit: `test_filter_matches_exclusion`
- [x] unit: `test_filter_matches_combined`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool filter`

**Rollback:** Delete `filter.rs`, remove from `lib.rs`

---

#### Step 1: Define New CLI Structure in Clap {#step-1}

**Commit:** `feat(cli): define new multi-level command structure`

**References:** [D01] Three Actions Only, [D02] Language is a Required Positional, Spec S01, (#command-grammar)

**Artifacts:**
- Modified: `crates/tugtool/src/main.rs` (new enum definitions)

**Tasks:**
- [ ] Define `Action` enum: `Apply`, `Emit`, `Analyze`
- [ ] Define `Language` enum: `Python`, `Rust`
- [x] Define `PythonCommand` enum with `Rename` variant
- [x] Define `RustCommand` enum (placeholder)
- [x] Update `Cli` struct to use new subcommand structure
- [x] Keep utility commands (`doctor`, `session`, `fixture`, `clean`) at top level
- [x] Add trailing positional `file_filter: Vec<String>` to capture filter patterns

**Tests:**
- [x] unit: CLI parses `apply python rename --at x:1:1 --to y` (no filter)
- [x] unit: CLI parses `apply python rename --at x:1:1 --to y -- src/**` (with filter)
- [x] unit: CLI parses `emit python rename --at x:1:1 --to y --json`
- [x] unit: CLI parses `analyze python rename --at x:1:1 --to y --output references`

**Checkpoint:**
- [x] `cargo build -p tugtool`
- [x] `cargo run -p tugtool -- --help` shows new structure

**Rollback:** Revert main.rs changes

---

#### Step 2: Implement execute_action Dispatcher {#step-2}

**Commit:** `feat(cli): implement action/language/command dispatcher`

**References:** [D01], [D02], Spec S01, (#command-grammar)

**Artifacts:**
- Modified: `crates/tugtool/src/main.rs` (new execute functions)

**Tasks:**
- [x] Implement `execute_action(action, language, global)` dispatcher
- [x] Implement `execute_python_command(action, command, global)`
- [x] Route `apply` to existing rename logic with `apply=true`
- [x] Route `emit` to existing rename logic with `apply=false`, output diff only
- [x] Support `emit --json` by wrapping diff in JSON envelope
- [x] Route `analyze` to existing analyze logic
- [x] Implement `execute_rust_command` that returns "not yet implemented" error
- [x] Remove old `Command::Rename` and `Command::Analyze` variants

**Tests:**
- [x] integration: `tug apply python rename --at ... --to ...` modifies all Python files
- [x] integration: `tug emit python rename --at ... --to ...` outputs diff
- [x] integration: `tug emit python rename --at ... --to ... --json` outputs JSON envelope (Spec S07)
- [x] integration: `tug analyze python rename --at ... --to ...` outputs JSON

**Checkpoint:**
- [x] `cargo nextest run -p tugtool`

**Rollback:** Revert main.rs changes

---

#### Step 3: Integrate File Filter into File Collection {#step-3}

**Commit:** `feat(cli): integrate file filter with file collection`

**References:** [D03], Spec S05, (#file-filter-spec)

**Artifacts:**
- Modified: `crates/tugtool/src/cli.rs`
- Modified: `crates/tugtool-python/src/files.rs`

**Tasks:**
- [x] Add `filter: Option<&FileFilterSpec>` parameter to `collect_python_files_filtered()`
- [x] Modify file collection to apply filter after default exclusions
- [x] Update `analyze_rename` and `do_rename` in cli.rs to accept filter
- [x] Pass filter from CLI through to file collection
- [x] Test with filter patterns

**Tests:**
- [x] integration: rename with `-- src/**/*.py` only affects src files
- [x] integration: rename with `-- !tests/**` excludes tests directory
- [x] integration: rename with combined filter works correctly

**Checkpoint:**
- [x] `cargo nextest run -p tugtool`
- [x] Manual test: `tug apply python rename --at ... --to ... -- src/**/*.py`

**Rollback:** Revert cli.rs and files.rs changes

---

#### Step 4: Implement analyze Output Variants {#step-4}

**Commit:** `feat(cli): add --output flag to analyze command`

**References:** Spec S04, (#analyze-spec)

**Artifacts:**
- Modified: `crates/tugtool/src/main.rs`

**Tasks:**
- [x] Add `AnalyzeOutput` enum: `Impact`, `References`, `Symbol`
- [x] Add `--output` option to analyze command
- [x] Implement output filtering (extract just references or symbol from ImpactAnalysis)
- [x] Default to `Impact` (full analysis)

**Tests:**
- [x] integration: `--output=impact` returns full JSON
- [x] integration: `--output=references` returns just references array
- [x] integration: `--output=symbol` returns just symbol info

**Checkpoint:**
- [x] `cargo nextest run -p tugtool analyze`

**Rollback:** Revert main.rs changes

---

#### Step 5: Remove Old Commands {#step-5}

**Commit:** `refactor(cli): remove verify and snapshot commands`

**References:** [D06] Snapshot and Verify Commands Removed

**Artifacts:**
- Modified: `crates/tugtool/src/main.rs`

**Tasks:**
- [x] Remove `Command::Verify` variant and `execute_verify` function
- [x] Remove `Command::Snapshot` variant and `execute_snapshot` function
- [x] Update help text to remove references to old commands
- [x] Remove any tests specific to old commands

**Tests:**
- [x] integration: Old command syntax returns appropriate error
- [x] All remaining tests pass

**Checkpoint:**
- [x] `cargo nextest run --workspace`

**Rollback:** Revert main.rs changes

---

#### Step 6: Update Documentation {#step-6}

**Commit:** `docs: update CLI documentation for new command structure`

**References:** All design decisions

**Artifacts:**
- Modified: `CLAUDE.md`
- Modified: `README.md` (if exists)

**Tasks:**
- [x] Update CLAUDE.md with new command examples
- [x] Update quick reference section
- [x] Document file filter spec syntax
- [x] Remove references to old commands
- [x] Update any inline help text

**Tests:**
- [x] Documentation examples work when copy-pasted

**Checkpoint:**
- [x] Manual review of documentation
- [x] Examples in docs execute correctly

**Rollback:** Revert documentation changes

---

#### Step 7: Golden Test Updates {#step-7}

**Commit:** `test: update golden tests for new CLI structure`

**References:** (#test-plan)

**Artifacts:**
- Modified: Golden test files
- Possibly new golden test cases

**Tasks:**
- [x] Update any golden tests that use old command syntax
- [x] Add golden tests for new command structure
- [x] Verify all golden tests pass

**Tests:**
- [x] `TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool golden` (if needed)
- [x] `cargo nextest run -p tugtool golden`

**Checkpoint:**
- [x] All golden tests pass

**Rollback:** Revert golden test changes

---

### 12.6 Deliverables and Checkpoints {#deliverables}

**Deliverable:** New agent-focused CLI with `tug <action> <language> <command>` structure and file filter support.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [x] `tug apply python rename --at ... --to ...` works (files modified, all Python files)
- [x] `tug apply python rename --at ... --to ... -- 'src/**'` works (filter restricts scope)
- [x] `tug emit python rename --at ... --to ...` works (diff output)
- [x] `tug emit python rename --at ... --to ... --json` works (JSON envelope, Spec S07)
- [x] `tug analyze python rename --at ... --to ...` works (JSON output)
- [x] `tug analyze python rename --at ... --to ... --output references` works
- [x] File filter exclusions work: `-- '!tests/**'` excludes tests
- [x] Utility commands unchanged (`doctor`, `session`, `fixture`)
- [x] All tests pass: `cargo nextest run --workspace`
- [x] Documentation updated
- [x] No clippy warnings: `cargo clippy --workspace -- -D warnings`

#### Acceptance Tests {#acceptance-tests}

- [x] integration: Full rename workflow with new syntax (no filter = all files)
- [x] integration: Filter inclusion restricts scope
- [x] integration: Filter exclusion removes files from scope
- [x] integration: Error handling returns proper JSON and exit codes

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add more refactoring operations (extract-function, inline, move)
- [ ] Implement Rust language support
- [ ] Add `tug analyze python callers --of <symbol>` command (query-only)
- [ ] Add `tug analyze python references --of <symbol>` command (query-only)

| Checkpoint | Verification |
|------------|--------------|
| CLI structure | `tug --help` shows new structure |
| Python rename (no filter) | `tug apply python rename --at test.py:1:5 --to new_name` |
| Python rename (with filter) | `tug apply python rename --at test.py:1:5 --to new_name -- 'src/**'` |
| emit --json | `tug emit python rename --at test.py:1:5 --to new_name --json` |
| All tests | `cargo nextest run --workspace` |

**Phase complete when all checkpoints pass.**

---

### 12.7 Revisit File Filtering To Make It Great {#file-filtering-great}

**Purpose:** Add a powerful, agent-first file filtering system that supports structured filters, composable logic, and optional content-aware matching while remaining deterministic and explicit.

---

#### Context {#file-filtering-context}

The current filter system is glob-based and CLI-friendly, but it is not expressive enough for agents that want precise, multi-criteria selection (path + metadata + git state + content signals). Agents should be able to express complex constraints in a single call without precomputing file lists.

#### Strategy {#file-filtering-strategy}

- Preserve the existing glob filter for simple cases (`-- <patterns...>`)
- Add a structured filter expression language for complex selection
- Add a JSON filter schema for deterministic, machine-authored queries
- Keep evaluation deterministic and order-independent
- Make content-aware filters explicit and opt-in (avoid accidental expensive scans)

#### Stakeholders / Primary Customers {#file-filtering-stakeholders}

1. AI coding agents (primary)
2. Tool integrators who generate filters programmatically

#### Success Criteria (Measurable) {#file-filtering-success}

- An agent can express compound selection: `path:src/** and ext:py and not name:*_test.py`
- JSON filters can reproduce any expression filter result (parity)
- Content filters only run when explicitly enabled (performance safety)
- Filters are deterministic: same workspace snapshot → same matched set
- `emit`/`apply` use identical filtering semantics for the same filter spec

#### Scope {#file-filtering-scope}

1. Filter expression syntax (`--filter "<expr>"`)
2. JSON filter schema (`--filter-json '{...}'`)
3. Multiple filter sources, combined deterministically
4. Optional content-aware matching (explicitly enabled)
5. Filter introspection mode for agents (list matched files)

#### Non-goals (Explicitly out of scope) {#file-filtering-non-goals}

- Fuzzy semantic search or embedding-based selection
- Language-aware AST queries (future analyze subcommands)
- Implicitly reading file contents for filtering unless explicitly requested

#### Dependencies / Prerequisites {#file-filtering-deps}

- Existing `FileFilterSpec` and default exclusions
- Workspace root resolution and file collection

#### Constraints {#file-filtering-constraints}

- Filters must be deterministic and side-effect free
- Content filters must be opt-in and should short-circuit where possible
- All filters must be evaluable without requiring the language analyzer
- Content predicates operate on UTF-8 text; binary files are skipped with a warning-level diagnostic
- Binary detection uses null-byte heuristic: file contains `\x00` in first 8KB
- Content predicates enforce a maximum file size (default 5MB) unless `--filter-content-max-bytes` overrides

#### Assumptions {#file-filtering-assumptions}

- Agents can generate structured JSON filters reliably
- CLI consumers can pass JSON safely via `--filter-file` with explicit format selection

---

### 12.7.0 Design Decisions {#file-filtering-decisions}

#### [D09] Filter Inputs Are Additive (DECIDED) {#d09-filter-inputs}

**Decision:** Filters can be provided via any of:
- Trailing glob patterns (`-- <patterns...>`)
- Expression filters (`--filter "<expr>"`, repeatable)
- JSON filter (`--filter-json '{...}'`, single instance)
- Filter file (`--filter-file path.json` or `path.txt`)

All filter sources are combined with logical **AND**.

#### [D10] Content Filters Are Opt-In (DECIDED) {#d10-content-opt-in}

**Decision:** Content-aware matching requires an explicit flag (`--filter-content`) and is ignored (or errors) without it.

#### [D11] Default Exclusions Always Apply (DECIDED) {#d11-default-exclusions}

**Decision:** Default exclusions (`.git`, `__pycache__`, `venv`, `.venv`, `node_modules`, `target`) always apply to all filter modes.

#### [D12] Filter Introspection for Agents (DECIDED) {#d12-filter-introspection}

**Decision:** Add a lightweight listing mode (`--filter-list`) that prints the matched file list as JSON when used with any refactor command.

#### [D13] Filter File Format Is Explicit (DECIDED) {#d13-filter-file-format}

**Decision:** `--filter-file` requires a companion `--filter-file-format` flag with one of: `json`, `glob`, `expr`.

#### [D14] Git Predicates Are Supported (DECIDED) {#d14-git-predicates}

**Decision:** Filters can query git state (tracked/ignored/status) when a `.git` directory is present. If no git repo is detected, git predicates return false unless explicitly set to `any`.

---

### 12.7.1 Specification {#file-filtering-spec}

**Spec S08: Filter Expression Language** {#s08-filter-expr}

Expression grammar (case-insensitive operators):

```
<expr>       := <term> (("and" | "or") <term>)*
<term>       := ["not"] <factor>
<factor>     := <predicate> | "(" <expr> ")"
<predicate>  := key ":" value | key "~" regex | key comparator value
```

Supported predicates:

| Key | Meaning | Examples |
|-----|---------|----------|
| `path` | Path glob | `path:src/**` |
| `name` | Basename glob | `name:*_test.py` |
| `ext` | File extension | `ext:py` |
| `lang` | Language tag | `lang:python` |
| `kind` | `file` or `dir` | `kind:file` |
| `size` | Bytes | `size>10k`, `size<=2m` |
| `contains` | Content substring (requires `--filter-content`) | `contains:"TODO"` |
| `regex` | Content regex (requires `--filter-content`) | `regex:/@deprecated\\b/` |
| `git_status` | Git status (requires repo) | `git_status:modified`, `git_status:untracked` |
| `git_tracked` | File tracked by git | `git_tracked:true` |
| `git_ignored` | File ignored by git | `git_ignored:true` |
| `git_stage` | Stage state | `git_stage:staged`, `git_stage:unstaged` |

Operator precedence: `not` binds tighter than `and`, which binds tighter than `or`. Parentheses override.

**Git predicate semantics:**

- Source of truth: `git status --porcelain=v1 -z` at workspace root
- A file is **tracked** if it appears in the index or HEAD (not `??`)
- `git_tracked:true` matches tracked files; `git_tracked:false` matches untracked files
- `git_ignored:true` matches files ignored by git (from `git check-ignore`)
- `git_status` values map to porcelain codes:
  - `modified`: `M` in index or worktree
  - `added`: `A` in index
  - `deleted`: `D` in index or worktree
  - `renamed`: `R` in index
  - `untracked`: `??`
  - `conflicted`: `U`
- `git_stage` values:
  - `staged`: index status is not blank
  - `unstaged`: worktree status is not blank
- If no `.git` directory is found, git predicates return **false** unless value is `"any"`, which always returns true

**Spec S09: JSON Filter Schema** {#s09-filter-json}

```
{
  "all": [ <filter>, ... ],
  "any": [ <filter>, ... ],
  "not": <filter>,
  "predicates": [
    { "key": "path", "op": "glob", "value": "src/**" },
    { "key": "ext", "op": "eq", "value": "py" }
  ]
}
```

- `all` and `any` support nested filters for complex logic
- `predicates` are combined with AND
- Content predicates (`contains`, `regex`) require `--filter-content`
- Git predicates require a git repository; if no repo is found, they evaluate to false unless `value` is `"any"`

**Spec S10: Filter Combination Rules** {#s10-filter-combine}

1. Start with language-appropriate file set
2. Apply default exclusions
3. Apply glob patterns (`-- <patterns...>`)
4. Apply all `--filter` expressions (AND)
5. Apply `--filter-json` (AND)
6. Apply `--filter-file` content according to `--filter-file-format` (AND)

**Spec S11: Filter Output / Introspection** {#s11-filter-list}

`--filter-list` outputs JSON:

```
{ "files": ["src/a.py", "src/b.py"], "count": 2 }
```

This flag runs filtering only and exits 0 (no refactor performed).

---

### 12.7.2 Symbol Inventory {#file-filtering-symbols}

**Table T20: Filter CLI Options** {#t20-filter-options}

| Option | Type | Notes |
|--------|------|-------|
| `--filter <expr>` | repeatable | Expression filter |
| `--filter-json <json>` | single | JSON filter schema |
| `--filter-file <path>` | single | File containing JSON or expression/glob lines |
| `--filter-file-format <format>` | single | Required with `--filter-file`: `json`, `glob`, `expr` |
| `--filter-content` | flag | Enables content predicates |
| `--filter-content-max-bytes <n>` | single | Max bytes per file for content predicates |
| `--filter-list` | flag | Outputs matched files and exits |

---

### 12.7.3 Documentation Plan {#file-filtering-docs}

- Update `docs/AGENT_API.md` with filter expression + JSON schema
- Add examples to `README.md` for common filter recipes

---

### 12.7.4 Test Plan Concepts {#file-filtering-tests}

- Unit: expression parser, JSON schema parser, predicate evaluation
- Integration: `--filter` + `--filter-json` + glob parity
- Performance: content filters require explicit flag; error otherwise

---

### 12.7.5 Execution Steps {#file-filtering-steps}

#### Step 0: Refactor filter.rs to Directory Module {#step-filter-0}

**Commit:** `refactor(filter): convert filter.rs to directory module`

**References:** [D11] Default Exclusions Always Apply, (#file-filtering-context)

**Artifacts:**
- Renamed: `crates/tugtool-core/src/filter.rs` → `crates/tugtool-core/src/filter/mod.rs`
- New: `crates/tugtool-core/src/filter/glob.rs` (existing code moved here)

**Tasks:**
- [x] Create `filter/` directory in `tugtool-core/src/`
- [x] Move existing `filter.rs` content to `filter/glob.rs`
- [x] Create `filter/mod.rs` that re-exports from `glob.rs`
- [x] Update `lib.rs` if necessary to maintain public exports
- [x] Verify all existing imports continue to work

**Tests:**
- [x] unit: All existing filter tests pass unchanged

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core filter`
- [x] `cargo build --workspace`

**Rollback:** Revert to single-file `filter.rs`

---

#### Step 1: Add Predicate Types {#step-filter-1}

**Commit:** `feat(filter): add predicate types and evaluation`

**References:** [D11] Default Exclusions Always Apply, [D14] Git Predicates Are Supported,
Spec S08, Table T20, (#file-filtering-spec)

**Artifacts:**
- New: `crates/tugtool-core/src/filter/predicate.rs`
- Modified: `crates/tugtool-core/src/filter/mod.rs` (add exports)

**Tasks:**
- [x] Define `PredicateKey` enum: `Path`, `Name`, `Ext`, `Lang`, `Kind`, `Size`, `Contains`, `Regex`, `GitStatus`, `GitTracked`, `GitIgnored`, `GitStage`
- [x] Define `PredicateOp` enum: `Glob`, `Eq`, `Neq`, `Gt`, `Gte`, `Lt`, `Lte`, `Match`
- [x] Define `FilterPredicate` struct with `key`, `op`, `value` fields
- [x] Implement `FilterPredicate::evaluate(&self, path: &Path, metadata: Option<&Metadata>, git_state: Option<&GitState>) -> Result<bool, FilterError>`
- [x] Implement size parsing with suffixes (bytes, k/K, m/M, g/G)
- [x] Add `FilterPredicate::requires_content(&self) -> bool` method
- [x] Add `FilterPredicate::requires_git(&self) -> bool` method
- [x] Add `FilterError::ContentPredicateWithoutFlag` variant
- [x] Define `GitState` struct to hold parsed `git status --porcelain=v1 -z` output
- [x] Implement `GitState::load(workspace: &Path) -> Option<GitState>` (returns None if no .git)
- [x] Implement git predicate evaluation per Spec S08 semantics

**Tests:**
- [x] unit: `test_predicate_path_glob_match`
- [x] unit: `test_predicate_path_glob_no_match`
- [x] unit: `test_predicate_name_glob`
- [x] unit: `test_predicate_ext_eq`
- [x] unit: `test_predicate_ext_neq`
- [x] unit: `test_predicate_size_gt`
- [x] unit: `test_predicate_size_lte`
- [x] unit: `test_predicate_size_suffixes_k_m_g`
- [x] unit: `test_predicate_requires_content_contains`
- [x] unit: `test_predicate_requires_content_regex`
- [x] unit: `test_predicate_requires_content_path_false`
- [x] unit: `test_predicate_git_tracked_true`
- [x] unit: `test_predicate_git_tracked_false`
- [x] unit: `test_predicate_git_status_modified`
- [x] unit: `test_predicate_git_status_untracked`
- [x] unit: `test_predicate_git_stage_staged`
- [x] unit: `test_predicate_git_ignored`
- [x] unit: `test_predicate_git_no_repo_returns_false`
- [x] unit: `test_predicate_git_any_always_true`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core predicate`
- [x] `cargo clippy -p tugtool-core -- -D warnings`

**Rollback:** Delete `predicate.rs`, revert `mod.rs`

---

#### Step 2: Implement Expression Parser {#step-filter-2}

**Commit:** `feat(filter): add expression parser`

**References:** [D09] Filter Inputs Are Additive, Spec S08, (#file-filtering-spec)

**Artifacts:**
- New: `crates/tugtool-core/src/filter/expr.rs`
- Modified: `crates/tugtool-core/Cargo.toml` (add `winnow` dependency)
- Modified: `crates/tugtool-core/src/filter/mod.rs` (add exports)

**Tasks:**
- [x] Add `winnow` parser combinator to `tugtool-core` dependencies
- [x] Define `FilterExpr` enum: `And(Vec<FilterExpr>)`, `Or(Vec<FilterExpr>)`, `Not(Box<FilterExpr>)`, `Pred(FilterPredicate)`
- [x] Implement `parse_filter_expr(input: &str) -> Result<FilterExpr, FilterError>`
- [x] Handle case-insensitive keywords (`and`, `AND`, `And`)
- [x] Handle quoted values (`"value with spaces"`, `'single quoted'`)
- [x] Handle unquoted values (`src/**`)
- [x] Implement operator parsing: `:`, `~`, `=`, `!=`, `>`, `>=`, `<`, `<=`
- [x] Implement parentheses for grouping
- [x] Add `FilterError::InvalidExpression { input, message }` variant
- [x] Implement `FilterExpr::evaluate(&self, path: &Path, metadata: Option<&Metadata>, content: Option<&str>) -> Result<bool, FilterError>`

**Tests:**
- [x] unit: `test_parse_simple_predicate` (`ext:py`)
- [x] unit: `test_parse_predicate_with_colon` (`path:src/**`)
- [x] unit: `test_parse_predicate_with_comparison` (`size>10k`)
- [x] unit: `test_parse_and_expression` (`ext:py and path:src/**`)
- [x] unit: `test_parse_or_expression` (`ext:py or ext:pyi`)
- [x] unit: `test_parse_not_expression` (`not name:*_test.py`)
- [x] unit: `test_parse_nested_parentheses` (`(ext:py or ext:pyi) and path:src/**`)
- [x] unit: `test_parse_case_insensitive_and` (`ext:py AND path:src/**`)
- [x] unit: `test_parse_case_insensitive_or` (`ext:py OR ext:pyi`)
- [x] unit: `test_parse_quoted_value` (`contains:"hello world"`)
- [x] unit: `test_parse_invalid_syntax_error`
- [x] unit: `test_evaluate_and_both_true`
- [x] unit: `test_evaluate_and_one_false`
- [x] unit: `test_evaluate_or_one_true`
- [x] unit: `test_evaluate_not_inverts`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core expr`
- [x] `cargo clippy -p tugtool-core -- -D warnings`

**Rollback:** Delete `expr.rs`, revert Cargo.toml and `mod.rs`

---

#### Step 3: Implement JSON Filter Schema {#step-filter-3}

**Commit:** `feat(filter): add JSON filter schema support`

**References:** [D09] Filter Inputs Are Additive, [D14] Git Predicates Are Supported,
Spec S09, (#file-filtering-spec)

**Artifacts:**
- New: `crates/tugtool-core/src/filter/json.rs`
- Modified: `crates/tugtool-core/src/filter/mod.rs` (add exports)

**Tasks:**
- [x] Define `JsonFilter` enum matching Spec S09 schema (`All`, `Any`, `Not`, `Predicates`)
- [x] Define `JsonPredicate` struct with `key`, `op`, `value` fields (string-typed for serde)
- [x] Implement `serde::Deserialize` for `JsonFilter` and `JsonPredicate`
- [x] Implement `parse_filter_json(input: &str) -> Result<FilterExpr, FilterError>` (converts to FilterExpr)
- [x] Validate schema structure (reject empty `all`/`any`, missing required fields)
- [x] Add `FilterError::InvalidJsonFilter { message }` variant
- [x] Map JSON operators (`glob`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `match`) to `PredicateOp`

**Tests:**
- [x] unit: `test_parse_json_simple_predicate`
- [x] unit: `test_parse_json_all_combinator`
- [x] unit: `test_parse_json_any_combinator`
- [x] unit: `test_parse_json_not_combinator`
- [x] unit: `test_parse_json_nested_all_any`
- [x] unit: `test_parse_json_predicates_list`
- [x] unit: `test_parse_json_invalid_missing_key`
- [x] unit: `test_parse_json_invalid_unknown_operator`
- [x] unit: `test_parse_json_empty_all_error`
- [x] unit: `test_json_to_expr_parity` (same filter in JSON and expr yields same result)

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core json`
- [x] `cargo clippy -p tugtool-core -- -D warnings`

**Rollback:** Delete `json.rs`, revert `mod.rs`

---

#### Step 4: Implement Content Predicates {#step-filter-4}

**Commit:** `feat(filter): add content-aware predicates`

**References:** [D10] Content Filters Are Opt-In, Spec S08, (#file-filtering-spec)

**Artifacts:**
- New: `crates/tugtool-core/src/filter/content.rs`
- Modified: `crates/tugtool-core/src/filter/mod.rs` (add exports)
- Modified: `crates/tugtool-core/Cargo.toml` (add `regex` if not present)

**Tasks:**
- [x] Define `ContentMatcher` struct that holds cached file contents
- [x] Implement `ContentMatcher::new() -> Self`
- [x] Implement `ContentMatcher::matches_contains(&mut self, path: &Path, substring: &str) -> Result<bool, FilterError>`
- [x] Implement `ContentMatcher::matches_regex(&mut self, path: &Path, pattern: &str) -> Result<bool, FilterError>`
- [x] Add lazy file reading with caching (avoid re-reading same file)
- [x] Add `FilterError::ContentReadError { path, message }` variant
- [x] Add `FilterError::InvalidRegex { pattern, message }` variant
- [x] Implement short-circuit on first match for `contains`

**Tests:**
- [x] unit: `test_content_contains_match`
- [x] unit: `test_content_contains_no_match`
- [x] unit: `test_content_contains_multiline`
- [x] unit: `test_content_regex_match`
- [x] unit: `test_content_regex_no_match`
- [x] unit: `test_content_regex_multiline`
- [x] unit: `test_content_regex_invalid_pattern_error`
- [x] unit: `test_content_file_not_found_error`
- [x] unit: `test_content_caching_reads_once`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core content`
- [x] `cargo clippy -p tugtool-core -- -D warnings`

**Rollback:** Delete `content.rs`, revert `mod.rs` and Cargo.toml

---

#### Step 5: Implement Combined Filter {#step-filter-5}

**Commit:** `feat(filter): add combined filter evaluation`

**References:** [D09] Filter Inputs Are Additive, [D10] Content Filters Are Opt-In,
[D11] Default Exclusions Always Apply, [D14] Git Predicates Are Supported,
Spec S10, (#file-filtering-spec)

**Artifacts:**
- New: `crates/tugtool-core/src/filter/combined.rs`
- Modified: `crates/tugtool-core/src/filter/mod.rs` (add exports, add `CombinedFilter` as primary public type)

**Tasks:**
- [x] Define `CombinedFilter` struct holding:
  - `glob_spec: Option<FileFilterSpec>` (existing glob filter)
  - `expressions: Vec<FilterExpr>` (parsed from `--filter`)
  - `json_filter: Option<FilterExpr>` (parsed from `--filter-json`)
  - `content_enabled: bool` (from `--filter-content`)
  - `content_matcher: ContentMatcher` (lazily populated)
  - `git_state: Option<GitState>` (lazily loaded if git predicates used)
- [x] Implement `CombinedFilter::builder() -> CombinedFilterBuilder` pattern
- [x] Implement `CombinedFilterBuilder::with_glob_patterns(patterns: &[String]) -> Result<Self, FilterError>`
- [x] Implement `CombinedFilterBuilder::with_expression(expr: &str) -> Result<Self, FilterError>`
- [x] Implement `CombinedFilterBuilder::with_json(json: &str) -> Result<Self, FilterError>`
- [x] Implement `CombinedFilterBuilder::with_content_enabled(enabled: bool) -> Self`
- [x] Implement `CombinedFilterBuilder::build() -> Result<CombinedFilter, FilterError>`
- [x] Implement `CombinedFilter::matches(&mut self, path: &Path) -> Result<bool, FilterError>`
- [x] Implement `CombinedFilter::requires_content(&self) -> bool`
- [x] Add validation: reject content predicates if `!content_enabled`
- [x] Implement filter combination per Spec S10 (all sources AND'd)

**Tests:**
- [x] unit: `test_combined_glob_only`
- [x] unit: `test_combined_expr_only`
- [x] unit: `test_combined_json_only`
- [x] unit: `test_combined_glob_and_expr`
- [x] unit: `test_combined_all_sources_and`
- [x] unit: `test_combined_content_without_flag_error`
- [x] unit: `test_combined_content_with_flag_ok`
- [x] unit: `test_combined_empty_is_all_files`
- [x] unit: `test_combined_default_exclusions_always_apply`

**Checkpoint:**
- [x] `cargo nextest run -p tugtool-core combined`
- [x] `cargo clippy -p tugtool-core -- -D warnings`

**Rollback:** Delete `combined.rs`, revert `mod.rs`

---

#### Step 6: Add CLI Options {#step-filter-6}

**Commit:** `feat(cli): add filter expression and JSON options`

**References:** [D09] Filter Inputs Are Additive, [D10] Content Filters Are Opt-In,
[D13] Filter File Format Is Explicit, Table T20, (#file-filtering-symbols)

**Artifacts:**
- Modified: `crates/tugtool/src/main.rs` (add new CLI options to all command variants)

**Tasks:**
- [x] Add `--filter <expr>` option to `ApplyPythonCommand::Rename` (repeatable via `Vec<String>`)
- [x] Add `--filter <expr>` option to `EmitPythonCommand::Rename`
- [x] Add `--filter <expr>` option to `AnalyzePythonCommand::Rename`
- [x] Add `--filter-json <json>` option (single, `Option<String>`)
- [x] Add `--filter-file <path>` option (single, `Option<PathBuf>`)
- [x] Add `--filter-file-format <format>` option (single, `Option<String>`)
- [x] Add `--filter-content` flag (`bool`)
- [x] Add `--filter-content-max-bytes <n>` option (`Option<u64>`)
- [x] Add `--filter-list` flag (`bool`)
- [x] Implement `parse_filter_file(path: &Path) -> Result<String, TugError>` helper
- [x] Reject multiple `--filter-json` with clear error (clap handles this)
- [x] Validate required pairing: `--filter-file` requires `--filter-file-format`
- [x] Validate mutual exclusivity: `--filter-list` skips operation execution

**Tests:**
- [x] unit: CLI parses `--filter "ext:py"`
- [x] unit: CLI parses multiple `--filter` options
- [x] unit: CLI parses `--filter-json '{...}'`
- [x] unit: CLI parses `--filter-file path.txt`
- [x] unit: CLI rejects `--filter-file` without `--filter-file-format`
- [x] unit: CLI parses `--filter-content` flag
- [x] unit: CLI parses `--filter-content-max-bytes 1048576`
- [x] unit: CLI parses `--filter-list` flag
- [x] unit: CLI parses combined `--filter` and `-- patterns`

**Checkpoint:**
- [x] `cargo build -p tugtool`
- [x] `cargo run -p tugtool -- apply python rename --help` shows new options
- [x] `cargo run -p tugtool -- emit python rename --help` shows new options
- [x] `cargo run -p tugtool -- analyze python rename --help` shows new options

**Rollback:** Revert `main.rs` changes

---

#### Step 7: Implement Filter List Mode {#step-filter-7}

**Commit:** `feat(cli): add --filter-list introspection mode`

**References:** [D12] Filter Introspection for Agents, Spec S11, (#file-filtering-spec)

**Artifacts:**
- Modified: `crates/tugtool/src/main.rs` (add filter-list handling)
- Modified: `crates/tugtool-core/src/output.rs` (add `FilterListResponse`)

**Tasks:**
- [x] Add `FilterListResponse` struct to `output.rs`:
  - `files: Vec<String>` (sorted relative paths)
  - `count: usize`
  - `filter_summary: FilterSummary`
- [x] Add `FilterSummary` struct:
  - `glob_patterns: Vec<String>`
  - `expressions: Vec<String>`
  - `json_filter: Option<serde_json::Value>`
  - `content_enabled: bool`
- [x] Implement `Serialize` for `FilterListResponse`
- [x] In command execution, check `--filter-list` flag first
- [x] If set, build `CombinedFilter`, collect matching files, output JSON, exit 0
- [x] Skip actual rename/analyze operation when `--filter-list` is set

**Tests:**
- [x] integration: `--filter-list` with glob patterns outputs JSON with correct files
- [x] integration: `--filter-list` with expression outputs JSON
- [x] integration: `--filter-list` count matches file list length
- [x] integration: `--filter-list` returns exit code 0
- [x] integration: `--filter-list` does not modify any files

**Checkpoint:**
- [x] `cargo nextest run -p tugtool filter_list`
- [x] Manual: `tug apply python rename --at x:1:1 --to y --filter-list` outputs JSON

**Rollback:** Revert `main.rs` and `output.rs` changes

---

#### Step 8: Integrate Combined Filter into Operations {#step-filter-8}

**Commit:** `feat(cli): use combined filter in refactoring operations`

**References:** [D09] Filter Inputs Are Additive, [D10] Content Filters Are Opt-In,
[D11] Default Exclusions Always Apply, [D14] Git Predicates Are Supported,
Spec S10, (#file-filtering-spec)

**Artifacts:**
- Modified: `crates/tugtool/src/main.rs`
- Modified: `crates/tugtool/src/cli.rs`
- Modified: `crates/tugtool-python/src/files.rs`

**Tasks:**
- [ ] Update `collect_python_files_filtered()` signature to accept `&mut CombinedFilter`
- [ ] Update `analyze_rename()` in `cli.rs` to accept `CombinedFilter`
- [ ] Update `do_rename()` in `cli.rs` to accept `CombinedFilter`
- [ ] Build `CombinedFilter` in `execute_apply_python()` from all filter sources
- [ ] Build `CombinedFilter` in `execute_emit_python()` from all filter sources
- [ ] Build `CombinedFilter` in `execute_analyze_python()` from all filter sources
- [ ] Ensure backward compatibility: glob-only usage (`-- patterns`) still works
- [ ] Support `--filter-file` input based on `--filter-file-format`
- [ ] Enforce `--filter-content-max-bytes` when content predicates are used
- [ ] Ensure filter errors produce proper JSON error output

**Tests:**
- [ ] integration: `--filter "ext:py"` restricts rename scope
- [ ] integration: `--filter "path:src/**"` restricts to src directory
- [ ] integration: `--filter "not name:*_test.py"` excludes test files
- [ ] integration: `--filter` + `-- patterns` both apply (AND)
- [ ] integration: `--filter-json '{...}'` restricts scope
- [ ] integration: existing glob-only tests still pass
- [ ] integration: content predicate without `--filter-content` errors

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool`
- [ ] `cargo nextest run -p tugtool-python`
- [ ] Manual: `tug apply python rename --at test.py:1:5 --to new_name --filter "path:src/**"`
- [ ] Manual: `tug emit python rename --at test.py:1:5 --to new_name --filter "ext:py" -- "!tests/**"`

**Rollback:** Revert changes to `main.rs`, `cli.rs`, `files.rs`

---

#### Step 9: Documentation {#step-filter-9}

**Commit:** `docs: add filter expression and JSON documentation`

**References:** (#file-filtering-docs), Spec S08, Spec S09, Table T20

**Artifacts:**
- Modified: `CLAUDE.md`
- Modified: `docs/AGENT_API.md`

**Tasks:**
- [ ] Add "Filter Expression Language" section to CLAUDE.md Quick Reference
- [ ] Document all predicates (`path`, `name`, `ext`, `lang`, `kind`, `size`, `contains`, `regex`)
- [ ] Document operators (`:`, `~`, `=`, `!=`, `>`, `>=`, `<`, `<=`)
- [ ] Document combinators (`and`, `or`, `not`, parentheses)
- [ ] Add JSON filter schema documentation with examples
- [ ] Document `--filter-content` requirement for content predicates
- [ ] Document `--filter-list` introspection mode
- [ ] Add "Common Filter Recipes" section with agent-focused examples
- [ ] Update `docs/AGENT_API.md` with filter CLI options

**Tests:**
- [ ] Documentation examples execute correctly when copy-pasted

**Checkpoint:**
- [ ] Manual review of CLAUDE.md changes
- [ ] Manual review of AGENT_API.md changes
- [ ] Run documented examples to verify they work

**Rollback:** Revert documentation changes

---

#### Step 10: Golden Tests {#step-filter-10}

**Commit:** `test: add golden tests for filter system`

**References:** (#file-filtering-tests), Spec S08, Spec S09, Spec S11

**Artifacts:**
- New: `crates/tugtool/tests/golden/filter/` directory
- New: Golden test files for filter outputs

**Tasks:**
- [ ] Add golden test for `--filter-list` response schema
- [ ] Add golden test for filter expression error message format
- [ ] Add golden test for JSON filter error message format
- [ ] Add golden test for content predicate without flag error
- [ ] Verify expression/JSON parity (same filter logic yields same file set)
- [ ] Add drift prevention test for `FilterListResponse` schema

**Tests:**
- [ ] golden: `filter_list_response.json`
- [ ] golden: `filter_expr_error.json`
- [ ] golden: `filter_json_error.json`
- [ ] golden: `filter_content_without_flag_error.json`

**Checkpoint:**
- [ ] `cargo nextest run -p tugtool golden`
- [ ] `TUG_UPDATE_GOLDEN=1 cargo nextest run -p tugtool golden` (if needed to create baselines)

**Rollback:** Delete golden test files

---

### 12.7.6 Deliverables and Checkpoints {#file-filtering-deliverables}

**Deliverable:** Advanced file filtering system with expression language, JSON schema, and introspection mode.

#### Phase Exit Criteria ("Done means...") {#file-filtering-exit}

- [ ] `--filter "path:src/** and ext:py"` works on all refactoring commands
- [ ] `--filter-json '{"all":[...]}'` works on all refactoring commands
- [ ] `--filter` + `-- patterns` both apply (AND combination)
- [ ] `contains`/`regex` predicates error without `--filter-content`
- [ ] `contains`/`regex` predicates work with `--filter-content`
- [ ] `--filter "git_tracked:true"` restricts to tracked files
- [ ] Git predicates return false gracefully when no `.git` present
- [ ] `--filter-list` outputs matched files JSON and exits 0
- [ ] All existing glob-only tests pass unchanged
- [ ] Documentation updated in CLAUDE.md and AGENT_API.md
- [ ] No clippy warnings: `cargo clippy --workspace -- -D warnings`

#### Acceptance Tests {#file-filtering-acceptance}

- [ ] integration: Expression filter restricts rename scope
- [ ] integration: JSON filter restricts rename scope
- [ ] integration: Filter parity (same predicate in expr vs JSON yields same files)
- [ ] integration: Content filter requires `--filter-content` flag
- [ ] integration: Git predicate restricts to tracked/modified files
- [ ] integration: Git predicate graceful when no `.git` present
- [ ] integration: `--filter-list` returns correct file count

| Checkpoint | Verification |
|------------|--------------|
| Parser tests | `cargo nextest run -p tugtool-core expr json` |
| Predicate tests | `cargo nextest run -p tugtool-core predicate content` |
| CLI options | `tug apply python rename --help` shows filter options |
| Filter list | `tug apply python rename --at x:1:1 --to y --filter-list` |
| Integration | `cargo nextest run --workspace` |

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#file-filtering-roadmap}

- [ ] Add `mtime` predicate (file modification time comparison)
- [ ] Add `ctime` predicate (file creation time comparison)
- [ ] Add `--include-default-excluded` override flag
- [ ] Add filter preset system (`--filter-preset no-tests`)
- [ ] Parallel content scanning for large codebases

**Phase complete when all checkpoints pass.**
