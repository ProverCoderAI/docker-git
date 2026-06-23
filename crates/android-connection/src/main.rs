use clap::{Args, Parser, Subcommand};
use docker_git_android_connection::{
    android_spec, docker_run_args, docker_stop_args, DEFAULT_ADB_ENDPOINT, DEFAULT_ANDROID_IMAGE,
    DEFAULT_PROJECT_ID,
};
use serde_json::json;
use std::process::{Command, ExitCode};

#[derive(Parser, Debug)]
#[command(version, about = "docker-git Android runtime lifecycle CLI")]
struct Cli {
    #[command(subcommand)]
    command: LifecycleCommand,
}

#[derive(Subcommand, Debug)]
enum LifecycleCommand {
    Start(LifecycleArgs),
    Status(LifecycleArgs),
    Stop(LifecycleArgs),
}

#[derive(Args, Clone, Debug)]
struct LifecycleArgs {
    #[arg(long, default_value = DEFAULT_PROJECT_ID)]
    project: String,
    #[arg(long, default_value = "docker-git-shared")]
    network: String,
    #[arg(long, default_value = DEFAULT_ADB_ENDPOINT)]
    endpoint: String,
    #[arg(long, default_value = DEFAULT_ANDROID_IMAGE)]
    image: String,
    #[arg(long)]
    dry_run: bool,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        LifecycleCommand::Start(args) => start(args),
        LifecycleCommand::Status(args) => status(args),
        LifecycleCommand::Stop(args) => stop(args),
    }
}

fn start(args: LifecycleArgs) -> Result<(), Box<dyn std::error::Error>> {
    let spec = android_spec(&args.project, &args.network, &args.endpoint, &args.image)?;
    let docker_args = docker_run_args(&spec);
    if args.dry_run {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({ "docker": docker_args }))?
        );
        return Ok(());
    }

    run_docker(&docker_args)
}

fn status(args: LifecycleArgs) -> Result<(), Box<dyn std::error::Error>> {
    let spec = android_spec(&args.project, &args.network, &args.endpoint, &args.image)?;
    println!("{}", serde_json::to_string_pretty(&spec)?);
    Ok(())
}

fn stop(args: LifecycleArgs) -> Result<(), Box<dyn std::error::Error>> {
    let spec = android_spec(&args.project, &args.network, &args.endpoint, &args.image)?;
    let docker_args = docker_stop_args(&spec);
    if args.dry_run {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!({ "docker": docker_args }))?
        );
        return Ok(());
    }

    run_docker(&docker_args)
}

fn run_docker(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let output = Command::new("docker").args(args).output()?;
    if output.status.success() {
        print!("{}", String::from_utf8_lossy(&output.stdout));
        return Ok(());
    }

    Err(format!(
        "docker failed with status {:?}\nstdout:\n{}\nstderr:\n{}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout).trim(),
        String::from_utf8_lossy(&output.stderr).trim()
    )
    .into())
}
