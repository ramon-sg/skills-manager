# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 1.3.0

### Added

- `init` and `add` take `--repo <owner/name | URL>`, with `--ref` and `--path`: they
  list and install skills from a GitHub repo without the plugin or marketplace on the
  machine. With a `.claude-plugin/marketplace.json` they offer its plugins; without
  one, the folders under `--path` (default `skills`). `--select` takes `<plugin>`,
  `<plugin>:a+b` or `<skill>`. Each skill is its own `repo` entry, so `update <name>`
  moves only that one.
- A `repo` entry inside a marketplace plugin rewrites `<plugin>:<skill>` references
  between its skills on install, like plugin sources. Heads up: the hash of an
  existing entry like this can change on the next rebuild.

### Fixed

- A `repo` entry with `ref` pins the commit of that exact tag or branch: an annotated
  tag is locked to the commit, not the tag object, and `main` no longer matches
  `feature/main`.

## 1.2.0

### Added

- An incoming skill with the name of one of the repo's own skills can replace it:
  in a terminal `install`, `update`, `init` and `add` ask for each one; without a
  terminal, `--replace <names>` allows them. An editable file the own folder already
  has (`project.md`) is kept. Before, they always stopped.

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
- `editable` files in a catalog skill (for example `project.md`): created from
  `<file>.template` when missing, left out of the hash and kept on `install` and
  `update`. A lock that records them is written as `lockVersion: 2`; one without
  them stays at version 1.

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
