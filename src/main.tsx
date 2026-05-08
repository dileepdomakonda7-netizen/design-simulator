import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'
import './index.css'
import App from './App'
import { LandingPage } from './landing/LandingPage'
import { clearPersistedDemoDesigns } from './persistence/designStorage'

// One-time migration for users who landed before the auto-save subscriber
// learned to skip demo designs: drop any `design:demo-*` records and their
// index entries. Cheap (a few localStorage reads + writes); runs once per
// page load. After this fix lands, no new demo designs ever get persisted,
// so future calls find nothing to remove.
clearPersistedDemoDesigns()

const rootEl = document.getElementById('root')
if (rootEl === null) throw new Error('#root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<App />} />
        {/* Anything else → land users at the landing page. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
