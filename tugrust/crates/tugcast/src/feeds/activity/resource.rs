//! OS subtree resource sampler for the ACTIVITY feed ([P08], [P10], [P20]).
//!
//! This module owns the `(pid, start_time)` reuse-guard and the process-tree
//! reader. Step 11 lands the capture + guard primitives (used by the
//! supervisor to retain each session's `(pid, start_time)`); the sampler task
//! that walks the subtree and publishes CPU/memory/disk gauges builds on them.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tokio_util::sync::CancellationToken;

use crate::feeds::agent_supervisor::AgentSupervisor;
use crate::feeds::session_scoped::SessionScopedFeed;

/// OS sample cadence ([Q02]). 1 Hz is the coarsest rate that still shows a
/// legible CPU hump; the full-process refresh is gated to ticks where at
/// least one session has a live pid, so an idle tugcast does no sysinfo work.
const SAMPLE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

/// One process's contribution to a subtree sum: its own CPU% and resident
/// memory. `cpu_pct` follows sysinfo's convention (100 == one core saturated;
/// a multi-core process may exceed 100).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct SubtreeUsage {
    pub cpu_pct: f32,
    pub rss_bytes: u64,
}

/// One process node in a refresh snapshot — its parent link (for the subtree
/// walk) and its own resource readings.
#[derive(Debug, Clone, Copy)]
pub struct ProcNode {
    pub parent: Option<u32>,
    pub cpu_pct: f32,
    pub rss_bytes: u64,
}

/// pid → node for one refresh. Built from a `System` snapshot; the pure
/// [`subtree_usage`] sums over it so the walk is testable without sysinfo.
pub type ProcMap = HashMap<u32, ProcNode>;

/// Invert a [`ProcMap`] into a parent → children adjacency index, so the
/// subtree walk is O(subtree) rather than O(all-processes) per root.
pub fn children_index(procs: &ProcMap) -> HashMap<u32, Vec<u32>> {
    let mut idx: HashMap<u32, Vec<u32>> = HashMap::new();
    for (&pid, node) in procs {
        if let Some(parent) = node.parent {
            idx.entry(parent).or_default().push(pid);
        }
    }
    idx
}

/// Every pid in the subtree rooted at `root` (inclusive), following child
/// links ([P08]). Returns `None` when `root` is absent — a dead root has no
/// subtree. The `seen` set guards against a cyclic parent map (never expected
/// from the kernel, but cheap insurance).
pub fn subtree_pids(
    procs: &ProcMap,
    children: &HashMap<u32, Vec<u32>>,
    root: u32,
) -> Option<Vec<u32>> {
    procs.get(&root)?;
    let mut seen: HashSet<u32> = HashSet::new();
    let mut out: Vec<u32> = Vec::new();
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        out.push(pid);
        if let Some(kids) = children.get(&pid) {
            stack.extend(kids.iter().copied());
        }
    }
    Some(out)
}

/// macOS per-process disk I/O via `proc_pid_rusage(RUSAGE_INFO_V2)` ([P11]).
/// The counters are cumulative-since-process-start; the sampler differences
/// them across ticks into a bytes/sec gauge. Absent on other platforms — the
/// `disk` channel is simply not produced there ([Q03]).
#[cfg(target_os = "macos")]
pub mod disk {
    /// Cumulative disk bytes for one process (read + written since it started).
    #[derive(Debug, Clone, Copy, Default, PartialEq)]
    pub struct DiskCounters {
        pub read: u64,
        pub write: u64,
    }

    /// Read a process's cumulative disk bytes, or `None` if the pid is gone or
    /// access is denied (a subprocess we don't own — rare for our own subtree).
    pub fn proc_disk_counters(pid: u32) -> Option<DiskCounters> {
        // SAFETY: a zeroed `rusage_info_v2` is a valid all-zero POD. On success
        // `proc_pid_rusage` returns 0 and fills the struct; on failure it
        // returns non-zero and we ignore the (untouched) buffer. The buffer
        // arg is typed `*mut rusage_info_t` (itself `*mut c_void`), so the
        // struct pointer is reinterpreted per the C `proc_pid_rusage` idiom.
        unsafe {
            let mut ri: libc::rusage_info_v2 = std::mem::zeroed();
            let ret = libc::proc_pid_rusage(
                pid as libc::c_int,
                libc::RUSAGE_INFO_V2,
                &mut ri as *mut libc::rusage_info_v2 as *mut libc::rusage_info_t,
            );
            if ret != 0 {
                return None;
            }
            Some(DiskCounters {
                read: ri.ri_diskio_bytesread,
                write: ri.ri_diskio_byteswritten,
            })
        }
    }

    /// Non-negative per-tick delta (bytes/sec at the 1 Hz cadence). The
    /// counters are monotonic per process, but the subtree's process *set*
    /// shifts as bash children come and go, so a raw session-level difference
    /// can go negative when a child exits mid-window; `saturating_sub` clamps
    /// that to zero ([Q03]).
    pub fn non_negative_delta(last: DiskCounters, cur: DiskCounters) -> DiskCounters {
        DiskCounters {
            read: cur.read.saturating_sub(last.read),
            write: cur.write.saturating_sub(last.write),
        }
    }
}

/// Read every live process into a [`ProcMap`] from a refreshed `System`.
fn snapshot_processes(system: &System) -> ProcMap {
    system
        .processes()
        .iter()
        .map(|(pid, proc)| {
            (
                pid.as_u32(),
                ProcNode {
                    parent: proc.parent().map(|p| p.as_u32()),
                    cpu_pct: proc.cpu_usage(),
                    rss_bytes: proc.memory(),
                },
            )
        })
        .collect()
}

/// Per-session OS sampler task ([P10]). On each 1 Hz tick it asks the
/// supervisor for every session with a live tugcode child, and — only if
/// there is at least one — refreshes the full process table once, builds the
/// parent map, and for each session walks its child pid's subtree, summing
/// CPU% + memory. The `(pid, start_time)` reuse-guard ([P20]) rejects a
/// recycled or dead pid, publishing a zero sample so the deck gauge decays
/// rather than misattributing another process's work. Samples ride the
/// ACTIVITY feed as gauge channels ([P09]), session-tagged by the
/// `SessionScopedFeed` splice.
pub async fn run_resource_sampler(
    supervisor: Arc<AgentSupervisor>,
    activity: SessionScopedFeed,
    cancel: CancellationToken,
) {
    let mut system = System::new();
    // macOS per-pid cumulative disk counters, carried across ticks so the
    // sampler can difference them into a bytes/sec gauge ([P11]).
    #[cfg(target_os = "macos")]
    let mut disk_last: HashMap<u32, disk::DiskCounters> = HashMap::new();
    let mut ticker = tokio::time::interval(SAMPLE_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = ticker.tick() => {
                let live = supervisor.live_session_processes().await;
                // Gate the (relatively expensive) full refresh to ticks where
                // at least one session actually has a live pid ([Q02]).
                if live.is_empty() {
                    continue;
                }
                system.refresh_processes_specifics(
                    ProcessesToUpdate::All,
                    true,
                    ProcessRefreshKind::nothing().with_cpu().with_memory(),
                );
                let procs = snapshot_processes(&system);
                let children = children_index(&procs);
                #[cfg(target_os = "macos")]
                let mut disk_seen: HashSet<u32> = HashSet::new();
                for session in &live {
                    let live_start = system
                        .process(Pid::from_u32(session.pid))
                        .map(|p| p.start_time());
                    // Reuse-guard: a recycled/dead pid attributes nothing ([P20]).
                    let pids = if is_same_process(session.start_time, live_start) {
                        subtree_pids(&procs, &children, session.pid).unwrap_or_default()
                    } else {
                        Vec::new()
                    };

                    let mut usage = SubtreeUsage::default();
                    for &pid in &pids {
                        if let Some(node) = procs.get(&pid) {
                            usage.cpu_pct += node.cpu_pct;
                            usage.rss_bytes = usage.rss_bytes.saturating_add(node.rss_bytes);
                        }
                    }

                    let mut channels = serde_json::Map::new();
                    channels.insert("cpu_pct".into(), serde_json::json!(usage.cpu_pct));
                    channels.insert("rss_bytes".into(), serde_json::json!(usage.rss_bytes));

                    // Disk I/O (macOS only, [P11]/[Q03]): sum each subtree pid's
                    // per-tick counter delta. A pid's first observation seeds a
                    // baseline and contributes zero (its cumulative counter is
                    // since process start, not since this window).
                    #[cfg(target_os = "macos")]
                    {
                        let mut read_bps = 0u64;
                        let mut write_bps = 0u64;
                        for &pid in &pids {
                            let Some(cur) = disk::proc_disk_counters(pid) else { continue };
                            disk_seen.insert(pid);
                            if let Some(prev) = disk_last.get(&pid).copied() {
                                let d = disk::non_negative_delta(prev, cur);
                                read_bps = read_bps.saturating_add(d.read);
                                write_bps = write_bps.saturating_add(d.write);
                            }
                            disk_last.insert(pid, cur);
                        }
                        channels.insert("disk_read_bps".into(), serde_json::json!(read_bps));
                        channels.insert("disk_write_bps".into(), serde_json::json!(write_bps));
                    }

                    let payload = serde_json::json!({ "channels": channels });
                    if let Ok(bytes) = serde_json::to_vec(&payload) {
                        activity.publish(session.tug_session_id.as_str(), &bytes);
                    }
                }
                // Drop disk counters for pids no longer in any live subtree so
                // the map can't grow without bound over a long-lived tugcast.
                #[cfg(target_os = "macos")]
                disk_last.retain(|pid, _| disk_seen.contains(pid));
            }
        }
    }
}

/// Read a live process's start time (seconds since the Unix epoch), or `None`
/// if `pid` is not currently a live process. Captured at spawn as the
/// reuse-guard baseline ([P20]): a pid that is later recycled for a different
/// process will report a different start time.
pub fn process_start_time(pid: u32) -> Option<u64> {
    let pid = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing(),
    );
    system.process(pid).map(|p| p.start_time())
}

/// The PID-reuse guard ([P20]): a session's captured `(pid, start_time)` still
/// names the same process iff the pid is currently live **and** its start time
/// equals the captured baseline. A recycled pid has a different start time; a
/// dead pid has no start time at all. In either case the subtree must not be
/// attributed to the session, so this returns `false` and the sampler emits a
/// zero sample.
pub fn is_same_process(captured_start_time: u64, live_start_time: Option<u64>) -> bool {
    live_start_time == Some(captured_start_time)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reused_pid_with_a_different_start_time_is_rejected() {
        // The session captured its child at start time T. The pid is later
        // recycled for an unrelated process that started at T+5 — the guard
        // must reject it so the new process's work is never attributed.
        assert!(is_same_process(1000, Some(1000)));
        assert!(!is_same_process(1000, Some(1005)));
    }

    #[test]
    fn a_dead_pid_is_not_attributed() {
        // The process exited: no live start time to match, so not attributable.
        assert!(!is_same_process(1000, None));
    }

    fn node(parent: Option<u32>, cpu: f32, rss: u64) -> ProcNode {
        ProcNode { parent, cpu_pct: cpu, rss_bytes: rss }
    }

    /// Sum CPU% + rss over a subtree the way the sampler does inline.
    fn sum_subtree(
        procs: &ProcMap,
        children: &HashMap<u32, Vec<u32>>,
        root: u32,
    ) -> Option<SubtreeUsage> {
        let pids = subtree_pids(procs, children, root)?;
        let mut usage = SubtreeUsage::default();
        for pid in pids {
            if let Some(n) = procs.get(&pid) {
                usage.cpu_pct += n.cpu_pct;
                usage.rss_bytes = usage.rss_bytes.saturating_add(n.rss_bytes);
            }
        }
        Some(usage)
    }

    #[test]
    fn subtree_sum_covers_descendants_and_excludes_outsiders() {
        // root(10) → claude(20) → bash(30); plus an unrelated process(99).
        let mut procs: ProcMap = HashMap::new();
        procs.insert(10, node(None, 5.0, 100));
        procs.insert(20, node(Some(10), 10.0, 200));
        procs.insert(30, node(Some(20), 20.0, 400));
        procs.insert(99, node(None, 77.0, 9_000)); // a second session — excluded
        let children = children_index(&procs);
        let usage = sum_subtree(&procs, &children, 10).expect("root is live");
        // 5+10+20 CPU, 100+200+400 rss — the unrelated 99 is not in the subtree.
        assert_eq!(usage.cpu_pct, 35.0);
        assert_eq!(usage.rss_bytes, 700);
    }

    #[test]
    fn subtree_of_a_dead_root_is_none() {
        let procs: ProcMap = HashMap::new();
        let children = children_index(&procs);
        assert!(subtree_pids(&procs, &children, 10).is_none());
    }

    #[test]
    fn two_same_directory_sessions_are_distinct_subtrees() {
        // Two independent trees under the same conceptual cwd. Each session's
        // subtree sums only its own processes — parentage, not directory,
        // separates them ([P08]).
        let mut procs: ProcMap = HashMap::new();
        procs.insert(10, node(None, 1.0, 10)); // session A root
        procs.insert(11, node(Some(10), 2.0, 20));
        procs.insert(50, node(None, 40.0, 500)); // session B root — busy build
        procs.insert(51, node(Some(50), 60.0, 800));
        let children = children_index(&procs);
        let a = sum_subtree(&procs, &children, 10).unwrap();
        let b = sum_subtree(&procs, &children, 50).unwrap();
        assert_eq!(a.cpu_pct, 3.0);
        assert_eq!(b.cpu_pct, 100.0);
        assert_ne!(a.rss_bytes, b.rss_bytes);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn disk_differencing_is_monotonic_and_non_negative() {
        use super::disk::{non_negative_delta, DiskCounters};
        let last = DiskCounters { read: 1_000, write: 500 };
        // Monotonic growth → the delta is the growth.
        let cur = DiskCounters { read: 1_600, write: 900 };
        let d = non_negative_delta(last, cur);
        assert_eq!(d.read, 600);
        assert_eq!(d.write, 400);
        // A counter that appears to go backward (a child exited, its bytes
        // left the session sum) clamps to zero rather than underflowing.
        let shrunk = DiskCounters { read: 400, write: 100 };
        let d2 = non_negative_delta(last, shrunk);
        assert_eq!(d2.read, 0);
        assert_eq!(d2.write, 0);
    }

    #[test]
    fn reads_a_live_process_start_time() {
        // The test process itself is live, so its own pid yields a start time;
        // a pid that cannot exist (0 is the kernel scheduler, never a sysinfo
        // user process) yields none — and re-reading the same live pid is
        // stable, which is exactly what the guard relies on.
        let me = std::process::id();
        let start = process_start_time(me);
        assert!(start.is_some(), "the running test process must have a start time");
        assert_eq!(start, process_start_time(me), "start time must be stable");
    }
}
