#!/usr/bin/env rust-script
//! Create a changelog fragment for manual release PR
//!
//! This script creates a changelog fragment with the appropriate
//! category based on the bump type.
//!
//! Usage: rust-script scripts/create-changelog-fragment.rs --bump-type <type> [--description <desc>]
//!
//! ```cargo
//! [dependencies]
//! chrono = "0.4"
//! ```

use std::env;
use std::fs;
use std::path::Path;
use std::process::exit;
use chrono::Utc;

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

fn get_rust_root() -> String {
    if let Some(root) = get_arg("rust-root") {
        return root;
    }

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

fn get_changelog_dir(rust_root: &str) -> String {
    if rust_root == "." {
        "changelog.d".to_string()
    } else {
        format!("{}/changelog.d", rust_root)
    }
}

fn get_category(bump_type: &str) -> &'static str {
    match bump_type {
        "major" => "### Breaking Changes",
        "minor" => "### Added",
        "patch" => "### Fixed",
        _ => "### Changed",
    }
}

fn generate_timestamp() -> String {
    Utc::now().format("%Y%m%d%H%M%S").to_string()
}

fn main() {
    let bump_type = get_arg("bump-type").unwrap_or_else(|| "patch".to_string());
    let description = get_arg("description");

    // Validate bump type
    if !["major", "minor", "patch"].contains(&bump_type.as_str()) {
        eprintln!("Invalid bump type: {}. Must be major, minor, or patch.", bump_type);
        exit(1);
    }

    let rust_root = get_rust_root();
    let changelog_dir = get_changelog_dir(&rust_root);
    let timestamp = generate_timestamp();
    let fragment_file = format!("{}/{}-manual-{}.md", changelog_dir, timestamp, bump_type);

    // Determine changelog category based on bump type
    let category = get_category(&bump_type);

    // Create changelog fragment with frontmatter
    let description_text = description.unwrap_or_else(|| format!("Manual {} release", bump_type));
    let fragment_content = format!(
        "---\nbump: {}\n---\n\n{}\n\n- {}\n",
        bump_type, category, description_text
    );

    // Ensure changelog directory exists
    let dir_path = Path::new(&changelog_dir);
    if !dir_path.exists() {
        if let Err(e) = fs::create_dir_all(dir_path) {
            eprintln!("Error creating directory {}: {}", changelog_dir, e);
            exit(1);
        }
    }

    // Write the fragment file
    if let Err(e) = fs::write(&fragment_file, &fragment_content) {
        eprintln!("Error writing fragment file: {}", e);
        exit(1);
    }

    println!("Created changelog fragment: {}", fragment_file);
    println!();
    println!("Content:");
    println!("{}", fragment_content);
}
