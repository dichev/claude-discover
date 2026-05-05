import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

export default function AgentPrompt({ text, pretty }) {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const outputRef = useRef(null)

  useEffect(() => {
    return window.api.onAgentOutput((chunk) => {
      setOutput((prev) => prev + chunk)
    })
  }, [])

  useEffect(() => {
    const el = outputRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [output])

  const onSend = async () => {
    setOutput('')
    setError('')
    setStatus('running')
    try {
      const { code } = await window.api.runAgentPrompt(text)
      setStatus(code === 0 ? 'done' : 'error')
      if (code !== 0) setError(`claude exited with code ${code}`)
    } catch (err) {
      setStatus('error')
      setError(err.message || String(err))
    }
  }

  const label = status === 'running' ? 'Sending…' : 'Send to Claude'
  const statusText =
    status === 'running' ? 'Running…' :
    status === 'done' ? 'Done' :
    status === 'error' ? 'Error' : ''

  return (
    <div className="agent-prompt">
      <div className="agent-prompt-actions">
        <button
          type="button"
          className="agent-view-copy"
          onClick={onSend}
          disabled={status === 'running'}
        >
          {label}
        </button>
        {statusText && <span className="agent-prompt-status">{statusText}</span>}
        {error && <span className="agent-prompt-error">{error}</span>}
      </div>
      <div className="agent-prompt-output" ref={outputRef}>
        {pretty
          ? <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{output}</ReactMarkdown></div>
          : <pre className="agent-view-raw">{output}</pre>}
      </div>
    </div>
  )
}
