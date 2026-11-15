import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine, ArrowUpRight, Bell, BriefcaseBusiness, CalendarClock, Camera, Check, ChevronDown, ChevronLeft,
  ChevronRight, CircleAlert, ClipboardList, Database as DatabaseIcon, FileSearch, Files, Globe2,
  Grid2X2, LayoutDashboard, Menu, Pencil, Plus, Search, Settings, ShieldCheck, SlidersHorizontal,
  Trash2, Upload, Users, X, ZoomIn, ContactRound, FileText, Plane, Phone, Mail, Moon, Sun, Sparkles,
  Eye, EyeOff, RefreshCw, LogOut
} from 'lucide-react'
import { APP_MODULES, defaultModulesForRole, STAGES, type AppModule, type Application, type ApplicationActivity, type AuthUser, type CatalogItem, type Customer, type CustomerProfile, type Dashboard, type DocumentLibraryRecord, type DocumentRecord, type HrAttendanceDay, type HrSelfAttendanceStatus, type Language, type NewApplication, type PassportDiagnostics, type PassportProvider, type Pipeline } from '../shared/types'
import { parsePassportMrz } from '../shared/mrz'
import { parseClientSetupCode } from '../shared/lanSetup'
import type { PassportFieldAssessment, PassportFieldName } from '../shared/passportProfiles'
import { HrPage } from './HrPage'

type Page = 'Apps' | 'Dashboard' | 'My Attendance' | 'CRM' | 'Visa Pipeline' | 'Customers' | 'Human Resources' | 'DATA' | 'Documents' | 'Visa Types' | 'Countries' | 'Smart Scanner' | 'Reports' | 'Settings' | 'Gemini API'
const nav: Array<{ name: Page; icon: typeof LayoutDashboard }> = [
  { name: 'Dashboard', icon: LayoutDashboard }, { name: 'My Attendance', icon: CalendarClock },
  { name: 'CRM', icon: ContactRound },
  { name: 'Visa Pipeline', icon: BriefcaseBusiness }, { name: 'Customers', icon: Users },
  { name: 'Human Resources', icon: Users },
  { name: 'DATA', icon: DatabaseIcon }, { name: 'Documents', icon: Files },
  { name: 'Visa Types', icon: Plane }, { name: 'Countries', icon: Globe2 },
  { name: 'Smart Scanner', icon: FileSearch }, { name: 'Reports', icon: ClipboardList },
  { name: 'Settings', icon: Settings }, { name: 'Gemini API', icon: Sparkles }
]

const words: Record<string, [string, string]> = {
  Dashboard: ['Dashboard', 'لوحة التحكم'], 'Visa Pipeline': ['Visa Pipeline', 'مسار التأشيرات'],
  'Human Resources': ['Human Resources', 'الموارد البشرية'],
  Customers: ['Customers', 'العملاء'], 'Smart Scanner': ['Smart Scanner', 'الماسح الذكي'],
  Reports: ['Reports', 'التقارير'], Settings: ['Settings', 'الإعدادات'],
  'Total applications': ['Total applications', 'إجمالي الطلبات'], 'New applications': ['New applications', 'طلبات جديدة'],
  'Documents required': ['Documents required', 'مستندات مطلوبة'], 'Ready to submit': ['Ready to submit', 'جاهز للتقديم'],
  'Under process': ['Under process', 'قيد الإجراء'], 'Approved': ['Approved', 'تمت الموافقة'],
  'Rejected': ['Rejected', 'مرفوض'], 'Overdue follow-ups': ['Overdue follow-ups', 'متابعات متأخرة'],
  'Recent applications': ['Recent applications', 'الطلبات الأخيرة'], 'Applications by country': ['Applications by country', 'الطلبات حسب الدولة'],
  'New application': ['New application', 'طلب جديد'], 'Search applications or customers': ['Search applications or customers', 'ابحث عن طلب أو عميل'],
  'No applications yet': ['No applications yet', 'لا توجد طلبات بعد'],
  'Create your first application to start managing your visa pipeline.': ['Create your first application to start managing your visa pipeline.', 'أنشئ أول طلب لبدء إدارة معاملات التأشيرة.'],
  'Save application': ['Save application', 'حفظ الطلب'], 'Company name': ['Company name', 'اسم الشركة'],
  Language: ['Language', 'اللغة'], English: ['English', 'الإنجليزية'], Arabic: ['Arabic', 'العربية'],
  Export: ['Export CSV', 'تصدير CSV'], Backup: ['Create backup', 'إنشاء نسخة احتياطية'],
  'Daily attendance check-in': ['Daily attendance check-in', 'تسجيل الحضور اليومي'],
  'Check in for today?': ['Check in for today?', 'هل تريد تسجيل الحضور لهذا اليوم؟'],
  'Not now': ['Not now', 'ليس الآن'],
  'Checking in...': ['Checking in...', 'جارٍ تسجيل الحضور...'],
  'Checking out...': ['Checking out...', 'جارٍ تسجيل الانصراف...'],
  'Check in': ['Check in', 'تسجيل الحضور'],
  'Check out': ['Check out', 'تسجيل الانصراف'],
  'Check-in recorded at': ['Check-in recorded at', 'تم تسجيل الحضور الساعة'],
  'Check-out recorded at': ['Check-out recorded at', 'تم تسجيل الانصراف الساعة'],
  'My attendance': ['My attendance', 'حضوري'], 'My Attendance': ['My Attendance', 'حضوري'],
  'Not checked in': ['Not checked in', 'لم يتم تسجيل الحضور'],
  'Checking attendance status...': ['Checking attendance status...', 'جارٍ التحقق من حالة الحضور...'],
  'Attendance is already marked for today.': ['Attendance is already marked for today.', 'تم تسجيل الحضور لهذا اليوم مسبقاً.']
}

function useCopy(language: Language) {
  return useCallback((key: string) => words[key]?.[language === 'ar' ? 1 : 0] ?? key, [language])
}

function attendancePromptDismissalKey(username: string, date: string): string {
  return `blue-line-attendance-prompt-dismissed:${username}:${date}`
}

function shouldOpenMyAttendanceToday(username: string): boolean {
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const key = `blue-line-my-attendance-opened:${username}:${date}`
  try {
    if (window.localStorage.getItem(key) === '1') return false
    window.localStorage.setItem(key, '1')
    return true
  } catch (error) {
    window.dispatchEvent(new CustomEvent('app-notice', {
      detail: error instanceof Error ? `My Attendance will open today, but its daily launch could not be saved: ${error.message}` : 'My Attendance will open today, but its daily launch could not be saved.'
    }))
    return true
  }
}

function splitName(fullName: string): [string, string] {
  const [firstName = '', ...surnameParts] = fullName.trim().split(/\s+/)
  return [firstName, surnameParts.join(' ')]
}

function joinName(firstName: string, surname: string): string {
  return [firstName.trim(), surname.trim()].filter(Boolean).join(' ')
}

function defaultPageFor(user: AuthUser): Page {
  if (user.permissions.length === 1 && user.permissions[0] === 'My Attendance') return 'My Attendance'
  if (user.role !== 'visa') return 'Apps'
  return nav.find(({ name }) => name !== 'My Attendance' && user.permissions.includes(name as AppModule))?.name ?? 'My Attendance'
}

function App() {
  const [page, setPage] = useState<Page>('Apps')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [officeClient, setOfficeClient] = useState(false)
  const [authError, setAuthError] = useState('')
  const [language, setLanguage] = useState<Language>('en')
  const [company, setCompany] = useState('Blue Line Travel')
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [passportProvider, setPassportProvider] = useState<PassportProvider>('ocr')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [applications, setApplications] = useState<Application[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null)
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null)
  const [initialLoading, setInitialLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [nightMode, setNightMode] = useState(() => window.localStorage.getItem('blue-line-theme') === 'dark')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [attendancePrompt, setAttendancePrompt] = useState<HrSelfAttendanceStatus | null>(null)
  const [dashboardAttendance, setDashboardAttendance] = useState<HrSelfAttendanceStatus | null>(null)
  const [attendanceStatusError, setAttendanceStatusError] = useState('')
  const [attendancePromptBusy, setAttendancePromptBusy] = useState(false)
  const copy = useCopy(language)
  const rtl = language === 'ar'
  const isAdmin = authUser?.role !== 'visa'
  const canOpenSettings = Boolean(authUser?.permissions.includes('Settings'))
  const roleLabel = authUser?.role === 'manager' ? 'Manager' : isAdmin ? 'Administrator' : 'Visa access'
  const visibleNav = authUser ? nav.filter(({ name }) => authUser.permissions.includes(name as AppModule)) : []
  useEffect(() => {
    window.localStorage.setItem('blue-line-theme', nightMode ? 'dark' : 'light')
  }, [nightMode])
  useEffect(() => {
    let active = true
    void Promise.all([window.blueLine.getSession(), window.blueLine.workspaceInfo()]).then(([user, workspace]) => {
      if (active) setOfficeClient(workspace.mode === 'client')
      if (active && user) {
        setAuthUser(user)
        setPage(shouldOpenMyAttendanceToday(user.username) ? 'My Attendance' : defaultPageFor(user))
      }
    }).catch((error: unknown) => {
      if (active) setAuthError(error instanceof Error ? error.message : 'Unable to check sign-in status.')
    }).finally(() => {
      if (active) setAuthLoading(false)
    })
    return () => { active = false }
  }, [])
  const openPage = (nextPage: Page) => {
    if (nextPage === 'Apps') {
      if (authUser?.role === 'visa') return
    } else if (!authUser?.permissions.includes(nextPage as AppModule)) return
    setSelectedCustomerId(null)
    setPage(nextPage)
  }

  const refresh = useCallback(async () => {
    if (!authUser) return
    try {
      const [stats, apps, pipelineRows] = await Promise.all([
        authUser.permissions.includes('Dashboard') || authUser.permissions.includes('Reports')
          ? window.blueLine.dashboard() : Promise.resolve(null),
        authUser.permissions.some((module) => ['Visa Pipeline', 'Reports', 'Smart Scanner'].includes(module))
          ? window.blueLine.listApplications() : Promise.resolve([] as Application[]),
        authUser.permissions.some((module) => ['Dashboard', 'Visa Pipeline', 'Settings'].includes(module))
          ? window.blueLine.listPipelines() : Promise.resolve([] as Pipeline[])
      ])
      setDashboard(stats)
      setApplications(apps)
      setPipelines(pipelineRows)
      if (officeClient || authUser.permissions.includes('Settings')
        || authUser.permissions.includes('Gemini API') || authUser.permissions.includes('Smart Scanner')) {
        const [settings, geminiSettings, scannerProvider] = await Promise.all([
          authUser.permissions.includes('Settings') || officeClient ? window.blueLine.getSettings() : Promise.resolve(null),
          authUser.permissions.includes('Gemini API')
            ? window.blueLine.getGeminiSettings() : Promise.resolve(null),
          authUser.permissions.includes('Smart Scanner')
            ? window.blueLine.getPassportProvider() : Promise.resolve(null)
        ])
        if (settings) {
          setCompany(settings.companyName)
          setCompanyLogo(settings.companyLogoDataUrl)
          setLanguage(settings.language)
        }
        if (geminiSettings) setPassportProvider(geminiSettings.provider)
        if (scannerProvider) setPassportProvider(scannerProvider)
      }
      if (authUser.permissions.some((module) => ['CRM', 'Customers', 'DATA', 'Visa Pipeline'].includes(module))) {
        setCustomers(await window.blueLine.listCustomers(query))
      } else {
        setCustomers([])
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load local data.')
    } finally {
      setInitialLoading(false)
    }
  }, [authUser, query, officeClient])
  useEffect(() => { if (authUser) void refresh() }, [authUser, refresh])
  useEffect(() => {
    if (!authUser || !authUser.permissions.includes('My Attendance')) {
      setAttendancePrompt(null)
      setDashboardAttendance(null)
      setAttendanceStatusError('')
      setAttendancePromptBusy(false)
      return
    }
    let active = true
    void window.blueLine.selfAttendance.status().then((status) => {
      if (!active) return
      setDashboardAttendance(status)
      setAttendanceStatusError('')
      const dismissed = window.localStorage.getItem(attendancePromptDismissalKey(authUser.username, status.attendanceDate)) === '1'
      setAttendancePrompt(status.shouldPrompt && !dismissed ? status : null)
    }).catch((error: unknown) => {
      if (active) {
        setAttendancePrompt(null)
        setDashboardAttendance(null)
        setAttendanceStatusError(error instanceof Error ? error.message : 'Unable to load daily attendance status.')
        setNotice(error instanceof Error ? error.message : 'Unable to load daily attendance status.')
      }
    })
    return () => { active = false }
  }, [authUser])
  useEffect(() => {
    const handler = (event: Event) => setNotice((event as CustomEvent<string>).detail)
    window.addEventListener('app-notice', handler)
    return () => window.removeEventListener('app-notice', handler)
  }, [])
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const filteredApps = useMemo(() => applications.filter((app) => {
    const value = query.toLowerCase()
    return [app.applicationId, app.customerName, app.phone, app.country, app.visaType].some((field) => field.toLowerCase().includes(value))
  }), [applications, query])
  async function signIn(username: string, password: string) {
    try {
      const user = await window.blueLine.login(username, password)
      setAuthUser(user)
      setAttendancePrompt(null)
      setAttendancePromptBusy(false)
      setAuthError('')
      setPage(shouldOpenMyAttendanceToday(user.username) ? 'My Attendance' : defaultPageFor(user))
      setSidebarCollapsed(user.role !== 'visa')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in.')
    }
  }
  function dismissAttendancePrompt() {
    if (!authUser || !attendancePrompt) return
    try {
      window.localStorage.setItem(attendancePromptDismissalKey(authUser.username, attendancePrompt.attendanceDate), '1')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to remember this attendance reminder.')
    }
    setAttendancePrompt(null)
  }
  async function checkInFromPrompt() {
    if (!authUser || !attendancePrompt || attendancePromptBusy) return
    setAttendancePromptBusy(true)
    try {
      const status = await window.blueLine.selfAttendance.checkIn()
      setDashboardAttendance(status)
      let storageError = ''
      try {
        window.localStorage.setItem(attendancePromptDismissalKey(authUser.username, status.attendanceDate), '1')
      } catch (error) {
        storageError = error instanceof Error ? error.message : 'Unable to remember this attendance reminder.'
      }
      setAttendancePrompt(null)
      setNotice(storageError
        ? `Attendance was recorded, but the daily reminder could not be saved: ${storageError}`
        : status.checkIn ? `${copy('Check-in recorded at')} ${status.checkIn}.` : copy('Attendance is already marked for today.'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to record attendance.')
    } finally {
      setAttendancePromptBusy(false)
    }
  }
  async function recordDashboardAttendance(action: 'in' | 'out') {
    if (attendancePromptBusy) return
    setAttendancePromptBusy(true)
    try {
      const status = action === 'in'
        ? await window.blueLine.selfAttendance.checkIn()
        : await window.blueLine.selfAttendance.checkOut()
      setDashboardAttendance(status)
      setAttendancePrompt(null)
      const time = action === 'in' ? status.checkIn : status.checkOut
      setNotice(time
        ? `${copy(action === 'in' ? 'Check-in recorded at' : 'Check-out recorded at')} ${time}.`
        : copy('Attendance is already marked for today.'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Unable to record check-${action}.`)
    } finally {
      setAttendancePromptBusy(false)
    }
  }
  async function signOut() {
    try {
      await window.blueLine.logout()
      setAuthUser(null)
      setAttendancePrompt(null)
      setSelectedCustomerId(null)
      setSelectedApplicationId(null)
      setAuthError('')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to sign out.')
    }
  }
  async function createApplication(input: NewApplication) {
    setBusy(true)
    try {
      const app = await window.blueLine.createApplication(input)
      setShowNew(false)
      setNotice(`Application ${app.applicationId} created.`)
      await refresh()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to create application.')
    } finally { setBusy(false) }
  }

  async function move(id: number, status: string) {
    try {
      await window.blueLine.moveApplication(id, status)
      await refresh()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to update stage.') }
  }

  async function moveMany(ids: number[], status: string): Promise<boolean> {
    try {
      for (const id of ids) await window.blueLine.moveApplication(id, status)
      setNotice(`${ids.length} application(s) moved to ${status}.`)
      await refresh()
      return true
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to move selected applications.')
      await refresh()
      return false
    }
  }

  async function updateApplication(id: number, input: NewApplication) {
    try {
      await window.blueLine.updateApplication(id, input)
      setSelectedApplicationId(null)
      setNotice('Application updated.')
      await refresh()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to update application.') }
  }

  async function deleteApplication(id: number) {
    const application = applications.find((item) => item.id === id)
    if (!application || !window.confirm(`Delete application ${application.applicationId}? The customer profile and uploaded documents will be preserved.`)) return
    try {
      await window.blueLine.deleteApplication(id)
      setSelectedApplicationId(null)
      setNotice('Application deleted. Customer information and documents were preserved.')
      await refresh()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to delete application.') }
  }

  async function exportCsv() {
    try { if (await window.blueLine.exportCsv()) setNotice('CSV report exported.') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed.') }
  }
  async function backup() {
    try { if (await window.blueLine.backup()) setNotice('Backup created.') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Backup failed.') }
  }

  if (authLoading) return <div className="auth-loading" aria-label="Checking sign-in status"><span /></div>
  if (!authUser) return <LoginPage onLogin={signIn} error={authError} />

  return <div className="app-shell" data-theme={nightMode ? 'dark' : 'light'} dir={rtl ? 'rtl' : 'ltr'}>
    <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="brand">
        <button className="brand-mark" title={isAdmin ? 'Open app launcher' : 'Blue Line Visa'} onClick={() => isAdmin && openPage('Apps')}>{companyLogo ? <img src={companyLogo} alt="" /> : <span>BL</span>}</button>
        {!sidebarCollapsed && <div><strong>BLUE LINE</strong><small>TRAVEL & VISA</small></div>}
      </div>
      {isAdmin && !sidebarCollapsed && <button className="workspace-switcher" onClick={() => openPage('Apps')}><Grid2X2 size={16} /><span>All applications</span><ChevronDown size={14} /></button>}
      <div className="workspace-label">{sidebarCollapsed ? '' : 'WORKSPACE'}</div>
      <nav aria-label="Main navigation">{visibleNav.map(({ name, icon: Icon }) => <button key={name} title={sidebarCollapsed ? copy(name) : undefined} onClick={() => openPage(name)} aria-current={page === name ? 'page' : undefined} className={`nav-item ${page === name ? 'active' : ''}`}>
        <Icon size={18} strokeWidth={1.8} /><span>{!sidebarCollapsed && copy(name)}</span>{!sidebarCollapsed && name === 'Visa Pipeline' && <b className="nav-count">{applications.length}</b>}
      </button>)}</nav>
      <div className="sidebar-bottom">
        {!sidebarCollapsed && <div className="offline"><span className="online-dot" /><span>Workspace</span><ShieldCheck size={16} /></div>}
        <button className="profile" onClick={() => canOpenSettings ? openPage('Settings') : void signOut()} title={canOpenSettings ? 'Open team settings' : 'Sign out'}><div className="avatar">{authUser.displayName.slice(0, 1).toUpperCase()}</div>{!sidebarCollapsed && <><div><strong>{authUser.displayName}</strong><small>{roleLabel}</small></div>{canOpenSettings ? <ChevronDown size={16} /> : <LogOut size={15} />}</>}</button>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="topbar-leading">
          <button className="icon-btn sidebar-toggle" aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}><Menu size={18} /></button>
          {isAdmin && <button className="icon-btn launcher-toggle" aria-label="Open application launcher" onClick={() => openPage('Apps')}><Grid2X2 size={17} /></button>}
          <div className="breadcrumbs">{companyLogo && <img className="header-brand-logo" src={companyLogo} alt="" />}<span>{company}</span><ChevronRight size={14} className="crumb-slash" /><strong>{page === 'Apps' ? 'Applications' : copy(page)}</strong></div>
        </div>
        <div className="top-actions">
          <label className="global-search"><Search size={16} /><input ref={searchInputRef} aria-label="Search records" placeholder={copy('Search applications or customers')} value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>Ctrl K</kbd></label>
          {isAdmin && <button className="icon-btn" title="Notifications" onClick={() => setNotice('You’re all caught up.')}><Bell size={17} /></button>}
          <button className="icon-btn" aria-label={nightMode ? 'Switch to light mode' : 'Switch to night mode'} title={nightMode ? 'Switch to light mode' : 'Switch to night mode'} onClick={() => setNightMode((value) => !value)}>{nightMode ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button>
          {canOpenSettings && <>
            <button className="icon-btn" title="Settings" onClick={() => openPage('Settings')}><Settings size={17} /></button>
            <button className="icon-btn language-toggle" title="Switch language" onClick={() => { const next = language === 'en' ? 'ar' : 'en'; void window.blueLine.saveSettings({ companyName: company, language: next }).then(() => setLanguage(next)).catch((e: Error) => setNotice(e.message)) }}>{rtl ? 'ع' : 'EN'}</button>
          </>}
          <button className="top-profile" onClick={() => canOpenSettings ? openPage('Settings') : void signOut()} title={canOpenSettings ? 'Open team settings' : 'Sign out'}><span className="avatar">{authUser.displayName.slice(0, 1).toUpperCase()}</span><span className="top-profile-copy"><strong>{authUser.displayName}</strong><small>{roleLabel}</small></span>{canOpenSettings ? <ChevronDown size={14} /> : <LogOut size={14} />}</button>
        </div>
      </header>
      <section className="page-content" key={page} data-page={page}>
        {page === 'Apps' && <ApplicationLauncher permissions={authUser.permissions} onOpen={openPage} />}
        {page === 'Dashboard' && <DashboardPage
          stats={dashboard}
          loading={initialLoading}
          copy={copy}
          welcome={authUser.username === 'mustafa'}
          attendance={dashboardAttendance}
          attendanceError={attendanceStatusError}
          attendanceBusy={attendancePromptBusy}
          onAttendance={(action) => void recordDashboardAttendance(action)}
          onNew={() => setShowNew(true)}
          onOpen={(id) => {
            if (!authUser.permissions.includes('Visa Pipeline')) {
              setNotice('You do not have permission to access Visa Pipeline.')
              return
            }
            setQuery(id)
            openPage('Visa Pipeline')
          }}
        />}
        {page === 'My Attendance' && <MyAttendancePage
          attendance={dashboardAttendance}
          attendanceError={attendanceStatusError}
          attendanceBusy={attendancePromptBusy}
          onAttendance={(action) => void recordDashboardAttendance(action)}
        />}
        {page === 'Human Resources' && <HrPage query={query} setNotice={setNotice} user={authUser} />}
        {page === 'Visa Pipeline' && <PipelinePage apps={filteredApps} customers={customers} pipelines={pipelines} query={query} readOnly={false} onNew={() => setShowNew(true)} onMove={move} onMoveMany={moveMany} onOpen={setSelectedApplicationId} />}
        {(page === 'Customers' || page === 'CRM') && (selectedCustomerId === null
          ? <CustomersPage customers={customers} query={query} onOpen={setSelectedCustomerId} />
          : <CustomerProfilePage customerId={selectedCustomerId} readOnly={false} onBack={() => setSelectedCustomerId(null)} setNotice={setNotice} onChanged={refresh} />)}
        {page === 'DATA' && (selectedCustomerId === null
          ? <DataPage customers={customers} query={query} onOpen={setSelectedCustomerId} />
          : <CustomerProfilePage customerId={selectedCustomerId} readOnly={false} onBack={() => setSelectedCustomerId(null)} setNotice={setNotice} onChanged={refresh} />)}
        {page === 'Documents' && <DocumentsPage query={query} setNotice={setNotice} />}
        {page === 'Visa Types' && <CatalogPage kind="visaType" title="Visa types" canManage setNotice={setNotice} />}
        {page === 'Countries' && <CatalogPage kind="country" title="Countries" canManage setNotice={setNotice} />}
        {page === 'Smart Scanner' && <ScannerPage apps={applications} canUseDocuments={authUser.permissions.some((module) => module === 'Documents' || module === 'Visa Pipeline')} setNotice={setNotice} />}
        {page === 'Reports' && <ReportsPage stats={dashboard} apps={applications} onExport={exportCsv} />}
        {page === 'Settings' && <SettingsPage company={company} language={language} officeClient={officeClient} canManageUsers={authUser.role === 'admin'} currentUserId={authUser.id} onUserUpdated={setAuthUser} onSave={async (name, lang) => {
          try { await window.blueLine.saveSettings({ companyName: name, language: lang }); setCompany(name); setLanguage(lang); setNotice('Settings saved.') }
          catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to save settings.') }
        }} logo={companyLogo} onLogoChanged={(logo) => setCompanyLogo(logo)} pipelines={pipelines} onConfigurationChanged={refresh} onBackup={backup} setNotice={setNotice} />}
        {page === 'Gemini API' && <GeminiApiPage provider={passportProvider} onProviderChanged={setPassportProvider} setNotice={setNotice} />}
      </section>
    </main>
    {attendancePrompt && page !== 'My Attendance' && <div className="modal-backdrop attendance-prompt-backdrop">
      <section className="modal attendance-prompt" role="dialog" aria-modal="true" aria-labelledby="daily-attendance-title" aria-describedby="daily-attendance-description" aria-busy={attendancePromptBusy}>
        <div className="modal-head"><div><p className="eyebrow">{copy('Human Resources')}</p><h2 id="daily-attendance-title">{copy('Daily attendance check-in')}</h2></div></div>
        <p className="attendance-prompt-copy" id="daily-attendance-description">{copy('Check in for today?')} <strong>{attendancePrompt.employeeName}</strong></p>
        <time className="attendance-prompt-date" dateTime={attendancePrompt.attendanceDate}>{attendancePrompt.attendanceDate}</time>
        <div className="attendance-prompt-actions">
          <button type="button" className="secondary-btn" disabled={attendancePromptBusy} onClick={dismissAttendancePrompt}>{copy('Not now')}</button>
          <button type="button" className="primary-btn" autoFocus disabled={attendancePromptBusy} onClick={() => void checkInFromPrompt()}>
            <Check size={15} />{attendancePromptBusy ? copy('Checking in...') : copy('Check in')}
          </button>
        </div>
      </section>
    </div>}
    {notice && <div className="toast"><CircleAlert size={18} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={15} /></button></div>}
    {showNew && <NewApplicationForm pipelines={pipelines} busy={busy} provider={passportProvider} officeClient={officeClient} onProviderChange={setPassportProvider} onClose={() => setShowNew(false)} onSubmit={createApplication} />}
    {selectedApplicationId !== null && <ApplicationDetailsModal
      application={applications.find((item) => item.id === selectedApplicationId) ?? null}
      onClose={() => setSelectedApplicationId(null)}
      onSave={(input) => void updateApplication(selectedApplicationId, input)}
      onDelete={() => void deleteApplication(selectedApplicationId)}
      onCustomerOpen={(customerId) => {
        setSelectedApplicationId(null)
        const destination: Page = authUser.permissions.includes('CRM') ? 'CRM' : 'Customers'
        if (!authUser.permissions.includes(destination)) {
          setNotice('You do not have permission to access customer profiles.')
          return
        }
        setSelectedCustomerId(customerId)
        setPage(destination)
      }}
      onNotice={setNotice}
    />}
  </div>
}

function LoginPage({ onLogin, error }: { onLogin: (username: string, password: string) => Promise<void>; error: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [configuringWorkspace, setConfiguringWorkspace] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (configuringWorkspace) return
    setBusy(true)
    await onLogin(username, password)
    setBusy(false)
  }

  return <main className="auth-page">
    <div className={`auth-layout${configuringWorkspace ? ' auth-layout-configuring' : ''}`}>
      <section className="auth-aside" aria-label="Blue Line Travel and Visa">
        <div className="auth-brand auth-aside-brand"><span className="brand-mark">BL</span><div><strong>BLUE LINE</strong><small>TRAVEL & VISA</small></div></div>
        <div className="auth-aside-copy">
          <p>YOUR OFFICE WORKSPACE</p>
          <h2>Everything in<br />its right place.</h2>
          <span>Visa operations, customer records and team tools — all in one place.</span>
        </div>
        <div className="auth-aside-art" aria-hidden="true"><div className="auth-aside-orbit auth-aside-orbit-one" /><div className="auth-aside-orbit auth-aside-orbit-two" /><span><Plane size={28} /></span></div>
        <div className="auth-aside-footer"><ShieldCheck size={16} /><span>Blue Line Travel & Visa</span><i /></div>
      </section>
      <form className={`auth-card${configuringWorkspace ? ' is-configuring' : ''}`} onSubmit={(event) => void submit(event)}>
        {!configuringWorkspace && <>
          <div className="auth-heading">
            <p className="auth-kicker">WELCOME BACK</p>
            <h1>Sign in</h1>
            <p>Enter your account details to continue.</p>
          </div>
          <div className="auth-fields">
        <label className="field"><span>Username</span><input autoComplete="username" autoFocus required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <div className="auth-error" role="alert"><CircleAlert size={16} />{error}</div>}
        <button className="primary-btn auth-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </div>
        </>}
        <WorkspaceConfiguration onEditingChange={setConfiguringWorkspace} />
      </form>
    </div>
  </main>
}

function WorkspaceConfiguration({ onEditingChange }: { onEditingChange: (editing: boolean) => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof window.blueLine.workspaceInfo>> | null>(null)
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<'local' | 'server' | 'client'>('local')
  const [bindAddress, setBindAddress] = useState('')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState('47832')
  const [fingerprint, setFingerprint] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [createCertificate, setCreateCertificate] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    void window.blueLine.workspaceInfo().then((value) => {
      setInfo(value)
      setMode(value.mode)
      setBindAddress(value.bindAddress ?? value.networkAddresses[0] ?? '')
      setPort(String(value.port ?? 47832))
      if (value.mode === 'client' && value.host && value.port) setAddress(`https://${value.host}:${value.port}`)
      if (value.mode === 'client') setFingerprint(value.fingerprint)
      setCreateCertificate(value.mode !== 'server')
    }).catch((cause: Error) => setError(cause.message))
  }, [])
  function setWorkspaceEditing(value: boolean) {
    setEditing(value)
    onEditingChange(value)
    setError('')
    setTestResult('')
  }
  function updateSetupCode(value: string) {
    setSetupCode(value)
    setError('')
    setTestResult('')
    const code = value.trim()
    if (!code.startsWith('BLUELINE-OFFICE-1|')) return
    try {
      const setup = parseClientSetupCode(code)
      setAddress(`https://${setup.host}:${setup.port}`)
      setFingerprint(setup.fingerprint)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid office client setup code.')
    }
  }
  async function testConnection() {
    setTesting(true)
    setError('')
    setTestResult('')
    try {
      const result = await window.blueLine.testWorkspaceConnection(address.trim(), fingerprint.trim())
      setTestResult(`${result.service} is reachable and the certificate fingerprint matches.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect to the office server.')
    } finally {
      setTesting(false)
    }
  }
  async function save() {
    setSaving(true)
    setError('')
    try {
      if (mode === 'local') {
        await window.blueLine.configureWorkspace({ mode })
      } else if (mode === 'server') {
        await window.blueLine.configureWorkspace({ mode, bindAddress, port: Number(port), createCertificate })
      } else {
        await window.blueLine.configureWorkspace({ mode, address: address.trim(), fingerprint: fingerprint.trim() })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save workspace settings.')
    } finally {
      setSaving(false)
    }
  }
  return <div className={`workspace-configuration${editing ? ' is-editing' : ''}`}>
    {!editing && <>
      <div className="workspace-status">
        <span className={`workspace-status-dot${info?.mode === 'server' ? ' is-server' : info?.mode === 'client' ? ' is-client' : ''}`} />
        <div className="workspace-status-copy">
          <strong>{info ? `${info.mode === 'server' ? 'Server' : info.mode === 'client' ? 'Client' : 'Standalone'} mode` : 'Checking connection'}</strong>
          <span>{info?.mode === 'server' ? 'Company workspace hosted here' : info?.mode === 'client' ? 'Using the shared office workspace' : info ? 'Using this computer’s workspace' : 'Loading office settings…'}</span>
        </div>
        <button type="button" className="workspace-manage-btn" onClick={() => setWorkspaceEditing(true)}><Settings size={14} />Office Connection</button>
      </div>
      {info?.mode === 'server' && <div className="workspace-server-details">
        <div><span>Server address</span><code>https://{info.bindAddress}:{info.port}</code></div>
        <div><span>Certificate SHA-256</span><code>{info.fingerprint}</code></div>
        <p>Keep this computer running for office clients. Copy the client setup code from Help → Copy Client Setup Code.</p>
      </div>}
      {info?.mode === 'client' && <p className="workspace-connection-note">Connected to https://{info.host}:{info.port}. Records and files are shared from the office server.</p>}
    </>}
    {editing && <section className="workspace-connection-form">
      <div><h2>Office Connection</h2><p>Choose how this computer opens Blue Line Visa.</p></div>
      <div className="workspace-current-mode">Current mode: {info?.mode ?? 'standalone'}</div>
      <label className="field"><span>Computer mode</span>
        <select value={mode} onChange={(event) => {
          const next = event.target.value as 'local' | 'server' | 'client'
          setMode(next)
          setError('')
          setTestResult('')
          if (next === 'server' && info?.mode !== 'server') setCreateCertificate(true)
        }}>
          <option value="local">Standalone — existing local company</option>
          <option value="server">Server — central company for the office</option>
          <option value="client">Client — connect to the office server</option>
        </select>
      </label>
      {mode === 'server' && <>
        <label className="field"><span>Server LAN address</span>
          <select value={bindAddress} onChange={(event) => setBindAddress(event.target.value)}>
            {info?.networkAddresses.map((networkAddress) => <option key={networkAddress} value={networkAddress}>{networkAddress}</option>)}
          </select>
        </label>
        <p className="workspace-connection-note">Use this computer’s reserved LAN address. Select Server only on the computer that keeps the company database.</p>
        <label className="field"><span>Server port</span><input type="number" min="1024" max="65535" value={port} onChange={(event) => setPort(event.target.value)} /></label>
        <label className="workspace-checkbox"><input type="checkbox" checked={createCertificate} onChange={(event) => setCreateCertificate(event.target.checked)} /><span>Create a new server certificate</span></label>
        <p className="workspace-connection-note">Creating or changing the certificate generates a private certificate on this computer. Share its SHA-256 fingerprint with each client; clients must confirm a changed fingerprint again.</p>
      </>}
      {mode === 'client' && <>
        <label className="field"><span>Setup code from the server (optional)</span><input value={setupCode} onChange={(event) => updateSetupCode(event.target.value)} placeholder="Paste the code copied from Help → Copy Client Setup Code" /></label>
        <p className="workspace-connection-note">The code fills the server address and fingerprint below. It contains no password.</p>
        <label className="field"><span>Office server address</span><input value={address} onChange={(event) => { setAddress(event.target.value); setTestResult('') }} placeholder="https://192.168.1.101:47832" /></label>
        <label className="field"><span>Server certificate SHA-256 fingerprint</span><input value={fingerprint} onChange={(event) => { setFingerprint(event.target.value); setTestResult('') }} placeholder="Paste the fingerprint shown on the server" /></label>
        <p className="workspace-connection-note">Confirm the fingerprint directly with the server administrator. This client never creates a local company database or posts while disconnected.</p>
      </>}
      {error && <div className="auth-error" role="alert"><CircleAlert size={15} />{error}</div>}
      {testResult && <div className="workspace-test-result" role="status">{testResult}</div>}
      <div className="workspace-connection-actions">
        {mode === 'client' && <button type="button" className="secondary-btn" disabled={testing || saving} onClick={() => void testConnection()}>{testing ? 'Testing…' : 'Test Connection'}</button>}
        <button type="button" className="primary-btn" disabled={testing || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save & Restart'}</button>
        <button type="button" className="secondary-btn" disabled={testing || saving} onClick={() => setWorkspaceEditing(false)}>Cancel</button>
      </div>
    </section>}
  </div>
}

function NewApplicationForm({ pipelines, busy, provider, officeClient, onProviderChange, onClose, onSubmit }: {
  pipelines: Pipeline[]
  busy: boolean
  provider: PassportProvider
  officeClient: boolean
  onProviderChange: (provider: PassportProvider) => void
  onClose: () => void
  onSubmit: (input: NewApplication) => Promise<void>
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [inspection, setInspection] = useState<Awaited<ReturnType<typeof window.blueLine.inspectPassport>> | null>(null)
  const [visaTypes, setVisaTypes] = useState<CatalogItem[]>([])
  const [countries, setCountries] = useState<CatalogItem[]>([])
  const [selectedProvider, setSelectedProvider] = useState(provider)
  const [scanning, setScanning] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [error, setError] = useState('')
  const [scanFailed, setScanFailed] = useState(false)
  const retryFileRef = useRef<File | null>(null)
  useEffect(() => { setSelectedProvider(provider) }, [provider])

  useEffect(() => {
    void Promise.all([window.blueLine.listCatalog('visaType'), window.blueLine.listCatalog('country')])
      .then(([types, destinations]) => { setVisaTypes(types.filter((item) => item.active)); setCountries(destinations.filter((item) => item.active)) })
      .catch((cause: Error) => setError(cause.message))
  }, [])

  function clearPassportFields() {
    for (const name of ['firstName', 'surname', 'fullName', 'nationality', 'passportNumber', 'dateOfBirth', 'gender', 'passportIssueDate', 'passportExpiryDate']) {
      const field = formRef.current?.elements.namedItem(name)
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) field.value = ''
    }
  }

  async function inspect(file?: File) {
    if (!file) return
    if (officeClient && selectedProvider === 'gemini'
      && !window.confirm('Send this passport through the office server to Google Gemini for analysis?')) return
    retryFileRef.current = file
    if (!/\.(jpe?g|png|pdf)$/i.test(file.name)) { setError('IMAGE_PROCESSING_ERROR: Choose a JPG, JPEG, PNG, or PDF file.'); setScanFailed(false); return }
    setInspection(null)
    clearPassportFields()
    setScanning(true)
    setZoomed(false)
    setError('')
    setScanFailed(false)
    setReviewed(false)
    try {
      const result = await window.blueLine.inspectPassport(file, selectedProvider)
      setInspection(result)
      if (result.diagnostics?.category) {
        setError(`${result.diagnostics.category}: ${result.diagnostics.message ?? 'Gemini passport analysis did not complete.'}`)
        setScanFailed(true)
      }
      const values: Record<string, string> = {
        firstName: result.fields.firstName,
        surname: result.fields.surname,
        fullName: result.fields.fullName,
        nationality: result.fields.nationality,
        passportNumber: result.fields.passportNumber,
        dateOfBirth: result.fields.dateOfBirth,
        gender: result.fields.gender,
        passportIssueDate: result.fields.issueDate,
        passportExpiryDate: result.fields.expiryDate
      }
      for (const [name, value] of Object.entries(values)) {
        const field = formRef.current?.elements.namedItem(name)
        if (field instanceof HTMLInputElement && value) field.value = value
        if (field instanceof HTMLSelectElement && value) field.value = value
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to scan this passport.')
      setScanFailed(true)
    } finally { setScanning(false) }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inspection && !reviewed) {
      setError('Review and confirm the extracted passport details before saving.')
      return
    }
    const data = new FormData(event.currentTarget)
    await onSubmit({
      fullName: String(data.get('fullName') ?? '').trim() || joinName(String(data.get('firstName') ?? ''), String(data.get('surname') ?? '')),
      phone: String(data.get('phone') ?? ''),
      email: String(data.get('email') ?? ''),
      nationality: String(data.get('nationality') ?? ''),
      passportNumber: String(data.get('passportNumber') ?? ''),
      dateOfBirth: String(data.get('dateOfBirth') ?? ''),
      gender: String(data.get('gender') ?? ''),
      address: String(data.get('address') ?? ''),
      passportIssueDate: String(data.get('passportIssueDate') ?? ''),
      passportExpiryDate: String(data.get('passportExpiryDate') ?? ''),
      country: String(data.get('country') ?? ''),
      visaType: String(data.get('visaType') ?? ''),
      employee: String(data.get('employee') ?? ''),
      followUpDate: String(data.get('followUpDate') ?? ''),
      pipelineId: Number(data.get('pipelineId') ?? pipelines[0]?.id ?? 1),
      passportToken: inspection?.token
    })
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="modal application-modal" ref={formRef} onChange={(event) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement) || !['firstName', 'surname'].includes(target.name)) return
      const data = new FormData(event.currentTarget)
      const fullName = formRef.current?.elements.namedItem('fullName')
      if (fullName instanceof HTMLInputElement) fullName.value = joinName(String(data.get('firstName') ?? ''), String(data.get('surname') ?? ''))
    }} onSubmit={(event) => void submit(event)}>
      <div className="modal-head"><div><p className="eyebrow">APPLICATION</p><h2>New application</h2></div><button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button></div>
      <section className="passport-scan">
        <div className="passport-scan-heading"><div><strong>Passport scan · Iraqi profile</strong><small>{selectedProvider === 'gemini' ? 'Gemini Vision analyzes the original image with labeled-field context. Images are sent to Google; MRZ is optional corroboration.' : 'Local visual OCR uses printed labels and field positions. MRZ is optional corroboration only.'}</small></div><div className="passport-scan-actions"><label className="field passport-provider"><span>Recognition engine</span><select disabled={scanning} value={selectedProvider} onChange={(event) => {
          const nextProvider = event.target.value as PassportProvider
          const previousProvider = selectedProvider
          setSelectedProvider(nextProvider)
          setInspection(null)
          clearPassportFields()
          setReviewed(false)
          void window.blueLine.savePassportProvider(nextProvider).then(onProviderChange).catch((cause: Error) => {
            setSelectedProvider(previousProvider)
            setError(cause.message)
          })
        }}><option value="ocr">Local OCR</option><option value="gemini">Gemini Vision{officeClient ? ' (office server)' : ''}</option></select></label><label className="secondary-btn small"><Upload size={15} />Browse<input className="visually-hidden" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(event) => void inspect(event.target.files?.[0])} /></label></div></div>
        <div className={`passport-review-layout ${scanning ? 'is-scanning' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void inspect(event.dataTransfer.files[0]) }}>
          <div className="passport-original-pane">
          {scanning ? <div className="loading-panel"><span /><strong>Preprocessing and reading passport…</strong></div> : inspection ? <div className="passport-preview">
            {inspection.mimeType === 'application/pdf'
              ? <iframe title="Passport PDF preview" src={inspection.previewDataUrl} />
              : <img className={zoomed ? 'zoomed' : ''} src={inspection.previewDataUrl} alt="Passport scan preview" />}
            <div className="passport-preview-info"><span>{inspection.fileName}</span>{inspection.mimeType !== 'application/pdf' && <button type="button" className="text-btn" onClick={() => setZoomed((value) => !value)}><ZoomIn size={14} />{zoomed ? 'Fit' : 'Zoom'}</button>}<button type="button" className="text-btn" onClick={() => { setInspection(null); clearPassportFields(); setReviewed(false); setZoomed(false); setScanFailed(false); setError(''); retryFileRef.current = null }}><X size={14} />Remove</button></div>
            <p className="scan-confidence uncertain">{selectedProvider === 'gemini'
              ? `Gemini Vision · all extracted values require manual verification${inspection.mrz ? ` · MRZ ${inspection.mrz.checkDigitsValid ? 'available for comparison' : 'unclear or failed validation'}` : ' · MRZ unavailable'}`
              : inspection.mimeType === 'application/pdf'
              ? 'PDF preview only · automatic OCR is unavailable for PDFs. Enter and verify the passport fields manually.'
              : inspection.mrz
                ? `MRZ ${inspection.mrz.checkDigitsValid ? 'available for comparison' : 'is unclear or failed validation'} · visual fields remain primary.`
                : 'MRZ unavailable · extracted information is based on visible labeled fields.'}</p>
          </div> : <div className="passport-drop-copy"><Files size={24} /><strong>Drag and drop passport scan here</strong><span>JPG, JPEG, PNG, PDF · up to 25 MB</span></div>}
          </div>
          {inspection?.diagnostics && <PassportDiagnosticsPanel diagnostics={inspection.diagnostics} onRetry={() => void inspect(retryFileRef.current ?? undefined)} retryDisabled={scanning} />}
          <div className="passport-extracted-panel">
            <div className="passport-extracted-heading"><strong>Extracted passport fields</strong><span>{inspection ? 'Review each value before saving' : 'Upload an image to extract fields'}</span></div>
            <div className="passport-extracted-grid">
              {renderPassportField('firstName', 'Given name')}
              {renderPassportField('surname', 'Surname')}
              {renderPassportField('fullName', 'Full name')}
              {renderPassportField('passportNumber', 'Passport number')}
              {renderPassportField('dateOfBirth', 'Date of birth', 'date')}
              {renderPassportField('nationality', 'Nationality')}
              {renderPassportField('gender', 'Gender', 'gender')}
              {renderPassportField('issueDate', 'Issue date', 'date')}
              {renderPassportField('expiryDate', 'Expiry date', 'date')}
            </div>
          </div>
        </div>
        {error && <div className="notice-banner"><CircleAlert size={15} /><span>{error}</span>{scanFailed && retryFileRef.current && <button type="button" className="text-btn" disabled={scanning} onClick={() => void inspect(retryFileRef.current ?? undefined)}><RefreshCw size={14} />Retry</button>}</div>}
        {inspection && <label className="review-confirm"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I verified the original image, manually corrected every uncertain or conflicting value, and confirm the fields above. OCR results are never saved until verified.</span></label>}
      </section>
      <div className="form-grid">
        <Field label="Phone number" name="phone" />
        <Field label="Email" name="email" type="email" />
        <Field label="Address" name="address" />
        <label className="field"><span>Destination country</span><select name="country" required defaultValue=""><option value="" disabled>Select country</option>{countries.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
        <label className="field"><span>Visa type</span><select name="visaType" required defaultValue=""><option value="" disabled>Select visa type</option>{visaTypes.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
        <label className="field"><span>Pipeline</span><select name="pipelineId" defaultValue={String(pipelines[0]?.id ?? 1)}>{pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Field label="Assigned employee" name="employee" />
        <Field label="Follow-up date" name="followUpDate" type="date" />
      </div>
      <div className="modal-foot"><span>Existing customers are matched by passport number.</span><button className="primary-btn" disabled={busy || (inspection !== null && !reviewed)}>{busy ? 'Saving…' : 'Save application'}</button></div>
    </form>
  </div>

  function renderPassportField(field: PassportFieldName, label: string, type: 'text' | 'date' | 'gender' = 'text') {
    const assessment: PassportFieldAssessment | undefined = inspection?.assessments[field]
    const state = assessment?.conflict ? 'conflict' : assessment?.needsReview ? 'review' : 'verified'
    const source = assessment?.sources.includes('visible')
      ? `Visible label${assessment.sources.includes('mrz') ? ' + MRZ' : ''}${assessment.sources.includes('gemini') ? ' + Gemini Vision' : ''}`
      : assessment?.sources.includes('gemini')
        ? `Gemini Vision${assessment.sources.includes('mrz') ? ' + MRZ' : ''}`
        : assessment?.sources.includes('mrz') ? 'MRZ fallback' : 'Not read'
    return <label className={`field passport-extracted-field ${inspection ? `ocr-${state}` : ''}`} key={field}>
      <span>{label}</span>
      {type === 'gender'
        ? <select name={field} defaultValue=""><option value="">Select gender</option><option>Female</option><option>Male</option><option>Unspecified</option></select>
        : <input name={field === 'issueDate' ? 'passportIssueDate' : field === 'expiryDate' ? 'passportExpiryDate' : field} type={type} required={field === 'firstName' || field === 'surname'} />}
      {inspection && <><small className="ocr-field-status">{assessment?.conflict ? `Conflict · ${source} · verify manually` : assessment?.needsReview ? `${source} · review · ${assessment?.confidence ?? 0}%` : `${source} · ${assessment?.confidence ?? 0}%`}</small><span className="passport-confidence-track" aria-label={`${assessment?.confidence ?? 0}% confidence`}><span style={{ width: `${assessment?.confidence ?? 0}%` }} /></span></>}
    </label>
  }
}

function Field({ label, name, type = 'text', required = false, placeholder, defaultValue }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string; defaultValue?: string }): React.JSX.Element {
  return <label className="field"><span>{label}{required && <i> *</i>}</span><input name={name} type={type} required={required} placeholder={placeholder} defaultValue={defaultValue ?? ''} /></label>
}

function PassportDiagnosticsPanel({ diagnostics, onRetry, retryDisabled }: {
  diagnostics: PassportDiagnostics
  onRetry: () => void
  retryDisabled: boolean
}) {
  const stages: Array<[keyof PassportDiagnostics['stages'], string]> = [
    ['apiConnection', 'API connection'], ['imageProcessing', 'Image processing'],
    ['request', 'Request sent'], ['response', 'Response received'],
    ['jsonParsing', 'JSON parsing'], ['validation', 'Recognition validation']
  ]
  return <section className="passport-diagnostics" aria-label="Gemini passport diagnostics">
    <div className="passport-diagnostics-head"><strong>Gemini diagnostics</strong><span>Model: {diagnostics.model ?? 'Not selected'}</span></div>
    <div className="passport-diagnostics-stages">{stages.map(([key, title]) => <div className={`diagnostic-state ${diagnostics.stages[key]}`} key={key}>
      <i />{title}<span>{diagnostics.stages[key]}</span>
    </div>)}</div>
    {diagnostics.category && <div className="diagnostic-failure"><strong>{diagnostics.category}</strong><span>{diagnostics.message}</span>{diagnostics.attempts !== undefined && <small>{diagnostics.attempts} request attempt(s)</small>}</div>}
    {diagnostics.responsePreview && <details className="diagnostic-response"><summary>Gemini response excerpt (memory only)</summary><pre>{diagnostics.responsePreview}</pre></details>}
    {diagnostics.category && <button type="button" className="secondary-btn small diagnostic-retry" onClick={onRetry} disabled={retryDisabled}><RefreshCw size={14} />Retry Gemini scan</button>}
  </section>
}

function ApplicationLauncher({ permissions, onOpen }: { permissions: AppModule[]; onOpen: (page: Page) => void }) {
  const apps: Array<{ name: Page; label: string; icon: typeof LayoutDashboard; tone: string }> = [
    { name: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard, tone: 'dashboard' },
    { name: 'My Attendance', label: 'My Attendance', icon: CalendarClock, tone: 'dashboard' },
    { name: 'CRM', label: 'CRM', icon: ContactRound, tone: 'crm' },
    { name: 'Visa Pipeline', label: 'Visa Pipeline', icon: BriefcaseBusiness, tone: 'pipeline' },
    { name: 'Customers', label: 'Customers', icon: Users, tone: 'customers' },
    { name: 'DATA', label: 'Data', icon: DatabaseIcon, tone: 'data' },
    { name: 'Documents', label: 'Documents', icon: Files, tone: 'documents' },
    { name: 'Reports', label: 'Reports', icon: ClipboardList, tone: 'reports' },
    { name: 'Settings', label: 'Settings', icon: Settings, tone: 'settings' }
  ]
  return <div className="launcher-page">
    <div className="launcher-intro"><p>Discover the beyond</p></div>
    <div className="launcher-grid">{apps.filter(({ name }) => permissions.includes(name as AppModule)).map(({ name, label, icon: Icon, tone }) => <button className={`launcher-card ${tone}`} key={name} onClick={() => onOpen(name)}>
      <span className={`launcher-icon ${tone}`}><Icon size={25} strokeWidth={1.8} /></span><strong>{label}</strong>
    </button>)}{!apps.some(({ name }) => permissions.includes(name as AppModule)) && <p className="empty-inline">No application modules are assigned to this account.</p>}</div>
    <div className="launcher-footer"><span className="online-dot" />Workspace · Access based on your account</div>
  </div>
}

function CatalogPage({ kind, title, canManage, setNotice }: { kind: 'visaType' | 'country'; title: string; canManage: boolean; setNotice: (message: string) => void }) {
  return <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">WORKSPACE DATA</p><h1>{title}</h1><p className="subheading">{canManage ? 'Manage the options available to your visa team.' : 'Search existing options or add a new one.'}</p></div></div><CatalogManager kind={kind} title={title} canManage={canManage} onNotice={setNotice} /></div>
}

function DocumentsPage({ query, setNotice }: { query: string; setNotice: (message: string) => void }) {
  const [documents, setDocuments] = useState<DocumentLibraryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<'fileName' | 'category' | 'applicationId' | 'customerName' | 'addedAt'>('addedAt')
  const [descending, setDescending] = useState(true)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [officeClient, setOfficeClient] = useState(false)
  const [reference, setReference] = useState('')
  const [uploading, setUploading] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => { void window.blueLine.workspaceInfo().then((info) => setOfficeClient(info.mode === 'client')).catch((error: Error) => setNotice(error.message)) }, [setNotice])
  useEffect(() => {
    let active = true
    setLoading(true)
    void window.blueLine.listAllDocuments().then((rows) => { if (active) setDocuments(rows) })
      .catch((error: unknown) => { if (active) setNotice(error instanceof Error ? error.message : 'Unable to load documents.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [setNotice, revision])
  useEffect(() => { setSelected(new Set()); setPage(0) }, [query])
  const visible = documents.filter((document) => [document.fileName, document.category, document.applicationId, document.customerName].some((value) => String(value ?? '').toLowerCase().includes(query.toLowerCase()))).sort((a, b) => {
    const comparison = String(a[sortKey]).localeCompare(String(b[sortKey]), undefined, { numeric: true, sensitivity: 'base' })
    return descending ? -comparison : comparison
  })
  const pageSize = 12
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const documentKey = (document: DocumentLibraryRecord) => `${document.storage}-${document.id}`
  async function openSelected() {
    const selectedRows = visible.filter((document) => selected.has(documentKey(document)))
    if (!selectedRows.length || !window.confirm(`Open ${selectedRows.length} selected document(s) with the default desktop applications?`)) return
    try {
      for (const document of selectedRows) {
        if (document.storage === 'application') await window.blueLine.openDocument(document.id)
        else await window.blueLine.openCustomerDocument(document.id)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to open selected documents.') }
  }
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">FILE LIBRARY</p><h1>Documents</h1><p className="subheading">Documents stored with visa applications.</p></div><span className="count-badge">{visible.length}</span></div>
    {officeClient && <section className="panel">
      <div className="panel-heading"><div><h2>Upload to an existing application</h2><p>Enter its application reference. PDF, JPG and PNG files up to 25 MB are stored on the office server.</p></div></div>
      <label className="field"><span>Application reference</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
      <button type="button" className="secondary-btn" disabled={uploading || !reference.trim()} onClick={() => {
        setUploading(true)
        void window.blueLine.uploadDocumentByReference(reference.trim()).then((item) => {
          if (item) { setNotice(`${item.fileName} uploaded to the office server.`); setRevision((value) => value + 1) }
        }).catch((error: Error) => setNotice(error.message)).finally(() => setUploading(false))
      }}>{uploading ? 'Uploading…' : 'Choose and upload document'}</button>
      <p>Opening a document asks where to save a copy on this computer.</p>
    </section>}
    <section className="panel document-library">
      {loading ? <div className="loading-panel"><span /><span /><span /></div> : visible.length ? <>
        <div className="list-toolbar"><div className="list-toolbar-summary"><span className="count-badge">{visible.length}</span><span>{selected.size ? `${selected.size} selected` : 'Documents'}</span>{selected.size > 0 && <button className="text-btn" onClick={() => setSelected(new Set())}>Clear selection</button>}</div><div className="list-toolbar-actions"><label className="list-sort">Sort by<select aria-label="Sort documents" value={sortKey} onChange={(event) => { setSortKey(event.target.value as typeof sortKey); setPage(0) }}><option value="addedAt">Date added</option><option value="fileName">File name</option><option value="category">Category</option><option value="applicationId">Application</option><option value="customerName">Customer</option></select></label><button className={`sort-direction ${descending ? 'descending' : ''}`} aria-label={descending ? 'Sort ascending' : 'Sort descending'} onClick={() => setDescending((value) => !value)}>↓</button>{selected.size > 0 && <button className="secondary-btn small" onClick={() => void openSelected()}>Open selected</button>}</div></div>
        <div className="table-scroll"><table><thead><tr><th className="selection-cell"><input aria-label="Select documents on this page" type="checkbox" checked={pageRows.length > 0 && pageRows.every((document) => selected.has(documentKey(document)))} onChange={(event) => setSelected((value) => { const next = new Set(value); pageRows.forEach((document) => event.target.checked ? next.add(documentKey(document)) : next.delete(documentKey(document))); return next })} /></th><th>FILE</th><th>CATEGORY</th><th>APPLICATION</th><th>CUSTOMER</th><th>ADDED</th><th /></tr></thead><tbody>
        {pageRows.map((document) => <tr key={documentKey(document)} onClick={() => void (document.storage === 'application' ? window.blueLine.openDocument(document.id) : window.blueLine.openCustomerDocument(document.id)).catch((error: Error) => setNotice(error.message))}><td className="selection-cell" onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${document.fileName}`} type="checkbox" checked={selected.has(documentKey(document))} onChange={(event) => setSelected((value) => { const next = new Set(value); event.target.checked ? next.add(documentKey(document)) : next.delete(documentKey(document)); return next })} /></td><td><strong>{document.fileName}</strong></td><td>{document.category}</td><td><strong className="app-id">{document.applicationId || 'Customer file'}</strong></td><td>{document.customerName}</td><td>{new Date(document.addedAt).toLocaleDateString()}</td><td><ArrowUpRight size={15} className="muted-icon" /></td></tr>)}
        </tbody></table></div><div className="list-pagination"><span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, visible.length)} of {visible.length}</span><div><button className="secondary-btn small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="secondary-btn small" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
      </> : <div className="empty-state"><div className="empty-illustration"><FileText size={25} /></div><h3>{query ? 'No matching documents' : 'No documents yet'}</h3><p>Application documents will appear here after they are uploaded.</p></div>}
    </section>
  </div>
}

function DashboardPage({ stats, loading, copy, welcome, attendance, attendanceError, attendanceBusy, onAttendance, onNew, onOpen }: {
  stats: Dashboard | null
  loading: boolean
  copy: (key: string) => string
  welcome: boolean
  attendance: HrSelfAttendanceStatus | null
  attendanceError: string
  attendanceBusy: boolean
  onAttendance: (action: 'in' | 'out') => void
  onNew: () => void
  onOpen: (id: string) => void
}) {
  const items = [
    { title: copy('Total applications'), value: stats?.total ?? 0, icon: BriefcaseBusiness, color: 'blue' },
    { title: copy('New applications'), value: stats?.byStatus['New Request'] ?? 0, icon: Plus, color: 'violet' },
    { title: copy('Documents required'), value: (stats?.byStatus['Documents Collection'] ?? 0) + (stats?.byStatus['Additional Documents Required'] ?? 0), icon: Files, color: 'amber' },
    { title: copy('Ready to submit'), value: stats?.byStatus['Ready to Submit'] ?? 0, icon: ArrowUpRight, color: 'green' },
    { title: copy('Under process'), value: stats?.byStatus['Under Process'] ?? 0, icon: CalendarClock, color: 'blue' },
    { title: copy('Approved'), value: stats?.byStatus.Approved ?? 0, icon: Check, color: 'green' },
    { title: copy('Rejected'), value: stats?.byStatus.Rejected ?? 0, icon: X, color: 'red' },
    { title: copy('Overdue follow-ups'), value: stats?.overdue ?? 0, icon: CircleAlert, color: 'amber' }
  ]
  return <div className="page-stack">
    {welcome && <div className="mustafa-welcome">Welcome to Dr Mustafa Marwan</div>}
    <div className="page-heading"><div><p className="eyebrow">OVERVIEW</p><h1>{copy('Dashboard')}</h1><p className="subheading">Your visa operations at a glance.</p></div><button className="primary-btn" onClick={onNew}><Plus size={17} />{copy('New application')}</button></div>
    <section className="panel dashboard-attendance" aria-busy={attendanceBusy} aria-labelledby="dashboard-attendance-title">
      <div className="dashboard-attendance-heading">
        <p className="eyebrow">HUMAN RESOURCES</p>
        <h2 id="dashboard-attendance-title">{copy('My attendance')}</h2>
        <p>{attendanceError || (attendance
          ? `${attendance.employeeName} · ${attendance.attendanceDate}`
          : copy('Checking attendance status...'))}</p>
      </div>
      <div className="dashboard-attendance-times" aria-live="polite">
        <div><span>{copy('Check in')}</span><strong>{attendance?.checkIn ?? '—'}</strong></div>
        <div><span>{copy('Check out')}</span><strong>{attendance?.checkOut ?? '—'}</strong></div>
      </div>
      <div className="dashboard-attendance-actions">
        <button type="button" className="primary-btn" disabled={attendanceBusy || !attendance?.shouldPrompt} onClick={() => onAttendance('in')}>
          <Check size={14} />{attendanceBusy ? copy('Checking in...') : copy('Check in')}
        </button>
        <button type="button" className="secondary-btn" disabled={attendanceBusy || !attendance?.checkIn || Boolean(attendance.checkOut)} onClick={() => onAttendance('out')}>
          <Check size={14} />{attendanceBusy ? copy('Checking out...') : copy('Check out')}
        </button>
      </div>
    </section>
    <div className="stats-grid" aria-busy={loading}>{items.map(({ title, value, icon: Icon, color }) => <div className="stat-card" key={title}>
      <div className={`stat-icon ${color}`}><Icon size={18} /></div><div className="stat-title">{title}</div><div className="stat-value">{loading ? <span className="loading-skeleton" aria-label="Loading" /> : value}</div><div className="stat-foot">Live from your local records</div>
    </div>)}</div>
    <div className="dashboard-lower">
      <section className="panel recent-panel"><div className="panel-heading"><div><h2>{copy('Recent applications')}</h2><p>Latest activity across your pipeline</p></div><button className="text-btn" onClick={() => onOpen('')}>View pipeline <ArrowUpRight size={15} /></button></div>
        {loading ? <div className="loading-panel" aria-label="Loading recent applications"><span /><span /><span /></div> : !stats?.recent.length ? <EmptyState copy={copy} onNew={onNew} /> : <ApplicationTable rows={stats.recent} onOpen={onOpen} />}
      </section>
      <section className="panel country-panel"><div className="panel-heading"><div><h2>{copy('Applications by country')}</h2><p>Destination distribution</p></div><Globe2 size={17} className="muted-icon" /></div>
        {loading ? <div className="loading-panel country-loading" aria-label="Loading country summary"><span /><span /><span /></div> : !stats?.countries.length ? <div className="chart-empty">Country insights will appear when applications are added.</div> : <div className="country-list">{stats.countries.map((row) => {
          const max = Math.max(...stats.countries.map((item) => item.count), 1)
          return <div className="country-row" key={row.country}><div className="country-label"><span>{row.country}</span><b>{row.count}</b></div><div className="bar-track"><span style={{ width: `${row.count / max * 100}%` }} /></div></div>
        })}</div>}
      </section>
    </div>
  </div>
}

function EmptyState({ copy, onNew }: { copy: (key: string) => string; onNew: () => void }) {
  return <div className="empty-state"><div className="empty-illustration"><BriefcaseBusiness size={26} /></div><h3>{copy('No applications yet')}</h3><p>{copy('Create your first application to start managing your visa pipeline.')}</p><button className="secondary-btn" onClick={onNew}><Plus size={15} />{copy('New application')}</button></div>
}

function MyAttendancePage({ attendance, attendanceError, attendanceBusy, onAttendance }: {
  attendance: HrSelfAttendanceStatus | null
  attendanceError: string
  attendanceBusy: boolean
  onAttendance: (action: 'in' | 'out') => void
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [days, setDays] = useState<HrAttendanceDay[]>([])
  const [loading, setLoading] = useState(true)
  const [calendarError, setCalendarError] = useState('')
  const year = month.getFullYear()
  const monthNumber = month.getMonth() + 1
  useEffect(() => {
    let active = true
    setLoading(true)
    setCalendarError('')
    void window.blueLine.selfAttendance.calendar(year, monthNumber).then((records) => {
      if (active) setDays(records)
    }).catch((error: unknown) => {
      if (active) setCalendarError(error instanceof Error ? error.message : 'Unable to load your attendance calendar.')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [year, monthNumber, attendance?.checkIn, attendance?.checkOut])

  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const firstWeekday = (new Date(year, month.getMonth(), 1).getDay() + 6) % 7
  const dayCount = new Date(year, month.getMonth() + 1, 0).getDate()
  const records = new Map(days.map((day) => [Number(day.date.slice(-2)), day]))
  const cells = Array.from({ length: firstWeekday + dayCount }, (_, index) => {
    const day = index - firstWeekday + 1
    return day > 0 ? day : null
  })
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return <div className="page-stack my-attendance-page">
    <div className="page-heading"><div><p className="eyebrow">PERSONAL</p><h1>My Attendance</h1><p className="subheading">Your check-in, check-out, and attendance history.</p></div></div>
    <section className="panel my-attendance-status" aria-busy={attendanceBusy} aria-labelledby="my-attendance-status-title">
      <div className="my-attendance-status-heading">
        <div className="attendance-app-icon"><CalendarClock size={20} /></div>
        <div><p className="eyebrow">TODAY</p><h2 id="my-attendance-status-title">{attendance?.employeeName ?? 'Attendance status'}</h2>
          <p>{attendanceError || attendance?.attendanceDate || 'Loading your attendance record…'}</p></div>
      </div>
      <div className="my-attendance-timings" aria-live="polite">
        <div><span>Check in</span><strong>{attendance?.checkIn ?? '—'}</strong></div>
        <div><span>Check out</span><strong>{attendance?.checkOut ?? '—'}</strong></div>
      </div>
      <div className="my-attendance-actions">
        <button type="button" className="primary-btn" disabled={attendanceBusy || !attendance?.shouldPrompt} onClick={() => onAttendance('in')}>
          <Check size={14} />{attendanceBusy ? 'Recording…' : 'Check in'}
        </button>
        <button type="button" className="secondary-btn" disabled={attendanceBusy || !attendance?.checkIn || Boolean(attendance.checkOut)} onClick={() => onAttendance('out')}>
          <Check size={14} />{attendanceBusy ? 'Recording…' : 'Check out'}
        </button>
      </div>
    </section>
    <section className="panel my-attendance-calendar">
      <div className="panel-heading"><div><h2>Attendance calendar</h2><p>{loading ? 'Loading your records…' : `${days.length} recorded ${days.length === 1 ? 'day' : 'days'}`}</p></div>
        <div className="my-attendance-month-controls">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(year, month.getMonth() - 1, 1))}><ChevronLeft size={17} /></button>
          <strong>{monthLabel}</strong>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(year, month.getMonth() + 1, 1))}><ChevronRight size={17} /></button>
        </div>
      </div>
      {calendarError && <div className="notice-banner"><CircleAlert size={15} /><span>{calendarError}</span></div>}
      <div className="my-attendance-calendar-grid" aria-busy={loading}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => <strong className="my-attendance-weekday" key={weekday}>{weekday}</strong>)}
        {cells.map((day, index) => {
          if (day === null) return <span className="my-attendance-blank" key={`blank-${index}`} />
          const record = records.get(day)
          const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const isDayOff = record?.status === 'Day Off'
          const checkedIn = Boolean(record?.checkIn)
          const label = [date, record?.status, record?.checkIn && `In ${record.checkIn}`, record?.checkOut && `Out ${record.checkOut}`].filter(Boolean).join(' · ')
          return <div
            className={`my-attendance-day${isDayOff ? ' day-off' : checkedIn ? ' checked-in' : ''}${date === todayKey ? ' today' : ''}`}
            key={date}
            aria-label={label}
            title={label}
          ><span>{day}</span>{record && <small>{isDayOff ? 'Day off' : record.checkOut ? 'Complete' : record.checkIn ? 'Checked in' : record.status}</small>}</div>
        })}
      </div>
      <div className="my-attendance-legend"><span><i className="checked-in" />Attendance recorded</span><span><i className="day-off" />Day off</span></div>
    </section>
  </div>
}

function ApplicationTable({ rows, onOpen }: { rows: Application[]; onOpen: (id: string) => void }) {
  return <div className="table-scroll"><table><thead><tr><th>APPLICATION</th><th>CUSTOMER</th><th>DESTINATION</th><th>STATUS</th><th>FOLLOW-UP</th><th /></tr></thead><tbody>
    {rows.map((row) => <tr key={row.id} onClick={() => onOpen(row.applicationId)}><td><strong className="app-id">{row.applicationId}</strong><small>{row.visaType}</small></td><td><strong>{row.customerName}</strong><small>{row.phone}</small></td><td>{row.country}</td><td><StatusPill value={row.status} /></td><td>{row.followUpDate || '—'}</td><td><ArrowUpRight size={15} className="muted-icon" /></td></tr>)}
  </tbody></table></div>
}

function StatusPill({ value }: { value: string }) {
  const color = value === 'Approved' ? 'green' : value === 'Rejected' ? 'red' : value === 'New Request' ? 'blue' : value === 'Under Process' ? 'violet' : value.includes('Required') ? 'amber' : 'gray'
  return <span className={`status-pill ${color}`}><i />{value}</span>
}

function PipelinePage({ apps, customers, pipelines, query, readOnly, onNew, onMove, onMoveMany, onOpen }: { apps: Application[]; customers: Customer[]; pipelines: Pipeline[]; query: string; readOnly: boolean; onNew: () => void; onMove: (id: number, status: string) => void; onMoveMany: (ids: number[], status: string) => Promise<boolean>; onOpen: (id: number) => void }) {
  const [country, setCountry] = useState('')
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? 1)
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkStage, setBulkStage] = useState('')
  const [sortKey, setSortKey] = useState<'applicationId' | 'customerName' | 'country' | 'status' | 'followUpDate'>('applicationId')
  const [sortDescending, setSortDescending] = useState(true)
  const [listPage, setListPage] = useState(0)
  useEffect(() => { if (!pipelines.some((item) => item.id === pipelineId) && pipelines[0]) setPipelineId(pipelines[0].id) }, [pipelines, pipelineId])
  const selectedPipeline = pipelines.find((item) => item.id === pipelineId)
  const stages = selectedPipeline?.stages ?? STAGES
  const pipelineApps = apps.filter((app) => (app.pipelineId ?? 1) === pipelineId)
  const customersById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers])
  const countries = [...new Set(pipelineApps.map((app) => app.country))].sort()
  const filtered = country ? pipelineApps.filter((app) => app.country === country) : pipelineApps
  const sortedFiltered = [...filtered].sort((a, b) => {
    const comparison = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''), undefined, { numeric: true, sensitivity: 'base' })
    return sortDescending ? -comparison : comparison
  })
  const listPageSize = 12
  const listPageCount = Math.max(1, Math.ceil(sortedFiltered.length / listPageSize))
  const activeListPage = Math.min(listPage, listPageCount - 1)
  const listRows = sortedFiltered.slice(activeListPage * listPageSize, (activeListPage + 1) * listPageSize)
  const [dragging, setDragging] = useState<number | null>(null)
  return <div className="page-stack pipeline-page">
    <div className="page-heading"><div><p className="eyebrow">CASE MANAGEMENT</p><h1>Visa Pipeline</h1><p className="subheading">Track every application from request to completion.</p></div>{!readOnly && <button className="primary-btn" onClick={onNew}><Plus size={17} />New application</button>}</div>
    <div className="filter-row"><label className="filter-search"><Search size={15} /><span>{query ? `${filtered.length} matching records` : `${pipelineApps.length} applications`}</span></label>{pipelines.length > 1 && <select aria-label="Select pipeline" value={pipelineId} onChange={(event) => { setPipelineId(Number(event.target.value)); setCountry(''); setSelected(new Set()); setListPage(0) }}>{pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}<select aria-label="Filter by country" value={country} onChange={(e) => { setCountry(e.target.value); setListPage(0); setSelected(new Set()) }}><option value="">All countries</option>{countries.map((item) => <option key={item}>{item}</option>)}</select><button className="secondary-btn small" onClick={() => { setCountry(''); setSelected(new Set()); setListPage(0) }}>Clear filters</button><div className="view-switch" role="group" aria-label="Choose view"><button className={view === 'kanban' ? 'selected' : ''} onClick={() => setView('kanban')}><BriefcaseBusiness size={15} />Kanban</button><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><ClipboardList size={15} />List</button></div></div>
    {view === 'list' ? <section className="panel pipeline-list-view">
      <div className="list-toolbar"><div className="list-toolbar-summary"><span className="count-badge">{filtered.length}</span><span>{selected.size ? `${selected.size} selected` : 'Applications'}</span>{!readOnly && selected.size > 0 && <button className="text-btn" onClick={() => setSelected(new Set())}>Clear selection</button>}</div><div className="list-toolbar-actions"><label className="list-sort">Sort by<select aria-label="Sort applications" value={sortKey} onChange={(event) => { setSortKey(event.target.value as typeof sortKey); setListPage(0) }}><option value="applicationId">Reference</option><option value="customerName">Customer</option><option value="country">Country</option><option value="status">Status</option><option value="followUpDate">Follow-up</option></select></label><button className={`sort-direction ${sortDescending ? 'descending' : ''}`} aria-label={sortDescending ? 'Sort ascending' : 'Sort descending'} onClick={() => setSortDescending((value) => !value)}>↓</button>{!readOnly && selected.size > 0 && <><select aria-label="Move selected applications to stage" value={bulkStage} onChange={(event) => setBulkStage(event.target.value)}><option value="">Move to stage…</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select><button className="secondary-btn small" disabled={!bulkStage} onClick={() => { const ids = filtered.filter((app) => selected.has(app.id)).map((app) => app.id); void onMoveMany(ids, bulkStage).then((success) => { if (success) setSelected(new Set()) }) }}>Apply</button></>}</div></div>
      {filtered.length ? <><div className="table-scroll"><table><thead><tr>{!readOnly && <th className="selection-cell"><input aria-label="Select all applications on page" type="checkbox" checked={listRows.length > 0 && listRows.every((row) => selected.has(row.id))} onChange={(event) => setSelected((value) => { const next = new Set(value); listRows.forEach((row) => event.target.checked ? next.add(row.id) : next.delete(row.id)); return next })} /></th>}<th>APPLICATION</th><th>CUSTOMER</th><th>PASSPORT</th><th>DESTINATION</th><th>VISA TYPE</th><th>STATUS</th><th>FOLLOW-UP</th></tr></thead><tbody>{listRows.map((app) => {
        const customer = customersById.get(app.customerId)
        return <tr key={app.id} onClick={readOnly ? undefined : () => onOpen(app.id)}>{!readOnly && <td className="selection-cell" onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${app.applicationId}`} type="checkbox" checked={selected.has(app.id)} onChange={(event) => setSelected((value) => { const next = new Set(value); event.target.checked ? next.add(app.id) : next.delete(app.id); return next })} /></td>}<td><strong className="app-id">{app.applicationId}</strong></td><td><span className="customer-cell"><span className="customer-avatar">{customer?.photoDataUrl ? <img src={customer.photoDataUrl} alt="" /> : app.customerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><strong>{app.customerName}</strong></span></td><td>{customer?.passportNumber || '—'}</td><td>{app.country}</td><td>{app.visaType}</td><td><StatusPill value={app.status} /></td><td>{app.followUpDate || '—'}</td></tr>
      })}</tbody></table></div><div className="list-pagination"><span>Showing {activeListPage * listPageSize + 1}–{Math.min((activeListPage + 1) * listPageSize, filtered.length)} of {filtered.length}</span><div><button className="secondary-btn small" disabled={activeListPage === 0} onClick={() => setListPage(activeListPage - 1)}>Previous</button><span>Page {activeListPage + 1} of {listPageCount}</span><button className="secondary-btn small" disabled={activeListPage >= listPageCount - 1} onClick={() => setListPage(activeListPage + 1)}>Next</button></div></div></> : <div className="empty-inline"><BriefcaseBusiness size={20} /><p>No applications match these filters.</p></div>}
    </section> : <div className="kanban-board">{stages.map((stage, index) => {
      const rows = filtered.filter((app) => app.status === stage)
      return <section className={`kanban-column ${dragging !== null ? 'drag-active' : ''}`} key={stage} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
        e.preventDefault(); const id = Number(e.dataTransfer.getData('text/plain')); if (id && !readOnly) onMove(id, stage); setDragging(null)
      }}><div className="column-head"><span className={`stage-dot stage-${index}`} /><strong>{stage}</strong><b>{rows.length}</b></div>
        <div className="column-body">{rows.map((app) => <article draggable={!readOnly} key={app.id} className="kanban-card" onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(app.id)); setDragging(app.id) }} onDragEnd={() => setDragging(null)}>
          <div className="card-top"><span className="app-id">{app.applicationId}</span>{!readOnly && <><button type="button" title="Application details" className="mini-icon" onClick={() => onOpen(app.id)}><Pencil size={14} /></button><button type="button" title="Upload document" className="mini-icon" onClick={async () => {
            try { const file = await window.blueLine.uploadDocument(app.id); if (file) window.dispatchEvent(new CustomEvent('app-notice', { detail: `${file.fileName} uploaded.` })) } catch (error) { window.dispatchEvent(new CustomEvent('app-notice', { detail: error instanceof Error ? error.message : 'Upload failed.' })) }
          }}><Files size={15} /></button></>}</div>
          <div className="kanban-customer"><span className="customer-avatar">{customersById.get(app.customerId)?.photoDataUrl ? <img src={customersById.get(app.customerId)?.photoDataUrl ?? ''} alt="" /> : app.customerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><strong className="card-customer">{app.customerName}</strong></div><div className="card-destination"><Globe2 size={13} />{app.country}<span>·</span>{app.visaType}</div><div className="card-passport">Passport {customersById.get(app.customerId)?.passportNumber || 'Not recorded'}</div>
          <div className="card-footer"><span>{app.employee || 'Unassigned'}</span><small>{app.followUpDate ? `Follow-up ${app.followUpDate}` : app.applicationDate}</small></div>
          <select aria-label="Change application stage" disabled={readOnly} value={app.status} onChange={(e) => onMove(app.id, e.target.value)}>{stages.map((item) => <option key={item}>{item}</option>)}</select>
        </article>)}
        {!rows.length && <div className="column-empty">{query ? 'No matching cases' : 'Drop applications here'}</div>}</div>
      </section>
    })}</div>}
  </div>
}

function CustomersPage({ customers, query, onOpen }: { customers: Customer[]; query: string; onOpen: (id: number) => void }) {
  const [sortKey, setSortKey] = useState<'fullName' | 'phone' | 'nationality' | 'passportNumber' | 'applications'>('fullName')
  const [descending, setDescending] = useState(false)
  const [nationality, setNationality] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [columns, setColumns] = useState({ phone: true, email: true, nationality: true, passport: true, applications: true })
  const pageSize = 10
  const nationalities = [...new Set(customers.map((customer) => customer.nationality).filter(Boolean))].sort()
  const sorted = [...customers].filter((customer) => !nationality || customer.nationality === nationality).sort((a, b) => {
    const left = a[sortKey]
    const right = b[sortKey]
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' })
    return descending ? -comparison : comparison
  })
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const rows = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  function sortBy(key: typeof sortKey) {
    if (sortKey === key) setDescending((value) => !value)
    else { setSortKey(key); setDescending(false) }
  }
  function toggleColumn(key: keyof typeof columns) {
    setColumns((value) => ({ ...value, [key]: !value[key] }))
  }
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">CUSTOMER DIRECTORY</p><h1>Customers</h1><p className="subheading">{customers.length} customers{query ? ' matching your search' : ' in your local database'}.</p></div><button className="secondary-btn" onClick={() => { if (customers[0]) onOpen(customers[0].id) }} disabled={!customers.length}><Users size={16} />Customer records</button></div>
    <section className="panel customer-panel">
      <div className="list-toolbar">
        <div className="list-toolbar-summary"><span className="count-badge">{sorted.length}</span><span>{selected.size ? `${selected.size} selected` : 'Customers'}</span>{selected.size === 1 && <button className="text-btn" onClick={() => onOpen([...selected][0])}>Open selected <ArrowUpRight size={14} /></button>}{selected.size > 0 && <button className="text-btn" onClick={() => setSelected(new Set())}>Clear selection</button>}</div>
        <div className="list-toolbar-actions"><label className="filter-field"><SlidersHorizontal size={15} /><select aria-label="Filter by nationality" value={nationality} onChange={(event) => { setNationality(event.target.value); setPage(0) }}><option value="">All nationalities</option>{nationalities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <details className="column-picker"><summary className="secondary-btn small"><SlidersHorizontal size={14} />Columns</summary><div className="column-menu">{([['phone', 'Phone'], ['email', 'Email'], ['nationality', 'Nationality'], ['passport', 'Passport'], ['applications', 'Applications']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={columns[key]} onChange={() => toggleColumn(key)} />{label}</label>)}</div></details>
        </div>
      </div>
      {rows.length ? <>
        <div className="table-scroll"><table><thead><tr><th className="selection-cell"><input aria-label="Select all customers on page" type="checkbox" checked={rows.length > 0 && rows.every((row) => selected.has(row.id))} onChange={(event) => setSelected((value) => { const next = new Set(value); rows.forEach((row) => event.target.checked ? next.add(row.id) : next.delete(row.id)); return next })} /></th><th>PROFILE</th><th><button className="sort-button" onClick={() => sortBy('fullName')}>CUSTOMER</button></th>{columns.phone && <th><button className="sort-button" onClick={() => sortBy('phone')}>PHONE</button></th>}{columns.email && <th>EMAIL</th>}{columns.nationality && <th><button className="sort-button" onClick={() => sortBy('nationality')}>NATIONALITY</button></th>}{columns.passport && <th><button className="sort-button" onClick={() => sortBy('passportNumber')}>PASSPORT</button></th>}{columns.applications && <th><button className="sort-button" onClick={() => sortBy('applications')}>APPLICATIONS</button></th>}</tr></thead><tbody>{rows.map((customer) => <tr key={customer.id} onClick={() => onOpen(customer.id)}><td className="selection-cell" onClick={(event) => event.stopPropagation()}><input aria-label={`Select ${customer.fullName}`} type="checkbox" checked={selected.has(customer.id)} onChange={(event) => setSelected((value) => { const next = new Set(value); event.target.checked ? next.add(customer.id) : next.delete(customer.id); return next })} /></td><td><span className="customer-avatar">{customer.photoDataUrl ? <img src={customer.photoDataUrl} alt="" /> : customer.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span></td><td><strong>{customer.fullName}</strong><small>Customer #{String(customer.id).padStart(4, '0')}</small></td>{columns.phone && <td>{customer.phone}</td>}{columns.email && <td>{customer.email || '—'}</td>}{columns.nationality && <td>{customer.nationality || '—'}</td>}{columns.passport && <td>{customer.passportNumber || '—'}</td>}{columns.applications && <td><span className="count-badge">{customer.applications}</span></td>}</tr>)}</tbody></table></div>
        <div className="list-pagination"><span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} of {sorted.length}</span><div><button className="secondary-btn small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="secondary-btn small" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
      </> : <div className="empty-state"><div className="empty-illustration"><Users size={26} /></div><h3>No customers found</h3><p>Customers are created and matched when you add a visa application.</p></div>}
    </section>
  </div>
}

function DataPage({ customers, query, onOpen }: { customers: Customer[]; query: string; onOpen: (id: number) => void }) {
  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">CUSTOMER DATABASE</p><h1>DATA</h1><p className="subheading">Search customers by passport number, name, phone, or email.</p></div><span className="count-badge">{customers.length}</span></div>
    <section className="panel data-panel">
      {customers.length ? <div className="table-scroll"><table><thead><tr><th>PROFILE</th><th>FULL NAME</th><th>PASSPORT</th><th>NATIONALITY</th><th>PHONE</th><th>EMAIL</th><th>APPLICATIONS</th><th>LAST APPLICATION</th></tr></thead><tbody>
        {customers.map((customer) => <tr key={customer.id} onClick={() => onOpen(customer.id)}><td><span className="customer-avatar">{customer.photoDataUrl ? <img src={customer.photoDataUrl} alt="" /> : customer.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span></td><td><strong>{customer.fullName}</strong></td><td>{customer.passportNumber || '—'}</td><td>{customer.nationality || '—'}</td><td>{customer.phone}</td><td>{customer.email || '—'}</td><td><span className="count-badge">{customer.applications}</span></td><td>{customer.lastApplicationDate || '—'}</td></tr>)}
      </tbody></table></div> : <div className="empty-state"><div className="empty-illustration"><DatabaseIcon size={26} /></div><h3>{query ? 'No matching customers' : 'No customer records yet'}</h3><p>{query ? 'Try searching by passport number, name, phone, or email.' : 'Customer profiles will be created when you save an application.'}</p></div>}
    </section>
  </div>
}

function CustomerProfilePage({ customerId, readOnly, onBack, setNotice, onChanged }: { customerId: number; readOnly: boolean; onBack: () => void; setNotice: (notice: string) => void; onChanged: () => Promise<void> }) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [activityApplicationId, setActivityApplicationId] = useState<number | null>(null)
  const [activityType, setActivityType] = useState<'Internal Note' | 'Customer Call' | 'Customer Message' | 'Follow-up'>('Internal Note')
  const [activityText, setActivityText] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const nextProfile = await window.blueLine.getCustomerProfile(customerId)
      setProfile(nextProfile)
      setActivityApplicationId((current) => nextProfile.applications.some((application) => application.id === current)
        ? current
        : nextProfile.applications[0]?.id ?? null)
    }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to load customer profile.') }
    finally { setLoading(false) }
  }, [customerId, setNotice])
  useEffect(() => { void load() }, [load])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    setSaving(true)
    const data = new FormData(event.currentTarget)
    try {
      await window.blueLine.updateCustomer(customerId, {
        fullName: joinName(String(data.get('firstName') ?? ''), String(data.get('surname') ?? '')),
        passportNumber: String(data.get('passportNumber') ?? ''),
        dateOfBirth: String(data.get('dateOfBirth') ?? ''),
        nationality: String(data.get('nationality') ?? ''),
        gender: String(data.get('gender') ?? ''),
        phone: String(data.get('phone') ?? ''),
        email: String(data.get('email') ?? ''),
        address: String(data.get('address') ?? ''),
        passportIssueDate: String(data.get('passportIssueDate') ?? ''),
        passportExpiryDate: String(data.get('passportExpiryDate') ?? '')
      })
      setEditing(false)
      setNotice('Customer profile saved.')
      await Promise.all([load(), onChanged()])
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to save customer profile.') }
    finally { setSaving(false) }
  }

  async function changePhoto() {
    try {
      const photoDataUrl = await window.blueLine.setCustomerPhoto(customerId)
      if (photoDataUrl && profile) setProfile({ ...profile, customer: { ...profile.customer, photoDataUrl } })
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to update profile photo.') }
  }
  async function uploadDocument() {
    try {
      const doc = await window.blueLine.uploadCustomerDocument(customerId)
      if (doc) { setNotice(`${doc.fileName} added to customer files.`); await load() }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to upload customer document.') }
  }
  async function addActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (activityApplicationId === null) return
    setSavingActivity(true)
    try {
      await window.blueLine.addApplicationActivity(activityApplicationId, { activityType, description: activityText })
      setActivityText('')
      setNotice('Customer activity saved.')
      await load()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to save customer activity.')
    } finally { setSavingActivity(false) }
  }

  if (loading) return <div className="page-stack"><div className="loading-panel"><span /><span /><span /></div></div>
  if (!profile) return <div className="page-stack"><button className="secondary-btn" onClick={onBack}>Back to DATA</button><div className="notice-banner">Customer profile is not available.</div></div>
  const customer = profile.customer
  function showRelatedRecords(section: string) {
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return <div className="page-stack customer-profile-page">
    <div className="customer-profile-heading">
      <button className="profile-back" onClick={onBack}><ChevronRight size={15} />Back to customers</button>
      <div className="customer-identity">
        <div className="customer-profile-photo">{customer.photoDataUrl ? <img src={customer.photoDataUrl} alt={`${customer.fullName} profile`} /> : <span>{customer.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>}{!readOnly && <span className="photo-edit" onClick={() => void changePhoto()}><Camera size={14} /></span>}</div>
        <div className="customer-identity-copy"><p className="eyebrow">CUSTOMER PROFILE</p><h1>{customer.fullName}</h1><div className="customer-identity-meta"><span>Customer #{String(customer.id).padStart(4, '0')}</span><span className="identity-divider" /><span>Since {new Date(customer.createdAt).toLocaleDateString()}</span>{customer.nationality && <><span className="identity-divider" /><span>{customer.nationality}</span></>}</div></div>
        {!readOnly && <button className="primary-btn profile-edit-btn" onClick={() => setEditing((value) => !value)}><Pencil size={15} />{editing ? 'Cancel editing' : 'Edit profile'}</button>}
      </div>
    </div>
    <div className="smart-buttons" aria-label="Related customer records">
      <button onClick={() => showRelatedRecords('customer-applications')}><span className="smart-button-icon applications"><BriefcaseBusiness size={18} /></span><span><strong>Applications</strong><small>{profile.applications.length} linked records</small></span><b>{profile.applications.length}</b><ChevronRight size={15} /></button>
      <button onClick={() => showRelatedRecords('customer-documents')}><span className="smart-button-icon documents"><Files size={18} /></span><span><strong>Documents</strong><small>{profile.documents.length} files</small></span><b>{profile.documents.length}</b><ChevronRight size={15} /></button>
      <button onClick={() => showRelatedRecords('customer-activity')}><span className="smart-button-icon history"><CalendarClock size={18} /></span><span><strong>Activity</strong><small>{profile.activities.length} updates</small></span><b>{profile.activities.length}</b><ChevronRight size={15} /></button>
    </div>
    <div className="customer-profile-grid">
      <section className="panel customer-personal">
        <div className="profile-section-title"><div><span className="profile-section-icon"><ContactRound size={17} /></span><div><h2>Contact information</h2><p>Personal and passport details</p></div></div>{!readOnly && !editing && <button className="text-btn" onClick={() => setEditing(true)}><Pencil size={13} />Edit</button>}</div>
        {editing ? <form className="profile-form" onSubmit={(event) => void save(event)}>
          <div className="profile-field-section"><h3>Personal details</h3><div className="profile-fields-grid">
            <Field label="First name" name="firstName" required defaultValue={splitName(customer.fullName)[0]} />
            <Field label="Surname" name="surname" required defaultValue={splitName(customer.fullName)[1]} />
            <Field label="Phone number" name="phone" required defaultValue={customer.phone} />
            <Field label="Email address" name="email" type="email" defaultValue={customer.email} />
            <Field label="Nationality" name="nationality" defaultValue={customer.nationality} />
            <label className="field"><span>Gender</span><select name="gender" defaultValue={customer.gender || ''}><option value="">Not specified</option><option>Female</option><option>Male</option><option>Unspecified</option></select></label>
            <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={customer.dateOfBirth} />
            <Field label="Address" name="address" defaultValue={customer.address} />
          </div></div>
          <div className="profile-field-section"><h3>Passport details</h3><div className="profile-fields-grid">
            <Field label="Passport number" name="passportNumber" defaultValue={customer.passportNumber} />
            <Field label="Passport issue date" name="passportIssueDate" type="date" defaultValue={customer.passportIssueDate} />
            <Field label="Passport expiry date" name="passportExpiryDate" type="date" defaultValue={customer.passportExpiryDate} />
          </div></div>
          <div className="profile-form-actions"><button type="button" className="secondary-btn" onClick={() => setEditing(false)}>Discard</button><button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : <><Check size={15} />Save changes</>}</button></div>
        </form> : <div className="profile-info-sections">
          <section className="profile-info-section"><h3>Contact details</h3><dl className="profile-details">
            {[['Phone', customer.phone, 'phone'], ['Email', customer.email, 'email'], ['Address', customer.address, 'address']].map(([label, value, kind]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}{value && kind === 'phone' && <a className="profile-inline-action" href={`tel:${value}`} aria-label={`Call ${customer.fullName}`}><Phone size={13} /></a>}{value && kind === 'email' && <a className="profile-inline-action" href={`mailto:${value}`} aria-label={`Email ${customer.fullName}`}><Mail size={13} /></a>}</dd></div>)}
          </dl></section>
          <section className="profile-info-section"><h3>Passport details</h3><dl className="profile-details">
            {[['Passport number', customer.passportNumber], ['Nationality', customer.nationality], ['Date of birth', customer.dateOfBirth], ['Gender', customer.gender], ['Issue date', customer.passportIssueDate], ['Expiry date', customer.passportExpiryDate]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
          </dl></section>
        </div>}
      </section>
      <div className="customer-history">
        <section className="panel" id="customer-applications"><div className="panel-heading"><div><h2>Application history</h2><p>{profile.applications.length} application(s) linked to this customer</p></div></div>
          {profile.applications.length ? <div className="table-scroll"><table><thead><tr><th>APPLICATION</th><th>DESTINATION</th><th>VISA TYPE</th><th>STATUS</th><th>CREATED</th></tr></thead><tbody>{profile.applications.map((application) => <tr key={application.id}><td><strong className="app-id">{application.applicationId}</strong></td><td>{application.country}</td><td>{application.visaType}</td><td><StatusPill value={application.status} /></td><td>{application.applicationDate}</td></tr>)}</tbody></table></div> : <div className="empty-inline"><BriefcaseBusiness size={20} /><p>No applications linked yet.</p></div>}
        </section>
        <section className="panel" id="customer-documents"><div className="panel-heading"><div><h2>Customer documents</h2><p>Passport scans and supporting files</p></div>{!readOnly && <button className="secondary-btn small" onClick={() => void uploadDocument()}><Upload size={14} />Upload</button>}</div>
          {profile.documents.length ? <div className="document-list">{profile.documents.map((document) => <button className="document-row" key={`${document.storage}-${document.id}`} onClick={() => void window.blueLine.openCustomerDocument(document.id).catch((error: Error) => setNotice(error.message))}><span className="file-icon"><Files size={16} /></span><span className="document-name"><strong>{document.fileName}</strong><small>{document.category} · {new Date(document.addedAt).toLocaleDateString()}</small></span><ArrowUpRight size={15} /></button>)}</div> : <div className="empty-inline"><Files size={20} /><p>No customer documents have been uploaded.</p></div>}
        </section>
        <section className="panel activity-panel" id="customer-activity"><div className="panel-heading"><div><h2>Customer activity</h2><p>Chronological history across linked visa applications</p></div><span className="count-badge">{profile.activities.length}</span></div>
          {profile.applications.length > 0 && !readOnly && <form className="activity-composer customer-activity-composer" onSubmit={(event) => void addActivity(event)}>
            {profile.applications.length > 1 && <label className="field"><span>Related application</span><select value={activityApplicationId ?? ''} onChange={(event) => setActivityApplicationId(Number(event.target.value))}>{profile.applications.map((application) => <option key={application.id} value={application.id}>{application.applicationId} · {application.country}</option>)}</select></label>}
            <label className="field"><span>Activity type</span><select value={activityType} onChange={(event) => setActivityType(event.target.value as typeof activityType)}><option>Internal Note</option><option>Customer Call</option><option>Customer Message</option><option>Follow-up</option></select></label>
            <label className="field"><span>Log a customer update</span><textarea rows={2} maxLength={2000} required value={activityText} onChange={(event) => setActivityText(event.target.value)} placeholder="Write a note or summarize a customer conversation…" /></label>
            <div className="composer-foot"><small>Saved to the selected application’s activity log</small><button className="primary-btn small" disabled={savingActivity || activityApplicationId === null || !activityText.trim()}>{savingActivity ? 'Saving…' : 'Post update'}</button></div>
          </form>}
          {profile.activities.length ? <div className="activity-list">{profile.activities.map((activity) => <article className="activity-item" key={activity.id}><span className="activity-mark"><CalendarClock size={14} /></span><div className="activity-content"><div className="activity-meta"><strong>{activity.activityType}</strong><span>{activity.applicationId}</span><time>{new Date(`${activity.createdAt.replace(' ', 'T')}Z`).toLocaleString()}</time></div><p>{activity.description}</p><small>By {activity.createdBy}</small></div></article>)}</div> : <div className="empty-inline"><CalendarClock size={20} /><p>Application activity will appear here as work progresses.</p></div>}
        </section>
      </div>
    </div>
  </div>
}

function ScannerPage({ apps, canUseDocuments, setNotice }: { apps: Application[]; canUseDocuments: boolean; setNotice: (message: string) => void }) {
  const [selected, setSelected] = useState<number | null>(apps[0]?.id ?? null)
  const [documents, setDocuments] = useState<Array<{ id: number; fileName: string; category: string; addedAt: string }>>([])
  const [scanText, setScanText] = useState('')
  const [scanning, setScanning] = useState(false)
  useEffect(() => {
    if (!apps.some((application) => application.id === selected)) setSelected(apps[0]?.id ?? null)
  }, [apps, selected])
  useEffect(() => {
    if (selected === null || !canUseDocuments) { setDocuments([]); return }
    void window.blueLine.listDocuments(selected).then(setDocuments).catch((error: Error) => setNotice(error.message))
  }, [selected, canUseDocuments, setNotice])
  const current = apps.find((item) => item.id === selected)
  return <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">DOCUMENT WORKSPACE</p><h1>Smart Scanner</h1><p className="subheading">Keep passport and visa scans attached to the right application.</p></div></div>
    <div className="scanner-grid"><section className="panel scanner-upload"><div className="panel-heading"><div><h2>Application documents</h2><p>Files are stored in the workspace.</p></div><Files size={18} className="muted-icon" /></div>
      {canUseDocuments && apps.length > 0 ? <><label className="field"><span>Select application</span><select value={selected ?? ''} onChange={(e) => setSelected(Number(e.target.value))}>{apps.map((app) => <option key={app.id} value={app.id}>{app.applicationId} — {app.customerName}</option>)}</select></label>
        <div className="upload-target"><div className="upload-icon"><ArrowDownToLine size={22} /></div><h3>Upload a document</h3><p>PDF, JPG, JPEG, or PNG · Max 25 MB</p><button className="secondary-btn" onClick={async () => {
          if (!selected) return
          try { const item = await window.blueLine.uploadDocument(selected); if (item) { setDocuments((currentDocs) => [item, ...currentDocs]); setNotice(`${item.fileName} uploaded successfully.`) } }
          catch (error) { setNotice(error instanceof Error ? error.message : 'Document upload failed.') }
        }}>Choose file</button></div>
      </> : <div className="empty-inline"><Files size={22} /><p>{canUseDocuments ? 'Create an application before uploading its documents.' : 'Documents or Visa Pipeline permission is required for application files.'}</p></div>}
        <div className="scan-action"><button className="secondary-btn" disabled={scanning} onClick={async () => {
          setScanning(true)
          try { const result = await window.blueLine.scanPassport(); if (result) { setScanText(result.text); setNotice(`Offline scan completed for ${result.fileName}. Review the extracted text before using it.`) } }
          catch (error) { setNotice(error instanceof Error ? error.message : 'Offline OCR scan failed.') }
          finally { setScanning(false) }
        }}><FileSearch size={16} />{scanning ? 'Scanning locally…' : 'Scan passport image offline'}</button><small>English + Arabic OCR · image files</small></div>
    </section>
    <section className="panel"><div className="panel-heading"><div><h2>Attached files</h2><p>{current ? `${current.applicationId} · ${current.customerName}` : 'Select an application'}</p></div><span className="count-badge">{documents.length}</span></div>
      {documents.length ? <div className="document-list">{documents.map((doc) => <button className="document-row" key={doc.id} onClick={() => void window.blueLine.openDocument(doc.id).catch((error: Error) => setNotice(error.message))}><span className="file-icon"><Files size={17} /></span><span className="document-name"><strong>{doc.fileName}</strong><small>{doc.category} · {new Date(doc.addedAt).toLocaleDateString()}</small></span><ArrowUpRight size={15} /></button>)}</div>
      : <div className="empty-inline"><FileSearch size={22} /><p>No files attached to this application yet.</p></div>}
    </section></div>
    {scanText && <section className="panel extracted-panel"><div className="panel-heading"><div><h2>Review passport scan</h2><p>Offline OCR output is not saved to customer records automatically.</p></div><button className="icon-btn" onClick={() => setScanText('')}><X size={16} /></button></div>
      {(() => {
        const mrz = parsePassportMrz(scanText)
        if (!mrz) return <div className="scan-text"><div className="notice-banner"><CircleAlert size={16} /><span>No valid TD3 passport MRZ was found. Check the original document and enter details manually.</span></div><pre>{scanText}</pre></div>
        const fields: Array<[string, string]> = [['Full name', mrz.fullName], ['Passport number', mrz.passportNumber], ['Nationality', mrz.nationality], ['Date of birth', mrz.dateOfBirth], ['Gender', mrz.gender], ['Passport expiry', mrz.expiryDate]]
        return <div className="scan-review"><div className={`notice-banner ${mrz.checkDigitsValid ? 'valid' : ''}`}><CircleAlert size={16} /><span>{mrz.checkDigitsValid ? 'MRZ check digits are valid. Confirm every value against the original passport.' : 'One or more MRZ check digits are invalid. Verify every value against the original passport.'}</span></div><div className="form-grid">{fields.map(([label, value]) => <label className="field" key={label}><span>{label}</span><input defaultValue={value} /></label>)}</div></div>
      })()}
    </section>}
    <div className="notice-banner"><CircleAlert size={17} /><span>Local OCR currently supports English and Arabic text on passport images. MRZ review supports TD3-format passports only. Visa layout extraction and automated document-to-application matching are not available yet.</span></div>
  </div>
}

function ReportsPage({ stats, apps, onExport }: { stats: Dashboard | null; apps: Application[]; onExport: () => void }) {
  const approved = stats?.byStatus.Approved ?? 0
  const rejected = stats?.byStatus.Rejected ?? 0
  return <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">BUSINESS INSIGHTS</p><h1>Reports</h1><p className="subheading">Operational summaries calculated from local SQLite records.</p></div><button className="secondary-btn" onClick={onExport}><ArrowDownToLine size={16} />Export CSV</button></div>
    <div className="report-stats"><div className="report-stat"><small>Total applications</small><strong>{stats?.total ?? 0}</strong></div><div className="report-stat"><small>Approved</small><strong className="success-text">{approved}</strong></div><div className="report-stat"><small>Rejected</small><strong className="danger-text">{rejected}</strong></div><div className="report-stat"><small>Approval rate</small><strong>{approved + rejected ? `${Math.round(approved / (approved + rejected) * 100)}%` : '—'}</strong></div></div>
    <div className="report-grid"><section className="panel"><div className="panel-heading"><div><h2>Applications by stage</h2><p>Current pipeline distribution</p></div></div><div className="report-bars">{STAGES.map((stage) => <div className="report-bar-row" key={stage}><span>{stage}</span><div className="bar-track"><span style={{ width: `${Math.min(100, (stats?.byStatus[stage] ?? 0) / Math.max(stats?.total ?? 1, 1) * 100)}%` }} /></div><b>{stats?.byStatus[stage] ?? 0}</b></div>)}</div></section>
      <section className="panel"><div className="panel-heading"><div><h2>Destination countries</h2><p>Active applications by destination</p></div></div>{stats?.countries.length ? <div className="country-list">{stats.countries.map((row) => <div className="country-row" key={row.country}><div className="country-label"><span>{row.country}</span><b>{row.count}</b></div><div className="bar-track"><span style={{ width: `${row.count / Math.max(...stats.countries.map((item) => item.count)) * 100}%` }} /></div></div>)}</div> : <p className="chart-empty">Country data will appear when applications are added.</p>}</section></div>
    <p className="report-footnote">Showing {apps.length} locally stored application records. Monthly trends and date-range filters are not yet available.</p>
  </div>
}

function ApplicationDetailsModal({ application, onClose, onSave, onDelete, onCustomerOpen, onNotice }: {
  application: Application | null
  onClose: () => void
  onSave: (application: NewApplication) => void
  onDelete: () => void
  onCustomerOpen: (customerId: number) => void
  onNotice: (message: string) => void
}) {
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null)
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [activities, setActivities] = useState<ApplicationActivity[]>([])
  const [activityType, setActivityType] = useState<'Internal Note' | 'Customer Call' | 'Customer Message' | 'Follow-up'>('Internal Note')
  const [activityText, setActivityText] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  useEffect(() => {
    if (!application) return
    let active = true
    void Promise.all([
      window.blueLine.getCustomerProfile(application.customerId),
      window.blueLine.listDocuments(application.id),
      window.blueLine.listApplicationActivities(application.id)
    ]).then(([profile, appDocuments, history]) => {
      if (!active) return
      setCustomerProfile(profile)
      setDocuments(appDocuments)
      setActivities(history)
    }).catch((error: unknown) => {
      if (active) onNotice(error instanceof Error ? error.message : 'Unable to load application details.')
    })
    return () => { active = false }
  }, [application, onNotice])

  if (!application) return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>Application is no longer available</h2><button className="icon-btn" onClick={onClose}><X size={17} /></button></div></div></div>
  const applicationRecordId = application.id
  const [customerFirstName, customerSurname] = splitName(customerProfile?.customer.fullName ?? application.customerName)
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    onSave({
      fullName: joinName(String(data.get('firstName') ?? ''), String(data.get('surname') ?? '')),
      phone: String(data.get('phone') ?? ''),
      email: String(data.get('email') ?? ''),
      nationality: String(data.get('nationality') ?? ''),
      passportNumber: String(data.get('passportNumber') ?? ''),
      country: String(data.get('country') ?? ''),
      visaType: String(data.get('visaType') ?? ''),
      employee: String(data.get('employee') ?? ''),
      followUpDate: String(data.get('followUpDate') ?? '')
    })
  }
  async function addActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingActivity(true)
    try {
      await window.blueLine.addApplicationActivity(applicationRecordId, { activityType, description: activityText })
      setActivityText('')
      setActivities(await window.blueLine.listApplicationActivities(applicationRecordId))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Unable to save activity.')
    } finally { setSavingActivity(false) }
  }
  function scrollTo(section: string) {
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="modal record-modal">
      <div className="modal-head"><div><p className="eyebrow">{application.applicationId} · {application.applicationDate}</p><h2>Application details</h2></div><button type="button" className="icon-btn" aria-label="Close application" onClick={onClose}><X size={18} /></button></div>
      <div className="smart-buttons record-smart-buttons">
        <button onClick={() => onCustomerOpen(application.customerId)}><ContactRound size={17} /><span><strong>Customer profile</strong><small>{application.customerName}</small></span><ChevronRight size={15} /></button>
        <button onClick={() => scrollTo('application-documents')}><Files size={17} /><span><strong>Documents</strong><small>{documents.length} attached</small></span><ChevronRight size={15} /></button>
        <button onClick={() => scrollTo('application-activity')}><CalendarClock size={17} /><span><strong>Activity log</strong><small>{activities.length} updates</small></span><ChevronRight size={15} /></button>
      </div>
      <div className="record-modal-grid">
        <div className="record-main">
          <section className="record-section"><div className="record-section-heading"><h3>Visa application</h3><StatusPill value={application.status} /></div>
            <form onSubmit={submit}>
              <div className="form-grid">
                <Field label="First name" name="firstName" required defaultValue={customerFirstName} />
                <Field label="Surname" name="surname" required defaultValue={customerSurname} />
                <Field label="Phone" name="phone" required defaultValue={application.phone} />
                <Field label="Destination country" name="country" required defaultValue={application.country} />
                <Field label="Visa type" name="visaType" required defaultValue={application.visaType} />
                <Field label="Assigned employee" name="employee" defaultValue={application.employee} />
                <Field label="Follow-up date" name="followUpDate" type="date" defaultValue={application.followUpDate ?? ''} />
              </div>
              <div className="passport-details"><h3>Passport information</h3>{customerProfile ? <dl>{[
                ['Passport number', customerProfile.customer.passportNumber],
                ['Nationality', customerProfile.customer.nationality],
                ['Date of birth', customerProfile.customer.dateOfBirth],
                ['Issued', customerProfile.customer.passportIssueDate],
                ['Expires', customerProfile.customer.passportExpiryDate]
              ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl> : <div className="loading-panel"><span /><span /></div>}</div>
              <div className="modal-foot"><button type="button" className="secondary-btn danger-btn" onClick={onDelete}><Trash2 size={15} />Delete application</button><button className="primary-btn">Save changes</button></div>
            </form>
          </section>
          <section className="record-section" id="application-documents"><div className="record-section-heading"><div><h3>Uploaded documents</h3><p>Files linked to this application</p></div><span className="count-badge">{documents.length}</span></div>
            {documents.length ? <div className="document-list">{documents.map((document) => <button className="document-row" key={document.id} onClick={() => void window.blueLine.openDocument(document.id).catch((error: Error) => onNotice(error.message))}><span className="file-icon"><Files size={16} /></span><span className="document-name"><strong>{document.fileName}</strong><small>{document.category} · {new Date(document.addedAt).toLocaleDateString()}</small></span><ArrowUpRight size={15} /></button>)}</div> : <div className="empty-inline"><Files size={20} /><p>No documents have been uploaded.</p></div>}
          </section>
        </div>
        <section className="record-section chatter-section" id="application-activity">
          <div className="record-section-heading"><div><h3>Chatter</h3><p>Notes and customer touchpoints</p></div></div>
          <form className="activity-composer" onSubmit={(event) => void addActivity(event)}><label className="field"><span>Activity type</span><select value={activityType} onChange={(event) => setActivityType(event.target.value as typeof activityType)}><option>Internal Note</option><option>Customer Call</option><option>Customer Message</option><option>Follow-up</option></select></label><label className="field"><span>Log an update</span><textarea rows={3} maxLength={2000} required value={activityText} onChange={(event) => setActivityText(event.target.value)} placeholder="Write a note or summarize the conversation…" /></label><div className="composer-foot"><small>{activityText.length}/2000</small><button className="primary-btn small" disabled={savingActivity || !activityText.trim()}>{savingActivity ? 'Saving…' : 'Post'}</button></div></form>
          <div className="activity-list">{activities.map((activity) => <article className="activity-item" key={activity.id}><span className="activity-mark"><CalendarClock size={14} /></span><div className="activity-content"><div className="activity-meta"><strong>{activity.activityType}</strong><time>{new Date(`${activity.createdAt.replace(' ', 'T')}Z`).toLocaleString()}</time></div><p>{activity.description}</p><small>By {activity.createdBy}</small></div></article>)}{!activities.length && <div className="empty-inline"><CalendarClock size={18} /><p>No activity recorded yet.</p></div>}</div>
        </section>
      </div>
    </div>
  </div>
}

function CatalogManager({ kind, title, canManage = true, onNotice }: { kind: 'visaType' | 'country'; title: string; canManage?: boolean; onNotice: (message: string) => void }) {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const load = useCallback(async () => {
    try { setItems(await window.blueLine.listCatalog(kind)) }
    catch (error) { onNotice(error instanceof Error ? error.message : `Unable to load ${title.toLowerCase()}.`) }
    finally { setLoading(false) }
  }, [kind, onNotice, title])
  useEffect(() => { void load() }, [load])
  async function save(item: { id?: number; name: string; active: boolean }) {
    try { await window.blueLine.saveCatalogItem(kind, item); await load() }
    catch (error) { onNotice(error instanceof Error ? error.message : `Unable to save ${title.toLowerCase()}.`) }
  }
  async function remove(item: CatalogItem) {
    if (!window.confirm(`Delete "${item.name}"? Items used by applications cannot be removed; disable them instead.`)) return
    try { await window.blueLine.deleteCatalogItem(kind, item.id); setSelected((value) => { const next = new Set(value); next.delete(item.id); return next }); await load() }
    catch (error) { onNotice(error instanceof Error ? error.message : `Unable to delete ${title.toLowerCase()}.`) }
  }
  const filteredItems = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())
    && (activeFilter === 'all' || item.active === (activeFilter === 'active'))).sort((a, b) => a.name.localeCompare(b.name))
  const pageSize = 10
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageItems = filteredItems.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  async function setSelectedActive(active: boolean) {
    try {
      for (const item of filteredItems.filter((candidate) => selected.has(candidate.id))) {
        await window.blueLine.saveCatalogItem(kind, { ...item, active })
      }
      setSelected(new Set())
      await load()
      onNotice(`${selected.size} ${title.toLowerCase()} updated.`)
    } catch (error) { onNotice(error instanceof Error ? error.message : `Unable to update selected ${title.toLowerCase()}.`) }
  }
  return <section className="panel settings-panel catalog-manager"><div className="settings-title"><div className="settings-icon"><ClipboardList size={18} /></div><div><h2>{title}</h2><p>Manage the active choices shown in new applications.</p></div></div>
    <form className="catalog-add" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; void save({ name, active: true }).then(() => setName('')) }}><input aria-label={`New ${title.toLowerCase()}`} value={name} onChange={(event) => setName(event.target.value)} placeholder={`Add ${title.toLowerCase()}`} /><button className="secondary-btn small"><Plus size={14} />Add</button></form>
    {loading ? <div className="loading-panel"><span /><span /></div> : <>
      <div className="list-toolbar catalog-toolbar"><div className="list-toolbar-summary"><span className="count-badge">{filteredItems.length}</span><span>{selected.size ? `${selected.size} selected` : title}</span></div><div className="list-toolbar-actions"><label className="catalog-search"><Search size={14} /><input aria-label={`Search ${title.toLowerCase()}`} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); setSelected(new Set()) }} placeholder={`Search ${title.toLowerCase()}`} /></label>{canManage && <><select aria-label={`Filter ${title.toLowerCase()} by status`} value={activeFilter} onChange={(event) => { setActiveFilter(event.target.value as typeof activeFilter); setPage(0); setSelected(new Set()) }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>{selected.size > 0 && <><button className="secondary-btn small" onClick={() => void setSelectedActive(false)}>Disable selected</button><button className="secondary-btn small" onClick={() => void setSelectedActive(true)}>Enable selected</button></>}</>}</div></div>
      {pageItems.length ? <><div className="table-scroll"><table><thead><tr>{canManage && <th className="selection-cell"><input aria-label={`Select all ${title.toLowerCase()} on page`} type="checkbox" checked={pageItems.length > 0 && pageItems.every((item) => selected.has(item.id))} onChange={(event) => setSelected((value) => { const next = new Set(value); pageItems.forEach((item) => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next })} /></th>}<th>NAME</th><th>STATUS</th>{canManage && <th />}</tr></thead><tbody>{pageItems.map((item) => <tr key={item.id}>{canManage && <td className="selection-cell"><input aria-label={`Select ${item.name}`} type="checkbox" checked={selected.has(item.id)} onChange={(event) => setSelected((value) => { const next = new Set(value); event.target.checked ? next.add(item.id) : next.delete(item.id); return next })} /></td>}<td><strong>{item.name}</strong></td><td><span className={`status-pill ${item.active ? 'green' : 'gray'}`}><i />{item.active ? 'Active' : 'Inactive'}</span></td>{canManage && <td><button className="mini-icon" aria-label={`Delete ${item.name}`} onClick={() => void remove(item)}><Trash2 size={15} /></button></td>}</tr>)}</tbody></table></div><div className="list-pagination"><span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filteredItems.length)} of {filteredItems.length}</span><div><button className="secondary-btn small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="secondary-btn small" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div></div></> : <div className="empty-inline"><ClipboardList size={20} /><p>No matching {title.toLowerCase()}.</p></div>}
    </>}
  </section>
}

function PipelineManager({ pipelines, onChanged, onNotice }: { pipelines: Pipeline[]; onChanged: () => Promise<void>; onNotice: (message: string) => void }) {
  const [editing, setEditing] = useState<Pipeline | null>(null)
  const [name, setName] = useState('')
  const [stages, setStages] = useState('')
  const [saving, setSaving] = useState(false)
  function startEdit(pipeline?: Pipeline) {
    setEditing(pipeline ?? null)
    setName(pipeline?.name ?? '')
    setStages((pipeline?.stages ?? []).join('\n'))
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      await window.blueLine.savePipeline({ id: editing?.id, name, stages: stages.split(/\r?\n/).map((stage) => stage.trim()).filter(Boolean) })
      setEditing(null)
      await onChanged()
      onNotice('Pipeline saved.')
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Unable to save pipeline.') }
    finally { setSaving(false) }
  }
  async function remove(pipeline: Pipeline) {
    if (!window.confirm(`Delete pipeline "${pipeline.name}"? Its ${pipeline.applications} application(s) will be moved to the default pipeline's first stage. Customer profiles and uploaded files will be preserved.`)) return
    try { await window.blueLine.deletePipeline(pipeline.id); await onChanged(); onNotice('Pipeline deleted; applications and files were preserved.') }
    catch (error) { onNotice(error instanceof Error ? error.message : 'Unable to delete pipeline.') }
  }
  return <section className="panel settings-panel pipeline-manager"><div className="settings-title"><div className="settings-icon"><BriefcaseBusiness size={18} /></div><div><h2>Pipelines and stages</h2><p>Manage workflow names, stages, order, and application assignment.</p></div><button className="secondary-btn small" onClick={() => startEdit()}><Plus size={14} />New pipeline</button></div>
    {editing !== null && <form className="pipeline-editor" onSubmit={(event) => void save(event)}><label className="field"><span>Pipeline name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Stages (one per line; line order controls stage order)</span><textarea rows={5} value={stages} onChange={(event) => setStages(event.target.value)} /></label><div className="pipeline-editor-actions"><button type="button" className="secondary-btn small" onClick={() => setEditing(null)}>Cancel</button><button className="primary-btn small" disabled={saving}>{saving ? 'Saving…' : 'Save pipeline'}</button></div></form>}
    <div className="pipeline-list">{pipelines.map((pipeline) => <div className="pipeline-row" key={pipeline.id}><div><strong>{pipeline.name}</strong><small>{pipeline.stages.length} stages · {pipeline.applications} applications</small><div className="stage-chips">{pipeline.stages.map((stage) => <span key={stage}>{stage}</span>)}</div></div><button className="mini-icon" aria-label={`Edit ${pipeline.name}`} onClick={() => startEdit(pipeline)}><Pencil size={15} /></button><button className="mini-icon" aria-label={`Delete ${pipeline.name}`} disabled={pipeline.id === 1} onClick={() => void remove(pipeline)}><Trash2 size={15} /></button></div>)}</div>
  </section>
}

function SettingsPage({ company, language, officeClient, canManageUsers, currentUserId, onUserUpdated, onSave, onBackup, logo, onLogoChanged, pipelines, onConfigurationChanged, setNotice }: {
  company: string
  language: Language
  officeClient: boolean
  canManageUsers: boolean
  currentUserId: number
  onUserUpdated: (user: AuthUser) => void
  onSave: (name: string, language: Language) => Promise<void>
  onBackup: () => void
  logo: string | null
  onLogoChanged: (logo: string | null) => void
  pipelines: Pipeline[]
  onConfigurationChanged: () => Promise<void>
  setNotice: (message: string) => void
}) {
  const [name, setName] = useState(company)
  const [lang, setLang] = useState(language)
  useEffect(() => { setName(company); setLang(language) }, [company, language])
  async function changeLogo() {
    try { const next = await window.blueLine.setCompanyLogo(); if (next) onLogoChanged(next) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to update the company logo.') }
  }
  async function removeLogo() {
    if (!window.confirm('Remove the uploaded company logo and restore the original Blue Line branding?')) return
    try { await window.blueLine.removeCompanyLogo(); onLogoChanged(null) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to remove the company logo.') }
  }
  return <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1><p className="subheading">Configure this Blue Line workspace.</p></div></div>
    <section className="panel settings-panel"><div className="settings-title"><div className="settings-icon"><Settings size={19} /></div><div><h2>General</h2><p>Company details and interface preferences.</p></div></div>
      <div className="settings-fields"><label className="field"><span>Company name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label><label className="field"><span>Application language</span><select value={lang} onChange={(e) => setLang(e.target.value as Language)}><option value="en">English</option><option value="ar">العربية</option></select></label></div>
      <div className="settings-actions"><button className="secondary-btn" onClick={() => void onSave(name, lang)}>Save preferences</button></div>
    </section>
    <section className="panel settings-panel"><div className="settings-title"><div className="settings-icon"><Camera size={19} /></div><div><h2>Company branding</h2><p>Your logo appears in navigation and the application header.</p></div></div>
      <div className="branding-preview">{logo ? <img src={logo} alt="Company logo preview" /> : <div className="brand-mark"><span>BL</span></div>}<div><strong>{name || 'Blue Line Travel'}</strong><small>{logo ? 'Custom logo' : 'Original Blue Line branding'}</small></div></div>
      <div className="settings-actions"><button className="secondary-btn" onClick={() => void changeLogo()}><Upload size={15} />{logo ? 'Replace logo' : 'Upload logo'}</button>{logo && <button className="secondary-btn danger-btn" onClick={() => void removeLogo()}><Trash2 size={15} />Remove logo</button>}</div>
    </section>
    {canManageUsers && <ApplicationUsersManager currentUserId={currentUserId} onUserUpdated={onUserUpdated} setNotice={setNotice} />}
    <CatalogManager kind="visaType" title="Visa types" onNotice={setNotice} />
    <CatalogManager kind="country" title="Countries" onNotice={setNotice} />
    <PipelineManager pipelines={pipelines} onChanged={onConfigurationChanged} onNotice={setNotice} />
    <section className="panel settings-panel"><div className="settings-title"><div className="settings-icon"><ShieldCheck size={19} /></div><div><h2>Data and backup</h2><p>{officeClient ? 'Backups contain sensitive data and are saved here. An administrator must unlock Human Resources first.' : 'Data is stored in this Windows user account’s application data folder.'}</p></div></div>{!officeClient && <div className="storage-path">Database: <code>%APPDATA%\BlueLineVisaCRM\database\blueline.db</code></div>}<div className="settings-actions">{!officeClient || canManageUsers ? <button className="secondary-btn" onClick={onBackup}><ArrowDownToLine size={16} />{officeClient ? 'Create workspace backup' : 'Create database backup'}</button> : <small>Only an administrator can create a shared backup.</small>}</div></section>
    <section className="panel settings-panel"><div className="settings-title"><div className="settings-icon"><BriefcaseBusiness size={19} /></div><div><h2>About</h2><p>Blue Line Visa CRM · Version 1.0.0</p></div></div></section>
  </div>
}

function ApplicationUsersManager({ currentUserId, onUserUpdated, setNotice }: {
  currentUserId: number
  onUserUpdated: (user: AuthUser) => void
  setNotice: (message: string) => void
}) {
  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<AuthUser['role']>('visa')
  const [permissions, setPermissions] = useState<AppModule[]>(defaultModulesForRole('visa'))
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  async function refreshUsers() {
    try {
      setUsers(await window.blueLine.applicationUsers.list())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to load application users.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void refreshUsers() }, [])

  function startCreate() {
    setEditingUser(null)
    setUsername('')
    setDisplayName('')
    setRole('visa')
    setPermissions(defaultModulesForRole('visa'))
    setPassword('')
    setEditorOpen(true)
  }
  function startEdit(user: AuthUser) {
    setEditingUser(user)
    setUsername(user.username)
    setDisplayName(user.displayName)
    setRole(user.role)
    setPermissions(user.permissions)
    setPassword('')
    setEditorOpen(true)
  }
  function closeEditor() {
    if (saving) return
    setEditorOpen(false)
    setEditingUser(null)
  }
  async function saveUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const details = {
        username, displayName, role, permissions,
        ...(password ? { password } : {})
      }
      const saved = editingUser
        ? await window.blueLine.applicationUsers.update({ ...details, id: editingUser.id })
        : await window.blueLine.applicationUsers.create({ ...details, password })
      if (saved.id === currentUserId) onUserUpdated(saved)
      setEditorOpen(false)
      setEditingUser(null)
      setNotice(editingUser ? 'Application user updated.' : 'Application user added.')
      await refreshUsers()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to save application user.')
    } finally {
      setSaving(false)
    }
  }
  async function removeUser(user: AuthUser) {
    if (user.id === currentUserId) return
    if (!window.confirm(`Delete the application user "${user.displayName}"? Any assigned employee profile will become unassigned.`)) return
    try {
      await window.blueLine.applicationUsers.delete(user.id)
      setNotice('Application user deleted.')
      await refreshUsers()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to delete application user.')
    }
  }

  return <>
    <section className="panel settings-panel application-users-panel">
      <div className="settings-title"><div className="settings-icon"><Users size={19} /></div><div><h2>Application users</h2><p>Add, edit, or remove accounts and assign each employee profile to a user in Human Resources.</p></div>
        <button type="button" className="secondary-btn small" onClick={startCreate}><Plus size={14} />Add user</button>
      </div>
      {loading ? <div className="application-users-empty">Loading users…</div> : users.length === 0
        ? <div className="application-users-empty">No application users found.</div>
        : <div className="application-users-list">{users.map((user) => <div className="application-user-row" key={user.id}>
          <div className="application-user-details"><strong>{user.displayName}</strong><span>@{user.username} · {user.role} · {user.permissions.length} modules</span></div>
          <div className="application-user-actions">
            <button type="button" className="mini-icon" aria-label={`Edit ${user.displayName}`} onClick={() => startEdit(user)}><Pencil size={14} /></button>
            <button type="button" className="mini-icon danger" aria-label={`Delete ${user.displayName}`} disabled={user.id === currentUserId} onClick={() => void removeUser(user)}><Trash2 size={14} /></button>
          </div>
        </div>)}</div>}
    </section>
    {editorOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor() }}>
      <form className="modal application-user-modal" onSubmit={(event) => void saveUser(event)}>
        <div className="modal-head"><div><p className="eyebrow">ACCOUNT MANAGEMENT</p><h2>{editingUser ? 'Edit application user' : 'Add application user'}</h2></div><button type="button" className="icon-btn" disabled={saving} aria-label="Close" onClick={closeEditor}><X size={17} /></button></div>
        <div className="form-grid">
          <label className="field"><span>Username</span><input required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="field"><span>Display name</span><input required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="field"><span>Role</span><select value={role} disabled={editingUser?.id === currentUserId} onChange={(event) => {
            const nextRole = event.target.value as AuthUser['role']
            setRole(nextRole)
            setPermissions(defaultModulesForRole(nextRole))
          }}>
            <option value="admin">Administrator</option><option value="manager">Manager</option><option value="visa">Visa access</option>
          </select></label>
          <label className="field"><span>{editingUser ? 'New password (optional)' : 'Password'}</span><input type="password" autoComplete="new-password" required={!editingUser} minLength={8} maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        </div>
        <fieldset className="application-module-permissions" disabled={saving || role === 'admin'}>
          <legend>Module access</legend>
          <p>Selected modules include their normal actions. My Attendance is always available to every user. Account and security controls remain administrator-only.</p>
          <div className="application-module-grid">{APP_MODULES.map((module) => <label key={module}>
            <input
              type="checkbox"
              checked={role === 'admin' || permissions.includes(module)}
              disabled={module === 'My Attendance'}
              onChange={(event) => setPermissions((current) => event.target.checked
                ? [...current, module]
                : current.filter((item) => item !== module))}
            />
            <span>{module}</span>
          </label>)}</div>
          {role === 'admin' && <small>Administrators always have access to every module.</small>}
        </fieldset>
        <div className="modal-actions"><button type="button" className="secondary-btn" disabled={saving} onClick={closeEditor}>Cancel</button><button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editingUser ? 'Save changes' : 'Add user'}</button></div>
      </form>
    </div>}
  </>
}

function GeminiApiPage({ provider, onProviderChanged, setNotice }: {
  provider: PassportProvider
  onProviderChanged: (provider: PassportProvider) => void
  setNotice: (message: string) => void
}) {
  const apiKeyRef = useRef<HTMLInputElement>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [model, setModel] = useState('gemini-2.5-flash')
  const [models, setModels] = useState([
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash · Recommended' },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' }
  ])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<PassportProvider>(provider)
  const [configured, setConfigured] = useState(false)
  const [usage, setUsage] = useState({ requests: 0, successes: 0, failures: 0, promptTokens: 0, candidateTokens: 0, lastUsedAt: null as string | null })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState('Not tested')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void window.blueLine.getGeminiSettings().then((settings) => {
      if (!active) return
      setConfigured(settings.configured)
      setUsage(settings.usage)
      setModel(settings.model)
      setModels((current) => current.some((item) => item.id === settings.model)
        ? current
        : [{ id: settings.model, displayName: settings.model }, ...current])
      setSelectedProvider(settings.provider)
      onProviderChanged(settings.provider)
      if (settings.configured) {
        void window.blueLine.listGeminiModels().then((items) => {
          if (active && items.length) setModels(items)
        }).catch((cause: Error) => {
          if (active) {
            setConnectionStatus('Could not refresh model list')
            setError(cause.message)
          }
        })
      }
    }).catch((cause: Error) => {
      if (active) setError(cause.message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [onProviderChanged])

  async function loadModels() {
    setModelsLoading(true)
    setError('')
    try {
      const items = await window.blueLine.listGeminiModels(apiKeyRef.current?.value || undefined)
      setModels(items)
      if (!items.some((item) => item.id === model)) setModel(items[0].id)
      setConnectionStatus('Supported models loaded')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load supported Gemini models.')
    } finally { setModelsLoading(false) }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const settings = await window.blueLine.saveGeminiSettings({
        apiKey: apiKeyRef.current?.value || undefined,
        model,
        provider: selectedProvider
      })
      if (apiKeyRef.current) apiKeyRef.current.value = ''
      setConfigured(settings.configured)
      setUsage(settings.usage)
      setSelectedProvider(settings.provider)
      onProviderChanged(settings.provider)
      setNotice('Gemini recognition settings saved securely.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save Gemini settings.')
    } finally { setBusy(false) }
  }

  async function testConnection() {
    setBusy(true)
    setError('')
    setConnectionStatus('Testing…')
    try {
      await window.blueLine.testGeminiConnection({ apiKey: apiKeyRef.current?.value || undefined, model })
      setConnectionStatus('Connected · test passed')
    } catch (cause) {
      setConnectionStatus('Connection failed')
      setError(cause instanceof Error ? cause.message : 'Gemini connection test failed.')
    } finally { setBusy(false) }
  }

  return <div className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">AI RECOGNITION</p><h1>Gemini API</h1><p className="subheading">Configure an optional cloud vision provider for Iraqi passport recognition.</p></div></div>
    <form className="panel settings-panel gemini-settings" onSubmit={(event) => void save(event)}>
      <div className="settings-title"><div className="settings-icon"><Sparkles size={19} /></div><div><h2>Gemini Passport Scanner</h2><p>Credentials are encrypted with Windows secure storage and used only in the desktop main process.</p></div></div>
      <div className="gemini-privacy-note"><ShieldCheck size={17} /><span>When Gemini Vision is selected, the original passport image and its personal information are sent to Google for analysis. Use local OCR instead if this transfer is not authorized for the document.</span></div>
      {loading ? <div className="loading-panel"><span /><span /></div> : <div className="settings-fields gemini-fields">
        <label className="field"><span>Gemini API key</span><span className="api-key-entry"><input ref={apiKeyRef} type={showApiKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} placeholder={configured ? 'Saved securely · leave blank to keep current key' : 'Enter API key'} /><button type="button" className="mini-icon" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} title={showApiKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label>
        <label className="field"><span>Supported Gemini model</span><select value={model} onChange={(event) => setModel(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>
        <div className="gemini-model-refresh"><button type="button" className="secondary-btn small" disabled={modelsLoading || busy} onClick={() => void loadModels()}><RefreshCw size={14} className={modelsLoading ? 'spin' : ''} />{modelsLoading ? 'Loading models…' : 'Refresh supported models'}</button></div>
        <label className="field"><span>Default passport recognition engine</span><select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value as PassportProvider)}><option value="ocr">Existing local OCR</option><option value="gemini">Gemini Vision</option></select></label>
      </div>}
      <div className="gemini-connection"><span className={`status-pill ${configured ? 'green' : 'gray'}`}><i />{configured ? 'API key stored securely' : 'API key not configured'}</span><span>{connectionStatus}</span></div>
      <div className="gemini-usage"><strong>Passport scan usage</strong><span>{usage.requests} API attempts · {usage.successes} successful scans · {usage.failures} failed scans</span><span>{usage.promptTokens.toLocaleString()} input tokens · {usage.candidateTokens.toLocaleString()} output tokens</span><small>{usage.lastUsedAt ? `Last used ${new Date(usage.lastUsedAt).toLocaleString()}` : 'No Gemini passport scans yet'}</small></div>
      {error && <div className="notice-banner"><CircleAlert size={15} /><span>{error}</span></div>}
      <div className="settings-actions gemini-actions"><button type="button" className="secondary-btn" disabled={busy || loading} onClick={() => void testConnection()}>{busy && connectionStatus === 'Testing…' ? 'Testing…' : 'Test connection'}</button><button className="primary-btn" disabled={busy || loading}>{busy && connectionStatus !== 'Testing…' ? 'Saving…' : 'Save configuration'}</button></div>
    </form>
  </div>
}

export default App
