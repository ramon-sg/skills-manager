/**
 * @file `skills-manager init` and `skills-manager add`: read what is installed on the
 * machine (plugins from `~/.claude/plugins/installed_plugins.json` and skills
 * from `~/.claude/skills`), let the user pick (with the checkbox menu of
 * `prompt.mjs` if there is a TTY, or with `--candidates` / `--select`), add the
 * pick to the manifest and run `install`. If `install` fails, the manifest goes
 * back to how it was.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { listCandidates, parseSelect, picksToSources } from "./lib.mjs";
import { askInteractively } from "./prompt.mjs";
import {
  LOCAL_SKILLS,
  loadMarketplaces,
  MANIFEST,
  PLUGINS_DIR,
  readJson,
  readManifest,
  SKILL_FILE,
  writeManifest,
} from "./state.mjs";

/** Option that prints the candidates as JSON. */
const CANDIDATES_FLAG = "--candidates";

/** Option that picks without asking. */
const SELECT_FLAG = "--select";

/** Exit code of a usage error. */
const USAGE_EXIT = 2;

/** How to use it without a TTY. */
const USAGE = `Without an interactive terminal use ${CANDIDATES_FLAG} to see what is available, or ${SELECT_FLAG} plugin@marketplace,local-skill (plugin@marketplace:skill1+skill2 for individual skills).`;

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
 * Runs `init` or `add`: picks from what is installed, adds it to the manifest and installs.
 *
 * @param root - Repo root.
 * @param opts - `{ init, args, home, install }`; `install` runs the installation.
 * @throws {Error} If `init` finds a manifest, `add` does not find one, the
 * pick is not valid or the installation fails (with the manifest already restored).
 */
export async function commandPick(root, { init, args, home, install }) {
  const file = path.join(root, MANIFEST);
  if (init && existsSync(file)) {
    throw new Error(`${MANIFEST} already exists; use skills-manager add`);
  }
  const manifest = readManifest(root);
  if (!init && manifest === undefined) {
    throw new Error(`No ${MANIFEST} found; start with skills-manager init`);
  }
  const candidates = listCandidates(readMachine(home), manifest);
  if (args.includes(CANDIDATES_FLAG)) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }
  const sources = picksToSources(await choose(args, candidates), candidates);
  const previous = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  writeManifest(root, { ...manifest, sources: [...(manifest?.sources ?? []), ...sources] });
  try {
    install();
  } catch (error) {
    if (previous === undefined) {
      rmSync(file, { force: true });
    } else {
      writeFileSync(file, previous);
    }
    throw error;
  }
}
