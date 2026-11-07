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
    manifest: {
      pathsNotObject: () => '"paths" debe ser un objeto.',
      pathsUnknownKey: ({ key, allowed }) => `Clave desconocida "${key}" en "paths"; permitidas: ${allowed}`,
      pathsNotString: ({ key }) => `"paths.${key}" debe ser un texto.`,
      sessionStartNotList: () => '"sessionStart" debe ser una lista de nombres de skills.',
      noSources: () => 'El manifiesto necesita una lista "sources".',
      sourceKind: ({ kinds, entry }) => `Cada origen lleva exactamente uno de ${kinds}: ${entry}`,
      catalogTwice: ({ catalog }) => `El catálogo ${catalog} aparece dos veces en el manifiesto; junta todas sus skills en un solo origen.`,
      pathRoot: ({ key, value }) => `La ruta "${key}" no puede apuntar a la raíz del repo: ${value}`,
    },
    lock: {
      invalidVersion: ({ version }) => `El lock tiene un lockVersion inválido: ${version}.`,
      newerVersion: ({ version }) => `El lock lo escribió un skills-manager más nuevo (lockVersion ${version}); actualiza @ramon-sg/skills-manager.`,
    },
    git: {
      failed: ({ args }) => `git ${args} falló`,
      repoNotAllowed: ({ repo }) => `Repo no permitido (solo https:// o file://): ${repo}`,
      notFullSha: ({ sha }) => `No es un sha completo: ${sha}`,
      pathNotRelative: ({ rel }) => `La ruta debe ser relativa y sin "..": ${rel}`,
      invalidSkillName: ({ name }) => `Nombre de skill inválido: ${name}`,
      escapesRepo: ({ rel }) => `"${rel}" se sale del repo de origen (enlace simbólico hacia afuera).`,
      symlink: ({ rel }) => `"${rel}" es un enlace simbólico: las skills no pueden contener enlaces simbólicos.`,
      noRef: ({ repo, ref }) => `${repo} no tiene ${ref}.`,
      noHead: ({ repo }) => `${repo} no tiene HEAD.`,
    },
    catalog: {
      unknownKey: ({ key, allowed }) => `Clave desconocida "${key}" en un origen de catálogo; permitidas: ${allowed}`,
      needsSkills: ({ catalog }) => `El origen de catálogo ${catalog} necesita una lista "skills" que no esté vacía.`,
      badRef: ({ repo }) => `"ref" de ${repo} debe ser el nombre de una rama o una etiqueta.`,
      skillNotObject: ({ file, skill }) => `Cada skill de ${file} debe ser un objeto: ${skill}`,
      requiresNotList: ({ name }) => `"requires" de ${name} debe ser una lista.`,
      editableNotList: ({ name }) => `"editable" de ${name} debe ser una lista.`,
      editableDefinition: ({ name, file }) => `"editable" de ${name} no puede incluir ${file}.`,
      missing: ({ file }) => `El repo no tiene ${file}.`,
      badVersion: ({ file, version }) => `${file} tiene un catalogVersion inválido: ${version}.`,
      newerVersion: ({ file, version }) => `${file} usa catalogVersion ${version}; actualiza @ramon-sg/skills-manager.`,
      noSkillsList: ({ file }) => `${file} necesita una lista "skills".`,
      duplicate: ({ file, name }) => `${file} lista "${name}" dos veces.`,
      requiresMissing: ({ name, missing, file }) => `"${name}" requiere "${missing}", que no está en ${file}.`,
      noSkillFile: ({ name, file, path }) => `"${name}" no tiene ${file} en ${path}.`,
      notInCatalog: ({ name, catalog }) => `"${name}" no está en el catálogo ${catalog}.`,
      notInCatalogAt: ({ name, catalog, tag }) => `"${name}" no está en el catálogo ${catalog} en ${tag}.`,
    },
    repo: {
      invalidJson: ({ file }) => `${file} no es un JSON válido.`,
      settingsNotObject: ({ file }) => `${file} debe ser un objeto JSON.`,
    },
    source: {
      unknownPluginSource: ({ name, source }) => `Tipo de origen desconocido en el plugin ${name}: ${source}`,
      nothingPicked: () => "No elegiste nada.",
      notCandidate: ({ id }) => `"${id}" no está entre los candidatos (mira --candidates).`,
      cannotPick: ({ id, note }) => `"${id}" no se puede elegir: ${note}.`,
      unknownSkills: ({ id, unknown, provides }) => `"${id}" no ofrece ${unknown}; ofrece ${provides}.`,
    },
  },
  pick: {
    yours: () => "tuya",
    skillOne: () => "1 skill",
    skillMany: ({ count }) => `${count} skills`,
    all: ({ count }) => `(todas, ${count})`,
    usage: () =>
      "Sin una terminal interactiva usa --candidates para ver qué hay disponible, o --select plugin@marketplace,skill-local (plugin@marketplace:skill1+skill2 para skills sueltas; catalog:<catálogo>/<skill> con --catalog; --repo <owner/name> --select <plugin>[:a+b] | <skill>, con --ref <ref> y --path <carpeta>).",
    selectNeedsValue: ({ usage }) => `--select necesita un valor. ${usage}`,
    flagNeedsValue: ({ flag }) => `${flag} necesita un valor.`,
    onlyOnce: ({ flag }) => `${flag} va una sola vez.`,
    needsRepo: () => "--ref y --path necesitan --repo.",
    repoWithCatalog: () => "--repo y --catalog no pueden ir juntos.",
    nothingNew: () => "No hay nada nuevo que añadir.",
    exists: ({ file }) => `${file} ya existe; usa skills-manager add`,
    noManifest: ({ file }) => `No se encuentra ${file}; empieza con skills-manager init`,
    initDone: () => "Listo: el manifiesto está creado y las skills instaladas",
    addDone: () => "Listo: las skills se añadieron al manifiesto y se instalaron",
    note: {
      notOnDisk: () => "no está en el disco",
      noSkills: () => "no tiene skills",
      unreadableMarketplace: ({ marketplace }) => `no se pudo leer el marketplace ${marketplace}`,
      otherRepo: () => "plugin en otro repo",
    },
  },
  prompt: {
    cancelled: () => "Cancelado; no se cambió nada.",
    nothingOnMachine: () => "No hay nada instalado en esta máquina que añadir.",
    checkboxKeys: () => "(espacio marca · enter continúa)",
    selectKeys: () => "(enter elige)",
    pickOne: () => "Marca al menos una opción con la barra espaciadora.",
    yes: () => "Sí",
    no: () => "No",
    introThirdParty: () => "Skills de terceros",
    introCatalog: () => "Skills",
    cannotPickTitle: () => "No se pueden elegir",
    whatToAdd: ({ keys }) => `¿Qué quieres añadir? ${keys}`,
    allSkillsQuestion: ({ name, keys }) => `${name}: ¿todas las skills? ${keys}`,
    allOption: ({ count }) => `Todas (${count})`,
    someOption: () => "Elegir algunas",
    skillsOf: ({ name, keys }) => `Skills de ${name} ${keys}`,
    summaryTitle: () => "Vas a añadir",
    continue: () => "¿Continuar?",
    installing: () => "Instalando…",
    replaceQuestion: ({ name, kept }) => `El repo tiene su propia skill "${name}". ¿Reemplazarla por la que llega? (se borra su carpeta; ${kept})`,
  },
  replace: {
    missing: () => "--replace necesita los nombres de las skills que reemplazar.",
    misplaced: () => "--replace va con install, update, init o add.",
  },
  next: {
    run: () => "Para arreglarlo, ejecuta:",
    start: () => "Para empezar, ejecuta:",
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
  install: {
    done: () => "Listo: se aplicaron los cambios",
    upToDate: () => "Todo está al día: no hay nada que cambiar",
    dryRun: () => "Esto es lo que cambiaría (no se escribió nada)",
    noManifest: ({ file }) => `No existe ${file}: no hay nada que instalar`,
    nothingChanged: ({ clashes }) => `${clashes}\nNo se cambió nada.`,
    collisions: ({ items }) => items,
    notInLock: ({ name, file }) => `"${name}" no está en ${file}.`,
    pluginNotFound: ({ plugin }) => `No se encuentra ${plugin} en los marketplaces de esta máquina (~/.claude/plugins).`,
    localNotFound: ({ file }) => `No se encuentra ${file}.`,
    edited: ({ name, dir }) =>
      `"${name}" se editó a mano\nPara volver a la versión del lock: rm -rf ${dir} && skills-manager install\nPara sobrescribirla con lo último publicado: skills-manager update ${name}`,
    ownHint: ({ names, each }) =>
      `Ejecútalo en una terminal para que te pregunte, o de nuevo con --replace ${names}; reemplazar borra cada carpeta de skill propia: ${each}.`,
    change: {
      removed: ({ name }) => `${name}: se eliminará`,
      added: ({ name, label }) => `${name}: nueva (${label})`,
      addedReplacing: ({ name, label }) => `${name}: nueva (${label}), reemplaza la carpeta de la skill propia`,
      moved: ({ name, from, to }) => `${name}: ${from} → ${to}`,
      overwritten: ({ name }) => `${name}: editada a mano, se sobrescribirá`,
      editableReplaced: ({ name, rel }) => `${name}: ${rel} ya no es editable; la copia del repo se reemplazará por la de la skill`,
      editableRemoved: ({ name, rel }) => `${name}: ${rel} ya no es editable; la copia del repo se eliminará`,
    },
  },
  collisions: {
    ownCatalog: ({ name, origins }) =>
      `"${name}" (de ${origins}) ya existe como skill propia: elimina la carpeta propia o quita "${name}" (y lo que lo requiere) del origen de catálogo`,
    ownManifest: ({ name, origins }) => `"${name}" (de ${origins}) ya existe como skill propia: excluye "${name}" en el manifiesto`,
    acrossCatalogs: ({ name, origins }) => `"${name}" viene de ${origins}: deja "${name}" (y lo que lo requiere) en un solo origen de catálogo`,
    acrossManifest: ({ name, origins }) => `"${name}" viene de ${origins}: excluye "${name}" en el manifiesto de uno de los orígenes`,
  },
  kept: {
    nothing: () => "no se conserva nada de su carpeta",
    files: ({ files }) => `conserva ${files}`,
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
