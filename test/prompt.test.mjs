/**
 * @file Tests that cancelling a prompt, or an empty menu, ends as a keyed error
 * (shown under its own title) and not as an unexpected one.
 */
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { test } from "node:test";

import { confirm } from "@clack/prompts";

import { setLang } from "../src/lang.mjs";
import { askInteractively, orCancel } from "../src/prompt.mjs";

test("an empty menu fails with the key it was given, so it is not an unexpected error", async () => {
  setLang("en");
  await assert.rejects(askInteractively([], { empty: "pick.nothingNew" }), (error) => error.key === "pick.nothingNew" && /nothing new/i.test(error.message));
  await assert.rejects(askInteractively([]), (error) => error.key === "prompt.nothingOnMachine");
});

test("a cancelled prompt fails with prompt.cancelled; an answer goes through", async () => {
  // NOTE: an aborted signal makes clack return its real cancel value, without a terminal or timing.
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const cancelled = await confirm({ message: "x", signal: AbortSignal.abort(), output });
  assert.throws(() => orCancel(cancelled), (error) => error.key === "prompt.cancelled");
  assert.equal(orCancel(false), false);
});
