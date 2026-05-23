# Online Research: GitHub Actions Best Practices

This document compiles research findings from various online sources related to the issues addressed in this case study.

## 1. GitHub Actions `set-output` Deprecation

### Official Sources

- **[GitHub Changelog: Deprecating save-state and set-output commands](https://github.blog/changelog/2022-10-11-github-actions-deprecating-save-state-and-set-output-commands/)** (October 2022)
  - Announced deprecation of `::set-output` and `::save-state` commands
  - Migration path: Use `$GITHUB_OUTPUT` and `$GITHUB_STATE` environment files

- **[GitHub Changelog: Update on save-state and set-output commands](https://github.blog/changelog/2023-07-24-github-actions-update-on-save-state-and-set-output-commands/)** (July 2023)
  - Removal postponed due to "significant usage"
  - Commands still functional but showing warnings

### Community Resources

- **[How to Fix the set-output GitHub Actions Deprecation Warning](https://hynek.me/til/set-output-deprecation-github-actions/)**
  - Practical migration examples
  - GNU sed one-liner for bulk migration

- **[GitHub Community Discussion #35994](https://github.com/orgs/community/discussions/35994)**
  - Community discussion on migration challenges
  - Workarounds for complex scenarios

- **[Earthly Blog: Resolving Deprecation Errors](https://earthly.dev/blog/deprecation-error-github-action-command/)**
  - Comprehensive guide covering `set-output`, `save-state`, `add-path`, and `set-env`

## 2. GitHub Actions Job Dependencies and Skipping

### Official Documentation

- **[GitHub Docs: Workflow syntax - jobs.<job_id>.needs](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idneeds)**
  - Official documentation on job dependencies

- **[GitHub Docs: Using conditions to control job execution](https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution)**
  - Explanation of `success()`, `always()`, `failure()`, `cancelled()` functions

### Key GitHub Issues

- **[GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491)**: "Job-level 'if' condition not evaluated correctly if job in 'needs' property is skipped"
  - This is the primary issue documenting the behavior
  - Acknowledged by GitHub, in backlog with no timeline

- **[GitHub Actions Runner Issue #2205](https://github.com/actions/runner/issues/2205)**: "Jobs skipped when NEEDS job ran successfully"
  - Related issue about unexpected skipping behavior

- **[GitHub Community Discussion #45058](https://github.com/orgs/community/discussions/45058)**: "success() returns false if dependent jobs are skipped"
  - Community workarounds and best practices

### Blog Posts and Tutorials

- **[CodeStudy: GitHub Actions - How to Ensure Your Deploy Job Runs When Previous Jobs Are Skipped](https://www.codestudy.net/blog/github-action-job-fire-when-previous-job-skipped/)**
  - Practical examples and solutions
  - Comparison of different approaches

- **[Kerno Blog: Advanced Workflows in GitHub Actions](https://www.kerno.io/blog/advanced-workflows-in-github-actions)**
  - Comprehensive guide to complex workflow patterns

## 3. crates.io Publishing with GitHub Actions

### Official Documentation

- **[crates.io Trusted Publishing Documentation](https://crates.io/docs/trusted-publishing)**
  - Official setup guide for OIDC-based publishing
  - Security benefits explained

- **[RFC #3691: Trusted Publishing for crates.io](https://rust-lang.github.io/rfcs/3691-trusted-publishing-cratesio.html)**
  - Technical specification of trusted publishing
  - OIDC flow details

### GitHub Actions

- **[rust-lang/crates-io-auth-action](https://github.com/rust-lang/crates-io-auth-action)**
  - Official action for OIDC authentication
  - Used with trusted publishing

- **[katyo/publish-crates](https://github.com/marketplace/actions/publish-crates)**
  - Popular third-party action
  - Supports workspace publishing

### Tutorials

- **[Jonas' Blog: How to Automate Publishing your Crates with GitHub Actions](https://fassbender.dev/blog/001-cargo-publish-action/)**
  - Step-by-step guide
  - Traditional and modern approaches

- **[Medium: Publishing crates using GitHub Actions](https://pratikpc.medium.com/publishing-crates-using-github-actions-165ee67780e1)**
  - Beginner-friendly tutorial

- **[RapidRecast: Simplify Rust Releases with GitHub Actions](https://rapidrecast.io/blog/simplify-rust-releases-with-github-actions/)**
  - End-to-end release automation

## 4. Best Practices Summary

### From Official Documentation

1. **Use Environment Files**: Migrate from `::set-output` to `$GITHUB_OUTPUT`
2. **Understand Job Dependencies**: Jobs in `needs` chain skip if dependency skips
3. **Use Status Functions**: `always()`, `success()`, `failure()`, `cancelled()`
4. **Combine Conditions**: `always() && !cancelled() && needs.job.result == 'success'`

### From Community Experience

1. **Test Failure Paths**: Ensure CI checks actually fail when they should
2. **Be Explicit**: Use explicit result checks rather than relying on defaults
3. **Document Quirks**: Add comments explaining non-obvious behavior
4. **Stay Current**: Regularly update actions and check for deprecations

### From Security Best Practices

1. **Use Trusted Publishing**: Prefer OIDC over long-lived API tokens
2. **Limit Token Scope**: Use least-privilege tokens when manual tokens required
3. **Use Environments**: Add protection rules for sensitive publishing
4. **Audit Dependencies**: Review third-party actions before use

## 5. Tools and Resources

### GitHub Actions Tools

- [actionlint](https://github.com/rhysd/actionlint) - Static checker for GitHub Actions workflow files
- [act](https://github.com/nektos/act) - Run GitHub Actions locally

### Rust Publishing Tools

- [cargo-release](https://github.com/crate-ci/cargo-release) - Automate cargo releases
- [cargo-workspaces](https://github.com/pksunkara/cargo-workspaces) - Manage cargo workspaces
- [semantic-release-cargo](https://crates.io/crates/semantic-release-cargo) - Semantic versioning for Rust

### Migration Helpers

```bash
# Find all set-output usages in workflows
grep -r "::set-output" .github/

# GNU sed one-liner to migrate set-output
sed -i 's/echo "::set-output name=\([^:]*\)::\(.*\)"/echo "\1=\2" >> $GITHUB_OUTPUT/g' .github/workflows/*.yml
```
