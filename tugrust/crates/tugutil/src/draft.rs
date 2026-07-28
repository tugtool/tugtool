//! The `draft` namespace — `tugutil draft set|show|clear` (Spec S02).
//!
//! Writes go through the running tugcast's `POST /api/draft` (port via the
//! [D09] CLI discovery order), so a short-lived CLI process never opens the
//! machine-global changes ledger read-write — one writer surface, one
//! journal, one pragma set. With `TUG_CHANGES_DB` set (test-harness
//! isolation), writes fall back to the direct local path against that
//! private file. Reads (`show`) open the ledger read-only. A skill-authored
//! draft is an authored draft: every `set` writes `edited=1`, so the draft
//! engine never clobbers it. `--project` travels as the user's own
//! spelling and the **server** canonicalizes it to the persisted row key
//! ([L29] — the CLI never canonicalizes); reads union the as-spelled and
//! legacy-realpath spellings (Spec S05).

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

/// Resolve `--project` (default cwd) to `(project, legacy)` spellings.
///
/// `project` is the path as the user spelled it, absolutized — the CLI
/// never canonicalizes ([L29]): the canonicalization gateway is the
/// tugcast server, which resolves this spelling to Claude form and keys
/// the row on the result. `legacy` is the `realpath(3)` spelling older
/// CLI builds used as their row key; it rides along solely so the server
/// supersedes/sweeps rows written under it.
fn resolve_project(project: Option<PathBuf>) -> Result<(String, String), AppError> {
    let cwd =
        std::env::current_dir().map_err(|e| AppError::Exit1(format!("cannot resolve cwd: {e}")))?;
    let raw = match project {
        Some(p) if p.is_absolute() => p,
        Some(p) => cwd.join(p),
        None => cwd,
    };
    let legacy = std::fs::canonicalize(&raw).unwrap_or_else(|_| raw.clone());
    Ok((
        raw.to_string_lossy().into_owned(),
        legacy.to_string_lossy().into_owned(),
    ))
}

/// The test-isolation escape: when `TUG_CHANGES_DB` points at a private
/// file, writes stay local instead of routing through tugcast. Production
/// never sets it, so production CLI writes always go through the server.
fn isolated_changes_db() -> bool {
    std::env::var_os(tugcore::instance::ENV_CHANGES_DB).is_some_and(|v| !v.is_empty())
}

/// Read-only open of the changes ledger for `show` and pre-write reads.
/// `None` when the file doesn't exist yet (no drafts on file).
fn open_changes_db_readonly() -> Option<Connection> {
    let path = tugcore::instance::changes_db_path();
    Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

/// POST one request to the running tugcast's `/api/draft`, discovering the
/// port per [D09]. Errors are actionable: no reachable tugcast means the
/// draft was NOT written.
fn post_draft_api(body: serde_json::Value) -> Result<serde_json::Value, AppError> {
    let port = crate::commands::tell::resolve_port(None, None).map_err(|e| {
        AppError::Exit1(format!(
            "draft writes go through the running Tug instance, but none was found ({e})"
        ))
    })?;
    let url = format!("http://127.0.0.1:{port}/api/draft");
    let response = ureq::post(&url)
        .send_json(body)
        .map_err(|e| AppError::Exit1(format!("cannot reach tugcast at {url}: {e}")))?;
    let value: serde_json::Value = response
        .into_body()
        .read_json()
        .map_err(|e| AppError::Exit1(format!("bad response from tugcast: {e}")))?;
    if value.get("status").and_then(|s| s.as_str()) != Some("ok") {
        let message = value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(AppError::Exit1(format!("draft request failed: {message}")));
    }
    Ok(value)
}

/// Decode the server's draft row into the CLI's output shape.
fn draft_row_from_api(row: &serde_json::Value) -> Result<DraftRow, AppError> {
    let s = |key: &str| {
        row.get(key)
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| AppError::Exit1(format!("malformed draft row: missing {key}")))
    };
    Ok(DraftRow {
        owner_kind: s("owner_kind")?,
        owner_id: s("owner_id")?,
        project_dir: s("project_dir")?,
        fingerprint: s("fingerprint")?,
        message: s("message")?,
        updated_at: row.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0),
        edited: row.get("edited").and_then(|v| v.as_bool()).unwrap_or(true),
        selection: row
            .get("selection")
            .and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()),
    })
}

/// Open the machine-global changes ledger as a WAL co-writer, creating the
/// `changeset_drafts` table when this CLI is the first writer. Reached only
/// under `TUG_CHANGES_DB` isolation (see [`isolated_changes_db`]).
fn open_changes_db() -> Result<Connection, AppError> {
    let path = tugcore::instance::changes_db_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let conn = tugcore::ledger_db::open(&path)
        .map_err(|e| AppError::Exit1(format!("cannot open changes ledger: {e}")))?;
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

/// Read one draft row under the Spec S05 spelling contract: the primary
/// spelling first, the fallback when it differs.
fn read_row(
    conn: &Connection,
    owner_kind: &str,
    owner_id: &str,
    primary: &str,
    fallback: &str,
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
    read(primary).or_else(|| (primary != fallback).then(|| read(fallback)).flatten())
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
    let (project_dir, legacy) = resolve_project(project)?;

    if !isolated_changes_db() {
        let selection = (!include.is_empty() || !exclude.is_empty())
            .then(|| serde_json::json!({"include": include, "exclude": exclude}).to_string());
        let mut body = serde_json::json!({
            "op": "set",
            "owner_kind": owner_kind,
            "owner_id": owner_id,
            "project_dir": project_dir,
            "raw_project_dir": legacy,
        });
        if let Some(m) = &message {
            body["message"] = serde_json::json!(m);
        }
        if let Some(sel) = &selection {
            body["selection"] = serde_json::json!(sel);
        }
        let response = post_draft_api(body)?;
        let row = response
            .get("row")
            .ok_or_else(|| AppError::Exit1("malformed response: missing row".to_string()))
            .and_then(draft_row_from_api)?;
        if json {
            print_ok("draft set", &row);
        } else {
            println!("draft set for {owner} ({})", row.project_dir);
        }
        return Ok(());
    }

    let conn = open_changes_db()?;

    let existing = read_row(&conn, &owner_kind, &owner_id, &project_dir, &legacy);
    let selection = if include.is_empty() && exclude.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e.selection.as_ref())
            .map(|v| v.to_string())
    } else {
        Some(serde_json::json!({"include": include, "exclude": exclude}).to_string())
    };
    let message = match message {
        Some(m) => m,
        None => existing
            .as_ref()
            .map(|e| e.message.clone())
            .unwrap_or_default(),
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
            project_dir,
            fingerprint,
            message,
            now_millis(),
            selection,
        ],
    )
    .map_err(|e| AppError::Exit1(format!("cannot write draft: {e}")))?;
    // A legacy-spelling row for the same owner is now stale — the row
    // just written supersedes it.
    if project_dir != legacy {
        let _ = conn.execute(
            "DELETE FROM changeset_drafts
             WHERE owner_kind = ?1 AND owner_id = ?2 AND project_dir = ?3",
            params![owner_kind, owner_id, legacy],
        );
    }

    let row =
        read_row(&conn, &owner_kind, &owner_id, &project_dir, &legacy).expect("row just written");
    if json {
        print_ok("draft set", &row);
    } else {
        println!("draft set for {owner} ({})", row.project_dir);
    }
    Ok(())
}

pub fn run_show(owner: String, project: Option<PathBuf>, json: bool) -> Result<(), AppError> {
    let (owner_kind, owner_id) = parse_owner(&owner)?;
    let (project_dir, legacy) = resolve_project(project)?;
    // Reads never need a writable ledger open; a missing file just means
    // no drafts exist yet.
    let Some(row) = open_changes_db_readonly()
        .and_then(|conn| read_row(&conn, &owner_kind, &owner_id, &project_dir, &legacy))
    else {
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

#[derive(Serialize)]
struct ClearData {
    owner: String,
    deleted: bool,
}

fn print_clear(owner: String, deleted: bool, json: bool) {
    if json {
        print_ok("draft clear", ClearData { owner, deleted });
    } else if deleted {
        println!("draft cleared for {owner}");
    } else {
        println!("no draft on file for {owner}");
    }
}

pub fn run_clear(owner: String, project: Option<PathBuf>, json: bool) -> Result<(), AppError> {
    let (owner_kind, owner_id) = parse_owner(&owner)?;
    let (project_dir, legacy) = resolve_project(project)?;

    if !isolated_changes_db() {
        let response = post_draft_api(serde_json::json!({
            "op": "clear",
            "owner_kind": owner_kind,
            "owner_id": owner_id,
            "project_dir": project_dir,
            "raw_project_dir": legacy,
        }))?;
        let deleted = response
            .get("deleted")
            .and_then(|d| d.as_bool())
            .unwrap_or(false);
        print_clear(owner, deleted, json);
        return Ok(());
    }

    let conn = open_changes_db()?;
    let mut deleted = conn
        .execute(
            "DELETE FROM changeset_drafts
             WHERE owner_kind = ?1 AND owner_id = ?2 AND project_dir = ?3",
            params![owner_kind, owner_id, project_dir],
        )
        .map_err(|e| AppError::Exit1(format!("cannot clear draft: {e}")))?;
    if project_dir != legacy {
        deleted += conn
            .execute(
                "DELETE FROM changeset_drafts
                 WHERE owner_kind = ?1 AND owner_id = ?2 AND project_dir = ?3",
                params![owner_kind, owner_id, legacy],
            )
            .unwrap_or(0);
    }
    print_clear(owner, deleted > 0, json);
    Ok(())
}
