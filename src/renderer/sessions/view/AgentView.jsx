import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { useLocalStorage } from '../../utils/useLocalStorage.js'
import { markdownSession } from '../MarkdownSession.js'
import Toggle from '../../ui/Toggle.jsx'
import AgentPrompt, { AgentPromptOutput, buildAgentPrompt } from '../../agent/AgentPrompt.jsx'
import './AgentView.css'

export default function AgentView({ meta, items, agent, onClose }) {
  const [pretty, setPretty] = useLocalStorage('agent.pretty', true)
  const [fullText, setFullText] = useLocalStorage('agent.fullText', false)
  const truncated = !fullText
  const [copied, setCopied] = useState(false)
  const { body } = markdownSession(meta, items, truncated)
  const defaultPrompt = buildAgentPrompt(truncated)
  const combinedText = `${agent.prompt}\n\n---\n${body}`
  const onCopy = async () => {
    await navigator.clipboard.writeText(combinedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="agent-view">
      <div className="agent-view-actions">
        <Toggle checked={fullText} onChange={setFullText} label="full text" />
        <Toggle checked={pretty} onChange={setPretty} label="human-friendly" />
        {onClose && (
          <button type="button" className="agent-view-close" onClick={onClose} aria-label="Close" title="Close">
            ✕
          </button>
        )}
      </div>
      <div className="agent-view-left">
        <div className="agent-view-label">Session</div>
        <div className="agent-view-block">
          {pretty
            ? <div className="markdown"><ReactMarkdown rehypePlugins={[rehypeHighlight]}>{body}</ReactMarkdown></div>
            : <pre className="agent-view-raw">{body}</pre>}
        </div>
      </div>
      <div className="agent-view-right">
        <div className="agent-prompt-wrap">
          <div className="agent-view-label">Prompt</div>
          <AgentPrompt prompt={defaultPrompt} onPromptChange={agent.setPrompt} pretty={pretty} />
          <div className="agent-prompt-actions">
            <button type="button" className="button-primary" onClick={onCopy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="button-primary" onClick={() => agent.send(combinedText)} disabled={agent.running}>
              Send
            </button>
          </div>
        </div>
        <div className="agent-view-output-wrap">
          <div className="agent-view-label">AI Result</div>
          <AgentPromptOutput output={agent.output} pretty={pretty} running={agent.running} error={agent.error} />
        </div>
      </div>
    </div>
  )
}
