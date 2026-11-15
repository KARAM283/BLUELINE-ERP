import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, BriefcaseBusiness, Building2, Camera, Clock3, FileText, LayoutGrid, List, Mail, Trash2,
  MoreHorizontal, Pencil, Phone, Search, SlidersHorizontal, UserRound
} from 'lucide-react'
import type {
  AuthUser, HrAttendance, HrDepartment, HrEmployee, HrEmployeeProfile
} from '../shared/types'

type ProfileTab = 'Personal' | 'Employment' | 'Attendance' | 'Leave' | 'Payroll' | 'Documents' | 'Activity'
type DirectoryView = 'kanban' | 'list'

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase() || '?'
}

function employeeStatus(employee: HrEmployee): string {
  return employee.archivedAt ? 'Archived' : employee.status
}

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(value)} IQD`
}

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : '—'
}

function Avatar({ employee, large = false }: { employee: HrEmployee; large?: boolean }) {
  return <span className={`hr-employee-avatar${large ? ' large' : ''}`}>
    {employee.photoDataUrl
      ? <img src={employee.photoDataUrl} alt={`${employee.fullName} profile`} />
      : <span aria-hidden="true">{initials(employee.fullName)}</span>}
  </span>
}

export function HrEmployeeDirectory({
  employees, departments, loading, loadError, showArchived, onToggleArchived, onRetry, onAdd,
  onManageDepartments, onEdit, onArchive, onRestore, onDelete, onOpenProfile, view, onViewChange
}: {
  employees: HrEmployee[]
  departments: HrDepartment[]
  loading: boolean
  loadError: string
  showArchived: boolean
  onToggleArchived: () => void
  onRetry: () => void
  onAdd: () => void
  onManageDepartments: () => void
  onEdit: (employee: HrEmployee) => void
  onArchive: (employee: HrEmployee) => void
  onRestore: (employee: HrEmployee) => void
  onDelete: (employee: HrEmployee) => void
  onOpenProfile: (employeeId: number) => void
  view: DirectoryView
  onViewChange: (view: DirectoryView) => void
}) {
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterCount = Number(Boolean(search.trim())) + Number(Boolean(departmentFilter))
    + Number(Boolean(statusFilter)) + Number(showArchived)
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return employees.filter((employee) => {
      if (departmentFilter && String(employee.departmentId ?? '') !== departmentFilter) return false
      if (statusFilter && employeeStatus(employee) !== statusFilter) return false
      if (!term) return true
      return `${employee.fullName} ${employee.employeeCode} ${employee.departmentName} ${employee.jobTitle} ${employee.phone} ${employee.email}`
        .toLocaleLowerCase().includes(term)
    })
  }, [employees, search, departmentFilter, statusFilter])

  function clearFilters() {
    setSearch('')
    setDepartmentFilter('')
    setStatusFilter('')
    if (showArchived) onToggleArchived()
  }

  return <section className="panel hr-panel hr-directory">
    <div className="panel-heading hr-directory-heading">
      <div><h2>Employee directory</h2><p>{filtered.length} employees · Choose a view or select an employee to open their profile.</p></div>
      <div className="hr-actions">
        <div className="hr-view-switch" role="group" aria-label="Employee directory view">
          <button className={view === 'list' ? 'selected' : ''} aria-pressed={view === 'list'} onClick={() => onViewChange('list')}><List size={14} />List</button>
          <button className={view === 'kanban' ? 'selected' : ''} aria-pressed={view === 'kanban'} onClick={() => onViewChange('kanban')}><LayoutGrid size={14} />Kanban</button>
        </div>
        <button className="secondary-btn small" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          <SlidersHorizontal size={14} />Search & filters{filterCount > 0 ? ` · ${filterCount}` : ''}
        </button>
        <button className="secondary-btn small" onClick={onManageDepartments}>Manage departments</button>
        <button className="primary-btn" onClick={onAdd}><UserRound size={15} />Add employee</button>
      </div>
    </div>
    {loadError && <div className="hr-directory-error" role="alert"><span>{loadError}</span><button className="secondary-btn small" onClick={onRetry}>Retry</button></div>}
    {filtersOpen && <div className="hr-directory-filters">
      <label className="hr-directory-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees" aria-label="Search employees" /></label>
      <label className="field"><span>Department</span><select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}><option value="">All departments</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
      <label className="field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated', 'Archived'].map((status) => <option key={status}>{status}</option>)}</select></label>
      <label className="hr-include-archived"><input type="checkbox" checked={showArchived} onChange={onToggleArchived} />Include archived employees</label>
      <button className="text-btn" onClick={clearFilters}>Clear filters</button>
    </div>}
    {view === 'kanban'
      ? <div className="hr-kanban">
        {filtered.map((employee) => <article className="hr-employee-card" key={employee.id}>
          <button className="hr-employee-card-main" onClick={() => onOpenProfile(employee.id)} aria-label={`Open ${employee.fullName} profile`}>
            <Avatar employee={employee} />
            <span className="hr-employee-card-copy">
              <strong>{employee.fullName}</strong>
              <span className="hr-employee-card-id">{employee.employeeCode}</span>
              <StatusPill value={employeeStatus(employee)} />
            </span>
            <span className="hr-employee-card-details">
              <span><Building2 size={13} />{employee.departmentName || 'Unassigned'}</span>
              <span><BriefcaseBusiness size={13} />{employee.jobTitle || 'No job title'}</span>
              <span><Phone size={13} />{employee.phone || 'No phone number'}</span>
              <span><Mail size={13} />{employee.email || 'No email address'}</span>
            </span>
          </button>
          <div className="hr-employee-card-actions">
            <button className="text-btn" onClick={() => onEdit(employee)}><Pencil size={13} />Edit</button>
            <details className="hr-card-menu">
              <summary aria-label={`More actions for ${employee.fullName}`}><MoreHorizontal size={17} /></summary>
              <div className="hr-card-menu-items">
                <button onClick={() => onOpenProfile(employee.id)}>View profile</button>
                <button onClick={() => onEdit(employee)}>Edit employee</button>
                {employee.archivedAt
                  ? <button onClick={() => onRestore(employee)}>Restore employee</button>
                  : <button className="danger" onClick={() => onArchive(employee)}>Archive employee</button>}
                <button className="danger" onClick={() => void onDelete(employee)}>Delete permanently</button>
              </div>
            </details>
          </div>
        </article>)}
        {!filtered.length && <div className="hr-kanban-empty">
          {loading ? 'Loading employees…' : loadError ? 'Employee data could not be loaded.' : 'No employees match the current search and filters.'}
        </div>}
      </div>
      : <div className="table-scroll hr-directory-table"><table><thead><tr>
        <th>EMPLOYEE</th><th>EMPLOYEE ID</th><th>DEPARTMENT</th><th>JOB TITLE</th><th>PHONE</th><th>EMAIL</th><th>STATUS</th><th />
      </tr></thead><tbody>
        {filtered.map((employee) => <tr key={employee.id}>
          <td><button className="hr-list-employee" onClick={() => onOpenProfile(employee.id)}><Avatar employee={employee} /><strong>{employee.fullName}</strong></button></td>
          <td><strong className="app-id">{employee.employeeCode}</strong></td><td>{employee.departmentName || '—'}</td>
          <td>{employee.jobTitle || '—'}</td><td>{employee.phone || '—'}</td><td>{employee.email || '—'}</td>
          <td><StatusPill value={employeeStatus(employee)} /></td>
          <td><div className="hr-row-actions">
            <button className="mini-icon" aria-label={`Edit ${employee.fullName}`} onClick={() => onEdit(employee)}>Edit</button>
            {employee.archivedAt
              ? <button className="mini-icon" aria-label={`Restore ${employee.fullName}`} onClick={() => onRestore(employee)}>Restore</button>
              : <button className="mini-icon" aria-label={`Archive ${employee.fullName}`} onClick={() => onArchive(employee)}>Archive</button>}
            <button className="mini-icon danger" aria-label={`Delete ${employee.fullName} and all related HR records`} onClick={() => void onDelete(employee)}>Delete</button>
          </div></td>
        </tr>)}
        {!filtered.length && <tr><td colSpan={8} className="hr-empty">{loading ? 'Loading employees…' : loadError ? 'Employee data could not be loaded.' : 'No employees match the current search and filters.'}</td></tr>}
      </tbody></table></div>}
  </section>
}

export function HrEmployeeProfileView({
  employeeId, reloadKey, user, onBack, onEdit, onDelete, onPhotoUpdated, setNotice
}: {
  employeeId: number
  reloadKey: number
  user: AuthUser
  onBack: () => void
  onEdit: (employee: HrEmployee) => void
  onDelete: (employee: HrEmployee) => Promise<boolean>
  onPhotoUpdated: (employeeId: number, photoDataUrl: string) => void
  setNotice: (message: string) => void
}) {
  const [profile, setProfile] = useState<HrEmployeeProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deletingEmployee, setDeletingEmployee] = useState(false)
  const canViewPayroll = user.role === 'admin' || user.role === 'manager'
  const [tab, setTab] = useState<ProfileTab>('Personal')
  const tabs: ProfileTab[] = ['Personal', 'Employment', 'Attendance', 'Leave', ...(canViewPayroll ? ['Payroll' as const] : []), 'Documents', 'Activity']

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    window.blueLine.hr.getEmployeeProfile(employeeId)
      .then((result) => { if (active) setProfile(result) })
      .catch((cause: unknown) => {
        if (active) {
          const message = cause instanceof Error ? cause.message : 'Unable to load employee profile.'
          setError(message)
          if (message.includes('Unlock Human Resources with the HR password')) setNotice(message)
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [employeeId, reloadKey])

  async function changePhoto() {
    setUploadingPhoto(true)
    try {
      const photoDataUrl = await window.blueLine.hr.setEmployeePhoto(employeeId)
      if (photoDataUrl) {
        setProfile((current) => current ? { ...current, employee: { ...current.employee, photoDataUrl } } : current)
        onPhotoUpdated(employeeId, photoDataUrl)
        setNotice('Employee profile photo updated.')
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Unable to update employee profile photo.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  if (loading) return <section className="panel hr-profile-state"><span className="spin"><Clock3 size={20} /></span><p>Loading employee profile…</p></section>
  if (error || !profile) return <section className="panel hr-profile-state"><p>{error || 'Employee profile is unavailable.'}</p><div><button className="secondary-btn" onClick={onBack}><ArrowLeft size={14} />Back to directory</button>  <button className="primary-btn" onClick={() => {
    setLoading(true)
    setError('')
    void window.blueLine.hr.getEmployeeProfile(employeeId)
      .then(setProfile)
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : 'Unable to load employee profile.'
        setError(message)
        if (message.includes('Unlock Human Resources with the HR password')) setNotice(message)
      })
      .finally(() => setLoading(false))
  }}>Retry</button></div></section>

  const employee = profile.employee
  const completedMinutes = profile.attendance.reduce((total, record) => total + attendanceMinutes(record), 0)
  const lateCount = profile.attendance.filter((record) => record.status === 'Late').length
  const absentCount = profile.attendance.filter((record) => record.status === 'Absent').length
  const activeLeaveCount = profile.leaveRequests.filter((request) => request.status === 'Pending' || request.status === 'Approved').length

  return <div className="hr-employee-profile">
    <section className="panel hr-profile-header">
      <button className="text-btn hr-profile-back" onClick={onBack}><ArrowLeft size={15} />Employee directory</button>
      <div className="hr-profile-identity">
        <div className="hr-profile-photo-wrap">
          <Avatar employee={employee} large />
          <button className="hr-photo-button" onClick={() => void changePhoto()} disabled={uploadingPhoto} aria-label="Change employee photo">
            <Camera size={15} />{uploadingPhoto ? 'Saving…' : 'Change photo'}
          </button>
        </div>
        <div className="hr-profile-title">
          <p className="eyebrow">EMPLOYEE PROFILE</p>
          <h2>{employee.fullName}</h2>
          <p>{employee.jobTitle || 'Job title not set'}{employee.departmentName ? ` · ${employee.departmentName}` : ''}</p>
          <div className="hr-profile-badges"><span className="hr-profile-id">{employee.employeeCode}</span><StatusPill value={employeeStatus(employee)} /></div>
        </div>
        <div className="hr-profile-actions">
          <button className="primary-btn hr-profile-edit" onClick={() => onEdit(employee)}><Pencil size={14} />Edit profile</button>
          <button className="secondary-btn small hr-profile-delete" disabled={deletingEmployee} onClick={() => {
            setDeletingEmployee(true)
            void onDelete(employee).finally(() => setDeletingEmployee(false))
          }}><Trash2 size={14} />{deletingEmployee ? 'Deleting…' : 'Delete employee'}</button>
        </div>
      </div>
    </section>
    <div className="hr-profile-tabs" role="tablist" aria-label="Employee profile sections">
      {tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'selected' : ''} onClick={() => setTab(item)}>{item}</button>)}
    </div>
    <section className="panel hr-profile-content" role="tabpanel">
      {tab === 'Personal' && <ProfilePanel title="Personal information" subtitle="Contact details saved for this employee.">
        <div className="hr-profile-info-grid">
          <Info label="Full name" value={employee.fullName} />
          <Info label="Phone number" value={employee.phone} />
          <Info label="Email address" value={employee.email} />
        </div>
        {!employee.phone && !employee.email && <p className="hr-profile-note">No additional contact details are on file.</p>}
      </ProfilePanel>}
      {tab === 'Employment' && <ProfilePanel title="Employment information" subtitle="Current employee and compensation details.">
        <div className="hr-profile-info-grid">
          <Info label="Employee ID" value={employee.employeeCode} />
          <Info label="Department" value={employee.departmentName} />
          <Info label="Job title" value={employee.jobTitle} />
          <Info label="Hire date" value={formatDate(employee.hireDate)} />
          <Info label="Employment type" value={employee.employmentType} />
          <Info label="Scheduled work hours" value={employee.workStart && employee.workEnd ? `${employee.workStart}–${employee.workEnd}` : 'Not set'} />
          <Info label="Employment status" value={employee.archivedAt ? 'Archived' : employee.status} />
          {user.role === 'admin' && <Info label="Application user" value={employee.appUserDisplayName ? `${employee.appUserDisplayName} · @${employee.appUsername}` : 'Unassigned'} />}
          {canViewPayroll && <Info label="Hourly rate" value={`${formatMoney(employee.hourlyRate)} / hour`} />}
        </div>
      </ProfilePanel>}
      {tab === 'Attendance' && <ProfilePanel title="Attendance history" subtitle="Recorded check-ins, check-outs, statuses, and working hours.">
        <div className="hr-profile-stat-row">
          <ProfileMetric label="Recorded days" value={profile.attendance.length} />
          <ProfileMetric label="Completed hours" value={`${(completedMinutes / 60).toFixed(1)} h`} />
          <ProfileMetric label="Late arrivals" value={lateCount} />
          <ProfileMetric label="Absence records" value={absentCount} />
        </div>
        <div className="table-scroll"><table><thead><tr><th>DATE</th><th>CHECK-IN</th><th>CHECK-OUT</th><th>HOURS</th><th>STATUS</th><th>NOTES</th></tr></thead><tbody>
          {profile.attendance.map((record) => <tr key={record.id}><td>{record.attendanceDate}</td><td>{record.checkIn || '—'}</td><td>{record.checkOut || '—'}</td><td>{(attendanceMinutes(record) / 60).toFixed(1)}</td><td><StatusPill value={record.status} /></td><td>{record.notes || '—'}</td></tr>)}
          {!profile.attendance.length && <tr><td colSpan={6} className="hr-empty">No attendance records are on file.</td></tr>}
        </tbody></table></div>
      </ProfilePanel>}
      {tab === 'Leave' && <ProfilePanel title="Leave" subtitle={`${activeLeaveCount} current or pending request${activeLeaveCount === 1 ? '' : 's'}.`}>
        <h3 className="hr-profile-subheading">Leave balances</h3>
        <div className="table-scroll"><table><thead><tr><th>YEAR</th><th>LEAVE TYPE</th><th>ALLOCATED</th><th>USED</th><th>REMAINING</th></tr></thead><tbody>
          {profile.leaveBalances.map((balance) => <tr key={`${balance.year}-${balance.leaveType}`}><td>{balance.year}</td><td>{balance.leaveType}</td><td>{balance.allocatedDays}</td><td>{balance.usedDays}</td><td>{balance.remainingDays}</td></tr>)}
          {!profile.leaveBalances.length && <tr><td colSpan={5} className="hr-empty">No leave balances are configured.</td></tr>}
        </tbody></table></div>
        <h3 className="hr-profile-subheading">Leave requests</h3>
        <div className="table-scroll"><table><thead><tr><th>TYPE</th><th>DATES</th><th>DAYS</th><th>STATUS</th><th>REVIEWED BY</th><th>SUBMITTED</th></tr></thead><tbody>
          {profile.leaveRequests.map((request) => <tr key={request.id}><td>{request.leaveType}</td><td>{request.startDate} – {request.endDate}</td><td>{request.totalDays}</td><td><StatusPill value={request.status} /></td><td>{request.approvedBy || '—'}</td><td>{formatDate(request.createdAt)}</td></tr>)}
          {!profile.leaveRequests.length && <tr><td colSpan={6} className="hr-empty">No leave requests are on file.</td></tr>}
        </tbody></table></div>
      </ProfilePanel>}
      {tab === 'Payroll' && canViewPayroll && <ProfilePanel title="Payroll history" subtitle="Monthly payroll records, hourly rates, allowances, and deductions.">
        <div className="table-scroll"><table><thead><tr><th>PERIOD</th><th>STATUS</th><th>HOURS</th><th>BASE PAY</th><th>BONUS</th><th>ALLOWANCE</th><th>DEDUCTIONS</th><th>ADVANCE</th><th>NET PAY</th></tr></thead><tbody>
          {profile.payroll.map((record) => <tr key={record.id}><td>{new Date(record.year, record.month - 1).toLocaleString('en', { month: 'long', year: 'numeric' })}</td><td><StatusPill value={record.periodStatus} /></td><td>{(record.workedMinutes / 60).toFixed(1)}</td><td>{formatMoney(record.basicSalary)}</td><td>{formatMoney(record.totalBonuses)}</td><td>{formatMoney(record.totalAllowances)}</td><td>{formatMoney(record.totalDeductions)}</td><td>{formatMoney(record.totalAdvanceRepayments)}</td><td><strong>{formatMoney(record.netSalary)}</strong></td></tr>)}
          {!profile.payroll.length && <tr><td colSpan={9} className="hr-empty">No payroll history is on file.</td></tr>}
        </tbody></table></div>
      </ProfilePanel>}
      {tab === 'Documents' && <ProfilePanel title="Employee documents" subtitle="Private files stored with the employee record.">
        <div className="hr-profile-document-list">
          {profile.documents.map((document) => <div className="hr-profile-document" key={document.id}>
            <span className="hr-profile-document-icon"><FileText size={17} /></span>
            <span><strong>{document.documentName}</strong><small>{document.documentType}{document.expirationDate ? ` · Expires ${document.expirationDate}` : ''}</small></span>
            <button className="secondary-btn small" onClick={() => void window.blueLine.hr.openDocument(document.id).catch((cause: unknown) => setNotice(cause instanceof Error ? cause.message : 'Unable to open employee document.'))}>Open</button>
          </div>)}
          {!profile.documents.length && <p className="hr-profile-note">No employee documents have been uploaded.</p>}
        </div>
      </ProfilePanel>}
      {tab === 'Activity' && <ProfilePanel title="Activity history" subtitle="Recorded profile changes and related HR actions.">
        <div className="table-scroll"><table><thead><tr><th>DATE & TIME</th><th>ACTION</th><th>RECORD TYPE</th><th>RESPONSIBLE USER</th></tr></thead><tbody>
          {profile.activity.map((item) => <tr key={item.id}><td>{item.createdAt}</td><td>{item.action}</td><td>{item.entityType.replace(/_/g, ' ')}</td><td>{item.actor}</td></tr>)}
          {!profile.activity.length && <tr><td colSpan={4} className="hr-empty">No activity has been recorded.</td></tr>}
        </tbody></table></div>
      </ProfilePanel>}
    </section>
  </div>
}

function attendanceMinutes(record: HrAttendance): number {
  if (!record.checkIn || !record.checkOut) return 0
  const toMinutes = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number)
    return hours * 60 + minutes
  }
  return Math.max(0, toMinutes(record.checkOut) - toMinutes(record.checkIn))
}

function ProfilePanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="hr-profile-panel"><div className="hr-profile-panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</div>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="hr-profile-info"><span>{label}</span><strong>{value || '—'}</strong></div>
}

function ProfileMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="hr-profile-metric"><span>{label}</span><strong>{value}</strong></div>
}

function StatusPill({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace(/ /g, '-')
  return <span className={`hr-employee-status ${normalized}`}><i />{value}</span>
}
