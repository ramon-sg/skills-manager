/**
 * @file Catalog sources: a repo with a `skills-catalog.json` at its root that
 * lists its skills (name, path, category and the skills each one requires).
 * Validates the manifest entry and the catalog file, resolves the repo URL and
 * the latest release (the highest `vX.Y.Z` tag, or the HEAD of `ref`), expands
 * `requires` and reads the description of a skill from its `SKILL.md`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { assertRelPath, assertRepo, assertSha, assertSkillName, git } from "./git.mjs";

/** Prefix of a catalog source in the lock and of a catalog pick in `--select`. */
export const CATALOG_PREFIX = "catalog:";

/** File at the root of a catalog repo that lists its skills. */
export const CATALOG_FILE = "skills-catalog.json";

/** Version of the catalog format this tool reads; a catalog without it is version 1. */
export const CATALOG_VERSION = 1;

/** Category of a skill whose catalog does not give one. */
export const DEFAULT_CATEGORY = "Other";

/** GitHub `owner/repo` shorthand. */
const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

/** Release tag: `v` plus three numbers. */
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Prefix of tag refs in `git ls-remote`. */
const TAGS_REF = "refs/tags/";

/** Suffix `git ls-remote` adds to the commit an annotated tag points to. */
const PEELED_SUFFIX = "^{}";

/** Keys allowed in a catalog manifest entry. */
const ENTRY_KEYS = ["catalog", "ref", "skills"];

/** Suffix of the file an editable file is created from. */
export const TEMPLATE_SUFFIX = ".template";

/** File that defines a skill; it can never be editable. */
const SKILL_DEFINITION = "SKILL.md";

/** Longest description shown in the menu, in characters. */
const MAX_DESCRIPTION = 72;

/**
 * Validates a manifest entry of kind `catalog`.
 *
 * @param entry - Manifest source with `catalog`.
 * @throws {Error} If `catalog` is not a repo, `ref` is not text, `skills` is not
 * a non-empty list of valid names, or it has unknown keys.
 * @example
 * assertCatalogEntry({ catalog: "owner/repo", skills: ["planning"] });
 */
export function assertCatalogEntry(entry) {
  const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Unknown key "${unknown[0]}" in a catalog source; allowed: ${ENTRY_KEYS.join(", ")}`);
  }
  catalogRepo(entry.catalog);
  assertRef(entry.ref, entry.catalog);
  if (!Array.isArray(entry.skills) || entry.skills.length === 0) {
    throw new Error(`The catalog source ${entry.catalog} needs a non-empty "skills" list.`);
  }
  entry.skills.forEach(assertSkillName);
}

/**
 * Validates the optional `ref` of a manifest source.
 *
 * @param ref - Value to check; `undefined` is valid (follow HEAD or the latest release).
 * @param repo - Repo the source names, for the message.
 * @throws {Error} If it is not a non-empty text that can be taken for a git option.
 * @example
 * assertRef("v1.0.0", "owner/repo");
 */
export function assertRef(ref, repo) {
  if (ref !== undefined && (typeof ref !== "string" || ref === "" || ref.startsWith("-"))) {
    throw new Error(`"ref" of ${repo} must be a branch or tag name.`);
  }
}

/**
 * Turns the `catalog` value of a source into a repo URL git can fetch.
 *
 * @param catalog - `owner/repo` (GitHub) or an `https://` / `file://` URL.
 * @returns The repo URL.
 * @throws {Error} If it is neither.
 * @example
 * catalogRepo("ramon-sg/agent-skills");
 * // "https://github.com/ramon-sg/agent-skills.git"
 */
export function catalogRepo(catalog) {
  if (typeof catalog === "string" && GITHUB_SHORTHAND.test(catalog)) {
    return `https://github.com/${catalog}.git`;
  }
  return assertRepo(catalog);
}

/**
 * Reads the lines of `git ls-remote` as ref name to sha, keeping the commit
 * of annotated tags instead of the tag object.
 *
 * @param output - Output of `git ls-remote`.
 * @returns Ref name to full sha.
 */
function parseRefs(output) {
  const refs = new Map();
  const peeled = new Map();
  for (const line of output.split("\n").filter(Boolean)) {
    const [sha, ref] = line.split("\t");
    if (ref.endsWith(PEELED_SUFFIX)) {
      peeled.set(ref.slice(0, -PEELED_SUFFIX.length), sha);
    } else {
      refs.set(ref, sha);
    }
  }
  for (const [ref, sha] of peeled) {
    refs.set(ref, sha);
  }
  return refs;
}

/**
 * Picks the highest release tag (`vX.Y.Z`) among the refs.
 *
 * @param refs - Ref name to sha, from `parseRefs`.
 * @returns `{ tag, commit }`, or `undefined` if there is no release tag.
 * @example
 * highestRelease(new Map([["refs/tags/v1.10.0", "a"], ["refs/tags/v1.9.0", "b"]]));
 * // { tag: "v1.10.0", commit: "a" }
 */
export function highestRelease(refs) {
  let best;
  for (const [ref, commit] of refs) {
    const tag = ref.startsWith(TAGS_REF) ? ref.slice(TAGS_REF.length) : "";
    const parts = RELEASE_TAG.exec(tag);
    if (parts === null) {
      continue;
    }
    const numbers = parts.slice(1).map(Number);
    if (best === undefined || compareVersions(numbers, best.numbers) > 0) {
      best = { tag, commit, numbers };
    }
  }
  return best === undefined ? undefined : { tag: best.tag, commit: best.commit };
}

/**
 * Compares two versions given as `[major, minor, patch]`.
 *
 * @param a - First version.
 * @param b - Second version.
 * @returns A positive number if `a` is newer, negative if older, 0 if equal.
 */
function compareVersions(a, b) {
  const index = a.findIndex((value, position) => value !== b[position]);
  return index === -1 ? 0 : a[index] - b[index];
}

/**
 * Latest release of a catalog: with `ref`, the commit of the tag or branch with
 * exactly that name (and the tag, if it is one); without it, the highest `vX.Y.Z` tag, or HEAD if the
 * repo has no release tags.
 *
 * @param repo - Repo URL, from `catalogRepo`.
 * @param ref - Optional branch or tag to follow.
 * @returns `{ commit, tag? }`.
 * @throws {Error} If the repo cannot be read or has no tag or branch named `ref`.
 * @example
 * latestRelease("https://github.com/o/r.git");
 * // { tag: "v1.2.0", commit: "…" }
 */
export function latestRelease(repo, ref) {
  const url = assertRepo(repo);
  if (ref !== undefined) {
    const refs = parseRefs(git(["ls-remote", "--", url, ref, `${ref}${PEELED_SUFFIX}`]));
    const tagRef = `${TAGS_REF}${ref}`;
    const found = refs.get(tagRef) ?? refs.get(`refs/heads/${ref}`);
    if (found === undefined) {
      throw new Error(`${repo} has no ${ref}.`);
    }
    return refs.has(tagRef) ? { tag: ref, commit: assertSha(found) } : { commit: assertSha(found) };
  }
  const release = highestRelease(parseRefs(git(["ls-remote", "--tags", "--", url])));
  if (release !== undefined) {
    return { tag: release.tag, commit: assertSha(release.commit) };
  }
  const [line] = git(["ls-remote", "--", url, "HEAD"]).split("\n");
  if (!line) {
    throw new Error(`${repo} has no HEAD.`);
  }
  return { commit: assertSha(line.split("\t")[0]) };
}

/**
 * Validates one skill of a catalog file.
 *
 * @param skill - Entry of the `skills` list.
 * @returns `{ name, path, category, requires, editable }`, with defaults filled in.
 * @throws {Error} If the name or path are not valid, `requires` is not a list of
 * names, or `editable` is not a list of relative paths other than `SKILL.md`.
 */
function catalogSkill(skill) {
  if (skill === null || typeof skill !== "object") {
    throw new Error(`Each skill of ${CATALOG_FILE} must be an object: ${JSON.stringify(skill)}`);
  }
  const name = assertSkillName(skill.name);
  const requires = skill.requires ?? [];
  if (!Array.isArray(requires)) {
    throw new Error(`"requires" of ${name} must be a list.`);
  }
  requires.forEach(assertSkillName);
  const editable = skill.editable ?? [];
  if (!Array.isArray(editable)) {
    throw new Error(`"editable" of ${name} must be a list.`);
  }
  const files = editable.map(assertRelPath);
  if (files.includes(SKILL_DEFINITION)) {
    throw new Error(`"editable" of ${name} cannot include ${SKILL_DEFINITION}.`);
  }
  const category = typeof skill.category === "string" && skill.category !== "" ? skill.category : DEFAULT_CATEGORY;
  return { name, path: assertRelPath(skill.path), category, requires, editable: files };
}

/**
 * Reads and validates `skills-catalog.json` from a catalog checkout.
 *
 * @param tree - Catalog checkout.
 * @returns Skill name to `{ name, path, category, requires, editable }`.
 * @throws {Error} If the file is missing or invalid, its `catalogVersion` is
 * newer than this tool's, a name repeats or a `requires` names a skill the
 * catalog does not have.
 */
export function readCatalog(tree) {
  const file = path.join(tree, CATALOG_FILE);
  if (!existsSync(file)) {
    throw new Error(`The repo has no ${CATALOG_FILE}.`);
  }
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  const version = catalog.catalogVersion ?? CATALOG_VERSION;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${CATALOG_FILE} has an invalid catalogVersion: ${version}.`);
  }
  if (version > CATALOG_VERSION) {
    throw new Error(`${CATALOG_FILE} uses catalogVersion ${version}; upgrade @ramon-sg/skills-manager.`);
  }
  if (!Array.isArray(catalog.skills)) {
    throw new Error(`${CATALOG_FILE} needs a "skills" list.`);
  }
  const skills = new Map();
  for (const skill of catalog.skills.map(catalogSkill)) {
    if (skills.has(skill.name)) {
      throw new Error(`${CATALOG_FILE} lists "${skill.name}" twice.`);
    }
    skills.set(skill.name, skill);
  }
  for (const skill of skills.values()) {
    const missing = skill.requires.find((name) => !skills.has(name));
    if (missing !== undefined) {
      throw new Error(`"${skill.name}" requires "${missing}", which is not in ${CATALOG_FILE}.`);
    }
  }
  return skills;
}

/**
 * Expands a list of skills with everything they require, transitively.
 *
 * @param names - Skills asked for.
 * @param requiresOf - Returns the skills a given one requires.
 * @returns The names asked for, then their requirements, without repeats.
 * @example
 * withRequires(["planning"], (name) => (name === "planning" ? ["narrative-summary"] : []));
 * // ["planning", "narrative-summary"]
 */
export function withRequires(names, requiresOf) {
  const result = [];
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.shift();
    if (result.includes(name)) {
      continue;
    }
    result.push(name);
    queue.push(...requiresOf(name));
  }
  return result;
}

/**
 * Reads the `description` of a `SKILL.md` frontmatter as one short line: the
 * first sentence, cut to fit a menu row.
 *
 * @param text - Content of `SKILL.md`.
 * @returns The description, or `""` if it has none.
 * @example
 * skillDescription("---\nname: a\ndescription: Plans a change. Use when…\n---\n");
 * // "Plans a change."
 */
export function skillDescription(text) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r/g, ""))?.[1] ?? "";
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((line) => line.startsWith("description:"));
  if (start === -1) {
    return "";
  }
  const inline = lines[start].slice("description:".length).trim().replace(/^[|>][-+]?$/, "");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !/^\s/.test(line));
  const block = end === -1 ? rest : rest.slice(0, end);
  const joined = [inline, ...block.map((line) => line.trim())].filter(Boolean).join(" ").replace(/^["']|["']$/g, "");
  const sentence = /^.*?[.!?](?=\s|$)/.exec(joined)?.[0] ?? joined;
  return sentence.length > MAX_DESCRIPTION ? `${sentence.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : sentence;
}
