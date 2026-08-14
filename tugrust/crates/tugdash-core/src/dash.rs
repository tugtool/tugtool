//! Dash helpers — git-derived lightweight worktree work units.
//!
//! A dash *is* a git branch (`tugdash/<name>`) plus a worktree
//! (`.tug/worktrees/<name>`); its lifecycle and status derive from git, not
//! a database. This module holds the small shared helpers the `tugdash`
//! commands build on: name validation, default-branch detection, and the
//! append-only visibility log.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::Command;
use tugutil_core::error::TugError;
use tugutil_core::paths::project_state_dir;
use tugutil_core::session::now_iso8601;

/// Round metadata passed via stdin to `tugdash commit`.
///
/// Git already records the commit; the one datum it lacks is the verbatim
/// instruction, which lands in the dash-log. `summary` is retained for a richer
/// commit body. (The former `files_created` / `files_modified` fields were
/// dropped — git's own diff is the record.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashRoundMeta {
    pub instruction: Option<String>,
    pub summary: Option<String>,
}

/// Validate a dash name.
///
/// Names must:
/// - Match pattern: `^[a-z][a-z0-9-]*[a-z0-9]$`
/// - Be at least 2 characters
/// - Not be a reserved word: "release", "join", "status"
pub fn validate_dash_name(name: &str) -> Result<(), TugError> {
    // Reserved words check
    if name == "release" || name == "join" || name == "status" {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: format!("'{}' is a reserved word", name),
        });
    }

    // Minimum length
    if name.len() < 2 {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must be at least 2 characters".to_string(),
        });
    }

    // Pattern validation
    let chars: Vec<char> = name.chars().collect();

    // Must start with lowercase letter
    if !chars[0].is_ascii_lowercase() {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must start with a lowercase letter".to_string(),
        });
    }

    // Must end with lowercase letter or digit
    if !chars[chars.len() - 1].is_ascii_lowercase() && !chars[chars.len() - 1].is_ascii_digit() {
        return Err(TugError::DashNameInvalid {
            name: name.to_string(),
            reason: "name must end with a lowercase letter or digit".to_string(),
        });
    }

    // All characters must be lowercase letter, digit, or hyphen
    for ch in chars.iter() {
        if !ch.is_ascii_lowercase() && !ch.is_ascii_digit() && *ch != '-' {
            return Err(TugError::DashNameInvalid {
                name: name.to_string(),
                reason: "name must contain only lowercase letters, digits, and hyphens".to_string(),
            });
        }
    }

    Ok(())
}

/// Detect the default branch using a four-step fallback chain.
///
/// 1. Try `git symbolic-ref refs/remotes/origin/HEAD` (extract branch name)
/// 2. If that fails: check if `main` exists locally
/// 3. If that fails: check if `master` exists locally
/// 4. If all fail: error with message listing available local branches
pub fn detect_default_branch(repo_root: &Path) -> Result<String, TugError> {
    // Step 1: Try origin/HEAD
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("symbolic-ref")
        .arg("refs/remotes/origin/HEAD")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let symref = String::from_utf8_lossy(&output.stdout);
            // Format is "refs/remotes/origin/<branch>"
            if let Some(branch) = symref.trim().strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_string());
            }
        }
    }

    // Step 2: Check if main exists
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--verify")
        .arg("main")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            return Ok("main".to_string());
        }
    }

    // Step 3: Check if master exists
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("rev-parse")
        .arg("--verify")
        .arg("master")
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            return Ok("master".to_string());
        }
    }

    // Step 4: Error with available branches
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("branch")
        .arg("--format=%(refname:short)")
        .output()
        .map_err(|e| TugError::WorktreeCreationFailed {
            reason: format!("failed to list branches: {}", e),
        })?;

    let branches = String::from_utf8_lossy(&output.stdout);
    let branch_list: Vec<&str> = branches.lines().collect();

    Err(TugError::BaseBranchNotFound {
        branch: format!(
            "Could not detect default branch. Available local branches: {}",
            branch_list.join(", ")
        ),
    })
}

/// Append one record to the per-project dash-log under [`project_state_dir`].
///
/// The log is a flat, append-only, greppable markdown file — the whole
/// visibility surface for dash activity. Each line is four space-separated
/// fields: `<iso8601>  <dash>  <marker>  <note>`, where `<marker>` is the short
/// commit hash for a commit round (or `released` for a discarded dash) and
/// `<note>` is the verbatim instruction (or the terminal action). The directory
/// is created on first write.
pub fn append_dash_log(
    repo_root: &Path,
    dash: &str,
    marker: &str,
    note: &str,
) -> Result<(), TugError> {
    let dir = project_state_dir(repo_root);
    fs::create_dir_all(&dir).map_err(TugError::Io)?;
    let path = dir.join("dash-log.md");

    let note = note.replace('\n', " ");
    let line = format!("{}  {}  {}  {}\n", now_iso8601(), dash, marker, note.trim());

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(TugError::Io)?;
    file.write_all(line.as_bytes()).map_err(TugError::Io)?;
    Ok(())
}

// --- declarations ----------------------------------------------------------

/// A stage a dash declared for itself in the dash-log (Spec S01).
///
/// Git can see rounds, dirt, and a draft; it cannot see that a step is under
/// way or that a build was vetted. Those are declared, and the declaration
/// lives as one more line in the same append-only log ([P01]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DashDeclaration {
    /// Step `current` of `total` is under way.
    Step { current: u32, total: u32 },
    /// The dash built and launched.
    Built,
    /// The dash's work passed an audit.
    Audited,
}

/// Which end of a step a declaration marks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepPhase {
    Start,
    Done,
}

impl StepPhase {
    /// The log marker this phase writes.
    pub fn marker(self) -> &'static str {
        match self {
            StepPhase::Start => "step-start",
            StepPhase::Done => "step-done",
        }
    }
}

/// A stage `dash mark` may declare — the closed vocabulary of [P09].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkStage {
    Built,
    Audited,
}

impl MarkStage {
    /// The log marker, which is also the stage's wire spelling.
    pub fn marker(self) -> &'static str {
        match self {
            MarkStage::Built => "built",
            MarkStage::Audited => "audited",
        }
    }
}

/// What a dash's surviving declarations say about it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DashDeclarations {
    /// The latest declaration of any kind — the one the stage derives from.
    /// A `step-start` after a `built` correctly demotes the dash back to
    /// implementing, because the last thing declared is the current answer.
    pub latest: Option<DashDeclaration>,
    /// The latest step declaration's `i`/`N`, which outlives a later `built`
    /// or `audited` so a display can still say how far the run got.
    pub step: Option<(u32, u32)>,
}

/// Split a dash-log line into its dash, marker, and note fields.
///
/// [`append_dash_log`] joins the four fields with two spaces and trims the
/// note, so the note is whatever follows the third separator — including
/// nothing at all, which is how a `released` line is written.
fn split_log_line(line: &str) -> Option<(&str, &str, &str)> {
    let mut fields = line.trim_end().splitn(4, "  ");
    let _timestamp = fields.next()?;
    let dash = fields.next()?;
    let marker = fields.next()?;
    Some((
        dash.trim(),
        marker.trim(),
        fields.next().unwrap_or("").trim(),
    ))
}

/// Whether a log line ends a dash generation.
///
/// "Terminal" is spelled two ways because two writers spell it two ways: the
/// join teardown records the squash's sha as the marker and `joined` as the
/// note, and `release` records the marker `released` with no note.
fn is_terminal(marker: &str, note: &str) -> bool {
    marker == "released" || note == "joined"
}

/// Read the `i`/`N` a step declaration's note leads with. An unparseable note
/// is skipped rather than guessed at.
fn read_step_fields(note: &str) -> Option<(u32, u32)> {
    let token = note.split_whitespace().next()?;
    let (current, total) = token.split_once('/')?;
    Some((current.parse().ok()?, total.parse().ok()?))
}

/// The declarations a dash's *current generation* has made ([P02]).
///
/// Lines are filtered to the dash by name, then everything at or before its
/// last terminal line is discarded: the log is append-only across generations,
/// so without that reset a name reused after a join would be born `audited`.
/// A missing log, an empty log, and a log with nothing after the terminal line
/// all read as no declarations.
pub fn read_declarations(repo_root: &Path, dash: &str) -> DashDeclarations {
    let path = project_state_dir(repo_root).join("dash-log.md");
    let Ok(text) = fs::read_to_string(&path) else {
        return DashDeclarations::default();
    };

    let mut found = DashDeclarations::default();
    for line in text.lines() {
        let Some((name, marker, note)) = split_log_line(line) else {
            continue;
        };
        if name != dash {
            continue;
        }
        if is_terminal(marker, note) {
            found = DashDeclarations::default();
            continue;
        }
        match marker {
            "step-start" | "step-done" => {
                if let Some((current, total)) = read_step_fields(note) {
                    found.latest = Some(DashDeclaration::Step { current, total });
                    found.step = Some((current, total));
                }
            }
            "built" => found.latest = Some(DashDeclaration::Built),
            "audited" => found.latest = Some(DashDeclaration::Audited),
            _ => {}
        }
    }
    found
}

/// Append a step declaration (Spec S01). `tail` is the step's title on a start
/// and the round's short sha on a done; the `i/N` prefix is written here so no
/// call site has to spell the note's grammar.
pub fn append_step_declaration(
    repo_root: &Path,
    dash: &str,
    phase: StepPhase,
    current: u32,
    total: u32,
    tail: &str,
) -> Result<(), TugError> {
    let note = format!("{current}/{total} {}", tail.trim());
    append_dash_log(repo_root, dash, phase.marker(), note.trim())
}

/// Append a `built` or `audited` declaration (Spec S01, [P09]).
pub fn append_mark_declaration(
    repo_root: &Path,
    dash: &str,
    stage: MarkStage,
    note: &str,
) -> Result<(), TugError> {
    append_dash_log(repo_root, dash, stage.marker(), note)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    /// A scratch data dir plus the repo root whose dash-log it holds. Both
    /// live as long as the fixture; the data dir is redirected off the user's
    /// real one, which is why every test here is `#[serial]`.
    struct LogFixture {
        _home: tempfile::TempDir,
        repo: tempfile::TempDir,
    }

    impl LogFixture {
        fn root(&self) -> &Path {
            self.repo.path()
        }
    }

    /// Redirect the data dir and hand back a repo root whose project state dir
    /// holds `lines` as its dash-log. An empty `lines` writes no log at all.
    fn log_repo(lines: &str) -> LogFixture {
        let home = tempfile::tempdir().expect("tempdir");
        // SAFETY: these tests are #[serial]; no other thread reads the
        // environment concurrently while this runs.
        unsafe {
            std::env::set_var("TUG_DATA_DIR", home.path());
        }
        let repo = tempfile::tempdir().expect("tempdir");
        if !lines.is_empty() {
            let state = project_state_dir(repo.path());
            fs::create_dir_all(&state).expect("state dir");
            fs::write(state.join("dash-log.md"), lines).expect("write log");
        }
        LogFixture { _home: home, repo }
    }

    /// One log line in the shape [`append_dash_log`] writes.
    fn log_line(dash: &str, marker: &str, note: &str) -> String {
        format!("2026-08-14T12:00:00Z  {dash}  {marker}  {note}\n")
    }

    #[test]
    #[serial]
    fn declarations_are_empty_without_a_log() {
        let fixture = log_repo("");
        assert_eq!(
            read_declarations(fixture.root(), "some-dash"),
            DashDeclarations::default()
        );
    }

    #[test]
    #[serial]
    fn a_later_step_start_demotes_a_built_dash() {
        let log = format!(
            "{}{}{}",
            log_line("d", "step-start", "1/9 Step 1: First"),
            log_line("d", "built", ""),
            log_line("d", "step-start", "2/9 Step 2: Second"),
        );
        let fixture = log_repo(&log);
        let found = read_declarations(fixture.root(), "d");
        assert_eq!(
            found.latest,
            Some(DashDeclaration::Step {
                current: 2,
                total: 9
            })
        );
        assert_eq!(found.step, Some((2, 9)));
    }

    #[test]
    #[serial]
    fn a_step_survives_a_later_mark_for_the_step_fields() {
        let log = format!(
            "{}{}",
            log_line("d", "step-done", "3/9 a4477d5"),
            log_line("d", "built", "debug instance up"),
        );
        let fixture = log_repo(&log);
        let found = read_declarations(fixture.root(), "d");
        assert_eq!(found.latest, Some(DashDeclaration::Built));
        assert_eq!(found.step, Some((3, 9)));
    }

    #[test]
    #[serial]
    fn a_reused_name_inherits_nothing_across_a_terminal_line() {
        for terminal in [
            log_line("d", "released", ""),
            log_line("d", "a4477d5", "joined"),
        ] {
            let log = format!(
                "{}{}{}{}",
                log_line("d", "step-done", "9/9 a4477d5"),
                log_line("d", "audited", ""),
                terminal,
                log_line("d", "abc1234", "a fresh round on the reused name"),
            );
            let fixture = log_repo(&log);
            assert_eq!(
                read_declarations(fixture.root(), "d"),
                DashDeclarations::default(),
                "a new generation starts undeclared"
            );
        }
    }

    #[test]
    #[serial]
    fn an_unparseable_step_note_is_skipped() {
        let log = format!(
            "{}{}",
            log_line("d", "step-start", "1/9 Step 1: First"),
            log_line("d", "step-start", "nonsense"),
        );
        let fixture = log_repo(&log);
        let found = read_declarations(fixture.root(), "d");
        assert_eq!(found.step, Some((1, 9)), "the garbage note is ignored");
    }

    #[test]
    #[serial]
    fn another_dashs_declarations_never_leak_in() {
        let log = format!(
            "{}{}",
            log_line("other", "audited", ""),
            log_line("d", "step-start", "1/2 Step 1: First"),
        );
        let fixture = log_repo(&log);
        assert_eq!(
            read_declarations(fixture.root(), "other").latest,
            Some(DashDeclaration::Audited)
        );
        assert_eq!(
            read_declarations(fixture.root(), "d").latest,
            Some(DashDeclaration::Step {
                current: 1,
                total: 2
            })
        );
    }

    #[test]
    #[serial]
    fn the_writers_round_trip_through_the_reader() {
        let fixture = log_repo("");
        let root = fixture.root();
        append_step_declaration(root, "d", StepPhase::Start, 2, 8, "Step 2: Second").unwrap();
        assert_eq!(
            read_declarations(root, "d").latest,
            Some(DashDeclaration::Step {
                current: 2,
                total: 8
            })
        );
        append_mark_declaration(root, "d", MarkStage::Built, "").unwrap();
        assert_eq!(
            read_declarations(root, "d").latest,
            Some(DashDeclaration::Built)
        );
        append_mark_declaration(root, "d", MarkStage::Audited, "good shape").unwrap();
        assert_eq!(
            read_declarations(root, "d").latest,
            Some(DashDeclaration::Audited)
        );
    }

    #[test]
    fn test_validate_dash_name_valid() {
        assert!(validate_dash_name("ab").is_ok());
        assert!(validate_dash_name("login-page").is_ok());
        assert!(validate_dash_name("fix-bug").is_ok());
        assert!(validate_dash_name("test-123").is_ok());
        assert!(validate_dash_name("a1").is_ok());
    }

    #[test]
    fn test_validate_dash_name_invalid() {
        // Too short
        assert!(validate_dash_name("a").is_err());

        // Reserved words
        assert!(validate_dash_name("release").is_err());
        assert!(validate_dash_name("join").is_err());
        assert!(validate_dash_name("status").is_err());

        // Uppercase
        assert!(validate_dash_name("Login-Page").is_err());

        // Special chars
        assert!(validate_dash_name("login_page").is_err());
        assert!(validate_dash_name("login.page").is_err());

        // Leading hyphen
        assert!(validate_dash_name("-login").is_err());

        // Trailing hyphen
        assert!(validate_dash_name("login-").is_err());

        // Starts with digit
        assert!(validate_dash_name("1login").is_err());
    }
}
