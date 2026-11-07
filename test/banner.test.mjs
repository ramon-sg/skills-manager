import { test } from "node:test";
import assert from "node:assert/strict";
import { KURO, banner, blockStyle, printBlock } from "../src/banner.mjs";

const plain = { art: false, color: false };

test("sin Kuro ni color, un titulo simple", () => {
  assert.equal(banner({ mood: "ok", title: "Listo" }, plain), "\n  [ok] Listo\n\n");
});

test("con Kuro salen sus 4 lineas y el titulo empieza en la columna 26", () => {
  const out = banner({ mood: "ok", title: "Listo" }, { art: true, color: false });
  for (const line of KURO) assert.ok(out.includes(line.trimEnd()));
  const second = out.split("\n")[2];
  assert.equal(second.indexOf("[ok]"), 26);
});

test("las filas se alinean al ancho de la etiqueta mas larga + 2", () => {
  const out = banner({ mood: "ok", title: "T", rows: [["ab", "1"], ["abcd", "2"]] }, plain);
  const lines = out.split("\n");
  assert.ok(lines.includes("  ab    1"));
  assert.ok(lines.includes("  abcd  2"));
});

test("un comando largo sale entero en una linea", () => {
  const command = "x".repeat(200);
  const out = banner({ mood: "ok", title: "T", next: { label: "Siguiente", command } }, plain);
  assert.ok(out.split("\n").includes(`    ${command}`));
});

test("sin color no hay secuencias ANSI; con color el titulo va en verde", () => {
  assert.ok(!banner({ mood: "error", title: "T", next: { label: "L", command: "c" } }, plain).includes("\x1b["));
  assert.ok(banner({ mood: "ok", title: "T" }, { art: false, color: true }).includes("\x1b[32mT\x1b[0m"));
});

test("blockStyle", () => {
  assert.deepEqual(blockStyle({ isTTY: true }, {}), { art: true, color: true });
  assert.deepEqual(blockStyle({ isTTY: true }, { NO_COLOR: "1" }), { art: true, color: false });
  assert.deepEqual(blockStyle({ isTTY: true }, { NO_COLOR: "" }), { art: true, color: true });
  assert.deepEqual(blockStyle({}, {}), { art: false, color: false });
});

test("printBlock escribe en el stream", () => {
  let got = "";
  printBlock({ mood: "question", title: "?" }, { write: (s) => (got += s) }, {});
  assert.equal(got, "\n  [?] ?\n\n");
});
