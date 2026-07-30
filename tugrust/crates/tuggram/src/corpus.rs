//! The routing corpus, graded hermetically.
//!
//! `tests/model-eval/classify-corpus.json` is the labeled shell-vs-prompt set
//! the model harness scores against. This module grades every one of its cases
//! with no app, no model, no network — and no live PATH either.
//!
//! **The injected command set is the whole point.** A sweep of this machine's
//! login PATH inside a unit suite would make the result depend on what Homebrew
//! installed this week, which is not a regression gate, it is a weather report.
//! So the set is `data/corpus-commands.txt` unioned with the committed
//! catalog's own names, and `cwd` is `None`, so nothing here ever stats a real
//! file either. The reading against a real PATH belongs to the eval harness,
//! which is machine-bound by nature and reports per band.
//!
//! The floor this pins: **no line labeled `shell` may grade `No`.** A No is the
//! one band that withholds the model, so a shell line landing there is the
//! grader silently swallowing a real command — the failure the band doctrine
//! exists to make impossible.

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use crate::catalog::catalog;
    use crate::{grade, Band, CommandSet};

    const CORPUS_JSON: &str = include_str!("../../../../tests/model-eval/classify-corpus.json");
    const CORPUS_COMMANDS: &str = include_str!("../data/corpus-commands.txt");

    struct Case {
        text: String,
        label: String,
        band: Option<String>,
    }

    fn cases() -> Vec<Case> {
        let value: serde_json::Value = serde_json::from_str(CORPUS_JSON).expect("corpus parses");
        value["cases"]
            .as_array()
            .expect("cases array")
            .iter()
            .map(|c| Case {
                text: c["text"].as_str().expect("text").to_string(),
                label: c["label"].as_str().expect("label").to_string(),
                band: c["band"].as_str().map(str::to_string),
            })
            .collect()
    }

    /// The injected set: the hand-reviewed corpus openers plus every name the
    /// committed catalog knows. Sorted, because `CommandSet` binary-searches.
    fn injected() -> Vec<String> {
        let mut names: BTreeSet<String> = CORPUS_COMMANDS
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(str::to_string)
            .collect();
        names.extend(catalog().entries().map(|e| e.name.clone()));
        names.into_iter().collect()
    }

    fn band_of(text: &str, names: &[String]) -> Band {
        grade(text, &CommandSet::new_sorted(names), None).band
    }

    #[test]
    fn no_line_labeled_shell_grades_no() {
        let names = injected();
        for case in cases().iter().filter(|c| c.label == "shell") {
            assert_ne!(
                band_of(&case.text, &names),
                Band::No,
                "a No withholds the model entirely, so this real command would \
                 be silently swallowed: {:?}",
                case.text
            );
        }
    }

    #[test]
    fn every_recorded_band_still_holds() {
        let names = injected();
        for case in cases().iter().filter(|c| c.band.is_some()) {
            let expected = case.band.as_deref().expect("filtered");
            assert_eq!(
                band_of(&case.text, &names).as_str(),
                expected,
                "recorded band no longer holds for {:?}",
                case.text
            );
        }
    }

    #[test]
    fn every_opener_the_corpus_assumes_exists_is_in_the_injected_set() {
        // Without this a new case could grade No for want of a set entry rather
        // than because its opener names nothing, and the floor above would
        // quietly stop meaning anything.
        let names = injected();
        let set = CommandSet::new_sorted(&names);
        for case in cases() {
            if case.band.as_deref() == Some("no") {
                continue;
            }
            let Some(opener) = case.text.split_whitespace().next() else {
                continue;
            };
            // Path-shaped openers name a file, not a set entry.
            if opener.contains('/') {
                continue;
            }
            assert!(
                set.contains(opener) || crate::is_builtin(opener),
                "corpus opener {opener:?} is in no injected set entry — add it to \
                 data/corpus-commands.txt, or label the case band: no"
            );
        }
    }

    #[test]
    fn a_relative_opener_grades_unknown_with_no_working_directory() {
        // `./setup.sh` is the corpus's one path-shaped case. Graded with no
        // session cwd it is un-checkable, which is Unknown and never No — and
        // it is also why this suite never touches the filesystem.
        let names = injected();
        assert_eq!(band_of("./setup.sh", &names), Band::Unknown);
    }

    #[test]
    fn the_authored_no_cases_all_actually_grade_no() {
        // They are the only cases that exercise the band at all; if a word one
        // of them opens on ever became a real program, the case would silently
        // stop testing anything.
        let names = injected();
        let authored: Vec<_> = cases()
            .into_iter()
            .filter(|c| c.band.as_deref() == Some("no"))
            .collect();
        assert!(authored.len() >= 10, "the No band needs cases to exercise it");
        for case in authored {
            assert_eq!(band_of(&case.text, &names), Band::No, "{:?}", case.text);
        }
    }
}
