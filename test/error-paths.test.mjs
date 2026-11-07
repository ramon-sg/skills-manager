/**
 * @file Tests for error paths that must end in their own message: a lock or a catalog
 * that is not JSON, and an `init` whose copy of the bundled skill fails after installing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { setLang } from "../src/lang.mjs";
import { es } from "../src/messages/es.mjs";
import { commandPick } from "../src/pick.mjs";

/** The CLI under test. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.mjs");

/** Git configuration to commit without depending on the user's. */
const GIT_IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

/** Temporary folder of each test. */
let base;

/** Repo where the CLI runs. */
let repo;

/**
 * Writes a file, creating its folders.
 *
 * @param file - Absolute path.
 * @param content - Text.
 */
function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * Runs git in a folder and fails the test if it exits badly.
 *
 * @param cwd - Folder where it runs.
 * @param args - Git arguments.
 */
function git(cwd, args) {
  const result = spawnSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
}

/**
 * Runs the CLI in Spanish in the temporary repo.
 *
 * @param args - CLI arguments.
 * @returns The spawn result.
 */
function cli(args) {
  const env = { ...process.env, SKILLS_HOME: join(base, "home") };
  for (const name of ["SKILLS_MANAGER_LANG", "NO_COLOR", "LANG", "LC_ALL"]) {
    delete env[name];
  }
  return spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: "utf8", env });
}

/**
 * Checks a keyed error block: its title is exactly the sentence, the parser's message
 * is indented below it and there is no generic title.
 *
 * @param result - Spawn result of the CLI.
 * @param sentence - The catalog sentence that must appear.
 */
function assertJsonError(result, sentence) {
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /\[!\]/);
  assert.ok(result.stderr.split("\n").some((line) => line.trimEnd().endsWith(`[!] ${sentence}`)), result.stderr);
  assert.ok(result.stderr.split("\n").some((line) => /^\s+\S/.test(line) && /JSON/.test(line)), result.stderr);
  assert.ok(!result.stderr.includes(es.errors.unexpected()), result.stderr);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "skills-errors-"));
  repo = join(base, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("JSON that is not valid", () => {
  test("a broken lock names the lock, with the parser's message below", () => {
    write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [] }));
    write(join(repo, ".agents/skills.lock.json"), "{ not json");
    assertJsonError(cli(["check"]), es.errors.lock.badJson({ file: "skills.lock.json" }));
  });

  test("a broken catalog file names it, with the parser's message below", () => {
    const origin = join(base, "origin");
    mkdirSync(origin);
    git(origin, ["init", "-q"]);
    write(join(origin, "skills-catalog.json"), "{ not json");
    git(origin, ["add", "."]);
    git(origin, ["commit", "-qm", "broken catalog"]);
    git(origin, ["tag", "v1.0.0"]);
    write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [] }));
    assertJsonError(cli(["add", "--catalog", `file://${origin}`, "--candidates"]), es.errors.catalog.badJson({ file: "skills-catalog.json" }));
  });
});

describe("init whose copy of the bundled skill fails", () => {
  const asRoot = process.getuid?.() === 0;

  test("fails without reporting the install as done", { skip: asRoot || process.platform === "win32" }, async () => {
    setLang("es");
    const home = join(base, "home");
    write(join(home, ".claude/skills/beta/SKILL.md"), "Beta.\n");
    const skillsDir = join(repo, ".agents/skills");
    let reported = false;
    const install = async () => {
      // NOTE: a skills folder without write permission makes the copy that follows fail.
      mkdirSync(skillsDir, { recursive: true });
      chmodSync(skillsDir, 0o555);
      return { changed: true, wrote: true, changes: [] };
    };
    try {
      await assert.rejects(commandPick(repo, { init: true, args: ["--select", "beta"], home, install, report: () => { reported = true; } }));
      assert.equal(reported, false);
    } finally {
      chmodSync(skillsDir, 0o755);
    }
  });
});
