//! Scribe — the headless one-shot `claude -p` sidecar behind the changeset
//! card's "Summarize" / "Draft message" actions ([P11]).
//!
//! tugcast composes a prompt (the entry's scoped diff plus whatever owner
//! context the ledger holds) and runs `claude -p --output-format text
//! --model <model>` once per request — no session ledger, no transcript, no
//! resume, and the working session is never disturbed. The model comes from
//! the tugbank default `dev.tugtool.changeset`/`scribe_model` (resolved by a
//! closure built in `main.rs`), falling back to `haiku`.
//!
//! [`ScribeSpawner`] is the test seam (the `ChildSpawner` pattern —
//! `TugpulseSpawner` in `feeds/pulse.rs` is the sibling): tests drive
//! [`summarize_with`] and [`compose_scribe_prompt`] with a fake spawner and
//! never assert model prose. The production [`ClaudeScribeSpawner`] pipes the
//! prompt over stdin (a diff can exceed ARG_MAX), scrubs the Anthropic auth
//! env exactly like the other `claude` shells (via
//! `feeds::claude_auth::claude_command`), holds a 60s timeout, and
//! `kill_on_drop`s the child so a timeout reaps rather than orphans.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

use crate::feeds::claude_auth::claude_command;

/// Hard ceiling on one scribe round trip.
const SCRIBE_TIMEOUT: Duration = Duration::from_secs(60);

/// What the scribe is asked to produce (Spec S03 `kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScribeKind {
    /// A short prose summary of the changeset.
    Summary,
    /// A conventional one-line-subject commit message.
    CommitMessage,
}

impl ScribeKind {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "summary" => Some(Self::Summary),
            "commit_message" => Some(Self::CommitMessage),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Summary => "summary",
            Self::CommitMessage => "commit_message",
        }
    }
}

/// One-shot scribe run: `model` + composed `prompt` in, generated text out.
/// `Err` carries a human-readable detail (stderr tail, timeout, spawn
/// failure) for the card to surface.
pub trait ScribeSpawner: Send + Sync + 'static {
    fn run(
        &self,
        model: String,
        prompt: String,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>>;
}

/// Production spawner: `claude -p --output-format text --model <model>`,
/// prompt over stdin.
pub struct ClaudeScribeSpawner;

impl ScribeSpawner for ClaudeScribeSpawner {
    fn run(
        &self,
        model: String,
        prompt: String,
    ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
        Box::pin(async move {
            let mut cmd = claude_command(&["-p", "--output-format", "text", "--model", &model]);
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
            let output = tokio::time::timeout(SCRIBE_TIMEOUT, child.wait_with_output())
                .await
                .map_err(|_| "scribe timed out".to_string())?
                .map_err(|e| e.to_string())?;
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).into_owned())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(stderr
                    .trim()
                    .lines()
                    .last()
                    .filter(|l| !l.is_empty())
                    .unwrap_or("scribe run failed")
                    .to_string())
            }
        })
    }
}

/// Compose the scribe prompt: the ask (by `kind`), the owner context lines
/// (session name / last prompt — whatever the ledger holds), then the scoped
/// diff. Pure, so tests pin the shape without a subprocess.
pub fn compose_scribe_prompt(kind: ScribeKind, context_lines: &[String], diff: &str) -> String {
    let ask = match kind {
        ScribeKind::Summary => {
            "Summarize the following uncommitted change in 2-4 plain sentences. \
             Describe what changed and why it matters. Output only the summary text."
        }
        ScribeKind::CommitMessage => {
            "Write a git commit message for the following uncommitted change: one \
             short imperative subject line (max 72 chars), then, only if the change \
             warrants it, a blank line and terse bullet points. Output only the \
             commit message text."
        }
    };
    let mut prompt = String::from(ask);
    if !context_lines.is_empty() {
        prompt.push_str("\n\nContext from the working session:\n");
        for line in context_lines {
            prompt.push_str("- ");
            prompt.push_str(line);
            prompt.push('\n');
        }
    }
    prompt.push_str("\n\nThe diff:\n\n");
    prompt.push_str(diff);
    prompt
}

/// Run one scribe request through `spawner`, normalizing the result: output
/// is trimmed, and an empty generation is an error (the card should never
/// paste an empty draft).
pub async fn summarize_with(
    spawner: &Arc<dyn ScribeSpawner>,
    model: String,
    prompt: String,
) -> Result<String, String> {
    let text = spawner.run(model, prompt).await?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("scribe returned no text".to_string());
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake spawner: records the request, returns a canned result.
    struct FakeSpawner {
        result: Result<String, String>,
        seen: std::sync::Mutex<Vec<(String, String)>>,
    }

    impl FakeSpawner {
        fn new(result: Result<String, String>) -> Arc<Self> {
            Arc::new(Self {
                result,
                seen: std::sync::Mutex::new(Vec::new()),
            })
        }
    }

    impl ScribeSpawner for FakeSpawner {
        fn run(
            &self,
            model: String,
            prompt: String,
        ) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>> {
            self.seen.lock().unwrap().push((model, prompt));
            let result = self.result.clone();
            Box::pin(async move { result })
        }
    }

    #[tokio::test]
    async fn summarize_with_trims_success_and_passes_model_and_prompt() {
        let fake = FakeSpawner::new(Ok("  a tidy summary \n".to_string()));
        let spawner: Arc<dyn ScribeSpawner> = fake.clone();
        let text = summarize_with(&spawner, "haiku".into(), "the prompt".into())
            .await
            .expect("success");
        assert_eq!(text, "a tidy summary");
        let seen = fake.seen.lock().unwrap();
        assert_eq!(seen.as_slice(), [("haiku".to_string(), "the prompt".to_string())]);
    }

    #[tokio::test]
    async fn summarize_with_propagates_spawner_errors() {
        let fake = FakeSpawner::new(Err("scribe timed out".to_string()));
        let spawner: Arc<dyn ScribeSpawner> = fake;
        let err = summarize_with(&spawner, "haiku".into(), "p".into())
            .await
            .expect_err("error propagates");
        assert_eq!(err, "scribe timed out");
    }

    #[tokio::test]
    async fn summarize_with_rejects_empty_generation() {
        let fake = FakeSpawner::new(Ok("   \n".to_string()));
        let spawner: Arc<dyn ScribeSpawner> = fake;
        let err = summarize_with(&spawner, "haiku".into(), "p".into())
            .await
            .expect_err("empty output is an error");
        assert!(err.contains("no text"), "{err}");
    }

    #[test]
    fn compose_scribe_prompt_carries_kind_context_and_diff() {
        let context = ["session: fix the parser".to_string()];
        let summary = compose_scribe_prompt(ScribeKind::Summary, &context, "DIFF-BODY");
        assert!(summary.contains("Summarize"));
        assert!(summary.contains("fix the parser"));
        assert!(summary.ends_with("DIFF-BODY"));

        let message = compose_scribe_prompt(ScribeKind::CommitMessage, &[], "DIFF-BODY");
        assert!(message.contains("commit message"));
        assert!(!message.contains("Context from the working session"));
        assert!(message.ends_with("DIFF-BODY"));
    }
}
