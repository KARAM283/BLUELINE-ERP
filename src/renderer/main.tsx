import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

function reportRendererError(
  type: 'window-error' | 'unhandled-rejection' | 'react-uncaught-error',
  error?: unknown
): void {
  const diagnostic = error instanceof Error
    ? { type, errorName: error.name, stack: error.stack?.split('\n').slice(1).join('\n') }
    : { type }
  window.blueLine.reportRendererError(diagnostic)
}

window.addEventListener('error', (event) => {
  reportRendererError('window-error', event.error)
})
window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('unhandled-rejection', event.reason)
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('The renderer root element is missing.')

createRoot(rootElement, {
  onUncaughtError: (error) => reportRendererError('react-uncaught-error', error)
}).render(<React.StrictMode><App /></React.StrictMode>)
