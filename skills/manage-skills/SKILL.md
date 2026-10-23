---
name: manage-skills
description: |
  Manages the third-party skills vendored in `.agents/skills/` (manifest
  `.agents/skills.json`, lock `.agents/skills.lock.json`) with the
  `npx @ramon-sg/skills-manager` commands. Use when: (1) asked what skills are installed
  or which ones the repo has, (2) adding skills from the machine to the repo,
  (3) looking for or applying updates to third-party skills, (4) `check` fails.
---

# manage-skills: third-party skills in the repo

Third-party skills are copied into `.agents/skills/` and pinned by commit and
hash in the lock. **Never hand-edit a skill that came from a plugin or a repo**
(the hash would stop matching and `check` fails): change them only with these
commands. Local skills (`kind: "local"`), once copied, belong to the repo and can
be edited. **Never commit or push**: show the diff, ask for approval and leave
the commit to the user.

## See what is there

`npx @ramon-sg/skills-manager list` shows what is in the lock, with origin, version and
whether a newer one exists.

## No manifest (`.agents/skills.json` does not exist)

1. `npx @ramon-sg/skills-manager init --candidates` prints as JSON what is installed on the
   machine (`{id, kind: "plugin"|"local", skills, note?}`).
2. Show the list in the chat and ask what to add.
3. With the answer, `npx @ramon-sg/skills-manager init --select <ids>`. Grammar:
   `plugin@marketplace` (all its skills), `plugin@marketplace:skill1+skill2`
   (some of them), or the name of a local skill; separated by commas.

## With a manifest

- Add more: `npx @ramon-sg/skills-manager add --candidates`, show the list, ask, then
  `npx @ramon-sg/skills-manager add --select <ids>`.
- Update: `npx @ramon-sg/skills-manager update --dry-run` (or `update <name> --dry-run`)
  only prints what would change. Show the result and, once approved, run
  `npx @ramon-sg/skills-manager update [name]`.
- Reconcile disk and lock with the manifest: `npx @ramon-sg/skills-manager install`.

When a plugin is copied, the command sets `enabledPlugins: {"<plugin>": false}`
in `.claude/settings.json` so it is not loaded twice; do not touch it.

## From a catalog

A catalog is a repo of shared skills (`skills-catalog.json` at its root).

1. `npx @ramon-sg/skills-manager add --catalog <owner/repo> --candidates` (or
   `init` without a manifest) prints its skills as JSON, with `category`,
   `description` and `requires`.
2. Show them in the chat grouped by category and ask which ones.
3. `npx @ramon-sg/skills-manager add --catalog <owner/repo> --select catalog:<owner/repo>/<skill>,...`.
   What a skill `requires` comes along on its own.

`update <name>` moves only that skill of the catalog.

## Before applying and after

1. Show the change: `git diff --stat .agents/skills` and the diff of every
   touched `SKILL.md`, so the user sees which new instructions come in.
2. Apply only with their explicit approval.
3. Run `npx @ramon-sg/skills-manager check` and leave the changes uncommitted.

## If `check` fails

Without a manifest it exits 0. With one, it fails when disk, lock and manifest
disagree (a hand-edited skill, or one that is missing). The output says which:
run `npx @ramon-sg/skills-manager install` to reconcile what is missing. If the difference
was a hand edit, `install` refuses to go on and there are two ways out; ask which
one before running anything:

- Go back to the locked version: `rm -rf .agents/skills/<name> && npx @ramon-sg/skills-manager install`.
- Move to the latest published: `npx @ramon-sg/skills-manager update <name>` (overwrites the
  edit and moves the lock; `--dry-run` warns `<name>: edited by hand, will be overwritten`).

Local skills do not fail for being edited; `update <name>` copies them again from
the machine, overwriting the edit.
