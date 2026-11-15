import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Clock3, LockKeyhole, Plus, RefreshCw, Users, Wallet } from 'lucide-react'
import { HrEmployeeDirectory, HrEmployeeProfileView } from './HrEmployeeViews'
import { HrCvsBank } from './HrCvsBank'
import type {
  AuthUser, HrAttendance, HrAttendanceDay, HrDashboard, HrDepartment, HrEmployee, HrPayrollPeriod
} from '../shared/types'

type Section = 'Overview' | 'Employees' | 'Attendance' | 'CVs Bank' | 'Reports' | 'Security'

function localDate(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localTime(): string {
  const date = new Date()
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function money(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(value)} IQD`
}

export function HrPage({ query, setNotice, user }: { query: string; setNotice: (message: string) => void; user: AuthUser }) {
  const [section, setSection] = useState<Section>('Overview')
  const [passwordConfigured, setPasswordConfigured] = useState<boolean | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [accessPassword, setAccessPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resettingPassword, setResettingPassword] = useState(false)
  const [administratorPassword, setAdministratorPassword] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [confirmResetPassword, setConfirmResetPassword] = useState('')
  const [dashboard, setDashboard] = useState<HrDashboard | null>(null)
  const [employees, setEmployees] = useState<HrEmployee[]>([])
  const [applicationUsers, setApplicationUsers] = useState<AuthUser[]>([])
  const [departments, setDepartments] = useState<HrDepartment[]>([])
  const [attendance, setAttendance] = useState<HrAttendance[]>([])
  const [attendanceDays, setAttendanceDays] = useState<HrAttendanceDay[]>([])
  const [attendanceEmployeeId, setAttendanceEmployeeId] = useState<number | null>(null)
  const [attendanceDate, setAttendanceDate] = useState(localDate)
  const [attendanceTimeDialog, setAttendanceTimeDialog] = useState<{ record: HrAttendance; action: 'in' | 'out' } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [payroll, setPayroll] = useState<HrPayrollPeriod[]>([])
  const [employeeForm, setEmployeeForm] = useState(false)
  const [editing, setEditing] = useState<HrEmployee | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null)
  const [profileReloadKey, setProfileReloadKey] = useState(0)
  const [employeeDirectoryView, setEmployeeDirectoryView] = useState<'list' | 'kanban'>('kanban')
  const [departmentForm, setDepartmentForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const now = new Date()
  const [month] = useState(now.getMonth() + 1)
  const year = now.getFullYear()
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth() + 1)
  const [calendarYear, setCalendarYear] = useState(now.getFullYear())
  const hrNotice = useCallback((message: string) => {
    if (message.includes('Unlock Human Resources with the HR password')) setUnlocked(false)
    setNotice(message)
  }, [setNotice])

  useEffect(() => {
    void window.blueLine.hr.passwordStatus()
      .then(({ configured }) => setPasswordConfigured(configured))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : 'Unable to check HR password status.'))
  }, [])

  async function refresh() {
    if (!unlocked) return
    setLoading(true)
    try {
      const [stats, employeeRows, departmentRows, attendanceRows, attendanceCalendarRows, payrollRows, userRows] = await Promise.all([
        window.blueLine.hr.dashboard(),
        window.blueLine.hr.listEmployees(query, showArchived),
        window.blueLine.hr.listDepartments(),
        window.blueLine.hr.listAttendance(attendanceDate),
        window.blueLine.hr.listAttendanceCalendar(calendarYear, calendarMonth, attendanceEmployeeId ?? undefined),
        window.blueLine.hr.listPayrollPeriods(),
        user.role === 'admin' ? window.blueLine.applicationUsers.list() : Promise.resolve([])
      ])
      setDashboard(stats)
      setEmployees(employeeRows)
      setDepartments(departmentRows)
      setAttendance(attendanceRows)
      setAttendanceDays(attendanceCalendarRows)
      setPayroll(payrollRows)
      setApplicationUsers(userRows)
      setLoadError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load HR data.'
      setLoadError(message)
      hrNotice(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [unlocked, query, attendanceDate, showArchived, year, calendarYear, calendarMonth, attendanceEmployeeId, user])

  async function submitAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const password = String(data.get('password') ?? '')
    try {
      if (!passwordConfigured && user.role === 'admin') {
        const confirmation = String(data.get('confirmPassword') ?? '')
        if (password !== confirmation) throw new Error('The passwords do not match.')
        await window.blueLine.hr.setupPassword(password)
        setPasswordConfigured(true)
      } else {
        await window.blueLine.hr.unlock(password)
      }
      setAccessPassword('')
      setUnlocked(true)
      setNotice('Human Resources unlocked.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to unlock Human Resources.')
    }
  }

  async function submitPasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setNotice('The new passwords do not match.')
      return
    }
    try {
      await window.blueLine.hr.changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice('HR password changed.')
    } catch (error) {
      hrNotice(error instanceof Error ? error.message : 'Unable to change the HR password.')
    }
  }

  async function submitPasswordReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (resetPassword !== confirmResetPassword) {
      setNotice('The new passwords do not match.')
      return
    }
    try {
      await window.blueLine.hr.resetPassword(administratorPassword, resetPassword)
      setAdministratorPassword('')
      setResetPassword('')
      setConfirmResetPassword('')
      setResettingPassword(false)
      setUnlocked(true)
      setNotice('HR password reset. Human Resources unlocked.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to reset the HR password.')
    }
  }

  async function perform(action: () => Promise<unknown>, success: string): Promise<boolean> {
    try {
      await action()
      setNotice(success)
      await refresh()
      return true
    } catch (error) {
      hrNotice(error instanceof Error ? error.message : 'The HR operation could not be completed.')
      return false
    }
  }

  async function saveAttendanceTime(time: string): Promise<boolean> {
    if (!attendanceTimeDialog) return false
    const { record, action } = attendanceTimeDialog
    const status = record.status === 'Unmarked' || record.status === 'Day Off' ? 'Present' : record.status
    const checkIn = action === 'in' ? time : record.checkIn
    const checkOut = action === 'out' ? time : record.checkOut
    const saved = await perform(() => window.blueLine.hr.saveAttendance({
      employeeId: record.employeeId, attendanceDate, checkIn, checkOut, status, notes: record.notes
    }), `${record.fullName} checked ${action === 'in' ? 'in' : 'out'} at ${time}.`)
    if (saved) setAttendanceTimeDialog(null)
    return saved
  }

  async function submitEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const employee = {
      ...(editing ? { id: editing.id } : {}),
      fullName: String(data.get('fullName') ?? ''),
      phone: String(data.get('phone') ?? ''),
      email: String(data.get('email') ?? ''),
      departmentId: data.get('departmentId') ? Number(data.get('departmentId')) : null,
      jobTitle: String(data.get('jobTitle') ?? ''),
      hireDate: String(data.get('hireDate') ?? ''),
      employmentType: String(data.get('employmentType') ?? 'Full-time'),
      status: String(data.get('status') ?? 'Active'),
      hourlyRate: Number(data.get('hourlyRate') ?? 0),
      workStart: String(data.get('workStart') ?? '') || null,
      workEnd: String(data.get('workEnd') ?? '') || null,
      ...(user.role === 'admin' ? { appUserId: data.get('appUserId') ? Number(data.get('appUserId')) : null } : {})
    }
    const updatedEmployeeId = editing?.id
    if (await perform(() => window.blueLine.hr.saveEmployee(employee), editing ? 'Employee updated.' : 'Employee created.')) {
      setEmployeeForm(false)
      setEditing(null)
      if (updatedEmployeeId !== undefined && updatedEmployeeId === selectedEmployeeId) {
        setProfileReloadKey((value) => value + 1)
      }
    }
  }

  async function exportHrReport(report: 'employees' | 'attendance' | 'leaves' | 'payroll' | 'documents' | 'activity') {
    try {
      if (await window.blueLine.hr.exportReport(report)) setNotice('HR report exported.')
    } catch (error) {
      hrNotice(error instanceof Error ? error.message : 'Unable to export HR report.')
    }
  }

  const nav: Section[] = ['Overview', 'Employees', 'Attendance', 'CVs Bank', 'Reports', ...(user.role === 'admin' ? ['Security' as const] : [])]
  const activePayroll = useMemo(() => payroll.reduce((sum, item) => item.month === month && item.year === year ? sum + item.totalNet : sum, 0), [payroll, month, year])
  const daysInCalendarMonth = new Date(calendarYear, calendarMonth, 0).getDate()
  const calendarOffset = new Date(calendarYear, calendarMonth - 1, 1).getDay()
  const calendarSummary = new Map(attendanceDays.map((day) => [day.date, day]))
  const selectedAttendanceEmployee = attendance.find(({ employeeId }) => employeeId === attendanceEmployeeId)
  const visibleAttendance = attendanceEmployeeId === null
    ? attendance
    : attendance.filter(({ employeeId }) => employeeId === attendanceEmployeeId)
  const calendarCells = [...Array.from({ length: calendarOffset }, () => null), ...Array.from({ length: daysInCalendarMonth }, (_, index) => index + 1)]

  if (passwordConfigured === null) return <div className="panel hr-access"><LockKeyhole size={28} /><h1>Human Resources</h1><p>Checking HR access…</p></div>
  if (!unlocked) return <div className="panel hr-access">
    <LockKeyhole size={28} /><h1>{passwordConfigured ? 'Unlock Human Resources' : 'Create the HR password'}</h1>
    <p>{passwordConfigured ? 'Enter the separate HR password to view employee and payroll records.' : user.role === 'admin' ? 'Create a password used only to protect Human Resources.' : 'An administrator must sign in and create the HR password before anyone can access this section.'}</p>
    {(!passwordConfigured && user.role === 'admin') || passwordConfigured ? <form className="hr-form hr-form-single" onSubmit={(event) => void submitAccess(event)}>
      <label className="field"><span>{passwordConfigured ? 'HR password' : 'Create password'}</span><input name="password" type="password" minLength={8} maxLength={256} autoComplete="current-password" required value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} /></label>
      {!passwordConfigured && <label className="field"><span>Confirm password</span><input name="confirmPassword" type="password" minLength={8} maxLength={256} autoComplete="new-password" required /></label>}
      <button className="primary-btn"><LockKeyhole size={15} />{passwordConfigured ? 'Unlock HR' : 'Create HR password'}</button>
    </form> : null}
    {passwordConfigured && user.role === 'admin' && (resettingPassword
      ? <form className="hr-form hr-form-single" onSubmit={(event) => void submitPasswordReset(event)}>
        <h2>Reset HR password</h2>
        <p>Verify your administrator sign-in password to set a new HR password.</p>
        <label className="field"><span>Administrator password</span><input type="password" autoComplete="current-password" required value={administratorPassword} onChange={(event) => setAdministratorPassword(event.target.value)} /></label>
        <label className="field"><span>New HR password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
        <label className="field"><span>Confirm new HR password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={confirmResetPassword} onChange={(event) => setConfirmResetPassword(event.target.value)} /></label>
        <button className="primary-btn"><RefreshCw size={15} />Reset HR password</button>
        <button type="button" className="secondary-btn" onClick={() => { setResettingPassword(false); setAdministratorPassword(''); setResetPassword(''); setConfirmResetPassword('') }}>Cancel</button>
      </form>
      : <button type="button" className="secondary-btn" onClick={() => setResettingPassword(true)}>Reset HR password</button>)}
  </div>
  return <div className="page-stack hr-page">
    <div className="page-heading">
      <div><p className="eyebrow">PEOPLE OPERATIONS</p><h1>Human Resources</h1><p className="subheading">Manage employees, attendance, candidate pipelines, and payroll.</p></div>
      <button className="secondary-btn" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? 'spin' : ''} />Refresh</button>
    </div>
    <div className="hr-tabs" role="tablist" aria-label="Human Resources sections">
      {nav.map((item) => <button key={item} role="tab" aria-selected={section === item} className={section === item ? 'selected' : ''} onClick={() => setSection(item)}>{item}</button>)}
    </div>
    {section === 'Overview' && <section className="hr-section">
      <div className="hr-stat-grid">
        <HrStat icon={<Users size={17} />} label="Total employees" value={dashboard?.totalEmployees ?? '—'} />
        <HrStat icon={<Users size={17} />} label="Active employees" value={dashboard?.activeEmployees ?? '—'} />
        <HrStat icon={<CalendarCheck size={17} />} label="Present today" value={dashboard?.presentToday ?? '—'} />
        <HrStat icon={<Clock3 size={17} />} label="Absent today" value={dashboard?.absentToday ?? '—'} />
        <HrStat icon={<CalendarCheck size={17} />} label="On approved leave" value={dashboard?.onLeaveToday ?? '—'} />
        <HrStat icon={<Clock3 size={17} />} label="Pending leave requests" value={dashboard?.pendingLeaveRequests ?? '—'} />
        <HrStat icon={<Wallet size={17} />} label="Current month payroll" value={money(dashboard?.currentMonthPayrollTotal ?? 0)} />
      </div>
      <div className="hr-overview-grid">
        <section className="panel"><div className="panel-heading"><div><h2>Recent employees</h2><p>Current active employee directory</p></div><button className="text-btn" onClick={() => setSection('Employees')}>View employees</button></div>
          <div className="table-scroll"><table><thead><tr><th>EMPLOYEE</th><th>DEPARTMENT</th><th>JOB TITLE</th><th>STATUS</th></tr></thead><tbody>
            {employees.slice(0, 6).map((employee) => <tr key={employee.id}><td><strong>{employee.fullName}</strong><small>{employee.employeeCode}</small></td><td>{employee.departmentName || '—'}</td><td>{employee.jobTitle || '—'}</td><td><span className="status-pill green"><i />{employee.status}</span></td></tr>)}
            {!employees.length && <tr><td colSpan={4}>No employees yet.</td></tr>}
          </tbody></table></div>
        </section>
        <section className="panel"><div className="panel-heading"><div><h2>Payroll period</h2><p>{new Date(year, month - 1).toLocaleString('en', { month: 'long', year: 'numeric' })}</p></div></div>
          <div className="hr-payroll-highlight"><Wallet size={22} /><strong>{money(activePayroll)}</strong><span>Net amount for the selected period</span></div>
        </section>
      </div>
    </section>}
    {section === 'Employees' && (selectedEmployeeId !== null
      ? <HrEmployeeProfileView
        employeeId={selectedEmployeeId}
        reloadKey={profileReloadKey}
        user={user}
        onBack={() => setSelectedEmployeeId(null)}
        onEdit={(employee) => { setEditing(employee); setEmployeeForm(true) }}
        onDelete={async (employee) => {
          if (!window.confirm(`Permanently delete ${employee.fullName} and all linked attendance, leave, payroll, advances, documents, and photos? This cannot be undone. An audit entry will be retained.`)) return false
          const deleted = await perform(() => window.blueLine.hr.deleteEmployee(employee.id), 'Employee and related HR data permanently deleted.')
          if (deleted) setSelectedEmployeeId(null)
          return deleted
        }}
        onPhotoUpdated={(employeeId, photoDataUrl) => setEmployees((current) => current.map((employee) =>
          employee.id === employeeId ? { ...employee, photoDataUrl } : employee))}
        setNotice={hrNotice}
      />
      : <HrEmployeeDirectory
        employees={employees}
        departments={departments}
        loading={loading}
        loadError={loadError}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((value) => !value)}
        onRetry={() => void refresh()}
        onAdd={() => { setEditing(null); setEmployeeForm(true) }}
        onManageDepartments={() => setDepartmentForm(true)}
        onEdit={(employee) => { setEditing(employee); setEmployeeForm(true) }}
        onArchive={(employee) => {
          if (window.confirm(`Archive ${employee.fullName}? Historical HR records will be retained.`)) {
            void perform(() => window.blueLine.hr.archiveEmployee(employee.id, true), 'Employee archived.')
          }
        }}
        onRestore={(employee) => void perform(() => window.blueLine.hr.archiveEmployee(employee.id, false), 'Employee restored.')}
        onDelete={async (employee) => {
          if (!window.confirm(`Permanently delete ${employee.fullName} and all linked attendance, leave, payroll, advances, documents, and photos? This cannot be undone. An audit entry will be retained.`)) return false
          return perform(() => window.blueLine.hr.deleteEmployee(employee.id), 'Employee and related HR data permanently deleted.')
        }}
        onOpenProfile={setSelectedEmployeeId}
        view={employeeDirectoryView}
        onViewChange={setEmployeeDirectoryView}
      />)}
    {section === 'Attendance' && <section className="panel hr-panel">
      <div className="panel-heading"><div><h2>Attendance</h2><p>Select a date, enter the times if needed, and record check-in, check-out, or a day off for each active employee.</p></div></div>
      <div className="hr-attendance-layout">
        <div className="hr-attendance-main">
          <div className="panel-heading hr-attendance-heading"><div><h2>Attendance for {attendanceDate}{selectedAttendanceEmployee ? ` · ${selectedAttendanceEmployee.fullName}` : ''}</h2><p>Times can be entered manually for any date.</p></div></div>
          <div className="table-scroll"><table><thead><tr><th>EMPLOYEE</th><th>APPLICATION USER</th><th>DEPARTMENT</th><th>TIME RECORD</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>
            {visibleAttendance.map((item) => <AttendanceRow key={item.employeeId} record={item}
              onCheckIn={() => setAttendanceTimeDialog({ record: item, action: 'in' })}
              onCheckOut={() => setAttendanceTimeDialog({ record: item, action: 'out' })}
              onDayOff={() => {
                if ((item.checkIn || item.checkOut) && !window.confirm(`${item.fullName} already has recorded hours on this date. Marking Day off will clear those times. Continue?`)) return
                void perform(() => window.blueLine.hr.saveAttendance({
                  employeeId: item.employeeId, attendanceDate, checkIn: null, checkOut: null, status: 'Day Off', notes: item.notes
                }), `${item.fullName} marked Day off.`)
              }} />)}
            {!visibleAttendance.length && <tr><td colSpan={6} className="hr-empty">No active employees to mark.</td></tr>}
          </tbody></table></div>
        </div>
        <aside className="hr-calendar hr-attendance-calendar">
          <label className="hr-attendance-employee-select"><span>Employee calendar</span><select
            value={attendanceEmployeeId ?? ''}
            onChange={(event) => setAttendanceEmployeeId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">All employees</option>
            {attendance.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>
              {employee.fullName} · {employee.employeeCode}
            </option>)}
          </select></label>
          <div className="hr-calendar-heading"><button className="secondary-btn small" aria-label="Previous month" onClick={() => { const date = new Date(calendarYear, calendarMonth - 2, 1); setCalendarYear(date.getFullYear()); setCalendarMonth(date.getMonth() + 1) }}><ChevronLeft size={15} /></button><strong>{new Date(calendarYear, calendarMonth - 1).toLocaleString('en', { month: 'long', year: 'numeric' })}</strong><button className="secondary-btn small" aria-label="Next month" onClick={() => { const date = new Date(calendarYear, calendarMonth, 1); setCalendarYear(date.getFullYear()); setCalendarMonth(date.getMonth() + 1) }}><ChevronRight size={15} /></button></div>
          <div className="hr-calendar-grid">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="hr-calendar-weekday" key={day}>{day}</span>)}{calendarCells.map((day, index) => {
            if (day === null) return <span className="hr-calendar-empty" key={`empty-${index}`} />
            const date = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const summary = calendarSummary.get(date)
            const hasDayOff = Boolean(summary?.dayOffCount)
            const daySummary = summary
              ? selectedAttendanceEmployee
                ? `${summary.status ?? 'Attendance record'}${summary.checkIn ? `, checked in ${summary.checkIn}` : ''}${summary.checkOut ? `, checked out ${summary.checkOut}` : ''}`
                : `${summary.dayOffCount} day off, ${summary.checkedOut} checked out of ${summary.total}`
              : ''
            const individualStatus = selectedAttendanceEmployee
              ? hasDayOff ? 'Off' : summary?.checkIn ?? summary?.status
              : summary ? `${hasDayOff ? `${summary.dayOffCount} off · ` : ''}${summary.checkedOut}/${summary.total}` : ''
            return <button key={date} className={`hr-calendar-day${date === attendanceDate ? ' selected' : ''}${hasDayOff ? ' day-off' : ''}${selectedAttendanceEmployee && summary && !hasDayOff ? ' attendance-recorded' : ''}`} onClick={() => setAttendanceDate(date)} aria-label={`${date}${daySummary ? `, ${daySummary}` : ''}`}>
              <span>{day}</span>{summary && <small>{individualStatus}</small>}
            </button>
          })}</div>
          <p className="hr-calendar-legend">{selectedAttendanceEmployee
            ? <><i /><i className="attendance-recorded" />Showing {selectedAttendanceEmployee.fullName}'s records. Yellow is day off; blue marks attendance.</>
            : <><i />Yellow dates have at least one employee marked Day off.</>}</p>
        </aside>
      </div>
      {attendanceTimeDialog && <AttendanceTimeDialog
        record={attendanceTimeDialog.record}
        action={attendanceTimeDialog.action}
        onClose={() => setAttendanceTimeDialog(null)}
        onSave={saveAttendanceTime}
      />}
    </section>}
    {section === 'CVs Bank' && <HrCvsBank departments={departments} setNotice={hrNotice} />}
    {section === 'Reports' && <section className="panel hr-panel"><div className="panel-heading"><div><h2>HR reports</h2><p>Export current database records as CSV files that open in spreadsheet software.</p></div></div>
      <div className="hr-report-grid">{([
        ['employees', 'Employee directory', 'Employee identity, department, status, and salary.'],
        ['attendance', 'Attendance report', 'Recorded check-in, check-out, and attendance statuses.'],
        ['leaves', 'Leave report', 'Leave dates, type, status, and approver.'],
        ['payroll', 'Payroll summary', 'Monthly periods, employee totals, and approval state.'],
        ['documents', 'Document expiration report', 'Employee documents and expiration dates.'],
        ['activity', 'HR activity report', 'Administrator audit events and recorded changes.']
      ] as const).map(([report, title, description]) => <div className="hr-report-card" key={report}><div><strong>{title}</strong><p>{description}</p></div><button className="secondary-btn small" onClick={() => void exportHrReport(report)}>Export CSV</button></div>)}</div>
    </section>}
    {section === 'Security' && user.role === 'admin' && <section className="panel hr-panel"><div className="panel-heading"><div><h2>HR password</h2><p>This password is separate from the app sign-in and protects all HR records.</p></div></div>
      <form className="hr-form hr-form-single hr-security-form" onSubmit={(event) => void submitPasswordChange(event)}>
        <label className="field"><span>Current HR password</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label className="field"><span>New HR password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        <button className="primary-btn"><LockKeyhole size={15} />Change HR password</button>
      </form>
    </section>}
    {employeeForm && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setEmployeeForm(false); setEditing(null) } }}><form className="modal hr-modal" onSubmit={(event) => void submitEmployee(event)}>
      <div className="modal-head"><div><p className="eyebrow">EMPLOYEE RECORD</p><h2>{editing ? 'Edit employee' : 'Add employee'}</h2></div><button type="button" className="icon-btn" onClick={() => { setEmployeeForm(false); setEditing(null) }}>×</button></div>
      <div className="hr-form">
        <label className="field"><span>Full name</span><input name="fullName" required defaultValue={editing?.fullName ?? ''} /></label>
        <div className="hr-form-pair"><label className="field"><span>Phone</span><input name="phone" defaultValue={editing?.phone ?? ''} /></label><label className="field"><span>Email</span><input name="email" type="email" defaultValue={editing?.email ?? ''} /></label></div>
        <div className="hr-form-pair"><label className="field"><span>Department</span><select name="departmentId" defaultValue={editing?.departmentId ?? ''}><option value="">Unassigned</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>Job title</span><input name="jobTitle" defaultValue={editing?.jobTitle ?? ''} /></label></div>
        <div className="hr-form-pair"><label className="field"><span>Hire date</span><input name="hireDate" type="date" required defaultValue={editing?.hireDate ?? localDate()} /></label><label className="field"><span>Employment type</span><select name="employmentType" defaultValue={editing?.employmentType ?? 'Full-time'}>{['Full-time', 'Part-time', 'Contract', 'Temporary'].map((type) => <option key={type}>{type}</option>)}</select></label></div>
        <div className="hr-form-pair"><label className="field"><span>Work hours from</span><input name="workStart" type="time" defaultValue={editing?.workStart ?? ''} /></label><label className="field"><span>Work hours to</span><input name="workEnd" type="time" defaultValue={editing?.workEnd ?? ''} /></label></div>
        {user.role === 'admin' && <label className="field"><span>Application user</span><select name="appUserId" defaultValue={editing?.appUserId ?? ''}><option value="">Unassigned</option>{applicationUsers.map((appUser) => <option key={appUser.id} value={appUser.id}>{appUser.displayName} · @{appUser.username}</option>)}</select></label>}
        {editing && <label className="field"><span>Status</span><select name="status" defaultValue={editing.status}>{['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated'].map((status) => <option key={status}>{status}</option>)}</select></label>}
        <label className="field"><span>Hourly rate (IQD)</span><input name="hourlyRate" type="number" min="1" step="1" required defaultValue={editing?.hourlyRate ?? 1} /></label>
      </div>
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => { setEmployeeForm(false); setEditing(null) }}>Cancel</button><button className="primary-btn">{editing ? 'Save changes' : 'Create employee'}</button></div>
    </form></div>}
    {departmentForm && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDepartmentForm(false) }}><form className="modal hr-modal" onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void perform(() => window.blueLine.hr.saveDepartment({ name: String(data.get('name') ?? ''), description: String(data.get('description') ?? '') }), 'Department saved.')
        .then((saved) => { if (saved) setDepartmentForm(false) })
    }}><div className="modal-head"><div><p className="eyebrow">ORGANIZATION</p><h2>Manage departments</h2></div><button type="button" className="icon-btn" onClick={() => setDepartmentForm(false)}>×</button></div>
      <div className="hr-department-list">{departments.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.description}</span></div>)}</div>
      <div className="hr-form"><label className="field"><span>Department name</span><input name="name" required minLength={2} /></label><label className="field"><span>Description</span><input name="description" /></label></div>
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setDepartmentForm(false)}>Close</button><button className="primary-btn"><Plus size={14} />Add department</button></div>
    </form></div>}
  </div>
}

function HrStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return <div className="panel hr-stat"><span className="hr-stat-icon">{icon}</span><span className="hr-stat-label">{label}</span><strong>{value}</strong></div>
}

function AttendanceRow({ record, onCheckIn, onCheckOut, onDayOff }: {
  record: HrAttendance
  onCheckIn: () => void
  onCheckOut: () => void
  onDayOff: () => void
}) {
  const statusClass = record.status === 'Day Off' ? 'amber' : record.checkOut ? 'green' : record.checkIn ? 'blue' : 'gray'
  return <tr>
    <td><strong>{record.fullName}</strong><small>{record.employeeCode}</small></td>
    <td className="hr-attendance-user">{record.appUserDisplayName
      ? <><strong>{record.appUserDisplayName}</strong><small>@{record.appUsername}</small></>
      : <span>Not assigned</span>}</td>
    <td>{record.departmentName || '—'}</td>
    <td className="hr-attendance-recorded-times"><span>In: {record.checkIn || '—'}</span><span>Out: {record.checkOut || '—'}</span></td>
    <td><span className={`status-pill ${statusClass}`}><i />{record.status}</span></td>
    <td><div className="hr-attendance-actions">
      <button className="secondary-btn small hr-clock-button" onClick={onCheckIn}><Check size={13} />Check in</button>
      <button className="secondary-btn small hr-clock-button" disabled={!record.checkIn} onClick={onCheckOut}><Check size={13} />Check out</button>
      <button className="secondary-btn small hr-day-off-button" disabled={record.status === 'Day Off'} onClick={onDayOff}>Day off</button>
    </div></td>
  </tr>
}

function AttendanceTimeDialog({ record, action, onClose, onSave }: {
  record: HrAttendance
  action: 'in' | 'out'
  onClose: () => void
  onSave: (time: string) => Promise<boolean>
}) {
  const [time, setTime] = useState((action === 'in' ? record.checkIn : record.checkOut) ?? localTime())
  const [saving, setSaving] = useState(false)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(time)
    } finally {
      setSaving(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <form className="modal hr-modal hr-attendance-time-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-time-title" onSubmit={(event) => void submit(event)}>
      <div className="modal-head"><div><p className="eyebrow">{record.attendanceDate}</p><h2 id="attendance-time-title">{action === 'in' ? 'Set check-in time' : 'Set check-out time'}</h2><p>{record.fullName}</p></div><button type="button" className="icon-btn" disabled={saving} aria-label="Close dialog" onClick={onClose}>×</button></div>
      <label className="field"><span>{action === 'in' ? 'Check-in time' : 'Check-out time'}</span><input type="time" required autoFocus value={time} onChange={(event) => setTime(event.target.value)} /></label>
      <div className="modal-actions"><button type="button" className="secondary-btn" disabled={saving} onClick={onClose}>Cancel</button><button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : `Save check-${action === 'in' ? 'in' : 'out'}`}</button></div>
    </form>
  </div>
}
