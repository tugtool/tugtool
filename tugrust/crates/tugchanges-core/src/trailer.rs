//! Git commit-message trailers (Spec S02).
//!
//! `Tug-Session:` / `Tug-Dash:` trailers ride every tugutil commit path so
//! `git log --grep` and `--format=%(trailers:key=Tug-Session)` can answer
//! session- and dash-scoped history questions. This is the ONE shared
//! implementation both tugcast (deck commits) and tugdash-core (dash round /
//! join commits) append with — client-side appending is deliberately avoided
//! ([P08]) since the commit sites are the single choke points.
//!
//! Trailers follow git's convention: a final paragraph (blank-line separated
//! from the body) of `Key: value` lines. Appending is idempotent — a key
//! already present anywhere in the message is skipped, so re-running over a
//! draft that already carries a trailer never duplicates it.

/// Append machine-parseable git trailers to a commit message (Spec S02).
///
/// Each `(key, value)` becomes a `Key: value` line in the message's final
/// paragraph. A key already present in the message (any line beginning
/// `Key:`) is skipped, so the append is idempotent per key. When the message
/// already ends with a trailer-only paragraph the new lines join it (keeping
/// all trailers one contiguous paragraph, which is what git's trailer parser
/// reads); otherwise they form a new blank-line-separated final paragraph.
pub fn append_trailers(message: &str, trailers: &[(&str, &str)]) -> String {
    let mut to_add: Vec<String> = Vec::new();
    for (key, value) in trailers {
        if has_trailer_key(message, key) {
            continue;
        }
        to_add.push(format!("{key}: {value}"));
    }
    if to_add.is_empty() {
        return message.to_string();
    }
    let base = message.trim_end();
    let added = to_add.join("\n");
    if base.is_empty() {
        return added;
    }
    if last_paragraph_is_trailers(base) {
        format!("{base}\n{added}")
    } else {
        format!("{base}\n\n{added}")
    }
}

/// Whether the message already carries a trailer line for `key` (any line
/// beginning `key:`, case-sensitive — trailer keys are exact).
fn has_trailer_key(message: &str, key: &str) -> bool {
    let prefix = format!("{key}:");
    message.lines().any(|line| line.starts_with(&prefix))
}

/// Whether the message's final paragraph is entirely trailer lines
/// (`Key: value`). Used to decide whether new trailers join the last
/// paragraph or start a fresh one.
fn last_paragraph_is_trailers(message: &str) -> bool {
    // The final paragraph is the run of lines after the last blank line.
    let last_para = match message.rsplit("\n\n").next() {
        Some(p) => p,
        None => message,
    };
    let mut saw_line = false;
    for line in last_para.lines() {
        if line.trim().is_empty() {
            continue;
        }
        saw_line = true;
        if !is_trailer_line(line) {
            return false;
        }
    }
    saw_line
}

/// A `Key: value` trailer line: a leading token of `[A-Za-z][A-Za-z0-9-]*`
/// followed immediately by a colon and a space.
fn is_trailer_line(line: &str) -> bool {
    let colon = match line.find(": ") {
        Some(i) => i,
        None => return false,
    };
    let key = &line[..colon];
    !key.is_empty()
        && key.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_a_trailer_as_the_final_paragraph() {
        let out = append_trailers("Fix the thing", &[("Tug-Session", "web (sess-1)")]);
        assert_eq!(out, "Fix the thing\n\nTug-Session: web (sess-1)");
    }

    #[test]
    fn preserves_a_multiline_body_before_the_trailer_block() {
        let msg = "Subject line\n\n- bullet one\n- bullet two";
        let out = append_trailers(msg, &[("Tug-Dash", "tugdash/x onto main")]);
        assert_eq!(
            out,
            "Subject line\n\n- bullet one\n- bullet two\n\nTug-Dash: tugdash/x onto main"
        );
    }

    #[test]
    fn is_idempotent_per_key() {
        let once = append_trailers("Do a thing", &[("Tug-Session", "web (sess-1)")]);
        let twice = append_trailers(&once, &[("Tug-Session", "web (sess-1)")]);
        assert_eq!(once, twice, "a present key is never appended twice");
        // Even a different value for a present key is skipped (present wins).
        let diff = append_trailers(&once, &[("Tug-Session", "other (sess-2)")]);
        assert_eq!(diff, once);
    }

    #[test]
    fn multiple_trailers_in_one_call_form_one_paragraph() {
        let out = append_trailers(
            "Land the dash",
            &[
                ("Tug-Session", "web (sess-1)"),
                ("Tug-Dash", "tugdash/x onto main"),
            ],
        );
        assert_eq!(
            out,
            "Land the dash\n\nTug-Session: web (sess-1)\nTug-Dash: tugdash/x onto main"
        );
    }

    #[test]
    fn a_new_key_joins_an_existing_trailer_paragraph() {
        // A message that already ends with a trailer gets the new key on the
        // SAME paragraph, not a second blank-line-separated one.
        let msg = "Subject\n\nTug-Session: web (sess-1)";
        let out = append_trailers(msg, &[("Tug-Dash", "tugdash/x onto main")]);
        assert_eq!(
            out,
            "Subject\n\nTug-Session: web (sess-1)\nTug-Dash: tugdash/x onto main"
        );
    }

    #[test]
    fn no_trailers_requested_returns_the_message_unchanged() {
        assert_eq!(append_trailers("Subject", &[]), "Subject");
    }

    #[test]
    fn a_message_that_is_only_a_body_paragraph_gets_a_blank_line() {
        // A prose final paragraph (not trailers) → new paragraph.
        let out = append_trailers("just a sentence here", &[("Tug-Session", "web (s)")]);
        assert_eq!(out, "just a sentence here\n\nTug-Session: web (s)");
    }
}
