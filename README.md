# @ramon-sg/skills-manager

Manage the third-party agent skills (Claude Code plugins and your own
`~/.claude/skills`) that you vendor inside a repository. The skills are copied
into `.agents/skills/` so every session has them, cloud sessions included, without
downloading anything. A manifest says which ones you want and a lock records the
exact commit and content hash that was copied.

Requires Node 20.12 or newer.

## Install

```sh
npx @ramon-sg/skills-manager init
```

Recommended: add it to the project as a devDependency and expose the commands as
scripts (the unscoped `skills-manager` on npm is an unrelated package, so always
use the full `@ramon-sg/` name with `npx`):

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

The examples below use `npx @ramon-sg/skills-manager <command>`. Once it is a
devDependency, `npx --no-install skills-manager <command>` (or the scripts above)
runs the installed copy.

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
    { "local": "my-skill" },
    { "catalog": "owner/skills-repo", "skills": ["planning", "code-audit"] }
  ]
}
```

Each source takes exactly one of `plugin`, `repo`, `local` or `catalog`:

- `plugin`: `plugin@marketplace`, resolved from the marketplaces on your machine;
  optional `skills` picks some of its skills.
- `repo`: a git repo, either `owner/name` (GitHub shorthand) or a full URL. `path`
  (required) is the folder inside the repo that holds the skill, relative and
  without `..`; `ref` (optional) is a branch or tag.
- `local`: the name of a skill in `~/.claude/skills`.
- `catalog`: a repo with a `skills-catalog.json` (see [Catalogs](#catalogs)),
  `owner/name` or a full URL; `skills` (required) lists the skills you want and
  `ref` (optional) pins a tag or follows a branch.

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
| `init`                            | First time: pick from what is installed on your machine; builds the manifest and copies the bundled `manage-skills` skill. | `npx @ramon-sg/skills-manager init`                                 |
| `add`                             | Adds more skills to the manifest and installs them.                     | `npx @ramon-sg/skills-manager add --select superpowers@claude-plugins-official` |
| `install`                         | Makes disk and lock match the manifest.                                 | `npx @ramon-sg/skills-manager install`                              |
| `update [name]`                   | Moves to the latest published. `--dry-run` only prints what would change. | `npx @ramon-sg/skills-manager update --dry-run`                     |
| `check`                           | Fails if disk, lock and manifest disagree. Meant for CI.                | `npx @ramon-sg/skills-manager check`                                |
| `list`                            | Lists the lock: origin, version and whether a newer one exists.         | `npx @ramon-sg/skills-manager list`                                 |
| `session-notice`                  | Prints a notice for a `SessionStart` hook (see below).                  | `npx @ramon-sg/skills-manager session-notice`                       |

In a terminal, `init` and `add` show a checkbox list: one line per plugin with how
many skills it brings, space to mark and enter to continue. For every marked plugin
they ask whether all its skills go or you pick, and show a summary to confirm before
installing. Ctrl+C cancels without changing anything.

Without a terminal (for example from an agent session), `init` and `add` accept
`--candidates` (prints what is on the machine as JSON) and `--select <ids>` (picks
without asking). Ids are `plugin@marketplace`, `plugin@marketplace:skill1+skill2`, or
the name of a local skill, separated by commas. With `--repo` they follow
[From a git repo](#from-a-git-repo).

## How to update

1. `npx @ramon-sg/skills-manager update --dry-run`: see what would change.
2. `npx @ramon-sg/skills-manager update`: apply it.
3. Review the diff: `git diff --stat .agents/skills` and every touched `SKILL.md`.
   They are instructions agents will read, so know what comes in.
4. `npx @ramon-sg/skills-manager check`, then commit.

## No hand edits

If you change a file of a plugin or repo skill inside `.agents/skills/`, its hash no
longer matches the lock and `check` fails (also if a script loses its executable
bit). To change something, use the commands. If the difference was a hand edit,
`install` refuses to continue and names the two ways out:

- **Go back to the locked version:** `rm -rf .agents/skills/<name> && npx @ramon-sg/skills-manager install`.
  It rebuilds the skill at the pinned commit, fetching nothing new.
- **Move to the latest published:** `npx @ramon-sg/skills-manager update <name>`. It overwrites
  the edit and moves the lock to the latest commit. `update --dry-run` warns
  `<name>: edited by hand, will be overwritten` for every skill that would lose an edit.

## From a git repo

`init` and `add` can take skills straight from a GitHub repo (or any `https://` or
`file://` git URL), without the plugin or
its marketplace on your machine:

```sh
npx @ramon-sg/skills-manager add --repo owner/skills --candidates
npx @ramon-sg/skills-manager add --repo owner/skills --select my-plugin:one+two
```

`--repo` takes `owner/name`, an `https://` URL or a `file://` URL, once. `--ref` picks
a tag or branch and `--path` the folder with the skills (default `skills`). `--ref`
and `--path` need `--repo`, and `--repo` does not mix with `--catalog`.

- **With `.claude-plugin/marketplace.json`**, `--candidates` lists its plugins
  (`kind: "repo-plugin"`) with their skills: the plugin's `skills` list, or
  `<plugin root>/skills/*`. A plugin whose source is another repo shows
  `note: "plugin in another repo"` and cannot be picked.
- **Without it, or with `--path`**, every folder with a `SKILL.md` under `--path`
  (default `skills`) is a skill (`kind: "repo-skill"`). A `--path` you give wins
  over the marketplace.

`--select` takes `<plugin>` (all its skills), `<plugin>:a+b` (some) or `<skill>`,
separated by commas. In a terminal you get the same checkbox list as for plugins.

Each picked skill becomes its own `repo` entry, with the repo as you typed it, the
skill's folder as `path` and `ref` if you gave one:

```json
{ "repo": "owner/skills", "path": "plugins/my-plugin/skills/one", "ref": "v1.2.0" }
```

So `update <name>` moves only that skill, and a skill already in the manifest is not
offered again. A `ref` pins the commit of that exact tag or branch (an annotated tag
is locked to its commit).

Inside a marketplace plugin, references like `my-plugin:other-skill` between skills of
the same repo are rewritten to `other-skill` on install, as for plugin sources. Adding
or removing a sibling rebuilds the others at their locked commit.

## Local skills

Skills copied from `~/.claude/skills` are the exception: once copied they belong to
the repo. You can edit them: `check` does not flag them and `install` does not
overwrite them; it only copies them when they are missing. `update <name>` copies
them again from the machine, overwriting your edit.

## Replacing the repo's own skills

A folder in `.agents/skills/` that the lock does not know is one of the repo's own
skills. If an incoming skill has its name, `install`, `update`, `init` and `add` do
not overwrite it silently:

- **In a terminal** they ask for each one: "The repo has its own `code-audit` skill.
  Replace it with the incoming one?". The default is no, and a no stops without
  changing anything.
- **Without a terminal** they stop and name the clashes. `--replace code-audit,planning`
  allows those:

  ```sh
  npx @ramon-sg/skills-manager add --catalog ramon-sg/agent-skills --select catalog:ramon-sg/agent-skills/code-audit --replace code-audit
  ```

Replacing deletes the own folder and writes the incoming skill. An [editable file](#editable-files)
that the own folder already has, such as `project.md`, is kept as the repo's copy, so
you can move what is specific to the repo there before replacing. `update --dry-run`
marks each one with "replaces the repo's own folder".

## Catalogs

A catalog is a repo of skills meant to be shared between projects. It lists them
in `skills-catalog.json` at its root:

```json
{
  "catalogVersion": 1,
  "skills": [
    { "name": "planning", "path": "skills/planning", "category": "Plans", "requires": ["narrative-summary"] },
    { "name": "narrative-summary", "path": "skills/narrative-summary", "category": "Writing" }
  ]
}
```

- `name` and `path` are required; `category` groups the menu (`Other` if missing).
- `requires` lists skills of the same catalog that are installed along with it.
- `editable` lists files of the skill that belong to each repo (see
  [Editable files](#editable-files)).
- The menu description is the first sentence of the `description` in each
  `SKILL.md` frontmatter.
- A release is a `vX.Y.Z` tag. Without `ref`, `install` takes the highest one (or
  HEAD if the repo has no release tags).

Pick from one or more catalogs with `--catalog` (repeatable). The menu groups the
skills by category, with their description, and shows what each one requires:

```sh
npx @ramon-sg/skills-manager add --catalog ramon-sg/agent-skills
npx @ramon-sg/skills-manager init --catalog owner/one --catalog owner/two#v2.0.0
```

`#<tag>` pins the source to that tag; `#<branch>` follows the branch. Without a
terminal, `--candidates` prints the catalog skills as JSON and `--select` takes
`catalog:<catalog>/<skill>` ids (for example
`catalog:ramon-sg/agent-skills/planning`). Picking a catalog already in the
manifest extends its `skills` list: a catalog appears only once in the manifest.

Each catalog skill is pinned on its own: the lock keeps its tag, commit and
`requires`. `update <name>` moves only that skill (and anything new it now
requires) to the latest release; the other skills of the catalog stay where they
are. `update` without a name moves them all.

### Editable files

A shared skill often needs a little of each repo: where plans live, the test
command, local conventions. A catalog skill can declare files the repo owns:

```json
{ "name": "code-audit", "path": "skills/code-audit", "editable": ["project.md"] }
```

- On install, a missing `project.md` is created from `project.md.template` in the
  skill (or from the `project.md` the skill ships, if it has no template).
- The repo can edit it: it is left out of the hash, so `check` does not flag it,
  and `install` and `update` keep the repo's copy when they rebuild the skill.
- Every other file of the skill, the template included, is still pinned.
- If the repo deletes it, the next `install` creates it again, at the pinned
  version of the skill.
- If a new version stops declaring a file editable, `update --dry-run` warns that
  the repo's copy will be removed (or replaced, if the skill now ships it).

The lock records the editable files of each skill and is then written as
`lockVersion: 2`, which older versions of this tool refuse to read. A lock with
no editable files stays at version 1.

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

`session-notice` finds the repo from the current directory (the hook runs from the
project dir) and reports each problem on its own `skills-manager:` stderr line, one
per missing skill, always exiting 0 so it never blocks the session start. With
`npx --no-install`, if the package is not installed npx prints its own error; that
does not block the session start either. `node_modules/.bin/skills-manager
session-notice` works too, without going through `npx`. A session in the cloud only receives the skills, and they arrive through the
repo; plugin commands, hooks and MCP servers do not.

## The bundled skill

`init` copies a `manage-skills` skill to `.agents/skills/manage-skills/SKILL.md`
(inside your `skillsDir`) that teaches the agent to run these commands. It never
overwrites an existing copy.

## Releasing

For maintainers. npm trusted publishing can only be configured once the package
exists, so the first release cannot use it: publish `1.0.0` with `npm publish` from
a logged-in machine (or with an `NPM_TOKEN` secret), then configure trusted
publishing for `publish.yml` on npmjs.com. Later releases go through the workflow.

## License

MIT
