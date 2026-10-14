export declare const LAUNCH_MODES: {
  readonly NPM_DEV: 'npm-dev'
  readonly NPM_START: 'npm-start'
  readonly NPX_TEMP: 'npx-temp'
  readonly NPM_GLOBAL: 'npm-global'
}

export type LaunchMode = typeof LAUNCH_MODES[keyof typeof LAUNCH_MODES]

/** How the app was launched, from the path its code runs from (e.g. `app.getAppPath()`); `dev` wins over the path. */
export function launchMode(appPath: string, options?: { dev?: boolean }): LaunchMode
