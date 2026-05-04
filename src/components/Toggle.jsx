import React from 'react'
import './Toggle.css'

export default function Toggle({ checked, onChange, label, className = '' }) {
  return (
    <label className={`toggle ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <span className="toggle-label">{label}</span>}
    </label>
  )
}
