//! `tugmark` — the standalone CLI for git changes & commits.
//!
//! A thin presentation shell over [`tugmark_core`]: it parses arguments, calls
//! the typed library API, and formats the outcome as `--json` (the
//! `{schema_version, command, status, data, issues}` envelope the skills parse)
//! or a plain human read-out. The subcommands are `changes`, `context`,
//! `commit`, `log`, and `diff` (List L01).

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use serde::Serialize;

use tugmark_core::{
    ChangesError, ChangesOptions, CommitOptions, ContextOptions, DiffOptions, LogOptions,
};

const SCHEMA_VERSION: &str = "1";

/// The `--json` envelope — identical shape to `tugdash`/`tugutil`'s
/// `JsonResponse`, so the skills parse `tugmark --json` exactly as they parsed
/// the others.
#[derive(Serialize)]
struct JsonResponse<T> {
    schema_version: String,
    command: String,
    status: String,
    data: T,
    issues: Vec<serde_json::Value>,
}

impl<T: Serialize> JsonResponse<T> {
    fn ok(command: &str, data: T) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            command: command.to_string(),
            status: "ok".to_string(),
            data,
            issues: vec![],
        }
    }
}

fn print_json<T: Serialize>(command: &str, data: T) {
    let response = JsonResponse::ok(command, data);
    println!("{}", serde_json::to_string_pretty(&response).unwrap());
}

/// A CLI failure carrying its intended exit code. Exit 2 is the ledger's
/// "can't resolve the session" outcome (`changes`/`context`); exit 1 is a real
/// error. Keeping the code with the message lets `main` map cleanly instead of
/// collapsing 0/2 the way a bare `String` would ([F5]).
enum AppError {
    Exit1(String),
    Exit2(String),
}

impl From<ChangesError> for AppError {
    fn from(err: ChangesError) -> Self {
        if err.is_exit_two() {
            AppError::Exit2(err.to_string())
        } else {
            AppError::Exit1(err.to_string())
        }
    }
}

impl From<String> for AppError {
    fn from(msg: String) -> Self {
        AppError::Exit1(msg)
    }
}

#[derive(Parser)]
#[command(
    name = "tugmark",
    version,
    about = "tugmark — standalone git changes & commits",
    long_about = "tugmark — a cohesive program that owns git changes & commits: changes (which files this session changed), context (one-shot commit context), commit (stage → commit → structured receipt), log, and diff. A thin --json CLI over tugmark-core."
)]
struct Cli {
    /// Emit machine-readable JSON.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Which files this session changed (ledger ∩ git status).
    Changes {
        /// Session id (default: $TUG_SESSION_ID).
        #[arg(long)]
        session: Option<String>,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Keep committed/reverted files too.
        #[arg(long)]
        all: bool,
        /// Attach each file's unified diff.
        #[arg(long)]
        diff: bool,
    },
    /// One-shot commit context: changed files (with diff), branch/head, recent commits.
    Context {
        /// Session id (default: $TUG_SESSION_ID).
        #[arg(long)]
        session: Option<String>,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Recent-commit depth.
        #[arg(long, default_value_t = 10)]
        log_limit: u32,
    },
    /// Stage the session's changed files, commit, and print a structured receipt.
    Commit {
        /// Git commit message (subject, optional body).
        #[arg(long)]
        message: String,
        /// Session id (default: $TUG_SESSION_ID).
        #[arg(long)]
        session: Option<String>,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
        /// Explicit file set (overrides the session's changed files).
        #[arg(long, num_args = 1..)]
        paths: Vec<String>,
        /// Include ambiguous files.
        #[arg(long)]
        all: bool,
    },
    /// Recent commits, or a range's commits.
    Log {
        /// Number of commits (default 10).
        #[arg(long)]
        limit: Option<u32>,
        /// Two-dot range `a..b`.
        #[arg(long)]
        range: Option<String>,
    },
    /// Per-file diff stats for the working tree, the index, a range, or the session.
    Diff {
        /// Two-dot range `a..b`.
        #[arg(long)]
        range: Option<String>,
        /// Diff the index instead of the working tree.
        #[arg(long)]
        staged: bool,
        /// Narrow to the session's changed files (default session: $TUG_SESSION_ID).
        #[arg(long)]
        session: bool,
        /// Project dir (default: cwd).
        #[arg(long)]
        project: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let json = cli.json;

    let result: Result<(), AppError> = match cli.command {
        Command::Changes {
            session,
            project,
            all,
            diff,
        } => run_changes(session, project, all, diff, json),
        Command::Context {
            session,
            project,
            log_limit,
        } => run_context(session, project, log_limit, json),
        Command::Commit {
            message,
            session,
            project,
            paths,
            all,
        } => run_commit(message, session, project, paths, all, json),
        Command::Log { limit, range } => run_log(limit, range, json),
        Command::Diff {
            range,
            staged,
            session,
            project,
        } => run_diff(range, staged, session, project, json),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(AppError::Exit1(msg)) => {
            eprintln!("error: {msg}");
            ExitCode::from(1)
        }
        Err(AppError::Exit2(msg)) => {
            eprintln!("error: {msg}");
            ExitCode::from(2)
        }
    }
}

fn run_changes(
    session: Option<String>,
    project: Option<PathBuf>,
    all: bool,
    diff: bool,
    json: bool,
) -> Result<(), AppError> {
    let report = tugmark_core::changes(ChangesOptions {
        session,
        project,
        all,
        diff,
    })?;
    if json {
        print_json("mark changes", &report);
    } else {
        // Plain: one repo-relative path per line, EXCLUDING ambiguous rows (the
        // skill opts into those via --json); the omitted count goes to stderr so
        // it isn't silent.
        for file in report.files.iter().filter(|f| !f.ambiguous) {
            println!("{}", file.path);
        }
        let omitted = report.files.iter().filter(|f| f.ambiguous).count();
        if omitted > 0 {
            eprintln!("{omitted} ambiguous file(s) omitted — use --json to see them");
        }
    }
    Ok(())
}

fn run_context(
    session: Option<String>,
    project: Option<PathBuf>,
    log_limit: u32,
    json: bool,
) -> Result<(), AppError> {
    let report = tugmark_core::context(ContextOptions {
        session,
        project,
        log_limit,
    })?;
    if json {
        print_json("mark context", &report);
    } else {
        println!("branch: {}  head: {}", report.branch, report.head);
        println!("files ({}):", report.files.len());
        for file in &report.files {
            println!("  {} {}", file.git_status, file.path);
        }
        println!("recent commits:");
        for commit in &report.recent_commits {
            println!("  {} {}", commit.sha, commit.subject);
        }
    }
    Ok(())
}

fn run_commit(
    message: String,
    session: Option<String>,
    project: Option<PathBuf>,
    paths: Vec<String>,
    all: bool,
    json: bool,
) -> Result<(), AppError> {
    let receipt = tugmark_core::commit(CommitOptions {
        session,
        project,
        message,
        paths: if paths.is_empty() { None } else { Some(paths) },
        all,
    })?;
    if json {
        print_json("mark commit", &receipt);
    } else {
        println!("committed {} on {}", receipt.sha, receipt.branch);
        println!(
            "{} file(s), +{} -{}",
            receipt.aggregate.files_changed,
            receipt.aggregate.insertions,
            receipt.aggregate.deletions
        );
        for file in &receipt.files {
            println!("  {} {}", file.status, file.path);
        }
    }
    Ok(())
}

fn run_log(limit: Option<u32>, range: Option<String>, json: bool) -> Result<(), AppError> {
    let report = tugmark_core::log(LogOptions { limit, range })?;
    if json {
        print_json("mark log", &report);
    } else {
        for commit in &report.commits {
            println!("{} {}", commit.sha, commit.subject);
        }
    }
    Ok(())
}

fn run_diff(
    range: Option<String>,
    staged: bool,
    session: bool,
    project: Option<PathBuf>,
    json: bool,
) -> Result<(), AppError> {
    let report = tugmark_core::diff(DiffOptions {
        session: None,
        project,
        range,
        staged,
        session_scope: session,
    })?;
    if json {
        print_json("mark diff", &report);
    } else {
        for file in &report.files {
            let added = file.added.map(|n| n.to_string()).unwrap_or_else(|| "-".into());
            let deleted = file
                .deleted
                .map(|n| n.to_string())
                .unwrap_or_else(|| "-".into());
            println!("{} {} (+{added} -{deleted})", file.status, file.path);
        }
    }
    Ok(())
}
