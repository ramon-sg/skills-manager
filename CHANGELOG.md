# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 1.0.0

### Added

- `install`, `update [name] [--dry-run]`, `check` and `list` commands to vendor
  third-party skills into `.agents/skills/` from Claude Code plugins and local skills.
- `init` and `add` with an interactive checkbox menu, or `--candidates` and
  `--select` without a terminal. `init` also copies the bundled `manage-skills` skill.
- Manifest `.agents/skills.json` with `sources`, optional `paths` (`lock`,
  `skillsDir`, `settings`) and `sessionStart`.
- Lock `.agents/skills.lock.json` with `lockVersion: 1`; a lock without it is read as
  version 1 and a higher one asks to upgrade the package.
- Sync of `enabledPlugins: false` into `.claude/settings.json` for copied plugins.
- `session-notice` command for a `SessionStart` hook.
