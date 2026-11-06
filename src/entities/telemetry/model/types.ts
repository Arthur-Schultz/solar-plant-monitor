export type InverterStatus = 'producing' | 'standby' | 'fault' | 'offline'

export interface StringReading {
  dcW: number
  voltageV: number
  currentA: number
}

export interface InverterReading {
  status: InverterStatus
  acW: number
  dcW: number
  /** Temperatura interna do inversor (°C) */
  heatsinkC: number
}

/** Leitura da usina num instante — o mesmo formato viria de Modbus, nuvem do fabricante ou CSV. */
export interface TelemetrySample {
  t: number
  strings: Record<string, StringReading>
  inverters: Record<string, InverterReading>
}

export interface InverterEvent {
  t: number
  inverterId: string
  code: string
  severity: 'info' | 'warning' | 'critical'
  /** Chave i18n da descrição */
  messageKey: string
  durationMin?: number
}

/**
 * Contrato da fonte de telemetria. A UI e os diagnósticos dependem só disto, então trocar
 * o simulador por um coletor Modbus TCP/RTU ou pela API de nuvem do fabricante não muda
 * nenhuma tela (Dependency Inversion).
 */
export interface TelemetrySource {
  readonly kind: 'simulated' | 'modbus-tcp' | 'vendor-cloud' | 'csv'
  getSeries(from: number, to: number): Promise<TelemetrySample[]>
  getEvents(from: number, to: number): Promise<InverterEvent[]>
}
