//! `tugbank-core` — SQLite-backed typed defaults store.
//!
//! This crate provides a durable, typed, domain-separated key-value store
//! modeled after Apple's `UserDefaults`. It uses SQLite as the storage
//! backend via [`rusqlite`] with WAL mode, busy-timeout, and CAS
//! (compare-and-swap) generation counters for safe concurrent writes.
//!
//! # Design overview
//!
//! - **Domains** separate keys into named namespaces (e.g. `"com.example.prefs"`).
//!   Each domain has a monotonically increasing *generation* counter that
//!   increments on every write.
//! - **Values** are typed: [`Value`] holds `Null`, `Bool`, `I64`, `F64`,
//!   `String`, `Bytes`, or `Json`. Values are stored in typed SQL columns so
//!   type fidelity is preserved without custom binary encoding.
//! - **`DefaultsStore`** is `Send + Sync` via an internal `Mutex<Connection>`,
//!   making it safe to share across threads with `Arc`.
//! - **`DomainHandle`** borrows the store and provides all read/write
//!   operations scoped to a single domain.
//!
//! # Basic usage
//!
//! ```no_run
//! use tugbank_core::{DefaultsStore, Value};
//!
//! let store = DefaultsStore::open("/path/to/bank.db").unwrap();
//! let handle = store.domain("com.example.settings").unwrap();
//!
//! handle.set("theme", Value::String("dark".into())).unwrap();
//! handle.set("font-size", Value::I64(14)).unwrap();
//!
//! let theme = handle.get("theme").unwrap();
//! assert_eq!(theme, Some(Value::String("dark".into())));
//!
//! let all = handle.read_all().unwrap();
//! println!("{} keys in domain", all.len());
//! ```
//!
//! # Atomic multi-key updates
//!
//! Use [`DomainHandle::update`] to apply several mutations atomically:
//!
//! ```no_run
//! use tugbank_core::{DefaultsStore, Value};
//!
//! let store = DefaultsStore::open("/path/to/bank.db").unwrap();
//! let handle = store.domain("com.example.settings").unwrap();
//!
//! handle.update(|txn| {
//!     txn.set("theme", Value::String("light".into()))?;
//!     txn.set("font-size", Value::I64(16))?;
//!     txn.remove("legacy-key");
//!     Ok(())
//! }).unwrap();
//! ```
//!
//! # CAS (compare-and-swap) writes
//!
//! Use [`DomainHandle::set_if_generation`] for optimistic concurrency: read
//! the current generation, compute a new value, then write only if the
//! generation has not changed since you read it.
//!
//! ```no_run
//! use tugbank_core::{DefaultsStore, SetOutcome, Value};
//!
//! let store = DefaultsStore::open("/path/to/bank.db").unwrap();
//! let handle = store.domain("com.example.settings").unwrap();
//!
//! loop {
//!     let g = handle.generation().unwrap();
//!     match handle.set_if_generation("counter", Value::I64(42), g).unwrap() {
//!         SetOutcome::Written => break,
//!         SetOutcome::Conflict { .. } => continue, // retry
//!     }
//! }
//! ```
//!
//! # Thread safety
//!
//! `DefaultsStore` implements `Send + Sync` and can be wrapped in `Arc` for
//! shared use across threads. Each thread obtains a [`DomainHandle`] from the
//! shared store and operates independently. SQLite WAL mode and a 5-second
//! busy-timeout handle writer contention transparently.
//!
//! ```no_run
//! use std::sync::Arc;
//! use tugbank_core::{DefaultsStore, Value};
//!
//! let store = Arc::new(DefaultsStore::open("/path/to/bank.db").unwrap());
//! let store2 = Arc::clone(&store);
//!
//! std::thread::spawn(move || {
//!     let handle = store2.domain("com.example.prefs").unwrap();
//!     handle.set("key", Value::Bool(true)).unwrap();
//! });
//! ```

mod domain;
mod error;
mod schema;
mod store;
mod value;

pub use domain::{DomainHandle, DomainTxn, SetOutcome};
pub use error::Error;
pub use store::DefaultsStore;
pub use value::Value;
