import React from 'react'
import { createRoot } from 'react-dom/client'
import { delegate } from 'tippy.js'
import App from './App.jsx'
import { AppErrorBoundary, ErrorBanner } from './ui/Errors.jsx'
import { clearOutdatedLocalStorage } from './utils/useLocalStorage.js'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-200.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import 'highlight.js/styles/github-dark.css'
import 'tippy.js/dist/tippy.css'
import './styles.css'

clearOutdatedLocalStorage()

// Plain-text tooltips from title. allowHTML stays OFF: these carry
// untrusted transcript fields (session/model/type labels), so tippy must render them as text.
delegate('body', {
  target: '[title]',
  delay: [0, 0],
  onShow(instance) {
    moveTitleIntoTippy(instance.reference)
    return !!instance.props.content
  }
})

// React writes the title back whenever its value changes, even while the tooltip is open
new MutationObserver(records => {
  for (const { target } of records) {
    if (target._tippy) moveTitleIntoTippy(target)
  }
}).observe(document.body, { subtree: true, attributeFilter: ['title'] })

// Removing the title keeps the browser's own tooltip from showing beside tippy's
function moveTitleIntoTippy(el) {
  if (!el.hasAttribute('title')) return
  el._tippy.setContent(el.title)
  el.removeAttribute('title')
}

// HTML tooltips, opt-in via data-tippy-html. Only ever set from trusted, numeric content
// (the token-usage breakdown, plan limits) — never from transcript data. Keep it that way.
delegate('body', {
  target: '[data-tippy-html]',
  delay: [0, 0],
  allowHTML: true,
  appendTo: () => document.body, // explicit, or a data-tippy-interactive one lands in the reference's parent and picks up its styles
  content: reference => reference.getAttribute('data-tippy-html'),
  onShow(instance) {
    instance.setContent(instance.reference.getAttribute('data-tippy-html'))
  }
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <ErrorBanner />
  </React.StrictMode>
)
