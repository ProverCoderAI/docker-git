#!/usr/bin/env rust-script
//! Parse changelog fragments and determine version bump type
//!
//! This script reads changeset fragments from changelog.d/ and determines
//! the version bump type based on the frontmatter in each fragment.
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: changelog.d/ in repository root
//! - Multi-language: changelog.d/ in rust/ subfolder
//!
//! Fragment format:
//! ---
//! bump: patch|minor|major
//! ---
//!
//! ### Added
//! - Your changes here
//!
//! Usage: rust-script scripts/get-bump-type.rs [--default <patch|minor|major>] [--rust-root <path>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use std::env;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::exit;
use regex::Regex;

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
        eprintln!("Using explicitly configured Rust root: {}", root);
        return root;
    }

    if Path::new("./Cargo.toml").exists() {
        eprintln!("Detected single-language repository (Cargo.toml in root)");
        return ".".to_string();
    }

    if Path::new("./rust/Cargo.toml").exists() {
        eprintln!("Detected multi-language repository (Cargo.toml in rust/)");
        return "rust".to_string();
    }

    eprintln!("Error: Could not find Cargo.toml in expected locations");
    exit(1);
}

fn get_changelog_dir(rust_root: &str) -> String {
    if rust_root == "." {
        "./changelog.d".to_string()
    } else {
        format!("{}/changelog.d", rust_root)
    }
}

fn set_output(key: &str, value: &str) {
    if let Ok(output_file) = env::var("GITHUB_OUTPUT") {
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&output_file) {
            let _ = writeln!(file, "{}={}", key, value);
        }
    }
    println!("Output: {}={}", key, value);
}

fn bump_priority(bump_type: &str) -> u8 {
    match bump_type {
        "patch" => 1,
        "minor" => 2,
        "major" => 3,
        _ => 0,
    }
}

fn parse_frontmatter(content: &str) -> Option<String> {
    let re = Regex::new(r"(?s)^---\s*\n(.*?)\n---").unwrap();

    if let Some(caps) = re.captures(content) {
        let frontmatter = caps.get(1).unwrap().as_str();

        // Parse YAML-like frontmatter (simple key: value format)
        for line in frontmatter.lines() {
            let bump_re = Regex::new(r"^\s*bump\s*:\s*(.+?)\s*$").unwrap();
            if let Some(bump_caps) = bump_re.captures(line) {
                return Some(bump_caps.get(1).unwrap().as_str().to_string());
            }
        }
    }

    None
}

fn determine_bump_type(changelog_dir: &str, default_bump: &str) -> (String, usize) {
    let dir_path = Path::new(changelog_dir);
    if !dir_path.exists() {
        println!("No {} directory found", changelog_dir);
        return (default_bump.to_string(), 0);
    }

    let mut files: Vec<_> = match fs::read_dir(dir_path) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.extension().map_or(false, |ext| ext == "md")
                    && p.file_name().map_or(false, |name| name != "README.md")
            })
            .collect(),
        Err(_) => {
            println!("No changelog fragments found");
            return (default_bump.to_string(), 0);
        }
    };

    if files.is_empty() {
        println!("No changelog fragments found");
        return (default_bump.to_string(), 0);
    }

    files.sort();

    let mut highest_priority: u8 = 0;
    let mut highest_bump_type = default_bump.to_string();

    for file in &files {
        if let Ok(content) = fs::read_to_string(file) {
            if let Some(bump) = parse_frontmatter(&content) {
                let priority = bump_priority(&bump);
                if priority > highest_priority {
                    highest_priority = priority;
                    highest_bump_type = bump.clone();
                }
                println!("Fragment {}: bump={}", file.file_name().unwrap().to_string_lossy(), bump);
            } else {
                println!(
                    "Fragment {}: no bump specified, using default",
                    file.file_name().unwrap().to_string_lossy()
                );
            }
        }
    }

    (highest_bump_type, files.len())
}

fn main() {
    let default_bump = get_arg("default").unwrap_or_else(|| "patch".to_string());
    let rust_root = get_rust_root();
    let changelog_dir = get_changelog_dir(&rust_root);

    let (bump_type, fragment_count) = determine_bump_type(&changelog_dir, &default_bump);

    println!("\nDetermined bump type: {} (from {} fragment(s))", bump_type, fragment_count);

    set_output("bump_type", &bump_type);
    set_output("fragment_count", &fragment_count.to_string());
    set_output("has_fragments", if fragment_count > 0 { "true" } else { "false" });
}
