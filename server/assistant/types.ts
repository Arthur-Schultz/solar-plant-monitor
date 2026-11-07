export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantRequest {
  messages: ChatMessage[]
  /** Resumo do painel no momento da pergunta (gerado no navegador) */
  snapshot: unknown
  language: 'pt-BR' | 'en-US'
}

export type StreamEvent = { delta: string } | { done: true } | { error: string; code?: string }
