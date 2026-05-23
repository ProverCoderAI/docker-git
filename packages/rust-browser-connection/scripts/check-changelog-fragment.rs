#!/usr/bin/env rust-script
//! Check if a changelog fragment was added in the current PR
//!
//! This script validates that a changelog fragment is added in the PR diff,
//! not just checking if any fragments exist in the directory. This prevents
//! the check from incorrectly passing when there are leftover fragments
//! from previous PRs that haven't been released yet.
//!
//! Usage: rust-script scripts/check-changelog-fragment.rs
//!
//! Environment variables (set by GitHub Actions):
//!   - GITHUB_BASE_REF: Base branch name for PR (e.g., "main")
//!
//! Exit codes:
//!   - 0: Check passed (fragment added or no source changes)
//!   - 1: Check failed (source changes without changelog fragment)
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
            if output.status.success() {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            } else {
                eprintln!("Error executing {} {:?}", command, args);
                eprintln!("{}", String::from_utf8_lossy(&output.stderr));
                String::new()
            }
        }
        Err(e) => {
            eprintln!("Failed to execute {} {:?}: {}", command, args, e);
            String::new()
        }
    }
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

fn get_changed_files() -> Vec<String> {
    let base_ref = env::var("GITHUB_BASE_REF").unwrap_or_else(|_| "main".to_string());
    eprintln!("Comparing against origin/{}...HEAD", base_ref);

    let output = exec(
        "git",
        &["diff", "--name-only", &format!("origin/{}...HEAD", base_ref)],
    );

    if output.is_empty() {
        return Vec::new();
    }

    output.lines().filter(|s| !s.is_empty()).map(String::from).collect()
}

fn is_source_file(file_path: &str, rust_root: &str) -> bool {
    let prefix = if rust_root == "." { String::new() } else { format!("{}/", rust_root) };

    let source_patterns = [
        Regex::new(&format!(r"^{}src/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(r"^{}tests/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(r"^{}?scripts/", regex::escape(&prefix))).unwrap(),
        Regex::new(&format!(r"^{}Cargo\.toml$", regex::escape(&prefix))).unwrap(),
    ];

    source_patterns.iter().any(|pattern| pattern.is_match(file_path))
}

fn is_changelog_fragment(file_path: &str, rust_root: &str) -> bool {
    let changelog_dir = if rust_root == "." { "changelog.d/".to_string() } else { format!("{}/changelog.d/", rust_root) };

    (file_path.starts_with(&changelog_dir) || file_path.starts_with("changelog.d/"))
        && file_path.ends_with(".md")
        && !file_path.ends_with("README.md")
}

fn main() {
    println!("Checking for changelog fragment in PR diff...\n");

    let rust_root = get_rust_root();
    if rust_root != "." {
        println!("Detected multi-language repository (Rust root: {})", rust_root);
    }

    let changed_files = get_changed_files();

    if changed_files.is_empty() {
        println!("No changed files found");
        exit(0);
    }

    println!("Changed files:");
    for file in &changed_files {
        println!("  {}", file);
    }
    println!();

    // Count source files changed
    let source_changes: Vec<&String> = changed_files.iter().filter(|f| is_source_file(f, &rust_root)).collect();
    let source_changed_count = source_changes.len();

    println!("Source files changed: {}", source_changed_count);
    if source_changed_count > 0 {
        for file in &source_changes {
            println!("  {}", file);
        }
    }
    println!();

    // Count changelog fragments added in this PR
    let fragments_added: Vec<&String> = changed_files
        .iter()
        .filter(|f| is_changelog_fragment(f, &rust_root))
        .collect();
    let fragment_added_count = fragments_added.len();

    println!("Changelog fragments added: {}", fragment_added_count);
    if fragment_added_count > 0 {
        for file in &fragments_added {
            println!("  {}", file);
        }
    }
    println!();

    // Check if source files changed but no fragment was added
    if source_changed_count > 0 && fragment_added_count == 0 {
        eprintln!("::error::No changelog fragment found in this PR. Please add a changelog entry in changelog.d/");
        eprintln!();
        eprintln!("To create a changelog fragment:");
        eprintln!("  Create a new .md file in changelog.d/ with your changes");
        eprintln!();
        eprintln!("See changelog.d/README.md for more information.");
        exit(1);
    }

    println!(
        "Changelog check passed (source files changed: {}, fragments added: {})",
        source_changed_count, fragment_added_count
    );
}
