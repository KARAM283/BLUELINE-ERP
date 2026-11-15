import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { extractIraqiPassport } from '../shared/passportProfiles'
import type { PassportDiagnostics } from '../shared/types'
import { authenticate, createApplicationUser, updateApplicationUser } from './auth'
import { initializeDatabase } from './database'
import { parseRequest, requestAttendance, startAttendanceServer } from './lanAttendance'
import { DOCUMENT_CHUNK_SIZE } from './lanDocuments'
import { LanGemini } from './lanGemini'

const openssl = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
  ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
let hasOpenSsl = false
try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); hasOpenSsl = true } catch { /* Optional integration-test tool. */ }

describe.skipIf(!hasOpenSsl)('server-mediated Gemini scanning', () => {
  it('isolates uploads, rechecks permissions, and keeps credentials and host paths private', async () => {
    const root = join(process.cwd(), `.lan-gemini-test-${randomUUID()}`)
    mkdirSync(join(root, 'lan-server'), { recursive: true })
    let db: Database.Database | undefined
    try {
      db = initializeDatabase(new Database(':memory:'))
      const database = db
      execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=gemini-test', '-keyout', join(root, 'lan-server', 'key.pem'), '-out', join(root, 'lan-server', 'cert.pem')], { stdio: 'ignore' })
      const user = createApplicationUser(db, { username: 'test.scanner', displayName: 'Scanner', role: 'visa', password: 'password123', permissions: ['Smart Scanner'] })
      const other = createApplicationUser(db, { username: 'test.other', displayName: 'Other', role: 'visa', password: 'password123', permissions: ['CRM'] })
      const data = Buffer.alloc(DOCUMENT_CHUNK_SIZE + 7, 0x61)
      const local = extractIraqiPassport([], null)
      const diagnostics: PassportDiagnostics = { model: 'gemini-test', stages: { apiConnection: 'success', imageProcessing: 'success', request: 'success', response: 'success', jsonParsing: 'success', validation: 'success' } }
      let release!: () => void
      let scanPath = ''
      let seen = false
      const service = new LanGemini(root, async () => true, async (path, mime, input) => {
        scanPath = path
        expect(mime).toBe('application/pdf')
        expect(readFileSync(path)).toEqual(data)
        expect(input).toEqual(local)
        seen = true
        await new Promise<void>((resolve) => { release = resolve })
        return { extraction: input, diagnostics }
      })
      const server = await startAttendanceServer(root, { mode: 'server', bindAddress: '127.0.0.1', port: 0 }, {
        authenticate: (name, password) => authenticate(database, name, password), attendance: () => null, gemini: service
      })
      try {
        const address = server.server.address()
        if (!address || typeof address === 'string') throw new Error('No server address.')
        const config = { mode: 'client' as const, host: '127.0.0.1', port: address.port, fingerprint: server.fingerprint.replace(/:/g, '') }
        const session = randomBytes(32).toString('hex')
        const otherSession = randomBytes(32).toString('hex')
        const call = (operation: string, args: unknown[] = [], username = user.username, activeSession = session) =>
          requestAttendance(config, parseRequest({ action: 'gemini', username, password: 'password123', args: [operation, args, activeSession] }))
        await expect(call('availability', [], other.username)).rejects.toThrow('permission')
        await expect(call('begin', ['..\\passport.pdf', 4])).rejects.toThrow()
        await expect(call('begin', ['passport.pdf', 26 * 1024 * 1024])).rejects.toThrow()
        expect(await call('availability')).toEqual({ configured: true })
        const token = await call('begin', ['passport.pdf', data.length]) as string
        await expect(call('chunk', [token, 0, 'YQ=='], user.username, otherSession)).rejects.toThrow('Scan expired')
        await call('chunk', [token, 0, data.subarray(0, DOCUMENT_CHUNK_SIZE).toString('base64')])
        await call('chunk', [token, DOCUMENT_CHUNK_SIZE, data.subarray(DOCUMENT_CHUNK_SIZE).toString('base64')])
        await expect(call('finish', [token, { ...local, password: 'not allowed' }])).rejects.toThrow()
        await call('finish', [token, local])
        expect(seen).toBe(true)
        expect(await call('status', [token])).toEqual({ state: 'processing' })
        await expect(call('begin', ['another.pdf', 1])).rejects.toThrow('already in progress')
        updateApplicationUser(db, 9999, { ...user, permissions: ['CRM'] })
        await expect(call('status', [token])).rejects.toThrow('permission')
        updateApplicationUser(db, 9999, { ...user, permissions: ['Smart Scanner'] })
        release()
        let response: { state: string; result?: unknown } = { state: 'processing' }
        for (let attempt = 0; attempt < 30 && response.state === 'processing'; attempt++) {
          response = await call('status', [token]) as typeof response
          if (response.state === 'processing') await new Promise((resolve) => setTimeout(resolve, 20))
        }
        expect(response).toEqual({ state: 'ready', result: { extraction: local, diagnostics } })
        expect(JSON.stringify(response)).not.toContain(root.replace(/\\/g, '\\\\'))
        expect(existsSync(scanPath)).toBe(false)
        await call('cancel', [token])
        await expect(call('status', [token])).rejects.toThrow('Scan expired')
      } finally {
        await new Promise<void>((resolve, reject) => server.server.close((error) => error ? reject(error) : resolve()))
      }
    } finally { db?.close(); rmSync(root, { recursive: true, force: true }) }
  }, 30000)
})
