//! tugcore — shared low-level primitives for Tug binaries.
//!
//! This crate is the foundation other Tug crates build on. It holds
//! identity, path, port-allocation, and registry helpers — code that
//! the tugcast, tugbank, tuglog, tugutil, and Swift-bridged binaries
//! all need to agree on but that does not belong inside any single
//! binary.
//!
//! Nothing in this crate may depend on any other Tug crate.

pub mod instance;
pub mod ports;
pub mod registry;
