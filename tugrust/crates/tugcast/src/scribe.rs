//! Scribe — the headless `claude -p` sidecar behind the changeset card's
//! maintained commit-message draft ([P21], #draft-engine).
//!
//! The maintained-draft engine composes a per-owner prompt (Spec S11 —
//! [`compose_draft_prompt_session`] / `_dash` / `_unattributed`, over the
//! scoped diff, file provenance, the owning session's prompts, and the
//! packaged commit-skill style rules) and runs `claude -p --output-format
//! stream-json --include-partial-messages --model <model>` once per changed
//! entry — no session ledger, no transcript, no resume, and the working
//! session is never disturbed. The model comes from the tugbank default
//! `dev.tugtool.changeset`/`scribe_model` (resolved in `main.rs`), falling
//! back to `sonnet` ([P22]).
//!
//! [`ScribeSpawner`] is the test seam (the `ChildSpawner` pattern —
//! `TugpulseSpawner` in `feeds/pulse.rs` is the sibling): tests drive
//! [`summarize_with`] with a fake spawner (scripting streamed deltas) and
//! never assert model prose. The production [`ClaudeScribeSpawner`] pipes the
//! prompt over stdin (a diff can exceed ARG_MAX), scrubs the Anthropic auth
//! env exactly like the other `claude` shells (via
//! `feeds::claude_auth::claude_command`), streams text deltas ([P24]), holds a
//! 120s timeout, and `kill_on_drop`s the child so a timeout reaps rather than
//! orphans.

use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::feeds::claude_auth::claude_command;

/// Hard ceiling on one scribe round trip. Sonnet on a large diff can take a
/// while; the fingerprint gate bounds how often we pay it ([P22]).
const SCRIBE_TIMEOUT: Duration = Duration::from_secs(120);

/// Live text deltas from a streaming scribe run: each send carries the
/// **accumulated** generation so far (idempotent against a dropped frame),
/// so the card can fill in live ([P24]). `None` means "don't stream".
pub type ScribeDeltas = Option<mpsc::UnboundedSender<String>>;

/// One-shot scribe run: `model` + composed `prompt` in, generated text out.
/// When `deltas` is `Some`, the accumulated generation is streamed as it
/// arrives ([P24]) — a nicety; the returned final text is the source of
/// truth. `Err` carries a human-readable detail (stderr tail, timeout, spawn
/// failure) for the card to surface.
pub trait ScribeSpawner: Send + Sync + 'static {
    fn run(
        &self,
        model: String,
        prompt: String,
        deltas: ScribeDeltas,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>>;
}

/// Production spawner: `claude -p --output-format stream-json
/// --include-partial-messages --verbose --model <model>`, prompt over stdin.
/// Partial `content_block_delta` text is accumulated and streamed over
/// `deltas`; the terminal `{"type":"result", …}` line's `result` is the
/// canonical full text.
pub struct ClaudeScribeSpawner;

impl ScribeSpawner for ClaudeScribeSpawner {
    fn run(
        &self,
        model: String,
        prompt: String,
        deltas: ScribeDeltas,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
        Box::pin(async move {
            let mut cmd = claude_command(&[
                "-p",
                "--output-format",
                "stream-json",
                "--include-partial-messages",
                "--verbose",
                "--model",
                &model,
            ]);
            cmd.stdin(std::process::Stdio::piped())
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
            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(prompt.as_bytes())
                    .await
                    .map_err(|e| e.to_string())?;
                drop(stdin);
            }
            let stdout = child.stdout.take().ok_or("scribe: no stdout")?;
            let stderr = child.stderr.take();

            // Read + parse the stream-json lines, then reap the child, all
            // under the one timeout.
            let run = async move {
                let mut lines = BufReader::new(stdout).lines();
                let mut acc = String::new();
                let mut final_text: Option<String> = None;
                while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    match value.get("type").and_then(|t| t.as_str()) {
                        Some("stream_event") => {
                            if let Some(text) = value
                                .get("event")
                                .and_then(|e| e.get("delta"))
                                .and_then(|d| d.get("text"))
                                .and_then(|t| t.as_str())
                            {
                                acc.push_str(text);
                                if let Some(tx) = &deltas {
                                    let _ = tx.send(acc.clone());
                                }
                            }
                        }
                        Some("result") => {
                            if let Some(result) = value.get("result").and_then(|r| r.as_str()) {
                                final_text = Some(result.to_string());
                            }
                        }
                        _ => {}
                    }
                }
                let status = child.wait().await.map_err(|e| e.to_string())?;
                Ok::<_, String>((status, final_text.unwrap_or(acc)))
            };

            let (status, text) = tokio::time::timeout(SCRIBE_TIMEOUT, run)
                .await
                .map_err(|_| "scribe timed out".to_string())??;

            if status.success() {
                Ok(text)
            } else {
                let detail = match stderr {
                    Some(mut e) => {
                        let mut buf = String::new();
                        let _ = tokio::io::AsyncReadExt::read_to_string(&mut e, &mut buf).await;
                        buf.trim()
                            .lines()
                            .last()
                            .filter(|l| !l.is_empty())
                            .unwrap_or("scribe run failed")
                            .to_string()
                    }
                    None => "scribe run failed".to_string(),
                };
                Err(detail)
            }
        })
    }
}

/// Run one scribe request through `spawner`, normalizing the result: output
/// is trimmed, and an empty generation is an error (the card should never
/// paste an empty draft). When `deltas` is `Some`, live text is streamed as
/// it arrives ([P24]).
pub async fn summarize_with(
    spawner: &Arc<dyn ScribeSpawner>,
    model: String,
    prompt: String,
    deltas: ScribeDeltas,
) -> Result<String, String> {
    let text = spawner.run(model, prompt, deltas).await?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("scribe returned no text".to_string());
    }
    Ok(trimmed.to_string())
}

// ---------------------------------------------------------------------------
// Maintained-draft prompt composition (Spec S11)
// ---------------------------------------------------------------------------

/// Scoped diffs beyond this many chars are truncated with a marker — a large
/// changeset still fits the model context, and the fingerprint gate already
/// bounds how often we regenerate.
const DIFF_TRUNCATE_CHARS: usize = 150_000;

/// The ask that opens every draft prompt: produce a commit message in the
/// project's voice, embedding the packaged commit-skill style rules.
fn draft_ask(style_rules: &str) -> String {
    format!(
        "You are maintaining the commit message for an in-progress changeset. \
         Write ONE conventional commit message — a short imperative subject \
         line, then (only if the change warrants it) a blank line and terse \
         bullet points. The subject MUST follow the house scoped format \
         `scope(topic): specific summary` (e.g. `tugdash(changesets-m03b): …`, \
         `plan(update): …`) — scoped and specific, NEVER a bare one-word subject \
         like `Fix`. Output only the commit message text, nothing else.\n\n\
         Follow these project style rules:\n{}\n",
        style_rules.trim()
    )
}

fn truncate_diff(diff: &str) -> String {
    if diff.chars().count() <= DIFF_TRUNCATE_CHARS {
        return diff.to_string();
    }
    let mut out: String = diff.chars().take(DIFF_TRUNCATE_CHARS).collect();
    out.push_str("\n[diff truncated]");
    out
}

fn push_voice_section(prompt: &mut String, git_subjects: &[String]) {
    if git_subjects.is_empty() {
        return;
    }
    prompt.push_str("\n\nRecent commit subjects (match this voice):\n");
    for subject in git_subjects {
        prompt.push_str("- ");
        prompt.push_str(subject);
        prompt.push('\n');
    }
}

fn push_diff_section(prompt: &mut String, diff: &str) {
    prompt.push_str("\n\nThe diff:\n\n");
    if diff.trim().is_empty() {
        prompt.push_str("(no textual diff — new/untracked files only)");
    } else {
        prompt.push_str(&truncate_diff(diff));
    }
}

/// Compose the draft prompt for a **session** entry (Spec S11): diff + file
/// list with provenance + the owning session's user prompts since the
/// changeset began + recent commit subjects for voice.
pub fn compose_draft_prompt_session(
    style_rules: &str,
    files: &[(String, String, String)],
    user_prompts: &[String],
    git_subjects: &[String],
    diff: &str,
) -> String {
    let mut prompt = draft_ask(style_rules);
    if !files.is_empty() {
        prompt.push_str("\nFiles in this changeset:\n");
        for (path, op, origin) in files {
            prompt.push_str(&format!("- {path} ({op} · {origin})\n"));
        }
    }
    if !user_prompts.is_empty() {
        prompt.push_str("\nWhat the user asked for (their prompts since this changeset began):\n");
        for p in user_prompts {
            prompt.push_str("- ");
            prompt.push_str(p);
            prompt.push('\n');
        }
    }
    push_voice_section(&mut prompt, git_subjects);
    push_diff_section(&mut prompt, diff);
    prompt
}

/// Compose the draft prompt for a **dash** entry (Spec S11, [P23]). This is
/// the dash's eventual squash/join message: round subjects/bodies from
/// `git log base..branch`, the dash-log's per-round instruction metadata,
/// the merge-base diff, and recent commit subjects for voice.
pub fn compose_draft_prompt_dash(
    style_rules: &str,
    git_log: &str,
    dash_log_lines: &[String],
    git_subjects: &[String],
    diff: &str,
) -> String {
    let mut prompt = draft_ask(style_rules);
    prompt.push_str(
        "\nThis changeset is a dash worktree; the message you write is its \
         eventual squash/join commit message summarizing all its rounds.\n",
    );
    if !git_log.trim().is_empty() {
        prompt.push_str("\nCommits on the dash branch (base..branch):\n");
        prompt.push_str(git_log.trim());
        prompt.push('\n');
    }
    if !dash_log_lines.is_empty() {
        prompt.push_str("\nPer-round instructions (dash log):\n");
        for line in dash_log_lines {
            prompt.push_str("- ");
            prompt.push_str(line);
            prompt.push('\n');
        }
    }
    push_voice_section(&mut prompt, git_subjects);
    push_diff_section(&mut prompt, diff);
    prompt
}

/// Compose the draft prompt for an **unattributed** entry (Spec S11): diff +
/// file list + voice only — no session context (no owning session).
pub fn compose_draft_prompt_unattributed(
    style_rules: &str,
    files: &[(String, String, String)],
    git_subjects: &[String],
    diff: &str,
) -> String {
    let mut prompt = draft_ask(style_rules);
    if !files.is_empty() {
        prompt.push_str("\nUnattributed changed files:\n");
        for (path, op, origin) in files {
            prompt.push_str(&format!("- {path} ({op} · {origin})\n"));
        }
    }
    push_voice_section(&mut prompt, git_subjects);
    push_diff_section(&mut prompt, diff);
    prompt
}

// ---------------------------------------------------------------------------
// AI file-merge prompt ([P32])
// ---------------------------------------------------------------------------

/// A conflicted file's three versions each truncate here — a giant file still
/// fits the model context.
const MERGE_VERSION_TRUNCATE_CHARS: usize = 60_000;

fn merge_version(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    if text.chars().count() <= MERGE_VERSION_TRUNCATE_CHARS {
        return text.into_owned();
    }
    let mut out: String = text.chars().take(MERGE_VERSION_TRUNCATE_CHARS).collect();
    out.push_str("\n[truncated]");
    out
}

/// Compose the AI file-merge prompt ([P32]): the three versions of one
/// conflicted file (BASE ancestor / OURS target branch / THEIRS incoming dash)
/// plus the dash's intent, asking for the merged body with **no conflict
/// markers** and no surrounding prose or fences. The ladder validates the reply
/// is marker-free before accepting it — a bad reply just leaves the file
/// unresolved.
pub fn compose_file_merge_prompt(
    path: &str,
    base: Option<&[u8]>,
    ours: &[u8],
    theirs: &[u8],
    intent: &str,
) -> String {
    let mut p = format!(
        "You are resolving a git merge conflict in the file `{path}`. Below are \
         three versions: the common ancestor (BASE), the target branch's version \
         (OURS), and the incoming dash's version (THEIRS). Produce the correctly \
         merged file that preserves BOTH sides' intent.\n\n\
         Output ONLY the full merged file content — no explanation, no markdown \
         code fences, and ABSOLUTELY NO conflict markers (`<<<<<<<`, `=======`, \
         `|||||||`, `>>>>>>>`). If you cannot merge the two safely, output nothing.\n"
    );
    if !intent.trim().is_empty() {
        p.push_str("\nWhat the dash was doing (intent):\n");
        p.push_str(intent.trim());
        p.push('\n');
    }
    p.push_str("\n===== BASE =====\n");
    p.push_str(&merge_version(
        base.unwrap_or(b"(file did not exist in the ancestor)"),
    ));
    p.push_str("\n===== OURS =====\n");
    p.push_str(&merge_version(ours));
    p.push_str("\n===== THEIRS =====\n");
    p.push_str(&merge_version(theirs));
    p.push('\n');
    p
}

// ---------------------------------------------------------------------------
// Fingerprints (Spec S11 / [P22])
// ---------------------------------------------------------------------------

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// Fingerprint a session/unattributed entry: sorted `(path, git_status)`
/// pairs, then the scoped diff, then per-untracked-file `(path, size,
/// mtime_ms)` (untracked content is invisible to `git diff HEAD`).
pub fn fingerprint_head_entry(
    files: &[(String, String)],
    diff: &str,
    untracked: &[(String, u64, i64)],
) -> String {
    let mut hasher = Sha256::new();
    let mut sorted_files = files.to_vec();
    sorted_files.sort();
    for (path, status) in &sorted_files {
        hasher.update(path.as_bytes());
        hasher.update([0]);
        hasher.update(status.as_bytes());
        hasher.update([0]);
    }
    hasher.update([1]);
    hasher.update(diff.as_bytes());
    hasher.update([2]);
    let mut sorted_untracked = untracked.to_vec();
    sorted_untracked.sort();
    for (path, size, mtime) in &sorted_untracked {
        hasher.update(path.as_bytes());
        hasher.update(size.to_le_bytes());
        hasher.update(mtime.to_le_bytes());
    }
    hex(hasher.finalize())
}

/// Fingerprint a dash entry: branch head sha + the worktree's porcelain
/// status (empty when no worktree).
pub fn fingerprint_dash_entry(branch_head_sha: &str, worktree_status: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(branch_head_sha.as_bytes());
    hasher.update([0]);
    hasher.update(worktree_status.as_bytes());
    hex(hasher.finalize())
}

// ---------------------------------------------------------------------------
// Commit-skill style rules
// ---------------------------------------------------------------------------

/// Baked fallback style rules — used when the packaged commit skill can't be
/// read or its expected sections are absent. Mirrors the skill's contract.
const BAKED_STYLE_RULES: &str = "\
- First line: imperative mood, no period, under 50 characters.
- Subject uses the house scoped format `scope(topic): specific summary` (e.g. \
`tugdash(changesets-m03b): …`, `plan(update): …`) — scoped and specific, never a \
bare one-word subject like `Fix`.
- Then, only if warranted, a blank line and terse factual bullet points.
- No buzzwords, no filler, no \"enhanced\"/\"improved\" without specifics.
- List only the most significant files if many changed.
- NEVER include Co-Authored-By lines or any AI/agent attribution.";

/// The commit-message style rules read from the packaged commit skill
/// (`tugplug/skills/commit/SKILL.md`), falling back to [`BAKED_STYLE_RULES`]
/// when the file or its sections are missing.
pub fn commit_style_rules() -> String {
    let path = crate::resources::source_tree().join("tugplug/skills/commit/SKILL.md");
    match std::fs::read_to_string(&path) {
        Ok(text) => extract_style_rules(&text).unwrap_or_else(|| BAKED_STYLE_RULES.to_string()),
        Err(_) => BAKED_STYLE_RULES.to_string(),
    }
}

/// Extract the message-format contract from the commit skill markdown: the
/// "Compose the Commit Message" section plus the two "Examples" sections.
fn extract_style_rules(md: &str) -> Option<String> {
    let compose = md.find("**Compose the Commit Message**")?;
    let stage = md[compose..]
        .find("**Stage and Commit**")
        .map(|i| compose + i)?;
    let compose_section = md[compose..stage].trim();

    let examples = md.find("## Examples of Good Commit Messages")?;
    let examples_end = md[examples..]
        .find("## If Uncertain")
        .map(|i| examples + i)
        .unwrap_or(md.len());
    let examples_section = md[examples..examples_end].trim();

    Some(format!("{compose_section}\n\n{examples_section}"))
}

// ---------------------------------------------------------------------------
// Session prompt extraction (Spec S11)
// ---------------------------------------------------------------------------

/// The owning session's genuine user prompts at or after `since_ms`, read
/// from its claude session JSONL, newest-last, capped to `max_prompts` and
/// `max_chars` each. Reuses the `external_sessions` submission classifier so
/// tool-results, interrupts, and scaffolding lines are excluded. Missing /
/// unreadable file → empty (the caller degrades to diff + conventions).
pub fn session_prompts_since(
    jsonl_path: &Path,
    since_ms: i64,
    max_prompts: usize,
    max_chars: usize,
) -> Vec<String> {
    let Ok(content) = std::fs::read_to_string(jsonl_path) else {
        return Vec::new();
    };
    let mut prompts = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        if let Some(ts) = value
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(crate::external_sessions::parse_timestamp_millis)
        {
            if ts < since_ms {
                continue;
            }
        }
        let is_meta = value
            .get("isMeta")
            .and_then(|b| b.as_bool())
            .unwrap_or(false);
        let is_compact = value
            .get("isCompactSummary")
            .and_then(|b| b.as_bool())
            .unwrap_or(false);
        let has_perm = value
            .get("permissionMode")
            .map(|p| !p.is_null())
            .unwrap_or(false);
        let Some(msg_content) = value.get("message").and_then(|m| m.get("content")) else {
            continue;
        };
        let (counts, is_wake) = crate::external_sessions::user_submission_opens_turn(
            is_meta,
            is_compact,
            has_perm,
            msg_content,
        );
        if !counts || is_wake {
            continue;
        }
        let text = crate::external_sessions::submission_text(msg_content);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        prompts.push(text.chars().take(max_chars).collect::<String>());
    }
    if prompts.len() > max_prompts {
        prompts = prompts.split_off(prompts.len() - max_prompts);
    }
    prompts
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake spawner: records the request, optionally scripts streamed deltas,
    /// returns a canned result.
    struct FakeSpawner {
        result: Result<String, String>,
        /// Accumulated-text frames to emit over the delta channel, in order.
        scripted_deltas: Vec<String>,
        seen: std::sync::Mutex<Vec<(String, String)>>,
    }

    impl FakeSpawner {
        fn new(result: Result<String, String>) -> Arc<Self> {
            Arc::new(Self {
                result,
                scripted_deltas: Vec::new(),
                seen: std::sync::Mutex::new(Vec::new()),
            })
        }
        fn with_deltas(result: Result<String, String>, deltas: Vec<String>) -> Arc<Self> {
            Arc::new(Self {
                result,
                scripted_deltas: deltas,
                seen: std::sync::Mutex::new(Vec::new()),
            })
        }
    }

    impl ScribeSpawner for FakeSpawner {
        fn run(
            &self,
            model: String,
            prompt: String,
            deltas: ScribeDeltas,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
            self.seen.lock().unwrap().push((model, prompt));
            if let Some(tx) = &deltas {
                for frame in &self.scripted_deltas {
                    let _ = tx.send(frame.clone());
                }
            }
            let result = self.result.clone();
            Box::pin(async move { result })
        }
    }

    #[tokio::test]
    async fn summarize_with_trims_success_and_passes_model_and_prompt() {
        let fake = FakeSpawner::new(Ok("  a tidy summary \n".to_string()));
        let spawner: Arc<dyn ScribeSpawner> = fake.clone();
        let text = summarize_with(&spawner, "sonnet".into(), "the prompt".into(), None)
            .await
            .expect("success");
        assert_eq!(text, "a tidy summary");
        let seen = fake.seen.lock().unwrap();
        assert_eq!(
            seen.as_slice(),
            [("sonnet".to_string(), "the prompt".to_string())]
        );
    }

    #[tokio::test]
    async fn summarize_with_streams_accumulated_deltas_then_final_text() {
        let fake = FakeSpawner::with_deltas(
            Ok("Add the widget".to_string()),
            vec![
                "Add".to_string(),
                "Add the".to_string(),
                "Add the widget".to_string(),
            ],
        );
        let spawner: Arc<dyn ScribeSpawner> = fake;
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let text = summarize_with(&spawner, "sonnet".into(), "p".into(), Some(tx))
            .await
            .expect("success");
        assert_eq!(text, "Add the widget");
        let mut frames = Vec::new();
        while let Ok(frame) = rx.try_recv() {
            frames.push(frame);
        }
        assert_eq!(frames, ["Add", "Add the", "Add the widget"]);
    }

    #[tokio::test]
    async fn summarize_with_propagates_spawner_errors() {
        let fake = FakeSpawner::new(Err("scribe timed out".to_string()));
        let spawner: Arc<dyn ScribeSpawner> = fake;
        let err = summarize_with(&spawner, "sonnet".into(), "p".into(), None)
            .await
            .expect_err("error propagates");
        assert_eq!(err, "scribe timed out");
    }

    #[tokio::test]
    async fn summarize_with_rejects_empty_generation() {
        let fake = FakeSpawner::new(Ok("   \n".to_string()));
        let spawner: Arc<dyn ScribeSpawner> = fake;
        let err = summarize_with(&spawner, "sonnet".into(), "p".into(), None)
            .await
            .expect_err("empty output is an error");
        assert!(err.contains("no text"), "{err}");
    }

    #[test]
    fn draft_prompt_composers_carry_the_right_sections_per_owner_kind() {
        let style = "- imperative subject";
        let files = [("a.rs".to_string(), "edit".to_string(), "exact".to_string())];
        let prompts = ["fix the parser".to_string()];
        let subjects = ["prior subject".to_string()];

        // The house scoped-subject rule ([P30]) reaches every per-owner-kind
        // prompt through `draft_ask` — never a bare one-word subject.
        let scoped_rule = "scope(topic): specific summary";

        let session = compose_draft_prompt_session(style, &files, &prompts, &subjects, "DIFF");
        assert!(
            session.contains("imperative subject"),
            "style rules present"
        );
        assert!(
            session.contains(scoped_rule),
            "scoped-subject rule in session prompt"
        );
        assert!(
            session.contains("fix the parser"),
            "session prompts present"
        );
        assert!(session.contains("a.rs (edit · exact)"));
        assert!(session.contains("prior subject"));
        assert!(session.trim_end().ends_with("DIFF"));

        let dash = compose_draft_prompt_dash(
            style,
            "abc123 round one",
            &["round one instruction".to_string()],
            &subjects,
            "DIFF",
        );
        assert!(dash.contains("squash/join commit message"));
        assert!(
            dash.contains(scoped_rule),
            "scoped-subject rule in dash prompt"
        );
        assert!(
            dash.contains("round one instruction"),
            "dash-log lines present"
        );
        assert!(!dash.contains("prompts since this changeset began"));

        let unattributed = compose_draft_prompt_unattributed(style, &files, &subjects, "DIFF");
        assert!(unattributed.contains("Unattributed changed files"));
        assert!(
            unattributed.contains(scoped_rule),
            "scoped-subject rule in unattributed prompt"
        );
        assert!(!unattributed.contains("prompts since this changeset began"));
    }

    #[test]
    fn file_merge_prompt_carries_versions_intent_and_no_marker_rule() {
        let p = compose_file_merge_prompt(
            "src/parser.rs",
            Some(b"BASE-BODY"),
            b"OURS-BODY",
            b"THEIRS-BODY",
            "rewrite the tokenizer",
        );
        assert!(p.contains("src/parser.rs"), "names the file");
        assert!(p.contains("BASE-BODY") && p.contains("OURS-BODY") && p.contains("THEIRS-BODY"));
        assert!(p.contains("rewrite the tokenizer"), "carries intent");
        // The instruction enumerates the markers to avoid.
        assert!(p.contains("<<<<<<<") && p.contains(">>>>>>>"));
        assert!(p.contains("NO conflict markers"));

        // An add/add conflict (no ancestor) still composes.
        let no_base = compose_file_merge_prompt("f", None, b"O", b"T", "");
        assert!(no_base.contains("did not exist"));
    }

    #[test]
    fn fingerprints_are_stable_and_content_sensitive() {
        let files = [("a.rs".to_string(), "M".to_string())];
        let untracked = [("new.txt".to_string(), 10u64, 1_700i64)];
        let fp = fingerprint_head_entry(&files, "DIFF", &untracked);
        assert_eq!(
            fp,
            fingerprint_head_entry(&files, "DIFF", &untracked),
            "stable"
        );
        // Order of the input files must not matter (sorted internally).
        let files_rev = [
            ("b.rs".to_string(), "M".to_string()),
            ("a.rs".to_string(), "M".to_string()),
        ];
        let files_fwd = [
            ("a.rs".to_string(), "M".to_string()),
            ("b.rs".to_string(), "M".to_string()),
        ];
        assert_eq!(
            fingerprint_head_entry(&files_rev, "D", &[]),
            fingerprint_head_entry(&files_fwd, "D", &[]),
        );
        // A changed untracked size flips the fingerprint.
        let untracked2 = [("new.txt".to_string(), 11u64, 1_700i64)];
        assert_ne!(fp, fingerprint_head_entry(&files, "DIFF", &untracked2));
        // Dash fingerprint reacts to head sha and worktree dirt.
        assert_ne!(
            fingerprint_dash_entry("sha1", ""),
            fingerprint_dash_entry("sha2", ""),
        );
        assert_ne!(
            fingerprint_dash_entry("sha1", ""),
            fingerprint_dash_entry("sha1", " M x.rs"),
        );
    }

    #[test]
    fn commit_style_rules_extracts_from_the_packaged_skill_or_falls_back() {
        // In debug/tests, `source_tree()` resolves the tugtool root, which
        // ships the commit skill — so extraction should find the sections.
        let rules = commit_style_rules();
        assert!(!rules.is_empty());
        assert!(
            rules.contains("imperative") || rules.contains("Co-Authored-By"),
            "carries the message-style contract: {rules}"
        );
    }
}
