//! SharedAgent — an app-scoped pool of persistent, job-constrained `claude`
//! workers ([P01], [P02]).
//!
//! A `SharedAgent` is a model operated against a **fixed table of named jobs**,
//! not a general-purpose model handle: callers ask for a job by name and hand
//! it an input, and there is no API that accepts an arbitrary prompt ([P01]).
//! Adding a capability means adding a [`JobSpec`], which is reviewed like any
//! other contract change; standing up a second agent on a different model means
//! constructing a second [`AgentSpec`], not writing new machinery.
//!
//! Workers are **persistent** because a cold `claude` spawn costs more than the
//! whole latency budget of the job that would be waiting on it — measured at
//! 2327 ms for the first turn against 867–989 ms for every turn after it (CLI
//! 2.1.222, `claude-haiku-4-5`). One warm process therefore serves many turns,
//! recycled by turn count and reaped when idle ([P04]).
//!
//! Every turn is self-contained ([P05]): the job's full instructions ride each
//! message and the model is told to answer only from it, so any turn can be a
//! worker's first and a recycle costs nothing but a spawn.
//!
//! The test seam is [`AgentWorkerSpawner`] (the `ScribeSpawner` / `ChildSpawner`
//! pattern): production spawns the persistent child, tests script turn outcomes
//! and never assert model prose.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::time::{Duration, Instant};
use tracing::{info, warn};
use tugcast_core::{FeedId, Frame};

// MARK: - Recycle and growth policy ([P04])

/// Turns one worker answers before it is retired and replaced.
///
/// Bounds both conversation growth (cost, and the cross-turn bleed of [R01])
/// and the blast radius of a worker that has drifted. Self-contained turns
/// ([P05]) are what make this free: the replacement's first turn is no
/// different from the turn it replaced.
const MAX_TURNS_PER_WORKER: u64 = 40;

/// Idle time after which a worker is reaped, mirroring the idle unload the
/// on-device backend used. A machine nobody is typing shell candidates into
/// carries no classify worker.
const IDLE_REAP: Duration = Duration::from_secs(300);

/// How long a class waits before replacing a worker that **died**, mirroring
/// the daemon respawn debounce in `feeds::pulse`. This gates replacement after
/// a failure, never healthy growth — a first spawn and a growth spawn are both
/// immediate, so nothing pays this cost except a crash loop.
const RESPAWN_MIN_INTERVAL: Duration = Duration::from_secs(5);

// Reaping and recycling are decided when a job arrives rather than on a timer:
// a pool with no traffic has nothing to reap, and a background ticker would be
// a task to leak. The constants above are provisional and meant to be set from
// the `shared agent call` telemetry ([P04]).

// MARK: - Job and agent specification ([P01])

/// One named job: what the model is told, and what the caller's wait is bounded
/// by. Instructions are fixed per job so behavior stays auditable, scorable
/// against a corpus, and stable enough to cache against later ([Q02]).
pub struct JobSpec {
    pub name: &'static str,
    pub instructions: &'static str,
    /// Ceiling on the caller's wait. Past this the job is an error and the
    /// caller degrades ([P06]).
    pub timeout: Duration,
    /// Turnaround past which a call is marked `slow=true`. Nothing is
    /// cancelled — this only makes drift readable in accumulated logs.
    pub slow: Option<Duration>,
}

/// A model plus the table of jobs it is operated against.
///
/// `model` is a closure rather than a value so a settings change applies on the
/// next worker spawn without a restart, matching the scribe-model pattern in
/// `main.rs` ([P03]).
pub struct AgentSpec {
    pub name: &'static str,
    pub model: Arc<dyn Fn() -> String + Send + Sync>,
    pub jobs: &'static [JobSpec],
    /// Total workers across all job classes ([P12]).
    pub max_workers: usize,
}

impl AgentSpec {
    fn job(&self, name: &str) -> Option<&'static JobSpec> {
        self.jobs.iter().find(|j| j.name == name)
    }
}

/// The latency lane a job runs in ([P12]).
///
/// A worker is assigned the class of the job that spawned it and only ever
/// answers jobs of that class. The two lanes have incompatible latency
/// contracts — 2 s against 6 s — and reactive growth cannot rescue a classify
/// that arrives while the only worker is mid-summarize: the rescue spawn alone
/// costs more than classify's entire budget. Since summarize occupancy is
/// routine rather than rare, without affinity shell routing would simply "not
/// work sometimes".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobClass {
    Classify,
    Summarize,
}

impl JobClass {
    /// Both classify wordings share the lane: they are the same question asked
    /// with and without the program's documentation, and they answer the same
    /// 2 s submit. Splitting them would put the `maybe` band on a worker that
    /// has to be spawned while somebody waits.
    fn of(job: &str) -> Self {
        match job {
            "classify" | "classify_with_grammar" => Self::Classify,
            _ => Self::Summarize,
        }
    }
}

// MARK: - Worker spawner seam

/// One job turn: the composed message, and where its answer goes.
pub struct TurnRequest {
    pub text: String,
    pub reply: oneshot::Sender<Result<String, String>>,
}

/// Spawns persistent workers. The pool holds one of these and never knows
/// whether the thing on the other end is a `claude` process or a script.
///
/// A worker is represented by the channel its turns are written to: the worker
/// answers them one at a time, in order, and dropping the sender reaps it.
pub trait AgentWorkerSpawner: Send + Sync + 'static {
    fn spawn(&self, model: String) -> Result<mpsc::Sender<TurnRequest>, String>;
}

/// One spawned worker and the bookkeeping the pool recycles it by.
struct Worker {
    id: u64,
    class: JobClass,
    tx: mpsc::Sender<TurnRequest>,
    /// Turns started, which is what the recycle cap counts — a turn that timed
    /// out still spent context.
    turns: AtomicU64,
    in_flight: AtomicUsize,
    last_used: Mutex<Instant>,
    /// Set when the worker has been recycled, timed out, or died. A retired
    /// worker answers nothing further and is dropped on the next sweep.
    retired: AtomicBool,
}

impl Worker {
    fn idle(&self) -> bool {
        self.in_flight.load(Ordering::Relaxed) == 0
    }
}

// MARK: - The pool ([P02])

/// One pool per [`AgentSpec`], app-scoped, lazily spawning workers up to
/// `max_workers` and reaping them on idle. Callers hold this and never see a
/// worker.
pub struct SharedAgentPool {
    spec: AgentSpec,
    spawner: Arc<dyn AgentWorkerSpawner>,
    workers: Mutex<Vec<Arc<Worker>>>,
    /// When a worker of each class last died, for the respawn debounce.
    last_death: Mutex<Vec<(JobClass, Instant)>>,
    next_worker_id: AtomicU64,
}

impl SharedAgentPool {
    pub fn new(spec: AgentSpec, spawner: Arc<dyn AgentWorkerSpawner>) -> Arc<Self> {
        Arc::new(Self {
            spec,
            spawner,
            workers: Mutex::new(Vec::new()),
            last_death: Mutex::new(Vec::new()),
            next_worker_id: AtomicU64::new(1),
        })
    }

    /// Run one named job, bounded by that job's timeout.
    ///
    /// Every failure shape — the app-test gate, an unknown job, a spawn
    /// failure, a dead worker, a timeout — comes back as `Err`, because every
    /// caller degrades identically on one ([P06]). An unknown job name is a
    /// programming error, so it panics where a test would catch it and errors
    /// where a user would rather have a missing headline than a dead process.
    pub async fn run(&self, job: &str, input: String) -> Result<String, String> {
        let Some(spec) = self.spec.job(job) else {
            debug_assert!(false, "unknown shared-agent job {job:?}");
            return Err(format!("unknown job {job}"));
        };
        self.run_spec(spec, compose_turn(spec.instructions, &input))
            .await
    }

    /// Ask whether one line means the shell or means Claude.
    ///
    /// `grammar` is the program's own condensed documentation, attached by the
    /// command-grammar grader exactly when it could not account for the line
    /// against the grammar it knows; its presence picks the documentation-
    /// bearing wording, as it did on the device.
    ///
    /// The label parse happens here so no caller ever sees raw model text: an
    /// answer naming no label, or naming both, is a refusal rather than a coin
    /// flip.
    pub async fn run_classify(
        &self,
        text: String,
        grammar: Option<String>,
    ) -> Result<String, String> {
        let job = match &grammar {
            Some(_) => "classify_with_grammar",
            None => "classify",
        };
        let Some(spec) = self.spec.job(job) else {
            debug_assert!(false, "unknown shared-agent job {job:?}");
            return Err(format!("unknown job {job}"));
        };
        let instructions = match &grammar {
            Some(g) => spec.instructions.replace(GRAMMAR_PLACEHOLDER, g),
            None => spec.instructions.to_string(),
        };
        let raw = self
            .run_spec(spec, compose_turn(&instructions, &text))
            .await?;
        // The call itself succeeded, so `record` has already timed it; a refusal
        // is a fact about the answer, and logging it as a second `shared agent
        // call` line would double-count one call.
        verdict(&raw).ok_or_else(|| {
            warn!(task = spec.name, %raw, "shared agent classify named no label");
            "classification did not name a label".to_string()
        })
    }

    async fn run_spec(&self, spec: &'static JobSpec, turn: String) -> Result<String, String> {
        if app_test_gated() {
            record(spec.name, "unavailable", None);
            return Err(UNAVAILABLE.to_string());
        }
        let started = Instant::now();
        let class = JobClass::of(spec.name);
        let worker = match self.acquire(class) {
            Ok(worker) => worker,
            Err(error) => {
                record(spec.name, "unavailable", Some((started, spec)));
                return Err(error);
            }
        };

        worker.turns.fetch_add(1, Ordering::Relaxed);
        worker.in_flight.fetch_add(1, Ordering::Relaxed);
        let outcome = self.turn(&worker, spec, turn).await;
        worker.in_flight.fetch_sub(1, Ordering::Relaxed);
        *worker.last_used.lock().unwrap() = Instant::now();

        // A worker that reached the turn cap is replaced on the next job, not
        // this one — the caller already has its answer and should not pay for
        // hygiene.
        if worker.turns.load(Ordering::Relaxed) >= MAX_TURNS_PER_WORKER {
            self.retire(&worker, "recycled");
        }

        match &outcome {
            Ok(_) => record(spec.name, "ok", Some((started, spec))),
            Err(_) => record(spec.name, "failed", Some((started, spec))),
        }
        outcome
    }

    /// One turn against one worker, under the job's ceiling.
    ///
    /// A timeout retires the worker rather than leaving it in the rotation: it
    /// is still working on an answer nobody is waiting for, so the next job
    /// handed to it would queue behind that and time out too.
    async fn turn(
        &self,
        worker: &Arc<Worker>,
        spec: &'static JobSpec,
        turn: String,
    ) -> Result<String, String> {
        let (reply, answer) = oneshot::channel();
        // The ceiling covers the whole wait: the channel send (which blocks
        // when the worker's queue is full) and the answer both count against
        // the job's timeout, so the caller's wait is bounded no matter where
        // the turn stalls.
        let attempt = async {
            if worker
                .tx
                .send(TurnRequest { text: turn, reply })
                .await
                .is_err()
            {
                return Err("shared agent worker died".to_string());
            }
            match answer.await {
                Ok(outcome) => outcome,
                Err(_) => Err("shared agent worker dropped the turn".to_string()),
            }
        };
        match tokio::time::timeout(spec.timeout, attempt).await {
            Ok(Ok(text)) => Ok(text),
            Ok(Err(error)) => {
                self.mark_dead(worker);
                Err(error)
            }
            Err(_) => {
                // A hung worker counts as a failure for the respawn debounce:
                // without it a systematically stalled backend would spawn one
                // fresh child per call.
                self.retire(worker, "timed out");
                self.note_death(worker.class);
                Err(format!("{} timed out", spec.name))
            }
        }
    }

    /// Pick a worker of `class`, growing the pool when that is what the latency
    /// contract needs ([P12]).
    ///
    /// An idle worker of the class is always preferred. Failing that the pool
    /// grows, because queueing a classify behind a busy classify is harmless
    /// (typing serializes them) while queueing it behind a summarize is not.
    /// Only when the pool cannot grow does a job queue, and only ever behind
    /// its own class.
    fn acquire(&self, class: JobClass) -> Result<Arc<Worker>, String> {
        let mut workers = self.workers.lock().unwrap();
        self.sweep(&mut workers);

        if let Some(idle) = workers
            .iter()
            .find(|w| w.class == class && w.idle())
            .cloned()
        {
            return Ok(idle);
        }

        if workers.len() < self.spec.max_workers && self.respawn_allowed(class) {
            match self.spawn(class) {
                Ok(worker) => {
                    workers.push(Arc::clone(&worker));
                    return Ok(worker);
                }
                Err(error) => {
                    self.note_death(class);
                    // A same-class worker that is merely busy still beats no
                    // answer at all, so a failed growth spawn falls through to
                    // the queue rather than failing the job outright.
                    warn!(agent = self.spec.name, %error, "shared agent spawn failed");
                }
            }
        }

        // Never queue behind a retired worker: it is stuck on or has abandoned
        // a turn nobody is waiting for, so honest unavailability beats a wait
        // that can only time out.
        workers
            .iter()
            .find(|w| w.class == class && !w.retired.load(Ordering::Relaxed))
            .cloned()
            .ok_or_else(|| UNAVAILABLE.to_string())
    }

    /// Drop workers that are retired, or that have been idle past the reap
    /// window. Dropping the last sender closes the worker's channel, which ends
    /// its driver task and reaps the child.
    fn sweep(&self, workers: &mut Vec<Arc<Worker>>) {
        let now = Instant::now();
        workers.retain(|w| {
            if w.retired.load(Ordering::Relaxed) && w.idle() {
                return false;
            }
            if w.idle() && now.duration_since(*w.last_used.lock().unwrap()) >= IDLE_REAP {
                info!(agent = self.spec.name, worker = w.id, "shared agent worker reaped");
                return false;
            }
            true
        });
    }

    fn spawn(&self, class: JobClass) -> Result<Arc<Worker>, String> {
        let model = (self.spec.model)();
        let tx = self.spawner.spawn(model.clone())?;
        let id = self.next_worker_id.fetch_add(1, Ordering::Relaxed);
        info!(
            agent = self.spec.name,
            worker = id,
            class = ?class,
            %model,
            "shared agent worker spawned",
        );
        Ok(Arc::new(Worker {
            id,
            class,
            tx,
            turns: AtomicU64::new(0),
            in_flight: AtomicUsize::new(0),
            last_used: Mutex::new(Instant::now()),
            retired: AtomicBool::new(false),
        }))
    }

    fn retire(&self, worker: &Arc<Worker>, why: &str) {
        if !worker.retired.swap(true, Ordering::Relaxed) {
            info!(
                agent = self.spec.name,
                worker = worker.id,
                why,
                "shared agent worker retired",
            );
        }
    }

    /// A worker that failed is retired *and* starts its class's respawn
    /// debounce, so a `claude` that dies on every spawn cannot be respawned in
    /// a hot loop.
    fn mark_dead(&self, worker: &Arc<Worker>) {
        self.retire(worker, "died");
        self.note_death(worker.class);
    }

    fn note_death(&self, class: JobClass) {
        let mut deaths = self.last_death.lock().unwrap();
        let now = Instant::now();
        match deaths.iter_mut().find(|(c, _)| *c == class) {
            Some(entry) => entry.1 = now,
            None => deaths.push((class, now)),
        }
    }

    fn respawn_allowed(&self, class: JobClass) -> bool {
        let deaths = self.last_death.lock().unwrap();
        match deaths.iter().find(|(c, _)| *c == class) {
            Some((_, at)) => Instant::now().duration_since(*at) >= RESPAWN_MIN_INTERVAL,
            None => true,
        }
    }

    /// Live worker count after a sweep — how the pool-policy tests read growth
    /// and reaping without reaching inside the lock.
    #[cfg(test)]
    pub fn worker_count(&self) -> usize {
        let mut workers = self.workers.lock().unwrap();
        self.sweep(&mut workers);
        workers.len()
    }
}

/// What every unavailable path answers with. One string because callers do not
/// branch on the reason — they degrade ([P06]).
const UNAVAILABLE: &str = "shared agent unavailable";

/// The slot [`JobSpec::instructions`] substitutes a command's own documentation
/// into, carried over from the on-device wording.
pub const GRAMMAR_PLACEHOLDER: &str = "{{GRAMMAR}}";

/// Instructions and input in one self-contained message ([P05]).
///
/// The input rides verbatim: a caller that composed a digest to an exact shape
/// gets that shape in front of the model, and what the caller logged is what
/// was asked.
fn compose_turn(instructions: &str, input: &str) -> String {
    format!("{}\n\n{}", instructions.trim_end(), input)
}

/// Whether this process is one of the app-test harness's launches ([P08]).
///
/// App-tests must be free, fast, and deterministic, so no worker is ever
/// spawned under one and every job answers with the designed degraded posture.
/// The variable reaches tugcast because `ProcessManager.swift` seeds the
/// tugcast child's environment from the app's own, and the app is what the
/// harness launches with `TUGAPP_APP_TEST=1`.
fn app_test_gated() -> bool {
    std::env::var("TUGAPP_APP_TEST").as_deref() == Ok("1")
}

/// Match a classify answer to one of the two labels.
///
/// The contract is prompt-and-parse, not constrained decoding, so an answer
/// naming no label is a refusal rather than a guess, and one naming both is a
/// refusal too, because nothing in the answer prefers either. Labels match only
/// as whole tokens, so prose that merely contains the word "shell" inside
/// another word cannot route a command.
fn verdict(raw: &str) -> Option<String> {
    let mut found: Option<&str> = None;
    for piece in raw.split(|c: char| !c.is_alphanumeric()) {
        let label = match piece.to_ascii_lowercase().as_str() {
            "shell" => "shell",
            "prompt" => "prompt",
            _ => continue,
        };
        match found {
            Some(seen) if seen != label => return None,
            _ => found = Some(label),
        }
    }
    found.map(str::to_string)
}

/// The caller's side of one job.
///
/// Says what the caller waited for and whether it gave up — a fact the worker
/// itself cannot see, since a timed-out turn finishes eventually and never
/// learns nobody was listening.
fn record(task: &str, outcome: &str, timing: Option<(Instant, &JobSpec)>) {
    let Some((started, spec)) = timing else {
        info!(task = %task, outcome = %outcome, "shared agent call");
        return;
    };
    let elapsed = started.elapsed();
    let slow = spec.slow.is_some_and(|threshold| elapsed > threshold);
    let elapsed_ms = elapsed.as_millis() as u64;
    if slow {
        info!(task = %task, outcome = %outcome, elapsed_ms, slow = true, "shared agent call");
    } else {
        info!(task = %task, outcome = %outcome, elapsed_ms, "shared agent call");
    }
}

// MARK: - Production spawner (#worker-protocol, [P13])

/// The directory workers run in ([P13]).
///
/// Tug-owned and free of any `CLAUDE.md`, for two reasons the spike confirmed
/// against CLI 2.1.222. A worker rooted in a user repo inherits that repo's
/// instructions — a decoy `CLAUDE.md` demanding a token got it appended to the
/// answer, while the same turn from here came back bare. And the CLI writes
/// each worker's transcript to `~/.claude/projects/<encoded cwd>/<session>.jsonl`,
/// so a project cwd would file 40-turn worker conversations where the session
/// picker's on-disk scan reads them as real sessions — its exclusion rules
/// (cwd mismatch, id/filename mismatch) would not catch them.
///
/// Fixed and Tug-owned, so no user-supplied path is resolved and [L29]'s
/// canonicalization gateway is not in play.
fn worker_cwd() -> std::path::PathBuf {
    tugcore::instance::base_data_dir().join("shared-agent")
}

/// Spawns one persistent `claude` in streaming-input mode per worker
/// (#worker-protocol).
pub struct ClaudeAgentWorkerSpawner;

impl AgentWorkerSpawner for ClaudeAgentWorkerSpawner {
    fn spawn(&self, model: String) -> Result<mpsc::Sender<TurnRequest>, String> {
        let cwd = worker_cwd();
        std::fs::create_dir_all(&cwd).map_err(|e| format!("shared agent cwd: {e}"))?;

        // Verified against claude 2.1.222 from an empty neutral cwd:
        //
        // - `--disallowedTools '*'` reports `tools: []` in the init frame and the
        //   answer comes back text-only in one turn. Without it the same
        //   tool-baiting turn ran Bash and took two turns — slow, and a hazard
        //   for a classify that is deciding whether to run a command.
        // - `--strict-mcp-config` with no `--mcp-config` leaves the worker no
        //   MCP servers, so nothing project-scoped is loaded.
        // - No session flag: a streaming-input spawn with none works and the CLI
        //   mints its own id, which is what keeps worker transcripts out of any
        //   directory a session query reads ([P13]).
        //
        // Tugplug's hooks are PreToolUse-only, so with no tools available no
        // Tug hook can fire on a worker turn.
        let mut cmd = crate::feeds::claude_auth::claude_command(&[
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--model",
            &model,
            "--strict-mcp-config",
            "--disallowedTools",
            "*",
        ]);
        cmd.current_dir(&cwd)
            .env("MAX_THINKING_TOKENS", "0")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Claude Code isn't installed".to_string()
            } else {
                e.to_string()
            }
        })?;
        let stdin = child.stdin.take().ok_or("shared agent worker: no stdin")?;
        let stdout = child.stdout.take().ok_or("shared agent worker: no stdout")?;
        let stderr = child.stderr.take();

        let (tx, rx) = mpsc::channel::<TurnRequest>(8);
        tokio::spawn(drive_worker(child, stdin, stdout, stderr, rx));
        Ok(tx)
    }
}

/// One worker's whole life: take turns off the channel, write each as a user
/// message, read stdout to that turn's `result` frame, answer.
///
/// Turns are answered strictly in order because the transport is one stdio
/// pipe — which is also what makes "one job at a time per worker" true by
/// construction rather than by a lock. When the channel closes the child is
/// dropped, and `kill_on_drop` reaps it.
async fn drive_worker(
    mut child: tokio::process::Child,
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    mut stderr: Option<tokio::process::ChildStderr>,
    mut rx: mpsc::Receiver<TurnRequest>,
) {
    let mut lines = BufReader::new(stdout).lines();

    while let Some(TurnRequest { text, reply }) = rx.recv().await {
        let message = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
        });
        let Ok(line) = serde_json::to_string(&message) else {
            let _ = reply.send(Err("shared agent turn could not be encoded".to_string()));
            continue;
        };
        if stdin.write_all(format!("{line}\n").as_bytes()).await.is_err()
            || stdin.flush().await.is_err()
        {
            let _ = child.start_kill();
            let _ = reply.send(Err(worker_failure(stderr.take()).await));
            return;
        }

        // The `result` frame carries the whole answer — the same frame shape
        // `scribe.rs` and tugcode already parse. Streamed deltas are ignored:
        // nothing renders a job turn as it arrives.
        let answer = loop {
            match lines.next_line().await {
                Ok(Some(out)) => {
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&out) else {
                        continue;
                    };
                    if value.get("type").and_then(|t| t.as_str()) != Some("result") {
                        continue;
                    }
                    if value.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
                        break Err(value
                            .get("result")
                            .and_then(|r| r.as_str())
                            .unwrap_or("shared agent turn failed")
                            .to_string());
                    }
                    break Ok(value
                        .get("result")
                        .and_then(|r| r.as_str())
                        .unwrap_or_default()
                        .to_string());
                }
                // EOF or a read error is the worker dying; the pool replaces it.
                _ => {
                    let _ = child.start_kill();
                    let _ = reply.send(Err(worker_failure(stderr.take()).await));
                    return;
                }
            }
        };
        let _ = reply.send(answer);
    }
}

/// The detail a dead worker gets reported with: its stderr tail when there is
/// one, the way `agent_bridge` surfaces a child's own account of itself. The
/// read is bounded because the caller kills the child rather than waiting on
/// it — a process that holds stderr open must not hold the driver task with
/// it.
async fn worker_failure(stderr: Option<tokio::process::ChildStderr>) -> String {
    let Some(mut stderr) = stderr else {
        return "shared agent worker exited".to_string();
    };
    let mut buf = String::new();
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::io::AsyncReadExt::read_to_string(&mut stderr, &mut buf),
    )
    .await;
    buf.trim()
        .lines()
        .last()
        .filter(|l| !l.is_empty())
        .unwrap_or("shared agent worker exited")
        .to_string()
}

// MARK: - Observability CONTROL verbs ([P07])

/// The pool as the router holds it: absent until `main` builds one, which is
/// also the shape a build with no agent would have.
pub type SharedAgentHandle = Option<Arc<SharedAgentPool>>;

fn send_control(cat: &broadcast::Sender<Frame>, body: serde_json::Value) {
    if let Ok(bytes) = serde_json::to_vec(&body) {
        let _ = cat.send(Frame::new(FeedId::CONTROL, bytes));
    }
}

/// Run one summarize job and broadcast the headline.
///
/// The socket-reachable form of the question the session overview asks on its
/// own cadence, so what the model actually says about a given digest can be
/// read without waiting for a strip to update. The raw answer rides alongside
/// the normalized one: the two differing is the signal that the prompt is
/// drifting and the normalizer is covering for it.
pub fn request_summary(
    agent: SharedAgentHandle,
    cat: Option<broadcast::Sender<Frame>>,
    prompt: String,
    retrospective: bool,
) {
    let task = if retrospective {
        "summarize_done"
    } else {
        "summarize"
    };
    tokio::spawn(async move {
        let result = match agent {
            Some(pool) => pool.run(task, prompt).await,
            None => Err(UNAVAILABLE.to_string()),
        };
        let (ok, text, error) = match result {
            Ok(raw) => {
                let report = crate::feeds::session_overview::headline_register_report(&raw);
                info!(
                    task,
                    %raw,
                    headline = %report.text,
                    normalized = report.normalized,
                    trimmed = report.trimmed,
                    clipped = report.clipped,
                    "shared agent summarize answered",
                );
                (true, Some(report.text), None)
            }
            Err(error) => {
                warn!(task, %error, "shared agent summarize failed");
                (false, None, Some(error))
            }
        };
        let Some(cat) = cat else { return };
        send_control(
            &cat,
            serde_json::json!({
                "action": "shared_agent_summarize_result",
                "task": task,
                "ok": ok,
                "text": text,
                "error": error,
            }),
        );
    });
}

/// Run one classify job and broadcast the verdict.
///
/// The shell-routing tenant asks this on every ambiguous line as part of a
/// submit; this is the same question with nothing waiting on it, so a verdict
/// can be observed without a composer in the loop.
pub fn request_classification(
    agent: SharedAgentHandle,
    cat: Option<broadcast::Sender<Frame>>,
    text: String,
    grammar: Option<String>,
) {
    let has_grammar = grammar.is_some();
    tokio::spawn(async move {
        let result = match agent {
            Some(pool) => pool.run_classify(text.clone(), grammar).await,
            None => Err(UNAVAILABLE.to_string()),
        };
        // No elapsed here: `shared agent call` already timed this from the
        // caller's side, and two timings of one call invite the reader to
        // wonder which is authoritative.
        let (ok, verdict, error) = match result {
            Ok(verdict) => {
                info!(%text, %verdict, grammar = has_grammar, "shared agent classify answered");
                (true, Some(verdict), None)
            }
            Err(error) => {
                warn!(%text, %error, grammar = has_grammar, "shared agent classify failed");
                (false, None, Some(error))
            }
        };
        let Some(cat) = cat else { return };
        send_control(
            &cat,
            serde_json::json!({
                "action": "shared_agent_classify_result",
                "ok": ok,
                "verdict": verdict,
                "error": error,
            }),
        );
    });
}

// MARK: - Configuration (Spec S04, [P10])

/// Tugbank domain for the shared agents. Mirrored in
/// `tugdeck/src/lib/shared-agent-store.ts`.
pub const SHARED_AGENT_DOMAIN: &str = "dev.tugtool.shared-agent";

/// Per-tenant kill switch for the session-overview intent line.
///
/// The shell-routing switch under the same domain has no Rust consumer — that
/// tenant lives entirely in the deck — so its key is declared only in
/// `shared-agent-store.ts`.
pub const PULSE_OVERVIEW_KEY: &str = "pulse-overview";

/// Full model id override, read per spawn.
pub const MODEL_KEY: &str = "model";

/// Total worker cap across job classes.
pub const MAX_WORKERS_KEY: &str = "max_workers";

/// Room for one worker per job class in steady state ([P12]), which is what the
/// measured traffic asks for: session overview holds one emit in flight
/// process-wide, and classify is serialized by typing.
pub const DEFAULT_MAX_WORKERS: usize = 2;

/// The Haiku agent's pinned model ([P03]). A full id, never a bare alias:
/// aliases drift, and a drifting aux model is a silent behavior change.
pub const HAIKU_MODEL: &str = "claude-haiku-4-5";

/// Read a tenant kill switch. Absent — and any non-bool — reads as enabled, so
/// a tenant is never accidentally dark because a value was never written.
pub fn tenant_enabled(bank: Option<&tugbank_core::TugbankClient>, key: &str) -> bool {
    let Some(bank) = bank else {
        return true;
    };
    match bank.get(SHARED_AGENT_DOMAIN, key) {
        Ok(Some(tugbank_core::Value::Bool(enabled))) => enabled,
        _ => true,
    }
}

// MARK: - The Haiku agent's job table (Spec S01)

/// Ported from the on-device wording, then simplified for a model that does not
/// need propping up.
///
/// What is kept verbatim is everything the Rust gates downstream depend on: the
/// two labels, and the headline register rules that `headline_register_report`
/// and `ground_headline` enforce. What is dropped is scaffolding that existed
/// only because a 4-bit 4B pack over-read whatever came first — long example
/// ladders teaching one distinction at a time.
///
/// The summarize wording is deliberately **extractive**: a fluent model
/// paraphrases where a weak one copies, and `ground_headline` refuses any
/// headline whose words are not in the digest, so the instruction to reuse the
/// digest's own words is what keeps the refusal rate down ([R01]).
pub static HAIKU_AGENT_JOBS: &[JobSpec] = &[
    JobSpec {
        name: "classify",
        timeout: CLASSIFY_TIMEOUT,
        slow: Some(CLASSIFY_SLOW),
        instructions: CLASSIFY_INSTRUCTIONS,
    },
    JobSpec {
        name: "classify_with_grammar",
        timeout: CLASSIFY_TIMEOUT,
        slow: Some(CLASSIFY_SLOW),
        instructions: CLASSIFY_WITH_GRAMMAR_INSTRUCTIONS,
    },
    JobSpec {
        name: "summarize",
        timeout: SUMMARIZE_TIMEOUT,
        slow: Some(SUMMARIZE_SLOW),
        instructions: SUMMARIZE_INSTRUCTIONS,
    },
    JobSpec {
        name: "summarize_done",
        timeout: SUMMARIZE_TIMEOUT,
        slow: Some(SUMMARIZE_SLOW),
        instructions: SUMMARIZE_DONE_INSTRUCTIONS,
    },
];

/// Classify's ceiling is one of **three** constants that must agree:
/// `CLASSIFY_REQUEST_TIMEOUT_MS` in `tugdeck/src/lib/shell-classify-store.ts`
/// and `VERDICT_SUBMIT_WAIT_MS` in
/// `tugdeck/src/components/tugways/tug-prompt-entry.tsx` are the same 2s from
/// the deck's side. Lowering one silently makes it the real deadline and the
/// other two unreachable.
const CLASSIFY_TIMEOUT: Duration = Duration::from_secs(2);

/// Summarize stays under the session-overview emit floor (`EMIT_FLOOR`, 8s), so
/// a headline can never still be in flight when the next one is due.
const SUMMARIZE_TIMEOUT: Duration = Duration::from_secs(6);

/// Set from the Step 1 spike rather than guessed: warm classify turns measured
/// 867–989 ms against CLI 2.1.222, so a 1s mark would fire on roughly half of
/// all calls. A slow-mark that fires constantly is not a signal, and the
/// `slow=true` rate is what the latency risk is meant to be read by — so the
/// threshold sits above the measured warm band and marks the calls that are
/// genuinely drifting toward the 2s ceiling.
const CLASSIFY_SLOW: Duration = Duration::from_millis(1500);

const SUMMARIZE_SLOW: Duration = Duration::from_secs(3);

/// What both classify wordings share: the task, the one fact the caller has
/// already established, and the asymmetry that decides every close call.
///
/// A macro rather than a `const` because the two wordings are assembled with
/// `concat!`, which folds string *literals* at compile time — the instructions
/// have to be `&'static str` to live in a [`JobSpec`]. Shared rather than
/// duplicated because the two variants must ask the same question: a drift
/// between them would surface as a band difference and be misread as a fact
/// about the grader.
macro_rules! classify_core {
    () => {
        "\
You label one line a developer typed into a dev tool. Answer with exactly one word and nothing else: SHELL or PROMPT.

The first word of the line ALWAYS names a real program installed on this machine. The question is never whether the program exists — only whether the person meant to RUN it, or was writing a sentence to an AI assistant that happens to begin with that word.

SHELL — they meant to run the program. Anything after the first word is an argument to it: a file name, a directory, a flag, a path, or a subcommand.

PROMPT — they were writing to the assistant. The line reads as English prose: it contains an article, a pronoun, a preposition, or it asks a question.

The two mistakes are not equal. A wrong SHELL runs a command nobody asked for and cannot be taken back. A wrong PROMPT costs one keystroke to retype. When the line could be read either way, answer PROMPT.

Answer only from this message."
    };
}

const CLASSIFY_INSTRUCTIONS: &str = concat!(
    classify_core!(),
    "

Decide by what follows the first word. A bare word that could name a file or a directory means SHELL. An English phrase means PROMPT.

cd tugrust => SHELL
rg TODO src => SHELL
open index.html => SHELL
make clean => SHELL
head over to the docs => PROMPT
open an issue for this bug => PROMPT
make this function faster => PROMPT
why is the test failing => PROMPT

The line:"
);

/// The same question with the program's own documentation in hand — the
/// `maybe` band, where the grader has confirmed the first word names a real
/// program and has failed to account for what follows.
///
/// The contrast pairs are the load-bearing part: a real command wearing a flag
/// the documentation happens not to list is still a command, while an English
/// sentence the documentation gives no meaning to is not. That difference is
/// the entire population of this band.
const CLASSIFY_WITH_GRAMMAR_INSTRUCTIONS: &str = concat!(
    classify_core!(),
    "

Here is that program's own documentation, from this machine:

{{GRAMMAR}}

Read the rest of the line against this documentation.

If the words after the first read as arguments — a subcommand it lists, a flag, a file, a path, a value — answer SHELL. Documentation is never complete: a flag or subcommand missing from it, or spelled a little wrong, is still someone running the program. Judge the SHAPE of what follows, not whether every token appears above.

If the words after the first read as English about the program — a request, a question, a description of what to do — answer PROMPT. The giveaway is that the documentation gives those words no meaning at all.

curl -sS --compressed https://example.com/api => SHELL
curl the config down from the staging box => PROMPT
docker compose up --detach --wait => SHELL
docker the worker into a smaller image => PROMPT

The line:"
);

/// The headline register, kept verbatim from the on-device wording because
/// `headline_register_report` and `ground_headline` enforce exactly these rules
/// downstream — a headline that breaks them is refused, not repaired.
macro_rules! headline_rules {
    () => {
        "\
NO \"the\", \"a\", \"an\". NO \"and\" — use a comma, or cut the second half.
NO trailing detail. Name the work, not the parts it is made of.
SENTENCE CASE, like a sentence: only the first word is capitalized. Proper names keep their capitals — Lens, Finder, Keychain, CodeMirror.
No period. No quotes.
ROOM FOR ABOUT 56 CHARACTERS — one short line.

USE THE DIGEST'S OWN WORDS. Build the headline out of words that appear in the digest you were given; do not reach for a synonym when the digest has the word. Never name a tool — Bash, Edit, Read, Write, Grep — and never write a path or a file's location. Those say which command ran; the headline says what the work is for.

A headline with no verb is a label, and a label is a failure. \"Ligature fallback for monospace fonts\" is a label. \"Repair ligature fallback in monospace\" is a headline."
    };
}

const SUMMARIZE_INSTRUCTIONS: &str = concat!(
    "\
You write the headline for a live coding session. The digest comes in labeled sections.

\"The current ask\" is what the person most recently asked for, and it names the subject: headline the work being done about THAT. \"The standing goal\" is the older, wider aim — background, not the subject, unless it is the only ask there is. \"What it is doing right now\" says how the ask is being advanced, and it is what makes the headline move.

Newspaper headline style. The rules are strict:

START WITH A VERB, in the plain command form: Fix, Author, Draft, Wire, Trace, Port, Audit, Bundle, Salvage, Explain. Not \"Fixing\", not \"Building\" — Fix, Build.
",
    headline_rules!(),
    "

Answer only from the digest below. Output only the headline.

DIGEST:"
);

const SUMMARIZE_DONE_INSTRUCTIONS: &str = concat!(
    "\
You write one line saying what a coding session accomplished. The work has stopped. The section labeled \"What the session did\" holds everything that happened, and the other sections say what it was for. Say what was accomplished — not the last thing that ran, and not every step in order.

Newspaper headline style, in the PAST TENSE. The rules are strict:

START WITH A PAST-TENSE VERB: Fixed, Authored, Drafted, Wired, Traced, Ported, Audited, Bundled, Salvaged, Explained. Not \"Fixing\", not \"Has fixed\" — Fixed, Wired.
",
    headline_rules!(),
    "

Never restate one line of the digest; say what the lines add up to.

Answer only from the digest below. Output only the line.

DIGEST:"
);

/// Scripted workers, for this module's pool-policy tests and for any other
/// module that needs a pool answering a known thing.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// Scripts turn outcomes. Every worker this hands out draws from the same
    /// script, so a test says what the model does without saying which process
    /// said it.
    pub(crate) struct FakeSpawner {
        /// Answer for each turn, by the order turns arrive at this worker.
        answers: Mutex<Vec<Result<String, String>>>,
        /// Held before answering turns whose text carries the marker, so a test
        /// can put a worker of **one** class mid-turn while the other answers
        /// at once — which is the whole shape [P12] exists to produce.
        delay: Option<(&'static str, Duration)>,
        /// Spawns attempted, and whether each is allowed to succeed.
        spawns: AtomicUsize,
        spawn_fails: bool,
        /// Turn text seen, for the composition assertions.
        seen: Arc<Mutex<Vec<String>>>,
    }

    impl FakeSpawner {
        pub(crate) fn new(answers: Vec<Result<String, String>>) -> Arc<Self> {
            Arc::new(Self {
                answers: Mutex::new(answers),
                delay: None,
                spawns: AtomicUsize::new(0),
                spawn_fails: false,
                seen: Arc::new(Mutex::new(Vec::new())),
            })
        }
        pub(crate) fn always(answer: Result<String, String>) -> Arc<Self> {
            Self::new(vec![answer; 64])
        }
        /// Answers turns containing `marker` only after `delay`.
        pub(crate) fn slow(
            answer: Result<String, String>,
            marker: &'static str,
            delay: Duration,
        ) -> Arc<Self> {
            Arc::new(Self {
                answers: Mutex::new(vec![answer; 64]),
                delay: Some((marker, delay)),
                spawns: AtomicUsize::new(0),
                spawn_fails: false,
                seen: Arc::new(Mutex::new(Vec::new())),
            })
        }
        pub(crate) fn failing() -> Arc<Self> {
            Arc::new(Self {
                answers: Mutex::new(Vec::new()),
                delay: None,
                spawns: AtomicUsize::new(0),
                spawn_fails: true,
                seen: Arc::new(Mutex::new(Vec::new())),
            })
        }
    }

    impl AgentWorkerSpawner for FakeSpawner {
        fn spawn(&self, _model: String) -> Result<mpsc::Sender<TurnRequest>, String> {
            self.spawns.fetch_add(1, Ordering::Relaxed);
            if self.spawn_fails {
                return Err("no claude here".to_string());
            }
            let (tx, mut rx) = mpsc::channel::<TurnRequest>(8);
            let answers: Vec<_> = self.answers.lock().unwrap().clone();
            let delay = self.delay;
            let seen = Arc::clone(&self.seen);
            tokio::spawn(async move {
                let mut answers = answers.into_iter();
                while let Some(TurnRequest { text, reply }) = rx.recv().await {
                    if let Some((marker, delay)) = delay {
                        if text.contains(marker) {
                            tokio::time::sleep(delay).await;
                        }
                    }
                    seen.lock().unwrap().push(text);
                    let answer = answers
                        .next()
                        .unwrap_or_else(|| Err("fake ran out of answers".to_string()));
                    let _ = reply.send(answer);
                }
            });
            Ok(tx)
        }
    }

    /// Spawn counter and turn log, for the pool-policy assertions.
    impl FakeSpawner {
        pub(crate) fn spawn_count(&self) -> usize {
            self.spawns.load(Ordering::Relaxed)
        }
        pub(crate) fn turns_seen(&self) -> Vec<String> {
            self.seen.lock().unwrap().clone()
        }
    }

    /// A pool over the **real** Haiku job table, answering `answer` to every
    /// turn — what another module's tests want when they are exercising a verb
    /// rather than pool policy.
    pub(crate) fn scripted_haiku_pool(answer: Result<String, String>) -> Arc<SharedAgentPool> {
        SharedAgentPool::new(
            AgentSpec {
                name: "haiku",
                model: Arc::new(|| HAIKU_MODEL.to_string()),
                jobs: HAIKU_AGENT_JOBS,
                max_workers: DEFAULT_MAX_WORKERS,
            },
            FakeSpawner::always(answer) as Arc<dyn AgentWorkerSpawner>,
        )
    }

    pub(crate) static TEST_JOBS: &[JobSpec] = &[
        JobSpec {
            name: "classify",
            instructions: "CLASSIFY",
            timeout: Duration::from_secs(2),
            slow: Some(Duration::from_secs(1)),
        },
        JobSpec {
            name: "classify_with_grammar",
            instructions: "CLASSIFY-DOC {{GRAMMAR}}",
            timeout: Duration::from_secs(2),
            slow: None,
        },
        JobSpec {
            name: "summarize",
            instructions: "SUMMARIZE",
            timeout: Duration::from_secs(6),
            slow: None,
        },
    ];

    pub(crate) fn pool(spawner: Arc<FakeSpawner>, max_workers: usize) -> Arc<SharedAgentPool> {
        SharedAgentPool::new(
            AgentSpec {
                name: "test",
                model: Arc::new(|| "test-model".to_string()),
                jobs: TEST_JOBS,
                max_workers,
            },
            spawner,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{FakeSpawner, pool};
    use super::*;

    #[tokio::test]
    async fn a_job_turn_carries_its_instructions_and_input() {
        let fake = FakeSpawner::always(Ok("Fix the thing".to_string()));
        let pool = pool(Arc::clone(&fake), 2);
        pool.run("summarize", "the digest".to_string())
            .await
            .expect("answers");
        assert_eq!(fake.turns_seen().as_slice(), ["SUMMARIZE\n\nthe digest"]);
    }

    #[tokio::test]
    async fn one_worker_serves_every_job_of_its_class_in_turn() {
        let fake = FakeSpawner::always(Ok("SHELL".to_string()));
        let pool = pool(Arc::clone(&fake), 2);
        for _ in 0..3 {
            pool.run_classify("ls".to_string(), None).await.expect("ok");
        }
        // Serialized by typing, so a second classify worker would be pool
        // growth nobody asked for.
        assert_eq!(fake.spawn_count(), 1);
        assert_eq!(pool.worker_count(), 1);
    }

    /// [P12]'s reason for existing: a classify that arrives while the only
    /// worker is mid-summarize must not wait for it. The summarize here holds
    /// for 5s — longer than classify's entire 2s ceiling — so if the classify
    /// queued behind it, it would time out instead of answering.
    #[tokio::test(start_paused = true)]
    async fn a_classify_never_queues_behind_a_busy_summarize_worker() {
        let fake = FakeSpawner::slow(Ok("SHELL".to_string()), "SUMMARIZE", Duration::from_secs(5));
        let pool = pool(Arc::clone(&fake), 2);

        let summarizing = {
            let pool = Arc::clone(&pool);
            tokio::spawn(async move { pool.run("summarize", "digest".to_string()).await })
        };
        // Let the summarize claim its worker before the classify arrives.
        tokio::time::sleep(Duration::from_millis(50)).await;

        let verdict = pool.run_classify("ls -la".to_string(), None).await;
        assert_eq!(verdict.as_deref(), Ok("shell"));
        assert_eq!(
            fake.spawn_count(),
            2,
            "the classify got a worker of its own class",
        );
        summarizing.await.expect("join").expect("summarize answers");
    }

    #[tokio::test(start_paused = true)]
    async fn the_pool_grows_to_max_workers_and_never_past_it() {
        let fake = FakeSpawner::slow(
            Ok("SHELL".to_string()),
            "CLASSIFY",
            Duration::from_millis(300),
        );
        let pool = pool(Arc::clone(&fake), 2);

        // Four concurrent classifies against a cap of two: two workers, and the
        // other two jobs queue behind their own class.
        let mut running = Vec::new();
        for _ in 0..4 {
            let pool = Arc::clone(&pool);
            running.push(tokio::spawn(async move {
                pool.run_classify("ls".to_string(), None).await
            }));
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        for job in running {
            assert_eq!(job.await.expect("join").as_deref(), Ok("shell"));
        }
        assert_eq!(fake.spawn_count(), 2);
    }

    #[tokio::test]
    async fn a_worker_is_recycled_at_the_turn_cap() {
        let fake = FakeSpawner::always(Ok("SHELL".to_string()));
        let pool = pool(Arc::clone(&fake), 2);
        for _ in 0..MAX_TURNS_PER_WORKER {
            pool.run_classify("ls".to_string(), None).await.expect("ok");
        }
        assert_eq!(fake.spawn_count(), 1, "one worker so far");
        // Turn 41 lands on a fresh worker.
        pool.run_classify("ls".to_string(), None).await.expect("ok");
        assert_eq!(fake.spawn_count(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn an_idle_worker_is_reaped() {
        let fake = FakeSpawner::always(Ok("SHELL".to_string()));
        let pool = pool(Arc::clone(&fake), 2);
        pool.run_classify("ls".to_string(), None).await.expect("ok");
        assert_eq!(pool.worker_count(), 1);

        tokio::time::advance(IDLE_REAP + Duration::from_secs(1)).await;
        assert_eq!(pool.worker_count(), 0, "reaped after the idle window");

        pool.run_classify("ls".to_string(), None).await.expect("ok");
        assert_eq!(fake.spawn_count(), 2, "spawned again on demand");
    }

    /// A worker that dies must not be respawned in a hot loop. Within the
    /// debounce the job degrades; past it the class may spawn again.
    #[tokio::test(start_paused = true)]
    async fn a_dead_worker_is_not_respawned_inside_the_debounce() {
        let fake = FakeSpawner::failing();
        let pool = pool(Arc::clone(&fake), 2);

        assert!(pool.run_classify("ls".to_string(), None).await.is_err());
        assert_eq!(fake.spawn_count(), 1);

        // Immediately again: the debounce holds, so no second spawn attempt.
        assert!(pool.run_classify("ls".to_string(), None).await.is_err());
        assert_eq!(fake.spawn_count(), 1);

        tokio::time::advance(RESPAWN_MIN_INTERVAL + Duration::from_secs(1)).await;
        assert!(pool.run_classify("ls".to_string(), None).await.is_err());
        assert_eq!(fake.spawn_count(), 2, "allowed past the debounce");
    }

    #[tokio::test(start_paused = true)]
    async fn a_job_past_its_ceiling_errors_and_retires_the_worker() {
        // Classify's ceiling is 2s in the test table; this worker takes 10.
        let fake = FakeSpawner::slow(Ok("SHELL".to_string()), "CLASSIFY", Duration::from_secs(10));
        let pool = pool(Arc::clone(&fake), 2);

        let error = pool
            .run_classify("ls".to_string(), None)
            .await
            .expect_err("the ceiling is the answer");
        assert!(error.contains("timed out"), "{error}");
        // The stuck worker is out of the rotation rather than left to make the
        // next job time out behind it.
        assert_eq!(pool.worker_count(), 0);
    }

    /// A timeout is a failure for the respawn debounce too: a hung backend is
    /// never paid for with one fresh spawn per call, and a job arriving inside
    /// the window degrades instead of queueing behind the retired worker.
    #[tokio::test(start_paused = true)]
    async fn a_timed_out_class_holds_the_respawn_debounce() {
        let fake = FakeSpawner::slow(Ok("SHELL".to_string()), "CLASSIFY", Duration::from_secs(10));
        let pool = pool(Arc::clone(&fake), 2);

        assert!(pool.run_classify("ls".to_string(), None).await.is_err());
        assert_eq!(fake.spawn_count(), 1);

        let error = pool
            .run_classify("ls".to_string(), None)
            .await
            .expect_err("degrades inside the debounce");
        assert!(error.contains("unavailable"), "{error}");
        assert_eq!(fake.spawn_count(), 1, "no spawn inside the debounce");

        tokio::time::advance(RESPAWN_MIN_INTERVAL + Duration::from_secs(1)).await;
        assert!(pool.run_classify("ls".to_string(), None).await.is_err());
        assert_eq!(fake.spawn_count(), 2, "allowed past the debounce");
    }

    #[tokio::test]
    async fn a_classify_answer_naming_no_label_or_both_is_a_refusal() {
        for answer in ["I am not sure", "SHELL or PROMPT", "", "shellfish"] {
            let fake = FakeSpawner::always(Ok(answer.to_string()));
            let pool = pool(fake, 2);
            let error = pool
                .run_classify("ls".to_string(), None)
                .await
                .expect_err("refusal");
            assert!(error.contains("did not name a label"), "{answer:?}: {error}");
        }
        // A label anywhere in the answer, named once, is the verdict.
        for (answer, expected) in [
            ("SHELL", "shell"),
            ("prompt", "prompt"),
            ("**SHELL**", "shell"),
            ("The answer is PROMPT.", "prompt"),
        ] {
            let fake = FakeSpawner::always(Ok(answer.to_string()));
            let pool = pool(fake, 2);
            assert_eq!(
                pool.run_classify("ls".to_string(), None).await.as_deref(),
                Ok(expected),
                "{answer:?}",
            );
        }
    }

    #[tokio::test]
    async fn a_grammar_picks_the_documentation_wording_and_is_substituted() {
        let fake = FakeSpawner::always(Ok("SHELL".to_string()));
        let pool = pool(Arc::clone(&fake), 2);
        pool.run_classify("curl -sS x".to_string(), Some("usage: curl [options]".to_string()))
            .await
            .expect("ok");
        assert_eq!(
            fake.turns_seen().as_slice(),
            ["CLASSIFY-DOC usage: curl [options]\n\ncurl -sS x"],
        );
    }

    /// [P08]: an app-test instance must never reach a real worker, so the gate
    /// answers before anything is spawned.
    #[tokio::test]
    async fn the_app_test_gate_answers_without_spawning() {
        // Safe under nextest, which runs each test in its own process.
        unsafe { std::env::set_var("TUGAPP_APP_TEST", "1") };
        let fake = FakeSpawner::always(Ok("SHELL".to_string()));
        let pool = pool(Arc::clone(&fake), 2);

        let error = pool
            .run_classify("ls".to_string(), None)
            .await
            .expect_err("gated");
        assert_eq!(error, UNAVAILABLE);
        assert!(pool.run("summarize", "d".to_string()).await.is_err());
        assert_eq!(fake.spawn_count(), 0, "nothing was spawned");
        unsafe { std::env::remove_var("TUGAPP_APP_TEST") };
    }

    /// The future-Sonnet exit criterion ([P01]): a second agent is a second
    /// value, not new machinery. This spec shares nothing with the Haiku one
    /// but the pool type.
    #[tokio::test]
    async fn a_second_agent_spec_runs_on_the_same_pool_machinery() {
        static OTHER_JOBS: &[JobSpec] = &[
            JobSpec {
                name: "summarize",
                instructions: "OTHER-SUMMARIZE",
                timeout: Duration::from_secs(30),
                slow: None,
            },
            JobSpec {
                name: "critique",
                instructions: "OTHER-CRITIQUE",
                timeout: Duration::from_secs(30),
                slow: None,
            },
        ];
        let fake = FakeSpawner::always(Ok("an answer".to_string()));
        let pool = SharedAgentPool::new(
            AgentSpec {
                name: "other",
                model: Arc::new(|| "claude-sonnet-5".to_string()),
                jobs: OTHER_JOBS,
                max_workers: 1,
            },
            Arc::clone(&fake) as Arc<dyn AgentWorkerSpawner>,
        );
        assert_eq!(
            pool.run("critique", "a draft".to_string()).await.as_deref(),
            Ok("an answer"),
        );
        assert_eq!(fake.turns_seen().as_slice(), ["OTHER-CRITIQUE\n\na draft"]);
    }

    #[test]
    fn the_haiku_job_table_carries_every_contract_the_gates_depend_on() {
        let job = |name: &str| {
            HAIKU_AGENT_JOBS
                .iter()
                .find(|j| j.name == name)
                .unwrap_or_else(|| panic!("{name} missing"))
        };
        // Both labels, in both classify wordings.
        for name in ["classify", "classify_with_grammar"] {
            let text = job(name).instructions;
            assert!(text.contains("SHELL") && text.contains("PROMPT"), "{name}");
            assert!(text.contains("answer PROMPT"), "{name} keeps the asymmetry");
        }
        assert!(job("classify_with_grammar")
            .instructions
            .contains(GRAMMAR_PLACEHOLDER));
        assert!(!job("classify").instructions.contains(GRAMMAR_PLACEHOLDER));

        // The register rules `headline_register_report` and `ground_headline`
        // enforce, and the extractive instruction that keeps grounding passing.
        for name in ["summarize", "summarize_done"] {
            let text = job(name).instructions;
            assert!(text.contains("SENTENCE CASE"), "{name}");
            assert!(text.contains("USE THE DIGEST'S OWN WORDS"), "{name}");
            assert!(text.contains("56 CHARACTERS"), "{name}");
        }
        assert!(job("summarize_done").instructions.contains("PAST TENSE"));

        // Classify's ceiling is the triad's Rust member; summarize stays under
        // the emit floor.
        assert_eq!(job("classify").timeout, Duration::from_secs(2));
        assert!(job("summarize").timeout < crate::feeds::session_overview::EMIT_FLOOR);
        assert!(job("summarize_done").timeout < crate::feeds::session_overview::EMIT_FLOOR);
    }

    /// The only test that spawns a real `claude` and spends real tokens.
    ///
    /// `#[ignore]`-gated **and** `TUG_REAL_CLAUDE`-gated, the same
    /// belt-and-suspenders as `tests/multi_session_real_claude.rs`, so a
    /// developer running `--run-ignored only` without the variable gets a fast
    /// no-op rather than a surprise spawn. To run it:
    ///
    /// ```sh
    /// cd tugrust
    /// TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast \
    ///   --run-ignored only a_real_worker_answers
    /// ```
    ///
    /// It pins the seam the fake spawner cannot: that the argv, the isolation
    /// posture, and the stream-json frame parsing actually work against the
    /// installed CLI. It asserts a label and a non-empty headline — never model
    /// prose, which is the eval harness's business.
    #[tokio::test]
    #[ignore = "requires TUG_REAL_CLAUDE=1 and a live claude binary"]
    async fn a_real_worker_answers_one_classify_and_one_summarize() {
        if std::env::var("TUG_REAL_CLAUDE").as_deref() != Ok("1") {
            return;
        }
        let pool = SharedAgentPool::new(
            AgentSpec {
                name: "haiku",
                model: Arc::new(|| HAIKU_MODEL.to_string()),
                jobs: HAIKU_AGENT_JOBS,
                max_workers: DEFAULT_MAX_WORKERS,
            },
            Arc::new(ClaudeAgentWorkerSpawner),
        );

        // The first turn of a class pays the cold spawn, which is more than
        // classify's own ceiling — so warm the lane first and time the turn
        // that a user would actually wait on.
        let _ = pool.run_classify("pwd".to_string(), None).await;
        let started = Instant::now();
        let verdict = pool
            .run_classify("ls -la".to_string(), None)
            .await
            .expect("a warm classify answers");
        let warm_ms = started.elapsed().as_millis();
        assert_eq!(verdict, "shell", "an unambiguous command routes to the shell");
        assert!(
            started.elapsed() < CLASSIFY_TIMEOUT,
            "a warm classify took {warm_ms}ms, past the {CLASSIFY_TIMEOUT:?} budget",
        );

        let digest = "The standing goal:\n- make the watch loop resilient\n\
             What it is doing right now:\n- Edit(watch.rs)\n";
        let headline = pool
            .run("summarize", digest.to_string())
            .await
            .expect("a summarize answers");
        assert!(!headline.trim().is_empty(), "an empty headline is a failure");
    }

    #[test]
    fn job_classes_split_the_two_latency_lanes() {
        assert_eq!(JobClass::of("classify"), JobClass::Classify);
        assert_eq!(
            JobClass::of("classify_with_grammar"),
            JobClass::Classify,
            "both classify wordings share a lane",
        );
        assert_eq!(JobClass::of("summarize"), JobClass::Summarize);
        assert_eq!(JobClass::of("summarize_done"), JobClass::Summarize);
    }
}
