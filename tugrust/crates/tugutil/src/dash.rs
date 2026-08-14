//! Dashes — worktree-isolated work units (`tugutil dash …`). A thin shell over
//! [`tugdash_core::ops`]: parse arguments, read commit round-metadata from stdin,
//! call the typed library API, and format the outcome as `--json` (the shared
//! envelope) or a plain human read-out.

use std::io::{self, IsTerminal, Read};
use std::process::ExitCode;

use serde::Serialize;

use tugdash_core::{DashRoundMeta, JoinOptions, JoinStrategy, ops, resolve};

use crate::cli::DashCommands;
use crate::output::print_ok;

/// Dispatch a `dash` subcommand, mapping a `Result<(), String>` to an exit code
/// (exit 1 on any error, matching the former standalone tugdash binary).
pub fn dispatch(cmd: DashCommands, json: bool, quiet: bool) -> ExitCode {
    let result: Result<(), String> = match cmd {
        DashCommands::Create { name, description } => run_create(&name, description, json, quiet),
        DashCommands::Commit { name, message } => run_commit(&name, &message, json, quiet),
        DashCommands::Join {
            name,
            message,
            strategy,
            preview,
            continue_join,
            resolve,
        } if resolve => run_join_resolve(&name, message, strategy.into(), json, quiet),
        DashCommands::Join {
            name,
            message,
            strategy,
            preview,
            continue_join,
            resolve: _,
        } => run_join(
            &name,
            JoinOptions {
                strategy: strategy.into(),
                message,
                preview,
                continue_join,
                candidate: None,
            },
            json,
            quiet,
        ),
        DashCommands::Release { name } => run_release(&name, json, quiet),
        DashCommands::List => run_list(json, quiet),
        DashCommands::Show { name } => run_show(&name, json, quiet),
        DashCommands::Status { name } => run_status(&name, json, quiet),
        DashCommands::Bind { name, project } => run_bind(&name, project, json, quiet),
        DashCommands::Unbind { project } => run_unbind(project, json, quiet),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {}", e);
            ExitCode::from(1)
        }
    }
}

fn run_create(
    name: &str,
    description: Option<String>,
    json: bool,
    quiet: bool,
) -> Result<(), String> {
    let data = ops::create(name, description)?;
    // The session that made the dash is working on it. Best-effort: a headless
    // run with no live instance loses nothing (binding is a UI concept), so a
    // failure warns and never fails the create.
    if std::env::var("TUG_SESSION_ID").is_ok_and(|s| !s.is_empty())
        && let Err(e) = run_bind(name, None, false, true)
    {
        eprintln!("warning: could not bind this session to dash '{name}': {e}");
    }
    if json {
        print_ok("dash create", &data);
    } else if !quiet {
        if data.created {
            println!("Created dash '{}'", data.name);
        } else {
            println!("Dash '{}' already exists (active)", data.name);
        }
        println!("  Worktree: {}", data.worktree);
        println!("  Branch: {}", data.branch);
        println!("  Base: {}", data.base_branch);
    }
    Ok(())
}

fn run_commit(name: &str, message: &str, json: bool, quiet: bool) -> Result<(), String> {
    // Round metadata arrives on stdin (the one datum git lacks: the verbatim
    // instruction). A terminal stdin means none was piped.
    let round_meta: Option<DashRoundMeta> = if !io::stdin().is_terminal() {
        let mut buf = String::new();
        io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| format!("failed to read stdin: {}", e))?;
        if buf.trim().is_empty() {
            None
        } else {
            Some(
                serde_json::from_str(&buf)
                    .map_err(|e| format!("failed to parse round metadata JSON: {}", e))?,
            )
        }
    } else {
        None
    };

    let data = ops::commit(name, message, round_meta)?;
    if json {
        print_ok("dash commit", &data);
    } else if !quiet {
        if data.committed {
            println!("Committed changes to dash '{}'", name);
            if let Some(hash) = &data.commit_hash {
                println!("  Commit: {}", hash);
            }
        } else {
            println!("No changes to commit for dash '{}'", name);
        }
    }
    Ok(())
}

/// The dash's owner key and the repo it lives in, resolved for a landing.
///
/// Called **before** the verb runs, always. `join`/`release` end in
/// `git branch -D`, which deletes `branch.tugdash/<name>.tugid` with the
/// branch — a key read afterwards is the legacy form and names none of the
/// id-keyed rows the `dash_gone` sweep must reach ([L23], [P05], Risk R02).
fn capture_owner_key(name: &str) -> Option<(std::path::PathBuf, String)> {
    let repo = tugutil_core::find_repo_root().ok()?;
    let key = tugdash_core::ops::dash_owner_key(&repo, name);
    Some((repo, key))
}

fn run_join(name: &str, opts: JoinOptions, json: bool, quiet: bool) -> Result<(), String> {
    let previewing = opts.preview;
    let captured = (!previewing).then(|| capture_owner_key(name)).flatten();
    let data = ops::join(name, opts)?;
    // Only a real join that landed tore the dash down.
    if !data.previewed
        && data.conflicts.is_empty()
        && let Some((repo, owner_key)) = captured
    {
        broadcast_dash_gone(&repo, &owner_key);
    }
    if json {
        print_ok("dash join", &data);
    } else if !quiet {
        if data.previewed {
            if data.conflicts.is_empty() {
                println!(
                    "Preview: dash '{}' joins cleanly into '{}'.",
                    data.name, data.base_branch
                );
            } else {
                println!(
                    "Preview: joining dash '{}' into '{}' conflicts in {} file(s):",
                    data.name,
                    data.base_branch,
                    data.conflicts.len()
                );
                for path in &data.conflicts {
                    println!("  {}", path);
                }
            }
        } else if data.conflicts.is_empty() {
            println!(
                "Joined dash '{}' to branch '{}'",
                data.name, data.base_branch
            );
            if let Some(hash) = &data.commit_hash {
                println!("  Commit: {}", hash);
            }
            for warning in &data.warnings {
                println!("  Warning: {}", warning);
            }
        } else {
            println!(
                "Join aborted: dash '{}' conflicts with '{}' in {} file(s) (working tree restored):",
                data.name,
                data.base_branch,
                data.conflicts.len()
            );
            for path in &data.conflicts {
                println!("  {}", path);
            }
        }
    }
    // A real (non-preview) join that hit conflicts is a failure exit for scripts.
    if !data.previewed && !data.conflicts.is_empty() {
        return Err(format!(
            "join conflicts in {} file(s); working tree restored",
            data.conflicts.len()
        ));
    }
    Ok(())
}

/// `tugutil dash join --resolve`: run the resolution ladder, then land the candidate
/// ([P31]). No AI rung from the CLI (the scribe lives in tugcast) — the ladder's
/// algorithmic rungs only.
fn run_join_resolve(
    name: &str,
    message: Option<String>,
    strategy: JoinStrategy,
    json: bool,
    quiet: bool,
) -> Result<(), String> {
    let outcome = resolve::resolve_conflicts_cwd(name, None)?;

    let Some(candidate) = outcome.candidate_commit.clone() else {
        // Some files could not be resolved algorithmically.
        if json {
            print_ok("dash join --resolve", &outcome);
        } else if !quiet {
            println!(
                "Could not fully resolve dash '{}': {} file(s) still conflict:",
                name,
                outcome.unresolved.len()
            );
            for path in &outcome.unresolved {
                println!("  {}", path);
            }
            for r in &outcome.resolved {
                println!("  resolved {} ({:?})", r.path, r.resolved_by);
            }
        }
        return Err(format!(
            "{} file(s) unresolved; run the join from a Session card for AI assist",
            outcome.unresolved.len()
        ));
    };

    // Captured before the teardown, for the reason `capture_owner_key` states.
    let captured = capture_owner_key(name);
    let landed = ops::join(
        name,
        JoinOptions {
            strategy,
            message,
            preview: false,
            continue_join: false,
            candidate: Some(candidate),
        },
    )?;
    if landed.conflicts.is_empty()
        && let Some((repo, owner_key)) = captured
    {
        broadcast_dash_gone(&repo, &owner_key);
    }

    if json {
        // Report the ladder outcome and the landed join together.
        print_ok(
            "dash join --resolve",
            serde_json::json!({ "resolve": outcome, "join": landed }),
        );
    } else if !quiet {
        println!(
            "Resolved and joined dash '{}' into '{}' ({:?} shape)",
            landed.name, landed.base_branch, outcome.shape
        );
        if let Some(hash) = &landed.commit_hash {
            println!("  Commit: {}", hash);
        }
        for r in &outcome.resolved {
            println!("  resolved {} ({:?})", r.path, r.resolved_by);
        }
        for warning in outcome.warnings.iter().chain(landed.warnings.iter()) {
            println!("  Warning: {}", warning);
        }
    }
    Ok(())
}

fn run_release(name: &str, json: bool, quiet: bool) -> Result<(), String> {
    // Captured before the teardown, for the reason `capture_owner_key` states.
    let captured = capture_owner_key(name);
    let data = ops::release(name)?;
    if let Some((repo, owner_key)) = captured {
        broadcast_dash_gone(&repo, &owner_key);
    }
    if json {
        print_ok("dash release", &data);
    } else if !quiet {
        println!("Released dash '{}'", data.name);
        for warning in &data.warnings {
            println!("  Warning: {}", warning);
        }
    }
    Ok(())
}

fn run_status(name: &str, json: bool, quiet: bool) -> Result<(), String> {
    let data = ops::status(name)?;
    if json {
        print_ok("dash status", &data);
    } else if !quiet {
        println!("Dash: {}", data.name);
        println!("Id: {}", data.id);
        println!("Stage: {}", data.stage);
        println!("Branch: {}", data.branch);
        println!("Base: {}", data.base_branch);
        println!("Rounds: {}", data.rounds);
        println!(
            "Worktree: {}{}",
            data.worktree,
            if data.worktree_dirty {
                " (uncommitted changes)"
            } else {
                ""
            }
        );
        println!("Draft: {}", if data.draft { "yes" } else { "no" });
        if let Some(phase) = &data.join_journal_phase {
            println!("Landing interrupted at: {}", phase);
        }
        if data.bound_sessions.is_empty() {
            println!("Sessions: none (parked)");
        } else {
            println!("Sessions: {}", data.bound_sessions.join(", "));
        }
    }
    Ok(())
}

// --- session↔dash binding ([P04], Spec S04) --------------------------------

/// Resolve `--project` (default cwd) to an absolute path, as the user spelled
/// it. The CLI never canonicalizes ([L29]) — `/api/dash` is the gateway.
fn binding_project(project: Option<std::path::PathBuf>) -> Result<std::path::PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("cannot resolve cwd: {e}"))?;
    Ok(match project {
        Some(p) if p.is_absolute() => p,
        Some(p) => cwd.join(p),
        None => cwd,
    })
}

/// POST one binding request to the instance that owns the session.
///
/// Unlike `/api/draft` — whose target is the machine-global changes ledger, so
/// any live instance is a valid conduit — `sessions.db` is **per-instance**. A
/// bind must land on the instance holding the session, so this tries the
/// cwd-derived instance first (`find_for_cwd` reaches through a dash worktree
/// to its main checkout, so it is usually right on the first try) and then
/// walks every live instance, taking `unknown_session` as "not this one" and
/// moving on.
///
/// `resolve_port_*` is deliberately not used here: it collapses the registry to
/// a single port by design ([D09]), which is the right answer for a
/// machine-global write and the wrong one for a per-instance ledger.
fn post_dash_api(body: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut ports: Vec<u16> = Vec::new();
    if let Ok(Some(instance)) =
        std::env::current_dir().map_err(|_| ()).and_then(|cwd| {
            tugcore::registry::find_for_cwd(&cwd).map_err(|_| ())
        })
    {
        ports.push(instance.tugcast_port);
    }
    for instance in tugcore::registry::list_live().unwrap_or_default() {
        if !ports.contains(&instance.tugcast_port) {
            ports.push(instance.tugcast_port);
        }
    }
    if ports.is_empty() {
        return Err(
            "dash binding goes through a running Tug instance, but none was found".to_string(),
        );
    }

    // A non-2xx must stay readable: `unknown_session` arrives as a 404 whose
    // *body* is the answer the loop branches on, and ureq's default turns a
    // non-2xx into an error that discards it.
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .build()
        .into();

    let mut last_error = None;
    for port in ports {
        let url = format!("http://127.0.0.1:{port}/api/dash");
        let response = match agent.post(&url).send_json(body.clone()) {
            Ok(r) => r,
            Err(e) => {
                last_error = Some(format!("cannot reach tugcast at {url}: {e}"));
                continue;
            }
        };
        let value: serde_json::Value = match response.into_body().read_json() {
            Ok(v) => v,
            Err(e) => {
                last_error = Some(format!("bad response from tugcast: {e}"));
                continue;
            }
        };
        if value.get("status").and_then(|s| s.as_str()) == Some("ok") {
            return Ok(value);
        }
        last_error = Some(
            value
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown error")
                .to_string(),
        );
    }
    Err(last_error.unwrap_or_else(|| "no instance accepted the request".to_string()))
}

/// The calling session's id, or the actionable error naming what to do.
fn calling_session_id() -> Result<String, String> {
    std::env::var("TUG_SESSION_ID")
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "no session — dash binding names the calling session, so run this from a Session card or set TUG_SESSION_ID"
                .to_string()
        })
}

fn run_bind(
    name: &str,
    project: Option<std::path::PathBuf>,
    json: bool,
    quiet: bool,
) -> Result<(), String> {
    let session = calling_session_id()?;
    let project = binding_project(project)?;
    let response = post_dash_api(serde_json::json!({
        "op": "bind",
        "tug_session_id": session,
        "project_dir": project.to_string_lossy(),
        "dash": name,
    }))?;
    if json {
        print_ok(
            "dash bind",
            serde_json::json!({
                "dash": name,
                "dash_id": response.get("dash_id"),
                "tug_session_id": session,
            }),
        );
    } else if !quiet {
        println!("Bound this session to dash '{}'", name);
    }
    Ok(())
}

fn run_unbind(
    project: Option<std::path::PathBuf>,
    json: bool,
    quiet: bool,
) -> Result<(), String> {
    let session = calling_session_id()?;
    let _project = binding_project(project)?;
    post_dash_api(serde_json::json!({
        "op": "unbind",
        "tug_session_id": session,
    }))?;
    if json {
        print_ok(
            "dash unbind",
            serde_json::json!({ "tug_session_id": session }),
        );
    } else if !quiet {
        println!("Unbound this session from its dash");
    }
    Ok(())
}

/// Tell every live instance that a dash is gone, so its bindings and its
/// authored draft are swept ([P05]).
///
/// Best-effort by design: a landing must never fail because no instance was
/// listening. Broadcast rather than try-until-owned — any instance may hold
/// bindings to the dead dash.
///
/// `dash_id` is the owner key the caller captured **before** the landing.
/// `git branch -D` takes the branch's config with it, so a key resolved after
/// the verb returns is the legacy form and matches none of the id-keyed rows
/// this sweep exists to remove ([L23], Risk R02).
fn broadcast_dash_gone(project: &std::path::Path, dash_id: &str) {
    let body = serde_json::json!({
        "op": "dash_gone",
        "project_dir": project.to_string_lossy(),
        "dash_id": dash_id,
    });
    let live = tugcore::registry::list_live().unwrap_or_default();
    if live.is_empty() {
        // Nothing is running, so nothing holds a binding to sweep — not a
        // condition worth a warning.
        return;
    }
    let mut reached = false;
    for instance in live {
        let url = format!("http://127.0.0.1:{}/api/dash", instance.tugcast_port);
        if ureq::post(&url).send_json(body.clone()).is_ok() {
            reached = true;
        }
    }
    if !reached {
        eprintln!(
            "warning: no running Tug instance was told that dash '{}' is gone; \
             its bindings clear lazily on the next read",
            dash_id
        );
    }
}

/// The list `--json` payload — `{ "dashes": [...] }`.
#[derive(Serialize)]
struct ListPayload {
    dashes: Vec<tugdash_core::DashListItem>,
}

fn run_list(json: bool, quiet: bool) -> Result<(), String> {
    let items = ops::list()?;
    if json {
        print_ok("dash list", ListPayload { dashes: items });
    } else if !quiet {
        if items.is_empty() {
            println!("No dashes found");
        } else {
            for item in &items {
                println!("{} (active, {} rounds)", item.name, item.round_count);
                match &item.worktree {
                    Some(worktree) => println!("  Worktree: {}", worktree),
                    None => println!("  Worktree: (missing)"),
                }
                println!("  Base: {}", item.base_branch);
            }
        }
    }
    Ok(())
}

fn run_show(name: &str, json: bool, quiet: bool) -> Result<(), String> {
    let data = ops::show(name)?;
    if json {
        print_ok("dash show", &data);
    } else if !quiet {
        println!("Dash: {}", data.name);
        if let Some(desc) = &data.description {
            println!("Description: {}", desc);
        }
        println!("Status: {}", data.status);
        println!("Branch: {}", data.branch);
        println!("Worktree: {}", data.worktree);
        println!("Base: {}", data.base_branch);
        if let Some(has_changes) = data.uncommitted_changes {
            println!(
                "Uncommitted changes: {}",
                if has_changes { "yes" } else { "no" }
            );
        }
        println!("\nRounds ({}):", data.rounds.len());
        for round in &data.rounds {
            println!("  {} {}", round.commit_hash, round.started_at);
            if !round.summary.is_empty() {
                println!("    {}", round.summary);
            }
        }
    }
    Ok(())
}
