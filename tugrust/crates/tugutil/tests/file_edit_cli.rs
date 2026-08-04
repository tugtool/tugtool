//! Integration tests for `tugutil file edit`, driving the built binary against
//! a real temp git repo.
//!
//! The contract under test is the receipt: exactly the files whose bytes moved,
//! named absolutely, in one line the relay can read. The relay side of that path
//! is already covered by `attribution.rs`'s own receipt tests, so nothing here
//! stands up a fake one.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use assert_cmd::cargo::CommandCargoExt;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("run git");
    assert!(out.status.success(), "git {args:?} failed");
}

fn init_repo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    git(&root, &["config", "user.email", "t@t.test"]);
    git(&root, &["config", "user.name", "t"]);
    std::fs::create_dir_all(root.join("src")).unwrap();
    std::fs::write(root.join("src/x.ts"), "const a = 1;\nconst b = 1;\n").unwrap();
    std::fs::write(root.join("src/y.ts"), "const c = 1;\n").unwrap();
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "-q", "-m", "init"]);
    (dir, root)
}

fn edit(root: &Path, args: &[&str]) -> Output {
    Command::cargo_bin("tugutil")
        .unwrap()
        .current_dir(root)
        .args(["file", "edit"])
        .args(args)
        .output()
        .expect("run tugutil")
}

/// The receipt's `ops` array, parsed out of the surrounding output the way the
/// relay parses it.
fn receipt_ops(out: &Output) -> Vec<serde_json::Value> {
    let stdout = String::from_utf8_lossy(&out.stdout);
    let line = stdout
        .lines()
        .find_map(|l| l.strip_prefix("TUG-FILE-RECEIPT: "))
        .unwrap_or_else(|| panic!("no receipt in output: {stdout}"));
    let parsed: serde_json::Value = serde_json::from_str(line).expect("receipt is valid json");
    parsed["ops"].as_array().expect("ops array").clone()
}

fn has_receipt(out: &Output) -> bool {
    String::from_utf8_lossy(&out.stdout).contains("TUG-FILE-RECEIPT")
}

#[test]
fn a_literal_substitution_edits_the_file_and_reports_one_modified_op() {
    let (_dir, root) = init_repo();
    let out = edit(
        &root,
        &[
            "--path",
            "src/x.ts",
            "--replace",
            "const a = 1;",
            "--with",
            "const a = 2;",
        ],
    );

    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(root.join("src/x.ts")).unwrap(),
        "const a = 2;\nconst b = 1;\n"
    );
    let ops = receipt_ops(&out);
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["op"], "modified");
    assert_eq!(
        ops[0]["path"].as_str().unwrap(),
        root.join("src/x.ts").to_string_lossy()
    );
}

#[test]
fn every_occurrence_goes_unless_count_bounds_it() {
    let (_dir, root) = init_repo();

    let out = edit(
        &root,
        &["--path", "src/x.ts", "--replace", "= 1;", "--with", "= 9;"],
    );
    assert!(out.status.success());
    assert_eq!(
        std::fs::read_to_string(root.join("src/x.ts")).unwrap(),
        "const a = 9;\nconst b = 9;\n"
    );

    std::fs::write(root.join("src/x.ts"), "const a = 1;\nconst b = 1;\n").unwrap();
    let out = edit(
        &root,
        &[
            "--path",
            "src/x.ts",
            "--replace",
            "= 1;",
            "--with",
            "= 9;",
            "--count",
            "1",
        ],
    );
    assert!(out.status.success());
    assert_eq!(
        std::fs::read_to_string(root.join("src/x.ts")).unwrap(),
        "const a = 9;\nconst b = 1;\n"
    );
}

#[test]
fn count_zero_is_refused_in_both_modes_rather_than_meaning_two_things() {
    let (_dir, root) = init_repo();
    let before = std::fs::read(root.join("src/x.ts")).unwrap();

    for extra in [vec![], vec!["--regex"]] {
        let mut args = extra.clone();
        args.extend_from_slice(&[
            "--path",
            "src/x.ts",
            "--replace",
            "= 1;",
            "--with",
            "= 9;",
            "--count",
            "0",
        ]);
        let out = edit(&root, &args);
        assert!(!out.status.success(), "--count 0 {extra:?} should refuse");
        assert!(!has_receipt(&out));
        // The regex path used to read 0 as "replace all" and silently rewrite
        // every occurrence — the opposite of what the flag asks for.
        assert_eq!(std::fs::read(root.join("src/x.ts")).unwrap(), before);
    }
}

#[test]
fn a_regex_substitution_supports_captures() {
    let (_dir, root) = init_repo();
    let out = edit(
        &root,
        &[
            "--regex",
            "--path",
            "src/x.ts",
            "--replace",
            r"const (\w+) = 1;",
            "--with",
            "let $1 = 2;",
        ],
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(root.join("src/x.ts")).unwrap(),
        "let a = 2;\nlet b = 2;\n"
    );
}

#[test]
fn a_substitution_that_matches_nothing_fails_and_testifies_to_nothing() {
    let (_dir, root) = init_repo();
    let before = std::fs::read(root.join("src/x.ts")).unwrap();

    let out = edit(
        &root,
        &[
            "--path",
            "src/x.ts",
            "--replace",
            "not in the file",
            "--with",
            "anything",
        ],
    );
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("no match"));
    assert!(!has_receipt(&out));
    assert_eq!(std::fs::read(root.join("src/x.ts")).unwrap(), before);
}

#[test]
fn a_multi_file_diff_reports_one_op_per_file_that_actually_moved() {
    let (_dir, root) = init_repo();
    let patch = root.join("p.diff");
    std::fs::write(
        &patch,
        "\
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,2 +1,2 @@
-const a = 1;
+const a = 2;
 const b = 1;
--- a/src/y.ts
+++ b/src/y.ts
@@ -1 +1 @@
-const c = 1;
+const c = 2;
",
    )
    .unwrap();

    let out = edit(&root, &["--patch", patch.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let ops = receipt_ops(&out);
    assert_eq!(ops.len(), 2);
    assert!(ops.iter().all(|op| op["op"] == "modified"));
    let mut paths: Vec<String> = ops
        .iter()
        .map(|op| op["path"].as_str().unwrap().to_string())
        .collect();
    paths.sort();
    assert_eq!(
        paths,
        vec![
            root.join("src/x.ts").to_string_lossy().to_string(),
            root.join("src/y.ts").to_string_lossy().to_string(),
        ]
    );
}

#[test]
fn a_patch_creating_a_file_reports_it_as_created() {
    let (_dir, root) = init_repo();
    let patch = root.join("p.diff");
    std::fs::write(
        &patch,
        "\
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+fresh
",
    )
    .unwrap();

    let out = edit(&root, &["--patch", patch.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let ops = receipt_ops(&out);
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["op"], "created");
    assert!(root.join("src/new.ts").exists());
}

#[test]
fn a_patch_that_does_not_apply_changes_nothing_and_testifies_to_nothing() {
    let (_dir, root) = init_repo();
    let before = std::fs::read(root.join("src/x.ts")).unwrap();
    let patch = root.join("p.diff");
    std::fs::write(
        &patch,
        "\
--- a/src/x.ts
+++ b/src/x.ts
@@ -1 +1 @@
-this line is not in the file
+replacement
",
    )
    .unwrap();

    let out = edit(&root, &["--patch", patch.to_str().unwrap()]);
    assert!(!out.status.success());
    assert!(!has_receipt(&out));
    assert_eq!(std::fs::read(root.join("src/x.ts")).unwrap(), before);
}

#[test]
fn the_patch_can_come_from_stdin() {
    use std::io::Write;
    use std::process::Stdio;

    let (_dir, root) = init_repo();
    let mut child = Command::cargo_bin("tugutil")
        .unwrap()
        .current_dir(&root)
        .args(["file", "edit", "--patch", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"--- a/src/y.ts\n+++ b/src/y.ts\n@@ -1 +1 @@\n-const c = 1;\n+const c = 2;\n")
        .unwrap();
    let out = child.wait_with_output().unwrap();

    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(receipt_ops(&out).len(), 1);
    assert_eq!(
        std::fs::read_to_string(root.join("src/y.ts")).unwrap(),
        "const c = 2;\n"
    );
}

/// Spec S05: the verb names the regions its bytes landed in, by the same
/// [P06] identity the diff wire and the landing engine use — which is what
/// lets the relay mint `hunk` spans that match against a later diff.
#[test]
fn a_substitution_receipt_names_the_hunk_it_produced() {
    let (_dir, root) = init_repo();
    let out = edit(
        &root,
        &[
            "--path",
            "src/x.ts",
            "--replace",
            "const a = 1;",
            "--with",
            "const a = 2;",
        ],
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let ops = receipt_ops(&out);
    let hunks: Vec<String> = ops[0]["hunks"]
        .as_array()
        .expect("the receipt names its hunks")
        .iter()
        .map(|v| v.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(hunks.len(), 1, "one edit, one region");

    // The id is the one the engine computes for the file's current diff —
    // the agreement the whole feature rests on.
    let engine: Vec<String> = tugchanges_core::hunks::file_hunks(&root, "src/x.ts")
        .expect("engine hunks")
        .into_iter()
        .map(|h| h.id)
        .collect();
    assert_eq!(hunks, engine);
}

/// A second edit reports only what *it* changed. Naming the file's whole
/// current diff would testify to regions another session wrote — a false
/// sole claim, the one direction [P12] forbids.
#[test]
fn a_second_edit_reports_only_its_own_region() {
    let (_dir, root) = init_repo();
    // Two edits far enough apart that git keeps them in separate hunks.
    let long: String = (1..=60).map(|n| format!("line{n:03}\n")).collect();
    std::fs::write(root.join("src/long.ts"), &long).unwrap();
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "-q", "-m", "long"]);

    let first = edit(
        &root,
        &["--path", "src/long.ts", "--replace", "line005", "--with", "FIVE"],
    );
    assert!(first.status.success());
    let first_hunks: Vec<serde_json::Value> =
        receipt_ops(&first)[0]["hunks"].as_array().unwrap().clone();
    assert_eq!(first_hunks.len(), 1);

    let second = edit(
        &root,
        &["--path", "src/long.ts", "--replace", "line050", "--with", "FIFTY"],
    );
    assert!(second.status.success());
    let second_hunks: Vec<serde_json::Value> =
        receipt_ops(&second)[0]["hunks"].as_array().unwrap().clone();
    assert_eq!(second_hunks.len(), 1, "only the new region");
    assert_ne!(second_hunks[0], first_hunks[0]);
}

/// A created file has no diff to read hunks from ([P07]), so the receipt says
/// nothing about regions — and the row it mints widens to the whole file,
/// which is exactly right for a file this session brought into existence.
#[test]
fn a_created_file_names_no_hunks() {
    let (_dir, root) = init_repo();
    let patch = root.join("new.diff");
    std::fs::write(
        &patch,
        "--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1 @@\n+const n = 1;\n",
    )
    .unwrap();
    let out = edit(&root, &["--patch", patch.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let ops = receipt_ops(&out);
    assert_eq!(ops[0]["op"], "created");
    assert!(ops[0].get("hunks").is_none(), "no regions to name");
}
