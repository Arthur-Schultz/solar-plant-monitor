type Level = 'ok' | 'info' | 'warning' | 'critical' | 'idle'

const ICON: Record<Level, string> = {
  ok: '✓',
  info: 'i',
  warning: '!',
  critical: '✕',
  idle: '–',
}

/** Status nunca só por cor: sempre ícone + rótulo (acessibilidade e daltonismo). */
export function StatusBadge({ level, label }: { level: Level; label: string }) {
  return (
    <span className={`badge badge--${level}`}>
      <span className="badge__icon" aria-hidden>
        {ICON[level]}
      </span>
      {label}
    </span>
  )
}
