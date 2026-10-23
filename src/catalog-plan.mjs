/**
 * @file Resolves a catalog source skill by skill, which is what lets
 * `update <name>` move one skill without touching the others of the same
 * catalog. Each skill asked for, and each one it requires, is either kept as
 * it is (pinned and on disk), rebuilt at its lock commit (pinned but missing)
 * or fetched at the latest release (new, or named in `update`). Each commit is
 * fetched at most once.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { catalogRepo, latestRelease, readCatalog, withRequires } from "./catalog.mjs";
import { fetchSource, insideTree, walk } from "./git.mjs";
import { installedHash, isRegularFile, SKILL_FILE } from "./state.mjs";

/** License copied from the catalog root into each skill. */
const LICENSE = "LICENSE";

/** Prefix of a release tag, dropped to get the version. */
const TAG_PREFIX = "v";

/**
 * Builds the files of one catalog skill from a checkout, adding the catalog's
 * license if the skill has none.
 *
 * @param tree - Catalog checkout.
 * @param item - Catalog entry `{ name, path, requires }`.
 * @param release - `{ commit, tag? }` the checkout is at.
 * @returns The skill with name, path, files, commit, tag, version and requires.
 * @throws {Error} If the folder has no `SKILL.md`, contains symlinks or escapes the checkout.
 */
function buildSkill(tree, item, { commit, tag }) {
  const dir = insideTree(tree, item.path);
  if (!isRegularFile(path.join(dir, SKILL_FILE))) {
    throw new Error(`"${item.name}" has no ${SKILL_FILE} at ${item.path}.`);
  }
  const files = walk(dir);
  const license = path.join(tree, LICENSE);
  if (isRegularFile(license) && !files.some((file) => file.path === LICENSE)) {
    files.push({ path: LICENSE, content: readFileSync(license) });
  }
  const version = tag?.startsWith(TAG_PREFIX) ? tag.slice(TAG_PREFIX.length) : tag;
  return { name: item.name, path: item.path, files, commit, tag, version, requires: item.requires };
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
    if (!fresh && installedHash(paths, name) !== undefined) {
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
