import { useState } from 'react'
import './ShortText.css'

// Long strings (system prompt, tool schemas) render shortened — click a string to toggle the full text.
const SHORTEN_AT = 500

// Prose reads better as a word count; spaceless blobs (base64, minified JSON) fall back to chars.
const moreLabel = hidden => /\s/.test(hidden)
  ? `${hidden.split(/\s+/).filter(Boolean).length.toLocaleString()} more words`
  : `${hidden.length.toLocaleString()} more chars`

// JsonView's own shortenTextAfterLength is buggy: each string keeps its shortened/expanded state
// per tree position and only re-syncs when the length prop changes, so a long string replacing a
// short one at the same spot (switching request/tab) can render unshortened — or a short one with
// a bogus "(0 more chars)". Here the decision derives from the text itself and resets with it.
function ShortText({ text, ...rest }) {
  const [expandedText, setExpandedText] = useState(null) // the string the user expanded — auto-collapses when another string reuses this tree position
  const expanded = expandedText === text
  return (
    <span {...rest} style={{ cursor: 'pointer' }} onClick={() => setExpandedText(expanded ? null : text)}>
      "{expanded ? text : `${text.slice(0, SHORTEN_AT)}...`}"
      {!expanded && <span className="shorten-more"> ({moreLabel(text.slice(SHORTEN_AT))})</span>}
    </span>
  )
}

// JsonView.String render — use with shortenTextAfterLength={0} (the library's shortening stays off);
// returning undefined falls through to the default string rendering.
export const renderShortened = shorten => ({ children, ...rest }, { type, value }) =>
  shorten && type === 'value' && typeof value === 'string' && value.length > SHORTEN_AT
    ? <ShortText {...rest} text={value} />
    : undefined
