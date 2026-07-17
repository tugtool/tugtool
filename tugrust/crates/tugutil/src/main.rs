//! tugutil — the unified Tug developer CLI (changes & commits, dashes, host plumbing).

mod cli;
mod commands;
mod dash;
mod host;
mod mark;
mod output;
mod splash;

use std::process::ExitCode;

use cli::Commands;

fn main() -> ExitCode {
    let cli = cli::parse();
    let json = cli.json;
    let quiet = cli.quiet;

    match cli.command {
        None => {
            // No subcommand — show the splash screen.
            if !quiet {
                splash::show_splash();
                println!("Use --help for usage information");
            }
            ExitCode::SUCCESS
        }

        // Changes & commits — the git surface (tugmark_core).
        Some(Commands::Changes {
            session,
            project,
            all,
            diff,
        }) => mark::finish(mark::run_changes(session, project, all, diff, json)),
        Some(Commands::Context {
            session,
            project,
            log_limit,
        }) => mark::finish(mark::run_context(session, project, log_limit, json)),
        Some(Commands::Commit {
            message,
            session,
            project,
            paths,
            all,
        }) => mark::finish(mark::run_commit(message, session, project, paths, all, json)),
        Some(Commands::Log { limit, range }) => mark::finish(mark::run_log(limit, range, json)),
        Some(Commands::Diff {
            range,
            staged,
            session,
            project,
        }) => mark::finish(mark::run_diff(range, staged, session, project, json)),

        // Dashes (tugdash_core) and host plumbing (command modules).
        Some(Commands::Dash(cmd)) => dash::dispatch(cmd, json, quiet),
        Some(Commands::Host(cmd)) => host::dispatch(cmd, json, quiet),
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
