/**
 * @file Tests for the language of the CLI: `--lang`, `SKILLS_MANAGER_LANG`, `--help`, the
 * final block of `check` and `session-notice`, against a temporary repo with one local skill.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { hashFiles } from "../src/lib.mjs";
import { en } from "../src/messages/en.mjs";
import { es } from "../src/messages/es.mjs";

/** The CLI under test. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.mjs");

/** Temporary repo. */
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
 * Runs the CLI in the temporary repo with a clean language environment.
 *
 * @param args - CLI arguments.
 * @param extra - Environment variables to add.
 * @returns The spawn result.
 */
function cli(args, extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of ["SKILLS_MANAGER_LANG", "NO_COLOR", "LANG", "LC_ALL"]) {
    if (!(name in extra)) {
      delete env[name];
    }
  }
  return spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: "utf8", env });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "skills-lang-"));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [{ local: "alpha" }] }));
  write(join(repo, ".agents/skills/alpha/SKILL.md"), "Alpha.\n");
  const hash = hashFiles([{ path: "SKILL.md", content: Buffer.from("Alpha.\n") }]);
  write(join(repo, ".agents/skills.lock.json"), JSON.stringify({ lockVersion: 1, skills: { alpha: { source: "local", hash } }, plugins: [] }));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("language of check", () => {
  test("defaults to Spanish, with the [ok] mark", () => {
    const result = cli(["check"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[ok\]/);
    assert.ok(result.stdout.includes(es.check.ok()));
  });

  test("--lang en, --lang=en and --lang before the subcommand give English", () => {
    for (const args of [["check", "--lang", "en"], ["--lang=en", "check"], ["--lang", "en", "check"]]) {
      const result = cli(args);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes(en.check.ok()), args.join(" "));
    }
  });

  test("SKILLS_MANAGER_LANG sets the language and --lang wins over it", () => {
    assert.ok(cli(["check"], { SKILLS_MANAGER_LANG: "en" }).stdout.includes(en.check.ok()));
    assert.ok(cli(["check", "--lang", "es"], { SKILLS_MANAGER_LANG: "en" }).stdout.includes(es.check.ok()));
  });

  test("LANG is not read", () => {
    assert.ok(cli(["check"], { LANG: "en_US.UTF-8" }).stdout.includes(es.check.ok()));
  });

  test("a missing skill exits 1 with the problem, the name and the next command", () => {
    rmSync(join(repo, ".agents/skills/alpha"), { recursive: true });
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    for (const part of ["[!]", es.check.problems.missing(), "alpha", "skills-manager install"]) {
      assert.ok(result.stderr.includes(part), part);
    }
  });

  test("without a terminal and without NO_COLOR there is no color and no Kuro", () => {
    const outputs = [cli(["check"]).stdout];
    rmSync(join(repo, ".agents/skills/alpha"), { recursive: true });
    outputs.push(cli(["check"]).stderr);
    for (const output of outputs) {
      assert.ok(!output.includes("\x1b["));
      assert.ok(!output.includes("▄█████▄"));
    }
  });
});

describe("invalid language", () => {
  test("--lang fr exits 2 in Spanish naming the flag and the value", () => {
    const result = cli(["check", "--lang", "fr"]);
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes("[!]"));
    assert.ok(result.stderr.includes("--lang") && result.stderr.includes("fr"));
    assert.ok(result.stderr.includes(es.lang.invalid({ source: "--lang", value: "fr" })));
  });

  test("the flag wins over an invalid variable, which is not validated", () => {
    const result = cli(["check", "--lang", "en"], { SKILLS_MANAGER_LANG: "fr" });
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes(en.check.ok()));
  });
});

describe("--help", () => {
  const WORDS = [
    "install", "update", "check", "list", "session-notice", "init", "add", "--dry-run", "--replace",
    "--catalog", "--repo", "--ref", "--path", "--candidates", "--select", "--lang", "SKILLS_MANAGER_LANG",
  ];

  test("lists commands and options in both languages, exit 0", () => {
    const spanish = cli(["--help"]);
    const english = cli(["--help", "--lang", "en"]);
    for (const result of [spanish, english]) {
      assert.equal(result.status, 0);
      for (const word of WORDS) {
        assert.ok(result.stdout.includes(word), word);
      }
    }
    assert.notEqual(spanish.stdout, english.stdout);
    assert.ok(spanish.stdout.includes(es.usage.main));
    assert.ok(english.stdout.includes(en.usage.main));
  });

  test("-h and help give the same text", () => {
    const expected = cli(["--help"]).stdout;
    assert.equal(cli(["-h"]).stdout, expected);
    assert.equal(cli(["help"]).stdout, expected);
    assert.equal(cli(["install", "--help"]).stdout, expected);
  });
});

describe("errors", () => {
  test("an unknown subcommand exits 2 with a [!] block in Spanish", () => {
    const result = cli(["frobnicate"]);
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes("[!]"));
    assert.ok(result.stderr.includes("frobnicate"));
    assert.ok(result.stderr.includes(es.errors.unknownCommand({ command: "frobnicate" })));
  });

  test("--replace without names, or without a valid subcommand, exits 2", () => {
    const missing = cli(["install", "--replace"]);
    assert.equal(missing.status, 2);
    assert.ok(missing.stderr.includes(es.replace.missing()));
    const misplaced = cli(["check", "--replace", "a"]);
    assert.equal(misplaced.status, 2);
    assert.ok(misplaced.stderr.includes(es.replace.misplaced()));
  });

  test("an error nobody wrapped gets the generic title and its original message", () => {
    write(join(repo, ".agents/skills.json"), "not json");
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(es.errors.unexpected()));
  });
});

describe("session-notice language", () => {
  test("an invalid SKILLS_MANAGER_LANG falls back to Spanish with one prefixed stderr line, exit 0", () => {
    const plain = cli(["session-notice"]);
    const bad = cli(["session-notice"], { SKILLS_MANAGER_LANG: "fr" });
    assert.equal(bad.status, 0);
    assert.equal(bad.stdout, plain.stdout);
    assert.match(bad.stderr, /^skills-manager: .*fr/);
  });

  test("warns about a missing session-start skill in the chosen language", () => {
    write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [], sessionStart: ["ghost"] }));
    assert.ok(cli(["session-notice"]).stderr.includes(es.notice.missing({ name: "ghost" })));
    assert.ok(cli(["session-notice", "--lang", "en"]).stderr.includes(en.notice.missing({ name: "ghost" })));
  });
});
