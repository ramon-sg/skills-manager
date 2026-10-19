/**
 * @file `skills:init` y `skills:add`: leen lo instalado en la máquina (plugins
 * de `~/.claude/plugins/installed_plugins.json` y skills de `~/.claude/skills`),
 * dejan elegir (con el menú de casillas de `prompt.mjs` si hay TTY, o con
 * `--candidates` / `--select`), suman la elección al manifiesto y corren
 * `install`. Si `install` falla, el manifiesto vuelve a como estaba.
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

/** Opción que imprime los candidatos en JSON. */
const CANDIDATES_FLAG = "--candidates";

/** Opción que elige sin preguntar. */
const SELECT_FLAG = "--select";

/** Código de salida de un error de uso. */
const USAGE_EXIT = 2;

/** Cómo se usa sin TTY. */
const USAGE = `Sin terminal interactiva usá ${CANDIDATES_FLAG} para ver qué hay, o ${SELECT_FLAG} plugin@marketplace,skill-local (plugin@marketplace:skill1+skill2 para skills sueltas).`;

/**
 * Arma un error de uso, que termina el CLI con 2.
 *
 * @param message - Qué faltó.
 * @returns El error con `exitCode`.
 */
function usageError(message) {
  return Object.assign(new Error(message), { exitCode: USAGE_EXIT });
}

/**
 * Lista las carpetas de skill (con `SKILL.md`) de un directorio.
 *
 * @param dir - Directorio a mirar.
 * @returns Los nombres ordenados, o `null` si el directorio no existe.
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
 * Lee de la máquina lo que necesita `listCandidates`.
 *
 * @param home - Home de la máquina.
 * @returns `{ installed, skillDirs, local, marketplaces }`.
 * @throws {Error} Si `installed_plugins.json` existe pero no es JSON.
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
 * Decide qué se eligió: por `--select`, o preguntando si hay TTY.
 *
 * @param args - Argumentos del subcomando.
 * @param candidates - Lo que devuelve `listCandidates`.
 * @returns Lo elegido.
 * @throws {Error} De uso (sale con 2) si no hay TTY ni `--select`, o `--select` no trae valor.
 */
async function choose(args, candidates) {
  const inline = args.find((arg) => arg.startsWith(`${SELECT_FLAG}=`));
  const index = args.indexOf(SELECT_FLAG);
  const value = inline?.slice(SELECT_FLAG.length + 1) ?? (index === -1 ? undefined : args[index + 1]);
  if (index !== -1 && (value === undefined || value.startsWith("--"))) {
    throw usageError(`${SELECT_FLAG} necesita un valor. ${USAGE}`);
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
 * Corre `init` o `add`: elige de lo instalado, lo suma al manifiesto e instala.
 *
 * @param root - Raíz del repo.
 * @param opts - `{ init, args, home, install }`; `install` corre la instalación.
 * @throws {Error} Si `init` encuentra un manifiesto, `add` no lo encuentra, la
 * elección no es válida o falla la instalación (con el manifiesto ya restaurado).
 */
export async function commandPick(root, { init, args, home, install }) {
  const file = path.join(root, MANIFEST);
  if (init && existsSync(file)) {
    throw new Error(`${MANIFEST} ya existe; usá skills:add`);
  }
  const manifest = readManifest(root);
  if (!init && manifest === undefined) {
    throw new Error(`No hay ${MANIFEST}; empezá con skills:init`);
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
