# @ramon-sg/skills-manager

Manage the third-party agent skills (Claude Code plugins and your own
`~/.claude/skills`) that you vendor inside a repository. The skills are copied
into `.agents/skills/` so every session has them, cloud sessions included, without
downloading anything. A manifest says which ones you want and a lock records the
exact commit and content hash that was copied.

Requires Node 20 or newer.

## Install

```sh
npx @ramon-sg/skills-manager init
```

Or add it to the project and expose the commands as scripts:

```sh
npm install --save-dev @ramon-sg/skills-manager
```

```json
{
  "scripts": {
    "skills:install": "skills-manager install",
    "skills:update": "skills-manager update",
    "skills:check": "skills-manager check"
  }
}
```

The examples below use `npx skills-manager <command>`.

## Files

| File                       | What it is                                                              |
| -------------------------- | ----------------------------------------------------------------------- |
| `.agents/skills.json`      | Manifest: which skills you want and where from (plugins, git repos or local skills). |
| `.agents/skills.lock.json` | Lock (`lockVersion: 1`): commit and hash of each copied skill. Written by the tool. |
| `.agents/skills/<name>/`   | The copied skills. Commit them.                                         |
| `.claude/settings.json`    | Gets `enabledPlugins` with the plugin set to `false` (see below).       |

Manifest example:

```json
{
  "sources": [
    { "plugin": "superpowers@claude-plugins-official" },
    { "plugin": "other@marketplace", "skills": ["one", "two"] },
    { "repo": "owner/name", "ref": "main", "path": "skills/my-skill" },
    { "local": "my-skill" }
  ]
}
```

Each source takes exactly one of `plugin`, `repo` or `local`:

- `plugin`: `plugin@marketplace`, resolved from the marketplaces on your machine;
  optional `skills` picks some of its skills.
- `repo`: a git repo, either `owner/name` (GitHub shorthand) or a full URL. `path`
  (required) is the folder inside the repo that holds the skill, relative and
  without `..`; `ref` (optional) is a branch or tag.
- `local`: the name of a skill in `~/.claude/skills`.

### Custom paths

Every path is relative to the repo root and optional:

```json
{
  "sources": [],
  "paths": {
    "lock": ".agents/skills.lock.json",
    "skillsDir": ".agents/skills",
    "settings": ".claude/settings.json"
  }
}
```

A lock without `lockVersion` is read as version 1. A lock with a higher version
stops with a message asking you to upgrade the package.

## Commands

| Command                           | What it does                                                            | Example                                                   |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `init`                            | First time: pick from what is installed on your machine; builds the manifest and copies the bundled `manage-skills` skill. | `npx skills-manager init`                                 |
| `add`                             | Adds more skills to the manifest and installs them.                     | `npx skills-manager add --select superpowers@claude-plugins-official` |
| `install`                         | Makes disk and lock match the manifest.                                 | `npx skills-manager install`                              |
| `update [name]`                   | Moves to the latest published. `--dry-run` only prints what would change. | `npx skills-manager update --dry-run`                     |
| `check`                           | Fails if disk, lock and manifest disagree. Meant for CI.                | `npx skills-manager check`                                |
| `list`                            | Lists the lock: origin, version and whether a newer one exists.         | `npx skills-manager list`                                 |
| `session-notice`                  | Prints a notice for a `SessionStart` hook (see below).                  | `npx skills-manager session-notice`                       |

In a terminal, `init` and `add` show a checkbox list: one line per plugin with how
many skills it brings, space to mark and enter to continue. For every marked plugin
they ask whether all its skills go or you pick, and show a summary to confirm before
installing. Ctrl+C cancels without changing anything.

Without a terminal (for example from an agent session), `init` and `add` accept
`--candidates` (prints what is on the machine as JSON) and `--select <ids>` (picks
without asking). Ids are `plugin@marketplace`, `plugin@marketplace:skill1+skill2`, or
the name of a local skill, separated by commas.

## How to update

1. `npx skills-manager update --dry-run`: see what would change.
2. `npx skills-manager update`: apply it.
3. Review the diff: `git diff --stat .agents/skills` and every touched `SKILL.md`.
   They are instructions agents will read, so know what comes in.
4. `npx skills-manager check`, then commit.

## No hand edits

If you change a file of a plugin or repo skill inside `.agents/skills/`, its hash no
longer matches the lock and `check` fails (also if a script loses its executable
bit). To change something, use the commands. If the difference was a hand edit,
`install` refuses to continue and names the two ways out:

- **Go back to the locked version:** `rm -rf .agents/skills/<name> && npx skills-manager install`.
  It rebuilds the skill at the pinned commit, fetching nothing new.
- **Move to the latest published:** `npx skills-manager update <name>`. It overwrites
  the edit and moves the lock to the latest commit. `update --dry-run` warns
  `<name>: edited by hand, will be overwritten` for every skill that would lose an edit.

## Local skills

Skills copied from `~/.claude/skills` are the exception: once copied they belong to
the repo. You can edit them: `check` does not flag them and `install` does not
overwrite them; it only copies them when they are missing. `update <name>` copies
them again from the machine, overwriting your edit.

## Disabled plugins in the project

When a plugin is copied, `install` and `update` write
`enabledPlugins: {"<plugin>": false}` into `.claude/settings.json`, so the skill does
not show up twice on your machine (the plugin's and the copy). If the plugin is still
active in `/plugin`, disable it for this project.

## Session notice

`session-notice` prints, for a Claude Code `SessionStart` hook, the full content of
the skills listed in the manifest's `sessionStart`, so the session starts already
knowing them. Each skill is wrapped in a fixed superpowers-style envelope
(`<EXTREMELY_IMPORTANT>You have superpowers. ...`), the same one the superpowers
plugin hook prints. It never fails the session: a skill that is not on disk, or a
broken manifest, ends up as a single `skills-manager: ...` line on stderr and the
exit code stays 0. List the skills in the manifest:

```json
{
  "sources": [],
  "sessionStart": ["manage-skills"]
}
```

Then call it from `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "npx --no-install skills-manager session-notice" }
        ]
      }
    ]
  }
}
```

`node_modules/.bin/skills-manager session-notice` works too, without going through
`npx`. A session in the cloud only receives the skills, and they arrive through the
repo; plugin commands, hooks and MCP servers do not.

## The bundled skill

`init` copies a `manage-skills` skill to `.agents/skills/manage-skills/SKILL.md`
(inside your `skillsDir`) that teaches the agent to run these commands. It never
overwrites an existing copy.

## License

MIT
