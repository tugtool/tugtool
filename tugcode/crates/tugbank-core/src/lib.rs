//! `tugbank-core` — SQLite-backed typed defaults store.
//!
//! This crate provides a durable, typed, domain-separated key-value store
//! modeled after Apple's `UserDefaults`. It uses SQLite as the storage backend
//! via [`rusqlite`] with WAL mode and CAS (compare-and-swap) concurrency.
//!
//! # Usage
//!
//! ```no_run
//! use tugbank_core::{DefaultsStore, Value};
//!
//! let store = DefaultsStore::open("/path/to/bank.db").unwrap();
//! let handle = store.domain("com.example.settings").unwrap();
//! handle.set("theme", Value::String("dark".into())).unwrap();
//! let theme = handle.get("theme").unwrap();
//! assert_eq!(theme, Some(Value::String("dark".into())));
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
