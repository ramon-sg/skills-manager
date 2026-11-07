/**
 * @file The block of the final messages: a title with a status mark, a few aligned rows and
 * the next command, with Kuro (the mascot) beside it when the terminal can show it.
 * Ported from issue-flow's `banner.ts`.
 */

/**
 * @typedef {"ok" | "error" | "question"} Mood How the block feels: done, failed or waiting.
 */

/**
 * @typedef {object} Block What a final message says.
 * @property {Mood} mood - How the block feels.
 * @property {string} title - The headline.
 * @property {[label: string, value: string][]} [rows] - Label and value pairs, aligned in a column.
 * @property {{ label: string, command: string }} [next] - The command to copy, under its own label.
 * @property {string[]} [lines] - Free lines after the rows.
 */

/** Kuro, the mascot, without trailing spaces. */
export const KURO = Object.freeze([
  "    ▄█████▄",
  " ≋≋██▀▀▀▀▀██",
  "    █ ▄  ▄ █   ╱",
  "    ▀█▄▄▄▄█▀  ╱",
]);

/** Columns Kuro takes, where the text begins. */
const TEXT_COLUMN = 26;
/** Indent of the text without Kuro. */
const INDENT = 2;

const MARKS = { ok: "[ok]", error: "[!]", question: "[?]" };
const MOOD_COLOR = { ok: 32, error: 31, question: 33 };

/**
 * Wraps text in an ANSI SGR code.
 *
 * @param {string} text - The text.
 * @param {number} code - The SGR code.
 * @param {boolean} on - Whether to color.
 * @returns {string} The text, colored or not.
 */
function paint(text, code, on) {
  return on ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * Builds a block. Values are never cut or wrapped: a command to copy must stay whole.
 *
 * @param {Block} block - What to say.
 * @param {{ art: boolean, color: boolean }} opts - Whether to draw Kuro and whether to color.
 * @returns {string} The text, with a blank line before and after.
 */
export function banner(block, opts) {
  const code = MOOD_COLOR[block.mood];
  const text = [`${paint(MARKS[block.mood], code, opts.color)} ${paint(block.title, code, opts.color)}`];
  if (block.rows?.length) {
    const width = Math.max(...block.rows.map(([label]) => [...label].length)) + 2;
    text.push("");
    for (const [label, value] of block.rows) text.push(label + " ".repeat(width - [...label].length) + value);
  }
  if (block.lines?.length) text.push("", ...block.lines);
  if (block.next) text.push("", block.next.label, `  ${paint(block.next.command, 1, opts.color)}`);

  const out = [];
  if (opts.art) {
    // Kuro takes rows 0-3 and the text starts on row 1.
    const total = Math.max(KURO.length, text.length + 1);
    for (let row = 0; row < total; row++) {
      const left = KURO[row] ?? "";
      const right = text[row - 1];
      out.push(right === undefined ? left : left + " ".repeat(TEXT_COLUMN - [...left].length) + right);
    }
  } else {
    for (const line of text) out.push(line === "" ? "" : " ".repeat(INDENT) + line);
  }
  return `\n${out.map((line) => line.trimEnd()).join("\n")}\n\n`;
}

/**
 * Decides whether a stream gets Kuro and color: only a terminal does, and NO_COLOR turns color off.
 *
 * @param {{ isTTY?: boolean }} stream - The output stream.
 * @param {Record<string, string | undefined>} env - The environment.
 * @returns {{ art: boolean, color: boolean }} The block options.
 */
export function blockStyle(stream, env) {
  const art = stream.isTTY === true;
  return { art, color: art && !env.NO_COLOR };
}

/**
 * Writes a block to a stream, with Kuro and color only on a terminal.
 *
 * @param {Block} block - What to say.
 * @param {{ write: (text: string) => unknown, isTTY?: boolean }} [stream] - Where to write, stdout by default.
 * @param {Record<string, string | undefined>} [env] - The environment, process.env by default.
 * @returns {void}
 */
export function printBlock(block, stream = process.stdout, env = process.env) {
  stream.write(banner(block, blockStyle(stream, env)));
}
