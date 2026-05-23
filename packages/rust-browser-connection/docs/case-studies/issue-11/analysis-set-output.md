# Analysis: GitHub Actions `set-output` Deprecation

## Issue Summary

- **Source Repository**: [link-foundation/lino-env](https://github.com/link-foundation/lino-env)
- **Issue**: [#26](https://github.com/link-foundation/lino-env/issues/26)
- **PR**: [#27](https://github.com/link-foundation/lino-env/pull/27)
- **Type**: Bug (deprecation warning)
- **Severity**: Low (warnings only, workflow still succeeds)
- **Risk**: Medium (command may be disabled in future GitHub Actions updates)

## Problem Description

The CI/CD pipeline generates deprecation warnings during the "Instant Release" job:

```
The `set-output` command is deprecated and will be disabled soon. Please upgrade to using Environment Files.
For more information see: https://github.blog/changelog/2022-10-11-github-actions-deprecating-save-state-and-set-output-commands/
```

## Root Cause Analysis

### Source Code Location

File: `scripts/version-and-commit.mjs`, `setOutput` function:

```javascript
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  // Also log for visibility
  console.log(`::set-output name=${key}::${value}`);  // <-- DEPRECATED
}
```

### Technical Explanation

The `setOutput` function does two things:
1. **Correctly** writes to the `GITHUB_OUTPUT` environment file (new approach)
2. **Also** outputs the deprecated `::set-output` command to stdout (old approach)

While the new approach works correctly, the legacy stdout command is still being printed, causing GitHub Actions to emit deprecation warnings.

### Why Warnings Appear Multiple Times

The `setOutput` function is called in several places:
- When tag already exists: `setOutput('already_released', 'true')` and `setOutput('new_version', newVersion)`
- When no changes to commit: `setOutput('version_committed', 'false')` and `setOutput('new_version', newVersion)`
- After successful push: `setOutput('version_committed', 'true')` and `setOutput('new_version', newVersion)`

## Official Deprecation Timeline

| Date | Event |
|------|-------|
| October 11, 2022 | GitHub announces deprecation |
| May 31, 2023 | Originally planned full disablement |
| July 24, 2023 | GitHub postpones removal due to significant usage |
| Present | Warnings shown but commands still functional |

## Migration Guide

### Old Approach (Deprecated)

```bash
# Shell
echo "::set-output name=myOutput::myValue"
```

```javascript
// JavaScript
console.log(`::set-output name=${key}::${value}`);
```

### New Approach (Recommended)

```bash
# Shell
echo "myOutput=myValue" >> $GITHUB_OUTPUT
```

```javascript
// JavaScript
import { appendFileSync } from 'fs';

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
    console.log(`Output: ${key}=${value}`);  // Optional: plain log for visibility
  }
}
```

### Handling Multi-line Values

For multi-line outputs, use delimiters:

```bash
echo "JSON_RESPONSE<<EOF" >> $GITHUB_OUTPUT
echo "$response_json" >> $GITHUB_OUTPUT
echo "EOF" >> $GITHUB_OUTPUT
```

## Fix Applied

The deprecated `console.log` line was removed and replaced with a plain log for visibility:

```javascript
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
    console.log(`Output: ${key}=${value}`);  // Plain log, not GitHub command
  }
}
```

## Verification

After the fix:
1. Run a workflow that sets outputs
2. Check that no deprecation warnings appear in the logs
3. Verify that subsequent steps can still access the output values

## References

- [GitHub Blog: Deprecating save-state and set-output commands](https://github.blog/changelog/2022-10-11-github-actions-deprecating-save-state-and-set-output-commands/)
- [GitHub Blog: Update on save-state and set-output commands](https://github.blog/changelog/2023-07-24-github-actions-update-on-save-state-and-set-output-commands/)
- [GitHub Docs: Environment Files](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#environment-files)
- [How to Fix the set-output GitHub Actions Deprecation Warning](https://hynek.me/til/set-output-deprecation-github-actions/)
