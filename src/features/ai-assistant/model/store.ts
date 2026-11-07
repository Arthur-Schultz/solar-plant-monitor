import { create } from 'zustand'
import { AssistantError, fetchHealth, streamAssistant, type AssistantHealth, type ChatMessage } from '../api/assistantApi'

interface AssistantState {
  open: boolean
  messages: ChatMessage[]
  streaming: boolean
  error: { message: string; code: string } | null
  health: AssistantHealth | null | 'checking'
  setOpen: (open: boolean) => void
  checkHealth: () => Promise<void>
  send: (text: string, snapshot: unknown, language: string) => Promise<void>
  stop: () => void
  reset: () => void
}

let controller: AbortController | null = null

export const useAssistantStore = create<AssistantState>((set, get) => ({
  open: false,
  messages: [],
  streaming: false,
  error: null,
  health: 'checking',

  setOpen(open) {
    set({ open })
    if (open) void get().checkHealth()
  },

  async checkHealth() {
    set({ health: 'checking' })
    set({ health: await fetchHealth() })
  },

  async send(text, snapshot, language) {
    const content = text.trim()
    if (!content || get().streaming) return
    const history: ChatMessage[] = [...get().messages, { role: 'user', content }]
    set({ messages: [...history, { role: 'assistant', content: '' }], streaming: true, error: null })

    controller = new AbortController()
    try {
      await streamAssistant(
        { messages: history, snapshot, language },
        (delta) => {
          const msgs = [...get().messages]
          const last = msgs[msgs.length - 1]
          msgs[msgs.length - 1] = { ...last, content: last.content + delta }
          set({ messages: msgs })
        },
        controller.signal,
      )
    } catch (e) {
      if (controller.signal.aborted) return
      const err = e instanceof AssistantError ? e : new AssistantError(e instanceof Error ? e.message : String(e))
      // Remove a bolha vazia da resposta que falhou
      const msgs = get().messages
      set({
        messages: msgs[msgs.length - 1]?.content ? msgs : msgs.slice(0, -1),
        error: { message: err.message, code: err.code },
      })
    } finally {
      set({ streaming: false })
      controller = null
    }
  },

  stop() {
    controller?.abort()
    set({ streaming: false })
  },

  reset() {
    controller?.abort()
    set({ messages: [], error: null, streaming: false })
  },
}))
