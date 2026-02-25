//! Tug CLI - From ideas to implementation via multi-agent orchestration

mod cli;
mod commands;
mod output;
mod splash;

use std::process::ExitCode;

use cli::Commands;
use commands::{DashCommands, LogCommands, StateCommands, WorktreeCommands};

fn main() -> ExitCode {
    let cli = cli::parse();

    let result = match cli.command {
        Some(Commands::Init { force, check }) => {
            commands::run_init(force, check, cli.json, cli.quiet)
        }
        Some(Commands::Validate {
            file,
            strict,
            level,
        }) => commands::run_validate(file, strict, level, cli.json, cli.quiet),
        Some(Commands::List { status }) => commands::run_list(status, cli.json, cli.quiet),
        Some(Commands::Status { file, verbose }) => {
            // Use verbose flag from subcommand, or global verbose
            let verbose = verbose || cli.verbose;
            commands::run_status(file, verbose, cli.json, cli.quiet)
        }
        Some(Commands::Worktree(worktree_cmd)) => match worktree_cmd {
            WorktreeCommands::Create {
                plan,
                base,
                skip_validation,
            } => commands::run_worktree_create(plan, base, skip_validation, cli.json, cli.quiet),
            WorktreeCommands::List => commands::run_worktree_list(cli.json, cli.quiet),
            WorktreeCommands::Cleanup {
                merged,
                orphaned,
                stale,
                all,
                dry_run,
            } => commands::run_worktree_cleanup(
                merged, orphaned, stale, all, dry_run, cli.json, cli.quiet,
            ),
            WorktreeCommands::Remove { target, force } => {
                commands::run_worktree_remove(target, force, cli.json, cli.quiet)
            }
        },
        Some(Commands::State(state_cmd)) => match state_cmd {
            StateCommands::Init { plan } => commands::run_state_init(plan, cli.json, cli.quiet),
            StateCommands::Claim {
                plan,
                worktree,
                lease_duration,
                force,
            } => commands::run_state_claim(
                plan,
                worktree,
                lease_duration,
                force,
                cli.json,
                cli.quiet,
            ),
            StateCommands::Start {
                plan,
                step,
                worktree,
            } => commands::run_state_start(plan, step, worktree, cli.json, cli.quiet),
            StateCommands::Heartbeat {
                plan,
                step,
                worktree,
                lease_duration,
            } => commands::run_state_heartbeat(
                plan,
                step,
                worktree,
                lease_duration,
                cli.json,
                cli.quiet,
            ),
            StateCommands::Update {
                plan,
                step,
                worktree,
                task,
                test,
                checkpoint,
                all_tasks,
                all_tests,
                all_checkpoints,
                all,
                batch,
                complete_remaining,
                allow_reopen,
                allow_drift,
            } => commands::run_state_update(
                plan,
                step,
                worktree,
                task,
                test,
                checkpoint,
                all_tasks,
                all_tests,
                all_checkpoints,
                all,
                batch,
                complete_remaining,
                allow_reopen,
                allow_drift,
                cli.json,
                cli.quiet,
            ),
            StateCommands::Artifact {
                plan,
                step,
                worktree,
                kind,
                summary,
            } => commands::run_state_artifact(
                plan, step, worktree, kind, summary, cli.json, cli.quiet,
            ),
            StateCommands::Complete {
                plan,
                step,
                worktree,
                force,
                reason,
                allow_drift,
            } => commands::run_state_complete(
                plan,
                step,
                worktree,
                force,
                reason,
                allow_drift,
                cli.json,
                cli.quiet,
            ),
            StateCommands::Show {
                plan,
                summary,
                checklist,
            } => commands::run_state_show(plan, summary, checklist, cli.json, cli.quiet),
            StateCommands::Ready { plan } => commands::run_state_ready(plan, cli.json, cli.quiet),
            StateCommands::Reset { plan, step } => {
                commands::run_state_reset(plan, step, cli.json, cli.quiet)
            }
            StateCommands::Release {
                plan,
                step,
                worktree,
                force,
            } => commands::run_state_release(plan, step, worktree, force, cli.json, cli.quiet),
            StateCommands::Reconcile { plan, force } => {
                commands::run_state_reconcile(plan, force, cli.json, cli.quiet)
            }
        },
        Some(Commands::Merge {
            plan,
            dry_run,
            force,
        }) => commands::run_merge(plan, dry_run, force, cli.json, cli.quiet),
        Some(Commands::Log(log_cmd)) => match log_cmd {
            LogCommands::Rotate { force } => {
                commands::run_log_rotate(None, force, cli.json, cli.quiet)
            }
            LogCommands::Prepend {
                step,
                plan,
                summary,
            } => commands::run_log_prepend(None, step, plan, summary, cli.json, cli.quiet),
        },
        Some(Commands::Doctor) => commands::run_doctor(cli.json, cli.quiet),
        Some(Commands::Resolve { identifier }) => {
            commands::run_resolve(identifier, cli.json, cli.quiet)
        }
        Some(Commands::Version { verbose }) => commands::run_version(verbose, cli.json, cli.quiet),
        Some(Commands::Commit {
            worktree,
            step,
            plan,
            message,
            summary,
        }) => commands::run_commit(worktree, step, plan, message, summary, cli.json, cli.quiet),
        Some(Commands::OpenPr {
            worktree,
            branch,
            base,
            title,
            plan,
            repo,
        }) => commands::run_open_pr(
            worktree, branch, base, title, plan, repo, cli.json, cli.quiet,
        ),
        Some(Commands::Tell {
            action,
            port,
            param,
        }) => commands::run_tell(action, port, param, cli.json),
        Some(Commands::Dash(dash_cmd)) => match dash_cmd {
            DashCommands::Create { name, description } => {
                commands::run_dash_create(name, description, cli.json, cli.quiet)
            }
            DashCommands::Commit { name, message } => {
                commands::run_dash_commit(name, message, cli.json, cli.quiet)
            }
            DashCommands::Join { name, message } => {
                commands::run_dash_join(name, message, cli.json, cli.quiet)
            }
            DashCommands::Release { name } => commands::run_dash_release(name, cli.json, cli.quiet),
            DashCommands::List { all } => commands::run_dash_list(all, cli.json, cli.quiet),
            DashCommands::Show { name, all_rounds } => {
                commands::run_dash_show(name, all_rounds, cli.json, cli.quiet)
            }
        },
        None => {
            // No subcommand - show splash screen
            if !cli.quiet {
                splash::show_splash();
                println!("Use --help for usage information");
            }
            Ok(0)
        }
    };

    match result {
        Ok(code) => ExitCode::from(code as u8),
        Err(e) => {
            eprintln!("error: {}", e);
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    #[test]
    fn verify_cli() {
        crate::cli::Cli::command().debug_assert();
    }
}
