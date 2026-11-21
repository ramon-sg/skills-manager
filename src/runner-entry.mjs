/**
 * @file The entry of skills-manager in `.agents/runner.json`, the repo file that
 * says which runner (`bun` or `node`) and which exact version runs each tool.
 * `planRunnerEntry` decides it before a command writes anything (reading the file,
 * and choosing the runner when the file is missing); `writeRunnerEntry` writes it
 * once the command has succeeded. Only this package's own entry moves, and never down.
 */
import { chooseRunner, readRunnerConfig, RUNNER_FILE, RunnerFileError, setTool, writeRunnerConfig } from "@ramon-sg/runner";

import { fail, text } from "./lang.mjs";
import { VERSION } from "./version.mjs";

/** Name of this package in `tools`. */
export const PACKAGE = "@ramon-sg/skills-manager";

/**
 * Reads `.agents/runner.json` and works out the entry to write, writing nothing.
 *
 * @param root - Repo root.
 * @param ask - `{ interactive, askRunner }`: whether there is a terminal, and the question
 * asked when the file is missing and Bun is not installed (`"node"`, or `null` to quit).
 * @returns `{ config, changed, warning }`: the config to write, whether it differs from the
 * file, and the notice to print when Node was picked for lack of Bun (or `null`).
 * @throws {Error} `runner.invalid` if the file is not valid; `runner.declined` if the person
 * chose to quit and install Bun.
 */
export async function planRunnerEntry(root, ask) {
  let current;
  try {
    current = readRunnerConfig(root);
  } catch (error) {
    if (error instanceof RunnerFileError) {
      throw fail("runner.invalid", { file: RUNNER_FILE, detail: error.message });
    }
    throw error;
  }
  let warning = null;
  let config = current;
  if (config === null) {
    const chosen = await chooseRunner({ ask: ask.interactive ? ask.askRunner : undefined });
    if (chosen === null) {
      throw fail("runner.declined");
    }
    warning = chosen.warning === null ? null : text("runner.noBun");
    config = { runner: chosen.runner, tools: {}, extra: {} };
  }
  const set = setTool(config, PACKAGE, VERSION);
  return { config: set.config, changed: current === null || set.changed, warning };
}

/**
 * Writes the entry planned by `planRunnerEntry`, if it changes the file, and prints
 * its warning on stderr.
 *
 * @param root - Repo root.
 * @param plan - What `planRunnerEntry` returned.
 */
export function writeRunnerEntry(root, plan) {
  if (plan.changed) {
    writeRunnerConfig(root, plan.config);
  }
  if (plan.warning !== null) {
    process.stderr.write(`${plan.warning}\n`);
  }
}

