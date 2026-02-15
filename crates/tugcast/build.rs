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

    // Run npm install if node_modules doesn't exist
    if !tugdeck_dir.join("node_modules").exists() {
        let status = Command::new("npm")
            .arg("install")
            .current_dir(&tugdeck_dir)
            .status()
            .expect("failed to run npm install -- is Node.js installed?");
        if !status.success() {
            panic!("npm install failed");
        }
    }

    // Run esbuild to bundle main.ts -> app.js
    let app_js = tugdeck_out.join("app.js");
    let status = Command::new("npx")
        .args([
            "esbuild",
            "src/main.ts",
            "--bundle",
            &format!("--outfile={}", app_js.display()),
            "--minify",
            "--target=es2020",
        ])
        .current_dir(&tugdeck_dir)
        .status()
        .expect("failed to run esbuild -- is npx available?");
    if !status.success() {
        panic!("esbuild bundling failed");
    }

    // Copy index.html to output
    fs::copy(tugdeck_dir.join("index.html"), tugdeck_out.join("index.html"))
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

    // Set rerun-if-changed for cargo caching
    println!("cargo:rerun-if-changed=../../tugdeck/src/");
    println!("cargo:rerun-if-changed=../../tugdeck/index.html");
    println!("cargo:rerun-if-changed=../../tugdeck/package.json");
}
