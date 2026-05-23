# rust-ai-driven-development-pipeline-template

A comprehensive template for AI-driven Rust development with full CI/CD pipeline support.

[![CI/CD Pipeline](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/actions?workflow=CI%2FCD+Pipeline)
[![Crates.io](https://img.shields.io/crates/v/example-sum-package-name?label=crates.io&style=flat)](https://crates.io/crates/example-sum-package-name)
[![Docs.rs](https://docs.rs/example-sum-package-name/badge.svg)](https://docs.rs/example-sum-package-name)
[![Rust Version](https://img.shields.io/badge/rust-1.70%2B-blue.svg)](https://www.rust-lang.org/)
[![Codecov](https://codecov.io/gh/link-foundation/rust-ai-driven-development-pipeline-template/branch/main/graph/badge.svg)](https://codecov.io/gh/link-foundation/rust-ai-driven-development-pipeline-template)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

## Features

- **Rust stable support**: Works with Rust stable version
- **Cross-platform testing**: CI runs on Ubuntu, macOS, and Windows
- **Comprehensive testing**: Unit tests, integration tests, and doc tests
- **Code quality**: rustfmt + Clippy with pedantic lints
- **Pre-commit hooks**: Automated code quality checks before commits
- **CI/CD pipeline**: GitHub Actions with multi-platform support
- **Changelog management**: Fragment-based changelog (like Changesets/Scriv)
- **Code coverage**: Automated coverage reports with cargo-llvm-cov and Codecov
- **Release automation**: Automatic GitHub releases, crates.io publishing, and optional Docker Hub image publishing
- **Template-safe defaults**: CI/CD skips publishing when package name is `example-sum-package-name`

## Quick Start

### Using This Template

1. Click "Use this template" on GitHub to create a new repository
2. Clone your new repository
3. Update `Cargo.toml`:
   - Change `name` from `example-sum-package-name` to your package name
   - Update `description`, `repository`, and `documentation` URLs
   - Update `[lib]` name and `[[bin]]` name
4. Update imports in `src/main.rs`, `tests/`, and `examples/`
5. Build and start developing!

### Development Setup

```bash
# Clone the repository
git clone https://github.com/link-foundation/rust-ai-driven-development-pipeline-template.git
cd rust-ai-driven-development-pipeline-template

# Build the project
cargo build

# Run tests
cargo test

# Run the CLI binary
cargo run -- --a 3 --b 7

# Run an example
cargo run --example basic_usage
```

### Running Tests

```bash
# Run all tests
cargo test

# Run tests with verbose output
cargo test --verbose

# Run doc tests
cargo test --doc

# Run a specific test
cargo test test_sum_positive_numbers

# Run tests with output
cargo test -- --nocapture
```

CI caps each test-matrix job at 10 minutes. `cargo test` does not provide a portable global per-test timeout, so long-running network, IO, or async tests should use explicit test-level timeouts. Repositories that adopt `cargo nextest` can configure runner deadlines with options such as `--slow-timeout` and `--leak-timeout`.

### Code Quality Checks

```bash
# Format code
cargo fmt

# Check formatting (CI style)
cargo fmt --check

# Run Clippy lints
cargo clippy --all-targets --all-features

# Check file size limits (requires rust-script: cargo install rust-script)
rust-script scripts/check-file-size.rs

# Run all checks
cargo fmt --check && cargo clippy --all-targets --all-features && rust-script scripts/check-file-size.rs
```

## Project Structure

```
.
├── .github/
│   └── workflows/
│       └── release.yml             # CI/CD pipeline configuration
├── changelog.d/                    # Changelog fragments
│   ├── README.md                   # Fragment instructions
│   └── *.md                        # Individual changelog entries
├── examples/
│   └── basic_usage.rs              # Usage examples
├── experiments/                    # Experiment and debug scripts
│   ├── test-changelog-parsing.rs   # Changelog parsing validation
│   └── test-crates-io-check.rs     # Crates.io version check validation
├── scripts/                        # Rust scripts (via rust-script)
│   ├── bump-version.rs             # Version bumping utility
│   ├── check-changelog-fragment.rs # Changelog fragment validation
│   ├── check-file-size.rs          # File size validation script
│   ├── check-release-needed.rs     # Release necessity check
│   ├── check-version-modification.rs # Version modification detection
│   ├── collect-changelog.rs        # Changelog collection script
│   ├── create-changelog-fragment.rs # Changelog fragment creation
│   ├── create-github-release.rs    # GitHub release creation
│   ├── detect-code-changes.rs      # Code change detection for CI
│   ├── get-bump-type.rs            # Version bump type determination
│   ├── get-version.rs              # Version extraction from Cargo.toml
│   ├── git-config.rs               # Git configuration for CI
│   ├── publish-crate.rs            # Crates.io publishing
│   ├── rust-paths.rs               # Rust root path detection
│   ├── version-and-commit.rs       # CI/CD version management
│   └── wait-for-crate.rs           # Crates.io availability wait before image publishing
├── src/
│   ├── lib.rs                      # Library entry point
│   ├── main.rs                     # CLI binary (uses lino-arguments)
│   └── sum.rs                      # Sum function module
├── tests/
│   ├── unit_tests.rs               # Unit test entry point
│   ├── unit/
│   │   ├── mod.rs
│   │   ├── sum.rs                  # Unit tests for sum function
│   │   └── ci-cd/
│   │       ├── mod.rs
│   │       └── changelog_parsing.rs # CI/CD changelog parsing tests
│   ├── integration_tests.rs        # Integration test entry point
│   └── integration/
│       ├── mod.rs
│       └── sum.rs                  # CLI integration tests
├── .gitignore                      # Git ignore patterns
├── .pre-commit-config.yaml         # Pre-commit hooks configuration
├── Cargo.toml                      # Project configuration
├── CHANGELOG.md                    # Project changelog
├── CONTRIBUTING.md                 # Contribution guidelines
├── LICENSE                         # Unlicense (public domain)
└── README.md                       # This file
```

## Design Choices

### Example Application

The template includes a simple CLI sum application using [lino-arguments](https://github.com/link-foundation/lino-arguments) (a drop-in replacement for clap that also supports `.lenv` and `.env` files). This demonstrates:

- Library module (`src/sum.rs`) with a pure function
- CLI binary (`src/main.rs`) using `lino-arguments` for argument parsing
- Unit tests (`tests/unit/sum.rs`) testing the function directly
- Integration tests (`tests/integration/sum.rs`) testing the full CLI binary

### Code Quality Tools

- **rustfmt**: Standard Rust code formatter
- **Clippy**: Rust linter with pedantic and nursery lints enabled
- **Pre-commit hooks**: Automated checks before each commit

### Testing Strategy

The template supports multiple levels of testing:

- **Unit tests**: In `tests/unit/` directory, testing functions directly
- **Integration tests**: In `tests/integration/` directory, testing CLI binary
- **CI/CD tests**: In `tests/unit/ci-cd/` directory, testing CI/CD script logic
- **Doc tests**: In documentation examples using `///` comments
- **Examples**: In `examples/` directory (also serve as documentation)

Users can easily delete CI/CD tests in `tests/unit/ci-cd/` if not needed.

### Changelog Management

This template uses a fragment-based changelog system similar to [Changesets](https://github.com/changesets/changesets) and [Scriv](https://scriv.readthedocs.io/).

```bash
# Create a changelog fragment
touch changelog.d/$(date +%Y%m%d_%H%M%S)_my_change.md

# Edit the fragment to document your changes
```

### CI/CD Pipeline

The GitHub Actions workflow provides:

1. **Change detection**: Only runs relevant jobs based on changed files
2. **Changelog check**: Validates changelog fragments on PRs with code changes
3. **Version check**: Prevents manual version modification in PRs
4. **Linting**: rustfmt and Clippy checks
5. **Test matrix**: 3 OS (Ubuntu, macOS, Windows) with Rust stable
6. **Code coverage**: cargo-llvm-cov with Codecov upload
7. **Building**: Release build and package validation
8. **Auto release**: Automatic releases when changelog fragments are merged to main
9. **Manual release**: Workflow dispatch with version bump type selection
10. **Optional Docker Hub publishing**: Pushes `latest` and version tags after the matching crates.io version is visible
11. **Documentation**: Automatic docs deployment to GitHub Pages after release

### Template-Safe Defaults

The default package name `example-sum-package-name` triggers skip logic in CI/CD scripts:
- `publish-crate.rs` skips crates.io publishing
- `create-github-release.rs` skips GitHub release creation
- Docker Hub publishing stays disabled unless `DOCKERHUB_IMAGE` is configured and a root `Dockerfile` exists

Rename the package in `Cargo.toml` to enable full CI/CD publishing.

## Configuration

### Updating Package Name

After creating a repository from this template:

1. Update `Cargo.toml`:
   - Change `name` field from `example-sum-package-name`
   - Update `repository` and `documentation` URLs
   - Change `[lib]` name and `[[bin]]` name

2. Update imports:
   - `src/main.rs`
   - `tests/unit/sum.rs`
   - `tests/integration/sum.rs`
   - `examples/basic_usage.rs`

3. Update badges in this `README.md`

### Optional Docker Hub Publishing

Projects that ship a Docker image can publish Docker Hub releases from the same Rust release workflow. Add a root `Dockerfile`, then configure:

| Name | Type | Example | Purpose |
| ---- | ---- | ------- | ------- |
| `DOCKERHUB_IMAGE` | Repository variable | `my-dockerhub-user/my-image` | Docker Hub repository to publish |
| `DOCKERHUB_USERNAME` | Repository variable or secret | `my-dockerhub-user` | Docker Hub login username |
| `DOCKERHUB_TOKEN` | Repository secret | Docker Hub access token | Docker Hub login token |

When configured, the release workflow publishes both `latest` and the Cargo package version tag, for example `my-dockerhub-user/my-image:0.10.0`. Docker publishing runs only after crates.io reports the matching version as available, and release checks rerun missing Docker Hub or GitHub release artifacts without bumping the version again.

Add a visible Docker Hub badge next to the crates.io badge in repositories that enable image publishing:

```markdown
[![Docker Hub](https://img.shields.io/docker/v/my-dockerhub-user/my-image?label=docker%20hub)](https://hub.docker.com/r/my-dockerhub-user/my-image)
```

## Deploying API documentation

The `deploy-docs` job in `.github/workflows/release.yml` publishes `cargo doc --no-deps --all-features` output to GitHub Pages on every push to `main` and on `workflow_dispatch` with `release_mode == 'instant'`. It uses the official `actions/configure-pages` / `actions/upload-pages-artifact` / `actions/deploy-pages` flow, which requires the repository's Pages source to be set to **GitHub Actions**.

Before the first run on `main`, open **Settings → Pages** of the new repository and set **Source = GitHub Actions**. This is a one-time manual step and cannot be configured from a workflow. The `deploy-docs` job will then provision the Pages site on its first run.

If this step is skipped, the first `deploy-docs` run fails on `actions/deploy-pages@v5` with `Error: Get Pages site failed.` / `Error: Failed to create deployment`. Flip the Pages source as described above and re-run the failed job; no workflow changes are required.

## Scripts Reference

All scripts in `scripts/` are Rust scripts that use [rust-script](https://github.com/fornwall/rust-script).
Install rust-script with: `cargo install rust-script`

| Command                               | Description              |
| ------------------------------------- | ------------------------ |
| `cargo test`                          | Run all tests            |
| `cargo fmt`                           | Format code              |
| `cargo clippy`                        | Run lints                |
| `cargo run -- --a 3 --b 7`           | Run CLI (sum 3 + 7)     |
| `cargo run --example basic_usage`     | Run example              |
| `rust-script scripts/check-file-size.rs` | Check file size limits |
| `rust-script scripts/bump-version.rs` | Bump version             |

## Example Usage

```rust
use example_sum_package_name::sum;

fn main() {
    let result = sum(2, 3);
    println!("2 + 3 = {result}");
}
```

See `examples/basic_usage.rs` for more examples.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests
4. Run quality checks: `cargo fmt && cargo clippy && cargo test`
5. Add a changelog fragment
6. Commit your changes (pre-commit hooks will run automatically)
7. Push and create a Pull Request

## License

[Unlicense](LICENSE) - Public Domain

This is free and unencumbered software released into the public domain. See [LICENSE](LICENSE) for details.

## Acknowledgments

Inspired by:
- [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template)
- [python-ai-driven-development-pipeline-template](https://github.com/link-foundation/python-ai-driven-development-pipeline-template)
- [lino-arguments](https://github.com/link-foundation/lino-arguments)
- [trees-rs](https://github.com/linksplatform/trees-rs)

## Resources

- [Rust Book](https://doc.rust-lang.org/book/)
- [Cargo Book](https://doc.rust-lang.org/cargo/)
- [Clippy Documentation](https://rust-lang.github.io/rust-clippy/)
- [rustfmt Documentation](https://rust-lang.github.io/rustfmt/)
- [Pre-commit Documentation](https://pre-commit.com/)
