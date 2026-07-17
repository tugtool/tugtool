//! Changes & commits — the git surface of `tugutil` (`changes`, `context`, `commit`,
//! `log`, `diff`). A thin shell over [`tugchanges_core`]: parse arguments, call the
//! typed library API, and format the outcome as `--json` (the shared
//! `{schema_version, command, status, data, issues}` envelope) or a plain read-out.

use std::path::PathBuf;
use std::process::ExitCode;

use tugchanges_core::{
    ChangesError, ChangesOptions, CommitError, CommitOptions, ContextOptions, DiffOptions,
    LogOptions,
};

use crate::output::print_ok;

/// A CLI failure carrying its intended exit code. Exit 2 is the ledger's
/// "can't resolve the session" outcome (`changes`/`context`); exit 3 is the
/// `commit` refusal ([P03], unattributed files with no disposition); exit 1 is a
/// real error. Keeping the code with the message lets `main` map cleanly instead
/// of collapsing them the way a bare `String` would.
pub enum AppError {
    Exit1(String),
    Exit2(String),
    Exit3(String),
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

impl From<CommitError> for AppError {
    fn from(err: CommitError) -> Self {
        if err.is_refusal() {
            AppError::Exit3(err.to_string())
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
        Err(AppError::Exit3(msg)) => {
            eprintln!("error: {msg}");
            ExitCode::from(3)
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
    let report = tugchanges_core::changes(ChangesOptions {
        session,
        project,
        all,
        diff,
    })?;
    if json {
        print_ok("changes", &report);
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
    let report = tugchanges_core::context(ContextOptions {
        session,
        project,
        log_limit,
    })?;
    if json {
        print_ok("context", &report);
    } else {
        println!("branch: {}  head: {}", report.branch, report.head);
        println!("files ({}):", report.files.len());
        for file in &report.files {
            println!("  {} {}", file.git_status, file.path);
        }
        // The buckets that complete the working-tree universe ([P01]): each is
        // labeled and only printed when non-empty, so a clean tree reads exactly
        // as before.
        if !report.unattributed.is_empty() {
            println!("unattributed ({}):", report.unattributed.len());
            for file in &report.unattributed {
                println!("  {} {}", file.git_status, file.path);
            }
        }
        if !report.foreign.is_empty() {
            println!("foreign ({}):", report.foreign.len());
            for file in &report.foreign {
                println!(
                    "  {} {} [{}]",
                    file.git_status,
                    file.path,
                    file.sessions.join(", ")
                );
            }
        }
        println!("recent commits:");
        for commit in &report.recent_commits {
            println!("  {} {}", commit.sha, commit.subject);
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn run_commit(
    message: String,
    session: Option<String>,
    project: Option<PathBuf>,
    paths: Vec<String>,
    all: bool,
    include_unattributed: bool,
    leave_unattributed: bool,
    tree: bool,
    json: bool,
) -> Result<(), AppError> {
    let receipt = tugchanges_core::commit(CommitOptions {
        session,
        project,
        message,
        paths: if paths.is_empty() { None } else { Some(paths) },
        all,
        include_unattributed,
        leave_unattributed,
        tree,
    })
    .map_err(refusal_to_app_error)?;
    if json {
        print_ok("commit", &receipt);
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
        print_left_behind(&receipt.left_behind);
    }
    Ok(())
}

/// Map a [`CommitError`] to its exit code, expanding the [P03] refusal into a
/// stderr message that lists the offending paths **and** names the disposition
/// flags that resolve it (Spec S03) — so the agent/user always sees the way out.
fn refusal_to_app_error(err: CommitError) -> AppError {
    match err {
        CommitError::UnattributedPresent { paths } => {
            let mut msg = format!(
                "refusing to commit: {} unattributed dirty file(s) have no disposition:",
                paths.len()
            );
            for path in &paths {
                msg.push_str(&format!("\n  {path}"));
            }
            msg.push_str(
                "\nre-run with one of: --include-unattributed (commit them), \
                 --leave-unattributed (proceed without them), --tree (commit the \
                 whole dirty tree), or --paths <p…> (choose explicitly)",
            );
            AppError::Exit3(msg)
        }
        other => AppError::from(other),
    }
}

/// Print the receipt's still-dirty buckets (Spec S04) when any is non-empty, so
/// a partial commit is visible immediately on the plain output.
fn print_left_behind(left_behind: &tugchanges_core::LeftBehind) {
    let sections = [
        ("unattributed", &left_behind.unattributed),
        ("foreign", &left_behind.foreign),
        ("ambiguous", &left_behind.ambiguous),
    ];
    for (label, paths) in sections {
        if !paths.is_empty() {
            println!("left behind ({label}): {}", paths.join(", "));
        }
    }
}

pub fn run_log(limit: Option<u32>, range: Option<String>, json: bool) -> Result<(), AppError> {
    let report = tugchanges_core::log(LogOptions { limit, range })?;
    if json {
        print_ok("log", &report);
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
    let report = tugchanges_core::diff(DiffOptions {
        session: None,
        project,
        range,
        staged,
        session_scope: session,
    })?;
    if json {
        print_ok("diff", &report);
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
