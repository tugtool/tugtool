# Tugbank Change Detection

## Decision

Drop all polling. Replace with explicit write-side broadcast via Unix domain sockets. When a client writes to tugbank, it sends a datagram with the domain name. Listening clients receive it and re-read from the database.

One mechanism, all platforms: Unix domain sockets. No Darwin notifications (the Rust listen side requires Objective-C blocks that can't be done cleanly from Rust — the `select()`-based workaround was fragile and buggy). The Swift client continues to use `notify_register_dispatch` for receiving since it works natively there, but the broadcast channel is the Unix socket.

**Update:** Darwin notifications work perfectly for Swift (one-line `notify_register_dispatch`) and for broadcast (`notify_post` from any language). But the Rust listener implementation was a failure — `notify_register_file_descriptor` + hand-rolled `select()` loop + raw pointers led to deadlocks and intermittent write failures. We're dropping the Rust Darwin listener entirely and using Unix sockets as the universal mechanism.

## Background

The actual need: when Process A writes to a domain, Process B should know about it. This happens rarely (theme changes, CLI settings writes). The writer knows what changed — it just needs to tell everyone else.

## Design

### Unix Domain Socket Broadcast

**Socket directory:** `~/.tugbank/notify/`

**Writer side:** After a successful write, send a datagram containing the domain name to every socket file in `~/.tugbank/notify/`. If no sockets exist (nobody listening), the send silently does nothing.

**Listener side:** Each listening process creates a socket at `~/.tugbank/notify/<pid>.sock`, then blocks on `recv()` in a background thread. Each received datagram is a domain name. On receipt, re-read that domain from the database and fire callbacks. On process exit, remove the socket file.

**Properties:**
- Pure `std::os::unix::net::UnixDatagram` in Rust — no FFI, no raw pointers
- `DatagramSocket` in Swift (Foundation)
- Bun can use `node:dgram` with `unix` type or spawn a tiny helper
- Works on macOS and Linux
- Cleanup: stale socket files (from crashed processes) are harmless — `sendto` on a stale socket returns ECONNREFUSED, writer ignores and moves on

### Broadcast function (all languages)

```
broadcast_domain_changed(domain):
    for each socket file in ~/.tugbank/notify/*.sock:
        try: sendto(socket_file, domain_name_bytes)
        catch: ignore (stale socket or process gone)
```

### Listener function (all languages)

```
start_listener():
    mkdir -p ~/.tugbank/notify/
    bind socket at ~/.tugbank/notify/<pid>.sock
    loop:
        domain = recv()
        if domain is cached:
            re-read domain from DB
            fire onDomainChanged callbacks
    on shutdown:
        remove ~/.tugbank/notify/<pid>.sock
```

## Client Behavior on Notification

1. **Check if the domain is cached.** If not, ignore.
2. **Re-read the domain from the database.**
3. **Replace the cached snapshot.**
4. **Fire any registered `onDomainChanged` callbacks.**

## What Gets Removed

- All Darwin notification code in Rust (`notify.rs` — `notify_post`, `notify_register_file_descriptor`, `select()` loop, `WatcherState`, raw pointers)
- All polling threads, timers, `PRAGMA data_version` checks
- The `libc` dependency added for `select()`/`pipe()`/`fcntl()`

## What Stays

- Swift `notify_register_dispatch` for the Swift client (it works, it's one line, keep it)
- Swift `notify_post` broadcast (works, keep it alongside the Unix socket broadcast)
- tugtalk `notify_post` via bun:ffi (works, keep it alongside the Unix socket broadcast)
- The in-memory cache, write-through cache, `onDomainChanged` callbacks, `get`/`set`/`readDomain`/`listDomains` API

## Implementation

### Single dash: Replace Rust Darwin listener with Unix socket

1. **Rewrite `notify.rs`:**
   - `broadcast_domain_changed(domain)`: iterate `~/.tugbank/notify/*.sock`, sendto each
   - `start_listener(callback)`: bind `~/.tugbank/notify/<pid>.sock`, spawn thread that blocks on `recv()`, calls callback with domain name
   - `stop_listener()`: close socket, remove file
   - No FFI, no raw pointers, no `select()`, no `libc`

2. **Update `TugbankClient`:**
   - `from_store`: start the Unix socket listener, wire callback to cache refresh + `onDomainChanged`
   - `set`: call `broadcast_domain_changed` after write
   - `Drop`: stop listener

3. **Update `tugbank` CLI:** call `broadcast_domain_changed` after write (already has this, just change the implementation)

4. **Swift client:** keep Darwin notifications for receiving (works). Add Unix socket broadcast alongside `notify_post` so Rust clients get notified too. Or just keep `notify_post` only — the Swift client doesn't need to notify Rust since Rust listens on the Unix socket.

   Actually: Swift writes call the FFI `tugbank_set` which goes through the Rust `TugbankClient::set()` which broadcasts via Unix socket. So Swift doesn't need its own broadcast — it goes through the FFI.

5. **tugtalk:** same — writes go through `bun:sqlite` directly, so tugtalk needs its own broadcast. Add the Unix socket sendto in the `set()` method alongside the existing `notify_post`.

6. **tugdeck:** no change — receives via WebSocket DEFAULTS feed.

### Testing

Same regime as before:
- `just ci` passes
- `tsc --noEmit` passes
- `bun test` passes
- `just app` — launches, cards load, dev mode
- Manual smoke test: `tugbank write dev.tugtool.app theme harmony` while app running — app reacts
- Both `harmony` and `brio` transitions work without restart
- Grep for dead polling code — zero hits
