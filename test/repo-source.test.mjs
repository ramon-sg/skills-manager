/**
 * @file Tests for reading the skills of a downloaded repo, with and without a
 * marketplace, against temporary folders. No network.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { MARKETPLACE_FILE, pluginOfPath, readRepoSkills } from "../src/repo-source.mjs";

/** Temporary repo tree of each test. */
let tree;

/**
 * Writes a file in the tree, creating its folder.
 *
 * @param rel - Path relative to the tree.
 * @param content - File content.
 */
function write(rel, content = "") {
  mkdirSync(dirname(join(tree, rel)), { recursive: true });
  writeFileSync(join(tree, rel), content);
}

/**
 * Writes a marketplace file with the given plugins.
 *
 * @param plugins - The `plugins` list.
 */
function marketplace(plugins) {
  write(MARKETPLACE_FILE, JSON.stringify({ name: "m", plugins }));
}

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), "repo-source-"));
});

afterEach(() => {
  rmSync(tree, { recursive: true, force: true });
});

describe("readRepoSkills", () => {
  test("a marketplace plugin without a skills list gives its skills/ folders", () => {
    marketplace([{ name: "demo", source: "./plugins/demo" }]);
    write("plugins/demo/skills/alpha/SKILL.md");
    write("plugins/demo/skills/beta/SKILL.md");
    write("plugins/demo/skills/README.md");
    assert.deepEqual(readRepoSkills(tree), {
      plugins: [
        {
          name: "demo",
          skills: [
            { name: "alpha", path: "plugins/demo/skills/alpha" },
            { name: "beta", path: "plugins/demo/skills/beta" },
          ],
        },
      ],
    });
  });

  test("a plugin skills list is followed, with source ./ as the repo root", () => {
    marketplace([{ name: "demo", source: "./", skills: ["./skills/alpha", "./extra"] }]);
    write("skills/alpha/SKILL.md");
    write("skills/gamma/SKILL.md");
    write("extra/delta/SKILL.md");
    assert.deepEqual(readRepoSkills(tree).plugins[0].skills, [
      { name: "alpha", path: "skills/alpha" },
      { name: "delta", path: "extra/delta" },
    ]);
  });

  test("a plugin from another repo has no skills and a note", () => {
    marketplace([
      { name: "far", source: { source: "github", repo: "o/r" } },
      { name: "url", source: { source: "url", url: "https://example.com/r.git" } },
    ]);
    assert.deepEqual(readRepoSkills(tree), {
      plugins: [
        { name: "far", skills: [], note: "plugin in another repo" },
        { name: "url", skills: [], note: "plugin in another repo" },
      ],
    });
  });

  test("without a marketplace it lists base/* with SKILL.md", () => {
    write("skills/b/SKILL.md");
    write("skills/a/SKILL.md");
    write("skills/empty/notes.md");
    write("tools/skills/c/SKILL.md");
    assert.deepEqual(readRepoSkills(tree), {
      skills: [
        { name: "a", path: "skills/a" },
        { name: "b", path: "skills/b" },
      ],
    });
    assert.deepEqual(readRepoSkills(tree, "tools/skills"), { skills: [{ name: "c", path: "tools/skills/c" }] });
  });

  test("invalid folder names and symlinks are skipped", () => {
    write("skills/ok/SKILL.md");
    write("skills/bad name/SKILL.md");
    write("elsewhere/linked/SKILL.md");
    symlinkSync(join(tree, "elsewhere/linked"), join(tree, "skills/linked"));
    const outside = mkdtempSync(join(tmpdir(), "repo-outside-"));
    try {
      writeFileSync(join(outside, "SKILL.md"), "");
      symlinkSync(outside, join(tree, "skills/escape"));
      assert.deepEqual(readRepoSkills(tree), { skills: [{ name: "ok", path: "skills/ok" }] });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a marketplace that is not JSON fails naming the file", () => {
    write(MARKETPLACE_FILE, "{ nope");
    assert.throws(() => readRepoSkills(tree), /marketplace\.json/);
  });
});

describe("pluginOfPath", () => {
  test("names the plugin that holds the path, or undefined", () => {
    write("skills/loose/SKILL.md");
    assert.equal(pluginOfPath(tree, "skills/loose"), undefined);
    marketplace([{ name: "demo", source: "./plugins/demo" }]);
    write("plugins/demo/skills/alpha/SKILL.md");
    assert.equal(pluginOfPath(tree, "plugins/demo/skills/alpha"), "demo");
    assert.equal(pluginOfPath(tree, "skills/loose"), undefined);
  });
});
