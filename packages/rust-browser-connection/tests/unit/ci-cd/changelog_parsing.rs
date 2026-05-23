use regex::Regex;

fn get_changelog_for_version(content: &str, version: &str) -> String {
    let escaped_version = regex::escape(version);
    let header_pattern = format!(r"(?m)^## \[{escaped_version}\]");
    let header_re = Regex::new(&header_pattern).unwrap();

    header_re.find(content).map_or_else(
        || format!("Release v{version}"),
        |m| {
            let after_header = &content[m.end()..];
            let body_start = after_header
                .find('\n')
                .map_or(after_header.len(), |i| i + 1);
            let body = &after_header[body_start..];

            let next_section_re = Regex::new(r"(?m)^## \[").unwrap();
            let section_body = next_section_re
                .find(body)
                .map_or(body, |next| &body[..next.start()]);

            let trimmed = section_body.trim();
            if trimmed.is_empty() {
                format!("Release v{version}")
            } else {
                trimmed.to_string()
            }
        },
    )
}

const SAMPLE_CHANGELOG: &str = r"# Changelog

## [0.3.0] - 2026-04-13

### Added
- Feature A
- Feature B

### Fixed
- Bug fix C

## [0.2.0] - 2026-03-11

### Added
- Feature D

## [0.1.0] - 2025-01-01

### Added
- Initial release
";

#[test]
fn test_middle_version_extraction() {
    let result = get_changelog_for_version(SAMPLE_CHANGELOG, "0.3.0");
    assert!(result.contains("Feature A"));
    assert!(result.contains("Bug fix C"));
    assert!(!result.contains("Feature D"));
}

#[test]
fn test_last_version_extraction() {
    let result = get_changelog_for_version(SAMPLE_CHANGELOG, "0.1.0");
    assert!(result.contains("Initial release"));
}

#[test]
fn test_nonexistent_version() {
    let result = get_changelog_for_version(SAMPLE_CHANGELOG, "9.9.9");
    assert_eq!(result, "Release v9.9.9");
}

#[test]
fn test_version_with_dots_regex_escape() {
    let result = get_changelog_for_version(SAMPLE_CHANGELOG, "0.2.0");
    assert!(result.contains("Feature D"));
    assert!(!result.contains("Initial release"));
}

#[test]
fn test_empty_section_fallback() {
    let changelog = r"# Changelog

## [1.0.0] - 2026-01-01

## [0.9.0] - 2025-12-01

### Added
- Something
";
    let result = get_changelog_for_version(changelog, "1.0.0");
    assert_eq!(result, "Release v1.0.0");
}
