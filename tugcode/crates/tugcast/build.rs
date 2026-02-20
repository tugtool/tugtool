use serde::Deserialize;
use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

// Keep in sync with dev.rs copy
#[derive(Debug, Deserialize)]
struct AssetManifest {
    files: HashMap<String, String>,
    dirs: Option<HashMap<String, DirEntry>>,
    #[allow(dead_code)] // Used in dev.rs but not in build.rs
    build: Option<BuildConfig>,
}

#[derive(Debug, Deserialize)]
struct DirEntry {
    src: String,
    pattern: String,
}

#[derive(Debug, Deserialize)]
struct BuildConfig {
    #[allow(dead_code)] // Used in dev.rs but not in build.rs
    fallback: String,
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

    // Run bun build to bundle main.ts -> app.js
    let app_js = tugdeck_out.join("app.js");
    let status = Command::new("bun")
        .args([
            "build",
            "src/main.ts",
            &format!("--outfile={}", app_js.display()),
            "--minify",
        ])
        .current_dir(&tugdeck_dir)
        .status()
        .expect("failed to run bun build");
    if !status.success() {
        panic!("bun build failed");
    }

    // Read and parse asset manifest
    let manifest_path = tugdeck_dir.join("assets.toml");
    let manifest_content = fs::read_to_string(&manifest_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {}", manifest_path.display(), e));
    let manifest: AssetManifest = toml::from_str(&manifest_content)
        .unwrap_or_else(|e| panic!("failed to parse {}: {}", manifest_path.display(), e));

    // Copy files from [files] section
    for (url_key, src_path) in &manifest.files {
        let src = tugdeck_dir.join(src_path);
        let dest = tugdeck_out.join(url_key);
        fs::copy(&src, &dest).unwrap_or_else(|e| {
            panic!(
                "failed to copy {} -> {}: {}",
                src.display(),
                dest.display(),
                e
            )
        });
    }

    // Copy files from [dirs] section with glob pattern matching
    if let Some(ref dirs) = manifest.dirs {
        for (prefix, entry) in dirs {
            let src_dir = tugdeck_dir.join(&entry.src);
            let dest_dir = tugdeck_out.join(prefix);
            fs::create_dir_all(&dest_dir).unwrap_or_else(|e| {
                panic!("failed to create dir {}: {}", dest_dir.display(), e)
            });

            let pattern = glob::Pattern::new(&entry.pattern)
                .unwrap_or_else(|e| panic!("invalid glob pattern '{}': {}", entry.pattern, e));

            if src_dir.exists() {
                for dir_entry in fs::read_dir(&src_dir)
                    .unwrap_or_else(|e| panic!("failed to read dir {}: {}", src_dir.display(), e))
                {
                    let dir_entry = dir_entry.unwrap_or_else(|e| {
                        panic!("failed to read dir entry in {}: {}", src_dir.display(), e)
                    });
                    let file_name = dir_entry.file_name();
                    let file_name_str = file_name.to_string_lossy();

                    if pattern.matches(&file_name_str) {
                        let dest = dest_dir.join(&*file_name);
                        fs::copy(dir_entry.path(), &dest).unwrap_or_else(|e| {
                            panic!(
                                "failed to copy {} -> {}: {}",
                                dir_entry.path().display(),
                                dest.display(),
                                e
                            )
                        });
                    }
                }
            }
        }
    }

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
    // Emit for the manifest itself
    println!(
        "cargo:rerun-if-changed={}",
        manifest_path.display()
    );

    // Emit for each [files] source path
    for (_, src_path) in &manifest.files {
        println!(
            "cargo:rerun-if-changed={}",
            tugdeck_dir.join(src_path).display()
        );
    }

    // Emit for each [dirs] source directory
    if let Some(ref dirs) = manifest.dirs {
        for (_, entry) in dirs {
            println!(
                "cargo:rerun-if-changed={}",
                tugdeck_dir.join(&entry.src).display()
            );
        }
    }

    // Emit for non-manifest paths (JS source, tugtalk)
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
