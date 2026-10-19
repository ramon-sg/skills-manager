/**
 * @file Tests de las funciones puras de `src/lib.mjs`: manifiesto,
 * resolución de plugins del marketplace, reescritura de referencias,
 * colisiones, hash del contenido, deriva contra el lock, candidatos de la
 * máquina y elección de `skills:init` / `skills:add`.
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

/** Repo del marketplace oficial, de donde salen los plugins con ruta relativa. */
const MARKETPLACE = "https://github.com/anthropics/claude-plugins-official.git";

/** Commit real de superpowers fijado en el marketplace. */
const SUPERPOWERS_SHA = "bb92a77741419a4ab5f06e711a283343f1ada0c3";

describe("parseManifest", () => {
  test("acepta las cuatro formas de fuente", () => {
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

  test("rechaza una entrada con plugin y repo a la vez", () => {
    const text = JSON.stringify({ sources: [{ plugin: "a@b", repo: "x/y" }] });
    assert.throws(() => parseManifest(text), /"plugin":"a@b"/);
  });

  test("rechaza una entrada sin ninguna fuente", () => {
    assert.throws(() => parseManifest(JSON.stringify({ sources: [{ skills: ["x"] }] })), /skills/);
  });

  test("rechaza un manifiesto sin lista de fuentes", () => {
    assert.throws(() => parseManifest("{}"), /sources/);
  });
});

describe("resolvePluginSource", () => {
  test("plugin con url y sha, como superpowers", () => {
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

  test("plugin con ruta relativa vive en el repo del marketplace", () => {
    const entry = { name: "frontend-design", source: "./plugins/frontend-design" };
    assert.deepEqual(resolvePluginSource(entry, MARKETPLACE), {
      repo: MARKETPLACE,
      path: "plugins/frontend-design",
    });
  });

  test("plugin de GitHub con ref y sha", () => {
    const entry = { name: "x", source: { source: "github", repo: "o/r", ref: "v1", sha: "abc" } };
    assert.deepEqual(resolvePluginSource(entry, MARKETPLACE), {
      repo: "https://github.com/o/r.git",
      ref: "v1",
      sha: "abc",
      path: ".",
    });
  });

  test("lanza si el tipo de fuente no se conoce", () => {
    const entry = { name: "x", source: { source: "npm", package: "x" } };
    assert.throws(() => resolvePluginSource(entry, MARKETPLACE), /npm/);
  });
});

describe("rewritePluginRefs", () => {
  const installed = new Set(["writing-plans"]);

  test("reemplaza solo la referencia del plugin propio", () => {
    assert.equal(
      rewritePluginRefs("usá superpowers:writing-plans y otro:writing-plans", "superpowers", installed),
      "usá writing-plans y otro:writing-plans",
    );
  });

  test("no toca nada si la skill no está instalada", () => {
    const text = "usá superpowers:writing-plans";
    assert.equal(rewritePluginRefs(text, "superpowers", new Set()), text);
  });

  test("no toca un plugin cuyo nombre termina igual", () => {
    const text = "usá my-superpowers:writing-plans";
    assert.equal(rewritePluginRefs(text, "superpowers", installed), text);
  });

  test("no toca URLs con la forma plugin:skill", () => {
    const text = "https://x.dev/superpowers:writing-plans y superpowers://writing-plans";
    assert.equal(rewritePluginRefs(text, "superpowers", installed), text);
  });

  test("reescribe dentro de backticks y del texto de un link", () => {
    assert.equal(
      rewritePluginRefs("`superpowers:writing-plans` y [superpowers:writing-plans](a.md)", "superpowers", installed),
      "`writing-plans` y [writing-plans](a.md)",
    );
  });
});

describe("findCollisions", () => {
  test("avisa de un nombre repetido entre orígenes y de uno igual a una skill propia", () => {
    const incoming = new Map([
      ["brainstorming", ["superpowers@a", "otro@b"]],
      ["start-issue", "superpowers@a"],
      ["limpia", "superpowers@a"],
    ]);
    const messages = findCollisions(incoming, new Set(["start-issue"]));
    assert.equal(messages.length, 2);
    assert.match(messages[0], /excluí "brainstorming" en el manifiesto/);
    assert.match(messages[1], /excluí "start-issue" en el manifiesto/);
  });

  test("sin colisiones devuelve una lista vacía", () => {
    assert.deepEqual(findCollisions(new Map([["a", "x"]]), new Set(["b"])), []);
  });
});

describe("hashFiles", () => {
  const a = { path: "SKILL.md", content: Buffer.from("uno") };
  const b = { path: "refs/x.md", content: Buffer.from("dos") };

  test("no depende del orden de entrada", () => {
    assert.equal(hashFiles([a, b]), hashFiles([b, a]));
  });

  test("tiene el formato sha256-<hex>", () => {
    assert.match(hashFiles([a]), /^sha256-[0-9a-f]{64}$/);
  });

  test("cambia con el contenido y con la ruta", () => {
    const base = hashFiles([a]);
    assert.notEqual(base, hashFiles([{ ...a, content: Buffer.from("otro") }]));
    assert.notEqual(base, hashFiles([{ ...a, path: "OTRO.md" }]));
  });

  test("cambia si solo cambia el bit de ejecución", () => {
    assert.notEqual(hashFiles([a]), hashFiles([{ ...a, executable: true }]));
  });

  test("un archivo no ejecutable hashea igual que sin el campo", () => {
    assert.equal(hashFiles([a]), hashFiles([{ ...a, executable: false }]));
  });
});

describe("diffLock", () => {
  test("detecta una faltante, una modificada y una sobrante", () => {
    const lock = { skills: { a: { hash: "h1" }, b: { hash: "h2" }, c: { hash: "h3" } } };
    const actual = new Map([
      ["a", "h1"],
      ["b", "distinto"],
      ["d", "h4"],
    ]);
    assert.deepEqual(diffLock(lock, actual), { missing: ["c"], modified: ["b"], extra: ["d"] });
  });

  test("un lock sin skills no rompe", () => {
    assert.deepEqual(diffLock({}, new Map()), { missing: [], modified: [], extra: [] });
  });
});

/**
 * Arma lo que se leyó de una máquina de prueba: dos plugins de `fake` (uno con
 * skills y otro solo con comandos), una skill local y la carpeta `synced/`.
 *
 * @param overrides - Campos que pisan los de la máquina base.
 * @returns La máquina, con la forma que recibe `listCandidates`.
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
    local: ["mi-skill", "synced"],
    marketplaces: new Set(["fake"]),
    ...overrides,
  };
}

describe("listCandidates", () => {
  test("lista plugins con sus skills y skills locales; un plugin sin skills/ no se puede elegir", () => {
    assert.deepEqual(listCandidates(machine(), undefined), [
      { id: "demo@fake", kind: "plugin", skills: ["alpha", "beta"] },
      { id: "cmds@fake", kind: "plugin", skills: [], note: "sin skills" },
      { id: "mi-skill", kind: "local", skills: ["mi-skill"] },
    ]);
  });

  test("no lista lo que ya está en el manifiesto", () => {
    const manifest = { sources: [{ plugin: "demo@fake" }, { local: "mi-skill" }] };
    assert.deepEqual(
      listCandidates(machine(), manifest).map((candidate) => candidate.id),
      ["cmds@fake"],
    );
  });

  test("un marketplace que no se pudo leer marca sus plugins y el resto sigue", () => {
    const candidates = listCandidates(machine({ marketplaces: new Set() }), undefined);
    assert.equal(candidates[0].note, "no pude leer el marketplace fake");
    assert.deepEqual(candidates[2], { id: "mi-skill", kind: "local", skills: ["mi-skill"] });
  });

  test("usa la entrada cuya carpeta existe y prefiere la de scope user", () => {
    const installed = {
      plugins: {
        "demo@fake": [
          { scope: "project", installPath: "/c/viejo" },
          { scope: "project", installPath: "/c/proyecto" },
          { scope: "user", installPath: "/c/usuario" },
        ],
      },
    };
    const skillDirs = new Map([
      ["/c/proyecto", ["vieja"]],
      ["/c/usuario", ["nueva"]],
    ]);
    const [candidate] = listCandidates(machine({ installed, skillDirs, local: [] }), undefined);
    assert.deepEqual(candidate.skills, ["nueva"]);
  });

  test("sin installed_plugins.json ni skills locales no hay candidatos", () => {
    assert.deepEqual(listCandidates(machine({ installed: undefined, local: [] }), undefined), []);
  });
});

describe("parseSelect", () => {
  test("separa fuentes por coma y skills sueltas con +", () => {
    assert.deepEqual(parseSelect("demo@fake,mi-skill, otro@m:a+b"), [
      { id: "demo@fake" },
      { id: "mi-skill" },
      { id: "otro@m", skills: ["a", "b"] },
    ]);
  });
});

describe("menuOptions", () => {
  const candidates = [
    { id: "superpowers@claude-plugins-official", kind: "plugin", skills: ["brainstorming", "writing-plans"] },
    { id: "frontend-design@claude-plugins-official", kind: "plugin", skills: ["frontend-design"] },
    { id: "code-review@claude-plugins-official", kind: "plugin", skills: [], note: "sin skills" },
    { id: "mia", kind: "local", skills: ["mia"] },
  ];

  test("una línea corta por elegible y los no elegibles aparte", () => {
    assert.deepEqual(menuOptions(candidates), {
      options: [
        { value: "superpowers@claude-plugins-official", label: "superpowers · 2 skills" },
        { value: "frontend-design@claude-plugins-official", label: "frontend-design · 1 skill" },
        { value: "mia", label: "mia · tuya" },
      ],
      hidden: ["code-review (sin skills)"],
    });
  });

  test("dos plugins con el mismo nombre en distintos marketplaces muestran el marketplace", () => {
    const twins = [
      { id: "x@uno", kind: "plugin", skills: ["a"] },
      { id: "x@dos", kind: "plugin", skills: ["a"] },
    ];
    assert.deepEqual(
      menuOptions(twins).options.map((option) => option.label),
      ["x (uno) · 1 skill", "x (dos) · 1 skill"],
    );
  });
});

describe("pickSummary", () => {
  const candidates = [
    { id: "superpowers@claude-plugins-official", kind: "plugin", skills: ["a", "b", "c"] },
    { id: "mia", kind: "local", skills: ["mia"] },
  ];

  test("plugin entero, skills sueltas y local", () => {
    assert.equal(
      pickSummary([{ id: "superpowers@claude-plugins-official" }, { id: "mia" }], candidates),
      "superpowers (todas, 3)\nmia (tuya)",
    );
    assert.equal(
      pickSummary([{ id: "superpowers@claude-plugins-official", skills: ["a", "c"] }], candidates),
      "superpowers: a, c",
    );
  });
});

describe("picksToSources", () => {
  /** Candidatos de una máquina de prueba, con uno que no se puede elegir. */
  const candidates = listCandidates(machine(), undefined);

  test("traduce plugins enteros, skills sueltas y locales a fuentes del manifiesto", () => {
    const picks = [{ id: "demo@fake", skills: ["beta"] }, { id: "mi-skill" }];
    assert.deepEqual(picksToSources(picks, candidates), [{ plugin: "demo@fake", skills: ["beta"] }, { local: "mi-skill" }]);
    assert.deepEqual(picksToSources([{ id: "demo@fake" }], candidates), [{ plugin: "demo@fake" }]);
  });

  test("rechaza lo que no está, lo que tiene nota y skills que el plugin no trae", () => {
    assert.throws(() => picksToSources([{ id: "nada@fake" }], candidates), /nada@fake/);
    assert.throws(() => picksToSources([{ id: "cmds@fake" }], candidates), /sin skills/);
    assert.throws(() => picksToSources([{ id: "demo@fake", skills: ["zeta"] }], candidates), /zeta/);
  });

  test("una elección vacía es un error", () => {
    assert.throws(() => picksToSources([], candidates), /nada/);
  });
});
