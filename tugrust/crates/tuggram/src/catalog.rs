//! The baked command catalog: what each program can be shown to accept.
//!
//! The catalog is a committed JSON file embedded at compile time and parsed
//! once. Nothing is harvested, probed, or cached at runtime — the harvester
//! (`src/bin/harvest.rs`) regenerates the file offline, and its output is
//! reviewed as an ordinary diff.
//!
//! A command absent from the catalog is not a command that fails to validate.
//! Absence means the grader has no grammar to check against, which is the
//! `Unknown` band and therefore the pre-grader path. Adding an entry can only
//! ever add discrimination.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// The committed catalog, embedded at compile time.
const CATALOG_JSON: &str = include_str!("../data/commands.json");

/// Upper bound on a synopsis, in characters — roughly 300 tokens of classify
/// prefill. The Maybe band rides a synopsis into the model's prompt inside a 2s
/// deadline, so the bound is a latency budget, not a formatting preference. The
/// harvester enforces it at build time and [`Catalog::check_integrity`] asserts
/// it, so nothing truncates at runtime.
pub const SYNOPSIS_CHAR_CAP: usize = 1200;

/// Where an entry's grammar came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Hand-authored. Survives every regeneration and wins on collision.
    Curated,
    /// Distilled from the program's man page. Executes nothing but `man`.
    Man,
    /// Read from the program's own `--help`, which means it was executed.
    Help,
}

/// What a grammar does with a token that is not a flag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Positionals {
    Kind(PositionalKind),
    /// The token must be one of these words.
    Enum {
        #[serde(rename = "enum")]
        values: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PositionalKind {
    /// Anything at all — the grammar names no shape the token must have.
    /// `make the watch loop resilient` is a valid `make` line.
    Free,
    /// Paths, confirmed by a `stat` against the session's working directory.
    Files,
    /// This command takes no bare words; one is a mismatch.
    None,
}

impl Default for Positionals {
    fn default() -> Self {
        Positionals::Kind(PositionalKind::Free)
    }
}

/// What a grammar can say about one bare word.
///
/// Only [`Confirmed`](PositionalVerdict::Confirmed) can hold a line at `Yes`.
/// The other two both mean `Maybe` and are distinguished for the caller's
/// reading, not for the band: a free positional is a shape the grammar never
/// constrained, an unconfirmed one is a shape it constrained and could not
/// match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionalVerdict {
    /// The grammar names the shape this token must have, and it has it.
    Confirmed,
    /// The grammar accepts arbitrary words here, so it can confirm nothing.
    Free,
    /// The grammar constrains this position and the token does not fit.
    Unconfirmed,
}

impl Positionals {
    /// What this policy can say about a bare word.
    ///
    /// `cwd` is the shell session's working directory, used to resolve a
    /// relative path positional. With no cwd there is nothing to resolve
    /// against and a path cannot be confirmed, which is `Unconfirmed` — the
    /// same degrade-toward-caution the head resolver applies.
    fn verdict(&self, token: &str, cwd: Option<&Path>) -> PositionalVerdict {
        match self {
            Positionals::Kind(PositionalKind::Free) => PositionalVerdict::Free,
            Positionals::Kind(PositionalKind::Files) => {
                if path_exists(token, cwd) {
                    PositionalVerdict::Confirmed
                } else {
                    PositionalVerdict::Unconfirmed
                }
            }
            Positionals::Kind(PositionalKind::None) => PositionalVerdict::Unconfirmed,
            Positionals::Enum { values } => {
                if values.iter().any(|v| v == token) {
                    PositionalVerdict::Confirmed
                } else {
                    PositionalVerdict::Unconfirmed
                }
            }
        }
    }
}

/// Whether a path positional names something that exists.
///
/// Unlike a command word, a path positional may be a directory (`ls src`) and
/// need not be executable, so this is a plain existence check rather than
/// [`crate::stat_resolution`]'s executable-regular-file test.
///
/// A token carrying a glob or a variable expansion is not the token that will
/// reach the program, so no `stat` can speak for it and it is never confirmed.
/// `-` is the conventional name for standard input rather than a path.
fn path_exists(token: &str, cwd: Option<&Path>) -> bool {
    if token == "-" || token.contains(['$', '*', '?', '[']) {
        return false;
    }
    if let Some(rest) = token.strip_prefix("~/") {
        let Some(home) = std::env::var_os("HOME") else {
            return false;
        };
        return PathBuf::from(home).join(rest).exists();
    }
    if token.starts_with('~') {
        return false;
    }
    if token.starts_with('/') {
        return Path::new(token).exists();
    }
    match cwd {
        Some(cwd) => cwd.join(token).exists(),
        None => false,
    }
}

/// One level of grammar: a command's own flags and positionals, plus the
/// subcommands that descend into their own level.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Grammar {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub flags: Vec<String>,
    /// Flags that swallow the following token as their value (`-m <msg>`).
    /// Must be a subset of `flags`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub value_flags: Vec<String>,
    #[serde(default)]
    pub positionals: Positionals,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub subcommands: BTreeMap<String, Grammar>,
}

impl Grammar {
    pub fn knows_flag(&self, flag: &str) -> bool {
        self.flags.iter().any(|f| f == flag)
    }

    pub fn flag_takes_value(&self, flag: &str) -> bool {
        self.value_flags.iter().any(|f| f == flag)
    }

    /// What this level's positional policy can say about a bare word.
    pub fn positional_verdict(&self, token: &str, cwd: Option<&Path>) -> PositionalVerdict {
        self.positionals.verdict(token, cwd)
    }

    fn is_empty_payload(&self) -> bool {
        self.flags.is_empty() && self.subcommands.is_empty()
    }
}

/// A catalog entry: one command's provenance, documentation, and grammar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub source: Source,
    /// The version the grammar was harvested from, when it could be determined
    /// without executing anything. Recorded so a stale synopsis reads as dated
    /// rather than as current truth; the grader never matches on it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// The program's condensed documentation, ≤ [`SYNOPSIS_CHAR_CAP`].
    pub synopsis: String,
    #[serde(flatten)]
    pub grammar: Grammar,
}

/// The parsed catalog, keyed for lookup.
#[derive(Debug, Default)]
pub struct Catalog {
    entries: BTreeMap<String, Entry>,
}

/// The on-disk file shape.
#[derive(Debug, Serialize, Deserialize)]
pub struct CatalogFile {
    /// A note to whoever opens the file. Ignored by everything else.
    #[serde(rename = "_doc", default, skip_serializing_if = "String::is_empty")]
    pub doc: String,
    pub commands: Vec<Entry>,
}

impl Catalog {
    /// Parse a catalog file's text.
    pub fn parse(json: &str) -> Result<Catalog, String> {
        let file: CatalogFile = serde_json::from_str(json).map_err(|e| e.to_string())?;
        let mut entries = BTreeMap::new();
        for entry in file.commands {
            if entries.contains_key(&entry.name) {
                return Err(format!("duplicate catalog entry: {}", entry.name));
            }
            entries.insert(entry.name.clone(), entry);
        }
        Ok(Catalog { entries })
    }

    pub fn get(&self, name: &str) -> Option<&Entry> {
        self.entries.get(name)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entries(&self) -> impl Iterator<Item = &Entry> {
        self.entries.values()
    }

    /// Everything the catalog promises about itself, checked in one pass. Run
    /// against the committed file by a unit test, and by the harvester before it
    /// writes, so a violation is caught at authoring time rather than as a
    /// truncated prompt in production.
    pub fn check_integrity(&self) -> Result<(), String> {
        for entry in self.entries.values() {
            let name = &entry.name;
            if entry.synopsis.chars().count() > SYNOPSIS_CHAR_CAP {
                return Err(format!(
                    "{name}: synopsis is {} chars, over the {SYNOPSIS_CHAR_CAP} cap",
                    entry.synopsis.chars().count()
                ));
            }
            if entry.synopsis.trim().is_empty() {
                return Err(format!("{name}: empty synopsis"));
            }
            if entry.grammar.is_empty_payload() {
                return Err(format!(
                    "{name}: no grammar payload — absence from the catalog says the same \
                     thing (Unknown) without pretending to know anything"
                ));
            }
            check_grammar(name, &entry.grammar)?;
        }
        Ok(())
    }
}

/// Recursively check one grammar level and its subcommands.
fn check_grammar(path: &str, grammar: &Grammar) -> Result<(), String> {
    for flag in &grammar.value_flags {
        if !grammar.knows_flag(flag) {
            return Err(format!("{path}: value_flag {flag} is not in flags"));
        }
    }
    for flag in &grammar.flags {
        if !flag.starts_with('-') {
            return Err(format!("{path}: flag {flag} does not start with a dash"));
        }
    }
    for (name, sub) in &grammar.subcommands {
        check_grammar(&format!("{path} {name}"), sub)?;
    }
    Ok(())
}

/// The embedded catalog, parsed once.
///
/// A malformed committed catalog is a build-time authoring error that the
/// integrity test catches; if one somehow ships, the grader degrades to an empty
/// catalog — every command grades Unknown, which is the pre-grader path.
pub fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| Catalog::parse(CATALOG_JSON).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_committed_catalog_parses() {
        let catalog = Catalog::parse(CATALOG_JSON).expect("committed catalog parses");
        assert!(!catalog.is_empty());
    }

    #[test]
    fn the_committed_catalog_satisfies_its_own_integrity_rules() {
        Catalog::parse(CATALOG_JSON)
            .expect("parses")
            .check_integrity()
            .expect("integrity");
    }

    #[test]
    fn every_committed_synopsis_is_inside_the_prefill_budget() {
        for entry in catalog().entries() {
            assert!(
                entry.synopsis.chars().count() <= SYNOPSIS_CHAR_CAP,
                "{} synopsis over cap",
                entry.name
            );
        }
    }

    #[test]
    fn positionals_parse_in_all_four_spellings() {
        let g: Grammar = serde_json::from_str(r#"{"positionals":"free"}"#).unwrap();
        assert_eq!(g.positionals, Positionals::Kind(PositionalKind::Free));
        let g: Grammar = serde_json::from_str(r#"{"positionals":"none"}"#).unwrap();
        assert_eq!(g.positionals, Positionals::Kind(PositionalKind::None));
        let g: Grammar = serde_json::from_str(r#"{"positionals":"files"}"#).unwrap();
        assert_eq!(g.positionals, Positionals::Kind(PositionalKind::Files));
        let g: Grammar = serde_json::from_str(r#"{"positionals":{"enum":["a","b"]}}"#).unwrap();
        assert_eq!(
            g.positionals.verdict("a", None),
            PositionalVerdict::Confirmed
        );
        assert_eq!(
            g.positionals.verdict("c", None),
            PositionalVerdict::Unconfirmed
        );
    }

    #[test]
    fn an_omitted_positional_policy_is_free() {
        let g: Grammar = serde_json::from_str(r#"{"flags":["-x"]}"#).unwrap();
        assert_eq!(
            g.positionals.verdict("anything", None),
            PositionalVerdict::Free
        );
    }

    #[test]
    fn a_files_positional_is_confirmed_only_by_an_existing_path() {
        let g: Grammar = serde_json::from_str(r#"{"positionals":"files"}"#).unwrap();
        let dir = std::env::temp_dir();
        let name = format!("tuggram-files-positional-{}", std::process::id());
        std::fs::write(dir.join(&name), b"x").unwrap();

        assert_eq!(
            g.positionals.verdict(&name, Some(&dir)),
            PositionalVerdict::Confirmed
        );
        // A directory counts: `ls src` names a real path.
        assert_eq!(
            g.positionals.verdict(".", Some(&dir)),
            PositionalVerdict::Confirmed
        );
        assert_eq!(
            g.positionals.verdict("no-such-file", Some(&dir)),
            PositionalVerdict::Unconfirmed
        );
        // No cwd means nothing to resolve a relative path against.
        assert_eq!(
            g.positionals.verdict(&name, None),
            PositionalVerdict::Unconfirmed
        );
        // A glob is not the token that reaches the program, so no stat speaks
        // for it — even when a file of that literal name happens to exist.
        assert_eq!(
            g.positionals.verdict("*.rs", Some(&dir)),
            PositionalVerdict::Unconfirmed
        );

        std::fs::remove_file(dir.join(&name)).unwrap();
    }

    #[test]
    fn integrity_rejects_a_value_flag_that_is_not_a_flag() {
        let json = r#"{"commands":[{"name":"x","source":"curated","synopsis":"s",
            "flags":["-a"],"value_flags":["-b"]}]}"#;
        let err = Catalog::parse(json).unwrap().check_integrity().unwrap_err();
        assert!(err.contains("value_flag"), "{err}");
    }

    #[test]
    fn integrity_rejects_an_over_cap_synopsis() {
        let long = "x".repeat(SYNOPSIS_CHAR_CAP + 1);
        let json = format!(
            r#"{{"commands":[{{"name":"x","source":"curated","synopsis":"{long}","flags":["-a"]}}]}}"#
        );
        let err = Catalog::parse(&json)
            .unwrap()
            .check_integrity()
            .unwrap_err();
        assert!(err.contains("cap"), "{err}");
    }

    #[test]
    fn integrity_rejects_an_entry_with_nothing_to_check_against() {
        let json = r#"{"commands":[{"name":"x","source":"curated","synopsis":"s"}]}"#;
        let err = Catalog::parse(json).unwrap().check_integrity().unwrap_err();
        assert!(err.contains("no grammar payload"), "{err}");
    }

    #[test]
    fn parse_rejects_a_duplicated_name() {
        let json = r#"{"commands":[
            {"name":"x","source":"curated","synopsis":"s","flags":["-a"]},
            {"name":"x","source":"man","synopsis":"s","flags":["-b"]}]}"#;
        assert!(Catalog::parse(json).unwrap_err().contains("duplicate"));
    }
}
