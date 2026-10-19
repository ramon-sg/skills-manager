/**
 * @file State of the third-party skills in the repo and on the machine: paths of
 * the manifest, the lock and the skills folders; reading and writing the
 * manifest, reading the lock, hashing what is installed, which source each
 * lock skill belongs to, and the marketplaces in `~/.claude/plugins`. Shared
 * by `cli.mjs` (install, update, check, list) and `pick.mjs` (init, add).
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { assertRelPath, assertSkillName, walk } from "./git.mjs";
import { hashFiles, parseManifest } from "./lib.mjs";

/** Third-party skills manifest, relative to the repo root. Fixed: `paths` is read from it. */
const MANIFEST = ".agents/skills.json";

/** Default lock path, relative to the repo root. */
const DEFAULT_LOCK = ".agents/skills.lock.json";

/** Default folder where skills are installed, own and third-party, relative to the repo root. */
const DEFAULT_SKILLS_DIR = ".agents/skills";

/** Default project Claude Code settings, relative to the repo root. */
const DEFAULT_SETTINGS = ".claude/settings.json";

/**
 * Absolute paths of the files and folders the tool manages. The manifest is
 * always `.agents/skills.json`; the rest can be moved with `paths` in it.
 *
 * @param root - Repo root.
 * @param manifest - Manifest read, if any; its `paths` field overrides the defaults.
 * @returns Absolute `{ manifest, lock, skillsDir, settings }`.
 * @throws {Error} If a path in `paths` is absolute or climbs out of the root.
 * @example
 * resolvePaths("/repo", { sources: [], paths: { skillsDir: "skills" } }).skillsDir;
 * // "/repo/skills"
 */
export function resolvePaths(root, manifest) {
  const configured = manifest?.paths ?? {};
  const pick = (key, fallback) => path.join(root, assertRelPath(configured[key] ?? fallback));
  return {
    manifest: path.join(root, MANIFEST),
    lock: pick("lock", DEFAULT_LOCK),
    skillsDir: pick("skillsDir", DEFAULT_SKILLS_DIR),
    settings: pick("settings", DEFAULT_SETTINGS),
  };
}

/** File that marks a folder as a skill. */
export const SKILL_FILE = "SKILL.md";

/** Folder of the machine's standalone skills, relative to home. */
export const LOCAL_SKILLS = ".claude/skills";

/** Claude Code plugins and marketplaces folder, relative to home. */
export const PLUGINS_DIR = ".claude/plugins";

/** `source` value in the lock for skills copied from the machine. */
export const LOCAL_SOURCE = "local";

/**
 * Reads a JSON file from disk.
 *
 * @param file - File path.
 * @returns The parsed content.
 * @throws {Error} If it cannot be read or is not JSON.
 */
export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Tells whether a path is a regular file (not a symlink).
 *
 * @param file - Path to check.
 * @returns `true` if it exists and is a regular file.
 */
export function isRegularFile(file) {
  return existsSync(file) && lstatSync(file).isFile();
}

/**
 * Reads a JSON file that may be missing or broken, without stopping.
 *
 * @param file - File path.
 * @returns The parsed content, or `undefined` if it is missing or unreadable.
 */
function readJsonIfValid(file) {
  try {
    return existsSync(file) ? readJson(file) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the marketplaces installed on the machine, with their repo and plugins.
 * A marketplace that cannot be read is left out; the rest goes on.
 *
 * @param home - Home that holds `.claude/plugins`.
 * @returns Marketplace name to `{ repo, plugins }`; empty if there are none.
 */
export function loadMarketplaces(home) {
  const base = path.join(home, PLUGINS_DIR);
  const marketplaces = new Map();
  for (const [name, info] of Object.entries(readJsonIfValid(path.join(base, "known_marketplaces.json")) ?? {})) {
    const file = path.join(info?.installLocation ?? path.join(base, "marketplaces", name), ".claude-plugin/marketplace.json");
    const source = info?.source;
    const repo = source?.source === "github" ? `https://github.com/${source.repo}.git` : source?.url;
    const marketplace = readJsonIfValid(file);
    if (marketplace !== undefined) {
      marketplaces.set(name, { repo, plugins: marketplace.plugins ?? [] });
    }
  }
  return marketplaces;
}

/**
 * Key under which a manifest source appears in the lock.
 *
 * @param entry - Manifest source.
 * @returns `plugin@marketplace`, `local` or `repo/path`.
 */
export function sourceKey(entry) {
  if (entry.local !== undefined) {
    return LOCAL_SOURCE;
  }
  return entry.plugin ?? `${entry.repo}/${entry.path}`;
}

/**
 * Name of a source for messages: tells one local from another.
 *
 * @param entry - Manifest source.
 * @returns `local:<name>` or the lock key.
 */
export function sourceLabel(entry) {
  return entry.local === undefined ? sourceKey(entry) : `${LOCAL_SOURCE}:${entry.local}`;
}

/**
 * Lock names that come from a source; a local only owns the skill with its own name.
 *
 * @param lock - Lock read.
 * @param entry - Manifest source.
 * @returns The names, in lock order.
 */
export function lockedNames(lock, entry) {
  const key = sourceKey(entry);
  return Object.keys(lock.skills).filter(
    (name) => lock.skills[name].source === key && (entry.local === undefined || name === entry.local),
  );
}

/**
 * Lock skills that no longer belong to any manifest source.
 *
 * @param lock - Lock read.
 * @param manifest - Manifest read.
 * @returns The names, in lock order.
 */
export function staleNames(lock, manifest) {
  const owned = new Set(manifest.sources.flatMap((entry) => lockedNames(lock, entry)));
  return Object.keys(lock.skills).filter((name) => !owned.has(name));
}

/**
 * Tells whether two lists have the same elements, regardless of order.
 *
 * @param a - First list.
 * @param b - Second list.
 * @returns `true` if they match as sets.
 */
export function sameSet(a, b) {
  return JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
}

/**
 * Plugins the manifest asks for, in order.
 *
 * @param manifest - Manifest read.
 * @returns The `plugin@marketplace` keys.
 */
export function manifestPlugins(manifest) {
  return manifest.sources.filter((entry) => entry.plugin !== undefined).map((entry) => entry.plugin);
}

/**
 * Hash of the installed content of a skill, or `undefined` if it is missing.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param name - Skill name.
 * @returns `sha256-<hex>` or `undefined`.
 */
export function installedHash(paths, name) {
  const dir = path.join(paths.skillsDir, name);
  return existsSync(dir) ? hashFiles(walk(dir)) : undefined;
}

/**
 * Reads the lock, or an empty one if it does not exist yet.
 *
 * @param paths - Paths from `resolvePaths`.
 * @returns `{ skills, plugins }`.
 * @throws {Error} If any skill name is not valid.
 */
export function readLock(paths) {
  const file = paths.lock;
  const lock = existsSync(file) ? readJson(file) : {};
  const skills = lock.skills ?? {};
  Object.keys(skills).forEach(assertSkillName);
  return { skills, plugins: lock.plugins ?? [] };
}

/**
 * Reads and validates the manifest, or `undefined` if there is none.
 *
 * @param root - Repo root.
 * @returns The parsed manifest or `undefined`.
 * @throws {Error} If it is not a valid manifest.
 */
export function readManifest(root) {
  const file = path.join(root, MANIFEST);
  return existsSync(file) ? parseManifest(readFileSync(file, "utf8")) : undefined;
}

/**
 * Writes the manifest with a stable format.
 *
 * @param root - Repo root.
 * @param manifest - Manifest to write; validated first.
 * @throws {Error} If it is not a valid manifest.
 */
export function writeManifest(root, manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  parseManifest(text);
  const file = path.join(root, MANIFEST);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * Leaves disabled in the project the plugins whose skills were copied, so they
 * do not show up twice (the repo copy and the prefixed plugin one). It only
 * manages the `enabledPlugins` keys that are its own: sets `false` on each
 * plugin of the new lock and removes the `false` of those in the previous lock
 * that are gone. What someone else set (a `true`, a plugin that was never in
 * the lock) is left alone, and the rest of the file (hooks, etc.) stays as is.
 *
 * @param paths - Paths from `resolvePaths`.
 * @param previous - Plugins of the previous lock (those the tool already managed).
 * @param plugins - Plugins of the new lock.
 * @returns `true` if the file was written.
 * @throws {Error} If the settings file exists but is not a JSON object.
 */
export function syncProjectSettings(paths, previous, plugins) {
  const file = paths.settings;
  const settings = existsSync(file) ? readJson(file) : {};
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${file} must be a JSON object.`);
  }
  const enabled = { ...settings.enabledPlugins };
  for (const plugin of previous.filter((name) => !plugins.includes(name) && enabled[name] === false)) {
    delete enabled[plugin];
  }
  for (const plugin of plugins) {
    enabled[plugin] = false;
  }
  const { enabledPlugins: _old, ...rest } = settings;
  const next = Object.keys(enabled).length > 0 ? { ...rest, enabledPlugins: enabled } : rest;
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const same = existsSync(file) ? readFileSync(file, "utf8") === text : Object.keys(next).length === 0;
  if (same) {
    return false;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}
