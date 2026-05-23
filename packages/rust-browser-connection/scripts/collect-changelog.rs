#!/usr/bin/env rust-script
//! Collect changelog fragments into CHANGELOG.md
//!
//! This script collects all .md files from changelog.d/ (except README.md)
//! and prepends them to CHANGELOG.md, then removes the processed fragments.
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml and changelog.d/ in repository root
//! - Multi-language: Cargo.toml and changelog.d/ in rust/ subfolder
//!
//! Usage: rust-script scripts/collect-changelog.rs [--rust-root <path>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! chrono = "0.4"
//! ```

use std::env;
use std::fs;
use std::path::Path;
use std::process::exit;
use chrono::Utc;
use regex::Regex;

const INSERT_MARKER: &str = "<!-- changelog-insert-here -->";

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

fn get_cargo_toml_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./Cargo.toml".to_string()
    } else {
        format!("{}/Cargo.toml", rust_root)
    }
}

fn get_changelog_dir(rust_root: &str) -> String {
    if rust_root == "." {
        "./changelog.d".to_string()
    } else {
        format!("{}/changelog.d", rust_root)
    }
}

fn get_changelog_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./CHANGELOG.md".to_string()
    } else {
        format!("{}/CHANGELOG.md", rust_root)
    }
}

fn get_version_from_cargo(cargo_toml_path: &str) -> Result<String, String> {
    let content = fs::read_to_string(cargo_toml_path)
        .map_err(|e| format!("Failed to read {}: {}", cargo_toml_path, e))?;

    let re = Regex::new(r#"(?m)^version\s*=\s*"([^"]+)""#).unwrap();

    if let Some(caps) = re.captures(&content) {
        Ok(caps.get(1).unwrap().as_str().to_string())
    } else {
        Err(format!("Could not find version in {}", cargo_toml_path))
    }
}

fn strip_frontmatter(content: &str) -> String {
    let re = Regex::new(r"(?s)^---\s*\n.*?\n---\s*\n(.*)$").unwrap();
    if let Some(caps) = re.captures(content) {
        caps.get(1).unwrap().as_str().trim().to_string()
    } else {
        content.trim().to_string()
    }
}

fn collect_fragments(changelog_dir: &str) -> String {
    let dir_path = Path::new(changelog_dir);
    if !dir_path.exists() {
        return String::new();
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
        Err(_) => return String::new(),
    };

    files.sort();

    let mut fragments = Vec::new();
    for file in &files {
        if let Ok(raw_content) = fs::read_to_string(file) {
            let content = strip_frontmatter(&raw_content);
            if !content.is_empty() {
                fragments.push(content);
            }
        }
    }

    fragments.join("\n\n")
}

fn update_changelog(changelog_file: &str, version: &str, fragments: &str) {
    let date_str = Utc::now().format("%Y-%m-%d").to_string();
    let new_entry = format!("\n## [{}] - {}\n\n{}\n", version, date_str, fragments);

    if Path::new(changelog_file).exists() {
        let mut content = fs::read_to_string(changelog_file).unwrap_or_default();

        if content.contains(INSERT_MARKER) {
            content = content.replace(INSERT_MARKER, &format!("{}{}", INSERT_MARKER, new_entry));
        } else {
            // Insert after the first ## heading
            let lines: Vec<&str> = content.lines().collect();
            let mut insert_index = None;

            for (i, line) in lines.iter().enumerate() {
                if line.starts_with("## [") {
                    insert_index = Some(i);
                    break;
                }
            }

            if let Some(idx) = insert_index {
                let mut new_lines: Vec<String> = lines[..idx].iter().map(|s| s.to_string()).collect();
                new_lines.push(new_entry.clone());
                new_lines.extend(lines[idx..].iter().map(|s| s.to_string()));
                content = new_lines.join("\n");
            } else {
                // Append after the main heading
                content.push_str(&new_entry);
            }
        }

        fs::write(changelog_file, content).expect("Failed to write changelog");
    } else {
        let content = format!(
            "# Changelog\n\n\
            All notable changes to this project will be documented in this file.\n\n\
            The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\n\
            and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n\
            {}\n{}\n",
            INSERT_MARKER, new_entry
        );
        fs::write(changelog_file, content).expect("Failed to write changelog");
    }

    println!("Updated CHANGELOG.md with version {}", version);
}

fn remove_fragments(changelog_dir: &str) {
    let dir_path = Path::new(changelog_dir);
    if !dir_path.exists() {
        return;
    }

    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "md")
                && path.file_name().map_or(false, |name| name != "README.md")
            {
                if fs::remove_file(&path).is_ok() {
                    println!("Removed {}", path.display());
                }
            }
        }
    }
}

fn main() {
    let rust_root = get_rust_root();
    let cargo_toml = get_cargo_toml_path(&rust_root);
    let changelog_dir = get_changelog_dir(&rust_root);
    let changelog_file = get_changelog_path(&rust_root);

    let version = match get_version_from_cargo(&cargo_toml) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };

    println!("Collecting changelog fragments for version {}", version);

    let fragments = collect_fragments(&changelog_dir);

    if fragments.is_empty() {
        println!("No changelog fragments found");
        exit(0);
    }

    update_changelog(&changelog_file, &version, &fragments);
    remove_fragments(&changelog_dir);

    println!("Changelog collection complete");
}
