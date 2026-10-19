/**
 * @file Pure functions for handling third-party skills: manifest validation
 * (`.agents/skills.json`), marketplace plugin resolution, rewriting of
 * `plugin:skill` references, name collisions, installed-content hash, drift
 * against the lock (`.agents/skills.lock.json`), and the candidates and picks
 * of `skills-manager init` / `skills-manager add`. They touch neither the disk
 * nor the network; the CLI composes them.
 */
import { createHash } from "node:crypto";

import { assertSkillName } from "./git.mjs";

/** Keys that identify the origin of a manifest source; only one per entry. */
const SOURCE_KINDS = ["plugin", "repo", "local"];

/** Prefix of paths relative to the marketplace repo. */
const RELATIVE_PREFIX = "./";

/** Prefix of the hash written in the lock. */
const HASH_PREFIX = "sha256-";

/** Separator between fields when hashing, so path and bytes cannot be confused. */
const HASH_SEPARATOR = "\0";

/** Mark added to the hash of an executable file, so losing the bit changes the hash. */
const HASH_EXECUTABLE = "+x";

/** Folder in `~/.claude/skills` synced by another tool: not a skill. */
const SYNCED_DIR = "synced";

/** Preferred scope when a plugin is installed several times. */
const USER_SCOPE = "user";

/** Separator between sources in `--select` and between numbers in the interactive answer. */
const LIST_SEPARATOR = ",";

/** Separator between a source and its individual skills. */
const SKILLS_SEPARATOR = ":";

/** Separator between individual skills in `--select`. */
const SELECT_SKILL_SEPARATOR = "+";

/** Separates the plugin name from its marketplace in an id (`superpowers@claude-plugins-official`). */
const PLUGIN_ID_SEPARATOR = "@";

/** Keys allowed in the manifest's `paths`. */
const PATH_KEYS = ["lock", "skillsDir", "settings"];

/**
 * Validates the optional `paths` and `sessionStart` fields of the manifest.
 *
 * @param manifest - Parsed manifest.
 * @throws {Error} If `paths` is not an object with only known string keys, or
 * `sessionStart` is not a list of valid skill names.
 */
function assertOptionalFields(manifest) {
  const { paths, sessionStart } = manifest;
  if (paths !== undefined) {
    if (paths === null || typeof paths !== "object" || Array.isArray(paths)) {
      throw new Error('"paths" must be an object.');
    }
    for (const [key, value] of Object.entries(paths)) {
      if (!PATH_KEYS.includes(key)) {
        throw new Error(`Unknown key "${key}" in "paths"; allowed: ${PATH_KEYS.join(", ")}`);
      }
      if (typeof value !== "string") {
        throw new Error(`"paths.${key}" must be a string.`);
      }
    }
  }
  if (sessionStart !== undefined) {
    if (!Array.isArray(sessionStart)) {
      throw new Error('"sessionStart" must be a list of skill names.');
    }
    sessionStart.forEach(assertSkillName);
  }
}

/**
 * Validates the skills manifest: each source must carry exactly one of
 * `plugin`, `repo` or `local`; `paths` and `sessionStart`, if present, must be valid.
 *
 * @param text - JSON content of the manifest.
 * @returns The parsed manifest.
 * @throws {Error} If the JSON has no `sources` or an entry breaks the rule;
 * the message includes the invalid entry.
 * @example
 * parseManifest('{"sources":[{"local":"x"}]}');
 * // { sources: [{ local: "x" }] }
 */
export function parseManifest(text) {
  const manifest = JSON.parse(text);
  if (!Array.isArray(manifest?.sources)) {
    throw new Error('The manifest needs a "sources" list.');
  }
  for (const entry of manifest.sources) {
    const kinds = SOURCE_KINDS.filter((kind) => entry?.[kind] !== undefined);
    if (kinds.length !== 1) {
      throw new Error(
        `Each source takes exactly one of ${SOURCE_KINDS.join(", ")}: ${JSON.stringify(entry)}`,
      );
    }
  }
  assertOptionalFields(manifest);
  return manifest;
}

/**
 * Translates a plugin entry in `marketplace.json` into where to download it.
 *
 * @param entry - Plugin entry in the marketplace.
 * @param marketplaceRepo - Marketplace repo URL, for relative paths.
 * @returns Repo, optional ref and sha, and the plugin path inside the repo.
 * @throws {Error} If the `source` type is unknown.
 * @example
 * resolvePluginSource({ name: "x", source: "./plugins/x" }, "https://h/m.git");
 * // { repo: "https://h/m.git", path: "plugins/x" }
 */
export function resolvePluginSource(entry, marketplaceRepo) {
  const { source } = entry;
  if (typeof source === "string" && source.startsWith(RELATIVE_PREFIX)) {
    return { repo: marketplaceRepo, path: source.slice(RELATIVE_PREFIX.length) };
  }
  if (source?.source === "url") {
    return { repo: source.url, ref: source.ref, sha: source.sha, path: "." };
  }
  if (source?.source === "github") {
    return {
      repo: `https://github.com/${source.repo}.git`,
      ref: source.ref,
      sha: source.sha,
      path: ".",
    };
  }
  throw new Error(`Unknown source type in plugin ${entry.name}: ${JSON.stringify(source)}`);
}

/**
 * Escapes a text so it can be used literally inside a regular expression.
 *
 * @param text - Text to escape.
 * @returns The text with metacharacters escaped.
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces `<plugin>:<skill>` with `<skill>` when the skill was installed
 * without a prefix. It leaves other plugins alone, as well as matches stuck to
 * `/`, `:`, `.` or a longer name (URLs and schemes like `superpowers://`).
 *
 * @param text - Content of a skill file.
 * @param plugin - Name of the source plugin.
 * @param installed - Names of the installed skills.
 * @returns The text with its own references unprefixed.
 * @example
 * rewritePluginRefs("use p:a and q:a", "p", new Set(["a"]));
 * // "use a and q:a"
 */
export function rewritePluginRefs(text, plugin, installed) {
  const pattern = new RegExp(`(?<![\\w/:.-])${escapeRegExp(plugin)}:([\\w-]+)`, "g");
  return text.replace(pattern, (match, skill) => (installed.has(skill) ? skill : match));
}

/**
 * Finds skill names that would clash on install: repeated across origins or
 * equal to one of the repo's own skills.
 *
 * @param incoming - Skill name to its origin; if several origins bring it,
 * the value is the list of origins.
 * @param own - Names of the repo's own skills.
 * @returns One message per collision, saying what to exclude in the manifest.
 * @example
 * findCollisions(new Map([["a", ["x", "y"]]]), new Set());
 * // ['"a" comes from x, y: exclude "a" in the manifest of one of the origins']
 */
export function findCollisions(incoming, own) {
  const messages = [];
  for (const [name, origin] of incoming) {
    const origins = [origin].flat();
    if (own.has(name)) {
      messages.push(`"${name}" (from ${origins.join(", ")}) already exists as an own skill: exclude "${name}" in the manifest`);
    } else if (new Set(origins).size > 1) {
      messages.push(`"${name}" comes from ${origins.join(", ")}: exclude "${name}" in the manifest of one of the origins`);
    }
  }
  return messages;
}

/**
 * Computes the hash of a skill's installed content: sorted relative paths plus
 * their bytes and, for executables, a mark, regardless of input order. A
 * non-executable file hashes the same as before the mark existed, so old locks
 * stay valid.
 *
 * @param files - Files with their relative path, content and optional `executable`.
 * @returns `sha256-<hex>`.
 * @example
 * hashFiles([{ path: "SKILL.md", content: Buffer.from("x") }]);
 * // "sha256-…"
 */
export function hashFiles(files) {
  const hash = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    hash.update(file.path).update(HASH_SEPARATOR).update(file.content).update(HASH_SEPARATOR);
    if (file.executable === true) {
      hash.update(HASH_EXECUTABLE).update(HASH_SEPARATOR);
    }
  }
  return `${HASH_PREFIX}${hash.digest("hex")}`;
}

/**
 * Compares the lock with the skills on disk.
 *
 * @param lock - Lock content (`{ skills: { name: { hash } } }`).
 * @param actual - Installed skill name to its current hash.
 * @returns Those missing on disk, those with a different hash and those the lock does not know.
 * @example
 * diffLock({ skills: { a: { hash: "h" } } }, new Map([["b", "h"]]));
 * // { missing: ["a"], modified: [], extra: ["b"] }
 */
export function diffLock(lock, actual) {
  const locked = lock.skills ?? {};
  const missing = Object.keys(locked).filter((name) => !actual.has(name));
  const modified = Object.keys(locked).filter(
    (name) => actual.has(name) && actual.get(name) !== locked[name].hash,
  );
  const extra = [...actual.keys()].filter((name) => !Object.hasOwn(locked, name));
  return { missing, modified, extra };
}

/**
 * Picks, among a plugin's installs, one whose folder exists, preferring the
 * `user` scope.
 *
 * @param entries - Plugin entries in `installed_plugins.json`.
 * @param skillDirs - Installed folder to its skills; only holds those that exist.
 * @returns The chosen entry, or `undefined` if none is on disk.
 */
function pickInstall(entries, skillDirs) {
  const present = [entries].flat().filter((entry) => skillDirs.has(entry?.installPath));
  return present.find((entry) => entry.scope === USER_SCOPE) ?? present[0];
}

/**
 * Builds the candidate of an installed plugin, with a note if it cannot be picked.
 *
 * @param id - `plugin@marketplace`.
 * @param entries - Its entries in `installed_plugins.json`.
 * @param machine - What was read from the machine (see `listCandidates`).
 * @returns The candidate.
 */
function pluginCandidate(id, entries, { skillDirs, marketplaces }) {
  const marketplace = id.split("@")[1];
  const install = pickInstall(entries, skillDirs);
  const skills = install === undefined ? [] : (skillDirs.get(install.installPath) ?? []);
  const candidate = { id, kind: "plugin", skills: [...skills] };
  if (!marketplaces.has(marketplace)) {
    return { ...candidate, note: `could not read marketplace ${marketplace}` };
  }
  if (install === undefined) {
    return { ...candidate, note: "not on disk" };
  }
  return skills.length === 0 ? { ...candidate, note: "no skills" } : candidate;
}

/**
 * Lists what can be added to the manifest from what is installed on the machine:
 * each plugin in `installed_plugins.json` with its skills and each skill in
 * `~/.claude/skills`. What is already in the manifest does not appear.
 *
 * @param machine - What was read from the machine: `installed` (the JSON of
 * `installed_plugins.json` or `undefined`), `skillDirs` (existing installed
 * folder to its skills, or `null` if it has no `skills/`), `local` (folders in
 * `~/.claude/skills` with `SKILL.md`) and `marketplaces` (names that could be read).
 * @param manifest - Current manifest, or `undefined` if there is none.
 * @returns Candidates `{ id, kind, skills, note? }`: plugins first, then locals; those with `note` cannot be picked.
 * @example
 * listCandidates({ installed: undefined, skillDirs: new Map(), local: ["x"], marketplaces: new Set() }, undefined);
 * // [{ id: "x", kind: "local", skills: ["x"] }]
 */
export function listCandidates(machine, manifest) {
  const sources = manifest?.sources ?? [];
  const taken = new Set(sources.map((entry) => entry.plugin ?? entry.local));
  const plugins = Object.entries(machine.installed?.plugins ?? {}).map(([id, entries]) => pluginCandidate(id, entries, machine));
  const local = [...machine.local]
    .filter((name) => name !== SYNCED_DIR && !name.startsWith("."))
    .sort()
    .map((name) => ({ id: name, kind: "local", skills: [name] }));
  return [...plugins, ...local].filter((candidate) => !taken.has(candidate.id));
}

/**
 * Reads the `--select` value: sources separated by commas and, to pick
 * individual skills of a plugin, `plugin@mkt:skill1+skill2`.
 *
 * @param text - `--select` value.
 * @returns Picks `{ id, skills? }`.
 * @example
 * parseSelect("a@m:x+y,local");
 * // [{ id: "a@m", skills: ["x", "y"] }, { id: "local" }]
 */
export function parseSelect(text) {
  return text
    .split(LIST_SEPARATOR)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [id, skills] = token.split(SKILLS_SEPARATOR);
      return skills === undefined ? { id } : { id, skills: skills.split(SELECT_SKILL_SEPARATOR).filter(Boolean) };
    });
}

/**
 * Short name of a candidate: the plugin without its marketplace, or the local skill.
 *
 * @param id - Candidate id.
 * @returns The name before `@`.
 */
function shortName(id) {
  return id.split(PLUGIN_ID_SEPARATOR)[0];
}

/**
 * Builds the options of the interactive menu: one short line per pickable
 * candidate (name and how many skills it brings, all in the label so it shows
 * on every row and not only on the cursor's) and, apart, those that cannot be
 * picked, to show them on a single line at the bottom. If two plugins share a
 * name in different marketplaces, the marketplace goes in parentheses.
 *
 * @param candidates - What `listCandidates` returns.
 * @returns `{ options: [{ value, label }], hidden: string[] }`.
 * @example
 * menuOptions([{ id: "superpowers@m", kind: "plugin", skills: ["a", "b"] }]);
 * // { options: [{ value: "superpowers@m", label: "superpowers · 2 skills" }], hidden: [] }
 */
export function menuOptions(candidates) {
  const names = candidates.map((candidate) => shortName(candidate.id));
  const repeated = new Set(names.filter((name, index) => names.indexOf(name) !== index));
  const options = [];
  const hidden = [];
  for (const candidate of candidates) {
    const name = shortName(candidate.id);
    const label = repeated.has(name) ? `${name} (${candidate.id.split(PLUGIN_ID_SEPARATOR)[1]})` : name;
    if (candidate.note !== undefined) {
      hidden.push(`${label} (${candidate.note})`);
      continue;
    }
    const count = candidate.skills.length;
    const detail = candidate.kind === "local" ? "yours" : `${count} ${count === 1 ? "skill" : "skills"}`;
    options.push({ value: candidate.id, label: `${label} · ${detail}` });
  }
  return { options, hidden };
}

/**
 * Summarizes the picks, one line per candidate, to confirm before installing.
 *
 * @param picks - Picks `{ id, skills? }`.
 * @param candidates - What `listCandidates` returns.
 * @returns The lines joined with newlines.
 * @example
 * pickSummary([{ id: "superpowers@m" }], [{ id: "superpowers@m", kind: "plugin", skills: ["a"] }]);
 * // "superpowers (all, 1)"
 */
export function pickSummary(picks, candidates) {
  return picks
    .map((pick) => {
      const candidate = candidates.find((option) => option.id === pick.id);
      const name = shortName(pick.id);
      if (candidate?.kind === "local") {
        return `${name} (yours)`;
      }
      if (pick.skills?.length > 0) {
        return `${name}: ${pick.skills.join(", ")}`;
      }
      return `${name} (all, ${candidate?.skills.length ?? 0})`;
    })
    .join("\n");
}

/**
 * Translates the picks into manifest sources, validating against the candidates.
 *
 * @param picks - Picks `{ id, skills? }`; if one repeats, the last one wins.
 * @param candidates - What `listCandidates` returns.
 * @returns Sources `{ plugin, skills? }` or `{ local }`.
 * @throws {Error} If nothing was picked, or something is missing, has a note or asks for a skill it does not provide.
 * @example
 * picksToSources([{ id: "x" }], [{ id: "x", kind: "local", skills: ["x"] }]);
 * // [{ local: "x" }]
 */
export function picksToSources(picks, candidates) {
  if (picks.length === 0) {
    throw new Error("You picked nothing.");
  }
  const unique = [...new Map(picks.map((pick) => [pick.id, pick])).values()];
  const sources = [];
  for (const pick of unique) {
    const candidate = candidates.find((option) => option.id === pick.id);
    if (candidate === undefined) {
      throw new Error(`"${pick.id}" is not among the candidates (see --candidates).`);
    }
    if (candidate.note !== undefined) {
      throw new Error(`"${pick.id}" cannot be picked: ${candidate.note}.`);
    }
    const unknown = (pick.skills ?? []).filter((skill) => !candidate.skills.includes(skill));
    if (unknown.length > 0) {
      throw new Error(`"${pick.id}" does not provide ${unknown.join(", ")}; it provides ${candidate.skills.join(", ")}.`);
    }
    if (candidate.kind === "local") {
      sources.push({ local: candidate.id });
    } else {
      sources.push(pick.skills?.length > 0 ? { plugin: candidate.id, skills: pick.skills } : { plugin: candidate.id });
    }
  }
  return sources;
}
