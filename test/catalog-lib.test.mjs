/**
 * @file Tests for the pure catalog pieces: the grouped menu, the description
 * read from `SKILL.md`, the expansion of `requires`, release tag ordering and
 * the catalog parts of the manifest and `--select`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertCatalogEntry, highestRelease, readCatalog, skillDescription, withRequires } from "../src/catalog.mjs";
import { catalogMenu, mergeSources, parseManifest, parseSelect } from "../src/lib.mjs";

/**
 * Builds a catalog candidate.
 *
 * @param name - Skill name.
 * @param category - Its category.
 * @param requires - What it requires.
 * @returns The candidate.
 */
function candidate(name, category, requires = []) {
  return { id: `catalog:o/r/${name}`, kind: "catalog", catalog: "o/r", name, category, description: `Does ${name}.`, requires, skills: [name] };
}

describe("catalogMenu", () => {
  test("groups by category in alphabetical order and shows the description on every row", () => {
    const menu = catalogMenu([candidate("test-audit", "Quality"), candidate("planning", "Plans", ["narrative-summary"]), candidate("code-audit", "Quality")]);

    assert.deepEqual(Object.keys(menu), ["Plans", "Quality"]);
    assert.deepEqual(menu.Quality.map((option) => option.label), ["code-audit · Does code-audit.", "test-audit · Does test-audit."]);
    assert.equal(menu.Plans[0].hint, "+ narrative-summary");
    assert.equal(menu.Quality[0].hint, undefined);
  });
});

describe("skillDescription", () => {
  test("reads a folded block description and keeps its first sentence", () => {
    const text = "---\nname: planning\ndescription: |\n  Plans a change in one short\n  document. Use when: (1) a feature.\nargument-hint: x\n---\nBody.\n";

    assert.equal(skillDescription(text), "Plans a change in one short document.");
  });

  test("cuts a long sentence to fit a menu row", () => {
    const text = `---\ndescription: ${"word ".repeat(40)}\n---\n`;

    const description = skillDescription(text);

    assert.equal(description.length, 72);
    assert.ok(description.endsWith("…"));
  });

  test("without a description it is empty", () => {
    assert.equal(skillDescription("# No frontmatter\n"), "");
  });
});

describe("withRequires", () => {
  test("adds requirements transitively, once, even with a cycle", () => {
    const graph = { a: ["b"], b: ["c", "a"], c: [] };

    assert.deepEqual(withRequires(["a"], (name) => graph[name]), ["a", "b", "c"]);
  });
});

describe("highestRelease", () => {
  test("orders tags by number, ignores other refs and returns nothing without release tags", () => {
    const refs = new Map([
      ["refs/tags/v1.9.0", "a"],
      ["refs/tags/v1.10.0", "b"],
      ["refs/tags/v2.0.0-beta", "c"],
      ["refs/heads/v9.0.0", "d"],
    ]);

    assert.deepEqual(highestRelease(refs), { tag: "v1.10.0", commit: "b" });
    assert.equal(highestRelease(new Map([["refs/heads/main", "x"]])), undefined);
  });
});

describe("readCatalog", () => {
  test("SKILL.md cannot be editable", () => {
    const tree = mkdtempSync(join(tmpdir(), "catalog-lib-"));
    writeFileSync(join(tree, "skills-catalog.json"), JSON.stringify({ skills: [{ name: "a", path: "skills/a", editable: ["SKILL.md"] }] }));

    try {
      assert.throws(() => readCatalog(tree), /cannot include SKILL\.md/);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe("catalog sources in the manifest", () => {
  test("a catalog source needs a skills list and no unknown keys", () => {
    assert.doesNotThrow(() => parseManifest(JSON.stringify({ sources: [{ catalog: "o/r", ref: "v1.0.0", skills: ["a"] }] })));
    assert.throws(() => parseManifest(JSON.stringify({ sources: [{ catalog: "o/r" }] })), /non-empty "skills"/);
    assert.throws(() => assertCatalogEntry({ catalog: "o/r", skills: ["a"], path: "x" }), /Unknown key "path"/);
    assert.throws(() => assertCatalogEntry({ catalog: "ssh://h/r", skills: ["a"] }), /Repo not allowed/);
    assert.throws(() => assertCatalogEntry({ catalog: "o/r", ref: "--upload-pack=x", skills: ["a"] }), /branch or tag/);
  });

  test("--select takes a catalog pick whole, colons included", () => {
    assert.deepEqual(parseSelect("catalog:file:///tmp/r/planning,a@m:x"), [{ id: "catalog:file:///tmp/r/planning" }, { id: "a@m", skills: ["x"] }]);
  });

  test("mergeSources extends an existing catalog, takes the new ref and leaves the inputs alone", () => {
    const existing = [{ catalog: "o/r", skills: ["a"] }, { plugin: "p@m" }];

    const merged = mergeSources(existing, [{ catalog: "o/r", ref: "v2.0.0", skills: ["a", "b"] }, { catalog: "o/s", skills: ["c"] }]);

    assert.deepEqual(merged, [{ catalog: "o/r", ref: "v2.0.0", skills: ["a", "b"] }, { plugin: "p@m" }, { catalog: "o/s", skills: ["c"] }]);
    assert.deepEqual(existing[0], { catalog: "o/r", skills: ["a"] });
  });
});
