mod actions;
mod auth;
mod cli;
mod control;
mod defaults;
mod dev;
mod feeds;
mod fs_complete;
mod host;
mod migration;
mod permissions;
mod resources;
mod router;
mod server;
mod session_ledger;
mod session_metadata_merge;

#[cfg(test)]
mod integration_tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use tugbank_core::TugbankClient;
use tugbank_core::notify as tugbank_notify;
use tugcast_core::{FeedId, Frame, StreamFeed};
use tugcore::instance as tug_instance;

use crate::auth::new_shared_auth_state;
use crate::feeds::agent_supervisor::{
    AgentSupervisor, AgentSupervisorConfig, LedgerSessionsRecorder, SessionsRecorder,
    SpawnerFactory, default_spawner_factory,
};
use crate::feeds::filetree::FileTreeQuery;
#[cfg(debug_assertions)]
use crate::feeds::stats::BuildStatusCollector;
use crate::feeds::stats::{ProcessInfoCollector, StatsRunner, TokenUsageCollector};
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
            Some(id) => match tugcore::ports::allocate_port(
                &id,
                tugcore::ports::TUGCAST_PORT_BASE,
                tugcore::ports::TUGCAST_PORT_WINDOW,
                tcp_port_is_free,
            ) {
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
                        tugcore::ports::TUGCAST_PORT_BASE,
                        tugcore::ports::TUGCAST_PORT_BASE + tugcore::ports::TUGCAST_PORT_WINDOW
                    );
                    0
                }
            },
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

    // One-time legacy ~/.tugbank.db migration into release-main.
    // Runs before TugbankClient::open so the copied DB is the one
    // opened. Skipped silently for non-release-main instances or
    // when the legacy file is absent. Errors are non-fatal — tugcast
    // continues with an empty per-instance DB on failure.
    if let Some(id) = tug_instance::instance_id()
        && let Some(parent) = bank_path.parent()
    {
        let legacy_path = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()))
            .join(".tugbank.db");
        match migration::migrate_legacy_tugbank(Some(&id), &legacy_path, parent) {
            Ok(migration::LegacyMigration::Migrated) => {
                info!(legacy = %legacy_path.display(), "copied legacy ~/.tugbank.db into release-main")
            }
            Ok(_) => {}
            Err(e) => warn!(error = %e, "legacy tugbank migration failed (non-fatal)"),
        }
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

    // Create broadcast channel for terminal output
    let (terminal_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

    // Create code channels
    let (code_tx, _) = broadcast::channel(feeds::code::CODE_BROADCAST_CAPACITY);
    let (code_input_tx, code_input_rx) = mpsc::channel(256);

    // Create terminal feed
    let feed = TerminalFeed::new(cli.session.clone());
    let input_tx = feed.input_sender();

    // Make the watch directory absolute. PathResolver inside FileWatcher
    // handles all further resolution (symlinks, synthetic firmlinks, APFS
    // firmlinks, Linux bind mounts).
    //
    // Note: `cli.source_tree` is the transitional CLI flag name (formerly
    // `--dir`). Internally we still call the bootstrap-watched directory
    // `watch_dir` because that's what it is semantically — the Cargo walk
    // at T3.0.W3.b deletes the bootstrap entirely when the Dev card lands
    // a per-card project picker.
    let watch_dir = if cli.source_tree.is_absolute() {
        cli.source_tree.clone()
    } else {
        std::env::current_dir()
            .unwrap_or_default()
            .join(&cli.source_tree)
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

    // Run the one-time flat-file-to-tugbank migration synchronously, before the
    // TCP listener binds, so no frontend fetch can race the migration writes [D05].
    // Dev-only: production Tug.app has no legacy `.tugtool/deck-settings.json`
    // to migrate (the file only ever existed on developer machines during the
    // pre-tugbank transition).
    #[cfg(debug_assertions)]
    if let Some(ref client) = bank_client {
        if let Err(e) = migration::migrate_settings_to_tugbank(&resources::source_tree(), client) {
            warn!(error = %e, "settings migration encountered an error (non-fatal)");
        }
    }

    let notify_socket_path = tugbank_notify::socket_path();

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

    // Create the bootstrap WorkspaceRegistry. In W1 this holds exactly one
    // entry (the startup `--source-tree`); W2 adds per-session `get_or_create`
    // calls from AgentSupervisor::spawn_session_worker. The registry owns
    // the FileWatcher, FilesystemFeed, FileTreeFeed, and GitFeed plus their
    // spawned tasks — see feeds/workspace_registry.rs and roadmap T3.0.W1.
    let registry = Arc::new(WorkspaceRegistry::new(ft_response_tx.clone()));
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

    // Create watch channels for stats feeds
    let (stats_agg_tx, stats_agg_rx) = watch::channel(Frame::new(FeedId::STATS, vec![]));
    let (stats_proc_tx, stats_proc_rx) =
        watch::channel(Frame::new(FeedId::STATS_PROCESS_INFO, vec![]));
    let (stats_token_tx, stats_token_rx) =
        watch::channel(Frame::new(FeedId::STATS_TOKEN_USAGE, vec![]));
    #[cfg(debug_assertions)]
    let (stats_build_tx, stats_build_rx) =
        watch::channel(Frame::new(FeedId::STATS_BUILD_STATUS, vec![]));

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

    // Start terminal feed in background task
    let feed_cancel = cancel.clone();
    let terminal_tx_for_router = terminal_tx.clone();
    tokio::spawn(async move {
        feed.run(terminal_tx, feed_cancel).await;
    });

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
    // SESSION_STATE/SESSION_METADATA filter frames by `tug_session_id`.
    use crate::router::{LagPolicy, ReplayBuffer};
    let code_replay = ReplayBuffer::new(1000);

    // Resolve tugcode path for the supervisor's default spawner factory.
    let tugcode_path = feeds::agent_bridge::resolve_tugcode_path(cli.tugcode_path.as_deref());
    if !tugcode_path.exists() {
        panic!(
            "tugcode not found at {} — tugcode is required for tugcast to run",
            tugcode_path.display()
        );
    }

    // Construct the multi-session supervisor. Broadcast channels for the
    // session-scoped feeds (SESSION_STATE, SESSION_METADATA) are created
    // here and registered with the router below. The supervisor publishes
    // CONTROL error frames onto the same broadcast that `register_stream`
    // wires for FeedId::CONTROL so clients observe them in-band.
    let (session_state_tx, _) = broadcast::channel(BROADCAST_CAPACITY);
    let (session_metadata_tx, _) = broadcast::channel(BROADCAST_CAPACITY);

    // Per [D15], tugbank unavailability is still a fatal startup error
    // because other tugcast subsystems (defaults, recents, layout) need it.
    if bank_client.is_none() {
        eprintln!(
            "tugcast: error: tugbank unavailable at {}, cannot start without it",
            bank_path.display()
        );
        std::process::exit(1);
    }

    // Open the session ledger. The data dir is created on demand. A failure
    // here is fatal: the supervisor depends on the ledger to track session
    // lifecycle, and limping along with no session metadata would make every
    // future picker open misleading.
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

    let sessions_recorder: Arc<dyn SessionsRecorder> = ledger_recorder;

    let supervisor_config = AgentSupervisorConfig {
        tugcode_path: tugcode_path.clone(),
        ..Default::default()
    };
    let spawner_factory: SpawnerFactory = default_spawner_factory(&supervisor_config);

    let (supervisor, merger_register_rx) = AgentSupervisor::new_with_ledger(
        session_state_tx.clone(),
        session_metadata_tx.clone(),
        code_tx.clone(),
        client_action_tx.clone(),
        sessions_recorder,
        Some(Arc::clone(&ledger)),
        spawner_factory,
        supervisor_config,
        Arc::clone(&registry),
        cancel.clone(),
    );
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
    // streams and publishes system_metadata to SESSION_METADATA).
    let dispatcher_supervisor = Arc::clone(&supervisor);
    tokio::spawn(async move {
        dispatcher_supervisor.dispatcher_task(code_input_rx).await;
    });
    let merger_cancel = cancel.clone();
    let merger_supervisor = Arc::clone(&supervisor);
    tokio::spawn(async move {
        merger_supervisor
            .merger_task(merger_register_rx, merger_cancel)
            .await;
    });

    // Build feed router with dynamic registration
    let mut feed_router = FeedRouter::new(
        cli.session.clone(),
        auth.clone(),
        shutdown_tx,
        shared_dev_state.clone(),
    );

    // Register stream outputs (broadcast feeds, server → client). The
    // CODE_OUTPUT Replay buffer stays shared across sessions per [D06];
    // correctness on replay relies on the tugdeck-side filter per [D11].
    feed_router.register_stream(
        FeedId::TERMINAL_OUTPUT,
        terminal_tx_for_router,
        LagPolicy::Bootstrap,
    );
    feed_router.register_stream(
        FeedId::CODE_OUTPUT,
        code_tx.clone(),
        LagPolicy::Replay(code_replay),
    );
    feed_router.register_stream(FeedId::CONTROL, client_action_tx, LagPolicy::Warn);
    // SESSION_STATE / SESSION_METADATA are broadcast streams (not snapshot
    // watches) per [D14]: a single watch slot would clobber concurrent
    // per-session updates. Per-session replay on reconnect is handled
    // event-driven inside `AgentSupervisor::handle_control("spawn_session")`
    // — there is no snapshot-watch registration for either feed.
    feed_router.register_stream(FeedId::SESSION_STATE, session_state_tx, LagPolicy::Warn);
    feed_router.register_stream(
        FeedId::SESSION_METADATA,
        session_metadata_tx,
        LagPolicy::Warn,
    );

    // Register input sinks (client → server backends). CODE_INPUT points
    // at the supervisor's dispatcher (spawned above); the dispatcher
    // parses `tug_session_id`, consults the ledger, and routes to the
    // per-session worker.
    feed_router.register_input(FeedId::TERMINAL_INPUT, input_tx.clone());
    feed_router.register_input(FeedId::TERMINAL_RESIZE, input_tx);
    feed_router.register_input(FeedId::CODE_INPUT, code_input_tx);
    feed_router.register_input(FeedId::FILETREE_QUERY, ft_input_tx);
    feed_router.register_input(FeedId::GIT_DIFF_QUERY, gd_input_tx);

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
    // `[CODE_INPUT, CODE_OUTPUT, SESSION_METADATA, FILETREE]`; without
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
    #[allow(unused_mut)]
    let mut snapshot_watches = vec![
        bootstrap.fs_watch_rx.clone(),
        bootstrap.ft_watch_rx.clone(),
        bootstrap.git_watch_rx.clone(),
        stats_agg_rx,
        stats_proc_rx,
        stats_token_rx,
    ];
    #[cfg(debug_assertions)]
    snapshot_watches.push(stats_build_rx);
    if let Some(rx) = defaults_rx {
        snapshot_watches.push(rx);
    }
    // SESSION_METADATA and session_init snapshots moved to supervisor (Step 8).
    feed_router.add_snapshot_watches(snapshot_watches);
    // Multi-workspace FILETREE response stream — registered once. Every
    // connected client subscribes its own broadcast receiver in
    // `ClientState::Live` and forwards every frame to the socket. JS
    // filters by `workspace_key` to dispatch responses to the right
    // card. Per `roadmap/dev-atoms.md#step-pre-4`.
    feed_router.add_broadcast_senders(vec![ft_response_tx, gd_response_tx]);

    // Filesystem, filetree, and git feed tasks are owned by the
    // WorkspaceRegistry's bootstrap entry — spawned inside
    // `WorkspaceEntry::new` above.

    // Start stats feeds in background task. BuildStatusCollector and its
    // watch sender are dev-only; release skips the push so collectors.len()
    // still matches senders.len() inside StatsRunner::run. `mut` is only
    // needed in debug; release is allowed to leave it unused.
    let stats_cancel = cancel.clone();
    #[allow(unused_mut)]
    let mut collectors: Vec<Arc<dyn crate::feeds::stats::StatCollector>> =
        vec![process_info, token_usage];
    #[cfg(debug_assertions)]
    collectors.push(build_status);
    #[allow(unused_mut)]
    let mut stats_senders = vec![stats_proc_tx, stats_token_tx];
    #[cfg(debug_assertions)]
    stats_senders.push(stats_build_tx);
    let stats_runner = StatsRunner::new(collectors);
    tokio::spawn(async move {
        stats_runner
            .run(stats_agg_tx, stats_senders, stats_cancel)
            .await;
    });

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

/// Kill any process currently holding the TCP port.
///
/// Uses lsof to find the PID, then sends SIGKILL. Waits briefly for
/// the port to become available.
fn force_kill_port_holder(port: u16) {
    let output = std::process::Command::new("lsof")
        .args(["-ti", &format!("tcp:{}", port)])
        .output();

    let pids = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return, // No process holding the port, or lsof not available.
    };

    for pid_str in pids.lines() {
        if let Ok(pid) = pid_str.trim().parse::<i32>() {
            eprintln!(
                "tugcast: --force: killing PID {} holding port {}",
                pid, port
            );
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
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
