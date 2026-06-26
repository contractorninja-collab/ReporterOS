function SectionHeader({ title, children }) {
  return (
    <div className="section-header">
      <div className="section-header__title">{title}</div>
      {children ? <div className="section-header__actions">{children}</div> : null}
    </div>
  )
}

export default SectionHeader
