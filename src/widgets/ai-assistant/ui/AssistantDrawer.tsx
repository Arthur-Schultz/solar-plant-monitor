import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import type { InverterEvent, TelemetrySample } from '@/entities/telemetry'
import { useWeatherStore } from '@/entities/weather'
import { useAssistantStore } from '@/features/ai-assistant'
import type { buildDiagnostics } from '@/features/plant-diagnostics'
import { useMonitoringStore, type PlantKpis } from '@/features/plant-monitoring'
import { useFormat } from '@/shared/lib/format/useFormat'
import { Markdown } from '@/shared/ui'
import { buildAssistantSnapshot } from '../lib/snapshot'

interface Props {
  kpis: PlantKpis
  analysis: ReturnType<typeof buildDiagnostics>
  measured: TelemetrySample[]
  events: InverterEvent[]
  now: number
}

/** Assistente técnico (Gemini) com o retrato do painel anexado a cada pergunta. */
export function AssistantDrawer({ kpis, analysis, measured, events, now }: Props) {
  const { t, i18n } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const { open, setOpen, messages, streaming, error, health, send, stop, reset, checkHealth } = useAssistantStore()
  const tiltDeg = useMonitoringStore((s) => s.tiltDeg)
  const rain = useMonitoringStore((s) => s.rain)
  const weatherSource = useWeatherStore((s) => s.source)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  const worst = analysis.diagnostics.find((d) => d.target && (d.severity === 'critical' || d.severity === 'warning'))
  const suggestions = [
    t('ai.suggestions.main'),
    worst?.target ? t('ai.suggestions.target', { target: worst.target }) : t('ai.suggestions.improve'),
    t('ai.suggestions.cleaning'),
    t('ai.suggestions.pr'),
  ]

  const ask = (text: string) => {
    const snapshot = buildAssistantSnapshot({ plant: PLANT, kpis, analysis, measured, events, rain, tiltDeg, weatherSource, now, t, fmt })
    void send(text, snapshot, i18n.language)
    setDraft('')
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    ask(draft)
  }

  const ready = health !== 'checking' && health?.configured
  const issueCount = analysis.diagnostics.filter((d) => d.severity === 'critical' || d.severity === 'warning').length

  return (
    <>
      <button type="button" className={`ai-fab ${open ? 'is-open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden className="ai-fab__icon">✦</span>
        {t('ai.open')}
        {issueCount > 0 && !open && <span className="ai-fab__badge">{issueCount}</span>}
      </button>

      <aside className={`ai-drawer ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label={t('ai.title')}>
        <header className="ai-drawer__head">
          <div>
            <strong>{t('ai.title')}</strong>
            <p>{health && health !== 'checking' ? t('ai.poweredBy', { model: health.model }) : t('ai.subtitle')}</p>
          </div>
          <div className="ai-drawer__actions">
            {messages.length > 0 && (
              <button type="button" className="btn" onClick={reset}>{t('ai.new')}</button>
            )}
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label={t('ai.close')}>✕</button>
          </div>
        </header>

        <div className="ai-messages" ref={listRef} aria-live="polite">
          {health === 'checking' && <p className="muted small">{t('ai.checking')}</p>}

          {health === null && (
            <div className="ai-setup">
              <strong>{t('ai.noBackendTitle')}</strong>
              <p>{t('ai.noBackend')}</p>
            </div>
          )}

          {health && health !== 'checking' && !health.configured && (
            <div className="ai-setup">
              <strong>{t('ai.setupTitle')}</strong>
              <ol>
                <li>{t('ai.setup1')} <code>aistudio.google.com/apikey</code></li>
                <li>{t('ai.setup2')} <code>.env.local</code>: <code>GEMINI_API_KEY=sua_chave</code></li>
                <li>{t('ai.setup3')} <code>npm run dev</code></li>
              </ol>
              <button type="button" className="btn" onClick={() => void checkHealth()}>{t('ai.retry')}</button>
            </div>
          )}

          {ready && messages.length === 0 && (
            <div className="ai-empty">
              <p>{t('ai.intro')}</p>
              <div className="ai-chips">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="ai-chip" onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ai-msg--${m.role}`}>
              {m.role === 'assistant' ? (
                m.content ? <Markdown text={m.content} /> : <span className="ai-typing" aria-label={t('ai.thinking')}><i /><i /><i /></span>
              ) : (
                <p>{m.content}</p>
              )}
            </div>
          ))}

          {error && (
            <div className="ai-error" role="alert">
              {error.message}
            </div>
          )}
        </div>

        <form className="ai-input" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            maxLength={2000}
            placeholder={t('ai.placeholder')}
            disabled={!ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!streaming) ask(draft)
              }
            }}
          />
          {streaming ? (
            <button type="button" className="btn" onClick={stop}>{t('ai.stop')}</button>
          ) : (
            <button type="submit" className="btn btn--primary" disabled={!ready || !draft.trim()}>{t('ai.send')}</button>
          )}
        </form>
        <p className="ai-disclaimer">{t('ai.disclaimer')}</p>
      </aside>
    </>
  )
}
