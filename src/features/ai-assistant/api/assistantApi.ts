import { http } from '@/shared/api/http'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantHealth {
  configured: boolean
  model: string
}

type StreamEvent = { delta: string } | { done: true } | { error: string; code?: string }

export class AssistantError extends Error {
  code: string
  constructor(message: string, code = 'unknown') {
    super(message)
    this.code = code
  }
}

export async function fetchHealth(): Promise<AssistantHealth | null> {
  try {
    const { data } = await http.get<AssistantHealth>('/api/assistant/health', { timeout: 4_000 })
    return typeof data?.configured === 'boolean' ? data : null
  } catch {
    return null // sem backend (ex.: build estático publicado)
  }
}

/**
 * Envia a conversa e lê a resposta em streaming (Server-Sent Events via fetch).
 * Axios não expõe o corpo como stream no navegador, por isso aqui usamos fetch.
 */
export async function streamAssistant(
  body: { messages: ChatMessage[]; snapshot: unknown; language: string },
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok || !res.body) {
    let err: { error?: string; code?: string } = {}
    try {
      err = await res.json()
    } catch {
      /* sem corpo */
    }
    throw new AssistantError(err.error ?? `Erro ${res.status}`, err.code ?? (res.status === 404 ? 'no_backend' : 'http'))
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 2)
      if (!raw.startsWith('data:')) continue
      const event = JSON.parse(raw.slice(5)) as StreamEvent
      if ('delta' in event) onDelta(event.delta)
      else if ('error' in event) throw new AssistantError(event.error, event.code)
    }
  }
}
