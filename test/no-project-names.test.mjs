/**
 * @file Guards against project-specific names leaking into the package sources.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
const FORBIDDEN = /abastio/i;

test("no file in src/ mentions the originating project", () => {
  for (const entry of readdirSync(SRC_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const file = join(entry.parentPath, entry.name);
    assert.ok(!FORBIDDEN.test(readFileSync(file, "utf8")), `${file} contains a project name`);
  }
});
