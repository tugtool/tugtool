//! Startup sweep of the composer's `draft-attachments/` folder.
//!
//! Files land there when an image is dropped on the Session card's prompt
//! entry ([`crate::attachments`]) and are referenced by a UUID-named path held
//! in durable card state or in prompt history. Nothing ever removes one: a
//! draft the user cleared, a chip they deleted, a prompt they sent and forgot
//! all leave their bytes behind. This is the sweep that reclaims them.
//!
//! ## The root-set contract
//!
//! Exactly two producers write references to these files:
//!
//!   - `dev.tugtool.deck.cardstate` — the prompt entry's `attachmentBytes`
//!     entries, each carrying the stored path.
//!   - `dev.tugtool.prompt.history` — the same path on a submitted prompt's
//!     image atoms.
//!
//! Both live in this instance's own tugbank, so the world is closed and the
//! sweep can union them and treat anything unmentioned as garbage. **A future
//! feature that stores one of these references anywhere else must add itself
//! to the root set**, or this sweep will delete bytes it still needs.
//!
//! ## Why the predicate is a UUID and not a path
//!
//! The obvious test is "does this file's absolute path appear in the roots'
//! JSON," and it is wrong. One directory has many spellings — `/u/src/…` vs
//! `/Users/…`, firmlinks, the APFS data-volume link — and a path that is
//! persisted *and* compared has to pass the canonicalization gateway first.
//! Here the cost of two spellings failing to match is not an invisible dark
//! row: it is deleting bytes a live draft still references, which is the exact
//! loss this whole feature exists to end.
//!
//! Matching the `<uuid>` stem removes the exposure by construction. A v4 UUID
//! has one spelling, cannot collide, and appears in a root value if and only
//! if some surface still references that file. **This sweep performs no path
//! comparison at all**, which is why it needs no gateway call and cannot
//! drift. A later refactor that "simplifies" it back into a path substring
//! match reintroduces the bug.
//!
//! Everything else about it is conservative in the safe direction. A crude
//! substring hit merely retains a file for another sweep. A mtime younger than
//! the grace period is left alone regardless — never delete eagerly on unlink.
//! Only files *directly* inside the folder are considered, and a filename
//! whose stem does not parse as a UUID is skipped rather than guessed at.

use std::path::Path;
use std::time::{Duration, SystemTime};

use tracing::{info, warn};
use tugbank_core::TugbankClient;

/// How long a file must have gone untouched before the sweep will consider
/// removing it. The git-gc / Joplin lesson: an unreferenced file is very often
/// a file whose reference has not been written yet.
pub(crate) const GRACE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// A file's stem as a v4 UUID, or `None` when it does not look like one.
///
/// Deliberately strict: only names this module's own writer produces are
/// candidates for deletion. Anything else in the folder is somebody else's.
fn uuid_stem(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    uuid::Uuid::parse_str(stem).ok().map(|_| stem.to_owned())
}

/// Delete unreferenced, aged-out files directly inside `dir`.
///
/// `root_json` is the concatenated JSON text of every value in the two root
/// domains; a file survives when its UUID stem appears anywhere in it.
/// Returns how many files were removed. Pure over its inputs (no tugbank, no
/// clock beyond `now`) so it can be tested directly.
pub(crate) fn sweep_draft_attachments(
    dir: &Path,
    root_json: &[String],
    grace: Duration,
    now: SystemTime,
) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        // No folder yet is the normal case on a fresh instance.
        return 0;
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        // Files only — a subdirectory is not ours to reason about.
        match entry.file_type() {
            Ok(ft) if ft.is_file() => {}
            _ => continue,
        }
        let Some(uuid) = uuid_stem(&path) else {
            continue;
        };
        if root_json.iter().any(|json| json.contains(&uuid)) {
            continue;
        }
        let aged_out = entry
            .metadata()
            .ok()
            .and_then(|md| md.modified().ok())
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > grace);
        if !aged_out {
            continue;
        }
        match std::fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(err) => warn!(error = %err, path = %path.display(), "draft-gc: remove failed"),
        }
    }
    removed
}

/// Read the root domains and run the sweep. Called once at tugcast startup;
/// tugbank is fatal-if-absent there, so the roots are always readable.
pub(crate) fn sweep_at_startup(bank: &TugbankClient) {
    let mut root_json: Vec<String> = Vec::new();
    for domain in [
        crate::defaults::CARDSTATE_DOMAIN,
        crate::defaults::PROMPT_HISTORY_DOMAIN,
    ] {
        match bank.read_domain(domain) {
            Ok(snapshot) => {
                for value in snapshot.into_values() {
                    // Only the shapes a reference can actually live in. A
                    // number or a blob cannot mention a UUID.
                    match value {
                        tugbank_core::Value::Json(json) => {
                            if let Ok(text) = serde_json::to_string(&json) {
                                root_json.push(text);
                            }
                        }
                        tugbank_core::Value::String(text) => root_json.push(text),
                        _ => {}
                    }
                }
            }
            Err(err) => {
                // Without a readable root set the sweep cannot tell live from
                // dead, so it does not run at all. Retaining everything for
                // another launch is the only safe answer.
                warn!(domain = %domain, error = %err, "draft-gc: root domain unreadable; sweep skipped");
                return;
            }
        }
    }
    let removed = sweep_draft_attachments(
        &crate::attachments::draft_attachments_dir(),
        &root_json,
        GRACE,
        SystemTime::now(),
    );
    if removed > 0 {
        info!(count = removed, "swept unreferenced draft attachments");
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A `<uuid>.png` file inside `dir`, written now. Returns its uuid.
    fn make_file(dir: &Path) -> String {
        let uuid = uuid::Uuid::new_v4().to_string();
        std::fs::write(dir.join(format!("{uuid}.png")), b"bytes").unwrap();
        uuid
    }

    /// A sweep running long after everything in the fixture was written, so
    /// every file is past the grace period. Ages the clock rather than the
    /// files: mtime is the fixture's to set, and the wall clock is what the
    /// sweep actually compares against.
    fn long_after() -> SystemTime {
        SystemTime::now() + Duration::from_secs(30 * 24 * 60 * 60)
    }

    #[test]
    fn removes_the_unreferenced_and_aged_out() {
        let dir = tempfile::tempdir().unwrap();
        let referenced = make_file(dir.path());
        let unreferenced = make_file(dir.path());

        let roots = vec![format!(
            r#"{{"attachmentBytes":{{"a":{{"path":"/d/{referenced}.png"}}}}}}"#
        )];
        let removed = sweep_draft_attachments(dir.path(), &roots, GRACE, long_after());

        assert_eq!(removed, 1);
        assert!(dir.path().join(format!("{referenced}.png")).exists());
        assert!(!dir.path().join(format!("{unreferenced}.png")).exists());
    }

    /// The grace period is what keeps a just-dropped attachment alive in the
    /// window before its reference has been written. Same fixture as above
    /// with only the clock changed — nothing goes.
    #[test]
    fn a_young_file_survives_even_unreferenced() {
        let dir = tempfile::tempdir().unwrap();
        let uuid = make_file(dir.path());

        let removed = sweep_draft_attachments(dir.path(), &[], GRACE, SystemTime::now());

        assert_eq!(removed, 0);
        assert!(dir.path().join(format!("{uuid}.png")).exists());
    }

    /// The whole reason the predicate is a UUID. Under a path-substring
    /// predicate this file would not match its own reference — one directory,
    /// two spellings — and the sweep would delete bytes a live draft still
    /// points at. Matching the stem is spelling-invariant, so it survives.
    #[test]
    fn a_reference_under_a_different_path_spelling_still_retains_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let uuid = make_file(dir.path());

        // The root records the file under a completely different spelling of
        // the same directory than the one the sweep is walking.
        let roots = vec![format!(
            r#"{{"path":"/System/Volumes/Data/u/src/tug/draft-attachments/{uuid}.png"}}"#
        )];
        let removed = sweep_draft_attachments(dir.path(), &roots, GRACE, long_after());

        assert_eq!(removed, 0);
        assert!(dir.path().join(format!("{uuid}.png")).exists());
    }

    #[test]
    fn either_root_domain_retains_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let in_cardstate = make_file(dir.path());
        let in_history = make_file(dir.path());

        let roots = vec![
            format!(r#"{{"path":"/d/{in_cardstate}.png"}}"#),
            format!(r#"{{"atoms":[{{"path":"/d/{in_history}.png"}}]}}"#),
        ];
        assert_eq!(
            sweep_draft_attachments(dir.path(), &roots, GRACE, long_after()),
            0,
        );
    }

    #[test]
    fn a_non_uuid_filename_is_never_touched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.png");
        std::fs::write(&path, b"bytes").unwrap();

        assert_eq!(
            sweep_draft_attachments(dir.path(), &[], GRACE, long_after()),
            0,
        );
        assert!(path.exists());
    }

    #[test]
    fn subdirectories_are_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join(format!("{}.png", uuid::Uuid::new_v4()));
        std::fs::create_dir(&sub).unwrap();
        let nested = sub.join(format!("{}.png", uuid::Uuid::new_v4()));
        std::fs::write(&nested, b"bytes").unwrap();

        assert_eq!(
            sweep_draft_attachments(dir.path(), &[], GRACE, long_after()),
            0,
        );
        assert!(sub.is_dir());
        assert!(nested.exists());
    }

    #[test]
    fn a_missing_directory_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            sweep_draft_attachments(&dir.path().join("never-created"), &[], GRACE, long_after(),),
            0,
        );
    }
}
