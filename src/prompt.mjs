/**
 * @file Interactive checkbox menu for `skills-manager init` and `skills-manager add`
 * (`@clack/prompts`). First plugins and local skills are ticked, one short line
 * each; then, for each ticked plugin with more than one skill, it asks whether
 * to take all or pick some. Catalog skills are ticked in one list grouped by
 * category, each with its description. At the end it shows the summary and asks for
 * confirmation. It only runs with a terminal; without one, `pick.mjs` asks for `--select`.
 */
import { confirm, groupMultiselect, intro, isCancel, multiselect, note, outro, select } from "@clack/prompts";

import { catalogMenu, menuOptions, pickSummary } from "./lib.mjs";

/** Answer "take all the plugin's skills". */
const ALL_SKILLS = "all";

/** Answer "pick individual skills of the plugin". */
const SOME_SKILLS = "some";

/** List rows visible at once; the rest is reached with the arrow keys. */
const MAX_ROWS = 10;

/** Message when cancelled with Ctrl+C or Esc; the CLI prints it on exit. */
const CANCELLED = "Cancelled; nothing changed.";

/** Key help for checkbox lists (replaces the library's own help). */
const CHECKBOX_KEYS = "(space ticks · enter continues)";

/** Key help for single-choice questions. */
const SELECT_KEYS = "(enter selects)";

/** Separates the plugin name from its marketplace in an id. */
const PLUGIN_ID_SEPARATOR = "@";

/** Order of skills in the list: alphabetical, with numbers in natural order. */
const NATURAL = new Intl.Collator("en", { numeric: true });

/**
 * Stops if the person cancelled the step.
 *
 * @param value - What the prompt returned.
 * @returns The same value, if not cancelled.
 * @throws {Error} If cancelled.
 */
function orCancel(value) {
  if (isCancel(value)) {
    throw new Error(CANCELLED);
  }
  return value;
}

/**
 * Asks which skills of a plugin to take: all, or a ticked list.
 *
 * @param candidate - The ticked plugin.
 * @returns The pick `{ id, skills? }`; without `skills` it means all.
 * @throws {Error} If cancelled.
 */
async function askSkills(candidate) {
  const name = candidate.id.split(PLUGIN_ID_SEPARATOR)[0];
  if (candidate.skills.length <= 1) {
    return { id: candidate.id };
  }
  const mode = orCancel(
    await select({
      message: `${name}: all the skills? ${SELECT_KEYS}`,
      options: [
        { value: ALL_SKILLS, label: `All (${candidate.skills.length})` },
        { value: SOME_SKILLS, label: "Pick some" },
      ],
      showInstructions: false,
    }),
  );
  if (mode === ALL_SKILLS) {
    return { id: candidate.id };
  }
  const skills = orCancel(
    await multiselect({
      message: `Skills of ${name} ${CHECKBOX_KEYS}`,
      options: candidate.skills.toSorted(NATURAL.compare).map((skill) => ({ value: skill })),
      maxItems: MAX_ROWS,
      required: true,
      showInstructions: false,
    }),
  );
  return { id: candidate.id, skills };
}

/**
 * Shows the summary of the picks and asks to go on.
 *
 * @param picks - Picks `{ id, skills? }`.
 * @param candidates - The candidates they come from.
 * @returns The same picks, if confirmed.
 * @throws {Error} If cancelled or not confirmed.
 */
async function confirmPicks(picks, candidates) {
  note(pickSummary(picks, candidates), "You are about to add");
  if (!orCancel(await confirm({ message: "Continue?", active: "Yes", inactive: "No" }))) {
    throw new Error(CANCELLED);
  }
  outro("Installing…");
  return picks;
}

/**
 * Shows the catalog skills grouped by category, each with its description,
 * and returns what was picked.
 *
 * @param candidates - Catalog candidates.
 * @returns Picks `{ id }`.
 * @throws {Error} If cancelled or not confirmed.
 */
async function askCatalog(candidates) {
  intro("Skills");
  const ids = orCancel(
    await groupMultiselect({
      message: `What do you want to add? ${CHECKBOX_KEYS}`,
      options: catalogMenu(candidates),
      maxItems: MAX_ROWS,
      required: true,
      selectableGroups: true,
      showInstructions: false,
    }),
  );
  return confirmPicks(ids.map((id) => ({ id })), candidates);
}

/**
 * Shows the checkbox menu and returns what was picked.
 *
 * @param candidates - What `listCandidates` returns, or catalog candidates.
 * @returns Picks `{ id, skills? }`.
 * @throws {Error} If nothing is pickable, or it is cancelled or not confirmed.
 */
export async function askInteractively(candidates) {
  if (candidates.length > 0 && candidates.every((candidate) => candidate.kind === "catalog")) {
    return askCatalog(candidates);
  }
  const { options, hidden } = menuOptions(candidates);
  if (options.length === 0) {
    throw new Error("Nothing installed on this machine to add.");
  }
  intro("Third-party skills");
  if (hidden.length > 0) {
    note(hidden.join("\n"), "Cannot be picked");
  }
  const ids = orCancel(
    await multiselect({
      message: `What do you want to add? ${CHECKBOX_KEYS}`,
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
  return confirmPicks(picks, candidates);
}

/**
 * Asks, for each own skill an install would replace, whether to replace it with the
 * incoming one. Its folder is deleted; a `project.md` in it is kept.
 *
 * @param names - The own skills that clash.
 * @returns The names the person allowed, in order; it stops at the first no.
 * @throws {Error} If cancelled.
 */
export async function askReplace(names) {
  const allowed = [];
  for (const name of names) {
    const yes = orCancel(await confirm({ message: `The repo has its own "${name}" skill. Replace it with the incoming one? (its folder is deleted; a project.md in it is kept)`, initialValue: false }));
    if (!yes) {
      break;
    }
    allowed.push(name);
  }
  return allowed;
}
