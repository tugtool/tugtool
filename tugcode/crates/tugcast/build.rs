use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    // Find the repo root (three levels up from crate root)
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo_root = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    // --- Build tugtalk (conversation engine binary) ---
    let tugtalk_dir = repo_root.join("tugtalk");

    // Run bun install if node_modules doesn't exist
    if !tugtalk_dir.join("node_modules").exists() {
        let status = Command::new("bun")
            .arg("install")
            .current_dir(&tugtalk_dir)
            .status()
            .expect("failed to run bun install for tugtalk");
        if !status.success() {
            panic!("bun install for tugtalk failed");
        }
    }

    // Compile tugtalk to a standalone binary using bun build --compile.
    // Place the binary in the cargo target profile directory (next to tugcast/tugtool).
    // OUT_DIR is: target/{profile}/build/{crate}-{hash}/out
    // We walk up to find the profile directory (debug or release).
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
    let target_profile_dir = out_dir
        .ancestors()
        .find(|p| {
            p.file_name()
                .map(|f| f == profile.as_str())
                .unwrap_or(false)
        })
        .expect("could not find target profile directory from OUT_DIR")
        .to_path_buf();

    let tugtalk_binary = target_profile_dir.join("tugtalk");
    let status = Command::new("bun")
        .args([
            "build",
            "--compile",
            "src/main.ts",
            &format!("--outfile={}", tugtalk_binary.display()),
        ])
        .current_dir(&tugtalk_dir)
        .status()
        .expect("failed to run bun build --compile for tugtalk");
    if !status.success() {
        panic!("bun build --compile for tugtalk failed");
    }

    // Set rerun-if-changed for cargo caching
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("tugtalk/src/").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("tugtalk/package.json").display()
    );
}
