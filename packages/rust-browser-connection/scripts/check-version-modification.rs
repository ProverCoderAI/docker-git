#!/usr/bin/env rust-script
//! Check for manual version modification in Cargo.toml
//!
//! This script prevents manual version changes in pull requests.
//! Versions should be managed automatically by the CI/CD pipeline
//! using changelog fragments in changelog.d/.
//!
//! Key behavior:
//! - Detects if `version = "..."` line has changed in Cargo.toml
//! - Fails the CI check if manual version change is detected
//! - Skips check for automated release branches (changelog-manual-release-*)
//!
//! Usage: rust-script scripts/check-version-modification.rs
//!
//! Environment variables (set by GitHub Actions):
//!   - GITHUB_HEAD_REF: The head branch name for PRs
//!   - GITHUB_BASE_REF: The base branch name for PRs
//!   - GITHUB_EVENT_NAME: Should be 'pull_request'
//!
//! Exit codes:
//!   - 0: No manual version changes detected (or check skipped)
//!   - 1: Manual version changes detected
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use std::env;
use std::path::Path;
use std::process::{Command, exit};
use regex::Regex;

fn exec(command: &str, args: &[&str]) -> String {
    match Command::new(command).args(args).output() {
        Ok(output) => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        Err(_) => String::new(),
    }
}

fn exec_ignore_error(command: &str, args: &[&str]) {
    let _ = Command::new(command)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

fn should_skip_version_check() -> bool {
    let head_ref = env::var("GITHUB_HEAD_REF").unwrap_or_default();

    // Skip for automated release PRs
    let automated_branch_prefixes = [
        "changelog-manual-release-",
        "changeset-release/",
        "release/",
        "automated-release/",
    ];

    for prefix in &automated_branch_prefixes {
        if head_ref.starts_with(prefix) {
            println!("Skipping version check for automated branch: {}", head_ref);
            return true;
        }
    }

    false
}

fn get_rust_root() -> String {
    if let Ok(root) = env::var("RUST_ROOT") {
        if !root.is_empty() {
            return root;
        }
    }

    if Path::new("./Cargo.toml").exists() {
        return ".".to_string();
    }

    if Path::new("./rust/Cargo.toml").exists() {
        return "rust".to_string();
    }

    ".".to_string()
}

fn get_cargo_toml_path(rust_root: &str) -> String {
    if rust_root == "." {
        "Cargo.toml".to_string()
    } else {
        format!("{}/Cargo.toml", rust_root)
    }
}

fn get_cargo_toml_diff(cargo_toml_path: &str) -> String {
    let base_ref = env::var("GITHUB_BASE_REF").unwrap_or_else(|_| "main".to_string());

    // Ensure we have the base branch
    exec_ignore_error("git", &["fetch", "origin", &base_ref, "--depth=1"]);

    // Get the diff for Cargo.toml
    exec(
        "git",
        &["diff", &format!("origin/{}...HEAD", base_ref), "--", cargo_toml_path],
    )
}

fn has_version_change(diff: &str) -> bool {
    if diff.is_empty() {
        return false;
    }

    // Look for changes to the version line
    // Match lines that start with + or - followed by version = "..."
    let version_change_pattern = Regex::new(r#"(?m)^[+-]version\s*=\s*""#).unwrap();
    version_change_pattern.is_match(diff)
}

fn main() {
    println!("Checking for manual version modifications in Cargo.toml...\n");

    // Only run on pull requests
    let event_name = env::var("GITHUB_EVENT_NAME").unwrap_or_default();
    if event_name != "pull_request" {
        println!("Skipping: Not a pull request event (event: {})", event_name);
        exit(0);
    }

    // Skip for automated release branches
    if should_skip_version_check() {
        exit(0);
    }

    // Get and check the diff
    let rust_root = get_rust_root();
    let cargo_toml_path = get_cargo_toml_path(&rust_root);
    let diff = get_cargo_toml_diff(&cargo_toml_path);

    if diff.is_empty() {
        println!("No changes to Cargo.toml detected.");
        println!("Version check passed.");
        exit(0);
    }

    // Check for version changes
    if has_version_change(&diff) {
        eprintln!("Error: Manual version change detected in Cargo.toml!\n");
        eprintln!("Versions are managed automatically by the CI/CD pipeline.");
        eprintln!("Please do not modify the version field directly.\n");
        eprintln!("To trigger a release, add a changelog fragment to changelog.d/");
        eprintln!("with the appropriate bump type (major, minor, or patch).\n");
        eprintln!("See changelog.d/README.md for more information.\n");
        eprintln!("If you need to undo your version change, run:");
        eprintln!("  git checkout origin/main -- Cargo.toml");
        exit(1);
    }

    println!("Cargo.toml was modified but version field was not changed.");
    println!("Version check passed.");
}
