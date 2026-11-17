import { TOKEN_FIELDS } from '../../../shared/usage.js'

export { TOKEN_FIELDS }

export const emptyBucket = () => Object.fromEntries(TOKEN_FIELDS.map(k => [k, 0]))
export const isEmpty = bucket => TOKEN_FIELDS.every(k => !bucket[k])
export const tokenCount = b => b.input + b.output + b.cacheRead + b.cacheCreation

export function addUsage(target, delta) {
  for (const k of TOKEN_FIELDS) target[k] += delta[k]
}

export function usageOf(u) {
  const cc = u.cache_creation || {}
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheCreation: u.cache_creation_input_tokens || 0,
    cacheCreation5m: cc.ephemeral_5m_input_tokens || 0,
    cacheCreation1h: cc.ephemeral_1h_input_tokens || 0,
  }
}
