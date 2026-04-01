//! TugbankClient — in-memory cached client wrapping DefaultsStore.
//!
//! `TugbankClient` wraps a [`DefaultsStore`] with an in-memory domain-snapshot
//! cache. On macOS, external changes are detected via Darwin notifications
//! (`notify_register_file_descriptor`). When a notification fires for a
//! cached domain, the snapshot is reloaded from the database and registered
//! callbacks are fired.
//!
//! # Thread safety
//!
//! `TugbankClient` is `Send + Sync` and intended to be shared via `Arc`.
//!
//! # Notification lifecycle
//!
//! On macOS, construction registers Darwin notification watchers for all
//! initially-known domains. Watchers are also registered when a new domain is
//! first accessed via `get`, `set`, or `read_domain`. The `NotifyToken`s are
//! stored in the client and cancelled when the client is dropped.
//!
//! On non-macOS platforms, no background polling or notification mechanism is
//! provided. The cache is populated on first access and updated only on local
//! writes.
//!
//! # Design
//!
//! `TugbankClient` holds `Arc<Inner>` internally so notification callbacks
//! can share the same `DefaultsStore` and callback registry.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::{DefaultsStore, Error, Value};

#[cfg(target_os = "macos")]
use crate::notify::{NotifyToken, broadcast_domain_changed, register_domain_watcher};

/// A snapshot of all key-value pairs for a single domain.
pub type DomainSnapshot = BTreeMap<String, Value>;

// ── Callback registry ─────────────────────────────────────────────────────────

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

// ── CallbackHandle ────────────────────────────────────────────────────────────

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

// ── Internal shared state ─────────────────────────────────────────────────────

struct Inner {
    store: DefaultsStore,
    cache: Mutex<HashMap<String, DomainSnapshot>>,
    callbacks: Arc<Mutex<CallbackRegistry>>,
}

// ── TugbankClient ─────────────────────────────────────────────────────────────

/// In-memory cached client wrapping a [`DefaultsStore`].
///
/// All reads go through an in-memory snapshot cache. The cache is populated
/// on first access per domain and refreshed via Darwin notifications (macOS)
/// when an external write is detected.
pub struct TugbankClient {
    inner: Arc<Inner>,
    /// Darwin notification tokens. Dropping these cancels the registrations.
    /// Wrapped in a Mutex so we can add tokens after construction.
    #[cfg(target_os = "macos")]
    notify_tokens: Mutex<Vec<NotifyToken>>,
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
    /// On macOS, registers Darwin notification watchers for all domains that
    /// currently exist in the database.
    pub fn from_store(store: DefaultsStore) -> Result<Self, Error> {
        let inner = Arc::new(Inner {
            store,
            cache: Mutex::new(HashMap::new()),
            callbacks: Arc::new(Mutex::new(CallbackRegistry::new())),
        });

        #[cfg(target_os = "macos")]
        let notify_tokens = {
            let tokens = Mutex::new(Vec::new());
            // Register watchers for all domains that already exist.
            if let Ok(domains) = inner.store.list_domains() {
                let mut toks = tokens.lock().unwrap();
                for domain in domains {
                    let tok = register_watcher_for_domain(&domain, &inner);
                    toks.push(tok);
                }
            }
            tokens
        };

        Ok(Self {
            inner,
            #[cfg(target_os = "macos")]
            notify_tokens,
        })
    }

    /// Access the underlying [`DefaultsStore`].
    ///
    /// Used by HTTP handlers during migration from `Arc<DefaultsStore>`.
    pub fn store(&self) -> &DefaultsStore {
        &self.inner.store
    }

    /// Read a value from the cache, loading the domain on first access.
    pub fn get(&self, domain: &str, key: &str) -> Result<Option<Value>, Error> {
        self.ensure_domain_loaded(domain)?;
        let cache = self.inner.cache.lock().unwrap();
        Ok(cache.get(domain).and_then(|snap| snap.get(key)).cloned())
    }

    /// Write a value to the DB and update the local cache atomically.
    ///
    /// On macOS, also broadcasts a Darwin notification so other processes
    /// (and other `TugbankClient` instances in this process) are notified.
    pub fn set(&self, domain: &str, key: &str, value: Value) -> Result<(), Error> {
        self.inner.store.domain(domain)?.set(key, value.clone())?;
        {
            let mut cache = self.inner.cache.lock().unwrap();
            cache
                .entry(domain.to_owned())
                .or_default()
                .insert(key.to_owned(), value);
        }
        #[cfg(target_os = "macos")]
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
        read_data_version(&self.inner.store)
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

    /// No-op for API compatibility. Notification cleanup happens on Drop.
    ///
    /// On macOS, the polling thread no longer exists; this method is kept so
    /// existing call sites compile without changes.
    pub fn shutdown(&self) {
        // Nothing to do — Darwin notification tokens are cancelled on Drop.
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn ensure_domain_loaded(&self, domain: &str) -> Result<(), Error> {
        let already_loaded = {
            let cache = self.inner.cache.lock().unwrap();
            cache.contains_key(domain)
        };
        if !already_loaded {
            let snapshot = self.inner.store.domain(domain)?.read_all()?;
            {
                let mut cache = self.inner.cache.lock().unwrap();
                // Another thread may have populated the cache between our check
                // and the lock re-acquisition — use `or_insert` to avoid
                // overwriting a fresher snapshot.
                cache.entry(domain.to_owned()).or_insert(snapshot);
            }
            // Register a Darwin notification watcher for this newly-seen domain.
            #[cfg(target_os = "macos")]
            {
                let tok = register_watcher_for_domain(domain, &self.inner);
                self.notify_tokens.lock().unwrap().push(tok);
            }
        }
        Ok(())
    }
}

impl Drop for TugbankClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ── Darwin watcher helper ─────────────────────────────────────────────────────

/// Register a Darwin notification watcher for `domain` that reloads the
/// domain snapshot and fires registered callbacks when a notification arrives.
#[cfg(target_os = "macos")]
fn register_watcher_for_domain(domain: &str, inner: &Arc<Inner>) -> NotifyToken {
    let domain_owned = domain.to_owned();
    let inner_clone = Arc::clone(inner);
    register_domain_watcher(domain, move || {
        // Re-read the domain from the database.
        let snapshot = match inner_clone
            .store
            .domain(&domain_owned)
            .and_then(|h| h.read_all())
        {
            Ok(s) => s,
            Err(_) => return,
        };
        // Update the cache.
        {
            let mut cache = inner_clone.cache.lock().unwrap();
            cache.insert(domain_owned.clone(), snapshot.clone());
        }
        // Fire callbacks.
        {
            let reg = inner_clone.callbacks.lock().unwrap();
            reg.fire(&domain_owned, &snapshot);
        }
    })
}

// ── Data version helper ───────────────────────────────────────────────────────

fn read_data_version(store: &DefaultsStore) -> Result<u64, Error> {
    let conn = store.conn.lock().unwrap();
    let v: i64 = conn.query_row("PRAGMA data_version", [], |row| row.get(0))?;
    Ok(v as u64)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

    // ── Compile-time: TugbankClient is Send + Sync ────────────────────────────

    #[test]
    fn test_tugbank_client_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<TugbankClient>();
    }

    // ── test_set_updates_cache ────────────────────────────────────────────────
    // set() followed by get() returns the new value immediately (no poll needed)

    #[test]
    fn test_set_updates_cache() {
        let (client, _tmp) = temp_client();
        client.set("d", "k", Value::I64(42)).unwrap();
        let v = client.get("d", "k").unwrap();
        assert_eq!(v, Some(Value::I64(42)));
    }

    // ── test_get_caches_value ─────────────────────────────────────────────────
    // after set + get, a second get returns the cached value without DB access

    #[test]
    fn test_get_caches_value() {
        let (client, _tmp) = temp_client();
        client.set("d", "k", Value::Bool(true)).unwrap();
        let v1 = client.get("d", "k").unwrap();
        let v2 = client.get("d", "k").unwrap();
        assert_eq!(v1, v2);
        assert_eq!(v1, Some(Value::Bool(true)));
    }

    // ── test_external_write_detected ─────────────────────────────────────────
    // open two DefaultsStore connections to the same file; write via the second;
    // assert TugbankClient detects the change via Darwin notification

    #[cfg(target_os = "macos")]
    #[test]
    fn test_external_write_detected() {
        let tmp = NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open failed");

        // Pre-load the domain so the cache has a baseline entry and a
        // Darwin notification watcher is registered.
        let _ = client.read_domain("ext").unwrap();

        // Write via a second independent connection.
        let external = DefaultsStore::open(tmp.path()).expect("external store open");
        external
            .domain("ext")
            .unwrap()
            .set("key", Value::String("external-write".into()))
            .unwrap();

        // Broadcast the notification as the write side would.
        crate::notify::broadcast_domain_changed("ext");

        // Wait for at most 500ms for the notification to propagate.
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
            "TugbankClient should detect external write via Darwin notification"
        );
    }

    // ── test_callback_fires_on_external_change ────────────────────────────────
    // register on_domain_changed callback; write via external connection;
    // assert callback fires via Darwin notification

    #[cfg(target_os = "macos")]
    #[test]
    fn test_callback_fires_on_external_change() {
        let tmp = NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path()).expect("open failed");

        let fired = Arc::new(AtomicU32::new(0));
        let fired_clone = Arc::clone(&fired);
        let _handle = client.on_domain_changed(move |_domain, _snapshot| {
            fired_clone.fetch_add(1, Ordering::Release);
        });

        // Pre-load the domain so a watcher is registered.
        let _ = client.read_domain("cb-domain").unwrap();

        // Write via a second independent connection.
        let external = DefaultsStore::open(tmp.path()).expect("external store open");
        external
            .domain("cb-domain")
            .unwrap()
            .set("key", Value::I64(1))
            .unwrap();

        // Broadcast as the write side would.
        crate::notify::broadcast_domain_changed("cb-domain");

        // Wait for the callback to fire within 500ms.
        let deadline = Duration::from_millis(500);
        let start = std::time::Instant::now();
        let mut callback_fired = false;
        while start.elapsed() < deadline {
            std::thread::sleep(Duration::from_millis(10));
            if fired.load(Ordering::Acquire) > 0 {
                callback_fired = true;
                break;
            }
        }

        assert!(
            callback_fired,
            "on_domain_changed callback should have fired via Darwin notification"
        );
    }

    // ── test_shutdown_is_noop ─────────────────────────────────────────────────
    // shutdown() is a no-op and can be called multiple times safely

    #[test]
    fn test_shutdown_is_noop() {
        let (client, _tmp) = temp_client();
        client.shutdown();
        client.shutdown();
    }
}
