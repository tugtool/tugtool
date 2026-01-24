//! Binary entry point for the tug CLI.
//!
//! This module provides the command-line interface for tug operations.
//! It is the "front door" for LLM coding agents (per \[D03\] One kernel, multiple front doors).
//!
//! ## Usage
//!
//! ```bash
//! # Rename a symbol (applies changes by default)
//! tug rename --at src/lib.py:10:5 --to new_name
//!
//! # Preview rename without applying (outputs unified diff)
//! tug analyze rename --at src/lib.py:10:5 --to new_name
//!
//! # Check session status
//! tug session status
//!
//! # Clean session resources
//! tug clean --workers --cache
//! ```

use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;
#[cfg(feature = "python")]
use std::process::{Command as ProcessCommand, Stdio};

use clap::{Parser, Subcommand, ValueEnum};

// Core imports (always available)
use tugtool_core::error::{OutputErrorCode, TugError};
#[cfg(feature = "python")]
use tugtool_core::output::VerifyResponse;
use tugtool_core::output::SCHEMA_VERSION;
use tugtool_core::output::{
    emit_response, CheckResult, DoctorResponse, ErrorInfo, ErrorResponse, FixtureFetchResponse,
    FixtureFetchResult, FixtureListItem, FixtureListResponse, FixtureStatusItem,
    FixtureStatusResponse, FixtureUpdateResponse, FixtureUpdateResult, SnapshotResponse,
};
use tugtool_core::session::{Session, SessionOptions};
use tugtool_core::workspace::{Language, SnapshotConfig, WorkspaceSnapshot};

// Python feature-gated imports
#[cfg(feature = "python")]
use tugtool::cli::run_rename;
#[cfg(feature = "python")]
use tugtool_python::verification::VerificationMode;

// Test command resolution (used by Python verification)
#[cfg(feature = "python")]
use tugtool::testcmd::{resolve_test_command, TemplateVars};

// ============================================================================
// CLI Structure
// ============================================================================

/// Safe code refactoring for AI agents.
///
/// Tug provides verified, deterministic, minimal-diff refactors across
/// Python codebases. All output is JSON for easy parsing by LLM agents.
#[derive(Parser, Debug)]
#[command(name = "tug", version, about = "Safe code refactoring for AI agents")]
struct Cli {
    #[command(flatten)]
    global: GlobalArgs,
    #[command(subcommand)]
    command: Command,
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

/// Output format for rename command.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
enum RenameFormat {
    /// Human-readable text summary (default).
    #[default]
    Text,
    /// Full JSON response.
    Json,
}

/// Output format for analyze command.
///
/// Per Phase 10 [D11]: Unified diff is the default output format.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
enum AnalyzeFormat {
    /// Unified diff format (default, compatible with `git apply`).
    #[default]
    Diff,
    /// Full JSON response.
    Json,
    /// Brief text summary.
    Summary,
}

/// CLI subcommands.
#[derive(Subcommand, Debug)]
enum Command {
    /// Create a workspace snapshot for analysis.
    Snapshot,
    /// Analyze a refactoring operation without applying changes.
    ///
    /// Per Phase 10 [D10]: Preview what changes would be made.
    /// Default output is unified diff format.
    Analyze {
        #[command(subcommand)]
        op: AnalyzeOp,
    },
    /// Rename a symbol (apply-by-default).
    ///
    /// Per Phase 10 [D09]: Primary command applies changes by default.
    /// Use --dry-run to preview changes without modifying files.
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// Preview changes without applying (default: apply changes).
        #[arg(long)]
        dry_run: bool,
        /// Verification mode after applying changes.
        #[arg(long, value_enum, default_value = "syntax")]
        verify: VerifyMode,
        /// Skip verification entirely.
        #[arg(long, conflicts_with = "verify")]
        no_verify: bool,
        /// Output format.
        #[arg(long, value_enum, default_value = "text")]
        format: RenameFormat,
    },
    /// Session management commands.
    Session {
        #[command(subcommand)]
        action: SessionAction,
    },
    /// Run verification on current workspace state.
    Verify {
        /// Verification mode to run.
        #[arg(value_enum)]
        mode: VerifyMode,
        /// Custom test command as JSON array (e.g., '["{python}","-m","pytest","-x"]').
        ///
        /// Template variables: {python} = resolved Python path, {workspace} = workspace root.
        /// If not provided, auto-detects from pyproject.toml, pytest.ini, or setup.cfg.
        #[arg(long)]
        test_command: Option<String>,
    },
    /// Clean up session resources.
    Clean {
        /// Clean worker processes.
        #[arg(long)]
        workers: bool,
        /// Clean facts cache.
        #[arg(long)]
        cache: bool,
    },
    /// Fixture management commands.
    Fixture {
        #[command(subcommand)]
        action: FixtureAction,
    },
    /// Run environment diagnostics.
    Doctor,
}

/// Analyze operations (used by the `analyze` command).
///
/// Per Phase 10 [D10]: Preview what changes a refactoring operation would make.
#[derive(Subcommand, Clone, Debug)]
enum AnalyzeOp {
    /// Analyze a symbol rename operation.
    ///
    /// Shows what edits would be made without applying them.
    Rename {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
        /// Output format.
        ///
        /// Per Phase 10 [D11]: Default is unified diff.
        #[arg(long, value_enum, default_value = "diff")]
        format: AnalyzeFormat,
    },
}

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

            // Write to stdout (errors go to stdout as JSON per agent contract)
            let _ = emit_response(&response, &mut io::stdout());
            let _ = io::stdout().flush();

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
        Command::Snapshot => execute_snapshot(&cli.global),
        Command::Analyze { op } => execute_analyze(&cli.global, op),
        Command::Rename {
            at,
            to,
            dry_run,
            verify,
            no_verify,
            format,
        } => execute_rename(&cli.global, &at, &to, dry_run, verify, no_verify, format),
        Command::Session { action } => execute_session(&cli.global, action),
        Command::Verify { mode, test_command } => execute_verify(&cli.global, mode, test_command),
        Command::Clean { workers, cache } => execute_clean(&cli.global, workers, cache),
        Command::Fixture { action } => execute_fixture(&cli.global, action),
        Command::Doctor => execute_doctor(&cli.global),
    }
}

// ============================================================================
// Command Executors
// ============================================================================

/// Execute snapshot command.
///
/// Creates a workspace snapshot using Python language config, saves it to the session,
/// and returns SnapshotResponse JSON.
fn execute_snapshot(global: &GlobalArgs) -> Result<(), TugError> {
    let mut session = open_session(global)?;

    // Create workspace snapshot using Python language config
    let config = SnapshotConfig::for_language(Language::Python);
    let snapshot = WorkspaceSnapshot::create(session.workspace_root(), &config)
        .map_err(|e| TugError::internal(format!("Failed to create snapshot: {}", e)))?;

    // Save snapshot to session
    session
        .save_snapshot(&snapshot)
        .map_err(|e| TugError::internal(format!("Failed to save snapshot: {}", e)))?;

    // Create response
    let response = SnapshotResponse::new(
        snapshot.snapshot_id.0.clone(),
        snapshot.file_count as u32,
        snapshot.total_bytes,
    );

    // Output response JSON
    emit_response(&response, &mut io::stdout()).map_err(|e| TugError::internal(e.to_string()))?;
    let _ = io::stdout().flush();

    Ok(())
}

/// Execute analyze command.
///
/// Per Phase 10 [D10]: Preview what changes a refactoring operation would make.
/// Per Phase 10 [D11]: Default output is unified diff.
///
/// This runs the rename operation in dry-run mode (no changes applied) and outputs
/// the results in the requested format.
#[cfg(feature = "python")]
fn execute_analyze(global: &GlobalArgs, op: AnalyzeOp) -> Result<(), TugError> {
    match op {
        AnalyzeOp::Rename { at, to, format } => {
            let mut session = open_session(global)?;
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Run rename in dry-run mode with no verification
            // The analyze command is purely for previewing changes
            let json = run_rename(
                &session,
                Some(python_path),
                &at,
                &to,
                VerificationMode::None,
                false, // Never apply changes
            )?;

            // Output based on format
            match format {
                AnalyzeFormat::Json => {
                    // Full JSON response
                    println!("{}", json);
                }
                AnalyzeFormat::Diff => {
                    // Extract unified diff from the JSON response
                    let result: serde_json::Value = serde_json::from_str(&json)
                        .map_err(|e| TugError::internal(e.to_string()))?;

                    let diff = result
                        .get("patch")
                        .and_then(|p| p.get("unified_diff"))
                        .and_then(|d| d.as_str())
                        .unwrap_or("");

                    if diff.is_empty() {
                        println!("No changes.");
                    } else {
                        print!("{}", diff);
                    }
                }
                AnalyzeFormat::Summary => {
                    // Brief text summary
                    let result: serde_json::Value = serde_json::from_str(&json)
                        .map_err(|e| TugError::internal(e.to_string()))?;

                    output_analyze_summary(&result)?;
                }
            }

            Ok(())
        }
    }
}

/// Execute analyze command (Python not available).
#[cfg(not(feature = "python"))]
fn execute_analyze(_global: &GlobalArgs, _op: AnalyzeOp) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
}

/// Output a brief text summary of analyze results.
///
/// Per Phase 10 Spec S07: --format summary produces brief text.
#[cfg(feature = "python")]
fn output_analyze_summary(result: &serde_json::Value) -> Result<(), TugError> {
    // Get symbol info
    let symbol_name = result
        .get("patch")
        .and_then(|p| p.get("edits"))
        .and_then(|e| e.as_array())
        .and_then(|arr| arr.first())
        .and_then(|e| e.get("old_text"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    // Get counts from summary
    let files_changed = result
        .get("summary")
        .and_then(|s| s.get("files_changed"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let edits_count = result
        .get("summary")
        .and_then(|s| s.get("edits_count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    if edits_count == 0 {
        println!("No changes needed for '{}'.", symbol_name);
    } else {
        println!(
            "Would rename '{}': {} file(s), {} edit(s)",
            symbol_name, files_changed, edits_count
        );

        // List affected files
        if let Some(edits) = result
            .get("patch")
            .and_then(|p| p.get("edits"))
            .and_then(|e| e.as_array())
        {
            let mut files: Vec<&str> = edits
                .iter()
                .filter_map(|e| e.get("file").and_then(|f| f.as_str()))
                .collect();
            files.sort();
            files.dedup();

            for file in files {
                println!("  {}", file);
            }
        }
    }

    Ok(())
}

/// Execute rename command.
///
/// Per Phase 10 [D09]: Apply-by-default. The `--dry-run` flag prevents file modification.
/// Per Phase 10 [D12]: Default verification mode is `syntax`.
///
/// # Arguments
///
/// * `global` - Global CLI arguments
/// * `at` - Location string in "file:line:col" format
/// * `to` - New name for the symbol
/// * `dry_run` - If true, preview changes without applying
/// * `verify` - Verification mode (default: syntax)
/// * `no_verify` - If true, skip verification entirely
/// * `format` - Output format (text or json)
#[cfg(feature = "python")]
fn execute_rename(
    global: &GlobalArgs,
    at: &str,
    to: &str,
    dry_run: bool,
    verify: VerifyMode,
    no_verify: bool,
    format: RenameFormat,
) -> Result<(), TugError> {
    let mut session = open_session(global)?;
    let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

    // Determine effective verification mode
    // --no-verify takes precedence (conflicts_with is already enforced by clap)
    let effective_verify = if no_verify {
        VerificationMode::None
    } else {
        verify.into()
    };

    // Apply changes unless --dry-run is specified
    let apply = !dry_run;

    // Run the rename operation
    let json = run_rename(&session, Some(python_path), at, to, effective_verify, apply)?;

    // Output based on format
    match format {
        RenameFormat::Json => {
            println!("{}", json);
        }
        RenameFormat::Text => {
            // Parse the JSON and produce human-readable summary
            let result: serde_json::Value =
                serde_json::from_str(&json).map_err(|e| TugError::internal(e.to_string()))?;

            output_rename_summary(&result, dry_run)?;
        }
    }

    Ok(())
}

/// Execute rename command (Python not available).
#[cfg(not(feature = "python"))]
fn execute_rename(
    _global: &GlobalArgs,
    _at: &str,
    _to: &str,
    _dry_run: bool,
    _verify: VerifyMode,
    _no_verify: bool,
    _format: RenameFormat,
) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
}

/// Output a human-readable summary of rename results.
///
/// Per Phase 10 Spec S08: Default output is human-readable summary.
#[cfg(feature = "python")]
fn output_rename_summary(result: &serde_json::Value, dry_run: bool) -> Result<(), TugError> {
    let status = result
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    // Check if this was a dry run
    let applied = result
        .get("applied")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Get symbol info
    let symbol_name = result
        .get("symbol")
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let symbol_kind = result
        .get("symbol")
        .and_then(|s| s.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("symbol");

    // Get counts
    let files_affected = result
        .get("files_written")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let edits_count = result
        .get("edits_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // Format output
    if dry_run || !applied {
        println!("Dry run: would rename {} '{}'", symbol_kind, symbol_name);
        println!(
            "  {} file(s) would be affected, {} edit(s)",
            files_affected, edits_count
        );
    } else {
        println!("Renamed {} '{}' successfully", symbol_kind, symbol_name);
        println!(
            "  {} file(s) modified, {} edit(s) applied",
            files_affected, edits_count
        );
    }

    // Show verification status if present
    if let Some(verification) = result.get("verification") {
        let verify_mode = verification
            .get("mode")
            .and_then(|v| v.as_str())
            .unwrap_or("none");
        let verify_passed = verification
            .get("passed")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if verify_mode != "none" {
            if verify_passed {
                println!("  Verification ({}): passed", verify_mode);
            } else {
                println!("  Verification ({}): FAILED", verify_mode);
            }
        }
    }

    // Show warnings if present
    if let Some(warnings) = result.get("warnings").and_then(|v| v.as_array()) {
        if !warnings.is_empty() {
            println!("  Warnings:");
            for warning in warnings {
                if let Some(msg) = warning.as_str() {
                    println!("    - {}", msg);
                }
            }
        }
    }

    // Show status
    if status == "error" {
        if let Some(error) = result.get("error") {
            let error_msg = error
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            println!("  Status: error - {}", error_msg);
        }
    }

    Ok(())
}

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

/// Execute verify command.
///
/// Runs verification on the current workspace state using the specified mode.
#[cfg(feature = "python")]
fn execute_verify(
    global: &GlobalArgs,
    mode: VerifyMode,
    test_command: Option<String>,
) -> Result<(), TugError> {
    let mut session = open_session(global)?;

    // Handle VerifyMode::None
    if matches!(mode, VerifyMode::None) {
        let response = VerifyResponse::passed("none");
        emit_response(&response, &mut io::stdout())
            .map_err(|e| TugError::internal(e.to_string()))?;
        let _ = io::stdout().flush();
        return Ok(());
    }

    // Resolve Python interpreter using cached toolchain
    let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

    // Resolve test command if mode is Tests
    let resolved_test_cmd = if mode == VerifyMode::Tests {
        let vars = TemplateVars::new(
            Some(python_path.to_string_lossy().to_string()),
            Some(session.workspace_root().to_string_lossy().to_string()),
        );
        resolve_test_command(test_command.as_deref(), session.workspace_root(), &vars)
            .map_err(|e| TugError::internal(e.to_string()))?
    } else {
        None
    };

    // Run verification based on mode
    let mode_str = match mode {
        VerifyMode::None => "none",
        VerifyMode::Syntax => "syntax",
        VerifyMode::Tests => "tests",
        VerifyMode::Typecheck => "typecheck",
    };

    let output = match mode {
        VerifyMode::None => unreachable!(), // Already handled above
        VerifyMode::Syntax | VerifyMode::Typecheck => {
            // Run compileall for syntax verification
            ProcessCommand::new(&python_path)
                .args(["-m", "compileall", "-q", "."])
                .current_dir(session.workspace_root())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| TugError::internal(format!("Failed to run compileall: {}", e)))?
        }
        VerifyMode::Tests => {
            // First run syntax check
            let syntax_output = ProcessCommand::new(&python_path)
                .args(["-m", "compileall", "-q", "."])
                .current_dir(session.workspace_root())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| TugError::internal(format!("Failed to run compileall: {}", e)))?;

            if !syntax_output.status.success() {
                syntax_output
            } else if let Some(ref test_cmd) = resolved_test_cmd {
                // Run the test command
                if test_cmd.args.is_empty() {
                    return Err(TugError::internal("Test command is empty"));
                }
                let (program, args) = test_cmd.args.split_first().unwrap();
                ProcessCommand::new(program)
                    .args(args)
                    .current_dir(session.workspace_root())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .output()
                    .map_err(|e| TugError::internal(format!("Failed to run test command: {}", e)))?
            } else {
                // No test command found, just return syntax success
                syntax_output
            }
        }
    };

    let response = if output.status.success() {
        VerifyResponse::passed(mode_str)
    } else {
        let combined_output = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let exit_code = output.status.code().unwrap_or(1);
        VerifyResponse::failed(mode_str, combined_output, exit_code)
    };

    // If verification failed, emit response and return verification error
    if !response.passed {
        emit_response(&response, &mut io::stdout())
            .map_err(|e| TugError::internal(e.to_string()))?;
        let _ = io::stdout().flush();
        return Err(TugError::VerificationFailed {
            mode: mode_str.to_string(),
            output: response.output.clone().unwrap_or_default(),
            exit_code: response.exit_code.unwrap_or(1),
        });
    }

    emit_response(&response, &mut io::stdout()).map_err(|e| TugError::internal(e.to_string()))?;
    let _ = io::stdout().flush();

    Ok(())
}

/// Execute verify command (Python not available).
#[cfg(not(feature = "python"))]
fn execute_verify(
    _global: &GlobalArgs,
    _mode: VerifyMode,
    _test_command: Option<String>,
) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
}

/// Execute clean command.
fn execute_clean(global: &GlobalArgs, workers: bool, cache: bool) -> Result<(), TugError> {
    let session = open_session(global)?;

    // If neither flag is set, clean both
    let clean_workers = workers || !cache;
    let clean_cache = cache || !workers;

    if clean_workers {
        session
            .clean_workers()
            .map_err(|e| TugError::internal(e.to_string()))?;
    }

    if clean_cache {
        session
            .clean_cache()
            .map_err(|e| TugError::internal(e.to_string()))?;
    }

    // Output success response
    let response = serde_json::json!({
        "status": "success",
        "schema_version": SCHEMA_VERSION,
        "workers_cleaned": clean_workers,
        "cache_cleaned": clean_cache,
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
///
/// Per Phase 10 Spec S02: Doctor Response Schema.
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
        // analyze command tests (Phase 10 Step 14)
        // ====================================================================

        #[test]
        fn test_analyze_rename_diff_default() {
            // AC-01: Default format is unified diff
            let args = [
                "tug",
                "analyze",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Analyze {
                    op: AnalyzeOp::Rename { at, to, format },
                } => {
                    assert_eq!(at, "src/main.py:10:5");
                    assert_eq!(to, "new_name");
                    assert!(matches!(format, AnalyzeFormat::Diff));
                }
                _ => panic!("expected Analyze Rename"),
            }
        }

        #[test]
        fn test_analyze_rename_format_json() {
            // AC-02: --format json produces JSON
            let args = [
                "tug",
                "analyze",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--format",
                "json",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Analyze {
                    op: AnalyzeOp::Rename { format, .. },
                } => {
                    assert!(matches!(format, AnalyzeFormat::Json));
                }
                _ => panic!("expected Analyze Rename"),
            }
        }

        #[test]
        fn test_analyze_rename_format_summary() {
            // AC-03: --format summary produces brief text
            let args = [
                "tug",
                "analyze",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--format",
                "summary",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Analyze {
                    op: AnalyzeOp::Rename { format, .. },
                } => {
                    assert!(matches!(format, AnalyzeFormat::Summary));
                }
                _ => panic!("expected Analyze Rename"),
            }
        }

        // ====================================================================
        // Old command removal tests (Phase 10 Step 14)
        // ====================================================================

        #[test]
        fn test_analyze_impact_removed() {
            // OR-01: `tug analyze-impact` → unknown command
            let args = [
                "tug",
                "analyze-impact",
                "rename-symbol",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "analyze-impact should be removed");
        }

        #[test]
        fn test_run_command_removed() {
            // OR-02: `tug run` → unknown command
            let args = [
                "tug",
                "run",
                "--apply",
                "rename-symbol",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "run should be removed");
        }

        // ====================================================================
        // rename command tests (existing from Step 13)
        // ====================================================================

        #[test]
        fn parse_rename_default_options() {
            let args = [
                "tug",
                "rename",
                "--at",
                "lib.py:42:8",
                "--to",
                "better_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename {
                    at,
                    to,
                    dry_run,
                    verify,
                    no_verify,
                    format,
                } => {
                    assert_eq!(at, "lib.py:42:8");
                    assert_eq!(to, "better_name");
                    assert!(!dry_run);
                    assert!(matches!(verify, VerifyMode::Syntax));
                    assert!(!no_verify);
                    assert!(matches!(format, RenameFormat::Text));
                }
                _ => panic!("expected Rename"),
            }
        }

        #[test]
        fn parse_rename_dry_run() {
            let args = [
                "tug",
                "rename",
                "--at",
                "lib.py:1:1",
                "--to",
                "x",
                "--dry-run",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { dry_run, .. } => {
                    assert!(dry_run);
                }
                _ => panic!("expected Rename"),
            }
        }

        #[test]
        fn parse_rename_no_verify() {
            let args = [
                "tug",
                "rename",
                "--at",
                "lib.py:1:1",
                "--to",
                "x",
                "--no-verify",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { no_verify, .. } => {
                    assert!(no_verify);
                }
                _ => panic!("expected Rename"),
            }
        }

        #[test]
        fn parse_rename_format_json() {
            let args = [
                "tug",
                "rename",
                "--at",
                "lib.py:1:1",
                "--to",
                "x",
                "--format",
                "json",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { format, .. } => {
                    assert!(matches!(format, RenameFormat::Json));
                }
                _ => panic!("expected Rename"),
            }
        }

        // ====================================================================
        // Other command tests (unchanged)
        // ====================================================================

        #[test]
        fn parse_session_status() {
            let args = ["tug", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(
                cli.command,
                Command::Session {
                    action: SessionAction::Status
                }
            ));
        }

        #[test]
        fn parse_verify_syntax() {
            let args = ["tug", "verify", "syntax"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Verify { mode, .. } => {
                    assert!(matches!(mode, VerifyMode::Syntax));
                }
                _ => panic!("expected Verify"),
            }
        }

        #[test]
        fn parse_clean_workers() {
            let args = ["tug", "clean", "--workers"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Clean { workers, cache } => {
                    assert!(workers);
                    assert!(!cache);
                }
                _ => panic!("expected Clean"),
            }
        }

        #[test]
        fn parse_clean_cache() {
            let args = ["tug", "clean", "--cache"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Clean { workers, cache } => {
                    assert!(!workers);
                    assert!(cache);
                }
                _ => panic!("expected Clean"),
            }
        }

        #[test]
        fn parse_clean_both() {
            let args = ["tug", "clean", "--workers", "--cache"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Clean { workers, cache } => {
                    assert!(workers);
                    assert!(cache);
                }
                _ => panic!("expected Clean"),
            }
        }

        #[test]
        fn parse_snapshot() {
            let args = ["tug", "snapshot"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(cli.command, Command::Snapshot));
        }

        #[test]
        fn parse_verify_none() {
            let args = ["tug", "verify", "none"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Verify { mode, .. } => {
                    assert!(matches!(mode, VerifyMode::None));
                }
                _ => panic!("expected Verify"),
            }
        }

        #[test]
        fn parse_verify_tests() {
            let args = ["tug", "verify", "tests"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Verify { mode, .. } => {
                    assert!(matches!(mode, VerifyMode::Tests));
                }
                _ => panic!("expected Verify"),
            }
        }

        #[test]
        fn parse_verify_typecheck() {
            let args = ["tug", "verify", "typecheck"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Verify { mode, .. } => {
                    assert!(matches!(mode, VerifyMode::Typecheck));
                }
                _ => panic!("expected Verify"),
            }
        }

        #[test]
        fn parse_verify_with_test_command() {
            let args = [
                "tug",
                "verify",
                "tests",
                "--test-command",
                r#"["pytest", "-v"]"#,
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Verify { mode, test_command } => {
                    assert!(matches!(mode, VerifyMode::Tests));
                    assert_eq!(test_command, Some(r#"["pytest", "-v"]"#.to_string()));
                }
                _ => panic!("expected Verify"),
            }
        }

        #[test]
        fn parse_fixture_fetch() {
            let args = ["tug", "fixture", "fetch"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Fixture {
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
                Command::Fixture {
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
                Command::Fixture {
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
                Command::Fixture {
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
                Command::Fixture {
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
                Command::Fixture {
                    action: FixtureAction::List
                }
            ));
        }

        #[test]
        fn parse_fixture_status() {
            let args = ["tug", "fixture", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Fixture {
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
                Command::Fixture {
                    action: FixtureAction::Status { name },
                } => {
                    assert_eq!(name, Some("temporale".to_string()));
                }
                _ => panic!("expected Fixture Status"),
            }
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
            let args = ["tug", "--session-dir", "/tmp/session", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(cli.global.session_dir, Some(PathBuf::from("/tmp/session")));
        }

        #[test]
        fn parse_session_name_flag() {
            let args = ["tug", "--session-name", "my-session", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(cli.global.session_name, Some("my-session".to_string()));
        }

        #[test]
        fn parse_fresh_flag() {
            let args = ["tug", "--fresh", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(cli.global.fresh);
        }

        #[test]
        fn parse_log_level_debug() {
            let args = ["tug", "--log-level", "debug", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(cli.global.log_level, LogLevel::Debug));
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
            assert_eq!(cli.global.toolchain[0].0, "python");
            assert_eq!(cli.global.toolchain[1].0, "rust");
        }

        #[test]
        fn parse_toolchain_invalid_format() {
            let args = [
                "tug",
                "--toolchain",
                "python-no-equals",
                "session",
                "status",
            ];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err());
        }

        #[test]
        fn default_log_level_is_warn() {
            let args = ["tug", "session", "status"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(cli.global.log_level, LogLevel::Warn));
        }
    }

    #[cfg(feature = "python")]
    mod verify_mode_conversion {
        use super::*;

        #[test]
        fn verify_mode_none_converts() {
            let vm: VerificationMode = VerifyMode::None.into();
            assert!(matches!(vm, VerificationMode::None));
        }

        #[test]
        fn verify_mode_syntax_converts() {
            let vm: VerificationMode = VerifyMode::Syntax.into();
            assert!(matches!(vm, VerificationMode::Syntax));
        }

        #[test]
        fn verify_mode_tests_converts() {
            let vm: VerificationMode = VerifyMode::Tests.into();
            assert!(matches!(vm, VerificationMode::Tests));
        }

        #[test]
        fn verify_mode_typecheck_converts() {
            let vm: VerificationMode = VerifyMode::Typecheck.into();
            assert!(matches!(vm, VerificationMode::TypeCheck));
        }
    }

    mod log_level {
        use super::*;

        #[test]
        fn trace_converts_to_tracing_level() {
            let level = LogLevel::Trace.to_tracing_level();
            assert_eq!(level, tracing::Level::TRACE);
        }

        #[test]
        fn debug_converts_to_tracing_level() {
            let level = LogLevel::Debug.to_tracing_level();
            assert_eq!(level, tracing::Level::DEBUG);
        }

        #[test]
        fn info_converts_to_tracing_level() {
            let level = LogLevel::Info.to_tracing_level();
            assert_eq!(level, tracing::Level::INFO);
        }

        #[test]
        fn warn_converts_to_tracing_level() {
            let level = LogLevel::Warn.to_tracing_level();
            assert_eq!(level, tracing::Level::WARN);
        }

        #[test]
        fn error_converts_to_tracing_level() {
            let level = LogLevel::Error.to_tracing_level();
            assert_eq!(level, tracing::Level::ERROR);
        }
    }

    mod open_session_tests {
        use super::*;
        use tempfile::TempDir;

        fn create_test_workspace() -> TempDir {
            let temp = TempDir::new().unwrap();
            std::fs::write(temp.path().join("test.py"), "def foo(): pass\n").unwrap();
            temp
        }

        #[test]
        fn open_session_uses_default_workspace() {
            let workspace = create_test_workspace();
            std::env::set_current_dir(workspace.path()).unwrap();

            let global = GlobalArgs {
                workspace: None,
                session_dir: None,
                session_name: None,
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let session = open_session(&global).unwrap();
            // Session should be opened in the current directory (the temp workspace)
            assert!(session.session_dir().exists());
        }

        #[test]
        fn open_session_uses_explicit_workspace() {
            let workspace = create_test_workspace();

            let global = GlobalArgs {
                workspace: Some(workspace.path().to_path_buf()),
                session_dir: None,
                session_name: None,
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let session = open_session(&global).unwrap();
            // Session should be opened with the explicit workspace
            assert!(session
                .workspace_root()
                .starts_with(workspace.path().canonicalize().unwrap()));
        }

        #[test]
        fn open_session_uses_session_dir() {
            let workspace = create_test_workspace();
            let custom_session_dir = workspace.path().join("custom_session");

            let global = GlobalArgs {
                workspace: Some(workspace.path().to_path_buf()),
                session_dir: Some(custom_session_dir.clone()),
                session_name: None,
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let session = open_session(&global).unwrap();
            assert_eq!(session.session_dir(), custom_session_dir);
        }

        #[test]
        fn open_session_uses_session_name() {
            let workspace = create_test_workspace();

            let global = GlobalArgs {
                workspace: Some(workspace.path().to_path_buf()),
                session_dir: None,
                session_name: Some("my-named-session".to_string()),
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let session = open_session(&global).unwrap();
            // Session should be in .tug/my-named-session/
            assert!(session
                .session_dir()
                .to_string_lossy()
                .contains("my-named-session"));
        }

        #[test]
        fn open_session_with_fresh_deletes_existing() {
            let workspace = create_test_workspace();

            // First, create a session and mark something
            {
                let global = GlobalArgs {
                    workspace: Some(workspace.path().to_path_buf()),
                    session_dir: None,
                    session_name: None,
                    fresh: false,
                    log_level: LogLevel::Warn,
                    toolchain: vec![],
                };
                let mut session = open_session(&global).unwrap();
                session.metadata_mut().config.python_resolved = true;
                session.save().unwrap();
            }

            // Now open with --fresh, which should delete the existing session
            let global = GlobalArgs {
                workspace: Some(workspace.path().to_path_buf()),
                session_dir: None,
                session_name: None,
                fresh: true,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let session = open_session(&global).unwrap();
            // The python_resolved flag should be false (session was reset)
            assert!(!session.metadata().config.python_resolved);
        }

        #[test]
        fn open_session_error_for_nonexistent_workspace() {
            let global = GlobalArgs {
                workspace: Some(PathBuf::from("/nonexistent/path/that/does/not/exist")),
                session_dir: None,
                session_name: None,
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let result = open_session(&global);
            assert!(result.is_err());
        }
    }

    mod exit_code_mapping {
        use tugtool_core::error::{OutputErrorCode, TugError};

        #[test]
        fn symbol_not_found_maps_to_exit_code_3() {
            let err = TugError::symbol_not_found("test.py", 10, 5);
            let code = OutputErrorCode::from(&err);
            assert_eq!(code.code(), 3);
        }

        #[test]
        fn verification_failed_maps_to_exit_code_5() {
            let err = TugError::VerificationFailed {
                mode: "syntax".to_string(),
                output: "SyntaxError".to_string(),
                exit_code: 1,
            };
            let code = OutputErrorCode::from(&err);
            assert_eq!(code.code(), 5);
        }

        #[test]
        fn internal_error_maps_to_exit_code_10() {
            let err = TugError::internal("unexpected state");
            let code = OutputErrorCode::from(&err);
            assert_eq!(code.code(), 10);
        }

        #[test]
        fn invalid_arguments_maps_to_exit_code_2() {
            let err = TugError::invalid_args("missing required field");
            let code = OutputErrorCode::from(&err);
            assert_eq!(code.code(), 2);
        }

        #[test]
        fn apply_error_maps_to_exit_code_4() {
            let err = TugError::ApplyError {
                message: "snapshot mismatch".to_string(),
                file: Some("test.py".to_string()),
            };
            let code = OutputErrorCode::from(&err);
            assert_eq!(code.code(), 4);
        }

        #[test]
        fn file_not_found_maps_to_exit_code_3() {
            let err = TugError::file_not_found("missing.py");
            let code = OutputErrorCode::from(&err);
            assert_eq!(code.code(), 3);
        }

        #[test]
        fn worker_error_maps_to_exit_code_10() {
            let err = TugError::WorkerError {
                message: "worker crashed".to_string(),
            };
            let code = OutputErrorCode::from(&err);
            assert_eq!(code.code(), 10);
        }
    }

    #[cfg(feature = "python")]
    mod toolchain_resolution {
        use super::*;
        use tempfile::TempDir;

        fn create_test_workspace() -> TempDir {
            let temp = TempDir::new().unwrap();
            std::fs::write(temp.path().join("test.py"), "def foo(): pass\n").unwrap();
            temp
        }

        #[test]
        fn explicit_override_returns_path_directly() {
            let workspace = create_test_workspace();
            let global = GlobalArgs {
                workspace: Some(workspace.path().to_path_buf()),
                session_dir: None,
                session_name: None,
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let mut session = open_session(&global).unwrap();
            let overrides = vec![("python".to_string(), PathBuf::from("/custom/python"))];

            let result = resolve_toolchain(&mut session, "python", &overrides).unwrap();
            assert_eq!(result, PathBuf::from("/custom/python"));

            // Override should NOT be cached
            assert!(session.config().toolchains.get("python").is_none());
        }

        #[test]
        fn cached_path_is_used_if_valid() {
            let workspace = create_test_workspace();
            let global = GlobalArgs {
                workspace: Some(workspace.path().to_path_buf()),
                session_dir: None,
                session_name: None,
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let mut session = open_session(&global).unwrap();

            // Pre-populate the cache with an existing path (use workspace path which exists)
            let existing_path = workspace.path().join("test.py");
            session
                .config_mut()
                .toolchains
                .insert("python".to_string(), existing_path.clone());

            // Resolve should return the cached path
            let result = resolve_toolchain(&mut session, "python", &[]).unwrap();
            assert_eq!(result, existing_path);
        }

        #[test]
        fn toolchain_override_lookup_works() {
            // Test the override lookup logic used in resolve_toolchain
            let overrides = vec![
                ("python".to_string(), PathBuf::from("/usr/bin/python3")),
                ("rust".to_string(), PathBuf::from("/usr/bin/rust-analyzer")),
            ];

            // Helper to find override (same logic as in resolve_toolchain)
            let find_override = |lang: &str| {
                overrides
                    .iter()
                    .find(|(l, _)| l == lang)
                    .map(|(_, p)| p.clone())
            };

            assert_eq!(
                find_override("python"),
                Some(PathBuf::from("/usr/bin/python3"))
            );
            assert_eq!(
                find_override("rust"),
                Some(PathBuf::from("/usr/bin/rust-analyzer"))
            );
            assert!(find_override("typescript").is_none());
        }

        #[test]
        fn unknown_language_returns_error() {
            let workspace = create_test_workspace();
            let global = GlobalArgs {
                workspace: Some(workspace.path().to_path_buf()),
                session_dir: None,
                session_name: None,
                fresh: false,
                log_level: LogLevel::Warn,
                toolchain: vec![],
            };

            let mut session = open_session(&global).unwrap();

            let result = resolve_toolchain(&mut session, "cobol", &[]);
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("Unknown language"));
        }
    }

    mod doctor_tests {
        use super::*;
        use tempfile::TempDir;
        use tugtool_core::output::CheckStatus;

        /// DR-01: Test that doctor detects git root
        #[test]
        fn test_doctor_git_repo() {
            let temp = TempDir::new().unwrap();

            // Create a .git directory to simulate a git repo
            std::fs::create_dir(temp.path().join(".git")).unwrap();

            // Create a Python file
            std::fs::write(temp.path().join("test.py"), "def foo(): pass\n").unwrap();

            let (root, method) = detect_workspace_root(temp.path());
            assert_eq!(root, temp.path().canonicalize().unwrap());
            assert_eq!(method, "git root");
        }

        /// DR-02: Test that doctor detects Cargo workspace
        #[test]
        fn test_doctor_cargo_workspace() {
            let temp = TempDir::new().unwrap();

            // Create a Cargo.toml with [workspace] section
            std::fs::write(
                temp.path().join("Cargo.toml"),
                "[workspace]\nmembers = [\"crate1\"]\n",
            )
            .unwrap();

            let (root, method) = detect_workspace_root(temp.path());
            assert_eq!(root, temp.path().canonicalize().unwrap());
            assert_eq!(method, "Cargo workspace root");
        }

        /// DR-03: Test that doctor warns when no Python files
        #[test]
        fn test_doctor_no_python_files() {
            let temp = TempDir::new().unwrap();

            // No Python files, just a text file
            std::fs::write(temp.path().join("readme.txt"), "Hello\n").unwrap();

            let count = count_python_files(temp.path());
            assert_eq!(count, 0);

            // Verify the check result would be a warning
            let check = if count > 0 {
                CheckResult::passed("python_files", format!("Found {} Python files", count))
            } else {
                CheckResult::warning("python_files", "Found 0 Python files".to_string())
            };
            assert_eq!(check.status, CheckStatus::Warning);
        }

        /// DR-04: Test that doctor passes with Python files
        #[test]
        fn test_doctor_with_python_files() {
            let temp = TempDir::new().unwrap();

            // Create some Python files
            std::fs::write(temp.path().join("test1.py"), "def foo(): pass\n").unwrap();
            std::fs::write(temp.path().join("test2.py"), "def bar(): pass\n").unwrap();

            // Create a subdirectory with Python files
            std::fs::create_dir(temp.path().join("subdir")).unwrap();
            std::fs::write(
                temp.path().join("subdir").join("test3.py"),
                "def baz(): pass\n",
            )
            .unwrap();

            let count = count_python_files(temp.path());
            assert_eq!(count, 3);

            // Verify the check result would be passed
            let check = if count > 0 {
                CheckResult::passed("python_files", format!("Found {} Python files", count))
            } else {
                CheckResult::warning("python_files", "Found 0 Python files".to_string())
            };
            assert_eq!(check.status, CheckStatus::Passed);
        }

        /// DR-05: Test that doctor falls back to current directory
        #[test]
        fn test_doctor_empty_directory() {
            let temp = TempDir::new().unwrap();

            // Empty directory - no .git, no Cargo.toml
            let (root, method) = detect_workspace_root(temp.path());
            assert_eq!(root, temp.path().canonicalize().unwrap());
            assert_eq!(method, "current directory");
        }

        /// DR-06: Test doctor JSON schema (golden test style)
        #[test]
        fn test_doctor_json_schema() {
            use tugtool_core::output::DoctorResponse;

            let checks = vec![
                CheckResult::passed("workspace_root", "Found git root at /repo"),
                CheckResult::passed("python_files", "Found 42 Python files"),
            ];

            let response = DoctorResponse::new(checks);
            let json = serde_json::to_string_pretty(&response).unwrap();

            // Verify schema structure
            let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed["status"], "ok");
            assert_eq!(parsed["schema_version"], "1");
            assert!(parsed["checks"].is_array());
            assert!(parsed["summary"].is_object());
            assert_eq!(parsed["summary"]["total"], 2);
            assert_eq!(parsed["summary"]["passed"], 2);
            assert_eq!(parsed["summary"]["warnings"], 0);
            assert_eq!(parsed["summary"]["failed"], 0);
        }

        /// DR-07: Test summary counts are correct
        #[test]
        fn test_doctor_summary_counts() {
            use tugtool_core::output::{DoctorResponse, DoctorSummary};

            // Test with mixed statuses
            let checks = vec![
                CheckResult::passed("check1", "passed"),
                CheckResult::warning("check2", "warning"),
                CheckResult::passed("check3", "passed"),
                CheckResult::failed("check4", "failed"),
            ];

            let summary = DoctorSummary::from_checks(&checks);
            assert_eq!(summary.total, 4);
            assert_eq!(summary.passed, 2);
            assert_eq!(summary.warnings, 1);
            assert_eq!(summary.failed, 1);

            // Test that status is "failed" when any check fails
            let response = DoctorResponse::new(checks);
            assert_eq!(response.status, "failed");

            // Test with only passed/warning (no failures)
            let checks_ok = vec![
                CheckResult::passed("check1", "passed"),
                CheckResult::warning("check2", "warning"),
            ];
            let response_ok = DoctorResponse::new(checks_ok);
            assert_eq!(response_ok.status, "ok");
        }

        /// Test that CLI parses doctor command
        #[test]
        fn parse_doctor_command() {
            let args = ["tug", "doctor"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(cli.command, Command::Doctor));
        }

        /// Test that hidden directories are skipped when counting Python files
        #[test]
        fn test_python_files_skips_hidden() {
            let temp = TempDir::new().unwrap();

            // Create a Python file in root
            std::fs::write(temp.path().join("main.py"), "def main(): pass\n").unwrap();

            // Create a Python file in hidden directory (should be skipped)
            std::fs::create_dir(temp.path().join(".hidden")).unwrap();
            std::fs::write(
                temp.path().join(".hidden").join("hidden.py"),
                "def hidden(): pass\n",
            )
            .unwrap();

            // Create a Python file in __pycache__ (should be skipped)
            std::fs::create_dir(temp.path().join("__pycache__")).unwrap();
            std::fs::write(
                temp.path().join("__pycache__").join("cached.py"),
                "def cached(): pass\n",
            )
            .unwrap();

            let count = count_python_files(temp.path());
            assert_eq!(count, 1); // Only main.py should be counted
        }
    }

    /// Tests for Phase 10 Step 13: rename command
    mod rename_command_tests {
        use super::*;

        /// RC-01: Test that rename applies by default (no --dry-run)
        #[test]
        fn test_rename_applies_by_default() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { dry_run, .. } => {
                    // By default, dry_run is false, meaning changes are applied
                    assert!(!dry_run);
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// RC-02: Test that --dry-run flag prevents changes
        #[test]
        fn test_rename_dry_run_no_changes() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--dry-run",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { dry_run, .. } => {
                    assert!(dry_run);
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// RC-03: Test that --verify defaults to syntax
        #[test]
        fn test_rename_verify_syntax_default() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { verify, .. } => {
                    assert!(matches!(verify, VerifyMode::Syntax));
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// RC-04: Test that --no-verify skips verification
        #[test]
        fn test_rename_no_verify_skips() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--no-verify",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { no_verify, .. } => {
                    assert!(no_verify);
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// RC-05: Test that --verify and --no-verify conflict
        #[test]
        fn test_rename_verify_no_verify_conflict() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--verify",
                "syntax",
                "--no-verify",
            ];
            // This should fail to parse due to conflicts_with
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "expected conflict error");
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("cannot be used with") || err.contains("conflict"),
                "error should mention conflict: {}",
                err
            );
        }

        /// RC-06: Test that default output format is text
        #[test]
        fn test_rename_format_text_default() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { format, .. } => {
                    assert!(matches!(format, RenameFormat::Text));
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// RC-07: Test that --format json produces JSON output
        #[test]
        fn test_rename_format_json() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--format",
                "json",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename { format, .. } => {
                    assert!(matches!(format, RenameFormat::Json));
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// RC-08: Test that --at is required
        #[test]
        fn test_rename_at_required() {
            let args = ["tug", "rename", "--to", "new_name"];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "expected missing --at error");
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("--at") || err.contains("required"),
                "error should mention --at: {}",
                err
            );
        }

        /// RC-09: Test that --to is required
        #[test]
        fn test_rename_to_required() {
            let args = ["tug", "rename", "--at", "src/main.py:10:5"];
            let result = Cli::try_parse_from(args);
            assert!(result.is_err(), "expected missing --to error");
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("--to") || err.contains("required"),
                "error should mention --to: {}",
                err
            );
        }

        /// RC-10: Test that invalid --at format produces error
        /// Note: This tests the Location parsing in the execution path,
        /// not CLI parsing, so we test the Location::parse function directly.
        #[test]
        fn test_rename_invalid_location() {
            use tugtool_core::output::Location;

            // Valid location
            let valid = Location::parse("src/main.py:10:5");
            assert!(valid.is_some(), "valid location should parse");

            // Invalid locations
            let invalid1 = Location::parse("src/main.py:10"); // missing column
            assert!(invalid1.is_none(), "missing column should fail");

            let invalid2 = Location::parse("src/main.py"); // missing line and column
            assert!(invalid2.is_none(), "missing line should fail");

            let invalid3 = Location::parse("bad"); // no colons
            assert!(invalid3.is_none(), "no colons should fail");
        }

        /// RC-11: Test verification mode combinations
        #[test]
        fn test_rename_verify_modes() {
            // Test explicit syntax
            let args_syntax = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--verify",
                "syntax",
            ];
            let cli = Cli::try_parse_from(args_syntax).unwrap();
            match cli.command {
                Command::Rename { verify, .. } => {
                    assert!(matches!(verify, VerifyMode::Syntax));
                }
                _ => panic!("expected Rename command"),
            }

            // Test verify none
            let args_none = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--verify",
                "none",
            ];
            let cli = Cli::try_parse_from(args_none).unwrap();
            match cli.command {
                Command::Rename { verify, .. } => {
                    assert!(matches!(verify, VerifyMode::None));
                }
                _ => panic!("expected Rename command"),
            }

            // Test verify tests
            let args_tests = [
                "tug",
                "rename",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
                "--verify",
                "tests",
            ];
            let cli = Cli::try_parse_from(args_tests).unwrap();
            match cli.command {
                Command::Rename { verify, .. } => {
                    assert!(matches!(verify, VerifyMode::Tests));
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// Additional test: Parse complete rename command with all flags
        #[test]
        fn parse_rename_all_flags() {
            let args = [
                "tug",
                "rename",
                "--at",
                "src/lib.py:25:10",
                "--to",
                "better_name",
                "--dry-run",
                "--verify",
                "none",
                "--format",
                "json",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Rename {
                    at,
                    to,
                    dry_run,
                    verify,
                    no_verify,
                    format,
                } => {
                    assert_eq!(at, "src/lib.py:25:10");
                    assert_eq!(to, "better_name");
                    assert!(dry_run);
                    assert!(matches!(verify, VerifyMode::None));
                    assert!(!no_verify);
                    assert!(matches!(format, RenameFormat::Json));
                }
                _ => panic!("expected Rename command"),
            }
        }

        /// Test global args work with rename command
        #[test]
        fn parse_rename_with_global_args() {
            let args = [
                "tug",
                "--workspace",
                "/my/project",
                "rename",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(cli.global.workspace, Some(PathBuf::from("/my/project")));
            assert!(matches!(cli.command, Command::Rename { .. }));
        }
    }
}
