//! Distilling a rendered man page (or a `--help` dump) into a catalog entry.
//!
//! Everything here is pure over text. Locating a man page, rendering it, and —
//! only behind an explicit opt-in — running a binary are the harvest *binary's*
//! job (`src/bin/harvest.rs`); this module is the part unit tests can drive over
//! checked-in fixtures without executing anything at all.
//!
//! # What the distiller aims for, and what it does not
//!
//! It aims to know a command's **flags**. It does not try to infer how many
//! bare words a command takes or what they mean, so every harvested entry
//! carries the `free` positional policy — the honest record that the distiller
//! learned nothing about this command's positions.
//!
//! `free` is not permissive in the band it produces. A free position cannot be
//! recognized, so any harvested command carrying a bare word grades Maybe and
//! goes to the model with its documentation attached. What `free` buys is that
//! the entry can never *narrow wrongly*: it makes no claim about the position,
//! so it cannot contradict one. Narrowing to `files` or an enum is what turns a
//! command's bare words into something the grader can confirm, and it comes
//! from the hand-authored curated entries.

use std::collections::BTreeSet;

use crate::catalog::{Entry, Grammar, PositionalKind, Positionals, Source, SYNOPSIS_CHAR_CAP};

/// Strip the backspace-overstrike sequences `man` uses for bold and underline
/// (`X\bX` for bold, `_\bX` for underline) so the text is plain.
pub fn strip_overstrike(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        // A backspace erases what precedes it and yields to what follows.
        if chars.get(i + 1) == Some(&'\u{8}') {
            i += 2;
            continue;
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// One top-level section of a man page: an unindented ALL-CAPS heading and the
/// indented lines under it.
fn sections(text: &str) -> Vec<(String, Vec<&str>)> {
    let mut out: Vec<(String, Vec<&str>)> = Vec::new();
    for line in text.lines() {
        let is_heading = !line.is_empty()
            && !line.starts_with(char::is_whitespace)
            && line
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_whitespace() || c == '-');
        if is_heading {
            out.push((line.trim().to_string(), Vec::new()));
        } else if let Some(last) = out.last_mut() {
            last.1.push(line);
        }
    }
    out
}

/// Collapse a section's indented lines into wrapped prose.
fn section_text(lines: &[&str]) -> String {
    lines
        .iter()
        .map(|l| l.trim())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// Whether a word read as a command-line flag: `-x` or `--long-name`, and not a
/// bare dash, a `--` terminator, or a negative number.
fn flag_of(word: &str) -> Option<&str> {
    // A SYNOPSIS line wraps optional flags in brackets: `[-o output]`.
    let word = word
        .trim_start_matches(['[', '(', '"', '\''])
        .trim_end_matches([',', '.', ';', ':', ')', ']', '"', '\'']);
    let (dashes, body) = if let Some(b) = word.strip_prefix("--") {
        (2, b)
    } else if let Some(b) = word.strip_prefix('-') {
        (1, b)
    } else {
        return None;
    };
    // `--flag=VALUE` names the flag `--flag`.
    let body = body.split('=').next().unwrap_or(body);
    if body.is_empty() {
        return None;
    }
    let mut chars = body.chars();
    let first = chars.next().expect("non-empty");
    if !first.is_ascii_alphabetic() {
        return None;
    }
    if dashes == 1 {
        // A short flag is one letter. Longer runs are either bundles or prose,
        // and neither is a flag name to record.
        if body.chars().count() != 1 {
            return None;
        }
    } else if !chars.all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(&word[..dashes + body.len()])
}

/// Whether a word reads as a placeholder for a flag's value rather than as
/// another flag or as prose: `FILE`, `<file>`, or the lowercase operand names a
/// SYNOPSIS line uses (`-o output`).
fn looks_like_a_value(word: &str, in_synopsis: bool) -> bool {
    let word = word.trim_matches(|c: char| "[]().,".contains(c));
    if word.starts_with('<') && word.ends_with('>') && word.len() > 2 {
        return true;
    }
    // An operand's name ends where its own optional part begins:
    // `field1[,field2]` names `field1`.
    let base = word
        .split(['[', ',', '|'])
        .next()
        .unwrap_or(word)
        .trim_matches(|c: char| "[]().,".contains(c));
    if base.is_empty() || flag_of(base).is_some() {
        return false;
    }
    if base.len() > 1
        && base
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
    {
        return true;
    }
    in_synopsis
        && base
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// Every flag the page mentions, plus the subset that appears to swallow the
/// following word as its value.
fn scan_flags(text: &str, in_synopsis: bool, flags: &mut BTreeSet<String>, values: &mut BTreeSet<String>) {
    for line in text.lines() {
        let words: Vec<&str> = line.split_whitespace().collect();
        for (i, word) in words.iter().enumerate() {
            let Some(flag) = flag_of(word) else { continue };
            // The word must start the token, not sit inside one, or hyphenated
            // prose would read as a flag.
            flags.insert(flag.to_string());
            if word.contains('=') && word.starts_with("--") {
                values.insert(flag.to_string());
                continue;
            }
            if let Some(next) = words.get(i + 1) {
                if looks_like_a_value(next, in_synopsis) {
                    values.insert(flag.to_string());
                }
            }
        }
    }
}

/// A version-looking token from the page's header or footer, when there is one.
/// Man pages mostly do not carry a version; `None` is the common answer and is
/// perfectly fine — the grader never matches on it.
fn scan_version(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    for line in lines.iter().take(1).chain(lines.iter().rev().take(1)) {
        for word in line.split_whitespace() {
            let candidate = word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.');
            let mut parts = candidate.split('.');
            let (Some(major), Some(minor)) = (parts.next(), parts.next()) else {
                continue;
            };
            if !major.is_empty()
                && major.chars().all(|c| c.is_ascii_digit())
                && !minor.is_empty()
                && minor.chars().all(|c| c.is_ascii_digit())
            {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Assemble a synopsis under the cap, dropping whole trailing pieces rather
/// than cutting one mid-word. The order is the order of usefulness to a model
/// judging a typed line: what the program is, how it is invoked, then its
/// flags.
fn compose_synopsis(pieces: Vec<String>, trailer: &str) -> String {
    let mut out = String::new();
    for piece in pieces {
        let piece = piece.trim();
        if piece.is_empty() {
            continue;
        }
        let addition = if out.is_empty() {
            piece.to_string()
        } else {
            format!("\n\n{piece}")
        };
        if out.chars().count() + addition.chars().count() + trailer.chars().count() + 2
            > SYNOPSIS_CHAR_CAP
        {
            break;
        }
        out.push_str(&addition);
    }
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(trailer);
    // A piece longer than the whole budget on its own still has to fit.
    if out.chars().count() > SYNOPSIS_CHAR_CAP {
        out = out.chars().take(SYNOPSIS_CHAR_CAP).collect();
    }
    out
}

/// Distill a rendered man page into a catalog entry, or `None` if the page
/// yields no flags — in which case the catalog says more by staying silent, and
/// the command grades Unknown.
pub fn distill_man(name: &str, rendered: &str) -> Option<Entry> {
    let text = strip_overstrike(rendered);
    let sections = sections(&text);
    let find = |wanted: &str| {
        sections
            .iter()
            .find(|(h, _)| h == wanted)
            .map(|(_, lines)| section_text(lines))
    };

    let mut flags = BTreeSet::new();
    let mut values = BTreeSet::new();
    let synopsis_section = find("SYNOPSIS").unwrap_or_default();
    scan_flags(&synopsis_section, true, &mut flags, &mut values);
    for heading in ["OPTIONS", "DESCRIPTION", "FLAGS"] {
        if let Some(body) = find(heading) {
            scan_flags(&body, false, &mut flags, &mut values);
        }
    }
    if flags.is_empty() {
        return None;
    }

    let version = scan_version(&text);
    let trailer = match &version {
        Some(v) => format!("({name} {v}, distilled from its man page)"),
        None => format!("({name}, distilled from its man page)"),
    };
    let description = find("NAME").unwrap_or_default().replace('\n', " ");
    let usage = if synopsis_section.is_empty() {
        String::new()
    } else {
        format!("Usage: {}", synopsis_section.replace('\n', "\n       "))
    };
    let flag_list = format!("Flags: {}", flags.iter().cloned().collect::<Vec<_>>().join(" "));
    let synopsis = compose_synopsis(vec![description, usage, flag_list], &trailer);

    Some(Entry {
        name: name.to_string(),
        source: Source::Man,
        version,
        synopsis,
        grammar: Grammar {
            flags: flags.into_iter().collect(),
            value_flags: values.into_iter().collect(),
            // See the module doc: harvested entries never narrow positionals.
            positionals: Positionals::Kind(PositionalKind::Free),
            subcommands: Default::default(),
        },
    })
}

/// Distill a `--help` dump. Same shape as [`distill_man`], but the text has no
/// section headings to lean on, so every line is scanned for flags and the
/// first non-empty lines stand in for the description.
pub fn distill_help(name: &str, help_text: &str) -> Option<Entry> {
    let text = strip_overstrike(help_text);
    let mut flags = BTreeSet::new();
    let mut values = BTreeSet::new();
    scan_flags(&text, false, &mut flags, &mut values);
    if flags.is_empty() {
        return None;
    }

    let version = scan_version(&text);
    let head: String = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join("\n");
    let flag_list = format!("Flags: {}", flags.iter().cloned().collect::<Vec<_>>().join(" "));
    let trailer = format!("({name}, read from its own --help)");
    let synopsis = compose_synopsis(vec![head, flag_list], &trailer);

    Some(Entry {
        name: name.to_string(),
        source: Source::Help,
        version,
        synopsis,
        grammar: Grammar {
            flags: flags.into_iter().collect(),
            value_flags: values.into_iter().collect(),
            positionals: Positionals::Kind(PositionalKind::Free),
            subcommands: Default::default(),
        },
    })
}

/// Merge harvested entries under the curated ones. Curated grammars are
/// hand-authored — they carry subcommand levels and narrowed positional
/// policies no distiller can infer — so they win outright on a name collision
/// rather than being merged field by field.
///
/// The result is sorted by name, which is what makes a regeneration diff
/// readable and `--check` meaningful.
pub fn merge(curated: Vec<Entry>, harvested: Vec<Entry>) -> Vec<Entry> {
    let mut out: Vec<Entry> = curated;
    let taken: BTreeSet<String> = out.iter().map(|e| e.name.clone()).collect();
    out.extend(harvested.into_iter().filter(|e| !taken.contains(&e.name)));
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::PositionalVerdict;

    const SORT_MAN: &str = include_str!("../data/man-fixtures/sort.txt");
    const TOUCH_MAN: &str = include_str!("../data/man-fixtures/touch.txt");

    #[test]
    fn overstrike_sequences_come_out_as_plain_text() {
        assert_eq!(strip_overstrike("s\u{8}so\u{8}or\u{8}rt\u{8}t"), "sort");
        assert_eq!(strip_overstrike("_\u{8}f_\u{8}i_\u{8}l_\u{8}e"), "file");
        assert_eq!(strip_overstrike("plain"), "plain");
    }

    #[test]
    fn flag_words_are_told_apart_from_hyphenated_prose() {
        assert_eq!(flag_of("-n"), Some("-n"));
        assert_eq!(flag_of("--reverse"), Some("--reverse"));
        assert_eq!(flag_of("--field-separator=SEP"), Some("--field-separator"));
        assert_eq!(flag_of("-n,"), Some("-n"));
        assert_eq!(flag_of("case-insensitive"), None);
        assert_eq!(flag_of("--"), None);
        assert_eq!(flag_of("-"), None);
        assert_eq!(flag_of("-12"), None);
        // A run of letters behind one dash is a bundle or prose, not a name.
        assert_eq!(flag_of("-bcCdf"), None);
    }

    #[test]
    fn the_sort_man_page_yields_its_real_flags() {
        let entry = distill_man("sort", SORT_MAN).expect("sort has flags");
        assert_eq!(entry.source, Source::Man);
        for flag in ["-n", "-r", "-u", "-k", "-o", "-t"] {
            assert!(entry.grammar.knows_flag(flag), "missing {flag}");
        }
        // `-k field` and `-o output` take the following word.
        assert!(entry.grammar.flag_takes_value("-k"));
        assert!(entry.grammar.flag_takes_value("-o"));
    }

    #[test]
    fn a_distilled_synopsis_says_what_the_program_is_and_where_it_came_from() {
        let entry = distill_man("touch", TOUCH_MAN).expect("touch has flags");
        assert!(entry.synopsis.contains("touch"));
        assert!(entry.synopsis.contains("Usage:"));
        assert!(entry.synopsis.contains("distilled from its man page"));
    }

    #[test]
    fn every_distilled_synopsis_respects_the_prefill_budget() {
        for (name, page) in [("sort", SORT_MAN), ("touch", TOUCH_MAN)] {
            let entry = distill_man(name, page).expect("has flags");
            assert!(
                entry.synopsis.chars().count() <= SYNOPSIS_CHAR_CAP,
                "{name} over cap at {}",
                entry.synopsis.chars().count()
            );
        }
    }

    #[test]
    fn harvested_entries_never_narrow_the_positional_policy() {
        let entry = distill_man("sort", SORT_MAN).unwrap();
        // A claim of nothing, which is what the distiller actually learned —
        // and which no longer holds a line at Yes.
        assert_eq!(
            entry.grammar.positional_verdict("anything at all", None),
            PositionalVerdict::Free
        );
    }

    #[test]
    fn a_page_with_no_flags_yields_no_entry() {
        let page = "NAME\n     nothing - does nothing\n\nDESCRIPTION\n     It does nothing.\n";
        assert!(distill_man("nothing", page).is_none());
    }

    #[test]
    fn distillation_is_deterministic() {
        let a = distill_man("sort", SORT_MAN).unwrap();
        let b = distill_man("sort", SORT_MAN).unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn help_text_distills_without_any_section_headings() {
        let help = "tugfake 1.2\nUsage: tugfake [options] <path>\n\n  -v, --verbose   say more\n  --out FILE      write there\n";
        let entry = distill_help("tugfake", help).expect("has flags");
        assert_eq!(entry.source, Source::Help);
        assert!(entry.grammar.knows_flag("--verbose"));
        assert!(entry.grammar.flag_takes_value("--out"));
        assert_eq!(entry.version.as_deref(), Some("1.2"));
    }

    #[test]
    fn curated_entries_win_a_name_collision_outright() {
        let curated = Entry {
            name: "sort".into(),
            source: Source::Curated,
            version: None,
            synopsis: "hand-authored".into(),
            grammar: Grammar {
                flags: vec!["-u".into()],
                ..Default::default()
            },
        };
        let harvested = distill_man("sort", SORT_MAN).unwrap();
        let merged = merge(vec![curated], vec![harvested]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].source, Source::Curated);
        assert_eq!(merged[0].synopsis, "hand-authored");
    }

    #[test]
    fn merged_output_is_sorted_by_name() {
        let entry = |name: &str| Entry {
            name: name.into(),
            source: Source::Man,
            version: None,
            synopsis: "s".into(),
            grammar: Grammar {
                flags: vec!["-a".into()],
                ..Default::default()
            },
        };
        let merged = merge(vec![entry("zed")], vec![entry("apple"), entry("mango")]);
        let names: Vec<&str> = merged.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["apple", "mango", "zed"]);
    }
}
