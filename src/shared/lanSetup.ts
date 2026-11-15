const setupCodePrefix = 'BLUELINE-OFFICE-1'

export type OfficeServerAddress = { host: string; port: number }
export type OfficeClientSetup = OfficeServerAddress & { fingerprint: string }

function isValidHost(host: string): boolean {
  if (!host || host.length > 253 || host.startsWith('.') || host.endsWith('.')) return false
  return host.split('.').every((label) => label.length > 0 && label.length <= 63
    && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label))
}

export function parseOfficeServerAddress(value: unknown): OfficeServerAddress {
  if (typeof value !== 'string' || value.length > 300) throw new Error('Enter a valid HTTPS office server address.')
  let url: URL
  try { url = new URL(value.trim()) }
  catch { throw new Error('Enter the server address as https://host:port.') }
  if (url.protocol !== 'https:' || !url.port || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !isValidHost(url.hostname)) {
    throw new Error('Enter the server address as https://host:port.')
  }
  const port = Number(url.port)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Server port must be between 1024 and 65535.')
  }
  return { host: url.hostname, port }
}

export function normalizeServerFingerprint(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter the server SHA-256 certificate fingerprint.')
  const fingerprint = value.trim().replace(/:/g, '').toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(fingerprint)) throw new Error('Enter a valid 64-character SHA-256 certificate fingerprint.')
  return fingerprint
}

export function buildClientSetupCode(host: string, port: number, fingerprint: string): string {
  if (!isValidHost(host) || !Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Invalid office server address.')
  }
  const normalizedFingerprint = normalizeServerFingerprint(fingerprint)
  return `${setupCodePrefix}|https://${host}:${port}|${normalizedFingerprint}`
}

export function parseClientSetupCode(value: unknown): OfficeClientSetup {
  if (typeof value !== 'string' || value.length > 500) throw new Error('Invalid office client setup code.')
  const [prefix, address, fingerprint, ...extra] = value.trim().split('|')
  if (prefix !== setupCodePrefix || !address || !fingerprint || extra.length) {
    throw new Error('Paste a valid client setup code copied from the office server.')
  }
  return { ...parseOfficeServerAddress(address), fingerprint: normalizeServerFingerprint(fingerprint) }
}
