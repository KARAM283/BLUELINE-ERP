import { describe, expect, it } from 'vitest'
import { buildClientSetupCode, normalizeServerFingerprint, parseClientSetupCode, parseOfficeServerAddress } from './lanSetup'

const fingerprint = 'AB'.repeat(32)

describe('office client setup', () => {
  it('parses an HTTPS server address and normalizes its fingerprint', () => {
    expect(parseOfficeServerAddress('https://192.168.1.101:45832')).toEqual({ host: '192.168.1.101', port: 45832 })
    expect(normalizeServerFingerprint('AB:'.repeat(31) + 'AB')).toBe(fingerprint)
  })

  it('round-trips the password-free client setup code', () => {
    const code = buildClientSetupCode('office-pc', 45832, fingerprint)
    expect(parseClientSetupCode(code)).toEqual({ host: 'office-pc', port: 45832, fingerprint })
  })

  it('rejects insecure, malformed, or incomplete connection details', () => {
    expect(() => parseOfficeServerAddress('http://office-pc:45832')).toThrow()
    expect(() => parseOfficeServerAddress('https://office-pc')).toThrow()
    expect(() => parseOfficeServerAddress('https://office-pc:443')).toThrow()
    expect(() => parseOfficeServerAddress('https://user:pass@office-pc:45832')).toThrow()
    expect(() => parseClientSetupCode('BLUELINE-OFFICE-1|https://office-pc:45832|invalid')).toThrow()
  })
})
