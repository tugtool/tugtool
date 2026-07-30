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
//! machine's live login PATH** — the harness's job is to read reality, so it
//! sees the same command set the running app would.
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

    let commands = tuggram::compute_path_commands();
    let set = tuggram::CommandSet::new_sorted(&commands);

    let mut out: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else {
            eprintln!("grade: unreadable input");
            return std::process::ExitCode::from(2);
        };
        if line.is_empty() {
            continue;
        }
        let graded = tuggram::grade(&line, &set, cwd.as_deref());
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
