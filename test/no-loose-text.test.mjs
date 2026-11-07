/**
 * @file Guard: no user-facing text outside `src/messages/`. Every `src/**\/*.mjs` is scanned
 * for errors and console output built from a literal; they must go through the catalogs.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/** The `src` folder. */
const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "src");

/** Console calls that must not take a literal; `console.log(JSON.stringify(` is not matched. */
const LOOSE = /\bconsole\.(?:log|error)\(\s*["'`]/;

/** Any `new Error(`: errors are built with `fail()`; only `src/lang.mjs` may use it. */
const NEW_ERROR = /\bnew Error\(/;

/**
 * Lists the `.mjs` files under a folder, skipping `src/messages`.
 *
 * @param dir - Folder to walk.
 * @returns Absolute paths.
 */
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return relative(SRC, full) === "messages" ? [] : sources(full);
    }
    return entry.name.endsWith(".mjs") ? [full] : [];
  });
}

test("no error or console output is built from a literal outside src/messages", () => {
  const found = [];
  for (const file of sources(SRC)) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (LOOSE.test(line) || (NEW_ERROR.test(line) && relative(SRC, file) !== "lang.mjs")) {
          found.push(`${relative(SRC, file).split(sep).join("/")}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(found, []);
});
