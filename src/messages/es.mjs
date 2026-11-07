/**
 * @file Spanish message catalog, the default language. `en.mjs` must have the same keys,
 * the same kind (text or function) and the same parameters at every key.
 * Parameters are strings or numbers; callers join name lists with `list()` first.
 * Commands, flags and paths are never translated.
 */

export const es = {
  lang: {
    invalid: ({ source, value }) => `${source} espera es o en: ${value}`,
    missing: () => "--lang necesita un valor: es o en",
  },
  errors: {
    unexpected: () => "Algo salió mal",
    unknownCommand: ({ command }) => `Comando desconocido: ${command}; usa install, update, check, list, session-notice, init o add`,
  },
  replace: {
    missing: () => "--replace necesita los nombres de las skills que reemplazar.",
    misplaced: () => "--replace va con install, update, init o add.",
  },
  next: {
    run: () => "Para arreglarlo, ejecuta:",
  },
  check: {
    ok: () => "Las skills de terceros coinciden con el lock y el manifiesto.",
    drift: () => "Las skills de terceros no coinciden con el lock ni con el manifiesto.",
    problems: {
      missing: () => "faltan en el disco",
      edited: () => "editadas a mano",
      notInstalled: () => "orígenes sin instalar",
      stale: () => "en el lock sin origen en el manifiesto",
      skillsList: () => "con otra lista de skills que el lock",
      plugins: () => "plugins del lock distintos a los del manifiesto",
    },
    pluginsDiff: ({ lock, manifest }) => `lock [${lock}], manifiesto [${manifest}]`,
  },
  list: {
    row: ({ name, source, version, commit, newer }) => `${name}  ${source}  ${version} (${commit})${newer}`,
    newer: () => "  (hay una versión más nueva)",
  },
  notice: {
    failed: ({ message }) => `skills-manager: ${message}`,
    missing: ({ name }) => `skills-manager: la skill de inicio de sesión "${name}" no está instalada`,
  },
  usage: {
    main: `Uso: skills-manager <comando> [opciones]

Comandos:
  install                       deja el disco y el lock como dice el manifiesto
  update [name] [--dry-run]     pasa a la última versión publicada; --dry-run solo muestra qué cambiaría
  check                         falla si el disco, el lock y el manifiesto no coinciden
  list                          muestra lo que hay en el lock, con origen, versión y si hay una más nueva
  session-notice                imprime las skills del inicio de sesión para un hook SessionStart; nunca falla
  init                          elige entre lo que hay instalado en la máquina y lo instala
  add                           igual que init, pero para agregar a lo que ya tienes

Opciones de init y add:
  --replace <names>             permite reemplazar skills propias con esos nombres (sin terminal, es obligatorio)
  --catalog <repo>              elige también de ese catálogo
  --repo <owner/name>           elige de un repo de GitHub
  --ref <ref>                   rama, tag o commit del repo (con --repo)
  --path <dir>                  carpeta del repo donde está el marketplace (con --repo)
  --candidates                  lista lo disponible como JSON, sin instalar
  --select <ids>                elige sin preguntar, por ejemplo plugin@marketplace,skill-local

Opciones generales:
  --lang es|en                  idioma de los mensajes (por defecto es)
  --help                        muestra esta ayuda

Variables de entorno:
  SKILLS_MANAGER_LANG           idioma por defecto (es o en); --lang gana`,
  },
};

/** @typedef {typeof es} Messages */
