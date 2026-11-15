import type { PassportMrz } from './mrz'
import type { PassportAssessments, PassportFieldValues } from './passportProfiles'

export type PassportProvider = 'ocr' | 'gemini'
export type GeminiUsage = {
  requests: number
  successes: number
  failures: number
  promptTokens: number
  candidateTokens: number
  lastUsedAt: string | null
}
export type GeminiSettings = { configured: boolean; model: string; provider: PassportProvider; usage: GeminiUsage }
export type PassportDiagnosticState = 'pending' | 'success' | 'failed' | 'skipped'
export type PassportDiagnostics = {
  model: string | null
  stages: {
    apiConnection: PassportDiagnosticState
    imageProcessing: PassportDiagnosticState
    request: PassportDiagnosticState
    response: PassportDiagnosticState
    jsonParsing: PassportDiagnosticState
    validation: PassportDiagnosticState
  }
  category?: string
  message?: string
  attempts?: number
  responsePreview?: string
}

export const STAGES = [
  'New Request',
  'Documents Collection',
  'Documents Review',
  'Ready to Submit',
  'Submitted',
  'Under Process',
  'Additional Documents Required',
  'Approved',
  'Rejected',
  'Passport Returned / Closed'
] as const

export type Stage = typeof STAGES[number]
export type Language = 'en' | 'ar'
export const APP_MODULES = [
  'Dashboard', 'My Attendance', 'CRM', 'Visa Pipeline', 'Customers', 'Human Resources', 'DATA',
  'Documents', 'Visa Types', 'Countries', 'Smart Scanner', 'Reports', 'Settings', 'Gemini API'
] as const
export type AppModule = typeof APP_MODULES[number]
export function defaultModulesForRole(role: AuthUser['role']): AppModule[] {
  return role === 'visa'
    ? ['My Attendance', 'Visa Pipeline', 'DATA', 'Visa Types', 'Countries']
    : [...APP_MODULES]
}
export type AuthUser = {
  id: number
  username: string
  displayName: string
  role: 'admin' | 'visa' | 'manager'
  permissions: AppModule[]
}
export type ApplicationUserDraft = Pick<AuthUser, 'username' | 'displayName' | 'role'> & { password: string; permissions?: AppModule[] }
export type ApplicationUserUpdate = Pick<AuthUser, 'id' | 'username' | 'displayName' | 'role'> & { password?: string; permissions?: AppModule[] }
export type Application = {
  id: number
  applicationId: string
  customerId: number
  customerName: string
  phone: string
  country: string
  visaType: string
  status: string
  employee: string
  applicationDate: string
  followUpDate: string | null
  updatedAt: string
  pipelineId?: number
}
export type Customer = {
  id: number
  fullName: string
  phone: string
  email: string
  nationality: string
  passportNumber: string
  createdAt: string
  applications: number
  dateOfBirth?: string
  gender?: string
  address?: string
  passportIssueDate?: string
  passportExpiryDate?: string
  photoDataUrl?: string | null
  lastApplicationDate?: string | null
}
export type Dashboard = {
  total: number
  byStatus: Record<string, number>
  overdue: number
  recent: Application[]
  countries: Array<{ country: string; count: number }>
}
export type NewApplication = {
  fullName: string
  phone?: string
  email?: string
  nationality?: string
  passportNumber?: string
  country: string
  visaType: string
  employee: string
  followUpDate?: string
  dateOfBirth?: string
  gender?: string
  address?: string
  passportIssueDate?: string
  passportExpiryDate?: string
  passportToken?: string
  pipelineId?: number
}
export type Pipeline = { id: number; name: string; sortOrder: number; stages: string[]; applications: number }
export type CatalogItem = { id: number; name: string; active: boolean }
export type PassportInspection = {
  token: string
  fileName: string
  mimeType: string
  previewDataUrl: string
  text: string
  fields: PassportFieldValues
  assessments: PassportAssessments
  profile: 'iraqi'
  mrz: PassportMrz | null
  diagnostics?: PassportDiagnostics
}
export type AppSettings = { companyName: string; language: Language; companyLogoDataUrl: string | null }
export type CustomerProfile = {
  customer: Customer
  applications: Application[]
  documents: Array<DocumentRecord & { applicationRecordId: number | null; storage: 'application' | 'customer' }>
  activities: ApplicationActivity[]
}
export type DocumentRecord = {
  id: number
  applicationId: string | null
  category: string
  fileName: string
  addedAt: string
}
export type DocumentLibraryRecord = DocumentRecord & {
  customerName: string
  storage: 'application' | 'customer'
}
export type ApplicationActivity = {
  id: number
  applicationId: string
  activityType: string
  description: string
  previousValue: string | null
  newValue: string | null
  createdBy: string
  createdAt: string
}
export type HrDepartment = { id: number; name: string; description: string }
export type HrCandidate = {
  id: number
  fullName: string
  phone: string
  email: string
  departmentId: number
  departmentName: string
  notes: string
  fileName: string
  isStarred: boolean
  createdAt: string
}
export type HrCandidateUpload = {
  uploadId: string
  fileName: string
  suggestedName: string
  nameSource: 'ocr' | 'filename'
  suggestionNote?: string
}
export type HrCandidateDraft = {
  fullName: string
  phone: string
  email: string
  departmentId: number
  notes: string
}
export type HrCandidateUpdate = HrCandidateDraft & { id: number }
export type HrEmployee = {
  id: number
  employeeCode: string
  fullName: string
  phone: string
  email: string
  departmentId: number | null
  departmentName: string
  jobTitle: string
  hireDate: string
  employmentType: string
  status: string
  hourlyRate: number
  workStart: string | null
  workEnd: string | null
  archivedAt: string | null
  appUserId: number | null
  appUsername: string | null
  appUserDisplayName: string | null
  photoDataUrl?: string | null
}
export type HrAttendance = {
  id: number
  employeeId: number
  employeeCode: string
  fullName: string
  appUserDisplayName?: string | null
  appUsername?: string | null
  departmentName: string
  attendanceDate: string
  checkIn: string | null
  checkOut: string | null
  status: string
  notes: string
}
export type HrSelfAttendanceStatus = {
  employeeName: string
  attendanceDate: string
  checkIn: string | null
  checkOut: string | null
  shouldPrompt: boolean
}
export type HrLeaveRequest = {
  id: number
  employeeId: number
  employeeCode: string
  fullName: string
  departmentName: string
  leaveType: string
  startDate: string
  endDate: string
  totalDays: number
  reason: string
  status: string
}
export type HrPayrollPeriod = {
  id: number
  month: number
  year: number
  status: string
  employeeCount: number
  totalNet: number
}
export type HrPayrollRecord = {
  id: number
  employeeId: number
  employeeCode: string
  fullName: string
  departmentName: string
  hourlyRate: number
  workedMinutes: number
  basicSalary: number
  totalBonuses: number
  totalAllowances: number
  totalDeductions: number
  totalAdvanceRepayments: number
  totalOtherAdjustments: number
  netSalary: number
}
export type HrAttendanceDay = {
  date: string
  total: number
  checkedIn: number
  checkedOut: number
  dayOffCount: number
  status?: string
  checkIn?: string | null
  checkOut?: string | null
}
export type HrPayCalculation = {
  employeeId: number
  employeeName: string
  hourlyRate: number
  workedMinutes: number
  grossPay: number
}
export type HrPayrollItemType = 'Bonus' | 'Allowance' | 'Deduction' | 'Advance Repayment' | 'Other Adjustment'
export type HrLeaveBalance = {
  employeeId: number
  employeeCode: string
  fullName: string
  leaveType: string
  year: number
  allocatedDays: number
  usedDays: number
  remainingDays: number
}
export type HrDocument = {
  id: number
  employeeId: number
  employeeName: string
  documentName: string
  documentType: string
  issueDate: string | null
  expirationDate: string | null
  uploadedAt: string
}
export type HrEmployeePayrollHistory = {
  id: number
  month: number
  year: number
  periodStatus: string
  hourlyRate: number
  workedMinutes: number
  basicSalary: number
  totalBonuses: number
  totalAllowances: number
  totalDeductions: number
  totalAdvanceRepayments: number
  totalOtherAdjustments: number
  netSalary: number
}
export type HrEmployeeProfileLeave = HrLeaveRequest & {
  createdAt: string
  approvedBy: string | null
  approvedAt: string | null
}
export type HrEmployeeActivity = {
  id: number
  actor: string
  entityType: string
  entityId: number | null
  action: string
  createdAt: string
}
export type HrEmployeeProfile = {
  employee: HrEmployee
  attendance: HrAttendance[]
  leaveRequests: HrEmployeeProfileLeave[]
  leaveBalances: HrLeaveBalance[]
  payroll: HrEmployeePayrollHistory[]
  documents: HrDocument[]
  activity: HrEmployeeActivity[]
}
export type HrReportType = 'employees' | 'attendance' | 'leaves' | 'payroll' | 'documents' | 'activity'
export type HrDashboard = {
  totalEmployees: number
  activeEmployees: number
  presentToday: number
  absentToday: number
  onLeaveToday: number
  pendingLeaveRequests: number
  currentMonthPayrollTotal: number
}
export type HrApi = {
  passwordStatus: () => Promise<{ configured: boolean }>
  setupPassword: (password: string) => Promise<void>
  unlock: (password: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  resetPassword: (administratorPassword: string, newPassword: string) => Promise<void>
  dashboard: () => Promise<HrDashboard>
  listDepartments: () => Promise<HrDepartment[]>
  saveDepartment: (department: { id?: number; name: string; description: string }) => Promise<void>
  listEmployees: (search?: string, includeArchived?: boolean) => Promise<HrEmployee[]>
  getEmployeeProfile: (employeeId: number) => Promise<HrEmployeeProfile>
  setEmployeePhoto: (employeeId: number) => Promise<string | null>
  saveEmployee: (employee: Omit<HrEmployee, 'id' | 'employeeCode' | 'departmentName' | 'archivedAt' | 'photoDataUrl' | 'appUsername' | 'appUserDisplayName' | 'appUserId' | 'workStart' | 'workEnd'> & { id?: number; appUserId?: number | null; workStart?: string | null; workEnd?: string | null }) => Promise<HrEmployee>
  archiveEmployee: (id: number, archived: boolean) => Promise<void>
  deleteEmployee: (id: number) => Promise<void>
  listAttendance: (date: string) => Promise<HrAttendance[]>
  listAttendanceCalendar: (year: number, month: number, employeeId?: number) => Promise<HrAttendanceDay[]>
  clockIn: (employeeId: number) => Promise<void>
  clockOut: (employeeId: number) => Promise<void>
  saveAttendance: (record: Omit<HrAttendance, 'id' | 'employeeCode' | 'fullName' | 'departmentName'>) => Promise<void>
  markAllPresent: (date: string) => Promise<number>
  listLeaveRequests: (status?: string) => Promise<HrLeaveRequest[]>
  createLeaveRequest: (request: Omit<HrLeaveRequest, 'id' | 'employeeCode' | 'fullName' | 'departmentName' | 'status'>) => Promise<void>
  decideLeaveRequest: (id: number, status: 'Approved' | 'Rejected') => Promise<void>
  listLeaveBalances: (year: number) => Promise<HrLeaveBalance[]>
  saveLeaveBalance: (balance: Omit<HrLeaveBalance, 'employeeCode' | 'fullName' | 'usedDays' | 'remainingDays'>) => Promise<void>
  listDocuments: (employeeId?: number) => Promise<HrDocument[]>
  uploadDocument: (employeeId: number, metadata: { documentType: string; issueDate?: string; expirationDate?: string }) => Promise<HrDocument | null>
  openDocument: (id: number) => Promise<void>
  listCandidates: () => Promise<HrCandidate[]>
  selectCandidateFile: () => Promise<HrCandidateUpload | null>
  cancelCandidateUpload: (uploadId: string) => Promise<void>
  createCandidate: (input: HrCandidateDraft & { uploadId: string }) => Promise<HrCandidate>
  updateCandidate: (input: HrCandidateUpdate) => Promise<HrCandidate>
  setCandidateStarred: (id: number, starred: boolean) => Promise<void>
  openCandidateFile: (id: number) => Promise<void>
  listPayrollPeriods: () => Promise<HrPayrollPeriod[]>
  calculatePay: (employeeId: number, startDate: string, endDate: string) => Promise<HrPayCalculation>
  generatePayroll: (month: number, year: number) => Promise<void>
  listPayrollRecords: (periodId: number) => Promise<HrPayrollRecord[]>
  addPayrollItem: (recordId: number, item: { itemType: HrPayrollItemType; description: string; amount: number }) => Promise<void>
  approvePayroll: (id: number) => Promise<void>
  markPayrollPaid: (id: number) => Promise<void>
  exportReport: (report: HrReportType) => Promise<boolean>
}
export type RendererDiagnostic = {
  type: 'window-error' | 'unhandled-rejection' | 'react-uncaught-error'
  errorName?: string
  stack?: string
}
export type WorkspaceConfigInput =
  | { mode: 'local' }
  | { mode: 'server'; bindAddress: string; port: number; createCertificate: boolean }
  | { mode: 'client'; address: string; fingerprint: string }
export type Api = {
  workspaceInfo: () => Promise<{
    mode: 'local' | 'server' | 'client'
    configPath: string
    fingerprint: string
    bindAddress?: string
    host?: string
    port?: number
    networkAddresses: string[]
    setupCode?: string
  }>
  configureWorkspace: (config: WorkspaceConfigInput) => Promise<void>
  testWorkspaceConnection: (address: string, fingerprint: string) => Promise<{ service: string; protocolVersion: number }>
  hr: HrApi
  applicationUsers: {
    list: () => Promise<AuthUser[]>
    create: (input: ApplicationUserDraft) => Promise<AuthUser>
    update: (input: ApplicationUserUpdate) => Promise<AuthUser>
    delete: (id: number) => Promise<void>
  }
  selfAttendance: {
    status: () => Promise<HrSelfAttendanceStatus>
    checkIn: () => Promise<HrSelfAttendanceStatus>
    checkOut: () => Promise<HrSelfAttendanceStatus>
    calendar: (year: number, month: number) => Promise<HrAttendanceDay[]>
  }
  getSession: () => Promise<AuthUser | null>
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  dashboard: () => Promise<Dashboard>
  listApplications: () => Promise<Application[]>
  listCustomers: (search?: string) => Promise<Customer[]>
  getCustomerProfile: (id: number) => Promise<CustomerProfile>
  updateCustomer: (customerId: number, customer: Pick<Customer, 'fullName' | 'passportNumber' | 'dateOfBirth' | 'nationality' | 'gender' | 'phone' | 'email' | 'address' | 'passportIssueDate' | 'passportExpiryDate'>) => Promise<void>
  updateApplication: (applicationId: number, application: Pick<NewApplication, 'fullName' | 'phone' | 'email' | 'nationality' | 'passportNumber' | 'country' | 'visaType' | 'employee' | 'followUpDate'>) => Promise<void>
  deleteApplication: (applicationId: number) => Promise<void>
  uploadCustomerDocument: (customerId: number, applicationId?: number) => Promise<DocumentRecord | null>
  setCustomerPhoto: (customerId: number) => Promise<Customer['photoDataUrl']>
  createApplication: (input: NewApplication) => Promise<Application>
  moveApplication: (id: number, status: string) => Promise<void>
  uploadDocument: (applicationId: number) => Promise<DocumentRecord | null>
  uploadDocumentByReference: (reference: string) => Promise<{ id: number; applicationId: string; fileName: string } | null>
  listDocuments: (applicationId: number) => Promise<DocumentRecord[]>
  listAllDocuments: () => Promise<DocumentLibraryRecord[]>
  openDocument: (documentId: number) => Promise<void>
  exportCsv: () => Promise<boolean>
  getSettings: () => Promise<AppSettings>
  saveSettings: (settings: { companyName: string; language: Language }) => Promise<void>
  setCompanyLogo: () => Promise<string | null>
  removeCompanyLogo: () => Promise<void>
  backup: () => Promise<boolean>
  scanPassport: () => Promise<{ fileName: string; text: string } | null>
  inspectPassport: (file: File, provider: PassportProvider) => Promise<PassportInspection>
  getGeminiSettings: () => Promise<GeminiSettings>
  listGeminiModels: (apiKey?: string) => Promise<Array<{ id: string; displayName: string }>>
  saveGeminiSettings: (settings: { apiKey?: string; model: string; provider: PassportProvider }) => Promise<GeminiSettings>
  testGeminiConnection: (settings: { apiKey?: string; model: string }) => Promise<{ ok: true; model: string }>
  getPassportProvider: () => Promise<PassportProvider>
  savePassportProvider: (provider: PassportProvider) => Promise<PassportProvider>
  listPipelines: () => Promise<Pipeline[]>
  savePipeline: (pipeline: { id?: number; name: string; stages: string[] }) => Promise<void>
  deletePipeline: (id: number) => Promise<void>
  saveCatalogItem: (kind: 'visaType' | 'country', item: { id?: number; name: string; active: boolean }) => Promise<void>
  deleteCatalogItem: (kind: 'visaType' | 'country', id: number) => Promise<void>
  listCatalog: (kind: 'visaType' | 'country') => Promise<CatalogItem[]>
  openCustomerDocument: (documentId: number) => Promise<void>
  listApplicationActivities: (applicationId: number) => Promise<ApplicationActivity[]>
  addApplicationActivity: (applicationId: number, activity: { activityType: 'Internal Note' | 'Customer Call' | 'Customer Message' | 'Follow-up'; description: string }) => Promise<void>
  reportRendererError: (diagnostic: RendererDiagnostic) => void
}
