import React, { useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { fenceBlocks, fenceTags, splitMarkdown } from '../utils/textBlock.js'
import LazyMount from './LazyMount.jsx'
import { useFindActive } from './useFindActive.js'
import './Markdown.css'

// The single markdown renderer: GFM + syntax highlighting, safe link handling, and chunked
// lazy mounting for huge texts. Every markdown surface should render through this component.

// Intercept link clicks (no navigation guard in the renderer) and let main open them:
// external in the browser, relative paths against basePath. Local links without a known
// basePath aren't resolvable, so render them as plain text.
const isExternal = href => /^(https?:|mailto:)/i.test(href || '')
function buildLinkComponents(basePath) {
  return {
    a: ({ href, children, ...props }) => {
      const clickable = href && (isExternal(href) || basePath)
      if (!clickable) return <>{children}</>
      const onClick = e => { e.preventDefault(); e.stopPropagation(); void window.api.openLink(href, basePath) }
      return <a href={href} onClick={onClick} {...props}>{children}</a>
    },
  }
}

// Memoized per chunk: when streaming output grows, earlier chunks keep their exact string,
// so only the tail chunk re-parses on each update.
const Chunk = React.memo(({ text, components }) => (
  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>{text}</ReactMarkdown>
))

// Long texts (dumps, pasted logs, whole-session bodies) render one chunk at a time, each
// lazy-mounted against the block's own scroll box (.markdown is max-height'd, and clipped
// chunks don't intersect), so only the scrolled-to part pays the markdown/highlight cost.
// Short texts — the common case — keep the plain single-render path with no wrapper divs.
// autoFence is for text that was never authored as markdown (raw transcript messages): bare
// JSON/tags get repaired into fenced code blocks first. Leave it off for genuine markdown.
export default function Markdown({ text, basePath = null, autoFence = false, className = '', ...rest }) {
  const ref        = useRef(null)
  const findOpen   = useFindActive()
  const components = useMemo(() => buildLinkComponents(basePath), [basePath])
  const chunks     = useMemo(() => splitMarkdown(autoFence ? fenceBlocks(fenceTags(text)) : text), [text, autoFence])
  const cls        = `markdown${className ? ' ' + className : ''}`
  if (chunks.length === 1) return (
    <div className={cls} {...rest}><Chunk text={chunks[0]} components={components} /></div>
  )
  return (
    <div className={cls} ref={ref} {...rest}>
      {chunks.map((c, i) => (
        <LazyMount key={i} eager={i === 0} forceMount={findOpen} rootRef={ref} placeholderMinHeight={500}>
          <Chunk text={c} components={components} />
        </LazyMount>
      ))}
    </div>
  )
}
