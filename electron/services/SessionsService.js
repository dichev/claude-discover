import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import chokidar from 'chokidar';
import { SessionReader } from './SessionReader.js';

const PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

export class SessionsService {
  constructor({ root = PROJECTS_ROOT, onUpdate = () => {}, debounceMs = 200 } = {}) {
    this.root = root;
    this.onUpdate = onUpdate;
    this.debounceMs = debounceMs;
    this.cache = new Map(); // filePath -> meta
    this.updateTimer = null;
    this.watcher = null;
  }

  snapshot() {
    return Array.from(this.cache.values()).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  async readSession(sessionId, offset = 0) {
    let meta = null;
    for (const m of this.cache.values()) {
      if (m.sessionId === sessionId) { meta = m; break; }
    }
    if (!meta) return null;
    const { items, nextOffset } = await new SessionReader(meta.filePath).readFrom(offset);
    return { meta, items, nextOffset };
  }

  async start() {
    await this._initialScan();
    this._scheduleUpdate();
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
    const meta = await new SessionReader(filePath).scanMetadata(this.cache.get(filePath));
    if (meta) {
      this.cache.set(filePath, meta);
      this._scheduleUpdate();
    }
  }

  _scheduleUpdate() {
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.onUpdate(this.snapshot());
    }, this.debounceMs);
  }

  async _initialScan() {
    try {
      const projects = await fsp.readdir(this.root, { withFileTypes: true });
      for (const dirent of projects) {
        if (!dirent.isDirectory()) continue;
        const dir = path.join(this.root, dirent.name);
        const files = await fsp.readdir(dir);
        await Promise.all(
          files.filter((f) => f.endsWith('.jsonl')).map((f) => this._refresh(path.join(dir, f)))
        );
      }
    } catch (err) {
      console.error('initial scan failed', err);
    }
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
