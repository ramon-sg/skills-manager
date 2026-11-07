/**
 * @file The language of the terminal: `--lang`, then `SKILLS_MANAGER_LANG`, then Spanish.
 * `LANG` and `LC_ALL` are not read. Also resolves message keys (`text`) and builds
 * errors from them (`fail`).
 */
import { messages } from "./messages/index.mjs";

/** Exit code of a usage error. */
const USAGE_EXIT = 2;

/** Active language; Spanish until `setLang` says otherwise. */
let current = "es";

/**
 * Sets the active language.
 *
 * @param lang - `es` or `en`.
 */
export function setLang(lang) {
  current = lang;
}

/**
 * @returns The active language.
 */
export function getLang() {
  return current;
}

/**
 * @returns The active message catalog.
 */
export function msg() {
  return messages(current);
}

/**
 * Resolves a dotted key in a catalog.
 *
 * @param catalog - The messages.
 * @param key - Dotted key, such as `check.ok`.
 * @param params - Parameters for a function message.
 * @returns The text.
 * @throws Error if the key does not exist (a bug of the program, not translated).
 */
function resolveIn(catalog, key, params) {
  let value = catalog;
  for (const part of key.split(".")) {
    value = value !== null && typeof value === "object" ? value[part] : undefined;
  }
  if (typeof value === "function") {
    return value(params);
  }
  if (typeof value !== "string") {
    throw new Error(`Unknown message key: ${key}`);
  }
  return value;
}

/**
 * The text of a key in the active language.
 *
 * @param key - Dotted key, such as `check.ok`.
 * @param params - Parameters for a function message.
 * @returns The text.
 * @throws Error if the key does not exist.
 * @example text("lang.missing") // "--lang necesita un valor: es o en"
 */
export function text(key, params = {}) {
  return resolveIn(msg(), key, params);
}

/**
 * Builds (does not throw) an error from a message key.
 *
 * @param key - Dotted key.
 * @param params - Parameters; `detail`, if present, goes after the message, indented.
 * @param props - Extra properties for the error, such as `exitCode`.
 * @returns The error, with `key`, `params` and `props`.
 * @example throw fail("lang.invalid", { source: "--lang", value: "fr" }, { exitCode: 2 })
 */
export function fail(key, params = {}, props = {}) {
  return build(text(key, params), key, params, props);
}

/**
 * @param message - Text of the error.
 * @param key - Message key.
 * @param params - Message parameters.
 * @param props - Extra properties.
 * @returns The error.
 */
function build(message, key, params, props) {
  const detail =
    params.detail === undefined
      ? ""
      : `\n${String(params.detail).split("\n").map((line) => `  ${line}`).join("\n")}`;
  return Object.assign(new Error(message + detail), { key, params }, props);
}

/**
 * Like `fail` but always in Spanish: for errors about the language itself.
 *
 * @param key - Dotted key.
 * @param params - Parameters.
 * @returns The error with `exitCode` 2.
 */
function failEs(key, params) {
  return build(resolveIn(messages("es"), key, params), key, params, { exitCode: USAGE_EXIT });
}

/**
 * Joins names as a list in the active language.
 *
 * @param items - The names.
 * @returns For example `a, b y c`.
 */
export function list(items) {
  return new Intl.ListFormat(current, { type: "conjunction" }).format(items);
}

/**
 * The language of the terminal.
 *
 * @param flag - The `--lang` value, or undefined.
 * @param env - The environment.
 * @returns The flag, else `SKILLS_MANAGER_LANG` (empty counts as unset), else `es`.
 * @throws Error (`lang.invalid`, exit 2, in Spanish) if the value is neither `es` nor `en`.
 * @example resolveLang(undefined, { SKILLS_MANAGER_LANG: "en" }) // "en"
 */
export function resolveLang(flag, env) {
  const fromEnv = env.SKILLS_MANAGER_LANG?.trim() === "" ? undefined : env.SKILLS_MANAGER_LANG;
  const source = flag !== undefined ? "--lang" : "SKILLS_MANAGER_LANG";
  const value = flag ?? fromEnv;
  if (value === undefined) {
    return "es";
  }
  const lang = value.trim().toLowerCase();
  if (lang !== "es" && lang !== "en") {
    throw failEs("lang.invalid", { source, value });
  }
  return lang;
}

/**
 * Takes `--lang x` and `--lang=x` out of the arguments, wherever they are.
 *
 * @param args - The arguments.
 * @returns The rest and the flag value (the last one given), or undefined.
 * @throws Error (`lang.missing`, exit 2, in Spanish) if `--lang` has no value.
 * @example takeLang(["--lang", "en", "check"]) // { rest: ["check"], flag: "en" }
 */
export function takeLang(args) {
  const rest = [];
  let flag;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--lang=")) {
      flag = arg.slice("--lang=".length);
    } else if (arg === "--lang") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw failEs("lang.missing", {});
      }
      flag = next;
      i++;
    } else {
      rest.push(arg);
    }
  }
  return { rest, flag };
}
