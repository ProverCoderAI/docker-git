mod changelog_parsing;
#[path = "../../../scripts/check-file-size.rs"]
mod check_file_size;
#[path = "../../../scripts/create-github-release.rs"]
mod create_github_release;
#[path = "../../../scripts/rust-paths.rs"]
mod rust_paths;
#[allow(clippy::all, clippy::nursery, clippy::pedantic, dead_code)]
#[path = "../../../scripts/version-and-commit.rs"]
mod version_and_commit;
mod workflow_release;
mod workspace_manifest_resolution;
