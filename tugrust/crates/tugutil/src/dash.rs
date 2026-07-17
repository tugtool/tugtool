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

fn run_join(name: &str, opts: JoinOptions, json: bool, quiet: bool) -> Result<(), String> {
    let data = ops::join(name, opts)?;
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
    let data = ops::release(name)?;
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
