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

// Sort project groups ({ key, root, rootShort, ... }) so worktrees sit right under their root project;
// roots order by combined stat. When only worktrees of a root are present, a label-only { header: true } row is inserted.
export function groupByRoot(groups, statOf = g => g.cost) {
  const rootStat = new Map()
  for (const g of groups) rootStat.set(g.root, (rootStat.get(g.root) || 0) + statOf(g))
  const sorted = [...groups].sort((a, b) => {
    if (a.root !== b.root) return (rootStat.get(b.root) - rootStat.get(a.root)) || a.root.localeCompare(b.root)
    if (a.key === a.root) return -1
    if (b.key === b.root) return 1
    return statOf(b) - statOf(a)
  })
  const out = []
  for (const g of sorted) {
    if (g.key !== g.root && out.at(-1)?.root !== g.root)
      out.push({ key: g.root, root: g.root, projectShort: g.rootShort, header: true })
    out.push(g)
  }
  return out
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
