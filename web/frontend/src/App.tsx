import { Routes, Route } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import DashboardPage from './pages/DashboardPage'
import CreateDramaPage from './pages/CreateDramaPage'
import MyWorksPage from './pages/MyWorksPage'
import WorkDetailPage from './pages/WorkDetailPage'

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/create" element={<CreateDramaPage />} />
        <Route path="/works" element={<MyWorksPage />} />
        <Route path="/works/:sessionId" element={<WorkDetailPage />} />
      </Routes>
    </AppShell>
  )
}
