import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { dispatchAttendance, parseLanConfig, parseRequest, requestAttendance, startAttendanceServer, testOfficeServerConnection } from './lanAttendance'
import type { AuthUser } from '../shared/types'

const user: AuthUser = { id: 7, username: 'test.user', displayName: 'Test', role: 'visa', permissions: ['My Attendance', 'DATA'] }
const request = (action: string, args: number[] = []) => parseRequest({ action, username: user.username, password: 'password', args })

describe('office attendance transport boundary', () => {
  it('rejects unknown actions, extra fields and invalid calendar arguments', () => {
    expect(() => request('documents:open')).toThrow()
    expect(() => parseRequest({ action: 'status', username: user.username, password: 'password', args: [], path: 'secret' })).toThrow()
    expect(() => request('calendar', [2026, 13])).toThrow()
    expect(() => request('status', [7])).toThrow()
  })

  const openssl = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
  let hasOpenSsl = false
  try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); hasOpenSsl = true } catch { /* Optional integration-test tool. */ }

  describe.skipIf(!hasOpenSsl)('pinned TLS attendance transport', () => {
    it('refuses a mismatched pin before credentials, and uses the server for authenticated calls', async () => {
      const root = join(process.cwd(), `.lan-test-${randomUUID()}`)
      const directory = join(root, 'lan-server')
      mkdirSync(directory, { recursive: true })
      try {
        execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
          '-subj', '/CN=attendance-test', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem')], { stdio: 'ignore' })
        const authenticate = vi.fn((name: string, password: string) => name === user.username && password === 'password' ? user : null)
        const { server, fingerprint } = await startAttendanceServer(root, { mode: 'server', bindAddress: '127.0.0.1', port: 0 }, {
          authenticate, attendance: (action, current) => ({ action, userId: current.id })
        })
        try {
          const address = server.address()
          if (!address || typeof address === 'string') throw new Error('No server address.')
          const config = { mode: 'client' as const, host: '127.0.0.1', port: address.port, fingerprint: '00'.repeat(32) }
          await expect(requestAttendance(config, request('login'))).rejects.toThrow('fingerprint')
          expect(authenticate).not.toHaveBeenCalled()
          config.fingerprint = fingerprint.replace(/:/g, '')
          await expect(testOfficeServerConnection(config)).resolves.toEqual({
            service: 'Blue Line Visa CRM', protocolVersion: 1
          })
          await expect(requestAttendance(config, request('status'))).resolves.toEqual({ action: 'status', userId: 7 })
          await expect(requestAttendance(config, { ...request('login'), password: 'wrong' })).rejects.toThrow('Username or password')
          expect(authenticate).toHaveBeenCalledTimes(2)
        } finally {
          await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        }
      } finally { rmSync(root, { recursive: true, force: true }) }
    }, 20000)
  })

  it('authenticates and checks current permission for every request', () => {
    const attendance = vi.fn(() => 'record')
    const authenticate = vi.fn((): AuthUser | null => user)
    const deps = { authenticate, attendance }
    expect(dispatchAttendance(parseRequest({ action: 'probe', args: [] }), deps)).toEqual({
      service: 'Blue Line Visa CRM', protocolVersion: 1
    })
    expect(authenticate).not.toHaveBeenCalled()
    expect(dispatchAttendance(request('status'), deps)).toBe('record')
    expect(attendance).toHaveBeenCalledWith('status', user, [])
    authenticate.mockReturnValueOnce(null)
    expect(() => dispatchAttendance(request('check-in'), deps)).toThrow('Username or password')
    authenticate.mockReturnValueOnce({ ...user, permissions: ['DATA'] })
    expect(() => dispatchAttendance(request('status'), deps)).toThrow('permission')
    expect(attendance).toHaveBeenCalledTimes(1)
  })

  it('exposes only the supported client module after login', () => {
    const result = dispatchAttendance(request('login'), { authenticate: () => user, attendance: vi.fn() })
    expect(result).toMatchObject({ id: 7, permissions: ['My Attendance'] })
  })

  it('requires an explicit host, port and pinned certificate for clients', () => {
    const fingerprint = 'AB:'.repeat(31) + 'AB'
    expect(parseLanConfig({ mode: 'client', host: 'office-pc', port: 47832, fingerprint })).toEqual({
      mode: 'client', host: 'office-pc', port: 47832, fingerprint: 'AB'.repeat(32)
    })
    expect(() => parseLanConfig({ mode: 'client', host: 'office-pc', port: 47832, fingerprint: '' })).toThrow()
    expect(() => parseLanConfig({ mode: 'server', bindAddress: '0.0.0.0', port: 47832 })).toThrow()
  })
})
