/**
 * @file The version of this package, read from its `package.json`. The path is
 * relative to this module, so it resolves the same from `src/` and from the
 * bundled `dist/`, both one level under the package root.
 */
import { readFileSync } from "node:fs";

/** Version of `@ramon-sg/skills-manager` that is running, such as `1.5.0`. */
export const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
