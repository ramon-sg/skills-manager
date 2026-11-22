/**
 * @file Smoke test of the published artifact: packs the package, installs the
 * tarball into a temporary project and runs the bin through `node_modules/.bin`
 * (a symlink), which is how users and hooks reach it. Skipped without `npm`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/** Package root. */
const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Whether `npm` can run here. */
const HAS_NPM = spawnSync("npm", ["--version"], { encoding: "utf8" }).status === 0;

/** Git configuration to commit without depending on the user's. */
const GIT_IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

/**
 * Runs a command and returns its result.
 *
 * @param command - Executable.
 * @param args - Arguments.
 * @param cwd - Working folder.
 * @param env - Environment (default the process's).
 * @returns The spawn result with text output.
 */
function run(command, args, cwd, env = process.env) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env });
}

test("the packed tarball is a bundle without dependencies, and its bin runs check, session-notice and init", { skip: !HAS_NPM && "npm is not available" }, () => {
  const base = mkdtempSync(join(tmpdir(), "pack-"));
  try {
    const packed = run("npm", ["pack", "--pack-destination", base, "--json"], PACKAGE);
    assert.equal(packed.status, 0, packed.stderr);
    // NOTE: the npm of Node 20 prints the prepack banner on stdout before the JSON.
    const json = packed.stdout.slice(packed.stdout.search(/^\[/m));
    const tarball = join(base, JSON.parse(json)[0].filename);
    const project = join(base, "project");
    mkdirSync(join(project, ".agents/skills/a"), { recursive: true });
    writeFileSync(join(project, "package.json"), '{"name":"p","version":"1.0.0"}');
    writeFileSync(join(project, ".agents/skills.json"), '{"sources":[{"local":"ghost"}],"sessionStart":["a"]}');
    writeFileSync(join(project, ".agents/skills/a/SKILL.md"), "A skill.\n");
    assert.equal(run("git", ["init", "-q"], project).status, 0);
    run("git", [...GIT_IDENTITY, "commit", "-q", "--allow-empty", "-m", "x"], project);
    const installed = run("npm", ["install", "--no-audit", "--no-fund", tarball], project);
    assert.equal(installed.status, 0, installed.stderr);

    const check = run("npx", ["--no-install", "skills-manager", "check"], project);
    assert.equal(check.status, 1);
    assert.match(`${check.stdout}${check.stderr}`, /\S/, "check printed nothing");

    const notice = run("npx", ["--no-install", "skills-manager", "session-notice"], project);
    assert.equal(notice.status, 0, notice.stderr);
    assert.match(notice.stdout, /A skill\./);

    const listing = run("tar", ["-tzf", tarball], base);
    assert.equal(listing.status, 0, listing.stderr);
    const listed = listing.stdout.split("\n");
    assert.ok(listed.includes("package/dist/cli.mjs"), "the tarball has no dist/cli.mjs");
    assert.ok(!listed.some((file) => file.startsWith("package/src/")), "the tarball ships src/");
    const installedPkg = join(project, "node_modules/@ramon-sg/skills-manager");
    const manifest = JSON.parse(readFileSync(join(installedPkg, "package.json"), "utf8"));
    assert.deepEqual(manifest.dependencies ?? {}, {});
    assert.deepEqual(readdirSync(join(project, "node_modules")).filter((name) => !name.startsWith(".")), ["@ramon-sg"]);
    assert.deepEqual(readdirSync(join(project, "node_modules/@ramon-sg")), ["skills-manager"]);

    // init from the bundle: version.mjs and the bundled skill resolve from dist/.
    const home = join(base, "home");
    mkdirSync(join(home, ".claude/skills/my-skill"), { recursive: true });
    writeFileSync(join(home, ".claude/skills/my-skill/SKILL.md"), "Mine.\n");
    const bin = join(base, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "bun"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "bun"), 0o755);
    const fresh = join(base, "fresh");
    mkdirSync(fresh);
    assert.equal(run("git", ["init", "-q"], fresh).status, 0);
    const env = { ...process.env, SKILLS_HOME: home, PATH: `${bin}:${process.env.PATH}` };
    const init = run(process.execPath, [join(project, "node_modules/.bin/skills-manager"), "init", "--select", "my-skill"], fresh, env);
    assert.equal(init.status, 0, `${init.stdout}${init.stderr}`);
    const runner = JSON.parse(readFileSync(join(fresh, ".agents/runner.json"), "utf8"));
    assert.deepEqual(runner.tools, { "@ramon-sg/skills-manager": manifest.version });
    assert.ok(existsSync(join(fresh, ".agents/skills/manage-skills/SKILL.md")));
    assert.equal(existsSync(join(fresh, "package.json")), false);

    // NOTE: checked from the project folder, since a version manager may pin bun only in some folders.
    if (run("bun", ["--version"], project).status === 0) {
      const withBun = run("bun", ["--bun", join(project, "node_modules/.bin/skills-manager"), "session-notice"], project);
      assert.equal(withBun.status, 0, withBun.stderr);
      assert.equal(withBun.stdout, notice.stdout);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
