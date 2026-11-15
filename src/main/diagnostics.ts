import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const maxLogSize = 2 * 1024 * 1024

function redact(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\b(?:\+?\d[\d\s().-]{5,}\d)\b/g, '[redacted number]')
    .replace(/\b(?=[A-Z0-9]{6,}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, '[redacted identifier]')
}

export function recordDiagnostic(
  event: string,
  error?: unknown,
  includeMessage = false,
  rendererDetails?: { errorName?: string; stack?: string }
): void {
  try {
    const directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })

    const date = new Date()
    const day = date.toISOString().slice(0, 10)
    const file = join(directory, `application-${day}.log`)
    if (existsSync(file) && statSync(file).size >= maxLogSize) {
      const base = `application-${day}-${date.getTime()}`
      let suffix = 0
      let rotated = join(directory, `${base}.log`)
      while (existsSync(rotated)) rotated = join(directory, `${base}-${++suffix}.log`)
      renameSync(file, rotated)
    }

    const details: Record<string, string> = {}
    if (rendererDetails) {
      if (rendererDetails.errorName) details.errorName = redact(rendererDetails.errorName).slice(0, 120)
      if (rendererDetails.stack) details.stack = redact(rendererDetails.stack).slice(0, 8000)
    } else if (error instanceof Error) {
      details.errorName = error.name
      if (includeMessage) details.message = redact(error.message).slice(0, 2000)
      const frames = error.stack?.split('\n').slice(1).join('\n')
      if (frames) details.stack = redact(frames).slice(0, 8000)
    } else if (error !== undefined) {
      details.errorType = typeof error
    }

    appendFileSync(file, `${JSON.stringify({
      timestamp: date.toISOString(),
      event,
      ...details
    })}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {
    console.error('Unable to write application diagnostics to the user data logs folder.')
  }
}
