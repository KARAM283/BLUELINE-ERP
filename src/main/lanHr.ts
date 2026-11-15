import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type Database from 'better-sqlite3'
import { authenticate, listApplicationUsers } from './auth'
import { changeHrPassword, isHrPasswordConfigured, resetHrPassword, setInitialHrPassword, verifyHrPassword } from './hrSecurity'
import {
  addHrCandidate, addHrDocument, addHrPayrollItem, approveHrPayroll, archiveHrEmployee, buildHrCsvReport,
  calculateHrPay, clockHrAttendance, createHrLeaveRequest, decideHrLeaveRequest, deleteHrEmployee,
  generateHrPayroll, getHrCandidateFilePath, getHrDashboard, getHrDocumentPath, getHrEmployeePhotoPath,
  getHrEmployeeProfileData, getHrEmployeeStoredFilePaths, listHrAttendance, listHrAttendanceCalendar,
  listHrCandidates, listHrDepartments, listHrDocuments, listHrEmployees, listHrLeaveBalances, listHrLeaveRequests,
  listHrPayrollPeriods, listHrPayrollRecords, markAllHrEmployeesPresent, markHrPayrollPaid, saveHrAttendance,
  saveHrDepartment, saveHrEmployee, saveHrLeaveBalance, setHrCandidateStarred, setHrEmployeePhotoPath,
  updateHrCandidate, type HrEmployeeRecord
} from './hrDatabase'
import { DOCUMENT_CHUNK_SIZE, DOCUMENT_MAX_SIZE } from './lanDocuments'
import type { AuthUser, HrCandidateDraft, HrReportType } from '../shared/types'

type UploadKind = 'photo' | 'document' | 'candidate'
type Upload = { userId: number; session: string; kind: UploadKind; employeeId: number | null; name: string; size: number; chunks: Buffer[]; received: number; complete: boolean; expires: number; metadata: { documentType: string; issueDate?: string; expirationDate?: string } | null }
type Unlocked = { version: string; expires: number }
const TTL = 12 * 60 * 60_000
const extensions = ['.pdf', '.jpg', '.jpeg', '.png']

function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Invalid record ID.')
  return Number(value)
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new Error('Invalid number.')
  return Number(value)
}
function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text value.')
  return value
}
function obj(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid details.')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error('Invalid details.')
  return record
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value, 200)
}
function name(value: unknown, photo = false): string {
  const file = text(value, 180)
  if (!file || /[\\/:*?"<>|\x00-\x1f]/.test(file) || !extensions.includes(extname(file).toLowerCase())
    || (photo && extname(file).toLowerCase() === '.pdf')) throw new Error('Unsupported file name.')
  return file
}

export class LanHr {
  private readonly unlocked = new Map<string, Unlocked>()
  private readonly uploads = new Map<string, Upload>()
  private readonly hrDir: string
  constructor(private readonly db: Database.Database, root: string, private readonly image: (data: Buffer, max: number) => Buffer) {
    this.hrDir = join(root, 'documents', 'hr')
    setInterval(() => this.expire(), 60_000).unref()
  }

  execute(user: AuthUser, session: string, operation: string, args: unknown[]): unknown {
    const key = `${user.id}:${session}`
    if (!user.permissions.includes('Human Resources')) {
      this.unlocked.delete(key)
      this.removeUploads(user.id, session)
      throw new Error('You do not have permission for Human Resources.')
    }
    const count = (n: number) => { if (args.length !== n) throw new Error('Invalid action arguments.') }
    const admin = () => { if (user.role !== 'admin') throw new Error('Only an administrator can manage HR security or user assignments.') }
    const unlock = () => {
      const version = this.version()
      if (!version) throw new Error('The HR password is not configured.')
      this.unlocked.set(key, { version, expires: Date.now() + TTL })
      if (this.unlocked.size > 1024) this.unlocked.delete(this.unlocked.keys().next().value!)
    }
    switch (operation) {
      case 'hr:auth:status': count(0); return { configured: isHrPasswordConfigured(this.db) }
      case 'hr:auth:setup':
        count(1); admin(); setInitialHrPassword(this.db, user.username, text(args[0], 256)); this.unlocked.clear(); this.uploads.clear(); unlock(); return
      case 'hr:auth:unlock':
        count(1)
        if (!isHrPasswordConfigured(this.db) || !verifyHrPassword(this.db, text(args[0], 256))) throw new Error('The HR password is incorrect.')
        unlock(); return
      case 'hr:auth:reset':
        count(2); admin()
        if (!isHrPasswordConfigured(this.db)) throw new Error('The HR password is not configured.')
        if (!authenticate(this.db, user.username, text(args[0], 256))) throw new Error('The administrator password is incorrect.')
        resetHrPassword(this.db, user.username, text(args[1], 256)); this.unlocked.clear(); this.uploads.clear(); unlock(); return
      case 'hr:auth:lock':
        count(0); this.unlocked.delete(key); this.removeUploads(user.id, session); return
    }
    const state = this.unlocked.get(key)
    if (!state || state.expires < Date.now() || state.version !== this.version()) {
      this.unlocked.delete(key)
      this.removeUploads(user.id, session)
      throw new Error('Unlock Human Resources with the HR password to continue.')
    }
    state.expires = Date.now() + TTL
    const actor = user.displayName
    switch (operation) {
      case 'hr:auth:check': count(0); return true
      case 'hr:auth:change':
        count(2); admin(); changeHrPassword(this.db, user.username, text(args[0], 256), text(args[1], 256))
        this.unlocked.clear(); this.uploads.clear(); unlock(); return
      case 'hr:users:list':
        count(0); admin(); return listApplicationUsers(this.db)
      case 'hr:dashboard': {
        count(0); const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        return getHrDashboard(this.db, date)
      }
      case 'hr:departments:list': count(0); return listHrDepartments(this.db)
      case 'hr:departments:save': {
        count(1); const value = obj(args[0], ['id', 'name', 'description'])
        return saveHrDepartment(this.db, actor, { ...(value.id === undefined ? {} : { id: id(value.id) }), name: text(value.name, 200), description: text(value.description) })
      }
      case 'hr:employees:list':
        count(2)
        if (args[1] !== null && typeof args[1] !== 'boolean') throw new Error('Invalid employee filters.')
        return listHrEmployees(this.db, args[0] === null ? '' : text(args[0], 200), args[1] === true).map((employee) => this.employee(employee, 48))
      case 'hr:employees:profile': {
        count(1); const profile = getHrEmployeeProfileData(this.db, id(args[0]))
        return { ...profile, employee: this.employee(profile.employee, 320) }
      }
      case 'hr:employees:save': {
        count(1)
        const fields = ['id', 'fullName', 'phone', 'email', 'departmentId', 'jobTitle', 'hireDate', 'employmentType', 'status', 'hourlyRate', 'workStart', 'workEnd', 'appUserId']
        const value = obj(args[0], fields)
        for (const field of ['fullName', 'phone', 'email', 'jobTitle', 'hireDate', 'employmentType', 'status']) text(value[field])
        if (value.id !== undefined) id(value.id)
        if (value.departmentId !== null) id(value.departmentId)
        integer(value.hourlyRate)
        if (value.appUserId !== undefined) { admin(); if (value.appUserId !== null) id(value.appUserId) }
        for (const field of ['workStart', 'workEnd']) if (value[field] !== undefined) nullableText(value[field])
        return this.employee(saveHrEmployee(this.db, actor, value as unknown as Parameters<typeof saveHrEmployee>[2]), 320)
      }
      case 'hr:employees:archive':
        count(2); if (typeof args[1] !== 'boolean') throw new Error('Invalid archive action.')
        return archiveHrEmployee(this.db, actor, id(args[0]), args[1])
      case 'hr:employees:delete': count(1); return this.deleteEmployee(actor, id(args[0]))
      case 'hr:attendance:list': count(1); return listHrAttendance(this.db, text(args[0], 20))
      case 'hr:attendance:calendar':
        count(3); return listHrAttendanceCalendar(this.db, integer(args[0]), integer(args[1]), args[2] === null ? undefined : id(args[2]))
      case 'hr:attendance:clock-in': count(1); return clockHrAttendance(this.db, actor, id(args[0]), 'in')
      case 'hr:attendance:clock-out': count(1); return clockHrAttendance(this.db, actor, id(args[0]), 'out')
      case 'hr:attendance:save': {
        count(1); const value = obj(args[0], ['employeeId', 'attendanceDate', 'checkIn', 'checkOut', 'status', 'notes'])
        return saveHrAttendance(this.db, actor, { employeeId: id(value.employeeId), attendanceDate: text(value.attendanceDate, 20),
          checkIn: nullableText(value.checkIn), checkOut: nullableText(value.checkOut), status: text(value.status, 50), notes: text(value.notes) })
      }
      case 'hr:attendance:mark-all-present': count(1); return markAllHrEmployeesPresent(this.db, actor, text(args[0], 20))
      case 'hr:leaves:list': count(1); return listHrLeaveRequests(this.db, args[0] === null ? undefined : text(args[0], 50))
      case 'hr:leaves:create': {
        count(1); const value = obj(args[0], ['employeeId', 'leaveType', 'startDate', 'endDate', 'totalDays', 'reason'])
        if (typeof value.totalDays !== 'number' || !Number.isFinite(value.totalDays)) throw new Error('Invalid leave details.')
        return createHrLeaveRequest(this.db, actor, { employeeId: id(value.employeeId), leaveType: text(value.leaveType, 100),
          startDate: text(value.startDate, 20), endDate: text(value.endDate, 20), totalDays: value.totalDays, reason: text(value.reason) })
      }
      case 'hr:leaves:decide':
        count(2); if (args[1] !== 'Approved' && args[1] !== 'Rejected') throw new Error('Invalid leave decision.')
        return decideHrLeaveRequest(this.db, actor, id(args[0]), args[1])
      case 'hr:leave-balances:list': count(1); return listHrLeaveBalances(this.db, integer(args[0]))
      case 'hr:leave-balances:save': {
        count(1); const value = obj(args[0], ['employeeId', 'leaveType', 'year', 'allocatedDays'])
        if (typeof value.allocatedDays !== 'number' || !Number.isFinite(value.allocatedDays)) throw new Error('Invalid leave balance.')
        return saveHrLeaveBalance(this.db, actor, { employeeId: id(value.employeeId), leaveType: text(value.leaveType, 100),
          year: integer(value.year), allocatedDays: value.allocatedDays })
      }
      case 'hr:documents:list': count(1); return listHrDocuments(this.db, args[0] === null ? undefined : id(args[0]))
      case 'hr:candidates:list': count(0); return listHrCandidates(this.db)
      case 'hr:candidates:create': {
        count(1); const value = obj(args[0], ['uploadId', 'fullName', 'phone', 'email', 'departmentId', 'notes'])
        const draft: HrCandidateDraft = { fullName: text(value.fullName, 120), phone: text(value.phone, 50),
          email: text(value.email, 200), departmentId: id(value.departmentId), notes: text(value.notes) }
        return this.createCandidate(user, session, text(value.uploadId, 64), draft)
      }
      case 'hr:candidates:update': {
        count(1); const value = obj(args[0], ['id', 'fullName', 'phone', 'email', 'departmentId', 'notes'])
        return updateHrCandidate(this.db, actor, { id: id(value.id), fullName: text(value.fullName, 120),
          phone: text(value.phone, 50), email: text(value.email, 200), departmentId: id(value.departmentId), notes: text(value.notes) })
      }
      case 'hr:candidates:star':
        count(2); if (typeof args[1] !== 'boolean') throw new Error('Invalid candidate star setting.')
        return setHrCandidateStarred(this.db, actor, id(args[0]), args[1])
      case 'hr:payroll:list': count(0); return listHrPayrollPeriods(this.db)
      case 'hr:payroll:calculate': count(3); return calculateHrPay(this.db, id(args[0]), text(args[1], 20), text(args[2], 20))
      case 'hr:payroll:records:list': count(1); return listHrPayrollRecords(this.db, id(args[0]))
      case 'hr:payroll:item:add': {
        count(2); const value = obj(args[1], ['itemType', 'description', 'amount'])
        const type = text(value.itemType, 32)
        if (!['Bonus', 'Allowance', 'Deduction', 'Advance Repayment', 'Other Adjustment'].includes(type)) throw new Error('Invalid payroll item details.')
        return addHrPayrollItem(this.db, actor, id(args[0]), { itemType: type as 'Bonus', description: text(value.description, 200), amount: integer(value.amount) })
      }
      case 'hr:payroll:generate': count(2); return generateHrPayroll(this.db, actor, integer(args[0]), integer(args[1]))
      case 'hr:payroll:approve': count(1); return approveHrPayroll(this.db, actor, id(args[0]))
      case 'hr:payroll:paid': count(1); return markHrPayrollPaid(this.db, actor, id(args[0]))
      case 'hr:reports:export': {
        count(1); const report = text(args[0], 20)
        if (!['employees', 'attendance', 'leaves', 'payroll', 'documents', 'activity'].includes(report)) throw new Error('Unsupported HR report.')
        return buildHrCsvReport(this.db, report as HrReportType)
      }
      case 'hr:file:begin': count(5); return this.begin(user, session, args)
      case 'hr:file:chunk': count(3); return this.chunk(user, session, args)
      case 'hr:file:finish': count(1); return this.finish(user, session, text(args[0], 64))
      case 'hr:candidates:cancel-upload':
      case 'hr:file:cancel':
        count(1); this.cancel(user, session, text(args[0], 64)); return
      case 'hr:file:download': count(3); return this.download(text(args[0], 20), id(args[1]), integer(args[2]))
      default: throw new Error('Unsupported HR action.')
    }
  }

  private version(): string {
    const row = this.db.prepare('SELECT salt, password_hash AS hash FROM hr_security_settings WHERE id = 1').get() as { salt: string; hash: string } | undefined
    return row ? `${row.salt}:${row.hash}` : ''
  }
  private employee(record: HrEmployeeRecord, max: number) {
    const { photoPath, ...details } = record
    let photoDataUrl: string | null = null
    if (photoPath && existsSync(photoPath)) {
      try {
        const path = this.safePath(photoPath, join(this.hrDir, 'employee-photos'))
        if (statSync(path).size <= 10 * 1024 * 1024) photoDataUrl = `data:image/jpeg;base64,${this.image(readFileSync(path), max).toString('base64')}`
      } catch { /* Missing or unmanaged photos are not sent. */ }
    }
    return { ...details, photoDataUrl }
  }
  private safePath(path: string, directory: string): string {
    const root = realpathSync(directory)
    const resolved = realpathSync(path)
    const rel = relative(root, resolved)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('File is outside managed HR storage.')
    return resolved
  }
  private deleteEmployee(actor: string, employeeId: number) {
    const documentDir = resolve(this.hrDir, String(employeeId))
    const photoDir = resolve(this.hrDir, 'employee-photos')
    const paths = getHrEmployeeStoredFilePaths(this.db, employeeId)
    for (const path of paths) {
      const absolute = resolve(path)
      const rel = relative(documentDir, absolute)
      const document = Boolean(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
      const photo = resolve(dirname(absolute)) === photoDir && basename(absolute).startsWith(`${employeeId}-`)
      if (!document && !photo) throw new Error('Employee files are outside managed HR storage; no data was deleted.')
      if (existsSync(absolute)) this.safePath(absolute, document ? documentDir : photoDir)
    }
    const deleted = deleteHrEmployee(this.db, actor, employeeId)
    try { for (const path of deleted) rmSync(path, { force: true }) }
    catch { throw new Error('Employee data was deleted, but a stored HR file could not be removed.') }
  }
  private begin(user: AuthUser, session: string, args: unknown[]) {
    const kind = args[0]
    if (kind !== 'photo' && kind !== 'document' && kind !== 'candidate') throw new Error('Invalid upload type.')
    this.expire()
    if (this.uploads.size >= 4 || Array.from(this.uploads.values()).some((item) => item.userId === user.id && item.session === session && !item.complete)) throw new Error('Too many uploads in progress.')
    const employeeId = kind === 'candidate' ? null : id(args[1])
    if (kind === 'candidate' && args[1] !== null) throw new Error('Invalid upload target.')
    if (employeeId !== null) getHrEmployeePhotoPath(this.db, employeeId)
    const file = name(args[2], kind === 'photo')
    const size = integer(args[3])
    if (size < 1 || size > (kind === 'photo' ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE)) throw new Error('Invalid file size.')
    let metadata: Upload['metadata'] = null
    if (kind === 'document') {
      const value = obj(args[4], ['documentType', 'issueDate', 'expirationDate'])
      metadata = { documentType: text(value.documentType, 80),
        ...(value.issueDate === undefined ? {} : { issueDate: text(value.issueDate, 20) }),
        ...(value.expirationDate === undefined ? {} : { expirationDate: text(value.expirationDate, 20) }) }
    } else if (args[4] !== null) throw new Error('Invalid upload details.')
    const token = randomUUID()
    this.uploads.set(token, { userId: user.id, session, kind, employeeId, name: file, size, chunks: [], received: 0, complete: false, expires: Date.now() + 5 * 60_000, metadata })
    return token
  }
  private pending(user: AuthUser, session: string, token: string): Upload {
    this.expire()
    const upload = this.uploads.get(token)
    if (!upload || upload.userId !== user.id || upload.session !== session) throw new Error('Upload expired. Choose the file again.')
    return upload
  }
  private cancel(user: AuthUser, session: string, token: string) {
    this.expire()
    const upload = this.uploads.get(token)
    if (!upload) return
    if (upload.userId !== user.id || upload.session !== session) throw new Error('Upload expired. Choose the file again.')
    this.uploads.delete(token)
  }
  private chunk(user: AuthUser, session: string, args: unknown[]) {
    const upload = this.pending(user, session, text(args[0], 64))
    const encoded = text(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4)
    if (upload.complete || args[1] !== upload.received || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid upload chunk.')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, upload.size - upload.received) || bytes.toString('base64') !== encoded) throw new Error('Invalid upload chunk.')
    upload.chunks.push(bytes); upload.received += bytes.length; upload.expires = Date.now() + 5 * 60_000
    return upload.received
  }
  private finish(user: AuthUser, session: string, token: string) {
    const upload = this.pending(user, session, token)
    if (upload.complete || upload.received !== upload.size) throw new Error('Upload is incomplete.')
    if (upload.kind === 'candidate') { upload.complete = true; upload.expires = Date.now() + 10 * 60_000; return { uploadId: token, fileName: upload.name } }
    this.uploads.delete(token)
    const directory = upload.kind === 'photo' ? join(this.hrDir, 'employee-photos') : join(this.hrDir, String(upload.employeeId))
    mkdirSync(directory, { recursive: true })
    const filePath = join(directory, upload.kind === 'photo' ? `${upload.employeeId}-${randomUUID()}.jpg` : `${randomUUID()}${extname(upload.name).toLowerCase()}`)
    const bytes = Buffer.concat(upload.chunks, upload.size)
    const content = upload.kind === 'photo' ? this.image(bytes, 800) : bytes
    const preview = upload.kind === 'photo' ? this.image(content, 320) : null
    this.writeNew(filePath, content)
    try {
      if (upload.kind === 'photo') {
        setHrEmployeePhotoPath(this.db, user.displayName, upload.employeeId!, filePath)
        return `data:image/jpeg;base64,${preview!.toString('base64')}`
      }
      return addHrDocument(this.db, user.displayName, { employeeId: upload.employeeId!, documentName: upload.name, ...upload.metadata!, filePath })
    } catch (error) { rmSync(filePath, { force: true }); throw error }
  }
  private createCandidate(user: AuthUser, session: string, token: string, draft: HrCandidateDraft) {
    const upload = this.pending(user, session, token)
    if (upload.kind !== 'candidate' || !upload.complete) throw new Error('Candidate upload expired.')
    const directory = join(this.hrDir, 'cvs')
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${randomUUID()}${extname(upload.name).toLowerCase()}`)
    this.writeNew(path, Buffer.concat(upload.chunks, upload.size))
    try {
      const result = addHrCandidate(this.db, user.displayName, draft, upload.name, path)
      this.uploads.delete(token)
      return result
    } catch (error) { rmSync(path, { force: true }); throw error }
  }
  private download(kind: string, recordId: number, offset: number) {
    if (kind !== 'document' && kind !== 'candidate') throw new Error('Invalid document type.')
    if (offset < 0 || offset > DOCUMENT_MAX_SIZE || offset % DOCUMENT_CHUNK_SIZE !== 0) throw new Error('Invalid download offset.')
    const row = (kind === 'document'
      ? this.db.prepare('SELECT document_name AS name, employee_id AS employeeId FROM hr_employee_documents WHERE id = ?').get(recordId)
      : this.db.prepare('SELECT file_name AS name FROM hr_candidates WHERE id = ?').get(recordId)) as { name: string; employeeId?: number } | undefined
    if (!row) throw new Error('HR file not found.')
    const fileName = name(basename(row.name))
    const path = kind === 'document' ? getHrDocumentPath(this.db, recordId) : getHrCandidateFilePath(this.db, recordId)
    const safe = this.safePath(path, kind === 'document' ? join(this.hrDir, String(id(row.employeeId))) : join(this.hrDir, 'cvs'))
    if (!extensions.includes(extname(safe).toLowerCase())) throw new Error('Unsupported document format.')
    const details = statSync(safe)
    if (!details.isFile() || details.size < 1 || details.size > DOCUMENT_MAX_SIZE || offset >= details.size) throw new Error('Document is unavailable or exceeds 25 MB.')
    const descriptor = openSync(safe, 'r')
    try {
      const bytes = Buffer.alloc(Math.min(DOCUMENT_CHUNK_SIZE, details.size - offset))
      if (readSync(descriptor, bytes, 0, bytes.length, offset) !== bytes.length) throw new Error('Document changed during download.')
      return { name: fileName, size: details.size, data: bytes.toString('base64') }
    } finally { closeSync(descriptor) }
  }
  private writeNew(path: string, data: Buffer) {
    try { writeFileSync(path, data, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') rmSync(path, { force: true }); throw error }
  }
  private removeUploads(userId: number, session: string) {
    for (const [token, upload] of this.uploads) if (upload.userId === userId && upload.session === session) this.uploads.delete(token)
  }
  private expire() {
    for (const [key, state] of this.unlocked) if (state.expires < Date.now()) this.unlocked.delete(key)
    for (const [key, upload] of this.uploads) if (upload.expires < Date.now()) this.uploads.delete(key)
  }
}
