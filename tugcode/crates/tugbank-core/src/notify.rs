//! Tugbank change notification via Unix domain sockets.
//!
//! # Write side
//!
//! After a successful write, call [`broadcast_domain_changed`]. This sends
//! the domain name as a datagram to the well-known notification socket.
//! If tugcast isn't running (socket doesn't exist), the send fails with
//! a warning to stderr.
//!
//! # Listen side
//!
//! Listening is tugcast's responsibility, not this library's. tugcast
//! binds the socket, receives datagrams, and refreshes its TugbankClient
//! cache. See the tugbank-change-detection roadmap for the full design.

use std::os::unix::net::UnixDatagram;
use std::path::PathBuf;

/// Return the well-known notification socket path.
///
/// Uses the per-user runtime directory (`std::env::temp_dir()` — resolves
/// to `/var/folders/.../T/` on macOS, `/tmp` or `$XDG_RUNTIME_DIR` on Linux).
pub fn socket_path() -> PathBuf {
    std::env::temp_dir().join("tugbank-notify.sock")
}

/// Broadcast a domain change to tugcast via the notification socket.
///
/// Sends the domain name as a datagram. If the socket doesn't exist
/// (tugcast not running) or the send fails, prints a warning to stderr
/// and returns. The database write has already succeeded — the notification
/// is supplementary.
pub fn broadcast_domain_changed(domain: &str) {
    let path = socket_path();

    let sender = match UnixDatagram::unbound() {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "warning: tugbank notify: failed to create socket: {} (domain: {})",
                e, domain
            );
            return;
        }
    };

    if let Err(e) = sender.send_to(domain.as_bytes(), &path) {
        // ENOENT = socket doesn't exist (tugcast not running). Silent — normal state.
        // Only warn on unexpected errors (stale socket, buffer full, etc.)
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("warning: tugbank notify: {} (domain: {})", e, domain);
        }
    }
}
