//! TugbankClient — in-memory cached client wrapping DefaultsStore.
//!
//! `TugbankClient` wraps a [`DefaultsStore`] with an in-memory domain-snapshot
//! cache. External changes are detected via Unix domain socket notifications.
//! When a notification arrives for a cached domain, the snapshot is reloaded
//! from the database and registered callbacks are fired.
//!
//! # Thread safety
//!
//! `TugbankClient` is `Send + Sync` and intended to be shared via `Arc`.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::notify::{ListenerHandle, broadcast_domain_changed, start_listener};
use crate::{DefaultsStore, Error, Value};

/// A snapshot of all key-value pairs for a single domain.
pub type DomainSnapshot = BTreeMap<String, Value>;

// ── Callback registry ────────────────────────────────────────────────────────

type Callback = Box<dyn Fn(&str, &DomainSnapshot) + Send + 'static>;

struct CallbackRegistry {
    next_id: u64,
    callbacks: HashMap<u64, Callback>,
}

impl CallbackRegistry {
    fn new() -> Self {
        Self {
            next_id: 0,
            callbacks: HashMap::new(),
        }
    }

    fn register(&mut self, cb: Callback) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.callbacks.insert(id, cb);
        id
    }

    fn unregister(&mut self, id: u64) {
        self.callbacks.remove(&id);
    }

    fn fire(&self, domain: &str, snapshot: &DomainSnapshot) {
        for cb in self.callbacks.values() {
            cb(domain, snapshot);
        }
    }
}

// ── CallbackHandle ───────────────────────────────────────────────────────────

/// Returned by [`TugbankClient::on_domain_changed`].
///
/// Unregisters the callback when dropped.
pub struct CallbackHandle {
    id: u64,
    registry: Arc<Mutex<CallbackRegistry>>,
}

impl Drop for CallbackHandle {
    fn drop(&mut self) {
        if let Ok(mut reg) = self.registry.lock() {
            reg.unregister(self.id);
        }
    }
}

// ── Internal shared state ────────────────────────────────────────────────────

struct Inner {
    store: DefaultsStore,
    cache: Mutex<HashMap<String, DomainSnapshot>>,
    callbacks: Arc<Mutex<CallbackRegistry>>,
}

// ── TugbankClient ────────────────────────────────────────────────────────────

/// In-memory cached client wrapping a [`DefaultsStore`].
///
/// All reads go through an in-memory snapshot cache. The cache is populated
/// on first access per domain and refreshed via Unix socket notifications
/// when an external write is detected.
pub struct TugbankClient {
    inner: Arc<Inner>,
    /// Listener handle — stops the listener thread when dropped.
    _listener: Option<ListenerHandle>,
}

// Compile-time assertion that TugbankClient is Send + Sync.
const _: () = {
    fn _assert_send_sync<T: Send + Sync>() {}
    fn _check() {
        _assert_send_sync::<TugbankClient>();
    }
};

impl TugbankClient {
    /// Open a new client backed by the database at `path`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, Error> {
        let store = DefaultsStore::open(path)?;
        Self::from_store(store)
    }

    /// Create a client from an existing [`DefaultsStore`].
    ///
    /// Starts a Unix socket listener for change notifications.
    pub fn from_store(store: DefaultsStore) -> Result<Self, Error> {
        let inner = Arc::new(Inner {
            store,
            cache: Mutex::new(HashMap::new()),
            callbacks: Arc::new(Mutex::new(CallbackRegistry::new())),
        });

        // Start the notification listener.
        let listener = {
            let inner_clone = Arc::clone(&inner);
            start_listener(move |domain| {
                handle_domain_notification(domain, &inner_clone);
            })
            .ok()
        };

        Ok(Self {
            inner,
            _listener: listener,
        })
    }

    /// Access the underlying [`DefaultsStore`].
    pub fn store(&self) -> &DefaultsStore {
        &self.inner.store
    }

    /// Read a value from the cache, loading the domain on first access.
    pub fn get(&self, domain: &str, key: &str) -> Result<Option<Value>, Error> {
        self.ensure_domain_loaded(domain)?;
        let cache = self.inner.cache.lock().unwrap();
        Ok(cache.get(domain).and_then(|snap| snap.get(key)).cloned())
    }

    /// Write a value to the DB and update the local cache.
    ///
    /// Broadcasts a Unix socket notification so other processes are notified.
    pub fn set(&self, domain: &str, key: &str, value: Value) -> Result<(), Error> {
        self.inner.store.domain(domain)?.set(key, value.clone())?;
        {
            let mut cache = self.inner.cache.lock().unwrap();
            cache
                .entry(domain.to_owned())
                .or_default()
                .insert(key.to_owned(), value);
        }
        broadcast_domain_changed(domain);
        Ok(())
    }

    /// Return the cached snapshot for `domain`, loading it on first access.
    pub fn read_domain(&self, domain: &str) -> Result<DomainSnapshot, Error> {
        self.ensure_domain_loaded(domain)?;
        let cache = self.inner.cache.lock().unwrap();
        Ok(cache.get(domain).cloned().unwrap_or_default())
    }

    /// Read `PRAGMA data_version` from the underlying connection.
    pub fn data_version(&self) -> Result<u64, Error> {
        let conn = self.inner.store.conn.lock().unwrap();
        let v: i64 = conn.query_row("PRAGMA data_version", [], |row| row.get(0))?;
        Ok(v as u64)
    }

    /// List all domain names in the database.
    pub fn list_domains(&self) -> Result<Vec<String>, Error> {
        self.inner.store.list_domains()
    }

    /// Register a callback that fires when any domain changes.
    ///
    /// Returns a [`CallbackHandle`] that unregisters the callback when dropped.
    pub fn on_domain_changed<F>(&self, callback: F) -> CallbackHandle
    where
        F: Fn(&str, &DomainSnapshot) + Send + 'static,
    {
        let mut reg = self.inner.callbacks.lock().unwrap();
        let id = reg.register(Box::new(callback));
        CallbackHandle {
            id,
            registry: Arc::clone(&self.inner.callbacks),
        }
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    fn ensure_domain_loaded(&self, domain: &str) -> Result<(), Error> {
        let already_loaded = {
            let cache = self.inner.cache.lock().unwrap();
            cache.contains_key(domain)
        };
        if !already_loaded {
            let snapshot = self.inner.store.domain(domain)?.read_all()?;
            let mut cache = self.inner.cache.lock().unwrap();
            cache.entry(domain.to_owned()).or_insert(snapshot);
        }
        Ok(())
    }
}

/// Handle a notification that a domain changed.
///
/// Re-reads the domain from the database, updates the cache, and fires
/// registered callbacks.
fn handle_domain_notification(domain: &str, inner: &Arc<Inner>) {
    let snapshot = match inner.store.domain(domain).and_then(|h| h.read_all()) {
        Ok(s) => s,
        Err(_) => return,
    };
    {
        let mut cache = inner.cache.lock().unwrap();
        cache.insert(domain.to_owned(), snapshot.clone());
    }
    {
        let reg = inner.callbacks.lock().unwrap();
        reg.fire(domain, &snapshot);
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;
    use tempfile::NamedTempFile;

    fn temp_client() -> (TugbankClient, NamedTempFile) {
        let tmp = NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open failed");
        (client, tmp)
    }

    #[test]
    fn test_tugbank_client_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<TugbankClient>();
    }

    #[test]
    fn test_get_set_round_trip() {
        let (client, _tmp) = temp_client();
        client
            .set("test.domain", "key", Value::String("hello".into()))
            .unwrap();
        let val = client.get("test.domain", "key").unwrap();
        assert_eq!(val, Some(Value::String("hello".into())));
    }

    #[test]
    fn test_external_write_detected() {
        let tmp = NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open failed");

        // Pre-load the domain so the cache has a baseline.
        let _ = client.read_domain("ext").unwrap();

        // Write via a second independent connection.
        let external = DefaultsStore::open(tmp.path()).expect("external store open");
        external
            .domain("ext")
            .unwrap()
            .set("key", Value::String("external-write".into()))
            .unwrap();

        // Broadcast the notification as the write side would.
        broadcast_domain_changed("ext");

        // Wait for the notification to propagate.
        let deadline = Duration::from_millis(500);
        let start = std::time::Instant::now();
        let mut detected = false;
        while start.elapsed() < deadline {
            std::thread::sleep(Duration::from_millis(10));
            let v = client.get("ext", "key").unwrap();
            if v == Some(Value::String("external-write".into())) {
                detected = true;
                break;
            }
        }

        assert!(
            detected,
            "TugbankClient should detect external write via Unix socket notification"
        );
    }

    #[test]
    fn test_callback_fires_on_external_change() {
        let tmp = NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open failed");

        let fired = Arc::new(AtomicU32::new(0));
        let fired_clone = Arc::clone(&fired);
        let _handle = client.on_domain_changed(move |_domain, _snapshot| {
            fired_clone.fetch_add(1, Ordering::Release);
        });

        // Pre-load the domain.
        let _ = client.read_domain("cb-test").unwrap();

        // Write via external connection + broadcast.
        let external = DefaultsStore::open(tmp.path()).expect("external store open");
        external
            .domain("cb-test")
            .unwrap()
            .set("k", Value::Bool(true))
            .unwrap();
        broadcast_domain_changed("cb-test");

        // Wait for the callback to fire.
        let deadline = Duration::from_millis(500);
        let start = std::time::Instant::now();
        while start.elapsed() < deadline {
            if fired.load(Ordering::Acquire) > 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        assert!(
            fired.load(Ordering::Acquire) > 0,
            "on_domain_changed callback should fire on external write"
        );
    }
}
