/**
 * @file What touches git and the disk of a downloaded origin, for the skills CLI:
 * validation of data-sourced values (repos, shas, paths, names), downloading a
 * commit without history, the latest published commit and a recursive read of
 * a folder without symlinks. Nothing coming from the manifest, the lock or a
 * marketplace reaches git or the disk without going through here.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** A full git sha. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** Accepted repo schemes: nothing git could interpret as a command or option. */
const ALLOWED_REPO = /^(https|file):\/\//;

/** Execute bits (user, group and others) of a file mode. */
const EXECUTABLE_BITS = 0o111;

/** Valid skill name: a single folder, without `..` or separators. */
const SKILL_NAME = /^[A-Za-z0-9][\w.-]*$/;

/**
 * Runs git and returns its output.
 *
 * @param args - Git arguments; data-sourced values go after `--`.
 * @param cwd - Folder where it runs.
 * @returns The standard output, trimmed.
 * @throws {Error} If git exits badly.
 */
export function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Requires a repo URL that is `https://` or `file://`.
 *
 * @param repo - URL to validate.
 * @returns The same URL.
 * @throws {Error} If it has another scheme or is not text.
 */
export function assertRepo(repo) {
  if (typeof repo !== "string" || !ALLOWED_REPO.test(repo)) {
    throw new Error(`Repo not allowed (only https:// or file://): ${repo}`);
  }
  return repo;
}

/**
 * Requires a full sha of 40 hexadecimal characters.
 *
 * @param sha - Value to validate.
 * @returns The same sha.
 * @throws {Error} If it is not a full sha.
 */
export function assertSha(sha) {
  if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
    throw new Error(`Not a full sha: ${sha}`);
  }
  return sha;
}

/**
 * Requires a relative path that does not climb out of the folder.
 *
 * @param rel - Path to validate.
 * @returns The path normalized in POSIX format.
 * @throws {Error} If it is absolute or has `..`.
 */
export function assertRelPath(rel) {
  if (typeof rel !== "string" || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
    throw new Error(`The path must be relative and without "..": ${rel}`);
  }
  return path.posix.normalize(rel);
}

/**
 * Requires a skill name that is a single folder.
 *
 * @param name - Name to validate.
 * @returns The same name.
 * @throws {Error} If it has separators, `..` or odd characters.
 */
export function assertSkillName(name) {
  if (typeof name !== "string" || !SKILL_NAME.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
  return name;
}

/**
 * Resolves a path of the downloaded origin and checks it does not escape through a symlink.
 *
 * @param tree - Origin checkout.
 * @param rel - Relative path, already validated.
 * @returns The real path.
 * @throws {Error} If the real path ends up outside the checkout.
 */
export function insideTree(tree, rel) {
  const base = realpathSync(tree);
  const full = realpathSync(path.join(tree, rel));
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) {
    throw new Error(`"${rel}" escapes the origin repo (symlink pointing outside).`);
  }
  return full;
}

/**
 * Downloads a single commit of a repo into a folder, without history.
 *
 * @param src - `{ repo, commit?, sha?, ref? }`; without commit or ref, it fetches HEAD.
 * @param dest - Destination folder; created if missing.
 * @returns The commit left in the folder.
 * @throws {Error} If the repo or sha are not valid, or git cannot fetch it.
 */
export function fetchSource(src, dest) {
  const repo = assertRepo(src.repo);
  const pinned = src.commit ?? src.sha;
  const target = pinned === undefined ? (src.ref ?? "HEAD") : assertSha(pinned);
  mkdirSync(dest, { recursive: true });
  git(["init", "-q"], dest);
  try {
    git(["fetch", "-q", "--depth", "1", "--", repo, target], dest);
    git(["checkout", "-q", "FETCH_HEAD", "--"], dest);
  } catch (error) {
    if (pinned === undefined) {
      throw error;
    }
    // WHY: a server without allowAnySHA1InWant refuses to serve a bare sha.
    git(["fetch", "-q", "--", repo, "+refs/heads/*:refs/remotes/origin/*"], dest);
    git(["checkout", "-q", target, "--"], dest);
  }
  return { commit: git(["rev-parse", "HEAD"], dest) };
}

/**
 * Latest published commit of a source: the marketplace `sha` or the HEAD of its branch.
 *
 * @param resolved - `{ repo, ref?, sha? }` of the source.
 * @returns The full sha.
 * @throws {Error} If the sha is not valid or the origin lacks that branch.
 */
export function latestCommit(resolved) {
  if (resolved.sha !== undefined) {
    return assertSha(resolved.sha);
  }
  const ref = resolved.ref ?? "HEAD";
  const [line] = git(["ls-remote", "--", assertRepo(resolved.repo), ref]).split("\n");
  if (!line) {
    throw new Error(`${resolved.repo} has no ${ref}.`);
  }
  return assertSha(line.split("\t")[0]);
}

/**
 * Lists the files of a folder, recursively, with a POSIX relative path.
 *
 * @param dir - Folder to walk.
 * @param prefix - Accumulated relative prefix.
 * @returns Files with their relative path, content and `executable` if any execute bit is set.
 * @throws {Error} If it finds a symlink: a skill cannot contain them.
 */
export function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
    const full = path.join(dir, dirent.name);
    if (dirent.isSymbolicLink()) {
      throw new Error(`"${rel}" is a symlink: skills cannot contain symlinks.`);
    }
    if (dirent.isDirectory()) {
      return walk(full, rel);
    }
    if (!dirent.isFile()) {
      return [];
    }
    const executable = (lstatSync(full).mode & EXECUTABLE_BITS) !== 0;
    return [{ path: rel, content: readFileSync(full), executable }];
  });
}
