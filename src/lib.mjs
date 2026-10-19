/**
 * @file Funciones puras del manejo de skills de terceros: validación del
 * manifiesto (`.agents/skills.json`), resolución de plugins del marketplace,
 * reescritura de referencias `plugin:skill`, colisiones de nombres, hash del
 * contenido instalado, deriva contra el lock (`.agents/skills.lock.json`), y
 * candidatos y elección de `skills:init` / `skills:add`. No tocan el disco ni
 * la red; el CLI las compone.
 */
import { createHash } from "node:crypto";

/** Claves que identifican el origen de una fuente del manifiesto; solo una por entrada. */
const SOURCE_KINDS = ["plugin", "repo", "local"];

/** Prefijo de las rutas relativas al repo del marketplace. */
const RELATIVE_PREFIX = "./";

/** Prefijo del hash que se escribe en el lock. */
const HASH_PREFIX = "sha256-";

/** Separador entre campos al hashear, para que ruta y bytes no se confundan. */
const HASH_SEPARATOR = "\0";

/** Marca que se suma al hash de un archivo ejecutable, para que perder el bit cambie el hash. */
const HASH_EXECUTABLE = "+x";

/** Carpeta de `~/.claude/skills` que sincroniza otra herramienta: no es una skill. */
const SYNCED_DIR = "synced";

/** Scope preferido cuando un plugin está instalado varias veces. */
const USER_SCOPE = "user";

/** Separador entre fuentes en `--select` y entre números en la respuesta interactiva. */
const LIST_SEPARATOR = ",";

/** Separador entre una fuente y sus skills sueltas. */
const SKILLS_SEPARATOR = ":";

/** Separador entre skills sueltas en `--select`. */
const SELECT_SKILL_SEPARATOR = "+";

/** Separa el nombre del plugin de su marketplace en un id (`superpowers@claude-plugins-official`). */
const PLUGIN_ID_SEPARATOR = "@";

/**
 * Valida el manifiesto de skills: cada fuente debe traer exactamente una de
 * `plugin`, `repo` o `local`.
 *
 * @param text - Contenido JSON del manifiesto.
 * @returns El manifiesto ya parseado.
 * @throws {Error} Si el JSON no tiene `sources` o una entrada no cumple la regla;
 * el mensaje incluye la entrada inválida.
 * @example
 * parseManifest('{"sources":[{"local":"x"}]}');
 * // { sources: [{ local: "x" }] }
 */
export function parseManifest(text) {
  const manifest = JSON.parse(text);
  if (!Array.isArray(manifest?.sources)) {
    throw new Error('El manifiesto necesita una lista "sources".');
  }
  for (const entry of manifest.sources) {
    const kinds = SOURCE_KINDS.filter((kind) => entry?.[kind] !== undefined);
    if (kinds.length !== 1) {
      throw new Error(
        `Cada fuente lleva exactamente una de ${SOURCE_KINDS.join(", ")}: ${JSON.stringify(entry)}`,
      );
    }
  }
  return manifest;
}

/**
 * Traduce la entrada de un plugin en `marketplace.json` a dónde bajarlo.
 *
 * @param entry - Entrada del plugin en el marketplace.
 * @param marketplaceRepo - URL del repo del marketplace, para las rutas relativas.
 * @returns Repo, ref y sha opcionales, y la ruta del plugin dentro del repo.
 * @throws {Error} Si el tipo de `source` no se conoce.
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
  throw new Error(`Tipo de fuente desconocido en el plugin ${entry.name}: ${JSON.stringify(source)}`);
}

/**
 * Escapa un texto para usarlo literal dentro de una expresión regular.
 *
 * @param text - Texto a escapar.
 * @returns El texto con los metacaracteres escapados.
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Reemplaza `<plugin>:<skill>` por `<skill>` cuando la skill quedó instalada
 * sin prefijo. No toca otros plugins, ni coincidencias pegadas a `/`, `:`, `.`
 * o a un nombre más largo (URLs y esquemas como `superpowers://`).
 *
 * @param text - Contenido de un archivo de la skill.
 * @param plugin - Nombre del plugin de origen.
 * @param installed - Nombres de las skills instaladas.
 * @returns El texto con las referencias propias sin prefijo.
 * @example
 * rewritePluginRefs("usá p:a y q:a", "p", new Set(["a"]));
 * // "usá a y q:a"
 */
export function rewritePluginRefs(text, plugin, installed) {
  const pattern = new RegExp(`(?<![\\w/:.-])${escapeRegExp(plugin)}:([\\w-]+)`, "g");
  return text.replace(pattern, (match, skill) => (installed.has(skill) ? skill : match));
}

/**
 * Busca nombres de skill que chocarían al instalarse: repetidos entre
 * orígenes o iguales a una skill propia del repo.
 *
 * @param incoming - Nombre de la skill a su origen; si varios orígenes la
 * traen, el valor es la lista de orígenes.
 * @param own - Nombres de las skills propias del repo.
 * @returns Un mensaje por colisión, que dice qué excluir en el manifiesto.
 * @example
 * findCollisions(new Map([["a", ["x", "y"]]]), new Set());
 * // ['"a" viene de x, y: excluí "a" en el manifiesto de uno de los orígenes']
 */
export function findCollisions(incoming, own) {
  const messages = [];
  for (const [name, origin] of incoming) {
    const origins = [origin].flat();
    if (own.has(name)) {
      messages.push(`"${name}" (de ${origins.join(", ")}) ya existe como skill propia: excluí "${name}" en el manifiesto`);
    } else if (new Set(origins).size > 1) {
      messages.push(`"${name}" viene de ${origins.join(", ")}: excluí "${name}" en el manifiesto de uno de los orígenes`);
    }
  }
  return messages;
}

/**
 * Calcula el hash del contenido instalado de una skill: rutas relativas
 * ordenadas más sus bytes y, en los ejecutables, una marca, sin depender del
 * orden de entrada. Un archivo no ejecutable hashea igual que antes de la
 * marca, así los locks viejos siguen valiendo.
 *
 * @param files - Archivos con su ruta relativa, su contenido y `executable` opcional.
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
 * Compara el lock con las skills que hay en disco.
 *
 * @param lock - Contenido del lock (`{ skills: { nombre: { hash } } }`).
 * @param actual - Nombre de la skill instalada a su hash actual.
 * @returns Las que faltan en disco, las de hash distinto y las que el lock no conoce.
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
 * Elige, entre las instalaciones de un plugin, una cuya carpeta exista,
 * prefiriendo la de scope `user`.
 *
 * @param entries - Entradas del plugin en `installed_plugins.json`.
 * @param skillDirs - Carpeta instalada a sus skills; solo trae las que existen.
 * @returns La entrada elegida, o `undefined` si ninguna está en disco.
 */
function pickInstall(entries, skillDirs) {
  const present = [entries].flat().filter((entry) => skillDirs.has(entry?.installPath));
  return present.find((entry) => entry.scope === USER_SCOPE) ?? present[0];
}

/**
 * Arma el candidato de un plugin instalado, con una nota si no se puede elegir.
 *
 * @param id - `plugin@marketplace`.
 * @param entries - Sus entradas en `installed_plugins.json`.
 * @param machine - Lo leído de la máquina (ver `listCandidates`).
 * @returns El candidato.
 */
function pluginCandidate(id, entries, { skillDirs, marketplaces }) {
  const marketplace = id.split("@")[1];
  const install = pickInstall(entries, skillDirs);
  const skills = install === undefined ? [] : (skillDirs.get(install.installPath) ?? []);
  const candidate = { id, kind: "plugin", skills: [...skills] };
  if (!marketplaces.has(marketplace)) {
    return { ...candidate, note: `no pude leer el marketplace ${marketplace}` };
  }
  if (install === undefined) {
    return { ...candidate, note: "no está en disco" };
  }
  return skills.length === 0 ? { ...candidate, note: "sin skills" } : candidate;
}

/**
 * Lista lo que se puede sumar al manifiesto desde lo instalado en la máquina:
 * cada plugin de `installed_plugins.json` con sus skills y cada skill de
 * `~/.claude/skills`. Lo que ya está en el manifiesto no aparece.
 *
 * @param machine - Lo leído de la máquina: `installed` (el JSON de
 * `installed_plugins.json` o `undefined`), `skillDirs` (carpeta instalada que
 * existe a sus skills, o `null` si no tiene `skills/`), `local` (carpetas de
 * `~/.claude/skills` con `SKILL.md`) y `marketplaces` (nombres que se pudieron leer).
 * @param manifest - Manifiesto actual, o `undefined` si no hay.
 * @returns Candidatos `{ id, kind, skills, note? }`: primero los plugins, después las locales; con `note` no se pueden elegir.
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
 * Lee el valor de `--select`: fuentes separadas por coma y, para elegir skills
 * sueltas de un plugin, `plugin@mkt:skill1+skill2`.
 *
 * @param text - Valor de `--select`.
 * @returns Elecciones `{ id, skills? }`.
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
 * Nombre corto de un candidato: el plugin sin su marketplace, o la skill local.
 *
 * @param id - Id del candidato.
 * @returns El nombre antes de `@`.
 */
function shortName(id) {
  return id.split(PLUGIN_ID_SEPARATOR)[0];
}

/**
 * Arma las opciones del menú interactivo: una línea corta por candidato
 * elegible (nombre y cuántas skills trae, todo en la etiqueta para que se vea
 * en cada fila y no solo en la del cursor) y, aparte, los que no se pueden
 * elegir, para mostrarlos en una sola línea al pie. Si dos plugins se llaman
 * igual en distintos marketplaces, el marketplace va entre paréntesis.
 *
 * @param candidates - Lo que devuelve `listCandidates`.
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
    const detail = candidate.kind === "local" ? "tuya" : `${count} ${count === 1 ? "skill" : "skills"}`;
    options.push({ value: candidate.id, label: `${label} · ${detail}` });
  }
  return { options, hidden };
}

/**
 * Resume lo elegido, una línea por candidato, para confirmar antes de instalar.
 *
 * @param picks - Elecciones `{ id, skills? }`.
 * @param candidates - Lo que devuelve `listCandidates`.
 * @returns Las líneas unidas con salto de línea.
 * @example
 * pickSummary([{ id: "superpowers@m" }], [{ id: "superpowers@m", kind: "plugin", skills: ["a"] }]);
 * // "superpowers (todas, 1)"
 */
export function pickSummary(picks, candidates) {
  return picks
    .map((pick) => {
      const candidate = candidates.find((option) => option.id === pick.id);
      const name = shortName(pick.id);
      if (candidate?.kind === "local") {
        return `${name} (tuya)`;
      }
      if (pick.skills?.length > 0) {
        return `${name}: ${pick.skills.join(", ")}`;
      }
      return `${name} (todas, ${candidate?.skills.length ?? 0})`;
    })
    .join("\n");
}

/**
 * Traduce lo elegido a fuentes del manifiesto, validando contra los candidatos.
 *
 * @param picks - Elecciones `{ id, skills? }`; si una se repite, vale la última.
 * @param candidates - Lo que devuelve `listCandidates`.
 * @returns Fuentes `{ plugin, skills? }` o `{ local }`.
 * @throws {Error} Si no se eligió nada, o algo no está, tiene nota o pide una skill que no trae.
 * @example
 * picksToSources([{ id: "x" }], [{ id: "x", kind: "local", skills: ["x"] }]);
 * // [{ local: "x" }]
 */
export function picksToSources(picks, candidates) {
  if (picks.length === 0) {
    throw new Error("No elegiste nada.");
  }
  const unique = [...new Map(picks.map((pick) => [pick.id, pick])).values()];
  const sources = [];
  for (const pick of unique) {
    const candidate = candidates.find((option) => option.id === pick.id);
    if (candidate === undefined) {
      throw new Error(`"${pick.id}" no está entre los candidatos (mirá --candidates).`);
    }
    if (candidate.note !== undefined) {
      throw new Error(`"${pick.id}" no se puede elegir: ${candidate.note}.`);
    }
    const unknown = (pick.skills ?? []).filter((skill) => !candidate.skills.includes(skill));
    if (unknown.length > 0) {
      throw new Error(`"${pick.id}" no trae ${unknown.join(", ")}; trae ${candidate.skills.join(", ")}.`);
    }
    if (candidate.kind === "local") {
      sources.push({ local: candidate.id });
    } else {
      sources.push(pick.skills?.length > 0 ? { plugin: candidate.id, skills: pick.skills } : { plugin: candidate.id });
    }
  }
  return sources;
}
