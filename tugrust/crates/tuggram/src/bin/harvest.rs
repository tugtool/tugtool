//! The batch catalog harvester.
//!
//! Sweeps the login PATH, distills each command's man page into a grammar,
//! merges the result under the hand-authored curated entries already in the
//! catalog, and rewrites `data/commands.json`.
//!
//! # It executes nothing by default
//!
//! `--help` is an execution, and on an arbitrary script on a user's PATH it is
//! *any* execution. A batch tool that runs everything it finds is a footgun
//! however good its intentions, so the default harvest reads man pages and runs
//! nothing but `man`. Probing is opt-in behind `--probe-help`, restricted to an
//! allowlist of system and package directories, given a kill-timeout, run with a
//! stripped environment, and handed a closed stdin.
//!
//! # Usage
//!
//! ```text
//! cargo run -p tuggram --bin harvest                 # rewrite the catalog
//! cargo run -p tuggram --bin harvest -- --check      # fail if it would change
//! cargo run -p tuggram --bin harvest -- --probe-help # also read --help output
//! cargo run -p tuggram --bin harvest -- --allow-dir /opt/local/bin
//! ```
//!
//! `--check` compares a fresh harvest against the committed file. It reads this
//! machine's PATH and this machine's man pages, so it holds only on the machine
//! that generated the catalog: it is a reproducibility check for whoever
//! regenerates, not a portable gate, and it must never run in a suite another
//! machine is expected to pass.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use tuggram::catalog::{Catalog, CatalogFile, Entry, Source};
use tuggram::harvest::{distill_help, distill_man, merge};

/// Directories a `--help` probe may run a binary out of. Everything here ships
/// with the system or with a package manager; a binary somewhere else on the
/// PATH is the user's own and is never executed.
const DEFAULT_PROBE_DIRS: &[&str] = &["/bin", "/usr/bin", "/sbin", "/usr/sbin", "/opt/homebrew/bin"];

/// Wall-clock cap on one `man` render or one `--help` probe.
const SUBPROCESS_TIMEOUT: Duration = Duration::from_secs(10);

/// The note written at the top of the generated file.
const CATALOG_DOC: &str = "The baked command catalog. Entries sorted by name; regenerate with `cargo run -p tuggram --bin harvest`. Entries marked source=curated are hand-authored, survive every regeneration, and win on collision with a harvested grammar. A command absent from this file grades Unknown, which is the pre-grader path — absence costs nothing, a wrong grammar costs one band (Yes degrades to Maybe, never to No).";

struct Options {
    check: bool,
    probe_help: bool,
    probe_dirs: Vec<PathBuf>,
    out: PathBuf,
}

fn main() -> std::process::ExitCode {
    let options = match parse_args() {
        Ok(o) => o,
        Err(message) => {
            eprintln!("{message}");
            return std::process::ExitCode::from(2);
        }
    };

    let committed = match std::fs::read_to_string(&options.out) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("cannot read {}: {e}", options.out.display());
            return std::process::ExitCode::from(2);
        }
    };
    let curated = match curated_entries(&committed) {
        Ok(entries) => entries,
        Err(message) => {
            eprintln!("{message}");
            return std::process::ExitCode::from(2);
        }
    };
    eprintln!("carrying {} curated entries forward", curated.len());

    let names = tuggram::compute_path_commands();
    eprintln!("sweeping {} commands on the login PATH", names.len());

    let curated_names: BTreeSet<&str> = curated.iter().map(|e| e.name.as_str()).collect();
    let mut harvested = Vec::new();
    let mut silent = Vec::new();
    for name in &names {
        if curated_names.contains(name.as_str()) {
            continue;
        }
        let entry = render_man(name)
            .and_then(|page| distill_man(name, &page))
            .or_else(|| {
                if options.probe_help {
                    probe_help(name, &options.probe_dirs).and_then(|text| distill_help(name, &text))
                } else {
                    None
                }
            });
        match entry {
            Some(entry) => harvested.push(entry),
            None => silent.push(name.as_str()),
        }
    }

    let merged = merge(curated, harvested);
    let rendered = match render_catalog(&merged) {
        Ok(text) => text,
        Err(message) => {
            eprintln!("{message}");
            return std::process::ExitCode::from(2);
        }
    };

    report(&names, &merged, &silent);

    if options.check {
        if rendered == committed {
            eprintln!("check: the committed catalog is what this machine harvests");
            return std::process::ExitCode::SUCCESS;
        }
        eprintln!(
            "check: a fresh harvest differs from {}",
            options.out.display()
        );
        return std::process::ExitCode::from(1);
    }

    if let Err(e) = std::fs::write(&options.out, &rendered) {
        eprintln!("cannot write {}: {e}", options.out.display());
        return std::process::ExitCode::from(2);
    }
    eprintln!("wrote {}", options.out.display());
    std::process::ExitCode::SUCCESS
}

fn parse_args() -> Result<Options, String> {
    let mut options = Options {
        check: false,
        probe_help: false,
        probe_dirs: DEFAULT_PROBE_DIRS.iter().map(PathBuf::from).collect(),
        out: default_out_path(),
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--check" => options.check = true,
            "--probe-help" => options.probe_help = true,
            "--allow-dir" => {
                let dir = args.next().ok_or("--allow-dir needs a directory")?;
                options.probe_dirs.push(PathBuf::from(dir));
            }
            "--out" => {
                let out = args.next().ok_or("--out needs a path")?;
                options.out = PathBuf::from(out);
            }
            "--help" | "-h" => {
                return Err(
                    "usage: harvest [--check] [--probe-help] [--allow-dir DIR] [--out PATH]".into(),
                )
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(options)
}

/// The committed catalog's path, relative to this source file so the harvester
/// works from any working directory.
fn default_out_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("data")
        .join("commands.json")
}

/// The hand-authored entries already in the committed catalog. They are their
/// own source of truth — there is no second seed file to drift from the thing
/// it seeds.
fn curated_entries(committed: &str) -> Result<Vec<Entry>, String> {
    let file: CatalogFile = serde_json::from_str(committed).map_err(|e| e.to_string())?;
    Ok(file
        .commands
        .into_iter()
        .filter(|e| e.source == Source::Curated)
        .collect())
}

/// Render a command's man page as plain text. Executes `man` and nothing else.
fn render_man(name: &str) -> Option<String> {
    let output = run_bounded(
        Command::new("man")
            .arg(name)
            .env("MANPAGER", "cat")
            .env("PAGER", "cat")
            .env("MANWIDTH", "100"),
    )?;
    let text = String::from_utf8_lossy(&output).to_string();
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Run a command's `--help` — an execution, hence the allowlist, the stripped
/// environment, the closed stdin, and the timeout.
fn probe_help(name: &str, allowed: &[PathBuf]) -> Option<String> {
    let path = allowed
        .iter()
        .map(|dir| dir.join(name))
        .find(|p| p.is_file())?;
    let mut command = Command::new(&path);
    command.arg("--help").env_clear().env("PATH", "/usr/bin:/bin");
    let output = run_bounded(&mut command)?;
    let text = String::from_utf8_lossy(&output).to_string();
    if text.trim().is_empty() {
        None
    } else {
        Some(text)
    }
}

/// Run a subprocess with stdin closed and a wall-clock kill-timeout, returning
/// its stdout. Anything that fails, exits non-zero, or overruns yields `None`.
///
/// A reader thread drains stdout while the child runs. Waiting for the child
/// first and reading afterwards would deadlock on any output larger than the
/// pipe buffer — which is most man pages of any substance, so the failure would
/// look like "this command has no documentation" rather than like a bug.
fn run_bounded(command: &mut Command) -> Option<Vec<u8>> {
    use std::io::Read;

    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        let _ = tx.send(buffer);
    });
    let Ok(buffer) = rx.recv_timeout(SUBPROCESS_TIMEOUT) else {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    // Stdout reached EOF, so the child is done writing and this returns at once.
    let status = child.wait().ok()?;
    if status.success() {
        Some(buffer)
    } else {
        None
    }
}

/// Serialize the catalog deterministically, and refuse to write one that would
/// fail the integrity rules — a bad catalog caught here is an authoring error,
/// caught at runtime it is a truncated prompt.
fn render_catalog(entries: &[Entry]) -> Result<String, String> {
    let file = CatalogFile {
        doc: CATALOG_DOC.to_string(),
        commands: entries.to_vec(),
    };
    let mut text = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    text.push('\n');
    Catalog::parse(&text)?.check_integrity()?;
    Ok(text)
}

/// The sweep report: every PATH command is accounted for, either as a catalog
/// entry or as a name that yielded no grammar. A command that yields nothing is
/// not a failure — it grades Unknown, which is the pre-grader path.
fn report(swept: &[String], merged: &[Entry], silent: &[&str]) {
    let curated = merged
        .iter()
        .filter(|e| e.source == Source::Curated)
        .count();
    let from_man = merged.iter().filter(|e| e.source == Source::Man).count();
    let from_help = merged.iter().filter(|e| e.source == Source::Help).count();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    let _ = writeln!(out, "PATH commands swept: {}", swept.len());
    let _ = writeln!(
        out,
        "catalog entries: {} ({curated} curated, {from_man} man, {from_help} help)",
        merged.len()
    );
    let _ = writeln!(out, "no grammar found ({}), grading Unknown:", silent.len());
    for chunk in silent.chunks(8) {
        let _ = writeln!(out, "  {}", chunk.join(" "));
    }
}
