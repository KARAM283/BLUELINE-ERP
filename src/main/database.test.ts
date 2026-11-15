import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STAGES } from '../shared/types'
import { addApplicationActivity, createApplication, getCustomerProfile, getDashboard, initializeDatabase, listAllDocuments, listApplicationActivities, listApplications, listCustomers, moveApplication, openDatabase, savePipeline, updateCustomer } from './database'

describe('local CRM database', () => {
  const db = initializeDatabase(new Database(':memory:'))
  afterEach(() => {
    db.exec('DELETE FROM application_activities; DELETE FROM documents; DELETE FROM customer_documents; DELETE FROM applications; DELETE FROM customers;')
    db.prepare('DELETE FROM pipeline_stage_definitions WHERE pipeline_id <> 1').run()
    db.prepare('UPDATE pipeline_stage_definitions SET active = 0 WHERE pipeline_id = 1').run()
    STAGES.forEach((stage, index) => {
      db.prepare(`INSERT INTO pipeline_stages(name, sort_order, active) VALUES (?, ?, 1)
        ON CONFLICT(name) DO UPDATE SET sort_order = excluded.sort_order, active = 1`).run(stage, index)
      db.prepare(`INSERT INTO pipeline_stage_definitions(pipeline_id, name, sort_order, active) VALUES (1, ?, ?, 1)
        ON CONFLICT(pipeline_id, name) DO UPDATE SET sort_order = excluded.sort_order, active = 1`).run(stage, index)
    })
  })

  it('creates durable application records and reuses a customer by passport number', () => {
    const first = createApplication(db, {
      fullName: 'Jordan Example', phone: '+12025550123', passportNumber: 'P1234567',
      country: 'Canada', visaType: 'Visitor', employee: 'Alex'
    })
    const second = createApplication(db, {
      fullName: 'Different spelling', phone: '+12025550123', passportNumber: 'p1234567',
      country: 'Japan', visaType: 'Tourist', employee: 'Alex'
    })

    expect(first.applicationId).toMatch(/^BL-\d{4}-\d{4}$/)
    expect(second.id).not.toBe(first.id)
    expect(second.customerId).toBe(first.customerId)
    expect(listApplications(db)).toHaveLength(2)
    expect(listCustomers(db)).toHaveLength(1)
  })

  it('creates an application when phone number and email are omitted', () => {
    const application = createApplication(db, {
      fullName: 'No Contact Example',
      country: 'Canada',
      visaType: 'Visitor',
      employee: ''
    })
    const customer = getCustomerProfile(db, application.customerId).customer

    expect(application.customerName).toBe('No Contact Example')
    expect(customer.phone).toBe('')
    expect(customer.email).toBe('')
  })

  it('starts applications at the selected pipeline first stage and preserves assignments on a stage rename', () => {
    const application = createApplication(db, {
      fullName: 'Pipeline Example', phone: '5550103', country: 'Japan', visaType: 'Visitor',
      employee: '', pipelineId: 1
    })
    moveApplication(db, application.id, 'Documents Collection')
    const reordered: string[] = STAGES.filter((stage) => stage !== 'Documents Collection')
    reordered.push('Awaiting Documents')
    savePipeline(db, { id: 1, name: 'Visa Applications', stages: reordered })

    expect(listApplications(db)[0].status).toBe('Awaiting Documents')
  })

  it('prevents assigning a passport number already used by another customer', () => {
    createApplication(db, {
      fullName: 'First Customer', phone: '5550104', passportNumber: 'AB123456',
      country: 'Italy', visaType: 'Visitor', employee: ''
    })
    const other = createApplication(db, {
      fullName: 'Second Customer', phone: '5550105',
      country: 'France', visaType: 'Visitor', employee: ''
    })

    expect(() => updateCustomer(db, other.customerId, {
      fullName: 'Second Customer', phone: '5550105', email: '', passportNumber: 'ab123456',
      dateOfBirth: '', nationality: '', gender: '', address: '', passportIssueDate: '', passportExpiryDate: ''
    })).toThrow('already assigned')
  })

  it('migrates a legacy v1 database without removing customer or document records', () => {
    const legacy = new Database(':memory:')
    legacy.exec(`
      CREATE TABLE pipeline_stages (name TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE customers (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', nationality TEXT NOT NULL DEFAULT '', passport_number TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE UNIQUE INDEX customers_passport_unique ON customers(passport_number) WHERE passport_number <> '';
      CREATE TABLE applications (id INTEGER PRIMARY KEY, application_id TEXT NOT NULL UNIQUE, customer_id INTEGER NOT NULL REFERENCES customers(id), country TEXT NOT NULL, visa_type TEXT NOT NULL, status TEXT NOT NULL REFERENCES pipeline_stages(name), employee TEXT NOT NULL DEFAULT '', application_date TEXT NOT NULL, follow_up_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE application_activities (id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id), activity_type TEXT NOT NULL, description TEXT NOT NULL, previous_value TEXT, new_value TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE documents (id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id), category TEXT NOT NULL, file_name TEXT NOT NULL, file_path TEXT NOT NULL, added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO pipeline_stages(name, sort_order) VALUES ('New Request', 0);
      INSERT INTO customers(id, full_name, phone, passport_number) VALUES (7, 'Legacy Customer', '5550106', 'LEGACY123');
      INSERT INTO applications(id, application_id, customer_id, country, visa_type, status, application_date) VALUES (9, 'BL-2024-0001', 7, 'Canada', 'Visitor', 'New Request', '2024-01-02');
      INSERT INTO documents(id, application_id, category, file_name, file_path) VALUES (11, 9, 'Passport', 'legacy.pdf', 'C:/existing/legacy.pdf');
    `)

    try {
      initializeDatabase(legacy)
      const profile = getCustomerProfile(legacy, 7)
      expect(profile.customer.fullName).toBe('Legacy Customer')
      expect(profile.documents).toMatchObject([
        { fileName: 'legacy.pdf', applicationId: 'BL-2024-0001', category: 'Passport' }
      ])
      expect(legacy.pragma('table_info(application_activities)')).toContainEqual(expect.objectContaining({ name: 'created_by' }))
      expect(listApplications(legacy)).toHaveLength(1)
      expect(legacy.pragma('user_version', { simple: true })).toBe(3)
    } finally {
      legacy.close()
    }
  })

  it('records each pipeline transition in the activity history', () => {
    const application = createApplication(db, {
      fullName: 'Sam Example', phone: '5550100', country: 'France', visaType: 'Business', employee: 'Taylor'
    })
    moveApplication(db, application.id, 'Documents Collection')
    moveApplication(db, application.id, 'Ready to Submit')

    const activities = db.prepare(`SELECT previous_value, new_value FROM application_activities
      WHERE application_id = ? AND activity_type = 'Status Changed' ORDER BY id`).all(application.id)
    expect(activities).toEqual([
      { previous_value: 'New Request', new_value: 'Documents Collection' },
      { previous_value: 'Documents Collection', new_value: 'Ready to Submit' }
    ])
    expect(getDashboard(db).byStatus['Ready to Submit']).toBe(1)
  })

  it('stores staff notes and customer touchpoints in application and customer histories', () => {
    const application = createApplication(db, {
      fullName: 'Activity Example', phone: '5550107', country: 'Japan', visaType: 'Visitor', employee: ''
    })
    addApplicationActivity(db, application.id, { activityType: 'Customer Call', description: 'Confirmed the appointment time.' })

    expect(listApplicationActivities(db, application.id)).toMatchObject([
      { applicationId: application.applicationId, activityType: 'Customer Call', description: 'Confirmed the appointment time.', createdBy: 'Blue Line Team' },
      { applicationId: application.applicationId, activityType: 'Application Created', createdBy: 'Blue Line Team' }
    ])
    expect(getCustomerProfile(db, application.customerId).activities).toHaveLength(2)
    expect(() => addApplicationActivity(db, application.id, { activityType: 'Internal Note', description: '   ' })).toThrow('description')
  })

  it('lists application and customer documents together without duplicating legacy file links', () => {
    const application = createApplication(db, {
      fullName: 'Documents Example', phone: '5550108', country: 'France', visaType: 'Visitor', employee: ''
    })
    db.prepare(`INSERT INTO documents(application_id, category, file_name, file_path) VALUES (?, 'Passport', 'passport.pdf', 'C:/docs/passport.pdf')`).run(application.id)
    db.prepare(`INSERT INTO customer_documents(customer_id, file_name, file_path, document_type)
      VALUES (?, 'extra.pdf', 'C:/docs/extra.pdf', 'Supporting document')`).run(application.customerId)
    db.prepare(`INSERT INTO customer_documents(customer_id, application_record_id, file_name, file_path, document_type, legacy_document_id)
      VALUES (?, ?, 'passport.pdf', 'C:/docs/passport.pdf', 'Passport', 1)`).run(application.customerId, application.id)

    expect(listAllDocuments(db)).toEqual(expect.arrayContaining([
      { fileName: 'passport.pdf', storage: 'application', applicationId: application.applicationId },
      { fileName: 'extra.pdf', storage: 'customer', applicationId: null }
    ].map((item) => expect.objectContaining(item))))
    expect(listAllDocuments(db)).toHaveLength(2)
  })

  it('rejects invalid pipeline stages without changing the saved stage', () => {
    const application = createApplication(db, {
      fullName: 'Case Example', phone: '5550101', country: 'Spain', visaType: 'Tourist', employee: ''
    })
    expect(() => moveApplication(db, application.id, 'Not a real stage' as never)).toThrow('Invalid pipeline stage')
    expect(listApplications(db)[0].status).toBe('New Request')
  })

  it('preserves application records across file-backed database restarts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'blue-line-visa-db-'))
    const filePath = join(directory, 'database', 'blueline.db')
    let fileDb = openDatabase(filePath)
    try {
      const application = createApplication(fileDb, {
        fullName: 'Persistent Example', phone: '5550102',
        country: 'Italy', visaType: 'Visitor', employee: ''
      })
      fileDb.close()
      fileDb = openDatabase(filePath)

      expect(listApplications(fileDb)).toMatchObject([
        { id: application.id, applicationId: application.applicationId, customerName: 'Persistent Example' }
      ])
      expect(getDashboard(fileDb).total).toBe(1)
    } finally {
      fileDb.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
