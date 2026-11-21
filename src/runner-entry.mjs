/**
 * @file The entry of skills-manager in `.agents/runner.json`, the repo file that
 * says which runner (`bun` or `node`) and which exact version runs each tool.
 * `planRunnerEntry` decides it before a command writes anything (reading the file,
 * and choosing the runner when the file is missing); `writeRunnerEntry` writes it
 * once the command has succeeded. Only this package's own entry moves, and never down.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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
 * @returns `{ config, changed, warning, schema }`: the config to write, whether it differs from
 * the file, the notice to print when Node was picked for lack of Bun (or `null`), and the
 * file's own `$schema` to keep (or `undefined`).
 * @throws {Error} `runner.invalid` if the file is not valid; `runner.declined` if the person
 * chose to quit and install Bun.
 */
export async function planRunnerEntry(root, ask) {
  let current;
  try {
    current = readRunnerConfig(root);
  } catch (error) {
    if (error instanceof RunnerFileError || error.code !== undefined) {
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
  return { config: set.config, changed: current === null || set.changed, warning, schema: current === null ? undefined : schemaOf(root) };
}

/**
 * The `$schema` of an existing, already validated `.agents/runner.json`. The library
 * drops it on read and writes its own; the file's is kept, since it may come from a
 * newer `@ramon-sg/runner` than the one bundled here.
 *
 * @param root - Repo root.
 * @returns The `$schema` value, or `undefined` if the file has none.
 */
function schemaOf(root) {
  const data = JSON.parse(readFileSync(path.join(root, RUNNER_FILE), "utf8").replace(/^\uFEFF/, ""));
  return typeof data.$schema === "string" ? data.$schema : undefined;
}

/**
 * Writes the entry planned by `planRunnerEntry`, if it changes the file, and prints
 * its warning on stderr.
 *
 * @param root - Repo root.
 * @param plan - What `planRunnerEntry` returned.
 * @throws {Error} `runner.writeFailed` if the file cannot be written.
 */
export function writeRunnerEntry(root, plan) {
  if (plan.changed) {
    try {
      writeRunnerConfig(root, plan.config);
      if (plan.schema !== undefined) {
        const file = path.join(root, RUNNER_FILE);
        const data = JSON.parse(readFileSync(file, "utf8"));
        if (data.$schema !== plan.schema) {
          writeFileSync(file, `${JSON.stringify({ ...data, $schema: plan.schema }, null, 2)}\n`);
        }
      }
    } catch (error) {
      throw fail("runner.writeFailed", { file: RUNNER_FILE, detail: error.message });
    }
  }
  if (plan.warning !== null) {
    process.stderr.write(`${plan.warning}\n`);
  }
}

