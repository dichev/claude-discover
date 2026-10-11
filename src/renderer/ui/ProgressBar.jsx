// The .progress-bar pill (styles.css), filled to `pct` (0-100)
export default function ProgressBar({ pct, tone }) {
  return (
    <span className={`progress-bar${tone ? ` tone-${tone}` : ''}`}>
      <span className="progress-bar-fill" style={{ width: `${Math.max(0, Math.min(pct ?? 0, 100))}%` }} />
    </span>
  )
}
