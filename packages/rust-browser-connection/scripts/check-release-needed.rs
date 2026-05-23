#!/usr/bin/env rust-script
//! Check if a release is needed based on changelog fragments and version state
//!
//! This script checks:
//! 1. If there are changelog fragments to process
//! 2. If the current version has already been published to crates.io
//! 3. If the matching GitHub release and configured Docker Hub image tag exist
//!
//! IMPORTANT: This script checks external release artifacts, NOT git tags.
//! This is critical because:
//! - Git tags can exist without the package being published
//! - GitHub releases create tags but do not publish to crates.io or Docker Hub
//! - A crates.io publish can succeed while later Docker/GitHub release steps fail
//!
//! Supports both single-language and multi-language repository structures:
//! - Single-language: Cargo.toml in repository root
//! - Multi-language: Cargo.toml in rust/ subfolder
//!
//! Usage: rust-script scripts/check-release-needed.rs [--rust-root <path>]
//!
//! Environment variables:
//!   - HAS_FRAGMENTS: 'true' if changelog fragments exist (from get-bump-type.rs)
//!   - DOCKERHUB_IMAGE: Optional Docker Hub image name to verify (namespace/repository)
//!   - GITHUB_REPOSITORY: GitHub repository to verify (owner/repository)
//!
//! Outputs (written to GITHUB_OUTPUT):
//!   - should_release: 'true' if a release should be created
//!   - skip_bump: 'true' if version bump should be skipped while missing artifacts are recreated
//!   - crate_published: 'true' if the current version already exists on crates.io
//!   - dockerhub_required: 'true' if Docker Hub publishing is configured and a Dockerfile exists
//!   - dockerhub_published: 'true' if the configured Docker Hub tag exists
//!   - github_release_published: 'true' if the matching GitHub release exists
//!   - max_published_version: the highest non-yanked version on crates.io (for downstream use)
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ureq = "2"
//! serde = { version = "1", features = ["derive"] }
//! serde_json = "1"
//! ```

use serde::Deserialize;
use std::env;
use std::fs;
use std::path::Path;
use std::process::exit;

#[path = "rust-paths.rs"]
mod rust_paths;

fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{}", name);

    if let Some(idx) = args.iter().position(|a| a == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|s| !s.is_empty())
}

fn set_output(key: &str, value: &str) {
    if let Ok(output_file) = env::var("GITHUB_OUTPUT") {
        if let Err(e) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&output_file)
            .and_then(|mut f| {
                use std::io::Write;
                writeln!(f, "{}={}", key, value)
            })
        {
            eprintln!("Warning: Could not write to GITHUB_OUTPUT: {}", e);
        }
    }
    println!("Output: {}={}", key, value);
}

#[derive(Deserialize)]
struct CratesIoVersion {
    version: Option<CratesIoVersionInfo>,
}

#[derive(Deserialize)]
struct CratesIoVersionInfo {
    #[allow(dead_code)]
    num: String,
}

#[derive(Deserialize)]
struct CratesIoCrate {
    versions: Option<Vec<CratesIoVersionEntry>>,
}

#[derive(Deserialize)]
struct CratesIoVersionEntry {
    num: String,
    yanked: bool,
}

fn check_version_on_crates_io(crate_name: &str, version: &str) -> bool {
    let url = format!("https://crates.io/api/v1/crates/{}/{}", crate_name, version);

    match ureq::get(&url)
        .set("User-Agent", "rust-script-check-release")
        .call()
    {
        Ok(response) => {
            if response.status() == 200 {
                if let Ok(body) = response.into_string() {
                    if let Ok(data) = serde_json::from_str::<CratesIoVersion>(&body) {
                        return data.version.is_some();
                    }
                }
            }
            false
        }
        Err(ureq::Error::Status(404, _)) => false,
        Err(e) => {
            eprintln!("Warning: Could not check crates.io: {}", e);
            false
        }
    }
}

fn split_docker_image(image: &str) -> Option<(&str, &str)> {
    let mut parts = image.split('/');
    let namespace = parts.next()?;
    let repository = parts.next()?;

    if parts.next().is_some() || namespace.is_empty() || repository.is_empty() {
        None
    } else {
        Some((namespace, repository))
    }
}

fn check_docker_hub_tag(image: &str, version: &str) -> bool {
    let Some((namespace, repository)) = split_docker_image(image) else {
        eprintln!(
            "Warning: Could not parse Docker Hub image '{}'; expected namespace/repository",
            image
        );
        return false;
    };

    let url = format!(
        "https://hub.docker.com/v2/repositories/{}/{}/tags/{}",
        namespace, repository, version
    );

    match ureq::get(&url)
        .set("User-Agent", "rust-script-check-release")
        .call()
    {
        Ok(response) => response.status() == 200,
        Err(ureq::Error::Status(404, _)) => false,
        Err(e) => {
            eprintln!("Warning: Could not check Docker Hub tag: {}", e);
            false
        }
    }
}

fn check_github_release(repository: &str, tag_prefix: &str, version: &str) -> bool {
    let url = format!(
        "https://api.github.com/repos/{}/releases/tags/{}{}",
        repository, tag_prefix, version
    );

    let mut request = ureq::get(&url)
        .set("User-Agent", "rust-script-check-release")
        .set("Accept", "application/vnd.github+json");

    if let Ok(token) = env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            let auth_header = format!("Bearer {}", token);
            request = request.set("Authorization", &auth_header);
        }
    }

    match request.call() {
        Ok(response) => response.status() == 200,
        Err(ureq::Error::Status(404, _)) => false,
        Err(e) => {
            eprintln!("Warning: Could not check GitHub release: {}", e);
            false
        }
    }
}

fn docker_hub_image_to_check() -> Option<String> {
    get_arg("dockerhub-image")
        .or_else(|| get_arg("docker-hub-image"))
        .or_else(|| get_arg("dockerhub_image"))
        .filter(|image| Path::new("Dockerfile").exists() && !image.trim().is_empty())
}

fn release_is_complete(
    crate_published: bool,
    dockerhub_required: bool,
    dockerhub_published: bool,
    github_release_published: bool,
) -> bool {
    crate_published && (!dockerhub_required || dockerhub_published) && github_release_published
}

fn parse_semver(version: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = version.split('-').next()?.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}

fn get_max_published_version(crate_name: &str) -> Option<String> {
    let url = format!("https://crates.io/api/v1/crates/{}", crate_name);

    match ureq::get(&url)
        .set("User-Agent", "rust-script-check-release")
        .call()
    {
        Ok(response) => {
            if response.status() == 200 {
                if let Ok(body) = response.into_string() {
                    if let Ok(data) = serde_json::from_str::<CratesIoCrate>(&body) {
                        if let Some(versions) = data.versions {
                            let mut max_version: Option<(u32, u32, u32, String)> = None;
                            for v in &versions {
                                if v.yanked {
                                    continue;
                                }
                                if let Some(parsed) = parse_semver(&v.num) {
                                    match &max_version {
                                        None => {
                                            max_version =
                                                Some((parsed.0, parsed.1, parsed.2, v.num.clone()));
                                        }
                                        Some(current) => {
                                            if parsed > (current.0, current.1, current.2) {
                                                max_version = Some((
                                                    parsed.0,
                                                    parsed.1,
                                                    parsed.2,
                                                    v.num.clone(),
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                            return max_version.map(|v| v.3);
                        }
                    }
                }
            }
            None
        }
        Err(ureq::Error::Status(404, _)) => None,
        Err(e) => {
            eprintln!("Warning: Could not query crates.io for versions: {}", e);
            None
        }
    }
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

    let has_fragments = env::var("HAS_FRAGMENTS")
        .map(|v| v == "true")
        .unwrap_or(false);

    let package_info = match rust_paths::read_package_info(&package_manifest) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Error: {}", e);
            exit(1);
        }
    };
    let crate_name = package_info.name;
    let current_version = package_info.version;

    let max_published = get_max_published_version(&crate_name);
    if let Some(ref max_ver) = max_published {
        println!("Max published version on crates.io: {}", max_ver);
        set_output("max_published_version", max_ver);
    } else {
        println!("No versions published on crates.io yet (or crate not found)");
        set_output("max_published_version", "");
    }

    if !has_fragments {
        let crate_published = check_version_on_crates_io(&crate_name, &current_version);
        let tag_prefix = get_arg("tag-prefix").unwrap_or_else(|| "v".to_string());
        let dockerhub_image = docker_hub_image_to_check();
        let dockerhub_required = dockerhub_image.is_some();
        let dockerhub_published = dockerhub_image
            .as_deref()
            .map(|image| {
                check_docker_hub_tag(image, &current_version)
                    && check_docker_hub_tag(image, "latest")
            })
            .unwrap_or(false);
        let github_release_published = get_arg("repository")
            .or_else(|| env::var("GITHUB_REPOSITORY").ok().filter(|s| !s.is_empty()))
            .map(|repository| check_github_release(&repository, &tag_prefix, &current_version))
            .unwrap_or_else(|| {
                eprintln!("Warning: GITHUB_REPOSITORY not set; assuming GitHub release is missing");
                false
            });

        set_output(
            "crate_published",
            if crate_published { "true" } else { "false" },
        );
        set_output(
            "dockerhub_required",
            if dockerhub_required { "true" } else { "false" },
        );
        set_output(
            "dockerhub_published",
            if dockerhub_published { "true" } else { "false" },
        );
        set_output(
            "github_release_published",
            if github_release_published {
                "true"
            } else {
                "false"
            },
        );

        println!(
            "Crate: {}, Version: {}, Published on crates.io: {}",
            crate_name, current_version, crate_published
        );
        if let Some(image) = dockerhub_image {
            println!(
                "Docker image: {}, version/latest tags published on Docker Hub: {}",
                image, dockerhub_published
            );
        } else {
            println!("Docker Hub artifact check skipped: DOCKERHUB_IMAGE or Dockerfile is not configured");
        }
        println!(
            "GitHub release {}{} published: {}",
            tag_prefix, current_version, github_release_published
        );

        if release_is_complete(
            crate_published,
            dockerhub_required,
            dockerhub_published,
            github_release_published,
        ) {
            println!(
                "No changelog fragments and v{} is fully published",
                current_version
            );
            set_output("should_release", "false");
        } else {
            println!(
                "No changelog fragments but v{} is missing at least one release artifact",
                current_version
            );
            set_output("should_release", "true");
            set_output("skip_bump", "true");
        }
    } else {
        println!("Found changelog fragments, proceeding with release");
        set_output("should_release", "true");
        set_output("skip_bump", "false");
    }
}
