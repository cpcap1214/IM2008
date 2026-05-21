import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.tsx'
import { PreferencesProvider } from './hooks/usePreferences'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider>
      <App />
      <Toaster richColors position="top-right" />
    </PreferencesProvider>
  </StrictMode>,
)
