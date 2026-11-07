/**
 * @file Interactive checkbox menu for `skills-manager init` and `skills-manager add`
 * (`@clack/prompts`). First plugins and local skills are ticked, one short line
 * each; then, for each ticked plugin with more than one skill, it asks whether
 * to take all or pick some. Catalog skills are ticked in one list grouped by
 * category, each with its description. At the end it shows the summary and asks for
 * confirmation. It only runs with a terminal; without one, `pick.mjs` asks for `--select`.
 */
import { confirm, groupMultiselect, intro, isCancel, log, multiselect, note, outro, select } from "@clack/prompts";

import { fail, text } from "./lang.mjs";
import { catalogMenu, keptText, menuOptions, pickSummary, REPO_PLUGIN } from "./lib.mjs";

/** Answer "take all the plugin's skills". */
const ALL_SKILLS = "all";

/** Answer "pick individual skills of the plugin". */
const SOME_SKILLS = "some";

/** List rows visible at once; the rest is reached with the arrow keys. */
const MAX_ROWS = 10;

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
    throw fail("prompt.cancelled");
  }
  return value;
}

/**
 * Asks a checkbox question that needs at least one tick. The library's own
 * "select at least one" text is English only, so it is switched off and checked here.
 *
 * @param ask - `multiselect` or `groupMultiselect`.
 * @param question - `{ message, options, ... }` for the prompt.
 * @returns The ticked values, or the cancel symbol.
 */
async function askMany(ask, question) {
  for (;;) {
    const answer = await ask({ ...question, maxItems: MAX_ROWS, required: false, showInstructions: false });
    if (isCancel(answer) || answer.length > 0) {
      return answer;
    }
    log.warn(text("prompt.pickOne"));
  }
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
      message: text("prompt.allSkillsQuestion", { name, keys: text("prompt.selectKeys") }),
      options: [
        { value: ALL_SKILLS, label: text("prompt.allOption", { count: candidate.skills.length }) },
        { value: SOME_SKILLS, label: text("prompt.someOption") },
      ],
      showInstructions: false,
    }),
  );
  if (mode === ALL_SKILLS) {
    return { id: candidate.id };
  }
  const skills = orCancel(
    await askMany(multiselect, {
      message: text("prompt.skillsOf", { name, keys: text("prompt.checkboxKeys") }),
      options: candidate.skills.toSorted(NATURAL.compare).map((skill) => ({ value: skill })),
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
  note(pickSummary(picks, candidates), text("prompt.summaryTitle"));
  if (!orCancel(await confirm({ message: text("prompt.continue"), active: text("prompt.yes"), inactive: text("prompt.no") }))) {
    throw fail("prompt.cancelled");
  }
  outro(text("prompt.installing"));
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
  intro(text("prompt.introCatalog"));
  const ids = orCancel(
    await askMany(groupMultiselect, {
      message: text("prompt.whatToAdd", { keys: text("prompt.checkboxKeys") }),
      options: catalogMenu(candidates),
      selectableGroups: true,
    }),
  );
  return confirmPicks(ids.map((id) => ({ id })), candidates);
}

/**
 * Shows the checkbox menu and returns what was picked.
 *
 * @param candidates - What `listCandidates` returns, or catalog or repo candidates.
 * @param options - `{ empty? }`: message key shown when nothing is pickable; defaults to the machine's.
 * @returns Picks `{ id, skills? }`.
 * @throws {Error} If nothing is pickable, or it is cancelled or not confirmed.
 */
export async function askInteractively(candidates, { empty = "prompt.nothingOnMachine" } = {}) {
  if (candidates.length > 0 && candidates.every((candidate) => candidate.kind === "catalog")) {
    return askCatalog(candidates);
  }
  const { options, hidden } = menuOptions(candidates);
  if (options.length === 0) {
    throw fail(empty);
  }
  intro(text("prompt.introThirdParty"));
  if (hidden.length > 0) {
    note(hidden.join("\n"), text("prompt.cannotPickTitle"));
  }
  const ids = orCancel(
    await askMany(multiselect, {
      message: text("prompt.whatToAdd", { keys: text("prompt.checkboxKeys") }),
      options,
    }),
  );
  const picks = [];
  for (const id of ids) {
    const candidate = candidates.find((option) => option.id === id);
    picks.push(candidate?.kind === "plugin" || candidate?.kind === REPO_PLUGIN ? await askSkills(candidate) : { id });
  }
  return confirmPicks(picks, candidates);
}

/**
 * Asks, for each own skill an install would replace, whether to replace it with the
 * incoming one, saying what of its folder is kept.
 *
 * @param skills - The own skills that clash, each `{ name, keeps }`.
 * @returns The names the person allowed, in order; it stops at the first no.
 * @throws {Error} If cancelled.
 */
export async function askReplace(skills) {
  const allowed = [];
  for (const { name, keeps } of skills) {
    const yes = orCancel(await confirm({ message: text("prompt.replaceQuestion", { name, kept: keptText(keeps) }), active: text("prompt.yes"), inactive: text("prompt.no"), initialValue: false }));
    if (!yes) {
      break;
    }
    allowed.push(name);
  }
  return allowed;
}
