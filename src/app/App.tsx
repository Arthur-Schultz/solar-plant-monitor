import { useEffect } from 'react'
import { initMonitoring } from '@/features/plant-monitoring'
import { DashboardPage } from '@/pages/dashboard'
import './styles/global.css'

export function App() {
  useEffect(() => initMonitoring(), [])
  return <DashboardPage />
}
