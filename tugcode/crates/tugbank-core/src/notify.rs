//! Tugbank change notification via Unix domain sockets.
//!
//! # Write side
//!
//! After a successful write, call [`broadcast_domain_changed`]. This sends
//! the domain name as a datagram to every listener socket in
//! `~/.tugbank/notify/*.sock`.
//!
//! # Listen side
//!
//! Call [`start_listener`] to create a socket at `~/.tugbank/notify/<pid>.sock`
//! and spawn a background thread that blocks on `recv()`. When a datagram
//! arrives, the callback fires with the domain name. Call the returned
//! [`ListenerHandle`] `.stop()` or drop it to clean up.

use std::collections::HashSet;
use std::fs;
use std::os::unix::net::UnixDatagram;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

/// Directory where listener sockets live.
fn notify_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".tugbank").join("notify")
}

// ── Broadcast ────────────────────────────────────────────────────────────────

/// Broadcast a domain change to all listening processes.
///
/// Sends the domain name as a datagram to every `*.sock` file in
/// `~/.tugbank/notify/`. If no listeners exist or a socket is stale,
/// errors are silently ignored.
pub fn broadcast_domain_changed(domain: &str) {
    let dir = notify_dir();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return, // No notify dir — nobody listening
    };

    let sender = match UnixDatagram::unbound() {
        Ok(s) => s,
        Err(_) => return,
    };

    let msg = domain.as_bytes();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("sock") {
            // Best-effort send — ignore errors (stale socket, process gone)
            let _ = sender.send_to(msg, &path);
        }
    }
}

// ── Listener ─────────────────────────────────────────────────────────────────

/// Handle for a running notification listener.
///
/// Dropping the handle stops the listener thread and removes the socket file.
pub struct ListenerHandle {
    shutdown: Arc<AtomicBool>,
    socket_path: PathBuf,
    thread: Option<thread::JoinHandle<()>>,
}

impl ListenerHandle {
    /// Stop the listener and clean up the socket file.
    pub fn stop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        // Send a dummy datagram to unblock the recv() call.
        if let Ok(sender) = UnixDatagram::unbound() {
            let _ = sender.send_to(b"", &self.socket_path);
        }
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
        let _ = fs::remove_file(&self.socket_path);
    }
}

impl Drop for ListenerHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Start a notification listener.
///
/// Creates a socket at `~/.tugbank/notify/<pid>.sock` and spawns a
/// background thread that blocks on `recv()`. When a datagram arrives
/// containing a domain name, `callback(domain)` is called.
///
/// The callback runs on the listener thread. It should be fast (just
/// update a cache and fire callbacks — no heavy I/O).
///
/// Returns a [`ListenerHandle`] that stops the listener when dropped.
pub fn start_listener(
    callback: impl Fn(&str) + Send + 'static,
) -> Result<ListenerHandle, std::io::Error> {
    let dir = notify_dir();
    fs::create_dir_all(&dir)?;

    // Clean up any stale socket from a previous run of this PID.
    let socket_path = dir.join(format!("{}.sock", std::process::id()));
    let _ = fs::remove_file(&socket_path);

    let socket = UnixDatagram::bind(&socket_path)?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let path_clone = socket_path.clone();

    let thread = thread::Builder::new()
        .name("tugbank-notify-listener".into())
        .spawn(move || {
            listener_thread(socket, shutdown_clone, callback);
            // Clean up socket on thread exit.
            let _ = fs::remove_file(&path_clone);
        })?;

    Ok(ListenerHandle {
        shutdown,
        socket_path,
        thread: Some(thread),
    })
}

/// The listener thread loop.
fn listener_thread(
    socket: UnixDatagram,
    shutdown: Arc<AtomicBool>,
    callback: impl Fn(&str),
) {
    let mut buf = [0u8; 512];
    let mut seen = HashSet::new();

    loop {
        // recv blocks until a datagram arrives.
        let n = match socket.recv(&mut buf) {
            Ok(n) => n,
            Err(_) => {
                if shutdown.load(Ordering::Acquire) {
                    return;
                }
                continue;
            }
        };

        if shutdown.load(Ordering::Acquire) {
            return;
        }

        if n == 0 {
            continue; // Shutdown wake-up or empty datagram
        }

        if let Ok(domain) = std::str::from_utf8(&buf[..n]) {
            // Deduplicate rapid-fire notifications for the same domain.
            // Clear the set on each recv to handle bursts.
            if seen.insert(domain.to_owned()) {
                callback(domain);
            }
            // Reset dedup set after processing.
            seen.clear();
        }
    }
}
