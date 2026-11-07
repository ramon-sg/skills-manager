# La terminal en español e inglés, con Kuro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** todo el texto para personas de skills-manager sale en español por defecto o en inglés con `--lang en` / `SKILLS_MANAGER_LANG=en`, y los mensajes finales salen en un bloque junto a Kuro, igual que en issue-flow.

**Architecture:** `src/lang.mjs` resuelve el idioma; `src/messages/{es,en}.mjs` son catálogos con la misma forma (textos o funciones con parámetros con nombre) y `src/messages/index.mjs` guarda el idioma activo y da `text`, `fail`, `list`. Cada módulo lanza sus errores con `fail(clave, params)`, así el `message` ya sale en el idioma activo y además lleva `key`. `src/banner.mjs` es el bloque de issue-flow portado; el CLI fija el idioma al arrancar y cierra cada comando con un bloque.

**Tech Stack:** Node ≥ 20.12, ESM `.mjs`, `node:test`, `Intl.ListFormat`, `@clack/prompts` 1.8.1. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-07-terminal-languages-and-kuro-design.md` (issue #6). Referencia: issue-flow `src/lang.ts`, `src/messages/`, `src/banner.ts` (`gh api repos/ramon-sg/issue-flow/contents/<ruta> -q .content | base64 -d`).

## Global Constraints

- Idioma: `--lang es|en` (también `--lang=en`, en cualquier posición de la línea), luego `SKILLS_MANAGER_LANG` (vacío = no puesto), luego `es`. `LANG` y `LC_ALL` no se leen. Valor inválido: error de uso, exit 2, en español.
- `session-notice` nunca falla: idioma inválido → español + una línea `skills-manager: …` en stderr, exit 0. Su stdout no cambia ni un byte.
- `--candidates` no cambia ni un byte entre idiomas (sus `note` siguen en inglés). Manifiesto, lock, `project.md` y settings no cambian.
- Frases completas por idioma con parámetros con nombre; nada de concatenar pedazos traducidos. Listas dentro de frases con `list()` (`Intl.ListFormat`, `conjunction`). Plurales con formas explícitas por idioma.
- Comandos, flags, rutas, nombres de skill, `owner/repo`, shas y versiones no se traducen.
- Glosario español: *skill*, *manifiesto*, *lock*, *origen*, *catálogo*, *marketplace*, *plugin*, *skill propia*, *reemplazar*. Tuteo. Tildes y `¿?` correctos.
- Texto de git, `JSON.parse` o fs no se traduce: frase del catálogo y el detalle original debajo, tal cual.
- Kuro solo si el stream donde se escribe es TTY; `NO_COLOR` no vacío o sin TTY → sin color. Mismo dibujo, marcas, colores y columnas que `banner.ts`.
- Versión **1.4.0**. Mensajes de commit en español, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `test/no-project-names.test.mjs` sigue pasando. Cada test nuevo se agrega a `scripts.test` de `package.json` (la lista es explícita).

## Review Focus

1. **`--lang` antes del subcomando** (`skills-manager --lang en check`): hoy el subcomando es `argv[2]`. Debe funcionar igual que después. Test en la Task 3.
2. **Salida en pipe o CI sin `NO_COLOR`:** ni un `\x1b[` ni el dibujo de Kuro. Test en la Task 3 (spawn sin TTY).
3. **Error de git dentro de una frase traducida:** el stderr de git aparece entero debajo de la frase, no se pierde ni se corta. Test en la Task 5.
4. **`--candidates` igual en los dos idiomas:** misma salida byte a byte con `es` y `en`. Test en la Task 6.
5. **`SKILLS_MANAGER_LANG=fr` con `session-notice`:** exit 0, stdout igual al de siempre, aviso en stderr. Test en la Task 3.

---

### Task 1: Idioma y catálogos

**Files:**
- Create: `src/lang.mjs`, `src/messages/index.mjs`, `src/messages/es.mjs`, `src/messages/en.mjs`
- Test: `test/messages.test.mjs` (y agregarlo a `scripts.test`)

**Interfaces:**
- Produces:
  - `resolveLang(flag: string|undefined, env: object): "es"|"en"`: lanza `fail("lang.invalid", { source, value }, { exitCode: 2 })` con `source` = `"--lang"` o `"SKILLS_MANAGER_LANG"`. Ese texto se dice en español aunque el idioma activo sea otro (se arma con el catálogo `es`).
  - `takeLang(args: string[]): { rest: string[], flag: string|undefined }`: saca `--lang x` y `--lang=x` de cualquier posición. Si `--lang` va sin valor (o el siguiente empieza con `--`), lanza `fail("lang.missing", {}, { exitCode: 2 })` en español.
  - `setLang(lang)`, `getLang()`; el idioma por defecto del módulo es `"es"`.
  - `msg(): Messages`: el catálogo activo.
  - `text(key: string, params?: object): string`: resuelve una clave con puntos (`"check.ok"`); si es función la llama con `params`. Si la clave no existe, lanza un `Error` (no se traduce: es un bug del programa).
  - `fail(key, params = {}, props = {}): Error`: devuelve (no lanza) un `Error` con `message = text(key, params)`, `key`, `params` y cada prop (`exitCode`, …). Si `params.detail` existe, el mensaje termina con `\n` + el detalle con cada línea indentada 2 espacios.
  - `list(items: string[]): string`: `Intl.ListFormat(getLang(), { type: "conjunction" })`.
  - `es.mjs` exporta `es` y `/** @typedef {typeof es} Messages */`; `en.mjs` exporta `en` anotado `/** @type {import("./es.mjs").Messages} */`.
  - Esta tarea crea las áreas `lang` y `usage` (con `usage.main`, la ayuda completa); cada tarea siguiente agrega sus claves a los dos catálogos.

- [ ] **Step 1: Escribir los tests que fallan** en `test/messages.test.mjs`:
  - `same keys at every depth`: recorre `es` y `en` y compara el conjunto de rutas de claves.
  - `same kind per key`: en cada ruta los dos son `string` o los dos `function`.
  - `functions use the same parameters`: para cada función, la llama con un `Proxy` que devuelve `"«<nombre>»"` por cada propiedad leída y anota qué propiedades se leyeron; el conjunto leído es el mismo en `es` y `en`, y cada `«<nombre>»` leído aparece en la salida de los dos. (Los parámetros numéricos como `count` se prueban con `count: 1` y `count: 2` aparte, para no romper los plurales.)
  - `no empty text`: ningún string ni salida de función es `""`.
  - `resolveLang`: `(undefined, {})` → `"es"`; `(undefined, { SKILLS_MANAGER_LANG: "en" })` → `"en"`; `("es", { SKILLS_MANAGER_LANG: "en" })` → `"es"`; `(" EN ", {})` → `"en"`; `(undefined, { SKILLS_MANAGER_LANG: "" })` → `"es"`; `(undefined, { LANG: "en_US.UTF-8" })` → `"es"`; `("fr", {})` lanza con `exitCode === 2`, `key === "lang.invalid"` y un mensaje que contiene `--lang` y `fr`, en español aunque antes se haya hecho `setLang("en")`.
  - `takeLang`: `["--lang", "en", "check"]` → `{ rest: ["check"], flag: "en" }`; `["check", "--lang=en"]` igual; `["check", "--lang"]` lanza con `exitCode === 2`.
  - `fail`: `fail("lang.invalid", { source: "--lang", value: "fr" }, { exitCode: 2 })` es `instanceof Error`, con `key`, `params` y `exitCode`; con `params.detail = "a\nb"` el mensaje termina en `"\n  a\n  b"`.
  - `list`: con `es`, `list(["a","b","c"])` → `"a, b y c"`; con `en` → `"a, b, and c"`.
- [ ] **Step 2: Correr y ver que falla**: `node --test test/messages.test.mjs` → FAIL (no existe `src/lang.mjs`).
- [ ] **Step 3: Implementar** `src/lang.mjs` y `src/messages/*` con las firmas de arriba. `usage.main` lista cada subcomando (`install`, `update [name] [--dry-run]`, `check`, `list`, `session-notice`, `init`, `add`), cada flag (`--replace <names>`, `--catalog <repo>`, `--repo <owner/name>`, `--ref <ref>`, `--path <dir>`, `--candidates`, `--select <ids>`, `--lang es|en`, `--help`) y `SKILLS_MANAGER_LANG`, con una línea de qué hace cada uno (tomar el qué hace del bloque `@file` de `src/cli.mjs` y del `USAGE` de `src/pick.mjs`).
- [ ] **Step 4: Correr y ver que pasa**: `node --test test/messages.test.mjs` → PASS.
- [ ] **Step 5: Commit** `feat: agrega el idioma y los catálogos de mensajes`.

### Task 2: El bloque con Kuro

**Files:**
- Create: `src/banner.mjs`
- Test: `test/banner.test.mjs` (y agregarlo a `scripts.test`)

**Interfaces:**
- Produces:
  - `KURO: readonly string[]`, `banner(block, { art, color }): string`: port fiel de `banner.ts` de issue-flow (mismas columnas `TEXT_COLUMN = 26`, `INDENT = 2`, marcas `[ok]`/`[!]`/`[?]`, colores 32/31/33, comando en negrita, línea en blanco antes y después). `block = { mood: "ok"|"error"|"question", title, rows?: [label, value][], next?: { label, command }, lines?: string[] }`.
  - `blockStyle(stream, env): { art: boolean, color: boolean }`: `art = stream.isTTY === true`; `color = art && !(env.NO_COLOR)` (un `NO_COLOR` vacío no cuenta).
  - `printBlock(block, stream = process.stdout, env = process.env): void`: escribe `banner(block, blockStyle(stream, env))` en `stream`.

- [ ] **Step 1: Tests que fallan**: `banner({ mood: "ok", title: "Listo" }, { art: false, color: false })` === `"\n  [ok] Listo\n\n"`; con `art: true` las 4 líneas de `KURO` aparecen y el título empieza en la columna 26 de la segunda línea; filas alineadas al ancho de la etiqueta más larga + 2; un `next.command` de 200 caracteres sale entero en una línea; con `color: false` no hay `\x1b[`; con `color: true` el título va en `\x1b[32m`. `blockStyle({ isTTY: true }, {})` → `{ art: true, color: true }`; `({ isTTY: true }, { NO_COLOR: "1" })` → `{ art: true, color: false }`; `({ isTTY: true }, { NO_COLOR: "" })` → color `true`; `({}, {})` → `{ art: false, color: false }`.
- [ ] **Step 2:** `node --test test/banner.test.mjs` → FAIL.
- [ ] **Step 3: Implementar** `src/banner.mjs`.
- [ ] **Step 4:** `node --test test/banner.test.mjs` → PASS.
- [ ] **Step 5: Commit** `feat: agrega el bloque de los mensajes finales con Kuro`.

### Task 3: El CLI habla el idioma: `--lang`, `--help`, `check`, `list`, errores y `session-notice`

**Files:**
- Modify: `src/cli.mjs` (`main`, `commandCheck`, `commandList`, `commandSessionNotice`, `driftProblems`, `takeReplace`)
- Modify: `test/cli.test.mjs`, `test/catalog.test.mjs`, `test/repo.test.mjs`, `test/notice.test.mjs`: los helpers que hacen `spawnSync` del CLI pasan `SKILLS_MANAGER_LANG: "en"` en `env` (a menos que el test diga otro), y las comparaciones con `✅`/`❌` pasan a `[ok]`/`[!]`.
- Test: `test/cli-lang.test.mjs` (nuevo, en `scripts.test`)

**Interfaces:**
- Consumes: `takeLang`, `resolveLang`, `setLang`, `msg`, `text`, `fail` (Task 1); `printBlock` (Task 2).
- Produces:
  - En `main()`: `takeLang` sobre `process.argv.slice(2)` **antes** de elegir el subcomando; luego `setLang(resolveLang(flag, process.env))`. Un error aquí sale como bloque `[!]` en stderr y exit 2.
  - `--help`, `-h` o `help` (como subcomando o en cualquier posición) → `msg().usage.main` a stdout, exit 0, sin bloque.
  - `printError(error)`: bloque `{ mood: "error", title, lines }` en stderr. Si el error tiene `key`, `title` = primera línea del mensaje y `lines` = el resto. Si no tiene `key` (error de git, Node o fs que nadie envolvió), `title = text("errors.unexpected")` y `lines` = el mensaje original entero.
  - `check` bien: bloque `{ mood: "ok", title: text("check.ok") }` en stdout. `check` mal: bloque `{ mood: "error", title: text("check.drift"), rows: [[etiqueta del problema, list(nombres)]…], next: { label: text("next.run"), command: "skills-manager install" } }` en stderr, exit 1. Las etiquetas de `driftProblems` salen de claves `check.problems.*`.
  - `list`: mismas líneas de hoy, sin bloque; `"(newer version available)"` sale de `list.newer`.
  - `session-notice`: resuelve el idioma con `resolveLang` dentro de un `try`; si falla, usa `es` y escribe `skills-manager: <mensaje>` en stderr. Las otras dos líneas de stderr salen de claves `notice.*`. Nunca usa bloques.
  - Errores de `takeReplace`, del `--replace` sin subcomando válido y del subcomando desconocido → `fail(..., { exitCode: 2 })`.

- [ ] **Step 1: Tests que fallan** en `test/cli-lang.test.mjs` (mismo armado de repo temporal que `cli.test.mjs`; puede importar o copiar sus helpers):
  - `check` con todo al día y sin `SKILLS_MANAGER_LANG`: exit 0, la salida contiene `[ok]` y el texto de `es.check.ok`.
  - `check --lang en`, `--lang=en check` y `--lang en check` (antes del subcomando): exit 0, contiene `en.check.ok`.
  - `SKILLS_MANAGER_LANG=en check`: `en.check.ok`. `SKILLS_MANAGER_LANG=en check --lang es`: `es.check.ok`.
  - `LANG=en_US.UTF-8 check`: sale en español.
  - `check` con una skill borrada del disco: exit 1, stderr contiene `[!]`, `es.check.problems.missing`, el nombre de la skill y `skills-manager install`.
  - Salida sin TTY (spawn normal) y sin `NO_COLOR`: no contiene `\x1b[` ni `▄█████▄` (Review Focus 2).
  - `check --lang fr`: exit 2, stderr en español, contiene `--lang` y `fr`. `SKILLS_MANAGER_LANG=fr check --lang en` sale en inglés (el flag gana y la variable no se valida).
  - `--help` y `--help --lang en`: exit 0; cada salida contiene `install`, `update`, `check`, `list`, `session-notice`, `init`, `add`, `--dry-run`, `--replace`, `--catalog`, `--repo`, `--ref`, `--path`, `--candidates`, `--select`, `--lang` y `SKILLS_MANAGER_LANG`; las dos salidas son distintas.
  - Subcomando desconocido: exit 2, `[!]`, en español.
  - `session-notice` con `SKILLS_MANAGER_LANG=fr`: exit 0, stdout idéntico al de sin variable, stderr con una línea que empieza con `skills-manager:` (Review Focus 5).
- [ ] **Step 2:** `node --test test/cli-lang.test.mjs` → FAIL.
- [ ] **Step 3: Implementar** lo de Interfaces en `src/cli.mjs`, con las claves nuevas en `es.mjs` y `en.mjs`, y pasar `SKILLS_MANAGER_LANG: "en"` en los helpers de los tests existentes.
- [ ] **Step 4:** `npm test` → PASS completo.
- [ ] **Step 5: Commit** `feat: el CLI elige idioma, tiene --help y cierra check con el bloque`.

### Task 4: `install` y `update` en el idioma, con su bloque

**Files:**
- Modify: `src/cli.mjs` (`assertUntouched`, `describeChanges`, `droppedEditable`, `assertNoCollisions`, `OwnSkillsError`, `installAll`, `installAsking`, `describeSource`, `collectLocal`, `main`), `src/lib.mjs` (`findCollisions`, `keptText`)
- Test: `test/cli-lang.test.mjs`, `test/lib.test.mjs`

**Interfaces:**
- Consumes: Task 1, Task 2, `printError` (Task 3).
- Produces:
  - `installAll(root, opts)` ya no recibe `log`; devuelve `{ changed: boolean, changes: string[], noManifest?: true }`. `changes` son las líneas de `describeChanges`, ahora de claves `install.change.*` (`removed`, `added`, `addedReplacing`, `moved`, `overwritten`, `editableReplaced`, `editableRemoved`).
  - Después de `install`/`update`, `main` imprime en stdout:
    - con cambios escritos: `{ mood: "ok", title: text("install.done"), lines: changes }`;
    - sin cambios: `{ mood: "ok", title: text("install.upToDate") }`;
    - `update --dry-run`: `{ mood: "question", title: text("install.dryRun"), lines: changes }` (si no hay cambios, `install.upToDate`);
    - sin manifiesto: `{ mood: "question", title: text("install.noManifest", { file }), next: { label: text("next.start"), command: "skills-manager init" } }`.
  - `OwnSkillsError(clashes, skills, hint)` conserva su forma; `hint` sale de `install.ownHint` con `{ names, each }`. `installAsking` lanza `fail("install.nothingChanged", { clashes })` cuando la persona dice que no.
  - `findCollisions` y `keptText` devuelven texto del catálogo activo (`collisions.*`, `kept.*`); `keptText([])` en es → algo como `"no se conserva nada de su carpeta"`, `keptText(["project.md"])` → contiene `project.md`.

- [ ] **Step 1: Tests que fallan**:
  - `test/lib.test.mjs` hace `setLang("en")` arriba (los textos en inglés que ya compara siguen valiendo) y agrega un `describe` con `setLang("es")` para `keptText` y `findCollisions` que comprueba que el texto en español contiene los nombres y no contiene la palabra inglesa `"already exists"`.
  - `test/cli-lang.test.mjs`: primer `install` sobre el repo de prueba sale con exit 0, `[ok]`, `es.install.done` y el nombre de cada skill nueva; un segundo `install` dice `es.install.upToDate`; `update --dry-run` tras publicar un commit nuevo dice `[?]` y `es.install.dryRun`; `install` sin manifiesto dice `es.install.noManifest` y `skills-manager init`; una skill editada a mano antes de `update` falla con `[!]` y contiene `rm -rf` y `skills-manager update <nombre>` enteros.
- [ ] **Step 2:** `node --test test/lib.test.mjs test/cli-lang.test.mjs` → FAIL.
- [ ] **Step 3: Implementar** con las claves nuevas en los dos catálogos. Los nombres en las frases van con `list()`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: install y update hablan el idioma y cierran con el bloque`.

### Task 5: Los errores de los módulos de datos

**Files:**
- Modify: `src/lib.mjs` (`assertOptionalFields`, `parseManifest`, `resolvePluginSource`, `picksToSources`), `src/git.mjs`, `src/catalog.mjs`, `src/catalog-plan.mjs`, `src/state.mjs`, `src/repo-source.mjs`
- Test: `test/lib.test.mjs`, `test/catalog-lib.test.mjs`, `test/repo-source.test.mjs`, `test/catalog.test.mjs`, `test/repo.test.mjs`, `test/cli-lang.test.mjs`

**Interfaces:**
- Consumes: `fail`, `text` (Task 1); `printError` (Task 3).
- Produces:
  - Cada `throw new Error(...)` de estos archivos pasa a `throw fail("errors.<área>.<caso>", params)`, con áreas `manifest`, `lock`, `git`, `catalog`, `repo`, `source`. Las propiedades que hoy se agregan (`exitCode`, …) se pasan en `props`.
  - `git()` en `src/git.mjs`: cuando `execFileSync` falla, lanza `fail("errors.git.failed", { args: args.join(" "), detail: <stderr de git, o el message original si no hay stderr> })`. El `detail` va entero (Review Focus 3).
  - `repo-source.mjs:136` usa `detail: error.message` en vez de pegarlo en la frase.
- Los tests en proceso que hoy comparan texto en inglés con `assert.throws(..., /regex/)` hacen `setLang("en")` al comienzo del archivo; donde la regex compara una frase entera (no un dato como un nombre o una ruta) pasa a comparar `{ key: "errors.…" }`.

- [ ] **Step 1: Tests que fallan**:
  - `test/catalog-lib.test.mjs`: las 4 aserciones de las líneas 98–101 pasan a `assert.throws(fn, { key: "errors.…" })` con la clave de cada caso.
  - `test/lib.test.mjs`: `parseManifest("{}")` lanza con `key === "errors.manifest.noSources"`; con `setLang("es")` su mensaje contiene `"sources"` y no contiene `"needs"`.
  - `test/cli-lang.test.mjs`: un manifiesto con un `repo` `file://` que no existe → exit 1, stderr con `[!]`, la frase de `es.errors.git.failed` y, debajo, una línea del stderr original de git (`fatal:` o `does not appear to be a git repository`).
- [ ] **Step 2:** `npm test` → FAIL en los tests nuevos.
- [ ] **Step 3: Implementar**; cada clave nueva en `es.mjs` y `en.mjs`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat: los errores de manifiesto, lock, git y catálogos salen en el idioma`.

### Task 6: `init` / `add`: menús, preguntas y errores de uso

**Files:**
- Modify: `src/prompt.mjs`, `src/pick.mjs`, `src/lib.mjs` (`menuOptions`, `catalogMenu`, `pickSummary`, `parseSelect`/`picksToSources` si tienen texto), `src/cli.mjs` (bloque final de `init`/`add`)
- Test: `test/lib.test.mjs`, `test/cli-lang.test.mjs`, `test/repo.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - Todo texto de `prompt.mjs` sale de `prompt.*`: cancelado, ayudas de teclas, `intro`, títulos de `note`, `outro`, y `confirm` con `active: text("prompt.yes")` / `inactive: text("prompt.no")` también en la pregunta de reemplazar. Las `multiselect`/`groupMultiselect` pasan `required: false` y, si la persona no marca nada, se muestra `text("prompt.pickOne")` con `log.warn` de clack y se vuelve a preguntar (reemplaza el texto fijo en inglés de clack).
  - `noteText(note: string): string` en `src/lib.mjs`: traduce los `note` conocidos (`"not on disk"`, `"no skills"`, `"could not read marketplace <m>"`, `OTHER_REPO_NOTE` de `repo-source.mjs`) y devuelve cualquier otro tal cual. Los `note` de los candidatos no cambian; `noteText` se usa en `menuOptions` (lista de "no se puede elegir") y en el error de `picksToSources` (`"… cannot be picked: <note>"`).
  - `menuOptions` (`"yours"`, `"N skill(s)"`) y `pickSummary` (`"(yours)"`, `"(all, N)"`) toman texto de `pick.*`, con plural explícito por idioma.
  - Errores de `pick.mjs` (`usageError`, `USAGE`, `NOTHING_NEW`, ya existe / no existe el manifiesto) → `fail("pick.*", params, { exitCode })` conservando el exit code de hoy.
  - Al terminar `init`/`add` con éxito, `main` imprime el bloque de la instalación (Task 4) con `title = text(init ? "pick.initDone" : "pick.addDone")`.

- [ ] **Step 1: Tests que fallan**:
  - `test/lib.test.mjs` con `setLang("es")`: `menuOptions([{ id: "p@m", kind: "plugin", skills: ["a"] }])` → label `"p · 1 skill"`; con `skills: ["a","b"]` → `"p · 2 skills"`; un candidato `local` → label con el texto de `es.pick.yours`; un candidato con `note: "not on disk"` → `hidden` contiene `noteText("not on disk")` y no contiene `"not on disk"`. `noteText("algo raro")` → `"algo raro"`.
  - `test/cli-lang.test.mjs`: `add --candidates` con `SKILLS_MANAGER_LANG=es` y con `en` dan stdout idéntico byte a byte (Review Focus 4). `add --select` sin valor: exit 2, `[!]`, en español. `init` cuando ya hay manifiesto: exit 1, contiene `skills-manager add`. `init --select <id>` sin TTY: exit 0, `[ok]` y `es.pick.initDone`.
- [ ] **Step 2:** `npm test` → FAIL en los nuevos.
- [ ] **Step 3: Implementar**; claves en los dos catálogos.
- [ ] **Step 4:** `npm test` → PASS. Además, a mano en una terminal: `node src/cli.mjs add` en un repo con manifiesto, en `es` y con `--lang en`; los menús, `Sí/No` y el bloque final salen en el idioma, sin nada en inglés en `es`.
- [ ] **Step 5: Commit** `feat: los menús y preguntas de init y add hablan el idioma`.

### Task 7: Que no se cuele texto suelto, docs y versión

**Files:**
- Create: `test/no-loose-text.test.mjs` (en `scripts.test`)
- Modify: `README.md`, `CHANGELOG.md`, `package.json`

**Interfaces:**
- Consumes: todo lo anterior.

- [ ] **Step 1: Test que falla (o pasa si las tareas anteriores no dejaron nada)**: `test/no-loose-text.test.mjs` lee cada `src/**/*.mjs` fuera de `src/messages/` y falla, con archivo y línea, si encuentra `new Error(` seguido de una comilla o backtick, `usageError(` seguido de una comilla o backtick, o `console.(log|error)(` seguido de una comilla o backtick. Se permite solo `console.log(JSON.stringify(` (salida de `--candidates`).
- [ ] **Step 2:** `node --test test/no-loose-text.test.mjs`; si falla, mover cada texto que encuentre a los catálogos.
- [ ] **Step 3: Docs y versión**: `package.json` → `"version": "1.4.0"`. `CHANGELOG.md`: entrada `1.4.0` con el idioma (`--lang`, `SKILLS_MANAGER_LANG`, español por defecto), Kuro, `--help`, y el aviso de que la salida por defecto pasa a español y los `✅`/`❌` pasan al bloque (`SKILLS_MANAGER_LANG=en` para scripts que lean el texto). `README.md`: una sección corta sobre el idioma y `--help`, en el idioma en que ya está escrito el README.
- [ ] **Step 4:** `npm test` → PASS completo.
- [ ] **Step 5: Commit** `chore: test contra texto suelto, docs y versión 1.4.0`.
