/**
 * @file Menú interactivo de `skills:init` y `skills:add`, con casillas
 * (`@clack/prompts`). Primero se marcan plugins y skills locales, una línea
 * corta por cada uno; después, por cada plugin marcado con más de una skill, se
 * pregunta si van todas o se eligen. Al final muestra el resumen y pide
 * confirmar. Solo corre con terminal; sin ella, `pick.mjs` pide `--select`.
 */
import { confirm, intro, isCancel, multiselect, note, outro, select } from "@clack/prompts";

import { menuOptions, pickSummary } from "./lib.mjs";

/** Respuesta "llevar todas las skills del plugin". */
const ALL_SKILLS = "all";

/** Respuesta "elegir skills sueltas del plugin". */
const SOME_SKILLS = "some";

/** Filas de la lista que se ven a la vez; el resto se recorre con las flechas. */
const MAX_ROWS = 10;

/** Mensaje cuando se cancela con Ctrl+C o Esc; lo imprime el CLI al salir. */
const CANCELLED = "Cancelado; no cambié nada.";

/** Ayuda de teclas de las listas con casillas (las de la librería vienen en inglés). */
const CHECKBOX_KEYS = "(espacio marca · enter sigue)";

/** Ayuda de teclas de las preguntas de una sola opción. */
const SELECT_KEYS = "(enter elige)";

/** Separa el nombre del plugin de su marketplace en un id. */
const PLUGIN_ID_SEPARATOR = "@";

/** Orden de las skills en la lista: alfabético, con los números en orden natural. */
const NATURAL = new Intl.Collator("es", { numeric: true });

/**
 * Corta si la persona canceló el paso.
 *
 * @param value - Lo que devolvió el prompt.
 * @returns El mismo valor, si no se canceló.
 * @throws {Error} Si se canceló.
 */
function orCancel(value) {
  if (isCancel(value)) {
    throw new Error(CANCELLED);
  }
  return value;
}

/**
 * Pregunta qué skills de un plugin se llevan: todas, o una lista marcada.
 *
 * @param candidate - El plugin marcado.
 * @returns La elección `{ id, skills? }`; sin `skills` son todas.
 * @throws {Error} Si se cancela.
 */
async function askSkills(candidate) {
  const name = candidate.id.split(PLUGIN_ID_SEPARATOR)[0];
  if (candidate.skills.length <= 1) {
    return { id: candidate.id };
  }
  const mode = orCancel(
    await select({
      message: `${name}: ¿todas las skills? ${SELECT_KEYS}`,
      options: [
        { value: ALL_SKILLS, label: `Todas (${candidate.skills.length})` },
        { value: SOME_SKILLS, label: "Elegir" },
      ],
      showInstructions: false,
    }),
  );
  if (mode === ALL_SKILLS) {
    return { id: candidate.id };
  }
  const skills = orCancel(
    await multiselect({
      message: `Skills de ${name} ${CHECKBOX_KEYS}`,
      options: candidate.skills.toSorted(NATURAL.compare).map((skill) => ({ value: skill })),
      maxItems: MAX_ROWS,
      required: true,
      showInstructions: false,
    }),
  );
  return { id: candidate.id, skills };
}

/**
 * Muestra el menú con casillas y devuelve lo elegido.
 *
 * @param candidates - Lo que devuelve `listCandidates`.
 * @returns Elecciones `{ id, skills? }`.
 * @throws {Error} Si no hay nada elegible, o se cancela o no se confirma.
 */
export async function askInteractively(candidates) {
  const { options, hidden } = menuOptions(candidates);
  if (options.length === 0) {
    throw new Error("No hay nada instalado en la máquina para sumar.");
  }
  intro("Skills de terceros");
  if (hidden.length > 0) {
    note(hidden.join("\n"), "No se pueden elegir");
  }
  const ids = orCancel(
    await multiselect({
      message: `¿Qué sumás? ${CHECKBOX_KEYS}`,
      options,
      maxItems: MAX_ROWS,
      required: true,
      showInstructions: false,
    }),
  );
  const picks = [];
  for (const id of ids) {
    const candidate = candidates.find((option) => option.id === id);
    picks.push(candidate?.kind === "plugin" ? await askSkills(candidate) : { id });
  }
  note(pickSummary(picks, candidates), "Vas a sumar");
  if (!orCancel(await confirm({ message: "¿Sigo?", active: "Sí", inactive: "No" }))) {
    throw new Error(CANCELLED);
  }
  outro("Instalando…");
  return picks;
}
