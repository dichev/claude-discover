import { fmtCompact, fmtUSD, plural } from '../utils/formatting.js'
import { THRESHOLDS as T } from '../utils/thresholds.js'
import { cacheAdvice, CACHE_LABELS } from '../utils/cacheAdvice.js'
import { parseCommand, EXPERIMENT_TIP } from './view/labels.js'
import { subagentClusters, isJournal } from '../utils/subagents.js'

// What the session list shows, apart from how it draws it: which sessions, in what order, under which rows, and each row's
// label, tags and badges. Pure, as the MCP server lists sessions by it too (see src/main/mcp/sessions/fromRenderer.js).

const TIPS = {
  cache: {
    '5m': 'Its 1h cache writes, billed 2×, were mostly reused within 5 min',
    '1h': 'Its pauses outlived the 5m cache, so the context was rewritten',
  },
  context: `Consider keeping it below ${fmtCompact(T.context.warn)} tokens`,
  effort: 'Thinks longer and spends more output tokens than high',
  debug: 'Run with --debug',
}

const EFFORT_BADGE = { xhigh: 'warn-badge', max: 'danger-badge' }

// The first command, when nothing better names the session
const labelCommand = s => !(s.agentDescription || s.aiTitle || s.summary || s.firstUserPrompt) && parseCommand(s.firstUserCommand)

function sessionLabel(s) {
  const c = labelCommand(s)
  return c ? `${c.name || c.message} ${c.args}` : (s.agentDescription || s.aiTitle || s.summary || s.firstUserPrompt || s.sessionId || '')
}

// The filter box: the sessions holding `text` in what names them or where they ran. A subagent is held by its session's id too, so that id lists them with it.
// A path is found typed with either slash, so by its row's label too (`AI/claude-discover` of D:\AI\claude-discover)
export const findable = text => text.toLowerCase().replace(/\\/g, '/')
export function filterSessions(sessions, text) {
  const q = findable(text.trim())
  return q ? sessions.filter(s => findable([
    s.customTitle, s.agentName, s.agentDescription, s.tag, s.aiTitle, s.summary, s.firstUserPrompt, s.firstUserCommand,
    s.project, s.projectShort, s.subdir, s.worktree, s.tempPath, s.sessionId, s.parentSessionId, s.model, s.gitBranch,
  ].filter(Boolean).join(' ')).includes(q)) : sessions
}

// By 'time' they stay as scanned: latest activity first
export function sortSessions(sessions, sortBy) {
  if (sortBy === 'cost') return sessions.toSorted((a, b) => (b.cost || 0) - (a.cost || 0))
  if (sortBy === 'tokens') return sessions.toSorted((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
  if (sortBy === 'name') return sessions.toSorted((a, b) => sessionLabel(a).toLowerCase().localeCompare(sessionLabel(b).toLowerCase()))
  return sessions
}

// The list's rows: each session, then its subagents under a header per run they were spawned in, newest run first, each run in the list's order
export function groupRuns(sorted) {
  const runsOf = Map.groupBy(subagentClusters(sorted), run => run[0].parentFilePath)
  const rank   = new Map(sorted.map((s, i) => [s, i]))
  return sorted.flatMap(s => runsOf.has(s.parentFilePath) ? [] : [
    { session: s },
    ...(runsOf.get(s.filePath) ?? []).toReversed().flatMap(run => {
      const runKey = `${run[0].filePath}::run`
      return [{ run, runKey }, ...run.toSorted((a, b) => rank.get(a) - rank.get(b)).map(c => ({ session: c, runKey }))]
    }),
  ])
}

const sumOf = (sessions, key) => sessions.reduce((sum, s) => sum + (s[key] || 0), 0)

// A run's row reads as one session: its subagents' totals, and for each per-session badge the worst of them
export function runSummary(run) {
  const max    = key => Math.max(...run.map(c => c[key] || 0))
  const uniq   = key => [...new Set(run.flatMap(c => c[key] ?? []))]
  const any    = key => run.some(c => c[key])
  const caches = run.map(c => c.cacheCosts)
  return {
    lastActivityAt: max('lastActivityAt'), totalTokens: sumOf(run, 'totalTokens'), cost: sumOf(run, 'cost'),
    cacheCosts: caches.every(Boolean) ? Object.fromEntries(Object.keys(CACHE_LABELS).map(p => [p, sumOf(caches, p)])) : null,
    lastContextTokens: max('lastContextTokens'),
    models: uniq('models'), efforts: uniq('efforts'), speed: run.some(c => c.speed === 'fast') ? 'fast' : null,
    fastPricingUnknown: any('fastPricingUnknown'), priceUnknown: any('priceUnknown'), experiment: any('experiment'), debug: any('debug'),
    advisor: { calls: Math.max(...run.map(c => c.advisor?.calls ?? 0)) },
  }
}

// A session that opened with a command goes by its arguments, the command itself named in a tag
export function rowLabel(s) {
  const command = labelCommand(s)
  return command ? command.args.trim() || command.name || command.message : sessionLabel(s)
}

// The tags under a row's label, as { key, text, tip }; the fork's has no text, being an icon told by its tip
export function rowTags(s) {
  const command = labelCommand(s)
  const name    = s.customTitle && s.agentName && s.customTitle !== s.agentName ? `${s.customTitle} [${s.agentName}]` : s.customTitle || s.agentName
  return [
    isJournal(s) && { key: 'subagent-tag', text: `[journal: ${plural(s.workflowAgents, 'subagent')}]` },
    s.worktree && { key: 'worktree-tag', text: `[${s.worktree}]`, tip: `Worktree of ${s.projectShort}` },
    s.forkedFrom && { key: 'fork-tag', tip: `Forked from session ${s.forkedFrom.sessionId}` },
    name && { key: 'session-name', text: name },
    command && { key: 'session-command', text: command.name || command.message },
    s.tag && { key: 'session-tag', text: `#${s.tag}` },
  ].filter(Boolean)
}

export const projectLabel = s => s.project ? `${s.projectShort}${s.subdir ? ` › ${s.subdir}` : ''}` : ''

export const modelsLabel = s => s.models?.length ? `${s.models.map(m => m.replace(/^claude-/, '')).join(', ')}${s.efforts?.length ? ` ${s.efforts.join(', ')}` : ''}` : ''

// A row's badges, as { key, className, tip, text }: an icon each, but the cache's short text. On a run's row the per-session ones tell of its worst subagent.
// A tip's first line is the fact, any advice follows: the MCP listing flags a session by that line alone
export function sessionBadges(s, run = false) {
  const worst     = run ? 'Largest subagent: ' : ''
  const advice    = cacheAdvice(s)
  const topEffort = ['max', 'xhigh'].find(e => s.efforts?.includes(e))
  return [
    advice && { key: 'cache', className: 'warn-badge', text: advice.policy, tip: `−${advice.pct.toFixed(0)}% (${fmtUSD(advice.saving)}) ${CACHE_LABELS[advice.policy]}\n${TIPS.cache[advice.policy]}` },
    s.lastContextTokens > T.context.warn && { key: 'context', className: s.lastContextTokens > T.context.danger ? 'danger-badge' : 'warn-badge', tip: `${worst}Context size: ${fmtCompact(s.lastContextTokens)} tokens\n${TIPS.context}` },
    topEffort && { key: 'effort', className: EFFORT_BADGE[topEffort], tip: `Effort: ${topEffort}\n${TIPS.effort}` },
    s.speed === 'fast' && { key: 'fast', className: `fast-badge ${s.fastPricingUnknown ? 'fast-badge-unknown' : ''}`, tip: s.fastPricingUnknown ? 'Used fast mode — cost is INACCURATE: no fast-mode price multiplier known for this model' : 'Used fast mode (speed: fast)' },
    s.priceUnknown && { key: 'price', className: 'danger-badge', tip: `No price entry for ${s.models?.join(', ') || 'this model'} — cost is missing or understated` },
    s.advisor?.calls > 0 && { key: 'advisor', className: s.advisor.calls >= T.advisorCalls.danger ? 'danger-badge' : 'warn-badge', tip: `${worst}Consulted the advisor ${s.advisor.calls === 1 ? 'once' : `${s.advisor.calls} times`}` },
    s.experiment && { key: 'experiment', className: 'experiment-badge', tip: EXPERIMENT_TIP },
    s.debug && { key: 'debug', className: 'debug-badge', tip: TIPS.debug },
  ].filter(Boolean)
}
