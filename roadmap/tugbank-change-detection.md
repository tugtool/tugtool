# Tugbank Change Detection

## Decision

Drop all polling and filesystem watching. Replace with explicit write-side broadcast notifications. When a client writes to tugbank, it broadcasts a lightweight "domain changed" notification. Other running clients receive it and re-read from the database.

Two notification tiers, both implemented:
- **macOS:** Darwin notifications (`notify_post` / `notify_register_dispatch`)
- **Other platforms:** Unix domain socket (datagram)

Use Darwin notifications when running on macOS. The Unix socket path exists for cross-platform support.

## Background: What We're Replacing

Every TugbankClient currently runs its own polling loop — dedicated threads, timers, `PRAGMA data_version` checks every 500ms. This is a lot of machinery for infrequent cross-process changes (theme switches, CLI writes, settings). The polling approach adds launch-time hitches, wastes CPU when idle, and creates complexity (thread safety, cache invalidation, generation tracking) in every client.

The actual need is simple: when Process A writes to a domain, Process B should know about it reasonably quickly. The writer already knows what changed — it just needs to tell everyone else.

## Design

### Write-Side Broadcast

When any tugbank client (CLI, Rust, Swift, TypeScript) writes to a domain, it broadcasts the domain name after the write succeeds. This is a one-line addition to the write path.

The notification carries only the domain name (e.g., `dev.tugtool.app`). The receiver doesn't know what key changed — it just knows to re-read that domain from the database if it cares about it.

### Tier 1: Darwin Notifications (macOS)

Darwin notifications are Apple's built-in cross-process notification system. They require no setup, no sockets, no files, no cleanup. The system manages everything.

**Posting (write side):**
```c
#include <notify.h>
notify_post("dev.tugtool.tugbank.changed.dev.tugtool.app");
```

One C function call. Works from any process — CLI, app, daemon. Fire-and-forget. If nobody is listening, the notification is silently dropped.

**Receiving (read side):**
```swift
import Foundation
let token: Int32 = 0
notify_register_dispatch(
    "dev.tugtool.tugbank.changed.dev.tugtool.app",
    &token,
    DispatchQueue.main
) { _ in
    // Domain "dev.tugtool.app" changed externally.
    // Re-read from database, update cache, fire callbacks.
}
```

Or register for a wildcard-style prefix by registering for each domain the client has cached.

**From Rust (tugbank CLI and tugcast):**
```rust
use std::ffi::CString;
extern "C" { fn notify_post(name: *const std::ffi::c_char) -> u32; }

fn broadcast_domain_changed(domain: &str) {
    let name = CString::new(format!("dev.tugtool.tugbank.changed.{}", domain)).unwrap();
    unsafe { notify_post(name.as_ptr()); }
}
```

**From Bun/TypeScript (tugtalk):**
```typescript
// Call via Bun FFI or shell out to a tiny helper
Bun.spawnSync(["notifyutil", "-p", `dev.tugtool.tugbank.changed.${domain}`]);
```

Or use Bun's FFI to call `notify_post` directly from libSystem.

**Properties:**
- Zero setup, zero cleanup
- System-managed, kernel-level delivery
- Works across all processes on the machine
- No files, no sockets, no ports
- Notifications are coalesced if they arrive faster than the receiver processes them
- Available on macOS, iOS, watchOS, tvOS

### Tier 2: Unix Domain Socket (Cross-Platform Fallback)

For Linux or other platforms where Darwin notifications aren't available.

**Socket:** Datagram (SOCK_DGRAM) at a well-known path, e.g., `/tmp/tugbank-notify.sock` or `$XDG_RUNTIME_DIR/tugbank-notify.sock`.

**Posting (write side):**
Send a datagram containing the domain name string to the socket. If the socket doesn't exist or nobody is listening, the send fails silently.

**Receiving (read side):**
Bind to the socket, receive datagrams. Each datagram is a domain name. On receipt, re-read that domain from the database.

**Limitation:** Unix datagram sockets are point-to-point, not broadcast. To support multiple listeners, either:
- Use a directory of per-client sockets (each client creates its own, writer sends to all)
- Use an abstract socket with SO_REUSEADDR (Linux-specific)
- Use a tiny broker process

The simplest approach: each client creates a socket at `/tmp/tugbank-notify-<pid>.sock` and registers it in a known directory. The writer iterates the directory and sends to each. Clients clean up their socket on exit.

This is more complex than Darwin notifications, which is why Darwin notifications are the preferred tier on macOS.

## Client Behavior on Notification

When a client receives a "domain changed" notification:

1. **Check if the domain is cached.** If not, ignore — the client doesn't care about this domain.
2. **Re-read the domain from the database** via `read_all()` or equivalent.
3. **Replace the cached snapshot.**
4. **Fire any registered `onDomainChanged` callbacks.**

This is the same cache-refresh logic that exists today, just triggered by an explicit notification instead of a polling timer.

## What Gets Simpler

| Component | Before | After |
|-----------|--------|-------|
| Rust TugbankClient | Dedicated polling thread, `mpsc` channel, `AtomicBool` shutdown | No thread. Register for notifications on construction. |
| Swift TugbankClient | `Timer` polling + Rust polling thread (double-poll) | Register `notify_register_dispatch`. No timer, no thread. |
| tugtalk TugbankClient | `setInterval` polling | Register for notifications (Bun FFI or helper). No timer. |
| tugdeck TugbankClient | WebSocket push (already correct) | No change. tugcast receives the notification, rebuilds the DEFAULTS frame, pushes via WebSocket. |
| tugbank CLI | No notification | Add `notify_post` after successful write. One line. |

## Notification Naming Convention

```
dev.tugtool.tugbank.changed.<domain>
```

Examples:
- `dev.tugtool.tugbank.changed.dev.tugtool.app`
- `dev.tugtool.tugbank.changed.dev.tugtool.deck.layout`
- `dev.tugtool.tugbank.changed.dev.tugtool.deck.tabstate`

Clients register for the specific domains they cache. This avoids unnecessary wake-ups.

## What Stays the Same

- The in-memory cache (read from DB on first access, serve from memory after)
- Write-through cache (write to DB, update local cache)
- The `onDomainChanged` callback registry
- The `get`/`set`/`readDomain`/`listDomains` API surface

## What Gets Removed

- All polling threads and timers
- `PRAGMA data_version` checks (no longer needed — notifications are authoritative)
- Per-domain generation tracking (just re-read the whole domain on notification)
- The `mpsc` channel shutdown mechanism in the Rust client
- The `AtomicBool` / `SyncSender` shutdown coordination

## Implementation Order

### Dash 1: Darwin notifications for Rust + Swift clients

One coordinated change across the write and listen sides:

- Add `notify_post` to the `tugbank` CLI write path (one line in Rust)
- Add `notify_post` to the Rust `TugbankClient::set()` so tugcast broadcasts when it writes
- Replace the Rust polling thread with `notify_register_dispatch` (via FFI to libSystem) — remove the thread, channel, and shutdown machinery
- Replace the Swift `Timer` with `notify_register_dispatch` — remove the timer, remove the double-poll
- tugdeck: no change — already push-based via WebSocket; tugcast receives the notification, rebuilds the DEFAULTS frame, pushes to clients

### Dash 2: Darwin notifications for tugtalk

- Register for notifications via Bun FFI (call `notify_register_dispatch` from libSystem) or a small native helper
- Remove the `setInterval` polling loop

### Dash 3: Unix domain socket fallback

Implement the cross-platform notification tier alongside Darwin notifications. Both tiers are written and both are tested on macOS:

- Implement the Unix datagram socket broadcast mechanism
- Wire it into the same write paths (tugbank CLI, TugbankClient::set)
- Wire listeners in Rust, Swift, and tugtalk clients
- Test on macOS to confirm it works correctly
- The runtime selects Darwin notifications on macOS; the Unix socket path is available for other platforms

### Dash 4: Audit and cleanup

Sweep the codebase for dead code, leftover polling machinery, and bad patterns from the iterative development process:

- Remove any remaining polling threads, timers, `setInterval` loops, `PRAGMA data_version` checks
- Remove `mpsc` channel / `SyncSender` / `AtomicBool` shutdown coordination in the Rust client
- Remove per-domain generation tracking if no longer used
- Remove unused imports, dead functions, orphaned test helpers
- Verify the `tugbank-ffi` crate doesn't spawn a polling thread (if `TugbankClient::open` still spawns one, switch to a lighter-weight handle or add a no-poll option)
- Verify no double-poll paths remain in any client
- Check that the Justfile, build scripts, and Xcode project don't reference removed code
- Run `just ci` (Rust), `tsc --noEmit` (tugdeck), `bun test` (tugtalk), and `just app` (Swift) to confirm everything builds and runs clean
- Verify the app launches without a hitch, loads saved cards, and responds to `tugbank write` changes via Darwin notifications
