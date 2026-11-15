import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '../shared/types'

const api: Api = {
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  configureWorkspace: (config) => ipcRenderer.invoke('workspace:configure', config),
  testWorkspaceConnection: (address, fingerprint) => ipcRenderer.invoke('workspace:test-connection', address, fingerprint),
  applicationUsers: {
    list: () => ipcRenderer.invoke('settings:users:list'),
    create: (input) => ipcRenderer.invoke('settings:users:create', input),
    update: (input) => ipcRenderer.invoke('settings:users:update', input),
    delete: (id) => ipcRenderer.invoke('settings:users:delete', id)
  },
  selfAttendance: {
    status: () => ipcRenderer.invoke('attendance:self:status'),
    checkIn: () => ipcRenderer.invoke('attendance:self:check-in'),
    checkOut: () => ipcRenderer.invoke('attendance:self:check-out'),
    calendar: (year, month) => ipcRenderer.invoke('attendance:self:calendar', year, month)
  },
  getSession: () => ipcRenderer.invoke('auth:session'),
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
  logout: () => ipcRenderer.invoke('auth:logout'),
  dashboard: () => ipcRenderer.invoke('dashboard'),
  listApplications: () => ipcRenderer.invoke('applications:list'),
  listCustomers: (search) => ipcRenderer.invoke('customers:list', search),
  createApplication: (input) => ipcRenderer.invoke('applications:create', input),
  moveApplication: (id, status) => ipcRenderer.invoke('applications:move', id, status),
  uploadDocument: (applicationId) => ipcRenderer.invoke('documents:upload', applicationId),
  uploadDocumentByReference: (reference) => ipcRenderer.invoke('documents:upload-by-reference', reference),
  listDocuments: (applicationId) => ipcRenderer.invoke('documents:list', applicationId),
  listAllDocuments: () => ipcRenderer.invoke('documents:list-all'),
  openDocument: (documentId) => ipcRenderer.invoke('documents:open', documentId),
  exportCsv: () => ipcRenderer.invoke('reports:csv'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getGeminiSettings: () => ipcRenderer.invoke('gemini:settings:get'),
  listGeminiModels: (apiKey) => ipcRenderer.invoke('gemini:models:list', apiKey),
  saveGeminiSettings: (settings) => ipcRenderer.invoke('gemini:settings:save', settings),
  testGeminiConnection: (settings) => ipcRenderer.invoke('gemini:connection:test', settings),
  getPassportProvider: () => ipcRenderer.invoke('passport:provider:get'),
  savePassportProvider: (provider) => ipcRenderer.invoke('passport:provider:save', provider),
  setCompanyLogo: () => ipcRenderer.invoke('settings:set-logo'),
  removeCompanyLogo: () => ipcRenderer.invoke('settings:remove-logo'),
  backup: () => ipcRenderer.invoke('backup:create'),
  scanPassport: () => ipcRenderer.invoke('scanner:passport'),
  reportRendererError: (diagnostic) => ipcRenderer.send('diagnostics:renderer', diagnostic),
  getCustomerProfile: (id) => ipcRenderer.invoke('customers:get-profile', id),
  updateCustomer: (customerId, customer) => ipcRenderer.invoke('customers:update', customerId, customer),
  updateApplication: (applicationId, application) => ipcRenderer.invoke('applications:update', applicationId, application),
  deleteApplication: (applicationId) => ipcRenderer.invoke('applications:delete', applicationId),
  uploadCustomerDocument: (customerId, applicationId) => ipcRenderer.invoke('customer-documents:upload', customerId, applicationId),
  setCustomerPhoto: (customerId) => ipcRenderer.invoke('customers:set-photo', customerId),
  inspectPassport: async (file, provider) => {
    const filePath = webUtils.getPathForFile(file)
    if (!filePath) throw new Error('IMAGE_PROCESSING_ERROR: Unable to access the selected passport file. Choose it again and retry.')
    if (provider === 'gemini' || file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      return ipcRenderer.invoke('passport:inspect', filePath, [], provider)
    }
    let image: ImageBitmap
    try {
      image = await createImageBitmap(file)
    } catch (error) {
      throw new Error(`IMAGE_PROCESSING_ERROR: Unable to read passport image dimensions. ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      const maxDimension = 2400
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
      const width = Math.max(1, Math.round(image.width * scale))
      const height = Math.max(1, Math.round(image.height * scale))
      const variants = [
        { label: 'enhanced', angle: 0, sharpen: true },
        { label: 'deskew-clockwise', angle: 0.8, sharpen: false },
        { label: 'deskew-counterclockwise', angle: -0.8, sharpen: false }
      ] as const
      const preprocessed = await Promise.all(variants.map(async ({ label, angle, sharpen }) => {
        const canvas = new OffscreenCanvas(width, height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('IMAGE_PROCESSING_ERROR: Unable to prepare passport image variations for OCR.')
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.filter = 'grayscale(1) contrast(1.22) brightness(1.04)'
        context.translate(width / 2, height / 2)
        context.rotate(angle * Math.PI / 180)
        context.drawImage(image, -width / 2, -height / 2, width, height)
        context.setTransform(1, 0, 0, 1, 0, 0)
        if (sharpen) {
          const pixels = context.getImageData(0, 0, width, height)
          const source = pixels.data.slice()
          for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
              const center = (y * width + x) * 4
              for (let channel = 0; channel < 3; channel += 1) {
                const original = source[center + channel]
                const blur = (
                  original * 4
                  + (source[center - 4 + channel] + source[center + 4 + channel]
                    + source[center - width * 4 + channel] + source[center + width * 4 + channel]) * 2
                  + source[center - width * 4 - 4 + channel] + source[center - width * 4 + 4 + channel]
                  + source[center + width * 4 - 4 + channel] + source[center + width * 4 + 4 + channel]
                ) / 16
                const value = original + (original - blur) * 0.7
                pixels.data[center + channel] = Math.max(0, Math.min(255, value))
              }
            }
          }
          context.putImageData(pixels, 0, 0)
        }
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
        if (blob.size > 4 * 1024 * 1024) throw new Error('IMAGE_PROCESSING_ERROR: Enhanced passport image is too large to inspect reliably.')
        return { label, width, height, imageData: new Uint8Array(await blob.arrayBuffer()) }
      }))
      return await ipcRenderer.invoke('passport:inspect', filePath, preprocessed, provider)
    } finally {
      image.close()
    }
  },
  listPipelines: () => ipcRenderer.invoke('pipelines:list'),
  savePipeline: (pipeline) => ipcRenderer.invoke('pipelines:save', pipeline),
  deletePipeline: (id) => ipcRenderer.invoke('pipelines:delete', id),
  saveCatalogItem: (kind, item) => ipcRenderer.invoke('catalog:save', kind, item),
  deleteCatalogItem: (kind, id) => ipcRenderer.invoke('catalog:delete', kind, id),
  listCatalog: (kind) => ipcRenderer.invoke('catalog:list', kind),
  openCustomerDocument: (documentId) => ipcRenderer.invoke('customer-documents:open', documentId),
  listApplicationActivities: (applicationId) => ipcRenderer.invoke('applications:activities:list', applicationId),
  addApplicationActivity: (applicationId, activity) => ipcRenderer.invoke('applications:activities:add', applicationId, activity),
  hr: {
    passwordStatus: () => ipcRenderer.invoke('hr:auth:status'),
    setupPassword: (password) => ipcRenderer.invoke('hr:auth:setup', password),
    unlock: (password) => ipcRenderer.invoke('hr:auth:unlock', password),
    changePassword: (currentPassword, newPassword) => ipcRenderer.invoke('hr:auth:change', currentPassword, newPassword),
    resetPassword: (administratorPassword, newPassword) => ipcRenderer.invoke('hr:auth:reset', administratorPassword, newPassword),
    dashboard: () => ipcRenderer.invoke('hr:dashboard'),
    listDepartments: () => ipcRenderer.invoke('hr:departments:list'),
    saveDepartment: (department) => ipcRenderer.invoke('hr:departments:save', department),
    listEmployees: (search, includeArchived) => ipcRenderer.invoke('hr:employees:list', search, includeArchived),
    getEmployeeProfile: (employeeId) => ipcRenderer.invoke('hr:employees:profile', employeeId),
    setEmployeePhoto: (employeeId) => ipcRenderer.invoke('hr:employees:set-photo', employeeId),
    saveEmployee: (employee) => ipcRenderer.invoke('hr:employees:save', employee),
    archiveEmployee: (id, archived) => ipcRenderer.invoke('hr:employees:archive', id, archived),
    deleteEmployee: (id) => ipcRenderer.invoke('hr:employees:delete', id),
    listAttendance: (date) => ipcRenderer.invoke('hr:attendance:list', date),
    listAttendanceCalendar: (year, month, employeeId) => ipcRenderer.invoke('hr:attendance:calendar', year, month, employeeId),
    clockIn: (employeeId) => ipcRenderer.invoke('hr:attendance:clock-in', employeeId),
    clockOut: (employeeId) => ipcRenderer.invoke('hr:attendance:clock-out', employeeId),
    saveAttendance: (record) => ipcRenderer.invoke('hr:attendance:save', record),
    markAllPresent: (date) => ipcRenderer.invoke('hr:attendance:mark-all-present', date),
    listLeaveRequests: (status) => ipcRenderer.invoke('hr:leaves:list', status),
    createLeaveRequest: (request) => ipcRenderer.invoke('hr:leaves:create', request),
    decideLeaveRequest: (id, status) => ipcRenderer.invoke('hr:leaves:decide', id, status),
    listLeaveBalances: (year) => ipcRenderer.invoke('hr:leave-balances:list', year),
    saveLeaveBalance: (balance) => ipcRenderer.invoke('hr:leave-balances:save', balance),
    listDocuments: (employeeId) => ipcRenderer.invoke('hr:documents:list', employeeId),
    uploadDocument: (employeeId, metadata) => ipcRenderer.invoke('hr:documents:upload', employeeId, metadata),
    openDocument: (id) => ipcRenderer.invoke('hr:documents:open', id),
    listCandidates: () => ipcRenderer.invoke('hr:candidates:list'),
    selectCandidateFile: () => ipcRenderer.invoke('hr:candidates:select-file'),
    cancelCandidateUpload: (uploadId) => ipcRenderer.invoke('hr:candidates:cancel-upload', uploadId),
    createCandidate: (input) => ipcRenderer.invoke('hr:candidates:create', input),
    updateCandidate: (input) => ipcRenderer.invoke('hr:candidates:update', input),
    setCandidateStarred: (id, starred) => ipcRenderer.invoke('hr:candidates:star', id, starred),
    openCandidateFile: (id) => ipcRenderer.invoke('hr:candidates:open-file', id),
    listPayrollPeriods: () => ipcRenderer.invoke('hr:payroll:list'),
    calculatePay: (employeeId, startDate, endDate) => ipcRenderer.invoke('hr:payroll:calculate', employeeId, startDate, endDate),
    generatePayroll: (month, year) => ipcRenderer.invoke('hr:payroll:generate', month, year),
    listPayrollRecords: (periodId) => ipcRenderer.invoke('hr:payroll:records:list', periodId),
    addPayrollItem: (recordId, item) => ipcRenderer.invoke('hr:payroll:item:add', recordId, item),
    approvePayroll: (id) => ipcRenderer.invoke('hr:payroll:approve', id),
    markPayrollPaid: (id) => ipcRenderer.invoke('hr:payroll:paid', id),
    exportReport: (report) => ipcRenderer.invoke('hr:reports:export', report)
  }
}

contextBridge.exposeInMainWorld('blueLine', api)
