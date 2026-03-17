import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Dashboard } from './pages/dashboard'
import ServicesPage from './pages/services'
import { MainLayout } from './components/layout/main-layout'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout><Dashboard /></MainLayout>} />
        <Route path="/services" element={<MainLayout><ServicesPage /></MainLayout>} />
        <Route path="/monitoring" element={<MainLayout><div className="page-monitoring">
          <h1>Monitoring</h1>
        </div></MainLayout>} />
        <Route path="/settings" element={<MainLayout><div className="page-settings">
          <h1>Settings</h1>
        </div></MainLayout>} />
      </Routes>
    </BrowserRouter>
  )
}