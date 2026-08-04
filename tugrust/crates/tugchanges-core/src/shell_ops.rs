//! A conservative grammar for the file operations a shell command **declares**.
//!
//! A Bash command that says `rm src/a.ts` names its file in the tool input, the
//! same way `Write`'s `file_path` does — that is proof-class evidence, unlike a
//! whole-tree fingerprint delta which cannot separate this session's write from
//! a build's churn or the user's hand-save. This module is what turns the
//! command text into that evidence, and it is deliberately timid: anything it
//! cannot read with certainty (variables, substitutions, globs, control flow)
//! refuses rather than guesses. The failure direction is always "stays a
//! bracket hint", never a wrong proof row.
//!
//! Pure functions only — no filesystem, no git, no canonicalization. Operands
//! are resolved lexically against `base_dir` (plus any leading literal `cd`);
//! consumers that join against canonical-space keys canonicalize at the join.
//!
//! Two consumers share it so the grammar cannot fork: tugcast's relay (live and
//! replay minting) and `tugutil file gate` (the PreToolUse hook's decision).

use std::path::{Component, Path, PathBuf};

/// What a declared operation does to its path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeclaredKind {
    Remove,
    /// The path is the destination; `orig` is where the file came from.
    Move {
        orig: PathBuf,
    },
    Copy,
    EditInPlace,
    WriteTarget,
    Touch,
}

/// One file operation a command literally declared. `path` is absolute but not
/// canonical.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeclaredOp {
    pub kind: DeclaredKind,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseOutcome {
    /// At least one literal file operation, and nothing was refused.
    Ops(Vec<DeclaredOp>),
    /// Parsed fine; nothing file-mutating that this grammar reads.
    NoFileOps,
    /// A file-mutating command is present with operands this grammar cannot
    /// resolve — the gate's deny signal. Refusal wins over any sibling
    /// command's ops on the same line: minting nothing is the safe direction,
    /// and the gate steers the whole line to `tugutil file`.
    Unparseable {
        reason: String,
        /// Which verb covers what refused. The grammar knows, and the gate
        /// would otherwise have to guess — steering a refused `perl -i` at
        /// `rm|mv|cp` teaches the wrong lesson.
        suggest: Suggestion,
    },
}

/// The `tugutil file` verb that covers a refused command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Suggestion {
    /// An `rm`/`mv`-class lifecycle operation — files removed, renamed, copied.
    Lifecycle,
    /// An in-place editor rewriting file contents.
    Edit,
}

/// Parse `command` into the file operations it declares, resolving relative
/// operands against `base_dir`.
pub fn parse_shell_ops(command: &str, base_dir: &Path) -> ParseOutcome {
    let stripped = strip_heredoc_bodies(command);
    let tokens = tokenize(&stripped);
    let mut cwd: Option<PathBuf> = Some(base_dir.to_path_buf());
    let mut ops: Vec<DeclaredOp> = Vec::new();

    for segment in split_segments(&tokens) {
        match parse_segment(&segment, &mut cwd) {
            SegmentOutcome::Ops(mut segment_ops) => ops.append(&mut segment_ops),
            SegmentOutcome::Nothing => {}
            SegmentOutcome::Refuse(reason, suggest) => {
                return ParseOutcome::Unparseable { reason, suggest };
            }
        }
    }

    if ops.is_empty() {
        ParseOutcome::NoFileOps
    } else {
        ParseOutcome::Ops(ops)
    }
}

// ---------------------------------------------------------------------------
// Heredocs
// ---------------------------------------------------------------------------

/// Drop heredoc bodies (and their terminators) before anything else looks at
/// the text — a body is data, and `rm` inside one deletes nothing. The `<<WORD`
/// operator itself stays on its line so the command around it (notably the
/// `cat > path <<'EOF'` idiom's redirect target) still parses.
fn strip_heredoc_bodies(command: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut pending: Vec<String> = Vec::new();
    let mut active: Option<String> = None;

    for line in command.lines() {
        if let Some(delim) = &active {
            if line.trim_end() == delim.as_str() || line.trim() == delim.as_str() {
                active = if pending.is_empty() {
                    None
                } else {
                    Some(pending.remove(0))
                };
            }
            continue;
        }
        out.push(line);
        pending = heredoc_delimiters(line);
        if !pending.is_empty() {
            active = Some(pending.remove(0));
        }
    }
    out.join("\n")
}

/// The heredoc delimiters a single line opens, in order. Quote-aware so a `<<`
/// inside a string is not mistaken for a heredoc; `<<<` (here-string) opens no
/// body.
fn heredoc_delimiters(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut delims = Vec::new();
    let mut i = 0;
    let mut quote: Option<char> = None;

    while i < chars.len() {
        let c = chars[i];
        match quote {
            Some(q) => {
                if c == '\\' && q == '"' {
                    i += 2;
                    continue;
                }
                if c == q {
                    quote = None;
                }
                i += 1;
            }
            None => {
                if c == '\\' {
                    i += 2;
                    continue;
                }
                if c == '\'' || c == '"' {
                    quote = Some(c);
                    i += 1;
                    continue;
                }
                if c == '<' && i + 1 < chars.len() && chars[i + 1] == '<' {
                    if i + 2 < chars.len() && chars[i + 2] == '<' {
                        i += 3;
                        continue;
                    }
                    i += 2;
                    if i < chars.len() && chars[i] == '-' {
                        i += 1;
                    }
                    while i < chars.len() && chars[i].is_whitespace() {
                        i += 1;
                    }
                    let mut delim = String::new();
                    let mut inner: Option<char> = None;
                    while i < chars.len() {
                        let d = chars[i];
                        match inner {
                            Some(q) if d == q => inner = None,
                            Some(_) => delim.push(d),
                            None if d == '\'' || d == '"' => inner = Some(d),
                            None if d.is_whitespace() => break,
                            None if d == '\\' => {
                                i += 1;
                                if i < chars.len() {
                                    delim.push(chars[i]);
                                }
                            }
                            None => delim.push(d),
                        }
                        i += 1;
                    }
                    if !delim.is_empty() {
                        delims.push(delim);
                    }
                    continue;
                }
                i += 1;
            }
        }
    }
    delims
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct Word {
    text: String,
    /// False when the shell would expand the word: an unquoted `$`, backtick,
    /// glob metacharacter, brace expansion, or leading `~`.
    literal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Tok {
    Word(Word),
    /// `>` / `>>` / `N>` / `&>` — the following word is the target.
    Out {
        append: bool,
    },
    /// `<` / `<<` / `<<<` — the following word is consumed and ignored.
    In,
    /// A redirect that duplicates a descriptor (`>&2`, `2>&1`).
    DupOut,
    Sep,
}

fn tokenize(command: &str) -> Vec<Tok> {
    let chars: Vec<char> = command.chars().collect();
    let mut toks: Vec<Tok> = Vec::new();
    let mut buf = String::new();
    let mut literal = true;
    let mut started = false;
    let mut i = 0;

    macro_rules! flush {
        () => {
            if started {
                toks.push(Tok::Word(Word {
                    text: std::mem::take(&mut buf),
                    literal,
                }));
                literal = true;
                started = false;
            }
        };
    }

    while i < chars.len() {
        let c = chars[i];
        match c {
            '\\' => {
                i += 1;
                if i < chars.len() {
                    if chars[i] != '\n' {
                        buf.push(chars[i]);
                        started = true;
                    }
                    i += 1;
                }
            }
            '\'' => {
                started = true;
                i += 1;
                while i < chars.len() && chars[i] != '\'' {
                    buf.push(chars[i]);
                    i += 1;
                }
                i += 1;
            }
            '"' => {
                started = true;
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    if chars[i] == '\\' && i + 1 < chars.len() {
                        buf.push(chars[i + 1]);
                        i += 2;
                        continue;
                    }
                    if chars[i] == '$' || chars[i] == '`' {
                        literal = false;
                    }
                    buf.push(chars[i]);
                    i += 1;
                }
                i += 1;
            }
            c if c.is_whitespace() && c != '\n' => {
                flush!();
                i += 1;
            }
            '\n' | ';' | '&' | '|' | '>' | '<' | '(' | ')' => {
                // A bare fd number in front of a redirect is a descriptor, not a word.
                let fd_prefix = (c == '>' || c == '<')
                    && started
                    && !buf.is_empty()
                    && buf.chars().all(|d| d.is_ascii_digit());
                if fd_prefix {
                    buf.clear();
                    started = false;
                } else {
                    flush!();
                }
                match c {
                    '>' => {
                        let append = chars.get(i + 1) == Some(&'>');
                        i += if append { 2 } else { 1 };
                        if chars.get(i) == Some(&'&') {
                            i += 1;
                            toks.push(Tok::DupOut);
                        } else {
                            toks.push(Tok::Out { append });
                        }
                    }
                    '<' => {
                        while chars.get(i) == Some(&'<') {
                            i += 1;
                        }
                        if chars.get(i) == Some(&'-') {
                            i += 1;
                        }
                        toks.push(Tok::In);
                    }
                    '&' => {
                        if chars.get(i + 1) == Some(&'>') {
                            let append = chars.get(i + 2) == Some(&'>');
                            i += if append { 3 } else { 2 };
                            toks.push(Tok::Out { append });
                        } else {
                            while chars.get(i) == Some(&'&') {
                                i += 1;
                            }
                            toks.push(Tok::Sep);
                        }
                    }
                    _ => {
                        while matches!(chars.get(i), Some(';') | Some('|') | Some('\n')) {
                            i += 1;
                        }
                        if c == '(' || c == ')' {
                            i += 1;
                        }
                        toks.push(Tok::Sep);
                    }
                }
            }
            _ => {
                if matches!(c, '$' | '`' | '*' | '?' | '[' | '{') {
                    literal = false;
                }
                if c == '~' && !started {
                    literal = false;
                }
                buf.push(c);
                started = true;
                i += 1;
            }
        }
    }
    if started {
        toks.push(Tok::Word(Word { text: buf, literal }));
    }
    toks
}

fn split_segments(tokens: &[Tok]) -> Vec<Vec<Tok>> {
    let mut out = Vec::new();
    let mut current = Vec::new();
    for tok in tokens {
        if matches!(tok, Tok::Sep) {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
        } else {
            current.push(tok.clone());
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

// ---------------------------------------------------------------------------
// Segment parsing
// ---------------------------------------------------------------------------

enum SegmentOutcome {
    Ops(Vec<DeclaredOp>),
    Nothing,
    Refuse(String, Suggestion),
}

/// Command words whose presence means an rm/mv-class operation is happening
/// somewhere in this segment even if it isn't the head (`xargs rm`, `-exec rm`).
const LIFECYCLE_WORDS: [&str; 2] = ["rm", "mv"];

/// Heads whose operands live outside the command text entirely.
const OPAQUE_HEADS: [&str; 9] = [
    "xargs", "find", "for", "while", "until", "if", "case", "select", "eval",
];

fn parse_segment(tokens: &[Tok], cwd: &mut Option<PathBuf>) -> SegmentOutcome {
    let mut ops: Vec<DeclaredOp> = Vec::new();

    // Redirect targets are a file operation on any head at all.
    let mut i = 0;
    let mut words: Vec<&Word> = Vec::new();
    while i < tokens.len() {
        match &tokens[i] {
            Tok::Word(w) => words.push(w),
            Tok::Out { .. } => {
                if let Some(Tok::Word(target)) = tokens.get(i + 1) {
                    if target.literal && !is_pseudo_device(&target.text) {
                        if let Some(path) = resolve(cwd, &target.text) {
                            ops.push(DeclaredOp {
                                kind: DeclaredKind::WriteTarget,
                                path,
                            });
                        }
                    }
                    i += 1;
                }
            }
            Tok::In => {
                i += 1;
            }
            Tok::DupOut | Tok::Sep => {}
        }
        i += 1;
    }

    let words = strip_command_prefixes(&words);
    let Some(head) = words.first() else {
        return finish(ops);
    };

    let lifecycle_present = words
        .iter()
        .any(|w| LIFECYCLE_WORDS.contains(&w.text.as_str()));

    if OPAQUE_HEADS.contains(&head.text.as_str()) || words.iter().any(|w| w.text == "-exec") {
        return if lifecycle_present {
            SegmentOutcome::Refuse(
                format!(
                    "`{}` runs a file-lifecycle command whose operands are not in the command text",
                    head.text
                ),
                Suggestion::Lifecycle,
            )
        } else {
            finish(ops)
        };
    }

    let rest = &words[1..];
    match head.text.as_str() {
        "cd" => {
            match rest.first() {
                Some(w) if w.literal => *cwd = resolve(cwd, &w.text),
                Some(_) => *cwd = None,
                None => {}
            }
            finish(ops)
        }
        "rm" => match operands(rest, cwd, &["-"]) {
            Ok(paths) => {
                ops.extend(paths.into_iter().map(|path| DeclaredOp {
                    kind: DeclaredKind::Remove,
                    path,
                }));
                finish(ops)
            }
            Err(reason) => SegmentOutcome::Refuse(reason, Suggestion::Lifecycle),
        },
        "mv" | "cp" => match operands(rest, cwd, &["-"]) {
            Ok(paths) => {
                let raw = literal_operands(rest);
                match transfer_ops(&paths, &raw, head.text == "mv") {
                    Some(mut moved) => {
                        ops.append(&mut moved);
                        finish(ops)
                    }
                    None => finish(ops),
                }
            }
            Err(reason) if head.text == "mv" => {
                SegmentOutcome::Refuse(reason, Suggestion::Lifecycle)
            }
            Err(_) => finish(ops),
        },
        "touch" => {
            let paths = operands(rest, cwd, &["-"]).unwrap_or_default();
            ops.extend(paths.into_iter().map(|path| DeclaredOp {
                kind: DeclaredKind::Touch,
                path,
            }));
            finish(ops)
        }
        "tee" => {
            let paths = operands(rest, cwd, &["-"]).unwrap_or_default();
            ops.extend(paths.into_iter().map(|path| DeclaredOp {
                kind: DeclaredKind::WriteTarget,
                path,
            }));
            finish(ops)
        }
        "sed" | "perl" | "ruby" => match in_place_editor_ops(head.text.as_str(), rest, cwd) {
            Ok(mut edits) => {
                ops.append(&mut edits);
                finish(ops)
            }
            Err(reason) => SegmentOutcome::Refuse(reason, Suggestion::Edit),
        },
        "git" => git_ops(rest, cwd, ops),
        // The verbs report their own outcome in a receipt, which covers the glob
        // and variable operands this grammar refuses — so the gate must never
        // deny them, and there is nothing here worth guessing at.
        "tugutil" | "tug" => finish(ops),
        _ => finish(ops),
    }
}

fn finish(ops: Vec<DeclaredOp>) -> SegmentOutcome {
    if ops.is_empty() {
        SegmentOutcome::Nothing
    } else {
        SegmentOutcome::Ops(ops)
    }
}

/// Drop `VAR=value` assignments, transparent wrappers, and the block keywords
/// that precede a command inside a compound (`do`, `then`, …) ahead of the real
/// head — a `rm "$f"` inside a loop body must still be seen as an `rm`.
fn strip_command_prefixes<'a>(words: &[&'a Word]) -> Vec<&'a Word> {
    let mut i = 0;
    while i < words.len() {
        let w = words[i];
        let assignment = w
            .text
            .split_once('=')
            .is_some_and(|(name, _)| !name.is_empty() && name.chars().all(is_name_char));
        if assignment
            || matches!(
                w.text.as_str(),
                "sudo" | "command" | "nohup" | "time" | "env" | "do" | "then" | "else" | "elif"
            )
        {
            i += 1;
            continue;
        }
        break;
    }
    words[i..].to_vec()
}

fn is_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_pseudo_device(target: &str) -> bool {
    target.starts_with("/dev/")
}

/// The non-flag operands of a command, resolved absolute. `Err` when any operand
/// is non-literal — the caller decides whether that refuses the command.
fn operands(
    words: &[&Word],
    cwd: &Option<PathBuf>,
    flag_prefixes: &[&str],
) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut end_of_flags = false;
    for w in words {
        if !end_of_flags && w.text == "--" {
            end_of_flags = true;
            continue;
        }
        if !end_of_flags && flag_prefixes.iter().any(|p| w.text.starts_with(p)) && w.text != "-" {
            continue;
        }
        if !w.literal {
            return Err(format!("operand `{}` is not a literal path", w.text));
        }
        if w.text.is_empty() {
            continue;
        }
        match resolve(cwd, &w.text) {
            Some(path) => out.push(path),
            None => return Err("the working directory is not statically known".to_string()),
        }
    }
    Ok(out)
}

fn literal_operands<'a>(words: &[&'a Word]) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut end_of_flags = false;
    for w in words {
        if !end_of_flags && w.text == "--" {
            end_of_flags = true;
            continue;
        }
        if !end_of_flags && w.text.starts_with('-') && w.text != "-" {
            continue;
        }
        if w.text.is_empty() {
            continue;
        }
        out.push(w.text.as_str());
    }
    out
}

/// `mv`/`cp`/`git mv` operand shape: the last operand is the destination, and
/// more than two operands means the destination is a directory each source
/// lands inside.
fn transfer_ops(paths: &[PathBuf], raw: &[&str], is_move: bool) -> Option<Vec<DeclaredOp>> {
    if paths.len() < 2 {
        return None;
    }
    let (dest, sources) = paths.split_last()?;
    let mut ops = Vec::new();
    for (idx, src) in sources.iter().enumerate() {
        let target = if sources.len() > 1 {
            let name = raw
                .get(idx)
                .and_then(|r| Path::new(r).file_name())
                .or_else(|| src.file_name())?;
            dest.join(name)
        } else {
            dest.clone()
        };
        ops.push(DeclaredOp {
            kind: if is_move {
                DeclaredKind::Move { orig: src.clone() }
            } else {
                DeclaredKind::Copy
            },
            path: target,
        });
    }
    Some(ops)
}

/// What a flag word means to an in-place editor's operand scan.
enum EditorFlag {
    /// In-place editing is on. `suffix_follows` for the BSD `sed` form, which
    /// takes its backup suffix as a separate operand.
    InPlace { suffix_follows: bool },
    /// The flag supplies the script; `inline` when the script text came attached
    /// to the flag rather than as the next word.
    Script { inline: bool },
    /// Anything else — carries no operand of its own.
    Plain,
}

fn scan_editor_flag(verb: &str, text: &str) -> EditorFlag {
    if verb == "sed" {
        return match text {
            "-i" => EditorFlag::InPlace {
                suffix_follows: true,
            },
            "-e" | "-f" => EditorFlag::Script { inline: false },
            t if t.starts_with("-i") => EditorFlag::InPlace {
                suffix_follows: false,
            },
            _ => EditorFlag::Plain,
        };
    }

    // A long option is never a cluster. Reading one as a cluster is a
    // false-proof source, not a missed row: `ruby --disable=gems x.rb data.txt`
    // has an `i` in `--disable`, which would turn on in-place editing and
    // declare `data.txt` as rewritten by a script that only read it.
    if text.starts_with("--") {
        return EditorFlag::Plain;
    }

    // `perl` and `ruby` cluster their single-letter switches. `-i` swallows the
    // rest of its cluster as the backup suffix, so `-i.bak`, `-pi` and `-0pi`
    // all read the same. `-e`/`-E` take the program either attached or as the
    // next word. A switch that swallows its own argument ends the scan.
    for (offset, c) in text.char_indices().skip(1) {
        match c {
            'i' => {
                return EditorFlag::InPlace {
                    suffix_follows: false,
                };
            }
            'e' | 'E' => {
                return EditorFlag::Script {
                    inline: offset + c.len_utf8() < text.len(),
                };
            }
            'M' | 'm' | 'F' | 'I' | 'x' => return EditorFlag::Plain,
            _ => {}
        }
    }
    EditorFlag::Plain
}

/// The in-place editors — `sed -i`, `perl -i`, `ruby -i` — name the files they
/// rewrite in the command text, which is the same standing `rm`'s operands have.
/// The verbs differ only in how their flags consume the script, so the flag scan
/// branches on the verb and the operand handling is shared.
///
/// The script operand is never a path — a regex is full of glob characters — so
/// it is dropped before literalness matters. A file operand that is *not* a
/// literal path refuses the whole command: the editor is provably rewriting
/// something the grammar cannot name.
fn in_place_editor_ops(
    verb: &str,
    words: &[&Word],
    cwd: &Option<PathBuf>,
) -> Result<Vec<DeclaredOp>, String> {
    let mut in_place = false;
    let mut have_expr = false;
    let mut operands: Vec<&Word> = Vec::new();
    let mut idx = 0;

    while idx < words.len() {
        let w = words[idx];
        if w.text.starts_with('-') && w.text != "-" {
            match scan_editor_flag(verb, &w.text) {
                EditorFlag::InPlace { suffix_follows } => {
                    in_place = true;
                    if suffix_follows {
                        if let Some(next) = words.get(idx + 1) {
                            if next.text.is_empty() || next.text.starts_with('.') {
                                idx += 2;
                                continue;
                            }
                        }
                    }
                }
                EditorFlag::Script { inline } => {
                    have_expr = true;
                    if !inline {
                        idx += 2;
                        continue;
                    }
                }
                EditorFlag::Plain => {}
            }
        } else if !have_expr {
            // Absent a script flag, the first non-flag operand is the script and
            // everything after it is a file.
            have_expr = true;
        } else {
            operands.push(w);
        }
        idx += 1;
    }

    if !in_place {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for w in operands {
        if w.text.is_empty() {
            continue;
        }
        if !w.literal {
            return Err(format!(
                "`{verb} -i` rewrites operand `{}`, which is not a literal path",
                w.text
            ));
        }
        match resolve(cwd, &w.text) {
            Some(path) => out.push(DeclaredOp {
                kind: DeclaredKind::EditInPlace,
                path,
            }),
            None => return Err("the working directory is not statically known".to_string()),
        }
    }
    Ok(out)
}

fn git_ops(words: &[&Word], cwd: &Option<PathBuf>, mut ops: Vec<DeclaredOp>) -> SegmentOutcome {
    // Skip global options (`-C dir` is a working-directory change we can follow).
    let mut cwd = cwd.clone();
    let mut idx = 0;
    while let Some(w) = words.get(idx) {
        match w.text.as_str() {
            "-C" => {
                match words.get(idx + 1) {
                    Some(dir) if dir.literal => cwd = resolve(&cwd, &dir.text),
                    _ => cwd = None,
                }
                idx += 2;
            }
            "-c" => idx += 2,
            t if t.starts_with('-') => idx += 1,
            _ => break,
        }
    }
    let Some(subcommand) = words.get(idx) else {
        return finish(ops);
    };
    let rest = &words[idx + 1..];

    match subcommand.text.as_str() {
        "rm" => match operands(rest, &cwd, &["-"]) {
            Ok(paths) => {
                ops.extend(paths.into_iter().map(|path| DeclaredOp {
                    kind: DeclaredKind::Remove,
                    path,
                }));
                finish(ops)
            }
            Err(reason) => SegmentOutcome::Refuse(reason, Suggestion::Lifecycle),
        },
        "mv" => match operands(rest, &cwd, &["-"]) {
            Ok(paths) => {
                let raw = literal_operands(rest);
                if let Some(mut moved) = transfer_ops(&paths, &raw, true) {
                    ops.append(&mut moved);
                }
                finish(ops)
            }
            Err(reason) => SegmentOutcome::Refuse(reason, Suggestion::Lifecycle),
        },
        "restore" => {
            let paths = operands(rest, &cwd, &["-"]).unwrap_or_default();
            ops.extend(paths.into_iter().map(|path| DeclaredOp {
                kind: DeclaredKind::EditInPlace,
                path,
            }));
            finish(ops)
        }
        // Only the pathspec form of `checkout` touches files predictably; a
        // branch checkout names no files at all.
        "checkout" => {
            let Some(sep) = rest.iter().position(|w| w.text == "--") else {
                return finish(ops);
            };
            let paths = operands(&rest[sep + 1..], &cwd, &[]).unwrap_or_default();
            ops.extend(paths.into_iter().map(|path| DeclaredOp {
                kind: DeclaredKind::EditInPlace,
                path,
            }));
            finish(ops)
        }
        _ => finish(ops),
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

fn resolve(cwd: &Option<PathBuf>, operand: &str) -> Option<PathBuf> {
    let raw = Path::new(operand);
    let joined = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        cwd.as_ref()?.join(raw)
    };
    Some(lexical_normalize(&joined))
}

/// Collapse `.` and `..` without touching the filesystem (the module is pure;
/// symlink-correct resolution is the consumer's job at the canonical join).
fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    if out.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PathBuf {
        PathBuf::from("/repo")
    }

    fn ops(command: &str) -> Vec<DeclaredOp> {
        match parse_shell_ops(command, &base()) {
            ParseOutcome::Ops(ops) => ops,
            other => panic!("expected ops for `{command}`, got {other:?}"),
        }
    }

    fn assert_no_file_ops(command: &str) {
        assert_eq!(
            parse_shell_ops(command, &base()),
            ParseOutcome::NoFileOps,
            "`{command}` should declare nothing"
        );
    }

    fn assert_refused(command: &str) {
        match parse_shell_ops(command, &base()) {
            ParseOutcome::Unparseable { .. } => {}
            other => panic!("expected refusal for `{command}`, got {other:?}"),
        }
    }

    #[test]
    fn literal_rm_declares_each_path() {
        assert_eq!(
            ops("rm -f src/a.ts src/b.ts"),
            vec![
                DeclaredOp {
                    kind: DeclaredKind::Remove,
                    path: PathBuf::from("/repo/src/a.ts")
                },
                DeclaredOp {
                    kind: DeclaredKind::Remove,
                    path: PathBuf::from("/repo/src/b.ts")
                },
            ]
        );
    }

    #[test]
    fn a_leading_cd_moves_the_resolution_base() {
        assert_eq!(
            ops("cd tugrust && rm ./target/x.rs"),
            vec![DeclaredOp {
                kind: DeclaredKind::Remove,
                path: PathBuf::from("/repo/tugrust/target/x.rs")
            }]
        );
    }

    #[test]
    fn a_recursive_rm_declares_the_directory() {
        assert_eq!(
            ops("rm -rf build/out"),
            vec![DeclaredOp {
                kind: DeclaredKind::Remove,
                path: PathBuf::from("/repo/build/out")
            }]
        );
    }

    #[test]
    fn globs_and_variables_refuse_lifecycle_commands() {
        assert_refused("rm -rf apptest-*");
        assert_refused("rm \"$WT/scratch.txt\"");
        assert_refused("mv \"$LOG\" \"$LOG.bak\"");
        assert_refused("rm $(ls | head -1)");
        assert_refused("git rm src/*.ts");
        assert_refused("cd \"$DIR\" && rm a.ts");
    }

    #[test]
    fn a_refusal_suppresses_its_siblings_ops() {
        assert_refused("rm a.ts && rm $B");
    }

    #[test]
    fn opaque_operand_sources_refuse() {
        assert_refused("grep -rl foo . | xargs rm");
        assert_refused("find . -name '*.tmp' -exec rm {} \\;");
        assert_refused("for f in a b; do rm $f; done");
    }

    #[test]
    fn a_quoted_mention_is_not_a_command() {
        assert_no_file_ops("tugutil dash commit d --message \"git mv a b\"");
        assert_no_file_ops("git commit -m 'rm the old file'");
        assert_no_file_ops("grep rm foo.txt");
    }

    #[test]
    fn a_quoted_glob_is_a_literal_name() {
        assert_eq!(
            ops("rm 'weird*name'"),
            vec![DeclaredOp {
                kind: DeclaredKind::Remove,
                path: PathBuf::from("/repo/weird*name")
            }]
        );
    }

    #[test]
    fn git_mv_declares_a_move_with_its_origin() {
        assert_eq!(
            ops("git mv src/old.rs src/new.rs"),
            vec![DeclaredOp {
                kind: DeclaredKind::Move {
                    orig: PathBuf::from("/repo/src/old.rs")
                },
                path: PathBuf::from("/repo/src/new.rs")
            }]
        );
    }

    #[test]
    fn a_multi_source_move_lands_each_source_in_the_destination() {
        assert_eq!(
            ops("mv a.rs b.rs dst"),
            vec![
                DeclaredOp {
                    kind: DeclaredKind::Move {
                        orig: PathBuf::from("/repo/a.rs")
                    },
                    path: PathBuf::from("/repo/dst/a.rs")
                },
                DeclaredOp {
                    kind: DeclaredKind::Move {
                        orig: PathBuf::from("/repo/b.rs")
                    },
                    path: PathBuf::from("/repo/dst/b.rs")
                },
            ]
        );
    }

    #[test]
    fn git_rm_cached_still_declares_the_path() {
        assert_eq!(
            ops("git rm --cached -r docs/notes.md"),
            vec![DeclaredOp {
                kind: DeclaredKind::Remove,
                path: PathBuf::from("/repo/docs/notes.md")
            }]
        );
    }

    #[test]
    fn git_c_dir_changes_the_resolution_base() {
        assert_eq!(
            ops("git -C sub rm a.ts"),
            vec![DeclaredOp {
                kind: DeclaredKind::Remove,
                path: PathBuf::from("/repo/sub/a.ts")
            }]
        );
    }

    #[test]
    fn git_restore_and_checkout_pathspecs_are_in_place_edits() {
        assert_eq!(
            ops("git restore src/a.ts"),
            vec![DeclaredOp {
                kind: DeclaredKind::EditInPlace,
                path: PathBuf::from("/repo/src/a.ts")
            }]
        );
        assert_eq!(
            ops("git checkout -- src/a.ts src/b.ts")
                .into_iter()
                .map(|op| op.path)
                .collect::<Vec<_>>(),
            vec![
                PathBuf::from("/repo/src/a.ts"),
                PathBuf::from("/repo/src/b.ts")
            ]
        );
        assert_no_file_ops("git checkout main");
    }

    #[test]
    fn redirection_declares_its_target() {
        assert_eq!(
            ops("cat > notes/out.txt <<'EOF'\nrm everything\nEOF"),
            vec![DeclaredOp {
                kind: DeclaredKind::WriteTarget,
                path: PathBuf::from("/repo/notes/out.txt")
            }]
        );
        assert_eq!(
            ops("echo hi >> log.txt")[0].path,
            PathBuf::from("/repo/log.txt")
        );
    }

    #[test]
    fn a_heredoc_body_is_data_not_commands() {
        assert_no_file_ops("python3 - <<'EOF'\nimport os\nos.remove('x')\nEOF");
        assert_no_file_ops("cat <<'EOF' > /dev/null\nrm -rf /\nEOF");
    }

    #[test]
    fn pseudo_devices_and_descriptor_dups_are_not_targets() {
        assert_no_file_ops("cargo build > /dev/null 2>&1");
        assert_no_file_ops("echo hi >&2");
    }

    #[test]
    fn sed_in_place_declares_each_file_operand() {
        assert_eq!(
            ops("sed -i '' 's/a*/b/' f1.rs f2.rs")
                .into_iter()
                .map(|op| op.path)
                .collect::<Vec<_>>(),
            vec![PathBuf::from("/repo/f1.rs"), PathBuf::from("/repo/f2.rs")]
        );
        assert_eq!(
            ops("sed -i.bak -e 's/a/b/' f1.rs")[0].path,
            PathBuf::from("/repo/f1.rs")
        );
        assert_no_file_ops("sed -n '1,5p' f1.rs");
        assert_refused("sed -i '' 's/a/b/' src/*.ts");
    }

    #[test]
    fn perl_in_place_declares_each_file_operand() {
        assert_eq!(
            ops("perl -i -pe 's/a/b/' src/x.ts"),
            vec![DeclaredOp {
                kind: DeclaredKind::EditInPlace,
                path: PathBuf::from("/repo/src/x.ts")
            }]
        );
        assert_eq!(
            ops("perl -0pi -e 's/a/b/' src/x.ts")[0].path,
            PathBuf::from("/repo/src/x.ts")
        );
        assert_eq!(
            ops("perl -pi -e 's/a/b/' a.ts b.ts")
                .into_iter()
                .map(|op| op.path)
                .collect::<Vec<_>>(),
            vec![PathBuf::from("/repo/a.ts"), PathBuf::from("/repo/b.ts")]
        );
        assert_eq!(
            ops("perl -i.bak -pe 's/a/b/' src/x.ts"),
            vec![DeclaredOp {
                kind: DeclaredKind::EditInPlace,
                path: PathBuf::from("/repo/src/x.ts")
            }]
        );
        assert_eq!(
            ops("ruby -i -pe 'gsub(/a/, \"b\")' src/x.ts")[0].path,
            PathBuf::from("/repo/src/x.ts")
        );
    }

    #[test]
    fn an_in_place_edit_whose_files_cannot_be_named_refuses() {
        assert_refused("perl -i -pe 's/a/b/' src/*.ts");
        assert_refused("perl -i -pe 's/a/b/' \"$F\"");
        assert_refused("ruby -i -pe 'x' src/*.ts");
    }

    #[test]
    fn a_long_option_is_never_read_as_a_switch_cluster() {
        // `--disable` contains an `i`. Read as a cluster it turns on in-place
        // editing, and the operand of a read-only script becomes a proof row
        // claiming the script rewrote it — a wrong row, which costs more than
        // every missed row this grammar ever declines to mint.
        assert_no_file_ops("ruby --disable=gems script.rb data.txt");
        assert_no_file_ops("ruby --disable=gems script.rb src/*.ts");
        assert_no_file_ops("perl --version");
        // The real `-i` still reads, long options alongside it or not.
        assert_eq!(
            ops("perl --verbose -i -pe 's/a/b/' src/x.ts")[0].path,
            PathBuf::from("/repo/src/x.ts")
        );
    }

    #[test]
    fn an_editor_without_in_place_declares_nothing() {
        assert_no_file_ops("perl -e 'print 1'");
        assert_no_file_ops("perl -ne 'print if /x/' src/x.ts");
        assert_no_file_ops("perl -pe 's/a/b/' src/*.ts");
        assert_no_file_ops("ruby -e 'puts 1'");
    }

    #[test]
    fn tee_and_touch_declare_their_paths() {
        assert_eq!(
            ops("echo x | tee -a out.log")[0],
            DeclaredOp {
                kind: DeclaredKind::WriteTarget,
                path: PathBuf::from("/repo/out.log")
            }
        );
        assert_eq!(
            ops("touch new.txt")[0],
            DeclaredOp {
                kind: DeclaredKind::Touch,
                path: PathBuf::from("/repo/new.txt")
            }
        );
    }

    #[test]
    fn cp_declares_its_destination_only() {
        assert_eq!(
            ops("cp -r src/a.ts src/b.ts"),
            vec![DeclaredOp {
                kind: DeclaredKind::Copy,
                path: PathBuf::from("/repo/src/b.ts")
            }]
        );
    }

    #[test]
    fn a_non_literal_cp_degrades_instead_of_refusing() {
        assert_no_file_ops("cp $SRC dst.ts");
    }

    #[test]
    fn the_file_verbs_leave_proof_to_their_receipt() {
        assert_no_file_ops("tugutil file rm 'apptest-*'");
        assert_no_file_ops("tugutil file mv a.ts b.ts");
    }

    #[test]
    fn absolute_operands_ignore_the_base_directory() {
        assert_eq!(
            ops("rm /other/place/x.ts")[0].path,
            PathBuf::from("/other/place/x.ts")
        );
    }

    #[test]
    fn an_environment_prefix_does_not_hide_the_head() {
        assert_eq!(
            ops("FOO=1 sudo rm a.ts")[0].path,
            PathBuf::from("/repo/a.ts")
        );
    }
}
