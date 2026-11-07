import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { GeminiError, streamGemini } from './gemini.ts'
import { buildSystemPrompt, validateRequest } from './prompt.ts'
import type { StreamEvent } from './types.ts'

interface Options {
  apiKey?: string
  model: string
}

function readBody(req: IncomingMessage, limit = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString('utf8')
      if (data.length > limit) {
        reject(new Error('Requisição grande demais'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function friendlyError(e: unknown): { error: string; code: string } {
  if (e instanceof GeminiError) {
    if (e.status === 400 && /API key/i.test(e.message)) return { error: 'Chave do Gemini inválida. Confira GEMINI_API_KEY no .env.local.', code: 'bad_key' }
    if (e.status === 403) return { error: 'A chave do Gemini não tem permissão para este modelo.', code: 'forbidden' }
    if (e.status === 404) return { error: 'Modelo do Gemini não encontrado. Ajuste GEMINI_MODEL no .env.local.', code: 'model' }
    if (e.status === 429) return { error: 'Limite de uso do plano gratuito atingido. Espere um minuto e tente de novo.', code: 'rate_limit' }
    return { error: e.message, code: e.code }
  }
  return { error: e instanceof Error ? e.message : 'Erro desconhecido', code: 'internal' }
}

/**
 * Backend mínimo do assistente, embutido no servidor do Vite (dev e preview).
 * A chave da API fica só no processo Node — o navegador nunca a vê.
 *
 *   GET  /api/assistant/health  → { configured, model }
 *   POST /api/assistant         → text/event-stream com { delta } | { done } | { error }
 */
export function assistantApi({ apiKey, model }: Options): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/assistant')) return next()

    if (req.method === 'GET' && url.startsWith('/api/assistant/health')) {
      return json(res, 200, { configured: Boolean(apiKey), model })
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido' })
    if (!apiKey) {
      return json(res, 503, { error: 'Assistente não configurado: defina GEMINI_API_KEY no arquivo .env.local e reinicie o servidor.', code: 'not_configured' })
    }

    let request
    try {
      request = validateRequest(JSON.parse(await readBody(req)))
    } catch (e) {
      return json(res, 400, friendlyError(e))
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    const send = (event: StreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`)

    const controller = new AbortController()
    res.on('close', () => controller.abort())

    try {
      const stream = streamGemini({
        apiKey,
        model,
        system: buildSystemPrompt(request.snapshot, request.language),
        messages: request.messages,
        signal: controller.signal,
      })
      for await (const delta of stream) send({ delta })
      send({ done: true })
    } catch (e) {
      if (!controller.signal.aborted) send(friendlyError(e))
    } finally {
      res.end()
    }
  }

  return {
    name: 'solar-assistant-api',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
