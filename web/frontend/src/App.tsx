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
        <Route path="*" element={
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-4xl mb-4">404</p>
            <p className="mb-4">页面未找到</p>
            <a href="/" className="text-primary hover:underline">返回工作台</a>
          </div>
        } />
      </Routes>
    </AppShell>
  )
}
