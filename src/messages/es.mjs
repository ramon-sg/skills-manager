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
