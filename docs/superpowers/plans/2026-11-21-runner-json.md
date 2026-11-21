# Su entrada y su skill `manage-skills` desde `.agents/runner.json` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** skills-manager escribe su propia entrada en `.agents/runner.json` (creando el archivo si falta), su skill `manage-skills` deja de decir `npx` fijo, y se publica como un bundle sin `dependencies`, probado con Node y Bun.

**Architecture:** un módulo nuevo, `src/runner-entry.mjs`, envuelve `@ramon-sg/runner`: decide la entrada **antes** de escribir nada (leer el archivo, elegir `runner` si falta, preguntar en terminal) y la escribe **después** de que el comando terminó bien, igual que hoy se copia la skill empaquetada. Lo llaman los comandos que escriben el repo (`init`, `add`, `install`, `update` sin `--dry-run`). La versión propia sale de `package.json` leído en tiempo de ejecución (`src/version.mjs`), que funciona igual desde `src/` y desde `dist/`. Al publicar, esbuild junta `src/cli.mjs` y sus dependencias en `dist/cli.mjs`.

**Tech Stack:** Node ≥ 20.12, ESM `.mjs`, `node:test`, `@clack/prompts` 1.8.1, `@ramon-sg/runner` 1.0.0 (nueva), esbuild (nueva, solo dev). Bun 1.4.4 para CI.

**Spec:** issue #10 (`gh issue view 10`) y el diseño `docs/superpowers/specs/2026-11-20-bunx-runner-design.md` de ramon-sg/agent-kitchen (`gh api repos/ramon-sg/agent-kitchen/contents/docs/superpowers/specs/2026-11-20-bunx-runner-design.md -q .content | base64 -d`), secciones "El archivo", "Herramientas instaladas solas" y "Las herramientas se publican con sus dependencias adentro". API de la biblioteca: `../runner/dist/index.d.ts` o el README de `@ramon-sg/runner`. Hallazgos del spike: `docs/spike-2026-11-20.md` de ramon-sg/runner.

## Global Constraints

- Paquete en `runner.json`: `"@ramon-sg/skills-manager"`. Versión exacta, la del `package.json` propio. Nunca una de otra herramienta: skills-manager no necesita ninguna.
- Comando según `runner`: `bun` → `bunx --bun @ramon-sg/skills-manager@<versión> <args>`; `node` → `npx --yes @ramon-sg/skills-manager@<versión> <args>`. Sin `runner` en el archivo vale `bun`.
- Archivo nuevo: `chooseRunner` de la biblioteca. Con terminal (`process.stdin.isTTY`) y sin Bun, pregunta "Bun no está instalado: ¿usar Node o salir para instalar Bun?"; sin terminal, `node` con aviso **traducido** (no se imprime `NO_BUN_WARNING`, que está solo en inglés).
- La entrada se escribe con `setTool` sin `allowLower`: nunca baja una versión existente. Las demás entradas, `$schema` y claves desconocidas quedan como estaban (`writeRunnerConfig` las conserva).
- skills-manager **no** crea ni toca `package.json` (no tiene atajos en el diseño) ni `.claude/settings.json` por esto.
- No se escribe `runner.json` en `check`, `list`, `session-notice`, `--candidates`, `update --dry-run` ni `--help`.
- Los tests no corren `npx`/`bunx` reales contra la red (el spike: `npx` sin red se cuelga). El `bunx` que ve `chooseRunner` se controla con un `PATH` armado por el test.
- Solo macOS/Linux (igual que `@ramon-sg/runner` 1.x).
- Todo texto para personas va en `src/messages/{es,en}.mjs` con la misma forma en los dos (`test/no-loose-text.test.mjs`, `test/messages.test.mjs`). Errores con `fail(clave, params)`.
- Versión **1.5.0**. Mensajes de commit en español, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Cada test nuevo se agrega a `scripts.test` (lista explícita).

## Review Focus

1. **Un `runner.json` ya escrito por otra herramienta** (`runner: "node"`, otras entradas, `$schema`, una clave desconocida): skills-manager agrega o sube solo la suya y deja todo lo demás igual. → Task 1, `keeps other tools and unknown keys`.
2. **La entrada ya fija una versión más nueva** que la que corre (alguien corrió una vieja con `npx @…@1.5.0` y el repo dice 1.6.0): no se baja. → Task 1, `never lowers a newer pin`.
3. **`runner.json` roto** (JSON inválido, `runner: "deno"`, una versión con `^`): el comando falla antes de escribir manifiesto, lock o skills, y el mensaje nombra el archivo. → Task 1, `a broken runner.json stops before writing anything`.
4. **Un repo de Node con `package.json` que tiene skills-manager en `devDependencies`**: `init`/`install` no tocan `package.json`; la migración es de agent-kitchen. → Task 1, `package.json stays byte-identical`.
5. **Cancelar la pregunta del runner** (elegir salir, o Ctrl+C) en `init`: no queda manifiesto, lock, skills ni `runner.json`. → Task 1, `declining the runner question writes nothing`.

---

### Task 1: la entrada en `.agents/runner.json`

**Files:**
- Create: `src/version.mjs`, `src/runner-entry.mjs`, `test/runner-entry.test.mjs`
- Modify: `package.json` (`dependencies` + `@ramon-sg/runner` `1.0.0` exacta; agrega el test a `scripts.test`), `package-lock.json`, `src/cli.mjs` (`main`, `TERMINAL`), `src/pick.mjs` (`commandPick`), `src/prompt.mjs` (`askRunner`), `src/messages/es.mjs`, `src/messages/en.mjs`, `test/cli.test.mjs`

**Interfaces:**
- Produces:
  - `src/version.mjs`: `export const VERSION: string` — `version` de `../package.json` leído con `readFileSync(new URL("../package.json", import.meta.url))` (así sirve desde `src/` y desde `dist/`).
  - `src/runner-entry.mjs`:
    - `export const PACKAGE = "@ramon-sg/skills-manager"`
    - `export async function planRunnerEntry(root: string, ask: { interactive: boolean, askRunner: () => Promise<"node"|null> }): Promise<{ config: RunnerConfig, changed: boolean, warning: string|null }>` — lee con `readRunnerConfig`; si es `null`, `chooseRunner({ ask: ask.interactive ? ask.askRunner : undefined })`; `null` del chooser → `fail("runner.declined")`; aviso de la biblioteca → `text("runner.noBun")`. Luego `setTool(config, PACKAGE, VERSION)`. `RunnerFileError` → `fail("runner.invalid", { file, detail })`. No escribe nada.
    - `export function writeRunnerEntry(root: string, plan): void` — `writeRunnerConfig` solo si `plan.changed`; imprime `plan.warning` en stderr si lo hay.
  - `src/prompt.mjs`: `export async function askRunner(): Promise<"node"|null>` — `select` de clack con dos opciones (usar Node / salir); salir → `null`; cancelar → `orCancel` (lanza `prompt.cancelled`).
  - `TERMINAL` en `cli.mjs` suma `askRunner`.
  - Mensajes nuevos (es y en): `runner.noBun`, `runner.question`, `runner.useNode`, `runner.exit`, `runner.declined` ("Instala Bun y vuelve a correr el comando; no se cambió nada."), `runner.invalid({ file, detail })`.

Dónde se llama: en `main`, para `install`, `update` (sin `--dry-run`), `init` y `add`, `planRunnerEntry` corre **antes** del comando y `writeRunnerEntry` justo antes del `report` (en `commandPick`, después de `copyBundledSkill`; `commandPick` recibe el plan por un nuevo campo `runnerEntry` de su `opts` y no lo escribe con `--candidates`). Con `--candidates` no se planifica (no pregunta nada).

- [ ] **Step 1: Tests unitarios que fallan** en `test/runner-entry.test.mjs`. Un helper arma un `PATH` en un temporal: `withBun` pone un `bunx` falso (`#!/bin/sh\nexit 0`, chmod 755); `withoutBun` lo deja vacío. Cada test fija `process.env.PATH` y lo restaura.
  - `creates runner.json with bun when bunx is on PATH`: repo vacío → `planRunnerEntry` + `writeRunnerEntry` → `readRunnerConfig(root)` es `{ runner: "bun", tools: { "@ramon-sg/skills-manager": VERSION } }`.
  - `without bun and no terminal, picks node and warns`: `interactive: false` → `runner: "node"`, `plan.warning === text("runner.noBun")`.
  - `without bun in a terminal, asks`: `interactive: true`, `askRunner` devuelve `"node"` → `runner: "node"`, `warning: null`, `askRunner` llamado una vez.
  - `declining the runner question writes nothing`: `askRunner` devuelve `null` → rechaza con `key === "runner.declined"`; `.agents/runner.json` no existe.
  - `keeps other tools and unknown keys`: archivo previo `{ "$schema": "x", "runner": "node", "tools": { "@ramon-sg/issue-flow": "0.6.0" }, "extra": 1 }` → después tiene las dos entradas, `runner: "node"`, `extra: 1`; `askRunner` nunca llamado.
  - `never lowers a newer pin`: archivo con `"@ramon-sg/skills-manager": "99.0.0"` → `plan.changed === false` y el archivo no cambia ni un byte.
  - `a broken runner.json fails with its name`: `{"runner":"deno"}` → rechaza con `key === "runner.invalid"` y `message` que incluye `.agents/runner.json`.
- [ ] **Step 2:** `node --test test/runner-entry.test.mjs` → FAIL (módulo no existe).
- [ ] **Step 3:** `npm install --save-exact @ramon-sg/runner@1.0.0`; implementar `src/version.mjs`, `src/runner-entry.mjs`, `askRunner` y los mensajes.
- [ ] **Step 4:** `node --test test/runner-entry.test.mjs` → PASS.
- [ ] **Step 5: Tests de CLI que fallan** en `test/cli.test.mjs` (el helper `run` ya pasa `env`; agregar `PATH` con `git` enlazado y, según el caso, el `bunx` falso):
  - `init in an empty repo writes runner.json and nothing in package.json` (criterio del issue): repo git vacío, `init --select <local>` → `runner.json` con la entrada y `runner: "bun"`; `package.json` no existe.
  - `package.json stays byte-identical`: repo con `package.json` que tiene `"devDependencies": {"@ramon-sg/skills-manager": "1.4.0"}` → `init` y luego `install` lo dejan igual byte a byte.
  - `install and update move the entry up`: `runner.json` con `"1.0.0"` → `install` lo deja en `VERSION`.
  - `read-only commands never write runner.json`: con manifiesto y sin `runner.json`, `check`, `list`, `update --dry-run`, `init --candidates`/`add --candidates` y `session-notice` → el archivo sigue sin existir.
  - `a broken runner.json stops before writing anything`: `runner.json` con `{` → `init --select …` sale con 1, stderr nombra `.agents/runner.json`, y no existen `.agents/skills.json` ni `.agents/skills/`.
  - `without bun and no terminal, init warns in Spanish`: sin `bunx` en `PATH` → `runner: "node"`, stderr contiene el texto de `runner.noBun` en español.
- [ ] **Step 6:** `node --test test/cli.test.mjs` → FAIL en los nuevos.
- [ ] **Step 7:** cablear en `main` y `commandPick` como dice "Dónde se llama".
- [ ] **Step 8:** `npm test` → PASS completo.
- [ ] **Step 9: Commit** `feat: escribe su entrada en .agents/runner.json`.

### Task 2: la skill `manage-skills` sin `npx` fijo

**Files:**
- Modify: `skills/manage-skills/SKILL.md`, `test/cli.test.mjs` (o un test nuevo `test/bundled-skill.test.mjs`, agregado a `scripts.test`)

**Interfaces:**
- Consumes: nada de código; el texto nombra `.agents/runner.json` y el paquete `@ramon-sg/skills-manager` de Task 1.

El texto es neutral y sin versión (la versión vive solo en `runner.json`; `checkToolPins` no lee skills). Una sección "Running the command" al principio, en inglés como el resto de la skill:

> Run `@ramon-sg/skills-manager` with the runner and the version in `.agents/runner.json` (`tools["@ramon-sg/skills-manager"]`):
> - `"runner": "bun"`, or no `runner`: `bunx --bun @ramon-sg/skills-manager@<version> <command>`
> - `"runner": "node"`: `npx --yes @ramon-sg/skills-manager@<version> <command>`
>
> Never run it without `@<version>`. Below, `skills-manager <command>` means that command.

Todas las demás menciones `npx @ramon-sg/skills-manager …` pasan a `skills-manager …`; la `description` del frontmatter dice "with the `@ramon-sg/skills-manager` commands" sin `npx`.

- [ ] **Step 1: Test que falla** `the bundled skill names no fixed runner`: el `SKILL.md` empaquetado no contiene `npx @ramon-sg`, ni `npx skills-manager`, ni `--no-install`; contiene literalmente `bunx --bun @ramon-sg/skills-manager@<version>` y `npx --yes @ramon-sg/skills-manager@<version>` y `.agents/runner.json`.
- [ ] **Step 2:** correrlo → FAIL.
- [ ] **Step 3:** reescribir `SKILL.md` como arriba.
- [ ] **Step 4:** `npm test` → PASS (el test existente `init copies the bundled manage-skills skill…` compara contra el archivo, sigue pasando).
- [ ] **Step 5: Commit** `feat: manage-skills corre la herramienta según .agents/runner.json`.

### Task 3: publicar con las dependencias adentro

**Files:**
- Modify: `package.json`, `package-lock.json`, `.gitignore` (`dist/`), `test/pack.test.mjs`

**Interfaces:**
- Consumes: `src/version.mjs` (Task 1) — desde `dist/cli.mjs`, `../package.json` y `../skills` siguen apuntando a la raíz del paquete; por eso `dist/` es de un solo nivel.
- Produces: `dist/cli.mjs` (ignorado en git, generado en `prepack`).

`package.json`:
- `"bin": { "skills-manager": "dist/cli.mjs" }`; `"files": ["dist", "skills", "README.md", "LICENSE"]`.
- `@clack/prompts` y `@ramon-sg/runner` pasan a `devDependencies` (exactas); sin `dependencies`. `esbuild` exacta en `devDependencies`.
- `"build": "esbuild src/cli.mjs --bundle --platform=node --format=esm --target=node20.12 --outfile=dist/cli.mjs --banner:js=\"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\""` — el banner porque alguna dependencia de clack es CommonJS y en ESM esbuild deja `require` sin definir. El hashbang de `src/cli.mjs` se conserva solo.
- `"prepack": "npm run build"` (corre en `npm pack` y `npm publish`).

Los tests de `cli.test.mjs` siguen corriendo `src/cli.mjs`; solo `pack.test.mjs` prueba el bundle.

- [ ] **Step 1: Tests que fallan** en `test/pack.test.mjs`, sobre el tarball que ya arma:
  - el `package.json` instalado (`node_modules/@ramon-sg/skills-manager/package.json`) no tiene `dependencies` (o está vacío) y el tarball no trae `src/`;
  - `node_modules/` del proyecto solo tiene `@ramon-sg/skills-manager` (nada de `@clack`, `sisteransi`, `@ramon-sg/runner`);
  - `check` y `session-notice` como hoy, más `init --select <local>` en el proyecto con el `PATH` del `bunx` falso, que deja `runner.json` con `VERSION` (prueba que `version.mjs` resuelve desde `dist/`) y copia `manage-skills` (prueba `../skills`);
  - si `bun` está en el `PATH` real (`spawnSync("bun", ["--version"]).status === 0`), `bun --bun node_modules/.bin/skills-manager session-notice` imprime lo mismo que con Node; si no, ese caso se salta.
- [ ] **Step 2:** `node --test test/pack.test.mjs` → FAIL.
- [ ] **Step 3:** cambios de `package.json` y `.gitignore`; `npm install` para el lockfile.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `build: publica un bundle sin dependencies`.

### Task 4: CI con Node y Bun, docs y versión

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `.tool-versions`, `README.md`, `CHANGELOG.md`, `package.json` (`version`), `package-lock.json`

- [ ] **Step 1:** `.tool-versions` suma `bun 1.4.4`. `ci.yml` conserva la matriz de Node `[20.12, 24]` y suma un job `bun` (patrón de ramon-sg/runner `test.yml`): `setup-node` 24, `oven-sh/setup-bun@v2` con `bun-version-file: .tool-versions`, `npm ci`, `bun test --timeout 20000 test/`. Bajo `bun test`, `process.execPath` es Bun, así que los tests de CLI corren la herramienta con Bun.
- [ ] **Step 2:** verificar local: `ASDF_BUN_VERSION=1.4.4 bun test --timeout 20000 test/` → PASS. Si algún test de `node:test` no corre igual en Bun, arreglar el test (no saltarlo) o, si es una API que Bun no tiene, saltarlo con `skip: typeof Bun !== "undefined" && "<motivo>"` y anotarlo en el commit.
- [ ] **Step 3:** `publish.yml`: sin cambios de pasos (`npm publish` dispara `prepack`); confirmar que `npm test` corre antes.
- [ ] **Step 4: README.** "Install": `bunx --bun @ramon-sg/skills-manager init` (o `npx --yes …` con Node), explicar que `init` deja la versión en `.agents/runner.json` y cómo se corre después (la misma tabla de dos filas de Task 2). Quitar la recomendación de `devDependency`, los `scripts` y el párrafo de `npx --no-install`. Ejemplos con `skills-manager <command>` + una línea que diga qué significa. Hook `SessionStart`: `bunx --bun @ramon-sg/skills-manager@<version> session-notice` (y la variante `node`), con la versión igual a la de `runner.json`; quitar `node_modules/.bin`. Nueva sección corta ".agents/runner.json" (qué escribe, que nunca baja una versión, la pregunta sin Bun).
- [ ] **Step 5:** `CHANGELOG.md` `## 1.5.0`: Added (entrada en `runner.json`, CI con Bun), Changed (skill neutral, README sin devDependency, publicado como bundle sin `dependencies`). `npm version 1.5.0 --no-git-tag-version`.
- [ ] **Step 6:** `npm test` → PASS; `npm pack --dry-run` → lista `dist/cli.mjs`, `skills/manage-skills/SKILL.md`, `package.json`, `README.md`, `LICENSE`, sin `src/`.
- [ ] **Step 7: Commit** `chore: CI con Bun, docs de runner.json y versión 1.5.0`.

### Después del merge (con aprobación del usuario)

- Prueba manual del criterio 1 del issue con el tarball, en un repo vacío: `npx --yes -p <tgz> skills-manager init --select <local>` (con la ruta sola npx falla; spike, Step 6). Revisar `runner.json` y que no haya `package.json`.
- Release `v1.5.0` en GitHub (dispara `publish.yml`).
- Comentar en ramon-sg/agent-kitchen (issue o PR #52) que `@ramon-sg/skills-manager` 1.5.0 lee y escribe `.agents/runner.json`, y cerrar el issue #10.
