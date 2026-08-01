import { useState } from 'react'
import { useLocalStorage } from '../../utils/useLocalStorage.js'
import { markdownSession } from '../MarkdownSession.js'
import Toggle from '../../ui/Toggle.jsx'
import Markdown from '../../ui/Markdown.jsx'
import PromptEditor from '../../agent/PromptEditor.jsx'
import AgentOutput from '../../agent/AgentOutput.jsx'
import './AgentView.css'

export default function AgentView({ meta, items, instructions, agent, onClose }) {
  const [pretty, setPretty] = useLocalStorage('agent.pretty', true)
  const [copied, setCopied] = useState(false)

  const { body } = markdownSession(meta, items, agent.truncated, instructions)
  const combinedText = `${agent.prompt}\n\n---\n${body}`

  const onCopy = async () => {
    await navigator.clipboard.writeText(combinedText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="agent-view">
      <div className="agent-view-actions">
        <Toggle checked={agent.truncated} onChange={agent.setTruncated} label="truncated" />
        <Toggle checked={pretty} onChange={setPretty} label="human-friendly" />
        {onClose && (
          <button type="button" className="agent-view-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <div className="agent-view-left">
        <div className="agent-view-label">Session</div>
        <div className="agent-view-block">
          {pretty
            ? <Markdown text={body} />
            : <pre className="agent-view-raw">{body}</pre>}
        </div>
      </div>
      <div className="agent-view-right">
        <div className="agent-prompt-wrap">
          <div className="agent-view-label">Prompt</div>
          <div className="agent-view-block">
            <PromptEditor source={agent.defaultPrompt} edited={agent.editedPrompt} setEdited={agent.setEditedPrompt} pretty={pretty} />
          </div>
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
          <AgentOutput output={agent.output} pretty={pretty} running={agent.running} error={agent.error} />
        </div>
      </div>
    </div>
  )
}
