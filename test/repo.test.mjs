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
 * Writes a fake Claude marketplace under the fake home.
 *
 * @param root - Origin repo the marketplace points at.
 * @param plugins - Plugin entries of its `marketplace.json`.
 */
function writeMarketplace(root, plugins) {
  const dir = join(home, ".claude/plugins/marketplaces/local");
  write(join(dir, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "local", plugins }));
  write(
    join(home, ".claude/plugins/known_marketplaces.json"),
    JSON.stringify({ local: { source: { source: "git", url: `file://${root}` }, installLocation: dir } }),
  );
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
