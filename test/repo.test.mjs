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

describe("add --repo", () => {
  /** Origin with a marketplace: a `demo` plugin with `alpha` and `beta`, and a plugin in another repo. */
  let origin;

  /** `--repo` value of the origin. */
  let url;

  /**
   * Reads the manifest sources of the temporary repo.
   *
   * @returns The `sources` list.
   */
  function sources() {
    return JSON.parse(readFileSync(join(repo, ".agents/skills.json"), "utf8")).sources;
  }

  /**
   * Runs `add --repo <url> --candidates` and parses its JSON.
   *
   * @param extra - More arguments.
   * @returns The candidates.
   */
  function candidates(extra = []) {
    const result = cli(["add", "--repo", url, "--candidates", ...extra]);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  beforeEach(() => {
    origin = makeOrigin();
    writeMarketplace(origin, [
      { name: "demo", source: "./plugins/demo" },
      { name: "elsewhere", source: { source: "github", repo: "o/r" } },
    ]);
    write(join(origin, "plugins/demo/skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: Does alpha.\n---\nUse demo:beta.\n");
    write(join(origin, "plugins/demo/skills/beta/SKILL.md"), "---\nname: beta\ndescription: Does beta.\n---\nBeta.\n");
    commit(origin, "v1");
    url = `file://${origin}`;
    setSources([]);
  });

  test("--candidates lists each marketplace plugin with its skills, without the marketplace on the machine", () => {
    const listed = candidates();

    const demo = listed.find((candidate) => candidate.id === "demo");
    assert.equal(demo.kind, "repo-plugin");
    assert.equal(demo.repo, url);
    assert.deepEqual(demo.skills, ["alpha", "beta"]);
    assert.deepEqual(demo.paths, { alpha: "plugins/demo/skills/alpha", beta: "plugins/demo/skills/beta" });
  });

  test("--select plugin:skill installs only that skill with commit and hash in the lock", () => {
    const result = cli(["add", "--repo", url, "--select", "demo:alpha"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sources(), [{ repo: url, path: "plugins/demo/skills/alpha" }]);
    const { alpha, beta } = lock().skills;
    assert.match(alpha.commit, /^[0-9a-f]{40}$/);
    assert.match(alpha.hash, /^sha256-/);
    assert.equal(beta, undefined);
  });

  test("without a marketplace --candidates lists base/* and --path changes the folder", () => {
    const plain = makeOrigin("plain");
    write(join(plain, "skills/x/SKILL.md"), "---\nname: x\ndescription: Does x.\n---\nX.\n");
    write(join(plain, "other/y/SKILL.md"), "---\nname: y\ndescription: Does y.\n---\nY.\n");
    commit(plain, "v1");
    url = `file://${plain}`;

    assert.deepEqual(candidates(), [{ id: "x", kind: "repo-skill", repo: url, skills: ["x"], path: "skills/x", description: "Does x." }]);
    assert.deepEqual(candidates(["--path", "other"]).map((candidate) => candidate.path), ["other/y"]);
    const result = cli(["add", "--repo", url, "--path", "other", "--select", "y"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sources(), [{ repo: url, path: "other/y" }]);
    assert.equal(installed("y/SKILL.md"), "---\nname: y\ndescription: Does y.\n---\nY.\n");
  });

  test("--ref pins every added entry to that ref", () => {
    git(origin, ["tag", "v1.0.0"]);
    write(join(origin, "plugins/demo/skills/gamma/SKILL.md"), "Gamma.\n");
    commit(origin, "v2");

    assert.deepEqual(candidates(["--ref", "v1.0.0"]).find((candidate) => candidate.id === "demo").skills, ["alpha", "beta"]);
    const result = cli(["add", "--repo", url, "--ref", "v1.0.0", "--select", "demo"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(sources(), [
      { repo: url, path: "plugins/demo/skills/alpha", ref: "v1.0.0" },
      { repo: url, path: "plugins/demo/skills/beta", ref: "v1.0.0" },
    ]);
    const tagged = git(origin, ["rev-parse", "v1.0.0^{commit}"]);
    assert.equal(lock().skills.alpha.commit, tagged);
    assert.equal(lock().skills.beta.commit, tagged);
  });

  test("skills already in the manifest are not candidates again", () => {
    assert.equal(cli(["add", "--repo", url, "--select", "demo:alpha"]).status, 0);

    assert.deepEqual(candidates().find((candidate) => candidate.id === "demo").skills, ["beta"]);
    assert.equal(cli(["add", "--repo", url, "--select", "demo:beta"]).status, 0);
    assert.equal(candidates().find((candidate) => candidate.id === "demo"), undefined);
  });

  test("a plugin from another repo is listed with its note and cannot be picked", () => {
    assert.deepEqual(candidates().find((candidate) => candidate.id === "elsewhere"), { id: "elsewhere", kind: "repo-plugin", repo: url, skills: [], paths: {}, note: "plugin in another repo" });

    const result = cli(["add", "--repo", url, "--select", "elsewhere"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot be picked: plugin in another repo/);
  });

  test("--ref without --repo and --repo with --catalog are usage errors", () => {
    assert.equal(cli(["add", "--ref", "v1", "--candidates"]).status, 2);
    assert.equal(cli(["add", "--path", "skills", "--candidates"]).status, 2);
    assert.equal(cli(["add", "--repo", url, "--catalog", url, "--candidates"]).status, 2);
    assert.equal(cli(["add", "--repo", url, "--repo", url, "--candidates"]).status, 2);
    assert.equal(cli(["init", "--ref", "v1", "--candidates"]).status, 2);
  });

  test("a failed install leaves the manifest as it was", () => {
    const other = makeOrigin("other");
    write(join(other, "skills/alpha/SKILL.md"), "Other alpha.\n");
    commit(other, "v1");
    setSources([{ repo: `file://${other}`, path: "skills/alpha" }]);
    assert.equal(cli(["install"]).status, 0);
    const before = readFileSync(join(repo, ".agents/skills.json"), "utf8");

    const result = cli(["add", "--repo", url, "--select", "demo:alpha"]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /alpha/);
    assert.doesNotMatch(result.stderr, /not among the candidates/);
    assert.equal(readFileSync(join(repo, ".agents/skills.json"), "utf8"), before);
  });
});
