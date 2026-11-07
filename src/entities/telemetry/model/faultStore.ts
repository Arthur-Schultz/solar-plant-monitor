import { create } from 'zustand'
import { DEMO_FAULTS, faultDefinition, type FaultInjection, type FaultKind } from './faults'

interface FaultState {
  faults: FaultInjection[]
  /** Liga uma falha com os valores padrão do catálogo (ou desliga, se já estiver ativa) */
  toggle: (kind: FaultKind) => void
  update: (id: string, patch: Partial<Omit<FaultInjection, 'id' | 'kind'>>) => void
  remove: (id: string) => void
  loadDemo: () => void
  clear: () => void
}

let seq = 0

/** Cenário de simulação ativo — estado de entidade, observado pelo pipeline de monitoramento. */
export const useFaultStore = create<FaultState>((set, get) => ({
  faults: DEMO_FAULTS,

  toggle(kind) {
    const existing = get().faults.find((f) => f.kind === kind)
    if (existing) {
      set({ faults: get().faults.filter((f) => f.id !== existing.id) })
      return
    }
    const def = faultDefinition(kind)
    const fault: FaultInjection = {
      id: `${kind}-${++seq}`,
      kind,
      target: def.target === 'plant' ? null : (def.defaultTarget ?? null),
      severity: def.defaultSeverity,
      sinceDaysAgo: kind === 'soiling-uniform' || kind === 'pid' || kind === 'aging' ? 7 : kind === 'heavy-rain' ? 1 : 0,
    }
    set({ faults: [...get().faults, fault] })
  },

  update(id, patch) {
    set({ faults: get().faults.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  },

  remove(id) {
    set({ faults: get().faults.filter((f) => f.id !== id) })
  },

  loadDemo: () => set({ faults: DEMO_FAULTS }),
  clear: () => set({ faults: [] }),
}))
