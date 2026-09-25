import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { HttpBackend } from './backend/httpBackend'
import { BackendProvider } from './backend/context'
import { PairingGate } from './components/PairingGate'
import { ToastProvider } from './components/Toast'
import { ThemeProvider } from './themes/ThemeProvider'
import './styles/base.css'
import './styles/app.css'

const backend = new HttpBackend()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BackendProvider backend={backend}>
      <ThemeProvider>
        <ToastProvider>
          <PairingGate>
            <App />
          </PairingGate>
        </ToastProvider>
      </ThemeProvider>
    </BackendProvider>
  </StrictMode>,
)
