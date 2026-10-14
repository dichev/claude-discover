// How the app was launched, from where its code runs. No electron import, so plain-node code can use it too
export const LAUNCH_MODES = { NPM_DEV: 'npm-dev', NPM_START: 'npm-start', NPX_TEMP: 'npx-temp', NPM_GLOBAL: 'npm-global' }

export function launchMode(appPath, { dev = false } = {}) {
  if (dev) return LAUNCH_MODES.NPM_DEV                              // a repo checkout in development
  const dirs = appPath.split(/[\\/]/)
  if (dirs.includes('_npx')) return LAUNCH_MODES.NPX_TEMP          // run out of npx's cache dir (~/.npm/_npx/<hash>), which is deleted later
  if (dirs.includes('node_modules')) return LAUNCH_MODES.NPM_GLOBAL // `npm i -g`
  return LAUNCH_MODES.NPM_START                                     // a repo checkout (`npm start` / `electron .`)
}
