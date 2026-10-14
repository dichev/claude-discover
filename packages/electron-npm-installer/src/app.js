// The host app's npm package: its name, and the bin that reopens it
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let pkg = null

export function appPackage() {
  if (pkg) return pkg
  const { name, bin } = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'))
  return pkg = { name, bin: typeof bin === 'string' ? bin : bin?.[name] ?? Object.values(bin ?? {})[0] }
}
