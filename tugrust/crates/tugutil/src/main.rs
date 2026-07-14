//! Tug utility — project management, state tracking, and developer tools

mod cli;
mod commands;
mod output;
mod splash;

use std::process::ExitCode;

use cli::Commands;

fn main() -> ExitCode {
    let cli = cli::parse();

    let result = match cli.command {
        Some(Commands::Init { force, check }) => {
            commands::run_init(force, check, cli.json, cli.quiet)
        }
        Some(Commands::Resolve { identifier }) => {
            commands::run_resolve(identifier, cli.json, cli.quiet)
        }
        Some(Commands::Version { verbose }) => commands::run_version(verbose, cli.json, cli.quiet),
        Some(Commands::Tell {
            action,
            port,
            instance,
            param,
        }) => commands::run_tell(action, port, instance, param, cli.json),
        Some(Commands::Instance(cmd)) => commands::run_instance(cmd),
        Some(Commands::Gate(cmd)) => Ok(commands::run_gate(cmd, cli.json, cli.quiet)),
        Some(Commands::StateDir) => commands::run_state_dir(cli.json, cli.quiet),
        Some(Commands::Changes {
            session,
            project,
            all,
        }) => commands::run_changes(session, project, all, cli.json, cli.quiet),
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
