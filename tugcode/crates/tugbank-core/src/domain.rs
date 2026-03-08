//! DomainHandle, DomainTxn, SetOutcome, and Mutation types.

use crate::Error;
use crate::Value;
use crate::value::check_blob_size;

/// Outcome of a `set_if_generation` operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SetOutcome {
    /// The value was written successfully.
    Written,
    /// The write was rejected because the domain generation has changed.
    Conflict {
        /// The current generation at the time of the conflict.
        current_generation: u64,
    },
}

/// Internal representation of a queued mutation in a `DomainTxn`.
#[allow(dead_code)]
pub(crate) enum Mutation {
    Set { key: String, value: Value },
    Remove { key: String },
}

/// A write-only transaction buffer for atomic multi-key updates.
///
/// Created by [`DomainHandle::update`] and passed to the user closure.
/// Call [`set`](DomainTxn::set) and [`remove`](DomainTxn::remove) to
/// queue mutations; they are applied atomically when the closure returns `Ok`.
pub struct DomainTxn {
    pub(crate) mutations: Vec<Mutation>,
}

impl DomainTxn {
    pub(crate) fn new() -> Self {
        Self {
            mutations: Vec::new(),
        }
    }

    /// Queue a set operation. Enforces the 10 MB blob size limit.
    pub fn set(&mut self, key: &str, value: Value) -> Result<(), Error> {
        check_blob_size(&value)?;
        self.mutations.push(Mutation::Set {
            key: key.to_owned(),
            value,
        });
        Ok(())
    }

    /// Queue a remove operation.
    pub fn remove(&mut self, key: &str) {
        self.mutations.push(Mutation::Remove {
            key: key.to_owned(),
        });
    }
}

/// A handle to a specific domain within a [`DefaultsStore`](crate::DefaultsStore).
///
/// All read and write operations on a domain go through this handle.
/// The handle borrows the store and is scoped to a single domain name.
pub struct DomainHandle<'a> {
    pub(crate) _store: &'a crate::DefaultsStore,
    pub(crate) _domain: String,
}

impl<'a> DomainHandle<'a> {
    /// Atomic multi-key update.
    ///
    /// The closure receives a write-only [`DomainTxn`]. Uses `BEGIN IMMEDIATE`
    /// for writer serialization. If the closure returns `Err`, the transaction
    /// is rolled back automatically and the error is propagated.
    pub fn update<F>(&self, f: F) -> Result<u64, Error>
    where
        F: FnOnce(&mut DomainTxn) -> Result<(), Error>,
    {
        let mut txn = DomainTxn::new();
        f(&mut txn)?;
        let _ = txn.mutations;
        unimplemented!("DomainHandle::update not yet implemented")
    }
}
