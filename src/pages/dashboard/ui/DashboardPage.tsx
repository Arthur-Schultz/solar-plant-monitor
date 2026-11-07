import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import type { InverterStatus } from '@/entities/telemetry'
import { FaultSimulatorPanel } from '@/features/fault-injection'
import { buildDiagnostics } from '@/features/plant-diagnostics'
import { computeKpis, useMonitoringStore } from '@/features/plant-monitoring'
import { AppHeader } from '@/widgets/app-header'
import { AssistantDrawer } from '@/widgets/ai-assistant'
import { DiagnosticsPanel } from '@/widgets/diagnostics-panel'
import { GenerationChart } from '@/widgets/generation-chart'
import { InverterPanel } from '@/widgets/inverter-panel'
import { KpiStrip } from '@/widgets/kpi-strip'
import { LossesChart } from '@/widgets/losses-chart'
import { PlantTwin } from '@/widgets/plant-twin'
import { StringHealthChart } from '@/widgets/string-health'
import { ThermalChart } from '@/widgets/thermal-chart'
import { WeeklyChart } from '@/widgets/weekly-chart'

/**
 * A página compõe: lê o estado da feature de monitoramento, deriva diagnósticos e KPIs
 * (memoizados) e distribui por props — os widgets não conhecem uns aos outros.
 */
export function DashboardPage() {
  const { t } = useTranslation()
  const { ready, expected, measured, events, now, rain } = useMonitoringStore()

  const analysis = useMemo(
    () => (ready ? buildDiagnostics({ plant: PLANT, expected, measured, events, now, rain }) : null),
    [ready, expected, measured, events, now, rain],
  )
  const kpis = useMemo(() => computeKpis(PLANT, expected, measured, now), [expected, measured, now])
  const inverterStatus = useMemo(() => {
    const last = measured.at(-1)
    return Object.fromEntries(
      PLANT.inverters.map((i) => [i.id, (last?.inverters[i.id]?.status ?? 'offline') as InverterStatus]),
    )
  }, [measured])

  return (
    <div className="app">
      <AppHeader now={now} />
      {!analysis ? (
        <div className="loading" role="status">
          <span className="spinner" aria-hidden />
          {t('app.loading')}
        </div>
      ) : (
        <main className="dashboard">
          <div className="area-twin">
            <PlantTwin
              strings={analysis.strings}
              inverterStatus={inverterStatus}
              expectedDayKwh={kpis.expectedFullDayKwh}
              now={now}
            />
          </div>
          <div className="area-kpis">
            <KpiStrip kpis={kpis} />
          </div>
          <div className="area-faults">
            <FaultSimulatorPanel />
          </div>
          <div className="area-curve">
            <GenerationChart expected={expected} measured={measured} now={now} timeZone={PLANT.timezone} />
          </div>
          <div className="area-inverters">
            <InverterPanel measured={measured} events={events} now={now} />
          </div>
          <div className="area-diag">
            <DiagnosticsPanel diagnostics={analysis.diagnostics} />
          </div>
          <div className="area-strings">
            <StringHealthChart strings={analysis.strings} />
          </div>
          <div className="area-week">
            <WeeklyChart daily={analysis.daily} />
          </div>
          <div className="area-losses">
            <LossesChart expected={expected} strings={analysis.strings} soiling={analysis.soiling} now={now} />
          </div>
          <div className="area-thermal">
            <ThermalChart expected={expected} now={now} />
          </div>
          <footer className="app-footer">{t('app.footer')}</footer>
        </main>
      )}
      {analysis && (
        <AssistantDrawer kpis={kpis} analysis={analysis} measured={measured} events={events} now={now} />
      )}
    </div>
  )
}
