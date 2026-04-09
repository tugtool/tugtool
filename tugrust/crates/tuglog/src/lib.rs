//! tuglog — shared tracing initialization for Tug binaries.
//!
//! All Tug Rust binaries (tugcast, tugexec, tugutil, etc.) call [`init`] at
//! startup. Tracing output is written to a rolling log file under:
//!
//! ```text
//! ~/Library/Application Support/Tug/Logs/<name>.log
//! ```
//!
//! Logs rotate daily. The `RUST_LOG` environment variable controls the filter
//! level (default: `info`). A non-blocking writer is used so logging never
//! blocks the application.
//!
//! # Usage
//!
//! ```no_run
//! let _guard = tuglog::init("tugcast");
//! // _guard must be held for the lifetime of the program.
//! ```
//!
//! The returned [`LogGuard`] flushes buffered output when dropped. Bind it to
//! a variable in `main` — do not discard it.

use std::fs;
use std::path::PathBuf;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

/// Opaque guard that flushes the non-blocking writer on drop.
/// Must be held for the lifetime of the program.
pub struct LogGuard {
    _inner: WorkerGuard,
}

/// Resolve the log directory: `~/Library/Application Support/Tug/Logs`.
///
/// Creates the directory if it doesn't exist. Falls back to the system
/// temp directory if the home directory can't be determined.
fn log_dir() -> PathBuf {
    let base = dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Tug")
        .join("Logs");
    let _ = fs::create_dir_all(&base);
    base
}

/// Initialize tracing for a Tug binary.
///
/// - `name`: binary name, used as the log file prefix (e.g. `"tugcast"`
///   produces `tugcast.log.2026-04-07`).
/// - Reads `RUST_LOG` for filter level; defaults to `info`.
/// - Returns a [`LogGuard`] that must be held for the program's lifetime.
///
/// # Panics
///
/// Panics if the tracing subscriber has already been set (i.e., `init` was
/// called twice in the same process).
pub fn init(name: &str) -> LogGuard {
    let dir = log_dir();

    let file_appender = tracing_appender::rolling::daily(&dir, format!("{name}.log"));
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer().with_writer(non_blocking))
        .init();

    tracing::info!(
        name,
        log_dir = %dir.display(),
        "tuglog initialized"
    );

    LogGuard { _inner: guard }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_dir_is_under_tug() {
        let dir = log_dir();
        assert!(dir.ends_with("Tug/Logs"));
    }
}
