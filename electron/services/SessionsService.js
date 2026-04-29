import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import chokidar from 'chokidar';
import { startOfDay, endOfDay, parseISO } from 'date-fns';
import { SessionReader, loadSessionNames } from './SessionReader.js';

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

function dayBounds(date) {
  const d = parseISO(date);
  return { start: +startOfDay(d), end: +endOfDay(d) };
}

function filterDay(cache, start, end, names) {
  return Array.from(cache.values())
    .filter((m) => m.lastActivityAt >= start && m.startedAt <= end)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((m) => names?.has(m.sessionId) ? { ...m, name: names.get(m.sessionId) } : m);
}

export class SessionsService {
  constructor({ root = PROJECTS_ROOT, onUpdate = () => {}, debounceMs = 200 } = {}) {
    this.root = root;
    this.onUpdate = onUpdate;
    this.debounceMs = debounceMs;
    this.cache = new Map(); // filePath -> meta (scoped to activeDay)
    this.activeDay = null; // { start, end, date }
    this.updateTimer = null;
    this.watcher = null;
  }

  async readSession(sessionId, offset = 0, date = null) {
    let meta = null;
    for (const m of this.cache.values()) {
      if (m.sessionId === sessionId) { meta = m; break; }
    }
    if (!meta) return null;
    const range = date ? dayBounds(date) : null;
    const { items, nextOffset } = await new SessionReader(meta.filePath).readFrom(offset, range);
    return { meta, items, nextOffset };
  }

  async list(date) {
    const { start, end } = dayBounds(date);
    if (this.activeDay?.date !== date) this.cache.clear();
    this.activeDay = { start, end, date };
    await this._scanDay(this.activeDay);
    const names = await loadSessionNames();
    return filterDay(this.cache, start, end, names);
  }

  async start() {
    this._startWatcher();
    return this;
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
  }

  async _refresh(filePath) {
    const day = this.activeDay;
    if (!day) return;
    const cached = this.cache.get(filePath);
    let stat;
    try { stat = await fsp.stat(filePath); } catch { return; }
    if (cached && cached.fileSize === stat.size && cached.mtime === stat.mtimeMs) return;
    const meta = await new SessionReader(filePath).scanMetadata(cached, day);
    if (meta) {
      this.cache.set(filePath, meta);
      if (meta.lastActivityAt >= day.start && meta.startedAt <= day.end) {
        this._scheduleUpdate();
      }
    }
  }

  _scheduleUpdate() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(async () => {
      this.updateTimer = null;
      const day = this.activeDay;
      if (!day) return;
      const names = await loadSessionNames();
      this.onUpdate(filterDay(this.cache, day.start, day.end, names));
    }, this.debounceMs);
  }

  async _scanDay(day) {
    let entries;
    try {
      entries = await fsp.readdir(this.root, { recursive: true, withFileTypes: true });
    } catch (err) {
      console.error('day scan failed', err);
      return;
    }
    await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
        .map(async (e) => {
          const filePath = path.join(e.parentPath, e.name);
          let stat;
          try { stat = await fsp.stat(filePath); } catch { return; }
          if (stat.mtimeMs < day.start) return;
          const cached = this.cache.get(filePath);
          if (cached && cached.fileSize === stat.size && cached.mtime === stat.mtimeMs) return;
          const meta = await new SessionReader(filePath).scanMetadata(cached, day);
          if (meta) this.cache.set(filePath, meta);
        })
    );
  }

  _startWatcher() {
    this.watcher = chokidar.watch(path.join(this.root, '**', '*.jsonl'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }
    });
    this.watcher.on('add', (p) => this._refresh(p));
    this.watcher.on('change', (p) => this._refresh(p));
    this.watcher.on('unlink', (p) => {
      if (this.cache.delete(p)) this._scheduleUpdate();
    });
  }
}
