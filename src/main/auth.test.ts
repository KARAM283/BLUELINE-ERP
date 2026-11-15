import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  authenticate, createApplicationUser, deleteApplicationUser, initializeAuthDatabase,
  listApplicationUsers, updateApplicationUser
} from './auth'
import { APP_MODULES, defaultModulesForRole } from '../shared/types'

describe('application user authentication and management', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeAuthDatabase(db)
  })

  afterEach(() => db.close())

  it('adds credential columns to an older user table without replacing account records', () => {
    const karam = db.prepare(`SELECT password_salt AS salt, password_hash AS passwordHash
      FROM app_users WHERE username = 'karam'`).get() as { salt: string; passwordHash: string }
    createApplicationUser(db, {
      username: 'retained.user', displayName: 'Retained User', role: 'manager', password: 'retained-password'
    })
    const retained = db.prepare(`SELECT password_salt AS salt, password_hash AS passwordHash
      FROM app_users WHERE username = 'retained.user'`).get() as { salt: string; passwordHash: string }
    db.exec(`DROP TABLE app_users;
      CREATE TABLE app_users (
        username TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`)
    const insertLegacy = db.prepare(`INSERT INTO app_users(username, display_name, role, salt, password_hash, active)
      VALUES (?, ?, ?, ?, ?, ?)`)
    insertLegacy.run('karam', 'Karam Existing', 'admin', karam.salt, karam.passwordHash, 1)
    insertLegacy.run('retained.user', 'Retained Existing', 'manager', retained.salt, retained.passwordHash, 1)
    insertLegacy.run('disabled.user', 'Disabled User', 'visa', retained.salt, retained.passwordHash, 0)

    initializeAuthDatabase(db)

    const accounts = db.prepare(`SELECT id, username, display_name AS displayName, role, active,
      password_salt AS passwordSalt, password_hash AS passwordHash
      FROM app_users WHERE username IN ('karam', 'retained.user', 'disabled.user') ORDER BY username`).all() as Array<{
      id: number; username: string; displayName: string; role: string; active: number; passwordSalt: string; passwordHash: string
    }>
    expect(accounts).toHaveLength(3)
    expect(new Set(accounts.map(({ id }) => id)).size).toBe(3)
    expect(accounts.find(({ username }) => username === 'karam')).toMatchObject({
      displayName: 'Karam Existing', role: 'admin', active: 1,
      passwordSalt: karam.salt, passwordHash: karam.passwordHash
    })
    expect(authenticate(db, 'retained.user', 'retained-password')).toMatchObject({
      username: 'retained.user', displayName: 'Retained Existing', role: 'manager'
    })
    expect(authenticate(db, 'disabled.user', 'retained-password')).toBeNull()

    const created = createApplicationUser(db, {
      username: 'fresh.user', displayName: 'Fresh User', role: 'visa', password: 'fresh-password'
    })
    expect(authenticate(db, 'fresh.user', 'fresh-password')).toMatchObject({ id: created.id })
    updateApplicationUser(db, accounts.find(({ username }) => username === 'karam')!.id, {
      id: accounts.find(({ username }) => username === 'retained.user')!.id,
      username: 'retained.user', displayName: 'Retained Existing', role: 'manager', password: 'updated-password'
    })
    expect(authenticate(db, 'retained.user', 'updated-password')).not.toBeNull()
  })

  it('creates users with hashed credentials and updates their login details', () => {
    const created = createApplicationUser(db, {
      username: 'new.user', displayName: 'New User', role: 'manager', password: 'secure-password'
    })
    expect(authenticate(db, 'NEW.USER', 'secure-password')).toMatchObject({
      id: created.id, username: 'new.user', displayName: 'New User', role: 'manager',
      permissions: [...APP_MODULES]
    })

    const adminId = db.prepare("SELECT id FROM app_users WHERE role = 'admin'").get() as { id: number }
    updateApplicationUser(db, adminId.id, {
      id: created.id, username: 'new.user', displayName: 'Updated User', role: 'visa',
      password: 'replacement-password'
    })

    expect(authenticate(db, 'new.user', 'secure-password')).toBeNull()
    expect(authenticate(db, 'new.user', 'replacement-password')).toMatchObject({
      id: created.id, displayName: 'Updated User', role: 'visa',
      permissions: defaultModulesForRole('visa')
    })
    expect(listApplicationUsers(db).find(({ id }) => id === created.id)).not.toHaveProperty('passwordHash')
  })

  it('persists custom module permissions and preserves an explicitly empty selection', () => {
    const created = createApplicationUser(db, {
      username: 'custom.user', displayName: 'Custom User', role: 'visa', password: 'secure-password',
      permissions: ['Dashboard', 'Human Resources']
    })
    expect(created.permissions).toEqual(['Dashboard', 'My Attendance', 'Human Resources'])

    const adminId = db.prepare("SELECT id FROM app_users WHERE role = 'admin'").get() as { id: number }
    updateApplicationUser(db, adminId.id, {
      id: created.id, username: created.username, displayName: created.displayName,
      role: created.role, permissions: []
    })
    initializeAuthDatabase(db)

    expect(authenticate(db, created.username, 'secure-password')?.permissions).toEqual(['My Attendance'])
  })

  it('rejects duplicate usernames regardless of letter case', () => {
    createApplicationUser(db, {
      username: 'directory.user', displayName: 'Directory User', role: 'manager', password: 'secure-password'
    })
    expect(() => createApplicationUser(db, {
      username: 'Directory.User', displayName: 'Duplicate User', role: 'manager', password: 'secure-password'
    })).toThrow('already in use')
  })

  it('protects the signed-in account and last administrator', () => {
    const admin = db.prepare("SELECT id FROM app_users WHERE role = 'admin'").get() as { id: number }
    expect(() => deleteApplicationUser(db, admin.id, admin.id)).toThrow('currently using')
    expect(() => updateApplicationUser(db, admin.id, {
      id: admin.id, username: 'karam', displayName: 'Karam', role: 'manager'
    })).toThrow('own application role')

    const secondAdmin = createApplicationUser(db, {
      username: 'second.admin', displayName: 'Second Admin', role: 'admin', password: 'secure-password'
    })
    deleteApplicationUser(db, secondAdmin.id, admin.id)
    const manager = db.prepare("SELECT id FROM app_users WHERE role = 'manager'").get() as { id: number }
    expect(() => deleteApplicationUser(db, manager.id, secondAdmin.id)).toThrow('last administrator')
  })

  it('deletes an account and prevents subsequent authentication', () => {
    const created = createApplicationUser(db, {
      username: 'remove.user', displayName: 'Remove User', role: 'visa', password: 'secure-password'
    })
    const admin = db.prepare("SELECT id FROM app_users WHERE role = 'admin'").get() as { id: number }
    deleteApplicationUser(db, admin.id, created.id)
    expect(authenticate(db, 'remove.user', 'secure-password')).toBeNull()
  })
})
