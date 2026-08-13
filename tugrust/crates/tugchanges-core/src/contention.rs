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
//! # The conservative direction is not one direction
//!
//! Two consumers read this verdict and they want opposite things from an
//! uncertainty. The **SHARED bit and `contested`** want it widened: failing
//! to warn about an overlap is the error that costs, so an owner with no
//! anchors, a `whole` anchor, or evidence that failed to place is read as
//! claiming the entire file — the file-level answer this module refines.
//! The **election** (`hunks_of`, which becomes the wire's `own_hunks` and
//! the default set of hunks a commit stages) wants it narrowed: leaving my
//! own work behind is cheap and visible — the row stays dirty and says so —
//! while sweeping a co-owner's work into my commit is expensive and
//! invisible.
//!
//! So a claim carries both readings. `Claim::Hunks { placed, unplaced }`
//! names the hunks the evidence actually reached *and* whether some of that
//! owner's evidence reached nothing; `covers`/`intersects` treat `unplaced`
//! as whole-file, while `hunks_of` returns only `placed`. `Claim::Whole` —
//! a `Write`, a claim, an edit past the anchor cap — is whole in *both*
//! directions, because that call really did produce the whole file.
//!
//! Multiple matches are not an uncertainty. One edit routinely lands in
//! several hunks (an import and its call site), so an anchor claims every
//! hunk it matches; that is narrower than the whole file either way.
//!
//! Anchors annotate; the diff decides.

use std::collections::{BTreeMap, BTreeSet};

use crate::anchors::{containment_probes, head_was_truncated};
use crate::hunks::{Hunk, content_hash};

/// One recorded piece of sub-file evidence, decoded from a span row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Anchor {
    /// The call asserted the whole file (a `Write`, a claim, an edit past the
    /// anchor cap) — or the row's anchor was unreadable, which is the same
    /// answer for the same reason.
    Whole,
    /// The lines an edit added, in the shape a hunk's added text has them
    /// ([`crate::anchors`]) — the anchor every new row is written as.
    AddedLines {
        /// [`content_hash`] of each distinctive added line.
        line_hashes: Vec<String>,
        /// How many lines the edit added in all, before the distinctiveness
        /// filter and the cap. Diagnostic; the matcher does not read it.
        added_lines: usize,
        /// Those lines joined and capped — a matcher input, probed by
        /// containment when no line hash lands.
        added_head: String,
    },
    /// Text the call wrote, matched against a hunk's added lines. The
    /// pre-added-lines shape; still written in ledgers, so still decoded.
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
                // New shape first: a row carrying `line_hashes` is an
                // added-lines anchor even if it also carries the legacy
                // fields, since the added-lines reading is the better one.
                if let Some(hashes) = value.get("line_hashes").and_then(|v| v.as_array()) {
                    return Anchor::AddedLines {
                        line_hashes: hashes
                            .iter()
                            .filter_map(|v| v.as_str())
                            .map(|s| s.to_owned())
                            .collect(),
                        added_lines: value
                            .get("added_lines")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0)
                            .try_into()
                            .unwrap_or(usize::MAX),
                        added_head: value
                            .get("added_head")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_owned(),
                    };
                }
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
    /// The whole file — every hunk, including ones that appear later. The
    /// evidence said so; this is whole in both readings.
    Whole,
    /// The hunks this owner's evidence reached, plus whether any of its
    /// evidence reached nothing at all.
    Hunks {
        /// Hunks an anchor actually matched. The election is exactly this.
        placed: BTreeSet<String>,
        /// Some anchor of this owner's placed nowhere, so for the SHARED
        /// question the owner is read as claiming the file — without
        /// widening what it would land.
        unplaced: bool,
    },
}

impl Claim {
    /// Whether this claim reads as the whole file for the SHARED and
    /// `contested` questions — either whole by evidence, or evidence that
    /// failed to place.
    fn widens(&self) -> bool {
        match self {
            Claim::Whole => true,
            Claim::Hunks { unplaced, .. } => *unplaced,
        }
    }

    /// The hunks the evidence reached, or `None` for a whole-file claim.
    fn placed(&self) -> Option<&BTreeSet<String>> {
        match self {
            Claim::Whole => None,
            Claim::Hunks { placed, .. } => Some(placed),
        }
    }

    /// Whether this claim covers `id` — the widened reading.
    pub fn covers(&self, id: &str) -> bool {
        match self {
            Claim::Whole => true,
            Claim::Hunks { placed, unplaced } => *unplaced || placed.contains(id),
        }
    }

    /// Whether two claims overlap, under the widened reading. Two widening
    /// claims overlap; a widening claim overlaps any non-empty claim.
    pub fn intersects(&self, other: &Claim) -> bool {
        match (self.widens(), other.widens()) {
            (true, true) => true,
            (true, false) => other.placed().is_some_and(|p| !p.is_empty()),
            (false, true) => self.placed().is_some_and(|p| !p.is_empty()),
            (false, false) => self
                .placed()
                .zip(other.placed())
                .is_some_and(|(a, b)| a.intersection(b).next().is_some()),
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
    ///
    /// This is the *narrow* reading: only hunks the evidence actually
    /// reached. An owner some of whose evidence placed nowhere elects what
    /// placed, even though the SHARED bit reads that same owner as claiming
    /// the file.
    pub fn hunks_of(&self, session: &str, hunks: &[Hunk]) -> Vec<String> {
        match self.claims.get(session) {
            Some(Claim::Hunks { placed, .. }) => hunks
                .iter()
                .filter(|h| placed.contains(&h.id))
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
    let added: Vec<HunkAdded> = hunks.iter().map(HunkAdded::of).collect();

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
    for hunk in &added {
        if claims.values().filter(|c| c.covers(&hunk.id)).count() > 1 {
            contested.insert(hunk.id.clone());
        }
    }

    ContentionVerdict {
        shared,
        claims,
        contested,
    }
}

/// One hunk's added lines, in every form the matchers want them: joined text
/// for containment, per-line hashes for the added-lines rule.
///
/// The hunk side hashes *every* added line, unfiltered — the distinctiveness
/// rule ([`crate::anchors::line_is_distinctive`]) is applied when the anchor
/// is written, and filtering here too could only lose matches the anchor side
/// already vouched for.
struct HunkAdded {
    id: String,
    text: String,
    line_hashes: BTreeSet<String>,
}

impl HunkAdded {
    fn of(hunk: &Hunk) -> HunkAdded {
        let text = added_text(hunk);
        HunkAdded {
            id: hunk.id.clone(),
            line_hashes: text.lines().map(content_hash).collect(),
            text,
        }
    }
}

/// Map one owner's anchors onto the file's hunks.
///
/// Every anchor either places — contributing every hunk it matched — or
/// fails to, setting `unplaced`. The two are kept apart because the SHARED
/// bit and the election read them oppositely; see the module doc.
fn claim_for(added: &[HunkAdded], anchors: &[Anchor]) -> Claim {
    if anchors.is_empty() {
        return Claim::Whole;
    }
    let mut placed: BTreeSet<String> = BTreeSet::new();
    let mut unplaced = false;
    for anchor in anchors {
        let matched: Vec<&String> = match anchor {
            Anchor::Whole => return Claim::Whole,
            Anchor::Hunk { id } => added
                .iter()
                .filter(|h| &h.id == id)
                .map(|h| &h.id)
                .collect(),
            Anchor::Content {
                new_hash,
                new_head,
                new_len,
            } => added
                .iter()
                .filter(|h| content_matches(&h.text, new_hash, new_head, *new_len))
                .map(|h| &h.id)
                .collect(),
            Anchor::AddedLines {
                line_hashes,
                added_head,
                ..
            } => added_lines_matches(added, line_hashes, added_head),
        };
        if matched.is_empty() {
            // The hunk this call wrote is gone, or its text moved under it:
            // we can no longer say which region is this owner's.
            unplaced = true;
        } else {
            placed.extend(matched.into_iter().cloned());
        }
    }
    Claim::Hunks { placed, unplaced }
}

/// The hunks an added-lines anchor reaches: any hunk sharing one of its line
/// hashes, and failing that, any hunk whose added text *contains* one of its
/// distinctive added lines.
///
/// The containment rule runs only when the hash rule matched nothing at all,
/// so it can turn an unplaced anchor into a placed one but never widen a set
/// the hash rule already produced. It exists for the two cases exact per-line
/// hashing cannot reach: a sub-line fragment edit, whose recorded "line" is
/// part of the hunk's line, and a line past the hash cap.
///
/// Containment places only on a *single* hunk. Unlike the hash rule, which
/// compares whole lines, a probe matches any hunk whose added text merely
/// contains it — so a short probe can appear in a region this edit never
/// wrote. Multi-match under the hash rule is evidence of one edit reaching
/// two hunks; multi-match under containment is indistinguishable from a
/// coincidence, and electing a co-owner's hunk on a coincidence is the
/// expensive, invisible error. Declining costs only the badge.
fn added_lines_matches<'a>(
    added: &'a [HunkAdded],
    line_hashes: &[String],
    added_head: &str,
) -> Vec<&'a String> {
    let by_hash: Vec<&String> = added
        .iter()
        .filter(|h| line_hashes.iter().any(|lh| h.line_hashes.contains(lh)))
        .map(|h| &h.id)
        .collect();
    if !by_hash.is_empty() {
        return by_hash;
    }
    let probes = containment_probes(added_head, head_was_truncated(added_head));
    if probes.is_empty() {
        return Vec::new();
    }
    let by_containment: Vec<&String> = added
        .iter()
        .filter(|h| probes.iter().any(|probe| h.text.contains(probe)))
        .map(|h| &h.id)
        .collect();
    if by_containment.len() == 1 {
        by_containment
    } else {
        Vec::new()
    }
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

    /// A legacy-shape anchor, as rows recorded before added-lines anchors
    /// carry it. Only tests that deliberately model the old shape use this.
    fn content(text: &str) -> Anchor {
        Anchor::Content {
            new_hash: content_hash(text),
            new_head: text.to_owned(),
            new_len: text.len(),
        }
    }

    /// An anchor built the way production builds one: through
    /// [`crate::anchors::edit_anchor`] and back out through the decoder, from
    /// the `old_string`/`new_string` pair an `Edit` actually carries. Fixtures
    /// that mint hashes from a hunk's added text instead are how the original
    /// feature shipped green while placing nothing in the field.
    fn edit(old: Option<&str>, new: &str) -> Anchor {
        let kind = if old.is_some_and(|s| !s.is_empty()) {
            "replace"
        } else {
            "insert"
        };
        Anchor::from_span(kind, &crate::anchors::edit_anchor(old, new).to_string())
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
    fn an_anchor_matching_nothing_widens_the_badge_but_not_the_election() {
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner("stale", vec![content("TEXT-THAT-IS-GONE")]),
                owner("b", vec![content("TANGO-ADDED")]),
            ],
        );
        assert!(verdict.shared, "widening restores file-level contention");
        assert!(
            verdict.claims["stale"].covers(&hunks[0].id),
            "unplaced evidence covers the file for the SHARED question"
        );
        assert!(
            verdict.hunks_of("stale", &hunks).is_empty(),
            "…and elects nothing, so the landing takes nobody else's work"
        );
    }

    #[test]
    fn an_ambiguous_anchor_claims_both_hunks() {
        // Both hunks added the identical text. Claiming both is narrower than
        // claiming the file, in both readings.
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
        assert_eq!(
            verdict.claims["a"],
            Claim::Hunks {
                placed: [hunks[0].id.clone(), hunks[1].id.clone()]
                    .into_iter()
                    .collect(),
                unplaced: false,
            }
        );
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
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![drifted]),
                owner("b", vec![content("TANGO-ADDED")]),
            ],
        );
        assert!(verdict.shared, "a drifted id still warns file-wide");
        assert!(
            verdict.hunks_of("a", &hunks).is_empty(),
            "…without electing b's hunk"
        );
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

    #[test]
    fn an_edit_carrying_context_lines_places_on_the_line_it_changed() {
        // The field failure, end to end: the anchor is built from the Edit's
        // own strings, context line and all, and still lands on one hunk.
        let diff = "\
--- a/f.tsx
+++ b/f.tsx
@@ -10,2 +10,2 @@
             glyphPosition=\"both\"
-            size={12}
+            size={14}
@@ -40,2 +40,3 @@
 elsewhere
+const unrelated = 1;
";
        let hunks = parse_hunks(diff);
        let anchor = edit(
            Some("            glyphPosition=\"both\"\n            size={12}"),
            "            glyphPosition=\"both\"\n            size={14}",
        );
        let verdict = classify_contention(&hunks, &[owner("a", vec![anchor])]);
        assert_eq!(verdict.hunks_of("a", &hunks), vec![hunks[0].id.clone()]);
    }

    #[test]
    fn a_large_replacement_of_one_line_places_on_that_line() {
        // The whole replacement is over a kilobyte and the hunk added sixty
        // bytes of it. Nothing in the added-lines path compares the two
        // lengths, which is what used to sink this.
        let old: String = (0..20)
            .map(|n| {
                format!("    // context line {n} with padding to make this a long replacement\n")
            })
            .collect();
        assert!(old.len() > 1024);
        let new = old.replace("line 7 with", "line 7 rewritten with");
        let changed =
            "    // context line 7 rewritten with padding to make this a long replacement";
        let diff = format!("--- a/f.rs\n+++ b/f.rs\n@@ -1,2 +1,3 @@\n alpha\n+{changed}\n bravo\n");
        let hunks = parse_hunks(&diff);
        let verdict = classify_contention(&hunks, &[owner("a", vec![edit(Some(&old), &new)])]);
        assert_eq!(verdict.hunks_of("a", &hunks), vec![hunks[0].id.clone()]);
    }

    #[test]
    fn one_edit_reaching_two_hunks_claims_both() {
        // An import and its call site — the normal shape of a real edit, and
        // formerly read as ambiguity and widened to the whole file.
        let diff = "\
--- a/f.rs
+++ b/f.rs
@@ -1,2 +1,3 @@
 use std::io;
+use std::fmt::Debug;
@@ -30,2 +31,3 @@
     let x = 1;
+    debug_print(x);
";
        let hunks = parse_hunks(diff);
        let spanning = edit(
            Some("use std::io;\n    let x = 1;"),
            "use std::io;\nuse std::fmt::Debug;\n    let x = 1;\n    debug_print(x);",
        );
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![spanning]),
                owner("b", vec![edit(None, "    debug_print(x);")]),
            ],
        );
        assert_eq!(
            verdict.hunks_of("a", &hunks),
            vec![hunks[0].id.clone(), hunks[1].id.clone()],
            "both hunks, not the file"
        );
        assert!(verdict.shared);
        assert_eq!(
            verdict.contested,
            [hunks[1].id.clone()].into_iter().collect::<BTreeSet<_>>(),
            "only the call site is contested"
        );
    }

    #[test]
    fn one_unplaceable_anchor_widens_the_badge_and_leaves_the_election_alone() {
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner(
                    "a",
                    vec![
                        edit(None, "ALPHA-ADDED"),
                        edit(None, "TEXT-SINCE-OVERWRITTEN"),
                    ],
                ),
                owner("b", vec![edit(None, "TANGO-ADDED")]),
            ],
        );
        assert!(verdict.shared, "a's unplaceable anchor still warns");
        assert_eq!(
            verdict.hunks_of("a", &hunks),
            vec![hunks[0].id.clone()],
            "a lands only what it can prove"
        );
        assert_eq!(
            verdict.contested,
            [hunks[1].id.clone()].into_iter().collect::<BTreeSet<_>>()
        );
    }

    #[test]
    fn an_owner_that_places_nothing_still_elects_nothing() {
        // The limit of the split, pinned so a later reader does not mistake
        // it for a bug: an empty election is read downstream as whole-file,
        // so this owner still lands its co-owner's work. Closing that needs a
        // wire signal for "evidence that failed to place".
        let hunks = hunks();
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![edit(None, "GONE-ONE"), edit(None, "GONE-TWO")]),
                owner("b", vec![edit(None, "TANGO-ADDED")]),
            ],
        );
        assert!(verdict.shared);
        assert!(verdict.hunks_of("a", &hunks).is_empty());
    }

    #[test]
    fn a_punctuation_only_edit_never_claims_a_co_owners_hunk() {
        // `});` is exactly the length floor and is everywhere. A length-only
        // distinctiveness rule would let this anchor claim b's hunk.
        let diff = "\
--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,3 @@
 alpha
+ALPHA-ADDED
@@ -20,2 +21,3 @@
 tango
+});
";
        let hunks = parse_hunks(diff);
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![edit(None, "});")]),
                owner("b", vec![edit(None, "ALPHA-ADDED")]),
            ],
        );
        assert_eq!(
            verdict.claims["a"],
            Claim::Hunks {
                placed: BTreeSet::new(),
                unplaced: true,
            }
        );
        assert!(verdict.hunks_of("a", &hunks).is_empty());
    }

    #[test]
    fn a_sub_line_fragment_places_by_containment() {
        // Neither string ends at a line boundary, so the anchor's "line" is a
        // fragment of the hunk's line and hashes differently.
        let diff = "\
--- a/f.tsx
+++ b/f.tsx
@@ -10,1 +10,1 @@
-            size={12}
+            size={14}
@@ -40,1 +40,2 @@
 elsewhere
+            weight={700}
";
        let hunks = parse_hunks(diff);
        let verdict = classify_contention(
            &hunks,
            &[owner("a", vec![edit(Some("size={12}"), "size={14}")])],
        );
        assert_eq!(verdict.hunks_of("a", &hunks), vec![hunks[0].id.clone()]);
    }

    #[test]
    fn containment_never_widens_a_set_the_hashes_already_placed() {
        let diff = "\
--- a/f.rs
+++ b/f.rs
@@ -1,2 +1,3 @@
 alpha
+let alpha = 1;
@@ -20,2 +21,3 @@
 tango
+let beta = 2;
";
        let hunks = parse_hunks(diff);
        // `beta` is contained in the second hunk's added line, but the first
        // hunk already matched by hash, so the fallback never runs.
        let verdict = classify_contention(
            &hunks,
            &[owner("a", vec![edit(None, "let alpha = 1;\nbeta")])],
        );
        assert_eq!(verdict.hunks_of("a", &hunks), vec![hunks[0].id.clone()]);
    }

    #[test]
    fn an_ambiguous_containment_probe_places_nothing() {
        // A probe matches on substring, not on the whole line, so a short
        // fragment can turn up in a region this edit never wrote. Two hits
        // are a coincidence, not one edit reaching two hunks — and electing
        // the co-owner's hunk on a coincidence is the error that costs.
        let diff = "\
--- a/f.tsx
+++ b/f.tsx
@@ -10,1 +10,1 @@
-            size={12}
+            size={14}
@@ -40,1 +40,2 @@
 elsewhere
+  <Icon size={14} />
";
        let hunks = parse_hunks(diff);
        let verdict = classify_contention(
            &hunks,
            &[
                owner("a", vec![edit(Some("size={12}"), "size={14}")]),
                owner("b", vec![edit(None, "  <Icon size={14} />")]),
            ],
        );
        assert_eq!(
            verdict.claims["a"],
            Claim::Hunks {
                placed: BTreeSet::new(),
                unplaced: true,
            },
            "an ambiguous probe declines rather than claiming both"
        );
        assert!(
            verdict.hunks_of("a", &hunks).is_empty(),
            "…so the landing cannot sweep up b's region"
        );
    }

    #[test]
    fn an_added_lines_anchor_decodes_its_fields() {
        let json = r#"{"line_hashes":["aa","bb"],"added_lines":3,"added_head":"one\ntwo"}"#;
        assert_eq!(
            Anchor::from_span("replace", json),
            Anchor::AddedLines {
                line_hashes: vec!["aa".to_owned(), "bb".to_owned()],
                added_lines: 3,
                added_head: "one\ntwo".to_owned(),
            }
        );
    }

    #[test]
    fn the_new_shape_wins_over_a_row_carrying_both() {
        let json = r#"{"line_hashes":["aa"],"added_lines":1,"added_head":"one","new_hash":"z","new_head":"y","new_len":1}"#;
        assert!(matches!(
            Anchor::from_span("insert", json),
            Anchor::AddedLines { .. }
        ));
    }

    #[test]
    fn an_empty_line_hashes_array_is_still_an_added_lines_anchor() {
        // An edit that added only punctuation places nothing — but it is a
        // read anchor, not an unreadable one, and must not decode as Whole.
        let json = r#"{"line_hashes":[],"added_lines":2,"added_head":"});"}"#;
        assert_eq!(
            Anchor::from_span("replace", json),
            Anchor::AddedLines {
                line_hashes: Vec::new(),
                added_lines: 2,
                added_head: "});".to_owned(),
            }
        );
    }
}
