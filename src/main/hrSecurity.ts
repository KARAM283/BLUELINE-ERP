import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type Database from 'better-sqlite3'

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 64)
}

function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw new Error('The HR password must be between 8 and 256 characters.')
  }
}

export function isHrPasswordConfigured(db: Database.Database): boolean {
  return Boolean(db.prepare('SELECT 1 FROM hr_security_settings WHERE id = 1').get())
}

export function setInitialHrPassword(db: Database.Database, actor: string, password: string): void {
  validatePassword(password)
  const salt = randomBytes(16)
  const result = db.prepare(`INSERT OR IGNORE INTO hr_security_settings(id, salt, password_hash, updated_by)
    VALUES (1, ?, ?, ?)`).run(salt.toString('hex'), hashPassword(password, salt).toString('hex'), actor)
  if (result.changes !== 1) throw new Error('The HR password has already been created.')
}

export function verifyHrPassword(db: Database.Database, password: string): boolean {
  if (typeof password !== 'string' || password.length > 256) return false
  const stored = db.prepare('SELECT salt, password_hash AS passwordHash FROM hr_security_settings WHERE id = 1')
    .get() as { salt: string; passwordHash: string } | undefined
  if (!stored) return false
  const actual = hashPassword(password, Buffer.from(stored.salt, 'hex'))
  const expected = Buffer.from(stored.passwordHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function changeHrPassword(db: Database.Database, actor: string, currentPassword: string, newPassword: string): void {
  validatePassword(newPassword)
  if (!verifyHrPassword(db, currentPassword)) throw new Error('The current HR password is incorrect.')
  const salt = randomBytes(16)
  db.prepare(`UPDATE hr_security_settings SET salt = ?, password_hash = ?, updated_by = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(salt.toString('hex'), hashPassword(newPassword, salt).toString('hex'), actor)
}

export function resetHrPassword(db: Database.Database, actor: string, newPassword: string): void {
  validatePassword(newPassword)
  const salt = randomBytes(16)
  const result = db.prepare(`UPDATE hr_security_settings SET salt = ?, password_hash = ?, updated_by = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(salt.toString('hex'), hashPassword(newPassword, salt).toString('hex'), actor)
  if (result.changes !== 1) throw new Error('The HR password is not configured.')
}
