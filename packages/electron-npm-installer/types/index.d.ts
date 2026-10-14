import type { LaunchMode } from './launch-mode.js'
export { LAUNCH_MODES, launchMode, type LaunchMode } from './launch-mode.js'

export interface Update {
  /** The app's npm package name. */
  name: string
  /** The running version. */
  current: string
  /** The latest version on npm. */
  latest: string
  /** How the app was launched: `npx-temp` always gets a result, to offer a global install. */
  mode: Exclude<LaunchMode, 'npm-start'>
}

export interface CheckOptions {
  /** Check from a repo checkout too; the install then updates the global install and doesn't reopen. Default: false. */
  dev?: boolean
}

/** Asks npm for a newer version, once per launch. Resolves to null when up to date, from a repo checkout, or on failure. */
export function checkForUpdate(options?: CheckOptions): Promise<Update | null>

export interface ShortcutOptions {
  /** Reverse-DNS app id, for the @windows taskbar and the @macOS bundle; a repo checkout gets `.local` appended. Default: `com.electron.<package name>`. */
  appId?: string
  /** Shortcut name; a repo checkout gets ` (local)` appended. Default: `app.getName()`. */
  name?: string
  /** @windows The shortcut's tooltip. */
  description?: string
  /** A repo checkout in development: sets the app id but writes no shortcuts. Default: false. */
  dev?: boolean
}

/** Writes @windows Start Menu + Desktop shortcuts and @macOS an ~/Applications launcher, for an `npm i -g` install. Call before any window is created. */
export function createShortcuts(options?: ShortcutOptions): void

/** Installs what the last check found: closes the app, runs `npm i -g`, then reopens it. Does nothing without an update. */
export function installUpdate(): Promise<void>
