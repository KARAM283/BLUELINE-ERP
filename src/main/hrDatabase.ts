import type Database from 'better-sqlite3'
import type {
  HrAttendance, HrAttendanceDay, HrCandidate, HrCandidateDraft, HrCandidateUpdate, HrDashboard, HrDepartment, HrDocument, HrEmployee, HrEmployeeActivity,
  HrEmployeePayrollHistory, HrEmployeeProfile, HrEmployeeProfileLeave, HrLeaveBalance, HrLeaveRequest,
  HrPayCalculation, HrPayrollPeriod, HrPayrollRecord, HrSelfAttendanceStatus
} from '../shared/types'
import type { HrReportType } from '../shared/types'

const employeeStatuses = new Set(['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated'])
const attendanceStatuses = new Set(['Present', 'Absent', 'Late', 'Half Day', 'Early Leave', 'Official Leave', 'Holiday', 'Day Off'])
const leaveStatuses = new Set(['Pending', 'Approved', 'Rejected', 'Cancelled'])

export function initializeHrDatabase(db: Database.Database): void {
  const employeeUserAssignmentsExist = Boolean(db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'hr_employee_user_assignments'`).get())
  const migrate = db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS hr_departments (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_employees (
      id INTEGER PRIMARY KEY,
      employee_code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      department_id INTEGER REFERENCES hr_departments(id) ON DELETE SET NULL,
      job_title TEXT NOT NULL DEFAULT '',
      hire_date TEXT NOT NULL,
      employment_type TEXT NOT NULL DEFAULT 'Full-time',
      status TEXT NOT NULL DEFAULT 'Active',
      basic_salary INTEGER NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
      hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
      work_start TEXT,
      work_end TEXT,
      photo_path TEXT,
      archived_at TEXT,
      archived_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_employee_user_assignments (
      employee_id INTEGER PRIMARY KEY REFERENCES hr_employees(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_employees_name_idx ON hr_employees(full_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS hr_employees_department_idx ON hr_employees(department_id, status);
    CREATE TABLE IF NOT EXISTS hr_employee_code_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_value INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS hr_attendance (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      attendance_date TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      status TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, attendance_date)
    );
    CREATE INDEX IF NOT EXISTS hr_attendance_date_idx ON hr_attendance(attendance_date, status);
    CREATE TABLE IF NOT EXISTS hr_leave_balances (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      leave_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      allocated_days REAL NOT NULL CHECK (allocated_days >= 0),
      used_days REAL NOT NULL DEFAULT 0 CHECK (used_days >= 0),
      UNIQUE(employee_id, leave_type, year)
    );
    CREATE TABLE IF NOT EXISTS hr_leave_requests (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      total_days REAL NOT NULL CHECK (total_days > 0),
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Pending',
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_leave_dates_idx ON hr_leave_requests(start_date, end_date, status);
    CREATE TABLE IF NOT EXISTS hr_payroll_periods (
      id INTEGER PRIMARY KEY,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
      status TEXT NOT NULL DEFAULT 'Draft',
      created_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(month, year)
    );
    CREATE TABLE IF NOT EXISTS hr_payroll_records (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      payroll_period_id INTEGER NOT NULL REFERENCES hr_payroll_periods(id),
      basic_salary INTEGER NOT NULL CHECK (basic_salary >= 0),
      hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
      worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
      total_bonuses INTEGER NOT NULL DEFAULT 0 CHECK (total_bonuses >= 0),
      total_allowances INTEGER NOT NULL DEFAULT 0 CHECK (total_allowances >= 0),
      total_deductions INTEGER NOT NULL DEFAULT 0 CHECK (total_deductions >= 0),
      total_advance_repayments INTEGER NOT NULL DEFAULT 0 CHECK (total_advance_repayments >= 0),
      net_salary INTEGER NOT NULL CHECK (net_salary >= 0),
      payment_status TEXT NOT NULL DEFAULT 'Unpaid',
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employee_id, payroll_period_id)
    );
    CREATE TABLE IF NOT EXISTS hr_payroll_items (
      id INTEGER PRIMARY KEY,
      payroll_record_id INTEGER NOT NULL REFERENCES hr_payroll_records(id),
      item_type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_employee_advances (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      advance_amount INTEGER NOT NULL CHECK (advance_amount > 0),
      outstanding_balance INTEGER NOT NULL CHECK (outstanding_balance >= 0),
      issue_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hr_advance_repayments (
      id INTEGER PRIMARY KEY,
      advance_id INTEGER NOT NULL REFERENCES hr_employee_advances(id),
      payroll_record_id INTEGER REFERENCES hr_payroll_records(id),
      amount INTEGER NOT NULL CHECK (amount > 0),
      repayment_date TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hr_employee_documents (
      id INTEGER PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      document_name TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      issue_date TEXT,
      expiration_date TEXT,
      uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_document_expiration_idx ON hr_employee_documents(expiration_date);
    CREATE TABLE IF NOT EXISTS hr_candidates (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      department_id INTEGER NOT NULL REFERENCES hr_departments(id) ON DELETE RESTRICT,
      notes TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS hr_candidates_department_idx
      ON hr_candidates(department_id, is_starred DESC, full_name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS hr_audit_logs (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL,
      old_values TEXT,
      new_values TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS hr_security_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
    if (!employeeUserAssignmentsExist) {
      db.exec(`INSERT OR IGNORE INTO hr_employee_user_assignments(employee_id, user_id)
        SELECT e.id, u.id FROM hr_employees e JOIN app_users u
          ON LOWER(TRIM(e.full_name)) = LOWER(TRIM(u.display_name))
        WHERE e.archived_at IS NULL AND e.status = 'Active'
          AND (SELECT COUNT(*) FROM hr_employees match_employee
            WHERE LOWER(TRIM(match_employee.full_name)) = LOWER(TRIM(u.display_name))
              AND match_employee.archived_at IS NULL AND match_employee.status = 'Active') = 1
          AND (SELECT COUNT(*) FROM app_users match_user
            WHERE LOWER(TRIM(match_user.display_name)) = LOWER(TRIM(e.full_name))) = 1`)
    }
    const seedDepartment = db.prepare('INSERT OR IGNORE INTO hr_departments(name) VALUES (?)')
    for (const name of ['VISA', 'Operations', 'Manager', 'Office Boy', 'Accountant', 'CRM', 'Media']) seedDepartment.run(name)
    db.prepare(`INSERT OR IGNORE INTO hr_employee_code_sequence(id, last_value)
      SELECT 1, COALESCE(MAX(CAST(substr(employee_code, 8) AS INTEGER)), 0)
      FROM hr_employees WHERE employee_code GLOB 'BL-EMP-[0-9]*'`).run()
    db.prepare(`UPDATE hr_employee_code_sequence SET last_value = MAX(last_value,
      (SELECT COALESCE(MAX(CAST(substr(employee_code, 8) AS INTEGER)), 0)
        FROM hr_employees WHERE employee_code GLOB 'BL-EMP-[0-9]*')) WHERE id = 1`).run()
    const employeeColumns = db.pragma('table_info(hr_employees)') as Array<{ name: string }>
    if (!employeeColumns.some((column) => column.name === 'archived_status')) {
      db.exec('ALTER TABLE hr_employees ADD COLUMN archived_status TEXT')
    }
    if (!employeeColumns.some((column) => column.name === 'hourly_rate')) {
      db.exec('ALTER TABLE hr_employees ADD COLUMN hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0)')
    }
    if (!employeeColumns.some((column) => column.name === 'work_start')) {
      db.exec('ALTER TABLE hr_employees ADD COLUMN work_start TEXT')
    }
    if (!employeeColumns.some((column) => column.name === 'work_end')) {
      db.exec('ALTER TABLE hr_employees ADD COLUMN work_end TEXT')
    }
    if (!employeeColumns.some((column) => column.name === 'photo_path')) {
      db.exec('ALTER TABLE hr_employees ADD COLUMN photo_path TEXT')
    }
    const payrollColumns = db.pragma('table_info(hr_payroll_records)') as Array<{ name: string }>
    if (!payrollColumns.some((column) => column.name === 'hourly_rate')) {
      db.exec('ALTER TABLE hr_payroll_records ADD COLUMN hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0)')
    }
    if (!payrollColumns.some((column) => column.name === 'worked_minutes')) {
      db.exec('ALTER TABLE hr_payroll_records ADD COLUMN worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0)')
    }
  })
  migrate()
}

function audit(db: Database.Database, actor: string, type: string, id: number | null, action: string, oldValue?: unknown, newValue?: unknown): void {
  db.prepare(`INSERT INTO hr_audit_logs(user_id, entity_type, entity_id, action, old_values, new_values)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    actor, type, id, action,
    oldValue === undefined ? null : JSON.stringify(oldValue),
    newValue === undefined ? null : JSON.stringify(newValue)
  )
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function validTime(value: string | null): boolean {
  return value === null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function actorName(actor: string): string {
  const value = actor.trim()
  if (!value || value.length > 100) throw new Error('Invalid HR operator.')
  return value
}

export function listHrDepartments(db: Database.Database): HrDepartment[] {
  return db.prepare('SELECT id, name, description FROM hr_departments ORDER BY name COLLATE NOCASE').all() as HrDepartment[]
}

export function saveHrDepartment(db: Database.Database, actor: string, input: { id?: number; name: string; description: string }): void {
  const name = input.name.trim()
  const description = input.description.trim()
  if (name.length < 2 || name.length > 80 || description.length > 500) throw new Error('Department name must be 2–80 characters.')
  const save = db.transaction(() => {
    if (input.id === undefined) {
      const result = db.prepare('INSERT INTO hr_departments(name, description) VALUES (?, ?)').run(name, description)
      audit(db, actorName(actor), 'department', Number(result.lastInsertRowid), 'created', undefined, { name, description })
    } else {
      const previous = db.prepare('SELECT name, description FROM hr_departments WHERE id = ?').get(input.id)
      if (!previous) throw new Error('Department not found.')
      db.prepare('UPDATE hr_departments SET name = ?, description = ? WHERE id = ?').run(name, description, input.id)
      audit(db, actorName(actor), 'department', input.id, 'updated', previous, { name, description })
    }
  })
  save()
}

const employeeSelect = `SELECT e.id, e.employee_code AS employeeCode, e.full_name AS fullName,
  e.phone, e.email, e.department_id AS departmentId, COALESCE(d.name, '') AS departmentName,
  e.job_title AS jobTitle, e.hire_date AS hireDate, e.employment_type AS employmentType,
  e.status, e.hourly_rate AS hourlyRate, e.work_start AS workStart, e.work_end AS workEnd,
  e.archived_at AS archivedAt, e.photo_path AS photoPath,
  a.user_id AS appUserId, u.username AS appUsername, u.display_name AS appUserDisplayName
  FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id
  LEFT JOIN hr_employee_user_assignments a ON a.employee_id = e.id
  LEFT JOIN app_users u ON u.id = a.user_id`

export type HrEmployeeRecord = HrEmployee & { photoPath: string | null }

export function listHrEmployees(db: Database.Database, search = '', includeArchived = false): HrEmployeeRecord[] {
  if (typeof search !== 'string' || search.length > 200) throw new Error('Invalid employee search.')
  const term = `%${search.trim()}%`
  return db.prepare(`${employeeSelect} WHERE (? = 1 OR e.archived_at IS NULL)
    AND (e.full_name LIKE ? OR e.employee_code LIKE ? OR e.phone LIKE ? OR e.email LIKE ?)
    ORDER BY e.archived_at IS NOT NULL, e.full_name COLLATE NOCASE LIMIT 500`)
    .all(includeArchived ? 1 : 0, term, term, term, term) as HrEmployeeRecord[]
}

export function saveHrEmployee(
  db: Database.Database,
  actor: string,
  input: Omit<HrEmployee, 'id' | 'employeeCode' | 'departmentName' | 'archivedAt' | 'photoDataUrl' | 'appUsername' | 'appUserDisplayName' | 'appUserId' | 'workStart' | 'workEnd'>
    & { id?: number; appUserId?: number | null; workStart?: string | null; workEnd?: string | null }
): HrEmployeeRecord {
  const fullName = input.fullName.trim()
  const phone = input.phone.trim()
  const email = input.email.trim()
  const jobTitle = input.jobTitle.trim()
  if (fullName.length < 2 || fullName.length > 160 || phone.length > 40 || email.length > 254 || jobTitle.length > 100) {
    throw new Error('Enter a valid employee name, contact, and job title.')
  }
  if (!validDate(input.hireDate) || !employeeStatuses.has(input.status)
    || !Number.isSafeInteger(input.hourlyRate) || input.hourlyRate <= 0
    || !['Full-time', 'Part-time', 'Contract', 'Temporary'].includes(input.employmentType)) {
    throw new Error('Enter valid employment details and an hourly rate greater than zero.')
  }
  if ((input.workStart === undefined) !== (input.workEnd === undefined)) {
    throw new Error('Set both scheduled work hours or leave both unset.')
  }
  if (input.workStart !== undefined && input.workEnd !== undefined) {
    if ((input.workStart === null) !== (input.workEnd === null)
      || (input.workStart !== null && input.workEnd !== null
        && (!validTime(input.workStart) || !validTime(input.workEnd) || input.workStart >= input.workEnd))) {
      throw new Error('Enter valid work hours with an end time later than the start time.')
    }
  }
  if (input.appUserId !== undefined && input.appUserId !== null
    && (!Number.isSafeInteger(input.appUserId) || input.appUserId <= 0)) throw new Error('Select a valid application user.')
  const save = db.transaction(() => {
    if (input.departmentId !== null && !db.prepare('SELECT 1 FROM hr_departments WHERE id = ?').get(input.departmentId)) {
      throw new Error('Selected department does not exist.')
    }
    if (input.appUserId !== undefined && input.appUserId !== null) {
      if (!db.prepare('SELECT 1 FROM app_users WHERE id = ?').get(input.appUserId)) throw new Error('Selected application user does not exist.')
      const currentAssignment = db.prepare('SELECT employee_id AS employeeId FROM hr_employee_user_assignments WHERE user_id = ?')
        .get(input.appUserId) as { employeeId: number } | undefined
      if (currentAssignment && currentAssignment.employeeId !== input.id) {
        throw new Error('This application user is already assigned to another employee.')
      }
    }
    if (input.id === undefined) {
      const sequence = Number((db.prepare('SELECT last_value AS value FROM hr_employee_code_sequence WHERE id = 1').get() as { value: number }).value) + 1
      db.prepare('UPDATE hr_employee_code_sequence SET last_value = ? WHERE id = 1').run(sequence)
      const employeeCode = `BL-EMP-${String(sequence).padStart(3, '0')}`
      const result = db.prepare(`INSERT INTO hr_employees(employee_code, full_name, phone, email, department_id,
        job_title, hire_date, employment_type, status, basic_salary, hourly_rate, work_start, work_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(
        employeeCode, fullName, phone, email, input.departmentId, jobTitle, input.hireDate,
        input.employmentType, input.status, input.hourlyRate, input.workStart ?? null, input.workEnd ?? null
      )
      const id = Number(result.lastInsertRowid)
      saveHrEmployeeUserAssignment(db, id, input.appUserId)
      audit(db, actorName(actor), 'employee', id, 'created', undefined, input)
      return id
    }
    const previous = db.prepare(`SELECT e.*, a.user_id AS appUserId FROM hr_employees e
      LEFT JOIN hr_employee_user_assignments a ON a.employee_id = e.id WHERE e.id = ?`).get(input.id) as
      ({ work_start: string | null; work_end: string | null } & Record<string, unknown>) | undefined
    if (!previous) throw new Error('Employee not found.')
    const workStart = input.workStart === undefined ? previous.work_start : input.workStart
    const workEnd = input.workEnd === undefined ? previous.work_end : input.workEnd
    db.prepare(`UPDATE hr_employees SET full_name = ?, phone = ?, email = ?, department_id = ?,
      job_title = ?, hire_date = ?, employment_type = ?, status = ?, basic_salary = 0, hourly_rate = ?,
      work_start = ?, work_end = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL`).run(
      fullName, phone, email, input.departmentId, jobTitle, input.hireDate,
      input.employmentType, input.status, input.hourlyRate, workStart, workEnd, input.id
    )
    saveHrEmployeeUserAssignment(db, input.id, input.appUserId)
    audit(db, actorName(actor), 'employee', input.id, 'updated', previous, input)
    return input.id
  })
  const id = save()
  return db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id) as HrEmployeeRecord
}

function saveHrEmployeeUserAssignment(db: Database.Database, employeeId: number, userId: number | null | undefined): void {
  if (userId === undefined) return
  if (userId === null) {
    db.prepare('DELETE FROM hr_employee_user_assignments WHERE employee_id = ?').run(employeeId)
    return
  }
  db.prepare(`INSERT INTO hr_employee_user_assignments(employee_id, user_id) VALUES (?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET user_id = excluded.user_id, assigned_at = CURRENT_TIMESTAMP`)
    .run(employeeId, userId)
}

export function getHrEmployeePhotoPath(db: Database.Database, id: number): string | null {
  const employee = db.prepare('SELECT photo_path AS photoPath FROM hr_employees WHERE id = ?')
    .get(id) as { photoPath: string | null } | undefined
  if (!employee) throw new Error('Employee not found.')
  return employee.photoPath
}

export function getHrEmployeeStoredFilePaths(db: Database.Database, id: number): string[] {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid employee ID.')
  const employee = db.prepare('SELECT photo_path AS photoPath FROM hr_employees WHERE id = ?')
    .get(id) as { photoPath: string | null } | undefined
  if (!employee) throw new Error('Employee not found.')
  const documents = db.prepare('SELECT file_path AS filePath FROM hr_employee_documents WHERE employee_id = ?')
    .all(id) as Array<{ filePath: string }>
  return [...new Set([...documents.map(({ filePath }) => filePath), employee.photoPath].filter((path): path is string => Boolean(path)))]
}

export function setHrEmployeePhotoPath(db: Database.Database, actor: string, id: number, photoPath: string): void {
  if (!photoPath || photoPath.length > 1000) throw new Error('Invalid employee photo path.')
  const update = db.transaction(() => {
    const employee = db.prepare('SELECT photo_path AS photoPath FROM hr_employees WHERE id = ?')
      .get(id) as { photoPath: string | null } | undefined
    if (!employee) throw new Error('Employee not found.')
    db.prepare('UPDATE hr_employees SET photo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(photoPath, id)
    audit(db, actorName(actor), 'employee', id, 'photo updated',
      { hasPhoto: Boolean(employee.photoPath) }, { hasPhoto: true })
  })
  update()
}

export function getHrEmployeeProfileData(
  db: Database.Database,
  id: number
): Omit<HrEmployeeProfile, 'employee'> & { employee: HrEmployeeRecord } {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid employee ID.')
  const employee = db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id) as HrEmployeeRecord | undefined
  if (!employee) throw new Error('Employee not found.')
  const attendance = db.prepare(`SELECT a.id, e.id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, COALESCE(d.name, '') AS departmentName,
    a.attendance_date AS attendanceDate, a.check_in AS checkIn, a.check_out AS checkOut,
    a.status, a.notes FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE a.employee_id = ? ORDER BY a.attendance_date DESC`).all(id) as HrAttendance[]
  const leaveRequests = db.prepare(`SELECT l.id, e.id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, COALESCE(d.name, '') AS departmentName, l.leave_type AS leaveType,
    l.start_date AS startDate, l.end_date AS endDate, l.total_days AS totalDays, l.reason, l.status,
    l.created_at AS createdAt, l.approved_by AS approvedBy, l.approved_at AS approvedAt
    FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE l.employee_id = ? ORDER BY l.created_at DESC`).all(id) as HrEmployeeProfileLeave[]
  const leaveBalances = db.prepare(`SELECT b.employee_id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, b.leave_type AS leaveType, b.year,
    b.allocated_days AS allocatedDays, b.used_days AS usedDays,
    b.allocated_days - b.used_days AS remainingDays
    FROM hr_leave_balances b JOIN hr_employees e ON e.id = b.employee_id
    WHERE b.employee_id = ? ORDER BY b.year DESC, b.leave_type`).all(id) as HrLeaveBalance[]
  const payroll = db.prepare(`SELECT r.id, p.month, p.year, p.status AS periodStatus,
    r.hourly_rate AS hourlyRate, r.worked_minutes AS workedMinutes,
    r.basic_salary AS basicSalary, r.total_bonuses AS totalBonuses,
    r.total_allowances AS totalAllowances, r.total_deductions AS totalDeductions,
    r.total_advance_repayments AS totalAdvanceRepayments,
    COALESCE((SELECT SUM(i.amount) FROM hr_payroll_items i
      WHERE i.payroll_record_id = r.id AND i.item_type = 'Other Adjustment'), 0) AS totalOtherAdjustments,
    r.net_salary AS netSalary
    FROM hr_payroll_records r JOIN hr_payroll_periods p ON p.id = r.payroll_period_id
    WHERE r.employee_id = ? ORDER BY p.year DESC, p.month DESC`).all(id) as HrEmployeePayrollHistory[]
  const documents = listHrDocuments(db, id)
  const activity = db.prepare(`SELECT l.id, l.user_id AS actor, l.entity_type AS entityType,
    l.entity_id AS entityId, l.action, l.created_at AS createdAt
    FROM hr_audit_logs l
    WHERE (l.entity_type = 'employee' AND l.entity_id = ?)
      OR (l.entity_type = 'attendance' AND l.entity_id = ?)
      OR (l.entity_type = 'leave_balance' AND l.entity_id = ?)
      OR (l.entity_type = 'leave' AND l.entity_id IN
        (SELECT id FROM hr_leave_requests WHERE employee_id = ?))
      OR (l.entity_type = 'employee_document' AND l.entity_id IN
        (SELECT id FROM hr_employee_documents WHERE employee_id = ?))
      OR (l.entity_type = 'payroll' AND l.entity_id IN
        (SELECT payroll_period_id FROM hr_payroll_records WHERE employee_id = ?))
      OR (l.entity_type = 'payroll_record' AND l.entity_id IN
        (SELECT id FROM hr_payroll_records WHERE employee_id = ?))
    ORDER BY l.created_at DESC LIMIT 500`)
    .all(id, id, id, id, id, id, id) as HrEmployeeActivity[]
  return { employee, attendance, leaveRequests, leaveBalances, payroll, documents, activity }
}

export function archiveHrEmployee(db: Database.Database, actor: string, id: number, archived: boolean): void {
  const update = db.transaction(() => {
    const employee = db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id) as HrEmployee | undefined
    if (!employee) throw new Error('Employee not found.')
    if (archived) {
      if (employee.archivedAt) return
      db.prepare(`UPDATE hr_employees SET archived_status = status, status = 'Archived',
        archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
    } else {
      if (!employee.archivedAt) return
      db.prepare(`UPDATE hr_employees SET status = COALESCE(archived_status, 'Active'), archived_status = NULL,
        archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
    }
    const updated = db.prepare(`${employeeSelect} WHERE e.id = ?`).get(id)
    audit(db, actorName(actor), 'employee', id, archived ? 'archived' : 'restored', employee, updated)
  })
  update()
}

export function deleteHrEmployee(db: Database.Database, actor: string, id: number): string[] {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid employee ID.')
  const remove = db.transaction(() => {
    const employee = db.prepare('SELECT employee_code AS employeeCode, full_name AS fullName, department_id AS departmentId, job_title AS jobTitle, status, archived_at AS archivedAt FROM hr_employees WHERE id = ?')
      .get(id) as { employeeCode: string; fullName: string; departmentId: number | null; jobTitle: string; status: string; archivedAt: string | null } | undefined
    if (!employee) throw new Error('Employee not found.')
    const filePaths = getHrEmployeeStoredFilePaths(db, id)
    db.prepare(`DELETE FROM hr_advance_repayments
      WHERE advance_id IN (SELECT id FROM hr_employee_advances WHERE employee_id = ?)
        OR payroll_record_id IN (SELECT id FROM hr_payroll_records WHERE employee_id = ?)`).run(id, id)
    db.prepare('DELETE FROM hr_payroll_items WHERE payroll_record_id IN (SELECT id FROM hr_payroll_records WHERE employee_id = ?)').run(id)
    db.prepare('DELETE FROM hr_employee_advances WHERE employee_id = ?').run(id)
    db.prepare('DELETE FROM hr_employee_documents WHERE employee_id = ?').run(id)
    db.prepare('DELETE FROM hr_payroll_records WHERE employee_id = ?').run(id)
    db.prepare('DELETE FROM hr_leave_requests WHERE employee_id = ?').run(id)
    db.prepare('DELETE FROM hr_leave_balances WHERE employee_id = ?').run(id)
    db.prepare('DELETE FROM hr_attendance WHERE employee_id = ?').run(id)
    db.prepare('DELETE FROM hr_employees WHERE id = ?').run(id)
    audit(db, actorName(actor), 'employee', id, 'deleted', employee)
    return filePaths
  })
  return remove()
}

export function getHrDashboard(db: Database.Database, date: string): HrDashboard {
  if (!validDate(date)) throw new Error('Invalid dashboard date.')
  const count = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args) as { count: number }).count)
  const totalEmployees = count("SELECT COUNT(*) AS count FROM hr_employees WHERE archived_at IS NULL")
  const activeEmployees = count("SELECT COUNT(*) AS count FROM hr_employees WHERE archived_at IS NULL AND status = 'Active'")
  const presentToday = count(`SELECT COUNT(*) AS count FROM hr_attendance
    WHERE attendance_date = ? AND status IN ('Present', 'Late', 'Half Day', 'Early Leave')`, date)
  const absentToday = count("SELECT COUNT(*) AS count FROM hr_attendance WHERE attendance_date = ? AND status = 'Absent'", date)
  const onLeaveToday = count(`SELECT COUNT(*) AS count FROM hr_leave_requests
    WHERE status = 'Approved' AND start_date <= ? AND end_date >= ?`, date, date)
  const pendingLeaveRequests = count("SELECT COUNT(*) AS count FROM hr_leave_requests WHERE status = 'Pending'")
  const month = Number(date.slice(5, 7))
  const year = Number(date.slice(0, 4))
  const payroll = db.prepare(`SELECT COALESCE(SUM(r.net_salary), 0) AS total FROM hr_payroll_records r
    JOIN hr_payroll_periods p ON p.id = r.payroll_period_id WHERE p.month = ? AND p.year = ? AND p.status <> 'Cancelled'`)
    .get(month, year) as { total: number }
  return { totalEmployees, activeEmployees, presentToday, absentToday, onLeaveToday, pendingLeaveRequests, currentMonthPayrollTotal: Number(payroll.total) }
}

export function listHrAttendance(db: Database.Database, date: string): HrAttendance[] {
  if (!validDate(date)) throw new Error('Invalid attendance date.')
  return db.prepare(`SELECT COALESCE(a.id, 0) AS id, e.id AS employeeId, e.employee_code AS employeeCode, e.full_name AS fullName,
    u.display_name AS appUserDisplayName, u.username AS appUsername,
    COALESCE(d.name, '') AS departmentName, COALESCE(a.attendance_date, ?) AS attendanceDate,
    a.check_in AS checkIn, a.check_out AS checkOut, COALESCE(a.status, 'Unmarked') AS status, COALESCE(a.notes, '') AS notes
    FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id
    LEFT JOIN hr_attendance a ON a.employee_id = e.id AND a.attendance_date = ?
    LEFT JOIN hr_employee_user_assignments assignment ON assignment.employee_id = e.id
    LEFT JOIN app_users u ON u.id = assignment.user_id
    WHERE e.archived_at IS NULL AND e.status = 'Active' ORDER BY e.full_name COLLATE NOCASE`).all(date, date) as HrAttendance[]
}

export function listHrAttendanceCalendar(db: Database.Database, year: number, month: number, employeeId?: number): HrAttendanceDay[] {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2200
    || !Number.isSafeInteger(month) || month < 1 || month > 12) throw new Error('Invalid attendance calendar month.')
  if (employeeId !== undefined && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) {
    throw new Error('Invalid attendance employee.')
  }
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate).padStart(2, '0')}`
  if (employeeId !== undefined) {
    return db.prepare(`SELECT a.attendance_date AS date, 1 AS total,
      CASE WHEN a.check_in IS NOT NULL THEN 1 ELSE 0 END AS checkedIn,
      CASE WHEN a.check_in IS NOT NULL AND a.check_out IS NOT NULL THEN 1 ELSE 0 END AS checkedOut,
      CASE WHEN a.status = 'Day Off' THEN 1 ELSE 0 END AS dayOffCount,
      a.status, a.check_in AS checkIn, a.check_out AS checkOut
      FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
      WHERE a.employee_id = ? AND a.attendance_date BETWEEN ? AND ?
        AND e.archived_at IS NULL AND e.status = 'Active'
      ORDER BY a.attendance_date`).all(employeeId, start, end) as HrAttendanceDay[]
  }
  return db.prepare(`SELECT attendance_date AS date, COUNT(*) AS total,
    SUM(CASE WHEN check_in IS NOT NULL THEN 1 ELSE 0 END) AS checkedIn,
    SUM(CASE WHEN check_in IS NOT NULL AND check_out IS NOT NULL THEN 1 ELSE 0 END) AS checkedOut,
    SUM(CASE WHEN status = 'Day Off' THEN 1 ELSE 0 END) AS dayOffCount
    FROM hr_attendance WHERE attendance_date BETWEEN ? AND ?
    GROUP BY attendance_date ORDER BY attendance_date`).all(start, end) as HrAttendanceDay[]
}

export function clockHrAttendance(db: Database.Database, actor: string, employeeId: number, action: 'in' | 'out', at = new Date()): void {
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0 || !['in', 'out'].includes(action) || Number.isNaN(at.getTime())) {
    throw new Error('Invalid attendance clock action.')
  }
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const clock = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND archived_at IS NULL AND status = 'Active'").get(employeeId)) {
      throw new Error('Active employee not found.')
    }
    const previous = db.prepare(`SELECT * FROM hr_attendance WHERE employee_id = ? AND attendance_date = ?`)
      .get(employeeId, date) as { check_in: string | null; check_out: string | null } | undefined
    const who = actorName(actor)
    if (action === 'in') {
      if (previous?.check_in || previous?.check_out) throw new Error('This employee has already checked in today.')
      db.prepare(`INSERT INTO hr_attendance(employee_id, attendance_date, check_in, status, recorded_by, updated_by)
        VALUES (?, ?, ?, 'Present', ?, ?)
        ON CONFLICT(employee_id, attendance_date) DO UPDATE SET check_in = excluded.check_in,
          status = 'Present', updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
        .run(employeeId, date, time, who, who)
    } else {
      if (!previous?.check_in) throw new Error('Check in before checking out.')
      if (previous.check_out) throw new Error('This employee has already checked out today.')
      if (time <= previous.check_in) throw new Error('Check-out must be later than check-in. Overnight shifts are not supported.')
      db.prepare(`UPDATE hr_attendance SET check_out = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ? AND attendance_date = ?`).run(time, who, employeeId, date)
    }
    const updated = db.prepare(`SELECT * FROM hr_attendance WHERE employee_id = ? AND attendance_date = ?`)
      .get(employeeId, date)
    audit(db, who, 'attendance', employeeId, action === 'in' ? 'clocked in' : 'clocked out', previous, updated)
  })
  clock()
}

function findActiveEmployeeForUser(db: Database.Database, userId: number): { id: number; fullName: string } {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid application user.')
  const assignment = db.prepare(`SELECT e.id, e.full_name AS fullName, e.status, e.archived_at AS archivedAt
    FROM hr_employee_user_assignments a JOIN hr_employees e ON e.id = a.employee_id
    WHERE a.user_id = ?`).get(userId) as { id: number; fullName: string; status: string; archivedAt: string | null } | undefined
  if (!assignment) throw new Error('No employee profile is assigned to this application user. Ask an administrator to assign one in Human Resources.')
  if (assignment.archivedAt || assignment.status !== 'Active') {
    throw new Error('The employee profile assigned to this application user is not active.')
  }
  return assignment
}

export function getHrSelfAttendanceStatus(db: Database.Database, userId: number, date: string): HrSelfAttendanceStatus {
  if (!validDate(date)) throw new Error('Invalid attendance date.')
  const employee = findActiveEmployeeForUser(db, userId)
  const record = db.prepare(`SELECT check_in AS checkIn, check_out AS checkOut, status FROM hr_attendance
    WHERE employee_id = ? AND attendance_date = ?`)
    .get(employee.id, date) as { checkIn: string | null; checkOut: string | null; status: string } | undefined
  return {
    employeeName: employee.fullName,
    attendanceDate: date,
    checkIn: record?.checkIn ?? null,
    checkOut: record?.checkOut ?? null,
    shouldPrompt: !record?.checkIn && record?.status !== 'Day Off'
  }
}

export function getHrSelfAttendanceCalendar(db: Database.Database, userId: number, year: number, month: number): HrAttendanceDay[] {
  const employee = findActiveEmployeeForUser(db, userId)
  return listHrAttendanceCalendar(db, year, month, employee.id)
}

export function clockInHrAttendanceForUser(db: Database.Database, userId: number, actor: string, at = new Date()): HrSelfAttendanceStatus {
  if (Number.isNaN(at.getTime())) throw new Error('Invalid attendance clock action.')
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  const status = getHrSelfAttendanceStatus(db, userId, date)
  if (!status.shouldPrompt) return status
  const employee = findActiveEmployeeForUser(db, userId)
  clockHrAttendance(db, actor, employee.id, 'in', at)
  return getHrSelfAttendanceStatus(db, userId, date)
}

export function clockOutHrAttendanceForUser(db: Database.Database, userId: number, actor: string, at = new Date()): HrSelfAttendanceStatus {
  if (Number.isNaN(at.getTime())) throw new Error('Invalid attendance clock action.')
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
  const status = getHrSelfAttendanceStatus(db, userId, date)
  if (!status.checkIn) throw new Error('Check in before checking out.')
  if (status.checkOut) throw new Error('This employee has already checked out today.')
  const employee = findActiveEmployeeForUser(db, userId)
  clockHrAttendance(db, actor, employee.id, 'out', at)
  return getHrSelfAttendanceStatus(db, userId, date)
}

function timeInMinutes(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) throw new Error('Attendance contains an invalid clock time.')
  return Number(match[1]) * 60 + Number(match[2])
}

export function calculateHrPay(db: Database.Database, employeeId: number, startDate: string, endDate: string): HrPayCalculation {
  if (!Number.isSafeInteger(employeeId) || employeeId <= 0 || !validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    throw new Error('Select a valid employee and date range.')
  }
  const employee = db.prepare('SELECT full_name AS employeeName, hourly_rate AS hourlyRate FROM hr_employees WHERE id = ?')
    .get(employeeId) as { employeeName: string; hourlyRate: number } | undefined
  if (!employee) throw new Error('Employee not found.')
  if (employee.hourlyRate <= 0) throw new Error('Set this employee’s hourly rate before calculating pay.')
  const records = db.prepare(`SELECT check_in AS checkIn, check_out AS checkOut FROM hr_attendance
    WHERE employee_id = ? AND attendance_date BETWEEN ? AND ? AND check_in IS NOT NULL AND check_out IS NOT NULL`)
    .all(employeeId, startDate, endDate) as Array<{ checkIn: string; checkOut: string }>
  const workedMinutes = records.reduce((total, record) => {
    const duration = timeInMinutes(record.checkOut) - timeInMinutes(record.checkIn)
    if (duration <= 0) throw new Error('Attendance contains a check-out that is not later than check-in.')
    return total + duration
  }, 0)
  const grossPay = Math.round(employee.hourlyRate * workedMinutes / 60)
  if (!Number.isSafeInteger(grossPay)) throw new Error('Calculated pay is outside the supported range.')
  return { employeeId, employeeName: employee.employeeName, hourlyRate: employee.hourlyRate, workedMinutes, grossPay }
}

export function saveHrAttendance(db: Database.Database, actor: string, input: Omit<HrAttendance, 'id' | 'employeeCode' | 'fullName' | 'departmentName'>): void {
  if (!validDate(input.attendanceDate) || !attendanceStatuses.has(input.status)
    || !validTime(input.checkIn) || !validTime(input.checkOut)
    || (input.checkOut !== null && input.checkIn === null)
    || (input.checkIn !== null && input.checkOut !== null && input.checkOut < input.checkIn)
    || typeof input.notes !== 'string' || input.notes.length > 1000) {
    throw new Error('Invalid attendance details. Check-out must not be earlier than check-in.')
  }
  const save = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND archived_at IS NULL AND status = 'Active'").get(input.employeeId)) {
      throw new Error('Active employee not found.')
    }
    const previous = db.prepare('SELECT * FROM hr_attendance WHERE employee_id = ? AND attendance_date = ?')
      .get(input.employeeId, input.attendanceDate)
    db.prepare(`INSERT INTO hr_attendance(employee_id, attendance_date, check_in, check_out, status, notes, recorded_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_id, attendance_date) DO UPDATE SET check_in = excluded.check_in,
        check_out = excluded.check_out, status = excluded.status, notes = excluded.notes,
        updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
      .run(input.employeeId, input.attendanceDate, input.checkIn, input.checkOut, input.status, input.notes, actorName(actor), actorName(actor))
    audit(db, actorName(actor), 'attendance', input.employeeId, previous ? 'updated' : 'created', previous, input)
  })
  save()
}

export function markAllHrEmployeesPresent(db: Database.Database, actor: string, date: string): number {
  if (!validDate(date)) throw new Error('Invalid attendance date.')
  const mark = db.transaction(() => {
    const candidates = db.prepare(`SELECT id FROM hr_employees WHERE status = 'Active' AND archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM hr_attendance WHERE employee_id = hr_employees.id AND attendance_date = ?)`)
      .all(date) as Array<{ id: number }>
    const result = db.prepare(`INSERT OR IGNORE INTO hr_attendance(employee_id, attendance_date, status, recorded_by, updated_by)
      SELECT id, ?, 'Present', ?, ? FROM hr_employees WHERE status = 'Active' AND archived_at IS NULL`)
      .run(date, actorName(actor), actorName(actor))
    for (const candidate of candidates) {
      audit(db, actorName(actor), 'attendance', candidate.id, 'created', undefined, { date, status: 'Present' })
    }
    return result.changes
  })
  return mark()
}

export function listHrLeaveRequests(db: Database.Database, status = ''): HrLeaveRequest[] {
  if (status && !leaveStatuses.has(status)) throw new Error('Invalid leave status.')
  return db.prepare(`SELECT l.id, e.id AS employeeId, e.employee_code AS employeeCode, e.full_name AS fullName,
    COALESCE(d.name, '') AS departmentName, l.leave_type AS leaveType, l.start_date AS startDate,
    l.end_date AS endDate, l.total_days AS totalDays, l.reason, l.status
    FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE (? = '' OR l.status = ?) ORDER BY l.created_at DESC LIMIT 500`).all(status, status) as HrLeaveRequest[]
}

export function createHrLeaveRequest(db: Database.Database, actor: string, input: Omit<HrLeaveRequest, 'id' | 'employeeCode' | 'fullName' | 'departmentName' | 'status'>): void {
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate
    || !Number.isFinite(input.totalDays) || input.totalDays <= 0 || input.totalDays > 366
    || input.leaveType.trim().length < 2 || input.leaveType.length > 80 || input.reason.length > 2000) {
    throw new Error('Invalid leave request details.')
  }
  const create = db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND archived_at IS NULL AND status = 'Active'").get(input.employeeId)) {
      throw new Error('Active employee not found.')
    }
    const result = db.prepare(`INSERT INTO hr_leave_requests(employee_id, leave_type, start_date, end_date, total_days, reason)
      VALUES (?, ?, ?, ?, ?, ?)`).run(input.employeeId, input.leaveType.trim(), input.startDate, input.endDate, input.totalDays, input.reason.trim())
    audit(db, actorName(actor), 'leave', Number(result.lastInsertRowid), 'submitted', undefined, input)
  })
  create()
}

export function decideHrLeaveRequest(db: Database.Database, actor: string, id: number, status: 'Approved' | 'Rejected'): void {
  const decide = db.transaction(() => {
    const request = db.prepare('SELECT * FROM hr_leave_requests WHERE id = ?').get(id) as {
      id: number; employee_id: number; leave_type: string; start_date: string; end_date: string; total_days: number; status: string
    } | undefined
    if (!request || request.status !== 'Pending') throw new Error('Only pending leave requests can be decided.')
    if (status === 'Approved') {
      if (request.start_date.slice(0, 4) !== request.end_date.slice(0, 4)) {
        throw new Error('Split leave requests that cross calendar years so each year can use its configured balance.')
      }
      const overlap = db.prepare(`SELECT 1 FROM hr_leave_requests WHERE employee_id = ? AND id <> ?
        AND status = 'Approved' AND start_date <= ? AND end_date >= ? LIMIT 1`)
        .get(request.employee_id, id, request.end_date, request.start_date)
      if (overlap) throw new Error('This request overlaps another approved leave.')
      const year = Number(request.start_date.slice(0, 4))
      const balance = db.prepare(`SELECT allocated_days AS allocatedDays, used_days AS usedDays
        FROM hr_leave_balances WHERE employee_id = ? AND leave_type = ? AND year = ?`)
        .get(request.employee_id, request.leave_type, year) as { allocatedDays: number; usedDays: number } | undefined
      if (balance && balance.usedDays + request.total_days > balance.allocatedDays) {
        throw new Error('The employee does not have enough remaining leave balance.')
      }
      if (balance) db.prepare(`UPDATE hr_leave_balances SET used_days = used_days + ?
        WHERE employee_id = ? AND leave_type = ? AND year = ?`).run(request.total_days, request.employee_id, request.leave_type, year)
    }
    db.prepare('UPDATE hr_leave_requests SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(status, actorName(actor), id)
    audit(db, actorName(actor), 'leave', id, status.toLowerCase(), request, { status })
  })
  decide()
}

export function listHrLeaveBalances(db: Database.Database, year: number): Array<{
  employeeId: number; employeeCode: string; fullName: string; leaveType: string; year: number;
  allocatedDays: number; usedDays: number; remainingDays: number
}> {
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2200) throw new Error('Invalid leave-balance year.')
  return db.prepare(`SELECT b.employee_id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, b.leave_type AS leaveType, b.year,
    b.allocated_days AS allocatedDays, b.used_days AS usedDays,
    b.allocated_days - b.used_days AS remainingDays
    FROM hr_leave_balances b JOIN hr_employees e ON e.id = b.employee_id
    WHERE b.year = ? ORDER BY e.full_name COLLATE NOCASE, b.leave_type`).all(year) as Array<{
      employeeId: number; employeeCode: string; fullName: string; leaveType: string; year: number;
      allocatedDays: number; usedDays: number; remainingDays: number
    }>
}

export function saveHrLeaveBalance(
  db: Database.Database,
  actor: string,
  input: { employeeId: number; leaveType: string; year: number; allocatedDays: number }
): void {
  const leaveType = input.leaveType.trim()
  if (!Number.isSafeInteger(input.employeeId) || input.employeeId <= 0
    || !Number.isSafeInteger(input.year) || input.year < 2000 || input.year > 2200
    || !Number.isFinite(input.allocatedDays) || input.allocatedDays < 0 || input.allocatedDays > 366
    || leaveType.length < 2 || leaveType.length > 80) throw new Error('Invalid leave-balance details.')
  const save = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM hr_employees WHERE id = ?').get(input.employeeId)) throw new Error('Employee not found.')
    const previous = db.prepare(`SELECT allocated_days AS allocatedDays, used_days AS usedDays
      FROM hr_leave_balances WHERE employee_id = ? AND leave_type = ? AND year = ?`)
      .get(input.employeeId, leaveType, input.year) as { allocatedDays: number; usedDays: number } | undefined
    if (previous && input.allocatedDays < previous.usedDays) throw new Error('Allocated days cannot be lower than days already used.')
    db.prepare(`INSERT INTO hr_leave_balances(employee_id, leave_type, year, allocated_days, used_days)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(employee_id, leave_type, year) DO UPDATE SET allocated_days = excluded.allocated_days`)
      .run(input.employeeId, leaveType, input.year, input.allocatedDays)
    audit(db, actorName(actor), 'leave_balance', input.employeeId, 'configured', previous, input)
  })
  save()
}

export function listHrDocuments(db: Database.Database, employeeId?: number): HrDocument[] {
  if (employeeId !== undefined && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) throw new Error('Invalid employee ID.')
  return db.prepare(`SELECT d.id, d.employee_id AS employeeId, e.full_name AS employeeName,
    d.document_name AS documentName, d.document_type AS documentType,
    d.issue_date AS issueDate, d.expiration_date AS expirationDate, d.created_at AS uploadedAt
    FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id
    WHERE (? IS NULL OR d.employee_id = ?) ORDER BY d.created_at DESC LIMIT 1000`)
    .all(employeeId ?? null, employeeId ?? null) as HrDocument[]
}

export function addHrDocument(
  db: Database.Database,
  actor: string,
  input: { employeeId: number; documentName: string; documentType: string; issueDate?: string; expirationDate?: string; filePath: string }
): HrDocument {
  const documentName = input.documentName.trim()
  const documentType = input.documentType.trim()
  const issueDate = input.issueDate?.trim() || null
  const expirationDate = input.expirationDate?.trim() || null
  if (!Number.isSafeInteger(input.employeeId) || input.employeeId <= 0
    || documentName.length < 1 || documentName.length > 200
    || documentType.length < 2 || documentType.length > 80
    || !input.filePath || input.filePath.length > 1000
    || (issueDate !== null && !validDate(issueDate))
    || (expirationDate !== null && !validDate(expirationDate))) throw new Error('Invalid employee document details.')
  const add = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM hr_employees WHERE id = ?').get(input.employeeId)) throw new Error('Employee not found.')
    const result = db.prepare(`INSERT INTO hr_employee_documents(employee_id, document_name, document_type,
      file_path, issue_date, expiration_date, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(input.employeeId, documentName, documentType, input.filePath, issueDate, expirationDate, actorName(actor))
    const id = Number(result.lastInsertRowid)
    audit(db, actorName(actor), 'employee_document', id, 'uploaded', undefined, {
      employeeId: input.employeeId, documentName, documentType, issueDate, expirationDate
    })
    return id
  })
  const id = add()
  return db.prepare(`SELECT d.id, d.employee_id AS employeeId, e.full_name AS employeeName,
    d.document_name AS documentName, d.document_type AS documentType,
    d.issue_date AS issueDate, d.expiration_date AS expirationDate, d.created_at AS uploadedAt
    FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id WHERE d.id = ?`).get(id) as HrDocument
}

export function getHrDocumentPath(db: Database.Database, id: number): string {
  const row = db.prepare('SELECT file_path AS filePath FROM hr_employee_documents WHERE id = ?').get(id) as { filePath: string } | undefined
  if (!row) throw new Error('Employee document not found.')
  return row.filePath
}

function validateHrCandidate(input: HrCandidateDraft): HrCandidateDraft {
  const candidate = {
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    email: input.email.trim(),
    departmentId: input.departmentId,
    notes: input.notes.trim()
  }
  if (candidate.fullName.length < 2 || candidate.fullName.length > 120
    || candidate.phone.length > 50 || candidate.email.length > 200
    || candidate.notes.length > 2000
    || !Number.isSafeInteger(candidate.departmentId) || candidate.departmentId <= 0) {
    throw new Error('Invalid candidate details.')
  }
  return candidate
}

const hrCandidateSelect = `SELECT c.id, c.full_name AS fullName, c.phone, c.email,
  c.department_id AS departmentId, d.name AS departmentName, c.notes,
  c.file_name AS fileName, c.is_starred AS isStarred, c.created_at AS createdAt
  FROM hr_candidates c JOIN hr_departments d ON d.id = c.department_id`

export function listHrCandidates(db: Database.Database): HrCandidate[] {
  const rows = db.prepare(`${hrCandidateSelect}
    ORDER BY c.department_id, c.is_starred DESC, c.full_name COLLATE NOCASE`).all() as Array<Omit<HrCandidate, 'isStarred'> & { isStarred: number }>
  return rows.map((row) => ({ ...row, isStarred: row.isStarred === 1 }))
}

export function purgeHrCandidatesFromDepartments(db: Database.Database, actor: string): string[] {
  const migrationName = 'remove-office-boy-manager-cv-candidates'
  const purge = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM hr_migrations WHERE name = ?').get(migrationName)) return []
    const candidates = db.prepare(`SELECT c.id, c.full_name AS fullName, c.file_name AS fileName,
      c.file_path AS filePath, d.name AS departmentName
      FROM hr_candidates c JOIN hr_departments d ON d.id = c.department_id
      WHERE lower(trim(d.name)) IN ('office boy', 'manager')`).all() as Array<{
      id: number; fullName: string; fileName: string; filePath: string; departmentName: string
    }>
    for (const candidate of candidates) {
      audit(db, actor, 'candidate', candidate.id, 'deleted', {
        fullName: candidate.fullName, fileName: candidate.fileName, departmentName: candidate.departmentName
      })
      db.prepare('DELETE FROM hr_candidates WHERE id = ?').run(candidate.id)
    }
    db.prepare('INSERT INTO hr_migrations(name) VALUES (?)').run(migrationName)
    return candidates.map(({ filePath }) => filePath)
  })
  return purge()
}

export function listHrCandidatePathsForDepartmentPurge(db: Database.Database): string[] {
  const migrationName = 'remove-office-boy-manager-cv-candidates'
  if (db.prepare('SELECT 1 FROM hr_migrations WHERE name = ?').get(migrationName)) return []
  return (db.prepare(`SELECT c.file_path AS filePath
    FROM hr_candidates c JOIN hr_departments d ON d.id = c.department_id
    WHERE lower(trim(d.name)) IN ('office boy', 'manager')`).all() as Array<{ filePath: string }>)
    .map(({ filePath }) => filePath)
}

export function addHrCandidate(
  db: Database.Database,
  actor: string,
  input: HrCandidateDraft,
  fileName: string,
  filePath: string
): HrCandidate {
  const candidate = validateHrCandidate(input)
  const name = fileName.trim()
  if (!name || name.length > 255 || !filePath || filePath.length > 1000) throw new Error('Invalid candidate file.')
  const add = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM hr_departments WHERE id = ?').get(candidate.departmentId)) {
      throw new Error('Department not found.')
    }
    const result = db.prepare(`INSERT INTO hr_candidates(
      full_name, phone, email, department_id, notes, file_name, file_path, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      candidate.fullName, candidate.phone, candidate.email, candidate.departmentId,
      candidate.notes, name, filePath, actorName(actor)
    )
    const id = Number(result.lastInsertRowid)
    audit(db, actor, 'candidate', id, 'created', undefined, { ...candidate, fileName: name })
    return id
  })
  const id = add()
  return listHrCandidateById(db, id)
}

function listHrCandidateById(db: Database.Database, id: number): HrCandidate {
  const row = db.prepare(`${hrCandidateSelect} WHERE c.id = ?`).get(id) as (Omit<HrCandidate, 'isStarred'> & { isStarred: number }) | undefined
  if (!row) throw new Error('Candidate not found.')
  return { ...row, isStarred: row.isStarred === 1 }
}

export function updateHrCandidate(db: Database.Database, actor: string, input: HrCandidateUpdate): HrCandidate {
  if (!Number.isSafeInteger(input.id) || input.id <= 0) throw new Error('Invalid candidate ID.')
  const candidate = validateHrCandidate(input)
  const update = db.transaction(() => {
    const previous = db.prepare(`SELECT full_name AS fullName, phone, email,
      department_id AS departmentId, notes FROM hr_candidates WHERE id = ?`).get(input.id)
    if (!previous) throw new Error('Candidate not found.')
    if (!db.prepare('SELECT 1 FROM hr_departments WHERE id = ?').get(candidate.departmentId)) {
      throw new Error('Department not found.')
    }
    db.prepare(`UPDATE hr_candidates SET full_name = ?, phone = ?, email = ?,
      department_id = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(candidate.fullName, candidate.phone, candidate.email, candidate.departmentId, candidate.notes, input.id)
    audit(db, actor, 'candidate', input.id, 'updated', previous, candidate)
  })
  update()
  return listHrCandidateById(db, input.id)
}

export function setHrCandidateStarred(db: Database.Database, actor: string, id: number, starred: boolean): void {
  if (!Number.isSafeInteger(id) || id <= 0 || typeof starred !== 'boolean') throw new Error('Invalid candidate star setting.')
  const update = db.transaction(() => {
    const previous = db.prepare('SELECT is_starred AS isStarred FROM hr_candidates WHERE id = ?').get(id) as { isStarred: number } | undefined
    if (!previous) throw new Error('Candidate not found.')
    if ((previous.isStarred === 1) === starred) return
    db.prepare('UPDATE hr_candidates SET is_starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Number(starred), id)
    audit(db, actor, 'candidate', id, starred ? 'starred' : 'unstarred', previous, { isStarred: Number(starred) })
  })
  update()
}

export function getHrCandidateFilePath(db: Database.Database, id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid candidate ID.')
  const row = db.prepare('SELECT file_path AS filePath FROM hr_candidates WHERE id = ?').get(id) as { filePath: string } | undefined
  if (!row) throw new Error('Candidate not found.')
  return row.filePath
}

export function listHrPayrollPeriods(db: Database.Database): HrPayrollPeriod[] {
  return db.prepare(`SELECT p.id, p.month, p.year, p.status,
    COUNT(r.id) AS employeeCount, COALESCE(SUM(r.net_salary), 0) AS totalNet
    FROM hr_payroll_periods p LEFT JOIN hr_payroll_records r ON r.payroll_period_id = p.id
    GROUP BY p.id ORDER BY p.year DESC, p.month DESC LIMIT 100`).all() as HrPayrollPeriod[]
}

export function listHrPayrollRecords(db: Database.Database, periodId: number): HrPayrollRecord[] {
  if (!Number.isSafeInteger(periodId) || periodId <= 0) throw new Error('Invalid payroll period.')
  return db.prepare(`SELECT r.id, e.id AS employeeId, e.employee_code AS employeeCode,
    e.full_name AS fullName, COALESCE(d.name, '') AS departmentName, r.basic_salary AS basicSalary,
    r.hourly_rate AS hourlyRate, r.worked_minutes AS workedMinutes,
    r.total_bonuses AS totalBonuses, r.total_allowances AS totalAllowances,
    r.total_deductions AS totalDeductions, r.total_advance_repayments AS totalAdvanceRepayments,
    COALESCE((SELECT SUM(i.amount) FROM hr_payroll_items i
      WHERE i.payroll_record_id = r.id AND i.item_type = 'Other Adjustment'), 0) AS totalOtherAdjustments,
    r.net_salary AS netSalary FROM hr_payroll_records r
    JOIN hr_employees e ON e.id = r.employee_id LEFT JOIN hr_departments d ON d.id = e.department_id
    WHERE r.payroll_period_id = ? ORDER BY e.full_name COLLATE NOCASE`).all(periodId) as HrPayrollRecord[]
}

export function addHrPayrollItem(
  db: Database.Database,
  actor: string,
  recordId: number,
  input: { itemType: 'Bonus' | 'Allowance' | 'Deduction' | 'Advance Repayment' | 'Other Adjustment'; description: string; amount: number }
): void {
  const itemTypes = new Set(['Bonus', 'Allowance', 'Deduction', 'Advance Repayment', 'Other Adjustment'])
  const description = input.description.trim()
  const validAmount = Number.isSafeInteger(input.amount)
    && (input.itemType === 'Other Adjustment' ? input.amount !== 0 : input.amount > 0)
  if (!Number.isSafeInteger(recordId) || recordId <= 0 || !itemTypes.has(input.itemType)
    || description.length < 2 || description.length > 200 || !validAmount) {
    throw new Error('Invalid payroll item details.')
  }
  const add = db.transaction(() => {
    const record = db.prepare(`SELECT r.*, p.status AS period_status FROM hr_payroll_records r
      JOIN hr_payroll_periods p ON p.id = r.payroll_period_id WHERE r.id = ?`).get(recordId) as
      { basic_salary: number; total_bonuses: number; total_allowances: number; total_deductions: number;
        total_advance_repayments: number; net_salary: number; period_status: string } | undefined
    if (!record || record.period_status !== 'Draft') throw new Error('Payroll items can only be changed in draft payroll.')
    const bonus = record.total_bonuses + (input.itemType === 'Bonus' ? input.amount : 0)
    const allowance = record.total_allowances + (input.itemType === 'Allowance' ? input.amount : 0)
    const deduction = record.total_deductions + (input.itemType === 'Deduction' ? input.amount : 0)
    const advanceRepayment = record.total_advance_repayments + (input.itemType === 'Advance Repayment' ? input.amount : 0)
    const otherAdjustment = Number((db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM hr_payroll_items
      WHERE payroll_record_id = ? AND item_type = 'Other Adjustment'`).get(recordId) as { total: number }).total)
      + (input.itemType === 'Other Adjustment' ? input.amount : 0)
    const netSalary = record.basic_salary + bonus + allowance - deduction - advanceRepayment + otherAdjustment
    if (!Number.isSafeInteger(netSalary) || netSalary < 0) throw new Error('Payroll item would make net salary invalid.')
    db.prepare(`INSERT INTO hr_payroll_items(payroll_record_id, item_type, description, amount, created_by)
      VALUES (?, ?, ?, ?, ?)`).run(recordId, input.itemType, description, input.amount, actorName(actor))
    db.prepare(`UPDATE hr_payroll_records SET total_bonuses = ?, total_allowances = ?,
      total_deductions = ?, total_advance_repayments = ?, net_salary = ? WHERE id = ?`)
      .run(bonus, allowance, deduction, advanceRepayment, netSalary, recordId)
    audit(db, actorName(actor), 'payroll_record', recordId, 'item added', undefined, input)
  })
  add()
}

export function generateHrPayroll(db: Database.Database, actor: string, month: number, year: number): void {
  if (!Number.isSafeInteger(month) || month < 1 || month > 12 || !Number.isSafeInteger(year) || year < 2000 || year > 2200) {
    throw new Error('Select a valid payroll month and year.')
  }
  const generate = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM hr_payroll_periods WHERE month = ? AND year = ?').get(month, year)) {
      throw new Error('A payroll period already exists for that month.')
    }
    const employees = db.prepare(`SELECT id, hourly_rate AS hourlyRate FROM hr_employees
      WHERE status = 'Active' AND archived_at IS NULL ORDER BY id`).all() as Array<{ id: number; hourlyRate: number }>
    if (employees.length === 0) throw new Error('No active employees are eligible for payroll.')
    if (employees.some((employee) => employee.hourlyRate <= 0)) throw new Error('Set an hourly rate for every active employee before generating payroll.')
    const result = db.prepare('INSERT INTO hr_payroll_periods(month, year, created_by) VALUES (?, ?, ?)')
      .run(month, year, actorName(actor))
    const periodId = Number(result.lastInsertRowid)
    const insert = db.prepare(`INSERT INTO hr_payroll_records(employee_id, payroll_period_id, basic_salary, hourly_rate,
      worked_minutes, net_salary) VALUES (?, ?, ?, ?, ?, ?)`)
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`
    for (const employee of employees) {
      const calculation = calculateHrPay(db, employee.id, startDate, endDate)
      insert.run(employee.id, periodId, calculation.grossPay, employee.hourlyRate, calculation.workedMinutes, calculation.grossPay)
    }
    audit(db, actorName(actor), 'payroll', periodId, 'generated', undefined, { month, year })
  })
  generate()
}

export function approveHrPayroll(db: Database.Database, actor: string, id: number): void {
  const approve = db.transaction(() => {
    const period = db.prepare('SELECT status FROM hr_payroll_periods WHERE id = ?').get(id) as { status: string } | undefined
    if (!period || period.status !== 'Draft') throw new Error('Only draft payroll can be approved.')
    db.prepare("UPDATE hr_payroll_periods SET status = 'Approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(actorName(actor), id)
    audit(db, actorName(actor), 'payroll', id, 'approved', period, { status: 'Approved' })
  })
  approve()
}

export function markHrPayrollPaid(db: Database.Database, actor: string, id: number): void {
  const markPaid = db.transaction(() => {
    const period = db.prepare('SELECT status FROM hr_payroll_periods WHERE id = ?').get(id) as { status: string } | undefined
    if (!period || period.status !== 'Approved') throw new Error('Only approved payroll can be marked paid.')
    db.prepare("UPDATE hr_payroll_records SET payment_status = 'Paid', paid_at = CURRENT_TIMESTAMP WHERE payroll_period_id = ?")
      .run(id)
    db.prepare("UPDATE hr_payroll_periods SET status = 'Paid' WHERE id = ?").run(id)
    audit(db, actorName(actor), 'payroll', id, 'marked paid', period, { status: 'Paid' })
  })
  markPaid()
}

export function buildHrCsvReport(db: Database.Database, type: HrReportType): string {
  const reports: Record<HrReportType, { columns: string[]; sql: string; transform?: (row: unknown[]) => unknown[] }> = {
    employees: {
      columns: ['Employee ID', 'Full Name', 'Department', 'Job Title', 'Phone', 'Email', 'Hire Date', 'Employment Type', 'Status', 'Hourly Rate IQD'],
      sql: `SELECT e.employee_code, e.full_name, COALESCE(d.name, ''), e.job_title, e.phone, e.email,
        e.hire_date, e.employment_type, e.status, e.hourly_rate
        FROM hr_employees e LEFT JOIN hr_departments d ON d.id = e.department_id
        ORDER BY e.full_name COLLATE NOCASE`
    },
    attendance: {
      columns: ['Date', 'Name', 'Check In', 'Check Out', 'Overtime (minutes)', 'Deduction (minutes)'],
      sql: `SELECT a.attendance_date, e.full_name, a.check_in, a.check_out, e.work_start, e.work_end
        FROM hr_attendance a JOIN hr_employees e ON e.id = a.employee_id
        ORDER BY a.attendance_date DESC, e.full_name COLLATE NOCASE`,
      transform: ([date, name, checkIn, checkOut, workStart, workEnd]) => [
        date,
        name,
        checkIn,
        checkOut,
        typeof checkIn === 'string' && typeof checkOut === 'string'
          && typeof workStart === 'string' && typeof workEnd === 'string'
          ? Math.max(0, timeInMinutes(checkOut) - timeInMinutes(workEnd))
          : '',
        typeof checkIn === 'string' && typeof workStart === 'string'
          ? Math.max(0, timeInMinutes(checkIn) - timeInMinutes(workStart))
          : ''
      ]
    },
    leaves: {
      columns: ['Employee ID', 'Employee', 'Department', 'Leave Type', 'Start Date', 'End Date', 'Days', 'Reason', 'Status', 'Approved By'],
      sql: `SELECT e.employee_code, e.full_name, COALESCE(d.name, ''), l.leave_type, l.start_date,
        l.end_date, l.total_days, l.reason, l.status, COALESCE(l.approved_by, '')
        FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id
        LEFT JOIN hr_departments d ON d.id = e.department_id ORDER BY l.created_at DESC`
    },
    payroll: {
      columns: ['Year', 'Month', 'Status', 'Employees', 'Net Payroll IQD', 'Created By', 'Approved By'],
      sql: `SELECT p.year, p.month, p.status, COUNT(r.id), COALESCE(SUM(r.net_salary), 0),
        p.created_by, COALESCE(p.approved_by, '')
        FROM hr_payroll_periods p LEFT JOIN hr_payroll_records r ON r.payroll_period_id = p.id
        GROUP BY p.id ORDER BY p.year DESC, p.month DESC`
    },
    documents: {
      columns: ['Employee', 'Document Name', 'Document Type', 'Issue Date', 'Expiration Date', 'Uploaded By', 'Uploaded At'],
      sql: `SELECT e.full_name, d.document_name, d.document_type, d.issue_date, d.expiration_date,
        d.uploaded_by, d.created_at FROM hr_employee_documents d JOIN hr_employees e ON e.id = d.employee_id
        ORDER BY d.expiration_date, e.full_name COLLATE NOCASE`
    },
    activity: {
      columns: ['Date', 'User', 'Entity', 'Record ID', 'Action', 'Old Values', 'New Values'],
      sql: `SELECT created_at, user_id, entity_type, entity_id, action, old_values, new_values
        FROM hr_audit_logs ORDER BY created_at DESC LIMIT 10000`
    }
  }
  const report = reports[type]
  if (!report) throw new Error('Unsupported HR report.')
  const sourceRows = db.prepare(report.sql).raw().all() as unknown[][]
  const rows = report.transform ? sourceRows.map(report.transform) : sourceRows
  const escape = (value: unknown) => {
    let text = String(value ?? '')
    if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  return `\uFEFF${[report.columns, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')}`
}
