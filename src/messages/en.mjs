/**
 * @file English message catalog. Same keys, kinds and parameters as `es.mjs`.
 */

/** @type {import("./es.mjs").Messages} */
export const en = {
  lang: {
    invalid: ({ source, value }) => `${source} expects es or en: ${value}`,
    missing: () => "--lang needs a value: es or en",
  },
  errors: {
    unexpected: () => "Something went wrong",
    unknownCommand: ({ command }) => `Unknown subcommand: ${command}; use install, update, check, list, session-notice, init or add`,
  },
  replace: {
    missing: () => "--replace needs the names of the skills to replace.",
    misplaced: () => "--replace goes with install, update, init or add.",
  },
  next: {
    run: () => "To fix it, run:",
    start: () => "To get started, run:",
  },
  check: {
    ok: () => "Third-party skills match the lock and the manifest.",
    drift: () => "Third-party skills do not match the lock or the manifest.",
    problems: {
      missing: () => "missing on disk",
      edited: () => "edited by hand",
      notInstalled: () => "sources not installed",
      stale: () => "in the lock without a source in the manifest",
      skillsList: () => "with a different skills list than the lock",
      plugins: () => "lock plugins differ from the manifest",
    },
    pluginsDiff: ({ lock, manifest }) => `lock [${lock}], manifest [${manifest}]`,
  },
  install: {
    done: () => "Done: the changes were applied",
    upToDate: () => "Everything is up to date: nothing to change",
    dryRun: () => "This is what would change (nothing was written)",
    noManifest: ({ file }) => `There is no ${file}: nothing to install`,
    nothingChanged: ({ clashes }) => `${clashes}\nNothing changed.`,
    collisions: ({ items }) => items,
    notInLock: ({ name, file }) => `"${name}" is not in ${file}.`,
    pluginNotFound: ({ plugin }) => `Cannot find ${plugin} in this machine's marketplaces (~/.claude/plugins).`,
    localNotFound: ({ file }) => `Cannot find ${file}.`,
    edited: ({ name, dir }) =>
      `"${name}" was edited by hand\nTo go back to the lock version: rm -rf ${dir} && skills-manager install\nTo overwrite it with the latest published: skills-manager update ${name}`,
    ownHint: ({ names, each }) =>
      `Run it in a terminal to be asked, or again with --replace ${names}; replacing deletes each own folder: ${each}.`,
    change: {
      removed: ({ name }) => `${name}: will be removed`,
      added: ({ name, label }) => `${name}: new (${label})`,
      addedReplacing: ({ name, label }) => `${name}: new (${label}), replaces the repo's own folder`,
      moved: ({ name, from, to }) => `${name}: ${from} → ${to}`,
      overwritten: ({ name }) => `${name}: edited by hand, will be overwritten`,
      editableReplaced: ({ name, rel }) => `${name}: ${rel} is no longer editable; the repo's copy will be replaced by the skill's`,
      editableRemoved: ({ name, rel }) => `${name}: ${rel} is no longer editable; the repo's copy will be removed`,
    },
  },
  collisions: {
    ownCatalog: ({ name, origins }) =>
      `"${name}" (from ${origins}) already exists as an own skill: remove the own folder or drop "${name}" (and what requires it) from the catalog source`,
    ownManifest: ({ name, origins }) => `"${name}" (from ${origins}) already exists as an own skill: exclude "${name}" in the manifest`,
    acrossCatalogs: ({ name, origins }) => `"${name}" comes from ${origins}: keep "${name}" (and what requires it) in only one of those catalog sources`,
    acrossManifest: ({ name, origins }) => `"${name}" comes from ${origins}: exclude "${name}" in the manifest of one of the origins`,
  },
  kept: {
    nothing: () => "nothing in its folder is kept",
    files: ({ files }) => `keeps ${files}`,
  },
  list: {
    row: ({ name, source, version, commit, newer }) => `${name}  ${source}  ${version} (${commit})${newer}`,
    newer: () => "  (newer version available)",
  },
  notice: {
    failed: ({ message }) => `skills-manager: ${message}`,
    missing: ({ name }) => `skills-manager: session-start skill "${name}" is not installed`,
  },
  usage: {
    main: `Usage: skills-manager <command> [options]

Commands:
  install                       bring disk and lock in line with the manifest
  update [name] [--dry-run]     move to the latest published version; --dry-run only shows what would change
  check                         fail if disk, lock and manifest do not match
  list                          show what is in the lock, with origin, version and whether a newer one exists
  session-notice                print the session-start skills for a SessionStart hook; never fails
  init                          pick from what is installed on the machine and install it
  add                           same as init, but to add to what you already have

Options of init and add:
  --replace <names>             allow replacing the repo's own skills with those names (required without a terminal)
  --catalog <repo>              also pick from that catalog
  --repo <owner/name>           pick from a GitHub repo
  --ref <ref>                   branch, tag or commit of the repo (with --repo)
  --path <dir>                  folder of the repo that holds the marketplace (with --repo)
  --candidates                  list what is available as JSON, without installing
  --select <ids>                pick without asking, for example plugin@marketplace,local-skill

General options:
  --lang es|en                  language of the messages (default es)
  --help                        show this help

Environment variables:
  SKILLS_MANAGER_LANG           default language (es or en); --lang wins`,
  },
};
