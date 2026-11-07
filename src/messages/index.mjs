/**
 * @file The message catalogs, by language.
 */
import { en } from "./en.mjs";
import { es } from "./es.mjs";

/**
 * The catalog of a language.
 *
 * @param lang - `es` or `en`.
 * @returns Its messages.
 * @example messages("en").lang.missing()
 */
export function messages(lang) {
  return lang === "en" ? en : es;
}
