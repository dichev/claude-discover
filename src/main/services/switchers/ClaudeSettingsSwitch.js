// Recommended Claude Code settings.json keys behind the StatusBar's "Claude settings" switch, applied
// all together. Deactivating removes them, back to Claude Code's defaults — except `oneWay` ones.
import { ClaudeSettings } from '../ClaudeSettings.js'

// `fallback` is Claude Code's default when the key is unset; `isOn` decides whether a value counts as on
const SETTINGS = [
  { key: 'cleanupPeriodDays',     value: 365,  fallback: 30, isOn: days => days >= 365, oneWay: true }, // this app can only browse transcripts Claude Code hasn't swept yet; lowering it would let the next sweep delete them for good
  { key: 'showThinkingSummaries', value: true, fallback: false },                                       // otherwise transcripts hold only empty thinking blocks
]

const isOn = (s, settings) => {
  const value = settings.get(s.key) ?? s.fallback
  return s.isOn ? s.isOn(value) : value === s.value
}

export class ClaudeSettingsSwitch {

  status() {
    const settings = new ClaudeSettings()
    return { applied: SETTINGS.filter(s => isOn(s, settings)).length, total: SETTINGS.length }
  }

  // A value that already counts as on (e.g. a longer retention) is left as is
  activate() {
    const settings = new ClaudeSettings() // fresh — settings.json may have changed since app launch
    const off = SETTINGS.filter(s => !isOn(s, settings))
    for (const s of off) {
      settings.set(s.key, s.value)
    }
    if (off.length) settings.save()
  }

  deactivate() {
    const settings = new ClaudeSettings()
    const set = SETTINGS.filter(s => !s.oneWay && settings.get(s.key) !== undefined)
    for (const s of set) {
      settings.set(s.key, undefined)
    }
    if (set.length) settings.save()
  }
}
