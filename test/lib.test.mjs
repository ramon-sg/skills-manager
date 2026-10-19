/**
 * @file Tests for the pure functions in `src/lib.mjs`: manifest,
 * marketplace plugin resolution, reference rewriting, collisions, content
 * hash, drift against the lock, machine candidates and the choice made by
 * `skills-manager init` / `skills-manager add`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  diffLock,
  findCollisions,
  hashFiles,
  listCandidates,
  menuOptions,
  pickSummary,
  parseManifest,
  parseSelect,
  picksToSources,
  resolvePluginSource,
  rewritePluginRefs,
} from "../src/lib.mjs";
import { resolvePaths } from "../src/state.mjs";

/** Official marketplace repo, where plugins with a relative path live. */
const MARKETPLACE = "https://github.com/anthropics/claude-plugins-official.git";

/** Real superpowers commit pinned in the marketplace. */
const SUPERPOWERS_SHA = "bb92a77741419a4ab5f06e711a283343f1ada0c3";

describe("parseManifest", () => {
  test("accepts the four source shapes", () => {
    const text = JSON.stringify({
      sources: [
        { plugin: "superpowers@claude-plugins-official" },
        { plugin: "frontend-design@claude-plugins-official", skills: ["frontend-design"] },
        { repo: "anthropics/skills", path: "skills/pdf", ref: "main" },
        { local: "open-code-review-delegate" },
      ],
    });
    assert.equal(parseManifest(text).sources.length, 4);
  });

  test("rejects an entry with both plugin and repo", () => {
    const text = JSON.stringify({ sources: [{ plugin: "a@b", repo: "x/y" }] });
    assert.throws(() => parseManifest(text), /"plugin":"a@b"/);
  });

  test("rejects an entry with no source", () => {
    assert.throws(() => parseManifest(JSON.stringify({ sources: [{ skills: ["x"] }] })), /skills/);
  });

  test("rejects a manifest without a sources list", () => {
    assert.throws(() => parseManifest("{}"), /sources/);
  });
});

describe("resolvePluginSource", () => {
  test("plugin with url and sha, like superpowers", () => {
    const entry = {
      name: "superpowers",
      source: { source: "url", url: "https://github.com/obra/superpowers.git", sha: SUPERPOWERS_SHA },
    };
    assert.deepEqual(resolvePluginSource(entry, MARKETPLACE), {
      repo: "https://github.com/obra/superpowers.git",
      ref: undefined,
      sha: SUPERPOWERS_SHA,
      path: ".",
    });
  });

  test("plugin with a relative path lives in the marketplace repo", () => {
    const entry = { name: "frontend-design", source: "./plugins/frontend-design" };
    assert.deepEqual(resolvePluginSource(entry, MARKETPLACE), {
      repo: MARKETPLACE,
      path: "plugins/frontend-design",
    });
  });

  test("GitHub plugin with ref and sha", () => {
    const entry = { name: "x", source: { source: "github", repo: "o/r", ref: "v1", sha: "abc" } };
    assert.deepEqual(resolvePluginSource(entry, MARKETPLACE), {
      repo: "https://github.com/o/r.git",
      ref: "v1",
      sha: "abc",
      path: ".",
    });
  });

  test("throws if the source type is unknown", () => {
    const entry = { name: "x", source: { source: "npm", package: "x" } };
    assert.throws(() => resolvePluginSource(entry, MARKETPLACE), /npm/);
  });
});

describe("rewritePluginRefs", () => {
  const installed = new Set(["writing-plans"]);

  test("replaces only the reference of its own plugin", () => {
    assert.equal(
      rewritePluginRefs("use superpowers:writing-plans and other:writing-plans", "superpowers", installed),
      "use writing-plans and other:writing-plans",
    );
  });

  test("touches nothing if the skill is not installed", () => {
    const text = "use superpowers:writing-plans";
    assert.equal(rewritePluginRefs(text, "superpowers", new Set()), text);
  });

  test("does not touch a plugin whose name ends the same", () => {
    const text = "use my-superpowers:writing-plans";
    assert.equal(rewritePluginRefs(text, "superpowers", installed), text);
  });

  test("does not touch URLs shaped like plugin:skill", () => {
    const text = "https://x.dev/superpowers:writing-plans and superpowers://writing-plans";
    assert.equal(rewritePluginRefs(text, "superpowers", installed), text);
  });

  test("rewrites inside backticks and link text", () => {
    assert.equal(
      rewritePluginRefs("`superpowers:writing-plans` and [superpowers:writing-plans](a.md)", "superpowers", installed),
      "`writing-plans` and [writing-plans](a.md)",
    );
  });
});

describe("findCollisions", () => {
  test("reports a name repeated across origins and one equal to an own skill", () => {
    const incoming = new Map([
      ["brainstorming", ["superpowers@a", "other@b"]],
      ["start-issue", "superpowers@a"],
      ["cleanup", "superpowers@a"],
    ]);
    const messages = findCollisions(incoming, new Set(["start-issue"]));
    assert.equal(messages.length, 2);
    assert.match(messages[0], /exclude "brainstorming" in the manifest/);
    assert.match(messages[1], /exclude "start-issue" in the manifest/);
  });

  test("without collisions returns an empty list", () => {
    assert.deepEqual(findCollisions(new Map([["a", "x"]]), new Set(["b"])), []);
  });
});

describe("hashFiles", () => {
  const a = { path: "SKILL.md", content: Buffer.from("one") };
  const b = { path: "refs/x.md", content: Buffer.from("two") };

  test("does not depend on input order", () => {
    assert.equal(hashFiles([a, b]), hashFiles([b, a]));
  });

  test("has the sha256-<hex> format", () => {
    assert.match(hashFiles([a]), /^sha256-[0-9a-f]{64}$/);
  });

  test("changes with the content and the path", () => {
    const base = hashFiles([a]);
    assert.notEqual(base, hashFiles([{ ...a, content: Buffer.from("other") }]));
    assert.notEqual(base, hashFiles([{ ...a, path: "OTHER.md" }]));
  });

  test("changes if only the executable bit changes", () => {
    assert.notEqual(hashFiles([a]), hashFiles([{ ...a, executable: true }]));
  });

  test("a non-executable file hashes the same as without the field", () => {
    assert.equal(hashFiles([a]), hashFiles([{ ...a, executable: false }]));
  });
});

describe("diffLock", () => {
  test("detects a missing, a modified and an extra one", () => {
    const lock = { skills: { a: { hash: "h1" }, b: { hash: "h2" }, c: { hash: "h3" } } };
    const actual = new Map([
      ["a", "h1"],
      ["b", "different"],
      ["d", "h4"],
    ]);
    assert.deepEqual(diffLock(lock, actual), { missing: ["c"], modified: ["b"], extra: ["d"] });
  });

  test("a lock without skills does not break", () => {
    assert.deepEqual(diffLock({}, new Map()), { missing: [], modified: [], extra: [] });
  });
});

/**
 * Builds what was read from a test machine: two `fake` plugins (one with
 * skills and one with commands only), a local skill and the `synced/` folder.
 *
 * @param overrides - Fields that override those of the base machine.
 * @returns The machine, shaped as `listCandidates` receives it.
 */
function machine(overrides = {}) {
  return {
    installed: {
      version: 2,
      plugins: {
        "demo@fake": [{ scope: "user", installPath: "/c/demo" }],
        "cmds@fake": [{ scope: "user", installPath: "/c/cmds" }],
      },
    },
    skillDirs: new Map([
      ["/c/demo", ["alpha", "beta"]],
      ["/c/cmds", null],
    ]),
    local: ["my-skill", "synced"],
    marketplaces: new Set(["fake"]),
    ...overrides,
  };
}

describe("listCandidates", () => {
  test("lists plugins with their skills and local skills; a plugin without skills/ cannot be picked", () => {
    assert.deepEqual(listCandidates(machine(), undefined), [
      { id: "demo@fake", kind: "plugin", skills: ["alpha", "beta"] },
      { id: "cmds@fake", kind: "plugin", skills: [], note: "no skills" },
      { id: "my-skill", kind: "local", skills: ["my-skill"] },
    ]);
  });

  test("does not list what is already in the manifest", () => {
    const manifest = { sources: [{ plugin: "demo@fake" }, { local: "my-skill" }] };
    assert.deepEqual(
      listCandidates(machine(), manifest).map((candidate) => candidate.id),
      ["cmds@fake"],
    );
  });

  test("a marketplace that could not be read flags its plugins and the rest goes on", () => {
    const candidates = listCandidates(machine({ marketplaces: new Set() }), undefined);
    assert.equal(candidates[0].note, "could not read marketplace fake");
    assert.deepEqual(candidates[2], { id: "my-skill", kind: "local", skills: ["my-skill"] });
  });

  test("uses the entry whose folder exists and prefers the user scope", () => {
    const installed = {
      plugins: {
        "demo@fake": [
          { scope: "project", installPath: "/c/old" },
          { scope: "project", installPath: "/c/project" },
          { scope: "user", installPath: "/c/user" },
        ],
      },
    };
    const skillDirs = new Map([
      ["/c/project", ["old"]],
      ["/c/user", ["new"]],
    ]);
    const [candidate] = listCandidates(machine({ installed, skillDirs, local: [] }), undefined);
    assert.deepEqual(candidate.skills, ["new"]);
  });

  test("without installed_plugins.json or local skills there are no candidates", () => {
    assert.deepEqual(listCandidates(machine({ installed: undefined, local: [] }), undefined), []);
  });
});

describe("parseSelect", () => {
  test("splits sources by comma and single skills by +", () => {
    assert.deepEqual(parseSelect("demo@fake,my-skill, other@m:a+b"), [
      { id: "demo@fake" },
      { id: "my-skill" },
      { id: "other@m", skills: ["a", "b"] },
    ]);
  });
});

describe("menuOptions", () => {
  const candidates = [
    { id: "superpowers@claude-plugins-official", kind: "plugin", skills: ["brainstorming", "writing-plans"] },
    { id: "frontend-design@claude-plugins-official", kind: "plugin", skills: ["frontend-design"] },
    { id: "code-review@claude-plugins-official", kind: "plugin", skills: [], note: "no skills" },
    { id: "mine", kind: "local", skills: ["mine"] },
  ];

  test("one short line per pickable and the non-pickable ones apart", () => {
    assert.deepEqual(menuOptions(candidates), {
      options: [
        { value: "superpowers@claude-plugins-official", label: "superpowers · 2 skills" },
        { value: "frontend-design@claude-plugins-official", label: "frontend-design · 1 skill" },
        { value: "mine", label: "mine · yours" },
      ],
      hidden: ["code-review (no skills)"],
    });
  });

  test("two plugins with the same name in different marketplaces show the marketplace", () => {
    const twins = [
      { id: "x@one", kind: "plugin", skills: ["a"] },
      { id: "x@two", kind: "plugin", skills: ["a"] },
    ];
    assert.deepEqual(
      menuOptions(twins).options.map((option) => option.label),
      ["x (one) · 1 skill", "x (two) · 1 skill"],
    );
  });
});

describe("pickSummary", () => {
  const candidates = [
    { id: "superpowers@claude-plugins-official", kind: "plugin", skills: ["a", "b", "c"] },
    { id: "mine", kind: "local", skills: ["mine"] },
  ];

  test("whole plugin, single skills and local", () => {
    assert.equal(
      pickSummary([{ id: "superpowers@claude-plugins-official" }, { id: "mine" }], candidates),
      "superpowers (all, 3)\nmine (yours)",
    );
    assert.equal(
      pickSummary([{ id: "superpowers@claude-plugins-official", skills: ["a", "c"] }], candidates),
      "superpowers: a, c",
    );
  });
});

describe("picksToSources", () => {
  /** Candidates of a test machine, one of them not pickable. */
  const candidates = listCandidates(machine(), undefined);

  test("translates whole plugins, single skills and locals into manifest sources", () => {
    const picks = [{ id: "demo@fake", skills: ["beta"] }, { id: "my-skill" }];
    assert.deepEqual(picksToSources(picks, candidates), [{ plugin: "demo@fake", skills: ["beta"] }, { local: "my-skill" }]);
    assert.deepEqual(picksToSources([{ id: "demo@fake" }], candidates), [{ plugin: "demo@fake" }]);
  });

  test("rejects what is missing, what has a note and skills the plugin does not provide", () => {
    assert.throws(() => picksToSources([{ id: "nothing@fake" }], candidates), /nothing@fake/);
    assert.throws(() => picksToSources([{ id: "cmds@fake" }], candidates), /no skills/);
    assert.throws(() => picksToSources([{ id: "demo@fake", skills: ["zeta"] }], candidates), /zeta/);
  });

  test("an empty pick is an error", () => {
    assert.throws(() => picksToSources([], candidates), /nothing/);
  });
});

describe("resolvePaths", () => {
  test("without paths it gives the default locations", () => {
    assert.deepEqual(resolvePaths("/repo", { sources: [] }), {
      manifest: "/repo/.agents/skills.json",
      lock: "/repo/.agents/skills.lock.json",
      skillsDir: "/repo/.agents/skills",
      settings: "/repo/.claude/settings.json",
    });
  });

  test("a configured path replaces only its own default", () => {
    const paths = resolvePaths("/repo", { sources: [], paths: { skillsDir: "skills" } });
    assert.equal(paths.skillsDir, "/repo/skills");
    assert.equal(paths.lock, "/repo/.agents/skills.lock.json");
  });

  test("it works without a manifest", () => {
    assert.equal(resolvePaths("/repo").lock, "/repo/.agents/skills.lock.json");
  });

  test("it rejects paths that climb out of the root or are absolute", () => {
    assert.throws(() => resolvePaths("/repo", { sources: [], paths: { lock: "../x" } }), /relative/);
    assert.throws(() => resolvePaths("/repo", { sources: [], paths: { settings: "/etc/x" } }), /relative/);
  });

  test("it rejects paths that point at the repo root", () => {
    for (const key of ["skillsDir", "lock", "settings"]) {
      for (const value of [".", "", "./", "a/.."]) {
        assert.throws(() => resolvePaths("/repo", { sources: [], paths: { [key]: value } }), /must not point at the repo root|relative/, `${key}=${JSON.stringify(value)}`);
      }
    }
  });
});
