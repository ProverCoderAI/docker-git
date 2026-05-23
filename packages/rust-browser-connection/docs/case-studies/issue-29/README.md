# Case Study: Issue #29 - Unsupported Look-Ahead Regex in create-github-release.rs

## Summary

The `scripts/create-github-release.rs` script used a regex pattern containing a positive look-ahead assertion `(?=...)`, which is not supported by Rust's `regex` crate. This caused a panic during GitHub release creation, preventing releases from completing even though crates.io publishing succeeded.

## Timeline of Events

| Date | Event | Detail |
|------|-------|--------|
| Prior | Template scripts converted to Rust | All CI/CD scripts were translated from JavaScript (.mjs) to Rust (.rs) using rust-script (Issue #25 era) |
| Prior | Regex pattern introduced | The `get_changelog_for_version()` function was written with `(?=\n## \[|$)` look-ahead |
| 2026-04-13 | mem-rs v0.2.0 release attempt | `linksplatform/mem-rs` release published to crates.io but GitHub Release creation panicked |
| 2026-04-13 | linksplatform/mem-rs#34 | Bug reported after investigating the failed release |
| 2026-04-13 | Issue #29 filed | Bug ported back to this template repository for fix |

## Root Cause Analysis

### The Bug

In `scripts/create-github-release.rs` (line 80), the changelog parsing function used:

```rust
let pattern = format!(r"(?s)## \[{}\].*?\n(.*?)(?=\n## \[|$)", escaped_version);
let re = Regex::new(&pattern).unwrap();
```

The `(?=\n## \[|$)` portion is a **positive look-ahead assertion**, which tells the regex engine: "match only if followed by `\n## [` or end-of-string, but don't consume the match."

### Why Rust's `regex` Crate Doesn't Support Look-Ahead

Rust's `regex` crate uses a **finite automaton (FA) engine** that guarantees **linear-time matching** — O(n) in the length of the input, regardless of the pattern. This is a deliberate design choice for safety and performance:

1. **Look-ahead requires backtracking** — Look-ahead assertions need the engine to "peek ahead" without consuming input, which requires backtracking or a separate pass
2. **Backtracking engines can be exponential** — PCRE-style engines with look-ahead can exhibit catastrophic backtracking (O(2^n)) on adversarial inputs
3. **Rust prioritizes safety** — The `regex` crate trades feature completeness for guaranteed performance bounds

The `regex` crate documents this explicitly: "look-around, including look-ahead and look-behind, is not supported."

### The Failure Mode

```
thread 'main' panicked at scripts/create-github-release.rs:48:35:
called `Result::unwrap()` on an `Err` value: Syntax(
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
regex parse error:
    (?s)## \[0\.2\.0\].*?\n(.*?)(?=\n## \[|$)
                                 ^^^
error: look-around, including look-ahead and look-behind, is not supported
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
)
```

The `.unwrap()` on the `Regex::new()` result converts the compilation error into a panic, crashing the script.

### How the Bug Was Introduced

When CI/CD scripts were translated from JavaScript to Rust, the regex pattern was likely carried over from a JavaScript implementation where `RegExp` supports look-ahead natively (JavaScript's regex engine is PCRE-based). The pattern worked correctly in the `.mjs` version but is invalid in Rust.

## Solution

### Fix Applied

Replaced the single look-ahead regex with a **two-step approach**:

```rust
// Step 1: Find the version header
let header_pattern = format!(r"(?m)^## \[{}\]", escaped_version);
let header_re = Regex::new(&header_pattern).unwrap();

if let Some(m) = header_re.find(&content) {
    // Step 2: Skip past the header line
    let after_header = &content[m.end()..];
    let body_start = after_header.find('\n').map_or(after_header.len(), |i| i + 1);
    let body = &after_header[body_start..];

    // Step 3: Find the next section boundary
    let next_section_re = Regex::new(r"(?m)^## \[").unwrap();
    let section_body = if let Some(next) = next_section_re.find(body) {
        &body[..next.start()]
    } else {
        body  // Last section — take everything remaining
    };

    let trimmed = section_body.trim();
    if trimmed.is_empty() {
        format!("Release v{}", version)
    } else {
        trimmed.to_string()
    }
}
```

### Why This Approach

1. **No look-ahead needed** — Instead of asserting "followed by `## [`", we find the boundary explicitly using a second regex and use string slicing
2. **Handles edge cases** — Works for the last section (no next `## [` header), empty sections, and versions with regex-special characters (dots are escaped)
3. **Uses only `regex` crate features** — All patterns are FA-compatible with guaranteed linear-time matching
4. **Equivalent semantics** — Produces identical output to the original pattern's intent

### Verification

A test script (`experiments/test-changelog-parsing.rs`) validates:
- Extracting a version section bounded by another section
- Extracting the last version section (no trailing boundary)
- Non-existent version returns default message
- Version strings with dots are properly regex-escaped
- Empty version sections return the default fallback

## Impact

- **Affected repositories** — Any repository using this template's `create-github-release.rs` script
- **Known incident** — `linksplatform/mem-rs` v0.2.0 release: crates.io published successfully, but GitHub Release creation failed
- **Severity** — The release was partially complete: the package was available on crates.io but the GitHub Release with notes and badges was missing

## Lessons Learned

1. **Test regex patterns at compile time** — When porting regex patterns between languages, verify compatibility with the target engine. Rust's `regex` crate has documented limitations.
2. **Avoid `.unwrap()` on regex compilation from dynamic patterns** — Consider using `expect()` with a descriptive message or handling the error gracefully to provide actionable diagnostics.
3. **Language migration requires testing** — When translating scripts from JavaScript to Rust, patterns, libraries, and runtime behavior differ. Each translation should include tests that exercise the ported logic.
4. **Two-step parsing is often cleaner** — Using string slicing with simple regex matches is more readable and debuggable than complex single-regex patterns with assertions.

## Related Issues

- [linksplatform/mem-rs#34](https://github.com/linksplatform/mem-rs/issues/34) — Original discovery of the panic during mem-rs v0.2.0 release
- [Issue #25](../issue-25/) — Previous case study covering CI/CD script translation to Rust
