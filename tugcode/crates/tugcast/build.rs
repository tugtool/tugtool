use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) {
    fs::create_dir_all(dst)
        .unwrap_or_else(|e| panic!("failed to create dir {}: {}", dst.display(), e));
    for entry in
        fs::read_dir(src).unwrap_or_else(|e| panic!("failed to read dir {}: {}", src.display(), e))
    {
        let entry = entry
            .unwrap_or_else(|e| panic!("failed to read dir entry in {}: {}", src.display(), e));
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path);
        } else {
            fs::copy(&src_path, &dst_path).unwrap_or_else(|e| {
                panic!(
                    "failed to copy {} -> {}: {}",
                    src_path.display(),
                    dst_path.display(),
                    e
                )
            });
        }
    }
}

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let tugdeck_out = out_dir.join("tugdeck");
    fs::create_dir_all(&tugdeck_out).expect("failed to create tugdeck output dir");

    // Find the tugdeck directory (three levels up from crate root)
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo_root = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let tugdeck_dir = repo_root.join("tugdeck");

    // Check that Bun is installed
    let bun_check = Command::new("bun").arg("--version").output();
    if bun_check.is_err() || !bun_check.unwrap().status.success() {
        panic!("Bun is required to build tugdeck. Install it from https://bun.sh");
    }

    // Run bun install if node_modules doesn't exist
    if !tugdeck_dir.join("node_modules").exists() {
        let status = Command::new("bun")
            .arg("install")
            .current_dir(&tugdeck_dir)
            .status()
            .expect("failed to run bun install -- is Bun installed? Install from https://bun.sh");
        if !status.success() {
            panic!("bun install failed");
        }
    }

    // Run bun run build (invokes vite build, produces dist/)
    let status = Command::new("bun")
        .args(["run", "build"])
        .current_dir(&tugdeck_dir)
        .status()
        .expect("failed to run bun run build");
    if !status.success() {
        panic!("bun run build failed");
    }

    // Copy the contents of tugdeck/dist/ into OUT_DIR/tugdeck/ recursively.
    // dist/index.html -> OUT_DIR/tugdeck/index.html
    // dist/assets/index-abc123.js -> OUT_DIR/tugdeck/assets/index-abc123.js
    // dist/fonts/hack-regular.woff2 -> OUT_DIR/tugdeck/fonts/hack-regular.woff2
    let dist_dir = tugdeck_dir.join("dist");
    copy_dir_recursive(&dist_dir, &tugdeck_out);

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
        tugdeck_dir.join("vite.config.ts").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        tugdeck_dir.join("index.html").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        tugdeck_dir.join("src/").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        tugdeck_dir.join("package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("tugtalk/src/").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("tugtalk/package.json").display()
    );
}
