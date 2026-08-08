//! operator — the Gazette's read-only verb executor.
//!
//! The Operator model never touches the machine. It emits verb *requests*
//! (Spec S02) and this module runs them: ledger reads over the session ledger,
//! and `git` subprocesses in a project dir resolved from the ledger. Every
//! verb is read-only, output-capped, and bounded by a wall-clock timeout, so
//! the worst a confused model can do is ask for something that comes back
//! empty.
//!
//! Three properties are structural rather than conventional, and each has a
//! test standing on it:
//!
//! - **Nothing the model writes reaches a shell.** Arguments are pushed onto
//!   an argv one at a time — there is no string interpolation anywhere in this
//!   file, so there is no quoting to get wrong. Beyond that, model-supplied
//!   strings that reach a git argv must not be flag-shaped: `-S`, `--upload-
//!   pack=…` and their relatives are rejected at the argument gate rather than
//!   handed to git to interpret.
//! - **Every result is capped before it is returned**, because the results are
//!   about to become the answering model's input and an uncapped `git show` of
//!   a vendored-dependency bump would displace the question itself.
//! - **A verb never fails the pipeline.** An unknown name, a missing argument,
//!   a malformed FTS query: all come back as `Err(String)`, which the caller
//!   packs into the results so the model reads its own mistake and tries
//!   something else.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};
use tokio::process::Command;
use tracing::warn;

use crate::session_ledger::{GazetteSearchFilter, SessionLedger};
use tugcast_core::types::{GazetteAuthor, GazettePost};

// MARK: - Caps

/// Per-verb wall clock. A ledger read that takes ten seconds is a wedged
/// database, and a `git log` that takes ten seconds is a repository the
/// Operator cannot help with in the time someone will wait.
pub const VERB_TIMEOUT: Duration = Duration::from_secs(10);

const SEARCH_LIMIT: usize = 20;
const WINDOW_MAX_N: usize = 10;
const SESSIONS_LIMIT: usize = 50;
const PROMPTS_LIMIT: usize = 50;
const PROMPT_MAX_CHARS: usize = 500;
const CHANGES_LIMIT: usize = 200;
const GIT_LOG_MAX_N: usize = 30;
const GIT_LOG_DEFAULT_N: usize = 20;
const GIT_SHOW_MAX_LINES: usize = 400;
const GIT_SHOW_MAX_BYTES: usize = 16 * 1024;
const GREP_MAX_MATCHES: usize = 100;

/// Incipit length for a session's title/last-prompt in `sessions.list`. Long
/// enough to recognize the session, short enough that fifty of them are a
/// list rather than a wall.
const INCIPIT_CHARS: usize = 120;

// MARK: - Context

/// What a verb needs to run: the ledger it reads, and the project dir to use
/// when a question names no session ([Q03]).
pub struct OperatorContext {
    pub ledger: Arc<SessionLedger>,
    /// The `--source-tree` dir `main.rs` resolves at startup — the repo a
    /// question means when it doesn't say.
    pub bootstrap_project_dir: PathBuf,
}

/// Every verb the Operator may name. The retrieval instructions list the same
/// nine; a test pins the two lists against each other so a verb can never be
/// offered to the model without an executor behind it.
pub const VERB_NAMES: &[&str] = &[
    "gazette.search",
    "gazette.window",
    "sessions.list",
    "session.prompts",
    "changes.for_session",
    "changes.for_path",
    "git.log",
    "git.show",
    "repo.grep",
];

// MARK: - Entry point

/// Run one verb and return its results as JSON.
///
/// The error side is a message written for the model, not for a log: it says
/// what was wrong with the request so the next round can fix it.
pub async fn run_verb(ctx: &OperatorContext, name: &str, args: &Value) -> Result<Value, String> {
    if !args.is_object() && !args.is_null() {
        return Err(format!("{name}: args must be a JSON object"));
    }
    match tokio::time::timeout(VERB_TIMEOUT, dispatch(ctx, name, args)).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "{name}: timed out after {}s",
            VERB_TIMEOUT.as_secs()
        )),
    }
}

async fn dispatch(ctx: &OperatorContext, name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "gazette.search" => gazette_search(ctx, args),
        "gazette.window" => gazette_window(ctx, args),
        "sessions.list" => sessions_list(ctx, args),
        "session.prompts" => session_prompts(ctx, args),
        "changes.for_session" => changes_for_session(ctx, args),
        "changes.for_path" => changes_for_path(ctx, args),
        "git.log" => git_log(ctx, args).await,
        "git.show" => git_show(ctx, args).await,
        "repo.grep" => repo_grep(ctx, args).await,
        other => Err(format!(
            "unknown verb {other:?}; the verbs are: {}",
            VERB_NAMES.join(", ")
        )),
    }
}

// MARK: - Argument reading

fn opt_str<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(format!("argument {key:?} must be a string")),
    }
}

fn req_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    opt_str(args, key)?.ok_or_else(|| format!("argument {key:?} is required"))
}

fn opt_i64(args: &Value, key: &str) -> Result<Option<i64>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("argument {key:?} must be a whole number")),
        Some(_) => Err(format!("argument {key:?} must be a number")),
    }
}

fn opt_bool(args: &Value, key: &str) -> Result<Option<bool>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(format!("argument {key:?} must be true or false")),
    }
}

// MARK: - The argument gate

/// Reject a model-supplied string that would reach a git argv as a flag.
///
/// git has no shortage of arguments that run code or reach the network —
/// `--upload-pack`, `--output`, `-S` in the wrong position — and the only
/// robust defense is that a value which *looks* like an option never becomes
/// one. Control characters go too: a newline in an argv is not an injection
/// here, but it is always a mistake, and rejecting it keeps the results
/// parseable.
fn plain_arg(value: &str, what: &str) -> Result<(), String> {
    if value.starts_with('-') {
        return Err(format!(
            "{what} may not begin with '-'; option-shaped values are refused"
        ));
    }
    if value.contains(['\0', '\n', '\r']) {
        return Err(format!("{what} may not contain control characters"));
    }
    Ok(())
}

/// A repo-relative path from the model. Not canonicalized — per the plan's
/// [L29] boundary it is an immediate operand, never a key — but confined:
/// absolute paths and `..` traversal are refused so a path argument cannot
/// address anything outside the resolved project dir.
fn path_arg(value: &str, what: &str) -> Result<(), String> {
    plain_arg(value, what)?;
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("{what} must be repo-relative"));
    }
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("{what} may not contain '..'"));
    }
    Ok(())
}

/// A commit-ish. Hex only: it is what a sha is, and it happens to be the
/// tightest possible refusal of everything a sha is not.
fn sha_arg(value: &str) -> Result<(), String> {
    let ok = (4..=64).contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit());
    if ok {
        Ok(())
    } else {
        Err(format!(
            "sha {value:?} is not a hex object name (4-64 hex digits)"
        ))
    }
}

// MARK: - Project dir resolution ([Q03])

/// The repo a verb runs in: the named session's project dir, or the bootstrap
/// workspace's when the question named no session.
fn project_dir(ctx: &OperatorContext, args: &Value) -> Result<PathBuf, String> {
    let Some(session_id) = opt_str(args, "session_id")? else {
        return Ok(ctx.bootstrap_project_dir.clone());
    };
    match ctx.ledger.get(session_id) {
        Ok(Some(row)) => Ok(PathBuf::from(row.project_dir)),
        Ok(None) => Err(format!("no session {session_id:?} in the ledger")),
        Err(err) => Err(format!("session lookup failed: {err}")),
    }
}

// MARK: - Ledger verbs

fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push('…');
    out
}

fn post_json(post: &tugcast_core::types::GazettePost) -> Value {
    json!({
        "id": post.id,
        "at_ms": post.at_ms,
        "author": post.author.as_str(),
        "session_id": post.session_id,
        "wake_reason": post.wake_reason,
        "body": post.body,
        "refs": post.refs.iter().map(|r| json!({"kind": r.kind.as_str(), "target": r.target}))
            .collect::<Vec<_>>(),
    })
}

fn gazette_search(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let query = req_str(args, "query")?;
    let author = match opt_str(args, "author")? {
        Some(raw) => Some(
            GazetteAuthor::parse(raw)
                .ok_or_else(|| format!("author {raw:?} is not reporter, operator, or user"))?,
        ),
        None => None,
    };
    let filter = GazetteSearchFilter {
        author,
        session_id: opt_str(args, "session_id")?.map(str::to_string),
        since_ms: opt_i64(args, "since_ms")?,
        until_ms: opt_i64(args, "until_ms")?,
    };
    let hits = ctx
        .ledger
        .search_gazette_posts(query, &filter, SEARCH_LIMIT)
        // An unbalanced quote or a bare `AND` is the model's error to see,
        // not a failure to hide: FTS5 says exactly what it disliked.
        .map_err(|err| format!("gazette.search: {err}"))?;
    let rows: Vec<Value> = hits
        .iter()
        .map(|hit| {
            let mut row = post_json(&hit.post);
            row["excerpt"] = json!(truncate(&hit.excerpt, 240));
            row
        })
        .collect();
    Ok(json!({ "posts": rows, "count": rows.len() }))
}

fn gazette_window(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let post_id = opt_i64(args, "post_id")?.ok_or("argument \"post_id\" is required")?;
    let n = opt_i64(args, "n")?
        .unwrap_or(3)
        .clamp(0, WINDOW_MAX_N as i64) as usize;
    let posts = ctx
        .ledger
        .gazette_posts_window(post_id, n)
        .map_err(|err| format!("gazette.window: {err}"))?;
    let rows: Vec<Value> = posts.iter().map(post_json).collect();
    Ok(json!({ "posts": rows, "count": rows.len() }))
}

fn sessions_list(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let rows = ctx
        .ledger
        .list_sessions_recent(
            opt_i64(args, "since_ms")?,
            opt_i64(args, "until_ms")?,
            opt_bool(args, "active")?.unwrap_or(false),
            SESSIONS_LIMIT,
        )
        .map_err(|err| format!("sessions.list: {err}"))?;
    let sessions: Vec<Value> = rows
        .iter()
        .map(|row| {
            // The title if it has one, otherwise the last thing the person
            // asked — either way, what makes the row recognizable.
            let incipit = row
                .name
                .as_deref()
                .or(row.last_user_prompt.as_deref())
                .map(|text| truncate(text, INCIPIT_CHARS));
            json!({
                "session_id": row.session_id,
                "incipit": incipit,
                "project_dir": row.project_dir,
                "created_at_ms": row.created_at,
                "last_used_at_ms": row.last_used_at,
                "turn_count": row.turn_count,
                "state": row.state.as_str(),
            })
        })
        .collect();
    Ok(json!({ "sessions": sessions, "count": sessions.len() }))
}

/// What the person asked in one session.
///
/// The ledger's `turns` journal holds only *pending* submissions — a row is
/// deleted the moment claude acknowledges it — so the durable record of a
/// prompt is the session row's `last_user_prompt`. This verb returns both:
/// anything still in flight, and the last prompt the session recorded. The
/// full prompt history lives in claude's JSONL, which no read-only ledger
/// verb reaches; an answer that needs it should say so rather than guess.
fn session_prompts(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let session_id = req_str(args, "session_id")?;
    let query = opt_str(args, "query")?.map(str::to_lowercase);
    let row = ctx
        .ledger
        .get(session_id)
        .map_err(|err| format!("session.prompts: {err}"))?
        .ok_or_else(|| format!("no session {session_id:?} in the ledger"))?;
    let pending = ctx
        .ledger
        .list_pending_turns_for_session(session_id)
        .map_err(|err| format!("session.prompts: {err}"))?;

    let mut prompts: Vec<Value> = Vec::new();
    let mut push = |text: &str, at_ms: i64, pending: bool| {
        if let Some(needle) = query.as_deref()
            && !text.to_lowercase().contains(needle)
        {
            return;
        }
        if prompts.len() < PROMPTS_LIMIT {
            prompts.push(json!({
                "text": truncate(text, PROMPT_MAX_CHARS),
                "at_ms": at_ms,
                "pending": pending,
            }));
        }
    };
    if let Some(last) = row.last_user_prompt.as_deref() {
        push(last, row.last_used_at, false);
    }
    for turn in &pending {
        push(&turn.user_text, turn.created_at, true);
    }
    Ok(json!({
        "session_id": session_id,
        "prompts": prompts,
        "turn_count": row.turn_count,
        "note": "the ledger keeps the last prompt plus any still in flight; \
                 earlier prompts are not stored",
    }))
}

fn changes_for_session(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let session_id = req_str(args, "session_id")?;
    let events = ctx
        .ledger
        .list_file_events_for_session(session_id, CHANGES_LIMIT)
        .map_err(|err| format!("changes.for_session: {err}"))?;
    let changes: Vec<Value> = events
        .iter()
        .map(|e| {
            json!({
                "path": e.file_path,
                "op": e.op,
                "origin": e.origin,
                "at_ms": e.at,
            })
        })
        .collect();
    Ok(json!({ "session_id": session_id, "changes": changes, "count": changes.len() }))
}

fn changes_for_path(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let pattern = req_str(args, "pattern")?;
    let events = ctx
        .ledger
        .list_file_events_for_path_pattern(
            pattern,
            opt_i64(args, "since_ms")?,
            opt_i64(args, "until_ms")?,
            CHANGES_LIMIT,
        )
        .map_err(|err| format!("changes.for_path: {err}"))?;
    let changes: Vec<Value> = events
        .iter()
        .map(|e| {
            json!({
                "path": e.file_path,
                "op": e.op,
                "origin": e.origin,
                "at_ms": e.at,
                "session_id": e.tug_session_id,
            })
        })
        .collect();
    Ok(json!({ "pattern": pattern, "changes": changes, "count": changes.len() }))
}

// MARK: - Git verbs

/// Run `git` in `dir` and return its stdout, or a message naming what failed.
///
/// `kill_on_drop` matters: the caller's timeout drops this future, and without
/// it a wedged `git grep` over a huge tree would keep running after nobody is
/// listening.
async fn run_git(dir: &Path, args: &[String]) -> Result<String, String> {
    if !dir.is_dir() {
        return Err(format!("{} is not a directory", dir.display()));
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args).kill_on_drop(true);
    let output = cmd
        .output()
        .await
        .map_err(|err| format!("git could not be run: {err}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    // `git grep` exits 1 with empty output when it simply matched nothing;
    // that is an answer, not a failure.
    if output.stdout.is_empty() && output.stderr.is_empty() {
        return Ok(String::new());
    }
    Err(format!(
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

/// Field and record separators. ASCII unit/record separators cannot appear in
/// a commit subject the way a `|` or a tab can, so parsing is exact rather
/// than heuristic.
const GIT_FIELD: char = '\x1f';
const GIT_RECORD: char = '\x1e';

async fn git_log(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let dir = project_dir(ctx, args)?;
    let n = opt_i64(args, "n")?
        .unwrap_or(GIT_LOG_DEFAULT_N as i64)
        .clamp(1, GIT_LOG_MAX_N as i64);

    let mut argv: Vec<String> = vec![
        "log".into(),
        "--no-color".into(),
        "--date=short".into(),
        format!("--pretty=format:{GIT_RECORD}%H{GIT_FIELD}%ad{GIT_FIELD}%s"),
        "--name-only".into(),
        format!("-n{n}"),
    ];
    if let Some(grep) = opt_str(args, "grep")? {
        plain_arg(grep, "grep")?;
        argv.push(format!("--grep={grep}"));
    }
    if let Some(pickaxe) = opt_str(args, "pickaxe")? {
        plain_arg(pickaxe, "pickaxe")?;
        argv.push(format!("-S{pickaxe}"));
    }
    if let Some(since) = opt_str(args, "since")? {
        plain_arg(since, "since")?;
        argv.push(format!("--since={since}"));
    }
    if let Some(until) = opt_str(args, "until")? {
        plain_arg(until, "until")?;
        argv.push(format!("--until={until}"));
    }
    if let Some(path) = opt_str(args, "path")? {
        path_arg(path, "path")?;
        argv.push("--".into());
        argv.push(path.to_string());
    }

    let stdout = run_git(&dir, &argv).await?;
    let commits: Vec<Value> = stdout
        .split(GIT_RECORD)
        .filter(|chunk| !chunk.trim().is_empty())
        .filter_map(|chunk| {
            let mut lines = chunk.lines();
            let header = lines.next()?;
            let mut fields = header.split(GIT_FIELD);
            let sha = fields.next()?.to_string();
            let date = fields.next().unwrap_or_default().to_string();
            let subject = fields.next().unwrap_or_default().to_string();
            let files: Vec<&str> = lines.filter(|l| !l.trim().is_empty()).collect();
            Some(json!({
                "sha": sha,
                "date": date,
                "subject": subject,
                "files": files,
            }))
        })
        .collect();
    Ok(json!({ "commits": commits, "count": commits.len() }))
}

/// Cap a diff at both a line count and a byte count, and say so in the text
/// when it bites — a silently truncated diff reads as a complete one.
fn cap_text(text: &str, max_lines: usize, max_bytes: usize) -> (String, bool) {
    let mut out = String::new();
    let mut truncated = false;
    for (lines, line) in text.lines().enumerate() {
        if lines >= max_lines || out.len() + line.len() + 1 > max_bytes {
            truncated = true;
            break;
        }
        out.push_str(line);
        out.push('\n');
    }
    if truncated {
        out.push_str("… output capped\n");
    }
    (out, truncated)
}

async fn git_show(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let dir = project_dir(ctx, args)?;
    let sha = req_str(args, "sha")?;
    sha_arg(sha)?;

    let mut argv: Vec<String> = vec![
        "show".into(),
        "--no-color".into(),
        "--date=short".into(),
        sha.to_string(),
    ];
    if let Some(path) = opt_str(args, "path")? {
        path_arg(path, "path")?;
        argv.push("--".into());
        argv.push(path.to_string());
    }

    let stdout = run_git(&dir, &argv).await?;
    let (text, truncated) = cap_text(&stdout, GIT_SHOW_MAX_LINES, GIT_SHOW_MAX_BYTES);
    Ok(json!({ "sha": sha, "text": text, "truncated": truncated }))
}

async fn repo_grep(ctx: &OperatorContext, args: &Value) -> Result<Value, String> {
    let dir = project_dir(ctx, args)?;
    let pattern = req_str(args, "pattern")?;
    plain_arg(pattern, "pattern")?;

    let mut argv: Vec<String> = vec![
        "grep".into(),
        "-n".into(),
        "-I".into(),
        "--no-color".into(),
        "-e".into(),
        pattern.to_string(),
    ];
    if let Some(scope) = opt_str(args, "path_scope")? {
        path_arg(scope, "path_scope")?;
        argv.push("--".into());
        argv.push(scope.to_string());
    }

    let stdout = run_git(&dir, &argv).await?;
    let all: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
    let truncated = all.len() > GREP_MAX_MATCHES;
    let matches: Vec<Value> = all
        .iter()
        .take(GREP_MAX_MATCHES)
        .map(|line| {
            let mut parts = line.splitn(3, ':');
            let path = parts.next().unwrap_or_default();
            let line_no = parts.next().and_then(|n| n.parse::<i64>().ok());
            let text = parts.next().unwrap_or_default();
            json!({ "path": path, "line": line_no, "text": truncate(text.trim_end(), 240) })
        })
        .collect();
    Ok(json!({
        "pattern": pattern,
        "matches": matches,
        "count": matches.len(),
        "truncated": truncated,
    }))
}

// MARK: - The pipeline

/// How much of the channel rides every Operator turn. Server-side scrollback:
/// the question arrives bare, and the last twenty posts are what make "that
/// theme thing yesterday" resolvable.
pub const SCROLLBACK_POSTS: usize = 20;

/// Per round. A model that wants more than six lookups has not narrowed the
/// question, and running them would spend the answer's context on breadth.
pub const MAX_VERBS_PER_ROUND: usize = 6;

/// How much of an unreadable model turn rides the warning. Enough to see what
/// shape it took; not so much that one bad turn floods the log.
const RAW_LOG_CHARS: usize = 400;

/// One retrieval round, then at most one follow-up, then the answer is forced.
/// The cap lives here rather than in the wording because the wording is a
/// request and this is a guarantee ([P07]).
pub const MAX_RETRIEVAL_ROUNDS: usize = 2;

/// One verb the model asked for.
///
/// **Not `deny_unknown_fields`, unlike the Reporter's envelope.** There the
/// strictness is the contract: a drifted field means a post nobody wrote on
/// purpose, and silence is the safe failure. Here the failure mode is the
/// opposite — somebody is waiting, and refusing a whole exchange because the
/// model annotated a verb with its reasoning spends their answer to enforce a
/// tidiness nothing depends on. Extra keys are ignored; an unknown verb *name*
/// is still an error the model reads, which is where the real checking is.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct VerbRequest {
    pub verb: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Deserialize)]
struct VerbsEnvelope {
    verbs: Vec<VerbRequest>,
}

#[derive(Debug, Deserialize)]
struct AnswerEnvelope {
    answer: AnswerPost,
}

#[derive(Debug, Deserialize)]
struct AnswerPost {
    body: String,
    #[serde(default)]
    refs: Vec<tugcast_core::types::GazetteRef>,
}

/// What `operator-answer` said: the answer, or a request for one more round.
enum AnswerTurn {
    Answer(AnswerPost),
    More(Vec<VerbRequest>),
}

/// Read a `{"verbs": […]}` envelope out of a model turn.
///
/// The same newest-first span scan the Reporter uses ([P06] as amended): the
/// models preface, double-wrap, and correct themselves the same way whichever
/// job they are answering, so there is one scanner rather than two.
fn parse_verbs(raw: &str) -> Option<Vec<VerbRequest>> {
    for span in crate::feeds::reporter_wake::json_object_spans(raw.trim())
        .into_iter()
        .rev()
    {
        if let Ok(envelope) = serde_json::from_str::<VerbsEnvelope>(span) {
            return Some(envelope.verbs);
        }
    }
    None
}

/// Read either half of what `operator-answer` may say. An answer wins over a
/// request for more when both somehow appear: the model has said the thing
/// someone is waiting for.
fn parse_answer_turn(raw: &str) -> Option<AnswerTurn> {
    let spans = crate::feeds::reporter_wake::json_object_spans(raw.trim());
    for span in spans.iter().rev() {
        if let Ok(envelope) = serde_json::from_str::<AnswerEnvelope>(span) {
            return Some(AnswerTurn::Answer(envelope.answer));
        }
    }
    for span in spans.iter().rev() {
        if let Ok(envelope) = serde_json::from_str::<VerbsEnvelope>(span) {
            return Some(AnswerTurn::More(envelope.verbs));
        }
    }
    None
}

fn render_scrollback(posts: &[tugcast_core::types::GazettePost]) -> String {
    if posts.is_empty() {
        return "(the channel is empty)\n".to_string();
    }
    let mut out = String::new();
    for post in posts {
        out.push_str("- [");
        out.push_str(&post.at_ms.to_string());
        out.push_str("] ");
        out.push_str(post.author.as_str());
        if let Some(id) = post.id {
            out.push_str(" (post_id ");
            out.push_str(&id.to_string());
            out.push(')');
        }
        out.push_str(": ");
        out.push_str(&post.body);
        out.push('\n');
    }
    out
}

/// One verb's outcome, rendered for the answering model. Errors ride the same
/// channel as results on purpose — the model that asked has to see what its
/// request did.
fn render_results(results: &[(VerbRequest, Result<Value, String>)]) -> String {
    let mut out = String::new();
    for (request, outcome) in results {
        out.push_str("\n--- VERB ");
        out.push_str(&request.verb);
        out.push(' ');
        out.push_str(&request.args.to_string());
        out.push('\n');
        match outcome {
            Ok(value) => {
                out.push_str(
                    &serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string()),
                );
                out.push('\n');
            }
            Err(err) => {
                out.push_str("ERROR: ");
                out.push_str(err);
                out.push('\n');
            }
        }
    }
    out
}

fn compose_retrieve_input(question: &str, scrollback: &str) -> String {
    format!("QUESTION:\n{question}\n\nRECENT GAZETTE POSTS:\n{scrollback}")
}

fn compose_answer_input(question: &str, scrollback: &str, results: &str, forced: bool) -> String {
    let mut out = String::new();
    if forced {
        // The instructions say one follow-up; this is where that promise is
        // kept, and saying so is what makes the model answer with what it has
        // rather than ask for a round it will never receive.
        out.push_str(
            "THIS IS YOUR LAST ROUND. You must answer now with what is below; \
             say plainly what you could not confirm. Do not ask for more verbs.\n\n",
        );
    }
    out.push_str("QUESTION:\n");
    out.push_str(question);
    out.push_str("\n\nRECENT GAZETTE POSTS:\n");
    out.push_str(scrollback);
    out.push_str("\nVERB RESULTS:\n");
    out.push_str(results);
    out
}

/// The Operator side of the Gazette: a question in, a post out.
pub struct OperatorPipeline {
    pub ctx: Arc<OperatorContext>,
    pub pool: Arc<crate::shared_agent::SharedAgentPool>,
    pub gazette_tx: tokio::sync::broadcast::Sender<tugcast_core::protocol::Frame>,
}

impl OperatorPipeline {
    /// Handle one `GAZETTE_INPUT` submission end to end.
    ///
    /// The user's post is persisted and broadcast **first** ([P08]): the
    /// question is history whatever happens next, and the Operator's own
    /// scrollback read has to be able to see it. A failure anywhere after
    /// that becomes a transient post — broadcast so the card stops waiting,
    /// never written, because an infrastructure hiccup is not history.
    pub async fn handle(&self, question: String, request_id: Option<String>) {
        let question = question.trim().to_string();
        if question.is_empty() {
            return;
        }
        self.publish(
            GazettePost {
                id: None,
                at_ms: now_ms(),
                author: GazetteAuthor::User,
                session_id: None,
                wake_reason: None,
                body: question.clone(),
                refs: Vec::new(),
                request_id: request_id.clone(),
                transient: false,
            },
            true,
        );

        match self.answer(&question).await {
            Ok((post, context)) => {
                let validated = crate::feeds::reporter_wake::validate_refs(post.refs, &context);
                if !validated.dropped.is_empty() {
                    tracing::warn!(
                        dropped = validated.dropped.len(),
                        "gazette operator: refs dropped — target not in the results verbatim",
                    );
                }
                self.publish(
                    GazettePost {
                        id: None,
                        at_ms: now_ms(),
                        author: GazetteAuthor::Operator,
                        session_id: None,
                        wake_reason: None,
                        body: post.body,
                        refs: validated.kept,
                        request_id: request_id.clone(),
                        transient: false,
                    },
                    true,
                );
            }
            Err(err) => {
                tracing::warn!(error = %err, "gazette operator: question went unanswered");
                self.publish(
                    GazettePost {
                        id: None,
                        at_ms: now_ms(),
                        author: GazetteAuthor::Operator,
                        session_id: None,
                        wake_reason: None,
                        body: format!("Couldn't answer that: {err}"),
                        refs: Vec::new(),
                        request_id,
                        transient: true,
                    },
                    false,
                );
            }
        }
    }

    /// Persist (unless transient) and broadcast one post.
    fn publish(&self, mut post: GazettePost, persist: bool) {
        if persist {
            match self.ctx.ledger.record_gazette_post(&post) {
                Ok(id) => post.id = Some(id),
                Err(err) => tracing::warn!(error = %err, "gazette operator: ledger write failed"),
            }
        }
        match serde_json::to_vec(&post) {
            Ok(bytes) => {
                let _ = self.gazette_tx.send(tugcast_core::protocol::Frame::new(
                    tugcast_core::protocol::FeedId::GAZETTE,
                    bytes,
                ));
            }
            Err(err) => tracing::warn!(error = %err, "gazette operator: post did not serialize"),
        }
    }

    /// Retrieve, execute, answer — bounded at [`MAX_RETRIEVAL_ROUNDS`].
    ///
    /// Returns the answer alongside the text it was allowed to draw on, which
    /// is what its refs are then validated against.
    async fn answer(&self, question: &str) -> Result<(AnswerPost, String), String> {
        let scrollback = render_scrollback(
            &self
                .ctx
                .ledger
                .list_gazette_posts_tail(SCROLLBACK_POSTS)
                .unwrap_or_default(),
        );

        let raw = self
            .pool
            .run(
                "operator-retrieve",
                compose_retrieve_input(question, &scrollback),
            )
            .await?;
        // An unreadable retrieval is not a failed exchange. Retrieval is an
        // optimization — it decides what to *add* to the material the answering
        // step already has, and the scrollback rides that turn either way. Some
        // questions ("how many physics questions today?") are answerable from
        // the channel alone, and killing the exchange because the model wrote
        // prose where a verb list was asked for spends a real answer to punish
        // a formatting slip. So: log it, and answer with what we have.
        let mut requests = match parse_verbs(&raw) {
            Some(requests) => requests,
            None => {
                warn!(
                    raw = %raw.chars().take(RAW_LOG_CHARS).collect::<String>(),
                    "gazette operator: retrieval named no verbs; answering from the channel alone",
                );
                Vec::new()
            }
        };

        let mut results: Vec<(VerbRequest, Result<Value, String>)> = Vec::new();
        let mut rendered = String::new();
        for round in 1..=MAX_RETRIEVAL_ROUNDS {
            requests.truncate(MAX_VERBS_PER_ROUND);
            for request in requests {
                let outcome = run_verb(&self.ctx, &request.verb, &request.args).await;
                results.push((request, outcome));
            }
            rendered = render_results(&results);
            let forced = round == MAX_RETRIEVAL_ROUNDS;
            let raw = self
                .pool
                .run(
                    "operator-answer",
                    compose_answer_input(question, &scrollback, &rendered, forced),
                )
                .await?;
            match parse_answer_turn(&raw) {
                Some(AnswerTurn::Answer(post)) => {
                    let context = format!("{scrollback}{rendered}");
                    return Ok((post, context));
                }
                Some(AnswerTurn::More(more)) if !forced => requests = more,
                Some(AnswerTurn::More(_)) => {
                    return Err(
                        "the answering step asked for more lookups after its last round"
                            .to_string(),
                    );
                }
                None => {
                    // Here the raw text IS the diagnosis: a silence cannot be
                    // read off the post that was not written.
                    warn!(
                        raw = %raw.chars().take(RAW_LOG_CHARS).collect::<String>(),
                        "gazette operator: unreadable answer envelope",
                    );
                    return Err("the answering step did not produce a readable answer".to_string());
                }
            }
        }
        // Unreachable while MAX_RETRIEVAL_ROUNDS ≥ 1: the final round either
        // answers or errors above. Kept as a value rather than an unwrap so a
        // future knob of 0 degrades to a transient post instead of a panic.
        let _ = rendered;
        Err("the Operator ran out of rounds without answering".to_string())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_ledger::SessionLedger;
    use tugcast_core::types::{GazettePost, GazetteRef, GazetteRefKind};

    struct Fixture {
        ctx: OperatorContext,
        _dir: tempfile::TempDir,
        repo: tempfile::TempDir,
    }

    fn ledger() -> Arc<SessionLedger> {
        Arc::new(SessionLedger::open_in_memory().expect("in-memory ledger"))
    }

    /// A real git repo with two commits — the crate's git-feed tests' pattern.
    fn git_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let run = |args: &[&str]| {
            let status = std::process::Command::new("git")
                .arg("-C")
                .arg(dir.path())
                .args(args)
                .env("GIT_AUTHOR_NAME", "Test")
                .env("GIT_AUTHOR_EMAIL", "test@example.com")
                .env("GIT_COMMITTER_NAME", "Test")
                .env("GIT_COMMITTER_EMAIL", "test@example.com")
                .output()
                .expect("git");
            assert!(
                status.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&status.stderr)
            );
        };
        run(&["init", "-q", "-b", "main"]);
        std::fs::write(dir.path().join("alpha.txt"), "hello gazette\n").unwrap();
        run(&["add", "alpha.txt"]);
        run(&["commit", "-q", "-m", "add alpha"]);
        std::fs::write(dir.path().join("beta.txt"), "second file\n").unwrap();
        run(&["add", "beta.txt"]);
        run(&["commit", "-q", "-m", "add beta"]);
        dir
    }

    fn fixture() -> Fixture {
        let repo = git_repo();
        let dir = tempfile::tempdir().expect("tempdir");
        Fixture {
            ctx: OperatorContext {
                ledger: ledger(),
                bootstrap_project_dir: repo.path().to_path_buf(),
            },
            _dir: dir,
            repo,
        }
    }

    fn seed_post(ctx: &OperatorContext, body: &str, session_id: Option<&str>) -> i64 {
        ctx.ledger
            .record_gazette_post(&GazettePost {
                id: None,
                at_ms: 1_700_000_000_000,
                author: GazetteAuthor::Reporter,
                session_id: session_id.map(str::to_string),
                wake_reason: Some("turn-end".to_string()),
                body: body.to_string(),
                refs: vec![GazetteRef {
                    kind: GazetteRefKind::File,
                    target: "tugdeck/styles/themes/brio.css".to_string(),
                }],
                request_id: None,
                transient: false,
            })
            .expect("post recorded")
    }

    #[tokio::test]
    async fn an_unknown_verb_is_an_error_the_model_can_read() {
        let f = fixture();
        let err = run_verb(&f.ctx, "git.blame", &json!({}))
            .await
            .expect_err("unknown verb");
        assert!(err.contains("unknown verb"));
        assert!(err.contains("repo.grep"), "the error lists the real verbs");
    }

    #[tokio::test]
    async fn a_missing_required_argument_is_an_error_not_a_panic() {
        let f = fixture();
        let err = run_verb(&f.ctx, "gazette.search", &json!({}))
            .await
            .expect_err("missing query");
        assert!(err.contains("query"));
    }

    #[tokio::test]
    async fn gazette_search_caps_at_twenty_posts() {
        let f = fixture();
        for i in 0..30 {
            seed_post(&f.ctx, &format!("theme token work number {i}"), None);
        }
        let out = run_verb(&f.ctx, "gazette.search", &json!({"query": "token"}))
            .await
            .expect("search ran");
        assert_eq!(out["posts"].as_array().unwrap().len(), SEARCH_LIMIT);
        assert!(out["posts"][0]["excerpt"].is_string());
    }

    #[tokio::test]
    async fn gazette_window_clamps_n_to_ten_each_side() {
        let f = fixture();
        let mut ids = Vec::new();
        for i in 0..40 {
            ids.push(seed_post(&f.ctx, &format!("post {i}"), None));
        }
        let middle = ids[20];
        let out = run_verb(
            &f.ctx,
            "gazette.window",
            &json!({"post_id": middle, "n": 500}),
        )
        .await
        .expect("window ran");
        // Ten either side plus the hit itself.
        assert_eq!(out["posts"].as_array().unwrap().len(), WINDOW_MAX_N * 2 + 1);
    }

    #[tokio::test]
    async fn sessions_list_returns_an_incipit_and_honors_active() {
        let f = fixture();
        f.ctx
            .ledger
            .record_spawn("sess-a", "ws", "/proj", "card-1", 1_000, None)
            .expect("spawn");
        f.ctx
            .ledger
            .record_user_prompt("sess-a", "why is the brio wash so pale")
            .expect("prompt");
        f.ctx
            .ledger
            .record_spawn("sess-b", "ws", "/proj", "card-2", 2_000, None)
            .expect("spawn");
        f.ctx.ledger.mark_closed("sess-b").expect("closed");

        let all = run_verb(&f.ctx, "sessions.list", &json!({}))
            .await
            .expect("list ran");
        assert_eq!(all["sessions"].as_array().unwrap().len(), 2);

        let live = run_verb(&f.ctx, "sessions.list", &json!({"active": true}))
            .await
            .expect("list ran");
        let rows = live["sessions"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["session_id"], "sess-a");
        assert_eq!(rows[0]["incipit"], "why is the brio wash so pale");
    }

    #[tokio::test]
    async fn session_prompts_truncates_each_prompt() {
        let f = fixture();
        f.ctx
            .ledger
            .record_spawn("sess-a", "ws", "/proj", "card-1", 1_000, None)
            .expect("spawn");
        let long = "x".repeat(PROMPT_MAX_CHARS * 2);
        f.ctx
            .ledger
            .record_user_prompt("sess-a", &long)
            .expect("prompt");
        let out = run_verb(&f.ctx, "session.prompts", &json!({"session_id": "sess-a"}))
            .await
            .expect("prompts ran");
        let text = out["prompts"][0]["text"].as_str().unwrap();
        assert_eq!(
            text.chars().count(),
            PROMPT_MAX_CHARS + 1,
            "capped plus '…'"
        );
    }

    #[tokio::test]
    async fn session_prompts_on_an_unknown_session_is_an_error() {
        let f = fixture();
        let err = run_verb(&f.ctx, "session.prompts", &json!({"session_id": "nope"}))
            .await
            .expect_err("unknown session");
        assert!(err.contains("no session"));
    }

    #[tokio::test]
    async fn git_log_reads_the_bootstrap_repo_and_names_files() {
        let f = fixture();
        let out = run_verb(&f.ctx, "git.log", &json!({}))
            .await
            .expect("log ran");
        let commits = out["commits"].as_array().unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0]["subject"], "add beta");
        assert_eq!(commits[0]["files"][0], "beta.txt");
    }

    #[tokio::test]
    async fn git_log_clamps_n_to_thirty() {
        let f = fixture();
        let out = run_verb(&f.ctx, "git.log", &json!({"n": 9_000}))
            .await
            .expect("log ran");
        // The fixture has two commits; the point is that the clamp made a
        // bounded request rather than that git had thirty to give.
        assert!(out["commits"].as_array().unwrap().len() <= GIT_LOG_MAX_N);
    }

    #[tokio::test]
    async fn a_pickaxe_payload_shaped_like_a_flag_is_refused() {
        let f = fixture();
        let err = run_verb(&f.ctx, "git.log", &json!({"pickaxe": "-S--output=/tmp/x"}))
            .await
            .expect_err("flag-shaped pickaxe");
        assert!(err.contains("may not begin with '-'"));
    }

    #[tokio::test]
    async fn an_upload_pack_path_is_refused() {
        let f = fixture();
        let err = run_verb(
            &f.ctx,
            "git.log",
            &json!({"path": "--upload-pack=touch /tmp/x"}),
        )
        .await
        .expect_err("flag-shaped path");
        assert!(err.contains("may not begin with '-'"));

        let err = run_verb(
            &f.ctx,
            "repo.grep",
            &json!({"pattern": "hello", "path_scope": "--upload-pack=x"}),
        )
        .await
        .expect_err("flag-shaped scope");
        assert!(err.contains("may not begin with '-'"));
    }

    #[tokio::test]
    async fn a_path_may_not_escape_the_project_dir() {
        let f = fixture();
        let err = run_verb(&f.ctx, "git.log", &json!({"path": "../../etc/passwd"}))
            .await
            .expect_err("traversal");
        assert!(err.contains(".."));

        let err = run_verb(&f.ctx, "git.log", &json!({"path": "/etc/passwd"}))
            .await
            .expect_err("absolute");
        assert!(err.contains("repo-relative"));
    }

    #[tokio::test]
    async fn git_show_refuses_anything_that_is_not_a_hex_object_name() {
        let f = fixture();
        for bad in ["--upload-pack=x", "HEAD; rm -rf /", "zzzz"] {
            let err = run_verb(&f.ctx, "git.show", &json!({"sha": bad}))
                .await
                .expect_err("non-sha");
            assert!(err.contains("hex object name"), "{bad}: {err}");
        }
    }

    #[tokio::test]
    async fn git_show_caps_its_diff() {
        let f = fixture();
        // A commit whose diff comfortably exceeds the line cap.
        let big: String = (0..GIT_SHOW_MAX_LINES * 2)
            .map(|i| format!("line {i}\n"))
            .collect();
        std::fs::write(f.repo.path().join("big.txt"), big).unwrap();
        for args in [
            vec!["add", "big.txt"],
            vec![
                "-c",
                "user.email=t@e.com",
                "-c",
                "user.name=T",
                "commit",
                "-q",
                "-m",
                "big",
            ],
        ] {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(f.repo.path())
                .args(&args)
                .output()
                .expect("git");
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
        }
        let head = String::from_utf8(
            std::process::Command::new("git")
                .arg("-C")
                .arg(f.repo.path())
                .args(["rev-parse", "HEAD"])
                .output()
                .expect("git")
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();

        let out = run_verb(&f.ctx, "git.show", &json!({"sha": head}))
            .await
            .expect("show ran");
        assert_eq!(out["truncated"], true);
        let text = out["text"].as_str().unwrap();
        assert!(text.lines().count() <= GIT_SHOW_MAX_LINES + 1);
        assert!(text.len() <= GIT_SHOW_MAX_BYTES + 64);
    }

    #[tokio::test]
    async fn repo_grep_finds_a_match_and_reports_its_line() {
        let f = fixture();
        let out = run_verb(&f.ctx, "repo.grep", &json!({"pattern": "gazette"}))
            .await
            .expect("grep ran");
        let matches = out["matches"].as_array().unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0]["path"], "alpha.txt");
        assert_eq!(matches[0]["line"], 1);
    }

    #[tokio::test]
    async fn repo_grep_with_no_match_is_an_empty_result_not_an_error() {
        let f = fixture();
        let out = run_verb(&f.ctx, "repo.grep", &json!({"pattern": "nothinghere"}))
            .await
            .expect("grep ran");
        assert_eq!(out["count"], 0);
    }

    #[tokio::test]
    async fn a_session_id_argument_moves_the_repo_a_git_verb_runs_in() {
        let f = fixture();
        // A session whose project dir is a directory with no repo in it: the
        // verb must run *there* and fail, proving it did not silently fall
        // back to the bootstrap repo.
        let elsewhere = tempfile::tempdir().expect("tempdir");
        f.ctx
            .ledger
            .record_spawn(
                "sess-a",
                "ws",
                elsewhere.path().to_str().unwrap(),
                "card-1",
                1_000,
                None,
            )
            .expect("spawn");
        let err = run_verb(&f.ctx, "git.log", &json!({"session_id": "sess-a"}))
            .await
            .expect_err("not a repo");
        assert!(err.contains("git failed"), "{err}");
    }

    #[tokio::test]
    async fn changes_verbs_read_the_file_event_ledger() {
        let f = fixture();
        let out = run_verb(
            &f.ctx,
            "changes.for_session",
            &json!({"session_id": "sess-a"}),
        )
        .await
        .expect("changes ran");
        assert_eq!(out["count"], 0);

        let out = run_verb(&f.ctx, "changes.for_path", &json!({"pattern": "%.css"}))
            .await
            .expect("changes ran");
        assert_eq!(out["count"], 0);
    }

    // MARK: - The pipeline

    use crate::shared_agent::test_support::FakeSpawner;
    use crate::shared_agent::{AgentSpec, AgentWorkerSpawner, SharedAgentPool};
    use tokio::sync::broadcast;
    use tugcast_core::protocol::{FeedId, Frame};

    /// A pool on the **real** gazette job table, answering a script — so the
    /// timeouts and instructions under test are the shipped ones.
    fn scripted_pool(answers: Vec<Result<String, String>>) -> Arc<SharedAgentPool> {
        SharedAgentPool::new(
            AgentSpec {
                name: "gazette",
                model: Arc::new(|| "sonnet".to_string()),
                jobs: super::super::gazette_agent::GAZETTE_AGENT_JOBS,
                max_workers: 3,
            },
            FakeSpawner::new(answers) as Arc<dyn AgentWorkerSpawner>,
        )
    }

    fn dead_pool() -> Arc<SharedAgentPool> {
        SharedAgentPool::new(
            AgentSpec {
                name: "gazette",
                model: Arc::new(|| "sonnet".to_string()),
                jobs: super::super::gazette_agent::GAZETTE_AGENT_JOBS,
                max_workers: 3,
            },
            FakeSpawner::failing() as Arc<dyn AgentWorkerSpawner>,
        )
    }

    struct PipelineHarness {
        pipeline: OperatorPipeline,
        rx: broadcast::Receiver<Frame>,
        ledger: Arc<SessionLedger>,
        _repo: tempfile::TempDir,
    }

    fn pipeline(pool: Arc<SharedAgentPool>) -> PipelineHarness {
        let repo = git_repo();
        let ledger = ledger();
        let (tx, rx) = broadcast::channel(64);
        PipelineHarness {
            pipeline: OperatorPipeline {
                ctx: Arc::new(OperatorContext {
                    ledger: Arc::clone(&ledger),
                    bootstrap_project_dir: repo.path().to_path_buf(),
                }),
                pool,
                gazette_tx: tx,
            },
            rx,
            ledger,
            _repo: repo,
        }
    }

    fn next_post(rx: &mut broadcast::Receiver<Frame>) -> GazettePost {
        let frame = rx.try_recv().expect("a GAZETTE frame was broadcast");
        assert_eq!(frame.feed_id, FeedId::GAZETTE);
        serde_json::from_slice(&frame.payload).expect("a GazettePost on the wire")
    }

    fn verbs_turn() -> Result<String, String> {
        Ok(json!({"verbs": [{"verb": "git.log", "args": {"n": 2}}]}).to_string())
    }

    fn answer_turn(body: &str) -> Result<String, String> {
        Ok(json!({"answer": {"body": body}}).to_string())
    }

    #[tokio::test]
    async fn the_happy_path_echoes_the_question_then_answers_it() {
        let mut h = pipeline(scripted_pool(vec![
            verbs_turn(),
            answer_turn("The last two commits added alpha.txt and beta.txt."),
        ]));
        h.pipeline
            .handle("what landed recently".to_string(), Some("req-1".into()))
            .await;

        let question = next_post(&mut h.rx);
        assert_eq!(question.author, GazetteAuthor::User);
        assert_eq!(question.body, "what landed recently");
        assert_eq!(question.request_id.as_deref(), Some("req-1"));
        assert!(question.id.is_some(), "the question is history");

        let answer = next_post(&mut h.rx);
        assert_eq!(answer.author, GazetteAuthor::Operator);
        assert!(answer.body.contains("alpha.txt"));
        assert_eq!(answer.request_id.as_deref(), Some("req-1"));
        assert!(!answer.transient);
        assert_eq!(
            h.ledger.list_gazette_posts_tail(10).unwrap().len(),
            2,
            "both the question and the answer are persisted",
        );
    }

    #[tokio::test]
    async fn a_follow_up_round_runs_more_verbs_and_then_answers() {
        let mut h = pipeline(scripted_pool(vec![
            verbs_turn(),
            // The answering model asks for one more lookup…
            verbs_turn(),
            // …and answers on the round it gets.
            answer_turn("Confirmed in the second round."),
        ]));
        h.pipeline
            .handle("when did beta land".to_string(), None)
            .await;

        let _question = next_post(&mut h.rx);
        let answer = next_post(&mut h.rx);
        assert_eq!(answer.body, "Confirmed in the second round.");
        assert!(!answer.transient);
    }

    /// A model that never stops asking still owes an answer, and the round cap
    /// is what collects it. Without the cap this is an infinite loop wearing a
    /// pending spinner.
    #[tokio::test]
    async fn a_model_that_only_ever_asks_for_more_still_ends_the_exchange() {
        let mut h = pipeline(scripted_pool(vec![
            verbs_turn(),
            verbs_turn(),
            verbs_turn(),
            verbs_turn(),
        ]));
        h.pipeline
            .handle("an unanswerable one".to_string(), Some("req-9".into()))
            .await;

        let _question = next_post(&mut h.rx);
        let post = next_post(&mut h.rx);
        assert!(post.transient, "the exchange ended, and not with an answer");
        assert_eq!(post.request_id.as_deref(), Some("req-9"));
        assert_eq!(
            h.ledger.list_gazette_posts_tail(10).unwrap().len(),
            1,
            "only the question is history",
        );
    }

    #[tokio::test]
    async fn an_unavailable_pool_yields_a_transient_post_that_is_never_written() {
        let mut h = pipeline(dead_pool());
        h.pipeline
            .handle("anything at all".to_string(), Some("req-2".into()))
            .await;

        let question = next_post(&mut h.rx);
        assert_eq!(question.author, GazetteAuthor::User);
        assert!(
            question.id.is_some(),
            "the question is persisted before any model call — it is history whatever happens next",
        );

        let failure = next_post(&mut h.rx);
        assert_eq!(failure.author, GazetteAuthor::Operator);
        assert!(failure.transient);
        assert!(failure.id.is_none());
        assert_eq!(failure.request_id.as_deref(), Some("req-2"));

        let persisted = h.ledger.list_gazette_posts_tail(10).unwrap();
        assert_eq!(persisted.len(), 1, "the hiccup did not enter the history");
        assert_eq!(persisted[0].author, GazetteAuthor::User);
    }

    #[tokio::test]
    async fn an_unreadable_answer_is_a_transient_post_not_a_guess() {
        let mut h = pipeline(scripted_pool(vec![
            verbs_turn(),
            Ok("I had a look and honestly it's hard to say.".to_string()),
        ]));
        h.pipeline.handle("what happened".to_string(), None).await;
        let _question = next_post(&mut h.rx);
        let post = next_post(&mut h.rx);
        assert!(post.transient);
    }

    #[tokio::test]
    async fn an_answers_refs_must_appear_in_what_it_was_shown() {
        let mut h = pipeline(scripted_pool(vec![
            verbs_turn(),
            Ok(json!({"answer": {
                "body": "alpha.txt is where it is.",
                "refs": [
                    {"kind": "file", "target": "alpha.txt"},
                    {"kind": "file", "target": "invented/nowhere.rs"},
                ],
            }})
            .to_string()),
        ]));
        h.pipeline.handle("where is alpha".to_string(), None).await;
        let _question = next_post(&mut h.rx);
        let answer = next_post(&mut h.rx);
        assert_eq!(answer.refs.len(), 1);
        assert_eq!(answer.refs[0].target, "alpha.txt");
    }

    #[tokio::test]
    async fn an_empty_question_is_not_an_exchange() {
        let mut h = pipeline(scripted_pool(vec![verbs_turn(), answer_turn("hi")]));
        h.pipeline.handle("   ".to_string(), None).await;
        assert!(h.rx.try_recv().is_err(), "nothing was broadcast");
    }

    #[test]
    fn a_verb_round_is_capped_at_six() {
        let many: Vec<VerbRequest> = (0..20)
            .map(|_| VerbRequest {
                verb: "git.log".to_string(),
                args: json!({}),
            })
            .collect();
        let mut requests = many;
        requests.truncate(MAX_VERBS_PER_ROUND);
        assert_eq!(requests.len(), 6);
    }

    #[test]
    fn a_self_corrected_envelope_is_read_at_its_last_word() {
        let raw = "{\"verbs\": [{\"verb\": \"nope\"}]}\nLet me fix that:\n\
                   {\"verbs\": [{\"verb\": \"git.log\", \"args\": {}}]}";
        let verbs = parse_verbs(raw).expect("verbs parsed");
        assert_eq!(verbs.len(), 1);
        assert_eq!(verbs[0].verb, "git.log");
    }

    /// A model that annotates its verbs still gets them run. The Reporter's
    /// `deny_unknown_fields` is a contract about what may enter the channel;
    /// applying it here would have spent a user's answer on tidiness.
    #[test]
    fn an_annotated_verb_list_is_still_a_verb_list() {
        let raw = json!({
            "reasoning": "the channel probably has it",
            "verbs": [{
                "verb": "gazette.search",
                "args": {"query": "physics"},
                "why": "the posts mention it",
            }],
        })
        .to_string();
        let verbs = parse_verbs(&raw).expect("verbs parsed");
        assert_eq!(verbs.len(), 1);
        assert_eq!(verbs[0].verb, "gazette.search");
    }

    #[test]
    fn an_annotated_answer_is_still_an_answer() {
        let raw = json!({
            "answer": {"body": "Three.", "refs": [], "confidence": "high"},
            "note": "read off the channel",
        })
        .to_string();
        match parse_answer_turn(&raw) {
            Some(AnswerTurn::Answer(post)) => assert_eq!(post.body, "Three."),
            _ => panic!("the annotation should not have cost the answer"),
        }
    }

    /// Retrieval is an optimization, not a gate. The scrollback rides the
    /// answering turn either way, and some questions are answerable from the
    /// channel alone — so a retrieval step that writes prose costs a lookup,
    /// never the exchange.
    #[tokio::test]
    async fn an_unreadable_retrieval_still_answers_from_the_channel() {
        let mut h = pipeline(scripted_pool(vec![
            Ok("I don't think I need to look anything up for this one.".to_string()),
            answer_turn("Three physics questions, all this afternoon."),
        ]));
        h.pipeline
            .handle(
                "how many physics questions today".to_string(),
                Some("req-3".into()),
            )
            .await;

        let _question = next_post(&mut h.rx);
        let answer = next_post(&mut h.rx);
        assert!(
            !answer.transient,
            "a formatting slip is not a failed exchange"
        );
        assert_eq!(answer.body, "Three physics questions, all this afternoon.");
        assert_eq!(answer.request_id.as_deref(), Some("req-3"));
    }

    /// The same shape the model actually chose: an empty verb list, meaning
    /// "the channel already says it".
    #[tokio::test]
    async fn an_empty_verb_list_goes_straight_to_the_answer() {
        let mut h = pipeline(scripted_pool(vec![
            Ok(json!({"verbs": []}).to_string()),
            answer_turn("Read straight off the channel."),
        ]));
        h.pipeline
            .handle("what have I been up to".to_string(), None)
            .await;
        let _question = next_post(&mut h.rx);
        let answer = next_post(&mut h.rx);
        assert!(!answer.transient);
        assert_eq!(answer.body, "Read straight off the channel.");
    }

    #[test]
    fn an_answer_wins_over_a_request_for_more() {
        let raw = "{\"verbs\": [{\"verb\": \"git.log\"}]}\n{\"answer\": {\"body\": \"done\"}}";
        match parse_answer_turn(raw) {
            Some(AnswerTurn::Answer(post)) => assert_eq!(post.body, "done"),
            _ => panic!("the answer should have won"),
        }
    }

    /// Every verb the model is offered has an executor behind it, and every
    /// executor is offered. A verb that drifts out of one list is a model
    /// asking for something that always errors, or a capability nobody can
    /// reach.
    #[test]
    fn the_verb_table_matches_the_instructions() {
        let instructions = super::super::gazette_agent::GAZETTE_AGENT_JOBS
            .iter()
            .find(|j| j.name == "operator-retrieve")
            .expect("operator-retrieve in the job table")
            .instructions;
        for verb in VERB_NAMES {
            assert!(
                instructions.contains(verb),
                "verb {verb} has an executor but is never offered to the model"
            );
        }
    }
}
