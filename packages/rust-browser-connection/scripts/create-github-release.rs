#!/usr/bin/env rust-script
//! Create GitHub Release from CHANGELOG.md
//!
//! Automatically includes crates.io and docs.rs badges in release notes
//! when the crate name can be detected from Cargo.toml.
//!
//! Usage: rust-script scripts/create-github-release.rs --release-version <version> --repository <repository> [--tag-prefix <prefix>] [--language <name>] [--release-label <label>] [--docker-hub-url <url>]
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! serde = { version = "1", features = ["derive"] }
//! serde_json = "1"
//! ```

use regex::Regex;
#[cfg(not(test))]
use serde::Serialize;
#[cfg(not(test))]
use std::env;
#[cfg(not(test))]
use std::fs;
#[cfg(not(test))]
use std::io::Write;
#[cfg(not(test))]
use std::path::Path;
#[cfg(not(test))]
use std::process::{exit, Command, Stdio};

#[cfg(not(test))]
const USAGE: &str = "Usage: rust-script scripts/create-github-release.rs --release-version <version> --repository <repository> [--tag-prefix <prefix>] [--language <name>] [--release-label <label>] [--docker-hub-url <url>]";

#[cfg(not(test))]
fn get_rust_root() -> String {
    if let Some(root) = get_arg("rust-root") {
        return root;
    }

    if Path::new("./Cargo.toml").exists() {
        return ".".to_string();
    }

    if Path::new("./rust/Cargo.toml").exists() {
        return "rust".to_string();
    }

    ".".to_string()
}

#[cfg(not(test))]
fn get_cargo_toml_path(rust_root: &str) -> String {
    if rust_root == "." {
        "./Cargo.toml".to_string()
    } else {
        format!("{rust_root}/Cargo.toml")
    }
}

#[cfg(not(test))]
fn get_crate_name_from_toml(cargo_toml_path: &str) -> Option<String> {
    let content = fs::read_to_string(cargo_toml_path).ok()?;
    let re = Regex::new(r#"(?m)^name\s*=\s*"([^"]+)""#).ok()?;
    re.captures(&content)
        .map(|captures| captures.get(1).unwrap().as_str().to_string())
}

#[cfg(not(test))]
fn get_arg(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    let flag = format!("--{name}");

    if let Some(idx) = args.iter().position(|arg| arg == &flag) {
        return args.get(idx + 1).cloned();
    }

    let env_name = name.to_uppercase().replace('-', "_");
    env::var(&env_name).ok().filter(|value| !value.is_empty())
}

fn normalize_release_version(release_version: &str) -> String {
    let trimmed = release_version.trim();
    let semver_re =
        Regex::new(r"(?i)(?:^|[-_])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$")
            .expect("release version regex should compile");

    semver_re.captures(trimmed).map_or_else(
        || {
            trimmed
                .strip_prefix('v')
                .or_else(|| trimmed.strip_prefix('V'))
                .unwrap_or(trimmed)
                .to_string()
        },
        |captures| {
            captures
                .get(1)
                .expect("release version regex should capture the semver")
                .as_str()
                .to_string()
        },
    )
}

fn build_release_tag(tag_prefix: &str, release_version: &str) -> String {
    let normalized_semver = normalize_release_version(release_version);
    format!("{tag_prefix}{normalized_semver}")
}

fn build_release_name(
    language: &str,
    release_version: &str,
    release_label: Option<&str>,
) -> String {
    let trimmed_language = language.trim();
    let language = if trimmed_language.is_empty() {
        "Rust"
    } else {
        trimmed_language
    };
    let normalized_semver = normalize_release_version(release_version);
    let name = format!("[{language}] {normalized_semver}");

    match release_label
        .map(str::trim)
        .filter(|label| !label.is_empty())
    {
        Some(label) => format!("{name} ({label})"),
        None => name,
    }
}

fn badge_escape(value: &str) -> String {
    value
        .replace('-', "--")
        .replace('_', "__")
        .replace(' ', "%20")
        .replace('/', "%2F")
        .replace(':', "%3A")
        .replace('+', "%2B")
}

fn docker_hub_tag_query(version: &str) -> String {
    version.replace('+', "%2B")
}

fn docker_hub_badge(url: &str, version: &str) -> String {
    let trimmed_url = url.trim_end_matches('/');
    let image = trimmed_url
        .strip_prefix("https://hub.docker.com/r/")
        .unwrap_or(trimmed_url);
    let image_tag = format!("{image}:{version}");
    let tag_url = format!(
        "{}/tags?name={}",
        trimmed_url,
        docker_hub_tag_query(version)
    );

    format!(
        "[![Docker Hub](https://img.shields.io/badge/docker-{}-2496ED?logo=docker)]({})",
        badge_escape(&image_tag),
        tag_url
    )
}

#[cfg(not(test))]
fn get_changelog_for_version(version: &str) -> String {
    let changelog_path = "CHANGELOG.md";

    if !Path::new(changelog_path).exists() {
        return format!("Release v{version}");
    }

    let content = match fs::read_to_string(changelog_path) {
        Ok(content) => content,
        Err(_) => return format!("Release v{version}"),
    };

    let escaped_version = regex::escape(version);
    let header_pattern = format!(r"(?m)^## \[{escaped_version}\]");
    let header_re = Regex::new(&header_pattern).unwrap();

    if let Some(version_header) = header_re.find(&content) {
        let after_header = &content[version_header.end()..];
        let body_start = after_header
            .find('\n')
            .map_or(after_header.len(), |i| i + 1);
        let body = &after_header[body_start..];

        let next_section_re = Regex::new(r"(?m)^## \[").unwrap();
        let section_body = if let Some(next) = next_section_re.find(body) {
            &body[..next.start()]
        } else {
            body
        };

        let trimmed = section_body.trim();
        if trimmed.is_empty() {
            format!("Release v{version}")
        } else {
            trimmed.to_string()
        }
    } else {
        format!("Release v{version}")
    }
}

#[cfg_attr(not(test), derive(Serialize))]
#[derive(Debug, PartialEq, Eq)]
struct ReleasePayload {
    tag_name: String,
    name: String,
    body: String,
}

fn build_release_payload(
    tag_prefix: &str,
    release_version: &str,
    language: &str,
    release_label: Option<&str>,
    body: String,
) -> ReleasePayload {
    ReleasePayload {
        tag_name: build_release_tag(tag_prefix, release_version),
        name: build_release_name(language, release_version, release_label),
        body,
    }
}

#[cfg(not(test))]
fn main() {
    let version = match get_arg("release-version") {
        Some(version) => version,
        None => {
            eprintln!("Error: Missing required argument --release-version");
            eprintln!("{USAGE}");
            exit(1);
        }
    };

    let repository = match get_arg("repository") {
        Some(repository) => repository,
        None => {
            eprintln!("Error: Missing required argument --repository");
            eprintln!("{USAGE}");
            exit(1);
        }
    };

    let tag_prefix = get_arg("tag-prefix").unwrap_or_else(|| "v".to_string());
    let language = get_arg("language").unwrap_or_else(|| "Rust".to_string());
    let release_label = get_arg("release-label");
    let crates_io_url = get_arg("crates-io-url");
    let docker_hub_url = get_arg("docker-hub-url");
    let normalized_version = normalize_release_version(&version);

    let rust_root = get_rust_root();
    let cargo_toml = get_cargo_toml_path(&rust_root);

    if let Some(ref crate_name) = get_crate_name_from_toml(&cargo_toml) {
        if crate_name == "example-sum-package-name" {
            println!(
                "Skipping GitHub release: package name is the template default 'example-sum-package-name'"
            );
            println!("Rename the package in Cargo.toml before creating releases");
            return;
        }
    }

    let mut release_notes = get_changelog_for_version(&normalized_version);
    let mut badges = Vec::new();
    if let Some(crate_name) = get_crate_name_from_toml(&cargo_toml) {
        let crate_badges = format!(
            "[![Crates.io](https://img.shields.io/crates/v/{crate_name}?label=crates.io)](https://crates.io/crates/{crate_name}/{normalized_version}) [![Docs.rs](https://docs.rs/{crate_name}/badge.svg)](https://docs.rs/{crate_name}/{normalized_version})"
        );
        badges.push(crate_badges);
    }
    if let Some(url) = docker_hub_url {
        badges.push(docker_hub_badge(&url, &normalized_version));
    }
    if !badges.is_empty() {
        release_notes = format!("{}\n\n{release_notes}", badges.join(" "));
    }

    if let Some(url) = crates_io_url {
        release_notes = format!("{url}\n\n{release_notes}");
    }

    let payload = build_release_payload(
        &tag_prefix,
        &normalized_version,
        &language,
        release_label.as_deref(),
        release_notes,
    );
    let tag = payload.tag_name.clone();
    println!("Creating GitHub release for {} ({})...", tag, payload.name);

    let payload_json = serde_json::to_string(&payload).expect("Failed to serialize payload");

    let mut child = Command::new("gh")
        .args([
            "api",
            &format!("repos/{repository}/releases"),
            "-X",
            "POST",
            "--input",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to execute gh command");

    if let Some(ref mut stdin) = child.stdin {
        stdin
            .write_all(payload_json.as_bytes())
            .expect("Failed to write to stdin");
    }

    let output = child
        .wait_with_output()
        .expect("Failed to wait on gh command");

    if output.status.success() {
        println!("Created GitHub release: {tag}");
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{stderr}{stdout}");
        if combined.contains("already exists")
            || combined.contains("already_exists")
            || combined.contains("Validation Failed")
        {
            println!("Release {tag} already exists, skipping");
        } else {
            eprintln!("Error creating release: {stderr}");
            exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_title_uses_language_and_bare_semver() {
        assert_eq!(
            build_release_name("Rust", "rust-v0.2.1", None),
            "[Rust] 0.2.1"
        );
        assert_eq!(
            build_release_name("JavaScript", "js_v1.2.3", None),
            "[JavaScript] 1.2.3"
        );
    }

    #[test]
    fn release_title_defaults_empty_language_to_rust() {
        assert_eq!(build_release_name(" ", "0.2.1", None), "[Rust] 0.2.1");
    }

    #[test]
    fn release_label_remains_optional_suffix() {
        assert_eq!(
            build_release_name("Rust", "0.2.1", Some("stable")),
            "[Rust] 0.2.1 (stable)"
        );
        assert_eq!(
            build_release_name("Rust", "0.2.1", Some(" ")),
            "[Rust] 0.2.1"
        );
    }

    #[test]
    fn release_tag_uses_prefix_with_normalized_semver() {
        assert_eq!(build_release_tag("rust-v", "0.2.1"), "rust-v0.2.1");
        assert_eq!(build_release_tag("rust_v", "rust-v0.2.1"), "rust_v0.2.1");
        assert_eq!(build_release_tag("v", "v0.2.1"), "v0.2.1");
    }

    #[test]
    fn release_payload_keeps_tag_prefix_out_of_release_name() {
        let payload =
            build_release_payload("rust-v", "0.2.1", "Rust", None, "release notes".to_string());

        assert_eq!(
            payload,
            ReleasePayload {
                tag_name: "rust-v0.2.1".to_string(),
                name: "[Rust] 0.2.1".to_string(),
                body: "release notes".to_string(),
            }
        );
    }

    #[test]
    fn docker_hub_badge_links_to_exact_tag() {
        let badge = docker_hub_badge("https://hub.docker.com/r/example/project", "1.2.3");

        assert!(badge.contains("docker-example%2Fproject%3A1.2.3"));
        assert!(badge.contains("https://hub.docker.com/r/example/project/tags?name=1.2.3"));
    }

    #[test]
    fn docker_hub_badge_escapes_build_metadata() {
        let badge = docker_hub_badge("https://hub.docker.com/r/example/project", "1.2.3+build.4");

        assert!(badge.contains("1.2.3%2Bbuild.4"));
        assert!(badge.contains("tags?name=1.2.3%2Bbuild.4"));
    }
}
