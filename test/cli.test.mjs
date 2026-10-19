/**
 * @file Tests del CLI `src/cli.mjs` contra un repo temporal: un
 * origen git local con dos skills, un `SKILLS_HOME` con un marketplace falso
 * que lo apunta por `file://`, y los comandos `install`, `update`, `check`,
 * `list`, `init` y `add`. Sin red: todos los orígenes son repos locales, y el
 * `~/.claude` es siempre el del home falso.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/** El CLI bajo prueba. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.mjs");

/** Configuración de git para commitear sin depender de la del usuario. */
const GIT_IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

/** Lock que escribe el CLI, relativo al repo. */
const LOCK = ".agents/skills.lock.json";

/** Carpeta temporal de cada test, con el repo, el origen y el home. */
let base;

/** Repo donde corre el CLI. */
let repo;

/** Repo de origen de las skills. */
let origin;

/** Home falso con el marketplace. */
let home;

/**
 * Corre git en una carpeta y falla el test si termina mal.
 *
 * @param cwd - Carpeta donde corre.
 * @param args - Argumentos de git.
 * @returns La salida estándar, sin espacios al final.
 */
function git(cwd, args) {
  const result = spawnSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Escribe un archivo creando su carpeta.
 *
 * @param file - Ruta absoluta.
 * @param content - Contenido.
 */
function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * Commitea todo lo que hay en el origen.
 *
 * @param message - Mensaje del commit.
 * @returns El sha del commit nuevo.
 */
function commitOrigin(message) {
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "-m", message]);
  return git(origin, ["rev-parse", "HEAD"]);
}

/**
 * Escribe el marketplace falso `fake` con el plugin `demo` fijado a un sha.
 *
 * @param sha - Commit del origen que publica el marketplace.
 */
function publish(sha) {
  const marketplace = { plugins: [{ name: "demo", source: { source: "url", url: `file://${origin}`, sha } }] };
  write(join(home, ".claude/plugins/marketplaces/fake/.claude-plugin/marketplace.json"), JSON.stringify(marketplace));
}

/**
 * Corre el CLI en el repo temporal, con el home falso.
 *
 * @param args - Argumentos del CLI.
 * @returns Código de salida y salida combinada.
 */
function cli(args) {
  const env = { ...process.env, SKILLS_HOME: home };
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: "utf8", env });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Lee un archivo del repo temporal.
 *
 * @param file - Ruta relativa al repo.
 * @returns El contenido.
 */
function read(file) {
  return readFileSync(join(repo, file), "utf8");
}

/**
 * Reemplaza las fuentes del manifiesto del repo temporal.
 *
 * @param sources - Fuentes nuevas.
 */
function setSources(sources) {
  write(join(repo, ".agents/skills.json"), JSON.stringify({ sources }));
}

/**
 * Deja en el home falso lo que `init` y `add` descubren: `demo@fake` instalado
 * en el caché de plugins, la skill local `mi-skill` y una carpeta `synced/`.
 */
function installMachine() {
  const installPath = join(home, ".claude/plugins/cache/fake/demo/1.0.0");
  write(join(installPath, "skills/alpha/SKILL.md"), "Alpha.\n");
  write(join(installPath, "skills/beta/SKILL.md"), "Beta.\n");
  const installed = { version: 2, plugins: { "demo@fake": [{ scope: "user", installPath, version: "1.0.0" }] } };
  write(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify(installed));
  write(join(home, ".claude/skills/mi-skill/SKILL.md"), "Mía.\n");
  write(join(home, ".claude/skills/mi-skill/refs/notas.md"), "Notas.\n");
  write(join(home, ".claude/skills/synced/otra/SKILL.md"), "Sincronizada.\n");
}

/**
 * Lee el manifiesto del repo temporal.
 *
 * @returns El manifiesto parseado.
 */
function manifest() {
  return JSON.parse(read(".agents/skills.json"));
}

/**
 * Escribe el `.claude/settings.json` del repo temporal con formato estable.
 *
 * @param settings - Contenido a escribir.
 */
function writeSettings(settings) {
  write(join(repo, ".claude/settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Lee el `.claude/settings.json` del repo temporal.
 *
 * @returns El contenido parseado.
 */
function settings() {
  return JSON.parse(read(".claude/settings.json"));
}

/**
 * Dice si un archivo del repo temporal tiene algún bit de ejecución.
 *
 * @param file - Ruta relativa al repo.
 * @returns `true` si es ejecutable.
 */
function isExecutable(file) {
  return (statSync(join(repo, file)).mode & 0o111) !== 0;
}

/** Mensaje de una skill editada a mano: las dos salidas, versión del lock o última publicada. */
const EDITED_ALPHA =
  /"alpha" se editó a mano: para volver a la versión del lock, rm -rf \.agents\/skills\/alpha && bun run skills:install; para pisarla con la última publicada, bun run skills:update alpha/;

/** Commit inicial del origen. */
let firstSha;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "skills-cli-"));
  repo = join(base, "repo");
  origin = join(base, "origin");
  home = join(base, "home");
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [{ plugin: "demo@fake" }] }));
  mkdirSync(origin);
  git(origin, ["init", "-q"]);
  write(join(origin, "skills/alpha/SKILL.md"), "Alpha. Después usá demo:beta y otro:beta.\n");
  write(join(origin, "skills/beta/SKILL.md"), "Beta.\n");
  write(join(origin, "LICENSE"), "MIT\n");
  write(join(origin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
  firstSha = commitOrigin("primero");
  write(
    join(home, ".claude/plugins/known_marketplaces.json"),
    JSON.stringify({ fake: { source: { source: "git", url: `file://${origin}` } } }),
  );
  publish(firstSha);
  writeSettings({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "x", timeout: 600 }] }] } });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("install", () => {
  test("sin lock baja las skills del plugin, reescribe referencias y escribe el lock", () => {
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Después usá beta y otro:beta.\n");
    assert.equal(read(".agents/skills/beta/SKILL.md"), "Beta.\n");
    assert.equal(read(".agents/skills/beta/LICENSE"), "MIT\n");
    const lock = JSON.parse(read(LOCK));
    assert.deepEqual(lock.plugins, ["demo@fake"]);
    assert.equal(lock.skills.alpha.commit, firstSha);
    assert.equal(lock.skills.alpha.source, "demo@fake");
    assert.equal(lock.skills.alpha.path, "skills/alpha");
    assert.equal(lock.skills.alpha.version, "1.0.0");
    assert.match(lock.skills.beta.hash, /^sha256-[0-9a-f]{64}$/);
  });

  test("un segundo install no cambia nada", () => {
    assert.equal(cli(["install"]).status, 0);
    const before = statSync(join(repo, LOCK)).mtimeMs;
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(statSync(join(repo, LOCK)).mtimeMs, before);
  });

  test("baja al commit del lock aunque el marketplace publique otro", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(origin, "skills/beta/SKILL.md"), "Beta 2.\n");
    publish(commitOrigin("segundo"));
    rmSync(join(repo, ".agents/skills/beta"), { recursive: true });
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/beta/SKILL.md"), "Beta.\n");
  });

  test("una skill editada a mano hace fallar check e install", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "editada\n");
    const check = cli(["check"]);
    assert.equal(check.status, 1);
    assert.match(check.output, /alpha/);
    const install = cli(["install"]);
    assert.equal(install.status, 1);
    assert.match(install.output, EDITED_ALPHA);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "editada\n");
  });

  test("borrar la skill editada e install la rearma al commit del lock, no a la última", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "editada\n");
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    publish(commitOrigin("segundo"));
    rmSync(join(repo, ".agents/skills/alpha"), { recursive: true });
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Después usá beta y otro:beta.\n");
    assert.equal(cli(["check"]).status, 0);
  });

  test("conserva el bit de ejecución y check detecta si se pierde", () => {
    write(join(origin, "skills/beta/run.sh"), "#!/bin/sh\necho hola\n");
    chmodSync(join(origin, "skills/beta/run.sh"), 0o755);
    publish(commitOrigin("script"));
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(isExecutable(".agents/skills/beta/run.sh"), true);
    assert.equal(isExecutable(".agents/skills/beta/SKILL.md"), false);
    assert.equal(cli(["check"]).status, 0);
    chmodSync(join(repo, ".agents/skills/beta/run.sh"), 0o644);
    const check = cli(["check"]);
    assert.equal(check.status, 1);
    assert.match(check.output, /editadas a mano: beta/);
  });

  test("una skill de terceros con el nombre de una propia corta con excluí", () => {
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "propia\n");
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /excluí "alpha"/);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "propia\n");
    assert.equal(existsSync(join(repo, LOCK)), false);
  });

  test("respeta la lista de skills del manifiesto", () => {
    write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [{ plugin: "demo@fake", skills: ["beta"] }] }));
    assert.equal(cli(["install"]).status, 0);
    assert.equal(existsSync(join(repo, ".agents/skills/alpha")), false);
    assert.deepEqual(Object.keys(JSON.parse(read(LOCK)).skills), ["beta"]);
  });
});

describe("plugins desactivados en el proyecto", () => {
  test("install desactiva el plugin y conserva el resto de settings.json", () => {
    assert.equal(cli(["install"]).status, 0);
    const current = settings();
    assert.equal(current.enabledPlugins["demo@fake"], false);
    assert.equal(current.hooks.SessionStart[0].hooks[0].timeout, 600);
    assert.match(read(".claude/settings.json"), /\n$/);
  });

  test("sacar la fuente del manifiesto quita la clave y el objeto vacío", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    assert.equal(cli(["install"]).status, 0);
    assert.equal("enabledPlugins" in settings(), false);
    assert.ok(settings().hooks);
  });

  test("no toca lo que la herramienta no puso", () => {
    writeSettings({ enabledPlugins: { "mano@x": true, "otro@y": false } });
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    assert.equal(cli(["install"]).status, 0);
    assert.deepEqual(settings(), { enabledPlugins: { "mano@x": true, "otro@y": false } });
  });

  test("sin settings.json lo crea; sin plugins no lo crea", () => {
    rmSync(join(repo, ".claude"), { recursive: true });
    assert.equal(cli(["install"]).status, 0);
    assert.deepEqual(settings(), { enabledPlugins: { "demo@fake": false } });
    rmSync(join(repo, ".claude"), { recursive: true });
    setSources([]);
    assert.equal(cli(["install"]).status, 0);
    assert.equal(existsSync(join(repo, ".claude/settings.json")), false);
  });

  test("init y add también lo dejan escrito", () => {
    installMachine();
    setSources([]);
    assert.equal(cli(["add", "--select", "demo@fake"]).status, 0);
    assert.equal(settings().enabledPlugins["demo@fake"], false);
  });

  test("--dry-run no escribe settings.json", () => {
    assert.equal(cli(["update", "--dry-run"]).status, 0);
    assert.equal("enabledPlugins" in settings(), false);
  });
});

describe("check", () => {
  test("sin manifiesto sale con 0", () => {
    rmSync(join(repo, ".agents/skills.json"));
    assert.equal(cli(["check"]).status, 0);
  });

  test("después de install sale con 0; si falta una skill, con 1", () => {
    assert.equal(cli(["install"]).status, 0);
    assert.equal(cli(["check"]).status, 0);
    rmSync(join(repo, ".agents/skills/beta"), { recursive: true });
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /beta/);
  });
});

describe("update", () => {
  test("--dry-run imprime el cambio de commit sin tocar archivos; update lo aplica", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    const newSha = commitOrigin("segundo");
    publish(newSha);
    const lockBefore = read(LOCK);

    const dry = cli(["update", "--dry-run"]);
    assert.equal(dry.status, 0, dry.output);
    assert.match(dry.output, new RegExp(`alpha: ${firstSha.slice(0, 7)} → ${newSha.slice(0, 7)}`));
    assert.equal(read(LOCK), lockBefore);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Después usá beta y otro:beta.\n");

    const real = cli(["update"]);
    assert.equal(real.status, 0, real.output);
    assert.match(real.output, new RegExp(`alpha: ${firstSha.slice(0, 7)} → ${newSha.slice(0, 7)}`));
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha 2.\n");
    assert.equal(JSON.parse(read(LOCK)).skills.alpha.commit, newSha);
    assert.equal(cli(["check"]).status, 0);
  });

  test("update <nombre> pisa una skill editada a mano", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "editada\n");
    const result = cli(["update", "alpha"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Después usá beta y otro:beta.\n");
  });
});

describe("list", () => {
  test("muestra cada skill con su origen y avisa si hay versión nueva", () => {
    assert.equal(cli(["install"]).status, 0);
    const same = cli(["list"]);
    assert.equal(same.status, 0, same.output);
    assert.match(same.output, new RegExp(`alpha\\s+demo@fake\\s+1\\.0\\.0 \\(${firstSha.slice(0, 7)}\\)`));
    assert.doesNotMatch(same.output, /hay versión nueva/);
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    publish(commitOrigin("segundo"));
    assert.match(cli(["list"]).output, /alpha.*\(hay versión nueva\)/);
  });
});

describe("reconciliación del lock con el manifiesto", () => {
  test("quitar una fuente borra sus skills del disco y del lock", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(existsSync(join(repo, ".agents/skills/alpha")), false);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), false);
    assert.deepEqual(JSON.parse(read(LOCK)), { skills: {}, plugins: [] });
    assert.equal(cli(["check"]).status, 0);
  });

  test("quitar una fuente con una skill editada a mano corta sin borrar", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "editada\n");
    setSources([]);
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, EDITED_ALPHA);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "editada\n");
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), true);
  });

  test("cambiar la lista de skills reconstruye la fuente al commit del lock", () => {
    setSources([{ plugin: "demo@fake", skills: ["beta"] }]);
    assert.equal(cli(["install"]).status, 0);
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    publish(commitOrigin("segundo"));

    setSources([{ plugin: "demo@fake", skills: ["alpha", "beta"] }]);
    const added = cli(["install"]);
    assert.equal(added.status, 0, added.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Después usá beta y otro:beta.\n");
    assert.equal(JSON.parse(read(LOCK)).skills.alpha.commit, firstSha);

    setSources([{ plugin: "demo@fake", skills: ["alpha"] }]);
    const dropped = cli(["install"]);
    assert.equal(dropped.status, 0, dropped.output);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), false);
    assert.deepEqual(Object.keys(JSON.parse(read(LOCK)).skills), ["alpha"]);
    assert.equal(cli(["check"]).status, 0);
  });

  test("check falla si una fuente del manifiesto no está en el lock", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([{ plugin: "demo@fake" }, { repo: `file://${origin}`, path: "skills/beta" }]);
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, new RegExp(`file://${origin}/skills/beta`));
  });

  test("check falla si el lock tiene skills de una fuente que ya no está", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /alpha/);
  });

  test("check falla si plugins del lock no coincide con el manifiesto", () => {
    assert.equal(cli(["install"]).status, 0);
    const lock = JSON.parse(read(LOCK));
    write(join(repo, LOCK), JSON.stringify({ ...lock, plugins: [] }));
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /plugins/);
  });

  test("check falla si la lista de skills del manifiesto no coincide con el lock", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([{ plugin: "demo@fake", skills: ["alpha"] }]);
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /demo@fake/);
  });
});

describe("update --dry-run", () => {
  test("avisa las skills que aparecen y desaparecen en el origen", () => {
    assert.equal(cli(["install"]).status, 0);
    rmSync(join(origin, "skills/beta"), { recursive: true });
    write(join(origin, "skills/gamma/SKILL.md"), "Gamma.\n");
    publish(commitOrigin("segundo"));
    const lockBefore = read(LOCK);
    const result = cli(["update", "--dry-run"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /gamma: nueva/);
    assert.match(result.output, /beta: se quita/);
    assert.equal(read(LOCK), lockBefore);
    assert.equal(existsSync(join(repo, ".agents/skills/gamma")), false);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), true);
  });

  test("avisa cada skill editada a mano que el update va a pisar", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "editada\n");
    const result = cli(["update", "--dry-run"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /alpha: editada a mano, se pisa/);
    assert.doesNotMatch(result.output, /beta: editada a mano/);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "editada\n");
  });
});

describe("seguridad", () => {
  test("rechaza repos que no son https:// ni file://", () => {
    setSources([{ repo: "ext::sh -c id", path: "skills/beta" }]);
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /https:\/\/ o file:\/\//);
  });

  test("rechaza un sha del marketplace que no es un sha completo", () => {
    publish("--upload-pack=id");
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /sha/);
  });

  test("rechaza rutas con .. o absolutas", () => {
    setSources([{ repo: `file://${origin}`, path: "../outside" }]);
    const parent = cli(["install"]);
    assert.equal(parent.status, 1);
    assert.match(parent.output, /ruta/);
    setSources([{ repo: `file://${origin}`, path: "/etc" }]);
    assert.match(cli(["install"]).output, /ruta/);
  });

  test("una skill con un symlink hace fallar install y no copia nada", () => {
    write(join(base, "secret.txt"), "secreto\n");
    symlinkSync(join(base, "secret.txt"), join(origin, "skills/beta/secret.txt"));
    publish(commitOrigin("symlink"));
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /symlink/);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), false);
    assert.equal(existsSync(join(repo, LOCK)), false);
  });

  test("una carpeta de skill que es un symlink fuera del origen hace fallar install", () => {
    mkdirSync(join(base, "outside"));
    write(join(base, "outside/SKILL.md"), "afuera\n");
    symlinkSync(join(base, "outside"), join(origin, "skills/gamma"));
    publish(commitOrigin("symlink de carpeta"));
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /symlink|sale del repo/);
    assert.equal(existsSync(join(repo, ".agents/skills/gamma")), false);
  });
});

describe("init y add", () => {
  test("init --select instala el plugin; un segundo init sugiere skills:add", () => {
    installMachine();
    rmSync(join(repo, ".agents/skills.json"));
    const result = cli(["init", "--select", "demo@fake"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(manifest(), { sources: [{ plugin: "demo@fake" }] });
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Después usá beta y otro:beta.\n");
    assert.equal(JSON.parse(read(LOCK)).skills.beta.commit, firstSha);
    const again = cli(["init", "--select", "demo@fake"]);
    assert.equal(again.status, 1);
    assert.match(again.output, /ya existe; usá skills:add/);
  });

  test("add --candidates no lista lo que ya está en el manifiesto ni synced/", () => {
    installMachine();
    rmSync(join(repo, ".agents/skills.json"));
    assert.equal(cli(["init", "--select", "demo@fake"]).status, 0);
    const result = cli(["add", "--candidates"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(JSON.parse(result.output), [{ id: "mi-skill", kind: "local", skills: ["mi-skill"] }]);
  });

  test("add --select de una local la copia y la fija en el lock sin repo ni commit", () => {
    installMachine();
    const result = cli(["add", "--select", "mi-skill"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(manifest().sources, [{ plugin: "demo@fake" }, { local: "mi-skill" }]);
    assert.equal(read(".agents/skills/mi-skill/SKILL.md"), "Mía.\n");
    assert.equal(read(".agents/skills/mi-skill/refs/notas.md"), "Notas.\n");
    const entry = JSON.parse(read(LOCK)).skills["mi-skill"];
    assert.equal(entry.source, "local");
    assert.equal(entry.repo, undefined);
    assert.equal(entry.commit, undefined);
    assert.match(entry.hash, /^sha256-[0-9a-f]{64}$/);
    assert.equal(cli(["check"]).status, 0);
  });

  test("una local copiada es propia: editarla no hace fallar check ni install, e install no la pisa", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "mi-skill"]).status, 0);
    write(join(repo, ".agents/skills/mi-skill/SKILL.md"), "editada\n");
    const check = cli(["check"]);
    assert.equal(check.status, 0, check.output);
    const install = cli(["install"]);
    assert.equal(install.status, 0, install.output);
    assert.equal(read(".agents/skills/mi-skill/SKILL.md"), "editada\n");
    const update = cli(["update"]);
    assert.equal(update.status, 0, update.output);
    assert.equal(read(".agents/skills/mi-skill/SKILL.md"), "editada\n");
  });

  test("una local que falta en disco se copia de nuevo; update <local> la vuelve a copiar", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "mi-skill"]).status, 0);
    rmSync(join(repo, ".agents/skills/mi-skill"), { recursive: true });
    assert.equal(cli(["check"]).status, 1);
    assert.equal(cli(["install"]).status, 0);
    assert.equal(read(".agents/skills/mi-skill/SKILL.md"), "Mía.\n");
    write(join(repo, ".agents/skills/mi-skill/SKILL.md"), "editada\n");
    write(join(home, ".claude/skills/mi-skill/SKILL.md"), "Mía 2.\n");
    const dry = cli(["update", "mi-skill", "--dry-run"]);
    assert.equal(dry.status, 0, dry.output);
    assert.match(dry.output, /mi-skill: editada a mano, se pisa/);
    const result = cli(["update", "mi-skill"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/mi-skill/SKILL.md"), "Mía 2.\n");
  });

  test("una local conserva el bit de ejecución", () => {
    installMachine();
    write(join(home, ".claude/skills/mi-skill/bin/run.sh"), "#!/bin/sh\n");
    chmodSync(join(home, ".claude/skills/mi-skill/bin/run.sh"), 0o755);
    assert.equal(cli(["add", "--select", "mi-skill"]).status, 0);
    assert.equal(isExecutable(".agents/skills/mi-skill/bin/run.sh"), true);
    assert.equal(isExecutable(".agents/skills/mi-skill/SKILL.md"), false);
  });

  test("update no toca las locales aunque cambien en ~/.claude/skills", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "mi-skill"]).status, 0);
    write(join(home, ".claude/skills/mi-skill/SKILL.md"), "Mía 2.\n");
    const result = cli(["update"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/mi-skill/SKILL.md"), "Mía.\n");
    assert.equal(cli(["check"]).status, 0);
  });

  test("quitar una local del manifiesto la borra del disco y del lock", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "mi-skill"]).status, 0);
    setSources([{ plugin: "demo@fake" }]);
    assert.equal(cli(["install"]).status, 0);
    assert.equal(existsSync(join(repo, ".agents/skills/mi-skill")), false);
    assert.equal(Object.hasOwn(JSON.parse(read(LOCK)).skills, "mi-skill"), false);
  });

  test("si install falla, add deja el manifiesto como estaba", () => {
    installMachine();
    write(join(repo, ".agents/skills/mi-skill/SKILL.md"), "propia\n");
    const result = cli(["add", "--select", "mi-skill"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /excluí "mi-skill"/);
    assert.deepEqual(manifest(), { sources: [{ plugin: "demo@fake" }] });
  });

  test("add --select rechaza lo que no está entre los candidatos", () => {
    installMachine();
    const result = cli(["add", "--select", "nada@fake"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /nada@fake/);
    assert.deepEqual(manifest(), { sources: [{ plugin: "demo@fake" }] });
  });

  test("un plugin de un marketplace que no se puede leer sale con nota y no se puede elegir", () => {
    installMachine();
    const installPath = join(home, ".claude/plugins/cache/roto/otro/1.0.0");
    write(join(installPath, "skills/gamma/SKILL.md"), "Gamma.\n");
    const file = join(home, ".claude/plugins/installed_plugins.json");
    const installed = JSON.parse(readFileSync(file, "utf8"));
    installed.plugins["otro@roto"] = [{ scope: "user", installPath }];
    write(file, JSON.stringify(installed));
    write(join(home, ".claude/plugins/marketplaces/fake/.claude-plugin/marketplace.json"), "{ roto");
    const result = cli(["add", "--candidates"]);
    assert.equal(result.status, 0, result.output);
    const candidates = JSON.parse(result.output);
    assert.equal(candidates.find((candidate) => candidate.id === "otro@roto").note, "no pude leer el marketplace roto");
    assert.ok(candidates.some((candidate) => candidate.id === "mi-skill"));
    const select = cli(["add", "--select", "otro@roto"]);
    assert.equal(select.status, 1);
    assert.match(select.output, /no pude leer el marketplace roto/);
  });

  test("sin installed_plugins.json, --candidates imprime [] y sale con 0", () => {
    const result = cli(["add", "--candidates"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(JSON.parse(result.output), []);
  });

  test("sin TTY y sin --candidates ni --select sale con 2 y dice cómo usarlo", () => {
    const result = cli(["add"]);
    assert.equal(result.status, 2);
    assert.match(result.output, /--select/);
  });
});
