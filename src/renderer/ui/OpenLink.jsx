// The renderer has no navigation guard, so a link click goes to main: external in the browser,
// relative paths against basePath.
export default function OpenLink({ href, basePath = null, children, ...props }) {
  const onClick = e => { e.preventDefault(); e.stopPropagation(); void window.api.openLink(href, basePath) }
  return <a href={href} onClick={onClick} {...props}>{children}</a>
}
