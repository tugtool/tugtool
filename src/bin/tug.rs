//! tug CLI binary entry point.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use tugtool::cli::{run_analyze_impact, run_rename};
use tugtool::python::rename::VerificationMode;

/// AI-native code transformation engine for verified, deterministic refactors.
#[derive(Parser)]
#[command(name = "tug")]
#[command(version, about, long_about = None)]
struct Cli {
    /// Workspace root directory (default: current directory)
    #[arg(long, global = true)]
    workspace: Option<PathBuf>,

    /// Session directory (default: .tug in workspace)
    #[arg(long, global = true)]
    session_dir: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Analyze impact of a refactoring operation without applying changes.
    #[command(name = "analyze-impact")]
    AnalyzeImpact {
        #[command(subcommand)]
        operation: AnalyzeOperation,
    },

    /// Run a refactoring operation.
    Run {
        #[command(subcommand)]
        operation: RunOperation,
    },
}

#[derive(Subcommand)]
enum AnalyzeOperation {
    /// Analyze impact of renaming a symbol.
    #[command(name = "rename-symbol")]
    RenameSymbol {
        /// Location of the symbol: path:line:col
        #[arg(long)]
        at: String,

        /// New name for the symbol
        #[arg(long)]
        to: String,
    },
}

#[derive(Subcommand)]
enum RunOperation {
    /// Rename a symbol across the workspace.
    #[command(name = "rename-symbol")]
    RenameSymbol {
        /// Location of the symbol: path:line:col
        #[arg(long)]
        at: String,

        /// New name for the symbol
        #[arg(long)]
        to: String,

        /// Apply changes to the workspace (default: dry-run)
        #[arg(long)]
        apply: bool,

        /// Verification mode: none, syntax, tests, typecheck
        #[arg(long, default_value = "syntax")]
        verify: String,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    // Determine workspace root
    let workspace = cli
        .workspace
        .unwrap_or_else(|| std::env::current_dir().expect("Failed to get current directory"));

    // Determine session directory
    let session_dir = cli
        .session_dir
        .unwrap_or_else(|| workspace.join(".tug"));

    let result = match cli.command {
        Commands::AnalyzeImpact { operation } => match operation {
            AnalyzeOperation::RenameSymbol { at, to } => {
                run_analyze_impact(&workspace, &session_dir, &at, &to)
            }
        },
        Commands::Run { operation } => match operation {
            RunOperation::RenameSymbol {
                at,
                to,
                apply,
                verify,
            } => {
                let verify_mode = match verify.as_str() {
                    "none" => VerificationMode::None,
                    "syntax" => VerificationMode::Syntax,
                    "tests" => VerificationMode::Tests,
                    "typecheck" => VerificationMode::TypeCheck,
                    _ => {
                        eprintln!(
                            "{{\"status\":\"error\",\"error\":{{\"code\":\"InvalidArgument\",\"message\":\"invalid verify mode: {}\"}}}}",
                            verify
                        );
                        return ExitCode::from(2);
                    }
                };
                run_rename(&workspace, &session_dir, &at, &to, verify_mode, apply)
            }
        },
    };

    match result {
        Ok(json) => {
            println!("{}", json);
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!(
                "{{\"status\":\"error\",\"error\":{{\"code\":\"InternalError\",\"message\":\"{}\"}}}}",
                e.to_string().replace('"', "\\\"")
            );
            ExitCode::from(1)
        }
    }
}
