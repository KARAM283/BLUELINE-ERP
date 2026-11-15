import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell, type IpcMainInvokeEvent } from 'electron'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { createSecureContext } from 'node:tls'
import type Database from 'better-sqlite3'
import { generate as generateSelfSignedCertificate } from 'selfsigned'
import { ZipFile } from 'yazl'
import { createWorker, PSM } from 'tesseract.js'
import { openDatabase, addApplicationActivity, createApplication, deleteApplication, deleteCatalogItem, deletePipeline, getCustomerPhotoPath, getCustomerProfile, getDashboard, listAllDocuments, listApplicationActivities, listApplications, listCatalog, listCustomers, listPipelines, moveApplication, saveCatalogItem, savePipeline, setCustomerPhotoPath, updateApplication, updateCustomer } from './database'
import {
  addHrCandidate, addHrPayrollItem, approveHrPayroll, archiveHrEmployee, clockInHrAttendanceForUser, clockOutHrAttendanceForUser, createHrLeaveRequest, decideHrLeaveRequest, deleteHrEmployee, generateHrPayroll,
  addHrDocument, buildHrCsvReport, getHrDocumentPath, getHrDashboard, listHrAttendance, listHrDepartments, listHrDocuments,
  getHrCandidateFilePath, listHrCandidates, setHrCandidateStarred, updateHrCandidate,
  calculateHrPay, clockHrAttendance, getHrEmployeePhotoPath, getHrEmployeeProfileData, getHrEmployeeStoredFilePaths, listHrAttendanceCalendar,
  getHrSelfAttendanceCalendar, getHrSelfAttendanceStatus, listHrEmployees, listHrLeaveBalances, listHrLeaveRequests, listHrPayrollRecords, listHrPayrollPeriods,
  markAllHrEmployeesPresent, markHrPayrollPaid, saveHrAttendance, saveHrDepartment, saveHrEmployee,
  listHrCandidatePathsForDepartmentPurge, purgeHrCandidatesFromDepartments,
  saveHrLeaveBalance, setHrEmployeePhotoPath, type HrEmployeeRecord
} from './hrDatabase'
import { changeHrPassword, isHrPasswordConfigured, resetHrPassword, setInitialHrPassword, verifyHrPassword } from './hrSecurity'
import { recordDiagnostic } from './diagnostics'
import { GeminiPassportError, GeminiPassportScanner } from './geminiPassportScanner'
import { parsePassportMrz } from '../shared/mrz'
import { extractIraqiPassport, type PassportOcrPage } from '../shared/passportProfiles'
import { authenticate, createApplicationUser, deleteApplicationUser, listApplicationUsers, updateApplicationUser } from './auth'
import { getLanIPv4Addresses, parseLanConfig, readLanConfig, requestAttendance, startAttendanceServer, testOfficeServerConnection } from './lanAttendance'
import { DOCUMENT_CHUNK_SIZE, DOCUMENT_MAX_SIZE, LanDocuments } from './lanDocuments'
import { LanCrm } from './lanCrm'
import { LanHr } from './lanHr'
import { LanWorkspace } from './lanWorkspace'
import { LanGemini } from './lanGemini'
import { buildClientSetupCode, normalizeServerFingerprint, parseOfficeServerAddress } from '../shared/lanSetup'
import type { AppModule, AuthUser, HrCandidateDraft, HrCandidateUpdate, HrEmployee, HrReportType, Language, NewApplication, PassportDiagnostics, PassportProvider, RendererDiagnostic } from '../shared/types'

app.setName('BlueLineVisaCRM')

process.on('uncaughtException', (error) => {
  recordDiagnostic('main-uncaught-exception', error, true)
  app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  recordDiagnostic('main-unhandled-rejection', reason, true)
  app.exit(1)
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()
type PendingPassport = { path: string; owner: number; fileName: string; mimeType: string; expiresAt: number; hash?: string }
type PassportPreprocessingVariant = { label: 'enhanced' | 'deskew-clockwise' | 'deskew-counterclockwise'; imageData: Uint8Array; width: number; height: number }
type PassportOcrLanguage = 'eng' | 'eng+ara'
type PassportOcrWorker = Awaited<ReturnType<typeof createWorker>>
type PassportOcrResult = { text: string; pages: PassportOcrPage[]; mrz: ReturnType<typeof parsePassportMrz>; extraction: ReturnType<typeof extractIraqiPassport> }
const pendingPassports = new Map<string, PendingPassport>()
const passportOcrWorkers = new Map<PassportOcrLanguage, Promise<PassportOcrWorker>>()
const pendingHrCandidateUploads = new Map<string, { filePath: string; fileName: string }>()
let authenticatedUser: AuthUser | null = null
let clientCredentials: { username: string; password: string } | null = null
let clientSession: string | null = null
let hrUnlocked = false
let mainWindow: BrowserWindow | null = null
let passportOcrQueue = Promise.resolve()
if (!hasSingleInstanceLock) app.quit()
else app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

function isMainWindowEvent(event: IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame
}

async function createOfficeServerCertificate(root: string, bindAddress: string): Promise<void> {
  const generated = await generateSelfSignedCertificate([{ name: 'commonName', value: bindAddress }], {
    keyType: 'rsa',
    keySize: 3072,
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip: bindAddress }] }
    ]
  })
  createSecureContext({ key: generated.private, cert: generated.cert, minVersion: 'TLSv1.2' })
  const directory = join(root, 'lan-server')
  await mkdir(directory, { recursive: true })
  const keyPath = join(directory, 'key.pem')
  const certificatePath = join(directory, 'cert.pem')
  const suffix = randomUUID()
  const pendingKey = join(directory, `${suffix}.key.tmp`)
  const pendingCertificate = join(directory, `${suffix}.cert.tmp`)
  const previousKey = join(directory, `${suffix}.key.previous`)
  const previousCertificate = join(directory, `${suffix}.cert.previous`)
  await writeFile(pendingKey, generated.private, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await writeFile(pendingCertificate, generated.cert, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  let keyMoved = false
  let certificateMoved = false
  let keyInstalled = false
  let certificateInstalled = false
  try {
    if (existsSync(keyPath)) { await rename(keyPath, previousKey); keyMoved = true }
    if (existsSync(certificatePath)) { await rename(certificatePath, previousCertificate); certificateMoved = true }
    await rename(pendingKey, keyPath)
    keyInstalled = true
    await rename(pendingCertificate, certificatePath)
    certificateInstalled = true
  } catch (error) {
    if (certificateInstalled) await rm(certificatePath, { force: true })
    if (keyInstalled) await rm(keyPath, { force: true })
    if (keyMoved) await rename(previousKey, keyPath)
    if (certificateMoved) await rename(previousCertificate, certificatePath)
    throw new Error(`Unable to save the office server certificate: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await rm(pendingKey, { force: true })
    await rm(pendingCertificate, { force: true })
  }
  await rm(previousKey, { force: true })
  await rm(previousCertificate, { force: true })
}

async function verifyOfficeServerCertificate(root: string): Promise<void> {
  try {
    createSecureContext({
      key: await readFile(join(root, 'lan-server', 'key.pem'), 'utf8'),
      cert: await readFile(join(root, 'lan-server', 'cert.pem'), 'utf8'),
      minVersion: 'TLSv1.2'
    })
  } catch (error) {
    throw new Error(`A valid office server certificate is required. Select “Create a new server certificate” or fix the existing certificate: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function installApplicationMenu(config: ReturnType<typeof readLanConfig>, getFingerprint: () => string): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [{
        label: 'Copy Client Setup Code',
        enabled: config.mode === 'server',
        click: () => {
          if (config.mode !== 'server') return
          const fingerprint = getFingerprint()
          if (!fingerprint) {
            dialog.showErrorBox('Office server is not ready', 'The client setup code is unavailable until the server has started.')
            return
          }
          clipboard.writeText(buildClientSetupCode(config.bindAddress, config.port, fingerprint))
        }
      }]
    }
  ]))
}

function modulesForChannel(channel: string): AppModule[] {
  if (channel.startsWith('hr:')) return ['Human Resources']
  if (channel === 'dashboard') return ['Dashboard', 'Reports']
  if (channel.startsWith('attendance:self:')) return ['My Attendance', 'Dashboard']
  if (channel === 'applications:list') return ['Visa Pipeline', 'Reports', 'Smart Scanner']
  if (channel === 'applications:create') return ['Dashboard', 'Visa Pipeline']
  if (channel.startsWith('applications:activities:')) return ['Visa Pipeline', 'CRM', 'Customers', 'DATA']
  if (channel.startsWith('applications:')) return ['Visa Pipeline']
  if (channel === 'customers:list') return ['CRM', 'Customers', 'DATA', 'Visa Pipeline']
  if (channel === 'customers:get-profile') return ['CRM', 'Customers', 'DATA', 'Visa Pipeline']
  if (channel === 'customer-documents:open') return ['CRM', 'Customers', 'DATA', 'Documents']
  if (channel.startsWith('customers:') || channel.startsWith('customer-documents:')) return ['CRM', 'Customers', 'DATA']
  if (channel === 'pipelines:list') return ['Dashboard', 'Visa Pipeline', 'Settings']
  if (channel.startsWith('pipelines:')) return ['Visa Pipeline', 'Settings']
  if (channel === 'catalog:list') return ['Dashboard', 'Visa Pipeline', 'CRM', 'Customers', 'DATA', 'Visa Types', 'Countries', 'Settings', 'Smart Scanner']
  if (channel.startsWith('catalog:')) return ['Visa Types', 'Countries', 'Settings']
  if (channel === 'documents:list-all') return ['Documents']
  if (channel.startsWith('documents:')) return ['Documents', 'Visa Pipeline']
  if (channel.startsWith('settings:users:')) return ['Settings']
  if (channel.startsWith('settings:')) return ['Settings']
  if (channel.startsWith('gemini:')) return ['Gemini API']
  if (channel.startsWith('passport:provider:')) return ['Smart Scanner', 'Gemini API', 'Visa Pipeline']
  if (channel === 'passport:inspect') return ['Smart Scanner', 'Visa Pipeline']
  if (channel.startsWith('passport:')) return ['Smart Scanner']
  if (channel.startsWith('scanner:')) return ['Smart Scanner']
  if (channel === 'reports:csv') return ['Reports']
  if (channel === 'backup:create') return ['Settings']
  return []
}

function secureHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    if (!authenticatedUser) throw new Error('Please sign in to continue.')
    const requiredModules = modulesForChannel(channel)
    if (!requiredModules.length) throw new Error('This application action is not assigned to a module.')
    if (!requiredModules.some((module) => authenticatedUser!.permissions.includes(module))) {
      throw new Error('You do not have permission to access this module.')
    }
    if (channel.startsWith('hr:') && !hrUnlocked
      && !['hr:auth:status', 'hr:auth:setup', 'hr:auth:unlock', 'hr:auth:reset'].includes(channel)) {
      throw new Error('Unlock Human Resources with the HR password to continue.')
    }
    return handler(event, ...args)
  })
}

function requireModuleAccess(...modules: AppModule[]): void {
  if (!authenticatedUser || !modules.some((module) => authenticatedUser!.permissions.includes(module))) {
    throw new Error('You do not have permission to access this module.')
  }
}

const validId = (id: unknown): number => {
  if (!Number.isSafeInteger(id) || Number(id) <= 0) throw new Error('Invalid record ID.')
  return Number(id)
}

function requireAdministrator(): AuthUser {
  if (!authenticatedUser || authenticatedUser.role !== 'admin') throw new Error('Only an administrator can manage application users.')
  return authenticatedUser
}

async function addDocuments(zip: ZipFile, source: string, archivePath: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const fullPath = join(source, entry.name)
    const archiveName = `${archivePath}/${entry.name}`
    if (entry.isDirectory()) await addDocuments(zip, fullPath, archiveName)
    else if (entry.isFile()) zip.addFile(fullPath, archiveName)
  }
}

async function createWindow(): Promise<void> {
  const preloadPath = join(__dirname, '../preload/index.js')
  if (!existsSync(preloadPath)) throw new Error('Required preload file is missing from the application package.')

  const win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1024, minHeight: 700,
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win
  win.once('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      authenticatedUser = null
      clientCredentials = null
      clientSession = null
      hrUnlocked = false
    }
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.on('render-process-gone', (_event, details) => {
    recordDiagnostic('renderer-process-gone', new Error(`reason=${details.reason}; exitCode=${details.exitCode}`), true)
  })
  win.webContents.once('did-finish-load', () => recordDiagnostic('renderer-load-succeeded'))
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      recordDiagnostic('renderer-load-failed', new Error(`code=${errorCode}; ${errorDescription}`), true)
    }
  })
  ipcMain.on('diagnostics:renderer', (event, value: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const diagnostic = value as Partial<RendererDiagnostic>
    if (!['window-error', 'unhandled-rejection', 'react-uncaught-error'].includes(String(diagnostic.type))) return
    const errorName = typeof diagnostic.errorName === 'string' ? diagnostic.errorName.slice(0, 120) : undefined
    const stack = typeof diagnostic.stack === 'string' ? diagnostic.stack.slice(0, 8000) : undefined
    recordDiagnostic(`renderer-${diagnostic.type}`, undefined, false, { errorName, stack })
  })
  try {
    const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
    const rendererPath = join(__dirname, '../renderer/index.html')
    if (rendererUrl) {
      try {
        await win.loadURL(rendererUrl)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (!/ERR_CONNECTION_REFUSED|\(-102\)/.test(detail) || !existsSync(rendererPath)) throw error
        recordDiagnostic('renderer-dev-server-unavailable', error, true)
        await win.loadFile(rendererPath)
      }
    } else {
      if (!existsSync(rendererPath)) throw new Error('Required renderer file is missing from the application package.')
      await win.loadFile(rendererPath)
    }
  } catch (error) {
    win.destroy()
    throw error
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  const root = app.getPath('userData')
  const lanConfig = readLanConfig(root)
  let serverFingerprint = ''
  installApplicationMenu(lanConfig, () => serverFingerprint)
  ipcMain.handle('workspace:info', (event) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    return {
      ...lanConfig,
      fingerprint: lanConfig.mode === 'server' ? serverFingerprint : lanConfig.mode === 'client' ? lanConfig.fingerprint : '',
      configPath: join(root, 'lan-workspace.json'),
      networkAddresses: getLanIPv4Addresses(),
      ...(lanConfig.mode === 'server' && serverFingerprint
        ? { setupCode: buildClientSetupCode(lanConfig.bindAddress, lanConfig.port, serverFingerprint) } : {})
    }
  })
  ipcMain.handle('workspace:configure', async (event, input: unknown) => {
    if (!isMainWindowEvent(event) || authenticatedUser) throw new Error('Sign out before changing workspace.')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid workspace configuration.')
    const value = input as Record<string, unknown>
    let config: ReturnType<typeof readLanConfig>
    if (value.mode === 'local') {
      if (Object.keys(value).some((key) => key !== 'mode')) throw new Error('Invalid workspace configuration.')
      config = { mode: 'local' }
    } else if (value.mode === 'server') {
      if (Object.keys(value).some((key) => !['mode', 'bindAddress', 'port', 'createCertificate'].includes(key))
        || typeof value.createCertificate !== 'boolean') throw new Error('Invalid server configuration.')
      config = parseLanConfig({ mode: 'server', bindAddress: value.bindAddress, port: value.port })
      if (value.createCertificate) await createOfficeServerCertificate(root, config.bindAddress)
      else await verifyOfficeServerCertificate(root)
    } else if (value.mode === 'client') {
      if (Object.keys(value).some((key) => !['mode', 'address', 'fingerprint'].includes(key))) throw new Error('Invalid client configuration.')
      const endpoint = parseOfficeServerAddress(value.address)
      const fingerprint = normalizeServerFingerprint(value.fingerprint)
      config = parseLanConfig({ mode: 'client', ...endpoint, fingerprint })
    } else {
      throw new Error('Select standalone, server, or client mode.')
    }
    await writeFile(join(root, 'lan-workspace.json'), JSON.stringify(config, null, 2), 'utf8')
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('workspace:test-connection', async (event, address: unknown, fingerprint: unknown) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    const endpoint = parseOfficeServerAddress(address)
    const pin = normalizeServerFingerprint(fingerprint)
    const config = parseLanConfig({ mode: 'client', ...endpoint, fingerprint: pin })
    return testOfficeServerConnection(config)
  })
  if (lanConfig.mode === 'client') {
    let clientPassportProvider: PassportProvider = 'ocr'
    let activeGeminiToken: string | null = null
    const check = (event: IpcMainInvokeEvent) => {
      if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    }
    ipcMain.handle('auth:session', (event) => { check(event); return authenticatedUser })
    ipcMain.handle('auth:login', async (event, username: unknown, password: unknown) => {
      check(event)
      if (typeof username !== 'string' || typeof password !== 'string') throw new Error('Invalid credentials.')
      const credentials = { username: username.trim(), password }
      const user = await requestAttendance(lanConfig, { action: 'login', ...credentials, args: [] }) as AuthUser
      clientCredentials = credentials
      clientSession = randomBytes(32).toString('hex')
      clientPassportProvider = 'ocr'
      pendingPassports.clear()
      authenticatedUser = user
      return user
    })
    ipcMain.handle('auth:logout', (event) => {
      check(event)
      const credentials = clientCredentials
      const session = clientSession
      const scan = activeGeminiToken
      clientCredentials = null; clientSession = null; authenticatedUser = null; pendingPassports.clear()
      clientPassportProvider = 'ocr'
      activeGeminiToken = null
      if (credentials && session) void requestAttendance(lanConfig, { action: 'hr', ...credentials, args: ['hr:auth:lock', [], session] }).catch(() => undefined)
      if (credentials && session && scan) void requestAttendance(lanConfig, { action: 'gemini', ...credentials, args: ['cancel', [scan], session] }).catch(() => undefined)
    })
    const remote = (action: Parameters<typeof requestAttendance>[1]['action'], args: unknown[] = []) => {
      if (!clientCredentials) throw new Error('Please sign in to continue.')
      return requestAttendance(lanConfig, { action, ...clientCredentials, args })
    }
    const workspace = (operation: string, args: unknown[] = []) => {
      if (!clientSession) throw new Error('Please sign in to continue.')
      return remote('crm', [operation, args, clientSession])
    }
    const hr = (operation: string, args: unknown[] = []) => {
      if (!clientSession) throw new Error('Please sign in to continue.')
      return remote('hr', [operation, args, clientSession])
    }
    const shared = (operation: string, args: unknown[] = []) => {
      if (!clientSession) throw new Error('Please sign in to continue.')
      return remote('workspace', [operation, args, clientSession])
    }
    const gemini = (operation: string, args: unknown[] = []) => {
      if (!clientSession) throw new Error('Please sign in to continue.')
      return remote('gemini', [operation, args, clientSession])
    }
    for (const channel of [
      'applications:list', 'applications:move', 'applications:update', 'applications:delete',
      'applications:activities:list', 'applications:activities:add', 'customers:list', 'customers:get-profile',
      'customers:update', 'pipelines:list', 'pipelines:save', 'pipelines:delete',
      'catalog:list', 'catalog:save', 'catalog:delete', 'documents:list'
    ]) {
      ipcMain.handle(channel, (event, ...args: unknown[]) => { check(event); return workspace(channel, args.map((arg) => arg === undefined ? null : arg)) })
    }
    for (const channel of [
      'hr:auth:status', 'hr:auth:setup', 'hr:auth:unlock', 'hr:auth:change', 'hr:auth:reset',
      'hr:dashboard', 'hr:departments:list', 'hr:departments:save', 'hr:employees:list', 'hr:employees:profile',
      'hr:employees:save', 'hr:employees:archive', 'hr:employees:delete', 'hr:attendance:list', 'hr:attendance:calendar',
      'hr:attendance:clock-in', 'hr:attendance:clock-out', 'hr:attendance:save', 'hr:attendance:mark-all-present',
      'hr:leaves:list', 'hr:leaves:create', 'hr:leaves:decide', 'hr:leave-balances:list', 'hr:leave-balances:save',
      'hr:documents:list', 'hr:candidates:list', 'hr:candidates:cancel-upload',
      'hr:candidates:update', 'hr:candidates:star', 'hr:payroll:list', 'hr:payroll:calculate',
      'hr:payroll:records:list', 'hr:payroll:item:add', 'hr:payroll:generate', 'hr:payroll:approve', 'hr:payroll:paid'
    ]) {
      ipcMain.handle(channel, (event, ...args: unknown[]) => { check(event); return hr(channel, args.map((arg) => arg === undefined ? null : arg)) })
    }
    for (const channel of ['dashboard', 'settings:get', 'settings:save', 'settings:users:list', 'settings:users:create', 'settings:users:delete', 'settings:remove-logo']) {
      ipcMain.handle(channel, (event, ...args: unknown[]) => { check(event); return shared(channel, args) })
    }
    ipcMain.handle('settings:users:update', async (event, input: unknown) => {
      check(event)
      const updated = await shared('settings:users:update', [input]) as AuthUser
      if (updated.id === authenticatedUser?.id && clientCredentials && input && typeof input === 'object') {
        const value = input as { password?: unknown }
        clientCredentials = { username: updated.username, password: typeof value.password === 'string' && value.password ? value.password : clientCredentials.password }
        try {
          authenticatedUser = await requestAttendance(lanConfig, { action: 'login', ...clientCredentials, args: [] }) as AuthUser
          if (clientSession) {
            try { await requestAttendance(lanConfig, { action: 'hr', ...clientCredentials, args: ['hr:auth:lock', [], clientSession] }) } catch { /* The old session also expires. */ }
          }
          clientSession = randomBytes(32).toString('hex')
          pendingPassports.clear()
          return authenticatedUser
        } catch { throw new Error('Your account was updated. Sign out and sign in again with the updated credentials.') }
      }
      return updated
    })
    ipcMain.handle('reports:csv', async (event) => {
      check(event)
      const csv = await shared('reports:csv')
      if (typeof csv !== 'string') throw new Error('Invalid report response.')
      const result = await dialog.showSaveDialog({ defaultPath: 'BlueLine-Visa-CRM-Applications.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
      if (result.canceled || !result.filePath) return false
      if (extname(result.filePath).toLowerCase() !== '.csv') throw new Error('Save the report as a CSV file.')
      await writeFile(result.filePath, csv, 'utf8')
      return true
    })
    ipcMain.handle('settings:set-logo', async (event) => {
      check(event)
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Company logo', extensions: ['png', 'jpg', 'jpeg'] }] })
      if (result.canceled || !result.filePaths[0]) return null
      const path = result.filePaths[0]
      const file = await stat(path)
      if (!file.isFile() || file.size < 1 || file.size > 5 * 1024 * 1024 || !['.png', '.jpg', '.jpeg'].includes(extname(path).toLowerCase())) throw new Error('Choose a JPG or PNG logo up to 5 MB.')
      const bytes = await readFile(path)
      if (bytes.length !== file.size) throw new Error('The selected logo changed. Choose it again.')
      const token = await shared('logo:begin', [bytes.length])
      if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid logo upload response.')
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length)
          if (await shared('logo:chunk', [token, offset, bytes.subarray(offset, end).toString('base64')]) !== end) throw new Error('The server did not acknowledge the upload.')
        }
        return await shared('logo:finish', [token])
      } catch (error) {
        try { await shared('logo:cancel', [token]) } catch { /* Uploads expire on the server. */ }
        throw error
      }
    })
    ipcMain.handle('backup:create', async (event) => {
      check(event)
      const destination = await dialog.showSaveDialog({ defaultPath: `BlueLine-Backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'ZIP backup', extensions: ['zip'] }] })
      if (destination.canceled || !destination.filePath) return false
      if (extname(destination.filePath).toLowerCase() !== '.zip') throw new Error('Save the backup as a ZIP file.')
      const token = await shared('backup:begin')
      if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid backup response.')
      const partial = `${destination.filePath}.partial-${randomUUID()}`
      try {
        let info: { state?: unknown; size?: unknown; hash?: unknown }
        const deadline = Date.now() + 30 * 60_000
        do {
          info = await shared('backup:status', [token]) as typeof info
          if (info?.state === 'building') await new Promise((resolve) => setTimeout(resolve, 1000))
          else break
        } while (Date.now() < deadline)
        if (info?.state !== 'ready' || !Number.isSafeInteger(info.size) || Number(info.size) < 1 || Number(info.size) > 1024 * 1024 * 1024
          || typeof info.hash !== 'string' || !/^[a-f0-9]{64}$/.test(info.hash)) throw new Error('The host backup is not ready or is invalid.')
        const handle = await open(partial, 'wx')
        try {
          const hash = createHash('sha256')
          const size = Number(info.size)
          for (let offset = 0; offset < size; offset += DOCUMENT_CHUNK_SIZE) {
            const encoded = await shared('backup:chunk', [token, offset])
            if (typeof encoded !== 'string' || encoded.length > Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4) throw new Error('Invalid backup data.')
            const bytes = Buffer.from(encoded, 'base64')
            if (bytes.toString('base64') !== encoded || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, size - offset)) throw new Error('Invalid backup data.')
            await handle.writeFile(bytes)
            hash.update(bytes)
          }
          if (hash.digest('hex') !== info.hash) throw new Error('Backup integrity check failed.')
        } finally { await handle.close() }
        await rename(partial, destination.filePath)
        return true
      } finally {
        try { await rm(partial, { force: true }) }
        finally {
          try { await shared('backup:release', [token]) } catch { /* The host expires abandoned backups. */ }
        }
      }
    })
    ipcMain.handle('hr:reports:export', async (event, report: unknown) => {
      check(event)
      if (typeof report !== 'string' || !['employees', 'attendance', 'leaves', 'payroll', 'documents', 'activity'].includes(report)) throw new Error('Unsupported HR report.')
      const csv = await hr('hr:reports:export', [report])
      if (typeof csv !== 'string') throw new Error('Invalid HR report response.')
      const result = await dialog.showSaveDialog({ defaultPath: `BlueLine-HR-${report}.csv`, filters: [{ name: 'CSV report', extensions: ['csv'] }] })
      if (result.canceled || !result.filePath) return false
      if (extname(result.filePath).toLowerCase() !== '.csv') throw new Error('Save the report as a CSV file.')
      await writeFile(result.filePath, csv, 'utf8')
      return true
    })
    ipcMain.handle('passport:provider:get', async (event) => { check(event); await shared('scanner:authorize', ['inspect']); return clientPassportProvider })
    ipcMain.handle('passport:provider:save', async (event, provider) => {
      check(event); await shared('scanner:authorize', ['inspect'])
      if (provider !== 'ocr' && provider !== 'gemini') throw new Error('Select a supported passport recognition engine.')
      if (provider === 'gemini') {
        const status = await gemini('availability') as { configured?: unknown }
        if (status?.configured !== true) throw new Error('Gemini is not configured on the office server.')
      }
      clientPassportProvider = provider
      return provider
    })
    for (const channel of ['gemini:settings:get', 'gemini:models:list', 'gemini:settings:save', 'gemini:connection:test']) {
      ipcMain.handle(channel, (event) => { check(event); throw new Error('Gemini configuration is available on the host only.') })
    }
    ipcMain.handle('scanner:passport', async (event) => {
      check(event); await shared('scanner:authorize', ['standalone'])
      const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Passport image', extensions: ['jpg', 'jpeg', 'png'] }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const path = selected.filePaths[0]
      const file = await stat(path)
      if (!file.isFile() || file.size < 1 || file.size > DOCUMENT_MAX_SIZE || !['.jpg', '.jpeg', '.png'].includes(extname(path).toLowerCase())) throw new Error('Choose a JPG or PNG passport image up to 25 MB.')
      const text = (await recognizePassport(path, root)).text
      await shared('scanner:authorize', ['standalone'])
      return { fileName: basename(path), text }
    })
    secureHandle('passport:inspect', async (event, filePath: unknown, preprocessingVariants: unknown, provider: unknown) => {
      await shared('scanner:authorize', ['inspect'])
      if (provider !== undefined && provider !== 'ocr' && provider !== 'gemini') throw new Error('Select a supported passport recognition engine.')
      const selectedProvider = provider ?? clientPassportProvider
      if (typeof filePath !== 'string' || !['.pdf', '.jpg', '.jpeg', '.png'].includes(extname(filePath).toLowerCase())) throw new Error('Choose a JPG, PNG, or PDF passport.')
      const details = await stat(filePath)
      if (!details.isFile() || details.size < 1 || details.size > DOCUMENT_MAX_SIZE) throw new Error('Passport must be between 1 byte and 25 MB.')
      const image = await readFile(filePath)
      if (image.length !== details.size) throw new Error('The passport file changed. Choose it again.')
      const extension = extname(filePath).toLowerCase()
      const mimeType = extension === '.pdf' ? 'application/pdf' : extension === '.png' ? 'image/png' : 'image/jpeg'
      const variants = validatePassportVariants(preprocessingVariants)
      let ocr = extension === '.pdf'
        ? { text: '', pages: [], mrz: null, extraction: extractIraqiPassport([], null) }
        : await recognizePassport(filePath, root, variants, 'eng').catch((error: unknown) => {
          if (selectedProvider === 'ocr') throw error
          return { text: '', pages: [], mrz: null, extraction: extractIraqiPassport([], null) }
        })
      if (createHash('sha256').update(await readFile(filePath)).digest('hex') !== createHash('sha256').update(image).digest('hex')) throw new Error('The passport file changed. Choose it again.')
      await shared('scanner:authorize', ['inspect'])
      let diagnostics: PassportDiagnostics | undefined
      if (selectedProvider === 'gemini') {
        const token = await gemini('begin', [basename(filePath), image.length])
        if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid Gemini scan response.')
        activeGeminiToken = token
        try {
          for (let offset = 0; offset < image.length; offset += DOCUMENT_CHUNK_SIZE) {
            const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, image.length)
            if (await gemini('chunk', [token, offset, image.subarray(offset, end).toString('base64')]) !== end) throw new Error('The server did not acknowledge the scan upload.')
          }
          await gemini('finish', [token, ocr.extraction])
          let status: { state?: unknown; result?: { extraction?: typeof ocr.extraction; diagnostics?: PassportDiagnostics } }
          const deadline = Date.now() + 5 * 60_000
          do {
            status = await gemini('status', [token]) as typeof status
            if (status?.state === 'processing') await new Promise((resolve) => setTimeout(resolve, 1000))
            else break
          } while (Date.now() < deadline)
          if (status?.state !== 'ready' || !status.result?.extraction || !status.result.diagnostics) throw new Error('The Gemini scan did not complete.')
          ocr = { ...ocr, extraction: status.result.extraction }
          diagnostics = status.result.diagnostics
        } finally {
          try { await gemini('cancel', [token]) } catch { /* The host removes abandoned scans. */ }
          if (activeGeminiToken === token) activeGeminiToken = null
        }
      }
      const token = randomUUID()
      pendingPassports.set(token, { path: filePath, owner: event.sender.id, fileName: basename(filePath), mimeType,
        expiresAt: Date.now() + 10 * 60_000, hash: createHash('sha256').update(image).digest('hex') })
      return { token, fileName: basename(filePath), mimeType, previewDataUrl: `data:${mimeType};base64,${image.toString('base64')}`,
        text: ocr.text, fields: ocr.extraction.fields, assessments: ocr.extraction.assessments, profile: ocr.extraction.profile, mrz: ocr.mrz,
        ...(diagnostics ? { diagnostics } : {}) }
    })
    for (const [channel, action] of [
      ['attendance:self:status', 'status'], ['attendance:self:check-in', 'check-in'],
      ['attendance:self:check-out', 'check-out'], ['attendance:self:calendar', 'calendar']
    ] as const) {
      ipcMain.handle(channel, (event, ...args: number[]) => {
        check(event)
        return remote(action, args)
      })
    }
    ipcMain.handle('documents:list-all', (event) => { check(event); return remote('documents-list') })
    const download = async (storage: 'application' | 'customer' | 'hr-document' | 'hr-candidate', id: unknown) => {
      const documentId = validId(id)
      const pieces: Buffer[] = []
      let offset = 0
      let size = 0
      let name = ''
      do {
        const chunk = await (storage === 'hr-document' || storage === 'hr-candidate'
          ? hr('hr:file:download', [storage === 'hr-document' ? 'document' : 'candidate', documentId, offset])
          : workspace('file:download', [storage, documentId, offset])) as { name?: unknown; size?: unknown; data?: unknown }
        if (!chunk || typeof chunk.name !== 'string' || basename(chunk.name) !== chunk.name
          || !['.pdf', '.jpg', '.jpeg', '.png'].includes(extname(chunk.name).toLowerCase())
          || /[\\/:*?"<>|\x00-\x1f]/.test(chunk.name) || chunk.name.length > 180
          || !Number.isSafeInteger(chunk.size) || Number(chunk.size) < 1 || Number(chunk.size) > DOCUMENT_MAX_SIZE
          || typeof chunk.data !== 'string' || chunk.data.length > Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4) throw new Error('Invalid document response.')
        if (offset && (chunk.size !== size || chunk.name !== name)) throw new Error('Document changed during download.')
        size = Number(chunk.size)
        name = chunk.name
        const bytes = Buffer.from(chunk.data, 'base64')
        if (bytes.toString('base64') !== chunk.data || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, size - offset)) throw new Error('Invalid document response.')
        pieces.push(bytes)
        offset += bytes.length
      } while (offset < size)
      const result = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] })
      if (result.canceled || !result.filePath) return
      if (extname(result.filePath).toLowerCase() !== extname(name).toLowerCase()) throw new Error('Save the document using its original file extension.')
      await writeFile(result.filePath, Buffer.concat(pieces, size))
      const error = await shell.openPath(result.filePath)
      if (error) throw new Error(`The document was saved, but could not be opened: ${error}`)
    }
    ipcMain.handle('documents:open', (event, id) => { check(event); return download('application', id) })
    ipcMain.handle('customer-documents:open', (event, id) => { check(event); return download('customer', id) })
    ipcMain.handle('hr:documents:open', (event, id) => { check(event); return download('hr-document', id) })
    ipcMain.handle('hr:candidates:open-file', (event, id) => { check(event); return download('hr-candidate', id) })
    const connectionLost = (error: unknown) => error instanceof Error && [
      'Could not securely connect to the office server.', 'Server connection timed out.', 'Server closed the connection.'
    ].includes(error.message)
    ipcMain.handle('hr:candidates:create', async (event, input) => {
      check(event)
      try { return await hr('hr:candidates:create', [input]) }
      catch (error) {
        if (connectionLost(error)) throw new Error('Candidate confirmation was lost. Check the CVs Bank before retrying.')
        throw error
      }
    })
    const upload = async (kind: 'application' | 'customer' | 'photo' | 'passport', target: number | null, related: number | null, fileName: string, bytes: Buffer) => {
      const token = await workspace('file:begin', [kind, target, related, fileName, bytes.length])
      if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid upload response.')
      let finishing = false
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length)
          if (await workspace('file:chunk', [token, offset, bytes.subarray(offset, end).toString('base64')]) !== end) throw new Error('The server did not acknowledge the upload.')
        }
        finishing = true
        return await workspace('file:finish', [token])
      } catch (error) {
        try { await workspace('file:cancel', [token]) } catch { /* Abandoned uploads expire on the server. */ }
        if (finishing && kind !== 'passport' && connectionLost(error)) throw new Error('Upload confirmation was lost. Check the record before retrying; the file may already be saved.')
        throw error
      }
    }
    const chooseUpload = async (kind: 'application' | 'customer' | 'photo', target: unknown, related: unknown = null) => {
      const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Documents', extensions: kind === 'photo' ? ['jpg', 'jpeg', 'png'] : ['pdf', 'jpg', 'jpeg', 'png'] }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const source = selected.filePaths[0]
      const details = await stat(source)
      const limit = kind === 'photo' ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE
      if (!details.isFile() || details.size < 1 || details.size > limit) throw new Error('The selected file is empty or too large.')
      const data = await readFile(source)
      if (data.length !== details.size) throw new Error('The selected file changed. Choose it again.')
      return upload(kind, validId(target), related == null ? null : validId(related), basename(source), data)
    }
    ipcMain.handle('documents:upload', (event, target) => { check(event); return chooseUpload('application', target) })
    ipcMain.handle('customer-documents:upload', (event, target, related) => { check(event); return chooseUpload('customer', target, related) })
    ipcMain.handle('customers:set-photo', (event, target) => { check(event); return chooseUpload('photo', target) })
    const uploadHr = async (kind: 'photo' | 'document' | 'candidate', target: number | null, fileName: string, bytes: Buffer, metadata: unknown = null) => {
      const token = await hr('hr:file:begin', [kind, target, fileName, bytes.length, metadata])
      if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid upload response.')
      let finishing = false
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length)
          if (await hr('hr:file:chunk', [token, offset, bytes.subarray(offset, end).toString('base64')]) !== end) throw new Error('The server did not acknowledge the upload.')
        }
        finishing = true
        return await hr('hr:file:finish', [token])
      } catch (error) {
        try { await hr('hr:file:cancel', [token]) } catch { /* Abandoned uploads expire. */ }
        if (finishing && kind !== 'candidate' && connectionLost(error)) throw new Error('Upload confirmation was lost. Check the HR record before retrying.')
        throw error
      }
    }
    const selectHrFile = async (photo: boolean) => {
      const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: photo ? 'Profile image' : 'HR documents', extensions: photo ? ['jpg', 'jpeg', 'png'] : ['pdf', 'jpg', 'jpeg', 'png'] }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const path = selected.filePaths[0]
      const details = await stat(path)
      if (!details.isFile() || details.size < 1 || details.size > (photo ? 10 * 1024 * 1024 : DOCUMENT_MAX_SIZE)) throw new Error('The selected file is empty or too large.')
      const data = await readFile(path)
      if (data.length !== details.size) throw new Error('The selected file changed. Choose it again.')
      return { path, fileName: basename(path), data }
    }
    ipcMain.handle('hr:employees:set-photo', async (event, target) => {
      check(event); const file = await selectHrFile(true)
      return file ? uploadHr('photo', validId(target), file.fileName, file.data) : null
    })
    ipcMain.handle('hr:documents:upload', async (event, target, metadata) => {
      check(event); const file = await selectHrFile(false)
      return file ? uploadHr('document', validId(target), file.fileName, file.data, metadata) : null
    })
    ipcMain.handle('hr:candidates:select-file', async (event) => {
      check(event)
      const file = await selectHrFile(false)
      if (!file) return null
      let suggestedName = candidateNameFromFileName(file.fileName)
      let nameSource: 'ocr' | 'filename' = 'filename'
      let suggestionNote: string | undefined
      if (['.jpg', '.jpeg', '.png'].includes(extname(file.fileName).toLowerCase())) {
        try {
          const recognized = candidateNameFromText((await recognizePassport(file.path, root, [], 'eng+ara')).text)
          if (recognized) { suggestedName = recognized; nameSource = 'ocr' }
        } catch { suggestionNote = 'Offline name recognition could not read this image; the filename suggestion is shown.' }
      }
      const result = await uploadHr('candidate', null, file.fileName, file.data) as { uploadId?: unknown; fileName?: unknown }
      if (typeof result?.uploadId !== 'string' || result.fileName !== file.fileName) throw new Error('Invalid candidate upload response.')
      return { uploadId: result.uploadId, fileName: file.fileName, suggestedName, nameSource, suggestionNote }
    })
    ipcMain.handle('applications:create', async (event, value: unknown) => {
      check(event)
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid application details.')
      const input = value as NewApplication
      let staged: string | undefined
      if (input.passportToken) {
        const pending = pendingPassports.get(input.passportToken)
        if (!pending || pending.owner !== event.sender.id || pending.expiresAt < Date.now()) throw new Error('Passport preview expired. Scan it again.')
        const bytes = await readFile(pending.path)
        if (!bytes.length || bytes.length > DOCUMENT_MAX_SIZE || createHash('sha256').update(bytes).digest('hex') !== pending.hash) throw new Error('The passport file changed. Scan it again.')
        const result = await upload('passport', null, null, pending.fileName, bytes) as { passportToken?: unknown }
        if (typeof result?.passportToken !== 'string') throw new Error('Invalid passport upload response.')
        staged = result.passportToken
      }
      try {
        const result = await workspace('applications:create', [{ ...input, ...(staged ? { passportToken: staged } : {}) }])
        if (input.passportToken) pendingPassports.delete(input.passportToken)
        return result
      } catch (error) {
        if (staged) { try { await workspace('file:cancel', [staged]) } catch { /* Staged passports expire. */ } }
        if (connectionLost(error)) throw new Error('Application confirmation was lost. Check the pipeline before retrying; the application may already exist.')
        throw error
      }
    })
    ipcMain.handle('documents:upload-by-reference', async (event, reference: unknown) => {
      check(event)
      if (typeof reference !== 'string' || !reference.trim() || reference.length > 80) throw new Error('Enter an application reference.')
      const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const source = selected.filePaths[0]
      const details = await stat(source)
      if (!details.isFile() || details.size < 1 || details.size > DOCUMENT_MAX_SIZE) throw new Error('Document must be between 1 byte and 25 MB.')
      if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(extname(source).toLowerCase())) throw new Error('Unsupported document format.')
      const bytes = await readFile(source)
      if (bytes.length !== details.size || bytes.length > DOCUMENT_MAX_SIZE) throw new Error('The selected file changed. Choose it again.')
      const token = await remote('document-begin', [reference.trim(), basename(source), bytes.length])
      if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid upload response.')
      let finishing = false
      try {
        for (let offset = 0; offset < bytes.length; offset += DOCUMENT_CHUNK_SIZE) {
          const end = Math.min(offset + DOCUMENT_CHUNK_SIZE, bytes.length)
          const received = await remote('document-chunk', [token, offset, bytes.subarray(offset, end).toString('base64')])
          if (received !== end) throw new Error('The server did not acknowledge the upload.')
        }
        finishing = true
        return await remote('document-finish', [token])
      } catch (error) {
        try { await remote('document-cancel', [token]) } catch { /* The server also expires abandoned uploads. */ }
        if (finishing) throw new Error('Upload confirmation failed. Check the document library before retrying; the file may already be saved.')
        throw error
      }
    })
    await createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(showStartupError) })
    return
  }
  const docsDir = join(root, 'documents')
  const geminiScanner = new GeminiPassportScanner(root)
  let db: Database.Database
  try {
    db = openDatabase(join(root, 'database', 'blueline.db'))
  } catch (error) {
    recordDiagnostic('database-initialization-failed', error, true)
    throw error
  }
  const removedCandidatePaths = listHrCandidatePathsForDepartmentPurge(db)
  const candidateDirectory = resolve(docsDir, 'hr', 'cvs')
  for (const filePath of removedCandidatePaths) {
    if (!isAbsolute(filePath)) throw new Error('A removed CV candidate file has an invalid stored path.')
    const relativePath = relative(candidateDirectory, resolve(filePath))
    if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error('A removed CV candidate file is outside the private CV storage directory.')
    }
    await rm(resolve(filePath), { force: true })
  }
  purgeHrCandidatesFromDepartments(db, 'System migration')
  if (lanConfig.mode === 'server') {
    const documents = new LanDocuments(db, docsDir)
    const resizeImage = (bytes: Buffer, max: number) => {
      const image = nativeImage.createFromBuffer(bytes)
      const size = image.getSize()
      if (image.isEmpty() || !size.width || !size.height || size.width * size.height > 40_000_000) throw new Error('Invalid image.')
      const factor = Math.min(1, max / Math.max(size.width, size.height))
      return image.resize({ width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)), quality: 'good' })
    }
    const convertImage = (bytes: Buffer, max: number) => resizeImage(bytes, max).toJPEG(80)
    const crm = new LanCrm(db, root, documents, convertImage)
    const hr = new LanHr(db, root, convertImage)
    const workspace = new LanWorkspace(db, root, (bytes, max) => resizeImage(bytes, max).toPNG(), (user, session) => { hr.execute(user, session, 'hr:auth:check', []) })
    const gemini = new LanGemini(root, async () => (await geminiScanner.getSettings()).configured, async (path, mime, local) => {
      const settings = await geminiScanner.getSettings()
      return geminiScanner.inspectImage(path, mime, local, settings.model)
    })
    const service = await startAttendanceServer(root, lanConfig, {
      authenticate: (username, password) => authenticate(db, username, password),
      documents, crm, hr, workspace, gemini,
      attendance: (action, user, args) => {
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        if (action === 'status') return getHrSelfAttendanceStatus(db, user.id, date)
        if (action === 'check-in') return clockInHrAttendanceForUser(db, user.id, user.displayName)
        if (action === 'check-out') return clockOutHrAttendanceForUser(db, user.id, user.displayName)
        return getHrSelfAttendanceCalendar(db, user.id, args[0], args[1])
      }
    })
    serverFingerprint = service.fingerprint
    app.once('before-quit', () => service.server.close())
  }
  ipcMain.handle('auth:session', (event) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    return authenticatedUser
  })
  ipcMain.handle('auth:login', (event, username: unknown, password: unknown) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    const user = authenticate(db, username, password)
    if (!user) throw new Error('Username or password is incorrect.')
    hrUnlocked = false
    authenticatedUser = user
    return user
  })
  ipcMain.handle('auth:logout', (event) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    authenticatedUser = null
    hrUnlocked = false
  })
  secureHandle('dashboard', () => getDashboard(db))
  const localDate = () => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }
  ipcMain.handle('attendance:self:status', (event) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    if (!authenticatedUser) throw new Error('Please sign in to continue.')
    requireModuleAccess('My Attendance', 'Dashboard')
    return getHrSelfAttendanceStatus(db, authenticatedUser.id, localDate())
  })
  ipcMain.handle('attendance:self:check-in', (event) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    if (!authenticatedUser) throw new Error('Please sign in to continue.')
    requireModuleAccess('My Attendance', 'Dashboard')
    return clockInHrAttendanceForUser(db, authenticatedUser.id, authenticatedUser.displayName)
  })
  ipcMain.handle('attendance:self:check-out', (event) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    if (!authenticatedUser) throw new Error('Please sign in to continue.')
    requireModuleAccess('My Attendance', 'Dashboard')
    return clockOutHrAttendanceForUser(db, authenticatedUser.id, authenticatedUser.displayName)
  })
  ipcMain.handle('attendance:self:calendar', (event, year: unknown, month: unknown) => {
    if (!isMainWindowEvent(event)) throw new Error('Untrusted application window.')
    if (!authenticatedUser) throw new Error('Please sign in to continue.')
    requireModuleAccess('My Attendance')
    return getHrSelfAttendanceCalendar(db, authenticatedUser.id, Number(year), Number(month))
  })
  secureHandle('hr:auth:status', () => ({ configured: isHrPasswordConfigured(db) }))
  secureHandle('hr:auth:setup', (_event, password) => {
    if (authenticatedUser!.role !== 'admin') throw new Error('Only an administrator can create or change the HR password.')
    if (typeof password !== 'string') throw new Error('Invalid HR password.')
    setInitialHrPassword(db, authenticatedUser!.username, password)
    hrUnlocked = true
  })
  secureHandle('hr:auth:unlock', (_event, password) => {
    if (typeof password !== 'string' || !isHrPasswordConfigured(db) || !verifyHrPassword(db, password)) {
      throw new Error('The HR password is incorrect.')
    }
    hrUnlocked = true
  })
  secureHandle('hr:auth:change', (_event, currentPassword, newPassword) => {
    if (authenticatedUser!.role !== 'admin') throw new Error('Only an administrator can change the HR password.')
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') throw new Error('Invalid HR password.')
    changeHrPassword(db, authenticatedUser!.username, currentPassword, newPassword)
  })
  secureHandle('hr:auth:reset', (_event, administratorPassword, newPassword) => {
    if (authenticatedUser!.role !== 'admin') throw new Error('Only an administrator can reset the HR password.')
    if (typeof administratorPassword !== 'string' || typeof newPassword !== 'string') throw new Error('Invalid password.')
    if (!isHrPasswordConfigured(db)) throw new Error('The HR password is not configured.')
    if (!authenticate(db, authenticatedUser!.username, administratorPassword)) throw new Error('The administrator password is incorrect.')
    resetHrPassword(db, authenticatedUser!.username, newPassword)
    hrUnlocked = true
  })
  secureHandle('hr:dashboard', () => getHrDashboard(db, localDate()))
  secureHandle('hr:departments:list', () => listHrDepartments(db))
  secureHandle('hr:departments:save', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.name !== 'string' || typeof input.description !== 'string'
      || (input.id !== undefined && !Number.isSafeInteger(input.id))) throw new Error('Invalid department details.')
    saveHrDepartment(db, authenticatedUser!.displayName, input)
  })
  secureHandle('hr:employees:list', (_event, search, includeArchived) => {
    if ((search !== undefined && typeof search !== 'string')
      || (includeArchived !== undefined && typeof includeArchived !== 'boolean')) throw new Error('Invalid employee filters.')
    return listHrEmployees(db, search, includeArchived).map(withHrEmployeePhoto)
  })
  secureHandle('hr:employees:profile', (_event, id) => {
    const profile = getHrEmployeeProfileData(db, validId(id))
    return { ...profile, employee: withHrEmployeePhoto(profile.employee) }
  })
  secureHandle('hr:employees:set-photo', async (_event, id) => {
    const employeeId = validId(id)
    getHrEmployeePhotoPath(db, employeeId)
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Employee profile image', extensions: ['jpg', 'jpeg', 'png'] }]
    })
    if (canceled || !filePaths[0]) return null
    const source = filePaths[0]
    const details = await stat(source)
    if (!details.isFile() || details.size > 10 * 1024 * 1024) throw new Error('Profile image must be smaller than 10 MB.')
    const extension = extname(source).toLowerCase()
    if (!['.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('Unsupported profile image format.')
    if (nativeImage.createFromPath(source).isEmpty()) throw new Error('The selected profile image could not be decoded.')
    const directory = join(docsDir, 'hr', 'employee-photos')
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${employeeId}-${randomUUID()}${extension}`)
    await copyFile(source, destination)
    try {
      const photoDataUrl = readHrEmployeePhotoDataUrl(destination)
      if (!photoDataUrl) throw new Error('The selected profile image could not be processed.')
      setHrEmployeePhotoPath(db, authenticatedUser!.displayName, employeeId, destination)
      return photoDataUrl
    } catch (error) {
      await rm(destination, { force: true })
      throw error
    }
  })
  secureHandle('hr:employees:save', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || (input.id !== undefined && !Number.isSafeInteger(input.id))
      || typeof input.fullName !== 'string' || typeof input.phone !== 'string'
      || typeof input.email !== 'string' || typeof input.jobTitle !== 'string'
      || typeof input.hireDate !== 'string' || typeof input.employmentType !== 'string'
      || typeof input.status !== 'string' || !Number.isSafeInteger(input.hourlyRate)
      || !(input.departmentId === null || Number.isSafeInteger(input.departmentId))
      || (input.workStart !== undefined && !(input.workStart === null || typeof input.workStart === 'string'))
      || (input.workEnd !== undefined && !(input.workEnd === null || typeof input.workEnd === 'string'))
      || (input.appUserId !== undefined && !(input.appUserId === null
        || (Number.isSafeInteger(input.appUserId) && Number(input.appUserId) > 0)))) throw new Error('Invalid employee details.')
    if (input.appUserId !== undefined && authenticatedUser!.role !== 'admin') {
      throw new Error('Only an administrator can assign application users to employees.')
    }
    const { id, ...employee } = input
    return withHrEmployeePhoto(saveHrEmployee(db, authenticatedUser!.displayName, {
      ...employee, ...(id === undefined ? {} : { id: validId(id) })
    }))
  })
  secureHandle('hr:employees:archive', (_event, id, archived) => {
    if (typeof archived !== 'boolean') throw new Error('Invalid archive action.')
    archiveHrEmployee(db, authenticatedUser!.displayName, validId(id), archived)
  })
  secureHandle('hr:employees:delete', async (_event, id) => {
    const employeeId = validId(id)
    const employeeDocumentDirectory = resolve(docsDir, 'hr', String(employeeId))
    const employeePhotoDirectory = resolve(docsDir, 'hr', 'employee-photos')
    const filePaths = getHrEmployeeStoredFilePaths(db, employeeId)
    for (const filePath of filePaths) {
      const absolutePath = resolve(filePath)
      const documentRelativePath = relative(employeeDocumentDirectory, absolutePath)
      const isEmployeeDocument = Boolean(documentRelativePath) && documentRelativePath !== '..'
        && !documentRelativePath.startsWith(`..${sep}`) && !isAbsolute(documentRelativePath)
      const isEmployeePhoto = resolve(dirname(absolutePath)) === employeePhotoDirectory
        && basename(absolutePath).startsWith(`${employeeId}-`)
      if (!isEmployeeDocument && !isEmployeePhoto) {
        throw new Error('Employee files are outside their managed HR storage location; no employee data was deleted.')
      }
    }
    const storedPaths = deleteHrEmployee(db, authenticatedUser!.displayName, employeeId)
    try {
      for (const filePath of storedPaths) await rm(filePath, { force: true })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`Employee data was deleted, but a stored HR file could not be removed: ${reason}`)
    }
  })
  secureHandle('hr:attendance:list', (_event, date) => {
    if (typeof date !== 'string') throw new Error('Invalid attendance date.')
    return listHrAttendance(db, date)
  })
  secureHandle('hr:attendance:calendar', (_event, year, month, employeeId) => {
    if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month)
      || (employeeId !== undefined && (!Number.isSafeInteger(employeeId) || Number(employeeId) <= 0))) {
      throw new Error('Invalid attendance calendar selection.')
    }
    return listHrAttendanceCalendar(db, year, month, employeeId === undefined ? undefined : Number(employeeId))
  })
  secureHandle('hr:attendance:clock-in', (_event, id) => clockHrAttendance(db, authenticatedUser!.displayName, validId(id), 'in'))
  secureHandle('hr:attendance:clock-out', (_event, id) => clockHrAttendance(db, authenticatedUser!.displayName, validId(id), 'out'))
  secureHandle('hr:attendance:save', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || !Number.isSafeInteger(input.employeeId) || typeof input.attendanceDate !== 'string'
      || !(input.checkIn === null || typeof input.checkIn === 'string')
      || !(input.checkOut === null || typeof input.checkOut === 'string')
      || typeof input.status !== 'string' || typeof input.notes !== 'string') throw new Error('Invalid attendance details.')
    saveHrAttendance(db, authenticatedUser!.displayName, input)
  })
  secureHandle('hr:attendance:mark-all-present', (_event, date) => {
    if (typeof date !== 'string') throw new Error('Invalid attendance date.')
    return markAllHrEmployeesPresent(db, authenticatedUser!.displayName, date)
  })
  secureHandle('hr:leaves:list', (_event, status) => {
    if (status !== undefined && typeof status !== 'string') throw new Error('Invalid leave filter.')
    return listHrLeaveRequests(db, status)
  })
  secureHandle('hr:leaves:create', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || !Number.isSafeInteger(input.employeeId) || typeof input.leaveType !== 'string'
      || typeof input.startDate !== 'string' || typeof input.endDate !== 'string'
      || typeof input.totalDays !== 'number' || typeof input.reason !== 'string') throw new Error('Invalid leave request.')
    createHrLeaveRequest(db, authenticatedUser!.displayName, input)
  })
  secureHandle('hr:leaves:decide', (_event, id, status) => {
    if (status !== 'Approved' && status !== 'Rejected') throw new Error('Invalid leave decision.')
    decideHrLeaveRequest(db, authenticatedUser!.displayName, validId(id), status)
  })
  secureHandle('hr:leave-balances:list', (_event, year) => {
    if (!Number.isSafeInteger(year)) throw new Error('Invalid leave-balance year.')
    return listHrLeaveBalances(db, year)
  })
  secureHandle('hr:leave-balances:save', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || !Number.isSafeInteger(input.employeeId) || typeof input.leaveType !== 'string'
      || !Number.isSafeInteger(input.year) || typeof input.allocatedDays !== 'number') throw new Error('Invalid leave-balance details.')
    saveHrLeaveBalance(db, authenticatedUser!.displayName, input)
  })
  secureHandle('hr:documents:list', (_event, employeeId) => {
    if (employeeId !== undefined && !Number.isSafeInteger(employeeId)) throw new Error('Invalid employee ID.')
    return listHrDocuments(db, employeeId)
  })
  secureHandle('hr:documents:upload', async (_event, employeeId, metadata) => {
    const id = validId(employeeId)
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || typeof metadata.documentType !== 'string'
      || (metadata.issueDate !== undefined && typeof metadata.issueDate !== 'string')
      || (metadata.expirationDate !== undefined && typeof metadata.expirationDate !== 'string')) throw new Error('Invalid employee document details.')
    if (!db.prepare('SELECT 1 FROM hr_employees WHERE id = ?').get(id)) throw new Error('Employee not found.')
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Employee documents', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }]
    })
    if (canceled || !filePaths[0]) return null
    const source = filePaths[0]
    const details = await stat(source)
    if (!details.isFile() || details.size > 25 * 1024 * 1024) throw new Error('Document must be smaller than 25 MB.')
    const extension = extname(source).toLowerCase()
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('Unsupported document format.')
    const directory = join(docsDir, 'hr', String(id))
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${randomUUID()}${extension}`)
    await copyFile(source, destination)
    try {
      return addHrDocument(db, authenticatedUser!.displayName, {
        employeeId: id, documentName: basename(source), documentType: metadata.documentType,
        issueDate: metadata.issueDate, expirationDate: metadata.expirationDate, filePath: destination
      })
    } catch (error) {
      await rm(destination, { force: true })
      throw error
    }
  })
  secureHandle('hr:documents:open', async (_event, documentId) => {
    const filePath = getHrDocumentPath(db, validId(documentId))
    if (!existsSync(filePath)) throw new Error('Employee document file not found.')
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
  })
  secureHandle('hr:candidates:list', () => listHrCandidates(db))
  secureHandle('hr:candidates:select-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CVs and photos', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }]
    })
    if (canceled || !filePaths[0]) return null
    const source = filePaths[0]
    const details = await stat(source)
    if (!details.isFile() || details.size > 25 * 1024 * 1024) throw new Error('Candidate file must be smaller than 25 MB.')
    const extension = extname(source).toLowerCase()
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('Unsupported candidate file format.')
    const fileName = basename(source)
    const uploadId = randomUUID()
    const stagingDirectory = join(docsDir, 'hr', 'cv-staging')
    await mkdir(stagingDirectory, { recursive: true })
    const stagedPath = join(stagingDirectory, `${uploadId}${extension}`)
    await copyFile(source, stagedPath)
    pendingHrCandidateUploads.set(uploadId, { filePath: stagedPath, fileName })
    let suggestedName = candidateNameFromFileName(fileName)
    let nameSource: 'ocr' | 'filename' = 'filename'
    let suggestionNote: string | undefined
    if (['.jpg', '.jpeg', '.png'].includes(extension)) {
      try {
        const recognizedName = candidateNameFromText((await recognizePassport(stagedPath, root, [], 'eng+ara')).text)
        if (recognizedName) {
          suggestedName = recognizedName
          nameSource = 'ocr'
        }
      } catch (error) {
        recordDiagnostic('hr-candidate-name-recognition-failed', error)
        nameSource = 'filename'
        suggestionNote = 'Offline name recognition could not read this image; the filename suggestion is shown.'
      }
    }
    return { uploadId, fileName, suggestedName, nameSource, suggestionNote }
  })
  secureHandle('hr:candidates:cancel-upload', async (_event, uploadId) => {
    if (typeof uploadId !== 'string') throw new Error('Invalid candidate upload.')
    const pending = pendingHrCandidateUploads.get(uploadId)
    if (!pending) return
    pendingHrCandidateUploads.delete(uploadId)
    await rm(pending.filePath, { force: true })
  })
  secureHandle('hr:candidates:create', async (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || typeof input.uploadId !== 'string'
      || typeof input.fullName !== 'string' || typeof input.phone !== 'string'
      || typeof input.email !== 'string' || !Number.isSafeInteger(input.departmentId)
      || typeof input.notes !== 'string') throw new Error('Invalid candidate details.')
    const pending = pendingHrCandidateUploads.get(input.uploadId)
    if (!pending) throw new Error('Candidate upload expired. Choose the file again.')
    const destinationDirectory = join(docsDir, 'hr', 'cvs')
    await mkdir(destinationDirectory, { recursive: true })
    const filePath = join(destinationDirectory, `${randomUUID()}${extname(pending.fileName).toLowerCase()}`)
    await copyFile(pending.filePath, filePath)
    let candidate: ReturnType<typeof addHrCandidate>
    try {
      const details: HrCandidateDraft = {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        departmentId: input.departmentId,
        notes: input.notes
      }
      candidate = addHrCandidate(db, authenticatedUser!.displayName, details, pending.fileName, filePath)
    } catch (error) {
      await rm(filePath, { force: true })
      throw error
    }
    pendingHrCandidateUploads.delete(input.uploadId)
    try {
      await rm(pending.filePath, { force: true })
    } catch (error) {
      recordDiagnostic('hr-candidate-staging-cleanup-failed', error)
    }
    return candidate
  })
  secureHandle('hr:candidates:update', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || !Number.isSafeInteger(input.id) || typeof input.fullName !== 'string'
      || typeof input.phone !== 'string' || typeof input.email !== 'string'
      || !Number.isSafeInteger(input.departmentId) || typeof input.notes !== 'string') {
      throw new Error('Invalid candidate details.')
    }
    const details: HrCandidateUpdate = {
      id: input.id,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      departmentId: input.departmentId,
      notes: input.notes
    }
    return updateHrCandidate(db, authenticatedUser!.displayName, details)
  })
  secureHandle('hr:candidates:star', (_event, id, starred) => {
    if (typeof starred !== 'boolean') throw new Error('Invalid candidate star setting.')
    setHrCandidateStarred(db, authenticatedUser!.displayName, validId(id), starred)
  })
  secureHandle('hr:candidates:open-file', async (_event, id) => {
    const filePath = getHrCandidateFilePath(db, validId(id))
    if (!existsSync(filePath)) throw new Error('Candidate file not found.')
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
  })
  secureHandle('hr:reports:export', async (_event, report) => {
    const reportNames: Record<HrReportType, string> = {
      employees: 'Employee-Directory',
      attendance: 'Attendance',
      leaves: 'Leave-Requests',
      payroll: 'Payroll-Summary',
      documents: 'Document-Expiration',
      activity: 'HR-Activity'
    }
    if (typeof report !== 'string' || !Object.hasOwn(reportNames, report)) throw new Error('Unsupported HR report.')
    const reportType = report as HrReportType
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `BlueLine-HR-${reportNames[reportType]}-${localDate()}.csv`,
      filters: [{ name: 'CSV report', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return false
    await writeFile(filePath, buildHrCsvReport(db, reportType), 'utf8')
    return true
  })
  secureHandle('hr:payroll:list', () => listHrPayrollPeriods(db))
  secureHandle('hr:payroll:calculate', (_event, employeeId, startDate, endDate) => {
    if (typeof startDate !== 'string' || typeof endDate !== 'string') throw new Error('Select a valid pay calculation date range.')
    return calculateHrPay(db, validId(employeeId), startDate, endDate)
  })
  secureHandle('hr:payroll:records:list', (_event, id) => listHrPayrollRecords(db, validId(id)))
  secureHandle('hr:payroll:item:add', (_event, id, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.itemType !== 'string' || typeof item.description !== 'string'
      || !Number.isSafeInteger(item.amount)) throw new Error('Invalid payroll item details.')
    addHrPayrollItem(db, authenticatedUser!.displayName, validId(id), item)
  })
  secureHandle('hr:payroll:generate', (_event, month, year) => {
    if (!Number.isSafeInteger(month) || !Number.isSafeInteger(year)) throw new Error('Invalid payroll period.')
    generateHrPayroll(db, authenticatedUser!.displayName, month, year)
  })
  secureHandle('hr:payroll:approve', (_event, id) => approveHrPayroll(db, authenticatedUser!.displayName, validId(id)))
  secureHandle('hr:payroll:paid', (_event, id) => markHrPayrollPaid(db, authenticatedUser!.displayName, validId(id)))
  secureHandle('applications:list', () => listApplications(db))
  secureHandle('customers:list', (_event, search) => {
    if (typeof search !== 'string' && search !== undefined) throw new Error('Invalid search query.')
    return listCustomers(db, search).map((customer) => ({
      ...customer,
      photoDataUrl: readImageDataUrl(getCustomerPhotoPath(db, customer.id))
    }))
  })
  secureHandle('customers:get-profile', (_event, id) => {
    const profile = getCustomerProfile(db, validId(id))
    profile.customer.photoDataUrl = readImageDataUrl(getCustomerPhotoPath(db, profile.customer.id))
    return profile
  })
  secureHandle('customers:update', (_event, id, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid customer details.')
    updateCustomer(db, validId(id), input)
  })
  secureHandle('customers:set-photo', async (_event, id) => {
    const customerId = validId(id)
    getCustomerPhotoPath(db, customerId)
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Profile image', extensions: ['jpg', 'jpeg', 'png'] }] })
    if (canceled || !filePaths[0]) return null
    const source = filePaths[0]
    const details = await stat(source)
    if (!details.isFile() || details.size > 10 * 1024 * 1024) throw new Error('Profile image must be smaller than 10 MB.')
    const extension = extname(source).toLowerCase()
    if (!['.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('Unsupported profile image format.')
    const directory = join(root, 'customer-photos')
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${customerId}-${Date.now()}${extension}`)
    await copyFile(source, destination)
    const previous = getCustomerPhotoPath(db, customerId)
    setCustomerPhotoPath(db, customerId, destination)
    if (previous && existsSync(previous)) await rm(previous, { force: true })
    return readImageDataUrl(destination)
  })
  secureHandle('customer-documents:upload', async (_event, id, applicationId) => {
    const customerId = validId(id)
    getCustomerProfile(db, customerId)
    const recordId = applicationId === undefined ? null : validId(applicationId)
    if (recordId !== null && !db.prepare('SELECT 1 FROM applications WHERE id = ? AND customer_id = ? AND deleted_at IS NULL').get(recordId, customerId)) {
      throw new Error('Application does not belong to this customer.')
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Customer documents', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] })
    if (canceled || !filePaths[0]) return null
    const source = filePaths[0]
    const details = await stat(source)
    if (!details.isFile() || details.size > 25 * 1024 * 1024) throw new Error('Document must be smaller than 25 MB.')
    const extension = extname(source).toLowerCase()
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(extension)) throw new Error('Unsupported document format.')
    const directory = join(docsDir, 'customers', String(customerId))
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `${Date.now()}-${basename(source).replace(/[^\w.-]/g, '_')}`)
    await copyFile(source, destination)
    const result = db.prepare(`INSERT INTO customer_documents(customer_id, application_record_id, file_name, file_path, document_type)
      VALUES (?, ?, ?, ?, 'Supporting document')`).run(customerId, recordId, basename(source), destination)
    return { id: Number(result.lastInsertRowid), applicationId: null, category: 'Supporting document', fileName: basename(source), addedAt: new Date().toISOString(), applicationRecordId: recordId, storage: 'customer' }
  })
  secureHandle('customer-documents:open', async (_event, id) => {
    const row = db.prepare('SELECT file_path FROM customer_documents WHERE id = ?').get(validId(id)) as { file_path: string } | undefined
    if (!row || !existsSync(row.file_path)) throw new Error('Customer document file not found.')
    const error = await shell.openPath(row.file_path)
    if (error) throw new Error(error)
  })
  secureHandle('applications:create', (event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid application details.')
    const application = input as NewApplication
    let passport: PendingPassport | undefined
    if (application.passportToken) {
      passport = pendingPassports.get(application.passportToken)
      if (!passport || passport.owner !== event.sender.id || passport.expiresAt < Date.now()) throw new Error('Passport preview expired. Please scan the document again.')
    }
    const storedPath = passport ? join(docsDir, 'passports', `${randomUUID()}${extname(passport.path).toLowerCase()}`) : undefined
    if (passport && storedPath) {
      mkdirSync(join(docsDir, 'passports'), { recursive: true })
      copyFileSync(passport.path, storedPath)
    }
    try {
      const { passportToken: _passportToken, ...details } = application
      const created = createApplication(db, details, storedPath)
      if (passport) pendingPassports.delete(application.passportToken!)
      return created
    } catch (error) {
      if (storedPath) rmSync(storedPath, { force: true })
      throw error
    }
  })
  secureHandle('applications:move', (_event, id, status) => {
    if (typeof status !== 'string') throw new Error('Invalid pipeline stage.')
    moveApplication(db, validId(id), status)
  })
  secureHandle('applications:update', (_event, id, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid application details.')
    updateApplication(db, validId(id), input)
  })
  secureHandle('applications:activities:list', (_event, id) => listApplicationActivities(db, validId(id)))
  secureHandle('applications:activities:add', (_event, id, activity) => {
    if (!activity || typeof activity !== 'object' || Array.isArray(activity)
      || typeof activity.activityType !== 'string' || typeof activity.description !== 'string') {
      throw new Error('Invalid activity details.')
    }
    addApplicationActivity(db, validId(id), activity)
  })
  secureHandle('applications:delete', (_event, id) => deleteApplication(db, validId(id)))
  secureHandle('pipelines:list', () => listPipelines(db))
  secureHandle('pipelines:save', (_event, pipeline) => {
    if (!pipeline || typeof pipeline.name !== 'string' || !Array.isArray(pipeline.stages) || pipeline.stages.some((stage: unknown) => typeof stage !== 'string')) throw new Error('Invalid pipeline details.')
    savePipeline(db, pipeline)
  })
  secureHandle('pipelines:delete', (_event, id) => deletePipeline(db, validId(id)))
  secureHandle('catalog:list', (_event, kind) => {
    if (kind !== 'visaType' && kind !== 'country') throw new Error('Invalid catalog.')
    return listCatalog(db, kind)
  })
  secureHandle('catalog:save', (_event, kind, item) => {
    if ((kind !== 'visaType' && kind !== 'country') || !item || typeof item.name !== 'string' || typeof item.active !== 'boolean') throw new Error('Invalid catalog entry.')
    saveCatalogItem(db, kind, item)
  })
  secureHandle('catalog:delete', (_event, kind, id) => {
    if (kind !== 'visaType' && kind !== 'country') throw new Error('Invalid catalog.')
    deleteCatalogItem(db, kind, validId(id))
  })
  secureHandle('documents:upload', async (_event, appId) => {
    const id = validId(appId)
    const exists = db.prepare('SELECT application_id FROM applications WHERE id = ?').get(id) as { application_id: string } | undefined
    if (!exists) throw new Error('Application not found.')
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Documents', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const source = result.filePaths[0]
    const stat = await import('node:fs/promises').then((fs) => fs.stat(source))
    if (stat.size > 25 * 1024 * 1024) throw new Error('File exceeds the 25 MB limit.')
    const ext = extname(source).toLowerCase()
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) throw new Error('Unsupported document format.')
    const directory = join(docsDir, 'applications', exists.application_id)
    await mkdir(directory, { recursive: true })
    const safeName = `${Date.now()}-${basename(source).replace(/[^\w.-]/g, '_')}`
    const destination = join(directory, safeName)
    await copyFile(source, destination)
    const record = db.prepare('INSERT INTO documents(application_id, category, file_name, file_path) VALUES (?, ?, ?, ?)').run(id, 'Supporting Document', basename(source), destination)
    db.prepare("INSERT INTO application_activities(application_id, activity_type, description) VALUES (?, 'Document Added', ?)").run(id, `Document uploaded: ${basename(source)}`)
    return db.prepare('SELECT id, (SELECT application_id FROM applications WHERE id = ?) AS applicationId, category, file_name AS fileName, added_at AS addedAt FROM documents WHERE id = ?').get(id, Number(record.lastInsertRowid))
  })
  secureHandle('documents:list', (_event, appId) => {
    return db.prepare(`SELECT d.id, a.application_id AS applicationId, d.category, d.file_name AS fileName, d.added_at AS addedAt
      FROM documents d JOIN applications a ON a.id = d.application_id
      WHERE d.application_id = ? ORDER BY d.added_at DESC`).all(validId(appId))
  })
  secureHandle('documents:list-all', () => listAllDocuments(db))
  secureHandle('documents:open', async (_event, documentId) => {
    const item = db.prepare('SELECT file_path FROM documents WHERE id = ?').get(validId(documentId)) as { file_path: string } | undefined
    if (!item || !existsSync(item.file_path)) throw new Error('Document file not found.')
    const error = await shell.openPath(item.file_path)
    if (error) throw new Error(error)
  })
  secureHandle('settings:get', () => {
    const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
    return {
      companyName: values.companyName ?? 'Blue Line Travel',
      language: values.language === 'ar' ? 'ar' : 'en',
      companyLogoDataUrl: readImageDataUrl(values.companyLogoPath ?? '')
    }
  })
  secureHandle('settings:save', (_event, settings) => {
    if (!settings || typeof settings.companyName !== 'string' || settings.companyName.trim().length < 2 || !['en', 'ar'].includes(settings.language)) throw new Error('Invalid settings.')
    const save = db.transaction(() => {
      db.prepare('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run('companyName', settings.companyName.trim())
      db.prepare('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)').run('language', settings.language as Language)
    })
    save()
  })
  secureHandle('settings:users:list', () => {
    requireAdministrator()
    return listApplicationUsers(db)
  })
  secureHandle('settings:users:create', (_event, input) => {
    requireAdministrator()
    return createApplicationUser(db, input)
  })
  secureHandle('settings:users:update', (_event, input) => {
    const actor = requireAdministrator()
    const updated = updateApplicationUser(db, actor.id, input)
    if (updated.id === actor.id) authenticatedUser = updated
    return updated
  })
  secureHandle('settings:users:delete', (_event, id) => {
    const actor = requireAdministrator()
    deleteApplicationUser(db, actor.id, validId(id))
  })
  secureHandle('settings:set-logo', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Company logo', extensions: ['png', 'jpg', 'jpeg'] }] })
    if (canceled || !filePaths[0]) return null
    const source = filePaths[0]
    const details = await stat(source)
    if (!details.isFile() || details.size > 5 * 1024 * 1024) throw new Error('Company logo must be smaller than 5 MB.')
    const extension = extname(source).toLowerCase()
    if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('Unsupported logo format.')
    const directory = join(root, 'branding')
    await mkdir(directory, { recursive: true })
    const destination = join(directory, `company-logo${extension}`)
    await copyFile(source, destination)
    const old = db.prepare("SELECT value FROM app_settings WHERE key = 'companyLogoPath'").get() as { value: string } | undefined
    db.prepare("INSERT OR REPLACE INTO app_settings(key, value) VALUES ('companyLogoPath', ?)").run(destination)
    if (old?.value && old.value !== destination && existsSync(old.value)) await rm(old.value, { force: true })
    return readImageDataUrl(destination)
  })
  secureHandle('settings:remove-logo', async () => {
    const old = db.prepare("SELECT value FROM app_settings WHERE key = 'companyLogoPath'").get() as { value: string } | undefined
    db.prepare("DELETE FROM app_settings WHERE key = 'companyLogoPath'").run()
    if (old?.value && existsSync(old.value)) await rm(old.value, { force: true })
  })
  secureHandle('gemini:settings:get', () => geminiScanner.getSettings())
  secureHandle('gemini:models:list', (_event, apiKey: unknown) => {
    if (apiKey !== undefined && typeof apiKey !== 'string') throw new Error('The Gemini API key format is invalid.')
    return geminiScanner.listModels(apiKey)
  })
  secureHandle('gemini:settings:save', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Gemini settings.')
    return geminiScanner.saveSettings(input)
  })
  secureHandle('gemini:connection:test', (_event, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Gemini connection test settings.')
    return geminiScanner.testConnection(input)
  })
  secureHandle('passport:provider:get', async () => (await geminiScanner.getSettings()).provider)
  secureHandle('passport:provider:save', async (_event, provider: unknown) => {
    if (provider !== 'ocr' && provider !== 'gemini') throw new Error('Select a supported passport recognition engine.')
    const settings = await geminiScanner.getSettings()
    return (await geminiScanner.saveSettings({ model: settings.model, provider, apiKey: undefined })).provider
  })
  secureHandle('reports:csv', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: 'BlueLine-Visa-CRM-Applications.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (canceled || !filePath) return false
    const rows = listApplications(db)
    const escape = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const csv = ['Application ID,Customer,Phone,Country,Visa Type,Status,Employee,Application Date,Follow-up Date',
      ...rows.map((row) => [row.applicationId, row.customerName, row.phone, row.country, row.visaType, row.status, row.employee, row.applicationDate, row.followUpDate].map(escape).join(','))].join('\r\n')
    await writeFile(filePath, `\uFEFF${csv}`, 'utf8')
    return true
  })
  secureHandle('backup:create', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: `BlueLine-Backup-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'ZIP backup', extensions: ['zip'] }] })
    if (canceled || !filePath) return false
    const backupRoot = join(root, 'backups')
    mkdirSync(backupRoot, { recursive: true })
    const snapshot = join(backupRoot, `snapshot-${Date.now()}.db`)
    try {
      await db.backup(snapshot)
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(filePath)
        const archive = new ZipFile()
        archive.outputStream.on('error', reject)
        output.on('error', reject)
        output.on('close', resolve)
        archive.outputStream.pipe(output)
        archive.addFile(snapshot, 'database/blueline.db')
        if (existsSync(docsDir)) void addDocuments(archive, docsDir, 'documents').then(() => {
          archive.addBuffer(Buffer.from(JSON.stringify({ product: 'Blue Line Visa CRM', createdAt: new Date().toISOString(), format: 1 }, null, 2)), 'backup.json')
          archive.end()
        }).catch(reject)
        else {
          archive.addBuffer(Buffer.from(JSON.stringify({ product: 'Blue Line Visa CRM', createdAt: new Date().toISOString(), format: 1 }, null, 2)), 'backup.json')
          archive.end()
        }
      })
    } finally { await rm(snapshot, { force: true }) }
    return true
  })
  secureHandle('passport:inspect', async (event, filePath: unknown, preprocessingVariants: unknown, requestedProvider: unknown) => {
    let extension = ''
    let provider: PassportProvider = requestedProvider === 'gemini' ? 'gemini' : 'ocr'
    try {
      if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('PASSPORT_VALIDATION_ERROR: Choose a passport image or PDF to inspect.')
      extension = extname(filePath).toLowerCase()
      if (!['.jpg', '.jpeg', '.png', '.pdf'].includes(extension)) throw new Error('PASSPORT_VALIDATION_ERROR: Passport inspection supports JPG, JPEG, PNG, or PDF files.')
      const details = await stat(filePath).catch((error: unknown) => {
        throw new Error(`IMAGE_PROCESSING_ERROR: Unable to access the selected passport file. ${error instanceof Error ? error.message : String(error)}`)
      })
      if (!details.isFile()) throw new Error('IMAGE_PROCESSING_ERROR: The selected passport scan is not a file.')
      if (details.size > 25 * 1024 * 1024) throw new Error('IMAGE_PROCESSING_ERROR: Passport scan files must be smaller than 25 MB.')
      if (requestedProvider !== undefined && requestedProvider !== 'ocr' && requestedProvider !== 'gemini') {
        throw new Error('PASSPORT_VALIDATION_ERROR: Select a supported passport recognition engine.')
      }

      const mimeType = extension === '.pdf' ? 'application/pdf' : extension === '.png' ? 'image/png' : 'image/jpeg'
      const variants = validatePassportVariants(preprocessingVariants)
      provider = requestedProvider === 'gemini'
        ? 'gemini'
        : requestedProvider === 'ocr' ? 'ocr' : (await geminiScanner.getSettings()).provider
      let ocr = extension === '.pdf'
        ? { text: '', pages: [], mrz: null, extraction: extractIraqiPassport([], null) }
        : await recognizePassport(filePath, root, variants, 'eng').catch((error: unknown) => {
          if (provider === 'ocr') throw error
          recordDiagnostic('passport-ocr-fallback-failed', new Error('Local OCR was unavailable during Gemini-assisted recognition.'), false)
          return { text: '', pages: [], mrz: null, extraction: extractIraqiPassport([], null) }
        })
      let diagnostics
      if (provider === 'gemini') {
        const settings = await geminiScanner.getSettings()
        try {
          const result = await geminiScanner.inspectImage(filePath, mimeType, ocr.extraction, settings.model)
          ocr = { ...ocr, extraction: result.extraction }
          diagnostics = result.diagnostics
        } catch (error) {
          const failure = error instanceof GeminiPassportError
            ? error
            : new GeminiPassportError('IPC_HANDLER_ERROR', `IPC_HANDLER_ERROR: ${error instanceof Error ? error.message : 'Unexpected Gemini scanner failure.'}`, {
              model: settings.model,
              stages: { apiConnection: 'pending', imageProcessing: 'success', request: 'failed', response: 'pending', jsonParsing: 'pending', validation: 'pending' },
              category: 'IPC_HANDLER_ERROR',
              message: error instanceof Error ? error.message : 'Unexpected Gemini scanner failure.'
            })
          diagnostics = failure.diagnostics
          recordDiagnostic('gemini-passport-scan-failed', new Error(failure.category), false)
        }
      }
      const image = await readFile(filePath)
      const token = randomUUID()

      for (const [key, pending] of pendingPassports) {
        if (pending.expiresAt < Date.now()) pendingPassports.delete(key)
      }
      pendingPassports.set(token, {
        path: filePath,
        owner: event.sender.id,
        fileName: basename(filePath),
        mimeType,
        expiresAt: Date.now() + 10 * 60 * 1000
      })

      return {
        token,
        fileName: basename(filePath),
        mimeType,
        previewDataUrl: `data:${mimeType};base64,${image.toString('base64')}`,
        text: ocr.text,
        fields: ocr.extraction.fields,
        assessments: ocr.extraction.assessments,
        profile: ocr.extraction.profile,
        mrz: ocr.mrz,
        ...(diagnostics ? { diagnostics } : {})
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unexpected passport inspection failure.'
      const category = detail.match(/^(API_AUTHENTICATION_ERROR|API_CONNECTION_ERROR|MODEL_NOT_AVAILABLE|IMAGE_PROCESSING_ERROR|IMAGE_UPLOAD_ERROR|GEMINI_EMPTY_RESPONSE|GEMINI_RESPONSE_PARSE_ERROR|PASSPORT_VALIDATION_ERROR|IPC_HANDLER_ERROR)/)?.[1] ?? 'IPC_HANDLER_ERROR'
      recordDiagnostic('passport-inspection-failed', new Error(category), false)
      throw new Error(detail.includes(':') ? detail : `${category}: ${detail}`)
    }
  })

  secureHandle('scanner:passport', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Passport image', extensions: ['jpg', 'jpeg', 'png'] }] })
    if (canceled || !filePaths[0]) return null
    const file = filePaths[0]
    const details = await stat(file)
    if (!details.isFile() || details.size > 25 * 1024 * 1024) throw new Error('Passport image must be a file smaller than 25 MB.')
    return { fileName: basename(file), text: (await recognizePassport(file, root)).text }
  })
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow().catch(showStartupError) })
}).catch(showStartupError)

function showStartupError(error: unknown): void {
  recordDiagnostic('application-startup-failed', error, true)
  const detail = error instanceof Error ? error.message : String(error)
  dialog.showErrorBox('Blue Line Visa CRM could not start', `${detail}\n\nPlease try opening the app again. If the problem continues, share this message with support.`)
  app.quit()
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function readImageDataUrl(filePath: string): string | null {
  if (!filePath || !existsSync(filePath)) return null
  const extension = extname(filePath).toLowerCase()
  const mimeType = extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : null
  if (!mimeType) return null
  try {
    const bytes = readFileSync(filePath)
    return `data:${mimeType};base64,${bytes.toString('base64')}`
  } catch (error) {
    throw new Error(`Unable to read image file: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readHrEmployeePhotoDataUrl(filePath: string | null): string | null {
  if (!filePath || !existsSync(filePath)) return null
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) return null
  const { width, height } = image.getSize()
  const scale = Math.min(1, 320 / Math.max(width, height))
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'good'
  }).toDataURL()
}

function withHrEmployeePhoto(employee: HrEmployeeRecord): HrEmployee {
  const { photoPath, ...details } = employee
  return { ...details, photoDataUrl: readHrEmployeePhotoDataUrl(photoPath) }
}

function candidateNameFromFileName(fileName: string): string {
  return basename(fileName, extname(fileName))
    .replace(/[_-]+/g, ' ')
    .replace(/^(cv|resume|resumé|curriculum vitae)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function candidateNameFromText(text: string): string | null {
  const ignoredTerms = /\b(curriculum vitae|resume|resumé|personal information|contact details|phone|email|address|profile|summary|objective|experience|education|skills|linkedin)\b/i
  for (const rawLine of text.split(/\r?\n/).slice(0, 12)) {
    const line = rawLine.replace(/^[\s*•\-–—]+/, '').trim()
    const words = line.split(/\s+/)
    if (line.length > 80 || words.length < 2 || words.length > 5
      || /[\d@:/\\]|https?/i.test(line) || ignoredTerms.test(line)
      || words.some((word) => word.length > 35)) continue
    return line
  }
  return null
}

function validatePassportVariants(value: unknown): PassportPreprocessingVariant[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 3) throw new Error('Invalid passport preprocessing data.')
  return value.map((region): PassportPreprocessingVariant => {
    if (!region || typeof region !== 'object' || Array.isArray(region)) throw new Error('Invalid passport preprocessing data.')
    const candidate = region as { label?: unknown; imageData?: unknown; width?: unknown; height?: unknown }
    if (candidate.label !== 'enhanced' && candidate.label !== 'deskew-clockwise' && candidate.label !== 'deskew-counterclockwise') {
      throw new Error('Invalid passport preprocessing variant.')
    }
    if (!(candidate.imageData instanceof Uint8Array) || candidate.imageData.byteLength === 0 || candidate.imageData.byteLength > 4 * 1024 * 1024
      || !Number.isSafeInteger(candidate.width) || Number(candidate.width) < 1
      || !Number.isSafeInteger(candidate.height) || Number(candidate.height) < 1) {
      throw new Error('Invalid passport preprocessing image.')
    }
    return { label: candidate.label, imageData: candidate.imageData, width: Number(candidate.width), height: Number(candidate.height) }
  })
}

function recognizePassport(
  filePath: string,
  root: string,
  variants: PassportPreprocessingVariant[] = [],
  languages: PassportOcrLanguage = 'eng+ara'
): Promise<PassportOcrResult> {
  const recognition = passportOcrQueue.then(() => recognizePassportNow(filePath, root, variants, languages))
  passportOcrQueue = recognition.then(() => undefined, () => undefined)
  return recognition.catch((error: unknown) => {
    recordDiagnostic('passport-ocr-failed', error, true)
    throw error
  })
}

async function recognizePassportNow(
  filePath: string,
  root: string,
  variants: PassportPreprocessingVariant[],
  languages: PassportOcrLanguage
): Promise<PassportOcrResult> {
  const require = createRequire(join(app.getAppPath(), 'package.json'))
  const modelsDir = join(root, 'ocr-data')
  await mkdir(modelsDir, { recursive: true })
  for (const language of languages.split('+')) {
    const source = join(dirname(require.resolve(`@tesseract.js-data/${language}`)), '4.0.0_best_int', `${language}.traineddata.gz`)
    const destination = join(modelsDir, `${language}.traineddata.gz`)
    if (!existsSync(destination)) await copyFile(source, destination)
  }
  let workerPromise = passportOcrWorkers.get(languages)
  if (!workerPromise) {
    workerPromise = createWorker(languages, 1, {
      langPath: modelsDir,
      gzip: true,
      corePath: require.resolve('tesseract.js-core/tesseract-core.wasm.js')
    })
    passportOcrWorkers.set(languages, workerPromise)
  }
  let worker: PassportOcrWorker
  try {
    worker = await workerPromise
  } catch (error) {
    if (passportOcrWorkers.get(languages) === workerPromise) passportOcrWorkers.delete(languages)
    throw error
  }
  const pages: PassportOcrPage[] = []
  const texts: string[] = []
  const inputs: Array<{ source: PassportOcrPage['source']; image: string | Buffer }> = [
    { source: 'original', image: filePath },
    ...variants.map(({ label, imageData }) => ({ source: label, image: Buffer.from(imageData) }))
  ]
  const originalSize = nativeImage.createFromPath(filePath).getSize()
  if (!originalSize.width || !originalSize.height) throw new Error('The passport image could not be decoded.')
  let extraction = extractIraqiPassport([], null)
  let mrz: ReturnType<typeof parsePassportMrz> = null
  for (const input of inputs) {
    await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: PSM.AUTO })
    const { data } = await worker.recognize(input.image, {}, { blocks: true })
    texts.push(data.text)
    const variant = variants.find((item) => item.label === input.source)
    const imageSize = variant ? { width: variant.width, height: variant.height } : originalSize
    const page: PassportOcrPage = {
      source: input.source,
      width: imageSize.width,
      height: imageSize.height,
      words: (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))).map((word) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: word.bbox
      }))
    }
    pages.push(page)
    const pageMrz = parsePassportMrz(data.text)
    if (pageMrz && (!mrz || (pageMrz.checkDigitsValid && !mrz.checkDigitsValid))) mrz = pageMrz
    extraction = extractIraqiPassport(pages, mrz)
    const unresolved = Object.values(extraction.assessments).some((field) => field.needsReview)
    if (!unresolved) break
  }
  return { text: texts.join('\n'), pages, mrz, extraction }
}
