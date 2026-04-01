# Tugbank Change Detection

## Problem

When a process writes to tugbank, other processes need to know. The writer knows what changed — it just needs to tell everyone else. This happens rarely (theme changes, CLI settings writes) but must be reliable when it does happen.

## What We Tried and Why It Failed

### Polling (original)

Every TugbankClient ran its own polling loop — dedicated threads, timers, `PRAGMA data_version` checks every 500ms. Too much machinery for infrequent events. Caused launch hitches, wasted CPU, added complexity (thread safety, cache invalidation, generation tracking) in every client.

### Darwin notifications

`notify_post` for broadcast works perfectly — one C call, fire-and-forget. But the Rust listen side was a disaster. `notify_register_dispatch` requires Objective-C blocks, which can't be done cleanly from Rust FFI. The workaround — `notify_register_file_descriptor` + hand-rolled `select()` loop + raw pointers — led to deadlocks, intermittent write failures, and unsafe code. Abandoned.

### Per-process Unix sockets

Each listening process creates its own socket (`~/.tugbank/notify/<pid>.sock`). Writers iterate the directory and `sendto` each. Problems: race conditions on socket creation, no coordination across processes, stale socket cleanup, runaway socket files, wrong directory location. Fundamentally unsuitable for cross-process coordination.

## Design: tugcast as IPC Coordinator

tugcast is already the long-running process that all other pieces depend on. It runs the HTTP server, the WebSocket, and the DEFAULTS feed. It is the natural coordination point.

### Architecture

```
                    ┌─────────────────────────────────┐
                    │           tugcast               │
                    │                                 │
                    │  ┌───────────────────────────┐  │
                    │  │ Unix datagram socket      │  │
                    │  │ (receives domain-change   │  │
                    │  │  notifications from CLI   │  │
                    │  │  and other writers)       │  │
                    │  └──────────┬────────────────┘  │
                    │             │                   │
                    │             ▼                   │
                    │  ┌───────────────────────────┐  │
                    │  │ TugbankClient             │  │
                    │  │ (refreshes cache,         │  │
                    │  │  fires onDomainChanged)   │  │
                    │  └──────────┬────────────────┘  │
                    │             │                   │
                    │             ▼                   │
                    │  ┌───────────────────────────┐  │
                    │  │ DEFAULTS feed             │  │
                    │  │ (rebuilds frame,          │  │
                    │  │  pushes via WebSocket)    │  │
                    │  └──────────┬────────────────┘  │
                    │             │                   │
                    └─────────────┼───────────────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    │             │              │
                    ▼             ▼              ▼
               ┌─────────┐ ┌─────────┐   ┌──────────┐
               │ tugdeck │ │ tugapp  │   │ tugtalk  │
               │ (WS)    │ │ (WS/FFI)│   │ (direct) │
               └─────────┘ └─────────┘   └──────────┘
```

### The Socket

tugcast creates and owns a single Unix datagram socket at a well-known path in the per-user runtime directory:
- **macOS:** `confstr(_CS_DARWIN_USER_TEMP_DIR)` → `/var/folders/.../T/tugbank-notify.sock`
- **Linux:** `$XDG_RUNTIME_DIR/tugbank-notify.sock` → `/run/user/<uid>/tugbank-notify.sock`

One socket. One owner (tugcast). No races.

**Single-instance guarantee:** tugcast's TCP port bind (default 55255) is the OS-enforced single-instance guard. If the port is already held by another tugcast, the new one fails to bind and exits. No advisory locks, no PID files.

**Force reclaim (`--force` flag):** Development escape hatch. When `--force` is passed and the TCP port is already bound, tugcast finds the PID holding the port, sends SIGKILL, waits briefly, then proceeds with normal startup. This avoids manual `lsof`/`pkill` work when a zombie tugcast is holding the port. Not the normal path — the normal path is: try to bind, fail if occupied, exit.

**Socket lifecycle:**
1. tugcast binds the TCP port. If this succeeds, we are the only tugcast.
2. If the notification socket file already exists, unlink it. (It's stale — the previous tugcast is dead, because if it were alive, the TCP bind would have failed.)
3. Bind the notification socket.
4. On clean shutdown, unlink the socket file.
5. On crash, the socket file is left behind — cleaned up by step 2 on the next startup, or by the OS on reboot (the runtime dir is tmpfs).

**The socket is a doorbell, not a queue.** It carries datagrams containing domain names — short strings like `dev.tugtool.app`. A datagram says "something changed in this domain, go re-read the database." If a datagram is dropped (kernel buffer full, tugcast not reading fast enough), the database still has the correct data — it just won't be pushed to clients until the next notification. This is acceptable for the use case (infrequent settings changes).

**Socket path:** Computed by `tugbank_core::notify::socket_path()` → `<std::env::temp_dir()>/tugbank-notify.sock`. On macOS this resolves to `/var/folders/.../T/tugbank-notify.sock`. This function lives in `tugbank-core` so every writer (CLI, tugcast, FFI) computes the exact same path.

**Self-notification:** When tugcast writes to tugbank via its own `TugbankClient::set()`, it broadcasts to its own socket. It receives its own notification, re-reads the domain, fires `onDomainChanged`, and the DEFAULTS feed rebuilds the frame. This is correct and necessary — it's the single code path by which the DEFAULTS feed learns about all writes, including those from tugdeck via HTTP PUT. Do not optimize this away.

Properties:
- `SOCK_DGRAM` — no connections, no handshake, no ordering guarantees
- Per-user directory with mode 700 — other users can't see or access it
- Managed by the OS — cleaned up on reboot (tmpfs)
- One socket per user, deterministic path — no PID, no port number
- No directory iteration on the write side — one `sendto` to a known path
- If tugcast isn't running, the socket doesn't exist, and writers fail silently (correct behavior)

### Write Side

Any process that writes to tugbank sends a datagram to the socket after the write succeeds:

```
sendto(tugbank-notify.sock, domain_name_bytes)
```

If the `sendto` fails, print a warning to stderr and move on. The DB write already succeeded — the notification is supplementary, not critical. No retry, no error code, no fallback.

```
warning: tugbank notify: <reason> (domain: dev.tugtool.app)
```

Failure modes:
- `ENOENT` — socket not found (tugcast not running). Warning: "socket not found — tugcast not running?"
- `ECONNREFUSED` — stale socket file (tugcast crashed). Warning: "stale socket"
- `ENOBUFS`/`EAGAIN` — kernel buffer full (tugcast not reading fast enough). Warning: "buffer full"

Writers:
- **tugbank CLI** — after successful `write`, `delete`, or `set_if_generation` command
- **Rust TugbankClient::set()** — after successful DB write (covers tugcast's own writes and FFI writes from tugapp)
- **tugtalk** — in `TugbankClient.set()` after successful `bun:sqlite` write

### Receive Side

tugcast binds the socket on startup and receives datagrams in a background task (tokio). Each datagram contains a domain name.

**Receive-side debounce (50ms):** When a datagram arrives for a domain, tugcast starts a 50ms timer for that domain. If another datagram arrives for the same domain during the window, the timer resets. When the timer fires, tugcast does the actual work:

1. Re-read the domain from the database via the TugbankClient
2. Update the in-memory cache
3. Fire `onDomainChanged` callbacks
4. The DEFAULTS feed callback rebuilds the aggregated frame and pushes it to all WebSocket clients

This collapses bursts (e.g., a script writing 10 keys to the same domain) into a single re-read and push. Single writes have 50ms latency — imperceptible for settings changes. The write side stays simple: broadcast immediately, no timer, no batching.

### Client Behavior

| Client | Writes via | Receives changes via |
|--------|-----------|---------------------|
| **tugbank CLI** | Direct DB + sendto socket | N/A (exits after write) |
| **tugcast** | TugbankClient::set() + sendto socket | Unix socket → cache refresh → DEFAULTS feed |
| **tugdeck** | HTTP PUT to tugcast | WebSocket DEFAULTS feed (already works) |
| **tugapp** | FFI → TugbankClient::set() + sendto socket | Indirectly via tugdeck bridge callbacks (see below) |
| **tugtalk** | Direct DB (bun:sqlite) + sendto socket | N/A (short-lived, reads at startup) |

**tugapp change flow:** tugapp (native Swift) doesn't have its own WebSocket connection to tugcast. tugdeck (running inside tugapp's WebView) receives DEFAULTS frames via WebSocket. When tugdeck detects a theme change, it applies the CSS theme and calls `bridgeSetTheme` via the WebKit message handler, which reaches Swift `AppDelegate` to update the window background color. So the full path for a CLI theme change is: CLI → socket → tugcast → DEFAULTS feed → WebSocket → tugdeck → bridge callback → tugapp native.

### Startup Ordering Constraint

tugcast must bind the notification socket before it reads any tugbank data or starts serving clients. The required startup order:

1. **Bind the TCP port** (single-instance guard). If occupied and `--force` is set, kill the holder and retry. If occupied without `--force`, exit with error.
2. **Unlink stale socket file if it exists, then bind the Unix datagram socket.** We know the previous owner is dead because the TCP bind succeeded.
3. **Open the TugbankClient** (read current DB state into cache).
4. **Start the HTTP server, WebSocket, and DEFAULTS feed.**
5. **Signal readiness** to the parent process (Tug.app).

The app (Tug.app) should make a best effort to ensure tugcast has completed step 1 before proceeding with other work that writes to tugbank (e.g., writing `source-tree-path`, configuring the Swift TugbankClient via FFI). This avoids the window where a write happens after tugcast reads the DB but before the socket is bound — which would cause the write to be invisible until the next notification.

If the socket isn't ready yet when a writer fires, the write still succeeds (it goes directly to the database) — the only consequence is that tugcast won't push the change to WebSocket clients until the next notification arrives. This is acceptable as a transient startup condition, not a correctness issue.

### What This Eliminates

- All polling threads, timers, `PRAGMA data_version` checks
- All Darwin notification code (`notify_post`/`notify_register_file_descriptor` FFI in Rust, `notify_register_dispatch` in Swift, `notify_post` via bun:ffi in tugtalk)
- The `libc` dependency in tugbank-core (was added for the `select()` loop)
- The `notify.h` bridging header import in Swift

## Cleanup (DONE)

All dead and broken code from the Darwin notification and per-process socket attempts has been removed:

- [x] notify.rs: rewritten to `socket_path()` + `broadcast_domain_changed()` only
- [x] client.rs: removed listener auto-start, added `refresh_domain()` method
- [x] tugbank CLI: removed `cfg(target_os = "macos")` gate on broadcast
- [x] Swift TugbankClient: removed `callbacks`, `onDomainChanged`, `data_version` tracking
- [x] Swift doc comments updated
- [x] ENOENT warning silenced (tugcast not running is normal)
- [x] All builds pass, tests pass, app launches with cards

Open minor items (not blocking implementation):
- `tugbank_data_version` still in FFI header/lib — harmless, could remove later
- `TugbankClient.configure` on background thread — moving to main thread caused app hang, investigating later

## Implementation

### tugtalk — add broadcast

- [ ] Add `sendto` to the Unix socket in `set()` after successful write
- [ ] Compute socket path via `os.tmpdir()` + `tugbank-notify.sock`

### tugcast — bind and listen on the notification socket

- [ ] Bind Unix datagram socket in main.rs startup (after TCP bind, before TugbankClient open)
- [ ] Unlink stale socket file before binding (safe — TCP bind already proved we're the only instance)
- [ ] Add receive loop in a tokio task with 50ms per-domain debounce
- [ ] On notification: call `TugbankClient::refresh_domain()` to reload cache + fire callbacks
- [ ] Unlink socket on clean shutdown
- [ ] Add `--force` flag for TCP port reclaim (kill holder, then bind)

### Verification

After implementation:
- [ ] `just ci` passes
- [ ] `cd tugdeck && npx tsc --noEmit` passes
- [ ] `cd tugtalk && bun test` passes
- [ ] `just app` — app launches, cards load, dev mode works
- [ ] Manual smoke test: `tugbank write dev.tugtool.app theme harmony` while app running — app reacts
- [ ] `tugbank write dev.tugtool.app theme brio` — app switches back
- [ ] Both transitions work without restart
