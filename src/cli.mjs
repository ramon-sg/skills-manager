#!/usr/bin/env node
/**
 * @file CLI de las skills de terceros que viven copiadas en `.agents/skills/`:
 *
 *   bun run skills:install              reconcilia disco y lock con el manifiesto
 *   bun run skills:update [nombre]      pasa al último publicado; --dry-run solo imprime
 *   bun run skills:check                falla si disco, lock y manifiesto no coinciden
 *   bun run skills:list                 lo del lock, con origen, versión y si hay nueva
 *   bun run skills:init | skills:add    elige de lo instalado en la máquina y lo instala
 *                                       (--candidates lista en JSON; --select elige sin preguntar)
 *
 * El manifiesto (`.agents/skills.json`) dice qué se quiere; el lock
 * (`.agents/skills.lock.json`) fija commit y hash de cada skill. Los plugins se
 * resuelven con los marketplaces de `~/.claude/plugins` y las locales se copian
 * de `~/.claude/skills` (`SKILLS_HOME` pisa el home, para los tests). Todo lo
 * que viene de datos (repos, shas, rutas) se valida antes de llegar a git o al
 * disco (`git.mjs`). Las funciones puras viven en `lib.mjs`, el estado del repo
 * en `state.mjs` y la elección de `init` / `add` en `pick.mjs`.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertRelPath, assertRepo, assertSkillName, fetchSource, git, insideTree, latestCommit, walk } from "./git.mjs";
import { diffLock, findCollisions, hashFiles, resolvePluginSource, rewritePluginRefs } from "./lib.mjs";
import { commandPick } from "./pick.mjs";
import {
  installedHash,
  isRegularFile,
  loadMarketplaces,
  LOCAL_SKILLS,
  LOCAL_SOURCE,
  LOCK,
  lockedNames,
  MANIFEST,
  manifestPlugins,
  readJson,
  readLock,
  readManifest,
  sameSet,
  SKILL_FILE,
  SKILLS_DIR,
  sourceKey,
  sourceLabel,
  staleNames,
  syncProjectSettings,
} from "./state.mjs";

export { fetchSource } from "./git.mjs";
export { loadMarketplaces } from "./state.mjs";

/** Licencia que se copia del origen a cada skill. */
const LICENSE = "LICENSE";

/** Largo del sha abreviado que se imprime. */
const SHORT_SHA = 7;

/** Modo con el que se escribe un archivo que en el origen es ejecutable. */
const EXECUTABLE_MODE = 0o755;

/** Atajo `dueño/repo` de GitHub en las fuentes `repo`. */
const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

/**
 * Resuelve dónde está publicada una fuente: repo, ref o sha, y ruta.
 *
 * @param entry - Fuente `plugin` o `repo` del manifiesto.
 * @param marketplaces - Lo que devuelve `loadMarketplaces`.
 * @returns `{ repo, ref?, sha?, path, plugin? }`; `plugin` solo en las de marketplace.
 * @throws {Error} Si el marketplace o el plugin no están, o el repo o la ruta no son válidos.
 */
function describeSource(entry, marketplaces) {
  if (entry.repo !== undefined) {
    const repo = GITHUB_SHORTHAND.test(entry.repo) ? `https://github.com/${entry.repo}.git` : assertRepo(entry.repo);
    return { repo, ref: entry.ref, path: assertRelPath(entry.path) };
  }
  const [plugin, marketplaceName] = entry.plugin.split("@");
  const marketplace = marketplaces.get(marketplaceName);
  const pluginEntry = marketplace?.plugins.find((candidate) => candidate.name === plugin);
  if (pluginEntry === undefined) {
    throw new Error(`No encuentro ${entry.plugin} en los marketplaces de esta máquina (~/.claude/plugins).`);
  }
  const resolved = resolvePluginSource(pluginEntry, marketplace.repo);
  return { ...resolved, repo: assertRepo(resolved.repo), path: assertRelPath(resolved.path), plugin };
}

/**
 * Dice si una skill instalada no tiene el hash del lock. Una que no está en
 * disco no cuenta como editada.
 *
 * @param root - Raíz del repo.
 * @param lock - Lock leído.
 * @param name - Skill a revisar; tiene que estar en el lock.
 * @returns `true` si está en disco con otro contenido.
 */
function isEdited(root, lock, name) {
  return ![undefined, lock.skills[name].hash].includes(installedHash(root, name));
}

/**
 * Corta si alguna skill instalada no tiene el hash del lock, y dice las dos
 * salidas: borrarla e instalar (vuelve a la versión del lock) o actualizarla
 * (pasa a la última publicada).
 *
 * @param root - Raíz del repo.
 * @param lock - Lock leído.
 * @param names - Skills a revisar; las que no están en disco no cuentan.
 * @throws {Error} Si alguna se editó a mano.
 */
function assertUntouched(root, lock, names) {
  const edited = names.find((name) => isEdited(root, lock, name));
  if (edited !== undefined) {
    throw new Error(
      `"${edited}" se editó a mano: para volver a la versión del lock, rm -rf ${SKILLS_DIR}/${edited} && bun run skills:install; ` +
        `para pisarla con la última publicada, bun run skills:update ${edited}`,
    );
  }
}

/**
 * Versión publicada del origen: la de `.claude-plugin/plugin.json` o `package.json`.
 *
 * @param dir - Carpeta raíz del plugin o del repo.
 * @returns La versión, o `undefined` si no declara ninguna.
 */
function versionOf(dir) {
  for (const file of [".claude-plugin/plugin.json", "package.json"]) {
    const full = path.join(dir, file);
    const version = isRegularFile(full) ? readJson(full).version : undefined;
    if (version !== undefined) {
      return version;
    }
  }
  return undefined;
}

/**
 * Arma los archivos de cada skill de un origen ya bajado: filtra las pedidas,
 * reescribe las referencias entre skills del mismo plugin y suma la licencia.
 *
 * @param tree - Checkout del origen.
 * @param plan - Plan de la fuente: `entry`, `root` (raíz del plugin o ruta de la skill) y `plugin`.
 * @returns Skills con nombre, ruta en el origen, archivos y versión.
 * @throws {Error} Si una skill trae symlinks o se sale del origen.
 */
function collectSkills(tree, plan) {
  const isPlugin = plan.plugin !== undefined;
  const pluginRoot = insideTree(tree, isPlugin ? plan.root : ".");
  const skillsDir = path.posix.join(plan.root, "skills");
  const names = isPlugin
    ? readdirSync(insideTree(tree, skillsDir)).filter((name) => existsSync(path.join(tree, skillsDir, name, SKILL_FILE)))
    : [path.posix.basename(plan.root)];
  const wanted = names.filter((name) => plan.entry.skills === undefined || plan.entry.skills.includes(name)).map(assertSkillName);
  const installed = new Set(wanted);
  const license = [path.join(pluginRoot, LICENSE), path.join(tree, LICENSE)].find(isRegularFile);
  const version = versionOf(pluginRoot);
  return wanted.map((name) => {
    const rel = isPlugin ? path.posix.join(skillsDir, name) : plan.root;
    const files = walk(insideTree(tree, rel)).map((file) =>
      isPlugin && !file.content.includes(0)
        ? { ...file, content: Buffer.from(rewritePluginRefs(file.content.toString("utf8"), plan.plugin, installed)) }
        : file,
    );
    if (license !== undefined && !files.some((file) => file.path === LICENSE)) {
      files.push({ path: LICENSE, content: readFileSync(license) });
    }
    return { name, path: rel, files, version };
  });
}

/**
 * Copia una skill suelta de la máquina (`~/.claude/skills/<nombre>`).
 *
 * @param home - Home de la máquina.
 * @param name - Nombre de la skill.
 * @returns La skill con su nombre y sus archivos.
 * @throws {Error} Si el nombre no es válido, no está o trae symlinks.
 */
function collectLocal(home, name) {
  const dir = path.join(home, LOCAL_SKILLS, assertSkillName(name));
  if (!isRegularFile(path.join(dir, SKILL_FILE))) {
    throw new Error(`No encuentro ~/${LOCAL_SKILLS}/${name}/${SKILL_FILE}.`);
  }
  return { name, files: walk(dir) };
}

/**
 * Decide qué hacer con una fuente local: dejarla, o copiarla de la máquina si es
 * nueva, falta en disco o se pidió `update <nombre>`. Una local copiada pasa a
 * ser propia del repo: se puede editar, e `install` y un `update` general no la
 * tocan mientras esté en disco.
 *
 * @param entry - Fuente `local` del manifiesto.
 * @param context - `{ root, lock, home, update }`.
 * @returns Plan con `key`, `entry`, `names` y, si hay que copiar, `skills`.
 * @throws {Error} Si hay que copiarla y no está en la máquina.
 */
function planLocal(entry, { root, lock, home, update }) {
  const names = lockedNames(lock, entry);
  if (names.length > 0 && update !== entry.local && installedHash(root, entry.local) !== undefined) {
    return { key: LOCAL_SOURCE, entry, names };
  }
  return { key: LOCAL_SOURCE, entry, names, skills: [collectLocal(home, entry.local)] };
}

/**
 * Decide qué hacer con una fuente: dejarla, rearmarla al commit del lock (falta
 * algo o cambió su lista de skills) o bajarla al último publicado (nueva o pedida
 * en `update`).
 *
 * @param entry - Fuente del manifiesto.
 * @param context - `{ root, lock, home, marketplaces, update }`.
 * @returns Plan con `key`, `entry`, `names` fijados y, si hay que bajar, `repo`, `commit`, `root` y `plugin`.
 * @throws {Error} Si una skill fijada se editó a mano y no se pidió pisarla.
 */
function planSource(entry, context) {
  if (entry.local !== undefined) {
    return planLocal(entry, context);
  }
  const { root, lock, marketplaces, update } = context;
  const key = sourceKey(entry);
  const names = lockedNames(lock, entry);
  if (names.length === 0 || update === true || names.includes(update)) {
    const resolved = describeSource(entry, marketplaces);
    return { key, entry, names, repo: resolved.repo, commit: latestCommit(resolved), root: resolved.path, plugin: resolved.plugin };
  }
  assertUntouched(root, lock, names);
  const listChanged = entry.skills !== undefined && !sameSet(entry.skills, names);
  if (!listChanged && names.every((name) => installedHash(root, name) !== undefined)) {
    return { key, entry, names };
  }
  const first = lock.skills[names[0]];
  const skillPath = assertRelPath(first.path);
  const isPlugin = entry.plugin !== undefined;
  const pluginRoot = isPlugin ? path.posix.dirname(path.posix.dirname(skillPath)) : skillPath;
  return { key, entry, names, repo: first.repo, commit: first.commit, root: pluginRoot, plugin: entry.plugin?.split("@")[0] };
}

/**
 * Describe lo que cambia: skills nuevas, que se quitan, que cambian de commit y
 * las editadas a mano que se van a pisar.
 *
 * @param root - Raíz del repo.
 * @param plans - Planes con sus skills ya armadas.
 * @param stale - Skills del lock cuya fuente ya no está en el manifiesto.
 * @param lock - Lock anterior.
 * @returns Una línea por cambio.
 */
function describeChanges(root, plans, stale, lock) {
  const lines = stale.map((name) => `${name}: se quita`);
  for (const plan of plans.filter((candidate) => candidate.skills !== undefined)) {
    const fresh = new Set(plan.skills.map((skill) => skill.name));
    lines.push(...plan.names.filter((name) => !fresh.has(name)).map((name) => `${name}: se quita`));
    const label = plan.commit?.slice(0, SHORT_SHA) ?? LOCAL_SOURCE;
    for (const { name } of plan.skills) {
      const known = Object.hasOwn(lock.skills, name);
      const old = known ? lock.skills[name].commit : undefined;
      if (!known) {
        lines.push(`${name}: nueva (${label})`);
        continue;
      }
      if (old !== plan.commit) {
        lines.push(`${name}: ${old?.slice(0, SHORT_SHA) ?? LOCAL_SOURCE} → ${label}`);
      }
      if (isEdited(root, lock, name)) {
        lines.push(`${name}: editada a mano, se pisa`);
      }
    }
  }
  return lines;
}

/**
 * Baja cada fuente que lo necesita y arma sus skills.
 *
 * @param plans - Planes de cada fuente; se les agrega `skills`.
 * @param temp - Carpeta temporal donde bajar los orígenes.
 */
function fetchPlans(plans, temp) {
  for (const [index, plan] of plans.entries()) {
    if (plan.commit !== undefined) {
      const tree = path.join(temp, String(index));
      fetchSource({ repo: plan.repo, commit: plan.commit }, tree);
      plan.skills = collectSkills(tree, plan);
    }
  }
}

/**
 * Corta si una skill entrante choca con una propia o con la de otro origen.
 *
 * @param root - Raíz del repo.
 * @param plans - Planes con sus skills ya armadas.
 * @param lock - Lock anterior; lo que está en él no es propio.
 * @throws {Error} Con un mensaje por colisión.
 */
function assertNoCollisions(root, plans, lock) {
  const incoming = new Map();
  for (const plan of plans) {
    for (const name of plan.skills?.map((skill) => skill.name) ?? plan.names) {
      incoming.set(name, [...(incoming.get(name) ?? []), plan.key]);
    }
  }
  const skillsRoot = path.join(root, SKILLS_DIR);
  const existing = existsSync(skillsRoot) ? readdirSync(skillsRoot) : [];
  const collisions = findCollisions(incoming, new Set(existing.filter((name) => !Object.hasOwn(lock.skills, name))));
  if (collisions.length > 0) {
    throw new Error(collisions.join("\n"));
  }
}

/**
 * Reconcilia `.agents/skills/` y el lock con el manifiesto: quita lo que ya no
 * está, rearma lo que cambió y baja lo nuevo. Las fuentes `local` se copian de
 * `~/.claude/skills` cuando faltan y `update` solo las pisa si se las nombra.
 *
 * @param root - Raíz del repo.
 * @param opts - `{ home, update?: true | nombre, dryRun?, log? }`.
 * @returns `{ changed }`: si se escribió el lock.
 * @throws {Error} Si una skill se editó a mano, hay colisiones, datos inválidos o falla git.
 */
export function installAll(root, { home, update, dryRun = false, log = console.log }) {
  const manifest = readManifest(root);
  if (manifest === undefined) {
    log(`No hay ${MANIFEST}: nada que instalar.`);
    return { changed: false };
  }
  const lock = readLock(root);
  if (typeof update === "string" && !Object.hasOwn(lock.skills, update)) {
    throw new Error(`"${update}" no está en ${LOCK}.`);
  }
  const stale = staleNames(lock, manifest);
  assertUntouched(root, lock, stale);
  const context = { root, lock, home, marketplaces: loadMarketplaces(home), update };
  const plans = manifest.sources.map((entry) => planSource(entry, context));
  const temp = mkdtempSync(path.join(tmpdir(), "skills-"));
  try {
    fetchPlans(plans, temp);
    assertNoCollisions(root, plans, lock);
    describeChanges(root, plans, stale, lock).forEach((line) => log(line));
    return dryRun ? { changed: false } : writeAll(root, { plans, stale, lock, manifest });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * Escribe las skills bajadas, borra las que salen, reescribe el lock si cambió y
 * deja desactivados en `.claude/settings.json` los plugins del lock.
 *
 * @param root - Raíz del repo.
 * @param state - `{ plans, stale, lock, manifest }`.
 * @returns `{ changed }`: si se escribió el lock.
 */
function writeAll(root, { plans, stale, lock, manifest }) {
  const skills = { ...lock.skills };
  const remove = (name) => {
    rmSync(path.join(root, SKILLS_DIR, name), { recursive: true, force: true });
    delete skills[name];
  };
  stale.forEach(remove);
  for (const plan of plans.filter((candidate) => candidate.skills !== undefined)) {
    plan.names.filter((name) => !plan.skills.some((skill) => skill.name === name)).forEach(remove);
    for (const skill of plan.skills) {
      const dir = path.join(root, SKILLS_DIR, skill.name);
      rmSync(dir, { recursive: true, force: true });
      for (const file of skill.files) {
        mkdirSync(path.dirname(path.join(dir, file.path)), { recursive: true });
        writeFileSync(path.join(dir, file.path), file.content);
        if (file.executable === true) {
          chmodSync(path.join(dir, file.path), EXECUTABLE_MODE);
        }
      }
      const { name, version } = skill;
      const hash = hashFiles(skill.files);
      skills[name] = plan.entry.local === undefined
        ? { source: plan.key, repo: plan.repo, commit: plan.commit, path: skill.path, version, hash }
        : { source: plan.key, hash };
    }
  }
  const sorted = Object.fromEntries(Object.keys(skills).sort().map((name) => [name, skills[name]]));
  const text = `${JSON.stringify({ skills: sorted, plugins: manifestPlugins(manifest) }, null, 2)}\n`;
  syncProjectSettings(root, lock.plugins, manifestPlugins(manifest));
  const file = path.join(root, LOCK);
  if (existsSync(file) && readFileSync(file, "utf8") === text) {
    return { changed: false };
  }
  writeFileSync(file, text);
  return { changed: true };
}

/**
 * Busca diferencias entre disco, lock y manifiesto.
 *
 * @param root - Raíz del repo.
 * @param manifest - Manifiesto leído.
 * @param lock - Lock leído.
 * @returns Pares `[problema, nombres]`, solo los que tienen algo.
 */
function driftProblems(root, manifest, lock) {
  const actual = new Map();
  for (const name of Object.keys(lock.skills)) {
    const hash = installedHash(root, name);
    if (hash !== undefined) {
      actual.set(name, hash);
    }
  }
  const diff = diffLock(lock, actual);
  // NOTA: una local copiada es propia del repo; editarla no es una deriva.
  const modified = diff.modified.filter((name) => lock.skills[name].source !== LOCAL_SOURCE);
  const remote = manifest.sources.filter((entry) => entry.local === undefined);
  const plugins = manifestPlugins(manifest);
  const pluginsDiff = `lock [${lock.plugins.join(", ")}], manifiesto [${plugins.join(", ")}]`;
  return [
    ["faltan en disco", diff.missing],
    ["editadas a mano", modified],
    ["fuentes sin instalar", manifest.sources.filter((entry) => lockedNames(lock, entry).length === 0).map(sourceLabel)],
    ["en el lock sin fuente en el manifiesto", staleNames(lock, manifest)],
    ["con otra lista de skills que el lock", remote.filter((e) => e.skills !== undefined && !sameSet(e.skills, lockedNames(lock, e))).map(sourceKey)],
    ["plugins del lock distintos del manifiesto", JSON.stringify(plugins) === JSON.stringify(lock.plugins) ? [] : [pluginsDiff]],
  ].filter(([, names]) => names.length > 0);
}

/**
 * Compara disco, lock y manifiesto, y termina con 1 si algo no coincide.
 *
 * @param root - Raíz del repo.
 */
function commandCheck(root) {
  const manifest = readManifest(root);
  if (manifest === undefined) {
    return;
  }
  const problems = driftProblems(root, manifest, readLock(root));
  if (problems.length === 0) {
    console.log("✅ Skills de terceros al día con el lock y el manifiesto.");
    return;
  }
  console.error("❌ Las skills de terceros no coinciden con el lock o el manifiesto (corré skills:install):");
  for (const [kind, names] of problems) {
    console.error(`   ${kind}: ${names.join(", ")}`);
  }
  process.exit(1);
}

/**
 * Imprime cada skill del lock con su origen y versión, y si hay una nueva.
 *
 * @param root - Raíz del repo.
 * @param home - Home con los marketplaces.
 */
function commandList(root, home) {
  const lock = readLock(root);
  const marketplaces = loadMarketplaces(home);
  const latest = new Map();
  for (const entry of (readManifest(root)?.sources ?? []).filter((candidate) => candidate.local === undefined)) {
    try {
      latest.set(sourceKey(entry), latestCommit(describeSource(entry, marketplaces)));
    } catch {
      // NOTA: sin el marketplace o sin red no se sabe si hay versión nueva; se lista igual.
    }
  }
  for (const [name, skill] of Object.entries(lock.skills)) {
    const newer = latest.has(skill.source) && latest.get(skill.source) !== skill.commit ? "  (hay versión nueva)" : "";
    console.log(`${name}  ${skill.source}  ${skill.version ?? "-"} (${skill.commit?.slice(0, SHORT_SHA) ?? LOCAL_SOURCE})${newer}`);
  }
}

/**
 * Punto de entrada: ubica la raíz del repo y despacha el subcomando. Los errores
 * terminan con su `exitCode` (2 para los de uso) o con 1.
 */
async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const home = process.env.SKILLS_HOME ?? homedir();
  try {
    const root = git(["rev-parse", "--show-toplevel"], process.cwd());
    if (subcommand === "install") {
      installAll(root, { home });
    } else if (subcommand === "update") {
      const name = rest.find((arg) => !arg.startsWith("--"));
      installAll(root, { home, update: name ?? true, dryRun: rest.includes("--dry-run") });
    } else if (subcommand === "check") {
      commandCheck(root);
    } else if (subcommand === "list") {
      commandList(root, home);
    } else if (subcommand === "init" || subcommand === "add") {
      await commandPick(root, { init: subcommand === "init", args: rest, home, install: () => installAll(root, { home }) });
    } else {
      throw new Error(`Subcomando desconocido: ${subcommand ?? "(ninguno)"}; usá install, update, check, list, init o add`);
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(error.exitCode ?? 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
