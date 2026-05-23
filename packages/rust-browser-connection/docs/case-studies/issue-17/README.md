# Case Study: Issue #17 - Apply Fixes from lino-objects-codec

## Summary

This case study documents the fixes applied from the [lino-objects-codec](https://github.com/link-foundation/lino-objects-codec) repository to improve the CI/CD pipeline in `rust-ai-driven-development-pipeline-template`.

## Referenced Pull Requests

| Repository | PR | Title | Key Fix |
|------------|-----|-------|---------|
| [link-foundation/lino-objects-codec](https://github.com/link-foundation/lino-objects-codec) | [#23](https://github.com/link-foundation/lino-objects-codec/pull/23) | Fix yargs reserved word conflict for --version option | Yargs `--version` reserved word workaround |
| [link-foundation/lino-objects-codec](https://github.com/link-foundation/lino-objects-codec) | [#24](https://github.com/link-foundation/lino-objects-codec/pull/24) | feat(rust): support both CARGO_REGISTRY_TOKEN and CARGO_TOKEN | Dual token support for crates.io |

## Best Practices Identified

### 1. Yargs Reserved Word Conflict (PR #23)

**Problem**: The `--version` flag is a reserved word in [yargs](https://yargs.js.org/) (v17.2.0+). When using `lino-arguments` (which wraps yargs), defining a custom `--version` option causes yargs to interpret it as its built-in version display command, returning `false` instead of the actual argument value.

**Root Cause**: Yargs reserves `--version` for displaying the application version. When a user defines a custom `version` option without disabling the built-in handling, the argument value is not properly parsed.

**Error Manifestation**:
```
Error: Missing required arguments
Usage: node scripts/create-github-release.mjs --version <version> --repository <repository>
```

The error is misleading because the arguments ARE being passed, but yargs interprets `--version` specially.

**Solutions** (choose one):

1. **Disable yargs built-in `--version`** (recommended for existing codebases):
   ```javascript
   const config = makeConfig({
     yargs: ({ yargs, getenv }) =>
       yargs
         .version(false) // Disable yargs built-in --version handling
         .option('version', {
           type: 'string',
           default: getenv('VERSION', ''),
           describe: 'Version number',
         })
   });
   ```

2. **Use an alternative option name** (cleaner for new scripts):
   ```javascript
   const config = makeConfig({
     yargs: ({ yargs, getenv }) =>
       yargs
         .option('release-version', {  // Avoid reserved word entirely
           type: 'string',
           default: getenv('VERSION', ''),
           describe: 'Version number',
         })
   });
   ```

**Status in this repository**: This template uses the alternative option name approach (`--release-version`) in `create-github-release.mjs`, which already avoids the conflict.

**References**:
- [yargs/yargs#2064 - Cannot have version as both option and command](https://github.com/yargs/yargs/issues/2064)
- [yargs version() documentation](https://yargs.js.org/docs/#api-reference-version)
- [CycloneDX/cdxgen#83 - Warning: "version" is a reserved word](https://github.com/CycloneDX/cdxgen/issues/83)

### 2. Dual Token Support for crates.io (PR #24)

**Problem**: Different CI/CD setups may use different secret names for the crates.io API token:
- `CARGO_REGISTRY_TOKEN` - Cargo's native environment variable
- `CARGO_TOKEN` - Alternative name used in some setups

**Root Cause**: Inconsistency in secret naming conventions across repositories and tooling.

**Solution**: Support both token names with fallback logic:

**In workflow files**:
```yaml
env:
  # Support both token names with fallback
  CARGO_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}
```

**In scripts** (publish-crate.mjs):
```javascript
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs.option('token', {
      type: 'string',
      default: getenv('CARGO_REGISTRY_TOKEN', '') || getenv('CARGO_TOKEN', ''),
      describe: 'Crates.io API token',
    }),
});
```

**Warning message** when no token is found:
```
::warning::Neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN is set, attempting publish without explicit token
```

## Changes Applied

### 1. `.github/workflows/release.yml`

Updated the global environment variable to support both token names:

```yaml
env:
  CARGO_TERM_COLOR: always
  RUSTFLAGS: -Dwarnings
  # Support both CARGO_REGISTRY_TOKEN (cargo's native env var) and CARGO_TOKEN (for backwards compatibility)
  CARGO_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}
```

### 2. `scripts/publish-crate.mjs`

- Updated documentation to mention both token environment variables
- Modified `getenv()` call to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN`
- Added warning message when neither token is set

## Key Takeaways

1. **Be aware of reserved words**: CLI argument parsing libraries often reserve common flags like `--version`, `--help`, `$0`. Consult the library documentation before choosing option names.

2. **Provide backwards compatibility**: When changing secret/environment variable names, support the old name as a fallback to avoid breaking existing setups.

3. **Use clear warning messages**: When configuration is missing, provide actionable messages that list ALL possible variable names.

4. **Test CI scripts locally**: Running CI scripts locally with the same arguments used in workflows helps identify parsing issues before they cause failures.

## References

### yargs Documentation
- [yargs API Reference - version()](https://yargs.js.org/docs/#api-reference-version)
- [yargs Reserved Words](https://yargs.js.org/docs/#api-reference-version)

### GitHub Issues
- [yargs/yargs#2064 - version reserved word conflict](https://github.com/yargs/yargs/issues/2064)

### crates.io
- [Cargo Environment Variables](https://doc.rust-lang.org/cargo/reference/environment-variables.html)
