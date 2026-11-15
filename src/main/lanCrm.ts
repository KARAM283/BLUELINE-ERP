import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type Database from 'better-sqlite3'
import {
  addApplicationActivity, createApplication, deleteApplication, deleteCatalogItem, deletePipeline, getCustomerPhotoPath,
  getCustomerProfile, listApplicationActivities, listApplications, listCatalog, listCustomers, listPipelines, moveApplication,
  saveCatalogItem, savePipeline, setCustomerPhotoPath, updateApplication, updateCustomer
} from './database'
import { DOCUMENT_CHUNK_SIZE, DOCUMENT_MAX_SIZE, LanDocuments } from './lanDocuments'
import type { AppModule, AuthUser, NewApplication } from '../shared/types'

type UploadKind = 'application' | 'customer' | 'photo' | 'passport'
type Upload = { userId: number; session: string; kind: UploadKind; id: number | null; related: number | null; name: string; size: number; chunks: Buffer[]; received: number; expires: number; complete: boolean }
const customers: AppModule[] = ['CRM', 'Customers', 'DATA']
const pipeline: AppModule[] = ['Visa Pipeline']
const fileModules: Record<UploadKind, AppModule[]> = {
  application: ['Visa Pipeline', 'Documents'], customer: customers, photo: customers, passport: ['Dashboard', 'Visa Pipeline']
}

function access(user: AuthUser, modules: AppModule[]) {
  if (!modules.some((module) => user.permissions.includes(module))) throw new Error('You do not have permission for this action.')
}
function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Invalid record ID.')
  return Number(value)
}
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text value.')
  return value
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid details.')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error('Invalid details.')
  return record
}
function applicationInput(value: unknown): NewApplication {
  const fields = ['fullName', 'phone', 'email', 'nationality', 'passportNumber', 'country', 'visaType', 'employee', 'followUpDate', 'dateOfBirth', 'gender', 'address', 'passportIssueDate', 'passportExpiryDate']
  const data = object(value, [...fields, 'pipelineId', 'passportToken'])
  for (const field of fields) if (data[field] !== undefined) text(data[field], 2000)
  for (const required of ['fullName', 'country', 'visaType', 'employee']) text(data[required], 2000)
  if (data.pipelineId !== undefined) id(data.pipelineId)
  if (data.passportToken !== undefined) text(data.passportToken, 64)
  return data as NewApplication
}
function filename(value: unknown, kind: UploadKind): string {
  const name = text(value, 180)
  const extension = extname(name).toLowerCase()
  if (!name || /[\\/:*?"<>|\x00-\x1f]/.test(name)
    || !(kind === 'photo' ? ['.jpg', '.jpeg', '.png'] : ['.pdf', '.jpg', '.jpeg', '.png']).includes(extension)) throw new Error('Unsupported file name.')
  return name
}

export class LanCrm {
  private readonly uploads = new Map<string, Upload>()
  private readonly photoDir: string
  constructor(private readonly db: Database.Database, private readonly root: string, private readonly docs: LanDocuments,
    private readonly image: (data: Buffer, max: number) => Buffer) {
    this.photoDir = join(root, 'customer-photos')
    setInterval(() => this.expire(), 60_000).unref()
  }

  execute(user: AuthUser, session: string, operation: string, args: unknown[]): unknown {
    const count = (n: number) => { if (args.length !== n) throw new Error('Invalid action arguments.') }
    switch (operation) {
      case 'applications:list':
        count(0); access(user, ['Visa Pipeline', 'Reports', 'Smart Scanner']); return listApplications(this.db)
      case 'applications:create':
        count(1); access(user, ['Dashboard', 'Visa Pipeline']); return this.create(user, session, applicationInput(args[0]))
      case 'applications:move':
        count(2); access(user, pipeline); return moveApplication(this.db, id(args[0]), text(args[1], 80))
      case 'applications:update':
        count(2); access(user, pipeline); return updateApplication(this.db, id(args[0]), applicationInput(args[1]))
      case 'applications:delete':
        count(1); access(user, pipeline); return deleteApplication(this.db, id(args[0]))
      case 'applications:activities:list':
        count(1); access(user, [...pipeline, ...customers]); return listApplicationActivities(this.db, id(args[0]))
      case 'applications:activities:add': {
        count(2); access(user, [...pipeline, ...customers])
        const value = object(args[1], ['activityType', 'description'])
        return addApplicationActivity(this.db, id(args[0]), { activityType: text(value.activityType, 32) as 'Internal Note', description: text(value.description) })
      }
      case 'customers:list':
        count(1); access(user, [...customers, ...pipeline])
        return listCustomers(this.db, args[0] === null ? '' : text(args[0], 200)).map((customer) => ({ ...customer, photoDataUrl: this.photo(customer.id, 48) }))
      case 'customers:get-profile': {
        count(1); access(user, [...customers, ...pipeline])
        const profile = getCustomerProfile(this.db, id(args[0]))
        profile.customer.photoDataUrl = this.photo(profile.customer.id, 400)
        return profile
      }
      case 'customers:update': {
        count(2); access(user, customers)
        const fields = ['fullName', 'passportNumber', 'dateOfBirth', 'nationality', 'gender', 'phone', 'email', 'address', 'passportIssueDate', 'passportExpiryDate']
        const value = object(args[1], fields)
        for (const key of fields) text(value[key], 2000)
        return updateCustomer(this.db, id(args[0]), value as unknown as Parameters<typeof updateCustomer>[2])
      }
      case 'pipelines:list':
        count(0); access(user, ['Dashboard', ...pipeline, 'Settings']); return listPipelines(this.db)
      case 'pipelines:save': {
        count(1); access(user, [...pipeline, 'Settings'])
        const value = object(args[0], ['id', 'name', 'stages'])
        if (value.id !== undefined) id(value.id)
        const name = text(value.name, 80)
        if (!Array.isArray(value.stages) || value.stages.length > 30) throw new Error('Invalid stages.')
        const stages = value.stages.map((stage) => text(stage, 80))
        return savePipeline(this.db, { ...(value.id === undefined ? {} : { id: Number(value.id) }), name, stages })
      }
      case 'pipelines:delete':
        count(1); access(user, [...pipeline, 'Settings']); return deletePipeline(this.db, id(args[0]))
      case 'catalog:list': {
        count(1); access(user, ['Dashboard', ...customers, ...pipeline, 'Visa Types', 'Countries', 'Settings', 'Smart Scanner'])
        return listCatalog(this.db, this.catalog(args[0]))
      }
      case 'catalog:save': {
        count(2); access(user, ['Visa Types', 'Countries', 'Settings'])
        const value = object(args[1], ['id', 'name', 'active'])
        if (value.id !== undefined) id(value.id)
        if (typeof value.active !== 'boolean') throw new Error('Invalid catalog entry.')
        return saveCatalogItem(this.db, this.catalog(args[0]), { ...(value.id === undefined ? {} : { id: Number(value.id) }), name: text(value.name, 200), active: value.active })
      }
      case 'catalog:delete':
        count(2); access(user, ['Visa Types', 'Countries', 'Settings']); return deleteCatalogItem(this.db, this.catalog(args[0]), id(args[1]))
      case 'documents:list':
        count(1); access(user, ['Visa Pipeline', 'Documents'])
        return this.db.prepare(`SELECT d.id, a.application_id AS applicationId, d.category, d.file_name AS fileName, d.added_at AS addedAt
          FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.application_id = ? AND a.deleted_at IS NULL ORDER BY d.added_at DESC`).all(id(args[0]))
      case 'file:download': {
        count(3)
        const storage = text(args[0], 20)
        if (storage === 'application') access(user, ['Visa Pipeline', 'Documents'])
        else if (storage === 'customer') access(user, [...customers, 'Documents'])
        else throw new Error('Invalid document type.')
        if (!Number.isSafeInteger(args[2])) throw new Error('Invalid download offset.')
        return this.docs.download(storage, id(args[1]), args[2] as number)
      }
      case 'file:begin':
        count(5); return this.begin(user, session, args)
      case 'file:chunk':
        count(3); return this.chunk(user, session, args)
      case 'file:finish':
        count(1); return this.finish(user, session, text(args[0], 64))
      case 'file:cancel':
        count(1); this.pending(user, session, text(args[0], 64)); this.uploads.delete(String(args[0])); return
      default: throw new Error('Unsupported workspace action.')
    }
  }

  private catalog(value: unknown): 'visaType' | 'country' {
    if (value !== 'visaType' && value !== 'country') throw new Error('Invalid catalog.')
    return value
  }
  private photo(customerId: number, max: number): string | null {
    const path = getCustomerPhotoPath(this.db, customerId)
    if (!path || !existsSync(path) || !existsSync(this.photoDir)) return null
    try {
      const base = realpathSync(this.photoDir)
      const actual = realpathSync(path)
      const rel = relative(base, actual)
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || statSync(actual).size > 10 * 1024 * 1024) return null
      return `data:image/jpeg;base64,${this.image(readFileSync(actual), max).toString('base64')}`
    } catch { return null }
  }
  private begin(user: AuthUser, session: string, args: unknown[]) {
    const kind = args[0]
    if (kind !== 'application' && kind !== 'customer' && kind !== 'photo' && kind !== 'passport') throw new Error('Invalid upload type.')
    access(user, fileModules[kind])
    this.expire()
    if (this.uploads.size >= 4 || Array.from(this.uploads.values()).some((item) => item.userId === user.id && item.session === session && !item.complete)) throw new Error('Too many uploads in progress.')
    const recordId = kind === 'passport' ? null : id(args[1])
    const related = args[2] === null ? null : id(args[2])
    if (kind !== 'customer' && related !== null) throw new Error('Invalid upload target.')
    if (kind === 'passport' && args[1] !== null) throw new Error('Invalid upload target.')
    if (kind === 'application' && !this.db.prepare('SELECT 1 FROM applications WHERE id = ? AND deleted_at IS NULL').get(recordId)) throw new Error('Application not found.')
    if ((kind === 'customer' || kind === 'photo') && !this.db.prepare('SELECT 1 FROM customers WHERE id = ?').get(recordId)) throw new Error('Customer not found.')
    if (related !== null && !this.db.prepare('SELECT 1 FROM applications WHERE id = ? AND customer_id = ? AND deleted_at IS NULL').get(related, recordId)) throw new Error('Application does not belong to this customer.')
    const name = filename(args[3], kind)
    const size = args[4]
    if (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > (kind === 'photo' ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE)) throw new Error('Invalid file size.')
    const token = randomUUID()
    this.uploads.set(token, { userId: user.id, session, kind, id: recordId, related, name, size: Number(size), chunks: [], received: 0, expires: Date.now() + 5 * 60_000, complete: false })
    return token
  }
  private pending(user: AuthUser, session: string, token: string): Upload {
    this.expire()
    const item = this.uploads.get(token)
    if (!item || item.userId !== user.id || item.session !== session) throw new Error('Upload expired. Choose the file again.')
    access(user, fileModules[item.kind])
    return item
  }
  private chunk(user: AuthUser, session: string, args: unknown[]) {
    const item = this.pending(user, session, text(args[0], 64))
    const offset = args[1]
    const encoded = text(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4)
    if (item.complete || offset !== item.received || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid upload chunk.')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, item.size - item.received) || bytes.toString('base64') !== encoded) throw new Error('Invalid upload chunk.')
    item.chunks.push(bytes)
    item.received += bytes.length
    item.expires = Date.now() + 5 * 60_000
    return item.received
  }
  private finish(user: AuthUser, session: string, token: string) {
    const item = this.pending(user, session, token)
    if (item.complete || item.received !== item.size) throw new Error('Upload is incomplete.')
    if (item.kind === 'passport') {
      item.complete = true
      item.expires = Date.now() + 10 * 60_000
      return { passportToken: token }
    }
    const data = Buffer.concat(item.chunks, item.size)
    this.uploads.delete(token)
    if (item.kind === 'photo') {
      const image = this.image(data, 800)
      mkdirSync(this.photoDir, { recursive: true })
      const path = join(this.photoDir, `${item.id}-${randomUUID()}.jpg`)
      const old = getCustomerPhotoPath(this.db, item.id!)
      try { writeFileSync(path, image, { flag: 'wx' }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') rmSync(path, { force: true }); throw error }
      try { setCustomerPhotoPath(this.db, item.id!, path) } catch (error) { rmSync(path, { force: true }); throw error }
      if (old && existsSync(old)) {
        try {
          const rel = relative(realpathSync(this.photoDir), realpathSync(old))
          if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) rmSync(old, { force: true })
        } catch { /* The new photo is already saved. */ }
      }
      return `data:image/jpeg;base64,${image.toString('base64')}`
    }
    const directory = join(this.root, 'documents', 'lan-uploads')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${randomUUID()}${extname(item.name).toLowerCase()}`)
    try { writeFileSync(path, data, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') rmSync(path, { force: true }); throw error }
    try {
      return this.db.transaction(() => {
        if (item.kind === 'application') {
          const app = this.db.prepare('SELECT application_id AS reference FROM applications WHERE id = ? AND deleted_at IS NULL').get(item.id) as { reference: string } | undefined
          if (!app) throw new Error('Application not found.')
          const result = this.db.prepare("INSERT INTO documents(application_id, category, file_name, file_path) VALUES (?, 'Supporting Document', ?, ?)").run(item.id, item.name, path)
          this.db.prepare("INSERT INTO application_activities(application_id, activity_type, description) VALUES (?, 'Document Added', ?)").run(item.id, `Document uploaded: ${item.name}`)
          return { id: Number(result.lastInsertRowid), applicationId: app.reference, category: 'Supporting Document', fileName: item.name, addedAt: new Date().toISOString() }
        }
        if (!this.db.prepare('SELECT 1 FROM customers WHERE id = ?').get(item.id)) throw new Error('Customer not found.')
        if (item.related !== null && !this.db.prepare('SELECT 1 FROM applications WHERE id = ? AND customer_id = ? AND deleted_at IS NULL').get(item.related, item.id)) throw new Error('Application does not belong to this customer.')
        const result = this.db.prepare("INSERT INTO customer_documents(customer_id, application_record_id, file_name, file_path, document_type) VALUES (?, ?, ?, ?, 'Supporting document')").run(item.id, item.related, item.name, path)
        return { id: Number(result.lastInsertRowid), applicationId: null, category: 'Supporting document', fileName: item.name, addedAt: new Date().toISOString(), applicationRecordId: item.related, storage: 'customer' }
      })()
    } catch (error) { rmSync(path, { force: true }); throw error }
  }
  private create(user: AuthUser, session: string, input: NewApplication) {
    let path: string | undefined
    const token = input.passportToken
    if (token) {
      const item = this.pending(user, session, token)
      if (item.kind !== 'passport' || !item.complete) throw new Error('Passport upload expired.')
      const directory = join(this.root, 'documents', 'passports')
      mkdirSync(directory, { recursive: true })
      path = join(directory, `${randomUUID()}${extname(item.name).toLowerCase()}`)
      try { writeFileSync(path, Buffer.concat(item.chunks, item.size), { flag: 'wx' }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') rmSync(path, { force: true }); throw error }
    }
    try {
      const { passportToken: _token, ...details } = input
      const result = createApplication(this.db, details, path)
      if (token) this.uploads.delete(token)
      return result
    } catch (error) { if (path) rmSync(path, { force: true }); throw error }
  }
  private expire() {
    for (const [token, item] of this.uploads) if (item.expires < Date.now()) this.uploads.delete(token)
  }
}
