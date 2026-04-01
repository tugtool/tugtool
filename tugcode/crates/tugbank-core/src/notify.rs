//! Darwin notification helpers for tugbank change detection.
//!
//! Uses Apple's `notify(3)` API (from libSystem) for cross-process, zero-setup
//! notification delivery.
//!
//! # Naming convention
//!
//! Notification names follow the pattern:
//! ```text
//! dev.tugtool.tugbank.changed.<domain>
//! ```
//!
//! # Write side
//!
//! After a successful write, call [`broadcast_domain_changed`]. This is a
//! single synchronous `notify_post` call — fire-and-forget.
//!
//! # Listen side
//!
//! Call [`register_domain_watcher`] to receive a callback whenever a
//! notification arrives for a domain. Returns a [`NotifyToken`] that
//! cancels the registration when dropped.
//!
//! # Implementation note
//!
//! We use `notify_register_file_descriptor` rather than
//! `notify_register_dispatch` to avoid Objective-C block FFI. The fd becomes
//! readable when a notification fires. A single background thread polls all
//! registered fds with `select(2)` and dispatches callbacks.

#![cfg(target_os = "macos")]

use std::collections::HashMap;
use std::ffi::CString;
use std::os::unix::io::RawFd;
use std::sync::{Arc, Mutex};
use std::thread;

// ── Darwin FFI ────────────────────────────────────────────────────────────────

#[allow(non_camel_case_types)]
type notify_status_t = u32;
const NOTIFY_STATUS_OK: notify_status_t = 0;

unsafe extern "C" {
    /// Post a notification to all registered observers.
    fn notify_post(name: *const std::ffi::c_char) -> notify_status_t;

    /// Register for notifications via a file descriptor.
    ///
    /// When a notification fires, a 4-byte token value is written to `fd`.
    /// `flags` should be 0. Returns NOTIFY_STATUS_OK (0) on success.
    fn notify_register_file_descriptor(
        name: *const std::ffi::c_char,
        fd: *mut RawFd,
        flags: i32,
        out_token: *mut i32,
    ) -> notify_status_t;

    /// Cancel a registration token, closing associated resources.
    fn notify_cancel(token: i32) -> notify_status_t;
}

// ── NotifyToken ───────────────────────────────────────────────────────────────

/// A registration token for a Darwin notification watcher.
///
/// When dropped, cancels the notification registration via `notify_cancel`.
pub struct NotifyToken(i32);

impl Drop for NotifyToken {
    fn drop(&mut self) {
        unsafe {
            notify_cancel(self.0);
        }
    }
}

// ── Broadcaster ──────────────────────────────────────────────────────────────

/// Broadcast a Darwin notification for a domain change.
///
/// Called on the write side after any successful tugbank write. This is a
/// single `notify_post` call — synchronous, fire-and-forget. If no listeners
/// are registered, the notification is silently dropped.
pub fn broadcast_domain_changed(domain: &str) {
    let name = format!("dev.tugtool.tugbank.changed.{domain}");
    if let Ok(cname) = CString::new(name) {
        unsafe {
            notify_post(cname.as_ptr());
        }
    }
}

// ── Watcher registry ──────────────────────────────────────────────────────────

/// Shared state for the fd-watcher thread.
struct WatcherState {
    /// Map from raw fd → (token, callback).
    ///
    /// The fd is owned by the Darwin notify API; we read from it.
    /// The token is stored so we can cancel on drop (via `NotifyToken`).
    entries: HashMap<RawFd, (i32, Box<dyn Fn() + Send + 'static>)>,
    /// Pipe used to wake the select() loop when entries change.
    wake_write: RawFd,
}

impl WatcherState {
    fn fds(&self) -> Vec<RawFd> {
        self.entries.keys().copied().collect()
    }
}

/// Global watcher coordinator.
static WATCHER: Mutex<Option<Arc<Mutex<WatcherState>>>> = Mutex::new(None);

/// Register a callback that fires when the given domain changes.
///
/// Internally registers with `notify_register_file_descriptor` for the
/// fd-based notification mechanism and adds the fd to the global poll loop.
///
/// Returns a [`NotifyToken`] that unregisters the watcher when dropped.
///
/// # Panics
///
/// Panics if the Darwin API returns an error or if the pipe cannot be created.
pub fn register_domain_watcher(
    domain: &str,
    callback: impl Fn() + Send + 'static,
) -> NotifyToken {
    let name = format!("dev.tugtool.tugbank.changed.{domain}");
    let cname = CString::new(name).expect("domain name contains null byte");

    let mut fd: RawFd = -1;
    let mut token: i32 = -1;

    let status = unsafe {
        notify_register_file_descriptor(cname.as_ptr(), &mut fd, 0, &mut token)
    };
    assert_eq!(
        status, NOTIFY_STATUS_OK,
        "notify_register_file_descriptor failed for domain {domain}"
    );

    // Add the fd + callback to the global watcher.
    get_or_init_watcher(fd, token, Box::new(callback));

    NotifyToken(token)
}

/// Get or initialize the global watcher state, adding a new fd entry.
fn get_or_init_watcher(fd: RawFd, token: i32, callback: Box<dyn Fn() + Send + 'static>) {
    let mut global = WATCHER.lock().unwrap();

    if global.is_none() {
        // Create a self-pipe for waking the select loop.
        let (wake_read, wake_write) = create_pipe();

        let state = Arc::new(Mutex::new(WatcherState {
            entries: HashMap::new(),
            wake_write,
        }));

        let state_clone = Arc::clone(&state);
        thread::Builder::new()
            .name("tugbank-notify-watcher".into())
            .spawn(move || {
                watcher_thread(state_clone, wake_read);
            })
            .expect("failed to spawn tugbank notify watcher thread");

        *global = Some(state);
    }

    let state_arc = global.as_ref().unwrap();
    let mut state = state_arc.lock().unwrap();
    state.entries.insert(fd, (token, callback));

    // Wake the select loop so it rebuilds its fd set.
    wake_select(state.wake_write);
}

/// Create a non-blocking pipe. Returns (read_fd, write_fd).
fn create_pipe() -> (RawFd, RawFd) {
    let mut fds = [0i32; 2];
    let rc = unsafe { libc::pipe(fds.as_mut_ptr()) };
    assert_eq!(rc, 0, "pipe() failed");
    // Set both ends non-blocking.
    unsafe {
        libc::fcntl(fds[0], libc::F_SETFL, libc::O_NONBLOCK);
        libc::fcntl(fds[1], libc::F_SETFL, libc::O_NONBLOCK);
    }
    (fds[0], fds[1])
}

/// Write a single byte to the wake pipe (non-blocking, best-effort).
fn wake_select(wake_write: RawFd) {
    unsafe {
        let byte: u8 = 1;
        libc::write(wake_write, &byte as *const u8 as *const libc::c_void, 1);
    }
}

// ── Watcher thread ────────────────────────────────────────────────────────────

/// The single background thread that polls all notification fds with select(2).
///
/// When any fd becomes readable, we read the token (4 bytes), look up the
/// corresponding callback, and fire it.
fn watcher_thread(state: Arc<Mutex<WatcherState>>, wake_read: RawFd) {
    loop {
        // Collect the current set of fds (notification fds + wake pipe).
        let notify_fds: Vec<RawFd> = {
            let s = state.lock().unwrap();
            s.fds()
        };

        // Build the fd_set for select().
        let mut readfds: libc::fd_set = unsafe { std::mem::zeroed() };
        let mut max_fd = wake_read;

        unsafe {
            libc::FD_ZERO(&mut readfds);
            libc::FD_SET(wake_read, &mut readfds);
        }

        for fd in &notify_fds {
            unsafe {
                libc::FD_SET(*fd, &mut readfds);
            }
            if *fd > max_fd {
                max_fd = *fd;
            }
        }

        // Block until at least one fd is readable (no timeout — we run forever).
        let rc = unsafe {
            libc::select(
                max_fd + 1,
                &mut readfds,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };

        if rc <= 0 {
            // Error or spurious wakeup — loop and retry.
            continue;
        }

        // Drain the wake pipe if it fired.
        if unsafe { libc::FD_ISSET(wake_read, &readfds) } {
            drain_fd(wake_read);
        }

        // Check each notification fd and collect callbacks to fire.
        // We must NOT call callbacks while holding the state lock — callbacks
        // may trigger ensure_domain_loaded → register_watcher_for_domain,
        // which re-acquires the lock and would deadlock.
        let mut fds_to_fire: Vec<RawFd> = Vec::new();
        for fd in &notify_fds {
            if unsafe { libc::FD_ISSET(*fd, &readfds) } {
                // Read the 4-byte token value written by the Darwin API.
                let mut _token_val: i32 = 0;
                unsafe {
                    libc::read(
                        *fd,
                        &mut _token_val as *mut i32 as *mut libc::c_void,
                        4,
                    );
                }
                fds_to_fire.push(*fd);
            }
        }

        // Fire callbacks outside the lock.
        for fd in fds_to_fire {
            let cb = {
                let s = state.lock().unwrap();
                s.entries.get(&fd).map(|(_, cb)| {
                    // SAFETY: We need a reference to the callback that outlives
                    // the lock. The callback is behind Arc<Mutex<WatcherState>>
                    // which won't be freed while we have a reference to `state`.
                    // We use a raw pointer to call it after releasing the lock.
                    cb as *const (dyn Fn() + Send + 'static)
                })
            };
            if let Some(cb_ptr) = cb {
                // SAFETY: The callback pointer is valid because:
                // 1. WatcherState is behind Arc — not freed while we hold a clone
                // 2. Entries are only removed when NotifyToken is dropped, which
                //    requires the caller to have exclusive ownership
                // 3. We're the only thread that reads fds and fires callbacks
                unsafe { (*cb_ptr)(); }
            }
        }
    }
}

/// Drain all available bytes from a non-blocking fd (used for the wake pipe).
fn drain_fd(fd: RawFd) {
    let mut buf = [0u8; 64];
    loop {
        let n = unsafe {
            libc::read(fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len())
        };
        if n <= 0 {
            break;
        }
    }
}
