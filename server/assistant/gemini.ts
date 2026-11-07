import type { ChatMessage } from './types.ts'

export interface GeminiOptions {
  apiKey: string
  model: string
  system: string
  messages: ChatMessage[]
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export class GeminiError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export function buildGeminiBody(system: string, messages: ChatMessage[]) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 1_500 },
  }
}

/** Extrai o texto de um evento SSE do Gemini (`data: {...}`). */
export function textFromChunk(json: unknown): string {
  const c = (json as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] })?.candidates?.[0]
  return (c?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
}

/**
 * Chama `streamGenerateContent` com `alt=sse` e devolve os pedaços de texto conforme chegam.
 * A chave vai no cabeçalho (nunca na URL, para não aparecer em logs).
 */
export async function* streamGemini({ apiKey, model, system, messages, signal, fetchImpl = fetch }: GeminiOptions): AsyncGenerator<string> {
  const res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(buildGeminiBody(system, messages)),
    signal,
  })

  if (!res.ok || !res.body) {
    let message = `Gemini respondeu ${res.status}`
    let code = 'upstream'
    try {
      const err = (await res.json()) as { error?: { message?: string; status?: string } }
      message = err.error?.message ?? message
      code = err.error?.status ?? code
    } catch {
      /* corpo não-JSON */
    }
    throw new GeminiError(message, res.status, code)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const text = textFromChunk(JSON.parse(payload))
        if (text) yield text
      } catch {
        /* linha parcial ou keep-alive */
      }
    }
  }
}
