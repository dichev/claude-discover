// Auto update and launchers: createShortcuts writes them on the first launch after an install or update (a deleted one stays deleted), none under npx or dev.
// The main bundle must keep the package external, or it can't find its bin/update.js (pinned in test/prod-build.test.js).
import { NpmUpdater } from 'electron-update-from-npm'
import { name, version, bin } from '../../package.json' // named, so the bundle keeps only these fields

export const updater = new NpmUpdater({ name, version, bin }, { dev: import.meta.env.DEV })
