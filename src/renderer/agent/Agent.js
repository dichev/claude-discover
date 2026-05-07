import { useEffect, useState } from 'react'
import { TRUNCATE_LINES, TRUNCATE_LINE_CHARS } from '../sessions/MarkdownSession.js'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import ANALYZE_PROMPT from './ANALYZE_PROMPT.md?raw'


const TRUNCATE_NOTE = `  - Note: long content was truncated for display (lines >${TRUNCATE_LINE_CHARS} chars, blocks >${TRUNCATE_LINES} lines). The original session had the full content — base advice on what was clearly happening, not on the truncation.`



export function useAgent(resetKey) {
  const [truncated, setTruncated]       = useLocalStorage('agent.truncated', true)
  const [editedPrompt, setEditedPrompt] = useLocalStorage('agent.prompt', '')
  const [running, setRunning]           = useState(false)
  const [output, setOutput]             = useState('')
  const [error, setError]               = useState('')

  const defaultPrompt = String(ANALYZE_PROMPT).replace('{{TRUNCATION_NOTE}}', truncated ? TRUNCATE_NOTE : '')
  const prompt = editedPrompt || defaultPrompt

  useEffect(() => window.api.onAgentOutput(chunk => setOutput(p => p + chunk)), [])

  useEffect(() => {
    setError('')
    setRunning(false)
    setOutput('')
  }, [resetKey])

  const send = async (text) => {
    setError('')
    setOutput('')
    setRunning(true)
    try {
      const { code } = await window.api.runAgentPrompt(text)
      if (code !== 0) setError(`Claude exited with code ${code}`)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setRunning(false)
    }
  }

  return { running, error, send, prompt, editedPrompt, setEditedPrompt, output, truncated, setTruncated, defaultPrompt }
}
