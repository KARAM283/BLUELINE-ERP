import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { join } from 'node:path'
import { connect, createServer, type Server } from 'node:tls'
import type { AuthUser } from '../shared/types'
import type { LanDocuments } from './lanDocuments'
import type { LanCrm } from './lanCrm'
import type { LanHr } from './lanHr'
import type { LanWorkspace } from './lanWorkspace'
import type { LanGemini } from './lanGemini'

export type LanConfig =
  | { mode: 'local' }
  | { mode: 'server'; bindAddress: string; port: number }
  | { mode: 'client'; host: string; port: number; fingerprint: string }

type AttendanceAction = 'status' | 'check-in' | 'check-out' | 'calendar'
type DocumentAction = 'documents-list' | 'document-begin' | 'document-chunk' | 'document-cancel' | 'document-finish' | 'document-download'
type Action = 'probe' | 'login' | 'crm' | 'hr' | 'workspace' | 'gemini' | AttendanceAction | DocumentAction
type Request = { action: 'probe'; args: [] }
  | { action: Exclude<Action, 'probe'>; username: string; password: string; args: unknown[] }
type Dependencies = {
  authenticate: (username: string, password: string) => AuthUser | null
  attendance: (action: AttendanceAction, user: AuthUser, args: number[]) => unknown
  documents?: Pick<LanDocuments, 'list' | 'begin' | 'chunk' | 'cancel' | 'finish' | 'download'>
  crm?: Pick<LanCrm, 'execute'>
  hr?: Pick<LanHr, 'execute'>
  workspace?: Pick<LanWorkspace, 'execute'>
  gemini?: Pick<LanGemini, 'execute'>
}
const MAX_REQUEST = 720 * 1024
const MAX_RESPONSE = 4 * 1024 * 1024
const documentActions = new Set(['documents-list', 'document-begin', 'document-chunk', 'document-cancel', 'document-finish', 'document-download'])
const actions = new Set(['probe', 'login', 'crm', 'hr', 'workspace', 'gemini', 'status', 'check-in', 'check-out', 'calendar', ...documentActions])

export function getLanIPv4Addresses(): string[] {
  const addresses = Object.values(networkInterfaces()).flat()
    .filter((item) => item && !item.internal && isIP(item.address) === 4 && !item.address.startsWith('169.254.'))
    .map((item) => item!.address)
  return [...new Set(addresses)].sort()
}

export function parseLanConfig(value: unknown): LanConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid LAN configuration.')
  const config = value as Record<string, unknown>
  if (config.mode === 'local') return { mode: 'local' }
  if (!Number.isSafeInteger(config.port) || Number(config.port) < 1024 || Number(config.port) > 65535) throw new Error('LAN port must be between 1024 and 65535.')
  const port = Number(config.port)
  if (config.mode === 'server') {
    if (typeof config.bindAddress !== 'string' || isIP(config.bindAddress) !== 4
      || config.bindAddress.startsWith('127.') || config.bindAddress === '0.0.0.0') throw new Error('Choose a specific LAN IPv4 address for the server.')
    const addresses = getLanIPv4Addresses()
    if (!addresses.includes(config.bindAddress)) throw new Error('The server bind address is not assigned to this computer.')
    return { mode: 'server', bindAddress: config.bindAddress, port }
  }
  if (config.mode === 'client') {
    if (typeof config.host !== 'string' || !/^[a-zA-Z0-9.-]{1,253}$/.test(config.host)
      || typeof config.fingerprint !== 'string' || !/^[a-fA-F0-9]{64}$/.test(config.fingerprint.replace(/:/g, ''))) {
      throw new Error('Invalid server address or SHA-256 certificate fingerprint.')
    }
    return { mode: 'client', host: config.host, port, fingerprint: config.fingerprint.replace(/:/g, '').toUpperCase() }
  }
  throw new Error('Unknown LAN workspace mode.')
}

export function readLanConfig(root: string): LanConfig {
  const file = join(root, 'lan-workspace.json')
  try { return parseLanConfig(JSON.parse(readFileSync(file, 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { mode: 'local' }
    throw new Error(`Cannot load LAN workspace configuration: ${error instanceof Error ? error.message : 'invalid configuration'}`)
  }
}

export function parseRequest(value: unknown): Request {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request.')
  const v = value as Record<string, unknown>
  if (v.action === 'probe') {
    if (Object.keys(v).some((key) => !['action', 'args'].includes(key)) || !Array.isArray(v.args) || v.args.length !== 0) {
      throw new Error('Invalid request.')
    }
    return { action: 'probe', args: [] }
  }
  if (Object.keys(v).some((key) => !['action', 'username', 'password', 'args'].includes(key))
    || typeof v.action !== 'string' || !actions.has(v.action)
    || typeof v.username !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/.test(v.username)
    || typeof v.password !== 'string' || v.password.length < 1 || v.password.length > 256
    || !Array.isArray(v.args)) throw new Error('Invalid request.')
  if (v.action === 'crm' || v.action === 'hr' || v.action === 'workspace' || v.action === 'gemini') {
    if (v.args.length !== 3 || typeof v.args[0] !== 'string' || v.args[0].length > 64
      || !Array.isArray(v.args[1]) || typeof v.args[2] !== 'string' || !/^[a-f0-9]{64}$/.test(v.args[2])) throw new Error('Invalid request.')
  } else if (v.action === 'calendar') {
    if (v.args.length !== 2 || !Number.isSafeInteger(v.args[0]) || v.args[0] < 1900 || v.args[0] > 9999
      || !Number.isSafeInteger(v.args[1]) || v.args[1] < 1 || v.args[1] > 12) throw new Error('Invalid calendar.')
  } else if (v.action === 'document-begin') {
    if (v.args.length !== 3 || typeof v.args[0] !== 'string' || typeof v.args[1] !== 'string' || typeof v.args[2] !== 'number') throw new Error('Invalid request.')
  } else if (v.action === 'document-chunk') {
    if (v.args.length !== 3 || typeof v.args[0] !== 'string' || typeof v.args[1] !== 'number' || typeof v.args[2] !== 'string') throw new Error('Invalid request.')
  } else if (v.action === 'document-cancel' || v.action === 'document-finish') {
    if (v.args.length !== 1 || typeof v.args[0] !== 'string') throw new Error('Invalid request.')
  } else if (v.action === 'document-download') {
    if (v.args.length !== 3 || typeof v.args[0] !== 'string' || typeof v.args[1] !== 'number' || typeof v.args[2] !== 'number') throw new Error('Invalid request.')
  } else if (v.args.length !== 0) throw new Error('Invalid request.')
  return v as Request
}

export function dispatchAttendance(request: Request, deps: Dependencies): unknown {
  if (request.action === 'probe') return { service: 'Blue Line Visa CRM', protocolVersion: 1 }
  const user = deps.authenticate(request.username, request.password)
  if (!user) throw new Error('Username or password is incorrect.')
  if (request.action === 'login') return { ...user, permissions: user.permissions.filter((permission) =>
    permission === 'My Attendance' || (deps.documents && permission === 'Documents')
    || (deps.crm && ['CRM', 'Customers', 'DATA', 'Visa Pipeline', 'Visa Types', 'Countries', 'Settings'].includes(permission))
    || (deps.hr && permission === 'Human Resources')
    || (deps.workspace && ['Dashboard', 'Reports', 'Smart Scanner'].includes(permission))) }
  if (request.action === 'crm' || request.action === 'hr' || request.action === 'workspace' || request.action === 'gemini') {
    const handler = request.action === 'crm' ? deps.crm : request.action === 'hr' ? deps.hr : request.action === 'gemini' ? deps.gemini : deps.workspace
    if (!handler) throw new Error('This workspace action is unavailable.')
    return handler.execute(user, request.args[2] as string, request.args[0] as string, request.args[1] as unknown[])
  }

  if (documentActions.has(request.action)) {
    if (!user.permissions.includes('Documents') || !deps.documents) throw new Error('You do not have permission to access Documents.')
    const [a, b, c] = request.args
    switch (request.action) {
      case 'documents-list': return deps.documents.list()
      case 'document-begin': return deps.documents.begin(user, a as string, b as string, c as number)
      case 'document-chunk': return deps.documents.chunk(user, a as string, b as number, c as string)
      case 'document-cancel': return deps.documents.cancel(user, a as string)
      case 'document-finish': return deps.documents.finish(user, a as string)
      case 'document-download': return deps.documents.download(a as string, b as number, c as number)
      default: throw new Error('Invalid request.')
    }
  }
  if (!user.permissions.includes('My Attendance')) throw new Error('You do not have permission to access My Attendance.')
  return deps.attendance(request.action as AttendanceAction, user, request.args as number[])
}

export async function testOfficeServerConnection(config: Extract<LanConfig, { mode: 'client' }>): Promise<{ service: string; protocolVersion: number }> {
  const result = await requestAttendance(config, { action: 'probe', args: [] }) as Partial<{ service: string; protocolVersion: number }>
  if (result?.service !== 'Blue Line Visa CRM' || result.protocolVersion !== 1) {
    throw new Error('The connected server is not a compatible Blue Line office server.')
  }
  return { service: result.service, protocolVersion: result.protocolVersion }
}

const publicErrors = new Set([
  'Username or password is incorrect.',
  'You do not have permission to access My Attendance.',
  'You do not have permission to access Documents.',
  'You do not have permission for this action.',
  'You do not have permission for Human Resources.',
  'Unlock Human Resources with the HR password to continue.',
  'The HR password is incorrect.',
  'The current HR password is incorrect.',
  'The administrator password is incorrect.',
  'Only an administrator can manage HR security or user assignments.',
  'The HR password is not configured.',
  'The HR password has already been created.',
  'The HR password must be between 8 and 256 characters.',
  'Only an administrator can manage application users or create a shared backup.',
  'The host could not create the backup.',
  'A shared backup is already in progress.',
  'Backup expired.',
  'Gemini is not configured on the office server.',
  'A shared Gemini scan is already in progress.',
  'The office server could not complete the Gemini scan.',
  'Scan expired.',
  'Employee data was deleted, but a stored HR file could not be removed.',
  'Application not found.',
  'Customer not found.',
  'Invalid pipeline stage.',
  'Invalid pipeline.',
  'That passport number is already assigned to another customer.',
  'Name, country, and visa type are required.',
  'Name, phone, country, and visa type are required.',
  'Customer name and phone are required.',
  'Application does not belong to this customer.',
  'Document not found.',
  'Unsupported document filename.',
  'Document must be between 1 byte and 25 MB.',
  'Document is unavailable or exceeds 25 MB.',
  'Too many uploads are in progress. Try again later.',
  'Finish or cancel your other upload first.',
  'Upload expired. Choose the file again.',
  'No employee profile is assigned to this application user. Ask an administrator to assign one in Human Resources.',
  'The employee profile assigned to this application user is not active.',
  'Check in before checking out.',
  'This employee has already checked out today.',
  'Check-out must be later than check-in. Overnight shifts are not supported.'
])

export async function startAttendanceServer(root: string, config: Extract<LanConfig, { mode: 'server' }>, deps: Dependencies): Promise<{ server: Server; fingerprint: string }> {
  const key = readFileSync(join(root, 'lan-server', 'key.pem'))
  const cert = readFileSync(join(root, 'lan-server', 'cert.pem'))
  const fingerprint = new X509Certificate(cert).fingerprint256
  const failures = new Map<string, { count: number; until: number }>()
  const server = createServer({ key, cert, minVersion: 'TLSv1.2' }, (socket) => {
    const deadline = setTimeout(() => socket.destroy(), 10000)
    socket.once('close', () => clearTimeout(deadline))
    socket.setTimeout(10000, () => socket.destroy())
    socket.on('error', () => socket.destroy())
    const chunks: Buffer[] = []
    let length = 0
    let handled = false
    socket.on('data', async (chunk: Buffer) => {
      if (handled) return
      chunks.push(chunk)
      length += chunk.length
      if (length > MAX_REQUEST) { socket.destroy(); return }
      if (!chunk.includes(10)) return
      handled = true
      const data = Buffer.concat(chunks, length)
      const newline = data.indexOf(10)
      const address = socket.remoteAddress ?? ''
      let response: object
      try {
        if (newline !== data.length - 1) throw new Error('Invalid request.')
        const request = parseRequest(JSON.parse(data.subarray(0, newline).toString('utf8')))
        const current = failures.get(address)
        if (current && current.until > Date.now() && current.count >= 5) throw new Error('Too many failed sign-in attempts. Try again later.')
        try {
          const result = await dispatchAttendance(request, deps)
          response = { ok: true, result }
        } catch (error) {
          if (error instanceof Error && ['Username or password is incorrect.', 'The HR password is incorrect.',
            'The current HR password is incorrect.', 'The administrator password is incorrect.'].includes(error.message)) {
            const previous = current && current.until > Date.now() ? current : { count: 0, until: Date.now() + 60000 }
            failures.set(address, { ...previous, count: previous.count + 1 })
            if (failures.size > 1024) failures.delete(failures.keys().next().value!)
          }
          throw error
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        response = { ok: false, error: publicErrors.has(message) || message === 'Too many failed sign-in attempts. Try again later.' ? message : 'Unable to process the workspace request. Check the details and try again.' }
      }
      const encoded = JSON.stringify(response)
      if (Buffer.byteLength(encoded) > MAX_RESPONSE) socket.end('{"ok":false,"error":"Server response is too large."}\n')
      else socket.end(`${encoded}\n`)
    })
  })
  server.maxConnections = 20
  server.on('tlsClientError', () => {})
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.bindAddress, () => { server.removeListener('error', reject); resolve() })
  })
  server.on('error', (error) => console.error('LAN attendance server error:', error.message))
  return { server, fingerprint }
}

export function requestAttendance(config: Extract<LanConfig, { mode: 'client' }>, request: Request): Promise<unknown> {
  parseRequest(request)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    let settled = false
    const socket = connect({ host: config.host, port: config.port, rejectUnauthorized: false, minVersion: 'TLSv1.2' })
    const fail = (error: Error) => { if (!settled) { settled = true; socket.destroy(); reject(error) } }
    socket.setTimeout(10000, () => fail(new Error('Server connection timed out.')))
    socket.on('error', () => fail(new Error('Could not securely connect to the office server.')))
    socket.on('secureConnect', () => {
      const actual = socket.getPeerCertificate().fingerprint256?.replace(/:/g, '').toUpperCase()
      if (!actual || actual !== config.fingerprint) { fail(new Error('Server certificate fingerprint does not match. No credentials were sent.')); return }
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      length += chunk.length
      if (length > MAX_RESPONSE) { fail(new Error('Server response is too large.')); return }
      if (!chunk.includes(10)) return
      const data = Buffer.concat(chunks, length)
      const newline = data.indexOf(10)
      try {
        if (newline !== data.length - 1) throw new Error()
        const response = JSON.parse(data.subarray(0, newline).toString('utf8'))
        if (!response || typeof response.ok !== 'boolean') throw new Error()
        settled = true
        socket.destroy()
        if (response.ok) resolve(response.result)
        else reject(new Error(typeof response.error === 'string' ? response.error : 'Server request failed.'))
      } catch { fail(new Error('Invalid server response.')) }
    })
    socket.on('end', () => { if (!settled) fail(new Error('Server closed the connection.')) })
    socket.on('close', () => { if (!settled) fail(new Error('Server closed the connection.')) })
  })
}
