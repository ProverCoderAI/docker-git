#!/usr/bin/env rust-script
//! Publish package to crates.io
//!
//! This script publishes the Rust package to crates.io and handles
//! the case where the version already exists.
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml in repository root
//! - Multi-language: Cargo.toml in rust/ subfolder
//!
//! Usage: rust-script scripts/publish-crate.rs [--token <token>] [--rust-root <path>]
//!
//! Environment variables (checked in order of priority):
//!   - CARGO_REGISTRY_TOKEN: Cargo's native crates.io token (preferred)
//!   - CARGO_TOKEN: Alternative token name for backwards compatibility
//!
//! Outputs (written to GITHUB_OUTPUT):
//!   - publish_result: 'success', 'already_exists', or 'failed'
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use std::env;
use std::fs;
use std::io::Write;
use std::process::{Command, exit};

#[path = "rust-paths.rs"]
mod rust_paths;

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    None
}

fn needs_cd(rust_root: &str) -> bool {
    rust_root != "."
}

fn set_output(key: &str, value: &str) {
    if let Ok(output_file) = env::var("GITHUB_OUTPUT") {
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&output_file) {
            let _ = writeln!(file, "{}={}", key, value);
        }
    }
    println!("Output: {}={}", key, value);
}

fn main() {
    let rust_root = match rust_paths::get_rust_root(None, true) {
        Ok(root) => root,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let cargo_toml = rust_paths::get_cargo_toml_path(&rust_root);
    let package_manifest = match rust_paths::get_package_manifest_path(&cargo_toml) {
        Ok(path) => path,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };

    // Get token from CLI arg, then env vars
    let token = get_arg("token")
        .or_else(|| env::var("CARGO_REGISTRY_TOKEN").ok().filter(|s| !s.is_empty()))
        .or_else(|| env::var("CARGO_TOKEN").ok().filter(|s| !s.is_empty()));

    let package_info = match rust_paths::read_package_info(&package_manifest) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let name = package_info.name;
    let version = package_info.version;

    println!("Package: {}@{}", name, version);

    if name == "example-sum-package-name" {
        println!("Skipping publish: package name is the template default 'example-sum-package-name'");
        println!("Rename the package in Cargo.toml before publishing to crates.io");
        set_output("publish_result", "skipped");
        return;
    }

    println!();
    println!("=== Attempting to publish to crates.io ===");

    if token.is_none() {
        println!("::warning::Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set, attempting publish without explicit token");
        println!();
        println!("To fix this, ensure one of the following secrets is configured:");
        println!("  - CARGO_REGISTRY_TOKEN (Cargo's native env var, preferred)");
        println!("  - CARGO_TOKEN (alternative for backwards compatibility)");
        println!();
        println!("For organization secrets, you may need to map the secret name in your workflow:");
        println!("  env:");
        println!("    CARGO_REGISTRY_TOKEN: ${{{{ secrets.CARGO_TOKEN }}}}");
        println!();
    } else {
        println!("Using provided authentication token");
    }

    // Build the cargo publish command
    let mut cmd = Command::new("cargo");
    cmd.arg("publish").arg("--allow-dirty").arg("-p").arg(&name);

    if let Some(t) = &token {
        cmd.arg("--token").arg(t);
    }

    // For multi-language repos, change to the rust directory
    if needs_cd(&rust_root) {
        cmd.current_dir(&rust_root);
    }

    let output = cmd.output().expect("Failed to execute cargo publish");

    if output.status.success() {
        println!("Successfully published {}@{} to crates.io", name, version);
        set_output("publish_result", "success");
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}\n{}", stdout, stderr);

        if combined.contains("already uploaded") || combined.contains("already exists") {
            eprintln!();
            eprintln!("=== VERSION ALREADY PUBLISHED ===");
            eprintln!();
            eprintln!("Version {} already exists on crates.io.", version);
            eprintln!("The release pipeline must always publish a version greater than what is already published.");
            eprintln!("This indicates a bug in version bumping: the pipeline should have computed a new, unpublished version.");
            eprintln!();
            set_output("publish_result", "already_exists");
            exit(1);
        } else if combined.contains("non-empty token")
            || combined.contains("please provide a")
            || combined.contains("unauthorized")
            || combined.contains("authentication")
        {
            eprintln!();
            eprintln!("=== AUTHENTICATION FAILURE ===");
            eprintln!();
            eprintln!("Failed to publish due to missing or invalid authentication token.");
            eprintln!();
            eprintln!("SOLUTION: Configure one of these secrets in your repository or organization:");
            eprintln!("  1. CARGO_REGISTRY_TOKEN - Cargo's native environment variable (preferred)");
            eprintln!("  2. CARGO_TOKEN - Alternative name for backwards compatibility");
            eprintln!();
            eprintln!("If using organization secrets with a different name, map it in your workflow:");
            eprintln!("  - name: Publish to Crates.io");
            eprintln!("    env:");
            eprintln!("      CARGO_REGISTRY_TOKEN: ${{{{ secrets.YOUR_SECRET_NAME }}}}");
            eprintln!();
            eprintln!("See: https://doc.rust-lang.org/cargo/reference/publishing.html");
            eprintln!();
            set_output("publish_result", "auth_failed");
            exit(1);
        } else {
            eprintln!("Failed to publish for unknown reason");
            eprintln!("{}", combined);
            set_output("publish_result", "failed");
            exit(1);
        }
    }
}
