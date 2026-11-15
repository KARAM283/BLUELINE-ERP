import { randomUUID } from 'node:crypto'
import { open, realpath, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type Database from 'better-sqlite3'
import { listAllDocuments } from './database'
import type { AuthUser } from '../shared/types'

export const DOCUMENT_CHUNK_SIZE = 512 * 1024
export const DOCUMENT_MAX_SIZE = 25 * 1024 * 1024
type PendingUpload = { owner: number; reference: string; name: string; size: number; chunks: Buffer[]; received: number; expires: number }
const extensions = new Set(['.pdf', '.jpg', '.jpeg', '.png'])

function documentName(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 180 || /[\\/:*?"<>|\x00-\x1f]/.test(value)
    || !extensions.has(extname(value).toLowerCase())) throw new Error('Unsupported document filename.')
  return value
}

function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Invalid document ID.')
  return Number(value)
}

/** Provides document-library operations without accepting server file paths from clients. */
export class LanDocuments {
  private readonly pending = new Map<string, PendingUpload>()
  constructor(private readonly db: Database.Database, private readonly docsDir: string) {
    setInterval(() => this.expire(), 60_000).unref()
  }

  list() {
    const records = listAllDocuments(this.db)
    if (records.length > 5000) throw new Error('The document library is too large for this client.')
    return records
  }

  begin(user: AuthUser, reference: string, name: string, size: number) {
    this.expire()
    if (this.pending.size >= 4) throw new Error('Too many uploads are in progress. Try again later.')
    if (Array.from(this.pending.values()).some((upload) => upload.owner === user.id)) throw new Error('Finish or cancel your other upload first.')
    if (typeof reference !== 'string' || reference.length > 80 || !reference.trim()) throw new Error('Enter an application reference.')
    const application = this.db.prepare('SELECT id FROM applications WHERE application_id = ? AND deleted_at IS NULL').get(reference.trim())
    if (!application) throw new Error('Application not found.')
    const fileName = documentName(name)
    if (!Number.isSafeInteger(size) || size < 1 || size > DOCUMENT_MAX_SIZE) throw new Error('Document must be between 1 byte and 25 MB.')
    const token = randomUUID()
    this.pending.set(token, { owner: user.id, reference: reference.trim(), name: fileName, size, chunks: [], received: 0, expires: Date.now() + 5 * 60_000 })
    return token
  }

  chunk(user: AuthUser, token: string, offset: number, encoded: string) {
    const pending = this.getPending(user, token)
    if (!Number.isSafeInteger(offset) || offset !== pending.received || typeof encoded !== 'string'
      || encoded.length > Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid upload chunk.')
    const data = Buffer.from(encoded, 'base64')
    if (data.length !== Math.min(DOCUMENT_CHUNK_SIZE, pending.size - pending.received)
      || data.toString('base64') !== encoded) throw new Error('Invalid upload chunk.')
    pending.chunks.push(data)
    pending.received += data.length
    pending.expires = Date.now() + 5 * 60_000
    return pending.received
  }

  cancel(user: AuthUser, token: string) {
    this.getPending(user, token)
    this.pending.delete(token)
  }

  async finish(user: AuthUser, token: string) {
    const pending = this.getPending(user, token)
    if (pending.received !== pending.size) throw new Error('The upload is incomplete.')
    this.pending.delete(token)
    const directory = join(this.docsDir, 'lan-uploads')
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${randomUUID()}${extname(pending.name).toLowerCase()}`)
    try { await writeFile(destination, Buffer.concat(pending.chunks, pending.size), { flag: 'wx' }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await rm(destination, { force: true })
      throw error
    }
    try {
      return this.db.transaction(() => {
        const app = this.db.prepare('SELECT id, application_id AS applicationId FROM applications WHERE application_id = ? AND deleted_at IS NULL')
          .get(pending.reference) as { id: number; applicationId: string } | undefined
        if (!app) throw new Error('Application not found.')
        const record = this.db.prepare("INSERT INTO documents(application_id, category, file_name, file_path) VALUES (?, 'Supporting Document', ?, ?)")
          .run(app.id, pending.name, destination)
        this.db.prepare("INSERT INTO application_activities(application_id, activity_type, description) VALUES (?, 'Document Added', ?)")
          .run(app.id, `Document uploaded: ${pending.name}`)
        return { id: Number(record.lastInsertRowid), applicationId: app.applicationId, fileName: pending.name }
      })()
    } catch (error) {
      await rm(destination, { force: true })
      throw error
    }
  }

  async download(storage: string, id: number, offset: number) {
    if (storage !== 'application' && storage !== 'customer') throw new Error('Invalid document type.')
    positiveId(id)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > DOCUMENT_MAX_SIZE || offset % DOCUMENT_CHUNK_SIZE !== 0) throw new Error('Invalid download offset.')
    const row = (storage === 'application'
      ? this.db.prepare(`SELECT d.file_path AS path, d.file_name AS name FROM documents d JOIN applications a ON a.id = d.application_id
          WHERE d.id = ? AND a.deleted_at IS NULL`).get(id)
      : this.db.prepare('SELECT file_path AS path, file_name AS name FROM customer_documents WHERE id = ?').get(id)) as { path: string; name: string } | undefined
    if (!row) throw new Error('Document not found.')
    const name = documentName(basename(row.name))
    const root = await realpath(this.docsDir)
    const path = await realpath(row.path)
    const within = relative(root, path)
    if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || resolve(path) === resolve(root)) throw new Error('Document is outside managed storage.')
    if (!extensions.has(extname(path).toLowerCase())) throw new Error('Unsupported document format.')
    const details = await stat(path)
    if (!details.isFile() || details.size < 1 || details.size > DOCUMENT_MAX_SIZE || offset >= details.size) throw new Error('Document is unavailable or exceeds 25 MB.')
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(DOCUMENT_CHUNK_SIZE, details.size - offset))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
      if (bytesRead !== buffer.length) throw new Error('Document changed during download.')
      return { name, size: details.size, data: buffer.toString('base64') }
    } finally { await handle.close() }
  }

  private expire() {
    for (const [token, upload] of this.pending) if (upload.expires < Date.now()) this.pending.delete(token)
  }

  private getPending(user: AuthUser, token: string): PendingUpload {
    this.expire()
    const upload = this.pending.get(token)
    if (!upload || upload.owner !== user.id) throw new Error('Upload expired. Choose the file again.')
    return upload
  }
}
