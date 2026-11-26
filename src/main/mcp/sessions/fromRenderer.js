// How sessions read on screen, for the MCP tools to answer with what the app shows.
// The one file in src/main that imports from src/renderer (eslint keeps it so): these modules are pure, with no React or DOM
export { findable, filterSessions, sortSessions, groupRuns, runSummary, rowLabel, rowTags, projectLabel, modelsLabel, sessionBadges } from '../../../renderer/sessions/sessionRows.js'
export { flatten, groupTurns, turnCategory, isReply, FILTERS } from '../../../renderer/sessions/view/transcript.js'
export { renderTurns, sessionSummary } from '../../../renderer/sessions/MarkdownSession.js'
export { sessionEvents } from '../../../renderer/sessions/events/sessionEvents.js'
export { clip } from '../../../renderer/sessions/view/labels.js'
export { sumTotals, tokenMix, groupByProject, bucketTotals } from '../../../renderer/timeline/periodTotals.js'
export { CACHE_LABELS } from '../../../renderer/utils/cacheAdvice.js'
export { startOfPeriod, addPeriod } from '../../../renderer/utils/period.js'
export { fmtCompact, fmtUSD, fmtDuration, plural } from '../../../renderer/utils/formatting.js'
