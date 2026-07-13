mod actions;
mod auth;
mod cli;
mod control;
mod defaults;
mod dev;
mod external_sessions;
mod feeds;
mod fs_complete;
mod fs_read;
mod fs_write;
mod host;
/// Crate-root path utilities (firmlink/synthetic/symlink resolution). Lives
/// at the root, not under `feeds/`, because both `feeds` (file watching) and
/// `session_ledger` (storage) depend on it — keeping it a leaf avoids a
/// storage→feeds back-reference.
mod path_resolver;
mod permissions;
mod resources;
mod router;
mod server;
mod session_ledger;
mod session_metadata_merge;
mod shell_ledger;
mod terminal_registry;
mod turn_engine;

#[cfg(test)]
mod integration_tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use tugbank_core::TugbankClient;
use tugbank_core::notify as tugbank_notify;
use tugcast_core::{FeedId, Frame};
use tugcore::instance as tug_instance;

use crate::auth::new_shared_auth_state;
use crate::feeds::agent_supervisor::{
    AgentSupervisor, AgentSupervisorConfig, LedgerSessionsRecorder, SessionsRecorder,
    SpawnerFactory, default_spawner_factory,
};
use crate::feeds::filetree::FileTreeQuery;
#[cfg(debug_assertions)]
use crate::feeds::stats::BuildStatusCollector;
use crate::feeds::stats::{ProcessInfoCollector, TokenUsageCollector};
use crate::feeds::terminal::{self, TerminalFeed};
use crate::feeds::workspace_registry::WorkspaceRegistry;
use crate::router::{BROADCAST_CAPACITY, FeedRouter};
use crate::session_ledger::SessionLedger;

#[tokio::main]
async fn main() {
    let _log_guard = tuglog::init("tugcast");

    // Write the per-instance bundle-path marker. When Swift launched
    // us it passed TUG_INSTANCE_ID and TUG_BUNDLE_PATH; the marker
    // anchors `tugutil instance prune` orphan detection. When either
    // var is unset (standalone harness launches, dev iteration) the
    // helper no-ops.
    match tug_instance::write_bundle_path_marker() {
        Ok(tug_instance::MarkerWrite::Written) => info!("bundle-path marker written"),
        Ok(tug_instance::MarkerWrite::Unchanged | tug_instance::MarkerWrite::Skipped) => {}
        Err(e) => warn!(error = %e, "failed to write bundle-path marker"),
    }

    // Create own process group so the app can kill tugcast + all children
    // (tugcode, bun) with a single kill(-pgid, SIGTERM). Without this,
    // children become orphans when the app force-kills tugcast.
    unsafe {
        libc::setpgid(0, 0);
    }

    // Parse CLI arguments
    let cli = cli::Cli::parse();

    // Duplicate-launch guard (per [D07]). When TUG_INSTANCE_ID is
    // set and the registry already lists a live tugcast for this
    // identity, bail out *before* binding any port. The walker in
    // `allocate_port` would otherwise quietly step to the next free
    // port and let a second tugcast cohabit, defeating the
    // single-instance semantics LaunchServices provides for the GUI
    // app. `--force` overrides the check — useful for harness rigs
    // that kill the previous process first.
    if !cli.force
        && let Some(id) = tug_instance::instance_id()
        && let Ok(Some(existing)) = tugcore::registry::find_by_id(&id)
    {
        eprintln!(
            "tugcast: another '{id}' instance is already running (PID {})",
            existing.pid
        );
        warn!(
            instance_id = %id,
            pid = existing.pid,
            port = existing.tugcast_port,
            "duplicate-launch refused; exiting EX_CANTCREAT (73)"
        );
        std::process::exit(73);
    }

    // Resolve the port we *want* to bind. Three branches:
    // - `--port <P>` explicit: use it (incl. 0 for OS-ephemeral)
    // - No --port + TUG_INSTANCE_ID set: derive per-instance port
    //   via FNV-1a hash, walk on collision, fall back to ephemeral
    // - No --port + no identity: legacy single-instance default 55255
    let requested_port: u16 = match cli.port {
        Some(p) => p,
        None => match tug_instance::instance_id() {
            Some(id) => {
                // App-test instances draw from a dedicated window so their
                // ports never overlap a live dev/release instance's.
                let (base, window) = tugcore::ports::tugcast_window_for(&id);
                match tugcore::ports::allocate_port(&id, base, window, tcp_port_is_free) {
                    tugcore::ports::AllocatedPort::Window { port, walk_offset } => {
                        if walk_offset > 0 {
                            info!(
                                port,
                                walk_offset, "derived tugcast port via walk-on-collision"
                            );
                        }
                        port
                    }
                    tugcore::ports::AllocatedPort::EphemeralFallback => {
                        warn!(
                            "tugcast port window {}..{} exhausted; falling back to OS-ephemeral",
                            base,
                            base + window
                        );
                        0
                    }
                }
            }
            None => 55255,
        },
    };

    // --force: kill any existing process holding the TCP port before we try to bind.
    if cli.force {
        force_kill_port_holder(requested_port);
    }

    // Bind the listener *now*, before auth state is constructed, so
    // we can use the actually-bound port (which may differ from the
    // request when port==0) in the auth allowlist and ready message.
    let listener = match TcpListener::bind(format!("127.0.0.1:{requested_port}")).await {
        Ok(l) => l,
        Err(e) => {
            // On EADDRINUSE, consult the registry: if a live tugcast
            // for the same instance ID is already registered, this is
            // a duplicate-launch collision (per [D07]). Exit code 73
            // (`EX_CANTCREAT`) signals "structurally cannot create"
            // — the Swift supervisor recognizes it as a duplicate and
            // does not retry the spawn.
            if e.kind() == std::io::ErrorKind::AddrInUse
                && let Some(id) = tug_instance::instance_id()
                && let Ok(Some(existing)) = tugcore::registry::find_by_id(&id)
            {
                eprintln!(
                    "tugcast: another '{id}' instance is already running (PID {})",
                    existing.pid
                );
                warn!(
                    instance_id = %id,
                    pid = existing.pid,
                    port = existing.tugcast_port,
                    "duplicate-launch collision; exiting EX_CANTCREAT (73)"
                );
                std::process::exit(73);
            }
            eprintln!("tugcast: error: failed to bind to 127.0.0.1:{requested_port}: {e}");
            std::process::exit(1);
        }
    };
    let actual_port: u16 = listener
        .local_addr()
        .map(|a| a.port())
        .unwrap_or(requested_port);
    info!(port = actual_port, "tugcast server listening");

    // Resolve bank path: --bank-path flag > TUGBANK_PATH env var >
    // per-instance `tugcore::instance::tugbank_db_path()` (when
    // TUG_INSTANCE_ID is set) > legacy `~/.tugbank.db`. Harness tests
    // that set TUGBANK_PATH still take precedence over the per-instance
    // path so a synthetic identity can be pointed at a temp DB.
    let bank_path: PathBuf = cli
        .bank_path
        .clone()
        .or_else(|| {
            std::env::var_os("TUGBANK_PATH")
                .map(PathBuf::from)
                .filter(|p| !p.as_os_str().is_empty())
        })
        .or_else(tug_instance::tugbank_db_path)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))
                .join(".tugbank.db")
        });

    // Ensure the parent directory exists. The per-instance data dir
    // (`~/Library/Application Support/Tug/instances/<id>/`) is not
    // created until first launch — TugbankClient::open below would
    // otherwise fail with ENOENT.
    if let Some(parent) = bank_path.parent()
        && let Err(e) = std::fs::create_dir_all(parent)
    {
        warn!(
            path = %parent.display(),
            error = %e,
            "failed to create tugbank parent directory (continuing)"
        );
    }

    info!(
        session = %cli.session,
        port = actual_port,
        source_tree = ?cli.source_tree,
        "tugcast starting"
    );

    // Verify tmux version
    match terminal::check_tmux_version().await {
        Ok(version) => info!("tmux version: {}", version),
        Err(e) => {
            eprintln!(
                "tugcast: error: tmux not found or version too old (requires 3.x+): {}",
                e
            );
            std::process::exit(1);
        }
    }

    // Ensure tmux session exists
    if let Err(e) = terminal::ensure_session(&cli.session).await {
        eprintln!(
            "tugcast: error: failed to create tmux session '{}': {}",
            cli.session, e
        );
        std::process::exit(1);
    }

    // Create auth state. With --no-auth, the token exchange and cookie still
    // work normally (so the app loads fine), but WebSocket validation is skipped
    // so external tools can connect without a session cookie.
    let auth = if cli.no_auth {
        auth::new_shared_auth_state_no_auth(actual_port)
    } else {
        new_shared_auth_state(actual_port)
    };

    let token = auth.lock().unwrap().token().unwrap().to_string();
    let auth_url = format!("http://127.0.0.1:{actual_port}/auth?token={token}");
    info!("Auth URL: {}", auth_url);

    // Connect to control socket if specified
    let control_socket = if let Some(ref path) = cli.control_socket {
        match control::ControlSocket::connect(path).await {
            Ok(cs) => Some(cs),
            Err(e) => {
                eprintln!("tugcast: error: failed to connect to control socket: {}", e);
                std::process::exit(1);
            }
        }
    } else {
        None
    };

    // Create the CODE_OUTPUT feed. The lag-recovery replay buffer lives
    // on the handle (P4): every frame published through it is buffered,
    // shared across sessions per [D06]; the tugdeck-side filter provides
    // isolation on replay per [D11].
    let code_output_feed = feeds::session_scoped::SessionScopedFeed::new(
        FeedId::CODE_OUTPUT,
        feeds::code::CODE_BROADCAST_CAPACITY,
        crate::router::LagPolicy::Replay(crate::router::ReplayBuffer::new(1000)),
    );
    let (code_input_tx, code_input_rx) = mpsc::channel(256);

    // SHELL feed — the `$` route's block-oriented shell execution. SHELL_OUTPUT
    // is a session-scoped broadcast (exchange frames tagged by tug_session_id);
    // SHELL_INPUT flows to the shell dispatcher (spawned below), which owns one
    // pipe-mode shell child per session.
    let shell_output_feed = feeds::session_scoped::SessionScopedFeed::new(
        FeedId::SHELL_OUTPUT,
        feeds::shell::SHELL_BROADCAST_CAPACITY,
        LagPolicy::Warn,
    );
    let (shell_input_tx, shell_input_rx) = mpsc::channel(256);

    // Create terminal feed. Its broadcast channel is created — and its
    // task spawned — by `register_stream_feed` below; only the input
    // sender is needed ahead of registration.
    let terminal_feed = TerminalFeed::new(cli.session.clone());
    let input_tx = terminal_feed.input_sender();

    // Make the watch directory absolute. PathResolver inside FileWatcher
    // handles all further resolution (symlinks, synthetic firmlinks, APFS
    // firmlinks, Linux bind mounts).
    //
    // Note: `cli.source_tree` is the transitional CLI flag name (formerly
    // `--dir`). Internally we still call the bootstrap-watched directory
    // `watch_dir` because that's what it is semantically — the Cargo walk
    // at T3.0.W3.b deletes the bootstrap entirely when the Dev card lands
    // a per-card project picker.
    let watch_dir = match cli.source_tree.clone() {
        Some(p) if p.is_absolute() => p,
        Some(p) => std::env::current_dir().unwrap_or_default().join(p),
        None => {
            // Distributed app: no project is bound at startup. The bootstrap
            // workspace exists only to emit the initial empty feed snapshots
            // an unbound Dev card renders against; per-card workspaces drive
            // every real feed directory at card-open time. Watch an empty
            // per-instance directory so nothing meaningful is observed.
            let dir = tug_instance::data_dir().join("bootstrap-empty");
            let _ = std::fs::create_dir_all(&dir);
            dir
        }
    };

    // Open the TugbankClient. On success, wrap in Arc for shared ownership between
    // migration, the defaults feed, and the HTTP server. On failure, log a warning
    // and continue without tugbank -- this preserves graceful degradation when the
    // bank path is inaccessible.
    let bank_client: Option<Arc<TugbankClient>> = match TugbankClient::open(&bank_path) {
        Ok(client) => Some(Arc::new(client)),
        Err(e) => {
            warn!(
                path = %bank_path.display(),
                error = %e,
                "failed to open TugbankClient — defaults endpoints and feed disabled"
            );
            None
        }
    };

    // App-test launches suppress the TugSetup wizard: the harness marker
    // (TUGAPP_TEST_SOCKET, inherited app → tugexec → tugcast) seeds the
    // tugbank default the deck reads synchronously at mount, so a fresh
    // per-instance bank never opens the blocking first-run wizard under a
    // focus-driven test. TUGAPP_TEST_KEEP_SETUP opts a TugSetup-specific
    // test back in — seeded `false` explicitly so a reused bank cannot
    // leak suppression into it. Written before the server accepts
    // connections, so the deck can never load ahead of the seed.
    if std::env::var_os("TUGAPP_TEST_SOCKET").is_some() {
        let keep_setup = std::env::var_os("TUGAPP_TEST_KEEP_SETUP").is_some();
        if let Some(bank) = bank_client.as_ref() {
            if let Err(e) = bank.set(
                "dev.tugtool.app",
                "suppress-setup",
                tugbank_core::Value::Bool(!keep_setup),
            ) {
                warn!(error = %e, "failed to seed app-test suppress-setup default");
            }
        }
    }

    let notify_socket_path = tugbank_notify::socket_path();

    // Open the session ledger BEFORE the DEFAULTS feed. A failure here is
    // fatal: the supervisor depends on the ledger to track session lifecycle,
    // and limping along with no session metadata would make every future
    // picker open misleading. Opening it here (rather than later) lets the
    // orphaned-prompt-history prune below run before the feed builds its
    // initial frame — keeping that frame clean and avoiding a frame rebuild
    // per deleted key.
    let ledger_path = SessionLedger::default_path().unwrap_or_else(|| {
        eprintln!("tugcast: error: cannot resolve user data dir for session ledger");
        std::process::exit(1);
    });
    if let Some(parent) = ledger_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!(
                "tugcast: error: failed to create ledger data dir {}: {}",
                parent.display(),
                e
            );
            std::process::exit(1);
        }
    }
    let ledger = match SessionLedger::open(&ledger_path) {
        Ok(l) => Arc::new(l),
        Err(e) => {
            eprintln!(
                "tugcast: error: failed to open session ledger at {}: {}",
                ledger_path.display(),
                e
            );
            std::process::exit(1);
        }
    };

    // Demote any rows still marked `live` from a previous run that didn't
    // shut down cleanly. The subprocesses they pointed at are gone; their
    // ledger state is stale.
    match ledger.demote_live_to_closed() {
        Ok(0) => {}
        Ok(n) => info!(count = n, "demoted stale live ledger rows on startup"),
        Err(e) => warn!(error = %e, "failed to demote stale live ledger rows"),
    }

    // Startup hygiene: drop per-session prompt-history entries whose session
    // no longer exists — the leak that bloated the boot DEFAULTS frame past
    // the transport cap and hung launch. Runs before the feed registers its
    // change callback so the deletions don't each rebuild the frame.
    if let Some(bank) = bank_client.as_ref() {
        match ledger.all_session_ids() {
            Ok(ids) => {
                let live: std::collections::HashSet<String> = ids.into_iter().collect();
                let removed = crate::defaults::prune_orphaned_session_keys(
                    bank,
                    crate::defaults::PROMPT_HISTORY_DOMAIN,
                    &live,
                );
                if removed > 0 {
                    info!(
                        count = removed,
                        "pruned orphaned prompt-history entries on startup"
                    );
                }
            }
            Err(e) => warn!(error = %e, "failed to list sessions for prompt-history prune"),
        }
    }

    // Create DEFAULTS feed from the TugbankClient.
    let defaults_rx: Option<tokio::sync::watch::Receiver<Frame>> = bank_client
        .as_ref()
        .map(|client| feeds::defaults::defaults_feed(Arc::clone(client)));

    // Shared cancellation token for the process. Declared before the
    // WorkspaceRegistry call because `get_or_create` needs a clone to hand
    // to the feed tasks it spawns internally.
    let cancel = CancellationToken::new();

    // Shared FILETREE-response broadcast channel. Every workspace's
    // `FileTreeFeed` publishes responses here; the router subscribes
    // once (below, via `add_broadcast_senders`) and fans out to every
    // connected client. JS-side filtering by `workspace_key` routes the
    // response to the right card. Buffer of 64 frames is comfortable
    // for FILETREE traffic (one frame per typed character, deduplicated
    // by JS) — a Lagged slow client drops some completions but doesn't
    // crash. Per `roadmap/dev-atoms.md#step-pre-4`.
    let (ft_response_tx, _) = broadcast::channel::<Frame>(64);

    // Shared GIT_DIFF-response broadcast channel ([#step-10a]). The
    // GIT_DIFF_QUERY adapter (below) publishes one single-shot
    // `GitDiffSnapshot` here per `/diff` request; the router fans it out to
    // every client and JS filters by `request_id` + `workspace_key`. A small
    // buffer suffices — `/diff` is a user-initiated, infrequent action.
    let (gd_response_tx, _) = broadcast::channel::<Frame>(16);

    // Shared USAGE-response broadcast channel. The USAGE_QUERY adapter (below)
    // publishes one single-shot `UsageSnapshot` here per `/usage` request; the
    // router fans it out and JS filters by `request_id`. Account-global (one
    // `claude -p "/usage"` per request, no workspace scoping), user-initiated
    // and infrequent, so a small buffer suffices.
    let (usage_response_tx, _) = broadcast::channel::<Frame>(16);

    // Create the bootstrap WorkspaceRegistry. In W1 this holds exactly one
    // entry (the startup `--source-tree`); W2 adds per-session `get_or_create`
    // calls from AgentSupervisor::spawn_session_worker. The registry owns
    // the FileWatcher, FilesystemFeed, FileTreeFeed, and GitFeed plus their
    // spawned tasks — see feeds/workspace_registry.rs and roadmap T3.0.W1.
    // Process-global recompute signal for the account-global CHANGESET_ALL
    // feed. Created before the registry so the registry can ping it on
    // open/close and the aggregate feed (built below) can await it. Shared
    // with the attribution `ChangesetBumper` so a file-event write in any
    // open project recomputes the aggregate.
    let changeset_all_bump = Arc::new(tokio::sync::Notify::new());

    let registry = Arc::new(WorkspaceRegistry::new(
        ft_response_tx.clone(),
        Arc::clone(&changeset_all_bump),
    ));
    let bootstrap = registry
        .get_or_create(&watch_dir, cancel.clone())
        .expect("bootstrap workspace must be a valid directory");

    // Adapter: router sends raw Frames on FILETREE_QUERY; parse JSON into
    // FileTreeQuery and forward to the workspace's FileTreeFeed.
    //
    // Routing strategy (`roadmap/dev-atoms.md#step-pre-4`): if the JS payload
    // carries a `root` field that resolves to a registered workspace, send
    // to that workspace's `ft_query_tx`. Otherwise fall back to the
    // bootstrap (the `--source-tree` workspace) — preserves single-workspace
    // behavior for legacy callers and the dev-loop case where no per-card
    // session has registered a project yet. A `root` that does not match
    // any registered workspace falls through to bootstrap as a defensive
    // default (the legacy `[D09]` retarget machinery still works there).
    let (ft_input_tx, mut ft_input_rx) = mpsc::channel::<Frame>(16);
    let ft_adapter_registry = Arc::clone(&registry);
    let bootstrap_ft_query_tx = bootstrap.ft_query_tx.clone();
    tokio::spawn(async move {
        while let Some(frame) = ft_input_rx.recv().await {
            #[derive(serde::Deserialize)]
            struct RawQuery {
                query: String,
                root: Option<String>,
            }
            match serde_json::from_slice::<RawQuery>(&frame.payload) {
                Ok(raw) => {
                    let ftq = FileTreeQuery {
                        query: raw.query,
                        root: raw.root.map(PathBuf::from),
                    };
                    ft_adapter_registry
                        .route_filetree_query(ftq, &bootstrap_ft_query_tx)
                        .await;
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        payload_len = frame.payload.len(),
                        "FILETREE_QUERY: malformed JSON payload"
                    );
                }
            }
        }
    });

    // Adapter: router sends raw Frames on GIT_DIFF_QUERY ([#step-10a]). Parse
    // `{root, requestId}`, resolve the workspace the diff belongs to (the
    // card's project dir — the Z4B chip's dir — falling back to bootstrap
    // exactly like the FILETREE adapter), then run a single `git diff HEAD`
    // there and broadcast the `GitDiffSnapshot` on GIT_DIFF. Each request is
    // serviced in its own task so a slow git invocation for one card never
    // head-of-line-blocks another's `/diff`.
    let (gd_input_tx, mut gd_input_rx) = mpsc::channel::<Frame>(16);
    let gd_registry = Arc::clone(&registry);
    let gd_bootstrap = Arc::clone(&bootstrap);
    let gd_response_tx_loop = gd_response_tx.clone();
    tokio::spawn(async move {
        #[derive(serde::Deserialize)]
        struct RawDiffQuery {
            root: Option<String>,
            #[serde(rename = "requestId")]
            request_id: Option<String>,
        }
        while let Some(frame) = gd_input_rx.recv().await {
            let raw = match serde_json::from_slice::<RawDiffQuery>(&frame.payload) {
                Ok(raw) => raw,
                Err(e) => {
                    warn!(
                        error = %e,
                        payload_len = frame.payload.len(),
                        "GIT_DIFF_QUERY: malformed JSON payload"
                    );
                    continue;
                }
            };
            let root_pb = raw.root.map(PathBuf::from);
            let entry = gd_registry.resolve_diff_target(root_pb.as_deref(), &gd_bootstrap);
            let request_id = raw.request_id.unwrap_or_default();
            let response_tx = gd_response_tx_loop.clone();
            tokio::spawn(async move {
                let snapshot = crate::feeds::git::build_git_diff_snapshot(
                    &entry.project_dir,
                    request_id,
                    entry.workspace_key.as_ref(),
                )
                .await;
                match serde_json::to_vec(&snapshot) {
                    Ok(json) => {
                        let _ = response_tx.send(Frame::new(FeedId::GIT_DIFF, json));
                    }
                    Err(e) => {
                        warn!(error = %e, "GIT_DIFF: failed to serialize response");
                    }
                }
            });
        }
    });

    // Adapter: router sends raw Frames on USAGE_QUERY. Parse `{requestId}`, run
    // one `claude -p "/usage"` (account-global — no workspace resolution), and
    // broadcast the `UsageSnapshot` on USAGE. Each request runs in its own task
    // so a slow `claude` invocation never head-of-line-blocks another card's
    // `/usage`.
    let (usage_input_tx, mut usage_input_rx) = mpsc::channel::<Frame>(16);
    let usage_response_tx_loop = usage_response_tx.clone();
    tokio::spawn(async move {
        #[derive(serde::Deserialize)]
        struct RawUsageQuery {
            #[serde(rename = "requestId")]
            request_id: Option<String>,
        }
        while let Some(frame) = usage_input_rx.recv().await {
            let request_id = serde_json::from_slice::<RawUsageQuery>(&frame.payload)
                .ok()
                .and_then(|r| r.request_id)
                .unwrap_or_default();
            let response_tx = usage_response_tx_loop.clone();
            tokio::spawn(async move {
                let (ok, text, error) = crate::feeds::claude_usage::fetch_usage_text().await;
                let snapshot = tugcast_core::types::UsageSnapshot {
                    request_id,
                    ok,
                    text,
                    error,
                };
                match serde_json::to_vec(&snapshot) {
                    Ok(json) => {
                        let _ = response_tx.send(Frame::new(FeedId::USAGE, json));
                    }
                    Err(e) => {
                        warn!(error = %e, "USAGE: failed to serialize response");
                    }
                }
            });
        }
    });

    // Create stats collectors
    let process_info =
        Arc::new(ProcessInfoCollector::new()) as Arc<dyn crate::feeds::stats::StatCollector>;
    let token_usage = Arc::new(TokenUsageCollector::new(cli.session.clone()))
        as Arc<dyn crate::feeds::stats::StatCollector>;
    // BuildStatusCollector is dev-only: it reads tugrust/target/, which
    // does not exist in a bundled Tug.app. Release tugcast skips both
    // construction and feed registration.
    #[cfg(debug_assertions)]
    let build_status = Arc::new(BuildStatusCollector::new(
        resources::source_tree().join("target"),
    )) as Arc<dyn crate::feeds::stats::StatCollector>;

    // Stats run through the unified stats surface: the subsystem creates
    // its own channels and spawns its tasks; the router receives only the
    // watch receivers (registered with the other snapshot watches below).
    // BuildStatusCollector is dev-only, so release skips the push and
    // `collectors.len()` still matches senders inside `StatsRunner::run`.
    #[allow(unused_mut)]
    let mut stats_collectors: Vec<Arc<dyn crate::feeds::stats::StatCollector>> =
        vec![process_info, token_usage];
    #[cfg(debug_assertions)]
    stats_collectors.push(build_status);
    let stats_watch_rxs = feeds::stats::spawn_stats_feeds(stats_collectors, cancel.clone());

    // Create shutdown channel for control commands
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<u8>(1);

    // Create broadcast channel for client-bound Control frames
    let (client_action_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

    // Create shared dev state (empty until runtime dev_mode control message)
    let shared_dev_state = dev::new_shared_dev_state();

    // Clone shutdown sender for control socket recv loop
    let ctl_shutdown_tx = shutdown_tx.clone();

    // Split control socket into reader and writer halves
    let mut control_writer: Option<control::ControlWriter> = None;
    let control_reader: Option<control::ControlReader> = if let Some(cs) = control_socket {
        let (writer, reader) = cs.split();
        control_writer = Some(writer);
        Some(reader)
    } else {
        None
    };

    // Start the tugbank notification socket listener.
    // Receives domain-change datagrams and calls refresh_domain() with debounce.
    if let Some(ref client) = bank_client {
        let notify_client = Arc::clone(client);
        let notify_cancel = cancel.clone();
        let notify_path = notify_socket_path.clone();
        tokio::spawn(async move {
            run_notify_listener(notify_path, notify_client, notify_cancel).await;
        });
    }

    // Create replay buffer for CodeOutput lag recovery (P4). Correctness
    // on replay relies on the client-side session filter per [D06]/[D11]:
    // the buffer is shared across sessions, and clients subscribed to
    // SESSION_STATE/SESSION_SIDEBAND filter frames by `tug_session_id`.
    use crate::router::LagPolicy;

    // Resolve tugcode path for the supervisor's default spawner factory.
    let tugcode_path = feeds::agent_bridge::resolve_tugcode_path(cli.tugcode_path.as_deref());
    if !tugcode_path.exists() {
        panic!(
            "tugcode not found at {} — tugcode is required for tugcast to run",
            tugcode_path.display()
        );
    }

    // Construct the multi-session supervisor. SESSION_STATE is a
    // SessionScopedFeed (created here, registered with the router below);
    // SESSION_SIDEBAND's broadcast channel is created here and registered
    // below. The supervisor publishes CONTROL error frames onto the same
    // broadcast that `register_stream` wires for FeedId::CONTROL so
    // clients observe them in-band.
    let session_state_feed = feeds::session_scoped::SessionScopedFeed::new(
        FeedId::SESSION_STATE,
        BROADCAST_CAPACITY,
        LagPolicy::Warn,
    );
    let session_sideband_feed = feeds::session_scoped::SessionScopedFeed::new(
        FeedId::SESSION_SIDEBAND,
        BROADCAST_CAPACITY,
        LagPolicy::Warn,
    );
    // ACTIVITY ([P16] byte 0x42) — a native SessionScopedFeed ([P14]). The
    // supervisor's merger diverts tugcode's `activity_delta` frames onto it
    // ([P13]); the OS subtree sampler (a later step) publishes gauge samples
    // through the same handle. `LagPolicy::Warn` per [P17]: the deck wants
    // the sample stream, and a dropped low-volume bin self-heals.
    let activity_feed = feeds::session_scoped::SessionScopedFeed::new(
        FeedId::ACTIVITY,
        BROADCAST_CAPACITY,
        LagPolicy::Warn,
    );

    // Per [D15], tugbank unavailability is still a fatal startup error
    // because other tugcast subsystems (defaults, recents, layout) need it.
    if bank_client.is_none() {
        eprintln!(
            "tugcast: error: tugbank unavailable at {}, cannot start without it",
            bank_path.display()
        );
        std::process::exit(1);
    }

    // Shell-exchange ledger — non-fatal: a failure means the `$` route just
    // won't persist exchanges (the deck degrades to no shell restore), which
    // must not take tugcast down.
    let shell_ledger: Option<Arc<shell_ledger::ShellLedger>> = shell_ledger::ShellLedger::default_path()
        .and_then(|path| {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match shell_ledger::ShellLedger::open(&path) {
                Ok(l) => Some(Arc::new(l)),
                Err(e) => {
                    warn!(error = %e, path = %path.display(), "failed to open shell ledger (shell persistence disabled)");
                    None
                }
            }
        });

    let ledger_recorder = Arc::new(LedgerSessionsRecorder::with_broadcast(
        Arc::clone(&ledger),
        client_action_tx.clone(),
    ));

    // Age sweep: drop every non-live row whose `last_used_at` is older
    // than the configured cap. Runs after `demote_live_to_closed` so the
    // demoted rows have a chance to be swept too if they're already old.
    // Broadcasts go nowhere yet — there are no clients connected — but
    // the recorder's broadcast call is harmless against an empty
    // subscriber set.
    let max_age_ms = crate::session_ledger::DEV_LEDGER_MAX_AGE_DAYS * 86_400_000;
    ledger_recorder.sweep_expired_with_broadcast(max_age_ms, crate::session_ledger::now_millis());

    // Trash sweep: walk every workspace's `.tug-trash/<deletedAt>/`
    // under `~/.claude/projects/` and remove any deletedAt subdir older
    // than 7 days. Runs after the age sweep so freshly-trashed JSONLs
    // (recoverable for 7 days) aren't immediately lost.
    let trash_max_age_ms = crate::session_ledger::DEV_TRASH_SWEEP_AGE_DAYS * 86_400_000;
    let trash_swept = ledger.sweep_trash(trash_max_age_ms, crate::session_ledger::now_millis());
    if trash_swept > 0 {
        info!(
            count = trash_swept,
            "swept stale trash directories on startup"
        );
    }

    // Background warm scan: pre-populate the external-session scan cache
    // for every project dir that already has ledger rows, so the picker's
    // first open after launch finds terminal-created sessions already
    // cached (a warm, stat-only scan) instead of paying the multi-second
    // cold JSONL parse on the user's timeline. Detached and best-effort:
    // it never blocks startup, and an empty/failed scan is harmless. The
    // scan itself fans out across cores (rayon), and `scan_*_cached` is
    // idempotent, so a concurrent picker scan during warm-up only
    // duplicates work, never corrupts.
    {
        let ledger = Arc::clone(&ledger);
        tokio::task::spawn_blocking(move || {
            let dirs = match ledger.distinct_workspaces() {
                Ok(dirs) => dirs,
                Err(err) => {
                    warn!(error = %err, "warm scan: distinct_workspaces failed");
                    return;
                }
            };
            for dir in dirs {
                let outcome =
                    crate::external_sessions::scan_external_sessions_cached(&ledger, &dir);
                if outcome.parsed > 0 {
                    info!(
                        project_dir = %dir,
                        parsed = outcome.parsed,
                        cache_hits = outcome.cache_hits,
                        "warm scan populated external-session cache",
                    );
                }
            }
        });
    }

    let sessions_recorder: Arc<dyn SessionsRecorder> = ledger_recorder;

    let supervisor_config = AgentSupervisorConfig {
        tugcode_path: tugcode_path.clone(),
        ..Default::default()
    };
    let spawner_factory: SpawnerFactory = default_spawner_factory(&supervisor_config);

    let (mut supervisor, merger_register_rx) = AgentSupervisor::new_with_ledger(
        session_state_feed.clone(),
        session_sideband_feed.clone(),
        code_output_feed.clone(),
        activity_feed.clone(),
        client_action_tx.clone(),
        sessions_recorder,
        Some(Arc::clone(&ledger)),
        spawner_factory,
        supervisor_config,
        Arc::clone(&registry),
        cancel.clone(),
    );
    // Give the supervisor the shell ledger so `list_shell_exchanges` can read
    // the tail the shell dispatcher writes.
    if let Some(sl) = shell_ledger.as_ref() {
        supervisor.set_shell_ledger(Arc::clone(sl));
    }

    // PULSE — app-wide color commentary. One bridge per process: it
    // taps the shared CODE_OUTPUT broadcast for the allowlisted frame
    // subset, lazily spawns/supervises the tugpulse daemon (gated on
    // the `pulse/enabled` tugbank default, ON by default), and the
    // daemon's lines land in the capped ledger + the PULSE broadcast.
    // A StreamFeed: its channel, lag policy, and task come from
    // `register_stream_feed` below.
    let tugpulse_path = feeds::pulse::resolve_tugpulse_path(&tugcode_path);
    let pulse_enabled: Arc<dyn Fn() -> bool + Send + Sync> = {
        let bank = bank_client.clone();
        Arc::new(move || {
            let Some(bank) = bank.as_ref() else {
                return true;
            };
            match bank.get(
                feeds::pulse::PULSE_ENABLED_DOMAIN,
                feeds::pulse::PULSE_ENABLED_KEY,
            ) {
                Ok(Some(tugbank_core::Value::Bool(enabled))) => enabled,
                // Absent / other-typed / unreadable all read as the
                // default-ON posture ([P06]).
                _ => true,
            }
        })
    };
    let pulse_bridge = feeds::pulse::PulseBridge::new(feeds::pulse::PulseBridgeConfig {
        spawner: Arc::new(feeds::pulse::TugpulseSpawner { tugpulse_path }),
        enabled: pulse_enabled,
        ledger: Some(Arc::clone(&ledger)),
        code_tx: code_output_feed.sender(),
    });

    let supervisor = Arc::new(supervisor);

    // Rebind persisted ledger rows. Per [F15] this only populates the
    // in-memory ledger — `client_sessions` is left untouched and real
    // clients connecting after startup send their own `spawn_session`
    // CONTROL frames.
    match supervisor.rebind_from_ledger().await {
        Ok(count) if count > 0 => info!(count, "rebound ledger rows on startup"),
        Ok(_) => {}
        Err(e) => warn!(error = %e, "rebind_from_ledger failed (non-fatal)"),
    }

    // Spawn the supervisor's dispatcher task (consumes CODE_INPUT, routes
    // to per-session workers) and merger task (fans in per-session stdout
    // streams and publishes system_metadata to SESSION_SIDEBAND).
    let dispatcher_supervisor = Arc::clone(&supervisor);
    tokio::spawn(async move {
        dispatcher_supervisor.dispatcher_task(code_input_rx).await;
    });
    // Shell dispatcher: routes SHELL_INPUT to per-session pipe-mode shell
    // children, publishes exchange frames on SHELL_OUTPUT, and records each
    // settled exchange to the shell ledger for restore.
    let shell_dispatch_feed = shell_output_feed.clone();
    let shell_dispatch_ledger = shell_ledger.clone();
    let shell_dispatch_cancel = cancel.clone();
    tokio::spawn(async move {
        feeds::shell::shell_dispatcher_task(
            shell_input_rx,
            shell_dispatch_feed,
            shell_dispatch_ledger,
            shell_dispatch_cancel,
        )
        .await;
    });
    let merger_cancel = cancel.clone();
    let merger_supervisor = Arc::clone(&supervisor);
    tokio::spawn(async move {
        merger_supervisor
            .merger_task(merger_register_rx, merger_cancel)
            .await;
    });

    // Spawn the OS resource sampler: at 1 Hz (gated to live sessions) it
    // walks each session's tugcode subtree and publishes CPU/memory gauge
    // samples onto the ACTIVITY feed ([P08]-[P10], [P20]).
    let sampler_supervisor = Arc::clone(&supervisor);
    let sampler_activity = activity_feed.clone();
    let sampler_cancel = cancel.clone();
    tokio::spawn(async move {
        feeds::activity::resource::run_resource_sampler(
            sampler_supervisor,
            sampler_activity,
            sampler_cancel,
        )
        .await;
    });

    // Build feed router with dynamic registration
    let mut feed_router = FeedRouter::new(
        cli.session.clone(),
        auth.clone(),
        shutdown_tx,
        shared_dev_state.clone(),
    );

    // Register stream feeds through the trait-mediated path — each feed
    // self-describes its id, lag policy, and channel capacity, and the
    // router creates the channel and spawns the task.
    feed_router.register_stream_feed(Box::new(terminal_feed), cancel.clone());
    // PULSE commentary lines fan out to every connected deck; the tail
    // a reconnecting deck needs comes from the `list_pulse_lines`
    // CONTROL read, not feed replay ([P09]).
    feed_router.register_stream_feed(Box::new(pulse_bridge), cancel.clone());

    feed_router.register_session_feed(&code_output_feed);
    // SHELL_OUTPUT — session-scoped exchange frames; the reconnect tail comes
    // from the ledger CONTROL read, not feed replay (like PULSE).
    feed_router.register_session_feed(&shell_output_feed);
    // CONTROL stays a channel-registered stream: router-internal,
    // bidirectional, and the sink for router-emitted error frames — one
    // of the two named exemptions from the feed abstraction.
    feed_router.register_stream(FeedId::CONTROL, client_action_tx, LagPolicy::Warn);
    // SESSION_STATE / SESSION_SIDEBAND are broadcast streams (not snapshot
    // watches) per [D14]: a single watch slot would clobber concurrent
    // per-session updates. Per-session replay on reconnect is handled
    // event-driven inside `AgentSupervisor::handle_control("spawn_session")`
    // — there is no snapshot-watch registration for either feed.
    feed_router.register_session_feed(&session_state_feed);
    feed_router.register_session_feed(&session_sideband_feed);
    // ACTIVITY ([P16]) — a native SessionScopedFeed client. The merger
    // publishes diverted `activity_delta` samples through the handle; the
    // router wires the same broadcast channel into client delivery.
    feed_router.register_session_feed(&activity_feed);

    // Register input sinks (client → server backends). CODE_INPUT points
    // at the supervisor's dispatcher (spawned above); the dispatcher
    // parses `tug_session_id`, consults the ledger, and routes to the
    // per-session worker.
    feed_router.register_input(FeedId::TERMINAL_INPUT, input_tx.clone());
    feed_router.register_input(FeedId::TERMINAL_RESIZE, input_tx);
    feed_router.register_input(FeedId::CODE_INPUT, code_input_tx);
    feed_router.register_input(FeedId::SHELL_INPUT, shell_input_tx);
    feed_router.register_input(FeedId::FILETREE_QUERY, ft_input_tx);
    feed_router.register_input(FeedId::GIT_DIFF_QUERY, gd_input_tx);
    feed_router.register_input(FeedId::USAGE_QUERY, usage_input_tx);

    // Attach the supervisor to the router so `handle_client` can intercept
    // session-lifecycle CONTROL frames and cross-check CODE_INPUT P5
    // ownership claims against `client_sessions`.
    feed_router.set_supervisor(Arc::clone(&supervisor));

    // Register snapshot watches. `stats_build_rx` is pushed only in debug
    // builds since BuildStatusCollector is gated out of release.
    //
    // `bootstrap.ft_watch_rx` is INCLUDED here even though FILETREE
    // responses now flow primarily through the shared broadcast
    // channel: the watch carries the bootstrap's initial empty
    // `FileTreeSnapshot`, and the router's "deliver latest value on
    // connect" pass for snapshot_watches is what causes the dev card
    // to see *any* FILETREE frame before a query has been sent. The
    // dev card gates rendering on `feedData.size > 0` across
    // `[CODE_INPUT, CODE_OUTPUT, SESSION_SIDEBAND, FILETREE]`; without
    // this initial empty frame, a brand-new card with no session
    // bound hangs at "Loading..." indefinitely. The broadcast does
    // not solve this on its own — broadcast carries no retained
    // history, so clients connecting after the initial publish miss
    // the empty snapshot.
    //
    // Bootstrap's *subsequent* responses (when a card is bound to the
    // tugtool repo) are written to BOTH the watch and the broadcast,
    // so JS receives them twice. Idempotent — the second parse
    // produces the same snapshot. Per-card workspaces write only to
    // the broadcast (their watches are never registered with the
    // router), so they don't double-publish.
    // Account-global aggregate changeset feed (CHANGESET_ALL, 0x24). One
    // process-level feed composing every open project into a single frame,
    // delivered like the other snapshot feeds (registered once, retained
    // latest value delivered on connect). Replaces the per-workspace
    // CHANGESET delivery, which only ever reached the bootstrap workspace.
    let (changeset_all_tx, changeset_all_rx) =
        tokio::sync::watch::channel(Frame::new(FeedId::CHANGESET_ALL, vec![]));
    let changeset_all_feed = feeds::changeset_all::ChangesetAllFeed::new(
        Arc::clone(&registry),
        Some(Arc::clone(&ledger)),
        Arc::clone(&changeset_all_bump),
    );
    tugcast_core::spawn_snapshot_feed(
        Box::new(changeset_all_feed),
        changeset_all_tx,
        cancel.clone(),
    );

    let mut snapshot_watches = vec![
        bootstrap.fs_watch_rx.clone(),
        bootstrap.ft_watch_rx.clone(),
        changeset_all_rx,
    ];
    snapshot_watches.extend(stats_watch_rxs);
    if let Some(rx) = defaults_rx {
        snapshot_watches.push(rx);
    }
    // SESSION_SIDEBAND and session_init snapshots moved to supervisor (Step 8).
    feed_router.add_snapshot_watches(snapshot_watches);
    // Multi-workspace FILETREE response stream — registered once. Every
    // connected client subscribes its own broadcast receiver in
    // `ClientState::Live` and forwards every frame to the socket. JS
    // filters by `workspace_key` to dispatch responses to the right
    // card. Per `roadmap/dev-atoms.md#step-pre-4`.
    feed_router.add_broadcast_senders(vec![ft_response_tx, gd_response_tx, usage_response_tx]);

    // Filesystem, filetree, and git feed tasks are owned by the
    // WorkspaceRegistry's bootstrap entry — spawned inside
    // `WorkspaceEntry::new` above; their tasks (and the stats subsystem's,
    // spawned by `spawn_stats_feeds` above) all run through the feed
    // abstraction's spawn paths.

    // The TCP listener is already bound above (right after CLI parse)
    // so the auth state and auth_url could use the actually-bound port.

    // Register with the per-host instance registry. Best-effort: if the
    // registry write fails we log and continue — `tugutil tell` will
    // not find us, but the runtime is otherwise unaffected.
    register_with_registry(actual_port, &cli.session);

    // Send ready message over control socket
    if let Some(ref mut writer) = control_writer {
        if let Err(e) = writer
            .send_ready(&auth_url, actual_port, std::process::id())
            .await
        {
            eprintln!("tugcast: warning: failed to send ready message: {}", e);
            // Non-fatal: continue without control socket
        }
    }

    // Create response channel and draining task for control socket writes
    let response_tx = if let Some(writer) = control_writer.take() {
        let (tx, mut rx) = mpsc::channel::<String>(4);
        let mut raw_writer = writer.into_inner();

        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            while let Some(msg) = rx.recv().await {
                let _ = raw_writer.write_all(msg.as_bytes()).await;
                let _ = raw_writer.write_all(b"\n").await;
                let _ = raw_writer.flush().await;
            }
            // Channel closed -- task exits
        });

        Some(tx)
    } else {
        None
    };

    // Spawn control socket receive loop
    if let Some(reader) = control_reader {
        let dev_state = shared_dev_state.clone();
        let ctl_stream_outputs = feed_router.stream_outputs.clone();
        let tx = response_tx
            .clone()
            .expect("response_tx must exist when control_reader exists");
        let ctl_pending_evals = feed_router.pending_evals.clone();
        tokio::spawn(reader.run_recv_loop(
            ctl_shutdown_tx,
            ctl_stream_outputs,
            dev_state,
            tx,
            auth.clone(),
            ctl_pending_evals,
        ));
    }

    // Start server and select! on shutdown channel + SIGTERM
    let server_future = server::run_server(listener, feed_router, shared_dev_state, bank_client);

    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("failed to register SIGTERM handler");
    let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
        .expect("failed to register SIGINT handler");

    // Watch for parent death (e.g. kill -9 on Tug.app). When our parent PID
    // changes to 1 (launchd/init), the parent is gone and we should exit.
    let parent_pid = unsafe { libc::getppid() };
    let parent_watch = async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let current_ppid = unsafe { libc::getppid() };
            if current_ppid != parent_pid {
                info!(
                    "Parent died (ppid {} → {}), shutting down",
                    parent_pid, current_ppid
                );
                break;
            }
        }
    };

    let exit_code = tokio::select! {
        result = server_future => {
            if let Err(e) = result {
                eprintln!("tugcast: error: server error: {}", e);
                1
            } else {
                0
            }
        }
        Some(code) = shutdown_rx.recv() => {
            info!("shutdown requested with exit code {}", code);
            code as i32
        }
        _ = sigterm.recv() => {
            info!("SIGTERM received, shutting down");
            0
        }
        _ = sigint.recv() => {
            info!("SIGINT received, shutting down");
            0
        }
        _ = parent_watch => {
            0
        }
    };

    // Send shutdown message via response channel (draining task writes to socket)
    if let Some(tx) = response_tx {
        let reason = shutdown_reason_for_exit_code(exit_code);
        let shutdown_json = control::make_shutdown_message(reason, std::process::id());
        let _ = tx.send(shutdown_json).await;
        drop(tx); // Close channel -- draining task exits after writing
    }

    // Clean up the notification socket before shutting down tasks.
    if let Err(e) = std::fs::remove_file(&notify_socket_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            warn!(error = %e, "failed to remove notification socket");
        }
    }

    // Signal shutdown for background tasks
    cancel.cancel();

    // Remove our entry from the per-host instance registry. Best-effort.
    if let Some(id) = tug_instance::instance_id()
        && let Err(e) = tugcore::registry::unregister(&id)
    {
        warn!(error = %e, "failed to unregister from tug-instances.json");
    }

    // App-test instances own an ephemeral private tmux server
    // (`tmux -L tug-<token>`). Tear it down on shutdown so each throwaway
    // `apptest-<uuid>` launch self-cleans instead of leaking a whole tmux
    // server per run. Dev/release instances deliberately KEEP their
    // server across restarts (tmux session persistence is a feature), so
    // this is gated on the app-test family. Best-effort.
    if let Some(id) = tug_instance::instance_id()
        && tugcore::ports::is_apptest_id(&id)
        && let Some(label) = tug_instance::tmux_socket_label()
    {
        info!(%label, "tearing down ephemeral app-test tmux server");
        let _ = std::process::Command::new(tug_instance::tmux_bin())
            .args(["-L", &label, "kill-server"])
            .status();
    }

    // Kill our entire process group (tugcast + tugcode + children).
    // `std::process::exit` doesn't run destructors, so `kill_on_drop`
    // and async cancellation can't be relied upon — sending SIGTERM
    // to our own pgid is the only mechanism that guarantees tugcode
    // children are signalled regardless of how we got here. tugcode's
    // SIGTERM handler then shuts claude down and exits cleanly.
    info!("Killing process group before exit");
    unsafe {
        libc::kill(0, libc::SIGTERM);
    }

    info!("tugcast shut down");
    std::process::exit(exit_code);
}

/// Run the tugbank notification socket listener.
///
/// Binds a Unix datagram socket at `path`, receives domain names as datagrams,
/// and calls `client.refresh_domain()` with 50ms per-domain debounce.
async fn run_notify_listener(path: PathBuf, client: Arc<TugbankClient>, cancel: CancellationToken) {
    // Remove stale socket from a previous run.
    let _ = std::fs::remove_file(&path);

    // Bind the socket (std UnixDatagram, then wrap for tokio).
    let std_sock = match std::os::unix::net::UnixDatagram::bind(&path) {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, path = %path.display(), "failed to bind notification socket");
            return;
        }
    };
    std_sock.set_nonblocking(true).unwrap();
    let sock = match tokio::net::UnixDatagram::from_std(std_sock) {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, "failed to convert notification socket to tokio");
            return;
        }
    };

    info!(path = %path.display(), "tugbank notification socket listening");

    let mut buf = [0u8; 512];
    let debounce_ms = Duration::from_millis(50);
    let mut pending: HashMap<String, tokio::time::Instant> = HashMap::new();

    loop {
        // Wait for the next datagram or a debounce timer to fire.
        let next_deadline = pending.values().copied().min();

        tokio::select! {
            _ = cancel.cancelled() => {
                info!("notification listener shutting down");
                break;
            }
            result = sock.recv(&mut buf) => {
                match result {
                    Ok(n) => {
                        if let Ok(domain) = std::str::from_utf8(&buf[..n]) {
                            let domain = domain.to_owned();
                            // Reset the debounce timer for this domain.
                            pending.insert(domain, tokio::time::Instant::now() + debounce_ms);
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "notification socket recv error");
                    }
                }
            }
            _ = async {
                match next_deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                // At least one debounce timer has fired. Drain all ready domains.
            }
        }

        // Drain any domains whose debounce timer has expired.
        let now = tokio::time::Instant::now();
        let ready: Vec<String> = pending
            .iter()
            .filter(|(_, deadline)| **deadline <= now)
            .map(|(domain, _)| domain.clone())
            .collect();
        for domain in ready {
            pending.remove(&domain);
            info!(domain = %domain, "tugbank domain changed — refreshing");
            client.refresh_domain(&domain);
        }
    }
}

/// Probe whether `127.0.0.1:port` accepts an immediate bind.
///
/// Used as the `is_free` predicate for `tugcore::ports::allocate_port`.
/// Synchronous `std::net::TcpListener` is enough — the probe happens
/// once during startup before the tokio runtime claims the port. The
/// listener drops immediately after the probe, releasing the port; a
/// successful probe is *not* a reservation, so a tight race window
/// remains between probe and the real bind. That race is acceptable
/// at Step 11; Step 12 turns the post-bind EADDRINUSE into a clean
/// exit with registry-derived diagnostics.
fn tcp_port_is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Register the running tugcast instance with the per-host registry.
///
/// Best-effort: a write failure is logged but does not abort startup.
/// The registry is read-only metadata for external tools — its
/// absence is recoverable, its corruption never blocks tugcast.
fn register_with_registry(actual_port: u16, tmux_session: &str) {
    let Some(id) = tug_instance::instance_id() else {
        return; // Standalone launch; no registry entry.
    };
    let bundle_path = tug_instance::bundle_path_from_env().unwrap_or_default();
    // Best-effort split of `<profile>-<branch-slug>`.
    let (profile, branch) = id
        .split_once('-')
        .map(|(p, b)| (p.to_owned(), b.to_owned()))
        .unwrap_or_else(|| (id.clone(), String::new()));
    let instance = tugcore::registry::Instance {
        instance_id: id.clone(),
        profile,
        branch,
        bundle_id: std::env::var("TUG_BUNDLE_ID").unwrap_or_default(),
        bundle_path,
        pid: std::process::id() as i32,
        // The parent process is the GUI host (`Tug.app`) that spawned
        // tugcast. Recording it lets `tugutil instance stop` tear down
        // the host app — tugcast then follows via its parent-watch
        // (see the parent_watch loop in `run`). `0` if somehow already
        // reparented (no live GUI host to signal).
        host_pid: {
            let ppid = unsafe { libc::getppid() };
            if ppid > 1 { ppid } else { 0 }
        },
        tugcast_port: actual_port,
        vite_port: 0,
        tmux_session: tmux_session.to_owned(),
        data_dir: tug_instance::data_dir(),
        started_at: tugcore::registry::now_rfc3339(),
    };
    if let Err(e) = tugcore::registry::register(instance) {
        warn!(error = %e, "failed to register with tug-instances.json (continuing)");
    } else {
        info!(instance_id = %id, "registered with tug-instances.json");
    }
}

/// Reclaim our derived port from a stale *same-instance* tugcast zombie.
///
/// Identity-gated on purpose: we kill the port holder ONLY when the
/// registry confirms it is our own (same `TUG_INSTANCE_ID`) previously
/// registered tugcast that failed to unregister. A holder belonging to
/// another instance, or any unrelated process that merely happens to sit
/// on the port, is never signalled — that blind `kill` was a
/// cross-instance footgun (an app-test launch could SIGKILL a live dev
/// instance). When we can't prove ownership we leave the holder alone
/// and let the normal `allocate_port` walk / EADDRINUSE path handle it.
fn force_kill_port_holder(port: u16) {
    // Without an identity we can't prove a holder is ours — do nothing.
    let Some(our_id) = tug_instance::instance_id() else {
        return;
    };
    // The only PID we're entitled to reclaim is the one the registry
    // recorded for THIS instance id (a stale/zombie self).
    let our_pid = match tugcore::registry::find_by_id(&our_id) {
        Ok(Some(entry)) => entry.pid,
        _ => return, // nothing registered for us → nothing to reclaim
    };

    let output = std::process::Command::new("lsof")
        .args(["-ti", &format!("tcp:{}", port)])
        .output();
    let pids = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return, // No process holding the port, or lsof not available.
    };

    for pid_str in pids.lines() {
        let Ok(pid) = pid_str.trim().parse::<i32>() else {
            continue;
        };
        if pid == our_pid {
            eprintln!(
                "tugcast: --force: reclaiming port {port} from our stale instance (PID {pid})"
            );
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        } else {
            warn!(
                pid,
                port,
                instance_id = %our_id,
                "--force: port holder is not our registered instance; not killing"
            );
        }
    }

    // Brief wait for the port to be released.
    std::thread::sleep(Duration::from_millis(100));
}

/// Map exit code to shutdown reason string
fn shutdown_reason_for_exit_code(code: i32) -> &'static str {
    match code {
        0 => "normal",
        42 => "restart",
        43 => "reset",
        45 => "relaunch",
        _ => "error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shutdown_reason_for_exit_code_normal() {
        assert_eq!(shutdown_reason_for_exit_code(0), "normal");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_restart() {
        assert_eq!(shutdown_reason_for_exit_code(42), "restart");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_reset() {
        assert_eq!(shutdown_reason_for_exit_code(43), "reset");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_relaunch() {
        assert_eq!(shutdown_reason_for_exit_code(45), "relaunch");
    }

    #[test]
    fn test_shutdown_reason_for_exit_code_error() {
        assert_eq!(shutdown_reason_for_exit_code(1), "error");
        assert_eq!(shutdown_reason_for_exit_code(-1), "error");
        assert_eq!(shutdown_reason_for_exit_code(99), "error");
    }
}
