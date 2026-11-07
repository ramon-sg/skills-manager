import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { fail, list, resolveLang, setLang, takeLang } from "../src/lang.mjs";
import { en } from "../src/messages/en.mjs";
import { es } from "../src/messages/es.mjs";

/** Every leaf path of a catalog, with its value. */
function leaves(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) =>
    value !== null && typeof value === "object" ? leaves(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  );
}

/** Calls a message with a Proxy that records the properties it reads. */
function probe(fn, extra = {}) {
  const read = new Set();
  const params = new Proxy(extra, {
    get(target, name) {
      if (typeof name !== "string") {
        return undefined;
      }
      read.add(name);
      return name in target ? target[name] : `«${name}»`;
    },
  });
  return { out: fn(params), read };
}

const esLeaves = new Map(leaves(es));
const enLeaves = new Map(leaves(en));

afterEach(() => setLang("es"));

describe("catalogs", () => {
  test("same keys at every depth", () => {
    assert.deepEqual([...enLeaves.keys()].sort(), [...esLeaves.keys()].sort());
  });

  test("same kind per key", () => {
    for (const [key, value] of esLeaves) {
      assert.equal(typeof enLeaves.get(key), typeof value, key);
      assert.ok(["string", "function"].includes(typeof value), key);
    }
  });

  test("functions use the same parameters", () => {
    for (const [key, fn] of esLeaves) {
      if (typeof fn !== "function") {
        continue;
      }
      const a = probe(fn);
      const b = probe(enLeaves.get(key));
      assert.deepEqual([...b.read].sort(), [...a.read].sort(), key);
      for (const name of a.read) {
        assert.ok(a.out.includes(`«${name}»`), `${key} es ${name}`);
        assert.ok(b.out.includes(`«${name}»`), `${key} en ${name}`);
      }
      for (const count of [1, 2]) {
        const x = probe(fn, { count });
        const y = probe(enLeaves.get(key), { count });
        assert.deepEqual([...y.read].sort(), [...x.read].sort(), `${key} count ${count}`);
      }
    }
  });

  test("no empty text", () => {
    for (const [catalog, map] of [["es", esLeaves], ["en", enLeaves]]) {
      for (const [key, value] of map) {
        const out = typeof value === "function" ? probe(value).out : value;
        assert.notEqual(out, "", `${catalog} ${key}`);
      }
    }
  });
});

describe("resolveLang", () => {
  test("flag, env and default", () => {
    assert.equal(resolveLang(undefined, {}), "es");
    assert.equal(resolveLang(undefined, { SKILLS_MANAGER_LANG: "en" }), "en");
    assert.equal(resolveLang("es", { SKILLS_MANAGER_LANG: "en" }), "es");
    assert.equal(resolveLang(" EN ", {}), "en");
    assert.equal(resolveLang(undefined, { SKILLS_MANAGER_LANG: "" }), "es");
    assert.equal(resolveLang(undefined, { LANG: "en_US.UTF-8" }), "es");
  });

  test("an unknown language fails in Spanish", () => {
    setLang("en");
    assert.throws(
      () => resolveLang("fr", {}),
      (error) => error.exitCode === 2 && error.key === "lang.invalid" && error.message.includes("--lang") && error.message.includes("fr") && error.message.includes("espera"),
    );
  });

  test("names the env var as the source", () => {
    assert.throws(() => resolveLang(undefined, { SKILLS_MANAGER_LANG: "fr" }), /SKILLS_MANAGER_LANG/);
  });
});

describe("takeLang", () => {
  test("takes both spellings from any position", () => {
    assert.deepEqual(takeLang(["--lang", "en", "check"]), { rest: ["check"], flag: "en" });
    assert.deepEqual(takeLang(["check", "--lang=en"]), { rest: ["check"], flag: "en" });
    assert.deepEqual(takeLang(["check"]), { rest: ["check"], flag: undefined });
  });

  test("a missing value fails", () => {
    for (const args of [["check", "--lang"], ["--lang", "--dry-run"]]) {
      assert.throws(() => takeLang(args), (error) => error.exitCode === 2 && error.key === "lang.missing");
    }
  });
});

describe("fail", () => {
  test("builds an error with key, params and props", () => {
    const params = { source: "--lang", value: "fr" };
    const error = fail("lang.invalid", params, { exitCode: 2 });
    assert.ok(error instanceof Error);
    assert.equal(error.key, "lang.invalid");
    assert.deepEqual(error.params, params);
    assert.equal(error.exitCode, 2);
  });

  test("indents the detail", () => {
    const error = fail("lang.invalid", { source: "x", value: "y", detail: "a\nb" });
    assert.ok(error.message.endsWith("\n  a\n  b"));
  });

  test("an unknown key is a bug", () => {
    assert.throws(() => fail("no.such.key"), /Unknown message key/);
  });
});

describe("list", () => {
  test("joins in the active language", () => {
    assert.equal(list(["a", "b", "c"]), "a, b y c");
    setLang("en");
    assert.equal(list(["a", "b", "c"]), "a, b, and c");
  });
});
