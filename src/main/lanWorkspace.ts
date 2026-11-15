import { createHash, randomUUID } from 'node:crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type Database from 'better-sqlite3'
import { ZipFile } from 'yazl'
import { createApplicationUser, deleteApplicationUser, listApplicationUsers, updateApplicationUser } from './auth'
import { getDashboard, listApplications } from './database'
import { DOCUMENT_CHUNK_SIZE } from './lanDocuments'
import type { AppModule, AuthUser } from '../shared/types'

const backupLimit = 1024 * 1024 * 1024
const backupTtl = 30 * 60_000
type LogoUpload = { userId: number; session: string; size: number; received: number; chunks: Buffer[]; expires: number }
type Backup = { userId: number; session: string; zip: string; snapshot: string; state: 'building' | 'ready' | 'failed'; size: number; hash: string; expires: number; cancelled: boolean }

function access(user: AuthUser, modules: AppModule[]) {
  if (!modules.some((module) => user.permissions.includes(module))) throw new Error('You do not have permission for this action.')
}
function administrator(user: AuthUser) {
  access(user, ['Settings'])
  if (user.role !== 'admin') throw new Error('Only an administrator can manage application users or create a shared backup.')
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid number.')
  return Number(value)
}
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Invalid text value.')
  return value
}
function details(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Invalid details.')
  return value as Record<string, unknown>
}

export class LanWorkspace {
  private readonly logos = new Map<string, LogoUpload>()
  private readonly backups = new Map<string, Backup>()
  private readonly branding: string
  private readonly backupDirectory: string

  constructor(private readonly db: Database.Database, private readonly root: string, private readonly image: (data: Buffer, max: number) => Buffer,
    private readonly requireHrUnlock: (user: AuthUser, session: string) => void) {
    this.branding = join(root, 'branding')
    this.backupDirectory = join(root, 'lan-backups')
    if (existsSync(this.backupDirectory)) {
      for (const name of readdirSync(this.backupDirectory)) {
        if (/^lan-[a-f0-9-]{36}\.(zip|db)$/.test(name)) rmSync(join(this.backupDirectory, name), { force: true })
      }
    }
    setInterval(() => this.expire(), 60_000).unref()
  }

  execute(user: AuthUser, session: string, operation: string, args: unknown[]): unknown {
    const count = (n: number) => { if (args.length !== n) throw new Error('Invalid action arguments.') }
    switch (operation) {
      case 'dashboard': count(0); access(user, ['Dashboard', 'Reports']); return getDashboard(this.db)
      case 'reports:csv': {
        count(0); access(user, ['Reports'])
        const escape = (value: string | number | null) => {
          let cell = String(value ?? '')
          if (/^[\s]*[=+\-@\t\r]/.test(cell)) cell = `'${cell}`
          return `"${cell.replace(/"/g, '""')}"`
        }
        return '\uFEFF' + ['Application ID,Customer,Phone,Country,Visa Type,Status,Employee,Application Date,Follow-up Date',
          ...listApplications(this.db).map((row) => [row.applicationId, row.customerName, row.phone, row.country, row.visaType,
            row.status, row.employee, row.applicationDate, row.followUpDate].map(escape).join(','))].join('\r\n')
      }
      case 'settings:get': count(0); return this.settings()
      case 'settings:save': {
        count(1); access(user, ['Settings'])
        const value = details(args[0], ['companyName', 'language'])
        const company = text(value.companyName, 200).trim()
        if (company.length < 2 || (value.language !== 'en' && value.language !== 'ar')) throw new Error('Invalid settings.')
        this.db.transaction(() => {
          this.db.prepare('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run('companyName', company)
          this.db.prepare('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run('language', value.language)
        })()
        return
      }
      case 'settings:users:list': count(0); administrator(user); return listApplicationUsers(this.db)
      case 'settings:users:create':
        count(1); administrator(user); details(args[0], ['username', 'displayName', 'role', 'password', 'permissions']); return createApplicationUser(this.db, args[0])
      case 'settings:users:update':
        count(1); administrator(user); details(args[0], ['id', 'username', 'displayName', 'role', 'password', 'permissions']); return updateApplicationUser(this.db, user.id, args[0])
      case 'settings:users:delete':
        count(1); administrator(user); return deleteApplicationUser(this.db, user.id, integer(args[0]))
      case 'scanner:authorize':
        count(1); access(user, args[0] === 'standalone' ? ['Smart Scanner'] : args[0] === 'inspect' ? ['Smart Scanner', 'Visa Pipeline'] : []); return true
      case 'logo:begin': {
        count(1); access(user, ['Settings']); this.expire()
        const size = integer(args[0])
        if (size < 1 || size > 5 * 1024 * 1024 || this.logos.size >= 4) throw new Error('Invalid logo upload.')
        const token = randomUUID()
        this.logos.set(token, { userId: user.id, session, size, received: 0, chunks: [], expires: Date.now() + 5 * 60_000 })
        return token
      }
      case 'logo:chunk': {
        count(3); access(user, ['Settings'])
        const upload = this.logo(user, session, text(args[0], 64))
        const encoded = text(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4)
        const bytes = Buffer.from(encoded, 'base64')
        if (args[1] !== upload.received || bytes.toString('base64') !== encoded
          || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, upload.size - upload.received)) throw new Error('Invalid logo chunk.')
        upload.chunks.push(bytes); upload.received += bytes.length; upload.expires = Date.now() + 5 * 60_000
        return upload.received
      }
      case 'logo:finish': {
        count(1); access(user, ['Settings'])
        const token = text(args[0], 64)
        const upload = this.logo(user, session, token)
        if (upload.received !== upload.size) throw new Error('Upload is incomplete.')
        const image = this.image(Buffer.concat(upload.chunks, upload.size), 800)
        mkdirSync(this.branding, { recursive: true })
        const path = join(this.branding, `company-logo-${randomUUID()}.png`)
        writeFileSync(path, image, { flag: 'wx' })
        const old = this.logoPath()
        try { this.db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('companyLogoPath', ?)").run(path) }
        catch (error) { rmSync(path, { force: true }); throw error }
        this.logos.delete(token)
        this.removeOldLogo(old)
        return `data:image/png;base64,${image.toString('base64')}`
      }
      case 'logo:cancel':
        count(1); access(user, ['Settings']); this.logo(user, session, text(args[0], 64)); this.logos.delete(String(args[0])); return
      case 'settings:remove-logo': {
        count(0); access(user, ['Settings'])
        const old = this.logoPath()
        this.db.prepare("DELETE FROM app_settings WHERE key = 'companyLogoPath'").run()
        this.removeOldLogo(old)
        return
      }
      case 'backup:begin': count(0); administrator(user); this.requireHrUnlock(user, session); return this.beginBackup(user, session)
      case 'backup:status': {
        count(1); administrator(user); this.requireHrUnlock(user, session)
        const item = this.backup(user, session, text(args[0], 64))
        if (item.state === 'failed') throw new Error('The host could not create the backup.')
        return { state: item.state, ...(item.state === 'ready' ? { size: item.size, hash: item.hash } : {}) }
      }
      case 'backup:chunk': {
        count(2); administrator(user); this.requireHrUnlock(user, session)
        const item = this.backup(user, session, text(args[0], 64))
        const offset = integer(args[1])
        if (item.state !== 'ready' || offset < 0 || offset >= item.size || offset % DOCUMENT_CHUNK_SIZE !== 0) throw new Error('Invalid backup offset.')
        const handle = openSync(item.zip, 'r')
        try {
          const bytes = Buffer.alloc(Math.min(DOCUMENT_CHUNK_SIZE, item.size - offset))
          if (readSync(handle, bytes, 0, bytes.length, offset) !== bytes.length) throw new Error('Backup changed during download.')
          return bytes.toString('base64')
        } finally { closeSync(handle) }
      }
      case 'backup:release': {
        count(1); administrator(user)
        const token = text(args[0], 64)
        const item = this.backups.get(token)
        if (item && (item.userId !== user.id || item.session !== session)) throw new Error('Backup expired.')
        if (item) this.discard(token, item)
        return
      }
      default: throw new Error('Unsupported workspace action.')
    }
  }

  private logoPath(): string {
    return (this.db.prepare("SELECT value FROM app_settings WHERE key = 'companyLogoPath'").get() as { value: string } | undefined)?.value ?? ''
  }
  private safeLogo(path: string): string {
    const rel = relative(realpathSync(this.branding), realpathSync(path))
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Logo is outside managed branding storage.')
    return realpathSync(path)
  }
  private removeOldLogo(path: string) {
    if (path && existsSync(path)) {
      try { rmSync(this.safeLogo(path), { force: true }) } catch { /* Do not delete unmanaged files. */ }
    }
  }
  private settings() {
    const values = Object.fromEntries((this.db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>).map(({ key, value }) => [key, value]))
    let companyLogoDataUrl: string | null = null
    try {
      const path = this.safeLogo(values.companyLogoPath)
      if (statSync(path).size <= 5 * 1024 * 1024 && ['.png', '.jpg', '.jpeg'].includes(extname(path).toLowerCase())) {
        companyLogoDataUrl = `data:image/png;base64,${this.image(readFileSync(path), 800).toString('base64')}`
      }
    } catch { /* Missing or unmanaged logos are not shared. */ }
    return { companyName: values.companyName ?? 'Blue Line Travel', language: values.language === 'ar' ? 'ar' : 'en', companyLogoDataUrl }
  }
  private logo(user: AuthUser, session: string, token: string): LogoUpload {
    this.expire()
    const item = this.logos.get(token)
    if (!item || item.userId !== user.id || item.session !== session) throw new Error('Upload expired. Choose the file again.')
    return item
  }
  private beginBackup(user: AuthUser, session: string) {
    this.expire()
    if (this.backups.size >= 1) throw new Error('A shared backup is already in progress.')
    mkdirSync(this.backupDirectory, { recursive: true })
    const token = randomUUID()
    const item: Backup = { userId: user.id, session, zip: join(this.backupDirectory, `lan-${token}.zip`),
      snapshot: join(this.backupDirectory, `lan-${token}.db`), state: 'building', size: 0, hash: '', expires: Date.now() + backupTtl, cancelled: false }
    this.backups.set(token, item)
    void this.createBackup(item).then(() => {
      if (item.cancelled) { this.cleanup(item); this.backups.delete(token) }
      else { item.state = 'ready'; item.expires = Date.now() + backupTtl }
    }).catch(() => {
      this.cleanup(item)
      if (item.cancelled) this.backups.delete(token)
      else { item.state = 'failed'; item.expires = Date.now() + 60_000 }
    })
    return token
  }
  private backup(user: AuthUser, session: string, token: string): Backup {
    this.expire()
    const item = this.backups.get(token)
    if (!item || item.cancelled || item.userId !== user.id || item.session !== session) throw new Error('Backup expired.')
    item.expires = Date.now() + backupTtl
    return item
  }
  private discard(token: string, item: Backup) {
    item.cancelled = true
    if (item.state !== 'building') { this.backups.delete(token); this.cleanup(item) }
  }
  private cleanup(item: Backup) {
    for (const path of [item.snapshot, item.zip]) {
      try { rmSync(path, { force: true }) } catch { /* A later startup removes abandoned files. */ }
    }
  }
  private expire() {
    const now = Date.now()
    for (const [token, item] of this.logos) if (item.expires < now) this.logos.delete(token)
    for (const [token, item] of this.backups) if (item.expires < now) this.discard(token, item)
  }
  private async createBackup(item: Backup): Promise<void> {
    await this.db.backup(item.snapshot)
    const zip = new ZipFile()
    let zipFailure: Error | undefined
    zip.outputStream.on('error', (error: Error) => { zipFailure = error })
    let total = (await stat(item.snapshot)).size
    let count = 0
    const addDirectory = async (directory: string, prefix: string): Promise<void> => {
      if (!existsSync(directory)) return
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        const archive = `${prefix}/${entry.name}`
        if (entry.isDirectory()) await addDirectory(path, archive)
        else if (entry.isFile()) {
          total += (await stat(path)).size
          if (++count > 100_000 || total > backupLimit) throw new Error('Backup is too large.')
          zip.addFile(path, archive)
        } else throw new Error('Backup contains unsupported filesystem entries.')
      }
    }
    try {
      zip.addFile(item.snapshot, 'database/blueline.db')
      await addDirectory(join(this.root, 'documents'), 'documents')
      await addDirectory(join(this.root, 'customer-photos'), 'customer-photos')
      await addDirectory(join(this.root, 'branding'), 'branding')
      if (total > backupLimit) throw new Error('Backup is too large.')
      if (zipFailure) throw zipFailure
      zip.addBuffer(Buffer.from(JSON.stringify({ product: 'Blue Line Visa CRM', createdAt: new Date().toISOString(), format: 1 }, null, 2)), 'backup.json')
      const completion = pipeline(zip.outputStream as Readable, createWriteStream(item.zip, { flags: 'wx' }))
      zip.end()
      await completion
      await rm(item.snapshot, { force: true })
      item.size = (await stat(item.zip)).size
      if (item.size < 1 || item.size > backupLimit) throw new Error('Backup is too large.')
      const hash = createHash('sha256')
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(item.zip)
        stream.on('data', (chunk) => hash.update(chunk))
        stream.on('error', reject)
        stream.on('end', resolve)
      })
      item.hash = hash.digest('hex')
    } catch (error) { throw error }
  }
}
