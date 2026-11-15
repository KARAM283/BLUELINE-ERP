import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { authenticate, createApplicationUser, updateApplicationUser } from './auth'
import { initializeDatabase } from './database'
import { parseRequest, requestAttendance, startAttendanceServer } from './lanAttendance'
import { DOCUMENT_CHUNK_SIZE } from './lanDocuments'
import { LanHr } from './lanHr'
import { resetHrPassword } from './hrSecurity'

const openssl = process.platform === 'win32' && existsSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe')
  ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : 'openssl'
let hasOpenSsl = false
try { execFileSync(openssl, ['version'], { stdio: 'ignore' }); hasOpenSsl = true } catch { /* Optional integration-test tool. */ }

describe.skipIf(!hasOpenSsl)('shared Human Resources', () => {
  it('isolates HR unlocks and shares records and files through authenticated TLS', async () => {
    const root = join(process.cwd(), `.lan-hr-test-${randomUUID()}`)
    mkdirSync(join(root, 'lan-server'), { recursive: true })
    let db: Database.Database | undefined
    try {
      db = initializeDatabase(new Database(':memory:'))
      const database = db
      execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=hr-test', '-keyout', join(root, 'lan-server', 'key.pem'), '-out', join(root, 'lan-server', 'cert.pem')], { stdio: 'ignore' })
      const admin = createApplicationUser(db, { username: 'test.admin', displayName: 'Admin', role: 'admin', password: 'password123', permissions: ['Human Resources'] })
      const staff = createApplicationUser(db, { username: 'test.staff', displayName: 'Staff', role: 'visa', password: 'password123', permissions: ['Human Resources'] })
      const hr = new LanHr(db, root, (bytes) => bytes)
      const server = await startAttendanceServer(root, { mode: 'server', bindAddress: '127.0.0.1', port: 0 }, {
        authenticate: (name, password) => authenticate(database, name, password), attendance: () => null, hr
      })
      try {
        const address = server.server.address()
        if (!address || typeof address === 'string') throw new Error('No server address.')
        const config = { mode: 'client' as const, host: '127.0.0.1', port: address.port, fingerprint: server.fingerprint.replace(/:/g, '') }
        const first = randomBytes(32).toString('hex')
        const second = randomBytes(32).toString('hex')
        const staffSession = randomBytes(32).toString('hex')
        const call = (operation: string, args: unknown[] = [], session = first, username = admin.username, password = 'password123') =>
          requestAttendance(config, parseRequest({ action: 'hr', username, password, args: [operation, args, session] }))
        const upload = async (kind: string, employeeId: number | null, fileName: string, data: Buffer, metadata: unknown = null) => {
          const token = await call('hr:file:begin', [kind, employeeId, fileName, data.length, metadata]) as string
          for (let offset = 0; offset < data.length; offset += DOCUMENT_CHUNK_SIZE) {
            await call('hr:file:chunk', [token, offset, data.subarray(offset, offset + DOCUMENT_CHUNK_SIZE).toString('base64')])
          }
          return { token, result: await call('hr:file:finish', [token]) }
        }
        const login = await requestAttendance(config, parseRequest({ action: 'login', username: admin.username, password: 'password123', args: [] })) as { permissions: string[] }
        expect(login.permissions).toContain('Human Resources')
        await expect(call('hr:dashboard')).rejects.toThrow('Unlock Human Resources')
        await call('hr:auth:setup', ['hrpassword1'])
        await expect(call('hr:dashboard', [], second)).rejects.toThrow('Unlock Human Resources')
        await call('hr:auth:unlock', ['hrpassword1'], second)
        await call('hr:auth:unlock', ['hrpassword1'], staffSession, staff.username)
        await expect(call('hr:users:list', [], staffSession, staff.username)).rejects.toThrow('administrator')
        await expect(call('hr:auth:change', ['hrpassword1', 'hrpassword2'], staffSession, staff.username)).rejects.toThrow('administrator')
        await expect(call('hr:auth:reset', ['password123', 'hrpassword2'], staffSession, staff.username)).rejects.toThrow('administrator')
        await expect(call('hr:users:list')).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: staff.id })]))

        const departments = await call('hr:departments:list') as Array<{ id: number; name: string }>
        const departmentId = departments.find((department) => department.name === 'CRM')!.id
        await call('hr:departments:save', [{ name: 'Shared department', description: 'Office' }])
        expect(await call('hr:departments:list')).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Shared department' })]))
        const employee = await call('hr:employees:save', [{ fullName: 'Test Employee', phone: '5550100', email: '', departmentId,
          jobTitle: 'Officer', hireDate: '2026-01-01', employmentType: 'Full-time', status: 'Active', hourlyRate: 1000 }]) as { id: number }
        await expect(call('hr:employees:save', [{ id: employee.id, fullName: 'Test Employee', phone: '', email: '', departmentId,
          jobTitle: 'Officer', hireDate: '2026-01-01', employmentType: 'Full-time', status: 'Active', hourlyRate: 1000, appUserId: staff.id }],
        staffSession, staff.username)).rejects.toThrow('administrator')
        await call('hr:attendance:save', [{ employeeId: employee.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: '16:00', status: 'Present', notes: '' }])
        expect(await call('hr:attendance:calendar', [2026, 4, employee.id])).toEqual(expect.arrayContaining([expect.objectContaining({ date: '2026-04-01' })]))
        await call('hr:leave-balances:save', [{ employeeId: employee.id, leaveType: 'Annual Leave', year: 2026, allocatedDays: 10 }])
        await call('hr:leaves:create', [{ employeeId: employee.id, leaveType: 'Annual Leave', startDate: '2026-04-06', endDate: '2026-04-07', totalDays: 2, reason: 'Travel' }])
        const leaves = await call('hr:leaves:list', [null]) as Array<{ id: number }>
        await call('hr:leaves:decide', [leaves[0].id, 'Approved'])
        await call('hr:payroll:generate', [4, 2026])
        const periods = await call('hr:payroll:list') as Array<{ id: number }>
        const payroll = await call('hr:payroll:records:list', [periods[0].id]) as Array<{ id: number }>
        await call('hr:payroll:item:add', [payroll[0].id, { itemType: 'Bonus', description: 'Bonus', amount: 100 }])
        await call('hr:payroll:approve', [periods[0].id])
        await call('hr:payroll:paid', [periods[0].id])
        expect(await call('hr:reports:export', ['employees'])).toContain('Test Employee')

        const data = Buffer.alloc(DOCUMENT_CHUNK_SIZE + 13, 0x61)
        const doc = (await upload('document', employee.id, 'contract.pdf', data, { documentType: 'Contract' })).result as { id: number }
        const path = (db.prepare('SELECT file_path AS path FROM hr_employee_documents WHERE id = ?').get(doc.id) as { path: string }).path
        expect(path.startsWith(join(root, 'documents', 'hr'))).toBe(true)
        expect(readFileSync(path)).toEqual(data)
        const chunk1 = await call('hr:file:download', ['document', doc.id, 0]) as { data: string }
        const chunk2 = await call('hr:file:download', ['document', doc.id, DOCUMENT_CHUNK_SIZE]) as { data: string }
        expect(Buffer.concat([Buffer.from(chunk1.data, 'base64'), Buffer.from(chunk2.data, 'base64')])).toEqual(data)
        expect((await upload('photo', employee.id, 'photo.jpg', Buffer.from('image'))).result).toContain('data:image/jpeg;base64,')
        const profile = await call('hr:employees:profile', [employee.id])
        expect(JSON.stringify(profile)).not.toContain(root.replace(/\\/g, '\\\\'))
        const cv = await upload('candidate', null, 'candidate.pdf', data)
        await expect(call('hr:candidates:create', [{ uploadId: cv.token, fullName: 'Candidate One', phone: '', email: '', departmentId, notes: '' }], second)).rejects.toThrow()
        const candidate = await call('hr:candidates:create', [{ uploadId: cv.token, fullName: 'Candidate One', phone: '', email: '', departmentId, notes: '' }]) as { id: number }
        await call('hr:candidates:cancel-upload', [cv.token])
        expect(Buffer.from((await call('hr:file:download', ['candidate', candidate.id, 0]) as { data: string }).data, 'base64')).toEqual(data.subarray(0, DOCUMENT_CHUNK_SIZE))
        const outside = join(root, 'outside.pdf')
        writeFileSync(outside, 'private')
        db.prepare('UPDATE hr_employee_documents SET file_path = ? WHERE id = ?').run(outside, doc.id)
        await expect(call('hr:file:download', ['document', doc.id, 0])).rejects.toThrow()
        db.prepare('UPDATE hr_employee_documents SET file_path = ? WHERE id = ?').run(path, doc.id)

        await call('hr:auth:change', ['hrpassword1', 'hrpassword2'])
        await expect(call('hr:dashboard', [], second)).rejects.toThrow('Unlock Human Resources')
        await expect(call('hr:dashboard', [], staffSession, staff.username)).rejects.toThrow('Unlock Human Resources')
        await call('hr:auth:unlock', ['hrpassword2'], second)
        await call('hr:auth:reset', ['password123', 'hrpassword3'])
        await expect(call('hr:dashboard', [], second)).rejects.toThrow('Unlock Human Resources')
        await call('hr:auth:unlock', ['hrpassword3'], staffSession, staff.username)
        updateApplicationUser(db, admin.id, { ...staff, permissions: ['CRM'] })
        await expect(call('hr:dashboard', [], staffSession, staff.username)).rejects.toThrow('permission')
        updateApplicationUser(db, admin.id, { ...staff, permissions: ['Human Resources'] })
        await expect(call('hr:dashboard', [], staffSession, staff.username)).rejects.toThrow('Unlock Human Resources')
        resetHrPassword(db, 'Host', 'hrpassword4')
        await expect(call('hr:dashboard')).rejects.toThrow('Unlock Human Resources')
        await call('hr:auth:unlock', ['hrpassword4'])
        await expect(call('hr:dashboard', [], first, admin.username, 'incorrect')).rejects.toThrow('Username or password')
        await expect(call('hr:arbitrary:filesystem', ['C:\\secret'])).rejects.toThrow()
        await call('hr:auth:lock')
        await expect(call('hr:dashboard')).rejects.toThrow('Unlock Human Resources')
        for (let attempt = 0; attempt < 4; attempt++) await expect(call('hr:auth:unlock', ['incorrect'])).rejects.toThrow('HR password is incorrect')
        await expect(call('hr:auth:unlock', ['hrpassword4'])).rejects.toThrow('Too many failed sign-in attempts')
      } finally {
        await new Promise<void>((resolve, reject) => server.server.close((error) => error ? reject(error) : resolve()))
      }
    } finally { db?.close(); rmSync(root, { recursive: true, force: true }) }
  }, 60000)
})
