import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeAuthDatabase } from './auth'
import {
  addHrCandidate, approveHrPayroll, archiveHrEmployee, createHrLeaveRequest, decideHrLeaveRequest, deleteHrEmployee,
  addHrDocument, addHrPayrollItem, buildHrCsvReport, calculateHrPay, clockHrAttendance, clockInHrAttendanceForUser, clockOutHrAttendanceForUser, generateHrPayroll,
  getHrDashboard, getHrEmployeePhotoPath, getHrEmployeeProfileData, getHrEmployeeStoredFilePaths, getHrSelfAttendanceCalendar, getHrSelfAttendanceStatus, initializeHrDatabase, listHrAttendance,
  listHrAttendanceCalendar, listHrCandidates, listHrDepartments, listHrDocuments, listHrEmployees, listHrLeaveBalances, listHrLeaveRequests, listHrPayrollPeriods,
  listHrPayrollRecords, markAllHrEmployeesPresent, markHrPayrollPaid, saveHrAttendance, saveHrDepartment,
  purgeHrCandidatesFromDepartments, saveHrEmployee, saveHrLeaveBalance, setHrCandidateStarred, setHrEmployeePhotoPath, updateHrCandidate
} from './hrDatabase'

describe('HR database workflows', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    initializeAuthDatabase(db)
    initializeHrDatabase(db)
  })

  afterEach(() => db.close())

  function employee(name = 'Amina Example', hourlyRate = 1_000, status = 'Active') {
    return saveHrEmployee(db, 'Admin', {
      fullName: name, phone: '0770000000', email: '', departmentId: null, jobTitle: 'Coordinator',
      hireDate: '2026-01-01', employmentType: 'Full-time', status, hourlyRate
    })
  }

  it('creates unique employee codes and archives without deleting history', () => {
    const first = employee('Amina Example')
    const second = employee('Noor Example')
    expect(first.employeeCode).toBe('BL-EMP-001')
    expect(second.employeeCode).toBe('BL-EMP-002')
    saveHrAttendance(db, 'Admin', {
      employeeId: first.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: null,
      status: 'Present', notes: ''
    })
    saveHrEmployee(db, 'Admin', {
      id: first.id, fullName: first.fullName, phone: first.phone, email: first.email,
      departmentId: first.departmentId, jobTitle: first.jobTitle, hireDate: first.hireDate,
      employmentType: first.employmentType, status: 'On Leave', hourlyRate: first.hourlyRate
    })

    archiveHrEmployee(db, 'Admin', first.id, true)
    expect(listHrEmployees(db)).toHaveLength(1)
    expect(listHrEmployees(db, '', true)).toHaveLength(2)
    archiveHrEmployee(db, 'Admin', first.id, false)
    expect(listHrEmployees(db)[0].status).toBe('On Leave')
    expect(db.prepare('SELECT COUNT(*) AS count FROM hr_attendance WHERE employee_id = ?').get(first.id)).toEqual({ count: 1 })
  })

  it('permanently removes employee HR records and files while retaining an audit entry and employee-code sequence', () => {
    const person = employee()
    saveHrAttendance(db, 'Admin', {
      employeeId: person.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: '16:00',
      status: 'Present', notes: ''
    })
    saveHrLeaveBalance(db, 'Admin', {
      employeeId: person.id, leaveType: 'Annual Leave', year: 2026, allocatedDays: 10
    })
    createHrLeaveRequest(db, 'Admin', {
      employeeId: person.id, leaveType: 'Annual Leave', startDate: '2026-05-01', endDate: '2026-05-02',
      totalDays: 2, reason: ''
    })
    const payrollPeriodId = Number(db.prepare(`INSERT INTO hr_payroll_periods(month, year, status, created_by)
      VALUES (4, 2026, 'Paid', 'Admin')`).run().lastInsertRowid)
    const payrollRecordId = Number(db.prepare(`INSERT INTO hr_payroll_records(employee_id, payroll_period_id,
      basic_salary, hourly_rate, worked_minutes, total_bonuses, total_allowances, total_deductions,
      total_advance_repayments, net_salary, payment_status)
      VALUES (?, ?, 1000, 1000, 60, 0, 0, 0, 0, 1000, 'Paid')`).run(person.id, payrollPeriodId).lastInsertRowid)
    addHrPayrollItem(db, 'Admin', payrollRecordId, { itemType: 'Allowance', description: 'Travel', amount: 100 })
    const advanceId = Number(db.prepare(`INSERT INTO hr_employee_advances(employee_id, advance_amount,
      outstanding_balance, issue_date, created_by) VALUES (?, 500, 300, '2026-04-01', 'Admin')`)
      .run(person.id).lastInsertRowid)
    db.prepare(`INSERT INTO hr_advance_repayments(advance_id, payroll_record_id, amount, repayment_date, created_by)
      VALUES (?, ?, 200, '2026-04-30', 'Admin')`).run(advanceId, payrollRecordId)
    addHrDocument(db, 'Admin', {
      employeeId: person.id, documentName: 'contract.pdf', documentType: 'Contract', filePath: 'hr/1/contract.pdf'
    })
    setHrEmployeePhotoPath(db, 'Admin', person.id, 'hr/employee-photos/1-photo.png')

    expect(getHrEmployeeStoredFilePaths(db, person.id)).toEqual([
      'hr/1/contract.pdf', 'hr/employee-photos/1-photo.png'
    ])
    expect(deleteHrEmployee(db, 'Admin', person.id)).toEqual([
      'hr/1/contract.pdf', 'hr/employee-photos/1-photo.png'
    ])
    for (const table of [
      'hr_attendance', 'hr_leave_balances', 'hr_leave_requests', 'hr_payroll_records',
      'hr_payroll_items', 'hr_employee_advances', 'hr_advance_repayments', 'hr_employee_documents'
    ]) {
      const count = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }
      expect(count.count, table).toBe(0)
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM hr_payroll_periods').get()).toEqual({ count: 1 })
    expect(db.prepare("SELECT action, old_values AS oldValues FROM hr_audit_logs WHERE entity_type = 'employee' AND entity_id = ? ORDER BY id DESC LIMIT 1")
      .get(person.id)).toMatchObject({ action: 'deleted', oldValues: expect.stringContaining(person.employeeCode) })
    expect(employee('Next employee').employeeCode).toBe('BL-EMP-002')
    expect(() => deleteHrEmployee(db, 'Admin', person.id)).toThrow('Employee not found')
  })

  it('stores candidates in department pipelines and persists stars and department changes', () => {
    const departments = listHrDepartments(db)
    const crm = departments.find(({ name }) => name === 'CRM')!
    const operations = departments.find(({ name }) => name === 'Operations')!
    const candidate = addHrCandidate(db, 'Admin', {
      fullName: 'Noor Example', phone: '0770000000', email: 'noor@example.com',
      departmentId: crm.id, notes: 'Strong communication'
    }, 'noor-cv.pdf', 'hr/cvs/noor-cv.pdf')

    expect(candidate).toMatchObject({
      fullName: 'Noor Example', departmentId: crm.id, departmentName: 'CRM',
      fileName: 'noor-cv.pdf', isStarred: false
    })
    setHrCandidateStarred(db, 'Admin', candidate.id, true)
    const updated = updateHrCandidate(db, 'Admin', {
      id: candidate.id, fullName: candidate.fullName, phone: candidate.phone, email: candidate.email,
      departmentId: operations.id, notes: candidate.notes
    })
    expect(updated).toMatchObject({ departmentId: operations.id, departmentName: 'Operations', isStarred: true })
    expect(listHrCandidates(db)).toEqual([updated])
    expect(db.prepare("SELECT action FROM hr_audit_logs WHERE entity_type = 'candidate' ORDER BY id").all())
      .toEqual([{ action: 'created' }, { action: 'starred' }, { action: 'updated' }])
    expect(() => updateHrCandidate(db, 'Admin', {
      id: candidate.id, fullName: '', phone: '', email: '', departmentId: operations.id, notes: ''
    })).toThrow('Invalid candidate details')
  })

  it('seeds Media and removes the selected CV departments without deleting HR departments', () => {
    const departments = listHrDepartments(db)
    const officeBoy = departments.find(({ name }) => name === 'Office Boy')!
    const manager = departments.find(({ name }) => name === 'Manager')!
    const crm = departments.find(({ name }) => name === 'CRM')!
    expect(departments.some(({ name }) => name === 'Media')).toBe(true)
    addHrCandidate(db, 'Admin', {
      fullName: 'Office Candidate', phone: '', email: '', departmentId: officeBoy.id, notes: ''
    }, 'office.pdf', 'hr/cvs/office.pdf')
    addHrCandidate(db, 'Admin', {
      fullName: 'Manager Candidate', phone: '', email: '', departmentId: manager.id, notes: ''
    }, 'manager.pdf', 'hr/cvs/manager.pdf')
    addHrCandidate(db, 'Admin', {
      fullName: 'CRM Candidate', phone: '', email: '', departmentId: crm.id, notes: ''
    }, 'crm.pdf', 'hr/cvs/crm.pdf')

    expect(purgeHrCandidatesFromDepartments(db, 'System migration')).toEqual(expect.arrayContaining([
      'hr/cvs/office.pdf', 'hr/cvs/manager.pdf'
    ]))
    expect(purgeHrCandidatesFromDepartments(db, 'System migration')).toEqual([])
    expect(listHrCandidates(db).map(({ fullName }) => fullName)).toEqual(['CRM Candidate'])
    expect(listHrDepartments(db).map(({ name }) => name)).toEqual(expect.arrayContaining(['Media', 'Office Boy', 'Manager']))
    expect(db.prepare(`SELECT COUNT(*) AS count FROM hr_audit_logs
      WHERE entity_type = 'candidate' AND action = 'deleted'`).get()).toEqual({ count: 2 })
  })

  it('validates daily attendance and makes mark-all-present idempotent', () => {
    const first = employee()
    employee('Noor Example')
    expect(markAllHrEmployeesPresent(db, 'Admin', '2026-04-01')).toBe(2)
    expect(markAllHrEmployeesPresent(db, 'Admin', '2026-04-01')).toBe(0)
    expect(listHrAttendance(db, '2026-04-01')).toHaveLength(2)
    expect(() => saveHrAttendance(db, 'Admin', {
      employeeId: first.id, attendanceDate: '2026-04-01', checkIn: '10:00', checkOut: '09:00',
      status: 'Present', notes: ''
    })).toThrow('Check-out must not be earlier')
    saveHrAttendance(db, 'Admin', {
      employeeId: first.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: '16:00',
      status: 'Present', notes: ''
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM hr_attendance').get()).toEqual({ count: 2 })
  })

  it('records one-tap local check-in and check-out and summarizes calendar days', () => {
    const person = employee()
    const anotherPerson = employee('Bina Example')
    const checkIn = new Date(2026, 3, 1, 8, 15)
    const checkOut = new Date(2026, 3, 1, 16, 45)
    clockHrAttendance(db, 'Admin', person.id, 'in', checkIn)
    expect(() => clockHrAttendance(db, 'Admin', person.id, 'in', checkIn)).toThrow('already checked in')
    clockHrAttendance(db, 'Admin', person.id, 'out', checkOut)
    expect(() => clockHrAttendance(db, 'Admin', person.id, 'out', checkOut)).toThrow('already checked out')
    clockHrAttendance(db, 'Admin', anotherPerson.id, 'in', checkIn)
    clockHrAttendance(db, 'Admin', anotherPerson.id, 'out', checkOut)
    expect(listHrAttendance(db, '2026-04-01')[0]).toMatchObject({ checkIn: '08:15', checkOut: '16:45' })
    expect(listHrAttendanceCalendar(db, 2026, 4)).toEqual([
      { date: '2026-04-01', total: 2, checkedIn: 2, checkedOut: 2, dayOffCount: 0 }
    ])
    expect(listHrAttendanceCalendar(db, 2026, 4, person.id)).toEqual([
      {
        date: '2026-04-01', total: 1, checkedIn: 1, checkedOut: 1, dayOffCount: 0,
        status: 'Present', checkIn: '08:15', checkOut: '16:45'
      }
    ])
  })

  it('checks in the assigned active employee and stops prompting after recording attendance', () => {
    const person = employee('Karam')
    const user = db.prepare('SELECT id FROM app_users WHERE username = ?').get('karam') as { id: number }
    db.prepare('INSERT INTO hr_employee_user_assignments(employee_id, user_id) VALUES (?, ?)').run(person.id, user.id)
    const at = new Date(2026, 3, 1, 8, 15)
    expect(getHrSelfAttendanceStatus(db, user.id, '2026-04-01')).toMatchObject({
      employeeName: 'Karam', attendanceDate: '2026-04-01', checkIn: null, shouldPrompt: true
    })
    expect(clockInHrAttendanceForUser(db, user.id, 'Karam', at)).toMatchObject({
      employeeName: 'Karam', attendanceDate: '2026-04-01', checkIn: '08:15', checkOut: null, shouldPrompt: false
    })
    expect(clockOutHrAttendanceForUser(db, user.id, 'Karam', new Date(2026, 3, 1, 16, 30))).toMatchObject({
      employeeName: 'Karam', attendanceDate: '2026-04-01', checkIn: '08:15', checkOut: '16:30'
    })
    expect(() => clockOutHrAttendanceForUser(db, user.id, 'Karam', new Date(2026, 3, 1, 16, 45))).toThrow('already checked out')
    expect(listHrAttendance(db, '2026-04-01')).toMatchObject([
      {
        employeeId: person.id, checkIn: '08:15', checkOut: '16:30', status: 'Present',
        appUserDisplayName: 'Karam', appUsername: 'karam'
      }
    ])
    expect(getHrSelfAttendanceStatus(db, user.id, '2026-04-01').shouldPrompt).toBe(false)
  })

  it('limits the My Attendance calendar to the signed-in user assigned employee', () => {
    const assigned = employee('Karam')
    const other = employee('Hind')
    const user = db.prepare('SELECT id FROM app_users WHERE username = ?').get('karam') as { id: number }
    db.prepare('INSERT INTO hr_employee_user_assignments(employee_id, user_id) VALUES (?, ?)').run(assigned.id, user.id)
    saveHrAttendance(db, 'Admin', {
      employeeId: assigned.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: '16:00',
      status: 'Present', notes: ''
    })
    saveHrAttendance(db, 'Admin', {
      employeeId: other.id, attendanceDate: '2026-04-02', checkIn: '09:00', checkOut: '17:00',
      status: 'Present', notes: ''
    })

    expect(getHrSelfAttendanceCalendar(db, user.id, 2026, 4)).toEqual([{
      date: '2026-04-01', total: 1, checkedIn: 1, checkedOut: 1, dayOffCount: 0,
      status: 'Present', checkIn: '08:00', checkOut: '16:00'
    }])
    const unassignedUser = db.prepare('SELECT id FROM app_users WHERE username = ?').get('hind') as { id: number }
    expect(() => getHrSelfAttendanceCalendar(db, unassignedUser.id, 2026, 4)).toThrow('No employee profile is assigned')
  })

  it('requires an assigned profile and prevents assigning one app user to multiple employees', () => {
    const first = employee('Karam')
    const second = employee('Hind')
    const karam = db.prepare('SELECT id FROM app_users WHERE username = ?').get('karam') as { id: number }
    expect(() => getHrSelfAttendanceStatus(db, karam.id, '2026-04-01')).toThrow('No employee profile is assigned')
    saveHrEmployee(db, 'Admin', {
      id: first.id, fullName: first.fullName, phone: first.phone, email: first.email, departmentId: first.departmentId,
      jobTitle: first.jobTitle, hireDate: first.hireDate, employmentType: first.employmentType,
      status: first.status, hourlyRate: first.hourlyRate, appUserId: karam.id
    })
    expect(() => saveHrEmployee(db, 'Admin', {
      id: second.id, fullName: second.fullName, phone: second.phone, email: second.email, departmentId: second.departmentId,
      jobTitle: second.jobTitle, hireDate: second.hireDate, employmentType: second.employmentType,
      status: second.status, hourlyRate: second.hourlyRate, appUserId: karam.id
    })).toThrow('already assigned')
    expect(listHrEmployees(db).find(({ id }) => id === first.id)).toMatchObject({
      appUserId: karam.id, appUsername: 'karam', appUserDisplayName: 'Karam'
    })
    saveHrEmployee(db, 'Admin', {
      id: first.id, fullName: first.fullName, phone: first.phone, email: first.email, departmentId: first.departmentId,
      jobTitle: first.jobTitle, hireDate: first.hireDate, employmentType: first.employmentType,
      status: first.status, hourlyRate: first.hourlyRate, appUserId: null
    })
    expect(() => getHrSelfAttendanceStatus(db, karam.id, '2026-04-01')).toThrow('No employee profile is assigned')
  })

  it('records an employee day off in attendance and marks the calendar date', () => {
    const person = employee('Karam')
    const user = db.prepare('SELECT id FROM app_users WHERE username = ?').get('karam') as { id: number }
    db.prepare('INSERT INTO hr_employee_user_assignments(employee_id, user_id) VALUES (?, ?)').run(person.id, user.id)
    saveHrAttendance(db, 'Admin', {
      employeeId: person.id, attendanceDate: '2026-04-02', checkIn: null, checkOut: null,
      status: 'Day Off', notes: ''
    })
    expect(listHrAttendance(db, '2026-04-02')[0]).toMatchObject({ status: 'Day Off', checkIn: null, checkOut: null })
    expect(getHrSelfAttendanceStatus(db, user.id, '2026-04-02').shouldPrompt).toBe(false)
    expect(listHrAttendanceCalendar(db, 2026, 4)).toContainEqual({
      date: '2026-04-02', total: 1, checkedIn: 0, checkedOut: 0, dayOffCount: 1
    })
    expect(listHrAttendanceCalendar(db, 2026, 4, person.id)).toContainEqual({
      date: '2026-04-02', total: 1, checkedIn: 0, checkedOut: 0, dayOffCount: 1,
      status: 'Day Off', checkIn: null, checkOut: null
    })
  })

  it('calculates IQD pay from complete attendance hours and employee hourly rate', () => {
    const person = employee('Amina Example', 1_250)
    saveHrAttendance(db, 'Admin', {
      employeeId: person.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: '12:30',
      status: 'Present', notes: ''
    })
    expect(calculateHrPay(db, person.id, '2026-04-01', '2026-04-30')).toEqual({
      employeeId: person.id, employeeName: 'Amina Example', hourlyRate: 1_250, workedMinutes: 270, grossPay: 5_625
    })
  })

  it('approves leave transactionally and rejects overlapping approved requests', () => {
    const person = employee()
    saveHrLeaveBalance(db, 'Admin', { employeeId: person.id, leaveType: 'Annual Leave', year: 2026, allocatedDays: 5 })
    createHrLeaveRequest(db, 'Admin', {
      employeeId: person.id, leaveType: 'Annual Leave', startDate: '2026-05-01', endDate: '2026-05-03',
      totalDays: 3, reason: 'Family'
    })
    const first = listHrLeaveRequests(db)[0]
    decideHrLeaveRequest(db, 'Admin', first.id, 'Approved')
    expect(listHrLeaveBalances(db, 2026)[0].remainingDays).toBe(2)
    expect(() => saveHrLeaveBalance(db, 'Admin', {
      employeeId: person.id, leaveType: 'Annual Leave', year: 2026, allocatedDays: 2
    })).toThrow('lower than days already used')
    createHrLeaveRequest(db, 'Admin', {
      employeeId: person.id, leaveType: 'Sick Leave', startDate: '2026-05-03', endDate: '2026-05-04',
      totalDays: 2, reason: ''
    })
    const second = listHrLeaveRequests(db).find((request) => request.status === 'Pending')!
    expect(() => decideHrLeaveRequest(db, 'Admin', second.id, 'Approved')).toThrow('overlaps')
    expect(listHrLeaveRequests(db).find((request) => request.id === second.id)?.status).toBe('Pending')
  })

  it('generates integer-IQD payroll, applies review items, and locks approved periods', () => {
    const first = employee('Amina Example', 1_000)
    const second = employee('Noor Example', 1_500)
    for (const person of [first, second]) {
      saveHrAttendance(db, 'Admin', {
        employeeId: person.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: '16:00',
        status: 'Present', notes: ''
      })
    }
    generateHrPayroll(db, 'Admin', 4, 2026)
    expect(listHrPayrollPeriods(db)[0]).toMatchObject({ employeeCount: 2, totalNet: 20_000, status: 'Draft' })
    expect(() => generateHrPayroll(db, 'Admin', 4, 2026)).toThrow('already exists')
    const period = listHrPayrollPeriods(db)[0]
    const record = listHrPayrollRecords(db, period.id)[0]
    expect(record).toMatchObject({ hourlyRate: 1_000, workedMinutes: 480, basicSalary: 8_000 })
    addHrPayrollItem(db, 'Admin', record.id, { itemType: 'Bonus', description: 'Monthly bonus', amount: 50_000 })
    addHrPayrollItem(db, 'Admin', record.id, { itemType: 'Allowance', description: 'Travel allowance', amount: 25_000 })
    addHrPayrollItem(db, 'Admin', record.id, { itemType: 'Deduction', description: 'Approved deduction', amount: 20_000 })
    addHrPayrollItem(db, 'Admin', record.id, { itemType: 'Advance Repayment', description: 'Approved installment', amount: 50_000 })
    expect(listHrPayrollRecords(db, period.id)[0].netSalary).toBe(13_000)
    expect(() => addHrPayrollItem(db, 'Admin', record.id, {
      itemType: 'Deduction', description: 'Too large', amount: 600_000
    })).toThrow('net salary invalid')
    approveHrPayroll(db, 'Admin', period.id)
    expect(() => approveHrPayroll(db, 'Admin', period.id)).toThrow('Only draft')
    expect(() => addHrPayrollItem(db, 'Admin', record.id, {
      itemType: 'Bonus', description: 'Late item', amount: 100
    })).toThrow('only be changed in draft')
    markHrPayrollPaid(db, 'Admin', period.id)
    expect(listHrPayrollPeriods(db)[0].status).toBe('Paid')
    expect(getHrDashboard(db, '2026-04-15').currentMonthPayrollTotal).toBe(25_000)
  })

  it('does not create an empty payroll period when no active employees exist', () => {
    expect(() => generateHrPayroll(db, 'Admin', 1, 2026)).toThrow('No active employees')
    expect(listHrPayrollPeriods(db)).toHaveLength(0)
  })

  it('enforces department links and writes audit records', () => {
    saveHrDepartment(db, 'Admin', { name: 'Finance', description: '' })
    const department = db.prepare('SELECT id FROM hr_departments WHERE name = ?').get('Finance') as { id: number }
    const saved = saveHrEmployee(db, 'Admin', {
      fullName: 'Amina Example', phone: '', email: '', departmentId: department.id, jobTitle: 'Lead',
      hireDate: '2026-01-01', employmentType: 'Full-time', status: 'Active', hourlyRate: 100
    })
    expect(saved.departmentName).toBe('Operations')
    expect(db.prepare('SELECT COUNT(*) AS count FROM hr_audit_logs').get()).toEqual({ count: 2 })
    expect(() => saveHrEmployee(db, 'Admin', {
      fullName: 'Invalid Person', phone: '', email: '', departmentId: 999, jobTitle: '',
      hireDate: '2026-01-01', employmentType: 'Full-time', status: 'Active', hourlyRate: 100
    })).toThrow('Selected department')
  })

  it('stores paired employee work hours and preserves omitted hours on updates', () => {
    const input = {
      fullName: 'Scheduled Employee', phone: '', email: '', departmentId: null, jobTitle: 'Coordinator',
      hireDate: '2026-01-01', employmentType: 'Full-time', status: 'Active', hourlyRate: 1_000
    }
    const person = saveHrEmployee(db, 'Admin', input)
    const scheduled = saveHrEmployee(db, 'Admin', {
      ...input, id: person.id, workStart: '09:00', workEnd: '17:00'
    })
    expect(scheduled).toMatchObject({ workStart: '09:00', workEnd: '17:00' })
    expect(saveHrEmployee(db, 'Admin', { ...input, id: person.id })).toMatchObject({
      workStart: '09:00', workEnd: '17:00'
    })
    expect(() => saveHrEmployee(db, 'Admin', {
      ...input, id: person.id, workStart: '09:00', workEnd: null
    })).toThrow('Set both scheduled work hours')
    expect(() => saveHrEmployee(db, 'Admin', {
      ...input, id: person.id, workStart: '17:00', workEnd: '09:00'
    })).toThrow('end time later than the start time')
    expect(saveHrEmployee(db, 'Admin', {
      ...input, id: person.id, workStart: null, workEnd: null
    })).toMatchObject({ workStart: null, workEnd: null })
  })

  it('seeds requested departments without duplicating or overwriting existing departments', () => {
    const initialCount = listHrDepartments(db).length
    db.prepare("UPDATE hr_departments SET description = 'Keep this description' WHERE name = 'Operations'").run()
    initializeHrDatabase(db)
    const departments = listHrDepartments(db)
    expect(departments.map((department) => department.name)).toEqual(expect.arrayContaining([
      'VISA', 'Operations', 'Manager', 'Office Boy', 'Accountant', 'CRM'
    ]))
    expect(departments).toHaveLength(initialCount)
    expect(departments.find((department) => department.name === 'Operations')?.description).toBe('Keep this description')
  })

  it('migrates employee photos additively and returns real profile history', () => {
    const legacy = new Database(':memory:')
    legacy.pragma('foreign_keys = ON')
    initializeAuthDatabase(legacy)
    legacy.exec(`CREATE TABLE hr_employees (
      id INTEGER PRIMARY KEY,
      employee_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      department_id INTEGER,
      job_title TEXT NOT NULL DEFAULT '',
      hire_date TEXT NOT NULL,
      employment_type TEXT NOT NULL DEFAULT 'Full-time',
      status TEXT NOT NULL DEFAULT 'Active',
      basic_salary INTEGER NOT NULL DEFAULT 0,
      hourly_rate INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      archived_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO hr_employees(employee_code, full_name, hire_date)
      VALUES ('BL-EMP-009', 'Legacy Employee', '2025-01-01');`)
    initializeHrDatabase(legacy)
    expect(legacy.prepare('SELECT employee_code, full_name, photo_path, work_start, work_end FROM hr_employees').get())
      .toMatchObject({ employee_code: 'BL-EMP-009', full_name: 'Legacy Employee', photo_path: null, work_start: null, work_end: null })
    legacy.close()

    const person = employee()
    saveHrAttendance(db, 'Admin', {
      employeeId: person.id, attendanceDate: '2026-04-01', checkIn: '08:00', checkOut: '16:00',
      status: 'Late', notes: 'Recorded late arrival'
    })
    saveHrLeaveBalance(db, 'Admin', { employeeId: person.id, leaveType: 'Annual Leave', year: 2026, allocatedDays: 10 })
    createHrLeaveRequest(db, 'Admin', {
      employeeId: person.id, leaveType: 'Annual Leave', startDate: '2026-05-01', endDate: '2026-05-02',
      totalDays: 2, reason: 'Personal leave'
    })
    addHrDocument(db, 'Admin', {
      employeeId: person.id, documentName: 'contract.pdf', documentType: 'Employment Contract',
      filePath: 'private/hr/1/contract.pdf'
    })
    generateHrPayroll(db, 'Admin', 4, 2026)
    const payrollRecord = listHrPayrollRecords(db, listHrPayrollPeriods(db)[0].id)[0]
    addHrPayrollItem(db, 'Admin', payrollRecord.id, {
      itemType: 'Allowance', description: 'Travel allowance', amount: 500
    })
    setHrEmployeePhotoPath(db, 'Admin', person.id, 'private/hr/employee-photos/1.png')

    expect(getHrEmployeePhotoPath(db, person.id)).toBe('private/hr/employee-photos/1.png')
    const profile = getHrEmployeeProfileData(db, person.id)
    expect(profile.employee).toMatchObject({ id: person.id, fullName: person.fullName })
    expect(profile.attendance).toHaveLength(1)
    expect(profile.leaveRequests).toHaveLength(1)
    expect(profile.leaveBalances).toHaveLength(1)
    expect(profile.payroll).toHaveLength(1)
    expect(profile.documents).toHaveLength(1)
    expect(profile.activity.map((item) => item.action)).toEqual(expect.arrayContaining([
      'created', 'photo updated', 'generated', 'item added'
    ]))
  })

  it('stores private employee document metadata and audits the upload', () => {
    const person = employee()
    const document = addHrDocument(db, 'Admin', {
      employeeId: person.id, documentName: 'contract.pdf', documentType: 'Employment Contract',
      issueDate: '2026-01-01', expirationDate: '2027-01-01', filePath: 'private/hr/1/file.pdf'
    })
    expect(listHrDocuments(db, person.id)).toEqual([document])
    expect(db.prepare("SELECT action FROM hr_audit_logs WHERE entity_type = 'employee_document'").get()).toEqual({ action: 'uploaded' })
  })

  it('exports actual HR rows with spreadsheet formula characters neutralized', () => {
    employee('=1+1')
    const report = buildHrCsvReport(db, 'employees')
    expect(report).toContain('"\'=1+1"')
    expect(report).toContain('"BL-EMP-001"')
  })

  it('exports scheduled overtime and late-arrival deduction in minutes', () => {
    const scheduled = saveHrEmployee(db, 'Admin', {
      fullName: 'Scheduled Employee', phone: '', email: '', departmentId: null, jobTitle: 'Coordinator',
      hireDate: '2026-01-01', employmentType: 'Full-time', status: 'Active', hourlyRate: 1_000,
      workStart: '09:00', workEnd: '17:00'
    })
    const unscheduled = employee('Unscheduled Employee')
    saveHrAttendance(db, 'Admin', {
      employeeId: scheduled.id, attendanceDate: '2026-04-01', checkIn: '09:20', checkOut: '17:45',
      status: 'Late', notes: ''
    })
    saveHrAttendance(db, 'Admin', {
      employeeId: unscheduled.id, attendanceDate: '2026-04-01', checkIn: '09:00', checkOut: '17:00',
      status: 'Present', notes: ''
    })

    const report = buildHrCsvReport(db, 'attendance')
    expect(report).toContain('"Date","Name","Check In","Check Out","Overtime (minutes)","Deduction (minutes)"')
    expect(report).toContain('"2026-04-01","Scheduled Employee","09:20","17:45","45","20"')
    expect(report).toContain('"2026-04-01","Unscheduled Employee","09:00","17:00","",""')
  })
})
