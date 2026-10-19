/**
 * @file Lo que toca git y el disco de un origen bajado, para el CLI de skills:
 * validaciones de lo que viene de datos (repos, shas, rutas, nombres), bajada de
 * un commit sin historia, último commit publicado y lectura recursiva de una
 * carpeta sin symlinks. Nada que venga del manifiesto, del lock o de un
 * marketplace llega a git ni al disco sin pasar por acá.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** Un sha completo de git. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** Esquemas de repo aceptados: nada que git pueda interpretar como comando u opción. */
const ALLOWED_REPO = /^(https|file):\/\//;

/** Bits de ejecución (usuario, grupo y otros) del modo de un archivo. */
const EXECUTABLE_BITS = 0o111;

/** Nombre válido de una skill: una sola carpeta, sin `..` ni separadores. */
const SKILL_NAME = /^[A-Za-z0-9][\w.-]*$/;

/**
 * Corre git y devuelve su salida.
 *
 * @param args - Argumentos de git; lo que viene de datos va después de `--`.
 * @param cwd - Carpeta donde corre.
 * @returns La salida estándar, sin espacios al final.
 * @throws {Error} Si git termina mal.
 */
export function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Exige una URL de repo `https://` o `file://`.
 *
 * @param repo - URL a validar.
 * @returns La misma URL.
 * @throws {Error} Si tiene otro esquema o no es texto.
 */
export function assertRepo(repo) {
  if (typeof repo !== "string" || !ALLOWED_REPO.test(repo)) {
    throw new Error(`Repo no permitido (solo https:// o file://): ${repo}`);
  }
  return repo;
}

/**
 * Exige un sha completo de 40 caracteres hexadecimales.
 *
 * @param sha - Valor a validar.
 * @returns El mismo sha.
 * @throws {Error} Si no es un sha completo.
 */
export function assertSha(sha) {
  if (typeof sha !== "string" || !FULL_SHA.test(sha)) {
    throw new Error(`No es un sha completo: ${sha}`);
  }
  return sha;
}

/**
 * Exige una ruta relativa que no suba de carpeta.
 *
 * @param rel - Ruta a validar.
 * @returns La ruta normalizada en formato POSIX.
 * @throws {Error} Si es absoluta o tiene `..`.
 */
export function assertRelPath(rel) {
  if (typeof rel !== "string" || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
    throw new Error(`La ruta tiene que ser relativa y sin "..": ${rel}`);
  }
  return path.posix.normalize(rel);
}

/**
 * Exige un nombre de skill que sea una sola carpeta.
 *
 * @param name - Nombre a validar.
 * @returns El mismo nombre.
 * @throws {Error} Si tiene separadores, `..` o caracteres raros.
 */
export function assertSkillName(name) {
  if (typeof name !== "string" || !SKILL_NAME.test(name)) {
    throw new Error(`Nombre de skill inválido: ${name}`);
  }
  return name;
}

/**
 * Resuelve una ruta del origen bajado y verifica que no se escape de él por un symlink.
 *
 * @param tree - Checkout del origen.
 * @param rel - Ruta relativa ya validada.
 * @returns La ruta real.
 * @throws {Error} Si la ruta real queda fuera del checkout.
 */
export function insideTree(tree, rel) {
  const base = realpathSync(tree);
  const full = realpathSync(path.join(tree, rel));
  if (full !== base && !full.startsWith(`${base}${path.sep}`)) {
    throw new Error(`"${rel}" sale del repo de origen (symlink hacia afuera).`);
  }
  return full;
}

/**
 * Baja un único commit de un repo a una carpeta, sin historia.
 *
 * @param src - `{ repo, commit?, sha?, ref? }`; sin commit ni ref, baja el HEAD.
 * @param dest - Carpeta destino; se crea si no existe.
 * @returns El commit que quedó en la carpeta.
 * @throws {Error} Si el repo o el sha no son válidos, o git no puede bajarlo.
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
    // POR QUÉ: un servidor sin allowAnySHA1InWant rechaza pedir un sha suelto.
    git(["fetch", "-q", "--", repo, "+refs/heads/*:refs/remotes/origin/*"], dest);
    git(["checkout", "-q", target, "--"], dest);
  }
  return { commit: git(["rev-parse", "HEAD"], dest) };
}

/**
 * Último commit publicado de una fuente: el `sha` del marketplace o el HEAD de su rama.
 *
 * @param resolved - `{ repo, ref?, sha? }` de la fuente.
 * @returns El sha completo.
 * @throws {Error} Si el sha no es válido o el origen no tiene esa rama.
 */
export function latestCommit(resolved) {
  if (resolved.sha !== undefined) {
    return assertSha(resolved.sha);
  }
  const ref = resolved.ref ?? "HEAD";
  const [line] = git(["ls-remote", "--", assertRepo(resolved.repo), ref]).split("\n");
  if (!line) {
    throw new Error(`${resolved.repo} no tiene ${ref}.`);
  }
  return assertSha(line.split("\t")[0]);
}

/**
 * Lista los archivos de una carpeta, recursivo, con ruta relativa POSIX.
 *
 * @param dir - Carpeta a recorrer.
 * @param prefix - Prefijo relativo acumulado.
 * @returns Archivos con su ruta relativa, su contenido y `executable` si tiene algún bit de ejecución.
 * @throws {Error} Si encuentra un symlink: una skill no puede traerlos.
 */
export function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
    const full = path.join(dir, dirent.name);
    if (dirent.isSymbolicLink()) {
      throw new Error(`"${rel}" es un symlink: las skills no pueden traer symlinks.`);
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
