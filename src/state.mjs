/**
 * @file Estado de las skills de terceros en el repo y en la máquina: rutas del
 * manifiesto, el lock y las carpetas de skills; lectura y escritura del
 * manifiesto, lectura del lock, hash de lo instalado, a qué fuente pertenece
 * cada skill del lock y los marketplaces de `~/.claude/plugins`. Lo comparten
 * `cli.mjs` (install, update, check, list) y `pick.mjs` (init, add).
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { assertSkillName, walk } from "./git.mjs";
import { hashFiles, parseManifest } from "./lib.mjs";

/** Manifiesto de skills de terceros, relativo a la raíz del repo. */
export const MANIFEST = ".agents/skills.json";

/** Lock que escriben solo estos comandos, relativo a la raíz del repo. */
export const LOCK = ".agents/skills.lock.json";

/** Carpeta donde se instalan las skills, propias y de terceros. */
export const SKILLS_DIR = ".agents/skills";

/** Archivo que marca una carpeta como skill. */
export const SKILL_FILE = "SKILL.md";

/** Carpeta de las skills sueltas de la máquina, relativa al home. */
export const LOCAL_SKILLS = ".claude/skills";

/** Carpeta de plugins y marketplaces de Claude Code, relativa al home. */
export const PLUGINS_DIR = ".claude/plugins";

/** Valor de `source` en el lock para las skills copiadas de la máquina. */
export const LOCAL_SOURCE = "local";

/**
 * Lee un JSON del disco.
 *
 * @param file - Ruta del archivo.
 * @returns El contenido parseado.
 * @throws {Error} Si no se puede leer o no es JSON.
 */
export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * Dice si una ruta es un archivo común (no symlink).
 *
 * @param file - Ruta a mirar.
 * @returns `true` si existe y es un archivo regular.
 */
export function isRegularFile(file) {
  return existsSync(file) && lstatSync(file).isFile();
}

/**
 * Lee un JSON que puede faltar o estar roto, sin cortar.
 *
 * @param file - Ruta del archivo.
 * @returns El contenido parseado, o `undefined` si no está o no se puede leer.
 */
function readJsonIfValid(file) {
  try {
    return existsSync(file) ? readJson(file) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lee los marketplaces instalados en la máquina, con su repo y sus plugins. Un
 * marketplace que no se puede leer no aparece; el resto sigue.
 *
 * @param home - Home donde está `.claude/plugins`.
 * @returns Nombre del marketplace a `{ repo, plugins }`; vacío si no hay ninguno.
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
 * Clave con la que una fuente del manifiesto figura en el lock.
 *
 * @param entry - Fuente del manifiesto.
 * @returns `plugin@marketplace`, `local` o `repo/path`.
 */
export function sourceKey(entry) {
  if (entry.local !== undefined) {
    return LOCAL_SOURCE;
  }
  return entry.plugin ?? `${entry.repo}/${entry.path}`;
}

/**
 * Nombre de una fuente para los mensajes: distingue una local de otra.
 *
 * @param entry - Fuente del manifiesto.
 * @returns `local:<nombre>` o la clave del lock.
 */
export function sourceLabel(entry) {
  return entry.local === undefined ? sourceKey(entry) : `${LOCAL_SOURCE}:${entry.local}`;
}

/**
 * Nombres del lock que vienen de una fuente; una local solo es dueña de la skill con su nombre.
 *
 * @param lock - Lock leído.
 * @param entry - Fuente del manifiesto.
 * @returns Los nombres, en el orden del lock.
 */
export function lockedNames(lock, entry) {
  const key = sourceKey(entry);
  return Object.keys(lock.skills).filter(
    (name) => lock.skills[name].source === key && (entry.local === undefined || name === entry.local),
  );
}

/**
 * Skills del lock que ya no pertenecen a ninguna fuente del manifiesto.
 *
 * @param lock - Lock leído.
 * @param manifest - Manifiesto leído.
 * @returns Los nombres, en el orden del lock.
 */
export function staleNames(lock, manifest) {
  const owned = new Set(manifest.sources.flatMap((entry) => lockedNames(lock, entry)));
  return Object.keys(lock.skills).filter((name) => !owned.has(name));
}

/**
 * Dice si dos listas tienen los mismos elementos, sin importar el orden.
 *
 * @param a - Primera lista.
 * @param b - Segunda lista.
 * @returns `true` si coinciden como conjuntos.
 */
export function sameSet(a, b) {
  return JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
}

/**
 * Plugins que pide el manifiesto, en su orden.
 *
 * @param manifest - Manifiesto leído.
 * @returns Las claves `plugin@marketplace`.
 */
export function manifestPlugins(manifest) {
  return manifest.sources.filter((entry) => entry.plugin !== undefined).map((entry) => entry.plugin);
}

/**
 * Hash del contenido instalado de una skill, o `undefined` si no está.
 *
 * @param root - Raíz del repo.
 * @param name - Nombre de la skill.
 * @returns `sha256-<hex>` o `undefined`.
 */
export function installedHash(root, name) {
  const dir = path.join(root, SKILLS_DIR, name);
  return existsSync(dir) ? hashFiles(walk(dir)) : undefined;
}

/**
 * Lee el lock, o uno vacío si todavía no existe.
 *
 * @param root - Raíz del repo.
 * @returns `{ skills, plugins }`.
 * @throws {Error} Si algún nombre de skill no es válido.
 */
export function readLock(root) {
  const file = path.join(root, LOCK);
  const lock = existsSync(file) ? readJson(file) : {};
  const skills = lock.skills ?? {};
  Object.keys(skills).forEach(assertSkillName);
  return { skills, plugins: lock.plugins ?? [] };
}

/**
 * Lee y valida el manifiesto, o `undefined` si no hay.
 *
 * @param root - Raíz del repo.
 * @returns El manifiesto parseado o `undefined`.
 * @throws {Error} Si no es un manifiesto válido.
 */
export function readManifest(root) {
  const file = path.join(root, MANIFEST);
  return existsSync(file) ? parseManifest(readFileSync(file, "utf8")) : undefined;
}

/**
 * Escribe el manifiesto con formato estable.
 *
 * @param root - Raíz del repo.
 * @param manifest - Manifiesto a escribir; se valida antes.
 * @throws {Error} Si no es un manifiesto válido.
 */
export function writeManifest(root, manifest) {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  parseManifest(text);
  const file = path.join(root, MANIFEST);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Configuración de Claude Code del proyecto, relativa a la raíz del repo. */
export const PROJECT_SETTINGS = ".claude/settings.json";

/**
 * Deja desactivados en el proyecto los plugins de los que se copiaron skills, para
 * que no aparezcan dos veces (la copia del repo y la del plugin con prefijo). Solo
 * administra las claves de `enabledPlugins` que son suyas: pone `false` a cada
 * plugin del lock nuevo y saca el `false` de los que estaban en el lock anterior y
 * ya no están. Lo que puso otra persona (un `true`, un plugin que nunca estuvo en
 * el lock) no se toca, y el resto del archivo (hooks, etc.) queda igual.
 *
 * @param root - Raíz del repo.
 * @param previous - Plugins del lock anterior (los que la herramienta ya administraba).
 * @param plugins - Plugins del lock nuevo.
 * @returns `true` si se escribió el archivo.
 * @throws {Error} Si `.claude/settings.json` existe pero no es un JSON de objeto.
 */
export function syncProjectSettings(root, previous, plugins) {
  const file = path.join(root, PROJECT_SETTINGS);
  const settings = existsSync(file) ? readJson(file) : {};
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${PROJECT_SETTINGS} tiene que ser un objeto JSON.`);
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
