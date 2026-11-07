/**
 * @file Tests for the language of the CLI: `--lang`, `SKILLS_MANAGER_LANG`, `--help`, the
 * final block of `check` and `session-notice`, against a temporary repo with one local skill.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Identity so the origin can commit without the machine's git config. */
const GIT_IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

/**
 * Runs git, failing the test if it exits badly.
 *
 * @param cwd - Folder.
 * @param args - Git arguments.
 */
function git(cwd, args) {
  const result = spawnSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

describe("install and update", () => {
  let origin;

  /**
   * Commits the origin's skills with the given text.
   *
   * @param body - Text of both skills.
   */
  function publish(body) {
    for (const name of ["one", "two"]) {
      write(join(origin, `skills/${name}/SKILL.md`), `---\nname: ${name}\ndescription: Does ${name}.\n---\n${body}\n`);
    }
    git(origin, ["add", "-A"]);
    git(origin, ["commit", "-q", "-m", body]);
  }

  beforeEach(() => {
    origin = join(repo, "origin-repo");
    mkdirSync(origin);
    git(origin, ["init", "-q", "-b", "main"]);
    publish("v1");
    write(join(repo, ".agents/skills.json"), JSON.stringify({
      sources: [{ repo: `file://${origin}`, path: "skills/one" }, { repo: `file://${origin}`, path: "skills/two" }],
    }));
    rmSync(join(repo, ".agents/skills.lock.json"));
    rmSync(join(repo, ".agents/skills/alpha"), { recursive: true });
    write(join(repo, ".gitignore"), "origin-repo\n");
  });

  test("the first install closes with [ok], the done title and each new skill; the second says it is up to date", () => {
    const first = cli(["install"]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /\[ok\]/);
    assert.ok(first.stdout.includes(es.install.done()));
    assert.ok(first.stdout.includes("one") && first.stdout.includes("two"));
    const second = cli(["install"]);
    assert.equal(second.status, 0, second.stderr);
    assert.ok(second.stdout.includes(es.install.upToDate()));
  });

  test("--lang en gives the English title", () => {
    assert.ok(cli(["install", "--lang", "en"]).stdout.includes(en.install.done()));
  });

  test("update --dry-run after a new commit says [?] and the dry-run title, and writes nothing", () => {
    cli(["install"]);
    const before = readFileSync(join(repo, ".agents/skills.lock.json"), "utf8");
    publish("v2");
    const result = cli(["update", "--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[\?\]/);
    assert.ok(result.stdout.includes(es.install.dryRun()));
    assert.ok(result.stdout.includes("one") && result.stdout.includes("→"));
    assert.equal(readFileSync(join(repo, ".agents/skills.lock.json"), "utf8"), before);
  });

  test("install without a manifest suggests init", () => {
    rmSync(join(repo, ".agents/skills.json"));
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[\?\]/);
    assert.ok(result.stdout.includes(es.install.noManifest({ file: ".agents/skills.json" })));
    assert.ok(result.stdout.includes("skills-manager init"));
  });

  test("a hand-edited skill fails with [!] and both commands whole", () => {
    cli(["install"]);
    write(join(repo, ".agents/skills/one/SKILL.md"), "edited\n");
    publish("v2");
    const result = cli(["update", "two"]);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("[!]"));
    assert.ok(result.stderr.includes("rm -rf .agents/skills/one && skills-manager install"));
    assert.ok(result.stderr.includes("skills-manager update one"));
    assert.ok(!result.stderr.includes("was edited by hand"));
  });

  test("an own skill with the name of an incoming one fails in Spanish with the whole --replace hint", () => {
    write(join(repo, ".agents/skills/one/SKILL.md"), "own\n");
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.ok(!result.stderr.includes(es.errors.unexpected()));
    assert.ok(result.stderr.includes("--replace one"));
    assert.ok(!result.stderr.includes("already exists"));
  });
});

describe("main routing", () => {
  test("an argument named session-notice does not take the hook path", () => {
    const result = cli(["add", "--candidates", "--select", "session-notice"], { SKILLS_HOME: repo });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
    const hook = cli(["--lang", "en", "session-notice"]);
    assert.equal(hook.status, 0);
  });

  test("session-notice stays a hook even after --lang=en and with a bad --lang", () => {
    assert.equal(cli(["--lang=en", "session-notice"]).status, 0);
    assert.equal(cli(["--lang", "fr", "session-notice"]).status, 0);
  });

  test("no subcommand prints the usage on stderr and exits 2", () => {
    const result = cli([]);
    assert.equal(result.status, 2);
    assert.ok(result.stderr.includes(es.usage.main));
    assert.equal(result.stdout, "");
    assert.ok(cli(["--lang", "en"]).stderr.includes(en.usage.main));
  });
});
