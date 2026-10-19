/**
 * @file Smoke test of the published artifact: packs the package, installs the
 * tarball into a temporary project and runs the bin through `node_modules/.bin`
 * (a symlink), which is how users and hooks reach it. Skipped without `npm`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * @returns The spawn result with text output.
 */
function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

test("the packed tarball installs and its bin runs check and session-notice", { skip: !HAS_NPM && "npm is not available" }, () => {
  const base = mkdtempSync(join(tmpdir(), "pack-"));
  try {
    const packed = run("npm", ["pack", "--pack-destination", base, "--json"], PACKAGE);
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = join(base, JSON.parse(packed.stdout)[0].filename);
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
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
