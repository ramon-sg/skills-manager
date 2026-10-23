/**
 * @file Resolves a catalog source skill by skill, which is what lets
 * `update <name>` move one skill without touching the others of the same
 * catalog. Each skill asked for, and each one it requires, is either kept as
 * it is (pinned and on disk), rebuilt at its lock commit (pinned but missing,
 * or missing one of its editable files)
 * or fetched at the latest release (new, or named in `update`). Each commit is
 * fetched at most once.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { catalogRepo, latestRelease, readCatalog, withRequires } from "./catalog.mjs";
import { assertRelPath, fetchSource, insideTree, walk } from "./git.mjs";
import { installedHash, isRegularFile, SKILL_FILE } from "./state.mjs";

/** License copied from the catalog root into each skill. */
const LICENSE = "LICENSE";

/** Prefix of a release tag, dropped to get the version. */
const TAG_PREFIX = "v";

/**
 * Builds the files of one catalog skill from a checkout, adding the catalog's
 * license if the skill has none. Editable files are left out of `files`: they
 * belong to the repo, and `writeAll` creates them from their template or from
 * the copy the skill ships (`defaults`).
 *
 * @param tree - Catalog checkout.
 * @param item - Catalog entry `{ name, path, requires, editable }`.
 * @param release - `{ commit, tag? }` the checkout is at.
 * @returns The skill with name, path, files, defaults, commit, tag, version, requires and editable.
 * @throws {Error} If the folder has no `SKILL.md`, contains symlinks or escapes the checkout.
 */
function buildSkill(tree, item, { commit, tag }) {
  const dir = insideTree(tree, item.path);
  if (!isRegularFile(path.join(dir, SKILL_FILE))) {
    throw new Error(`"${item.name}" has no ${SKILL_FILE} at ${item.path}.`);
  }
  const all = walk(dir);
  const files = all.filter((file) => !item.editable.includes(file.path));
  const defaults = all.filter((file) => item.editable.includes(file.path));
  const license = path.join(tree, LICENSE);
  if (isRegularFile(license) && !files.some((file) => file.path === LICENSE)) {
    files.push({ path: LICENSE, content: readFileSync(license) });
  }
  const version = tag?.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : tag;
  return { name: item.name, path: item.path, files, defaults, commit, tag, version, requires: item.requires, editable: item.editable };
}

/**
 * Tells whether an installed skill can be left as it is: it is on disk with
 * all its editable files. One that lost an editable file is rebuilt at its
 * lock commit, which creates the file again and keeps the others.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param name - Skill name.
 * @param editable - Its editable paths, from the lock.
 * @returns `true` if nothing is missing.
 */
function isComplete(paths, name, editable) {
  return installedHash(paths, name) !== undefined && editable.every((rel) => isRegularFile(path.join(paths.skillsDir, name, assertRelPath(rel))));
}

/**
 * Fills a catalog plan with the skills to write (`skills`) and the ones left as
 * they are (`keep`). Skills of the source that are no longer asked for nor
 * required end up in neither, so `writeAll` removes them.
 *
 * @param plan - Catalog plan from `planSource`: `{ key, entry, names }`.
 * @param context - `{ paths, lock, update, temp, index }`; `temp` and `index`
 * name the folders where commits are fetched.
 * @throws {Error} If the catalog cannot be fetched or read, or a skill asked
 * for is not in it.
 */
export function resolveCatalogPlan(plan, { paths, lock, update, temp, index }) {
  const { entry } = plan;
  const repo = catalogRepo(entry.catalog);
  const trees = new Map();
  let latest;
  const checkout = (commit) => {
    if (!trees.has(commit)) {
      const tree = path.join(temp, `${index}-${trees.size}`);
      fetchSource({ repo, commit }, tree);
      trees.set(commit, { tree, catalog: readCatalog(tree) });
    }
    return trees.get(commit);
  };
  const skills = [];
  const keep = [];
  const resolve = (name) => {
    const locked = lock.skills[name]?.source === plan.key ? lock.skills[name] : undefined;
    const fresh = locked === undefined || update === true || update === name;
    if (!fresh && isComplete(paths, name, locked.editable ?? [])) {
      keep.push(name);
      return locked.requires ?? [];
    }
    if (fresh) {
      latest ??= latestRelease(repo, entry.ref);
    }
    const release = fresh ? latest : { commit: locked.commit, tag: locked.tag };
    const { tree, catalog } = checkout(release.commit);
    const item = catalog.get(name);
    if (item === undefined) {
      throw new Error(`"${name}" is not in the catalog ${entry.catalog}${release.tag === undefined ? "" : ` at ${release.tag}`}.`);
    }
    skills.push(buildSkill(tree, item, release));
    return item.requires;
  };
  withRequires(entry.skills, resolve);
  plan.skills = skills;
  plan.keep = keep;
}
