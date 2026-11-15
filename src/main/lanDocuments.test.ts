import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { authenticate, createApplicationUser, updateApplicationUser } from './auth'
import { createApplication, initializeDatabase } from './database'
import { parseRequest, requestAttendance, startAttendanceServer } from './lanAttendance'
import { DOCUMENT_CHUNK_SIZE, LanDocuments } from './lanDocuments'

const openssl = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
  ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
let hasOpenSsl = false
try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); hasOpenSsl = true } catch { /* Optional integration-test tool. */ }

describe.skipIf(!hasOpenSsl)('shared documents over pinned TLS', () => {
  it('stores and downloads files on the server and rechecks authorization', async () => {
    const root = join(process.cwd(), `.lan-document-test-${randomUUID()}`)
    const certs = join(root, 'lan-server')
    const docs = join(root, 'documents')
    mkdirSync(certs, { recursive: true })
    mkdirSync(docs, { recursive: true })
    let opened: Database.Database | undefined
    try {
      const db = initializeDatabase(new Database(':memory:'))
      opened = db
      execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=documents-test', '-keyout', join(certs, 'key.pem'), '-out', join(certs, 'cert.pem')], { stdio: 'ignore' })
      const user = createApplicationUser(db, { username: 'test.user', displayName: 'Test', role: 'visa', password: 'password123', permissions: ['Documents'] })
      createApplicationUser(db, { username: 'second.user', displayName: 'Other', role: 'visa', password: 'password123', permissions: ['Documents'] })
      const application = createApplication(db, { fullName: 'Example Customer', country: 'Canada', visaType: 'Visitor', employee: '' })
      const documents = new LanDocuments(db, docs)
      const service = await startAttendanceServer(root, { mode: 'server', bindAddress: '127.0.0.1', port: 0 }, {
        authenticate: (name, password) => authenticate(db, name, password),
        attendance: () => { throw new Error('Not used') }, documents
      })
      try {
        const address = service.server.address()
        if (!address || typeof address === 'string') throw new Error('No server address.')
        const config = { mode: 'client' as const, host: '127.0.0.1', port: address.port, fingerprint: service.fingerprint.replace(/:/g, '') }
        const call = (action: string, args: unknown[] = []) => requestAttendance(config, parseRequest({ action, username: user.username, password: 'password123', args }))
        const contents = Buffer.alloc(DOCUMENT_CHUNK_SIZE + 17, 0x61)
        const token = await call('document-begin', [application.applicationId, 'sample.pdf', contents.length])
        await expect(requestAttendance(config, parseRequest({ action: 'document-cancel', username: 'second.user', password: 'password123', args: [token] }))).rejects.toThrow()
        await expect(call('document-chunk', [token, 0, Buffer.from('short').toString('base64')])).rejects.toThrow()
        await expect(call('document-chunk', [token, 0, contents.subarray(0, DOCUMENT_CHUNK_SIZE).toString('base64')])).resolves.toBe(DOCUMENT_CHUNK_SIZE)
        await expect(call('document-chunk', [token, DOCUMENT_CHUNK_SIZE, contents.subarray(DOCUMENT_CHUNK_SIZE).toString('base64')])).resolves.toBe(contents.length)
        const uploaded = await call('document-finish', [token]) as { id: number }
        const rows = await call('documents-list') as Array<{ id: number; fileName: string }>
        expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: uploaded.id, fileName: 'sample.pdf' })]))
        const first = await call('document-download', ['application', uploaded.id, 0]) as { data: string; size: number }
        const second = await call('document-download', ['application', uploaded.id, DOCUMENT_CHUNK_SIZE]) as { data: string }
        expect(first.size).toBe(contents.length)
        expect(Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(second.data, 'base64')])).toEqual(contents)
        const outside = join(root, 'outside.pdf')
        writeFileSync(outside, 'private')
        db.prepare('UPDATE documents SET file_path = ? WHERE id = ?').run(outside, uploaded.id)
        await expect(call('document-download', ['application', uploaded.id, 0])).rejects.toThrow()
        const unfinished = await call('document-begin', [application.applicationId, 'blocked.pdf', 2])
        await call('document-chunk', [unfinished, 0, Buffer.from('ok').toString('base64')])
        updateApplicationUser(db, 9999, { ...user, permissions: ['My Attendance'] })
        await expect(call('documents-list')).rejects.toThrow('permission')
        await expect(call('document-finish', [unfinished])).rejects.toThrow('permission')
        expect(db.prepare('SELECT COUNT(*) AS count FROM documents').get()).toEqual({ count: 1 })
      } finally {
        await new Promise<void>((resolve, reject) => service.server.close((error) => error ? reject(error) : resolve()))
      }
    } finally { opened?.close(); rmSync(root, { recursive: true, force: true }) }
  }, 30000)
})
