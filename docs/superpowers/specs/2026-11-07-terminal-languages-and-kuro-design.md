# La terminal en español e inglés, con Kuro — diseño

Issue: [#6](https://github.com/ramon-sg/skills-manager/issues/6). Rama: `terminal-languages-and-kuro`.

## Intención

issue-flow y agent-kitchen ya hablan español por defecto y cierran sus comandos con un
bloque junto a Kuro. skills-manager habla solo inglés y con otro estilo. Quien corre el
flujo completo ve tres herramientas con dos idiomas y dos estilos. Este cambio deja a
skills-manager igual que las otras dos.

**Hecho cuando:** `npx @ramon-sg/skills-manager check` dice el resultado en español junto a
Kuro, y con `--lang en` lo dice en inglés.

Referencia a imitar: issue-flow [#50](https://github.com/ramon-sg/issue-flow/pull/50)
(`src/lang.ts`, `src/messages/{es,en,index}.ts`, `src/banner.ts`).

## Objetivos

1. **Idioma.** Se elige con `--lang es|en` (en cualquier subcomando, también `--lang=en`),
   luego con `SKILLS_MANAGER_LANG` (vacío cuenta como no puesto) y si no, español.
   `LANG` y `LC_ALL` no se leen. Un valor distinto de `es`/`en` es error de uso (sale con 2)
   y ese error se dice en español, porque aún no hay idioma válido.
2. **Todo el texto para personas** sale en el idioma elegido:
   - los mensajes de cada comando (`install`, `update`, `check`, `list`, `init`, `add`);
   - los menús y preguntas de `@clack/prompts` (`pick.mjs`, `prompt.mjs`), incluidos
     `Sí`/`No`, títulos de `intro`/`note`/`outro`, ayudas de teclas y el texto de cancelar;
   - **todos los errores**, también los que se lanzan en `lib.mjs`, `git.mjs`,
     `catalog.mjs`, `catalog-plan.mjs`, `state.mjs`, `repo-source.mjs` (≈56 hoy);
   - las líneas de stderr de `session-notice`.
3. **Kuro.** Los mensajes finales salen en un bloque como el de `banner.ts` de issue-flow
   (mismo dibujo, mismas marcas `[ok]`, `[!]`, `[?]`, mismos colores y columnas):
   - cierre de `install`, `update` (también `--dry-run`), `check` (bien y mal), `init`/`add`;
   - errores que cortan un comando: bloque `[!]` en stderr.
   - Kuro solo se dibuja si la salida es una terminal (`isTTY` del stream donde se escribe).
     Sin terminal sale el mismo bloque sin dibujo, como texto plano indentado.
   - `NO_COLOR` (cualquier valor no vacío) quita el color; sin terminal tampoco hay color.
4. **`--help`** (y `-h`, y `help`) existe y está completo en los dos idiomas: cada
   subcomando, cada flag (`--dry-run`, `--replace`, `--catalog`, `--repo`, `--ref`,
   `--path`, `--candidates`, `--select`, `--lang`) y la variable `SKILLS_MANAGER_LANG`.
   Hoy no existe ayuda: se crea.

## No objetivos

- `--candidates` (la única salida JSON): la leen otras herramientas, no cambia (ni claves ni valores).
- Lo que se escribe a disco: manifiesto, lock, `project.md`, settings.
- El texto que `session-notice` imprime a stdout: es la copia exacta del envoltorio del hook
  de superpowers y lo lee el agente.
- README en inglés, CHANGELOG traducido o traducir las skills de `skills/`.
  *(Decisión mía; se puede sumar después.)*
- Un interruptor para apagar Kuro en la configuración (issue-flow tiene `"art": false`):
  el issue no lo pide.

## Anti-objetivos (sería un fracaso aunque funcione)

- Frases armadas pegando pedazos traducidos ("Skill " + nombre + " instalada"): rompe el
  orden de palabras del otro idioma.
- Que un comando, flag, nombre de archivo, nombre de skill, repo o sha salga traducido.
- Que el bloque corte o parta un comando a copiar.
- Que se cuele inglés en la salida en español (o al revés) por un texto olvidado.
- Que cambie un byte de `--json`, `--candidates`, del lock o del stdout de `session-notice`.

## Buenas prácticas de traducción (pedido explícito)

1. **Catálogo por idioma, mismo esquema que issue-flow:** `src/messages/es.mjs` define la
   forma; `src/messages/en.mjs` se anota `/** @type {import("./es.mjs").Messages} */`.
   Agrupado por área (`usage`, `lang`, `check`, `install`, `pick`, `prompt`, `errors.git`,
   `errors.manifest`, …). Cada mensaje es un texto o una función que recibe parámetros con
   nombre (`({ name, count }) => …`) y devuelve la frase entera.
2. **Frases completas.** Cada idioma escribe su oración entera; nada de concatenar
   fragmentos traducidos. Las listas de nombres se unen con `Intl.ListFormat` del idioma
   cuando forman parte de una frase ("a, b y c" / "a, b and c").
3. **Plurales** con `Intl.PluralRules` (o formas `one`/`other` explícitas), nunca `s` pegada.
4. **Lo técnico no se traduce:** comandos, flags, rutas, nombres de skill, `owner/repo`,
   shas y versiones van tal cual, en `código` cuando el texto lo permite.
5. **Glosario fijo en español**, usado igual en todo el catálogo: *skill* (no se traduce),
   *manifiesto* (`.agents/skills.json`), *lock* (no se traduce), *origen*, *catálogo*,
   *marketplace*, *plugin*, *skill propia* (la del repo que el lock no conoce),
   *reemplazar*. Tuteo neutro, como issue-flow. Tildes y `¿?` correctos.
6. **Los errores se traducen donde nacen, con clave:** los módulos lanzan con un helper
   (p. ej. `fail("errors.git.badRepo", { repo })`) que crea un `Error` con `message` ya en
   el idioma activo y además `key` y `params`. `exitCode` y las clases existentes
   (`OwnSkillsError`, errores de uso) se conservan. Los tests pueden afirmar por `key` en
   vez de por texto.
7. **Un solo punto de verdad del idioma:** `src/lang.mjs` resuelve el idioma
   (`resolveLang(flag, env)`) y el CLI lo fija al arrancar, antes de cualquier otro trabajo.
   Las funciones puras de `lib.mjs` que hoy devuelven texto (`keptText`, `pickSummary`,
   `menuOptions`, `catalogMenu`) toman el texto del catálogo activo.
8. **Tests del catálogo** (`test/messages.test.mjs`):
   - `es` y `en` tienen exactamente las mismas claves, a cualquier profundidad;
   - en cada clave los dos son del mismo tipo (texto o función) y las funciones aceptan los
     mismos parámetros (se comprueba llamándolas con un objeto de prueba y viendo que cada
     parámetro aparece en la salida de ambos);
   - ningún texto está vacío;
   - ningún archivo de `src/` fuera de `messages/` tiene frases para personas en inglés
     (al menos: ningún `new Error("` con texto literal y ningún `console.log`/`error` con
     literal), para que no vuelva a colarse un texto suelto.

## Restricciones

- Node ≥ 20.12, ESM `.mjs`, sin dependencias nuevas (`Intl` y `node:util` alcanzan).
- `test/no-project-names.test.mjs` sigue pasando: el catálogo no nombra repos reales.
- Los tests existentes que comparan texto en inglés corren con `SKILLS_MANAGER_LANG=en`
  o pasan a comparar por `key`; se agregan tests de la salida en español.
- Mensajes de commit en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Cambio de comportamiento a avisar

La salida por defecto pasa a español y el prefijo `❌`/`✅` se reemplaza por el bloque. Un
script que lea el texto de la terminal (no `--json`) puede necesitar
`SKILLS_MANAGER_LANG=en`. Va en el CHANGELOG y en la descripción del PR.

**Versión: 1.4.0** (decisión del autor): el texto de la terminal no se considera una
interfaz estable; la única salida para máquinas es `--candidates`, y esa no cambia.

## Decisiones tomadas en la revisión (mías, revisables)

- **`session-notice` nunca falla, tampoco por el idioma.** Si `SKILLS_MANAGER_LANG` no es
  válido, usa español y deja una línea `skills-manager: …` en stderr; sale con 0. El
  idioma se resuelve en `main()` para todo lo demás, y `session-notice` tiene su propio
  camino tolerante.
- **Texto ajeno dentro de un error.** Lo que dicen git, `JSON.parse` o el sistema de
  archivos no se traduce: la frase es del catálogo y el detalle original va después, como
  dato técnico (p. ej. `No se pudo bajar owner/repo.` + el stderr de git indentado). No se
  clasifican los fallos de git. El test de "nada de inglés en `src/`" solo mira literales
  escritos en nuestro código.
- **No hay `--json` hoy;** la única salida JSON es `--candidates`, y no se agrega otra.
  Los `note` en inglés dentro de `--candidates` no cambian; se traducen solo donde se
  muestran (menús, errores).
- **`@clack/prompts` trae un texto fijo en inglés** cuando `required: true` ("Please select
  at least one option…"). Esa validación se hace en nuestro código con un texto del catálogo.

## Queda para quien construye

- Nombres exactos de las claves y la división del catálogo en áreas.
- Las filas y la línea "siguiente comando" de cada bloque (p. ej. `check` con problemas
  muestra cada tipo de problema como fila y `skills-manager install` como siguiente comando).
- `list`: es una tabla para leer; *mi decisión* es dejarla sin bloque, solo traducida
  ("versión más nueva disponible").
- Si `banner` se porta a `src/banner.mjs` tal cual o se adapta, mientras el resultado se vea
  igual que en issue-flow.
