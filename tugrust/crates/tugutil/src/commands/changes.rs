//! Implementation of the `tugutil changes` command.
//!
//! The authoritative "which files did this session change?" query. It reads
//! the `file_events` attribution rows tugcast records at the moment of
//! change (see `tugcast::feeds::attribution`) straight out of the shared
//! `sessions.db`, joins them against the current `git status` so
//! committed/reverted files drop out, and prints the surviving repo-relative
//! paths — or a machine-readable JSON contract the commit skill consumes.
//!
//! Living in tugutil (rather than an HTTP endpoint) keeps the commit skill's
//! call one clean command — `tugutil changes --json`, no port discovery, no
//! heredoc, no `cd`. The sqlite open is read-only, which is safe cross-process
//! against tugcast's WAL writer.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;

/// One file in the `--json` contract (`{path, op, origin, ambiguous,
/// git_status}`). `git_status` is the porcelain-v1-style two-char code
/// (`" M"`, `"M "`, `"??"`, …), or empty for a `--all` row whose file is no
/// longer dirty.
#[derive(Debug, Clone, Serialize)]
struct ChangeFile {
    path: String,
    op: String,
    origin: String,
    ambiguous: bool,
    git_status: String,
}

/// The `--json` output shape — the commit-skill contract per Spec S04.
#[derive(Debug, Clone, Serialize)]
struct ChangesJson {
    session: String,
    project: String,
    files: Vec<ChangeFile>,
}

/// Run the `changes` command.
///
/// `session` defaults from `$TUG_SESSION_ID`; `project` defaults to cwd.
/// `all` keeps events whose file is no longer dirty (committed/reverted)
/// instead of dropping them. Returns exit code 2 when no session id is
/// available or the id is unknown to the ledger.
pub fn run_changes(
    session: Option<String>,
    project: Option<String>,
    all: bool,
    json: bool,
    quiet: bool,
) -> Result<i32, String> {
    let session = session
        .or_else(|| std::env::var("TUG_SESSION_ID").ok())
        .filter(|s| !s.is_empty());
    let session = match session {
        Some(s) => s,
        None => {
            eprintln!(
                "error: no session id — run inside a Session-card session (which sets \
                 $TUG_SESSION_ID) or pass --session <id>"
            );
            return Ok(2);
        }
    };

    let project_dir = match project {
        Some(p) => PathBuf::from(p),
        None => std::env::current_dir().map_err(|e| format!("cannot resolve cwd: {e}"))?,
    };
    // Repo-relative projection + the git-status join both key off the repo
    // root; fall back to the project dir when it isn't a git repo (then the
    // status map is empty and everything is treated as non-dirty).
    let repo_root = git_repo_root(&project_dir).unwrap_or_else(|| project_dir.clone());

    let db_path = match resolve_sessions_db_path() {
        Some(p) if p.exists() => p,
        _ => {
            // No ledger on disk → the session can't be known.
            eprintln!("error: session '{session}' unknown (no session ledger found)");
            return Ok(2);
        }
    };
    let conn = open_readonly(&db_path)?;

    let (files, known) = compute_changes(&conn, &repo_root, &session, all)?;
    if files.is_empty() && !known {
        eprintln!("error: session '{session}' unknown to the ledger");
        return Ok(2);
    }

    if json {
        let project = repo_root.to_string_lossy().into_owned();
        println!("{}", render_json(&session, &project, &files)?);
    } else {
        // Plain output: one repo-relative path per line, EXCLUDING ambiguous
        // rows (the skill must opt into those via --json, where the flag is
        // visible). Note any omission on stderr so it isn't silent.
        let (stdout, omitted) = render_plain(&files);
        if !quiet && !stdout.is_empty() {
            println!("{stdout}");
        }
        if omitted > 0 {
            eprintln!("{omitted} ambiguous file(s) omitted — use --json to see them");
        }
    }
    Ok(0)
}

/// Query, join, dedup, and filter the session's file events into the sorted
/// changeset — the pure core of `run_changes`, exercised directly by tests.
/// Returns the surviving files and whether the session is known to the
/// ledger (an unknown id with no events is the exit-2 case).
fn compute_changes(
    conn: &Connection,
    repo_root: &Path,
    session: &str,
    all: bool,
) -> Result<(Vec<ChangeFile>, bool), String> {
    let events = query_events(conn, session)?;
    let known = session_exists(conn, session)?;
    let status_map = git_status_map(repo_root);

    // Dedup per repo-relative path: latest event wins for op/origin (rows are
    // ordered oldest-first), ambiguity is OR-ed across every event that
    // touched the path (any ambiguous bracket taints the file).
    let mut order: Vec<String> = Vec::new();
    let mut by_path: HashMap<String, ChangeFile> = HashMap::new();
    for ev in &events {
        let rel = repo_relative(repo_root, &ev.file_path);
        let git_status = status_map.get(&rel).cloned().unwrap_or_default();
        let entry = by_path.entry(rel.clone()).or_insert_with(|| {
            order.push(rel.clone());
            ChangeFile {
                path: rel.clone(),
                op: ev.op.clone(),
                origin: ev.origin.clone(),
                ambiguous: false,
                git_status: git_status.clone(),
            }
        });
        entry.op = ev.op.clone();
        entry.origin = ev.origin.clone();
        entry.ambiguous |= ev.ambiguous;
        entry.git_status = git_status;
    }

    // Drop files no longer dirty unless --all (the git-status join): a file
    // that was committed or reverted since the event is no longer a change.
    let mut files: Vec<ChangeFile> = order
        .into_iter()
        .filter_map(|p| by_path.remove(&p))
        .filter(|f| all || !f.git_status.is_empty())
        .collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok((files, known))
}

/// Render the plain listing: the newline-joined non-ambiguous paths plus a
/// count of the ambiguous files omitted (surfaced on stderr by the caller).
fn render_plain(files: &[ChangeFile]) -> (String, usize) {
    let lines: Vec<&str> = files
        .iter()
        .filter(|f| !f.ambiguous)
        .map(|f| f.path.as_str())
        .collect();
    let omitted = files.iter().filter(|f| f.ambiguous).count();
    (lines.join("\n"), omitted)
}

/// Render the `--json` contract (Spec S04), ambiguous files included with
/// the flag set.
fn render_json(session: &str, project: &str, files: &[ChangeFile]) -> Result<String, String> {
    let out = ChangesJson {
        session: session.to_owned(),
        project: project.to_owned(),
        files: files.to_vec(),
    };
    serde_json::to_string_pretty(&out).map_err(|e| e.to_string())
}

/// A single decoded `file_events` row, in `at`-ascending order.
struct EventRow {
    file_path: String,
    op: String,
    origin: String,
    ambiguous: bool,
}

/// Open `sessions.db` read-only. WAL semantics make a read-only open safe
/// while tugcast writes concurrently.
fn open_readonly(db_path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("cannot open session ledger {}: {e}", db_path.display()))
}

/// All `file_events` for `session`, oldest-first (matching the ledger's own
/// `file_events_for_session` order).
fn query_events(conn: &Connection, session: &str) -> Result<Vec<EventRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT file_path, op, origin, ambiguous
             FROM file_events
             WHERE tug_session_id = ?1
             ORDER BY at ASC, tool_use_id ASC, file_path ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([session], |r| {
            Ok(EventRow {
                file_path: r.get::<_, String>(0)?,
                op: r.get::<_, String>(1)?,
                origin: r.get::<_, String>(2)?,
                ambiguous: r.get::<_, i64>(3)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Whether a `sessions` row exists for `session` — the "known vs unknown"
/// test that separates a valid session with no changes (exit 0, empty list)
/// from a bogus id (exit 2).
fn session_exists(conn: &Connection, session: &str) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE session_id = ?1",
            [session],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

/// Resolve the on-disk `sessions.db` path, mirroring
/// `tugcast::session_ledger::SessionLedger::default_path`: the per-instance
/// location when `TUG_INSTANCE_ID` is set, else the legacy single-instance
/// path under the platform data dir.
fn resolve_sessions_db_path() -> Option<PathBuf> {
    if let Some(p) = tugcore::instance::sessions_db_path() {
        return Some(p);
    }
    let base = dirs::data_dir()?;
    #[cfg(target_os = "macos")]
    let dir = base.join("Tug");
    #[cfg(not(target_os = "macos"))]
    let dir = base.join("tugcast");
    Some(dir.join("sessions.db"))
}

/// The repo root for `dir` via `git rev-parse --show-toplevel`, or `None`
/// when `dir` isn't in a git working tree.
fn git_repo_root(dir: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .args(["-C", &dir.to_string_lossy(), "rev-parse", "--show-toplevel"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        None
    } else {
        Some(PathBuf::from(root))
    }
}

/// Project an absolute event `file_path` to a repo-relative string. Falls
/// back to the raw path when it doesn't live under `repo_root` (shouldn't
/// happen for a same-repo session, but never panics).
fn repo_relative(repo_root: &Path, file_path: &str) -> String {
    let p = Path::new(file_path);
    match p.strip_prefix(repo_root) {
        Ok(rel) => rel.to_string_lossy().into_owned(),
        Err(_) => file_path.to_string(),
    }
}

/// Build a `repo-relative path → git-status` map from `git status
/// --porcelain=v2` run at `repo_root`. Status is normalized to the familiar
/// two-char porcelain-v1 form (`.` positions rendered as spaces; untracked
/// as `"??"`). An empty map on any git failure (non-repo, git error) — then
/// every event reads as non-dirty and drops from the default listing.
fn git_status_map(repo_root: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let output = match Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "status",
            "--porcelain=v2",
        ])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => return map,
    };
    let text = String::from_utf8_lossy(&output);
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("1 ") {
            // XY sub mH mI mW hH hI path
            let fields: Vec<&str> = rest.splitn(8, ' ').collect();
            if fields.len() >= 8 && !fields[0].is_empty() && !fields[7].is_empty() {
                map.insert(fields[7].to_owned(), normalize_xy(fields[0]));
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // XY sub mH mI mW hH hI Xscore path\torig
            let fields: Vec<&str> = rest.splitn(9, ' ').collect();
            if fields.len() >= 9 {
                let new_path = fields[8].split('\t').next().unwrap_or(fields[8]);
                if !new_path.is_empty() {
                    map.insert(new_path.to_owned(), normalize_xy(fields[0]));
                }
            }
        } else if let Some(path) = line.strip_prefix("? ") {
            map.insert(path.to_owned(), "??".to_owned());
        }
    }
    map
}

/// Render a porcelain-v2 `XY` (which uses `.` for an unchanged position)
/// as the porcelain-v1 two-char code (`.` → space).
fn normalize_xy(xy: &str) -> String {
    xy.chars().map(|c| if c == '.' { ' ' } else { c }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_xy_renders_dots_as_spaces() {
        assert_eq!(normalize_xy(".M"), " M");
        assert_eq!(normalize_xy("M."), "M ");
        assert_eq!(normalize_xy("MM"), "MM");
    }

    #[test]
    fn repo_relative_strips_root_and_falls_back() {
        let root = Path::new("/repo");
        assert_eq!(repo_relative(root, "/repo/src/a.rs"), "src/a.rs");
        assert_eq!(repo_relative(root, "/elsewhere/x"), "/elsewhere/x");
    }

    // ---- integration: real temp sessions.db + real temp git repo -----

    /// A git repo with one committed (clean) file and, for each name in
    /// `untracked`, an untracked (dirty) file.
    fn init_repo(untracked: &[&str]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        let git = |args: &[&str]| {
            assert!(
                std::process::Command::new("git")
                    .args(args)
                    .current_dir(root)
                    .output()
                    .expect("git")
                    .status
                    .success(),
                "git {args:?}"
            );
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t.test"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(root.join("clean.rs"), "clean\n").unwrap();
        git(&["add", "clean.rs"]);
        git(&["commit", "-q", "-m", "init"]);
        for name in untracked {
            std::fs::write(root.join(name), "dirty\n").unwrap();
        }
        dir
    }

    /// A sessions.db with the columns `changes` reads, seeded with one
    /// session row plus the given events `(file_path, op, origin, ambiguous, at)`.
    fn seed_db(session: &str, events: &[(String, &str, &str, bool, i64)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let conn = Connection::open(dir.path().join("sessions.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (session_id TEXT PRIMARY KEY);
             CREATE TABLE file_events (
                tug_session_id TEXT, tool_use_id TEXT, file_path TEXT,
                tool_name TEXT, op TEXT, origin TEXT, ambiguous INTEGER,
                parent_tool_use_id TEXT, project_dir TEXT, at INTEGER);",
        )
        .unwrap();
        conn.execute("INSERT INTO sessions (session_id) VALUES (?1)", [session])
            .unwrap();
        for (i, (path, op, origin, amb, at)) in events.iter().enumerate() {
            conn.execute(
                "INSERT INTO file_events
                    (tug_session_id, tool_use_id, file_path, tool_name, op, origin, ambiguous, project_dir, at)
                 VALUES (?1, ?2, ?3, 'Write', ?4, ?5, ?6, '/p', ?7)",
                rusqlite::params![session, format!("tu-{i}"), path, op, origin, i64::from(*amb), at],
            )
            .unwrap();
        }
        dir
    }

    #[test]
    fn changeset_joins_git_status_and_drops_committed_files() {
        let repo = init_repo(&["dirty.rs"]);
        let root = repo.path();
        let events = vec![
            (
                root.join("dirty.rs").to_string_lossy().into_owned(),
                "write",
                "exact",
                false,
                2,
            ),
            // clean.rs is committed/unmodified → not in git status → dropped.
            (
                root.join("clean.rs").to_string_lossy().into_owned(),
                "edit",
                "exact",
                false,
                1,
            ),
        ];
        let db = seed_db("s1", &events);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();

        // Default: only the dirty file survives the git-status join.
        let (files, known) = compute_changes(&conn, root, "s1", false).unwrap();
        assert!(known);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "dirty.rs");
        assert_eq!(files[0].op, "write");
        assert_eq!(files[0].git_status, "??");

        // --all keeps the committed file too (git_status empty).
        let (all_files, _) = compute_changes(&conn, root, "s1", true).unwrap();
        let paths: Vec<&str> = all_files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["clean.rs", "dirty.rs"]);
        let clean = all_files.iter().find(|f| f.path == "clean.rs").unwrap();
        assert_eq!(clean.git_status, "");
    }

    #[test]
    fn ambiguous_rows_excluded_from_plain_included_in_json() {
        let repo = init_repo(&["a.rs", "amb.rs"]);
        let root = repo.path();
        let events = vec![
            (
                root.join("a.rs").to_string_lossy().into_owned(),
                "write",
                "exact",
                false,
                1,
            ),
            (
                root.join("amb.rs").to_string_lossy().into_owned(),
                "modified",
                "bash",
                true,
                2,
            ),
        ];
        let db = seed_db("s1", &events);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();
        let (files, _) = compute_changes(&conn, root, "s1", false).unwrap();

        // Plain: ambiguous omitted, one path listed, omitted count noted.
        let (stdout, omitted) = render_plain(&files);
        assert_eq!(stdout, "a.rs");
        assert_eq!(omitted, 1);

        // JSON: both files present, the bash one flagged ambiguous.
        let json = render_json("s1", "/p", &files).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["session"], "s1");
        let arr = parsed["files"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        let amb = arr.iter().find(|f| f["path"] == "amb.rs").unwrap();
        assert_eq!(amb["ambiguous"], true);
        assert_eq!(amb["op"], "modified");
        assert_eq!(amb["origin"], "bash");
        let a = arr.iter().find(|f| f["path"] == "a.rs").unwrap();
        assert_eq!(a["ambiguous"], false);
    }

    #[test]
    fn unknown_session_is_not_known_and_has_no_files() {
        let repo = init_repo(&[]);
        let db = seed_db("s1", &[]);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();
        // A different id was never inserted → unknown (exit-2 case).
        let (files, known) = compute_changes(&conn, repo.path(), "ghost", false).unwrap();
        assert!(!known);
        assert!(files.is_empty());
        // The seeded id is known even with no events.
        let (_, known_s1) = compute_changes(&conn, repo.path(), "s1", false).unwrap();
        assert!(known_s1);
    }

    #[test]
    fn multiple_events_on_one_path_dedup_latest_wins_and_ors_ambiguous() {
        let repo = init_repo(&["a.rs"]);
        let root = repo.path();
        let p = root.join("a.rs").to_string_lossy().into_owned();
        let events = vec![
            (p.clone(), "write", "exact", false, 1),
            (p.clone(), "modified", "bash", true, 2), // later + ambiguous
        ];
        let db = seed_db("s1", &events);
        let conn = open_readonly(&db.path().join("sessions.db")).unwrap();
        let (files, _) = compute_changes(&conn, root, "s1", false).unwrap();
        assert_eq!(files.len(), 1, "one row per path");
        assert_eq!(files[0].op, "modified", "latest event wins");
        assert!(files[0].ambiguous, "ambiguity OR-ed across events");
    }
}
