use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let tugdeck_out = out_dir.join("tugdeck");
    fs::create_dir_all(&tugdeck_out).expect("failed to create tugdeck output dir");

    // Find the tugdeck directory (two levels up from crate root)
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
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

    // Copy index.html to output
    fs::copy(
        tugdeck_dir.join("index.html"),
        tugdeck_out.join("index.html"),
    )
    .expect("failed to copy index.html");

    // Copy xterm.js CSS to output as app.css
    // The xterm.js CSS is in node_modules/@xterm/xterm/css/xterm.css
    let xterm_css = tugdeck_dir.join("node_modules/@xterm/xterm/css/xterm.css");
    if xterm_css.exists() {
        fs::copy(&xterm_css, tugdeck_out.join("app.css")).expect("failed to copy xterm.css");
    } else {
        // Create empty app.css as fallback
        fs::write(tugdeck_out.join("app.css"), "/* xterm.css not found */")
            .expect("failed to write placeholder app.css");
    }

    // Copy CSS files to output
    let cards_css = tugdeck_dir.join("styles/cards.css");
    if cards_css.exists() {
        fs::copy(&cards_css, tugdeck_out.join("cards.css")).expect("failed to copy cards.css");
    }

    let tokens_css = tugdeck_dir.join("styles/tokens.css");
    if tokens_css.exists() {
        fs::copy(&tokens_css, tugdeck_out.join("tokens.css")).expect("failed to copy tokens.css");
    }

    let cards_chrome_css = tugdeck_dir.join("styles/cards-chrome.css");
    if cards_chrome_css.exists() {
        fs::copy(&cards_chrome_css, tugdeck_out.join("cards-chrome.css")).expect("failed to copy cards-chrome.css");
    }

    let dock_css = tugdeck_dir.join("styles/dock.css");
    if dock_css.exists() {
        fs::copy(&dock_css, tugdeck_out.join("dock.css")).expect("failed to copy dock.css");
    }

    // Copy font files to output
    let fonts_dir = tugdeck_dir.join("styles/fonts");
    if fonts_dir.exists() {
        let fonts_out = tugdeck_out.join("fonts");
        fs::create_dir_all(&fonts_out).expect("failed to create fonts output dir");
        for entry in fs::read_dir(&fonts_dir).expect("failed to read fonts dir") {
            let entry = entry.expect("failed to read fonts dir entry");
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "woff2") {
                let dest = fonts_out.join(path.file_name().unwrap());
                fs::copy(&path, &dest).expect("failed to copy font file");
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
    println!("cargo:rerun-if-changed=../../tugdeck/src/");
    println!("cargo:rerun-if-changed=../../tugdeck/index.html");
    println!("cargo:rerun-if-changed=../../tugdeck/package.json");
    println!("cargo:rerun-if-changed=../../tugdeck/styles/");
    println!("cargo:rerun-if-changed=../../tugtalk/src/");
    println!("cargo:rerun-if-changed=../../tugtalk/package.json");
}
