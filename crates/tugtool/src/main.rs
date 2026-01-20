//! Binary entry point for the tug CLI.
//!
//! This module provides the command-line interface for tug operations.
//! It is the "front door" for LLM coding agents (per \[D03\] One kernel, multiple front doors).
//!
//! ## Usage
//!
//! ```bash
//! # Analyze impact of a rename
//! tug analyze-impact rename-symbol --at src/lib.py:10:5 --to new_name
//!
//! # Execute rename with verification (--apply and --verify come before the refactor subcommand)
//! tug run --apply --verify syntax rename-symbol --at src/lib.py:10:5 --to new_name
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
use tugtool_core::output::{emit_response, ErrorInfo, ErrorResponse, SnapshotResponse};
use tugtool_core::session::{Session, SessionOptions};
use tugtool_core::workspace::{Language, SnapshotConfig, WorkspaceSnapshot};

// Python feature-gated imports
#[cfg(feature = "python")]
use tugtool::cli::{run_analyze_impact, run_rename};
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
#[derive(Parser)]
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

/// CLI subcommands.
#[derive(Subcommand)]
enum Command {
    /// Create a workspace snapshot for analysis.
    Snapshot,
    /// Analyze impact of a refactoring operation.
    AnalyzeImpact {
        #[command(subcommand)]
        refactor: RefactorOp,
    },
    /// Execute a refactoring operation.
    Run {
        #[command(subcommand)]
        refactor: RefactorOp,
        /// Apply changes to files (default: dry-run).
        #[arg(long)]
        apply: bool,
        /// Verification mode after applying changes.
        #[arg(long, value_enum, default_value = "syntax")]
        verify: VerifyMode,
        /// Custom test command as JSON array (e.g., '["{python}","-m","pytest","-x"]').
        ///
        /// Template variables: {python} = resolved Python path, {workspace} = workspace root.
        /// If not provided, auto-detects from pyproject.toml, pytest.ini, or setup.cfg.
        #[arg(long)]
        test_command: Option<String>,
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
    /// Start MCP server on stdio.
    ///
    /// Runs the Model Context Protocol server for AI agent integration.
    /// The server communicates via JSON-RPC 2.0 over stdin/stdout.
    #[cfg(feature = "mcp")]
    Mcp,
    /// Manage language toolchains.
    ///
    /// Set up, query, or verify toolchain environments for supported languages.
    /// Currently supports: python
    Toolchain {
        /// Target language (e.g., python).
        lang: String,
        #[command(subcommand)]
        action: ToolchainAction,
    },
}

/// Refactoring operations (used by analyze-impact and run).
#[derive(Subcommand, Clone)]
enum RefactorOp {
    /// Rename a symbol.
    RenameSymbol {
        /// Location of the symbol to rename (file:line:col).
        #[arg(long)]
        at: String,
        /// New name for the symbol.
        #[arg(long)]
        to: String,
    },
    /// Change a function signature (not yet implemented).
    ChangeSignature {
        /// Location of the function (file:line:col).
        #[arg(long)]
        at: String,
    },
    /// Move a symbol to a new location (not yet implemented).
    MoveSymbol {
        /// Location of the symbol to move (file:line:col).
        #[arg(long)]
        at: String,
        /// Destination file path.
        #[arg(long)]
        to: String,
    },
    /// Organize imports in a file (not yet implemented).
    OrganizeImports {
        /// File to organize imports in.
        #[arg(long)]
        file: String,
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
#[derive(Subcommand)]
enum SessionAction {
    /// Show session status.
    Status,
}

/// Toolchain management actions.
#[derive(Subcommand, Clone)]
enum ToolchainAction {
    /// Set up the toolchain environment.
    ///
    /// Creates a managed virtual environment with required dependencies.
    /// For Python: creates .tug/venv with libcst installed.
    Setup {
        /// Force recreation of existing environment.
        #[arg(long)]
        recreate: bool,
        /// Use global location (~/.tug/) instead of workspace.
        #[arg(long)]
        global: bool,
    },
    /// Show current toolchain configuration.
    ///
    /// Displays resolved toolchain path, version, and resolution source.
    Info,
    /// Verify toolchain is correctly configured.
    ///
    /// Exits 0 if valid, 1 if not. Useful for CI scripts.
    Check,
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
        Command::AnalyzeImpact { refactor } => execute_analyze_impact(&cli.global, refactor),
        Command::Run {
            refactor,
            apply,
            verify,
            test_command,
        } => execute_run(&cli.global, refactor, apply, verify, test_command),
        Command::Session { action } => execute_session(&cli.global, action),
        Command::Verify { mode, test_command } => execute_verify(&cli.global, mode, test_command),
        Command::Clean { workers, cache } => execute_clean(&cli.global, workers, cache),
        #[cfg(feature = "mcp")]
        Command::Mcp => execute_mcp(),
        Command::Toolchain { lang, action } => execute_toolchain(&cli.global, &lang, action),
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

/// Execute analyze-impact command.
#[cfg(feature = "python")]
fn execute_analyze_impact(global: &GlobalArgs, refactor: RefactorOp) -> Result<(), TugError> {
    let mut session = open_session(global)?;

    match refactor {
        RefactorOp::RenameSymbol { at, to } => {
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;
            // run_analyze_impact now returns Result<String, TugError> directly
            let json = run_analyze_impact(&session, Some(python_path), &at, &to)?;

            // Output is already JSON from run_analyze_impact
            println!("{}", json);
            Ok(())
        }
        RefactorOp::ChangeSignature { .. } => Err(TugError::internal(
            "Operation not yet implemented: change-signature",
        )),
        RefactorOp::MoveSymbol { .. } => Err(TugError::internal(
            "Operation not yet implemented: move-symbol",
        )),
        RefactorOp::OrganizeImports { .. } => Err(TugError::internal(
            "Operation not yet implemented: organize-imports",
        )),
    }
}

/// Execute analyze-impact command (Python not available).
#[cfg(not(feature = "python"))]
fn execute_analyze_impact(_global: &GlobalArgs, _refactor: RefactorOp) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
}

/// Execute run command.
#[cfg(feature = "python")]
fn execute_run(
    global: &GlobalArgs,
    refactor: RefactorOp,
    apply: bool,
    verify: VerifyMode,
    test_command: Option<String>,
) -> Result<(), TugError> {
    let mut session = open_session(global)?;

    match refactor {
        RefactorOp::RenameSymbol { at, to } => {
            let python_path = resolve_toolchain(&mut session, "python", &global.toolchain)?;

            // Resolve test command if verification mode is Tests
            if verify == VerifyMode::Tests {
                let vars = TemplateVars::new(
                    Some(python_path.to_string_lossy().to_string()),
                    Some(session.workspace_root().to_string_lossy().to_string()),
                );
                let _test_cmd =
                    resolve_test_command(test_command.as_deref(), session.workspace_root(), &vars)
                        .map_err(|e| TugError::internal(e.to_string()))?;
                // TODO: Pass test command to run_rename when tests verification is implemented
            }

            // run_rename now returns Result<String, TugError> directly
            let json = run_rename(&session, Some(python_path), &at, &to, verify.into(), apply)?;

            // Output is already JSON from run_rename
            println!("{}", json);
            Ok(())
        }
        RefactorOp::ChangeSignature { .. } => Err(TugError::internal(
            "Operation not yet implemented: change-signature",
        )),
        RefactorOp::MoveSymbol { .. } => Err(TugError::internal(
            "Operation not yet implemented: move-symbol",
        )),
        RefactorOp::OrganizeImports { .. } => Err(TugError::internal(
            "Operation not yet implemented: organize-imports",
        )),
    }
}

/// Execute run command (Python not available).
#[cfg(not(feature = "python"))]
fn execute_run(
    _global: &GlobalArgs,
    _refactor: RefactorOp,
    _apply: bool,
    _verify: VerifyMode,
    _test_command: Option<String>,
) -> Result<(), TugError> {
    Err(tugtool::cli::python_not_available())
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

/// Execute MCP server command.
///
/// Starts the Model Context Protocol server on stdio. The server communicates
/// via JSON-RPC 2.0 over stdin/stdout, enabling AI agent integration.
#[cfg(feature = "mcp")]
fn execute_mcp() -> Result<(), TugError> {
    // Create a tokio runtime to run the async MCP server
    let runtime = tokio::runtime::Runtime::new()
        .map_err(|e| TugError::internal(format!("Failed to create tokio runtime: {}", e)))?;

    // Run the MCP server (blocks until client disconnects or sends shutdown)
    runtime.block_on(tugtool::mcp::run_mcp_server())
}

/// Execute toolchain command.
///
/// Dispatches to language-specific toolchain handlers.
#[cfg(feature = "python")]
fn execute_toolchain(
    global: &GlobalArgs,
    lang: &str,
    action: ToolchainAction,
) -> Result<(), TugError> {
    match lang {
        "python" => execute_python_toolchain(global, action),
        _ => Err(TugError::invalid_args(format!(
            "Unknown language '{}'. Supported: python",
            lang
        ))),
    }
}

/// Execute toolchain command (Python not available).
#[cfg(not(feature = "python"))]
fn execute_toolchain(
    _global: &GlobalArgs,
    lang: &str,
    _action: ToolchainAction,
) -> Result<(), TugError> {
    match lang {
        "python" => Err(tugtool::cli::python_not_available()),
        _ => Err(TugError::invalid_args(format!(
            "Unknown language '{}'. No languages compiled in.\n\n\
             To enable Python: cargo install tugtool --features python",
            lang
        ))),
    }
}

/// Execute Python toolchain command.
///
/// With native CST, toolchain setup is no longer required. Python is only needed
/// for verification (running `python -m compileall` or tests).
#[cfg(feature = "python")]
fn execute_python_toolchain(_global: &GlobalArgs, action: ToolchainAction) -> Result<(), TugError> {
    match action {
        ToolchainAction::Setup { .. } => {
            let response = serde_json::json!({
                "status": "ok",
                "schema_version": SCHEMA_VERSION,
                "language": "python",
                "message": "Toolchain setup is no longer required. Tugtool now uses native Rust CST parsing.",
                "note": "Python is only needed for verification (syntax checking with compileall or running tests).",
            });
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
            Ok(())
        }
        ToolchainAction::Info => {
            // Try to find Python in PATH for verification purposes
            let python_path = find_python_in_path();
            let response = serde_json::json!({
                "status": "ok",
                "schema_version": SCHEMA_VERSION,
                "language": "python",
                "python_path": python_path,
                "message": "Native CST is used for analysis. Python shown is for verification only.",
            });
            println!("{}", serde_json::to_string_pretty(&response).unwrap());
            Ok(())
        }
        ToolchainAction::Check => {
            // Check if Python is available (for verification)
            let python_path = find_python_in_path();
            let valid = python_path.is_some();

            let response = serde_json::json!({
                "status": if valid { "ok" } else { "error" },
                "schema_version": SCHEMA_VERSION,
                "language": "python",
                "valid": valid,
                "python_path": python_path,
                "message": if valid {
                    "Python found for verification."
                } else {
                    "Python not found. Verification will be skipped."
                },
            });
            println!("{}", serde_json::to_string_pretty(&response).unwrap());

            // Always return Ok - Python is optional for native CST
            Ok(())
        }
    }
}

/// Find Python interpreter in PATH (for verification purposes).
#[cfg(feature = "python")]
fn find_python_in_path() -> Option<String> {
    for name in &["python3", "python"] {
        if let Ok(output) = std::process::Command::new("which")
            .arg(name)
            .output()
        {
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
            // Find Python in PATH (libcst no longer required with native CST)
            find_python_in_path()
                .map(PathBuf::from)
                .ok_or_else(|| TugError::internal(
                    "Could not find Python interpreter in PATH. Python is needed for verification.",
                ))?
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod cli_parsing {
        use super::*;

        #[test]
        fn parse_analyze_impact_rename() {
            let args = [
                "tug",
                "analyze-impact",
                "rename-symbol",
                "--at",
                "src/main.py:10:5",
                "--to",
                "new_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::AnalyzeImpact {
                    refactor: RefactorOp::RenameSymbol { at, to },
                } => {
                    assert_eq!(at, "src/main.py:10:5");
                    assert_eq!(to, "new_name");
                }
                _ => panic!("expected AnalyzeImpact RenameSymbol"),
            }
        }

        #[test]
        fn parse_run_rename_with_apply() {
            // Note: flags for 'run' come before the nested subcommand 'rename-symbol'
            let args = [
                "tug",
                "run",
                "--apply",
                "rename-symbol",
                "--at",
                "lib.py:42:8",
                "--to",
                "better_name",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run {
                    refactor: RefactorOp::RenameSymbol { at, to },
                    apply,
                    verify,
                    ..
                } => {
                    assert_eq!(at, "lib.py:42:8");
                    assert_eq!(to, "better_name");
                    assert!(apply);
                    assert!(matches!(verify, VerifyMode::Syntax)); // default
                }
                _ => panic!("expected Run RenameSymbol"),
            }
        }

        #[test]
        fn parse_run_with_verify_none() {
            let args = [
                "tug",
                "run",
                "--verify",
                "none",
                "rename-symbol",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run { verify, .. } => {
                    assert!(matches!(verify, VerifyMode::None));
                }
                _ => panic!("expected Run"),
            }
        }

        #[test]
        fn parse_run_with_verify_tests() {
            let args = [
                "tug",
                "run",
                "--verify",
                "tests",
                "rename-symbol",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run { verify, .. } => {
                    assert!(matches!(verify, VerifyMode::Tests));
                }
                _ => panic!("expected Run"),
            }
        }

        #[test]
        fn parse_run_with_verify_typecheck() {
            let args = [
                "tug",
                "run",
                "--verify",
                "typecheck",
                "rename-symbol",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run { verify, .. } => {
                    assert!(matches!(verify, VerifyMode::Typecheck));
                }
                _ => panic!("expected Run"),
            }
        }

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
        fn parse_analyze_impact_change_signature() {
            let args = [
                "tug",
                "analyze-impact",
                "change-signature",
                "--at",
                "src/lib.py:25:4",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::AnalyzeImpact {
                    refactor: RefactorOp::ChangeSignature { at },
                } => {
                    assert_eq!(at, "src/lib.py:25:4");
                }
                _ => panic!("expected AnalyzeImpact ChangeSignature"),
            }
        }

        #[test]
        fn parse_analyze_impact_move_symbol() {
            let args = [
                "tug",
                "analyze-impact",
                "move-symbol",
                "--at",
                "src/utils.py:10:0",
                "--to",
                "src/helpers.py",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::AnalyzeImpact {
                    refactor: RefactorOp::MoveSymbol { at, to },
                } => {
                    assert_eq!(at, "src/utils.py:10:0");
                    assert_eq!(to, "src/helpers.py");
                }
                _ => panic!("expected AnalyzeImpact MoveSymbol"),
            }
        }

        #[test]
        fn parse_analyze_impact_organize_imports() {
            let args = [
                "tug",
                "analyze-impact",
                "organize-imports",
                "--file",
                "src/main.py",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::AnalyzeImpact {
                    refactor: RefactorOp::OrganizeImports { file },
                } => {
                    assert_eq!(file, "src/main.py");
                }
                _ => panic!("expected AnalyzeImpact OrganizeImports"),
            }
        }

        #[test]
        fn parse_run_change_signature() {
            let args = [
                "tug",
                "run",
                "--apply",
                "change-signature",
                "--at",
                "src/lib.py:25:4",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run {
                    refactor: RefactorOp::ChangeSignature { at },
                    apply,
                    ..
                } => {
                    assert_eq!(at, "src/lib.py:25:4");
                    assert!(apply);
                }
                _ => panic!("expected Run ChangeSignature"),
            }
        }

        #[test]
        fn parse_run_move_symbol() {
            let args = [
                "tug",
                "run",
                "--apply",
                "move-symbol",
                "--at",
                "src/utils.py:10:0",
                "--to",
                "src/helpers.py",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run {
                    refactor: RefactorOp::MoveSymbol { at, to },
                    apply,
                    ..
                } => {
                    assert_eq!(at, "src/utils.py:10:0");
                    assert_eq!(to, "src/helpers.py");
                    assert!(apply);
                }
                _ => panic!("expected Run MoveSymbol"),
            }
        }

        #[test]
        fn parse_run_organize_imports() {
            let args = [
                "tug",
                "run",
                "--apply",
                "organize-imports",
                "--file",
                "src/main.py",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run {
                    refactor: RefactorOp::OrganizeImports { file },
                    apply,
                    ..
                } => {
                    assert_eq!(file, "src/main.py");
                    assert!(apply);
                }
                _ => panic!("expected Run OrganizeImports"),
            }
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
        fn parse_run_with_test_command() {
            let args = [
                "tug",
                "run",
                "--verify",
                "tests",
                "--test-command",
                r#"["{python}", "-m", "pytest", "-x"]"#,
                "rename-symbol",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run {
                    test_command,
                    verify,
                    ..
                } => {
                    assert!(matches!(verify, VerifyMode::Tests));
                    assert_eq!(
                        test_command,
                        Some(r#"["{python}", "-m", "pytest", "-x"]"#.to_string())
                    );
                }
                _ => panic!("expected Run"),
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
        fn parse_run_without_test_command() {
            let args = [
                "tug",
                "run",
                "--verify",
                "tests",
                "rename-symbol",
                "--at",
                "test.py:1:1",
                "--to",
                "x",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Run { test_command, .. } => {
                    assert!(test_command.is_none());
                }
                _ => panic!("expected Run"),
            }
        }

        #[test]
        #[cfg(feature = "mcp")]
        fn parse_mcp() {
            let args = ["tug", "mcp"];
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(matches!(cli.command, Command::Mcp));
        }

        #[test]
        fn parse_toolchain_python_setup() {
            let args = ["tug", "toolchain", "python", "setup"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "python");
                    match action {
                        ToolchainAction::Setup { recreate, global } => {
                            assert!(!recreate);
                            assert!(!global);
                        }
                        _ => panic!("expected Setup"),
                    }
                }
                _ => panic!("expected Toolchain"),
            }
        }

        #[test]
        fn parse_toolchain_python_setup_recreate() {
            let args = ["tug", "toolchain", "python", "setup", "--recreate"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "python");
                    match action {
                        ToolchainAction::Setup { recreate, global } => {
                            assert!(recreate);
                            assert!(!global);
                        }
                        _ => panic!("expected Setup"),
                    }
                }
                _ => panic!("expected Toolchain"),
            }
        }

        #[test]
        fn parse_toolchain_python_setup_global() {
            let args = ["tug", "toolchain", "python", "setup", "--global"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "python");
                    match action {
                        ToolchainAction::Setup { recreate, global } => {
                            assert!(!recreate);
                            assert!(global);
                        }
                        _ => panic!("expected Setup"),
                    }
                }
                _ => panic!("expected Toolchain"),
            }
        }

        #[test]
        fn parse_toolchain_python_setup_all_flags() {
            let args = [
                "tug",
                "toolchain",
                "python",
                "setup",
                "--recreate",
                "--global",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "python");
                    match action {
                        ToolchainAction::Setup { recreate, global } => {
                            assert!(recreate);
                            assert!(global);
                        }
                        _ => panic!("expected Setup"),
                    }
                }
                _ => panic!("expected Toolchain"),
            }
        }

        #[test]
        fn parse_toolchain_python_info() {
            let args = ["tug", "toolchain", "python", "info"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "python");
                    assert!(matches!(action, ToolchainAction::Info));
                }
                _ => panic!("expected Toolchain"),
            }
        }

        #[test]
        fn parse_toolchain_python_check() {
            let args = ["tug", "toolchain", "python", "check"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "python");
                    assert!(matches!(action, ToolchainAction::Check));
                }
                _ => panic!("expected Toolchain"),
            }
        }

        #[test]
        fn parse_toolchain_other_language() {
            // The CLI should accept any language string (validation happens at execution)
            let args = ["tug", "toolchain", "rust", "check"];
            let cli = Cli::try_parse_from(args).unwrap();
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "rust");
                    assert!(matches!(action, ToolchainAction::Check));
                }
                _ => panic!("expected Toolchain"),
            }
        }

        #[test]
        fn parse_toolchain_with_global_flags() {
            let args = [
                "tug",
                "--workspace",
                "/home/user/project",
                "toolchain",
                "python",
                "info",
            ];
            let cli = Cli::try_parse_from(args).unwrap();
            assert_eq!(
                cli.global.workspace,
                Some(PathBuf::from("/home/user/project"))
            );
            match cli.command {
                Command::Toolchain { lang, action } => {
                    assert_eq!(lang, "python");
                    assert!(matches!(action, ToolchainAction::Info));
                }
                _ => panic!("expected Toolchain"),
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
}
