import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { authenticate, createApplicationUser, updateApplicationUser } from './auth'
import { createApplication, initializeDatabase } from './database'
import { parseRequest, requestAttendance, startAttendanceServer } from './lanAttendance'
import { LanCrm } from './lanCrm'
import { DOCUMENT_CHUNK_SIZE, LanDocuments } from './lanDocuments'
import { LanWorkspace } from './lanWorkspace'
import { LanHr } from './lanHr'

const openssl = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
  ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
let hasOpenSsl = false
try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); hasOpenSsl = true } catch { /* Optional integration-test tool. */ }

async function archiveFiles(path: string): Promise<Map<string, Buffer>> {
  const yauzl = createRequire(join(process.cwd(), 'package.json'))('yauzl')
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (error: Error | null, zip: any) => {
      if (error) { reject(error); return }
      const entries = new Map<string, Buffer>()
      zip.on('error', reject)
      zip.on('end', () => resolve(entries))
      zip.on('entry', (entry: { fileName: string }) => {
        zip.openReadStream(entry, (streamError: Error | null, stream: NodeJS.ReadableStream) => {
          if (streamError) { reject(streamError); return }
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('error', reject)
          stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry() })
        })
      })
      zip.readEntry()
    })
  })
}

describe.skipIf(!hasOpenSsl)('remaining shared workspace', () => {
  it('authorizes dashboard, reports, settings, users, scanning and verified host backup', async () => {
    const root = join(process.cwd(), `.lan-workspace-test-${randomUUID()}`)
    mkdirSync(join(root, 'lan-server'), { recursive: true })
    mkdirSync(join(root, 'documents', 'hr'), { recursive: true })
    mkdirSync(join(root, 'customer-photos'), { recursive: true })
    const file = randomBytes(DOCUMENT_CHUNK_SIZE + 23)
    writeFileSync(join(root, 'documents', 'hr', 'test.pdf'), file)
    writeFileSync(join(root, 'customer-photos', 'customer.jpg'), 'customer photo')
    let db: Database.Database | undefined
    try {
      db = initializeDatabase(new Database(':memory:'))
      const database = db
      execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=workspace-test', '-keyout', join(root, 'lan-server', 'key.pem'), '-out', join(root, 'lan-server', 'cert.pem')], { stdio: 'ignore' })
      const admin = createApplicationUser(db, { username: 'test.admin', displayName: 'Admin', role: 'admin', password: 'password123', permissions: [] })
      const manager = createApplicationUser(db, { username: 'test.manager', displayName: 'Manager', role: 'manager', password: 'password123', permissions: ['Settings'] })
      const reporter = createApplicationUser(db, { username: 'test.report', displayName: 'Reporter', role: 'visa', password: 'password123', permissions: ['Reports', 'Smart Scanner'] })
      createApplication(db, { fullName: '=malicious', phone: '5550100', country: 'Canada', visaType: 'Visitor', employee: '' })
      const documents = new LanDocuments(db, join(root, 'documents'))
      const crm = new LanCrm(db, root, documents, (bytes) => bytes)
      const hr = new LanHr(db, root, (bytes) => bytes)
      const workspace = new LanWorkspace(db, root, (bytes) => bytes, (user, currentSession) => { hr.execute(user, currentSession, 'hr:auth:check', []) })
      const server = await startAttendanceServer(root, { mode: 'server', bindAddress: '127.0.0.1', port: 0 }, {
        authenticate: (name, password) => authenticate(database, name, password), attendance: () => null, workspace, crm, hr
      })
      try {
        const address = server.server.address()
        if (!address || typeof address === 'string') throw new Error('No server address.')
        const config = { mode: 'client' as const, host: '127.0.0.1', port: address.port, fingerprint: server.fingerprint.replace(/:/g, '') }
        const session = randomBytes(32).toString('hex')
        const otherSession = randomBytes(32).toString('hex')
        const call = (operation: string, args: unknown[] = [], username = admin.username, activeSession = session, action = 'workspace') =>
          requestAttendance(config, parseRequest({ action, username, password: 'password123', args: [operation, args, activeSession] }))
        const login = await requestAttendance(config, parseRequest({ action: 'login', username: reporter.username, password: 'password123', args: [] })) as { permissions: string[] }
        expect(login.permissions).toEqual(expect.arrayContaining(['Reports', 'Smart Scanner']))
        expect(login.permissions).not.toContain('Gemini API')
        expect(await call('dashboard', [], reporter.username)).toMatchObject({ total: 1 })
        expect(await call('applications:list', [], reporter.username, session, 'crm')).toHaveLength(1)
        expect(await call('reports:csv', [], reporter.username)).toContain(`"'=malicious"`)
        await expect(call('reports:csv', [], manager.username)).rejects.toThrow('permission')
        await expect(call('scanner:authorize', ['standalone'], reporter.username)).resolves.toBe(true)
        await expect(call('scanner:authorize', ['standalone'], manager.username)).rejects.toThrow('permission')
        await call('settings:save', [{ companyName: 'Shared Company', language: 'ar' }], manager.username)
        expect(await call('settings:get', [], reporter.username)).toMatchObject({ companyName: 'Shared Company', language: 'ar' })
        await expect(call('settings:save', [{ companyName: 'Blocked', language: 'en' }], reporter.username)).rejects.toThrow('permission')
        await expect(call('settings:users:list', [], manager.username)).rejects.toThrow('administrator')
        await expect(call('backup:begin', [], manager.username)).rejects.toThrow('administrator')
        const created = await call('settings:users:create', [{ username: 'new.user', displayName: 'New', role: 'visa', password: 'password123', permissions: ['CRM'] }]) as { id: number }
        expect(await call('settings:users:list')).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]))
        await call('settings:users:update', [{ id: created.id, username: 'new.user', displayName: 'Updated', role: 'visa', password: 'changed123', permissions: ['Reports'] }])
        expect(authenticate(db, 'new.user', 'password123')).toBeNull()
        expect(authenticate(db, 'new.user', 'changed123')?.permissions).toContain('Reports')
        await expect(call('settings:users:delete', [admin.id])).rejects.toThrow()
        await call('settings:users:delete', [created.id])
        await expect(call('settings:users:create', [{ username: 'bad.user', displayName: 'Bad', role: 'admin', password: 'password123', permissions: [], extra: 'unexpected' }])).rejects.toThrow()

        const logo = Buffer.from('safe logo bytes')
        const token = await call('logo:begin', [logo.length]) as string
        await expect(call('logo:chunk', [token, 0, logo.toString('base64')], admin.username, otherSession)).rejects.toThrow()
        await call('logo:chunk', [token, 0, logo.toString('base64')])
        expect(await call('logo:finish', [token])).toBe(`data:image/png;base64,${logo.toString('base64')}`)
        const settings = await call('settings:get', [], reporter.username)
        expect(JSON.stringify(settings)).not.toContain(root.replace(/\\/g, '\\\\'))
        expect(settings).toMatchObject({ companyLogoDataUrl: `data:image/png;base64,${logo.toString('base64')}` })

        await expect(call('backup:begin')).rejects.toThrow('Unlock Human Resources')
        await call('hr:auth:setup', ['hrpassword1'], admin.username, session, 'hr')
        await call('hr:auth:unlock', ['hrpassword1'], admin.username, otherSession, 'hr')
        const backup = await call('backup:begin') as string
        await expect(call('backup:status', [backup], admin.username, otherSession)).rejects.toThrow('Backup expired')
        await expect(call('backup:chunk', [backup, 0], manager.username)).rejects.toThrow('administrator')
        let info: { state: string; size: number; hash: string } = { state: 'building', size: 0, hash: '' }
        for (let attempt = 0; attempt < 100 && info.state === 'building'; attempt++) {
          info = await call('backup:status', [backup]) as typeof info
          if (info.state === 'building') await new Promise((resolve) => setTimeout(resolve, 50))
        }
        expect(info.state).toBe('ready')
        await call('hr:auth:lock', [], admin.username, session, 'hr')
        await expect(call('backup:chunk', [backup, 0])).rejects.toThrow('Unlock Human Resources')
        await call('hr:auth:unlock', ['hrpassword1'], admin.username, session, 'hr')
        const pieces: Buffer[] = []
        for (let offset = 0; offset < info.size; offset += DOCUMENT_CHUNK_SIZE) {
          pieces.push(Buffer.from(await call('backup:chunk', [backup, offset]) as string, 'base64'))
        }
        const bytes = Buffer.concat(pieces)
        expect(bytes.length).toBe(info.size)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(info.hash)
        const archive = join(root, 'download.zip')
        writeFileSync(archive, bytes)
        const entries = await archiveFiles(archive)
        expect(entries.get('documents/hr/test.pdf')).toEqual(file)
        expect(entries.get('customer-photos/customer.jpg')?.toString()).toBe('customer photo')
        expect([...entries.keys()].some((path) => path.startsWith('branding/company-logo-'))).toBe(true)
        expect(entries.has('lan-server/key.pem')).toBe(false)
        const snapshot = join(root, 'verification.db')
        writeFileSync(snapshot, entries.get('database/blueline.db')!)
        const copy = new Database(snapshot, { readonly: true })
        try { expect(copy.prepare('SELECT COUNT(*) AS count FROM applications').get()).toEqual({ count: 1 }) } finally { copy.close() }
        await call('backup:release', [backup])
        await expect(call('backup:status', [backup])).rejects.toThrow('Backup expired')
        updateApplicationUser(db, admin.id, { ...reporter, permissions: ['CRM'] })
        await expect(call('reports:csv', [], reporter.username)).rejects.toThrow('permission')
        await expect(call('scanner:authorize', ['standalone'], reporter.username)).rejects.toThrow('permission')
        await expect(call('arbitrary:filesystem', ['C:\\secret'])).rejects.toThrow()
      } finally {
        await new Promise<void>((resolve, reject) => server.server.close((error) => error ? reject(error) : resolve()))
      }
    } finally { db?.close(); rmSync(root, { recursive: true, force: true }) }
  }, 60000)
})
