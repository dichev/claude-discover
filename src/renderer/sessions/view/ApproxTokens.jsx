import { fmtCompact } from '../../utils/formatting.js'

export default function ApproxTokens({ tokens, tip = 'Approx. tokens' }) {
  return tokens > 0 && <span className="instruction-tokens" data-tooltip-content={tip}>~ {fmtCompact(tokens)}</span>
}
