//! Build script for tug CLI
//!
//! Captures build-time information:
//! - Git commit hash (TUG_COMMIT)
//! - Build date (TUG_BUILD_DATE)
//! - Rust compiler version (TUG_RUSTC_VERSION)
//!
//! Also parses palette-engine.ts and tug-cita-canonical.json to extract CITA
//! color system constants and generates a Rust source file with the canonical data.
//!
//! Per [D03], all values gracefully fall back to "unknown" if unavailable.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;

fn main() {
    // Capture git commit hash
    let commit = run_command("git", &["rev-parse", "--short", "HEAD"]);
    println!("cargo::rustc-env=TUG_COMMIT={}", commit);

    // Capture build date (YYYY-MM-DD format)
    let build_date = get_build_date();
    println!("cargo::rustc-env=TUG_BUILD_DATE={}", build_date);

    // Capture rustc version
    let rustc_version = get_rustc_version();
    println!("cargo::rustc-env=TUG_RUSTC_VERSION={}", rustc_version);

    // Generate CITA palette data from palette-engine.ts
    generate_cita_palette_data();

    // Rerun if git state changes (for accurate commit hash)
    // These may not exist in non-git builds, which is fine
    println!("cargo::rerun-if-changed=.git/HEAD");
    println!("cargo::rerun-if-changed=.git/index");
}

/// Run a command and return its stdout, or "unknown" on failure
fn run_command(program: &str, args: &[&str]) -> String {
    Command::new(program)
        .args(args)
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                String::from_utf8(output.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// Get the current date in YYYY-MM-DD format
fn get_build_date() -> String {
    // Try using the date command (works on Unix and most systems)
    let date_output = if cfg!(target_os = "windows") {
        // Windows: use PowerShell
        run_command("powershell", &["-Command", "Get-Date -Format yyyy-MM-dd"])
    } else {
        // Unix-like: use date command
        run_command("date", &["+%Y-%m-%d"])
    };

    if date_output != "unknown" {
        return date_output;
    }

    // Fallback: use Rust's SystemTime (basic implementation)
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| {
            // Simple date calculation (not accounting for leap seconds, but close enough)
            let days_since_epoch = d.as_secs() / 86400;
            let (year, month, day) = days_to_ymd(days_since_epoch);
            format!("{:04}-{:02}-{:02}", year, month, day)
        })
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Convert days since Unix epoch to (year, month, day)
fn days_to_ymd(days: u64) -> (i32, u32, u32) {
    // Algorithm based on Howard Hinnant's date algorithms
    // http://howardhinnant.github.io/date_algorithms.html
    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

/// Get the rustc version number (e.g., "1.75.0")
fn get_rustc_version() -> String {
    let output = run_command("rustc", &["--version"]);

    if output == "unknown" {
        return output;
    }

    // Parse "rustc X.Y.Z (hash date)" to extract just "X.Y.Z"
    output
        .split_whitespace()
        .nth(1)
        .map(|s| s.to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

// ---------------------------------------------------------------------------
// CITA palette data generation
// ---------------------------------------------------------------------------

/// Parse a TypeScript Record<string, number> block like:
///   { cherry: 0.619, red: 0.659, ... }
/// Returns Vec<(name, value)> in source order.
fn parse_ts_record(content: &str, var_name: &str) -> Vec<(String, f64)> {
    let pattern = format!("export const {}", var_name);
    let start = match content.find(&pattern) {
        Some(pos) => pos,
        None => return vec![],
    };
    let block_start = match content[start..].find('{') {
        Some(pos) => start + pos,
        None => return vec![],
    };
    let block_end = match content[block_start..].find('}') {
        Some(pos) => block_start + pos,
        None => return vec![],
    };
    let block = &content[block_start + 1..block_end];

    let mut entries = Vec::new();
    for line in block.lines() {
        let trimmed = line.trim().trim_end_matches(',');
        if let Some((key, val)) = trimmed.split_once(':') {
            let key = key.trim();
            let val = val.trim();
            if let Ok(num) = val.parse::<f64>() {
                entries.push((key.to_string(), num));
            }
        }
    }
    entries
}

/// Parse a single `export const NAME = VALUE;` line.
fn parse_ts_const(content: &str, var_name: &str) -> Option<f64> {
    let pattern = format!("export const {} = ", var_name);
    let start = content.find(&pattern)?;
    let after = &content[start + pattern.len()..];
    let end = after.find(';')?;
    after[..end].trim().parse::<f64>().ok()
}

/// Parse tug-cita-canonical.json to extract DEFAULT_CANONICAL_L entries.
///
/// Returns Vec<(hue_name, canonical_l)> in the order they appear in the JSON
/// "hues" object (preserved by serde_json's BTreeMap when keys are sorted,
/// but we use the insertion-order-preserving serde_json::Map via Value).
fn parse_canonical_json(path: &Path) -> Vec<(String, f64)> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => {
            eprintln!(
                "cargo::warning=tug-cita-canonical.json not found, canonical_l will be empty"
            );
            return vec![];
        }
    };

    let root: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("cargo::warning=failed to parse tug-cita-canonical.json: {e}");
            return vec![];
        }
    };

    let hues = match root.get("hues").and_then(|v| v.as_object()) {
        Some(obj) => obj,
        None => return vec![],
    };

    let mut entries = Vec::new();
    for (name, data) in hues {
        if let Some(val) = data.get("canonical_l").and_then(|v| v.as_f64()) {
            entries.push((name.clone(), val));
        }
    }
    entries
}

/// Generate src/cita_palette_data.rs from palette-engine.ts and tug-cita-canonical.json.
fn generate_cita_palette_data() {
    // Find palette-engine.ts relative to the workspace root.
    // build.rs runs from the crate directory (tugcode/crates/tugcode/).
    // palette-engine.ts is at tugdeck/src/components/tugways/palette-engine.ts
    // relative to the workspace root (tugcode/../tugdeck/...).
    let palette_path = Path::new("../../../tugdeck/src/components/tugways/palette-engine.ts");
    let canonical_json_path = Path::new("../../../roadmap/tug-cita-canonical.json");

    println!("cargo::rerun-if-changed={}", palette_path.to_string_lossy());
    println!(
        "cargo::rerun-if-changed={}",
        canonical_json_path.to_string_lossy()
    );

    let content = match fs::read_to_string(palette_path) {
        Ok(c) => c,
        Err(_) => {
            // If the file doesn't exist (e.g., CI without tugdeck), generate empty stubs
            eprintln!("cargo::warning=palette-engine.ts not found, generating empty CITA data");
            write_empty_cita_data();
            return;
        }
    };

    let hue_families = parse_ts_record(&content, "HUE_FAMILIES");
    let max_chroma = parse_ts_record(&content, "MAX_CHROMA_FOR_HUE");

    // DEFAULT_CANONICAL_L is derived from tug-cita-canonical.json (the single
    // source of truth). palette-engine.ts imports it at runtime; we read it
    // directly here with serde_json.
    let canonical_l = parse_canonical_json(canonical_json_path);

    let l_dark = parse_ts_const(&content, "L_DARK").unwrap_or(0.15);
    let l_light = parse_ts_const(&content, "L_LIGHT").unwrap_or(0.96);
    let peak_c_scale = parse_ts_const(&content, "PEAK_C_SCALE").unwrap_or(2.0);

    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("cita_palette_data.rs");
    let mut f = fs::File::create(dest_path).unwrap();

    writeln!(
        f,
        "// Auto-generated from palette-engine.ts and tug-cita-canonical.json by build.rs"
    )
    .unwrap();
    writeln!(f, "// Do not edit manually.").unwrap();
    writeln!(f).unwrap();

    // Constants — always emit as float literals (e.g., 2.0 not 2)
    writeln!(f, "pub const L_DARK: f64 = {:?};", l_dark).unwrap();
    writeln!(f, "pub const L_LIGHT: f64 = {:?};", l_light).unwrap();
    writeln!(f, "pub const PEAK_C_SCALE: f64 = {:?};", peak_c_scale).unwrap();
    writeln!(f).unwrap();

    // HUE_FAMILIES: &[(&str, f64)]
    writeln!(f, "pub const HUE_FAMILIES: &[(&str, f64)] = &[").unwrap();
    for (name, angle) in &hue_families {
        writeln!(f, "    (\"{name}\", {angle}_f64),").unwrap();
    }
    writeln!(f, "];").unwrap();
    writeln!(f).unwrap();

    // DEFAULT_CANONICAL_L: &[(&str, f64)]
    writeln!(f, "pub const DEFAULT_CANONICAL_L: &[(&str, f64)] = &[").unwrap();
    for (name, val) in &canonical_l {
        writeln!(f, "    (\"{name}\", {val}_f64),").unwrap();
    }
    writeln!(f, "];").unwrap();
    writeln!(f).unwrap();

    // MAX_CHROMA_FOR_HUE: &[(&str, f64)]
    writeln!(f, "pub const MAX_CHROMA_FOR_HUE: &[(&str, f64)] = &[").unwrap();
    for (name, val) in &max_chroma {
        writeln!(f, "    (\"{name}\", {val}_f64),").unwrap();
    }
    writeln!(f, "];").unwrap();
}

/// Write empty stubs when palette-engine.ts is not available.
fn write_empty_cita_data() {
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("cita_palette_data.rs");
    let mut f = fs::File::create(dest_path).unwrap();

    writeln!(f, "// Auto-generated stub (palette-engine.ts not found)").unwrap();
    writeln!(f, "pub const L_DARK: f64 = 0.15;").unwrap();
    writeln!(f, "pub const L_LIGHT: f64 = 0.96;").unwrap();
    writeln!(f, "pub const PEAK_C_SCALE: f64 = 2.0;").unwrap();
    writeln!(f, "pub const HUE_FAMILIES: &[(&str, f64)] = &[];").unwrap();
    writeln!(f, "pub const DEFAULT_CANONICAL_L: &[(&str, f64)] = &[];").unwrap();
    writeln!(f, "pub const MAX_CHROMA_FOR_HUE: &[(&str, f64)] = &[];").unwrap();
}
