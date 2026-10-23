#!/usr/bin/env node
/**
 * @file CLI for the third-party skills vendored in `.agents/skills/`:
 *
 *   skills-manager install              reconcile disk and lock with the manifest
 *   skills-manager update [name]        move to the latest published; --dry-run only prints
 *   skills-manager check                fail if disk, lock and manifest do not match
 *   skills-manager list                 what is in the lock, with origin, version and whether a newer one exists
 *   skills-manager session-notice       print the session-start skills for a SessionStart hook; never fails
 *   skills-manager init | add           pick from what is installed on the machine, or from the
 *                                       catalogs given with --catalog, and install it
 *                                       (--candidates lists as JSON; --select picks without asking)
 *
 * The manifest (`.agents/skills.json`) says what is wanted; the lock
 * (`.agents/skills.lock.json`) pins the commit and hash of each skill. Plugins
 * are resolved with the marketplaces in `~/.claude/plugins`, locals are
 * copied from `~/.claude/skills` (`SKILLS_HOME` overrides the home, for tests)
 * and catalogs are fetched from their repo, each skill at its own commit
 * (`catalog-plan.mjs`).
 * Everything that comes from data (repos, shas, paths) is validated before it
 * reaches git or the disk (`git.mjs`). Pure functions live in `lib.mjs`, repo
 * state in `state.mjs` and the `init` / `add` pick in `pick.mjs`.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { catalogRepo, latestRelease, withRequires } from "./catalog.mjs";
import { resolveCatalogPlan } from "./catalog-plan.mjs";
import { assertRelPath, assertRepo, assertSkillName, fetchSource, git, insideTree, latestCommit, walk } from "./git.mjs";
import { diffLock, findCollisions, hashFiles, resolvePluginSource, rewritePluginRefs } from "./lib.mjs";
import { sessionNotice } from "./notice.mjs";
import { commandPick } from "./pick.mjs";
import {
  installedHash,
  isRegularFile,
  loadMarketplaces,
  LOCAL_SKILLS,
  LOCAL_SOURCE,
  lockedNames,
  manifestPlugins,
  readJson,
  LOCK_VERSION,
  readLock,
  readManifest,
  sameSet,
  SKILL_FILE,
  resolvePaths,
  sourceKey,
  sourceLabel,
  staleNames,
  syncProjectSettings,
} from "./state.mjs";

export { fetchSource } from "./git.mjs";
export { loadMarketplaces } from "./state.mjs";

/** License copied from the origin into each skill. */
const LICENSE = "LICENSE";

/** Length of the abbreviated sha that gets printed. */
const SHORT_SHA = 7;

/** Mode used to write a file that is executable in the origin. */
const EXECUTABLE_MODE = 0o755;

/** GitHub `owner/repo` shorthand in `repo` sources. */
const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

/**
 * Resolves where a source is published: repo, ref or sha, and path.
 *
 * @param entry - `plugin` or `repo` source of the manifest.
 * @param marketplaces - What `loadMarketplaces` returns.
 * @returns `{ repo, ref?, sha?, path, plugin? }`; `plugin` only for marketplace ones.
 * @throws {Error} If the marketplace or plugin are missing, or the repo or path are not valid.
 */
function describeSource(entry, marketplaces) {
  if (entry.repo !== undefined) {
    const repo = GITHUB_SHORTHAND.test(entry.repo) ? `https://github.com/${entry.repo}.git` : assertRepo(entry.repo);
    return { repo, ref: entry.ref, path: assertRelPath(entry.path) };
  }
  const [plugin, marketplaceName] = entry.plugin.split("@");
  const marketplace = marketplaces.get(marketplaceName);
  const pluginEntry = marketplace?.plugins.find((candidate) => candidate.name === plugin);
  if (pluginEntry === undefined) {
    throw new Error(`Cannot find ${entry.plugin} in this machine's marketplaces (~/.claude/plugins).`);
  }
  const resolved = resolvePluginSource(pluginEntry, marketplace.repo);
  return { ...resolved, repo: assertRepo(resolved.repo), path: assertRelPath(resolved.path), plugin };
}

/**
 * Shows a managed path relative to the repo root, for messages.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param file - Absolute path under the repo root.
 * @returns The path relative to the root.
 */
function relativeTo(paths, file) {
  return path.relative(path.dirname(path.dirname(paths.manifest)), file);
}

/**
 * Tells whether an installed skill lacks the lock's hash. One that is not on
 * disk does not count as edited.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param lock - Lock read.
 * @param name - Skill to check; must be in the lock.
 * @returns `true` if it is on disk with different content.
 */
function isEdited(paths, lock, name) {
  return ![undefined, lock.skills[name].hash].includes(installedHash(paths, name));
}

/**
 * Stops if any installed skill lacks the lock's hash, and states the two ways
 * out: delete it and install (goes back to the lock version) or update it
 * (moves to the latest published).
 *
 * @param paths - Paths from `resolvePaths`.
 * @param lock - Lock read.
 * @param names - Skills to check; those not on disk do not count.
 * @throws {Error} If any was edited by hand.
 */
function assertUntouched(paths, lock, names) {
  const edited = names.find((name) => isEdited(paths, lock, name));
  if (edited !== undefined) {
    throw new Error(
      `"${edited}" was edited by hand: to go back to the lock version, rm -rf ${relativeTo(paths, path.join(paths.skillsDir, edited))} && skills-manager install; ` +
        `to overwrite it with the latest published, skills-manager update ${edited}`,
    );
  }
}

/**
 * Published version of the origin: the one in `.claude-plugin/plugin.json` or `package.json`.
 *
 * @param dir - Root folder of the plugin or repo.
 * @returns The version, or `undefined` if it declares none.
 */
function versionOf(dir) {
  for (const file of [".claude-plugin/plugin.json", "package.json"]) {
    const full = path.join(dir, file);
    const version = isRegularFile(full) ? readJson(full).version : undefined;
    if (version !== undefined) {
      return version;
    }
  }
  return undefined;
}

/**
 * Builds the files of each skill of a downloaded origin: filters the requested
 * ones, rewrites references between skills of the same plugin and adds the license.
 *
 * @param tree - Origin checkout.
 * @param plan - Source plan: `entry`, `root` (plugin root or skill path) and `plugin`.
 * @returns Skills with name, path in the origin, files and version.
 * @throws {Error} If a skill contains symlinks or escapes the origin.
 */
function collectSkills(tree, plan) {
  const isPlugin = plan.plugin !== undefined;
  const pluginRoot = insideTree(tree, isPlugin ? plan.root : ".");
  const skillsDir = path.posix.join(plan.root, "skills");
  const names = isPlugin
    ? readdirSync(insideTree(tree, skillsDir)).filter((name) => existsSync(path.join(tree, skillsDir, name, SKILL_FILE)))
    : [path.posix.basename(plan.root)];
  const wanted = names.filter((name) => plan.entry.skills === undefined || plan.entry.skills.includes(name)).map(assertSkillName);
  const installed = new Set(wanted);
  const license = [path.join(pluginRoot, LICENSE), path.join(tree, LICENSE)].find(isRegularFile);
  const version = versionOf(pluginRoot);
  return wanted.map((name) => {
    const rel = isPlugin ? path.posix.join(skillsDir, name) : plan.root;
    const files = walk(insideTree(tree, rel)).map((file) =>
      isPlugin && !file.content.includes(0)
        ? { ...file, content: Buffer.from(rewritePluginRefs(file.content.toString("utf8"), plan.plugin, installed)) }
        : file,
    );
    if (license !== undefined && !files.some((file) => file.path === LICENSE)) {
      files.push({ path: LICENSE, content: readFileSync(license) });
    }
    return { name, path: rel, files, version };
  });
}

/**
 * Copies a standalone skill from the machine (`~/.claude/skills/<name>`).
 *
 * @param home - Machine home.
 * @param name - Skill name.
 * @returns The skill with its name and files.
 * @throws {Error} If the name is not valid, it is missing or contains symlinks.
 */
function collectLocal(home, name) {
  const dir = path.join(home, LOCAL_SKILLS, assertSkillName(name));
  if (!isRegularFile(path.join(dir, SKILL_FILE))) {
    throw new Error(`Cannot find ~/${LOCAL_SKILLS}/${name}/${SKILL_FILE}.`);
  }
  return { name, files: walk(dir) };
}

/**
 * Decides what to do with a local source: leave it, or copy it from the machine
 * if it is new, missing on disk or `update <name>` was requested. A copied
 * local becomes the repo's own: it can be edited, and `install` and a general
 * `update` leave it alone while it is on disk.
 *
 * @param entry - `local` source of the manifest.
 * @param context - `{ paths, lock, home, update }`.
 * @returns Plan with `key`, `entry`, `names` and, if it must be copied, `skills`.
 * @throws {Error} If it must be copied and is not on the machine.
 */
function planLocal(entry, { paths, lock, home, update }) {
  const names = lockedNames(lock, entry);
  if (names.length > 0 && update !== entry.local && installedHash(paths, entry.local) !== undefined) {
    return { key: LOCAL_SOURCE, entry, names };
  }
  return { key: LOCAL_SOURCE, entry, names, skills: [collectLocal(home, entry.local)] };
}

/**
 * Decides what to do with a source: leave it, rebuild it at the lock commit
 * (something is missing or its skills list changed) or fetch it at the latest
 * published (new or requested in `update`).
 *
 * @param entry - Manifest source.
 * @param context - `{ paths, lock, home, marketplaces, update }`.
 * @returns Plan with `key`, `entry`, pinned `names` and, if it must be fetched, `repo`, `commit`, `root` and `plugin`;
 * a catalog plan only carries `catalog: true` and is resolved skill by skill when fetching.
 * @throws {Error} If a pinned skill was edited by hand and overwriting was not requested.
 */
function planSource(entry, context) {
  if (entry.local !== undefined) {
    return planLocal(entry, context);
  }
  const { paths, lock, marketplaces, update } = context;
  const key = sourceKey(entry);
  const names = lockedNames(lock, entry);
  if (entry.catalog !== undefined) {
    assertUntouched(paths, lock, names.filter((name) => update !== true && update !== name));
    return { key, entry, names, catalog: true };
  }
  if (names.length === 0 || update === true || names.includes(update)) {
    const resolved = describeSource(entry, marketplaces);
    return { key, entry, names, repo: resolved.repo, commit: latestCommit(resolved), root: resolved.path, plugin: resolved.plugin };
  }
  assertUntouched(paths, lock, names);
  const listChanged = entry.skills !== undefined && !sameSet(entry.skills, names);
  if (!listChanged && names.every((name) => installedHash(paths, name) !== undefined)) {
    return { key, entry, names };
  }
  const first = lock.skills[names[0]];
  const skillPath = assertRelPath(first.path);
  const isPlugin = entry.plugin !== undefined;
  const pluginRoot = isPlugin ? path.posix.dirname(path.posix.dirname(skillPath)) : skillPath;
  return { key, entry, names, repo: first.repo, commit: first.commit, root: pluginRoot, plugin: entry.plugin?.split("@")[0] };
}

/**
 * Describes what changes: new skills, removed ones, ones that change commit and
 * the hand-edited ones that will be overwritten.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param plans - Plans with their skills already built.
 * @param stale - Lock skills whose source is no longer in the manifest.
 * @param lock - Previous lock.
 * @returns One line per change.
 */
function describeChanges(paths, plans, stale, lock) {
  const lines = stale.map((name) => `${name}: will be removed`);
  for (const plan of plans.filter((candidate) => candidate.skills !== undefined)) {
    lines.push(...leavingNames(plan, plans).map((name) => `${name}: will be removed`));
    for (const { name, commit = plan.commit, tag } of plan.skills) {
      const label = commit === undefined ? LOCAL_SOURCE : `${tag === undefined ? "" : `${tag} `}${commit.slice(0, SHORT_SHA)}`.trim();
      const known = Object.hasOwn(lock.skills, name);
      const old = known ? lock.skills[name].commit : undefined;
      if (!known) {
        lines.push(`${name}: new (${label})`);
        continue;
      }
      if (old !== commit) {
        lines.push(`${name}: ${old?.slice(0, SHORT_SHA) ?? LOCAL_SOURCE} → ${label}`);
      }
      if (isEdited(paths, lock, name)) {
        lines.push(`${name}: edited by hand, will be overwritten`);
      }
    }
  }
  return lines;
}

/**
 * Fetches each source that needs it and builds its skills; catalog sources are
 * resolved skill by skill.
 *
 * @param plans - Plan of each source; `skills` (and, for catalogs, `keep`) is added to them.
 * @param temp - Temporary folder where origins are fetched.
 * @param context - `{ paths, lock, update }`, for catalog sources.
 */
function fetchPlans(plans, temp, context) {
  for (const [index, plan] of plans.entries()) {
    if (plan.catalog === true) {
      resolveCatalogPlan(plan, { ...context, temp, index });
    } else if (plan.commit !== undefined) {
      const tree = path.join(temp, String(index));
      fetchSource({ repo: plan.repo, commit: plan.commit }, tree);
      plan.skills = collectSkills(tree, plan);
    }
  }
}

/**
 * Stops if an incoming skill clashes with an own one or with another origin's.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param plans - Plans with their skills already built.
 * @param lock - Previous lock; what is in it is not own.
 * @throws {Error} With one message per collision.
 */
function assertNoCollisions(paths, plans, lock) {
  const incoming = new Map();
  for (const plan of plans) {
    const names = plan.skills === undefined ? plan.names : [...plan.skills.map((skill) => skill.name), ...(plan.keep ?? [])];
    for (const name of names) {
      incoming.set(name, [...(incoming.get(name) ?? []), plan.key]);
    }
  }
  const skillsRoot = paths.skillsDir;
  const existing = existsSync(skillsRoot) ? readdirSync(skillsRoot) : [];
  const collisions = findCollisions(incoming, new Set(existing.filter((name) => !Object.hasOwn(lock.skills, name))));
  if (collisions.length > 0) {
    throw new Error(collisions.join("\n"));
  }
}

/**
 * Reconciles `.agents/skills/` and the lock with the manifest: removes what is
 * gone, rebuilds what changed and fetches what is new. `local` sources are
 * copied from `~/.claude/skills` when missing and `update` only overwrites them
 * if they are named.
 *
 * @param root - Repo root.
 * @param opts - `{ home, update?: true | name, dryRun?, log? }`.
 * @returns `{ changed }`: whether the lock was written.
 * @throws {Error} If a skill was edited by hand, there are collisions, invalid data or git fails.
 */
export function installAll(root, { home, update, dryRun = false, log = console.log }) {
  const manifest = readManifest(root);
  if (manifest === undefined) {
    log(`No ${path.relative(root, resolvePaths(root).manifest)}: nothing to install.`);
    return { changed: false };
  }
  const paths = resolvePaths(root, manifest);
  const lock = readLock(paths);
  if (typeof update === "string" && !Object.hasOwn(lock.skills, update)) {
    throw new Error(`"${update}" is not in ${path.relative(root, paths.lock)}.`);
  }
  const stale = staleNames(lock, manifest);
  assertUntouched(paths, lock, stale);
  const context = { paths, lock, home, marketplaces: loadMarketplaces(home), update };
  const plans = manifest.sources.map((entry) => planSource(entry, context));
  const temp = mkdtempSync(path.join(tmpdir(), "skills-"));
  try {
    fetchPlans(plans, temp, context);
    assertNoCollisions(paths, plans, lock);
    describeChanges(paths, plans, stale, lock).forEach((line) => log(line));
    return dryRun ? { changed: false } : writeAll(paths, { plans, stale, lock, manifest });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * Builds the lock entry of a written skill. Catalog skills carry their own
 * repo, commit, tag and requires; other sources share the plan's.
 *
 * @param plan - Plan of the skill's source.
 * @param skill - Built skill with its files.
 * @returns The lock entry.
 */
function lockEntry(plan, skill) {
  const hash = hashFiles(skill.files);
  if (plan.entry.local !== undefined) {
    return { source: plan.key, hash };
  }
  if (plan.catalog === true) {
    const { commit, path: skillPath, tag, version, requires } = skill;
    return { source: plan.key, repo: catalogRepo(plan.entry.catalog), commit, ...(tag === undefined ? {} : { tag }), path: skillPath, version, hash, requires };
  }
  return { source: plan.key, repo: plan.repo, commit: plan.commit, path: skill.path, version: skill.version, hash };
}

/**
 * Names a source had in the lock that it no longer writes nor keeps. A name
 * another source now brings is not leaving: it moved there.
 *
 * @param plan - Plan with its skills already built.
 * @param plans - Every plan, to see what the others bring.
 * @returns The names to remove.
 */
function leavingNames(plan, plans) {
  const incoming = new Set(plans.flatMap((other) => [...(other.skills ?? []).map((skill) => skill.name), ...(other.keep ?? [])]));
  return plan.names.filter((name) => !incoming.has(name));
}

/**
 * Writes the fetched skills, deletes those that leave, rewrites the lock if it
 * changed and leaves the lock's plugins disabled in `.claude/settings.json`.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param state - `{ plans, stale, lock, manifest }`.
 * @returns `{ changed }`: whether the lock was written.
 */
function writeAll(paths, { plans, stale, lock, manifest }) {
  const skills = { ...lock.skills };
  const remove = (name) => {
    rmSync(path.join(paths.skillsDir, name), { recursive: true, force: true });
    delete skills[name];
  };
  const fetched = plans.filter((candidate) => candidate.skills !== undefined);
  stale.forEach(remove);
  fetched.forEach((plan) => leavingNames(plan, plans).forEach(remove));
  for (const plan of fetched) {
    for (const skill of plan.skills) {
      const dir = path.join(paths.skillsDir, skill.name);
      rmSync(dir, { recursive: true, force: true });
      for (const file of skill.files) {
        mkdirSync(path.dirname(path.join(dir, file.path)), { recursive: true });
        writeFileSync(path.join(dir, file.path), file.content);
        if (file.executable === true) {
          chmodSync(path.join(dir, file.path), EXECUTABLE_MODE);
        }
      }
      skills[skill.name] = lockEntry(plan, skill);
    }
  }
  const sorted = Object.fromEntries(Object.keys(skills).sort().map((name) => [name, skills[name]]));
  const text = `${JSON.stringify({ lockVersion: LOCK_VERSION, skills: sorted, plugins: manifestPlugins(manifest) }, null, 2)}\n`;
  syncProjectSettings(paths, lock.plugins, manifestPlugins(manifest));
  const file = paths.lock;
  if (existsSync(file) && readFileSync(file, "utf8") === text) {
    return { changed: false };
  }
  writeFileSync(file, text);
  return { changed: true };
}

/**
 * Looks for differences between disk, lock and manifest.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param manifest - Manifest read.
 * @param lock - Lock read.
 * @returns `[problem, names]` pairs, only those with something in them.
 */
function driftProblems(paths, manifest, lock) {
  const actual = new Map();
  for (const name of Object.keys(lock.skills)) {
    const hash = installedHash(paths, name);
    if (hash !== undefined) {
      actual.set(name, hash);
    }
  }
  const diff = diffLock(lock, actual);
  // NOTE: a copied local is the repo's own; editing it is not drift.
  const modified = diff.modified.filter((name) => lock.skills[name].source !== LOCAL_SOURCE);
  const remote = manifest.sources.filter((entry) => entry.local === undefined);
  const expected = (entry) => (entry.catalog === undefined ? entry.skills : withRequires(entry.skills, (name) => lock.skills[name]?.requires ?? []));
  const plugins = manifestPlugins(manifest);
  const pluginsDiff = `lock [${lock.plugins.join(", ")}], manifest [${plugins.join(", ")}]`;
  return [
    ["missing on disk", diff.missing],
    ["edited by hand", modified],
    ["sources not installed", manifest.sources.filter((entry) => lockedNames(lock, entry).length === 0).map(sourceLabel)],
    ["in the lock without a source in the manifest", staleNames(lock, manifest)],
    ["with a different skills list than the lock", remote.filter((e) => e.skills !== undefined && !sameSet(expected(e), lockedNames(lock, e))).map(sourceKey)],
    ["lock plugins differ from the manifest", JSON.stringify(plugins) === JSON.stringify(lock.plugins) ? [] : [pluginsDiff]],
  ].filter(([, names]) => names.length > 0);
}

/**
 * Compares disk, lock and manifest, and exits with 1 if anything does not match.
 *
 * @param root - Repo root.
 */
function commandCheck(root) {
  const manifest = readManifest(root);
  if (manifest === undefined) {
    return;
  }
  const paths = resolvePaths(root, manifest);
  const problems = driftProblems(paths, manifest, readLock(paths));
  if (problems.length === 0) {
    console.log("✅ Third-party skills match the lock and the manifest.");
    return;
  }
  console.error("❌ Third-party skills do not match the lock or the manifest (run skills-manager install):");
  for (const [kind, names] of problems) {
    console.error(`   ${kind}: ${names.join(", ")}`);
  }
  process.exit(1);
}

/**
 * Prints each lock skill with its origin and version, and whether a newer one exists.
 *
 * @param root - Repo root.
 * @param home - Home holding the marketplaces.
 */
function commandList(root, home) {
  const lock = readLock(resolvePaths(root, readManifest(root)));
  const marketplaces = loadMarketplaces(home);
  const latest = new Map();
  for (const entry of (readManifest(root)?.sources ?? []).filter((candidate) => candidate.local === undefined)) {
    try {
      const commit = entry.catalog === undefined
        ? latestCommit(describeSource(entry, marketplaces))
        : latestRelease(catalogRepo(entry.catalog), entry.ref).commit;
      latest.set(sourceKey(entry), commit);
    } catch {
      // NOTE: without the marketplace or the network it is unknown whether a newer version exists; it is listed anyway.
    }
  }
  for (const [name, skill] of Object.entries(lock.skills)) {
    const newer = latest.has(skill.source) && latest.get(skill.source) !== skill.commit ? "  (newer version available)" : "";
    console.log(`${name}  ${skill.source}  ${skill.version ?? "-"} (${skill.commit?.slice(0, SHORT_SHA) ?? LOCAL_SOURCE})${newer}`);
  }
}

/**
 * Runs `session-notice` for a SessionStart hook: the notice goes to stdout and
 * any problem becomes one line on stderr. It never exits non-zero, so a broken
 * manifest cannot break a session start.
 */
function commandSessionNotice() {
  try {
    const { text, missing } = sessionNotice(git(["rev-parse", "--show-toplevel"], process.cwd()));
    process.stdout.write(text);
    for (const name of missing) {
      console.error(`skills-manager: session-start skill "${name}" is not installed`);
    }
  } catch (error) {
    console.error(`skills-manager: ${error.message.split("\n")[0]}`);
  }
}

/**
 * Entry point: finds the repo root and dispatches the subcommand. Errors end
 * with their `exitCode` (2 for usage errors) or with 1.
 */
async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const home = process.env.SKILLS_HOME ?? homedir();
  if (subcommand === "session-notice") {
    commandSessionNotice();
    return;
  }
  try {
    const root = git(["rev-parse", "--show-toplevel"], process.cwd());
    if (subcommand === "install") {
      installAll(root, { home });
    } else if (subcommand === "update") {
      const name = rest.find((arg) => !arg.startsWith("--"));
      installAll(root, { home, update: name ?? true, dryRun: rest.includes("--dry-run") });
    } else if (subcommand === "check") {
      commandCheck(root);
    } else if (subcommand === "list") {
      commandList(root, home);
    } else if (subcommand === "init" || subcommand === "add") {
      await commandPick(root, { init: subcommand === "init", args: rest, home, install: () => installAll(root, { home }) });
    } else {
      throw new Error(`Unknown subcommand: ${subcommand ?? "(none)"}; use install, update, check, list, session-notice, init or add`);
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(error.exitCode ?? 1);
  }
}

/**
 * Tells whether this file is the process entry point, also when it is reached
 * through a symlink such as `node_modules/.bin/skills-manager`.
 *
 * @returns `true` if `argv[1]` resolves to this module's file.
 */
function isEntryPoint() {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  await main();
}
