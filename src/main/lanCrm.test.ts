import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { authenticate, createApplicationUser, updateApplicationUser } from './auth'
import { initializeDatabase } from './database'
import { parseRequest, requestAttendance, startAttendanceServer } from './lanAttendance'
import { LanCrm } from './lanCrm'
import { DOCUMENT_CHUNK_SIZE, LanDocuments } from './lanDocuments'

const openssl = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
  ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
let hasOpenSsl = false
try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); hasOpenSsl = true } catch { /* Optional integration-test tool. */ }

describe.skipIf(!hasOpenSsl)('shared CRM and pipeline', () => {
  it('uses the host database, transfers client files and isolates passport staging', async () => {
    const root = join(process.cwd(), `.lan-crm-test-${randomUUID()}`)
    mkdirSync(join(root, 'lan-server'), { recursive: true })
    let opened: Database.Database | undefined
    try {
      const db = initializeDatabase(new Database(':memory:'))
      opened = db
      execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=crm-test', '-keyout', join(root, 'lan-server', 'key.pem'), '-out', join(root, 'lan-server', 'cert.pem')], { stdio: 'ignore' })
      const user = createApplicationUser(db, { username: 'test.user', displayName: 'Test', role: 'visa', password: 'password123', permissions: ['Visa Pipeline', 'CRM', 'Settings'] })
      const documents = new LanDocuments(db, join(root, 'documents'))
      const crm = new LanCrm(db, root, documents, (bytes) => bytes)
      const server = await startAttendanceServer(root, { mode: 'server', bindAddress: '127.0.0.1', port: 0 }, {
        authenticate: (name, password) => authenticate(db, name, password), attendance: () => null, documents, crm
      })
      try {
        const address = server.server.address()
        if (!address || typeof address === 'string') throw new Error('No server address.')
        const config = { mode: 'client' as const, host: '127.0.0.1', port: address.port, fingerprint: server.fingerprint.replace(/:/g, '') }
        const session = randomBytes(32).toString('hex')
        const call = (operation: string, args: unknown[] = [], activeSession = session) => requestAttendance(config, parseRequest({
          action: 'crm', username: user.username, password: 'password123', args: [operation, args, activeSession]
        })).catch((error: Error) => { throw new Error(`${operation}: ${error.message}`) })
        const stage = async (kind: string, target: number | null, fileName: string, bytes: Buffer) => {
          const token = await call('file:begin', [kind, target, null, fileName, bytes.length]) as string
          for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
            await call('file:chunk', [token, offset, bytes.subarray(offset, offset + DOCUMENT_CHUNK_SIZE).toString('base64')])
          }
          return { token, result: await call('file:finish', [token]) }
        }
        const passport = Buffer.from('passport bytes')
        const staged = await stage('passport', null, 'passport.pdf', passport)
        const input = { fullName: 'Example Customer', phone: '5550100', country: 'Canada', visaType: 'Visitor', employee: '', passportToken: staged.token }
        await expect(call('applications:create', [input], randomBytes(32).toString('hex'))).rejects.toThrow()
        const app = await call('applications:create', [input]) as { id: number; customerId: number; applicationId: string }
        expect(app.applicationId).toMatch(/^BL-/)
        const path = (db.prepare('SELECT file_path AS path FROM customer_documents WHERE customer_id = ?').get(app.customerId) as { path: string }).path
        expect(path.startsWith(join(root, 'documents'))).toBe(true)
        expect(readFileSync(path)).toEqual(passport)
        expect(await call('applications:list')).toEqual(expect.arrayContaining([expect.objectContaining({ id: app.id })]))
        await call('applications:move', [app.id, 'Documents Collection'])
        await call('applications:update', [app.id, { fullName: 'Updated Customer', phone: '5550100', country: 'Canada', visaType: 'Visitor', employee: '' }])
        await call('applications:activities:add', [app.id, { activityType: 'Internal Note', description: 'Shared note' }])
        const profile = await call('customers:get-profile', [app.customerId]) as { customer: { fullName: string }; activities: Array<{ description: string }> }
        expect(profile.customer.fullName).toBe('Updated Customer')
        expect(profile.activities).toEqual(expect.arrayContaining([expect.objectContaining({ description: 'Shared note' })]))
        await call('customers:update', [app.customerId, { fullName: 'Customer Edited', phone: '5550100', passportNumber: '', dateOfBirth: '', nationality: '', gender: '', email: '', address: '', passportIssueDate: '', passportExpiryDate: '' }])
        const file = Buffer.alloc(DOCUMENT_CHUNK_SIZE + 17, 0x61)
        const appFile = (await stage('application', app.id, 'application.pdf', file)).result as { id: number }
        const customerFile = (await stage('customer', app.customerId, 'customer.pdf', file)).result as { id: number }
        await expect(call('file:begin', ['customer', app.customerId, app.id + 100, 'bad.pdf', 4])).rejects.toThrow()
        expect(await call('documents:list', [app.id])).toEqual(expect.arrayContaining([expect.objectContaining({ id: appFile.id })]))
        const appDownload = await call('file:download', ['application', appFile.id, 0]) as { data: string }
        expect(Buffer.from(appDownload.data, 'base64')).toEqual(file.subarray(0, DOCUMENT_CHUNK_SIZE))
        const downloaded = await call('file:download', ['customer', customerFile.id, 0]) as { data: string }
        const lastChunk = await call('file:download', ['customer', customerFile.id, DOCUMENT_CHUNK_SIZE]) as { data: string }
        expect(Buffer.concat([Buffer.from(downloaded.data, 'base64'), Buffer.from(lastChunk.data, 'base64')])).toEqual(file)
        await stage('photo', app.customerId, 'photo.jpg', Buffer.from('test image'))
        expect((await call('customers:get-profile', [app.customerId]) as { customer: { photoDataUrl: string } }).customer.photoDataUrl).toContain('data:image/jpeg;base64,')
        await call('pipelines:save', [{ name: 'New workflow', stages: ['Start', 'Finish'] }])
        const pipelines = await call('pipelines:list') as Array<{ id: number; name: string }>
        const newPipeline = pipelines.find((entry) => entry.name === 'New workflow')
        expect(newPipeline).toBeTruthy()
        await call('pipelines:save', [{ id: newPipeline!.id, name: 'Updated workflow', stages: ['Start', 'Finish'] }])
        await call('pipelines:delete', [newPipeline!.id])
        await call('catalog:save', ['country', { name: 'Test Country', active: true }])
        const catalog = await call('catalog:list', ['country']) as Array<{ id: number; name: string }>
        const country = catalog.find((entry) => entry.name === 'Test Country')
        expect(country).toBeTruthy()
        await call('catalog:save', ['country', { id: country!.id, name: 'Updated Country', active: true }])
        await call('catalog:delete', ['country', country!.id])
        await expect(call('arbitrary:filesystem', ['C:\\secret'])).rejects.toThrow()
        updateApplicationUser(db, 9999, { ...user, permissions: ['CRM'] })
        await expect(call('applications:delete', [app.id])).rejects.toThrow('permission')
        await expect(call('customers:get-profile', [app.customerId])).resolves.toBeTruthy()
        await expect(call('file:download', ['application', appFile.id, 0])).rejects.toThrow('permission')
        updateApplicationUser(db, 9999, { ...user, permissions: ['Visa Pipeline', 'CRM', 'Settings'] })
        await call('applications:delete', [app.id])
        expect(await call('applications:list')).toEqual([])
      } finally {
        await new Promise<void>((resolve, reject) => server.server.close((error) => error ? reject(error) : resolve()))
      }
    } finally { opened?.close(); rmSync(root, { recursive: true, force: true }) }
  }, 30000)
})
