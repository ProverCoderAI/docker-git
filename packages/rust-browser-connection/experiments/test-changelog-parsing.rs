#!/usr/bin/env rust-script
//! Test script to verify changelog parsing without look-ahead regex
//!
//! ```cargo
//! [dependencies]
//! regex = "1"
//! ```

use regex::Regex;

fn get_changelog_for_version(content: &str, version: &str) -> String {
    let escaped_version = regex::escape(version);
    let header_pattern = format!(r"(?m)^## \[{}\]", escaped_version);
    let header_re = Regex::new(&header_pattern).unwrap();

    if let Some(m) = header_re.find(content) {
        let after_header = &content[m.end()..];
        let body_start = after_header.find('\n').map_or(after_header.len(), |i| i + 1);
        let body = &after_header[body_start..];

        let next_section_re = Regex::new(r"(?m)^## \[").unwrap();
        let section_body = if let Some(next) = next_section_re.find(body) {
            &body[..next.start()]
        } else {
            body
        };

        let trimmed = section_body.trim();
        if trimmed.is_empty() {
            format!("Release v{}", version)
        } else {
            trimmed.to_string()
        }
    } else {
        format!("Release v{}", version)
    }
}

fn main() {
    let changelog = r#"# Changelog

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
"#;

    // Test 1: Extract middle version (has next section)
    let result = get_changelog_for_version(changelog, "0.3.0");
    assert!(result.contains("Feature A"), "Should contain Feature A, got: {}", result);
    assert!(result.contains("Bug fix C"), "Should contain Bug fix C, got: {}", result);
    assert!(!result.contains("Feature D"), "Should NOT contain Feature D, got: {}", result);
    println!("PASS: Test 1 - Middle version extraction");

    // Test 2: Extract last version (no next section)
    let result = get_changelog_for_version(changelog, "0.1.0");
    assert!(result.contains("Initial release"), "Should contain Initial release, got: {}", result);
    println!("PASS: Test 2 - Last version extraction");

    // Test 3: Non-existent version
    let result = get_changelog_for_version(changelog, "9.9.9");
    assert_eq!(result, "Release v9.9.9", "Should return default, got: {}", result);
    println!("PASS: Test 3 - Non-existent version");

    // Test 4: Version with special regex chars
    let result = get_changelog_for_version(changelog, "0.2.0");
    assert!(result.contains("Feature D"), "Should contain Feature D, got: {}", result);
    assert!(!result.contains("Initial release"), "Should NOT contain Initial release, got: {}", result);
    println!("PASS: Test 4 - Version with dots (regex escape)");

    // Test 5: Empty section
    let changelog_empty = r#"# Changelog

## [1.0.0] - 2026-01-01

## [0.9.0] - 2025-12-01

### Added
- Something
"#;
    let result = get_changelog_for_version(changelog_empty, "1.0.0");
    assert_eq!(result, "Release v1.0.0", "Empty section should return default, got: {}", result);
    println!("PASS: Test 5 - Empty section fallback");

    println!("\nAll tests passed!");
}
