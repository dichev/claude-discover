// Group subagents under their parent (orphans, whose parent is outside the period, are dropped). Map<parentId, child[]>.
export function subagentsByParent(sessions) {
  const ids = new Set(sessions.map(s => s.sessionId))
  const byParent = new Map()
  for (const s of sessions) {
    if (!ids.has(s.parentSessionId)) continue
    let arr = byParent.get(s.parentSessionId)
    if (!arr) byParent.set(s.parentSessionId, arr = [])
    arr.push(s)
  }
  return byParent
}

// Split each parent's subagents into time-separated runs (a pause > gap ms = the user worked in between).
export function subagentClusters(sessions, gap) {
  return [...subagentsByParent(sessions).values()].flatMap(subs =>
    subs.sort((a, b) => a.startedAt - b.startedAt).reduce((runs, s, i, arr) => {
      if (i && s.startedAt - arr[i - 1].lastActivityAt <= gap) runs.at(-1).push(s)
      else runs.push([s])
      return runs
    }, []))
}
