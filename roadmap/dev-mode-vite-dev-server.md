# Dev Mode: Vite Dev Server Architecture

## Problem

Dev mode hot-reload is broken. Editing a CSS file causes "index.html not found."
The app flashes and dies on launch. The system has been broken since the React
migration and the recent bun-to-vite swap made it worse.

### Root cause

`vite build --watch` is a production build tool. Every source change triggers a
full Rollup + Tailwind rebuild (~2 seconds). During that rebuild, `dist/` files
are being rewritten. Meanwhile, tugcast's file watcher independently detects the
same source change and fires `reload_frontend`. The browser reloads while `dist/`
is mid-rebuild. 404.

Two independent systems react to the same source file change with no
coordination:

```
Developer edits tokens.css
  │
  ├── tugcast styles watcher detects change → reload_frontend (instant)
  │                                              │
  │                                              ▼
  │                                     Browser reloads NOW
  │                                              │
  └── vite build --watch detects change ──────── │ ── rebuilding dist/ (~2s)
                                                 │
                                                 ▼
                                     dist/index.html missing → 404
```

### Why this can't be patched

The race is structural. You can't debounce it away because the watcher and the
builder have no shared clock. You can't stabilize `dist/` writes because Vite
doesn't expose "build complete" events to external consumers. Setting
`emptyOutDir: false` doesn't help because Vite still atomically replaces files
during the write window.

More fundamentally: **a 2-second production rebuild has no place in a hot-reload
path.** Hot-reload means sub-100ms. `vite build --watch` cannot deliver that.

## Solution

Replace `vite build --watch` with `vite` (the development server). This is the
tool purpose-built for hot-reloading. CSS changes are hot-swapped via HMR in
under 100ms with no page reload. JS/TSX changes use React Fast Refresh. No
`dist/` directory is involved during development.

## Architecture

### Dev mode serving model

```
Browser / WKWebView
       │
       ▼
Vite Dev Server (port 5173)
       │
       ├── /src/**  →  serves source files with on-demand transforms
       │                CSS: hot-swapped via HMR WebSocket (<100ms)
       │                JSX: React Fast Refresh (<500ms)
       │
       └── /auth    ─┐
           /ws       ─┼─→  proxy to tugcast (port 7080)
           /api      ─┘
```

The browser loads from Vite. Vite serves assets directly from source with
on-demand compilation. Auth, WebSocket, and API requests are proxied to tugcast.

### Production mode (unchanged)

```
Browser / WKWebView
       │
       ▼
tugcast
       │
       ├── /auth, /ws, /api  →  handled directly
       └── /*                 →  rust-embed (assets compiled into binary)
```

No changes to the production serving path. `vite build` still produces `dist/`
for embedding by `build.rs`.

### Fixed port for tugcast in dev mode

Tugcast uses a fixed port (7080) when dev mode is enabled. This allows:

- Vite's proxy config to use a static target (`http://localhost:7080`)
- Tugcast to rebind the same port after a restart (transparent to Vite)
- No dynamic port discovery or environment variable passing needed

In production (non-dev), tugcast continues to use port 0 (OS-assigned).

## Three tiers

### Tier 1: Styles — automatic, instant, no page reload

| Aspect | Value |
|--------|-------|
| Mechanism | Vite HMR |
| Latency | <100ms |
| Page reload | No — CSS hot-swapped in place |
| Tugcast involvement | None |
| Developer card | "Reloaded" flash via Vite HMR event listener |

When the developer edits `tokens.css`, Vite's dev server detects the change,
recompiles the CSS module, and pushes the update to the browser over its HMR
WebSocket. The browser applies the new styles without reloading the page. State
is preserved. No flash. No 404.

The Developer card's Styles row listens for Vite's `vite:afterUpdate` HMR event
to show the "Reloaded" indicator:

```typescript
if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", () => {
    // Flash "Reloaded" on styles row
  });
}
```

Tugcast has no styles watcher. There is no `reload_frontend` action for CSS.

### Tier 2: Code — frontend automatic, backend notification + restart

**Frontend (TS/TSX):**

| Aspect | Value |
|--------|-------|
| Mechanism | Vite HMR + React Fast Refresh |
| Latency | <500ms |
| Page reload | Rarely (only on HMR boundary failures) |
| Tugcast involvement | None |

React Fast Refresh preserves component state across edits. When HMR can't apply
a change (new module, changed exports), Vite falls back to a full page reload
automatically. This is standard React development workflow.

**Backend (Rust):**

| Aspect | Value |
|--------|-------|
| Mechanism | Binary mtime watcher in tugcast |
| Trigger | `tugcode/target/debug/tugcast` file changes |
| Notification | `dev_notification` type `restart_available` |
| Action | User clicks Restart in Developer card |

The developer runs `cargo build` (or `cargo-watch` does it). Tugcast's binary
watcher detects the mtime change and sends a notification. The Developer card
shows "N changes" with a Restart button. The user clicks when ready.

### Tier 3: App — notification + relaunch

| Aspect | Value |
|--------|-------|
| Mechanism | Source file watcher in tugcast |
| Trigger | `tugapp/Sources/**/*.swift` file changes |
| Notification | `dev_notification` type `relaunch_available` |
| Action | User clicks Relaunch in Developer card |

Unchanged from current design. Tugcast watches Swift source files, sends
notifications, user triggers relaunch when ready.

## Startup sequences

### `just app` (Mac app)

```
1. cargo build (produces tugcast, tugtool, tugcode binaries)
2. bun run build (produces dist/ for embedding in the cargo build above)
3. xcodebuild (builds Tug.app, links tugcast binary with embedded assets)
4. Copy binaries into Tug.app/Contents/MacOS/
5. Launch Tug.app

Inside Tug.app:
6. ProcessManager spawns tugcast --port 7080
7. ProcessManager spawns vite (dev server, port 5173)
8. tugcast sends ready message with auth URL
9. ProcessManager rewrites auth URL: port 7080 → port 5173
10. WKWebView loads http://localhost:5173/auth?token=...
11. Vite proxies /auth to tugcast → auth succeeds
12. Vite serves index.html + assets from source with HMR
13. Browser connects /ws through Vite proxy to tugcast
14. Dev mode control message sent → tugcast starts watchers (binary + app)
```

### `just dev` (CLI)

```
1. cargo build
2. tugtool starts
3. tugtool spawns tugcast --port 7080
4. tugtool spawns vite (dev server, port 5173, TUGCAST_PORT=7080)
5. tugcast sends ready message
6. tugtool rewrites auth URL → opens browser to http://localhost:5173/auth?token=...
7. Same flow as Mac app from step 11 onward
```

**No `ensure_dist_populated()` needed.** Vite serves from source. `dist/` is
irrelevant during development.

### Restart flow

```
1. User clicks Restart in Developer card
2. Frontend sends { action: "restart" } → Vite proxy → tugcast
3. Tugcast shuts down with exit code 42
4. Parent process (ProcessManager / tugtool) restarts tugcast on port 7080
5. Tugcast rebinds port 7080 (same port, transparent to Vite proxy)
6. Vite proxy reconnects automatically
7. Browser WebSocket reconnects through Vite proxy
8. Dev mode re-enabled, watchers restart
9. Developer card clears stale state (pending-flag confirmation)
```

No page navigation. No new auth URL. The Vite dev server stays running
throughout. The browser's WebSocket reconnect logic handles the brief
disconnect.

## What changes

### Vite config (`tugdeck/vite.config.ts`)

```typescript
server: {
  port: 5173,
  proxy: {
    "/auth": { target: "http://localhost:7080" },
    "/ws": { target: "ws://localhost:7080", ws: true },
    "/api": { target: "http://localhost:7080" },
  },
},
```

Port 7080 is hardcoded because tugcast uses a fixed port in dev mode.

### ProcessManager.swift

| Remove | Add |
|--------|-----|
| `viteProcess` with `["build", "--watch"]` | `viteProcess` with `[]` (Vite dev server, no args needed beyond implicit `dev`) |
| Auth URL used directly | Auth URL rewritten: tugcast port → Vite port |

The Vite process is now the dev server, not the build watcher. Arguments change
from `["build", "--watch"]` to `["--port", "5173"]` (or just run the `dev`
script via `bun run dev`).

### tugtool main.rs

| Remove | Add |
|--------|-----|
| `ensure_dist_populated()` | (deleted — not needed) |
| `spawn_vite_watch()` with `["build", "--watch"]` | `spawn_vite_dev()` with Vite dev server |
| Browser opens tugcast URL | Browser opens Vite URL |

### tugcast dev.rs

| Remove | Add |
|--------|-----|
| `dev_file_watcher` (styles watcher) | (deleted — Vite HMR handles styles) |
| `dist/index.html` mtime check in `dev_compiled_watcher` | (removed — no dist/ in dev mode) |
| `serve_dev_index()` / `serve_dev_asset()` in request path | (deleted — Vite serves assets) |
| `SharedDevState` asset serving logic | Simplified: only holds watcher state |
| `load_dev_state()` requiring `dist/index.html` | `init_dev_watchers()` requiring only source_tree |

`enable_dev_mode()` becomes:
1. Validate source_tree exists
2. Start backend binary watcher (`tugcode/target/debug/tugcast` mtime)
3. Start app source watcher (`tugapp/Sources/**/*.swift`)
4. Return success

No dist/ verification. No asset serving setup. No styles watcher.

### tugcast server.rs

The fallback handler simplifies. In dev mode, the fallback is never reached
because the browser doesn't request assets from tugcast — it gets them from
Vite. The `SharedDevState` check in the fallback can be removed or simplified
to a no-op in dev mode.

### Developer card (`developer-card.tsx`)

| Row | Old source | New source |
|-----|-----------|------------|
| Styles | `dev_notification` type `reloaded` from tugcast | Vite HMR `vite:afterUpdate` event |
| Code | `dev_notification` type `restart_available` (frontend + backend) | `dev_notification` type `restart_available` (backend only) |
| App | `dev_notification` type `relaunch_available` | Unchanged |

The pending-flag confirmation pattern stays. The badge calculation stays.
Git-based "Edited" state stays.

### Justfile

The `app` recipe keeps `bun run build` — it's needed for the `cargo build` step
that embeds assets into the tugcast binary via `build.rs`. This is the
production build path and is unrelated to dev mode serving.

The `dev` recipe needs no `bun run build` — Vite dev server serves from source.

## What gets removed

| Component | Why |
|-----------|-----|
| `vite build --watch` spawning | Replaced by Vite dev server |
| `ensure_dist_populated()` in tugtool | Vite serves from source, no dist/ needed |
| `dev_file_watcher` (styles watcher) in tugcast | Vite HMR handles CSS |
| `dist/index.html` mtime polling in compiled watcher | No dist/ in dev mode |
| `serve_dev_index()` / `serve_dev_asset()` | Vite serves assets |
| `load_dev_state()` dist verification | No dist/ needed |
| `reload_frontend` action for CSS changes | Vite HMR replaces full-page reload |
| `SharedDevState` asset serving path | No asset serving from tugcast in dev mode |

## What stays

| Component | Why |
|-----------|-----|
| `vite build` (production, in build.rs) | Needed for embedding assets in tugcast binary |
| rust-embed production serving | Production mode unchanged |
| Backend binary watcher | Backend changes need notification + restart |
| App source watcher | App changes need notification + relaunch |
| Developer card three-row design | Still the right UX |
| Pending-flag confirmation pattern | Still the right behavior |
| Git-based "Edited" state | Still useful |
| `dev_mode` control socket protocol | Still needed to activate watchers |

## Risks

### Vite dev server crashes

If the Vite process exits, the browser loses its asset server. Log a warning.
The developer restarts the app or runs `bun run dev` manually. Same failure mode
as the current `vite build --watch` crash, but more visible because the browser
immediately shows an error (instead of silently serving stale dist/ content).

### Port conflict on 7080

If another process holds port 7080, tugcast fails to bind. The error message
should be clear: "Port 7080 in use. Kill the stale process or set a custom port
with --port." This is the same class of error as the current dynamic port
approach, just with a fixed target.

### Vite HMR failure for complex JS changes

Vite falls back to a full page reload when HMR can't apply a change. This is
standard React development behavior and expected. The page reloads cleanly
because Vite is serving the latest source.

### CSP restrictions

The current `index.html` has a Content-Security-Policy that restricts sources
to `'self'`. Vite's dev server injects an HMR client script. In dev mode, Vite
serves the HTML and controls the CSP, so this is not an issue — Vite handles it
correctly. In production, the CSP stays restrictive.

## Implementation order

1. **Vite config**: Add proxy entries for `/auth`, `/api`. The `/ws` proxy
   already exists. Fix tugcast port to 7080.

2. **Tugcast**: Add `--port` flag. Simplify `enable_dev_mode()` to start only
   binary + app watchers. Remove styles watcher, dist/ verification, and dev
   asset serving.

3. **tugtool**: Replace `spawn_vite_watch()` (build --watch) with
   `spawn_vite_dev()` (dev server). Remove `ensure_dist_populated()`. Rewrite
   auth URL to point at Vite port. Open browser to Vite URL.

4. **ProcessManager.swift**: Same changes as tugtool — spawn Vite dev server,
   rewrite auth URL, load WKWebView from Vite URL.

5. **Developer card**: Switch styles row from `dev_notification` to Vite HMR
   events. Simplify code row to backend-only. Keep pending-flag pattern.

6. **Cleanup**: Remove dead code (`serve_dev_index`, `serve_dev_asset`,
   `load_dev_state`, `dev_file_watcher`, `reload_frontend` CSS path,
   `ensure_dist_populated`).

## Non-goals

- HMR state preservation across restarts (full reload on restart is fine)
- Changing the production build or embedding pipeline
- Vite dev server in production
- Custom Vite plugins for tugcast integration
- Replacing the `dev_mode` control socket protocol
