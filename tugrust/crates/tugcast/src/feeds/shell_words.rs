//! Per-session shell word tables: the orchestration around `tuggram::words`.
//!
//! The reading itself — spawning a shell, folding a dump, parsing a printed
//! body — lives in `tuggram`, next to the grader that consumes it, so the eval
//! harness and the app read reality through exactly one expression of it. What
//! lives here is everything asynchronous and stateful about doing that for a
//! live session: which session owns which table, when it is refreshed, and
//! keeping the blocking shell spawns off the dispatcher.
//!
//! A table is per session because it is read from the session's own project
//! directory, and rc files branch on where they are standing.

use std::path::Path;
use std::sync::Arc;

use tokio::sync::Mutex;
use tracing::warn;

/// One session's view of what its shell will resolve.
#[derive(Clone, Default)]
pub struct SessionWords(Arc<Mutex<tuggram::ShellWords>>);

impl SessionWords {
    /// Re-read the whole table from a fresh interactive-login shell standing in
    /// `cwd`, returning the member names for the deck.
    ///
    /// A dump that fails leaves the table empty, which is the pre-interrogation
    /// behavior: every word falls through to PATH and the static builtins.
    pub async fn refresh(&self, cwd: Option<&Path>) -> Vec<String> {
        let cwd = cwd.map(|c| c.to_path_buf());
        let dumped =
            tokio::task::spawn_blocking(move || tuggram::words::dump_shell_words(cwd.as_deref()))
                .await;
        let table = match dumped {
            Ok(Some(table)) => table,
            Ok(None) => {
                // Not an error worth a warning: a fish user has no table and
                // grades exactly as everyone did before this existed.
                tuggram::ShellWords::empty()
            }
            Err(e) => {
                warn!(error = %e, "shell word dump task failed");
                tuggram::ShellWords::empty()
            }
        };
        let names = table.member_names().iter().map(|n| n.to_string()).collect();
        *self.0.lock().await = table;
        names
    }

    /// Read the bodies of every word in `heads` that still needs one, following
    /// each through the chain it expands along.
    ///
    /// One shell spawn per unread word — which is why this is driven by the
    /// heads of a line somebody actually typed, and why it runs behind the
    /// typing debounce rather than at submit.
    pub async fn ensure_bodies(&self, heads: &[String]) {
        let mut table = self.0.lock().await;
        if !heads.iter().any(|h| table.needs_body(h)) {
            return;
        }
        // Work on a clone off-thread, then swap it back: the fetches are
        // blocking shell spawns and must not run on the async runtime.
        let mut working = table.clone();
        let heads = heads.to_vec();
        let fetched = tokio::task::spawn_blocking(move || {
            for head in &heads {
                tuggram::words::ensure_body_chain(&mut working, head);
            }
            working
        })
        .await;
        match fetched {
            Ok(working) => *table = working,
            Err(e) => warn!(error = %e, "shell word body fetch task failed"),
        }
    }

    /// A copy of the table for a grading task to hold while it works.
    pub async fn snapshot(&self) -> tuggram::ShellWords {
        self.0.lock().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Point `$SHELL` at zsh and `$ZDOTDIR` at a tempdir holding a known rc, so
    /// the assertions are about that rc rather than about whatever the machine
    /// running the test has configured.
    fn with_rc(rc: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".zshrc"), rc).unwrap();
        unsafe {
            std::env::set_var("SHELL", "/bin/zsh");
            std::env::set_var("ZDOTDIR", dir.path());
        }
        dir
    }

    #[tokio::test]
    async fn a_refresh_reads_the_session_shell_and_names_its_words() {
        let _rc = with_rc("alias tugalias='git status'\ntugfn () { git status $* }\n");
        let words = SessionWords::default();
        let names = words.refresh(None).await;
        assert!(names.iter().any(|n| n == "tugalias"));
        assert!(names.iter().any(|n| n == "tugfn"));
        assert!(names.iter().any(|n| n == "setopt"), "builtins are members");
        assert!(!names.iter().any(|n| n.starts_with('_')));
    }

    #[tokio::test]
    async fn bodies_are_fetched_only_for_the_words_asked_about() {
        let _rc = with_rc("tugfn () { git status $* }\ntugother () { echo hi }\n");
        let words = SessionWords::default();
        words.refresh(None).await;
        words.ensure_bodies(&["tugfn".to_string()]).await;

        let table = words.snapshot().await;
        assert!(!table.needs_body("tugfn"));
        assert_eq!(
            table.resolve("tugfn"),
            Some(tuggram::WordResolution::Expands(tuggram::ResolvedWord {
                head: "git".into(),
                prefix: vec!["status".into()],
                takes_args: true,
            }))
        );
        assert!(
            table.needs_body("tugother"),
            "a word nobody typed costs no spawn"
        );
    }

    #[tokio::test]
    async fn an_unusable_shell_leaves_an_empty_table_rather_than_wedging() {
        unsafe {
            std::env::set_var("SHELL", "/usr/bin/false");
        }
        let words = SessionWords::default();
        assert!(words.refresh(None).await.is_empty());
        words.ensure_bodies(&["anything".to_string()]).await;
        assert!(words.snapshot().await.is_empty());
    }
}
