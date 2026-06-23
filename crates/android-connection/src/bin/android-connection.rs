use clap::Parser;
use docker_git_android_connection::mcp::{run_stdio, McpState};
use docker_git_android_connection::{
    android_spec, DEFAULT_ADB_ENDPOINT, DEFAULT_ANDROID_IMAGE, DEFAULT_PROJECT_ID,
};
use std::io::{self, BufReader};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug)]
#[command(version, about = "Android MCP stdio server for docker-git")]
struct Cli {
    #[arg(long, default_value = DEFAULT_PROJECT_ID)]
    project: String,
    #[arg(long, default_value = "docker-git-shared")]
    network: String,
    #[arg(long, default_value = DEFAULT_ADB_ENDPOINT)]
    endpoint: String,
    #[arg(long, default_value = DEFAULT_ANDROID_IMAGE)]
    image: String,
    #[arg(long, default_value = ".")]
    workspace: PathBuf,
    #[arg(long)]
    allow_install: bool,
    #[arg(long)]
    no_adb_probe: bool,
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
    let spec = android_spec(&cli.project, &cli.network, &cli.endpoint, &cli.image)?;
    let state = McpState {
        spec,
        workspace: cli.workspace,
        adb_probe: !cli.no_adb_probe,
        allow_install: cli.allow_install,
    };
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();
    run_stdio(&mut reader, &mut writer, state)?;
    Ok(())
}
