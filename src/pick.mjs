/**
 * @file `skills-manager init` and `skills-manager add`: read what is installed on the
 * machine (plugins from `~/.claude/plugins/installed_plugins.json` and skills
 * from `~/.claude/skills`) or, with `--catalog`, the skills of one or more
 * catalog repos; let the user pick (with the checkbox menu of `prompt.mjs` if
 * there is a TTY, or with `--candidates` / `--select`), add the pick to the
 * manifest and run `install`. If `install` fails, the manifest goes back to how it was.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG_PREFIX, catalogRepo, latestRelease, readCatalog, skillDescription } from "./catalog.mjs";
import { fetchSource, insideTree } from "./git.mjs";
import { listCandidates, mergeSources, parseSelect, picksToSources } from "./lib.mjs";
import { askInteractively } from "./prompt.mjs";
import {
  isRegularFile,
  LOCAL_SKILLS,
  loadMarketplaces,
  PLUGINS_DIR,
  readJson,
  readManifest,
  resolvePaths,
  SKILL_FILE,
  writeManifest,
} from "./state.mjs";

/** Option that prints the candidates as JSON. */
const CANDIDATES_FLAG = "--candidates";

/** Option that picks without asking. */
const SELECT_FLAG = "--select";

/** Option, repeatable, that offers the skills of a catalog repo instead of the machine's. */
const CATALOG_FLAG = "--catalog";

/** Separates a catalog from the branch or tag to follow in `--catalog owner/repo#v1.2.0`. */
const CATALOG_REF_SEPARATOR = "#";

/** Exit code of a usage error. */
const USAGE_EXIT = 2;

/** How to use it without a TTY. */
const USAGE = `Without an interactive terminal use ${CANDIDATES_FLAG} to see what is available, or ${SELECT_FLAG} plugin@marketplace,local-skill (plugin@marketplace:skill1+skill2 for individual skills; ${CATALOG_PREFIX}<catalog>/<skill> with ${CATALOG_FLAG}).`;

/** Name of the skill bundled with the package, which `init` copies. */
const BUNDLED_SKILL = "manage-skills";

/** Folder of the package that holds the bundled skills. */
const BUNDLED_SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));

/**
 * Builds a usage error, which ends the CLI with 2.
 *
 * @param message - What was missing.
 * @returns The error with `exitCode`.
 */
function usageError(message) {
  return Object.assign(new Error(message), { exitCode: USAGE_EXIT });
}

/**
 * Lists the skill folders (with `SKILL.md`) of a directory.
 *
 * @param dir - Directory to look at.
 * @returns The sorted names, or `null` if the directory does not exist.
 */
function skillFolders(dir) {
  if (!existsSync(dir)) {
    return null;
  }
  return readdirSync(dir)
    .filter((name) => existsSync(path.join(dir, name, SKILL_FILE)))
    .sort();
}

/**
 * Copies the bundled `manage-skills` skill into the skills folder so the agent
 * knows how to use this tool; an existing copy is the repo's own and is kept.
 *
 * @param skillsDir - Absolute skills folder of the repo.
 */
function copyBundledSkill(skillsDir) {
  const target = path.join(skillsDir, BUNDLED_SKILL);
  if (existsSync(target)) {
    return;
  }
  cpSync(path.join(BUNDLED_SKILLS_DIR, BUNDLED_SKILL), target, { recursive: true });
}

/**
 * Reads from the machine what `listCandidates` needs.
 *
 * @param home - Machine home.
 * @returns `{ installed, skillDirs, local, marketplaces }`.
 * @throws {Error} If `installed_plugins.json` exists but is not JSON.
 */
export function readMachine(home) {
  const installedFile = path.join(home, PLUGINS_DIR, "installed_plugins.json");
  const installed = existsSync(installedFile) ? readJson(installedFile) : undefined;
  const skillDirs = new Map();
  for (const entries of Object.values(installed?.plugins ?? {})) {
    for (const installPath of [entries].flat().map((entry) => entry?.installPath)) {
      if (typeof installPath === "string" && existsSync(installPath)) {
        skillDirs.set(installPath, skillFolders(path.join(installPath, "skills")));
      }
    }
  }
  const local = skillFolders(path.join(home, LOCAL_SKILLS)) ?? [];
  return { installed, skillDirs, local, marketplaces: new Set(loadMarketplaces(home).keys()) };
}

/**
 * Reads every value of a repeatable option, as `--flag value` or `--flag=value`.
 *
 * @param args - Subcommand arguments.
 * @param flag - Option name.
 * @returns The values, in order.
 * @throws {Error} Usage error if the option has no value.
 */
function flagValues(args, flag) {
  const values = [];
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith(`${flag}=`)) {
      values.push(arg.slice(flag.length + 1));
    } else if (arg === flag) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw usageError(`${flag} needs a value.`);
      }
      values.push(value);
    }
  }
  return values;
}

/**
 * Lists the skills of each catalog at its latest release, with category,
 * description and requires. Skills the manifest already takes from that
 * catalog do not appear.
 *
 * @param specs - `--catalog` values: `owner/repo`, a URL, optionally `#ref`.
 * @param manifest - Current manifest, or `undefined`.
 * @returns Candidates `{ id, kind: "catalog", catalog, ref?, name, category, description, requires, skills }`.
 * @throws {Error} If a catalog cannot be fetched or read.
 */
export function catalogCandidates(specs, manifest) {
  const temp = mkdtempSync(path.join(tmpdir(), "skills-catalog-"));
  try {
    return specs.flatMap((spec, index) => {
      const [catalog, ref] = spec.split(CATALOG_REF_SEPARATOR);
      const repo = catalogRepo(catalog);
      const tree = path.join(temp, String(index));
      fetchSource({ repo, commit: latestRelease(repo, ref || undefined).commit }, tree);
      const taken = new Set(manifest?.sources.find((entry) => entry.catalog === catalog)?.skills ?? []);
      return [...readCatalog(tree).values()]
        .filter((skill) => !taken.has(skill.name))
        .map((skill) => {
          const file = path.join(insideTree(tree, skill.path), SKILL_FILE);
          const description = isRegularFile(file) ? skillDescription(readFileSync(file, "utf8")) : "";
          const base = { id: `${CATALOG_PREFIX}${catalog}/${skill.name}`, kind: "catalog", catalog, name: skill.name, category: skill.category, description, requires: skill.requires, skills: [skill.name] };
          return ref ? { ...base, ref } : base;
        });
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * Decides what was picked: through `--select`, or by asking if there is a TTY.
 *
 * @param args - Subcommand arguments.
 * @param candidates - What `listCandidates` returns.
 * @returns What was picked.
 * @throws {Error} Usage error (exits with 2) if there is no TTY nor `--select`, or `--select` has no value.
 */
async function choose(args, candidates) {
  const inline = args.find((arg) => arg.startsWith(`${SELECT_FLAG}=`));
  const index = args.indexOf(SELECT_FLAG);
  const value = inline?.slice(SELECT_FLAG.length + 1) ?? (index === -1 ? undefined : args[index + 1]);
  if (index !== -1 && (value === undefined || value.startsWith("--"))) {
    throw usageError(`${SELECT_FLAG} needs a value. ${USAGE}`);
  }
  if (value !== undefined) {
    return parseSelect(value);
  }
  if (!process.stdin.isTTY) {
    throw usageError(USAGE);
  }
  return askInteractively(candidates);
}

/**
 * Runs `init` or `add`: picks from what is installed (or from the `--catalog`
 * repos), adds it to the manifest and installs.
 *
 * @param root - Repo root.
 * @param opts - `{ init, args, home, install }`; `install` runs the installation (it may
 * ask before replacing an own skill, so it is awaited).
 * @throws {Error} If `init` finds a manifest, `add` does not find one, the
 * pick is not valid or the installation fails (with the manifest already restored).
 */
export async function commandPick(root, { init, args, home, install }) {
  const file = resolvePaths(root).manifest;
  const shown = path.relative(root, file);
  if (init && existsSync(file)) {
    throw new Error(`${shown} already exists; use skills-manager add`);
  }
  const manifest = readManifest(root);
  if (!init && manifest === undefined) {
    throw new Error(`No ${shown} found; start with skills-manager init`);
  }
  const catalogs = flagValues(args, CATALOG_FLAG);
  const candidates = catalogs.length > 0 ? catalogCandidates(catalogs, manifest) : listCandidates(readMachine(home), manifest);
  if (args.includes(CANDIDATES_FLAG)) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }
  const sources = picksToSources(await choose(args, candidates), candidates);
  const previous = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  writeManifest(root, { ...manifest, sources: mergeSources(manifest?.sources ?? [], sources) });
  try {
    await install();
  } catch (error) {
    if (previous === undefined) {
      rmSync(file, { force: true });
    } else {
      writeFileSync(file, previous);
    }
    throw error;
  }
  if (init) {
    copyBundledSkill(resolvePaths(root, readManifest(root)).skillsDir);
  }
}
