/**
 * @file English message catalog. Same keys, kinds and parameters as `es.mjs`.
 */

/** @type {import("./es.mjs").Messages} */
export const en = {
  lang: {
    invalid: ({ source, value }) => `${source} expects es or en: ${value}`,
    missing: () => "--lang needs a value: es or en",
  },
  usage: {
    main: `Usage: skills-manager <command> [options]

Commands:
  install                       bring disk and lock in line with the manifest
  update [name] [--dry-run]     move to the latest published version; --dry-run only shows what would change
  check                         fail if disk, lock and manifest do not match
  list                          show what is in the lock, with origin, version and whether a newer one exists
  session-notice                print the session-start skills for a SessionStart hook; never fails
  init                          pick from what is installed on the machine and install it
  add                           same as init, but to add to what you already have

Options of init and add:
  --replace <names>             allow replacing the repo's own skills with those names (required without a terminal)
  --catalog <repo>              also pick from that catalog
  --repo <owner/name>           pick from a GitHub repo
  --ref <ref>                   branch, tag or commit of the repo (with --repo)
  --path <dir>                  folder of the repo that holds the marketplace (with --repo)
  --candidates                  list what is available as JSON, without installing
  --select <ids>                pick without asking, for example plugin@marketplace,local-skill

General options:
  --lang es|en                  language of the messages (default es)
  --help                        show this help

Environment variables:
  SKILLS_MANAGER_LANG           default language (es or en); --lang wins`,
  },
};
