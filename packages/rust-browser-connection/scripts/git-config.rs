#!/usr/bin/env rust-script
//! Configure git user for CI/CD pipeline
//!
//! This script sets up the git user name and email for automated commits.
//! It's used by the CI/CD pipeline before making commits.
//!
//! Usage: rust-script scripts/git-config.rs [--name <name>] [--email <email>]
//!
//! Environment variables:
//!   - GIT_USER_NAME: Git user name (default: github-actions[bot])
//!   - GIT_USER_EMAIL: Git user email (default: github-actions[bot]@users.noreply.github.com)

use std::env;
use std::process::{Command, exit};

fn get_arg(name: &str, default: &str) -> String {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        if let Some(value) = args.get(idx + 1) {
            return value.clone();
        }
    }

    // Check environment variable
    let env_name = format!("GIT_USER_{}", name.to_uppercase());
    env::var(&env_name).unwrap_or_else(|_| default.to_string())
}

fn run_command(cmd: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", cmd, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Command failed: {}", stderr));
    }

    Ok(())
}

fn main() {
    let name = get_arg("name", "github-actions[bot]");
    let email = get_arg("email", "github-actions[bot]@users.noreply.github.com");

    println!("Configuring git user: {} <{}>", name, email);

    if let Err(e) = run_command("git", &["config", "user.name", &name]) {
        eprintln!("Error configuring git name: {}", e);
        exit(1);
    }

    if let Err(e) = run_command("git", &["config", "user.email", &email]) {
        eprintln!("Error configuring git email: {}", e);
        exit(1);
    }

    println!("Git configuration complete");
}
