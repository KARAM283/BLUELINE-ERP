import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'
import { APP_MODULES, defaultModulesForRole, type AppModule, type AuthUser } from '../shared/types'

const roles = ['admin', 'visa', 'manager'] as const
type UserRole = typeof roles[number]
type UserRow = {
  id: number
  username: string
  displayName: string
  role: UserRole
  passwordSalt: string
  passwordHash: string
}

const initialAccounts: Array<{ username: string; displayName: string; role: UserRole; salt: string; hash: string }> = [
  {
    username: 'karam',
    displayName: 'Karam',
    role: 'admin',
    salt: 'cabd4c9cb7673f76eda1fe7668e98866',
    hash: '4e61e2390d39a54cbb6cfccf923519555a0a6a3e91826953c495fb50a8014d64a5eef8322c30b7477194618b6ff7ec84635d04a366a7fd64ac15be7ecbf833e3'
  },
  {
    username: 'hind',
    displayName: 'Hind',
    role: 'visa',
    salt: '4de6089476974c4e034e512be34236ce',
    hash: '61f941bb7d6554e586d2944664c972b9f382d2b788918c138359d525871e6ed0fe82115a4400b0b11bfdc3471ad05fd01b4e53bf5c2bd8ac50ca637e248f018b'
  },
  {
    username: 'mustafa',
    displayName: 'Mustafa',
    role: 'manager',
    salt: '3fab56333fd6c2d32b93c40bd934c98c',
    hash: '5d9cff3238ccf5f990395ab3a8dbacbdafbb044aff3599f9b55c29bd0bd00767d63e4b0e65f1fe96b17e32f475348105350cd58539331f967d200259db31f2b6'
  }
]

export function initializeAuthDatabase(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'visa', 'manager')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  const migrateAndSeed = db.transaction(() => {
    const tableInfo = db.prepare('PRAGMA table_info(app_users)').all() as Array<{ name: string; pk: number }>
    const columns = new Set(tableInfo.map(({ name }) => name))
    for (const column of ['id', 'username', 'display_name', 'role']) {
      if (column !== 'id' && !columns.has(column)) {
        throw new Error(`Unsupported app_users schema: missing ${column} column.`)
      }
    }
    if (!columns.has('id')) db.exec('ALTER TABLE app_users ADD COLUMN id INTEGER')
    if (!columns.has('password_salt')) {
      db.exec("ALTER TABLE app_users ADD COLUMN password_salt TEXT NOT NULL DEFAULT ''")
    }
    if (!columns.has('password_hash')) {
      db.exec("ALTER TABLE app_users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")
    }
    if (!columns.has('active')) db.exec('ALTER TABLE app_users ADD COLUMN active INTEGER NOT NULL DEFAULT 1')
    if (columns.has('salt')) {
      db.exec("UPDATE app_users SET password_salt = salt WHERE password_salt = '' AND salt <> ''")
    }

    const idIsPrimaryKey = tableInfo.some(({ name, pk }) => name === 'id' && pk === 1)
    if (!idIsPrimaryKey) {
      db.exec(`UPDATE app_users SET id = rowid WHERE id IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS app_users_id_unique ON app_users(id);
        CREATE TRIGGER IF NOT EXISTS app_users_assign_id AFTER INSERT ON app_users
        WHEN NEW.id IS NULL BEGIN
          UPDATE app_users SET id = NEW.rowid WHERE rowid = NEW.rowid;
        END;`)
    }

    const find = db.prepare(`SELECT id, password_salt AS passwordSalt, password_hash AS passwordHash
      FROM app_users WHERE username = ? COLLATE NOCASE`)
    const insert = columns.has('salt')
      ? db.prepare(`INSERT INTO app_users(username, display_name, role, salt, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)`)
      : db.prepare(`INSERT INTO app_users(username, display_name, role, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, 1)`)
    const updateCredentials = db.prepare(`UPDATE app_users SET password_salt = ?, password_hash = ?
      WHERE id = ?`)
    for (const account of initialAccounts) {
      const existing = find.get(account.username) as Pick<UserRow, 'id' | 'passwordSalt' | 'passwordHash'> | undefined
      if (!existing) {
        if (columns.has('salt')) {
          insert.run(account.username, account.displayName, account.role, account.salt, account.salt, account.hash)
        } else {
          insert.run(account.username, account.displayName, account.role, account.salt, account.hash)
        }
      } else if (!/^[\da-f]{32}$/i.test(existing.passwordSalt)
        || !/^[\da-f]{128}$/i.test(existing.passwordHash)) {
        updateCredentials.run(account.salt, account.hash, existing.id)
        if (columns.has('salt')) {
          db.prepare('UPDATE app_users SET salt = ? WHERE id = ?').run(account.salt, existing.id)
        }
      }
    }
  })
  migrateAndSeed()
  db.exec(`CREATE TABLE IF NOT EXISTS app_user_module_permissions (
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    module TEXT NOT NULL,
    allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
    PRIMARY KEY (user_id, module)
  )`)
  const insertPermission = db.prepare(`INSERT OR IGNORE INTO app_user_module_permissions(user_id, module, allowed)
    VALUES (?, ?, ?)`)
  const savedUserIds = new Set((db.prepare('SELECT DISTINCT user_id AS id FROM app_user_module_permissions').all() as Array<{ id: number }>)
    .map(({ id }) => Number(id)))
  for (const user of db.prepare('SELECT id, role FROM app_users').all() as Array<{ id: number; role: UserRole }>) {
    if (!savedUserIds.has(user.id)) {
      const defaults = new Set(defaultModulesForRole(user.role))
      for (const module of APP_MODULES) insertPermission.run(user.id, module, Number(defaults.has(module)))
    }
    insertPermission.run(user.id, 'My Attendance', 1)
  }
}

export function authenticate(db: Database.Database, username: unknown, password: unknown): AuthUser | null {
  if (typeof username !== 'string' || typeof password !== 'string' || password.length > 256) return null
  const name = username.trim()
  if (!name) return null
  const row = db.prepare(`SELECT id, username, display_name AS displayName, role,
    password_salt AS passwordSalt, password_hash AS passwordHash
    FROM app_users WHERE username = ? COLLATE NOCASE AND active = 1`).get(name) as UserRow | undefined
  if (!row || !roles.includes(row.role) || !/^[\da-f]{32}$/i.test(row.passwordSalt)
    || !/^[\da-f]{128}$/i.test(row.passwordHash)) return null
  const actual = scryptSync(password, Buffer.from(row.passwordSalt, 'hex'), 64)
  const expected = Buffer.from(row.passwordHash, 'hex')
  if (!timingSafeEqual(actual, expected)) return null
  return toAuthUser(db, row)
}

export function listApplicationUsers(db: Database.Database): AuthUser[] {
  const rows = db.prepare(`SELECT id, username, display_name AS displayName, role
    FROM app_users ORDER BY display_name COLLATE NOCASE, username COLLATE NOCASE`)
    .all() as Pick<UserRow, 'id' | 'username' | 'displayName' | 'role'>[]
  return rows.map((row) => toAuthUser(db, row))
}

export function createApplicationUser(db: Database.Database, input: unknown): AuthUser {
  const user = parseUserInput(input, true)
  if (db.prepare('SELECT 1 FROM app_users WHERE username = ? COLLATE NOCASE').get(user.username)) {
    throw new Error('That username is already in use.')
  }
  const { salt, hash } = hashPassword(user.password!)
  const create = db.transaction(() => {
    const result = hasLegacySaltColumn(db)
      ? db.prepare(`INSERT INTO app_users(username, display_name, role, salt, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)`).run(user.username, user.displayName, user.role, salt, salt, hash)
      : db.prepare(`INSERT INTO app_users(username, display_name, role, password_salt, password_hash, active)
        VALUES (?, ?, ?, ?, ?, 1)`).run(user.username, user.displayName, user.role, salt, hash)
    const id = Number(result.lastInsertRowid)
    savePermissions(db, id, user.permissions ?? defaultModulesForRole(user.role))
    return id
  })
  const id = create()
  return getApplicationUser(db, id)
}

export function updateApplicationUser(db: Database.Database, actorId: number, input: unknown): AuthUser {
  const user = parseUserInput(input, false)
  const id = user.id
  if (!id) throw new Error('Invalid application user ID.')
  const previous = getApplicationUser(db, id)
  if (id === actorId && user.role !== previous.role) {
    throw new Error('You cannot change your own application role while signed in.')
  }
  if (db.prepare('SELECT 1 FROM app_users WHERE username = ? COLLATE NOCASE AND id <> ?').get(user.username, id)) {
    throw new Error('That username is already in use.')
  }
  const permissions = user.permissions ?? (
    user.role === previous.role ? previous.permissions : defaultModulesForRole(user.role)
  )
  const update = db.transaction(() => {
    if (user.password) {
      const { salt, hash } = hashPassword(user.password)
      if (hasLegacySaltColumn(db)) {
        db.prepare(`UPDATE app_users SET username = ?, display_name = ?, role = ?, salt = ?, password_salt = ?,
          password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(user.username, user.displayName, user.role, salt, salt, hash, id)
      } else {
        db.prepare(`UPDATE app_users SET username = ?, display_name = ?, role = ?, password_salt = ?,
          password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(user.username, user.displayName, user.role, salt, hash, id)
      }
    } else {
      db.prepare(`UPDATE app_users SET username = ?, display_name = ?, role = ?,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(user.username, user.displayName, user.role, id)
    }
    savePermissions(db, id, permissions)
  })
  update()
  return getApplicationUser(db, id)
}

export function deleteApplicationUser(db: Database.Database, actorId: number, id: number): void {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid application user ID.')
  if (id === actorId) throw new Error('You cannot delete the account you are currently using.')
  const user = getApplicationUser(db, id)
  if (user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin'").get() as { count: number }
    if (admins.count <= 1) throw new Error('The last administrator account cannot be deleted.')
  }
  db.prepare('DELETE FROM app_users WHERE id = ?').run(id)
}

type ParsedUserInput = {
  id?: number
  username: string
  displayName: string
  role: UserRole
  password?: string
  permissions?: AppModule[]
}

function parseUserInput(input: unknown, passwordRequired: boolean): ParsedUserInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid application user details.')
  const value = input as Record<string, unknown>
  const id = value.id
  if (id !== undefined && (!Number.isSafeInteger(id) || Number(id) <= 0)) throw new Error('Invalid application user ID.')
  if (passwordRequired && id !== undefined) throw new Error('Invalid new application user details.')
  if (typeof value.username !== 'string' || typeof value.displayName !== 'string'
    || typeof value.role !== 'string' || !roles.includes(value.role as UserRole)) {
    throw new Error('Enter a username, display name, and valid application role.')
  }
  const username = value.username.trim().toLowerCase()
  const displayName = value.displayName.trim()
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error('Username must be 3–32 characters and use letters, numbers, dots, underscores, or hyphens.')
  }
  if (displayName.length < 1 || displayName.length > 80) throw new Error('Display name must be between 1 and 80 characters.')
  let password: string | undefined
  if (typeof value.password === 'string') password = value.password
  else if (value.password !== undefined) throw new Error('Invalid application password.')
  if (passwordRequired && (!password || password.length < 8 || password.length > 256)) {
    throw new Error('Password must be between 8 and 256 characters.')
  }
  if (password && (password.length < 8 || password.length > 256)) throw new Error('Password must be between 8 and 256 characters.')
  let permissions: AppModule[] | undefined
  if (value.permissions !== undefined) {
    if (!Array.isArray(value.permissions)
      || value.permissions.some((module) => typeof module !== 'string' || !APP_MODULES.includes(module as AppModule))) {
      throw new Error('Invalid application module permissions.')
    }
    permissions = [...new Set(value.permissions as AppModule[])]
  }
  return {
    ...(id === undefined ? {} : { id: Number(id) }),
    username, displayName, role: value.role as UserRole, ...(password ? { password } : {}),
    ...(permissions ? { permissions } : {})
  }
}

function getApplicationUser(db: Database.Database, id: number): AuthUser {
  const row = db.prepare(`SELECT id, username, display_name AS displayName, role
    FROM app_users WHERE id = ?`).get(id) as Pick<UserRow, 'id' | 'username' | 'displayName' | 'role'> | undefined
  if (!row) throw new Error('Application user not found.')
  return toAuthUser(db, row)
}

function toAuthUser(db: Database.Database, row: Pick<UserRow, 'id' | 'username' | 'displayName' | 'role'>): AuthUser {
  const permissions = db.prepare(`SELECT module FROM app_user_module_permissions
    WHERE user_id = ? AND allowed = 1`).all(row.id) as Array<{ module: string }>
  const savedModules = new Set(permissions.map(({ module }) => module))
  savedModules.add('My Attendance')
  const savedPermissions = APP_MODULES.filter((module) => savedModules.has(module))
  return {
    id: Number(row.id), username: row.username, displayName: row.displayName, role: row.role,
    permissions: row.role === 'admin' ? [...APP_MODULES] : savedPermissions
  }
}

function savePermissions(db: Database.Database, userId: number, permissions: AppModule[]): void {
  const allowed = new Set(permissions)
  if (allowed.size !== permissions.length || permissions.some((module) => !APP_MODULES.includes(module))) {
    throw new Error('Invalid application module permissions.')
  }
  const user = db.prepare('SELECT role FROM app_users WHERE id = ?').get(userId) as { role: UserRole } | undefined
  allowed.add('My Attendance')
  if (user?.role === 'admin') {
    allowed.clear()
    APP_MODULES.forEach((module) => allowed.add(module))
  }
  db.prepare('DELETE FROM app_user_module_permissions WHERE user_id = ?').run(userId)
  const insert = db.prepare(`INSERT INTO app_user_module_permissions(user_id, module, allowed)
    VALUES (?, ?, ?)`)
  for (const module of APP_MODULES) insert.run(userId, module, Number(allowed.has(module)))
}

function hasLegacySaltColumn(db: Database.Database): boolean {
  return (db.prepare('PRAGMA table_info(app_users)').all() as Array<{ name: string }>)
    .some(({ name }) => name === 'salt')
}

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16)
  return { salt: salt.toString('hex'), hash: scryptSync(password, salt, 64).toString('hex') }
}
