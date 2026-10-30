# `add --repo` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `add --repo <owner/name>` lista e instala skills de un repo de GitHub sin tener el plugin ni el marketplace en la máquina, con `--candidates` y `--select` como hoy.

**Architecture:** No hay un tipo de origen nuevo. Cada skill elegida se escribe como una entrada `repo` de las que ya existen (`{ repo, path, ref? }`, con `path` a la carpeta de la skill), así `update <name>` mueve solo esa entrada sin más trabajo. Lo nuevo es (1) leer un repo bajado para listar sus skills, con marketplace o sin él (`src/repo-source.mjs`), (2) que `install` reescriba las referencias `plugin:skill` de las entradas `repo` que viven dentro de un plugin del marketplace, deduciendo el plugin del `marketplace.json` del árbol bajado, y (3) los flags `--repo`, `--ref` y `--path` en `init` / `add`.

**Tech Stack:** Node ≥ 20.12, ESM, `node:test`, git por `execFileSync`, `@clack/prompts` para el menú.

**Spec:** GitHub issue #4, "add no agrega skills de un repo de GitHub" (`gh issue view 4`). Decisión tomada con el autor el 2026-10-29: una entrada `repo` por skill, sin campos nuevos en el manifiesto.

## Global Constraints

- Fuera de alcance: repos fuera de GitHub y cambiar los orígenes `catalog` y `local`. (`--repo` acepta además `https://` y `file://` porque `catalogRepo` ya los acepta y los tests los necesitan; no se agrega nada específico para otros hosts.)
- El formato del manifiesto no cambia: una entrada `repo` sigue siendo `{ repo, path, ref? }`. Tampoco cambia `lockVersion`.
- Todo valor que viene de datos (repo, ref, path, nombres) pasa por `assertRepo` / `assertRelPath` / `assertSkillName` antes de tocar git o el disco (`src/git.mjs`).
- Las entradas `repo` sin `ref` siguen al HEAD como hoy. No se pasan a "tag `vX.Y.Z` más alto", eso es solo de `catalog`.
- Ningún archivo de `src/` nombra repos reales (`expo`, `hono`, `vercel`); en los tests se usan orígenes `file://` temporales, sin red.
- Los mensajes de commit van en español, como los últimos del repo, y terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Agregar después una skill hermana del mismo plugin.** A está instalada y referencia `demo:beta`. Un `add` posterior trae `beta`. Lo esperable es que A pase a decir `beta` igual que con un origen `plugin`, donde cambiar la lista `skills` reconstruye la fuente. Lo cubre la Task 3 (las entradas existentes del mismo repo se reconstruyen en su commit del lock cuando cambia el conjunto de hermanas).
2. **Quitar una hermana.** Se borra `beta` del manifiesto. A tiene que volver a `demo:beta` en el próximo `install`. Lo cubre la Task 3.
3. **`--ref` con un tag anotado o con un nombre que solo coincide con el final de una rama** (`main` frente a `feature/main`). El lock tiene que guardar el sha del commit de ese ref exacto. Lo cubre la Task 2, que usa `latestRelease`.
4. **Plugin del marketplace con `source` externo** (`{ source: "github" }` o `"url"`). No se puede elegir: aparece en `--candidates` con `note: "plugin in another repo"`, en vez de fallar o de instalar del repo equivocado. Lo cubre la Task 1.
5. **Repetir un `add` del mismo repo.** Las skills ya presentes en el manifiesto (misma clave `repo/path`) no aparecen como candidatas, y un plugin con todas sus skills ya tomadas desaparece. Lo cubre la Task 4.

---

## File Structure

- Create `src/repo-source.mjs`: lee un repo ya bajado. Lista sus skills por plugin del marketplace o por carpeta, y dice a qué plugin pertenece una ruta. Lee del disco, no usa git.
- Modify `src/cli.mjs`: `describeSource` (ref exacto), `planSource` (reconstruir hermanas), `fetchPlans` (un fetch por repo+commit), `collectSkills` (reescribir referencias en entradas `repo`).
- Modify `src/lib.mjs`: validar las entradas `repo` en `parseManifest`; candidatos `repo-plugin` / `repo-skill` en `picksToSources`, `menuOptions` y `pickSummary`.
- Modify `src/pick.mjs`: flags `--repo`, `--ref` y `--path`; `repoCandidates`.
- Modify `src/prompt.mjs`: un `repo-plugin` pregunta "¿todas o algunas?" igual que un `plugin`.
- Create `test/repo-source.test.mjs` (árboles en carpetas temporales, sin git) y `test/repo.test.mjs` (orígenes git `file://`, CLI de punta a punta, mismo estilo que `test/catalog.test.mjs`). Agregar los dos al script `test` de `package.json`.
- Modify `README.md`, `skills/manage-skills/SKILL.md`, `CHANGELOG.md` (1.3.0) y `package.json` (versión 1.3.0), como en el PR #3.

---

### Task 1: Leer las skills de un repo bajado

**Files:**
- Create: `src/repo-source.mjs`
- Test: `test/repo-source.test.mjs`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces:
  - `readRepoSkills(tree: string, base = "skills"): { plugins: Array<{ name: string, skills: Array<{ name, path }>, note?: string }> } | { skills: Array<{ name, path }> }`. Con `.claude-plugin/marketplace.json` devuelve `plugins`, si no devuelve `skills`. `path` es POSIX, relativo a la raíz del repo y normalizado (`"plugins/demo/skills/alpha"`, nunca `"./..."`).
  - `pluginOfPath(tree: string, skillPath: string): string | undefined`: el nombre del plugin del marketplace cuya lista de skills incluye `skillPath`, o `undefined` si no hay marketplace o ningún plugin la incluye.
  - `MARKETPLACE_FILE = ".claude-plugin/marketplace.json"`.

Reglas que fija la issue y lo que se vio en los repos reales:
- `source` de un plugin que empieza con `./` es la raíz del plugin dentro del repo (`"./"` es la raíz del repo). Sus skills salen de `plugin.skills` si existe (rutas relativas a la raíz del plugin; una ruta con `SKILL.md` es una skill, una sin él aporta sus subcarpetas con `SKILL.md`). Si no existe, salen de `<raíz del plugin>/skills/*` con `SKILL.md`.
- Un plugin con `source` que no es relativo queda con `skills: []` y `note: "plugin in another repo"`.
- Sin marketplace, se listan las carpetas `<base>/*` con `SKILL.md`.
- El nombre de la skill es el nombre de la carpeta. Una carpeta cuyo nombre no pasa `assertSkillName`, o que es un symlink o sale del árbol (`insideTree`), se salta sin error. Resultado ordenado por nombre.
- Un `marketplace.json` que no es JSON hace fallar con un mensaje que nombra el archivo.

- [x] **Step 1: Write the failing tests** en `test/repo-source.test.mjs`:
  - `"a marketplace plugin without a skills list gives its skills/ folders"`: marketplace `{ plugins: [{ name: "demo", source: "./plugins/demo" }] }` y carpetas `plugins/demo/skills/{alpha,beta}/SKILL.md` más `plugins/demo/skills/README.md`. Espera `{ plugins: [{ name: "demo", skills: [{ name: "alpha", path: "plugins/demo/skills/alpha" }, { name: "beta", path: "plugins/demo/skills/beta" }] }] }`.
  - `"a plugin skills list is followed, with source ./ as the repo root"`: `{ name: "demo", source: "./", skills: ["./skills/alpha", "./extra"] }`, con `skills/alpha/SKILL.md`, `skills/gamma/SKILL.md` (no listada) y `extra/delta/SKILL.md`. Espera las skills `alpha` (`skills/alpha`) y `delta` (`extra/delta`), sin `gamma`.
  - `"a plugin from another repo has no skills and a note"`: `source: { source: "github", repo: "o/r" }`. Espera `{ name, skills: [], note: "plugin in another repo" }`.
  - `"without a marketplace it lists base/* with SKILL.md"`: con base por defecto y con `base = "tools/skills"`.
  - `"invalid folder names and symlinks are skipped"`.
  - `"pluginOfPath names the plugin that holds the path, or undefined"`: `pluginOfPath(tree, "plugins/demo/skills/alpha") === "demo"`, una ruta fuera de cualquier plugin da `undefined`, y un árbol sin marketplace da `undefined`.
- [x] **Step 2:** Agregar `test/repo-source.test.mjs` al script `test` y correr `node --test test/repo-source.test.mjs`. Esperado: FAIL (no existe el módulo).
- [x] **Step 3:** Implementar `readRepoSkills`, `pluginOfPath` y `MARKETPLACE_FILE` en `src/repo-source.mjs`. Reusar `assertRelPath`, `assertSkillName`, `insideTree` de `git.mjs` y `SKILL_FILE`, `readJson` de `state.mjs`. El `@file` explica las dos formas de repo. `pluginOfPath` usa `readRepoSkills` y busca la ruta exacta.
- [x] **Step 4:** `npm test`. Esperado: todo PASS.
- [x] **Step 5: Commit** `feat: lee las skills de un repo bajado, con marketplace o sin él`.

---

### Task 2: Validar las entradas `repo` y seguir un `ref` exacto

**Files:**
- Modify: `src/lib.mjs` (`parseManifest`)
- Modify: `src/cli.mjs:88-92` (`describeSource`)
- Test: `test/lib.test.mjs`, `test/repo.test.mjs` (nuevo; agregarlo al script `test`)

**Interfaces:**
- Consumes: `latestRelease(repo, ref)` de `src/catalog.mjs` (ya existe y devuelve `{ commit, tag? }` con el sha del commit, también para tags anotados).
- Produces: `describeSource(entry, marketplaces)` para una entrada `repo` devuelve `{ repo, sha, path }` cuando hay `ref`, con el `sha` resuelto por `latestRelease`, de modo que `latestCommit` lo devuelve tal cual. Sin `ref` devuelve `{ repo, path }` como hoy (HEAD). Además `test/repo.test.mjs` define los helpers que usan las Tasks 3 y 4: `makeOrigin()`, `commit(root, msg) -> sha`, `cli(args) -> { status, stdout, stderr }`, `lock()`, `setSources(sources)` y `writeMarketplace(root, plugins)`, copiados del estilo de `test/catalog.test.mjs`.

- [x] **Step 1: Write the failing tests**
  - `test/lib.test.mjs`: `"a repo source needs a relative path and a valid ref"`. `parseManifest` rechaza `{ repo: "o/r" }` (sin `path`), `{ repo: "o/r", path: "../x" }`, `{ repo: "o/r", path: "s", ref: "-x" }` y `{ repo: "o/r", path: "s", ref: 3 }`, y acepta `{ repo: "o/r", path: "skills/a", ref: "v1" }`.
  - `test/repo.test.mjs`, `describe("repo ref")`:
    - `"a ref pinned to an annotated tag locks the commit, not the tag object"`: entrada `{ repo: "file://…", path: "skills/alpha", ref: "v1.0.0" }` con un tag anotado. `lock().skills.alpha.commit` es igual a `git rev-parse v1.0.0^{commit}`.
    - `"a ref that only matches the end of another branch name stops instead of following it"`: el origen solo tiene `feature/main` y `ref: "main"`. El `install` sale con 1 y stderr dice `has no main`.
- [x] **Step 2:** `node --test test/lib.test.mjs test/repo.test.mjs`. Esperado: FAIL.
- [x] **Step 3:** En `parseManifest`, para el tipo `repo`, validar `path` con `assertRelPath` y `ref` con la misma regla que `assertCatalogEntry`: string no vacío que no empieza con `-` (sacar la regla a una función compartida de `catalog.mjs` en vez de copiarla). En `describeSource`, si `entry.ref !== undefined`, poner `sha: latestRelease(repo, entry.ref).commit`.
- [x] **Step 4:** `npm test`. Esperado: todo PASS, sin tocar los tests de `cli.test.mjs` que usan `repo`.
- [x] **Step 5: Commit** `fix: una entrada repo con ref fija el commit de ese ref exacto`.

---

### Task 3: Reescribir referencias entre skills del mismo plugin en entradas `repo`

**Files:**
- Modify: `src/cli.mjs` (`collectSkills`, `planSource`, `fetchPlans`)
- Test: `test/repo.test.mjs`

**Interfaces:**
- Consumes: `pluginOfPath(tree, skillPath)` (Task 1) y `rewritePluginRefs(text, plugin, installed)` de `lib.mjs`.
- Produces: el plan de una entrada `repo` lleva `siblings: Set<string>`, con los nombres (basename de `path`) de todas las entradas `repo` del manifiesto con el mismo repo resuelto, incluida ella misma. `collectSkills` usa ese conjunto como `installed`.

Reglas:
- En una entrada `repo` (no `plugin`), si `pluginOfPath(tree, plan.root)` da un plugin, los archivos de texto de la skill se reescriben con `rewritePluginRefs(text, plugin, plan.siblings)`. Si no da nada, quedan como hoy.
- Paridad con `plugin`: en `planSource`, una entrada `repo` que ya está en el lock y en disco se reconstruye **en su commit del lock** cuando el conjunto de hermanas del manifiesto difiere del conjunto de nombres del lock que comparten su `repo` (URL resuelta). `assertUntouched` sigue aplicando antes de reconstruir.
- `fetchPlans` baja una sola vez cada par `repo`+`commit`: guarda `${repo}@${commit}` → carpeta y lo reusa.

- [x] **Step 1: Write the failing tests** en `test/repo.test.mjs`, `describe("repo sources inside a marketplace plugin")`. El origen tiene marketplace `{ name: "demo", source: "./plugins/demo" }`, `plugins/demo/skills/alpha/SKILL.md` = `"Use demo:beta and other:beta.\n"` y `plugins/demo/skills/beta/SKILL.md`.
  - `"references to a sibling in the manifest are rewritten; others are left"`: con las dos entradas, `alpha/SKILL.md` instalado es `"Use beta and other:beta.\n"`.
  - `"without the sibling the reference stays prefixed"`: solo `alpha`, y el archivo sigue con `demo:beta`.
  - `"adding the sibling later rewrites the installed one at its lock commit"`: instalar `alpha`, mover el origen a un commit nuevo, agregar la entrada `beta` e `install`. `alpha` dice `beta`, y `lock().skills.alpha.commit` no cambió.
  - `"removing the sibling restores the prefix"`: después del caso anterior, quitar `beta` e `install`. `alpha` vuelve a `demo:beta`.
  - `"update <name> moves only that skill"`: con las dos instaladas, un commit nuevo en el origen y `update alpha`. Solo cambia `commit` de `alpha` en el lock.
  - `"a repo without a marketplace is installed as before"`: entrada `{ repo, path: "skills/x" }` cuyo texto tiene `demo:y`, que no se reescribe.
- [x] **Step 2:** `node --test test/repo.test.mjs`. Esperado: FAIL en los casos de reescritura y de hermanas.
- [x] **Step 3:** Implementar en `src/cli.mjs` según las reglas: `siblings` se calcula una vez en `installAll` y se pasa por `context`, la reconstrucción va en `planSource` y la caché va en `fetchPlans`. En `collectSkills`, la rama que no es plugin decide el plugin con `pluginOfPath` y reusa la misma reescritura que la rama plugin (sacarla a una función local si se repite).
- [x] **Step 4:** `npm test`. Esperado: todo PASS. `test/cli.test.mjs` no cambia.
- [x] **Step 5: Commit** `feat: reescribe las referencias entre skills de un mismo plugin en orígenes repo`.

---

### Task 4: `add --repo` con `--candidates`, `--select`, `--ref` y `--path`

**Files:**
- Modify: `src/pick.mjs` (flags, `repoCandidates`, `commandPick`, `USAGE`)
- Modify: `src/lib.mjs` (`picksToSources`, `menuOptions`, `pickSummary`)
- Modify: `src/prompt.mjs` (`askInteractively`)
- Test: `test/repo.test.mjs`, `test/lib.test.mjs`

**Interfaces:**
- Consumes: `readRepoSkills` (Task 1), `catalogRepo`, `latestRelease`, `fetchSource`, `sourceKey`.
- Produces:
  - `repoCandidates(spec: string, { ref?, path? }, manifest): Candidate[]`, que baja el repo (HEAD, o el commit de `latestRelease(repo, ref)` si hay `ref`) en una carpeta temporal que borra al salir.
    - Por plugin: `{ id: <plugin>, kind: "repo-plugin", repo: spec, ref?, skills: string[], paths: { [skill]: path }, description?, note? }`.
    - Por carpeta: `{ id: <skill>, kind: "repo-skill", repo: spec, ref?, skills: [<skill>], path, description }`. La descripción sale de `skillDescription` del `SKILL.md`.
    - Se excluyen las skills cuya clave `sourceKey({ repo: spec, path })` ya está en el manifiesto. Un plugin que queda sin skills, y que no tiene `note`, desaparece.
  - `picksToSources` traduce `repo-plugin` (todas, o las de `pick.skills`) y `repo-skill` a una entrada `{ repo, path, ref? }` por skill, en el orden de `skills`.
  - `menuOptions`: un `repo-plugin` muestra `N skills` igual que un plugin, y un `repo-skill` muestra su descripción. `pickSummary`: un `repo-plugin` se resume como un plugin, y un `repo-skill` como `<name> · <repo>`.
  - `askInteractively`: un `repo-plugin` pasa por `askSkills` igual que un `plugin`.
- Flags: `--repo <spec>` (uno solo), `--ref <ref>` y `--path <dir>` (por defecto `skills`). `--ref` o `--path` sin `--repo`, `--repo` junto con `--catalog`, o `--repo` repetido, son error de uso (exit 2). Funciona igual con `init` y con `add`.

- [x] **Step 1: Write the failing tests**
  - `test/lib.test.mjs`, `"repo picks become one repo source per skill"`: `picksToSources([{ id: "demo", skills: ["beta"] }, { id: "x" }], [...])` con un `repo-plugin` `demo` (`paths: { alpha: "plugins/demo/skills/alpha", beta: "plugins/demo/skills/beta" }`, `ref: "v1"`) y un `repo-skill` `x`. Espera `[{ repo: "o/r", path: "plugins/demo/skills/beta", ref: "v1" }, { repo: "o/r", path: "skills/x" }]`. Pedir una skill que el plugin no tiene usa el error que ya existe.
  - `test/repo.test.mjs`, `describe("add --repo")`:
    - `"--candidates lists each marketplace plugin with its skills, without the marketplace on the machine"`: el `home` no tiene `.claude/plugins`. El JSON trae `{ id: "demo", kind: "repo-plugin", skills: ["alpha", "beta"] }`.
    - `"--select plugin:skill installs only that skill with commit and hash in the lock"`: `--select demo:alpha`. El manifiesto suma `{ repo: "file://…", path: "plugins/demo/skills/alpha" }`, y en el lock `alpha` tiene `commit` (40 hex) y `hash` (`sha256-…`).
    - `"without a marketplace --candidates lists base/* and --path changes the folder"`.
    - `"--ref pins every added entry to that ref"`: `--ref v1.0.0` escribe `ref: "v1.0.0"` en cada entrada, y el lock guarda el commit del tag.
    - `"skills already in the manifest are not candidates again"` (Review Focus 5).
    - `"a plugin from another repo is listed with its note and cannot be picked"` (Review Focus 4): `--select` sobre él sale con 1 y el mensaje `cannot be picked: plugin in another repo`.
    - `"--ref without --repo and --repo with --catalog are usage errors"`: exit 2.
    - `"a failed install leaves the manifest as it was"`: `--select` de una skill con un nombre que choca con otro origen.
- [x] **Step 2:** `node --test test/lib.test.mjs test/repo.test.mjs`. Esperado: FAIL.
- [x] **Step 3:** Implementar según las Interfaces. En `commandPick`, elegir la fuente de candidatos así: `--repo`, si no `--catalog`, si no la máquina. `USAGE` suma `--repo <owner/name> --select <plugin>[:a+b] | <skill>`.
- [x] **Step 4:** `npm test`. Esperado: todo PASS.
- [x] **Step 5: Commit** `feat: add --repo agrega skills de un repo de GitHub sin el marketplace en la máquina`.

---

### Task 5: Documentación y versión

**Files:**
- Modify: `README.md` (sección nueva "From a GitHub repo" después de la de `repo` sources; mencionar la reescritura de referencias y que cada skill es su propia entrada, así que `update <name>` la mueve sola).
- Modify: `skills/manage-skills/SKILL.md` (sección "From a GitHub repo" con los tres pasos `--candidates` → mostrar y preguntar → `--select`, la gramática `plugin:skill1+skill2` / `<skill>`, y `--ref` / `--path`).
- Modify: `CHANGELOG.md` (`## 1.3.0`, `### Added`: `add --repo`, y `### Fixed`: `ref` exacto con tags anotados; avisar que una entrada `repo` dentro de un plugin del marketplace ahora reescribe referencias, así que su hash puede cambiar en la próxima reconstrucción).
- Modify: `package.json` (`"version": "1.3.0"`).

- [x] **Step 1:** Escribir los cambios. Los ejemplos del README pueden usar `owner/skills`. Los nombres reales van solo en el README si hacen falta, nunca en `src/`.
- [x] **Step 2:** `npm test` (incluye `pack.test.mjs`, que revisa lo que se publica). Esperado: PASS.
- [x] **Step 3:** Probar contra la red una vez, fuera de los tests, en un repo de prueba descartable: `npx . add --repo expo/skills --candidates`, `npx . add --repo honojs/skills --candidates` y `npx . add --repo vercel/ai --candidates`. Esperado: expo lista los plugins `expo` y `expo-experiments` con sus skills, hono lista `hono` con `hono`, `hono-jsx` y `hono-void`, y vercel/ai lista sus carpetas de `skills/`.
- [x] **Step 4: Commit** `docs: documenta add --repo`.
