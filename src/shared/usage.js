// Token buckets: one reply's (or a session's) tokens by type, as the API's usage reports them
export const TOKEN_FIELDS = ['input', 'output', 'cacheRead', 'cacheCreation', 'cacheCreation5m', 'cacheCreation1h']

// The advisor tool's calls in a reply: a second model run server-side, logged only among the usage iterations
export const advisorIterations = u => (u.iterations ?? []).filter(i => i?.type === 'advisor_message')

// What one API call read: its fresh input plus the cached prefix, read or written. A reply that ran several calls
// (around an advisor consult) sums them in its top-level usage, so its context is its last executor call's.
export function contextSize(u) {
  const last = u.iterations?.findLast(i => i.type !== 'advisor_message') ?? u
  return (last.input_tokens || 0) + (last.cache_read_input_tokens || 0) + (last.cache_creation_input_tokens || 0)
}
