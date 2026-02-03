//! Binary entry point for the tug CLI.
//!
//! This module provides the command-line interface for tug operations.
//! It is the "front door" for LLM coding agents.
//!
//! ## Usage
//!
//! ```bash
//! # Apply a rename (modifies files)
//! tug apply python rename --at src/lib.py:10:5 --to new_name
//!
//! # Emit a diff without modifying files
//! tug emit python rename --at src/lib.py:10:5 --to new_name
//!
//! # Analyze operation metadata
//! tug analyze python rename --at src/lib.py:10:5 --to new_name
//!
//! # Check session status
//! tug session status
//!
//! # Clean session resources
//! tug clean --cache
//! ```

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand, ValueEnum};
use serde::Serialize;

// Core imports (always available)
use tugtool_core::error::{OutputErrorCode, TugError};
use tugtool_core::output::SCHEMA_VERSION;
use tugtool_core::output::{
    emit_response, CheckResult, DoctorResponse, ErrorInfo, ErrorResponse, FilterListResponse,
    FilterSummary, FixtureFetchResponse, FixtureFetchResult, FixtureListItem, FixtureListResponse,
    FixtureStatusItem, FixtureStatusResponse, FixtureUpdateResponse, FixtureUpdateResult,
};
use tugtool_core::session::{Session, SessionOptions};

// Python feature-gated imports
#[cfg(feature = "python")]
use tugtool::cli;
#[cfg(feature = "python")]
use tugtool::cli::{
    analyze_rename, analyze_rename_param, do_extract_constant, do_extract_variable, do_rename,
    do_rename_param,
};
#[cfg(feature = "python")]
use tugtool_core::filter::CombinedFilter;
#[cfg(feature = "python")]
use tugtool_python::verification::VerificationMode;

// ============================================================================
// CLI Structure
// ============================================================================

/// Safe code refactoring for AI agents.
///
/// Tug provides verified, deterministic, minimal-diff refactors across
/// Python codebases. Output is JSON for apply/analyze and unified diff for emit
/// (with optional JSON envelope via `emit --json`).
#[derive(Parser, Debug)]
#[command(name = "tug", version, about = "Safe code refactoring for AI agents")]
struct Cli {
    #[command(flatten)]
    global: GlobalArgs,
    #[command(subcommand)]
    command: TopLevelCommand,
}

/// Global arguments shared by all subcommands.
#[derive(Parser, Debug)]
struct GlobalArgs {
    /// Workspace root directory (default: current directory).
    #[arg(long, global = true)]
    workspace: Option<PathBuf>,

    /// Session directory path (default: .tug/ in workspace).
    #[arg(long, global = true)]
    session_dir: Option<PathBuf>,

    /// Named session (creates `.tug/<name>/`).
    #[arg(long, global = true)]
    session_name: Option<String>,

    /// Delete existing session and start fresh.
    #[arg(long, global = true)]
    fresh: bool,

    /// Log level for tracing output.
    #[arg(long, global = true, value_enum, default_value = "warn")]
    log_level: LogLevel,

    /// Explicit toolchain path override in format `<lang>=<path>`.
    ///
    /// Can be specified multiple times for different languages:
    /// - `--toolchain python=/usr/bin/python3`
    /// - `--toolchain rust=/usr/bin/rust-analyzer`
    ///
    /// Overrides bypass session caching (used directly without caching).
    #[arg(long, global = true, value_parser = parse_toolchain_override)]
    toolchain: Vec<(String, PathBuf)>,
}

/// Parse a toolchain override in `<lang>=<path>` format.
fn parse_toolchain_override(s: &str) -> Result<(String, PathBuf), String> {
    let parts: Vec<&str> = s.splitn(2, '=').collect();
    if parts.len() != 2 {
        return Err(format!(
            "invalid toolchain format '{}', expected '<lang>=<path>' (e.g., 'python=/usr/bin/python3')",
            s
        ));
    }
    let lang = parts[0].to_lowercase();
    let path = PathBuf::from(parts[1]);
    Ok((lang, path))
}

/// Log level for tracing output.
#[derive(Clone, Copy, Debug, ValueEnum)]
enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn to_tracing_level(self) -> tracing::Level {
        match self {
            LogLevel::Trace => tracing::Level::TRACE,
            LogLevel::Debug => tracing::Level::DEBUG,
            LogLevel::Info => tracing::Level::INFO,
            LogLevel::Warn => tracing::Level::WARN,
            LogLevel::Error => tracing::Level::ERROR,
        }
    }
}

/// Top-level CLI commands.
#[derive(Subcommand, Debug)]
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
    /// Session management commands.
    Session {
        #[command(subcommand)]
        action: SessionAction,
    },
    /// Fixture management commands.
    Fixture {
        #[command(subcommand)]
        action: FixtureAction,
    },
    /// Clean up session resources.
    Clean {
        /// Clean facts cache.
        #[arg(long)]
        cache: bool,
    },
    /// Run environment diagnostics.
    Doctor,
}

// ============================================================================
// Apply Action
// ============================================================================

/// Language selection for apply action.
#[derive(Subcommand, Debug)]
enum ApplyLanguage {
    /// Python language operations.
    Python {
        #[command(subcommand)]
        command: ApplyPythonCommand,
    },
    /// Rust language operations (not yet implemented).
    Rust {
        #[command(subcommand)]
        command: ApplyRustCommand,
    },
}

/// Filter options shared across commands (Table T20).
#[derive(Parser, Debug, Default, Clone)]
struct FilterOptions {
    /// Expression filter (repeatable).
    ///
    /// Filters files using predicate expressions. Multiple --filter options
    /// are combined with AND. Examples:
    /// - `--filter "ext:py"` - Python files only
    /// - `--filter "path:src/**"` - Files in src/ directory
    /// - `--filter "size<100k"` - Files under 100KB
    #[arg(long = "filter", value_name = "EXPR")]
    filter_expr: Vec<String>,

    /// JSON filter schema.
    ///
    /// A JSON object with optional `all`, `any`, `not`, and `predicates` fields.
    /// Example: `--filter-json '{"predicates":[{"key":"ext","op":"eq","value":"py"}]}'`
    #[arg(long, value_name = "JSON")]
    filter_json: Option<String>,

    /// Filter file path.
    ///
    /// A file containing filter definitions. Requires `--filter-file-format`.
    #[arg(long, value_name = "PATH")]
    filter_file: Option<PathBuf>,

    /// Filter file format (required with --filter-file).
    ///
    /// Specifies how to interpret the filter file:
    /// - `json`: JSON filter schema
    /// - `glob`: Newline-separated glob patterns
    /// - `expr`: Newline-separated expression filters
    #[arg(long, value_name = "FORMAT", value_parser = ["json", "glob", "expr"])]
    filter_file_format: Option<String>,

    /// Enable content predicates.
    ///
    /// Required for `contains` and `regex` predicates. Without this flag,
    /// content predicates will error.
    #[arg(long)]
    filter_content: bool,

    /// Maximum file size for content predicates (bytes).
    ///
    /// Files larger than this are skipped for content matching.
    /// Default: 5MB when --filter-content is set.
    #[arg(long, value_name = "BYTES")]
    filter_content_max_bytes: Option<u64>,

    /// List matched files and exit.
    ///
    /// Outputs JSON with matched files and exits without performing
    /// the refactoring operation. Useful for verifying filter scope.
    #[arg(long)]
    filter_list: bool,
}

/// Python commands for apply action.
#[derive(Subcommand, Debug)]
enum ApplyPythonCommand {
    /// Rename a symbol.
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// Verification mode after applying changes.
        #[arg(long, value_enum, default_value = "syntax")]
        verify: VerifyMode,
        /// Skip verification entirely.
        #[arg(long)]
        no_verify: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Rename a function parameter and update keyword arguments at call sites.
    RenameParam {
        /// Location of the parameter to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the parameter.
        #[arg(long)]
        to: String,
        /// Verification mode after applying changes.
        #[arg(long, value_enum, default_value = "syntax")]
        verify: VerifyMode,
        /// Skip verification entirely.
        #[arg(long)]
        no_verify: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Extract an expression into a named variable.
    ExtractVariable {
        /// Location of the expression to extract (file:line:col).
        #[arg(long)]
        at: String,
        /// Name for the extracted variable.
        #[arg(long)]
        name: String,
        /// Verification mode after applying changes.
        #[arg(long, value_enum, default_value = "syntax")]
        verify: VerifyMode,
        /// Skip verification entirely.
        #[arg(long)]
        no_verify: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Extract a literal into a module-level constant.
    ExtractConstant {
        /// Location of the literal to extract (file:line:col).
        #[arg(long)]
        at: String,
        /// Name for the extracted constant (UPPER_SNAKE_CASE recommended).
        #[arg(long)]
        name: String,
        /// Verification mode after applying changes.
        #[arg(long, value_enum, default_value = "syntax")]
        verify: VerifyMode,
        /// Skip verification entirely.
        #[arg(long)]
        no_verify: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

/// Rust commands for apply action (placeholder).
#[derive(Subcommand, Debug)]
enum ApplyRustCommand {
    /// Rename a symbol (not yet implemented).
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

// ============================================================================
// Emit Action
// ============================================================================

/// Language selection for emit action.
#[derive(Subcommand, Debug)]
enum EmitLanguage {
    /// Python language operations.
    Python {
        #[command(subcommand)]
        command: EmitPythonCommand,
    },
    /// Rust language operations (not yet implemented).
    Rust {
        #[command(subcommand)]
        command: EmitRustCommand,
    },
}

/// Python commands for emit action.
#[derive(Subcommand, Debug)]
enum EmitPythonCommand {
    /// Emit diff for a rename operation.
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// Output JSON envelope instead of plain diff.
        #[arg(long)]
        json: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Emit diff for a parameter rename operation.
    RenameParam {
        /// Location of the parameter to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the parameter.
        #[arg(long)]
        to: String,
        /// Output JSON envelope instead of plain diff.
        #[arg(long)]
        json: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Emit diff for extracting an expression into a variable.
    ExtractVariable {
        /// Location of the expression to extract (file:line:col).
        #[arg(long)]
        at: String,
        /// Name for the extracted variable.
        #[arg(long)]
        name: String,
        /// Output JSON envelope instead of plain diff.
        #[arg(long)]
        json: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Emit diff for extracting a literal into a constant.
    ExtractConstant {
        /// Location of the literal to extract (file:line:col).
        #[arg(long)]
        at: String,
        /// Name for the extracted constant (UPPER_SNAKE_CASE recommended).
        #[arg(long)]
        name: String,
        /// Output JSON envelope instead of plain diff.
        #[arg(long)]
        json: bool,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

/// Rust commands for emit action (placeholder).
#[derive(Subcommand, Debug)]
enum EmitRustCommand {
    /// Emit diff for a rename operation (not yet implemented).
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// Output JSON envelope instead of plain diff.
        #[arg(long)]
        json: bool,
        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

// ============================================================================
// Analyze Action
// ============================================================================

/// Language selection for analyze action.
#[derive(Subcommand, Debug)]
enum AnalyzeLanguage {
    /// Python language operations.
    Python {
        #[command(subcommand)]
        command: AnalyzePythonCommand,
    },
    /// Rust language operations (not yet implemented).
    Rust {
        #[command(subcommand)]
        command: AnalyzeRustCommand,
    },
}

/// Python commands for analyze action.
#[derive(Subcommand, Debug)]
enum AnalyzePythonCommand {
    /// Analyze a rename operation.
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// Output format.
        #[arg(long, value_enum, default_value = "impact")]
        output: AnalyzeOutput,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Analyze a parameter rename operation.
    RenameParam {
        /// Location of the parameter to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the parameter.
        #[arg(long)]
        to: String,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Analyze an extract-variable operation (preview expression and insertion point).
    ExtractVariable {
        /// Location of the expression to extract (file:line:col).
        #[arg(long)]
        at: String,
        /// Optional variable name (will suggest one if not provided).
        #[arg(long)]
        name: Option<String>,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
    /// Analyze an extract-constant operation (preview literal and insertion point).
    ExtractConstant {
        /// Location of the literal to extract (file:line:col).
        #[arg(long)]
        at: String,
        /// Optional constant name (will suggest one if not provided).
        #[arg(long)]
        name: Option<String>,

        /// Filter options.
        #[command(flatten)]
        filter_opts: FilterOptions,

        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

/// Rust commands for analyze action (placeholder).
#[derive(Subcommand, Debug)]
enum AnalyzeRustCommand {
    /// Analyze a rename operation (not yet implemented).
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// Output format.
        #[arg(long, value_enum, default_value = "impact")]
        output: AnalyzeOutput,
        /// File filter patterns (optional, after --).
        #[arg(last = true)]
        filter: Vec<String>,
    },
}

// ============================================================================
// Shared Types
// ============================================================================

/// Verification modes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum VerifyMode {
    /// No verification.
    None,
    /// Syntax check only.
    Syntax,
    /// Run tests.
    Tests,
    /// Type checking.
    Typecheck,
}

#[cfg(feature = "python")]
impl From<VerifyMode> for VerificationMode {
    fn from(mode: VerifyMode) -> Self {
        match mode {
            VerifyMode::None => VerificationMode::None,
            VerifyMode::Syntax => VerificationMode::Syntax,
            VerifyMode::Tests => VerificationMode::Tests,
            VerifyMode::Typecheck => VerificationMode::TypeCheck,
        }
    }
}

/// Output format for analyze command.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
enum AnalyzeOutput {
    /// Full impact analysis (default).
    #[default]
    Impact,
    /// Just the references array.
    References,
    /// Just the symbol info.
    Symbol,
}

/// Session management actions.
#[derive(Subcommand, Debug)]
enum SessionAction {
    /// Show session status.
    Status,
}

/// Fixture management actions.
#[derive(Subcommand, Debug)]
enum FixtureAction {
    /// Fetch fixtures according to lock files.
    Fetch {
        /// Specific fixture to fetch (fetches all if omitted).
        name: Option<String>,
        /// Re-fetch even if fixture exists and SHA matches.
        #[arg(long)]
        force: bool,
    },
    /// Update a fixture lock file to a new ref.
    Update {
        /// Fixture name to update.
        name: String,
        /// New ref (tag or branch).
        #[arg(long = "ref")]
        git_ref: String,
    },
    /// List available fixtures from lock files.
    List,
    /// Show fetch state of fixtures.
    Status {
        /// Specific fixture to check (checks all if omitted).
        name: Option<String>,
    },
}

// ============================================================================
// Emit JSON Envelope (Spec S07)
// ============================================================================

/// JSON envelope for emit --json output.
#[derive(Debug, Serialize)]
struct EmitJsonEnvelope {
    format: String,
    diff: String,
    files_affected: Vec<String>,
    metadata: serde_json::Value,
}

// ============================================================================
// Main Entry Point
// ============================================================================

fn main() -> ExitCode {
    let cli = Cli::parse();

    // Initialize tracing
    init_tracing(cli.global.log_level);

    // Execute command and handle errors
    match execute(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            // Emit error response JSON
            let error_code = OutputErrorCode::from(&err);
            let response = ErrorResponse {
                status: "error".to_string(),
                schema_version: SCHEMA_VERSION.to_string(),
                snapshot_id: None,
                error: ErrorInfo::from_error(&err),
            };

            // Write to stderr (errors go to stderr as JSON per agent contract)
            let _ = emit_response(&response, &mut io::stderr());
            let _ = io::stderr().flush();

            // Return appropriate exit code
            ExitCode::from(error_code.code())
        }
    }
}

/// Initialize tracing subscriber.
fn init_tracing(level: LogLevel) {
    use tracing_subscriber::fmt::format::FmtSpan;
    use tracing_subscriber::EnvFilter;

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level.to_tracing_level().to_string()));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_span_events(FmtSpan::CLOSE)
        .with_target(false)
        .with_writer(io::stderr)
        .init();
}

/// Execute the CLI command.
fn execute(cli: Cli) -> Result<(), TugError> {
    match cli.command {
        TopLevelCommand::Apply { language } => execute_apply(&cli.global, language),
        TopLevelCommand::Emit { language } => execute_emit(&cli.global, language),
        TopLevelCommand::Analyze { language } => execute_analyze(&cli.global, language),
        TopLevelCommand::Session { action } => execute_session(&cli.global, action),
        TopLevelCommand::Fixture { action } => execute_fixture(&cli.global, action),
        TopLevelCommand::Clean { cache } => execute_clean(&cli.global, cache),
        TopLevelCommand::Doctor => execute_doctor(&cli.global),
    }
}

// ============================================================================
// Action Dispatchers
// ============================================================================

/// Execute apply action.
fn execute_apply(global: &GlobalArgs, language: ApplyLanguage) -> Result<(), TugError> {
    match language {
        ApplyLanguage::Python { command } => execute_apply_python(global, command),
        ApplyLanguage::Rust { command } => execute_apply_rust(global, command),
    }
}

/// Execute emit action.
fn execute_emit(global: &GlobalArgs, language: EmitLanguage) -> Result<(), TugError> {
    match language {
        EmitLanguage::Python { command } => execute_emit_python(global, command),
        EmitLanguage::Rust { command } => execute_emit_rust(global, command),
    }
}

/// Execute analyze action.
fn execute_analyze(global: &GlobalArgs, language: AnalyzeLanguage) -> Result<(), TugError> {
    match language {
        AnalyzeLanguage::Python { command } => execute_analyze_python(global, command),
        AnalyzeLanguage::Rust { command } => execute_analyze_rust(global, command),
    }
}

// ============================================================================
// Python Command Executors
// ============================================================================

/// Execute apply python command.
#[cfg(feature = "python")]
fn execute_apply_python(global: &GlobalArgs, command: ApplyPythonCommand) -> Result<(), TugError> {
    match command {
        ApplyPythonCommand::Rename {
            at,
            to,
            verify,
            no_verify,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Determine effective verification mode
            // --no-verify takes precedence
            let effective_verify = if no_verify {
                VerificationMode::None
            } else {
                verify.into()
            };

            // Run the rename operation (apply=true) with combined filter
            let json = do_rename(
                &session,
                Some(python_path),
                &at,
                &to,
                effective_verify,
                true,
                &mut combined_filter,
            )?;

            // Output JSON result
            println!("{}", json);
            Ok(())
        }
        ApplyPythonCommand::RenameParam {
            at,
            to,
            verify,
            no_verify,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Determine effective verification mode
            // --no-verify takes precedence
            let effective_verify = if no_verify {
                VerificationMode::None
            } else {
                verify.into()
            };

            // Run the rename-param operation
            let json = do_rename_param(
                &session,
                Some(python_path),
                &at,
                &to,
                effective_verify,
                true,
                &mut combined_filter,
            )?;

            // Output JSON result
            println!("{}", json);
            Ok(())
        }
        ApplyPythonCommand::ExtractVariable {
            at,
            name,
            verify,
            no_verify,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Determine effective verification mode
            // --no-verify takes precedence
            let effective_verify = if no_verify {
                VerificationMode::None
            } else {
                verify.into()
            };

            // Run the extract-variable operation
            let json = do_extract_variable(
                &session,
                Some(python_path),
                &at,
                &name,
                effective_verify,
                true,
                &mut combined_filter,
            )?;

            // Output JSON result
            println!("{}", json);
            Ok(())
        }
        ApplyPythonCommand::ExtractConstant {
            at,
            name,
            verify,
            no_verify,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Determine effective verification mode
            // --no-verify takes precedence
            let effective_verify = if no_verify {
                VerificationMode::None
            } else {
                verify.into()
            };

            // Run the extract-constant operation
            let json = do_extract_constant(
                &session,
                Some(python_path),
                &at,
                &name,
                effective_verify,
                true,
                &mut combined_filter,
            )?;

            // Output JSON result
            println!("{}", json);
            Ok(())
        }
    }
}

#[cfg(not(feature = "python"))]
fn execute_apply_python(
    _global: &GlobalArgs,
    _command: ApplyPythonCommand,
) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
}

/// Execute apply rust command (placeholder).
fn execute_apply_rust(_global: &GlobalArgs, _command: ApplyRustCommand) -> Result<(), TugError> {
    Err(TugError::invalid_args(
        "rust language support not yet implemented".to_string(),
    ))
}

/// Execute emit python command.
#[cfg(feature = "python")]
fn execute_emit_python(global: &GlobalArgs, command: EmitPythonCommand) -> Result<(), TugError> {
    match command {
        EmitPythonCommand::Rename {
            at,
            to,
            json: emit_json,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run rename in dry-run mode (apply=false) with no verification
            let json_result = do_rename(
                &session,
                Some(python_path),
                &at,
                &to,
                VerificationMode::None,
                false, // Never apply changes
                &mut combined_filter,
            )?;

            // Parse result to extract diff
            let result: serde_json::Value = serde_json::from_str(&json_result)
                .map_err(|e| TugError::internal(e.to_string()))?;

            let diff = result
                .get("patch")
                .and_then(|p| p.get("unified_diff"))
                .and_then(|d| d.as_str())
                .unwrap_or("");

            // Extract files affected
            let files_affected: Vec<String> = result
                .get("patch")
                .and_then(|p| p.get("edits"))
                .and_then(|e| e.as_array())
                .map(|edits| {
                    let mut files: Vec<String> = edits
                        .iter()
                        .filter_map(|e| e.get("file").and_then(|f| f.as_str()).map(String::from))
                        .collect();
                    files.sort();
                    files.dedup();
                    files
                })
                .unwrap_or_default();

            if emit_json {
                // Output JSON envelope per Spec S07
                let envelope = EmitJsonEnvelope {
                    format: "unified".to_string(),
                    diff: diff.to_string(),
                    files_affected,
                    metadata: serde_json::json!({}),
                };
                let json_output = serde_json::to_string_pretty(&envelope)
                    .map_err(|e| TugError::internal(e.to_string()))?;
                println!("{}", json_output);
            } else {
                // Output plain diff (empty diff = empty output for machine consumption)
                if !diff.is_empty() {
                    print!("{}", diff);
                }
            }

            Ok(())
        }
        EmitPythonCommand::RenameParam {
            at,
            to,
            json: emit_json,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run rename-param in dry-run mode (apply=false) with no verification
            let json_result = do_rename_param(
                &session,
                Some(python_path),
                &at,
                &to,
                VerificationMode::None,
                false, // Never apply changes
                &mut combined_filter,
            )?;

            if emit_json {
                // Output JSON result directly (it's already analysis JSON)
                println!("{}", json_result);
            } else {
                // For plain mode, just output analysis info
                // (No diff since rename-param analyze doesn't generate unified diff yet)
                println!("{}", json_result);
            }

            Ok(())
        }
        EmitPythonCommand::ExtractVariable {
            at,
            name,
            json: emit_json,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run extract-variable in dry-run mode (apply=false) with no verification
            let json_result = do_extract_variable(
                &session,
                Some(python_path),
                &at,
                &name,
                VerificationMode::None,
                false, // Never apply changes
                &mut combined_filter,
            )?;

            // Parse to extract diff
            let result: serde_json::Value = serde_json::from_str(&json_result)
                .map_err(|e| TugError::internal(format!("Failed to parse result: {}", e)))?;

            // Extract diff from patch.unified_diff
            let diff = result
                .get("patch")
                .and_then(|p| p.get("unified_diff"))
                .and_then(|d| d.as_str())
                .unwrap_or("");

            // Extract files affected
            let files_affected: Vec<String> = result
                .get("patch")
                .and_then(|p| p.get("edits"))
                .and_then(|e| e.as_array())
                .map(|edits| {
                    let mut files: Vec<String> = edits
                        .iter()
                        .filter_map(|e| e.get("file").and_then(|f| f.as_str()).map(String::from))
                        .collect();
                    files.sort();
                    files.dedup();
                    files
                })
                .unwrap_or_default();

            if emit_json {
                // Output JSON envelope
                let envelope = EmitJsonEnvelope {
                    format: "unified".to_string(),
                    diff: diff.to_string(),
                    files_affected,
                    metadata: serde_json::json!({}),
                };
                let json_output = serde_json::to_string_pretty(&envelope)
                    .map_err(|e| TugError::internal(e.to_string()))?;
                println!("{}", json_output);
            } else {
                // Output plain diff
                if !diff.is_empty() {
                    print!("{}", diff);
                }
            }

            Ok(())
        }
        EmitPythonCommand::ExtractConstant {
            at,
            name,
            json: emit_json,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run extract-constant in dry-run mode (apply=false) with no verification
            let json_result = do_extract_constant(
                &session,
                Some(python_path),
                &at,
                &name,
                VerificationMode::None,
                false, // Never apply changes
                &mut combined_filter,
            )?;

            // Parse to extract diff
            let result: serde_json::Value = serde_json::from_str(&json_result)
                .map_err(|e| TugError::internal(format!("Failed to parse result: {}", e)))?;

            // Extract diff from patch.unified_diff
            let diff = result
                .get("patch")
                .and_then(|p| p.get("unified_diff"))
                .and_then(|d| d.as_str())
                .unwrap_or("");

            // Extract files affected
            let files_affected: Vec<String> = result
                .get("patch")
                .and_then(|p| p.get("edits"))
                .and_then(|e| e.as_array())
                .map(|edits| {
                    let mut files: Vec<String> = edits
                        .iter()
                        .filter_map(|e| e.get("file").and_then(|f| f.as_str()).map(String::from))
                        .collect();
                    files.sort();
                    files.dedup();
                    files
                })
                .unwrap_or_default();

            if emit_json {
                // Output JSON envelope
                let envelope = EmitJsonEnvelope {
                    format: "unified".to_string(),
                    diff: diff.to_string(),
                    files_affected,
                    metadata: serde_json::json!({}),
                };
                let json_output = serde_json::to_string_pretty(&envelope)
                    .map_err(|e| TugError::internal(e.to_string()))?;
                println!("{}", json_output);
            } else {
                // Output plain diff
                if !diff.is_empty() {
                    print!("{}", diff);
                }
            }

            Ok(())
        }
    }
}

#[cfg(not(feature = "python"))]
fn execute_emit_python(_global: &GlobalArgs, _command: EmitPythonCommand) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
}

/// Execute emit rust command (placeholder).
fn execute_emit_rust(_global: &GlobalArgs, _command: EmitRustCommand) -> Result<(), TugError> {
    Err(TugError::invalid_args(
        "rust language support not yet implemented".to_string(),
    ))
}

/// Execute analyze python command.
#[cfg(feature = "python")]
fn execute_analyze_python(
    global: &GlobalArgs,
    command: AnalyzePythonCommand,
) -> Result<(), TugError> {
    match command {
        AnalyzePythonCommand::Rename {
            at,
            to,
            output,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run impact analysis (read-only) with combined filter
            let json_result =
                analyze_rename(&session, Some(python_path), &at, &to, &mut combined_filter)?;

            // Parse result
            let result: serde_json::Value = serde_json::from_str(&json_result)
                .map_err(|e| TugError::internal(e.to_string()))?;

            // Output based on format
            match output {
                AnalyzeOutput::Impact => {
                    // Full JSON response
                    println!("{}", json_result);
                }
                AnalyzeOutput::References => {
                    // Extract just references
                    let references = result
                        .get("references")
                        .cloned()
                        .unwrap_or(serde_json::json!([]));
                    let output = serde_json::to_string_pretty(&references)
                        .map_err(|e| TugError::internal(e.to_string()))?;
                    println!("{}", output);
                }
                AnalyzeOutput::Symbol => {
                    // Extract just symbol info
                    let symbol = result
                        .get("symbol")
                        .cloned()
                        .unwrap_or(serde_json::json!(null));
                    let output = serde_json::to_string_pretty(&symbol)
                        .map_err(|e| TugError::internal(e.to_string()))?;
                    println!("{}", output);
                }
            }

            Ok(())
        }
        AnalyzePythonCommand::RenameParam {
            at,
            to,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let session = open_session(global)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run impact analysis (read-only) with combined filter
            let json_result = analyze_rename_param(&session, &at, &to, &mut combined_filter)?;

            // Output full JSON response
            println!("{}", json_result);

            Ok(())
        }
        AnalyzePythonCommand::ExtractVariable {
            at,
            name,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let session = open_session(global)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run extract-variable analysis (read-only)
            let json_result = cli::analyze_extract_variable(
                &session,
                &at,
                name.as_deref(),
                &mut combined_filter,
            )?;

            // Output full JSON response
            println!("{}", json_result);

            Ok(())
        }
        AnalyzePythonCommand::ExtractConstant {
            at,
            name,
            filter_opts,
            filter,
        } => {
            // Validate filter options
            validate_filter_options(&filter_opts)?;

            // Handle --filter-list mode (outputs JSON and returns early)
            if handle_filter_list(global, &filter_opts, &filter)? {
                return Ok(());
            }

            let session = open_session(global)?;

            // Build CombinedFilter from all filter sources
            let mut combined_filter =
                build_combined_filter(&filter_opts, &filter, session.workspace_root())?;

            // Run extract-constant analysis (read-only)
            let json_result = cli::analyze_extract_constant(
                &session,
                &at,
                name.as_deref(),
                &mut combined_filter,
            )?;

            // Output full JSON response
            println!("{}", json_result);

            Ok(())
        }
    }
}

#[cfg(not(feature = "python"))]
fn execute_analyze_python(
    _global: &GlobalArgs,
    _command: AnalyzePythonCommand,
) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
}

/// Execute analyze rust command (placeholder).
fn execute_analyze_rust(
    _global: &GlobalArgs,
    _command: AnalyzeRustCommand,
) -> Result<(), TugError> {
    Err(TugError::invalid_args(
        "rust language support not yet implemented".to_string(),
    ))
}

// ============================================================================
// Utility Command Executors
// ============================================================================

/// Execute session command.
fn execute_session(global: &GlobalArgs, action: SessionAction) -> Result<(), TugError> {
    match action {
        SessionAction::Status => {
            let session = open_session(global)?;
            let status = session.status();
            let json = serde_json::to_string_pretty(&status)
                .map_err(|e| TugError::internal(e.to_string()))?;
            println!("{}", json);
            Ok(())
        }
    }
}

/// Execute clean command.
fn execute_clean(global: &GlobalArgs, _cache: bool) -> Result<(), TugError> {
    let session = open_session(global)?;

    // Clean the cache (always, since that's the only thing to clean now)
    session
        .clean_cache()
        .map_err(|e| TugError::internal(e.to_string()))?;

    // Output success response
    let response = serde_json::json!({
        "status": "success",
        "schema_version": SCHEMA_VERSION,
        "cache_cleaned": true,
    });
    println!("{}", serde_json::to_string_pretty(&response).unwrap());
    Ok(())
}

/// Execute fixture command.
///
/// Handles fixture fetch, update, list, and status subcommands.
fn execute_fixture(global: &GlobalArgs, action: FixtureAction) -> Result<(), TugError> {
    match action {
        FixtureAction::Fetch { name, force } => execute_fixture_fetch(global, name, force),
        FixtureAction::Update { name, git_ref } => execute_fixture_update(global, &name, &git_ref),
        FixtureAction::List => execute_fixture_list(global),
        FixtureAction::Status { name } => execute_fixture_status(global, name),
    }
}

/// Execute fixture fetch subcommand.
///
/// Fetches fixtures according to lock files in the fixtures/ directory.
fn execute_fixture_fetch(
    global: &GlobalArgs,
    name: Option<String>,
    force: bool,
) -> Result<(), TugError> {
    let workspace = global
        .workspace
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let results = if let Some(fixture_name) = name {
        // Fetch specific fixture
        let result = tugtool::fixture::fetch_fixture_by_name(&workspace, &fixture_name, force)
            .map_err(fixture_error_to_tug_error)?;
        vec![result]
    } else {
        // Fetch all fixtures
        tugtool::fixture::fetch_all_fixtures(&workspace, force)
            .map_err(fixture_error_to_tug_error)?
    };

    // Convert to response format
    let fixture_results: Vec<FixtureFetchResult> = results
        .into_iter()
        .map(|r| {
            // Make path relative to workspace
            let relative_path = r
                .path
                .strip_prefix(&workspace)
                .unwrap_or(&r.path)
                .to_string_lossy()
                .to_string();

            FixtureFetchResult::new(
                r.name,
                r.action.to_string(),
                relative_path,
                r.repository,
                r.git_ref,
                r.sha,
            )
        })
        .collect();

    let response = FixtureFetchResponse::new(fixture_results);
    emit_response(&response, &mut io::stdout()).map_err(|e| TugError::internal(e.to_string()))?;
    let _ = io::stdout().flush();

    Ok(())
}

/// Execute fixture update subcommand.
///
/// Updates a fixture lock file to a new ref.
fn execute_fixture_update(global: &GlobalArgs, name: &str, git_ref: &str) -> Result<(), TugError> {
    let workspace_root = global
        .workspace
        .clone()
        .unwrap_or_else(|| std::env::current_dir().expect("current directory"));

    // Perform the update
    let result = tugtool::fixture::update_fixture_lock(&workspace_root, name, git_ref)
        .map_err(fixture_error_to_tug_error)?;

    // Convert lock_file path to relative path string
    let lock_file_relative = result
        .lock_file
        .strip_prefix(&workspace_root)
        .unwrap_or(&result.lock_file)
        .to_string_lossy()
        .to_string();

    // Build response
    let fixture_result = FixtureUpdateResult::new(
        result.name,
        result.previous_ref,
        result.previous_sha,
        result.new_ref,
        result.new_sha,
        lock_file_relative,
    );

    let response = FixtureUpdateResponse::new(fixture_result, result.warning);

    emit_response(&response, &mut io::stdout()).map_err(|e| TugError::internal(e.to_string()))?;
    let _ = io::stdout().flush();

    Ok(())
}

/// Execute fixture list subcommand.
///
/// Lists all fixtures defined by lock files in the fixtures/ directory.
fn execute_fixture_list(global: &GlobalArgs) -> Result<(), TugError> {
    let workspace = global
        .workspace
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    // Discover and read all lock files
    let lock_files = tugtool::fixture::discover_lock_files(&workspace)
        .map_err(|e| TugError::internal(e.to_string()))?;

    let mut fixtures = Vec::with_capacity(lock_files.len());

    for lock_path in lock_files {
        let info = tugtool::fixture::read_lock_file(&lock_path)
            .map_err(|e| TugError::internal(e.to_string()))?;

        // Make lock_file path relative to workspace
        let lock_file_relative = lock_path
            .strip_prefix(&workspace)
            .unwrap_or(&lock_path)
            .to_string_lossy()
            .to_string();

        fixtures.push(FixtureListItem::new(
            info.name,
            info.repository,
            info.git_ref,
            info.sha,
            lock_file_relative,
        ));
    }

    let response = FixtureListResponse::new(fixtures);
    emit_response(&response, &mut io::stdout()).map_err(|e| TugError::internal(e.to_string()))?;
    let _ = io::stdout().flush();

    Ok(())
}

/// Execute fixture status subcommand.
///
/// Shows the fetch state of fixtures on the filesystem.
fn execute_fixture_status(global: &GlobalArgs, name: Option<String>) -> Result<(), TugError> {
    let workspace = global
        .workspace
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let results = if let Some(fixture_name) = name {
        // Get state of specific fixture
        let (info, state) = tugtool::fixture::get_fixture_state_by_name(&workspace, &fixture_name)
            .map_err(fixture_error_to_tug_error)?;
        vec![(info, state)]
    } else {
        // Get states of all fixtures
        tugtool::fixture::get_all_fixture_states(&workspace)
            .map_err(|e| TugError::internal(e.to_string()))?
    };

    // Convert to response format
    let fixtures: Vec<FixtureStatusItem> = results
        .into_iter()
        .map(|(info, state_info)| {
            let path = tugtool::fixture::fixture_path(&workspace, &info.name);
            let relative_path = path
                .strip_prefix(&workspace)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();

            FixtureStatusItem::new(
                info.name,
                state_info.state.to_string(),
                relative_path,
                info.repository,
                info.git_ref,
                info.sha,
                state_info.actual_sha,
                state_info.error,
            )
        })
        .collect();

    let response = FixtureStatusResponse::new(fixtures);
    emit_response(&response, &mut io::stdout()).map_err(|e| TugError::internal(e.to_string()))?;
    let _ = io::stdout().flush();

    Ok(())
}

/// Execute doctor command.
///
/// Runs environment diagnostics:
/// 1. workspace_root: Verifies workspace root detection
/// 2. python_files: Counts Python files in workspace
fn execute_doctor(global: &GlobalArgs) -> Result<(), TugError> {
    let mut checks = Vec::new();

    // Determine workspace root
    let workspace = global
        .workspace
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    // Check 1: workspace_root
    // Workspace root detection order:
    // 1. Cargo workspace root (Cargo.toml with [workspace])
    // 2. Git repository root (.git directory)
    // 3. Current working directory (fallback)
    let (root_path, root_method) = detect_workspace_root(&workspace);
    checks.push(CheckResult::passed(
        "workspace_root",
        format!("Found {} at {}", root_method, root_path.display()),
    ));

    // Check 2: python_files
    // Count Python files in the workspace
    let python_count = count_python_files(&root_path);
    if python_count > 0 {
        checks.push(CheckResult::passed(
            "python_files",
            format!("Found {} Python files", python_count),
        ));
    } else {
        checks.push(CheckResult::warning(
            "python_files",
            "Found 0 Python files".to_string(),
        ));
    }

    // Build and emit response
    let response = DoctorResponse::new(checks);
    emit_response(&response, &mut io::stdout()).map_err(|e| TugError::internal(e.to_string()))?;
    let _ = io::stdout().flush();

    Ok(())
}

/// Detect workspace root using multiple strategies.
///
/// Returns (path, detection_method) where detection_method is one of:
/// - "Cargo workspace root"
/// - "git root"
/// - "current directory"
fn detect_workspace_root(start_path: &std::path::Path) -> (PathBuf, &'static str) {
    // Canonicalize the start path
    let start = start_path
        .canonicalize()
        .unwrap_or_else(|_| start_path.to_path_buf());

    // 1. Check for Cargo workspace root
    if let Some(cargo_root) = find_cargo_workspace_root(&start) {
        return (cargo_root, "Cargo workspace root");
    }

    // 2. Check for git root
    if let Some(git_root) = find_git_root(&start) {
        return (git_root, "git root");
    }

    // 3. Fall back to current directory
    (start, "current directory")
}

/// Find Cargo workspace root by walking up from the given path.
fn find_cargo_workspace_root(start: &std::path::Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        let cargo_toml = current.join("Cargo.toml");
        if cargo_toml.exists() {
            // Check if this Cargo.toml has a [workspace] section
            if let Ok(content) = std::fs::read_to_string(&cargo_toml) {
                if content.contains("[workspace]") {
                    return Some(current);
                }
            }
        }
        if !current.pop() {
            break;
        }
    }
    None
}

/// Find git root by walking up from the given path.
fn find_git_root(start: &std::path::Path) -> Option<PathBuf> {
    let mut current = start.to_path_buf();
    loop {
        if current.join(".git").exists() {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

/// Count Python files in the workspace.
fn count_python_files(workspace: &std::path::Path) -> usize {
    use std::fs;

    fn count_recursive(dir: &std::path::Path) -> usize {
        let mut count = 0;
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                // Skip hidden directories and common non-source directories
                if file_name.starts_with('.')
                    || file_name == "__pycache__"
                    || file_name == "node_modules"
                    || file_name == "target"
                    || file_name == "venv"
                    || file_name == ".venv"
                {
                    continue;
                }

                if path.is_dir() {
                    count += count_recursive(&path);
                } else if path.extension().is_some_and(|ext| ext == "py") {
                    count += 1;
                }
            }
        }
        count
    }

    count_recursive(workspace)
}

/// Find Python interpreter in PATH (for verification purposes).
#[cfg(feature = "python")]
fn find_python_in_path() -> Option<String> {
    for name in &["python3", "python"] {
        if let Ok(output) = std::process::Command::new("which").arg(name).output() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse a filter file and return its contents as a string.
///
/// Reads the file at the given path and validates it exists.
fn parse_filter_file(path: &Path) -> Result<String, TugError> {
    std::fs::read_to_string(path).map_err(|e| {
        TugError::invalid_args(format!(
            "failed to read filter file '{}': {}",
            path.display(),
            e
        ))
    })
}

/// Validate filter options for consistency.
///
/// Enforces:
/// - `--filter-file` requires `--filter-file-format`
fn validate_filter_options(filter_opts: &FilterOptions) -> Result<(), TugError> {
    // Validate: --filter-file requires --filter-file-format
    if filter_opts.filter_file.is_some() && filter_opts.filter_file_format.is_none() {
        return Err(TugError::invalid_args(
            "--filter-file requires --filter-file-format (json, glob, or expr)".to_string(),
        ));
    }

    // Validate: --filter-file-format without --filter-file is useless but not an error
    // (clap allows it, we just ignore it)

    Ok(())
}

/// Build a CombinedFilter from FilterOptions and glob patterns.
///
/// Combines all filter sources:
/// - Default `lang:python` expression (always added for Python operations)
/// - Glob patterns from `-- <patterns...>`
/// - Expression filters from `--filter`
/// - JSON filter from `--filter-json`
/// - Filter file content from `--filter-file` + `--filter-file-format`
///
/// All sources are combined with logical AND per [D09].
///
/// The `lang:python` expression ensures only Python files (.py, .pyi) are
/// collected. This makes the `lang` predicate meaningful rather than cosmetic.
#[cfg(feature = "python")]
fn build_combined_filter(
    filter_opts: &FilterOptions,
    glob_patterns: &[String],
    workspace_root: &Path,
) -> Result<CombinedFilter, TugError> {
    const DEFAULT_FILTER_CONTENT_MAX_BYTES: u64 = 5 * 1024 * 1024;
    let content_max_bytes = if filter_opts.filter_content {
        filter_opts
            .filter_content_max_bytes
            .or(Some(DEFAULT_FILTER_CONTENT_MAX_BYTES))
    } else {
        filter_opts.filter_content_max_bytes
    };

    let mut builder = CombinedFilter::builder()
        .with_glob_patterns(glob_patterns)
        .map_err(|e| TugError::invalid_args(e.to_string()))?
        // Add default lang:python filter - the filter is the single source of truth
        // for file collection, not hardcoded extension checks
        .with_expression("lang:python")
        .map_err(|e| TugError::invalid_args(e.to_string()))?
        .with_content_enabled(filter_opts.filter_content)
        .with_content_max_bytes(content_max_bytes)
        .with_workspace_root(workspace_root);

    // Add expression filters from --filter
    for expr in &filter_opts.filter_expr {
        builder = builder
            .with_expression(expr)
            .map_err(|e| TugError::invalid_args(e.to_string()))?;
    }

    // Add JSON filter from --filter-json
    if let Some(ref json) = filter_opts.filter_json {
        builder = builder
            .with_json(json)
            .map_err(|e| TugError::invalid_args(e.to_string()))?;
    }

    // Add filter file content based on --filter-file-format
    if let (Some(ref path), Some(ref format)) =
        (&filter_opts.filter_file, &filter_opts.filter_file_format)
    {
        let content = parse_filter_file(path)?;
        match format.as_str() {
            "json" => {
                builder = builder
                    .with_json(&content)
                    .map_err(|e| TugError::invalid_args(e.to_string()))?;
            }
            "glob" => {
                // Parse as newline-separated glob patterns
                let patterns: Vec<String> = content
                    .lines()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty() && !s.starts_with('#'))
                    .map(String::from)
                    .collect();
                builder = builder
                    .with_glob_patterns(&patterns)
                    .map_err(|e| TugError::invalid_args(e.to_string()))?;
            }
            "expr" => {
                // Parse as newline-separated expression filters
                for line in content.lines() {
                    let line = line.trim();
                    if !line.is_empty() && !line.starts_with('#') {
                        builder = builder
                            .with_expression(line)
                            .map_err(|e| TugError::invalid_args(e.to_string()))?;
                    }
                }
            }
            _ => {
                return Err(TugError::invalid_args(format!(
                    "unknown filter file format '{}', expected: json, glob, or expr",
                    format
                )));
            }
        }
    }

    builder
        .build()
        .map_err(|e| TugError::invalid_args(e.to_string()))
}

/// Handle --filter-list mode if enabled.
///
/// If --filter-list is set, builds a CombinedFilter from all filter sources,
/// collects matching Python files, outputs JSON, and returns Ok(true).
/// If --filter-list is not set, returns Ok(false) to continue with normal execution.
#[cfg(feature = "python")]
fn handle_filter_list(
    global: &GlobalArgs,
    filter_opts: &FilterOptions,
    glob_patterns: &[String],
) -> Result<bool, TugError> {
    if !filter_opts.filter_list {
        return Ok(false);
    }

    let workspace = global
        .workspace
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    // Build CombinedFilter from all filter sources (same as apply/emit/analyze)
    let mut combined_filter = build_combined_filter(filter_opts, glob_patterns, &workspace)?;

    // Collect matching Python files
    let mut matched_files = Vec::new();
    collect_python_files_for_filter_list(&workspace, &mut combined_filter, &mut matched_files)?;

    // Sort files for deterministic output
    matched_files.sort();

    // Build filter summary
    let json_filter_value = filter_opts
        .filter_json
        .as_ref()
        .and_then(|s| serde_json::from_str(s).ok());

    let filter_summary = FilterSummary::new(
        glob_patterns.to_vec(),
        filter_opts.filter_expr.clone(),
        json_filter_value,
        filter_opts.filter_content,
    );

    // Build and emit response
    let response = FilterListResponse::new(matched_files, filter_summary);
    emit_response(&response, &mut std::io::stdout())
        .map_err(|e| TugError::internal(e.to_string()))?;
    let _ = std::io::stdout().flush();

    Ok(true)
}

/// Collect Python files matching the combined filter.
#[cfg(feature = "python")]
fn collect_python_files_for_filter_list(
    workspace: &Path,
    filter: &mut CombinedFilter,
    files: &mut Vec<String>,
) -> Result<(), TugError> {
    use std::fs;

    fn walk_dir(
        dir: &Path,
        workspace: &Path,
        filter: &mut CombinedFilter,
        files: &mut Vec<String>,
    ) -> Result<(), TugError> {
        let entries = fs::read_dir(dir).map_err(|e| {
            TugError::internal(format!(
                "failed to read directory '{}': {}",
                dir.display(),
                e
            ))
        })?;

        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            // Skip common non-source directories (default exclusions)
            if file_name == ".git"
                || file_name == "__pycache__"
                || file_name == "node_modules"
                || file_name == "target"
                || file_name == "venv"
                || file_name == ".venv"
            {
                continue;
            }

            if path.is_dir() {
                walk_dir(&path, workspace, filter, files)?;
            } else {
                // Get relative path from workspace (filters use relative paths)
                let relative_path = path.strip_prefix(workspace).unwrap_or(&path);

                // The filter is the single source of truth for file selection
                // (lang:python is added by build_combined_filter)
                if filter
                    .matches(relative_path)
                    .map_err(|e| TugError::internal(e.to_string()))?
                {
                    files.push(relative_path.to_string_lossy().to_string());
                }
            }
        }

        Ok(())
    }

    walk_dir(workspace, workspace, filter, files)
}

/// Open a session with the given global arguments.
fn open_session(global: &GlobalArgs) -> Result<Session, TugError> {
    let workspace = global
        .workspace
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let mut options = SessionOptions::default();

    if let Some(ref dir) = global.session_dir {
        options = options.with_session_dir(dir);
    }

    if let Some(ref name) = global.session_name {
        options = options.with_session_name(name);
    }

    if global.fresh {
        options.fresh = true;
    }

    Session::open(&workspace, options).map_err(TugError::from)
}

/// Resolve a toolchain path for the given language.
///
/// Resolution order:
/// 1. Check explicit overrides (--toolchain flag) - used directly, not cached
/// 2. Check session cache - if cached path exists and is valid
/// 3. Auto-resolve - language-specific resolution, result is cached
///
/// Returns the resolved toolchain path.
#[cfg(feature = "python")]
fn resolve_toolchain(
    session: &mut Session,
    lang: &str,
    overrides: &[(String, PathBuf)],
) -> Result<PathBuf, TugError> {
    // 1. Check explicit overrides (--toolchain flag)
    if let Some((_, path)) = overrides.iter().find(|(l, _)| l == lang) {
        return Ok(path.clone());
    }

    // 2. Check session cache
    if let Some(cached_path) = session.config().toolchains.get(lang) {
        if cached_path.exists() {
            return Ok(cached_path.clone());
        }
        // Cached path is invalid, will re-resolve below
    }

    // 3. Auto-resolve based on language
    #[cfg(feature = "python")]
    let resolved_path = match lang {
        "python" => {
            // Find Python in PATH (needed for verification only)
            find_python_in_path().map(PathBuf::from).ok_or_else(|| {
                TugError::internal(
                    "Could not find Python interpreter in PATH. Python is needed for verification.",
                )
            })?
        }
        "rust" => {
            // Future: find rust-analyzer in PATH
            return Err(TugError::internal(
                "Rust toolchain resolution not yet implemented",
            ));
        }
        "typescript" => {
            // Future: detect npx/yarn/pnpm
            return Err(TugError::internal(
                "TypeScript toolchain resolution not yet implemented",
            ));
        }
        _ => {
            return Err(TugError::internal(format!(
                "Unknown language '{}' for toolchain resolution",
                lang
            )));
        }
    };
    #[cfg(not(feature = "python"))]
    let resolved_path = match lang {
        _ => {
            return Err(TugError::internal(format!(
                "Unknown language '{}' for toolchain resolution",
                lang
            )));
        }
    };

    // Cache the resolved path
    session
        .config_mut()
        .toolchains
        .insert(lang.to_string(), resolved_path.clone());

    // Save session to persist the cache
    session
        .save()
        .map_err(|e| TugError::internal(format!("Failed to save session: {}", e)))?;

    Ok(resolved_path)
}

/// Convert a FixtureError to a TugError with the appropriate exit code.
///
/// Maps fixture error kinds to TugError variants:
/// - `NotFound` -> `InvalidArguments` (exit code 2)
/// - `RefNotFound` -> `FileNotFound` (exit code 3, resolution error)
/// - `Internal` -> `InternalError` (exit code 10)
fn fixture_error_to_tug_error(e: tugtool::fixture::FixtureError) -> TugError {
    use tugtool::fixture::FixtureErrorKind;

    match e.kind {
        FixtureErrorKind::NotFound => TugError::invalid_args(e.to_string()),
        FixtureErrorKind::RefNotFound => TugError::file_not_found(e.to_string()),
        FixtureErrorKind::Internal => TugError::internal(e.to_string()),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod cli_parsing {
        use super::*;

        // ====================================================================
        // New CLI structure tests (Phase 12)
        // ====================================================================

        #[test]
        fn test_apply_python_rename_no_filter() {
            let args = [
                "tug",
                "apply",
                "python",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { at, to, filter, .. },
                        },
                } => {
                    assert_eq!(at, "src/main.py:10:5");
                    assert_eq!(to, "new_name");
                    assert!(filter.is_empty());
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_apply_python_rename_with_filter() {
            let args = [
                "tug",
                "apply",
                "python",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--",
                "src/**",
                "!tests/**",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { filter, .. },
                        },
                } => {
                    assert_eq!(filter, vec!["src/**", "!tests/**"]);
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_apply_python_rename_verify_modes() {
            // Default is syntax
            let args = [
                "tug", "apply", "python", "rename", "--at", "x:1:1", "--to", "y",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { verify, .. },
                        },
                } => {
                    assert!(matches!(verify, VerifyMode::Syntax));
                }
                _ => panic!("expected Apply Python Rename"),
            }

            // --no-verify
            let args = [
                "tug",
                "apply",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--no-verify",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { no_verify, .. },
                        },
                } => {
                    assert!(no_verify);
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_emit_python_rename() {
            let args = [
                "tug", "emit", "python", "rename", "--at", "x:1:1", "--to", "y",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Emit {
                    language:
                        EmitLanguage::Python {
                            command: EmitPythonCommand::Rename { at, to, json, .. },
                        },
                } => {
                    assert_eq!(at, "x:1:1");
                    assert_eq!(to, "y");
                    assert!(!json);
                }
                _ => panic!("expected Emit Python Rename"),
            }
        }

        #[test]
        fn test_emit_python_rename_json() {
            let args = [
                "tug", "emit", "python", "rename", "--at", "x:1:1", "--to", "y", "--json",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Emit {
                    language:
                        EmitLanguage::Python {
                            command: EmitPythonCommand::Rename { json, .. },
                        },
                } => {
                    assert!(json);
                }
                _ => panic!("expected Emit Python Rename"),
            }
        }

        #[test]
        fn test_analyze_python_rename() {
            let args = [
                "tug", "analyze", "python", "rename", "--at", "x:1:1", "--to", "y",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Analyze {
                    language:
                        AnalyzeLanguage::Python {
                            command: AnalyzePythonCommand::Rename { at, to, output, .. },
                        },
                } => {
                    assert_eq!(at, "x:1:1");
                    assert_eq!(to, "y");
                    assert!(matches!(output, AnalyzeOutput::Impact));
                }
                _ => panic!("expected Analyze Python Rename"),
            }
        }

        #[test]
        fn test_analyze_python_rename_output_references() {
            let args = [
                "tug",
                "analyze",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--output",
                "references",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Analyze {
                    language:
                        AnalyzeLanguage::Python {
                            command: AnalyzePythonCommand::Rename { output, .. },
                        },
                } => {
                    assert!(matches!(output, AnalyzeOutput::References));
                }
                _ => panic!("expected Analyze Python Rename"),
            }
        }

        #[test]
        fn test_analyze_python_rename_output_symbol() {
            let args = [
                "tug", "analyze", "python", "rename", "--at", "x:1:1", "--to", "y", "--output",
                "symbol",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Analyze {
                    language:
                        AnalyzeLanguage::Python {
                            command: AnalyzePythonCommand::Rename { output, .. },
                        },
                } => {
                    assert!(matches!(output, AnalyzeOutput::Symbol));
                }
                _ => panic!("expected Analyze Python Rename"),
            }
        }

        #[test]
        fn test_rust_language_parses() {
            // Verify Rust language parses (even though it errors at execution)
            let args = [
                "tug", "apply", "rust", "rename", "--at", "x:1:1", "--to", "y",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language: ApplyLanguage::Rust { .. },
                } => {}
                _ => panic!("expected Apply Rust"),
            }
        }

        // ====================================================================
        // Filter option tests (Phase 12.7)
        // ====================================================================

        #[test]
        fn test_filter_expr_single() {
            let args = [
                "tug", "apply", "python", "rename", "--at", "x:1:1", "--to", "y", "--filter",
                "ext:py",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { filter_opts, .. },
                        },
                } => {
                    assert_eq!(filter_opts.filter_expr, vec!["ext:py"]);
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_filter_expr_multiple() {
            let args = [
                "tug",
                "apply",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--filter",
                "ext:py",
                "--filter",
                "path:src/**",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { filter_opts, .. },
                        },
                } => {
                    assert_eq!(filter_opts.filter_expr, vec!["ext:py", "path:src/**"]);
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_filter_json() {
            let args = [
                "tug",
                "emit",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--filter-json",
                r#"{"predicates":[{"key":"ext","op":"eq","value":"py"}]}"#,
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Emit {
                    language:
                        EmitLanguage::Python {
                            command: EmitPythonCommand::Rename { filter_opts, .. },
                        },
                } => {
                    assert!(filter_opts.filter_json.is_some());
                    assert!(filter_opts.filter_json.unwrap().contains("predicates"));
                }
                _ => panic!("expected Emit Python Rename"),
            }
        }

        #[test]
        fn test_filter_file() {
            let args = [
                "tug",
                "analyze",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--filter-file",
                "filters.json",
                "--filter-file-format",
                "json",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Analyze {
                    language:
                        AnalyzeLanguage::Python {
                            command: AnalyzePythonCommand::Rename { filter_opts, .. },
                        },
                } => {
                    assert_eq!(filter_opts.filter_file, Some(PathBuf::from("filters.json")));
                    assert_eq!(filter_opts.filter_file_format, Some("json".to_string()));
                }
                _ => panic!("expected Analyze Python Rename"),
            }
        }

        #[test]
        fn test_filter_content_flag() {
            let args = [
                "tug",
                "apply",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--filter-content",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { filter_opts, .. },
                        },
                } => {
                    assert!(filter_opts.filter_content);
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_filter_content_max_bytes() {
            let args = [
                "tug",
                "apply",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--filter-content-max-bytes",
                "1048576",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command: ApplyPythonCommand::Rename { filter_opts, .. },
                        },
                } => {
                    assert_eq!(filter_opts.filter_content_max_bytes, Some(1048576));
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_filter_list_flag() {
            let args = [
                "tug",
                "emit",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--filter-list",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Emit {
                    language:
                        EmitLanguage::Python {
                            command: EmitPythonCommand::Rename { filter_opts, .. },
                        },
                } => {
                    assert!(filter_opts.filter_list);
                }
                _ => panic!("expected Emit Python Rename"),
            }
        }

        #[test]
        fn test_filter_combined_with_glob_patterns() {
            let args = [
                "tug",
                "apply",
                "python",
                "rename",
                "--at",
                "x:1:1",
                "--to",
                "y",
                "--filter",
                "ext:py",
                "--filter-content",
                "--",
                "src/**",
                "!tests/**",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Apply {
                    language:
                        ApplyLanguage::Python {
                            command:
                                ApplyPythonCommand::Rename {
                                    filter_opts,
                                    filter,
                                    ..
                                },
                        },
                } => {
                    assert_eq!(filter_opts.filter_expr, vec!["ext:py"]);
                    assert!(filter_opts.filter_content);
                    assert_eq!(filter, vec!["src/**", "!tests/**"]);
                }
                _ => panic!("expected Apply Python Rename"),
            }
        }

        #[test]
        fn test_validate_filter_options_missing_format() {
            let filter_opts = FilterOptions {
                filter_file: Some(PathBuf::from("filters.json")),
                filter_file_format: None,
                ..Default::default()
            };
            let result = validate_filter_options(&filter_opts);
            assert!(result.is_err());
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("--filter-file requires --filter-file-format"));
        }

        #[test]
        fn test_validate_filter_options_valid() {
            let filter_opts = FilterOptions {
                filter_file: Some(PathBuf::from("filters.json")),
                filter_file_format: Some("json".to_string()),
                ..Default::default()
            };
            let result = validate_filter_options(&filter_opts);
            assert!(result.is_ok());
        }

        // ====================================================================
        // Filter list tests (Phase 12.7)
        // ====================================================================

        #[test]
        fn test_filter_list_response_serialization() {
            let filter_summary = FilterSummary::new(
                vec!["src/**/*.py".to_string()],
                vec!["ext:py".to_string()],
                None,
                false,
            );
            let response = FilterListResponse::new(
                vec!["src/main.py".to_string(), "src/lib.py".to_string()],
                filter_summary,
            );

            let json = serde_json::to_string(&response).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["status"], "ok");
            assert_eq!(parsed["count"], 2);
            assert!(parsed["files"].is_array());
            assert_eq!(parsed["files"][0], "src/main.py");
            assert_eq!(parsed["files"][1], "src/lib.py");
            assert!(parsed["filter_summary"].is_object());
        }

        #[test]
        fn test_filter_list_count_matches_files() {
            let filter_summary = FilterSummary::new(vec![], vec![], None, false);
            let files = vec!["a.py".to_string(), "b.py".to_string(), "c.py".to_string()];
            let response = FilterListResponse::new(files, filter_summary);

            assert_eq!(response.count, 3);
            assert_eq!(response.files.len(), 3);
        }

        #[test]
        fn test_filter_summary_with_json_filter() {
            let json_filter = serde_json::json!({
                "predicates": [{"key": "ext", "op": "eq", "value": "py"}]
            });
            let filter_summary =
                FilterSummary::new(vec![], vec![], Some(json_filter.clone()), true);

            let json = serde_json::to_string(&filter_summary).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["content_enabled"], true);
            assert!(parsed["json_filter"].is_object());
        }

        #[test]
        fn test_filter_summary_without_json_filter() {
            let filter_summary = FilterSummary::new(
                vec!["src/**".to_string()],
                vec!["ext:py".to_string(), "size<100k".to_string()],
                None,
                false,
            );

            let json = serde_json::to_string(&filter_summary).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            // json_filter should be absent (not null) when None
            assert!(!json.contains("json_filter"));
            assert_eq!(parsed["glob_patterns"].as_array().unwrap().len(), 1);
            assert_eq!(parsed["expressions"].as_array().unwrap().len(), 2);
        }

        // ====================================================================
        // Utility command tests (unchanged from Phase 10)
        // ====================================================================

        #[test]
        fn parse_session_status() {
            let args = ["tug", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(
                cli.command,
                TopLevelCommand::Session {
                    action: SessionAction::Status
                }
            ));
        }

        #[test]
        fn parse_clean_cache() {
            let args = ["tug", "clean", "--cache"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Clean { cache } => {
                    assert!(cache);
                }
                _ => panic!("expected Clean"),
            }
        }

        #[test]
        fn parse_doctor() {
            let args = ["tug", "doctor"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(cli.command, TopLevelCommand::Doctor));
        }

        #[test]
        fn parse_fixture_fetch() {
            let args = ["tug", "fixture", "fetch"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Fixture {
                    action: FixtureAction::Fetch { name, force },
                } => {
                    assert!(name.is_none());
                    assert!(!force);
                }
                _ => panic!("expected Fixture Fetch"),
            }
        }

        #[test]
        fn parse_fixture_fetch_with_name() {
            let args = ["tug", "fixture", "fetch", "temporale"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Fixture {
                    action: FixtureAction::Fetch { name, force },
                } => {
                    assert_eq!(name, Some("temporale".to_string()));
                    assert!(!force);
                }
                _ => panic!("expected Fixture Fetch"),
            }
        }

        #[test]
        fn parse_fixture_fetch_force() {
            let args = ["tug", "fixture", "fetch", "--force"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Fixture {
                    action: FixtureAction::Fetch { name, force },
                } => {
                    assert!(name.is_none());
                    assert!(force);
                }
                _ => panic!("expected Fixture Fetch"),
            }
        }

        #[test]
        fn parse_fixture_fetch_with_name_and_force() {
            let args = ["tug", "fixture", "fetch", "temporale", "--force"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Fixture {
                    action: FixtureAction::Fetch { name, force },
                } => {
                    assert_eq!(name, Some("temporale".to_string()));
                    assert!(force);
                }
                _ => panic!("expected Fixture Fetch"),
            }
        }

        #[test]
        fn parse_fixture_update() {
            let args = ["tug", "fixture", "update", "temporale", "--ref", "v0.2.0"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Fixture {
                    action: FixtureAction::Update { name, git_ref },
                } => {
                    assert_eq!(name, "temporale");
                    assert_eq!(git_ref, "v0.2.0");
                }
                _ => panic!("expected Fixture Update"),
            }
        }

        #[test]
        fn parse_fixture_list() {
            let args = ["tug", "fixture", "list"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(
                cli.command,
                TopLevelCommand::Fixture {
                    action: FixtureAction::List
                }
            ));
        }

        #[test]
        fn parse_fixture_status() {
            let args = ["tug", "fixture", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Fixture {
                    action: FixtureAction::Status { name },
                } => {
                    assert!(name.is_none());
                }
                _ => panic!("expected Fixture Status"),
            }
        }

        #[test]
        fn parse_fixture_status_with_name() {
            let args = ["tug", "fixture", "status", "temporale"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                TopLevelCommand::Fixture {
                    action: FixtureAction::Status { name },
                } => {
                    assert_eq!(name, Some("temporale".to_string()));
                }
                _ => panic!("expected Fixture Status"),
            }
        }

        // ====================================================================
        // Old command removal tests
        // ====================================================================

        #[test]
        fn test_old_rename_syntax_fails() {
            // Old syntax: tug rename --at ... --to ...
            let args = ["tug", "rename", "--at", "x:1:1", "--to", "y"];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "old 'tug rename' syntax should fail");
        }

        #[test]
        fn test_old_analyze_syntax_fails() {
            // Old syntax: tug analyze rename --at ... --to ...
            // Now analyze requires a language: tug analyze python rename ...
            let args = ["tug", "analyze", "rename", "--at", "x:1:1", "--to", "y"];
            let result = Cli::try_parse_from(args);
            assert!(
                result.is_err(),
                "old 'tug analyze rename' syntax should fail"
            );
        }

        #[test]
        fn test_snapshot_command_removed() {
            let args = ["tug", "snapshot"];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "snapshot command should be removed");
        }

        #[test]
        fn test_verify_command_removed() {
            let args = ["tug", "verify", "syntax"];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "verify command should be removed");
        }
    }

    mod global_args {
        use super::*;

        #[test]
        fn parse_workspace_flag() {
            let args = [
                "tug",
                "--workspace",
                "/home/user/project",
                "session",
                "status",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(
                cli.global.workspace,
                Some(PathBuf::from("/home/user/project"))
            );
        }

        #[test]
        fn parse_session_dir_flag() {
            let args = ["tug", "--session-dir", "/tmp/.tug", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(cli.global.session_dir, Some(PathBuf::from("/tmp/.tug")));
        }

        #[test]
        fn parse_fresh_flag() {
            let args = ["tug", "--fresh", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(cli.global.fresh);
        }

        #[test]
        fn parse_toolchain_flag() {
            let args = [
                "tug",
                "--toolchain",
                "python=/usr/bin/python3.11",
                "session",
                "status",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(cli.global.toolchain.len(), 1);
            assert_eq!(cli.global.toolchain[0].0, "python");
            assert_eq!(
                cli.global.toolchain[0].1,
                PathBuf::from("/usr/bin/python3.11")
            );
        }

        #[test]
        fn parse_multiple_toolchain_flags() {
            let args = [
                "tug",
                "--toolchain",
                "python=/usr/bin/python3",
                "--toolchain",
                "rust=/usr/bin/rust-analyzer",
                "session",
                "status",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(cli.global.toolchain.len(), 2);
        }

        #[test]
        fn parse_log_level() {
            let args = ["tug", "--log-level", "debug", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(cli.global.log_level, LogLevel::Debug));
        }
    }

    mod emit_json_envelope {
        use super::*;

        #[test]
        fn test_emit_json_envelope_serialization() {
            let envelope = EmitJsonEnvelope {
                format: "unified".to_string(),
                diff: "--- a/foo.py\n+++ b/foo.py\n".to_string(),
                files_affected: vec!["foo.py".to_string()],
                metadata: serde_json::json!({}),
            };

            let json = serde_json::to_string(&envelope).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

            assert_eq!(parsed["format"], "unified");
            assert!(parsed["diff"].as_str().unwrap().contains("foo.py"));
            assert_eq!(parsed["files_affected"][0], "foo.py");
            assert!(parsed["metadata"].is_object());
        }
    }
}
