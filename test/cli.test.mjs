/**
 * @file Tests for the `src/cli.mjs` CLI against a temporary repo: a local
 * git origin with two skills, a `SKILLS_HOME` with a fake marketplace that
 * points to it through `file://`, and the `install`, `update`, `check`,
 * `list`, `init` and `add` commands. No network: every origin is a local repo,
 * and `~/.claude` is always the fake home one.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

/** Temporary folder of each test, holding the repo, the origin and the home. */
let base;

/** Repo where the CLI runs. */
let repo;

/** Origin repo of the skills. */
let origin;

/** Fake home with the marketplace. */
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
 * Commits everything in the origin.
 *
 * @param message - Commit message.
 * @returns The sha of the new commit.
 */
function commitOrigin(message) {
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "-m", message]);
  return git(origin, ["rev-parse", "HEAD"]);
}

/**
 * Writes the fake `fake` marketplace with the `demo` plugin pinned to a sha.
 *
 * @param sha - Origin commit the marketplace publishes.
 */
function publish(sha) {
  const marketplace = { plugins: [{ name: "demo", source: { source: "url", url: `file://${origin}`, sha } }] };
  write(join(home, ".claude/plugins/marketplaces/fake/.claude-plugin/marketplace.json"), JSON.stringify(marketplace));
}

/**
 * Runs the CLI in the temporary repo, with the fake home.
 *
 * @param args - CLI arguments.
 * @returns Exit code and combined output.
 */
function cli(args) {
  const env = { ...process.env, SKILLS_HOME: home };
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: "utf8", env });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Reads a file from the temporary repo.
 *
 * @param file - Path relative to the repo.
 * @returns The content.
 */
function read(file) {
  return readFileSync(join(repo, file), "utf8");
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
 * Leaves in the fake home what `init` and `add` discover: `demo@fake` installed
 * in the plugin cache, the local skill `my-skill` and a `synced/` folder.
 */
function installMachine() {
  const installPath = join(home, ".claude/plugins/cache/fake/demo/1.0.0");
  write(join(installPath, "skills/alpha/SKILL.md"), "Alpha.\n");
  write(join(installPath, "skills/beta/SKILL.md"), "Beta.\n");
  const installed = { version: 2, plugins: { "demo@fake": [{ scope: "user", installPath, version: "1.0.0" }] } };
  write(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify(installed));
  write(join(home, ".claude/skills/my-skill/SKILL.md"), "Mine.\n");
  write(join(home, ".claude/skills/my-skill/refs/notes.md"), "Notes.\n");
  write(join(home, ".claude/skills/synced/another/SKILL.md"), "Synced.\n");
}

/**
 * Reads the manifest of the temporary repo.
 *
 * @returns The parsed manifest.
 */
function manifest() {
  return JSON.parse(read(".agents/skills.json"));
}

/**
 * Writes the temporary repo's `.claude/settings.json` with a stable format.
 *
 * @param settings - Content to write.
 */
function writeSettings(settings) {
  write(join(repo, ".claude/settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Reads the temporary repo's `.claude/settings.json`.
 *
 * @returns The parsed content.
 */
function settings() {
  return JSON.parse(read(".claude/settings.json"));
}

/**
 * Tells whether a file in the temporary repo has any executable bit.
 *
 * @param file - Path relative to the repo.
 * @returns `true` if it is executable.
 */
function isExecutable(file) {
  return (statSync(join(repo, file)).mode & 0o111) !== 0;
}

/** Message for a hand-edited skill: both ways out, the lock version or the latest published. */
const EDITED_ALPHA =
  /"alpha" was edited by hand: to go back to the lock version, rm -rf \.agents\/skills\/alpha && skills-manager install; to overwrite it with the latest published, skills-manager update alpha/;

/** Initial commit of the origin. */
let firstSha;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "skills-cli-"));
  repo = join(base, "repo");
  origin = join(base, "origin");
  home = join(base, "home");
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [{ plugin: "demo@fake" }] }));
  mkdirSync(origin);
  git(origin, ["init", "-q"]);
  write(join(origin, "skills/alpha/SKILL.md"), "Alpha. Then use demo:beta and other:beta.\n");
  write(join(origin, "skills/beta/SKILL.md"), "Beta.\n");
  write(join(origin, "LICENSE"), "MIT\n");
  write(join(origin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
  firstSha = commitOrigin("first");
  write(
    join(home, ".claude/plugins/known_marketplaces.json"),
    JSON.stringify({ fake: { source: { source: "git", url: `file://${origin}` } } }),
  );
  publish(firstSha);
  writeSettings({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "x", timeout: 600 }] }] } });
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("install", () => {
  test("without a lock it downloads the plugin skills, rewrites references and writes the lock", () => {
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Then use beta and other:beta.\n");
    assert.equal(read(".agents/skills/beta/SKILL.md"), "Beta.\n");
    assert.equal(read(".agents/skills/beta/LICENSE"), "MIT\n");
    const lock = JSON.parse(read(LOCK));
    assert.deepEqual(lock.plugins, ["demo@fake"]);
    assert.equal(lock.skills.alpha.commit, firstSha);
    assert.equal(lock.skills.alpha.source, "demo@fake");
    assert.equal(lock.skills.alpha.path, "skills/alpha");
    assert.equal(lock.skills.alpha.version, "1.0.0");
    assert.match(lock.skills.beta.hash, /^sha256-[0-9a-f]{64}$/);
  });

  test("with paths in the manifest it installs where they say and check passes", () => {
    const { sources } = manifest();
    write(join(repo, ".agents/skills.json"), JSON.stringify({ sources, paths: { skillsDir: "vendor/skills", lock: "vendor/lock.json" } }));
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read("vendor/skills/beta/SKILL.md"), "Beta.\n");
    assert.equal(existsSync(join(repo, ".agents/skills")), false);
    assert.equal(existsSync(join(repo, LOCK)), false);
    assert.equal(JSON.parse(read("vendor/lock.json")).skills.alpha.commit, firstSha);
    assert.equal(cli(["check"]).status, 0);
  });

  test("a second install changes nothing", () => {
    assert.equal(cli(["install"]).status, 0);
    const before = statSync(join(repo, LOCK)).mtimeMs;
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(statSync(join(repo, LOCK)).mtimeMs, before);
  });

  test("installs the lock commit even if the marketplace publishes another", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(origin, "skills/beta/SKILL.md"), "Beta 2.\n");
    publish(commitOrigin("second"));
    rmSync(join(repo, ".agents/skills/beta"), { recursive: true });
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/beta/SKILL.md"), "Beta.\n");
  });

  test("a hand-edited skill makes check and install fail", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "edited\n");
    const check = cli(["check"]);
    assert.equal(check.status, 1);
    assert.match(check.output, /alpha/);
    const install = cli(["install"]);
    assert.equal(install.status, 1);
    assert.match(install.output, EDITED_ALPHA);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "edited\n");
  });

  test("deleting the edited skill and running install rebuilds it at the lock commit, not the latest", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "edited\n");
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    publish(commitOrigin("second"));
    rmSync(join(repo, ".agents/skills/alpha"), { recursive: true });
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Then use beta and other:beta.\n");
    assert.equal(cli(["check"]).status, 0);
  });

  test("keeps the executable bit and check detects if it is lost", () => {
    write(join(origin, "skills/beta/run.sh"), "#!/bin/sh\necho hello\n");
    chmodSync(join(origin, "skills/beta/run.sh"), 0o755);
    publish(commitOrigin("script"));
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(isExecutable(".agents/skills/beta/run.sh"), true);
    assert.equal(isExecutable(".agents/skills/beta/SKILL.md"), false);
    assert.equal(cli(["check"]).status, 0);
    chmodSync(join(repo, ".agents/skills/beta/run.sh"), 0o644);
    const check = cli(["check"]);
    assert.equal(check.status, 1);
    assert.match(check.output, /edited by hand: beta/);
  });

  test("a third-party skill named like an own one stops with exclude", () => {
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "own\n");
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /exclude "alpha"/);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "own\n");
    assert.equal(existsSync(join(repo, LOCK)), false);
  });

  test("honors the manifest skills list", () => {
    write(join(repo, ".agents/skills.json"), JSON.stringify({ sources: [{ plugin: "demo@fake", skills: ["beta"] }] }));
    assert.equal(cli(["install"]).status, 0);
    assert.equal(existsSync(join(repo, ".agents/skills/alpha")), false);
    assert.deepEqual(Object.keys(JSON.parse(read(LOCK)).skills), ["beta"]);
  });
});

describe("plugins disabled in the project", () => {
  test("install disables the plugin and keeps the rest of settings.json", () => {
    assert.equal(cli(["install"]).status, 0);
    const current = settings();
    assert.equal(current.enabledPlugins["demo@fake"], false);
    assert.equal(current.hooks.SessionStart[0].hooks[0].timeout, 600);
    assert.match(read(".claude/settings.json"), /\n$/);
  });

  test("removing the source from the manifest drops the key and the empty object", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    assert.equal(cli(["install"]).status, 0);
    assert.equal("enabledPlugins" in settings(), false);
    assert.ok(settings().hooks);
  });

  test("does not touch what the tool did not put there", () => {
    writeSettings({ enabledPlugins: { "hand@x": true, "other@y": false } });
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    assert.equal(cli(["install"]).status, 0);
    assert.deepEqual(settings(), { enabledPlugins: { "hand@x": true, "other@y": false } });
  });

  test("without settings.json it creates it; without plugins it does not", () => {
    rmSync(join(repo, ".claude"), { recursive: true });
    assert.equal(cli(["install"]).status, 0);
    assert.deepEqual(settings(), { enabledPlugins: { "demo@fake": false } });
    rmSync(join(repo, ".claude"), { recursive: true });
    setSources([]);
    assert.equal(cli(["install"]).status, 0);
    assert.equal(existsSync(join(repo, ".claude/settings.json")), false);
  });

  test("init and add also leave it written", () => {
    installMachine();
    setSources([]);
    assert.equal(cli(["add", "--select", "demo@fake"]).status, 0);
    assert.equal(settings().enabledPlugins["demo@fake"], false);
  });

  test("--dry-run does not write settings.json", () => {
    assert.equal(cli(["update", "--dry-run"]).status, 0);
    assert.equal("enabledPlugins" in settings(), false);
  });
});

describe("check", () => {
  test("without a manifest it exits with 0", () => {
    rmSync(join(repo, ".agents/skills.json"));
    assert.equal(cli(["check"]).status, 0);
  });

  test("after install it exits with 0; if a skill is missing, with 1", () => {
    assert.equal(cli(["install"]).status, 0);
    assert.equal(cli(["check"]).status, 0);
    rmSync(join(repo, ".agents/skills/beta"), { recursive: true });
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /beta/);
  });
});

describe("update", () => {
  test("--dry-run prints the commit change without touching files; update applies it", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    const newSha = commitOrigin("second");
    publish(newSha);
    const lockBefore = read(LOCK);

    const dry = cli(["update", "--dry-run"]);
    assert.equal(dry.status, 0, dry.output);
    assert.match(dry.output, new RegExp(`alpha: ${firstSha.slice(0, 7)} → ${newSha.slice(0, 7)}`));
    assert.equal(read(LOCK), lockBefore);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Then use beta and other:beta.\n");

    const real = cli(["update"]);
    assert.equal(real.status, 0, real.output);
    assert.match(real.output, new RegExp(`alpha: ${firstSha.slice(0, 7)} → ${newSha.slice(0, 7)}`));
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha 2.\n");
    assert.equal(JSON.parse(read(LOCK)).skills.alpha.commit, newSha);
    assert.equal(cli(["check"]).status, 0);
  });

  test("update <name> overwrites a hand-edited skill", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "edited\n");
    const result = cli(["update", "alpha"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Then use beta and other:beta.\n");
  });
});

describe("list", () => {
  test("shows each skill with its origin and reports if there is a newer version", () => {
    assert.equal(cli(["install"]).status, 0);
    const same = cli(["list"]);
    assert.equal(same.status, 0, same.output);
    assert.match(same.output, new RegExp(`alpha\\s+demo@fake\\s+1\\.0\\.0 \\(${firstSha.slice(0, 7)}\\)`));
    assert.doesNotMatch(same.output, /newer version available/);
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    publish(commitOrigin("second"));
    assert.match(cli(["list"]).output, /alpha.*\(newer version available\)/);
  });
});

describe("versioned lock", () => {
  test("install writes lockVersion 1 as the first key", () => {
    assert.equal(cli(["install"]).status, 0);
    assert.equal(Object.keys(JSON.parse(read(LOCK)))[0], "lockVersion");
    assert.equal(JSON.parse(read(LOCK)).lockVersion, 1);
  });

  test("a lock without lockVersion is read as version 1 and check passes", () => {
    assert.equal(cli(["install"]).status, 0);
    const { lockVersion: _version, ...legacy } = JSON.parse(read(LOCK));
    write(join(repo, LOCK), JSON.stringify(legacy, null, 2));
    const result = cli(["check"]);
    assert.equal(result.status, 0, result.output);
  });

  test("a lock with a newer lockVersion makes check exit 1 asking to upgrade", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, LOCK), JSON.stringify({ ...JSON.parse(read(LOCK)), lockVersion: 2 }));
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /The lock was written by a newer skills-manager \(lockVersion 2\); upgrade @ramon-sg\/skills-manager\./);
  });
});

describe("reconciling the lock with the manifest", () => {
  test("removing a source deletes its skills from disk and the lock", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    const result = cli(["install"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(existsSync(join(repo, ".agents/skills/alpha")), false);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), false);
    assert.deepEqual(JSON.parse(read(LOCK)), { lockVersion: 1, skills: {}, plugins: [] });
    assert.equal(cli(["check"]).status, 0);
  });

  test("removing a source with a hand-edited skill stops without deleting", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "edited\n");
    setSources([]);
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, EDITED_ALPHA);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "edited\n");
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), true);
  });

  test("changing the skills list rebuilds the source at the lock commit", () => {
    setSources([{ plugin: "demo@fake", skills: ["beta"] }]);
    assert.equal(cli(["install"]).status, 0);
    write(join(origin, "skills/alpha/SKILL.md"), "Alpha 2.\n");
    publish(commitOrigin("second"));

    setSources([{ plugin: "demo@fake", skills: ["alpha", "beta"] }]);
    const added = cli(["install"]);
    assert.equal(added.status, 0, added.output);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Then use beta and other:beta.\n");
    assert.equal(JSON.parse(read(LOCK)).skills.alpha.commit, firstSha);

    setSources([{ plugin: "demo@fake", skills: ["alpha"] }]);
    const dropped = cli(["install"]);
    assert.equal(dropped.status, 0, dropped.output);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), false);
    assert.deepEqual(Object.keys(JSON.parse(read(LOCK)).skills), ["alpha"]);
    assert.equal(cli(["check"]).status, 0);
  });

  test("check fails if a manifest source is not in the lock", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([{ plugin: "demo@fake" }, { repo: `file://${origin}`, path: "skills/beta" }]);
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, new RegExp(`file://${origin}/skills/beta`));
  });

  test("check fails if the lock has skills from a source that is gone", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([]);
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /alpha/);
  });

  test("check fails if the lock plugins do not match the manifest", () => {
    assert.equal(cli(["install"]).status, 0);
    const lock = JSON.parse(read(LOCK));
    write(join(repo, LOCK), JSON.stringify({ ...lock, plugins: [] }));
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /plugins/);
  });

  test("check fails if the manifest skills list does not match the lock", () => {
    assert.equal(cli(["install"]).status, 0);
    setSources([{ plugin: "demo@fake", skills: ["alpha"] }]);
    const result = cli(["check"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /demo@fake/);
  });
});

describe("update --dry-run", () => {
  test("reports the skills that appear and disappear in the origin", () => {
    assert.equal(cli(["install"]).status, 0);
    rmSync(join(origin, "skills/beta"), { recursive: true });
    write(join(origin, "skills/gamma/SKILL.md"), "Gamma.\n");
    publish(commitOrigin("second"));
    const lockBefore = read(LOCK);
    const result = cli(["update", "--dry-run"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /gamma: new/);
    assert.match(result.output, /beta: will be removed/);
    assert.equal(read(LOCK), lockBefore);
    assert.equal(existsSync(join(repo, ".agents/skills/gamma")), false);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), true);
  });

  test("reports each hand-edited skill that update will overwrite", () => {
    assert.equal(cli(["install"]).status, 0);
    write(join(repo, ".agents/skills/alpha/SKILL.md"), "edited\n");
    const result = cli(["update", "--dry-run"]);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /alpha: edited by hand, will be overwritten/);
    assert.doesNotMatch(result.output, /beta: edited by hand/);
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "edited\n");
  });
});

describe("security", () => {
  test("rejects repos that are neither https:// nor file://", () => {
    setSources([{ repo: "ext::sh -c id", path: "skills/beta" }]);
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /https:\/\/ or file:\/\//);
  });

  test("rejects a marketplace sha that is not a full sha", () => {
    publish("--upload-pack=id");
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /sha/);
  });

  test("rejects paths with .. or absolute ones", () => {
    setSources([{ repo: `file://${origin}`, path: "../outside" }]);
    const parent = cli(["install"]);
    assert.equal(parent.status, 1);
    assert.match(parent.output, /path/);
    setSources([{ repo: `file://${origin}`, path: "/etc" }]);
    assert.match(cli(["install"]).output, /path/);
  });

  test("a skill with a symlink makes install fail and copies nothing", () => {
    write(join(base, "secret.txt"), "secret\n");
    symlinkSync(join(base, "secret.txt"), join(origin, "skills/beta/secret.txt"));
    publish(commitOrigin("symlink"));
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /symlink/);
    assert.equal(existsSync(join(repo, ".agents/skills/beta")), false);
    assert.equal(existsSync(join(repo, LOCK)), false);
  });

  test("a skill folder that is a symlink outside the origin makes install fail", () => {
    mkdirSync(join(base, "outside"));
    write(join(base, "outside/SKILL.md"), "outside\n");
    symlinkSync(join(base, "outside"), join(origin, "skills/gamma"));
    publish(commitOrigin("folder symlink"));
    const result = cli(["install"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /symlink|escapes/);
    assert.equal(existsSync(join(repo, ".agents/skills/gamma")), false);
  });
});

describe("init and add", () => {
  test("init --select installs the plugin; a second init suggests skills-manager add", () => {
    installMachine();
    rmSync(join(repo, ".agents/skills.json"));
    const result = cli(["init", "--select", "demo@fake"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(manifest(), { sources: [{ plugin: "demo@fake" }] });
    assert.equal(read(".agents/skills/alpha/SKILL.md"), "Alpha. Then use beta and other:beta.\n");
    assert.equal(JSON.parse(read(LOCK)).skills.beta.commit, firstSha);
    const again = cli(["init", "--select", "demo@fake"]);
    assert.equal(again.status, 1);
    assert.match(again.output, /already exists; use skills-manager add/);
  });

  test("init copies the bundled manage-skills skill and never overwrites an existing one", () => {
    installMachine();
    rmSync(join(repo, ".agents/skills.json"));
    const bundled = readFileSync(join(dirname(CLI), "..", "skills", "manage-skills", "SKILL.md"), "utf8");
    assert.equal(cli(["init", "--select", "demo@fake"]).status, 0);
    assert.equal(read(".agents/skills/manage-skills/SKILL.md"), bundled);
    rmSync(join(repo, ".agents/skills.json"));
    writeFileSync(join(repo, ".agents/skills/manage-skills/SKILL.md"), "Mine.\n");
    assert.equal(cli(["init", "--select", "demo@fake"]).status, 0);
    assert.equal(read(".agents/skills/manage-skills/SKILL.md"), "Mine.\n");
    assert.equal(cli(["check"]).status, 0);
  });

  test("add --candidates does not list what is already in the manifest nor synced/", () => {
    installMachine();
    rmSync(join(repo, ".agents/skills.json"));
    assert.equal(cli(["init", "--select", "demo@fake"]).status, 0);
    const result = cli(["add", "--candidates"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(JSON.parse(result.output), [{ id: "my-skill", kind: "local", skills: ["my-skill"] }]);
  });

  test("add --select of a local copies it and pins it in the lock without repo or commit", () => {
    installMachine();
    const result = cli(["add", "--select", "my-skill"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(manifest().sources, [{ plugin: "demo@fake" }, { local: "my-skill" }]);
    assert.equal(read(".agents/skills/my-skill/SKILL.md"), "Mine.\n");
    assert.equal(read(".agents/skills/my-skill/refs/notes.md"), "Notes.\n");
    const entry = JSON.parse(read(LOCK)).skills["my-skill"];
    assert.equal(entry.source, "local");
    assert.equal(entry.repo, undefined);
    assert.equal(entry.commit, undefined);
    assert.match(entry.hash, /^sha256-[0-9a-f]{64}$/);
    assert.equal(cli(["check"]).status, 0);
  });

  test("a copied local is the repo's own: editing it does not make check or install fail, and install does not overwrite it", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "my-skill"]).status, 0);
    write(join(repo, ".agents/skills/my-skill/SKILL.md"), "edited\n");
    const check = cli(["check"]);
    assert.equal(check.status, 0, check.output);
    const install = cli(["install"]);
    assert.equal(install.status, 0, install.output);
    assert.equal(read(".agents/skills/my-skill/SKILL.md"), "edited\n");
    const update = cli(["update"]);
    assert.equal(update.status, 0, update.output);
    assert.equal(read(".agents/skills/my-skill/SKILL.md"), "edited\n");
  });

  test("a local missing on disk is copied again; update <local> copies it again", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "my-skill"]).status, 0);
    rmSync(join(repo, ".agents/skills/my-skill"), { recursive: true });
    assert.equal(cli(["check"]).status, 1);
    assert.equal(cli(["install"]).status, 0);
    assert.equal(read(".agents/skills/my-skill/SKILL.md"), "Mine.\n");
    write(join(repo, ".agents/skills/my-skill/SKILL.md"), "edited\n");
    write(join(home, ".claude/skills/my-skill/SKILL.md"), "Mine 2.\n");
    const dry = cli(["update", "my-skill", "--dry-run"]);
    assert.equal(dry.status, 0, dry.output);
    assert.match(dry.output, /my-skill: edited by hand, will be overwritten/);
    const result = cli(["update", "my-skill"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/my-skill/SKILL.md"), "Mine 2.\n");
  });

  test("a local keeps the executable bit", () => {
    installMachine();
    write(join(home, ".claude/skills/my-skill/bin/run.sh"), "#!/bin/sh\n");
    chmodSync(join(home, ".claude/skills/my-skill/bin/run.sh"), 0o755);
    assert.equal(cli(["add", "--select", "my-skill"]).status, 0);
    assert.equal(isExecutable(".agents/skills/my-skill/bin/run.sh"), true);
    assert.equal(isExecutable(".agents/skills/my-skill/SKILL.md"), false);
  });

  test("update does not touch locals even if they change in ~/.claude/skills", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "my-skill"]).status, 0);
    write(join(home, ".claude/skills/my-skill/SKILL.md"), "Mine 2.\n");
    const result = cli(["update"]);
    assert.equal(result.status, 0, result.output);
    assert.equal(read(".agents/skills/my-skill/SKILL.md"), "Mine.\n");
    assert.equal(cli(["check"]).status, 0);
  });

  test("removing a local from the manifest deletes it from disk and the lock", () => {
    installMachine();
    assert.equal(cli(["add", "--select", "my-skill"]).status, 0);
    setSources([{ plugin: "demo@fake" }]);
    assert.equal(cli(["install"]).status, 0);
    assert.equal(existsSync(join(repo, ".agents/skills/my-skill")), false);
    assert.equal(Object.hasOwn(JSON.parse(read(LOCK)).skills, "my-skill"), false);
  });

  test("if install fails, add leaves the manifest as it was", () => {
    installMachine();
    write(join(repo, ".agents/skills/my-skill/SKILL.md"), "own\n");
    const result = cli(["add", "--select", "my-skill"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /exclude "my-skill"/);
    assert.deepEqual(manifest(), { sources: [{ plugin: "demo@fake" }] });
  });

  test("add --select rejects what is not among the candidates", () => {
    installMachine();
    const result = cli(["add", "--select", "nothing@fake"]);
    assert.equal(result.status, 1);
    assert.match(result.output, /nothing@fake/);
    assert.deepEqual(manifest(), { sources: [{ plugin: "demo@fake" }] });
  });

  test("a plugin from an unreadable marketplace shows with a note and cannot be picked", () => {
    installMachine();
    const installPath = join(home, ".claude/plugins/cache/broken/other/1.0.0");
    write(join(installPath, "skills/gamma/SKILL.md"), "Gamma.\n");
    const file = join(home, ".claude/plugins/installed_plugins.json");
    const installed = JSON.parse(readFileSync(file, "utf8"));
    installed.plugins["other@broken"] = [{ scope: "user", installPath }];
    write(file, JSON.stringify(installed));
    write(join(home, ".claude/plugins/marketplaces/fake/.claude-plugin/marketplace.json"), "{ broken");
    const result = cli(["add", "--candidates"]);
    assert.equal(result.status, 0, result.output);
    const candidates = JSON.parse(result.output);
    assert.equal(candidates.find((candidate) => candidate.id === "other@broken").note, "could not read marketplace broken");
    assert.ok(candidates.some((candidate) => candidate.id === "my-skill"));
    const select = cli(["add", "--select", "other@broken"]);
    assert.equal(select.status, 1);
    assert.match(select.output, /could not read marketplace broken/);
  });

  test("without installed_plugins.json, --candidates prints [] and exits with 0", () => {
    const result = cli(["add", "--candidates"]);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(JSON.parse(result.output), []);
  });

  test("without a TTY and without --candidates or --select it exits with 2 and says how to use it", () => {
    const result = cli(["add"]);
    assert.equal(result.status, 2);
    assert.match(result.output, /--select/);
  });
});
