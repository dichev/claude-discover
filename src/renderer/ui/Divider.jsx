import './Divider.css'

// Labeled horizontal rule (——— label ———); clickable when given onClick.
export default function Divider({ children, onClick, title, className = '' }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} className={`divider ${className}`} onClick={onClick} title={title}>
      {children}
    </Tag>
  )
}
