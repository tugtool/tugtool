//! Schema bootstrap and migration logic for tugbank-core.

use rusqlite::Connection;

use crate::Error;

/// The current schema version produced by [`bootstrap_schema`].
const CURRENT_SCHEMA_VERSION: u64 = 1;

/// Apply required SQLite pragmas to a connection.
///
/// Sets `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`,
/// and `synchronous=NORMAL`. Called unconditionally on every database open.
#[allow(dead_code)]
pub(crate) fn apply_pragmas(conn: &Connection) -> Result<(), Error> {
    // WAL mode must be set with execute_batch; the others can use pragma_update.
    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.pragma_update(None, "foreign_keys", 1i64)?;
    conn.pragma_update(None, "busy_timeout", 5000i64)?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

/// Bootstrap the schema on a fresh database.
///
/// Creates the `meta`, `domains`, and `entries` tables plus the domain index,
/// then inserts `schema_version = '1'` into the `meta` table.
/// Uses `CREATE TABLE IF NOT EXISTS` and `INSERT OR REPLACE`, so calling
/// this function on a database that already has the schema is safe (idempotent).
#[allow(dead_code)]
pub(crate) fn bootstrap_schema(conn: &Connection) -> Result<(), Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS domains (
            name        TEXT PRIMARY KEY,
            generation  INTEGER NOT NULL DEFAULT 0,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS entries (
            domain       TEXT NOT NULL,
            key          TEXT NOT NULL,
            value_kind   INTEGER NOT NULL,
            value_i64    INTEGER,
            value_f64    REAL,
            value_text   TEXT,
            value_blob   BLOB,
            updated_at   TEXT NOT NULL,
            PRIMARY KEY (domain, key),
            FOREIGN KEY (domain) REFERENCES domains(name) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_entries_domain ON entries(domain);

        INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
        ",
    )?;
    Ok(())
}

/// Read the current schema version from the `meta` table.
///
/// Returns `None` if the table doesn't exist or the key is absent.
#[allow(dead_code)]
fn read_schema_version(conn: &Connection) -> Option<u64> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = 'schema_version'",
        [],
        |row| {
            let s: String = row.get(0)?;
            Ok(s)
        },
    )
    .ok()
    .and_then(|s: String| s.parse::<u64>().ok())
}

/// Ensure the schema is up to date.
///
/// Reads `schema_version` from the `meta` table. If missing, calls
/// [`bootstrap_schema`] to create the full schema. If present and older
/// than [`CURRENT_SCHEMA_VERSION`], runs versioned migrations inside a
/// transaction so failures roll back cleanly.
///
/// This function is called on every [`DefaultsStore::open`](crate::DefaultsStore::open).
#[allow(dead_code)]
pub(crate) fn migrate_schema(conn: &Connection) -> Result<(), Error> {
    let version = read_schema_version(conn);

    match version {
        None => {
            // Fresh database — bootstrap everything.
            bootstrap_schema(conn)?;
        }
        Some(v) if v < CURRENT_SCHEMA_VERSION => {
            // Run incremental migrations inside a transaction.
            // v1 is the only version in this phase, so there are no
            // migrations to apply yet. This branch is here for future phases.
            conn.execute_batch("BEGIN;")?;
            let result = run_migrations(conn, v);
            match result {
                Ok(()) => {
                    conn.execute_batch("COMMIT;")?;
                }
                Err(e) => {
                    conn.execute_batch("ROLLBACK;").ok();
                    return Err(e);
                }
            }
        }
        Some(_) => {
            // Already at current version — nothing to do.
        }
    }

    Ok(())
}

/// Apply any schema migrations needed to bring `from_version` up to
/// [`CURRENT_SCHEMA_VERSION`].
///
/// Called inside a transaction by [`migrate_schema`].
#[allow(dead_code)]
fn run_migrations(conn: &Connection, from_version: u64) -> Result<(), Error> {
    // No migrations exist in phase 5e1 (v1 is the only version).
    // Future phases add `if from_version < N { ... }` blocks here.
    let _ = (conn, from_version);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(test)]
    use tempfile::NamedTempFile;

    fn open_in_memory() -> Connection {
        Connection::open_in_memory().expect("in-memory connection failed")
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0)
            > 0
    }

    #[test]
    fn test_bootstrap_creates_all_tables() {
        let conn = open_in_memory();
        bootstrap_schema(&conn).expect("bootstrap should succeed");

        assert!(table_exists(&conn, "meta"), "meta table missing");
        assert!(table_exists(&conn, "domains"), "domains table missing");
        assert!(table_exists(&conn, "entries"), "entries table missing");

        // schema_version row should be present
        let version = read_schema_version(&conn);
        assert_eq!(version, Some(1));
    }

    #[test]
    fn test_bootstrap_is_idempotent() {
        let conn = open_in_memory();
        bootstrap_schema(&conn).expect("first bootstrap should succeed");
        bootstrap_schema(&conn).expect("second bootstrap should succeed");

        // Still exactly one schema_version row
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_migrate_schema_bootstraps_fresh_db() {
        let conn = open_in_memory();
        // No meta table yet — migrate_schema should detect this and bootstrap.
        migrate_schema(&conn).expect("migrate on fresh db should succeed");

        assert!(table_exists(&conn, "meta"));
        assert!(table_exists(&conn, "domains"));
        assert!(table_exists(&conn, "entries"));
        assert_eq!(read_schema_version(&conn), Some(1));
    }

    #[test]
    fn test_apply_pragmas_sets_wal_mode() {
        let conn = open_in_memory();
        apply_pragmas(&conn).expect("apply_pragmas should succeed");

        // In-memory databases always report "memory" for journal_mode,
        // but the pragma call itself must not error. We verify it
        // completes cleanly; WAL is confirmed on a file-backed DB below.
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal_mode query failed");
        assert!(
            journal_mode == "memory" || journal_mode == "wal",
            "unexpected journal_mode: {journal_mode}"
        );
    }

    #[test]
    fn test_apply_pragmas_sets_wal_mode_file_backed() {
        // Use a real file to confirm WAL mode is actually applied.
        let tmp = NamedTempFile::new().expect("temp file failed");
        let conn = Connection::open(tmp.path()).expect("open failed");
        apply_pragmas(&conn).expect("apply_pragmas should succeed");

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("journal_mode query failed");
        assert_eq!(journal_mode, "wal", "file-backed DB should be in WAL mode");
    }
}
