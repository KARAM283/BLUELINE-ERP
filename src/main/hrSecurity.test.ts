import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeHrDatabase } from './hrDatabase'
import { changeHrPassword, isHrPasswordConfigured, resetHrPassword, setInitialHrPassword, verifyHrPassword } from './hrSecurity'

describe('HR password security', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    initializeHrDatabase(db)
  })

  afterEach(() => db.close())

  it('stores only a salted hash and verifies the HR password', () => {
    expect(isHrPasswordConfigured(db)).toBe(false)
    setInitialHrPassword(db, 'karam', 'strong-local-pass')
    expect(isHrPasswordConfigured(db)).toBe(true)
    expect(verifyHrPassword(db, 'strong-local-pass')).toBe(true)
    expect(verifyHrPassword(db, 'wrong-password')).toBe(false)
    const stored = db.prepare('SELECT salt, password_hash AS passwordHash FROM hr_security_settings WHERE id = 1')
      .get() as { salt: string; passwordHash: string }
    expect(stored.passwordHash).not.toContain('strong-local-pass')
    expect(stored.salt).toHaveLength(32)
    expect(() => setInitialHrPassword(db, 'karam', 'another-strong-pass')).toThrow('already been created')
  })

  it('requires the current password and replaces the hash when changing it', () => {
    setInitialHrPassword(db, 'karam', 'strong-local-pass')
    expect(() => changeHrPassword(db, 'karam', 'wrong-password', 'new-local-pass')).toThrow('current HR password')
    changeHrPassword(db, 'karam', 'strong-local-pass', 'new-local-pass')
    expect(verifyHrPassword(db, 'strong-local-pass')).toBe(false)
    expect(verifyHrPassword(db, 'new-local-pass')).toBe(true)
  })

  it('resets the HR password without the previous HR password', () => {
    setInitialHrPassword(db, 'karam', 'strong-local-pass')
    resetHrPassword(db, 'karam', 'reset-local-pass')
    expect(verifyHrPassword(db, 'strong-local-pass')).toBe(false)
    expect(verifyHrPassword(db, 'reset-local-pass')).toBe(true)
    expect(() => resetHrPassword(db, 'karam', 'short')).toThrow('between 8 and 256')
  })

  it('does not reset an HR password that has not been configured', () => {
    expect(() => resetHrPassword(db, 'karam', 'reset-local-pass')).toThrow('not configured')
  })

  it('rejects short passwords', () => {
    expect(() => setInitialHrPassword(db, 'karam', 'short')).toThrow('between 8 and 256')
  })
})
