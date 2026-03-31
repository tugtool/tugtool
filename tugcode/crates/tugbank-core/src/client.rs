//! TugbankClient — in-memory cached client wrapping DefaultsStore.
//!
//! `TugbankClient` wraps a [`DefaultsStore`] with an in-memory domain-snapshot
//! cache and a background `std::thread` that polls `PRAGMA data_version` every
//! `poll_interval`. When the version changes, the polling thread discovers which
//! domains have a higher generation, reloads their snapshots, and fires
//! registered callbacks.
//!
//! # Thread safety
//!
//! `TugbankClient` is `Send + Sync` and intended to be shared via `Arc`.
//!
//! # Polling thread lifecycle
//!
//! Construction spawns a polling thread that runs until shutdown is signalled.
//! `Drop` signals the thread (by closing a channel sender) and joins it, so it
//! always exits cleanly — even when the poll interval is long.
//!
//! # Design
//!
//! `TugbankClient` holds `Arc<Inner>` internally so the polling thread can
//! share the same `DefaultsStore` and callback registry.

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::{DefaultsStore, Error, Value};

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
/// on first access per domain and refreshed by the background polling thread
/// when an external write is detected via `PRAGMA data_version`.
pub struct TugbankClient {
    inner: Arc<Inner>,
    /// Taking this sender and dropping it closes the channel, waking the
    /// polling thread so it exits immediately.
    shutdown_tx: Mutex<Option<mpsc::SyncSender<()>>>,
    poll_thread: Mutex<Option<JoinHandle<()>>>,
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
    ///
    /// Opens a [`DefaultsStore`] and spawns the background polling thread.
    pub fn open(path: impl AsRef<Path>, poll_interval: Duration) -> Result<Self, Error> {
        let store = DefaultsStore::open(path)?;
        Self::from_store(store, poll_interval)
    }

    /// Create a client from an existing [`DefaultsStore`].
    ///
    /// Reads `PRAGMA data_version` to establish the baseline, then spawns the
    /// background polling thread.
    pub fn from_store(store: DefaultsStore, poll_interval: Duration) -> Result<Self, Error> {
        let inner = Arc::new(Inner {
            store,
            cache: Mutex::new(HashMap::new()),
            callbacks: Arc::new(Mutex::new(CallbackRegistry::new())),
        });

        let baseline = read_data_version(&inner.store)?;

        // A zero-capacity sync channel: the polling thread calls `recv_timeout`
        // to implement an interruptible sleep. When the sender is dropped
        // (on shutdown or Drop), `recv_timeout` returns `Err(RecvTimeoutError::Disconnected)`.
        let (shutdown_tx, shutdown_rx) = mpsc::sync_channel::<()>(0);

        let inner_clone = Arc::clone(&inner);

        let handle = thread::spawn(move || {
            polling_thread(inner_clone, shutdown_rx, poll_interval, baseline);
        });

        Ok(Self {
            inner,
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
            poll_thread: Mutex::new(Some(handle)),
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
    pub fn set(&self, domain: &str, key: &str, value: Value) -> Result<(), Error> {
        self.inner.store.domain(domain)?.set(key, value.clone())?;
        let mut cache = self.inner.cache.lock().unwrap();
        cache
            .entry(domain.to_owned())
            .or_default()
            .insert(key.to_owned(), value);
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

    /// Stop the polling thread. Called automatically on `Drop`.
    ///
    /// Calling `shutdown` more than once is safe — the second call is a no-op.
    pub fn shutdown(&self) {
        // Drop the sender first to close the channel. This causes the polling
        // thread's `recv_timeout` to return `Disconnected` and exit immediately,
        // even if the poll interval is long.
        if let Ok(mut tx_guard) = self.shutdown_tx.lock() {
            tx_guard.take(); // drops the SyncSender, closing the channel
        }
        // Then join the thread.
        if let Ok(mut guard) = self.poll_thread.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn ensure_domain_loaded(&self, domain: &str) -> Result<(), Error> {
        let already_loaded = {
            let cache = self.inner.cache.lock().unwrap();
            cache.contains_key(domain)
        };
        if !already_loaded {
            let snapshot = self.inner.store.domain(domain)?.read_all()?;
            let mut cache = self.inner.cache.lock().unwrap();
            // Another thread may have populated the cache between our check and
            // the lock re-acquisition — use `or_insert` to avoid overwriting.
            cache.entry(domain.to_owned()).or_insert(snapshot);
        }
        Ok(())
    }
}

impl Drop for TugbankClient {
    fn drop(&mut self) {
        self.shutdown();
    }
}

// ── Polling helpers ───────────────────────────────────────────────────────────

fn read_data_version(store: &DefaultsStore) -> Result<u64, Error> {
    let conn = store.conn.lock().unwrap();
    let v: i64 = conn.query_row("PRAGMA data_version", [], |row| row.get(0))?;
    Ok(v as u64)
}

fn read_domain_generation(store: &DefaultsStore, domain: &str) -> Result<u64, Error> {
    let conn = store.conn.lock().unwrap();
    let result = conn.query_row(
        "SELECT generation FROM domains WHERE name = ?1",
        rusqlite::params![domain],
        |row| row.get::<_, i64>(0),
    );
    match result {
        Ok(g) => Ok(g as u64),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
        Err(e) => Err(Error::Sqlite(e)),
    }
}

// ── Polling thread ────────────────────────────────────────────────────────────

/// The background polling thread.
///
/// Uses `recv_timeout` on `shutdown_rx` to implement an interruptible sleep.
/// When the `TugbankClient` is dropped (or `shutdown()` is called), the sender
/// side of the channel is dropped, causing `recv_timeout` to return
/// `Disconnected` and the loop to exit immediately.
fn polling_thread(
    inner: Arc<Inner>,
    shutdown_rx: mpsc::Receiver<()>,
    poll_interval: Duration,
    baseline_version: u64,
) {
    let mut last_version = baseline_version;
    let mut known_generations: HashMap<String, u64> = HashMap::new();

    loop {
        // Interruptible sleep: exits immediately when the channel is closed.
        match shutdown_rx.recv_timeout(poll_interval) {
            Ok(()) => {
                // A message was sent — not used currently, but could be used
                // to trigger an immediate poll.
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // Channel closed — time to exit.
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Normal timeout: perform a poll cycle.
            }
        }

        let current_version = match read_data_version(&inner.store) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if current_version == last_version {
            continue;
        }
        last_version = current_version;

        let domains = match inner.store.list_domains() {
            Ok(d) => d,
            Err(_) => continue,
        };

        for domain in &domains {
            let current_gen = match read_domain_generation(&inner.store, domain) {
                Ok(g) => g,
                Err(_) => continue,
            };

            let prev_gen = known_generations.get(domain.as_str()).copied();
            let changed = match prev_gen {
                None => true,
                Some(prev) => current_gen > prev,
            };

            if changed {
                known_generations.insert(domain.clone(), current_gen);

                let snapshot = match inner.store.domain(domain) {
                    Ok(h) => match h.read_all() {
                        Ok(s) => s,
                        Err(_) => continue,
                    },
                    Err(_) => continue,
                };

                {
                    let mut cache = inner.cache.lock().unwrap();
                    cache.insert(domain.clone(), snapshot.clone());
                }

                {
                    let reg = inner.callbacks.lock().unwrap();
                    reg.fire(domain, &snapshot);
                }
            }
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use tempfile::NamedTempFile;

    fn temp_client(interval: Duration) -> (TugbankClient, NamedTempFile) {
        let tmp = NamedTempFile::new().expect("temp file");
        let client = TugbankClient::open(tmp.path(), interval).expect("open failed");
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
        let (client, _tmp) = temp_client(Duration::from_secs(60));
        client.set("d", "k", Value::I64(42)).unwrap();
        let v = client.get("d", "k").unwrap();
        assert_eq!(v, Some(Value::I64(42)));
    }

    // ── test_get_caches_value ─────────────────────────────────────────────────
    // after set + get, a second get returns the cached value without DB access

    #[test]
    fn test_get_caches_value() {
        let (client, _tmp) = temp_client(Duration::from_secs(60));
        client.set("d", "k", Value::Bool(true)).unwrap();
        let v1 = client.get("d", "k").unwrap();
        let v2 = client.get("d", "k").unwrap();
        assert_eq!(v1, v2);
        assert_eq!(v1, Some(Value::Bool(true)));
    }

    // ── test_external_write_detected ─────────────────────────────────────────
    // open two DefaultsStore connections to the same file; write via the second;
    // assert TugbankClient detects the change within 2x poll interval

    #[test]
    fn test_external_write_detected() {
        let tmp = NamedTempFile::new().expect("temp file");
        let poll = Duration::from_millis(50);
        let client = TugbankClient::open(tmp.path(), poll).expect("open failed");

        // Pre-load the domain so the cache has a baseline entry.
        let _ = client.read_domain("ext").unwrap();

        // Write via a second independent connection.
        let external = DefaultsStore::open(tmp.path()).expect("external store open");
        external
            .domain("ext")
            .unwrap()
            .set("key", Value::String("external-write".into()))
            .unwrap();

        // Wait for at most ~200ms for the polling thread to detect the change.
        let deadline = Duration::from_millis(500);
        let start = std::time::Instant::now();
        let mut detected = false;
        while start.elapsed() < deadline {
            thread::sleep(Duration::from_millis(10));
            let v = client.get("ext", "key").unwrap();
            if v == Some(Value::String("external-write".into())) {
                detected = true;
                break;
            }
        }

        assert!(
            detected,
            "TugbankClient should detect external write within polling interval"
        );
    }

    // ── test_callback_fires_on_external_change ────────────────────────────────
    // register on_domain_changed callback; write via external connection;
    // assert callback fires

    #[test]
    fn test_callback_fires_on_external_change() {
        let tmp = NamedTempFile::new().expect("temp file");
        let poll = Duration::from_millis(50);
        let client = TugbankClient::open(tmp.path(), poll).expect("open failed");

        let fired = Arc::new(AtomicU32::new(0));
        let fired_clone = Arc::clone(&fired);
        let _handle = client.on_domain_changed(move |_domain, _snapshot| {
            fired_clone.fetch_add(1, Ordering::Release);
        });

        // Write via a second independent connection.
        let external = DefaultsStore::open(tmp.path()).expect("external store open");
        external
            .domain("cb-domain")
            .unwrap()
            .set("key", Value::I64(1))
            .unwrap();

        // Wait for the callback to fire within ~200ms.
        let deadline = Duration::from_millis(500);
        let start = std::time::Instant::now();
        let mut callback_fired = false;
        while start.elapsed() < deadline {
            thread::sleep(Duration::from_millis(10));
            if fired.load(Ordering::Acquire) > 0 {
                callback_fired = true;
                break;
            }
        }

        assert!(callback_fired, "on_domain_changed callback should have fired");
    }

    // ── test_shutdown_stops_polling ───────────────────────────────────────────
    // after shutdown(), the polling thread exits cleanly

    #[test]
    fn test_shutdown_stops_polling() {
        let (client, _tmp) = temp_client(Duration::from_millis(10));
        client.shutdown();
        // A second call must be a no-op.
        client.shutdown();
    }
}
