//! The `draft` namespace — `tugutil draft set|show|clear` (Spec S02).
//!
//! Writes the maintained landing draft straight into the machine-global
//! changes ledger (`tugcore::instance::changes_db_path()`, `TUG_CHANGES_DB`
//! overridable) as a WAL co-writer — the same contract multiple tugcast
//! instances already rely on ([D112]). A skill-authored draft is an authored
//! draft: every `set` writes `edited=1`, so the draft engine never clobbers
//! it. `--project` is canonicalized on write (Spec S05); reads query the
//! canonical spelling and union the raw one when it differs.

use std::path::PathBuf;

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::changes::AppError;
use crate::output::print_ok;

/// One draft row as the CLI reads/writes it — mirrors
/// `changes.changeset_drafts`.
#[derive(Debug, Clone, Serialize)]
pub struct DraftRow {
    pub owner_kind: String,
    pub owner_id: String,
    pub project_dir: String,
    pub fingerprint: String,
    pub message: String,
    pub updated_at: i64,
    pub edited: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<serde_json::Value>,
}

/// Parse `--owner`: `session:<id>`, `dash:<name>`, or `unattributed`. A dash
/// owner normalizes to the branch-ref id the ledger stores
/// (`tugdash/<name>`), accepting either the bare name or the full ref.
fn parse_owner(owner: &str) -> Result<(String, String), AppError> {
    if owner == "unattributed" {
        return Ok(("unattributed".to_string(), String::new()));
    }
    if let Some(id) = owner.strip_prefix("session:") {
        if id.is_empty() {
            return Err(AppError::Exit1("empty session id in --owner".to_string()));
        }
        return Ok(("session".to_string(), id.to_string()));
    }
    if let Some(name) = owner.strip_prefix("dash:") {
        let name = name.strip_prefix("tugdash/").unwrap_or(name);
        if name.is_empty() {
            return Err(AppError::Exit1("empty dash name in --owner".to_string()));
        }
        return Ok(("dash".to_string(), format!("tugdash/{name}")));
    }
    Err(AppError::Exit1(format!(
        "invalid --owner '{owner}': expected session:<id>, dash:<name>, or unattributed"
    )))
}

/// Resolve `--project` (default cwd) to `(canonical, raw)` spellings.
fn resolve_project(project: Option<PathBuf>) -> Result<(String, String), AppError> {
    let raw = match project {
        Some(p) => p,
        None => std::env::current_dir()
            .map_err(|e| AppError::Exit1(format!("cannot resolve cwd: {e}")))?,
    };
    let canonical = std::fs::canonicalize(&raw).unwrap_or_else(|_| raw.clone());
    Ok((
        canonical.to_string_lossy().into_owned(),
        raw.to_string_lossy().into_owned(),
    ))
}

/// Open the machine-global changes ledger as a WAL co-writer, creating the
/// `changeset_drafts` table when this CLI is the first writer.
fn open_changes_db() -> Result<Connection, AppError> {
    let path = tugcore::instance::changes_db_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = Connection::open(&path)
        .map_err(|e| AppError::Exit1(format!("cannot open changes ledger: {e}")))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .and_then(|_| conn.pragma_update(None, "busy_timeout", 5000i64))
        .and_then(|_| conn.pragma_update(None, "synchronous", "NORMAL"))
        .map_err(|e| AppError::Exit1(format!("cannot configure changes ledger: {e}")))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS changeset_drafts (
            owner_kind   TEXT NOT NULL,
            owner_id     TEXT NOT NULL,
            project_dir  TEXT NOT NULL,
            fingerprint  TEXT NOT NULL,
            message      TEXT NOT NULL,
            updated_at   INTEGER NOT NULL,
            edited       INTEGER NOT NULL DEFAULT 0,
            selection    TEXT,
            PRIMARY KEY (owner_kind, owner_id, project_dir)
        );",
    )
    .map_err(|e| AppError::Exit1(format!("cannot bootstrap changes ledger: {e}")))?;
    Ok(conn)
}

/// Read one draft row under the Spec S05 spelling contract: canonical first,
/// raw fallback.
fn read_row(
    conn: &Connection,
    owner_kind: &str,
    owner_id: &str,
    canonical: &str,
    raw: &str,
) -> Option<DraftRow> {
    let read = |project: &str| -> Option<DraftRow> {
        conn.query_row(
            "SELECT owner_kind, owner_id, project_dir, fingerprint, message, updated_at,
                    edited, selection
             FROM changeset_drafts
             WHERE owner_kind = ?1 AND owner_id = ?2 AND project_dir = ?3",
            params![owner_kind, owner_id, project],
            |row| {
                Ok(DraftRow {
                    owner_kind: row.get(0)?,
                    owner_id: row.get(1)?,
                    project_dir: row.get(2)?,
                    fingerprint: row.get(3)?,
                    message: row.get(4)?,
                    updated_at: row.get(5)?,
                    edited: row.get::<_, i64>(6)? != 0,
                    selection: row
                        .get::<_, Option<String>>(7)?
                        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
                })
            },
        )
        .ok()
    };
    read(canonical).or_else(|| (canonical != raw).then(|| read(raw)).flatten())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn run_set(
    owner: String,
    project: Option<PathBuf>,
    message: Option<String>,
    include: Vec<String>,
    exclude: Vec<String>,
    json: bool,
) -> Result<(), AppError> {
    let (owner_kind, owner_id) = parse_owner(&owner)?;
    let (canonical, raw) = resolve_project(project)?;
    let conn = open_changes_db()?;

    let existing = read_row(&conn, &owner_kind, &owner_id, &canonical, &raw);
    let selection = if include.is_empty() && exclude.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e.selection.as_ref())
            .map(|v| v.to_string())
    } else {
        Some(
            serde_json::json!({"include": include, "exclude": exclude}).to_string(),
        )
    };
    let message = match message {
        Some(m) => m,
        None => existing.as_ref().map(|e| e.message.clone()).unwrap_or_default(),
    };
    if message.trim().is_empty() {
        return Err(AppError::Exit1(
            "nothing to set: no --message given and no draft on file".to_string(),
        ));
    }
    let fingerprint = existing
        .as_ref()
        .map(|e| e.fingerprint.clone())
        .unwrap_or_default();
    conn.execute(
        "INSERT OR REPLACE INTO changeset_drafts (
            owner_kind, owner_id, project_dir, fingerprint, message, updated_at,
            edited, selection
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
        params![
            owner_kind,
            owner_id,
            canonical,
            fingerprint,
            message,
            now_millis(),
            selection,
        ],
    )
    .map_err(|e| AppError::Exit1(format!("cannot write draft: {e}")))?;
    // A raw-spelling row for the same owner is now stale — the canonical row
    // supersedes it.
    if canonical != raw {
        let _ = conn.execute(
            "DELETE FROM changeset_drafts
             WHERE owner_kind = ?1 AND owner_id = ?2 AND project_dir = ?3",
            params![owner_kind, owner_id, raw],
        );
    }

    let row = read_row(&conn, &owner_kind, &owner_id, &canonical, &raw)
        .expect("row just written");
    if json {
        print_ok("draft set", &row);
    } else {
        println!("draft set for {owner} ({})", row.project_dir);
    }
    Ok(())
}

pub fn run_show(owner: String, project: Option<PathBuf>, json: bool) -> Result<(), AppError> {
    let (owner_kind, owner_id) = parse_owner(&owner)?;
    let (canonical, raw) = resolve_project(project)?;
    let conn = open_changes_db()?;
    let Some(row) = read_row(&conn, &owner_kind, &owner_id, &canonical, &raw) else {
        return Err(AppError::Exit1(format!("no draft on file for {owner}")));
    };
    if json {
        print_ok("draft show", &row);
    } else {
        println!("{}", row.message);
        if let Some(selection) = &row.selection {
            let paths = |key: &str| -> Vec<String> {
                selection
                    .get(key)
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|p| p.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default()
            };
            let include = paths("include");
            let exclude = paths("exclude");
            if !include.is_empty() {
                println!("include: {}", include.join(", "));
            }
            if !exclude.is_empty() {
                println!("exclude: {}", exclude.join(", "));
            }
        }
    }
    Ok(())
}

pub fn run_clear(owner: String, project: Option<PathBuf>, json: bool) -> Result<(), AppError> {
    let (owner_kind, owner_id) = parse_owner(&owner)?;
    let (canonical, raw) = resolve_project(project)?;
    let conn = open_changes_db()?;
    let mut deleted = conn
        .execute(
            "DELETE FROM changeset_drafts
             WHERE owner_kind = ?1 AND owner_id = ?2 AND project_dir = ?3",
            params![owner_kind, owner_id, canonical],
        )
        .map_err(|e| AppError::Exit1(format!("cannot clear draft: {e}")))?;
    if canonical != raw {
        deleted += conn
            .execute(
                "DELETE FROM changeset_drafts
                 WHERE owner_kind = ?1 AND owner_id = ?2 AND project_dir = ?3",
                params![owner_kind, owner_id, raw],
            )
            .unwrap_or(0);
    }
    #[derive(Serialize)]
    struct ClearData {
        owner: String,
        deleted: bool,
    }
    if json {
        print_ok(
            "draft clear",
            ClearData {
                owner,
                deleted: deleted > 0,
            },
        );
    } else if deleted > 0 {
        println!("draft cleared for {owner}");
    } else {
        println!("no draft on file for {owner}");
    }
    Ok(())
}
