import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { AppErrorBoundary, ErrorBanner } from './ui/Errors.jsx'
import Tip from './ui/Tip.jsx'
import { clearOutdatedLocalStorage } from './utils/useLocalStorage.js'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-200.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import 'highlight.js/styles/github-dark.css'
import 'react-tooltip/dist/react-tooltip.css'
import './styles.css'

clearOutdatedLocalStorage()

// data-tip-if-truncated: tip only while the text is cut off by its ellipsis
const fitsWhole = el => 'tipIfTruncated' in el.dataset && el.scrollWidth <= el.clientWidth

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <ErrorBanner />
    {/* Every data-tooltip-content in the app; React renders it as text, so untrusted transcript fields are safe in it */}
    <Tip anchorSelect="[data-tooltip-content]" disableTooltip={fitsWhole} className="tip-text" />
  </React.StrictMode>
)
