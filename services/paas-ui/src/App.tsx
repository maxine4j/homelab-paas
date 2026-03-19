import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { DashboardPage } from './pages/dashboard-page'
import { ServiceDirectoryPage } from './pages/service-directory-page'
import { ServiceOverviewPage } from './pages/service-overview-page'
import { ServiceLogsPage } from './pages/service-logs-page'
import { SettingsPage } from './pages/settings-page'
import { TopNav } from './components/navigation/TopNav'

export function App() {
  return (
    <BrowserRouter>
      <TopNav />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/services" element={<ServiceDirectoryPage />} />
        <Route path="/services/:serviceId" element={<ServiceOverviewPage />} />
        <Route path="/services/:serviceId/logs" element={<ServiceLogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  )
}