import { NpmUpdater } from 'electron-update-from-npm'
import { name, version, bin } from '../../package.json' // named, so the bundle keeps only these fields

export const updater = new NpmUpdater({ name, version, bin }, { dev: import.meta.env.DEV })
