//! Changes & commits — the git surface of `tugutil` (`changes`, `context`, `commit`,
//! `log`, `diff`). A thin shell over [`tugmark_core`]: parse arguments, call the
//! typed library API, and format the outcome as `--json` (the shared
//! `{schema_version, command, status, data, issues}` envelope) or a plain read-out.

use std::path::PathBuf;
use std::process::ExitCode;

use tugmark_core::{
    ChangesError, ChangesOptions, CommitOptions, ContextOptions, DiffOptions, LogOptions,
};

use crate::output::print_ok;

/// A CLI failure carrying its intended exit code. Exit 2 is the ledger's
/// "can't resolve the session" outcome (`changes`/`context`); exit 1 is a real
/// error. Keeping the code with the message lets `main` map cleanly instead of
/// collapsing 0/2 the way a bare `String` would.
pub enum AppError {
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

/// Map a git-verb result to a process exit code, printing the error to stderr.
pub fn finish(result: Result<(), AppError>) -> ExitCode {
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

pub fn run_changes(
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
        print_ok("mark changes", &report);
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

pub fn run_context(
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
        print_ok("mark context", &report);
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

pub fn run_commit(
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
        print_ok("mark commit", &receipt);
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

pub fn run_log(limit: Option<u32>, range: Option<String>, json: bool) -> Result<(), AppError> {
    let report = tugmark_core::log(LogOptions { limit, range })?;
    if json {
        print_ok("mark log", &report);
    } else {
        for commit in &report.commits {
            println!("{} {}", commit.sha, commit.subject);
        }
    }
    Ok(())
}

pub fn run_diff(
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
        print_ok("mark diff", &report);
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
