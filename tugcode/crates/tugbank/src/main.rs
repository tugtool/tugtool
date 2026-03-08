//! `tugbank` — command-line tool for inspecting and manipulating tugbank databases.
//!
//! Wraps `tugbank-core` into a `defaults`-like CLI. Supports seven subcommands:
//! `domains`, `read`, `write`, `delete`, `keys`, `cas-write`, `generation`.
//!
//! # Database path resolution
//!
//! Precedence order: `--path` flag > `TUGBANK_PATH` env var > `~/.tugbank.db`.
//!
//! # Output format
//!
//! Human-readable text by default; `--json` switches to machine-readable JSON
//! using the S01 envelope: `{"ok":true,"data":{...}}` or `{"ok":false,"error":"..."}`.
//!
//! # Exit codes (Table T01)
//!
//! | Code | Meaning |
//! |------|---------|
//! | 0    | Success |
//! | 1    | Internal/other error |
//! | 2    | Not found / clap argument error |
//! | 3    | CAS conflict |
//! | 4    | Invalid usage (app-level) |
//! | 5    | Busy/timeout |

use std::path::PathBuf;
use std::process;

use base64::Engine as _;
use clap::{Parser, Subcommand, ValueEnum};
use tugbank_core::{DefaultsStore, Value};

// ── CLI structure ─────────────────────────────────────────────────────────────

/// Command-line tool for inspecting and manipulating tugbank databases.
#[derive(Debug, Parser)]
#[command(name = "tugbank", version)]
struct Cli {
    /// Path to the tugbank database file.
    /// Overrides TUGBANK_PATH env var and the default (~/.tugbank.db).
    #[arg(long, global = true)]
    path: Option<String>,

    /// Output machine-readable JSON instead of human-readable text.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// List all domains in the database.
    Domains,

    /// Read one key or all keys in a domain.
    Read {
        /// The domain name.
        domain: String,
        /// The key to read. If omitted, all keys in the domain are printed.
        key: Option<String>,
    },

    /// Write a value to a key.
    Write {
        /// The domain name.
        domain: String,
        /// The key to write.
        key: String,
        /// Value type. Defaults to `string`.
        #[arg(long = "type", value_enum, default_value = "string")]
        value_type: ValueType,
        /// The value to write. Not required for `--type null`.
        /// For `--type bytes`, interpreted as base64-encoded bytes.
        value: Option<String>,
        /// Read bytes from this file path instead of the value argument.
        /// Only valid with `--type bytes`.
        #[arg(long)]
        bytes_file: Option<PathBuf>,
    },

    /// Delete a key or an entire domain.
    Delete {
        /// The domain name.
        domain: String,
        /// The key to delete. If omitted, the entire domain is deleted.
        key: Option<String>,
    },

    /// List all keys in a domain.
    Keys {
        /// The domain name.
        domain: String,
    },

    /// Write a value only if the domain generation matches.
    #[command(name = "cas-write")]
    CasWrite {
        /// The domain name.
        domain: String,
        /// The key to write.
        key: String,
        /// Value type. Defaults to `string`.
        #[arg(long = "type", value_enum, default_value = "string")]
        value_type: ValueType,
        /// The value to write. Not required for `--type null`.
        value: Option<String>,
        /// The expected generation. The write is rejected if the domain
        /// generation has changed since this was read.
        #[arg(long)]
        generation: u64,
    },

    /// Get the current generation counter for a domain.
    Generation {
        /// The domain name.
        domain: String,
    },
}

/// Value type for `--type` flag.
#[derive(Debug, Clone, ValueEnum)]
enum ValueType {
    String,
    Bool,
    Int,
    Float,
    Json,
    Bytes,
    Null,
}

// ── Path resolution ───────────────────────────────────────────────────────────

/// Resolve the database path: `--path` flag > `TUGBANK_PATH` env var > `~/.tugbank.db`.
///
/// Returns `Err(String)` with a user-facing message if no path can be determined
/// (home directory unavailable and no override provided).
fn resolve_db_path(cli_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = cli_path {
        return Ok(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("TUGBANK_PATH") {
        if !p.is_empty() {
            return Ok(PathBuf::from(p));
        }
    }
    match dirs::home_dir() {
        Some(home) => Ok(home.join(".tugbank.db")),
        None => Err(
            "cannot determine database path: home directory is unavailable. \
             Use --path or set TUGBANK_PATH."
                .to_owned(),
        ),
    }
}

// ── JSON output helpers (Spec S01) ────────────────────────────────────────────

fn json_ok(data: &serde_json::Value) {
    println!("{}", serde_json::json!({"ok": true, "data": data}));
}

fn json_err(msg: &str) {
    println!("{}", serde_json::json!({"ok": false, "error": msg}));
}

// ── Value conversion helpers ──────────────────────────────────────────────────

/// Convert a `tugbank_core::Value` to a serde_json representation.
/// Bytes are encoded as base64 strings; all other types map naturally.
fn value_to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Bool(b) => serde_json::json!(b),
        Value::I64(n) => serde_json::json!(n),
        Value::F64(f) => serde_json::json!(f),
        Value::String(s) => serde_json::json!(s),
        Value::Bytes(b) => {
            serde_json::json!(base64::engine::general_purpose::STANDARD.encode(b))
        }
        Value::Json(j) => j.clone(),
    }
}

/// Return the type name string for a `Value` variant (used in JSON `type` fields
/// and text output).
fn value_type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::I64(_) => "int",
        Value::F64(_) => "float",
        Value::String(_) => "string",
        Value::Bytes(_) => "bytes",
        Value::Json(_) => "json",
    }
}

/// Format a single value for text output (Spec S04).
fn value_to_text(v: &Value) -> String {
    match v {
        Value::Null => "null".to_owned(),
        Value::Bool(b) => b.to_string(),
        Value::I64(n) => n.to_string(),
        Value::F64(f) => f.to_string(),
        Value::String(s) => s.clone(),
        Value::Bytes(b) => base64::engine::general_purpose::STANDARD.encode(b),
        Value::Json(j) => j.to_string(),
    }
}

/// Parse a CLI string value into a `tugbank_core::Value` for a given `ValueType`.
///
/// Returns `Err(String)` with a user-facing message on parse failure.
fn parse_value(value_type: &ValueType, value_str: Option<&str>) -> Result<Value, String> {
    match value_type {
        ValueType::Null => Ok(Value::Null),
        ValueType::String => {
            let s = value_str.ok_or("missing value argument for --type string")?;
            Ok(Value::String(s.to_owned()))
        }
        ValueType::Bool => {
            let s = value_str.ok_or("missing value argument for --type bool")?;
            match s.to_lowercase().as_str() {
                "true" => Ok(Value::Bool(true)),
                "false" => Ok(Value::Bool(false)),
                other => Err(format!(
                    "invalid bool value: '{other}' (expected 'true' or 'false')"
                )),
            }
        }
        ValueType::Int => {
            let s = value_str.ok_or("missing value argument for --type int")?;
            s.parse::<i64>()
                .map(Value::I64)
                .map_err(|e| format!("invalid int value: {e}"))
        }
        ValueType::Float => {
            let s = value_str.ok_or("missing value argument for --type float")?;
            s.parse::<f64>()
                .map(Value::F64)
                .map_err(|e| format!("invalid float value: {e}"))
        }
        ValueType::Json => {
            let s = value_str.ok_or("missing value argument for --type json")?;
            serde_json::from_str::<serde_json::Value>(s)
                .map(Value::Json)
                .map_err(|e| format!("invalid json value: {e}"))
        }
        ValueType::Bytes => {
            let s = value_str.ok_or("missing value argument for --type bytes")?;
            base64::engine::general_purpose::STANDARD
                .decode(s)
                .map(Value::Bytes)
                .map_err(|e| format!("invalid base64 value: {e}"))
        }
    }
}

// ── main ──────────────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();
    let use_json = cli.json;

    // Resolve database path.
    let db_path = match resolve_db_path(cli.path.as_deref()) {
        Ok(p) => p,
        Err(msg) => {
            if use_json {
                json_err(&msg);
            } else {
                eprintln!("error: {msg}");
            }
            process::exit(4);
        }
    };

    // Open the store.
    let store = match DefaultsStore::open(&db_path) {
        Ok(s) => s,
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    };

    match cli.command {
        Commands::Domains => cmd_domains(&store, use_json),
        Commands::Read { domain, key } => cmd_read(&store, &domain, key.as_deref(), use_json),
        Commands::Write {
            domain,
            key,
            value_type,
            value,
            bytes_file,
        } => cmd_write(
            &store,
            &domain,
            &key,
            value_type,
            value.as_deref(),
            bytes_file,
            use_json,
        ),
        Commands::Delete { domain, key } => cmd_delete(&store, &domain, key.as_deref(), use_json),
        Commands::Keys { domain } => cmd_keys(&store, &domain, use_json),
        Commands::CasWrite {
            domain,
            key,
            value_type,
            value,
            generation,
        } => cmd_cas_write(
            &store,
            &domain,
            &key,
            value_type,
            value.as_deref(),
            generation,
            use_json,
        ),
        Commands::Generation { domain } => cmd_generation(&store, &domain, use_json),
    }
}

// ── subcommand implementations ────────────────────────────────────────────────

fn cmd_domains(store: &DefaultsStore, use_json: bool) {
    match store.list_domains() {
        Ok(domains) => {
            if use_json {
                json_ok(&serde_json::json!({"domains": domains}));
            } else {
                for d in &domains {
                    println!("{d}");
                }
            }
        }
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    }
}

fn cmd_keys(store: &DefaultsStore, domain: &str, use_json: bool) {
    let handle = match store.domain(domain) {
        Ok(h) => h,
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    };
    match handle.keys() {
        Ok(keys) => {
            if use_json {
                json_ok(&serde_json::json!({"keys": keys}));
            } else {
                for k in &keys {
                    println!("{k}");
                }
            }
        }
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    }
}

fn cmd_generation(store: &DefaultsStore, domain: &str, use_json: bool) {
    let handle = match store.domain(domain) {
        Ok(h) => h,
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    };
    match handle.generation() {
        Ok(g) => {
            if use_json {
                json_ok(&serde_json::json!({"generation": g}));
            } else {
                println!("{g}");
            }
        }
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    }
}

fn cmd_read(store: &DefaultsStore, domain: &str, key: Option<&str>, use_json: bool) {
    let handle = match store.domain(domain) {
        Ok(h) => h,
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    };

    if let Some(k) = key {
        // Read a single key.
        match handle.get(k) {
            Ok(Some(v)) => {
                if use_json {
                    json_ok(&serde_json::json!({
                        "value": value_to_json(&v),
                        "type": value_type_name(&v),
                    }));
                } else {
                    println!("{}", value_to_text(&v));
                }
            }
            Ok(None) => {
                if use_json {
                    json_err(&format!("key not found: {k}"));
                } else {
                    eprintln!("not found: {k}");
                }
                process::exit(2);
            }
            Err(e) => {
                let code = e.exit_code();
                if use_json {
                    json_err(&e.to_string());
                } else {
                    eprintln!("error: {e}");
                }
                process::exit(code as i32);
            }
        }
    } else {
        // Read all key-value pairs.
        match handle.read_all() {
            Ok(map) => {
                if use_json {
                    let obj: serde_json::Map<String, serde_json::Value> = map
                        .iter()
                        .map(|(k, v)| {
                            (
                                k.clone(),
                                serde_json::json!({
                                    "value": value_to_json(v),
                                    "type": value_type_name(v),
                                }),
                            )
                        })
                        .collect();
                    json_ok(&serde_json::Value::Object(obj));
                } else {
                    for (k, v) in &map {
                        println!("{k}\t{}\t{}", value_type_name(v), value_to_text(v));
                    }
                }
            }
            Err(e) => {
                let code = e.exit_code();
                if use_json {
                    json_err(&e.to_string());
                } else {
                    eprintln!("error: {e}");
                }
                process::exit(code as i32);
            }
        }
    }
}

fn cmd_write(
    store: &DefaultsStore,
    domain: &str,
    key: &str,
    value_type: ValueType,
    value_str: Option<&str>,
    bytes_file: Option<PathBuf>,
    use_json: bool,
) {
    // Handle --bytes-file: read the file and store as Value::Bytes.
    let value = if let Some(path) = bytes_file {
        match std::fs::read(&path) {
            Ok(bytes) => Value::Bytes(bytes),
            Err(e) => {
                let msg = format!("cannot read bytes-file '{}': {e}", path.display());
                if use_json {
                    json_err(&msg);
                } else {
                    eprintln!("error: {msg}");
                }
                process::exit(4);
            }
        }
    } else {
        match parse_value(&value_type, value_str) {
            Ok(v) => v,
            Err(msg) => {
                if use_json {
                    json_err(&msg);
                } else {
                    eprintln!("error: {msg}");
                }
                process::exit(4);
            }
        }
    };

    let handle = match store.domain(domain) {
        Ok(h) => h,
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    };

    if let Err(e) = handle.set(key, value) {
        let code = e.exit_code();
        if use_json {
            json_err(&e.to_string());
        } else {
            eprintln!("error: {e}");
        }
        process::exit(code as i32);
    }
    // No output on success (Spec S04).
}

fn cmd_delete(store: &DefaultsStore, domain: &str, key: Option<&str>, use_json: bool) {
    if let Some(k) = key {
        // Delete a single key.
        let handle = match store.domain(domain) {
            Ok(h) => h,
            Err(e) => {
                let code = e.exit_code();
                if use_json {
                    json_err(&e.to_string());
                } else {
                    eprintln!("error: {e}");
                }
                process::exit(code as i32);
            }
        };
        match handle.remove(k) {
            Ok(true) => {} // success, no output
            Ok(false) => {
                if use_json {
                    json_err(&format!("key not found: {k}"));
                } else {
                    eprintln!("not found: {k}");
                }
                process::exit(2);
            }
            Err(e) => {
                let code = e.exit_code();
                if use_json {
                    json_err(&e.to_string());
                } else {
                    eprintln!("error: {e}");
                }
                process::exit(code as i32);
            }
        }
    } else {
        // Delete entire domain.
        match store.delete_domain(domain) {
            Ok(true) => {} // success, no output
            Ok(false) => {
                if use_json {
                    json_err(&format!("domain not found: {domain}"));
                } else {
                    eprintln!("not found: {domain}");
                }
                process::exit(2);
            }
            Err(e) => {
                let code = e.exit_code();
                if use_json {
                    json_err(&e.to_string());
                } else {
                    eprintln!("error: {e}");
                }
                process::exit(code as i32);
            }
        }
    }
}

fn cmd_cas_write(
    store: &DefaultsStore,
    domain: &str,
    key: &str,
    value_type: ValueType,
    value_str: Option<&str>,
    expected_generation: u64,
    use_json: bool,
) {
    let value = match parse_value(&value_type, value_str) {
        Ok(v) => v,
        Err(msg) => {
            if use_json {
                json_err(&msg);
            } else {
                eprintln!("error: {msg}");
            }
            process::exit(4);
        }
    };

    let handle = match store.domain(domain) {
        Ok(h) => h,
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    };

    match handle.set_if_generation(key, value, expected_generation) {
        Ok(tugbank_core::SetOutcome::Written) => {
            // No output on success.
        }
        Ok(tugbank_core::SetOutcome::Conflict { current_generation }) => {
            if use_json {
                json_err(&format!("conflict: generation is now {current_generation}"));
            } else {
                eprintln!("conflict: generation is now {current_generation}");
            }
            process::exit(3);
        }
        Err(e) => {
            let code = e.exit_code();
            if use_json {
                json_err(&e.to_string());
            } else {
                eprintln!("error: {e}");
            }
            process::exit(code as i32);
        }
    }
}
