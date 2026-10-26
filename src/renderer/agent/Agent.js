import { useEffect, useState } from 'react'
import { MAX_LINES, MAX_LINE_CHARS, markdownSession } from '../sessions/MarkdownSession.js'
import ANALYZE_PROMPT from './ANALYZE_PROMPT.md?raw'
import ASK_PROMPT from './ASK_PROMPT.md?raw'
import DIAGNOSE_PROMPT from './DIAGNOSE_PROMPT.md?raw'
import STYLE from './STYLE.md?raw'


const TRUNCATE_NOTE = `
Note: long content was truncated (lines >${MAX_LINE_CHARS} chars, blocks >${MAX_LINES} lines). When a truncated block matters, read it in full:
 - the transcript is at \`Log file\`, the raw API requests at \`Proxy log\` (when listed)
 - both can be large: Grep for a distinctive string, then Read just those lines
 - only records between Started and Last activity belong to this period`
const fill = prompt => prompt.replace('{{TRUNCATION_NOTE}}', TRUNCATE_NOTE)
const analyzePrompt  = fill(ANALYZE_PROMPT)
const diagnosePrompt = fill(DIAGNOSE_PROMPT)
const askPrompt      = question => fill(ASK_PROMPT).replace('{{QUESTION}}', () => question)


const EMPTY = { running: false, output: '', error: '' }

// One result per key, so switching back to a session shows its last answer (or the run still streaming)
export function useAgent(key, meta, { items, instructions, requestLog }) {
  const [results, setResults] = useState({})
  const patch = (k, fn) => setResults(r => {
    const cur = r[k] ?? EMPTY
    return { ...r, [k]: { ...cur, ...fn(cur) } }
  })

  useEffect(() => window.api.onAgentOutput(({ id, chunk }) => patch(id, r => ({ output: r.output + chunk }))), [])

  const run = async (prompt, tag) => {
    patch(key, () => ({ ...EMPTY, running: true }))
    let error = ''
    try {
      const { body } = markdownSession(meta, items, instructions, requestLog)
      // The style goes in as the system prompt: it read briefer than inline, and kept the model from taking the transcript as its own
      const { code } = await window.api.runAgentPrompt({ id: key, prompt: `${prompt}\n\n---\n${body}`, systemPrompt: STYLE, tag })
      if (code !== 0) error = `Claude exited with code ${code}`
    } catch (err) {
      error = err.message || String(err)
    }
    patch(key, () => ({ running: false, error }))
  }

  // Tagged apart, so the app's own preset runs can be told from the user's questions in the session list
  const analyze  = () => run(analyzePrompt, 'claude-discover:analyze')
  const diagnose = () => run(diagnosePrompt, 'claude-discover:diagnose')
  const ask      = question => run(askPrompt(question), 'claude-discover:ask')

  return { ...(results[key] ?? EMPTY), analyze, diagnose, ask }
}
