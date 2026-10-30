/**
 * @file Tests for `repo` sources against temporary repos: a local git origin
 * reached through `file://`, and the `install`, `update`, `check` and `add`
 * commands. No network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

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
 * Creates an empty origin repo.
 *
 * @param name - Folder name under the test folder.
 * @returns Its path.
 */
function makeOrigin(name = "origin") {
  const root = join(base, name);
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  return root;
}

/**
 * Commits everything in an origin.
 *
 * @param root - Origin repo.
 * @param msg - Commit message.
 * @returns The sha of the new commit.
 */
function commit(root, msg) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--allow-empty", "-m", msg]);
  return git(root, ["rev-parse", "HEAD"]);
}

/**
 * Runs the CLI in the temporary repo, with the fake home.
 *
 * @param args - CLI arguments.
 * @returns Exit code and the two output streams.
 */
function cli(args) {
  const env = { ...process.env, SKILLS_HOME: home };
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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
 * Replaces the manifest sources of the temporary repo.
 *
 * @param sources - New sources.
 */
function setSources(sources) {
  write(join(repo, ".agents/skills.json"), JSON.stringify({ sources }));
}

/**
 * Writes the Claude Code marketplace of an origin repo, the file `readRepoSkills` reads.
 *
 * @param root - Origin repo.
 * @param plugins - Plugin entries of its `marketplace.json`.
 */
function writeMarketplace(root, plugins) {
  write(join(root, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "local", plugins }));
}

/**
 * Reads a file installed in the temporary repo.
 *
 * @param rel - Path under `.agents/skills/`.
 * @returns Its text.
 */
function installed(rel) {
  return readFileSync(join(repo, ".agents/skills", rel), "utf8");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "repo-test-"));
  repo = join(base, "repo");
  home = join(base, "home");
  mkdirSync(repo);
  mkdirSync(home);
  git(repo, ["init", "-q"]);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("repo ref", () => {
  test("a ref pinned to an annotated tag locks the commit, not the tag object", () => {
    const origin = makeOrigin();
    write(join(origin, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: Does alpha.\n---\nv1\n");
    commit(origin, "v1");
    git(origin, ["tag", "-a", "v1.0.0", "-m", "v1.0.0"]);
    write(join(origin, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: Does alpha.\n---\nv2\n");
    commit(origin, "v2");
    setSources([{ repo: `file://${origin}`, path: "skills/alpha", ref: "v1.0.0" }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(lock().skills.alpha.commit, git(origin, ["rev-parse", "v1.0.0^{commit}"]));
  });

  test("a ref that only matches the end of another branch name stops instead of following it", () => {
    const origin = makeOrigin();
    write(join(origin, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: Does alpha.\n---\nv1\n");
    commit(origin, "v1");
    git(origin, ["checkout", "-q", "-b", "feature/main"]);
    git(origin, ["branch", "-q", "-D", "main"]);
    setSources([{ repo: `file://${origin}`, path: "skills/alpha", ref: "main" }]);

    const result = cli(["install"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /has no main/);
  });
});

describe("repo sources inside a marketplace plugin", () => {
  /** Origin with a `demo` plugin whose `alpha` skill points at its sibling `beta`. */
  let origin;

  /** Manifest entry of each skill of the plugin. */
  let alpha;
  let beta;

  beforeEach(() => {
    origin = makeOrigin();
    writeMarketplace(origin, [{ name: "demo", source: "./plugins/demo" }]);
    write(join(origin, "plugins/demo/skills/alpha/SKILL.md"), "Use demo:beta and other:beta.\n");
    write(join(origin, "plugins/demo/skills/beta/SKILL.md"), "Beta.\n");
    commit(origin, "v1");
    alpha = { repo: `file://${origin}`, path: "plugins/demo/skills/alpha" };
    beta = { repo: `file://${origin}`, path: "plugins/demo/skills/beta" };
  });

  test("references to a sibling in the manifest are rewritten; others are left", () => {
    setSources([alpha, beta]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(installed("alpha/SKILL.md"), "Use beta and other:beta.\n");
  });

  test("without the sibling the reference stays prefixed", () => {
    setSources([alpha]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(installed("alpha/SKILL.md"), "Use demo:beta and other:beta.\n");
  });

  test("adding the sibling later rewrites the installed one at its lock commit", () => {
    setSources([alpha]);
    assert.equal(cli(["install"]).status, 0);
    const pinned = lock().skills.alpha.commit;
    write(join(origin, "plugins/demo/skills/alpha/SKILL.md"), "Use demo:beta, v2.\n");
    commit(origin, "v2");
    setSources([alpha, beta]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(installed("alpha/SKILL.md"), "Use beta and other:beta.\n");
    assert.equal(lock().skills.alpha.commit, pinned);
  });

  test("removing the sibling restores the prefix", () => {
    setSources([alpha]);
    assert.equal(cli(["install"]).status, 0);
    setSources([alpha, beta]);
    assert.equal(cli(["install"]).status, 0);
    setSources([alpha]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(installed("alpha/SKILL.md"), "Use demo:beta and other:beta.\n");
    assert.equal(lock().skills.beta, undefined);
    assert.equal(cli(["check"]).status, 0);
  });

  test("update <name> moves only that skill", () => {
    setSources([alpha, beta]);
    assert.equal(cli(["install"]).status, 0);
    const before = lock().skills;
    const v2 = commit(origin, "v2");

    const result = cli(["update", "alpha"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(lock().skills.alpha.commit, v2);
    assert.equal(lock().skills.beta.commit, before.beta.commit);
    assert.equal(installed("alpha/SKILL.md"), "Use beta and other:beta.\n");
  });

  test("a repo without a marketplace is installed as before", () => {
    const plain = makeOrigin("plain");
    write(join(plain, "skills/x/SKILL.md"), "Use demo:y.\n");
    write(join(plain, "skills/y/SKILL.md"), "Y.\n");
    commit(plain, "v1");
    setSources([{ repo: `file://${plain}`, path: "skills/x" }, { repo: `file://${plain}`, path: "skills/y" }]);

    const result = cli(["install"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(installed("x/SKILL.md"), "Use demo:y.\n");
  });
});
