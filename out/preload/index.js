"use strict";
const electron = require("electron");
const api = {
  workspaceInfo: () => electron.ipcRenderer.invoke("workspace:info"),
  configureWorkspace: (config) => electron.ipcRenderer.invoke("workspace:configure", config),
  testWorkspaceConnection: (address, fingerprint) => electron.ipcRenderer.invoke("workspace:test-connection", address, fingerprint),
  applicationUsers: {
    list: () => electron.ipcRenderer.invoke("settings:users:list"),
    create: (input) => electron.ipcRenderer.invoke("settings:users:create", input),
    update: (input) => electron.ipcRenderer.invoke("settings:users:update", input),
    delete: (id) => electron.ipcRenderer.invoke("settings:users:delete", id)
  },
  selfAttendance: {
    status: () => electron.ipcRenderer.invoke("attendance:self:status"),
    checkIn: () => electron.ipcRenderer.invoke("attendance:self:check-in"),
    checkOut: () => electron.ipcRenderer.invoke("attendance:self:check-out"),
    calendar: (year, month) => electron.ipcRenderer.invoke("attendance:self:calendar", year, month)
  },
  getSession: () => electron.ipcRenderer.invoke("auth:session"),
  login: (username, password) => electron.ipcRenderer.invoke("auth:login", username, password),
  logout: () => electron.ipcRenderer.invoke("auth:logout"),
  dashboard: () => electron.ipcRenderer.invoke("dashboard"),
  listApplications: () => electron.ipcRenderer.invoke("applications:list"),
  listCustomers: (search) => electron.ipcRenderer.invoke("customers:list", search),
  createApplication: (input) => electron.ipcRenderer.invoke("applications:create", input),
  moveApplication: (id, status) => electron.ipcRenderer.invoke("applications:move", id, status),
  uploadDocument: (applicationId) => electron.ipcRenderer.invoke("documents:upload", applicationId),
  uploadDocumentByReference: (reference) => electron.ipcRenderer.invoke("documents:upload-by-reference", reference),
  listDocuments: (applicationId) => electron.ipcRenderer.invoke("documents:list", applicationId),
  listAllDocuments: () => electron.ipcRenderer.invoke("documents:list-all"),
  openDocument: (documentId) => electron.ipcRenderer.invoke("documents:open", documentId),
  exportCsv: () => electron.ipcRenderer.invoke("reports:csv"),
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => electron.ipcRenderer.invoke("settings:save", settings),
  getGeminiSettings: () => electron.ipcRenderer.invoke("gemini:settings:get"),
  listGeminiModels: (apiKey) => electron.ipcRenderer.invoke("gemini:models:list", apiKey),
  saveGeminiSettings: (settings) => electron.ipcRenderer.invoke("gemini:settings:save", settings),
  testGeminiConnection: (settings) => electron.ipcRenderer.invoke("gemini:connection:test", settings),
  getPassportProvider: () => electron.ipcRenderer.invoke("passport:provider:get"),
  savePassportProvider: (provider) => electron.ipcRenderer.invoke("passport:provider:save", provider),
  setCompanyLogo: () => electron.ipcRenderer.invoke("settings:set-logo"),
  removeCompanyLogo: () => electron.ipcRenderer.invoke("settings:remove-logo"),
  backup: () => electron.ipcRenderer.invoke("backup:create"),
  scanPassport: () => electron.ipcRenderer.invoke("scanner:passport"),
  reportRendererError: (diagnostic) => electron.ipcRenderer.send("diagnostics:renderer", diagnostic),
  getCustomerProfile: (id) => electron.ipcRenderer.invoke("customers:get-profile", id),
  updateCustomer: (customerId, customer) => electron.ipcRenderer.invoke("customers:update", customerId, customer),
  updateApplication: (applicationId, application) => electron.ipcRenderer.invoke("applications:update", applicationId, application),
  deleteApplication: (applicationId) => electron.ipcRenderer.invoke("applications:delete", applicationId),
  uploadCustomerDocument: (customerId, applicationId) => electron.ipcRenderer.invoke("customer-documents:upload", customerId, applicationId),
  setCustomerPhoto: (customerId) => electron.ipcRenderer.invoke("customers:set-photo", customerId),
  inspectPassport: async (file, provider) => {
    const filePath = electron.webUtils.getPathForFile(file);
    if (!filePath) throw new Error("IMAGE_PROCESSING_ERROR: Unable to access the selected passport file. Choose it again and retry.");
    if (provider === "gemini" || file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      return electron.ipcRenderer.invoke("passport:inspect", filePath, [], provider);
    }
    let image;
    try {
      image = await createImageBitmap(file);
    } catch (error) {
      throw new Error(`IMAGE_PROCESSING_ERROR: Unable to read passport image dimensions. ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      const maxDimension = 2400;
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const variants = [
        { label: "enhanced", angle: 0, sharpen: true },
        { label: "deskew-clockwise", angle: 0.8, sharpen: false },
        { label: "deskew-counterclockwise", angle: -0.8, sharpen: false }
      ];
      const preprocessed = await Promise.all(variants.map(async ({ label, angle, sharpen }) => {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("IMAGE_PROCESSING_ERROR: Unable to prepare passport image variations for OCR.");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.filter = "grayscale(1) contrast(1.22) brightness(1.04)";
        context.translate(width / 2, height / 2);
        context.rotate(angle * Math.PI / 180);
        context.drawImage(image, -width / 2, -height / 2, width, height);
        context.setTransform(1, 0, 0, 1, 0, 0);
        if (sharpen) {
          const pixels = context.getImageData(0, 0, width, height);
          const source = pixels.data.slice();
          for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
              const center = (y * width + x) * 4;
              for (let channel = 0; channel < 3; channel += 1) {
                const original = source[center + channel];
                const blur = (original * 4 + (source[center - 4 + channel] + source[center + 4 + channel] + source[center - width * 4 + channel] + source[center + width * 4 + channel]) * 2 + source[center - width * 4 - 4 + channel] + source[center - width * 4 + 4 + channel] + source[center + width * 4 - 4 + channel] + source[center + width * 4 + 4 + channel]) / 16;
                const value = original + (original - blur) * 0.7;
                pixels.data[center + channel] = Math.max(0, Math.min(255, value));
              }
            }
          }
          context.putImageData(pixels, 0, 0);
        }
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
        if (blob.size > 4 * 1024 * 1024) throw new Error("IMAGE_PROCESSING_ERROR: Enhanced passport image is too large to inspect reliably.");
        return { label, width, height, imageData: new Uint8Array(await blob.arrayBuffer()) };
      }));
      return await electron.ipcRenderer.invoke("passport:inspect", filePath, preprocessed, provider);
    } finally {
      image.close();
    }
  },
  listPipelines: () => electron.ipcRenderer.invoke("pipelines:list"),
  savePipeline: (pipeline) => electron.ipcRenderer.invoke("pipelines:save", pipeline),
  deletePipeline: (id) => electron.ipcRenderer.invoke("pipelines:delete", id),
  saveCatalogItem: (kind, item) => electron.ipcRenderer.invoke("catalog:save", kind, item),
  deleteCatalogItem: (kind, id) => electron.ipcRenderer.invoke("catalog:delete", kind, id),
  listCatalog: (kind) => electron.ipcRenderer.invoke("catalog:list", kind),
  openCustomerDocument: (documentId) => electron.ipcRenderer.invoke("customer-documents:open", documentId),
  listApplicationActivities: (applicationId) => electron.ipcRenderer.invoke("applications:activities:list", applicationId),
  addApplicationActivity: (applicationId, activity) => electron.ipcRenderer.invoke("applications:activities:add", applicationId, activity),
  hr: {
    passwordStatus: () => electron.ipcRenderer.invoke("hr:auth:status"),
    setupPassword: (password) => electron.ipcRenderer.invoke("hr:auth:setup", password),
    unlock: (password) => electron.ipcRenderer.invoke("hr:auth:unlock", password),
    changePassword: (currentPassword, newPassword) => electron.ipcRenderer.invoke("hr:auth:change", currentPassword, newPassword),
    resetPassword: (administratorPassword, newPassword) => electron.ipcRenderer.invoke("hr:auth:reset", administratorPassword, newPassword),
    dashboard: () => electron.ipcRenderer.invoke("hr:dashboard"),
    listDepartments: () => electron.ipcRenderer.invoke("hr:departments:list"),
    saveDepartment: (department) => electron.ipcRenderer.invoke("hr:departments:save", department),
    listEmployees: (search, includeArchived) => electron.ipcRenderer.invoke("hr:employees:list", search, includeArchived),
    getEmployeeProfile: (employeeId) => electron.ipcRenderer.invoke("hr:employees:profile", employeeId),
    setEmployeePhoto: (employeeId) => electron.ipcRenderer.invoke("hr:employees:set-photo", employeeId),
    saveEmployee: (employee) => electron.ipcRenderer.invoke("hr:employees:save", employee),
    archiveEmployee: (id, archived) => electron.ipcRenderer.invoke("hr:employees:archive", id, archived),
    deleteEmployee: (id) => electron.ipcRenderer.invoke("hr:employees:delete", id),
    listAttendance: (date) => electron.ipcRenderer.invoke("hr:attendance:list", date),
    listAttendanceCalendar: (year, month, employeeId) => electron.ipcRenderer.invoke("hr:attendance:calendar", year, month, employeeId),
    clockIn: (employeeId) => electron.ipcRenderer.invoke("hr:attendance:clock-in", employeeId),
    clockOut: (employeeId) => electron.ipcRenderer.invoke("hr:attendance:clock-out", employeeId),
    saveAttendance: (record) => electron.ipcRenderer.invoke("hr:attendance:save", record),
    markAllPresent: (date) => electron.ipcRenderer.invoke("hr:attendance:mark-all-present", date),
    listLeaveRequests: (status) => electron.ipcRenderer.invoke("hr:leaves:list", status),
    createLeaveRequest: (request) => electron.ipcRenderer.invoke("hr:leaves:create", request),
    decideLeaveRequest: (id, status) => electron.ipcRenderer.invoke("hr:leaves:decide", id, status),
    listLeaveBalances: (year) => electron.ipcRenderer.invoke("hr:leave-balances:list", year),
    saveLeaveBalance: (balance) => electron.ipcRenderer.invoke("hr:leave-balances:save", balance),
    listDocuments: (employeeId) => electron.ipcRenderer.invoke("hr:documents:list", employeeId),
    uploadDocument: (employeeId, metadata) => electron.ipcRenderer.invoke("hr:documents:upload", employeeId, metadata),
    openDocument: (id) => electron.ipcRenderer.invoke("hr:documents:open", id),
    listCandidates: () => electron.ipcRenderer.invoke("hr:candidates:list"),
    selectCandidateFile: () => electron.ipcRenderer.invoke("hr:candidates:select-file"),
    cancelCandidateUpload: (uploadId) => electron.ipcRenderer.invoke("hr:candidates:cancel-upload", uploadId),
    createCandidate: (input) => electron.ipcRenderer.invoke("hr:candidates:create", input),
    updateCandidate: (input) => electron.ipcRenderer.invoke("hr:candidates:update", input),
    setCandidateStarred: (id, starred) => electron.ipcRenderer.invoke("hr:candidates:star", id, starred),
    openCandidateFile: (id) => electron.ipcRenderer.invoke("hr:candidates:open-file", id),
    listPayrollPeriods: () => electron.ipcRenderer.invoke("hr:payroll:list"),
    calculatePay: (employeeId, startDate, endDate) => electron.ipcRenderer.invoke("hr:payroll:calculate", employeeId, startDate, endDate),
    generatePayroll: (month, year) => electron.ipcRenderer.invoke("hr:payroll:generate", month, year),
    listPayrollRecords: (periodId) => electron.ipcRenderer.invoke("hr:payroll:records:list", periodId),
    addPayrollItem: (recordId, item) => electron.ipcRenderer.invoke("hr:payroll:item:add", recordId, item),
    approvePayroll: (id) => electron.ipcRenderer.invoke("hr:payroll:approve", id),
    markPayrollPaid: (id) => electron.ipcRenderer.invoke("hr:payroll:paid", id),
    exportReport: (report) => electron.ipcRenderer.invoke("hr:reports:export", report)
  }
};
electron.contextBridge.exposeInMainWorld("blueLine", api);
