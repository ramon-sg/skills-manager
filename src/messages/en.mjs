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
    manifest: {
      pathsNotObject: () => '"paths" must be an object.',
      pathsUnknownKey: ({ key, allowed }) => `Unknown key "${key}" in "paths"; allowed: ${allowed}`,
      pathsNotString: ({ key }) => `"paths.${key}" must be a string.`,
      sessionStartNotList: () => '"sessionStart" must be a list of skill names.',
      noSources: () => 'The manifest needs a "sources" list.',
      sourceKind: ({ kinds, entry }) => `Each source takes exactly one of ${kinds}: ${entry}`,
      catalogTwice: ({ catalog }) => `The catalog ${catalog} appears twice in the manifest; list all its skills in one source.`,
      pathRoot: ({ key, value }) => `The path "${key}" must not point at the repo root: ${value}`,
    },
    lock: {
      invalidVersion: ({ version }) => `The lock has an invalid lockVersion: ${version}.`,
      newerVersion: ({ version }) => `The lock was written by a newer skills-manager (lockVersion ${version}); upgrade @ramon-sg/skills-manager.`,
    },
    git: {
      failed: ({ args }) => `git ${args} failed`,
      repoNotAllowed: ({ repo }) => `Repo not allowed (only https:// or file://): ${repo}`,
      notFullSha: ({ sha }) => `Not a full sha: ${sha}`,
      pathNotRelative: ({ rel }) => `The path must be relative and without "..": ${rel}`,
      invalidSkillName: ({ name }) => `Invalid skill name: ${name}`,
      escapesRepo: ({ rel }) => `"${rel}" escapes the origin repo (symlink pointing outside).`,
      symlink: ({ rel }) => `"${rel}" is a symlink: skills cannot contain symlinks.`,
      noRef: ({ repo, ref }) => `${repo} has no ${ref}.`,
      noHead: ({ repo }) => `${repo} has no HEAD.`,
    },
    catalog: {
      unknownKey: ({ key, allowed }) => `Unknown key "${key}" in a catalog source; allowed: ${allowed}`,
      needsSkills: ({ catalog }) => `The catalog source ${catalog} needs a non-empty "skills" list.`,
      badRef: ({ repo }) => `"ref" of ${repo} must be a branch or tag name.`,
      skillNotObject: ({ file, skill }) => `Each skill of ${file} must be an object: ${skill}`,
      requiresNotList: ({ name }) => `"requires" of ${name} must be a list.`,
      editableNotList: ({ name }) => `"editable" of ${name} must be a list.`,
      editableDefinition: ({ name, file }) => `"editable" of ${name} cannot include ${file}.`,
      missing: ({ file }) => `The repo has no ${file}.`,
      badVersion: ({ file, version }) => `${file} has an invalid catalogVersion: ${version}.`,
      newerVersion: ({ file, version }) => `${file} uses catalogVersion ${version}; upgrade @ramon-sg/skills-manager.`,
      noSkillsList: ({ file }) => `${file} needs a "skills" list.`,
      duplicate: ({ file, name }) => `${file} lists "${name}" twice.`,
      requiresMissing: ({ name, missing, file }) => `"${name}" requires "${missing}", which is not in ${file}.`,
      noSkillFile: ({ name, file, path }) => `"${name}" has no ${file} at ${path}.`,
      notInCatalog: ({ name, catalog }) => `"${name}" is not in the catalog ${catalog}.`,
      notInCatalogAt: ({ name, catalog, tag }) => `"${name}" is not in the catalog ${catalog} at ${tag}.`,
    },
    repo: {
      invalidJson: ({ file }) => `${file} is not valid JSON.`,
      settingsNotObject: ({ file }) => `${file} must be a JSON object.`,
    },
    source: {
      unknownPluginSource: ({ name, source }) => `Unknown source type in plugin ${name}: ${source}`,
      nothingPicked: () => "You picked nothing.",
      notCandidate: ({ id }) => `"${id}" is not among the candidates (see --candidates).`,
      cannotPick: ({ id, note }) => `"${id}" cannot be picked: ${note}.`,
      unknownSkills: ({ id, unknown, provides }) => `"${id}" does not provide ${unknown}; it provides ${provides}.`,
    },
  },
  pick: {
    yours: () => "yours",
    skillOne: () => "1 skill",
    skillMany: ({ count }) => `${count} skills`,
    all: ({ count }) => `(all, ${count})`,
    usage: () =>
      "Without an interactive terminal use --candidates to see what is available, or --select plugin@marketplace,local-skill (plugin@marketplace:skill1+skill2 for individual skills; catalog:<catalog>/<skill> with --catalog; --repo <owner/name> --select <plugin>[:a+b] | <skill>, with --ref <ref> and --path <dir>).",
    selectNeedsValue: ({ usage }) => `--select needs a value. ${usage}`,
    flagNeedsValue: ({ flag }) => `${flag} needs a value.`,
    onlyOnce: ({ flag }) => `${flag} goes only once.`,
    needsRepo: () => "--ref and --path need --repo.",
    repoWithCatalog: () => "--repo and --catalog cannot go together.",
    nothingNew: () => "Nothing new to add.",
    exists: ({ file }) => `${file} already exists; use skills-manager add`,
    noManifest: ({ file }) => `No ${file} found; start with skills-manager init`,
    initDone: () => "Done: the manifest is created and the skills installed",
    addDone: () => "Done: the skills were added to the manifest and installed",
    note: {
      notOnDisk: () => "not on disk",
      noSkills: () => "no skills",
      unreadableMarketplace: ({ marketplace }) => `could not read marketplace ${marketplace}`,
      otherRepo: () => "plugin in another repo",
    },
  },
  prompt: {
    cancelled: () => "Cancelled; nothing changed.",
    nothingOnMachine: () => "Nothing installed on this machine to add.",
    checkboxKeys: () => "(space ticks · enter continues)",
    selectKeys: () => "(enter selects)",
    pickOne: () => "Tick at least one option with the space bar.",
    yes: () => "Yes",
    no: () => "No",
    introThirdParty: () => "Third-party skills",
    introCatalog: () => "Skills",
    cannotPickTitle: () => "Cannot be picked",
    whatToAdd: ({ keys }) => `What do you want to add? ${keys}`,
    allSkillsQuestion: ({ name, keys }) => `${name}: all the skills? ${keys}`,
    allOption: ({ count }) => `All (${count})`,
    someOption: () => "Pick some",
    skillsOf: ({ name, keys }) => `Skills of ${name} ${keys}`,
    summaryTitle: () => "You are about to add",
    continue: () => "Continue?",
    installing: () => "Installing…",
    replaceQuestion: ({ name, kept }) => `The repo has its own "${name}" skill. Replace it with the incoming one? (its folder is deleted; ${kept})`,
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
