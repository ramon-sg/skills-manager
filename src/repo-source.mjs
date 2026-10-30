/**
 * @file Reads the skills of an already downloaded GitHub repo. A repo has one
 * of two shapes: with a Claude Code marketplace (`.claude-plugin/marketplace.json`)
 * it is a list of plugins, each with its own skills (from the plugin's `skills`
 * list, or its `skills/` folder); without one it is a plain folder of skills
 * (`<base>/*`). Folders with an invalid name, symlinks and anything that
 * escapes the tree are skipped silently. An explicit folder wins over the
 * marketplace.
 */
import { existsSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";

import { assertRelPath, assertSkillName, insideTree } from "./git.mjs";
import { isRegularFile, readJson, SKILL_FILE } from "./state.mjs";

/** Marketplace file of a repo, relative to its root. */
export const MARKETPLACE_FILE = ".claude-plugin/marketplace.json";

/** Default folder of skills in a repo without marketplace. */
const DEFAULT_BASE = "skills";

/** Folder of a plugin that holds its skills when it gives no list. */
const PLUGIN_SKILLS_DIR = "skills";

/** Prefix of a `source` that points inside the repo. */
const RELATIVE_SOURCE = "./";

/** Note of a plugin whose files live in another repo. */
const OTHER_REPO_NOTE = "plugin in another repo";

/**
 * Reads a folder as a skill if it is a real folder, inside the tree, with a
 * valid name and a `SKILL.md`.
 *
 * @param tree - Repo checkout.
 * @param rel - Folder path relative to the repo root.
 * @returns `{ name, path }`, or `undefined` if the folder is not a skill.
 */
function skillAt(tree, rel) {
  try {
    const clean = assertRelPath(rel);
    const name = assertSkillName(path.posix.basename(clean));
    const full = path.join(tree, clean);
    if (!existsSync(full) || !lstatSync(full).isDirectory()) {
      return undefined;
    }
    insideTree(tree, clean);
    return isRegularFile(path.join(full, SKILL_FILE)) ? { name, path: clean } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lists the subfolders of a folder that are skills.
 *
 * @param tree - Repo checkout.
 * @param rel - Folder path relative to the repo root.
 * @returns The skills found; empty if the folder does not exist.
 */
function skillsIn(tree, rel) {
  try {
    const clean = assertRelPath(rel);
    insideTree(tree, clean);
    return readdirSync(path.join(tree, clean))
      .map((entry) => skillAt(tree, path.posix.join(clean, entry)))
      .filter((skill) => skill !== undefined);
  } catch {
    return [];
  }
}

/**
 * Sorts skills by name and drops repeated paths.
 *
 * @param skills - Skills in any order.
 * @returns A new sorted list.
 */
function tidy(skills) {
  const unique = [...new Map(skills.map((skill) => [skill.path, skill])).values()];
  return unique.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Reads the skills of one marketplace plugin.
 *
 * @param tree - Repo checkout.
 * @param plugin - Entry of the marketplace `plugins` list.
 * @returns `{ name, skills, note? }`.
 */
function pluginSkills(tree, plugin) {
  const { name, source } = plugin;
  if (typeof source !== "string" || !source.startsWith(RELATIVE_SOURCE)) {
    return { name, skills: [], note: OTHER_REPO_NOTE };
  }
  let root;
  try {
    root = assertRelPath(source);
  } catch {
    return { name, skills: [] };
  }
  const found = [];
  if (Array.isArray(plugin.skills)) {
    for (const listed of plugin.skills) {
      try {
        const rel = path.posix.join(root, assertRelPath(listed));
        const own = skillAt(tree, rel);
        found.push(...(own === undefined ? skillsIn(tree, rel) : [own]));
      } catch {
        // An invalid listed path is skipped like any other bad folder.
      }
    }
  } else {
    found.push(...skillsIn(tree, path.posix.join(root, PLUGIN_SKILLS_DIR)));
  }
  return { name, skills: tidy(found) };
}

/**
 * Reads the marketplace of a repo, if it has one.
 *
 * @param tree - Repo checkout.
 * @returns The `plugins` list (the first plugin of a repeated name only), or
 * `undefined` without a marketplace.
 * @throws {Error} If the marketplace file is not valid JSON.
 */
function readMarketplace(tree) {
  const file = path.join(tree, MARKETPLACE_FILE);
  if (!existsSync(file)) {
    return undefined;
  }
  let data;
  try {
    data = readJson(file);
  } catch (error) {
    throw new Error(`${MARKETPLACE_FILE} is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(data?.plugins)) {
    return [];
  }
  const named = data.plugins.filter((plugin) => typeof plugin?.name === "string");
  return named.filter((plugin, index) => named.findIndex((other) => other.name === plugin.name) === index);
}

/**
 * Lists the skills of a downloaded repo: the folders of `base` when given, else
 * per plugin when it has a marketplace, else the folders of `skills`.
 *
 * @param tree - Repo checkout.
 * @param base - Folder of skills; given, it wins over the marketplace.
 * @returns `{ plugins }` with a marketplace, `{ skills }` without one. Skill
 * paths are POSIX, relative to the repo root.
 * @throws {Error} If the marketplace file is not valid JSON.
 * @example
 * readRepoSkills(tree);
 * // { skills: [{ name: "alpha", path: "skills/alpha" }] }
 */
export function readRepoSkills(tree, base) {
  const plugins = base === undefined ? readMarketplace(tree) : undefined;
  if (plugins === undefined) {
    return { skills: tidy(skillsIn(tree, base ?? DEFAULT_BASE)) };
  }
  return { plugins: plugins.map((plugin) => pluginSkills(tree, plugin)) };
}

/**
 * Names the marketplace plugin that lists a skill path.
 *
 * @param tree - Repo checkout.
 * @param skillPath - Skill path relative to the repo root.
 * @returns The plugin name, or `undefined` without a marketplace or a plugin that has it.
 * @throws {Error} If the marketplace file is not valid JSON.
 * @example
 * pluginOfPath(tree, "plugins/demo/skills/alpha"); // "demo"
 */
export function pluginOfPath(tree, skillPath) {
  return pluginWithPath(tree, skillPath)?.name;
}

/**
 * Finds the marketplace plugin that lists a skill path, with all its skills.
 *
 * @param tree - Repo checkout.
 * @param skillPath - Skill path relative to the repo root.
 * @returns `{ name, skills }`, or `undefined` without a marketplace or a plugin that has it.
 * @throws {Error} If the marketplace file is not valid JSON.
 * @example
 * pluginWithPath(tree, "plugins/demo/skills/alpha");
 * // { name: "demo", skills: [{ name: "alpha", path: "plugins/demo/skills/alpha" }] }
 */
export function pluginWithPath(tree, skillPath) {
  const { plugins } = readRepoSkills(tree);
  return plugins?.find((plugin) => plugin.skills.some((skill) => skill.path === skillPath));
}
