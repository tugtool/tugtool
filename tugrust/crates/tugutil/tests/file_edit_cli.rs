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

    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
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
            "--path", "src/x.ts", "--replace", "= 1;", "--with", "= 9;", "--count", "1",
        ],
    );
    assert!(out.status.success());
    assert_eq!(
        std::fs::read_to_string(root.join("src/x.ts")).unwrap(),
        "const a = 9;\nconst b = 1;\n"
    );
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
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
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
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));

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
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
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
        .write_all(
            b"--- a/src/y.ts\n+++ b/src/y.ts\n@@ -1 +1 @@\n-const c = 1;\n+const c = 2;\n",
        )
        .unwrap();
    let out = child.wait_with_output().unwrap();

    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(receipt_ops(&out).len(), 1);
    assert_eq!(
        std::fs::read_to_string(root.join("src/y.ts")).unwrap(),
        "const c = 2;\n"
    );
}
