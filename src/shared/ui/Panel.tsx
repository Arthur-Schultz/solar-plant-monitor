import type { ReactNode } from 'react'

interface PanelProps {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Panel({ title, subtitle, actions, children, className = '', bodyClassName = '' }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel__head">
        <div>
          <h2 className="panel__title">{title}</h2>
          {subtitle && <p className="panel__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="panel__actions">{actions}</div>}
      </header>
      <div className={`panel__body ${bodyClassName}`}>{children}</div>
    </section>
  )
}
