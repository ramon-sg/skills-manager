/**
 * @file Tests for `src/runner-entry.mjs`: the entry of skills-manager in
 * `.agents/runner.json`. Whether Bun is installed is decided by the `PATH` each
 * test builds: a fake `bunx` that exits 0, or none at all. No real `bunx`/`npx` runs.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { readRunnerConfig } from "@ramon-sg/runner";

import { setLang, text } from "../src/lang.mjs";
import { PACKAGE, planRunnerEntry, writeRunnerEntry } from "../src/runner-entry.mjs";
import { VERSION } from "../src/version.mjs";

/** The file, relative to the repo. */
const FILE = ".agents/runner.json";

/** Temporary folder of each test. */
let base;

/** Repo root of each test. */
let root;

/** `PATH` before the test, restored after it. */
const savedPath = process.env.PATH;

/**
 * Leaves in `PATH` only a folder, with a fake `bunx` when `bun` is true.
 *
 * @param bun - Whether Bun looks installed.
 */
function setBun(bun) {
  const bin = join(base, bun ? "with-bun" : "without-bun");
  mkdirSync(bin, { recursive: true });
  if (bun) {
    writeFileSync(join(bin, "bunx"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "bunx"), 0o755);
  }
  process.env.PATH = bin;
}

/**
 * A terminal for `planRunnerEntry` that answers the runner question with `answer`.
 *
 * @param answer - What `askRunner` returns.
 * @param interactive - Whether there is a terminal.
 * @returns The ask object and the count of questions asked.
 */
function terminal(answer, interactive = true) {
  const asked = { count: 0 };
  return {
    asked,
    ask: {
      interactive,
      askRunner: async () => {
        asked.count += 1;
        return answer;
      },
    },
  };
}

/**
 * Writes `.agents/runner.json` in the repo.
 *
 * @param content - Raw content.
 */
function writeFile(content) {
  mkdirSync(join(root, ".agents"), { recursive: true });
  writeFileSync(join(root, FILE), content);
}

beforeEach(() => {
  setLang("en");
  base = mkdtempSync(join(tmpdir(), "runner-entry-"));
  root = join(base, "repo");
  mkdirSync(root);
});

afterEach(() => {
  process.env.PATH = savedPath;
  rmSync(base, { recursive: true, force: true });
});

test("creates runner.json with bun when bunx is on PATH", async () => {
  setBun(true);
  const { ask, asked } = terminal("node");
  writeRunnerEntry(root, await planRunnerEntry(root, ask));
  const config = readRunnerConfig(root);
  assert.equal(config.runner, "bun");
  assert.deepEqual(config.tools, { [PACKAGE]: VERSION });
  assert.equal(asked.count, 0);
});

test("without bun and no terminal, picks node and warns", async () => {
  setBun(false);
  const { ask, asked } = terminal("node", false);
  const plan = await planRunnerEntry(root, ask);
  assert.equal(plan.config.runner, "node");
  assert.equal(plan.warning, text("runner.noBun"));
  assert.equal(asked.count, 0);
});

test("without bun in a terminal, asks", async () => {
  setBun(false);
  const { ask, asked } = terminal("node");
  const plan = await planRunnerEntry(root, ask);
  assert.equal(plan.config.runner, "node");
  assert.equal(plan.warning, null);
  assert.equal(asked.count, 1);
});

test("declining the runner question writes nothing", async () => {
  setBun(false);
  const { ask } = terminal(null);
  await assert.rejects(planRunnerEntry(root, ask), (error) => error.key === "runner.declined");
  assert.equal(existsSync(join(root, FILE)), false);
});

test("planning alone writes nothing", async () => {
  setBun(true);
  await planRunnerEntry(root, terminal("node").ask);
  assert.equal(existsSync(join(root, FILE)), false);
});

test("keeps other tools and unknown keys", async () => {
  setBun(false);
  writeFile(JSON.stringify({ $schema: "x", runner: "node", tools: { "@ramon-sg/issue-flow": "0.6.0" }, extra: 1 }));
  const { ask, asked } = terminal(null);
  writeRunnerEntry(root, await planRunnerEntry(root, ask));
  const data = JSON.parse(readFileSync(join(root, FILE), "utf8"));
  assert.equal(data.runner, "node");
  assert.equal(data.extra, 1);
  assert.deepEqual(data.tools, { "@ramon-sg/issue-flow": "0.6.0", [PACKAGE]: VERSION });
  assert.equal(asked.count, 0);
});

test("never lowers a newer pin", async () => {
  setBun(true);
  const before = `${JSON.stringify({ runner: "bun", tools: { [PACKAGE]: "99.0.0" } }, null, 2)}\n`;
  writeFile(before);
  const plan = await planRunnerEntry(root, terminal("node").ask);
  assert.equal(plan.changed, false);
  writeRunnerEntry(root, plan);
  assert.equal(readFileSync(join(root, FILE), "utf8"), before);
});

test("a broken runner.json fails with its name", async () => {
  setBun(true);
  writeFile('{"runner":"deno"}');
  await assert.rejects(planRunnerEntry(root, terminal("node").ask), (error) => error.key === "runner.invalid" && error.message.includes(FILE));
});
