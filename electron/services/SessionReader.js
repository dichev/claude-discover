import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const SESSIONS_ROOT = path.join(os.homedir(), '.claude', 'sessions');

export async function loadSessionNames() {
  const map = new Map();
  let entries;
  try { entries = await fsp.readdir(SESSIONS_ROOT, { withFileTypes: true }); }
  catch { return map; }
  await Promise.all(entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map(async (e) => {
      try {
        const raw = await fsp.readFile(path.join(SESSIONS_ROOT, e.name), 'utf8');
        const obj = JSON.parse(raw);
        if (obj.sessionId && obj.name) map.set(obj.sessionId, obj.name);
      } catch {}
    }));
  return map;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : b && b.type === 'text' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

const ACTIVITY_GAP_MS = 5 * 60 * 1000;

function classifySource(meta) {
  if (meta.hasScheduledTask) return 'scheduled';
  const ep = (meta.entrypoint || '').toLowerCase();
  if (ep === 'cli') return 'cli';
  if (ep.includes('desktop')) return 'desktop';
  if (ep.includes('sdk')) return 'sdk';
  return 'other';
}

export class SessionReader {
  constructor(filePath) {
    this.filePath = filePath;
    this.sessionId = path.basename(filePath, '.jsonl');
  }

  async _eachLine(offset, onLine) {
    let consumed = 0;
    let leftover = '';
    await new Promise((resolve) => {
      const stream = fs.createReadStream(this.filePath, { encoding: 'utf8', start: offset });
      stream.on('data', (chunk) => {
        leftover += chunk;
        let idx;
        while ((idx = leftover.indexOf('\n')) !== -1) {
          const raw = leftover.slice(0, idx);
          consumed += Buffer.byteLength(raw, 'utf8') + 1;
          leftover = leftover.slice(idx + 1);
          const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
          if (!line) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }
          onLine(obj);
        }
      });
      stream.on('close', resolve);
      stream.on('error', resolve);
    });
    return offset + consumed;
  }

  async readFrom(offset = 0, range = null) {
    const items = [];
    const nextOffset = await this._eachLine(offset, (obj) => {
      if (range) {
        const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
        if (Number.isNaN(ts) || ts < range.start || ts > range.end) return;
      }
      items.push(obj);
    });
    return { items, nextOffset };
  }

  async scanMetadata(prev = null) {
    let stat;
    try {
      stat = await fsp.stat(this.filePath);
    } catch {
      return null;
    }

    const reuse = prev && stat.size >= prev.fileSize;
    const meta = reuse ? {
      ...prev,
      fileSize: stat.size,
      mtime: stat.mtimeMs,
      tokens: { ...prev.tokens },
      activityPeriods: (prev.activityPeriods || []).map((p) => ({ ...p }))
    } : {
      sessionId: this.sessionId,
      filePath: this.filePath,
      fileSize: stat.size,
      mtime: stat.mtimeMs,
      startedAt: null,
      lastActivityAt: null,
      entrypoint: null,
      cwd: null,
      gitBranch: null,
      version: null,
      model: null,
      summary: null,
      firstUserPrompt: null,
      messageCount: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      hasScheduledTask: false,
      activityPeriods: []
    };

    meta.nextOffset = await this._eachLine(reuse ? prev.nextOffset : 0, (obj) => {
      const t = obj.type;
      if (t === 'summary' && obj.summary) {
        meta.summary = obj.summary;
        return;
      }
      let ts = null;
      if (obj.timestamp) {
        ts = Date.parse(obj.timestamp);
        if (!Number.isNaN(ts)) {
          if (meta.startedAt == null || ts < meta.startedAt) meta.startedAt = ts;
          if (ts > meta.lastActivityAt) meta.lastActivityAt = ts;
        }
      }
      if (obj.cwd && !meta.cwd) meta.cwd = obj.cwd;
      if (obj.gitBranch && !meta.gitBranch) meta.gitBranch = obj.gitBranch;
      if (obj.entrypoint && !meta.entrypoint) meta.entrypoint = obj.entrypoint;
      if (obj.version && !meta.version) meta.version = obj.version;

      if (t === 'user' || t === 'assistant') {
        meta.messageCount += 1;
        if (ts != null) {
          const last = meta.activityPeriods[meta.activityPeriods.length - 1];
          if (last && ts - last.end <= ACTIVITY_GAP_MS) {
            if (ts > last.end) last.end = ts;
          } else {
            meta.activityPeriods.push({ start: ts, end: ts });
          }
        }
        const content = obj.message && obj.message.content;
        if (t === 'user' && !meta.firstUserPrompt) {
          const text = extractText(content);
          if (text && !text.includes('<local-command-caveat>') && !text.startsWith('<command-name>')) {
            meta.firstUserPrompt = text.slice(0, 500);
            if (text.includes('<scheduled-task')) meta.hasScheduledTask = true;
          }
        }
        if (t === 'assistant') {
          if (obj.message && obj.message.model && !meta.model) meta.model = obj.message.model;
          const u = obj.message && obj.message.usage;
          if (u) {
            meta.tokens.input += u.input_tokens || 0;
            meta.tokens.output += u.output_tokens || 0;
            meta.tokens.cacheRead += u.cache_read_input_tokens || 0;
            meta.tokens.cacheCreation += u.cache_creation_input_tokens || 0;
          }
        }
      }
      if (t === 'queue-operation' && obj.content && obj.content.includes('<scheduled-task')) {
        meta.hasScheduledTask = true;
      }
    });

    if (meta.startedAt == null) meta.startedAt = stat.mtimeMs;
    if (meta.lastActivityAt == null) meta.lastActivityAt = stat.mtimeMs;
    meta.source = classifySource(meta);
    return meta;
  }
}
