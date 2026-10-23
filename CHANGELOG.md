# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 1.1.0

### Added

- `catalog` sources: a repo with a `skills-catalog.json` that lists its skills
  with path, category and `requires`. Each skill is pinned on its own (tag,
  commit and requires in the lock), so `update <name>` moves only that skill.
- Releases are `vX.Y.Z` tags: without `ref`, the highest one is installed; with
  an annotated tag, the lock keeps the commit.
- `requires` installs the skills a catalog skill needs; `check` counts them.
- `init` and `add` take `--catalog <repo>[#ref]` (repeatable): a menu grouped
  by category with each skill's description, `--candidates` as JSON and
  `--select catalog:<catalog>/<skill>`.

## 1.0.0

### Added

- `install`, `update [name] [--dry-run]`, `check` and `list` commands to vendor
  third-party skills into `.agents/skills/` from Claude Code plugins, git repos
  (`repo`, with `path` and optional `ref`) and local skills.
- `init` and `add` with an interactive checkbox menu, or `--candidates` and
  `--select` without a terminal. `init` also copies the bundled `manage-skills` skill.
- Manifest `.agents/skills.json` with `sources`, optional `paths` (`lock`,
  `skillsDir`, `settings`) and `sessionStart`.
- Lock `.agents/skills.lock.json` with `lockVersion: 1`; a lock without it is read as
  version 1 and a higher one asks to upgrade the package.
- Sync of `enabledPlugins: false` into `.claude/settings.json` for copied plugins.
- `session-notice` command for a `SessionStart` hook.
