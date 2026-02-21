//! Tug CLI - From ideas to implementation via multi-agent orchestration

mod cli;
mod commands;
mod output;
mod splash;

use std::process::ExitCode;

use cli::Commands;
use commands::{BeadsCommands, LogCommands, WorktreeCommands};

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
        Some(Commands::Status {
            file,
            verbose,
            full,
        }) => {
            // Use verbose flag from subcommand, or global verbose
            let verbose = verbose || cli.verbose;
            commands::run_status(file, verbose, full, cli.json, cli.quiet)
        }
        Some(Commands::Beads(beads_cmd)) => match beads_cmd {
            BeadsCommands::Sync {
                file,
                dry_run,
                enrich,
                prune_deps,
                substeps,
            } => commands::run_sync(commands::beads::sync::SyncOptions {
                file,
                dry_run,
                enrich,
                prune_deps,
                substeps_mode: substeps,
                json_output: cli.json,
                quiet: cli.quiet,
            }),
            BeadsCommands::Link {
                file,
                step_anchor,
                bead_id,
            } => commands::run_link(file, step_anchor, bead_id, cli.json, cli.quiet),
            BeadsCommands::Status { file, pull } => {
                commands::run_beads_status(file, pull, cli.json, cli.quiet)
            }
            BeadsCommands::Pull { file, no_overwrite } => {
                commands::run_pull(file, no_overwrite, cli.json, cli.quiet)
            }
            BeadsCommands::Close { bead_id, reason } => {
                commands::run_close(bead_id, reason, cli.json, cli.quiet)
            }
            BeadsCommands::Inspect {
                bead_id,
                working_dir,
            } => commands::run_inspect(bead_id, working_dir, cli.json, cli.quiet),
            BeadsCommands::UpdateNotes {
                bead_id,
                content,
                content_file,
                working_dir,
            } => commands::run_update_notes(
                bead_id,
                content,
                content_file,
                working_dir,
                cli.json,
                cli.quiet,
            ),
            BeadsCommands::AppendNotes {
                bead_id,
                content,
                content_file,
                working_dir,
            } => commands::run_append_notes(
                bead_id,
                content,
                content_file,
                working_dir,
                cli.json,
                cli.quiet,
            ),
            BeadsCommands::AppendDesign {
                bead_id,
                content,
                content_file,
                working_dir,
            } => commands::run_append_design(
                bead_id,
                content,
                content_file,
                working_dir,
                cli.json,
                cli.quiet,
            ),
        },
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
                bead,
            } => commands::run_log_prepend(None, step, plan, summary, bead, cli.json, cli.quiet),
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
            bead,
            summary,
            close_reason,
        }) => commands::run_commit(
            worktree,
            step,
            plan,
            message,
            bead,
            summary,
            close_reason,
            cli.json,
            cli.quiet,
        ),
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
