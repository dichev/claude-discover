import fs from 'node:fs/promises'
import { CLAUDE_CONFIG } from '../paths.js'

// The experiments Claude Code is in now, by id, from the per-model settings it caches in its config (older ones are gone).
// Each lists the settings only its slots got: none a slot outside an experiment, or another experiment on the same model, has too.
export class Experiments {
  #mtime = null
  #byId = new Map()

  constructor(file = CLAUDE_CONFIG) {
    this.file = file
  }

  async get() {
    try {
      const { mtimeMs } = await fs.stat(this.file)
      if (mtimeMs === this.#mtime) return this.#byId
      const slots = Object.values(JSON.parse(await fs.readFile(this.file, 'utf8')).clientDataCacheSlots ?? {}).filter(s => s?.data)
      this.#byId = collect(slots)
      this.#mtime = mtimeMs
    } catch {} // missing, or caught mid-write: keep what was last read
    return this.#byId
  }

  async read() {
    return Object.fromEntries(await this.get())
  }

  async name(sessions) {
    const byId = await this.get()
    for (const m of sessions) m.experimentName = byId.get(m.experiment)?.name ?? null
  }
}

// `settings` are the latest slot's, less those a slot outside an experiment has too
function collect(slots) {
  const plain = new Set(slots.filter(s => !s.data.atis).flatMap(s => Object.entries(s.data).map(entryKey)))
  const byId = new Map()
  for (const { data, model, at } of slots.filter(s => s.data.atis).sort((a, b) => a.at - b.at)) {
    if (!byId.has(data.atis)) byId.set(data.atis, { name: null, models: [], cachedAt: null, settings: null })
    const e = byId.get(data.atis)
    e.settings = pick(data, (k, v) => k !== 'atis' && k !== 'experimentKey' && !plain.has(entryKey([k, v])))
    e.name = data.experimentKey ?? e.name
    e.cachedAt = Number(at)
    if (!e.models.includes(model)) e.models.push(model)
  }
  // With no slot of the model outside an experiment, a setting another experiment on it has too is likely the model's own
  const all = [...byId.values()]
  const inOthers = (e, k, v) => all.some(o => o !== e && o.models.some(m => e.models.includes(m)) && entryKey([k, o.settings[k]]) === entryKey([k, v]))
  const own = all.map(e => pick(e.settings, (k, v) => !inOthers(e, k, v)))
  for (const [i, e] of all.entries()) {
    e.settings = own[i]
  }
  return byId
}

const pick = (from, keep) => Object.fromEntries(Object.entries(from).filter(([k, v]) => keep(k, v)))
const entryKey = ([k, v]) => `${k}=${JSON.stringify(v)}`
