//! Tug utility — project management, state tracking, and developer tools

mod cli;
mod commands;
mod output;
mod splash;

use std::process::ExitCode;

use cli::Commands;
use commands::DashCommands;

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
        Some(Commands::Color { color }) => commands::run_color(color, cli.json, cli.quiet),
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
            DashCommands::List => commands::run_dash_list(cli.json, cli.quiet),
            DashCommands::Show { name } => commands::run_dash_show(name, cli.json, cli.quiet),
        },
        Some(Commands::Instance(cmd)) => commands::run_instance(cmd),
        Some(Commands::StateDir) => commands::run_state_dir(cli.json, cli.quiet),
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
