//! Single-writer routing for the machine-global changes ledger.
//!
//! Exactly one process on the machine writes `changes.db`. Ownership is a
//! first-come `flock` claim on `changes.db.writer-lock`
//! ([`tugcore::ledger_db::claim_writer`]), held for the owner's lifetime
//! and released by the kernel when it dies — there is no handoff protocol
//! and no stale-lock scanning to get wrong.
//!
//! An instance that loses the claim attaches the shared database
//! **read-only** and routes every would-be mutation through this module
//! to the owner's `POST /api/changes-write`. The wire body is one
//! [`crate::changes_journal::Record`] — the same enum the durable journal
//! serializes and the same enum the replay applier consumes, so the wire
//! format, the durable format, and the recovery format cannot drift apart.
//!
//! Failover is the same path as crash recovery: a forward that fails
//! (owner exited, port gone) triggers a re-claim; whoever wins reopens the
//! attach read-write and drains the pending queue. Records that arrive
//! while nobody can be reached are held in a small bounded queue — past
//! its bound the oldest are dropped, loudly, and the ledger is marked
//! degraded. The JSONL side of attribution capture is unaffected either
//! way.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tugcore::ledger_db::{WriterLock, WriterOwner};

use crate::changes_journal::Record;

/// How many forwarded records are held while no owner is reachable.
/// Attribution rows are small; this is minutes of heavy editing.
const PENDING_CAP: usize = 256;

/// Floor between takeover attempts, so a dead owner does not turn every
/// attribution write into a claim storm. Jittered per process.
const RETRY_FLOOR: Duration = Duration::from_millis(500);

/// Loopback request budget for one forwarded record.
const FORWARD_TIMEOUT: Duration = Duration::from_secs(2);

/// How this instance writes the shared changes ledger.
pub enum ChangesAccess {
    /// This process holds the claim: mutations execute locally against a
    /// read-write attach, and it alone journals and checkpoints. The
    /// claim is held by existing — dropping this variant releases it,
    /// which is how ownership passes on exit — and its lockfile identity
    /// is re-published on the maintenance tick.
    Owner(WriterLock),
    /// Another process holds the claim: mutations are forwarded to it.
    Forward(ChangesForwarder),
    /// No claim was attempted — an in-memory or per-test changes database
    /// with no other process to contend with. Writes execute locally.
    Unclaimed,
}

impl ChangesAccess {
    /// Whether mutations must be forwarded rather than executed locally.
    pub fn is_forwarding(&self) -> bool {
        matches!(self, ChangesAccess::Forward(_))
    }
}

/// Why a forwarded write did not land.
#[derive(Debug)]
pub enum ForwardError {
    /// No reachable owner: no published claim, or its process is gone.
    NoOwner,
    /// The owner was reached but refused or failed the write.
    Rejected(String),
    /// Transport failure talking to the owner.
    Transport(String),
}

impl std::fmt::Display for ForwardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ForwardError::NoOwner => write!(f, "no reachable changes-ledger owner"),
            ForwardError::Rejected(m) => write!(f, "owner rejected the write: {m}"),
            ForwardError::Transport(m) => write!(f, "cannot reach the owner: {m}"),
        }
    }
}

/// Client half of the single-writer contract: sends one record at a time
/// to the owning instance and holds what it cannot yet deliver.
pub struct ChangesForwarder {
    changes_db: PathBuf,
    agent: ureq::Agent,
    pending: VecDeque<Record>,
    /// Count of records dropped past [`PENDING_CAP`], for the log line.
    dropped: u64,
    last_attempt: Option<Instant>,
}

impl ChangesForwarder {
    pub fn new(changes_db: PathBuf) -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(FORWARD_TIMEOUT))
            .build();
        Self {
            changes_db,
            agent: config.into(),
            pending: VecDeque::new(),
            dropped: 0,
            last_attempt: None,
        }
    }

    /// Send one record to the owner and return how many rows it touched.
    pub fn send(&self, record: &Record) -> Result<usize, ForwardError> {
        let owner = resolve_owner(&self.changes_db).ok_or(ForwardError::NoOwner)?;
        if owner.port == 0 {
            return Err(ForwardError::NoOwner);
        }
        let url = format!("http://127.0.0.1:{}/api/changes-write", owner.port);
        let response = self
            .agent
            .post(&url)
            .send_json(record)
            .map_err(|e| ForwardError::Transport(e.to_string()))?;
        let value: serde_json::Value = response
            .into_body()
            .read_json()
            .map_err(|e| ForwardError::Transport(e.to_string()))?;
        if value.get("status").and_then(|s| s.as_str()) != Some("ok") {
            return Err(ForwardError::Rejected(
                value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown error")
                    .to_string(),
            ));
        }
        Ok(value.get("applied").and_then(|a| a.as_u64()).unwrap_or(0) as usize)
    }

    /// Hold a record that could not be delivered. Past the bound the
    /// oldest is dropped — recent attribution is the more useful half.
    pub fn queue(&mut self, record: Record) {
        if self.pending.len() >= PENDING_CAP {
            self.pending.pop_front();
            self.dropped += 1;
            tracing::error!(
                dropped = self.dropped,
                cap = PENDING_CAP,
                "changes-ledger forward queue overflowed; oldest pending attribution dropped"
            );
            // Dropped attribution is data loss ([LR8]): the deck must
            // report it, not present a quietly thinner changeset.
            crate::ledger_integrity::health::note_degraded("changes-forward-overflow");
        }
        self.pending.push_back(record);
    }

    /// Take everything held, oldest first — the takeover drain.
    pub fn take_pending(&mut self) -> Vec<Record> {
        self.pending.drain(..).collect()
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    /// Whether enough time has passed to spend another claim attempt.
    /// Jittered by PID so co-launched instances do not retry in lockstep.
    pub fn retry_due(&self) -> bool {
        match self.last_attempt {
            None => true,
            Some(at) => {
                let jitter = Duration::from_millis(u64::from(std::process::id() % 250));
                at.elapsed() >= RETRY_FLOOR + jitter
            }
        }
    }

    pub fn note_attempt(&mut self) {
        self.last_attempt = Some(Instant::now());
    }
}

/// The identity this process publishes when it claims the writer role.
pub fn local_identity(http_port: u16) -> WriterOwner {
    WriterOwner {
        instance_id: tugcore::instance::instance_id().unwrap_or_else(|| "standalone".to_string()),
        pid: std::process::id() as i32,
        port: http_port,
    }
}

/// Resolve the currently reachable owner of `changes_db`: the published
/// claim identity, cross-checked against the instance registry (which
/// knows the port a live instance actually bound). A claim whose process
/// is gone resolves to `None` — the caller's cue to attempt takeover.
fn resolve_owner(changes_db: &Path) -> Option<WriterOwner> {
    let mut owner = tugcore::ledger_db::read_writer_owner(changes_db)?;
    if !pid_is_live(owner.pid) {
        return None;
    }
    // The registry is the authority on ports; a claim written before a
    // rebind would otherwise send us to a stale one.
    if let Ok(Some(entry)) = tugcore::registry::find_by_id(&owner.instance_id)
        && entry.pid == owner.pid
        && entry.tugcast_port != 0
    {
        owner.port = entry.tugcast_port;
    }
    Some(owner)
}

fn pid_is_live(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // `kill(pid, 0)` sends no signal and returns ESRCH iff the PID is
    // gone; EPERM still means the process exists.
    let ret = unsafe { libc::kill(pid as libc::pid_t, 0) };
    ret == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_ledger::FileEventRow;

    fn row(id: &str) -> Record {
        Record::FileEvent {
            row: FileEventRow {
                tug_session_id: id.into(),
                tool_use_id: "t1".into(),
                file_path: "src/a.rs".into(),
                tool_name: "Write".into(),
                op: "modified".into(),
                origin: "exact".into(),
                ambiguous: false,
                parent_tool_use_id: None,
                project_dir: "/proj".into(),
                at: 1,
            },
        }
    }

    #[test]
    fn queue_is_bounded_and_drops_the_oldest() {
        let mut fwd = ChangesForwarder::new(PathBuf::from("/nonexistent/changes.db"));
        for i in 0..(PENDING_CAP + 3) {
            fwd.queue(row(&format!("s{i}")));
        }
        assert_eq!(fwd.pending_len(), PENDING_CAP);
        let drained = fwd.take_pending();
        assert!(
            matches!(&drained[0], Record::FileEvent { row } if row.tug_session_id == "s3"),
            "the three oldest records are the ones dropped"
        );
        assert_eq!(fwd.pending_len(), 0);
    }

    #[test]
    fn send_without_a_claim_reports_no_owner() {
        let dir = tempfile::tempdir().unwrap();
        let fwd = ChangesForwarder::new(dir.path().join("changes.db"));
        assert!(matches!(fwd.send(&row("s1")), Err(ForwardError::NoOwner)));
    }

    #[test]
    fn a_claim_from_a_dead_process_is_not_an_owner() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("changes.db");
        // A PID that cannot be live: `kill(0, …)` addresses the process
        // group, so the claim writer uses positive PIDs only.
        let dead = WriterOwner {
            instance_id: "gone".into(),
            pid: i32::MAX,
            port: 1,
        };
        std::fs::write(
            tugcore::ledger_db::writer_lock_path(&db),
            serde_json::to_vec(&dead).unwrap(),
        )
        .unwrap();
        assert!(resolve_owner(&db).is_none());
    }
}
