#!/usr/bin/env node
/*
Saves a copy of every instruction file Claude Code loads (CLAUDE.md, memory files, etc.) so we can see later what context the session actually had.

Runs on the InstructionsLoaded hook (wired in ~/.claude/settings.json) and appends one JSON line per file to <session>.context.ndjson, next to the
session's .jsonl transcript. Stays silent on errors so Claude Code doesn't surface them to the user.

Copy-paste into ~/.claude/settings.json (replace the path):
{
  "hooks": {
    "InstructionsLoaded": [
      { "hooks": [{ "type": "command", "command": "node /ABSOLUTE/PATH/TO/agentic-workflow/bin/capture-context.hook.mjs" }] }
    ]
  }
}
*/


import fs from 'node:fs'
import path from 'node:path'
import { text } from 'node:stream/consumers'

const HOOK_EVENT  = 'InstructionsLoaded'
const RECORD_TYPE = 'instructions-loaded'
const ERROR_LOG   = '.agentic-workflow.hook.error.log'


function readContent(filePath) {
  if (!filePath) return { error: 'no file_path' }
  try {
    return { content: fs.readFileSync(filePath, 'utf8') }
  } catch (e) {
    return { error: String(e.message || e) }
  }
}


async function main() {
  const raw = await text(process.stdin)
  const event = JSON.parse(raw || '{}')
  if (event.hook_event_name !== HOOK_EVENT || !event.transcript_path) return

  try {
    const content = readContent(event.file_path)
    const offsetMs = event.load_reason === 'session_start' ? -500 : 0 // Backdate session_start loads by 500ms so they sort above the first transcript events (which they fire just after).
    const record = {
      type: RECORD_TYPE,
      ...event, // = { file_path, memory_type, load_reason, parent_file_path, trigger_file_path, globs }
      timestamp: new Date(Date.now() + offsetMs).toISOString(),
      ...content
    }

    const logPath = event.transcript_path.replace('.jsonl', '.context.ndjson')
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
  }
  catch (err) {
    const claudeDir = path.resolve(event.transcript_path, '../../..') // transcript_path lives at <CLAUDE_DIR>/projects/<project>/<session>.jsonl
    const errLogPath = path.join(claudeDir, ERROR_LOG)
    try { fs.appendFileSync(errLogPath, `${new Date().toISOString()} ${err?.stack || err}\n`) } catch {}
  }
}

main().catch(() => {}).finally(() => process.exit(0))
