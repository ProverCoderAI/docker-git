#!/usr/bin/env rust-script
//! Rust package path detection utility
//!
//! Automatically detects the Rust package root for both:
//! - Single-language repositories (Cargo.toml in root)
//! - Multi-language repositories (Cargo.toml in rust/ subfolder)
//!
//! This utility follows best practices for multi-language monorepo support,
//! allowing scripts to work seamlessly in both repository structures.
//!
//! Usage (as library - import functions from this module):
//!   The functions are used by other scripts in this directory.
//!
//! Configuration options (in order of priority):
//!   1. Explicit parameter passed to functions
//!   2. CLI argument: --rust-root <path>
//!   3. Environment variable: `RUST_ROOT`
//!   4. Auto-detection: Check ./Cargo.toml first, then ./rust/Cargo.toml

#![allow(dead_code)]

use regex::Regex;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
}

/// Detect Rust package root directory
/// Checks in order:
/// 1. Explicit `rust_root` parameter
/// 2. --rust-root CLI argument
/// 3. `RUST_ROOT` environment variable
/// 4. ./Cargo.toml (single-language repo)
/// 5. ./rust/Cargo.toml (multi-language repo)
pub fn get_rust_root(explicit_root: Option<&str>, verbose: bool) -> Result<String, String> {
    // If explicitly configured, use that
    if let Some(root) = explicit_root {
        if verbose {
            eprintln!("Using explicitly configured Rust root: {root}");
        }
        return Ok(root.to_string());
    }

    // Check CLI arguments
    let args: Vec<String> = env::args().collect();
    if let Some(idx) = args.iter().position(|a| a == "--rust-root") {
        if let Some(root) = args.get(idx + 1) {
            if verbose {
                eprintln!("Using CLI configured Rust root: {root}");
            }
            return Ok(root.clone());
        }
    }

    // Check environment variable
    if let Ok(root) = env::var("RUST_ROOT") {
        if !root.is_empty() {
            if verbose {
                eprintln!("Using environment configured Rust root: {root}");
            }
            return Ok(root);
        }
    }

    // Check for single-language repo (Cargo.toml in root)
    if Path::new("./Cargo.toml").exists() {
        if verbose {
            eprintln!("Detected single-language repository (Cargo.toml in root)");
        }
        return Ok(".".to_string());
    }

    // Check for multi-language repo (Cargo.toml in rust/ subfolder)
    if Path::new("./rust/Cargo.toml").exists() {
        if verbose {
            eprintln!("Detected multi-language repository (Cargo.toml in rust/)");
        }
        return Ok("rust".to_string());
    }

    // No Cargo.toml found
    Err("Could not find Cargo.toml in expected locations.\n\
        Searched in:\n  \
        - ./Cargo.toml (single-language repository)\n  \
        - ./rust/Cargo.toml (multi-language repository)\n\n\
        To fix this, either:\n  \
        1. Run the script from the repository root\n  \
        2. Explicitly configure the Rust root using --rust-root option\n  \
        3. Set the RUST_ROOT environment variable"
        .to_string())
}

/// Get the path to Cargo.toml
pub fn get_cargo_toml_path(rust_root: &str) -> PathBuf {
    if rust_root == "." {
        PathBuf::from("./Cargo.toml")
    } else {
        PathBuf::from(rust_root).join("Cargo.toml")
    }
}

/// Get the path to Cargo.lock
pub fn get_cargo_lock_path(rust_root: &str) -> PathBuf {
    if rust_root == "." {
        PathBuf::from("./Cargo.lock")
    } else {
        PathBuf::from(rust_root).join("Cargo.lock")
    }
}

/// Get the path to changelog.d directory
pub fn get_changelog_dir(rust_root: &str) -> PathBuf {
    if rust_root == "." {
        PathBuf::from("./changelog.d")
    } else {
        PathBuf::from(rust_root).join("changelog.d")
    }
}

/// Get the path to CHANGELOG.md
pub fn get_changelog_path(rust_root: &str) -> PathBuf {
    if rust_root == "." {
        PathBuf::from("./CHANGELOG.md")
    } else {
        PathBuf::from(rust_root).join("CHANGELOG.md")
    }
}

/// Check if we need to change directory before running cargo commands
pub fn needs_cd(rust_root: &str) -> bool {
    rust_root != "."
}

/// Parse Rust root from CLI arguments
pub fn parse_rust_root_from_args() -> Option<String> {
    let args: Vec<String> = env::args().collect();
    if let Some(idx) = args.iter().position(|a| a == "--rust-root") {
        return args.get(idx + 1).cloned();
    }
    env::var("RUST_ROOT").ok().filter(|s| !s.is_empty())
}

pub fn get_package_manifest_path(root_manifest: &Path) -> Result<PathBuf, String> {
    let content = fs::read_to_string(root_manifest)
        .map_err(|e| format!("Failed to read {}: {}", root_manifest.display(), e))?;

    if has_package_section(&content) {
        return Ok(root_manifest.to_path_buf());
    }

    if has_workspace_section(&content) {
        return resolve_workspace_member_manifest(root_manifest, &content);
    }

    Err(format!(
        "Could not find [package] or [workspace] in {}",
        root_manifest.display()
    ))
}

pub fn read_package_info(manifest_path: &Path) -> Result<PackageInfo, String> {
    let content = fs::read_to_string(manifest_path)
        .map_err(|e| format!("Failed to read {}: {}", manifest_path.display(), e))?;

    let name = find_manifest_value(&content, "name")
        .ok_or_else(|| format!("Could not find name in {}", manifest_path.display()))?;
    let version = find_manifest_value(&content, "version")
        .ok_or_else(|| format!("Could not find version in {}", manifest_path.display()))?;

    Ok(PackageInfo { name, version })
}

fn has_package_section(content: &str) -> bool {
    Regex::new(r"(?m)^\[package\]\s*$")
        .unwrap()
        .is_match(content)
}

fn has_workspace_section(content: &str) -> bool {
    Regex::new(r"(?m)^\[workspace\]\s*$")
        .unwrap()
        .is_match(content)
}

fn resolve_workspace_member_manifest(
    root_manifest: &Path,
    content: &str,
) -> Result<PathBuf, String> {
    let members = parse_workspace_members(content).ok_or_else(|| {
        format!(
            "Could not find workspace members in {}",
            root_manifest.display()
        )
    })?;

    let base_dir = root_manifest.parent().ok_or_else(|| {
        format!(
            "Could not determine parent directory for {}",
            root_manifest.display()
        )
    })?;

    for member in members {
        let manifest = base_dir.join(member).join("Cargo.toml");
        let Ok(member_content) = fs::read_to_string(&manifest) else {
            continue;
        };

        if !has_package_section(&member_content) || is_publish_false(&member_content) {
            continue;
        }

        return Ok(manifest);
    }

    Err(format!(
        "No publishable workspace members found in {}",
        root_manifest.display()
    ))
}

fn parse_workspace_members(content: &str) -> Option<Vec<String>> {
    let re = Regex::new(r"(?s)members\s*=\s*\[(.*?)\]").unwrap();
    let captures = re.captures(content)?;
    let body = captures.get(1)?.as_str();

    let members = body
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.trim_matches('"').to_string())
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();

    if members.is_empty() {
        None
    } else {
        Some(members)
    }
}

fn is_publish_false(content: &str) -> bool {
    Regex::new(r"(?m)^publish\s*=\s*false\s*$")
        .unwrap()
        .is_match(content)
}

fn find_manifest_value(content: &str, key: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?m)^{}\s*=\s*"([^"]+)""#, regex::escape(key))).unwrap();
    re.captures(content)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}

#[cfg(not(test))]
fn main() {
    // When run directly, just print the detected rust root
    match get_rust_root(None, true) {
        Ok(root) => {
            println!("Rust root: {root}");
            println!("Cargo.toml: {}", get_cargo_toml_path(&root).display());
            println!("Changelog dir: {}", get_changelog_dir(&root).display());
        }
        Err(e) => {
            eprintln!("Error: {e}");
            std::process::exit(1);
        }
    }
}
