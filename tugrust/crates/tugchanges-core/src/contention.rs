//! Whether two sessions editing one file are actually editing the same part
//! of it.
//!
//! File-level SHARED over-warns: most cross-session overlaps are coincidences
//! of the file, not of the work. This module reads each owner's recorded
//! anchors ([P11]) against the file's *current* hunks and answers the question
//! the badge and the default election both need — which regions each owner
//! claims, and where those claims collide.
//!
//! Two independent readers ask it (the sync engine in `changes.rs`, the async
//! feed in tugcast), which is exactly why the decision lives here as one pure
//! function over `(hunks, per-owner anchors)` ([P14]). Each reader supplies
//! the hunks its own way; the id contract in [`crate::hunks`] is what makes
//! the two agree.
//!
//! # The conservative direction
//!
//! Every uncertainty widens ([P12]): an owner with no anchors, a `whole`
//! anchor, an anchor matching nothing, or an anchor matching more than one
//! hunk claims the entire file — which reproduces the file-level answer this
//! module exists to refine. So the failure direction is *more* SHARED than
//! strictly necessary, never a false sole claim. Anchors annotate; the diff
//! decides.

use std::collections::{BTreeMap, BTreeSet};

use crate::hunks::{Hunk, content_hash};

/// One recorded piece of sub-file evidence, decoded from a span row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Anchor {
    /// The call asserted the whole file (a `Write`, a claim, an edit past the
    /// anchor cap) — or the row's anchor was unreadable, which is the same
    /// answer for the same reason.
    Whole,
    /// Text the call wrote, matched against a hunk's added lines.
    Content {
        /// [`content_hash`] of the written text.
        new_hash: String,
        /// Its head, capped at write time.
        new_head: String,
        /// Its byte length.
        new_len: usize,
    },
    /// A hunk named by its own [P06] id — the strongest anchor, since it is
    /// already the identity hunks are keyed by.
    Hunk { id: String },
}

impl Anchor {
    /// Decode a span row's `(kind, anchor)` pair.
    ///
    /// Anything unreadable decodes as [`Anchor::Whole`]: a span we cannot
    /// interpret must not silently narrow its owner's claim, and widening is
    /// the blessed failure direction.
    pub fn from_span(kind: &str, anchor_json: &str) -> Anchor {
        let value: serde_json::Value = match serde_json::from_str(anchor_json) {
            Ok(v) => v,
            Err(_) => return Anchor::Whole,
        };
        match kind {
            "hunk" => match value.get("hunk_id").and_then(|v| v.as_str()) {
                Some(id) => Anchor::Hunk { id: id.to_owned() },
                None => Anchor::Whole,
            },
            "insert" | "replace" => {
                let new_hash = value.get("new_hash").and_then(|v| v.as_str());
                let new_head = value.get("new_head").and_then(|v| v.as_str());
                match (new_hash, new_head) {
                    (Some(hash), Some(head)) => Anchor::Content {
                        new_hash: hash.to_owned(),
                        new_head: head.to_owned(),
                        new_len: value
                            .get("new_len")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0)
                            .try_into()
                            .unwrap_or(usize::MAX),
                    },
                    _ => Anchor::Whole,
                }
            }
            _ => Anchor::Whole,
        }
    }
}

/// One owner's evidence for a path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerAnchors {
    pub session: String,
    pub anchors: Vec<Anchor>,
}

/// What one owner claims of a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Claim {
    /// The whole file — every hunk, including ones that appear later.
    Whole,
    /// Exactly these hunks, by id.
    Hunks(BTreeSet<String>),
}

impl Claim {
    /// Whether this claim covers `id`.
    pub fn covers(&self, id: &str) -> bool {
        match self {
            Claim::Whole => true,
            Claim::Hunks(ids) => ids.contains(id),
        }
    }

    /// Whether two claims overlap. Two whole-file claims overlap; a whole-file
    /// claim overlaps any non-empty claim.
    pub fn intersects(&self, other: &Claim) -> bool {
        match (self, other) {
            (Claim::Whole, Claim::Whole) => true,
            (Claim::Whole, Claim::Hunks(ids)) | (Claim::Hunks(ids), Claim::Whole) => {
                !ids.is_empty()
            }
            (Claim::Hunks(a), Claim::Hunks(b)) => a.intersection(b).next().is_some(),
        }
    }
}

/// The read of one path: who claims what, and where the claims collide.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentionVerdict {
    /// True iff two owners' claims intersect — the honest SHARED bit.
    pub shared: bool,
    /// Each owner's claim, by session id.
    pub claims: BTreeMap<String, Claim>,
    /// Hunks two or more owners claim. A whole-file claimant contests every
    /// hunk another owner claims.
    pub contested: BTreeSet<String>,
}

impl ContentionVerdict {
    /// One owner's claimed hunk ids, for the wire's `own_hunks`. A whole-file
    /// claim yields every hunk the file currently has, so the client's
    /// default election is "all of it" without a second encoding for "whole".
    pub fn hunks_of(&self, session: &str, hunks: &[Hunk]) -> Vec<String> {
        match self.claims.get(session) {
            Some(Claim::Hunks(ids)) => hunks
                .iter()
                .filter(|h| ids.contains(&h.id))
                .map(|h| h.id.clone())
                .collect(),
            Some(Claim::Whole) => hunks.iter().map(|h| h.id.clone()).collect(),
            None => Vec::new(),
        }
    }
}

/// Read a path's contention from its current hunks and each owner's anchors
/// ([P12], Spec S04).
///
/// Pure by design: the two readers that call it obtain `hunks` on their own
/// side of the sync/async line, and this function never touches git or the
/// ledger.
pub fn classify_contention(hunks: &[Hunk], owners: &[OwnerAnchors]) -> ContentionVerdict {
    let added: Vec<(String, String)> = hunks
        .iter()
        .map(|h| (h.id.clone(), added_text(h)))
        .collect();

    let mut claims: BTreeMap<String, Claim> = BTreeMap::new();
    for owner in owners {
        claims.insert(owner.session.clone(), claim_for(&added, &owner.anchors));
    }

    let sessions: Vec<&String> = claims.keys().collect();
    let mut shared = false;
    'outer: for (i, a) in sessions.iter().enumerate() {
        for b in sessions.iter().skip(i + 1) {
            if claims[*a].intersects(&claims[*b]) {
                shared = true;
                break 'outer;
            }
        }
    }

    let mut contested = BTreeSet::new();
    for (id, _) in &added {
        if claims.values().filter(|c| c.covers(id)).count() > 1 {
            contested.insert(id.clone());
        }
    }

    ContentionVerdict {
        shared,
        claims,
        contested,
    }
}

/// Map one owner's anchors onto the file's hunks, widening on any uncertainty.
fn claim_for(added: &[(String, String)], anchors: &[Anchor]) -> Claim {
    if anchors.is_empty() {
        return Claim::Whole;
    }
    let mut ids: BTreeSet<String> = BTreeSet::new();
    for anchor in anchors {
        match anchor {
            Anchor::Whole => return Claim::Whole,
            Anchor::Hunk { id } => {
                if !added.iter().any(|(hid, _)| hid == id) {
                    // The hunk this call wrote is gone — its content moved
                    // under it, and we can no longer say which region is
                    // this owner's.
                    return Claim::Whole;
                }
                ids.insert(id.clone());
            }
            Anchor::Content {
                new_hash,
                new_head,
                new_len,
            } => {
                let matched: Vec<&String> = added
                    .iter()
                    .filter(|(_, text)| content_matches(text, new_hash, new_head, *new_len))
                    .map(|(id, _)| id)
                    .collect();
                match matched.as_slice() {
                    [one] => {
                        ids.insert((*one).clone());
                    }
                    // Zero matches (the text was edited away) or several (two
                    // regions carry the same text) — either way this owner
                    // cannot be placed, so it claims the file.
                    _ => return Claim::Whole,
                }
            }
        }
    }
    Claim::Hunks(ids)
}

/// Whether a hunk's added text carries what an anchor recorded.
///
/// Two ways in, because an anchor's text and a hunk's added text are the same
/// bytes only in the simplest case. The hash is exact — it fires when the
/// call's written text is precisely what the hunk added. Otherwise the capped
/// head must appear *within* the added text, which is the normal case for an
/// edit whose replacement sits among unchanged neighbours the diff also
/// carries. The length check is what keeps a short head from matching a hunk
/// too small to hold what the anchor claims to have written: a contiguous
/// insertion lands inside one hunk, so that hunk added at least as many bytes.
fn content_matches(added_text: &str, new_hash: &str, new_head: &str, new_len: usize) -> bool {
    if content_hash(added_text) == new_hash {
        return true;
    }
    !new_head.is_empty() && added_text.contains(new_head) && added_text.len() >= new_len
}

/// A hunk's added lines with their `+` markers stripped, newline-joined — the
/// text the file gained here, which is what an anchor recorded having written.
fn added_text(hunk: &Hunk) -> String {
    let mut out = String::new();
    for line in hunk.body.lines() {
        if let Some(rest) = line.strip_prefix('+') {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(rest);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hunks::parse_hunks;

    /// Two edits far enough apart to stay two hunks.
    const TWO_HUNKS: &str = "\
--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,4 @@
 alpha
+ALPHA-ADDED
 bravo
 charlie
@@ -20,3 +21,4 @@
 tango
+TANGO-ADDED
 uniform
 victor
";

    fn hunks() -> Vec<Hunk> {
        parse_hunks(TWO_HUNKS)
    }

    fn content(text: &str) -> Anchor {
        Anchor::Content {
            new_hash: content_hash(text),
            new_head: text.to_owned(),
            new_len: text.len(),
        }
    }

    fn owner(session: &str, anchors: Vec<Anchor>) -> OwnerAnchors {
        OwnerAnchors {
            session: session.to_owned(),
            anchors,
        }
    }

    #[test]
    fn disjoint_edits_are_not_shared() {
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![content("ALPHA-ADDED")]),
                owner("b", vec![content("TANGO-ADDED")]),
            ],
        );
        assert!(!verdict.shared, "{verdict:?}");
        assert!(verdict.contested.is_empty());
        assert_eq!(verdict.hunks_of("a", &hunks), vec![hunks[0].id.clone()]);
        assert_eq!(verdict.hunks_of("b", &hunks), vec![hunks[1].id.clone()]);
    }

    #[test]
    fn edits_to_the_same_region_are_shared_and_contested() {
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![content("ALPHA-ADDED")]),
                owner("b", vec![content("ALPHA-ADDED")]),
            ],
        );
        assert!(verdict.shared);
        assert_eq!(
            verdict.contested,
            [hunks[0].id.clone()].into_iter().collect::<BTreeSet<_>>()
        );
    }

    #[test]
    fn a_span_less_owner_claims_the_whole_file() {
        // The pre-spans world, reproduced exactly: an owner with no evidence
        // of *where* it edited contends with everyone ([P12]).
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![content("ALPHA-ADDED")]),
                owner("legacy", Vec::new()),
            ],
        );
        assert!(verdict.shared);
        assert_eq!(verdict.claims["legacy"], Claim::Whole);
        assert_eq!(verdict.contested.len(), 1, "only a's hunk is contested");
    }

    #[test]
    fn a_whole_anchor_claims_the_whole_file() {
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner("writer", vec![Anchor::Whole]),
                owner("b", vec![content("TANGO-ADDED")]),
            ],
        );
        assert!(verdict.shared);
        assert_eq!(
            verdict.hunks_of("writer", &hunks).len(),
            2,
            "a whole claim elects every hunk"
        );
    }

    #[test]
    fn an_anchor_matching_nothing_widens_its_owner() {
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner("stale", vec![content("TEXT-THAT-IS-GONE")]),
                owner("b", vec![content("TANGO-ADDED")]),
            ],
        );
        assert_eq!(verdict.claims["stale"], Claim::Whole);
        assert!(verdict.shared, "widening restores file-level contention");
    }

    #[test]
    fn an_ambiguous_anchor_widens_its_owner() {
        // Both hunks added the identical text, so the anchor cannot say which
        // region is this owner's.
        let diff = "\
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,3 @@
 alpha
+SAME
@@ -20,2 +21,3 @@
 tango
+SAME
";
        let hunks = parse_hunks(diff);
        let verdict = classify_contention(&hunks, &[owner("a", vec![content("SAME")])]);
        assert_eq!(verdict.claims["a"], Claim::Whole);
    }

    #[test]
    fn identical_insertions_by_two_sessions_contest() {
        // Genuinely contested: two sessions wrote the same text into the same
        // region, and marking it shared is the correct reading (Risk R03).
        let diff = "\
--- a/f.txt
+++ b/f.txt
@@ -1,2 +1,3 @@
 alpha
+SAME
";
        let hunks = parse_hunks(diff);
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![content("SAME")]),
                owner("b", vec![content("SAME")]),
            ],
        );
        assert!(verdict.shared);
        assert_eq!(verdict.contested.len(), 1);
    }

    #[test]
    fn a_hunk_anchor_matches_by_id_and_widens_when_it_drifts() {
        let hunks = hunks();
        let live = Anchor::Hunk {
            id: hunks[1].id.clone(),
        };
        let verdict = classify_contention(&hunks, &[owner("a", vec![live])]);
        assert_eq!(verdict.hunks_of("a", &hunks), vec![hunks[1].id.clone()]);

        let drifted = Anchor::Hunk {
            id: "deadbeefdeadbeef".to_owned(),
        };
        let verdict = classify_contention(&hunks, &[owner("a", vec![drifted])]);
        assert_eq!(verdict.claims["a"], Claim::Whole);
    }

    #[test]
    fn a_sole_owner_is_never_shared() {
        let hunks = hunks();
        let verdict = classify_contention(&hunks, &[owner("a", vec![Anchor::Whole])]);
        assert!(!verdict.shared);
        assert!(verdict.contested.is_empty());
    }

    #[test]
    fn an_unreadable_anchor_decodes_as_whole() {
        assert_eq!(Anchor::from_span("insert", "not json"), Anchor::Whole);
        assert_eq!(Anchor::from_span("insert", "{}"), Anchor::Whole);
        assert_eq!(Anchor::from_span("hunk", "{}"), Anchor::Whole);
        assert_eq!(Anchor::from_span("wat", "{}"), Anchor::Whole);
        assert_eq!(Anchor::from_span("whole", "{}"), Anchor::Whole);
    }

    #[test]
    fn a_content_anchor_decodes_its_fields() {
        let json = r#"{"new_hash":"abc","new_head":"hello","new_len":5,"old_hash":"def"}"#;
        assert_eq!(
            Anchor::from_span("replace", json),
            Anchor::Content {
                new_hash: "abc".to_owned(),
                new_head: "hello".to_owned(),
                new_len: 5,
            }
        );
    }

    #[test]
    fn a_capped_head_still_matches_the_hunk_that_carries_it() {
        // The written text was longer than the head cap, so only its head is
        // recorded — containment plus the length floor is what places it.
        let long: String = (1..=20)
            .map(|n| format!("added-line-{n}"))
            .collect::<Vec<_>>()
            .join("\n");
        let body: String = long
            .lines()
            .map(|l| format!("+{l}"))
            .collect::<Vec<_>>()
            .join("\n");
        let diff = format!("--- a/f.txt\n+++ b/f.txt\n@@ -1,1 +1,21 @@\n alpha\n{body}\n");
        let hunks = parse_hunks(&diff);
        let anchor = Anchor::Content {
            new_hash: "not-the-hash".to_owned(),
            new_head: long[..40].to_owned(),
            new_len: long.len(),
        };
        let verdict = classify_contention(&hunks, &[owner("a", vec![anchor])]);
        assert_eq!(verdict.hunks_of("a", &hunks), vec![hunks[0].id.clone()]);
    }
}
