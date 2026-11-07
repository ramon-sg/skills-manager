/**
 * @file Tests that cancelling a prompt, or an empty menu, ends as a keyed error
 * (shown under its own title) and not as an unexpected one.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { setLang } from "../src/lang.mjs";
import { askInteractively } from "../src/prompt.mjs";

/** The prompts module under test. */
const PROMPT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "prompt.mjs");

test("an empty menu fails with the key it was given, so it is not an unexpected error", async () => {
  setLang("en");
  await assert.rejects(askInteractively([], { empty: "pick.nothingNew" }), (error) => error.key === "pick.nothingNew" && /nothing new/i.test(error.message));
  await assert.rejects(askInteractively([]), (error) => error.key === "prompt.nothingOnMachine");
});

test("Ctrl+C at the replace question fails with prompt.cancelled", () => {
  const script = `import { askReplace } from ${JSON.stringify(PROMPT)};
    try { await askReplace([{ name: "x", keeps: [] }]); } catch (error) { console.log("KEY " + error.key); }`;
  const input = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    input: "\u0003",
    env: { ...process.env, SKILLS_MANAGER_LANG: "en" },
  });
  assert.match(input.stdout, /KEY prompt\.cancelled/);
});
