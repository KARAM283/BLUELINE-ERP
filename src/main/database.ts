import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { STAGES, type Application, type ApplicationActivity, type CatalogItem, type Customer, type CustomerProfile, type Dashboard, type DocumentLibraryRecord, type NewApplication, type Pipeline } from '../shared/types'
import { initializeAuthDatabase } from './auth'
import { initializeHrDatabase } from './hrDatabase'

const today = () => new Date().toISOString().slice(0, 10)

export function initializeDatabase(db: Database.Database): Database.Database {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '', nationality TEXT NOT NULL DEFAULT '',
      passport_number TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS customers_passport_unique
      ON customers(passport_number) WHERE passport_number <> '';
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY, application_id TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      country TEXT NOT NULL, visa_type TEXT NOT NULL, status TEXT NOT NULL REFERENCES pipeline_stages(name),
      employee TEXT NOT NULL DEFAULT '', application_date TEXT NOT NULL,
      follow_up_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);
    CREATE INDEX IF NOT EXISTS applications_follow_up_idx ON applications(follow_up_date);
    CREATE TABLE IF NOT EXISTS application_activities (
      id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id),
      activity_type TEXT NOT NULL, description TEXT NOT NULL,
      previous_value TEXT, new_value TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL DEFAULT 'Blue Line Team'
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id),
      category TEXT NOT NULL, file_name TEXT NOT NULL, file_path TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
  `)
  migrateDatabase(db)
  initializeAuthDatabase(db)
  initializeHrDatabase(db)
  const insertStage = db.prepare('INSERT OR IGNORE INTO pipeline_stages(name, sort_order) VALUES (?, ?)')
  STAGES.forEach((stage, index) => insertStage.run(stage, index))
  db.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('companyName', 'Blue Line Travel')").run()
  db.prepare("INSERT OR IGNORE INTO app_settings(key, value) VALUES ('language', 'en')").run()
  db.prepare('INSERT OR IGNORE INTO pipelines(id, name, sort_order) VALUES (1, ?, 0)').run('Visa Applications')
  db.prepare(`INSERT OR IGNORE INTO pipeline_stage_definitions(pipeline_id, name, sort_order)
    SELECT 1, name, sort_order FROM pipeline_stages ORDER BY sort_order`).run()
  db.exec(`INSERT OR IGNORE INTO visa_types(name, active)
    SELECT DISTINCT trim(visa_type), 1 FROM applications WHERE trim(visa_type) <> '';
    INSERT OR IGNORE INTO countries(name, active)
    SELECT DISTINCT trim(country), 1 FROM applications WHERE trim(country) <> '';`)
  db.pragma('user_version = 3')
  return db
}

function migrateDatabase(db: Database.Database): void {
  const addColumn = (table: string, column: string, declaration: string) => {
    const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>
    if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
  }
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS pipeline_stage_definitions (
        id INTEGER PRIMARY KEY, pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        name TEXT NOT NULL, sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(pipeline_id, name)
      );
      CREATE TABLE IF NOT EXISTS visa_types (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS countries (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS customer_documents (
        id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        application_record_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
        file_name TEXT NOT NULL, file_path TEXT NOT NULL, document_type TEXT NOT NULL,
        uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, legacy_document_id INTEGER UNIQUE
      );
      CREATE INDEX IF NOT EXISTS customer_documents_customer_idx ON customer_documents(customer_id, uploaded_at);
      CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(full_name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);
    `)
    for (const [column, declaration] of [
      ['date_of_birth', "TEXT NOT NULL DEFAULT ''"],
      ['gender', "TEXT NOT NULL DEFAULT ''"],
      ['address', "TEXT NOT NULL DEFAULT ''"],
      ['passport_issue_date', "TEXT NOT NULL DEFAULT ''"],
      ['passport_expiry_date', "TEXT NOT NULL DEFAULT ''"],
      ['photo_path', "TEXT NOT NULL DEFAULT ''"]
    ] as const) addColumn('customers', column, declaration)
    addColumn('applications', 'pipeline_id', 'INTEGER NOT NULL DEFAULT 1')
    addColumn('applications', 'deleted_at', 'TEXT')
    addColumn('application_activities', 'created_by', "TEXT NOT NULL DEFAULT 'Blue Line Team'")
    addColumn('customer_documents', 'legacy_document_id', 'INTEGER')
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS customer_documents_legacy_idx
      ON customer_documents(legacy_document_id) WHERE legacy_document_id IS NOT NULL;
      INSERT OR IGNORE INTO customer_documents(customer_id, application_record_id, file_name, file_path, document_type, uploaded_at, legacy_document_id)
        SELECT a.customer_id, d.application_id, d.file_name, d.file_path, d.category, d.added_at, d.id
        FROM documents d JOIN applications a ON a.id = d.application_id;
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS applications_pipeline_idx ON applications(pipeline_id);
      CREATE INDEX IF NOT EXISTS customers_passport_search_idx ON customers(upper(passport_number));`)
  })
  migrate()
}

export function openDatabase(filePath: string): Database.Database {
  mkdirSync(dirname(filePath), { recursive: true })
  return initializeDatabase(new Database(filePath))
}

function mapApplication(row: Record<string, unknown>): Application {
  return {
    id: Number(row.id), applicationId: String(row.application_id), customerId: Number(row.customer_id),
    customerName: String(row.customer_name), phone: String(row.phone), country: String(row.country),
    visaType: String(row.visa_type), status: String(row.status), employee: String(row.employee),
    applicationDate: String(row.application_date), followUpDate: row.follow_up_date ? String(row.follow_up_date) : null,
    pipelineId: Number(row.pipeline_id ?? 1),
    updatedAt: String(row.updated_at)
  }
}

const appSelect = `
  SELECT a.*, c.full_name AS customer_name, c.phone FROM applications a
  JOIN customers c ON c.id = a.customer_id`

function assertPassportAvailable(db: Database.Database, passportNumber: string, exceptCustomerId?: number): void {
  if (!passportNumber) return
  const existing = db.prepare(`SELECT id FROM customers
    WHERE upper(passport_number) = ? AND (? IS NULL OR id <> ?) LIMIT 1`)
    .get(passportNumber, exceptCustomerId ?? null, exceptCustomerId ?? null) as { id: number } | undefined
  if (existing) throw new Error('That passport number is already assigned to another customer.')
}

export function listApplications(db: Database.Database): Application[] {
  return (db.prepare(`${appSelect} WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC`).all() as Record<string, unknown>[]).map(mapApplication)
}

export function getDashboard(db: Database.Database): Dashboard {
  const total = Number((db.prepare('SELECT COUNT(*) AS count FROM applications WHERE deleted_at IS NULL').get() as { count: number }).count)
  const statuses = db.prepare('SELECT status, COUNT(*) AS count FROM applications WHERE deleted_at IS NULL GROUP BY status').all() as Array<{ status: string; count: number }>
  const byStatus = Object.fromEntries(statuses.map((row) => [row.status, Number(row.count)]))
  const overdue = Number((db.prepare("SELECT COUNT(*) AS count FROM applications WHERE deleted_at IS NULL AND follow_up_date < ? AND status NOT IN ('Approved', 'Rejected', 'Passport Returned / Closed')").get(today()) as { count: number }).count)
  const recent = (db.prepare(`${appSelect} WHERE a.deleted_at IS NULL ORDER BY a.updated_at DESC LIMIT 6`).all() as Record<string, unknown>[]).map(mapApplication)
  const countries = db.prepare('SELECT country, COUNT(*) AS count FROM applications WHERE deleted_at IS NULL GROUP BY country ORDER BY count DESC LIMIT 6').all() as Array<{ country: string; count: number }>
  return { total, byStatus, overdue, recent, countries }
}

export function createApplication(db: Database.Database, input: NewApplication, passportStoragePath?: string): Application {
  const stringFields: Array<keyof NewApplication> = [
    'fullName', 'phone', 'email', 'nationality', 'passportNumber', 'country',
    'visaType', 'employee', 'followUpDate', 'dateOfBirth', 'gender', 'address',
    'passportIssueDate', 'passportExpiryDate'
  ]
  for (const field of stringFields) {
    if (input[field] !== undefined && typeof input[field] !== 'string') throw new Error(`Invalid ${field} value.`)
  }
  const fullName = input.fullName.trim()
  const phone = input.phone?.trim() ?? ''
  const country = input.country.trim()
  const visaType = input.visaType.trim()
  if (!fullName || !country || !visaType) throw new Error('Name, country, and visa type are required.')
  const pipelineId = input.pipelineId === undefined ? 1 : Number(input.pipelineId)
  if (!Number.isSafeInteger(pipelineId) || !db.prepare('SELECT 1 FROM pipelines WHERE id = ?').get(pipelineId)) throw new Error('Invalid pipeline.')
  const create = db.transaction(() => {
    const passportNumber = input.passportNumber?.trim().toUpperCase() ?? ''
    let customer = passportNumber
      ? db.prepare('SELECT id FROM customers WHERE upper(passport_number) = ?').get(passportNumber) as { id: number } | undefined
      : undefined
    if (!customer && phone) {
      customer = db.prepare(`SELECT id FROM customers WHERE lower(full_name) = lower(?) AND phone = ? LIMIT 1`)
        .get(fullName, phone) as { id: number } | undefined
    }
    if (!customer) {
      const result = db.prepare(`INSERT INTO customers
        (full_name, phone, email,                 nationality, passport_number, date_of_birth, gender, address, passport_issue_date, passport_expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        fullName, phone, input.email?.trim() ?? '', input.nationality?.trim() ?? '',
        passportNumber, input.dateOfBirth?.trim() ?? '', input.gender?.trim() ?? '',
        input.address?.trim() ?? '', input.passportIssueDate?.trim() ?? '', input.passportExpiryDate?.trim() ?? ''
      )
      customer = { id: Number(result.lastInsertRowid) }
    } else {
      db.prepare(`UPDATE customers SET
        full_name = ?, phone = CASE WHEN ? <> '' THEN ? ELSE phone END, email = CASE WHEN ? <> '' THEN ? ELSE email END,
        nationality = CASE WHEN ? <> '' THEN ? ELSE nationality END,
        passport_number = CASE WHEN ? <> '' THEN ? ELSE passport_number END,
        date_of_birth = CASE WHEN ? <> '' THEN ? ELSE date_of_birth END,
        gender = CASE WHEN ? <> '' THEN ? ELSE gender END,
        address = CASE WHEN ? <> '' THEN ? ELSE address END,
        passport_issue_date = CASE WHEN ? <> '' THEN ? ELSE passport_issue_date END,
        passport_expiry_date = CASE WHEN ? <> '' THEN ? ELSE passport_expiry_date END
        WHERE id = ?`).run(
        fullName, phone, phone,
        input.email?.trim() ?? '', input.email?.trim() ?? '',
        input.nationality?.trim() ?? '', input.nationality?.trim() ?? '',
        passportNumber, passportNumber,
        input.dateOfBirth?.trim() ?? '', input.dateOfBirth?.trim() ?? '',
        input.gender?.trim() ?? '', input.gender?.trim() ?? '',
        input.address?.trim() ?? '', input.address?.trim() ?? '',
        input.passportIssueDate?.trim() ?? '', input.passportIssueDate?.trim() ?? '',
        input.passportExpiryDate?.trim() ?? '', input.passportExpiryDate?.trim() ?? '',
        customer.id
      )
    }
    if (passportStoragePath) {
      db.prepare(`INSERT INTO customer_documents(customer_id, file_name, file_path, document_type)
        VALUES (?, ?, ?, 'Passport image')`).run(customer.id, basename(passportStoragePath), passportStoragePath)
    }
    const year = new Date().getFullYear()
    const seq = Number((db.prepare("SELECT COALESCE(MAX(CAST(substr(application_id, 9) AS INTEGER)), 0) AS n FROM applications WHERE application_id LIKE ?").get(`BL-${year}-%`) as { n: number }).n) + 1
    const applicationId = `BL-${year}-${String(seq).padStart(4, '0')}`
    const firstStage = db.prepare(`SELECT name FROM pipeline_stage_definitions
      WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order, id LIMIT 1`).get(pipelineId) as { name: string } | undefined
    if (!firstStage) throw new Error('The selected pipeline has no active stages.')
    const result = db.prepare(`INSERT INTO applications
      (application_id, customer_id, country, visa_type, status, employee, application_date, follow_up_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      applicationId, customer.id, country, visaType, firstStage.name, input.employee.trim(), today(), input.followUpDate || null
    )
    db.prepare('UPDATE applications SET pipeline_id = ? WHERE id = ?').run(pipelineId, Number(result.lastInsertRowid))
    const id = Number(result.lastInsertRowid)
    db.prepare(`INSERT INTO application_activities(application_id, activity_type, description, new_value)
      VALUES (?, 'Application Created', 'Application created', ?)`).run(id, applicationId)
    return id
  })
  return mapApplication(db.prepare(`${appSelect} WHERE a.id = ?`).get(create()) as Record<string, unknown>)
}

export function moveApplication(db: Database.Database, id: number, status: string): void {
  const transition = db.transaction(() => {
    const row = db.prepare('SELECT status, pipeline_id FROM applications WHERE id = ? AND deleted_at IS NULL').get(id) as { status: string; pipeline_id: number } | undefined
    if (!row) throw new Error('Application not found.')
    if (!db.prepare('SELECT 1 FROM pipeline_stage_definitions WHERE pipeline_id = ? AND name = ? AND active = 1').get(row.pipeline_id, status)) throw new Error('Invalid pipeline stage.')
    if (row.status === status) return
    db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id)
    db.prepare(`INSERT INTO application_activities(application_id, activity_type, description, previous_value, new_value)
      VALUES (?, 'Status Changed', ?, ?, ?)`).run(id, `Status changed from ${row.status} to ${status}`, row.status, status)
  })
  transition()
}

export function listCustomers(db: Database.Database, search = '') {
  const term = `%${search.trim()}%`
  return db.prepare(`SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.nationality,
      c.passport_number AS passportNumber, c.created_at AS createdAt,
      c.date_of_birth AS dateOfBirth, c.gender, c.address,
      c.passport_issue_date AS passportIssueDate, c.passport_expiry_date AS passportExpiryDate,
        (SELECT COUNT(*) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS applications,
        (SELECT max(application_date) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS lastApplicationDate
      FROM customers c WHERE upper(c.passport_number) = upper(?) OR c.full_name LIKE ? OR c.phone LIKE ? OR c.passport_number LIKE ? OR c.email LIKE ?
      ORDER BY CASE WHEN upper(c.passport_number) = upper(?) THEN 0 ELSE 1 END, c.created_at DESC LIMIT 500`)
      .all(search.trim(), term, term, term, term, search.trim()) as Customer[]
}

export function getCustomerProfile(db: Database.Database, id: number): CustomerProfile {
  const row = db.prepare(`SELECT c.id, c.full_name AS fullName, c.phone, c.email, c.nationality,
      c.passport_number AS passportNumber, c.created_at AS createdAt,
      c.date_of_birth AS dateOfBirth, c.gender, c.address,
      c.passport_issue_date AS passportIssueDate, c.passport_expiry_date AS passportExpiryDate,
      (SELECT COUNT(*) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS applications,
      (SELECT max(application_date) FROM applications a WHERE a.customer_id = c.id AND a.deleted_at IS NULL) AS lastApplicationDate
    FROM customers c WHERE c.id = ?`).get(id) as Customer | undefined
  if (!row) throw new Error('Customer not found.')
  const applications = (db.prepare(`${appSelect} WHERE a.customer_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at DESC`).all(id) as Record<string, unknown>[]).map(mapApplication)
  const documents = db.prepare(`SELECT cd.id, a.application_id AS applicationId, cd.document_type AS category,
      cd.file_name AS fileName, cd.uploaded_at AS addedAt, cd.application_record_id AS applicationRecordId, 'customer' AS storage
    FROM customer_documents cd LEFT JOIN applications a ON a.id = cd.application_record_id
    WHERE cd.customer_id = ?
    ORDER BY addedAt DESC`).all(id) as CustomerProfile['documents']
  const activities = db.prepare(`SELECT activity.id, a.application_id AS applicationId,
      activity.activity_type AS activityType, activity.description,
      activity.previous_value AS previousValue, activity.new_value AS newValue,
      activity.created_by AS createdBy, activity.created_at AS createdAt
    FROM application_activities activity
    JOIN applications a ON a.id = activity.application_id
    WHERE a.customer_id = ? AND a.deleted_at IS NULL
    ORDER BY activity.created_at DESC, activity.id DESC`).all(id) as ApplicationActivity[]
  return { customer: row, applications, documents, activities }
}

export function listAllDocuments(db: Database.Database): DocumentLibraryRecord[] {
  return db.prepare(`SELECT * FROM (
      SELECT d.id, a.application_id AS applicationId, d.category, d.file_name AS fileName,
        d.added_at AS addedAt, c.full_name AS customerName, 'application' AS storage
      FROM documents d JOIN applications a ON a.id = d.application_id
      JOIN customers c ON c.id = a.customer_id
      WHERE a.deleted_at IS NULL
      UNION ALL
      SELECT cd.id, a.application_id AS applicationId, cd.document_type AS category,
        cd.file_name AS fileName, cd.uploaded_at AS addedAt, c.full_name AS customerName, 'customer' AS storage
      FROM customer_documents cd JOIN customers c ON c.id = cd.customer_id
      LEFT JOIN applications a ON a.id = cd.application_record_id AND a.deleted_at IS NULL
      WHERE cd.legacy_document_id IS NULL
    ) ORDER BY addedAt DESC, id DESC`).all() as DocumentLibraryRecord[]
}

export function listApplicationActivities(db: Database.Database, id: number): ApplicationActivity[] {
  if (!db.prepare('SELECT 1 FROM applications WHERE id = ? AND deleted_at IS NULL').get(id)) throw new Error('Application not found.')
  return db.prepare(`SELECT activity.id, a.application_id AS applicationId,
      activity.activity_type AS activityType, activity.description,
      activity.previous_value AS previousValue, activity.new_value AS newValue,
      activity.created_by AS createdBy, activity.created_at AS createdAt
    FROM application_activities activity
    JOIN applications a ON a.id = activity.application_id
    WHERE activity.application_id = ?
    ORDER BY activity.created_at DESC, activity.id DESC`).all(id) as ApplicationActivity[]
}

export function addApplicationActivity(
  db: Database.Database,
  id: number,
  input: { activityType: 'Internal Note' | 'Customer Call' | 'Customer Message' | 'Follow-up'; description: string }
): void {
  const allowedTypes = new Set(['Internal Note', 'Customer Call', 'Customer Message', 'Follow-up'])
  const description = input.description.trim()
  if (!allowedTypes.has(input.activityType) || !description || description.length > 2000) {
    throw new Error('Activity type and a description of 1–2,000 characters are required.')
  }
  const result = db.prepare(`INSERT INTO application_activities(application_id, activity_type, description, created_by)
    SELECT id, ?, ?, 'Blue Line Team' FROM applications WHERE id = ? AND deleted_at IS NULL`)
    .run(input.activityType, description, id)
  if (result.changes === 0) throw new Error('Application not found.')
}

export function getCustomerPhotoPath(db: Database.Database, id: number): string {
  const row = db.prepare('SELECT photo_path FROM customers WHERE id = ?').get(id) as { photo_path: string } | undefined
  if (!row) throw new Error('Customer not found.')
  return row.photo_path
}

export function setCustomerPhotoPath(db: Database.Database, id: number, path: string): void {
  const result = db.prepare('UPDATE customers SET photo_path = ? WHERE id = ?').run(path, id)
  if (result.changes === 0) throw new Error('Customer not found.')
}

export function updateCustomer(db: Database.Database, id: number, input: Pick<Customer, 'fullName' | 'passportNumber' | 'dateOfBirth' | 'nationality' | 'gender' | 'phone' | 'email' | 'address' | 'passportIssueDate' | 'passportExpiryDate'>): void {
  const fullName = input.fullName.trim()
  const phone = input.phone.trim()
  const passportNumber = input.passportNumber.trim().toUpperCase()
  if (!fullName || !phone) throw new Error('Customer name and phone are required.')
  const update = db.transaction(() => {
    assertPassportAvailable(db, passportNumber, id)
    const result = db.prepare(`UPDATE customers SET full_name = ?, passport_number = ?, date_of_birth = ?,
      nationality = ?, gender = ?, phone = ?, email = ?, address = ?,
      passport_issue_date = ?, passport_expiry_date = ? WHERE id = ?`).run(
      fullName, passportNumber, input.dateOfBirth?.trim() ?? '', input.nationality?.trim() ?? '',
      input.gender?.trim() ?? '', phone, input.email.trim(), input.address?.trim() ?? '',
      input.passportIssueDate?.trim() ?? '', input.passportExpiryDate?.trim() ?? '', id
    )
    if (result.changes === 0) throw new Error('Customer not found.')
  })
  update()
}

export function updateApplication(db: Database.Database, id: number, input: Pick<NewApplication, 'fullName' | 'phone' | 'email' | 'nationality' | 'passportNumber' | 'country' | 'visaType' | 'employee' | 'followUpDate'>): void {
  const fullName = input.fullName.trim()
  const phone = input.phone?.trim() ?? ''
  const country = input.country.trim()
  const visaType = input.visaType.trim()
  if (!fullName || !phone || !country || !visaType) throw new Error('Name, phone, country, and visa type are required.')
  const update = db.transaction(() => {
    const application = db.prepare('SELECT customer_id FROM applications WHERE id = ? AND deleted_at IS NULL').get(id) as { customer_id: number } | undefined
    if (!application) throw new Error('Application not found.')
    const passportNumber = input.passportNumber?.trim().toUpperCase() ?? ''
    if (passportNumber) assertPassportAvailable(db, passportNumber, application.customer_id)
    db.prepare(`UPDATE customers SET full_name = ?, phone = ?,
      email = CASE WHEN ? <> '' THEN ? ELSE email END,
      nationality = CASE WHEN ? <> '' THEN ? ELSE nationality END,
      passport_number = CASE WHEN ? <> '' THEN ? ELSE passport_number END
      WHERE id = ?`).run(
      fullName, phone, input.email?.trim() ?? '', input.email?.trim() ?? '',
      input.nationality?.trim() ?? '', input.nationality?.trim() ?? '',
      passportNumber, passportNumber, application.customer_id
    )
    db.prepare(`UPDATE applications SET country = ?, visa_type = ?, employee = ?,
      follow_up_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      country, visaType, input.employee.trim(), input.followUpDate || null, id
    )
    db.prepare(`INSERT INTO application_activities(application_id, activity_type, description)
      VALUES (?, 'Application Updated', 'Application details updated')`).run(id)
  })
  update()
}

export function deleteApplication(db: Database.Database, id: number): void {
  const result = db.prepare(`UPDATE applications SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL`).run(id)
  if (result.changes === 0) throw new Error('Application not found.')
}

export function listPipelines(db: Database.Database): Pipeline[] {
  return (db.prepare(`SELECT p.id, p.name, p.sort_order AS sortOrder,
      (SELECT COUNT(*) FROM applications a WHERE a.pipeline_id = p.id AND a.deleted_at IS NULL) AS applications
    FROM pipelines p ORDER BY p.sort_order, p.id`).all() as Array<Omit<Pipeline, 'stages'>>)
    .map((pipeline) => ({
      ...pipeline,
      stages: (db.prepare(`SELECT name FROM pipeline_stage_definitions
        WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order, id`).all(pipeline.id) as Array<{ name: string }>).map((stage) => stage.name)
    }))
}

export function savePipeline(db: Database.Database, input: { id?: number; name: string; stages: string[] }): void {
  const name = input.name.trim()
  const stages = input.stages.map((stage) => stage.trim())
  if (name.length < 2 || name.length > 80) throw new Error('Pipeline names must be between 2 and 80 characters.')
  if (stages.length === 0 || stages.length > 30 || stages.some((stage) => !stage || stage.length > 80) || new Set(stages.map((stage) => stage.toLocaleLowerCase())).size !== stages.length) {
    throw new Error('A pipeline must have 1–30 uniquely named stages.')
  }
  const save = db.transaction(() => {
    if (input.id === undefined) {
      const order = Number((db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM pipelines').get() as { n: number }).n) + 1
      const result = db.prepare('INSERT INTO pipelines(name, sort_order) VALUES (?, ?)').run(name, order)
      input.id = Number(result.lastInsertRowid)
    } else {
      if (!db.prepare('SELECT 1 FROM pipelines WHERE id = ?').get(input.id)) throw new Error('Pipeline not found.')
      db.prepare('UPDATE pipelines SET name = ? WHERE id = ?').run(name, input.id)
    }

    const pipelineId = input.id!
    const previous = db.prepare('SELECT name FROM pipeline_stage_definitions WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order, id').all(pipelineId) as Array<{ name: string }>
    const removed = previous.map((item) => item.name).filter((stage) => !stages.includes(stage))
    const added = stages.filter((stage) => !previous.some((item) => item.name === stage))
    const fallback = stages[0]
    for (const stage of stages) {
      db.prepare('INSERT OR IGNORE INTO pipeline_stages(name, sort_order) VALUES (?, ?)').run(stage, stages.indexOf(stage))
      db.prepare(`INSERT INTO pipeline_stage_definitions(pipeline_id, name, sort_order, active) VALUES (?, ?, ?, 1)
        ON CONFLICT(pipeline_id, name) DO UPDATE SET sort_order = excluded.sort_order, active = 1`)
        .run(pipelineId, stage, stages.indexOf(stage))
    }
    const renamed = new Set<string>()
    if (removed.length === added.length) {
      if (removed.length === 1) {
        db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ? AND status = ?')
          .run(added[0], pipelineId, removed[0])
        renamed.add(removed[0])
      }
      for (let index = 0; index < previous.length; index += 1) {
        const oldName = previous[index].name
        const newName = stages[index]
        if (removed.length > 1 && removed.includes(oldName) && added.includes(newName)) {
          db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ? AND status = ?')
            .run(newName, pipelineId, oldName)
          renamed.add(oldName)
        }
      }
    }
    for (const stage of removed) {
      if (!renamed.has(stage)) {
        db.prepare('UPDATE applications SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ? AND status = ?')
          .run(fallback, pipelineId, stage)
      }
      db.prepare('UPDATE pipeline_stage_definitions SET active = 0 WHERE pipeline_id = ? AND name = ?').run(pipelineId, stage)
    }
    const unused = db.prepare(`SELECT name FROM pipeline_stages
      WHERE name IN (${removed.map(() => '?').join(',') || "''"})
      AND NOT EXISTS (SELECT 1 FROM applications WHERE status = pipeline_stages.name)`).all(...removed) as Array<{ name: string }>
    for (const item of unused) db.prepare('DELETE FROM pipeline_stages WHERE name = ?').run(item.name)
  })
  save()
}

export function deletePipeline(db: Database.Database, id: number): void {
  if (id === 1) throw new Error('The default pipeline cannot be deleted.')
  const remove = db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM pipelines WHERE id = ?').get(id)) throw new Error('Pipeline not found.')
    const fallback = db.prepare(`SELECT id FROM pipelines WHERE id <> ? ORDER BY sort_order, id LIMIT 1`).get(id) as { id: number } | undefined
    if (!fallback) throw new Error('Create another pipeline before deleting the last pipeline.')
    const firstStage = db.prepare('SELECT name FROM pipeline_stage_definitions WHERE pipeline_id = ? AND active = 1 ORDER BY sort_order LIMIT 1').get(fallback.id) as { name: string } | undefined
    if (!firstStage) throw new Error('The default pipeline needs at least one active stage.')
    db.prepare('UPDATE applications SET pipeline_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ?')
      .run(fallback.id, firstStage.name, id)
    db.prepare('DELETE FROM pipelines WHERE id = ?').run(id)
  })
  remove()
}

export function listCatalog(db: Database.Database, kind: 'visaType' | 'country'): CatalogItem[] {
  const table = kind === 'visaType' ? 'visa_types' : 'countries'
  return db.prepare(`SELECT id, name, active FROM ${table} ORDER BY name COLLATE NOCASE`).all()
    .map((row) => ({ ...(row as Omit<CatalogItem, 'active'> & { active: number }), active: Boolean((row as { active: number }).active) }))
}

export function saveCatalogItem(db: Database.Database, kind: 'visaType' | 'country', item: { id?: number; name: string; active: boolean }): void {
  const table = kind === 'visaType' ? 'visa_types' : 'countries'
  const name = item.name.trim()
  if (name.length < 2 || name.length > 100) throw new Error('Catalog names must be between 2 and 100 characters.')
  if (item.id === undefined) db.prepare(`INSERT INTO ${table}(name, active) VALUES (?, ?)`).run(name, Number(item.active))
  else db.prepare(`UPDATE ${table} SET name = ?, active = ? WHERE id = ?`).run(name, Number(item.active), item.id)
}

export function deleteCatalogItem(db: Database.Database, kind: 'visaType' | 'country', id: number): void {
  const table = kind === 'visaType' ? 'visa_types' : 'countries'
  const name = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined
  if (!name) throw new Error('Catalog item not found.')
  const column = kind === 'visaType' ? 'visa_type' : 'country'
  const count = Number((db.prepare(`SELECT COUNT(*) AS count FROM applications WHERE ${column} = ?`).get(name.name) as { count: number }).count)
  if (count) throw new Error(`This ${kind === 'visaType' ? 'visa type' : 'country'} is used by ${count} application(s). Disable it instead to preserve history.`)
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
}
