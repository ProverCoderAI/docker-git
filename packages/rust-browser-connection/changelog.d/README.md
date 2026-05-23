# Changelog Fragments

This directory contains changelog fragments that will be collected into `CHANGELOG.md` during releases.

## How to Add a Changelog Fragment

When making changes that should be documented in the changelog, create a fragment file:

```bash
# Create a new fragment with timestamp
touch changelog.d/$(date +%Y%m%d_%H%M%S)_description.md

# Or manually create a file matching the pattern: YYYYMMDD_HHMMSS_description.md
```

## Fragment Format

Each fragment should include a **frontmatter section** specifying the version bump type:

```markdown
---
bump: patch
---

### Fixed
- Description of bug fix
```

### Bump Types

Use semantic versioning bump types in the frontmatter:

- **`major`**: Breaking changes (incompatible API changes)
- **`minor`**: New features (backward compatible)
- **`patch`**: Bug fixes (backward compatible)

### Content Categories

Use these categories in your fragment content:

```markdown
---
bump: minor
---

### Added
- Description of new feature

### Changed
- Description of change to existing functionality

### Fixed
- Description of bug fix

### Removed
- Description of removed feature

### Deprecated
- Description of deprecated feature

### Security
- Description of security fix
```

## Examples

### Adding a new feature (minor bump)

```markdown
---
bump: minor
---

### Added
- New async processing mode for batch operations
```

### Fixing a bug (patch bump)

```markdown
---
bump: patch
---

### Fixed
- Fixed memory leak in connection pool handling
```

### Breaking change (major bump)

```markdown
---
bump: major
---

### Changed
- Renamed `process()` to `process_async()` - this is a breaking change

### Removed
- Removed deprecated `legacy_mode` option
```

## Why Fragments?

Using changelog fragments (similar to [Changesets](https://github.com/changesets/changesets) in JavaScript and [Scriv](https://scriv.readthedocs.io/) in Python):

1. **No merge conflicts**: Multiple PRs can add fragments without conflicts
2. **Per-PR documentation**: Each PR documents its own changes
3. **Automated version bumping**: Version bump type is specified per-change
4. **Automated collection**: Fragments are automatically collected during release
5. **Consistent format**: Template ensures consistent changelog entries

## How It Works

1. **During PR**: Add a fragment file with your changes and bump type
2. **On merge to main**: The release workflow automatically:
   - Reads all fragment files and determines the highest bump type
   - Bumps the version in `Cargo.toml` accordingly
   - Collects fragments into `CHANGELOG.md`
   - Creates a git tag and GitHub release
   - Removes processed fragment files

## Multiple PRs and Bump Priority

When multiple PRs are merged before a release, all pending fragments are processed together. The **highest** bump type wins:

- If any fragment specifies `major`, the release is a major version bump
- Otherwise, if any specifies `minor`, the release is a minor version bump
- Otherwise, the release is a patch version bump

This ensures that breaking changes are never missed, even when combined with smaller changes.

## Default Behavior

If a fragment doesn't include a bump type in the frontmatter, it defaults to `patch`.
