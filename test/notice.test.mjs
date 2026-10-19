/**
 * @file Tests for `session-notice`: the envelope printed for session-start
 * skills, missing skills, a missing manifest, manifest validation of
 * `sessionStart` and `paths`, and the CLI contract (never fails the hook).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseManifest } from "../src/lib.mjs";
import { sessionNotice } from "../src/notice.mjs";

/** The CLI under test. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.mjs");

/** Temporary repo root of each test. */
let root;

/**
 * Writes a file under the test root, creating its folders.
 *
 * @param file - Path relative to the root.
 * @param content - File content.
 */
function put(file, content) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}

/**
 * Builds the expected envelope of one skill.
 *
 * @param name - Skill name.
 * @param body - SKILL.md content.
 * @returns The exact text the hook prints.
 */
function envelope(name, body) {
  return (
    "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n" +
    `**Below is the full content of your '${name}' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n` +
    `${body}\n</EXTREMELY_IMPORTANT>\n`
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "notice-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sessionNotice", () => {
  test("wraps the SKILL.md of a session-start skill", () => {
    put(".agents/skills.json", JSON.stringify({ sources: [], sessionStart: ["using-superpowers"] }));
    put(".agents/skills/using-superpowers/SKILL.md", "# Using\nbody");
    assert.deepEqual(sessionNotice(root), { text: envelope("using-superpowers", "# Using\nbody"), missing: [] });
  });

  test("names a skill that is not installed and prints nothing for it", () => {
    put(".agents/skills.json", JSON.stringify({ sources: [], sessionStart: ["ghost"] }));
    assert.deepEqual(sessionNotice(root), { text: "", missing: ["ghost"] });
  });

  test("an unreadable SKILL.md goes to missing and the healthy skills still print", () => {
    put(".agents/skills.json", JSON.stringify({ sources: [], sessionStart: ["a", "broken", "b"] }));
    put(".agents/skills/a/SKILL.md", "A");
    put(".agents/skills/broken/SKILL.md/keep", "x");
    put(".agents/skills/b/SKILL.md", "B");
    assert.deepEqual(sessionNotice(root), { text: `${envelope("a", "A")}\n${envelope("b", "B")}`, missing: ["broken"] });
  });

  test("without a manifest everything is empty", () => {
    assert.deepEqual(sessionNotice(root), { text: "", missing: [] });
  });

  test("honors a custom skillsDir", () => {
    put(".agents/skills.json", JSON.stringify({ sources: [], sessionStart: ["a"], paths: { skillsDir: "skills" } }));
    put("skills/a/SKILL.md", "A");
    assert.equal(sessionNotice(root).text, envelope("a", "A"));
  });

  test("several skills: one envelope each, in manifest order, joined by a newline", () => {
    put(".agents/skills.json", JSON.stringify({ sources: [], sessionStart: ["b", "a"] }));
    put(".agents/skills/a/SKILL.md", "A");
    put(".agents/skills/b/SKILL.md", "B");
    assert.equal(sessionNotice(root).text, `${envelope("b", "B")}\n${envelope("a", "A")}`);
  });
});

describe("parseManifest sessionStart and paths", () => {
  test("rejects an unknown paths key naming it", () => {
    assert.throws(() => parseManifest('{"sources":[],"paths":{"foo":"x"}}'), /foo/);
  });

  test("rejects non-string path values and non-object paths", () => {
    assert.throws(() => parseManifest('{"sources":[],"paths":{"lock":1}}'), /lock/);
    assert.throws(() => parseManifest('{"sources":[],"paths":[]}'), /paths/);
  });

  test("rejects an invalid sessionStart", () => {
    assert.throws(() => parseManifest('{"sources":[],"sessionStart":"x"}'), /sessionStart/);
    assert.throws(() => parseManifest('{"sources":[],"sessionStart":["../x"]}'), /Invalid skill name/);
  });

  test("accepts valid ones", () => {
    const text = '{"sources":[],"sessionStart":["a"],"paths":{"lock":"l","skillsDir":"s","settings":"t"}}';
    assert.deepEqual(parseManifest(text).sessionStart, ["a"]);
  });
});

describe("session-notice CLI", () => {
  /**
   * Runs the CLI in the test repo.
   *
   * @returns The spawn result.
   */
  function run() {
    spawnSync("git", ["init", "-q"], { cwd: root });
    return spawnSync(process.execPath, [CLI, "session-notice"], { cwd: root, encoding: "utf8" });
  }

  test("prints the envelope and warns about missing skills, exit 0", () => {
    put(".agents/skills.json", JSON.stringify({ sources: [], sessionStart: ["a", "ghost"] }));
    put(".agents/skills/a/SKILL.md", "A");
    const result = run();
    assert.equal(result.status, 0);
    assert.equal(result.stdout, envelope("a", "A"));
    assert.equal(result.stderr, 'skills-manager: session-start skill "ghost" is not installed\n');
  });

  test("a broken manifest prints nothing, one stderr line, exit 0", () => {
    put(".agents/skills.json", '{"sources":[],"paths":{"foo":"x"}}');
    const result = run();
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^skills-manager: .*foo.*\n$/);
  });
});
