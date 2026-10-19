/**
 * @file The `session-notice` command: builds the text a SessionStart hook
 * prints so the agent starts the session knowing the skills listed in the
 * manifest's `sessionStart`. The envelope is a copy of the one the Claude
 * superpowers plugin hook prints, so the result is the same without the plugin.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { readManifest, resolvePaths, SKILL_FILE } from "./state.mjs";

/**
 * Wraps the content of a skill in the session-start envelope.
 *
 * @param name - Skill name.
 * @param content - Content of its SKILL.md.
 * @returns The exact text the plugin hook prints for that skill.
 */
function envelope(name, content) {
  return (
    "<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n" +
    `**Below is the full content of your '${name}' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n` +
    `${content}\n</EXTREMELY_IMPORTANT>\n`
  );
}

/**
 * Reads one SKILL.md without ever throwing.
 *
 * @param file - Absolute path of the SKILL.md.
 * @returns Its content, or `undefined` if it is absent or unreadable (for example a directory).
 */
function readSkill(file) {
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the session-start notice from the manifest's `sessionStart` skills.
 * Reads each skill from the configured `skillsDir`; those not on disk are
 * reported instead of failing.
 *
 * @param root - Repo root.
 * @returns `text` with one envelope per installed skill, in manifest order and
 * separated by a newline, and `missing` with the names not found on disk.
 * @throws {Error} If the manifest is invalid.
 * @example
 * sessionNotice("/repo");
 * // { text: "<EXTREMELY_IMPORTANT>\n...", missing: [] }
 */
export function sessionNotice(root) {
  const manifest = readManifest(root);
  const { skillsDir } = resolvePaths(root, manifest);
  const parts = [];
  const missing = [];
  for (const name of manifest?.sessionStart ?? []) {
    const body = readSkill(path.join(skillsDir, name, SKILL_FILE));
    if (body === undefined) {
      missing.push(name);
    } else {
      parts.push(envelope(name, body));
    }
  }
  return { text: parts.join("\n"), missing };
}
