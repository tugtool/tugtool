//! Grade lines from stdin and write the bands as JSON.
//!
//! This is the eval harness's seam onto the real grader, the mirror of
//! `tests/model-eval/veto-filter.ts` and there for the same reason: a Python
//! re-expression of the band rules would be a second source of truth that goes
//! stale while reporting that all is well. `classify.py` builds this once and
//! runs the built binary — never `cargo run` per line, which would put a cold
//! rebuild inside the scoring loop and have it read as model latency.
//!
//! ```text
//! printf 'git status\ngit stauts\n' | grade
//! {"git status":{"band":"yes"},"git stauts":{"band":"maybe","synopsis":"…"}}
//! ```
//!
//! Unlike the hermetic corpus test in the crate, this grades against **this
//! machine's live login PATH and this machine's login shell** — the harness's
//! job is to read reality, so it sees the same command set and the same
//! aliases, functions and builtins the running app would. It interrogates the
//! shell exactly the way tugcast does, through the same helpers, so there is no
//! second expression of the dump to drift.
//!
//! It grades from a working directory for the same reason. A path positional's
//! band is whatever a `stat` says, so a run with no cwd would confirm no path
//! anywhere and report a Maybe rate no real session would ever see. `--cwd`
//! names the directory to stand in; without it the process's own is used, which
//! is where the harness was invoked from.

use std::collections::BTreeMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;

fn main() -> std::process::ExitCode {
    let mut args = std::env::args().skip(1);
    let mut cwd: Option<PathBuf> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cwd" => match args.next() {
                Some(dir) => cwd = Some(PathBuf::from(dir)),
                None => {
                    eprintln!("grade: --cwd needs a directory");
                    return std::process::ExitCode::from(2);
                }
            },
            other => {
                eprintln!("grade: unknown argument {other}");
                return std::process::ExitCode::from(2);
            }
        }
    }
    let cwd = cwd.or_else(|| std::env::current_dir().ok());

    let path = tuggram::probe_login_path();
    let commands = tuggram::command_names_in_path(&path);
    let path_dirs: Vec<PathBuf> = path
        .split(':')
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .collect();
    let mut words = tuggram::words::dump_shell_words(cwd.as_deref()).unwrap_or_else(|| {
        eprintln!("grade: no shell word table (is $SHELL bash or zsh?)");
        tuggram::ShellWords::empty()
    });

    let mut out: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else {
            eprintln!("grade: unreadable input");
            return std::process::ExitCode::from(2);
        };
        if line.is_empty() {
            continue;
        }
        // Bodies are fetched for the words a line actually names, which is what
        // the app does too — the whole point of the table being names-first.
        ensure_bodies(&mut words, &line);
        let graded = tuggram::grade(
            &line,
            &tuggram::ShellContext {
                commands: tuggram::CommandSet::new_sorted(&commands),
                words: &words,
                path_dirs: &path_dirs,
                cwd: cwd.as_deref(),
            },
        );
        let mut entry = serde_json::json!({ "band": graded.band.as_str() });
        if let Some(synopsis) = graded.synopsis {
            entry["synopsis"] = serde_json::json!(synopsis);
        }
        if let Some(command) = graded.command {
            entry["command"] = serde_json::json!(command);
        }
        out.insert(line, entry);
    }

    let rendered = match serde_json::to_string(&out) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("grade: {e}");
            return std::process::ExitCode::from(2);
        }
    };
    let stdout = std::io::stdout();
    let mut handle = stdout.lock();
    if handle.write_all(rendered.as_bytes()).is_err() {
        return std::process::ExitCode::from(2);
    }
    std::process::ExitCode::SUCCESS
}

/// Read the bodies of every word this line names, so the grade can reach the
/// grammar of what those words expand to.
fn ensure_bodies(words: &mut tuggram::ShellWords, line: &str) {
    let Some(segments) = tuggram::lex(line) else {
        return;
    };
    for segment in &segments {
        if let Some(head) = segment.head() {
            tuggram::words::ensure_body_chain(words, head);
        }
    }
}
