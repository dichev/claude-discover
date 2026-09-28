import { useEffect, useState } from 'react'
import { MAX_LINES, MAX_LINE_CHARS, markdownSession } from '../sessions/MarkdownSession.js'
import ANALYZE_PROMPT from './ANALYZE_PROMPT.md?raw'


const TRUNCATE_NOTE = `  - Note: long content was truncated for display (lines >${MAX_LINE_CHARS} chars, blocks >${MAX_LINES} lines). The original session had the full content — base advice on what was clearly happening, not on the truncation.`
const PROMPT = String(ANALYZE_PROMPT).replace('{{TRUNCATION_NOTE}}', TRUNCATE_NOTE)



export function useAgent(resetKey) {
  const [running, setRunning] = useState(false)
  const [output, setOutput]   = useState('')
  const [error, setError]     = useState('')

  useEffect(() => window.api.onAgentOutput(chunk => setOutput(p => p + chunk)), [])

  useEffect(() => {
    setError('')
    setRunning(false)
    setOutput('')
  }, [resetKey])

  const analyze = async (meta, items, instructions) => {
    setError('')
    setOutput('')
    setRunning(true)
    try {
      const { body } = markdownSession(meta, items, instructions)
      const { code } = await window.api.runAgentPrompt(`${PROMPT}\n\n---\n${body}`)
      if (code !== 0) setError(`Claude exited with code ${code}`)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setRunning(false)
    }
  }

  return { running, error, output, analyze }
}
