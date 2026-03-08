//! DefaultsStore struct and implementation.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

use crate::Error;
use crate::domain::DomainHandle;

/// A SQLite-backed typed defaults store.
///
/// `DefaultsStore` wraps a `rusqlite::Connection` in a `Mutex` to provide
/// `Send + Sync` access. All domain operations go through a [`DomainHandle`]
/// obtained via [`domain`](DefaultsStore::domain).
pub struct DefaultsStore {
    pub(crate) conn: Mutex<Connection>,
}

// Compile-time assertion that DefaultsStore is Send + Sync.
const _: () = {
    fn _assert_send_sync<T: Send + Sync>() {}
    fn _check() {
        _assert_send_sync::<DefaultsStore>();
    }
};

impl DefaultsStore {
    /// Open or create a tugbank database at the given path.
    ///
    /// Sets WAL mode, busy_timeout=5000, synchronous=NORMAL, foreign_keys=ON.
    /// Bootstraps schema if missing; runs migrations if schema_version is older.
    pub fn open(_path: impl AsRef<Path>) -> Result<Self, Error> {
        unimplemented!("DefaultsStore::open not yet implemented")
    }

    /// Get a handle to a specific domain.
    ///
    /// The domain row is created lazily on first write.
    pub fn domain(&self, _name: &str) -> Result<DomainHandle<'_>, Error> {
        unimplemented!("DefaultsStore::domain not yet implemented")
    }

    /// List all domain names in the database.
    pub fn list_domains(&self) -> Result<Vec<String>, Error> {
        let _conn = self.conn.lock().unwrap();
        unimplemented!("DefaultsStore::list_domains not yet implemented")
    }
}
