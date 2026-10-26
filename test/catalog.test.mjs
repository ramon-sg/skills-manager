/**
 * @file Tests for catalog sources against temporary repos: a local git origin
 * with a `skills-catalog.json` and release tags, reached through `file://`,
 * and the `install`, `update`, `check` and `add` commands. No network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { installAsking, OwnSkillsError } from "../src/cli.mjs";

/** The CLI under test. */
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.mjs");

/** Git configuration to commit without depending on the user's. */
const GIT_IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

/** Lock the CLI writes, relative to the repo. */
const LOCK = ".agents/skills.lock.json";

/** Temporary folder of each test. */
let base;

/** Repo where the CLI runs. */
let repo;

/** Catalog origin repo. */
let origin;

/** Fake home, so the machine's `~/.claude` is never read. */
let home;

/**
 * Runs git in a folder and fails the test if it exits badly.
 *
 * @param cwd - Folder where it runs.
 * @param args - Git arguments.
 * @returns The standard output, trimmed.
 */
function git(cwd, args) {
  const result = spawnSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Writes a file, creating its folder.
 *
 * @param file - Absolute path.
 * @param content - Content.
 */
function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/**
 * Writes a skill in a catalog origin.
 *
 * @param root - Origin repo.
 * @param name - Skill name; it lives in `skills/<name>`.
 * @param body - Text after the frontmatter, to tell versions apart.
 */
function writeSkill(root, name, body) {
  write(join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Does ${name}. Use when needed.\n---\n${body}\n`);
}

/**
 * Writes the `skills-catalog.json` of an origin.
 *
 * @param root - Origin repo.
 * @param skills - Catalog entries; `path` defaults to `skills/<name>`.
 * @param catalogVersion - Format version to write.
 */
function writeCatalog(root, skills, catalogVersion = 1) {
  const entries = skills.map((skill) => ({ path: `skills/${skill.name}`, ...skill }));
  write(join(root, "skills-catalog.json"), JSON.stringify({ catalogVersion, skills: entries }));
}

/**
 * Commits everything in an origin and tags it.
 *
 * @param root - Origin repo.
 * @param tag - Release tag.
 * @param annotated - Whether the tag is annotated.
 * @returns The sha of the tagged commit.
 */
function release(root, tag, annotated = false) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", tag]);
  git(root, annotated ? ["tag", "-a", tag, "-m", tag] : ["tag", tag]);
  return git(root, ["rev-parse", "HEAD"]);
}

/**
 * Creates an empty origin repo.
 *
 * @param name - Folder name under the test folder.
 * @returns Its path.
 */
function makeOrigin(name) {
  const root = join(base, name);
  mkdirSync(root);
  git(root, ["init", "-q"]);
  return root;
}

/**
 * Runs the CLI in the temporary repo, with the fake home.
 *
 * @param args - CLI arguments.
 * @returns Exit code and combined output.
 */
function cli(args) {
  const env = { ...process.env, SKILLS_HOME: home };
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Reads the lock of the temporary repo.
 *
 * @returns The parsed lock.
 */
function lock() {
  return JSON.parse(readFileSync(join(repo, LOCK), "utf8"));
}

/**
 * Reads an installed skill's `SKILL.md`.
 *
 * @param name - Skill name.
 * @returns Its content.
 */
function installed(name) {
  return readFileSync(join(repo, ".agents/skills", name, "SKILL.md"), "utf8");
}

/**
 * Replaces the manifest sources of the temporary repo.
 *
 * @param sources - New sources.
 */
function setSources(sources) {
  write(join(repo, ".agents/skills.json"), JSON.stringify({ sources }));
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "catalog-test-"));
  repo = join(base, "repo");
  home = join(base, "home");
  mkdirSync(repo);
  mkdirSync(home);
  git(repo, ["init", "-q"]);
  origin = makeOrigin("origin");
  writeSkill(origin, "planning", "planning v1");
  writeSkill(origin, "narrative-summary", "narrative v1");
  writeSkill(origin, "code-audit", "audit v1");
  writeCatalog(origin, [
    { name: "planning", category: "Plans", requires: ["narrative-summary"] },
    { name: "narrative-summary", category: "Writing" },
    { name: "code-audit", category: "Quality" },
  ]);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("catalog install", () => {
  test("copies only the named skills, each with its tag and commit in the lock", () => {
    const commit = release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    const skills = lock().skills;
    assert.deepEqual(Object.keys(skills), ["code-audit"]);
    assert.equal(skills["code-audit"].commit, commit);
    assert.equal(skills["code-audit"].tag, "v1.0.0");
    assert.equal(skills["code-audit"].source, `catalog:file://${origin}`);
  });

  test("installs the highest release tag, not the newest commit nor the last tag in text order", () => {
    const wanted = release(origin, "v1.10.0");
    writeSkill(origin, "code-audit", "audit older line");
    release(origin, "v1.9.0");
    writeSkill(origin, "code-audit", "audit untagged");
    git(origin, ["commit", "-q", "-am", "untagged"]);
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(lock().skills["code-audit"].commit, wanted);
    assert.match(installed("code-audit"), /audit v1/);
  });

  test("with an annotated tag the lock pins the commit, not the tag object", () => {
    const commit = release(origin, "v1.0.0", true);
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.notEqual(git(origin, ["rev-parse", "v1.0.0"]), commit);
    assert.equal(lock().skills["code-audit"].commit, commit);
  });

  test("installs what a skill requires, and check and a second install see no difference", () => {
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["planning"] }]);
    assert.equal(cli(["install"]).status, 0);
    const before = readFileSync(join(repo, LOCK), "utf8");

    const check = cli(["check"]);
    const again = cli(["install"]);

    assert.match(installed("narrative-summary"), /narrative v1/);
    assert.deepEqual(lock().skills.planning.requires, ["narrative-summary"]);
    assert.equal(check.status, 0, check.output);
    assert.equal(again.status, 0, again.output);
    assert.equal(again.output, "");
    assert.equal(readFileSync(join(repo, LOCK), "utf8"), before);
  });

  test("a catalog with a newer catalogVersion stops asking to upgrade", () => {
    writeCatalog(origin, [{ name: "code-audit" }], 2);
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /catalogVersion 2; upgrade/);
  });

  test("two catalogs with a skill of the same name stop naming both", () => {
    release(origin, "v1.0.0");
    const other = makeOrigin("other");
    writeSkill(other, "code-audit", "other audit");
    writeCatalog(other, [{ name: "code-audit" }]);
    release(other, "v1.0.0");
    setSources([
      { catalog: `file://${origin}`, skills: ["code-audit"] },
      { catalog: `file://${other}`, skills: ["code-audit"] },
    ]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.match(result.output, new RegExp(`"code-audit" comes from catalog:file://${origin}, catalog:file://${other}`));
  });
});

describe("catalog sources that share names", () => {
  test("a manifest with the same catalog twice is rejected before anything is removed", () => {
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["planning"] }]);
    assert.equal(cli(["install"]).status, 0);
    setSources([
      { catalog: `file://${origin}`, skills: ["planning"] },
      { catalog: `file://${origin}`, skills: ["code-audit"] },
    ]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /appears twice/);
    assert.match(installed("planning"), /planning v1/);
  });

  test("moving a skill to another catalog listed first keeps it installed from the new one", () => {
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["planning", "code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    const other = makeOrigin("other");
    writeSkill(other, "code-audit", "other audit");
    writeCatalog(other, [{ name: "code-audit" }]);
    release(other, "v1.0.0");
    setSources([
      { catalog: `file://${other}`, skills: ["code-audit"] },
      { catalog: `file://${origin}`, skills: ["planning"] },
    ]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /code-audit: will be removed/);
    assert.match(installed("code-audit"), /other audit/);
    assert.equal(lock().skills["code-audit"].source, `catalog:file://${other}`);
    assert.equal(cli(["check"]).status, 0);
  });

  test("two catalogs with the same skill say to keep it in one catalog source, not to exclude it", () => {
    release(origin, "v1.0.0");
    const other = makeOrigin("other");
    writeSkill(other, "code-audit", "other audit");
    writeCatalog(other, [{ name: "code-audit" }]);
    release(other, "v1.0.0");
    setSources([
      { catalog: `file://${origin}`, skills: ["code-audit"] },
      { catalog: `file://${other}`, skills: ["code-audit"] },
    ]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.doesNotMatch(result.output, /exclude/);
    assert.match(result.output, /only one of those catalog sources/);
  });
});

describe("catalog ref", () => {
  test("a ref pinned to an annotated tag locks the commit, not the tag object", () => {
    const commit = release(origin, "v1.0.0", true);
    writeSkill(origin, "code-audit", "audit v2");
    release(origin, "v1.1.0");
    setSources([{ catalog: `file://${origin}`, ref: "v1.0.0", skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(lock().skills["code-audit"].commit, commit);
    assert.equal(lock().skills["code-audit"].tag, "v1.0.0");
  });

  test("a ref that only matches the end of another branch name stops instead of following it", () => {
    release(origin, "v1.0.0");
    git(origin, ["branch", "team/foo"]);
    setSources([{ catalog: `file://${origin}`, ref: "foo", skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /has no foo/);
  });
});

describe("catalog update", () => {
  test("update <name> moves only that skill to the latest release; the others keep their commit", () => {
    const first = release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["planning", "code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    writeSkill(origin, "planning", "planning v2");
    writeSkill(origin, "code-audit", "audit v2");
    const second = release(origin, "v1.1.0");

    const result = cli(["update", "planning"]);

    assert.equal(result.status, 0, result.output);
    const skills = lock().skills;
    assert.equal(skills.planning.commit, second);
    assert.equal(skills.planning.tag, "v1.1.0");
    assert.equal(skills["code-audit"].commit, first);
    assert.match(installed("planning"), /planning v2/);
    assert.match(installed("code-audit"), /audit v1/);
    assert.equal(cli(["check"]).status, 0);
  });

  test("update without a name moves every skill of the catalog", () => {
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["planning", "code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    writeSkill(origin, "code-audit", "audit v2");
    const second = release(origin, "v1.1.0");

    const result = cli(["update"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(lock().skills["code-audit"].commit, second);
    assert.match(installed("code-audit"), /audit v2/);
  });

  test("a skill missing on disk is rebuilt at its lock commit, not the latest release", () => {
    const first = release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    writeSkill(origin, "code-audit", "audit v2");
    release(origin, "v1.1.0");
    rmSync(join(repo, ".agents/skills/code-audit"), { recursive: true });

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(lock().skills["code-audit"].commit, first);
    assert.match(installed("code-audit"), /audit v1/);
  });

  test("dropping a skill from the list removes it, but keeps one still required", () => {
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["planning", "narrative-summary", "code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    setSources([{ catalog: `file://${origin}`, skills: ["planning"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(Object.keys(lock().skills), ["narrative-summary", "planning"]);
    assert.equal(cli(["check"]).status, 0);
  });
});

describe("add --catalog", () => {
  test("--select catalog:<repo>/<skill> without a TTY adds the source and installs it with its requires", () => {
    release(origin, "v1.0.0");
    setSources([]);

    const result = cli(["add", "--catalog", `file://${origin}`, "--select", `catalog:file://${origin}/planning`]);

    assert.equal(result.status, 0, result.output);
    const manifest = JSON.parse(readFileSync(join(repo, ".agents/skills.json"), "utf8"));
    assert.deepEqual(manifest.sources, [{ catalog: `file://${origin}`, skills: ["planning"] }]);
    assert.deepEqual(Object.keys(lock().skills), ["narrative-summary", "planning"]);
  });

  test("a second add of the same catalog extends its skills list instead of adding a source", () => {
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);

    const result = cli(["add", "--catalog", `file://${origin}`, "--select", `catalog:file://${origin}/planning`]);

    assert.equal(result.status, 0, result.output);
    const manifest = JSON.parse(readFileSync(join(repo, ".agents/skills.json"), "utf8"));
    assert.deepEqual(manifest.sources, [{ catalog: `file://${origin}`, skills: ["code-audit", "planning"] }]);
  });

  test("--candidates lists each skill with category, description and requires, minus those already in the manifest", () => {
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["add", "--catalog", `file://${origin}`, "--candidates"]);

    assert.equal(result.status, 0, result.output);
    const candidates = JSON.parse(result.output);
    assert.deepEqual(candidates.map((candidate) => candidate.name), ["planning", "narrative-summary"]);
    assert.equal(candidates[0].category, "Plans");
    assert.equal(candidates[0].description, "Does planning.");
    assert.deepEqual(candidates[0].requires, ["narrative-summary"]);
  });

  test("with --catalog a bare --select id is not a catalog skill", () => {
    release(origin, "v1.0.0");
    setSources([]);

    const result = cli(["add", "--catalog", `file://${origin}`, "--select", "planning"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /"planning" is not among the candidates/);
  });

  test("--catalog <repo>#<tag> pins the source to that tag", () => {
    const first = release(origin, "v1.0.0");
    writeSkill(origin, "planning", "planning v2");
    release(origin, "v1.1.0");
    setSources([]);

    const result = cli(["add", "--catalog", `file://${origin}#v1.0.0`, "--select", `catalog:file://${origin}/planning`]);

    assert.equal(result.status, 0, result.output);
    const manifest = JSON.parse(readFileSync(join(repo, ".agents/skills.json"), "utf8"));
    assert.equal(manifest.sources[0].ref, "v1.0.0");
    assert.equal(lock().skills.planning.commit, first);
    assert.match(installed("planning"), /planning v1/);
  });
});

describe("editable files", () => {
  /**
   * Publishes `code-audit` with an editable `project.md` and its template.
   *
   * @param template - Content of `project.md.template`.
   * @param tag - Release tag.
   * @returns The sha of the tagged commit.
   */
  function publishEditable(template, tag) {
    write(join(origin, "skills/code-audit/project.md.template"), template);
    writeCatalog(origin, [{ name: "code-audit", editable: ["project.md"] }]);
    return release(origin, tag);
  }

  /**
   * Path of a file inside the installed `code-audit`.
   *
   * @param file - Path inside the skill.
   * @returns The absolute path.
   */
  function auditFile(file) {
    return join(repo, ".agents/skills/code-audit", file);
  }

  test("a missing editable file is created from its template", () => {
    publishEditable("Conventions: none yet.\n", "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(readFileSync(auditFile("project.md"), "utf8"), "Conventions: none yet.\n");
    assert.deepEqual(lock().skills["code-audit"].editable, ["project.md"]);
  });

  test("a skill that ships the editable file itself uses it as the starting content, out of the hash", () => {
    write(join(origin, "skills/code-audit/project.md"), "Shipped default.\n");
    writeCatalog(origin, [{ name: "code-audit", editable: ["project.md"] }]);
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    const shipped = readFileSync(auditFile("project.md"), "utf8");
    writeFileSync(auditFile("project.md"), "Ours.\n");

    const check = cli(["check"]);

    assert.equal(shipped, "Shipped default.\n");
    assert.equal(check.status, 0, check.output);
  });

  test("install recreates a deleted editable file from its template without moving the skill", () => {
    const first = publishEditable("Conventions: none yet.\n", "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    publishEditable("Conventions: newer.\n", "v1.1.0");
    rmSync(auditFile("project.md"));

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(readFileSync(auditFile("project.md"), "utf8"), "Conventions: none yet.\n");
    assert.equal(lock().skills["code-audit"].commit, first);
  });

  test("an editable created from an executable template keeps the executable bit", () => {
    write(join(origin, "skills/code-audit/setup.sh.template"), "#!/bin/sh\n");
    chmodSync(join(origin, "skills/code-audit/setup.sh.template"), 0o755);
    writeCatalog(origin, [{ name: "code-audit", editable: ["setup.sh"] }]);
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.output);
    assert.notEqual(statSync(auditFile("setup.sh")).mode & 0o111, 0);
  });

  test("a new version that ships the file as a normal one warns that the repo's copy will be replaced", () => {
    publishEditable("Conventions: none yet.\n", "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    write(join(origin, "skills/code-audit/project.md"), "Shipped.\n");
    writeCatalog(origin, [{ name: "code-audit" }]);
    release(origin, "v1.1.0");

    const result = cli(["update", "--dry-run"]);

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /code-audit: project\.md is no longer editable; the repo's copy will be replaced by the skill's/);
  });

  test("editing it does not make check or install fail", () => {
    publishEditable("Conventions: none yet.\n", "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    writeFileSync(auditFile("project.md"), "Conventions: ours.\n");

    const check = cli(["check"]);
    const install = cli(["install"]);

    assert.equal(check.status, 0, check.output);
    assert.equal(install.status, 0, install.output);
    assert.equal(readFileSync(auditFile("project.md"), "utf8"), "Conventions: ours.\n");
  });

  test("update rebuilds the skill but keeps the edited file, and brings the new template", () => {
    publishEditable("Conventions: none yet.\n", "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    writeFileSync(auditFile("project.md"), "Conventions: ours.\n");
    writeSkill(origin, "code-audit", "audit v2");
    const second = publishEditable("Conventions: new template.\n", "v1.1.0");

    const result = cli(["update", "code-audit"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(lock().skills["code-audit"].commit, second);
    assert.match(installed("code-audit"), /audit v2/);
    assert.equal(readFileSync(auditFile("project.md"), "utf8"), "Conventions: ours.\n");
    assert.equal(readFileSync(auditFile("project.md.template"), "utf8"), "Conventions: new template.\n");
    assert.equal(cli(["check"]).status, 0);
  });

  test("editing any other file of the skill still makes check fail", () => {
    publishEditable("Conventions: none yet.\n", "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    writeFileSync(auditFile("project.md.template"), "changed\n");

    const result = cli(["check"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /edited by hand: code-audit/);
  });

  test("the lock is version 2 only while some skill has editable files", () => {
    publishEditable("Conventions: none yet.\n", "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
    assert.equal(cli(["install"]).status, 0);
    const withEditable = lock().lockVersion;
    writeCatalog(origin, [{ name: "code-audit" }]);
    release(origin, "v1.1.0");

    const result = cli(["update"]);

    assert.equal(result.status, 0, result.output);
    assert.equal(withEditable, 2);
    assert.match(result.output, /code-audit: project\.md is no longer editable; the repo's copy will be removed/);
    assert.equal(lock().lockVersion, 1);
    assert.equal(lock().skills["code-audit"].editable, undefined);
    assert.equal(existsSync(auditFile("project.md")), false);
  });

  test("an editable path that climbs out of the skill is rejected", () => {
    writeCatalog(origin, [{ name: "code-audit", editable: ["../outside.md"] }]);
    release(origin, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /relative and without/);
  });
});

describe("own skills with the name of an incoming one", () => {
  /**
   * Publishes `code-audit` with an editable `project.md`, and gives the repo its own
   * `code-audit` with an extra file and its own `project.md`.
   */
  function ownAudit() {
    write(join(origin, "skills/code-audit/project.md.template"), "Template.\n");
    writeCatalog(origin, [{ name: "code-audit", editable: ["project.md"] }, { name: "planning" }, { name: "narrative-summary" }]);
    release(origin, "v1.0.0");
    write(join(repo, ".agents/skills/code-audit/SKILL.md"), "the repo's own audit\n");
    write(join(repo, ".agents/skills/code-audit/labels.md"), "own notes\n");
    write(join(repo, ".agents/skills/code-audit/project.md"), "Kaname rules.\n");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
  }

  test("without a terminal nor --replace it stops, says how to allow it, and leaves the own folder", () => {
    ownAudit();

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /"code-audit" .* already exists as an own skill/);
    assert.match(result.output, /--replace code-audit/);
    assert.equal(installed("code-audit"), "the repo's own audit\n");
    assert.equal(existsSync(join(repo, LOCK)), false);
  });

  test("--replace replaces the own folder with the incoming skill, and keeps its project.md", () => {
    ownAudit();

    const result = cli(["install", "--replace", "code-audit"]);

    assert.equal(result.status, 0, result.output);
    assert.match(installed("code-audit"), /audit v1/);
    assert.equal(existsSync(join(repo, ".agents/skills/code-audit/labels.md")), false);
    assert.equal(readFileSync(join(repo, ".agents/skills/code-audit/project.md"), "utf8"), "Kaname rules.\n");
    assert.equal(lock().skills["code-audit"].tag, "v1.0.0");
    assert.equal(cli(["check"]).status, 0);
  });

  test("--replace with another name does not allow it", () => {
    ownAudit();

    const result = cli(["install", "--replace=planning"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /--replace code-audit; replacing deletes each own folder: code-audit \(keeps project\.md\)/);
    assert.equal(installed("code-audit"), "the repo's own audit\n");
  });

  test("update --dry-run says what it would replace, without --replace and without asking", () => {
    ownAudit();

    const result = cli(["update", "--dry-run"]);

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /code-audit: new \(v1\.0\.0 [0-9a-f]+\), replaces the repo's own folder/);
    assert.equal(installed("code-audit"), "the repo's own audit\n");
  });

  test("the hint names every own skill to replace, and says which keep nothing", () => {
    ownAudit();
    writeCatalog(origin, [{ name: "code-audit", editable: ["project.md"], requires: ["planning"] }, { name: "planning" }, { name: "narrative-summary" }]);
    release(origin, "v1.1.0");
    write(join(repo, ".agents/skills/planning/SKILL.md"), "the repo's own planning\n");
    write(join(repo, ".agents/skills/planning/project.md"), "not editable there\n");

    const result = cli(["install", "--replace", "code-audit"]);

    assert.equal(result.status, 1);
    assert.match(result.output, /--replace code-audit,planning; replacing deletes each own folder: planning \(nothing in its folder is kept\)/);
  });

  test("a clash between two catalogs is not offered as a replace, even with an own skill too", () => {
    ownAudit();
    const other = makeOrigin("other");
    writeSkill(other, "code-audit", "other audit");
    writeCatalog(other, [{ name: "code-audit" }]);
    release(other, "v1.0.0");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }, { catalog: `file://${other}`, skills: ["code-audit"] }]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.doesNotMatch(result.output, /--replace/);
  });

  test("--replace only goes with the commands that install", () => {
    const result = cli(["check", "--replace", "code-audit"]);

    assert.equal(result.status, 2);
    assert.match(result.output, /--replace goes with install, update, init or add/);
  });

  test("add --select with --replace adds the source and replaces; without it the manifest stays as it was", () => {
    ownAudit();
    setSources([{ catalog: `file://${origin}`, skills: ["planning"] }]);
    const before = readFileSync(join(repo, ".agents/skills.json"), "utf8");
    rmSync(join(repo, ".agents/skills/planning"), { recursive: true, force: true });

    const refused = cli(["add", "--catalog", `file://${origin}`, "--select", `catalog:file://${origin}/code-audit`]);
    const kept = readFileSync(join(repo, ".agents/skills.json"), "utf8");
    const added = cli(["add", "--catalog", `file://${origin}`, "--select", `catalog:file://${origin}/code-audit`, "--replace", "code-audit"]);

    assert.equal(refused.status, 1);
    assert.equal(kept, before);
    assert.equal(added.status, 0, added.output);
    assert.match(installed("code-audit"), /audit v1/);
    assert.deepEqual(JSON.parse(readFileSync(join(repo, ".agents/skills.json"), "utf8")).sources[0].skills.sort(), ["code-audit", "planning"]);
  });

  test("--replace without names is a usage error", () => {
    const result = cli(["install", "--replace"]);

    assert.equal(result.status, 2);
    assert.match(result.output, /--replace needs the names/);
  });
});

describe("asking before replacing, as in a terminal", () => {
  /**
   * Gives the repo its own `code-audit` with a `project.md`, and a catalog source with
   * `code-audit` declaring it editable.
   */
  function ownAudit() {
    write(join(origin, "skills/code-audit/project.md.template"), "Template.\n");
    writeCatalog(origin, [{ name: "code-audit", editable: ["project.md"] }]);
    release(origin, "v1.0.0");
    write(join(repo, ".agents/skills/code-audit/SKILL.md"), "the repo's own audit\n");
    write(join(repo, ".agents/skills/code-audit/project.md"), "Kaname rules.\n");
    setSources([{ catalog: `file://${origin}`, skills: ["code-audit"] }]);
  }

  /**
   * A question that answers with the given names and records what it was asked.
   *
   * @param answer - The names it allows, given what was asked.
   * @returns The asker and the list of what it was asked.
   */
  function asker(answer) {
    const asked = [];
    return { asked, ask: { interactive: true, askReplace: async (skills) => { asked.push(skills); return answer(skills); } } };
  }

  test("a yes replaces the skill after asking once, saying the project.md is kept", async () => {
    ownAudit();
    const { asked, ask } = asker((skills) => skills.map((skill) => skill.name));

    await installAsking(repo, { home, log: () => {} }, ask);

    assert.deepEqual(asked, [[{ name: "code-audit", keeps: ["project.md"] }]]);
    assert.match(installed("code-audit"), /audit v1/);
    assert.equal(readFileSync(join(repo, ".agents/skills/code-audit/project.md"), "utf8"), "Kaname rules.\n");
  });

  test("a no stops without changes and without the hint to run it in a terminal", async () => {
    ownAudit();
    const { asked, ask } = asker(() => []);

    await assert.rejects(installAsking(repo, { home, log: () => {} }, ask), (error) => /Nothing changed/.test(error.message) && !/in a terminal/.test(error.message));

    assert.equal(asked.length, 1);
    assert.equal(installed("code-audit"), "the repo's own audit\n");
  });

  test("without a terminal it does not ask", async () => {
    ownAudit();
    const { asked, ask } = asker((skills) => skills.map((skill) => skill.name));

    await assert.rejects(installAsking(repo, { home, log: () => {} }, { ...ask, interactive: false }), OwnSkillsError);

    assert.equal(asked.length, 0);
  });
});
