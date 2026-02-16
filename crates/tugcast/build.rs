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

    // Copy deck.css and cards.css to output
    let deck_css = tugdeck_dir.join("styles/deck.css");
    if deck_css.exists() {
        fs::copy(&deck_css, tugdeck_out.join("deck.css")).expect("failed to copy deck.css");
    }

    let cards_css = tugdeck_dir.join("styles/cards.css");
    if cards_css.exists() {
        fs::copy(&cards_css, tugdeck_out.join("cards.css")).expect("failed to copy cards.css");
    }

    let tokens_css = tugdeck_dir.join("styles/tokens.css");
    if tokens_css.exists() {
        fs::copy(&tokens_css, tugdeck_out.join("tokens.css")).expect("failed to copy tokens.css");
    }

    // Set rerun-if-changed for cargo caching
    println!("cargo:rerun-if-changed=../../tugdeck/src/");
    println!("cargo:rerun-if-changed=../../tugdeck/index.html");
    println!("cargo:rerun-if-changed=../../tugdeck/package.json");
    println!("cargo:rerun-if-changed=../../tugdeck/styles/");
}
