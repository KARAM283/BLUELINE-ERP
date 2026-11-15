import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { DOCUMENT_CHUNK_SIZE, DOCUMENT_MAX_SIZE } from './lanDocuments'
import { passportFieldNames, type PassportExtraction } from '../shared/passportProfiles'
import type { AuthUser, PassportDiagnostics } from '../shared/types'

type Job = {
  userId: number; session: string; size: number; received: number; chunks: Buffer[]
  extension: string; mime: string; path: string; expires: number; cancelled: boolean
  state: 'uploading' | 'processing' | 'ready' | 'failed'
  result?: { extraction: PassportExtraction; diagnostics: PassportDiagnostics }
}

function access(user: AuthUser) {
  if (!user.permissions.some((module) => module === 'Smart Scanner' || module === 'Visa Pipeline')) throw new Error('You do not have permission for this action.')
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid scanner input.')
  return value
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new Error('Invalid scanner input.')
  return value as Record<string, unknown>
}
function extraction(value: unknown): PassportExtraction {
  const input = record(value, ['profile', 'fields', 'assessments'])
  if (input.profile !== 'iraqi') throw new Error('Invalid scanner input.')
  const fields = record(input.fields, passportFieldNames)
  const assessments = record(input.assessments, passportFieldNames)
  const result = { profile: 'iraqi', fields: {}, assessments: {} } as PassportExtraction
  for (const name of passportFieldNames) {
    const assessment = record(assessments[name], ['value', 'confidence', 'sources', 'needsReview', 'conflict'])
    if (typeof assessment.confidence !== 'number' || !Number.isFinite(assessment.confidence)
      || assessment.confidence < 0 || assessment.confidence > 100 || !Array.isArray(assessment.sources)
      || assessment.sources.length > 2 || assessment.sources.some((source) => source !== 'visible' && source !== 'mrz')
      || typeof assessment.needsReview !== 'boolean' || typeof assessment.conflict !== 'boolean') throw new Error('Invalid scanner input.')
    result.fields[name] = string(fields[name], 2000)
    result.assessments[name] = {
      value: string(assessment.value, 2000), confidence: assessment.confidence,
      sources: assessment.sources as Array<'visible' | 'mrz'>, needsReview: assessment.needsReview, conflict: assessment.conflict
    }
  }
  return result
}

export class LanGemini {
  private readonly jobs = new Map<string, Job>()
  private readonly directory: string
  constructor(root: string, private readonly available: () => Promise<boolean>,
    private readonly inspect: (path: string, mime: string, local: PassportExtraction) => Promise<{ extraction: PassportExtraction; diagnostics: PassportDiagnostics }>) {
    this.directory = join(root, 'lan-gemini-scans')
    if (existsSync(this.directory)) {
      for (const name of readdirSync(this.directory)) if (/^scan-[a-f0-9-]{36}\.(pdf|jpg|jpeg|png)$/.test(name)) rmSync(join(this.directory, name), { force: true })
    }
    setInterval(() => this.expire(), 60_000).unref()
  }
  async execute(user: AuthUser, session: string, operation: string, args: unknown[]): Promise<unknown> {
    access(user)
    const count = (n: number) => { if (args.length !== n) throw new Error('Invalid action arguments.') }
    switch (operation) {
      case 'availability':
        count(0); return { configured: await this.available() }
      case 'begin': {
        count(2); this.expire()
        if (!await this.available()) throw new Error('Gemini is not configured on the office server.')
        if (this.jobs.size >= 1) throw new Error('A shared Gemini scan is already in progress.')
        const name = string(args[0], 180)
        const extension = extname(name).toLowerCase()
        if (!name || /[\\/:*?"<>|\x00-\x1f]/.test(name) || !['.jpg', '.jpeg', '.png', '.pdf'].includes(extension)
          || !Number.isSafeInteger(args[1]) || Number(args[1]) < 1 || Number(args[1]) > DOCUMENT_MAX_SIZE) throw new Error('Invalid scanner input.')
        const token = randomUUID()
        const mime = extension === '.pdf' ? 'application/pdf' : extension === '.png' ? 'image/png' : 'image/jpeg'
        this.jobs.set(token, { userId: user.id, session, size: Number(args[1]), received: 0, chunks: [], extension, mime,
          path: join(this.directory, `scan-${token}${extension}`), expires: Date.now() + 5 * 60_000, cancelled: false, state: 'uploading' })
        return token
      }
      case 'chunk': {
        count(3)
        const item = this.job(user, session, string(args[0], 64))
        const encoded = string(args[2], Math.ceil(DOCUMENT_CHUNK_SIZE / 3) * 4)
        const bytes = Buffer.from(encoded, 'base64')
        if (item.state !== 'uploading' || item.received >= item.size || args[1] !== item.received || bytes.toString('base64') !== encoded
          || bytes.length !== Math.min(DOCUMENT_CHUNK_SIZE, item.size - item.received)) throw new Error('Invalid scanner upload chunk.')
        item.chunks.push(bytes); item.received += bytes.length
        return item.received
      }
      case 'finish': {
        count(2)
        const token = string(args[0], 64)
        const item = this.job(user, session, token)
        const local = extraction(args[1])
        if (item.state !== 'uploading' || item.received !== item.size) throw new Error('Upload is incomplete.')
        mkdirSync(this.directory, { recursive: true })
        writeFileSync(item.path, Buffer.concat(item.chunks, item.size), { flag: 'wx' })
        item.chunks = []
        item.state = 'processing'
        void this.inspect(item.path, item.mime, local).then((result) => {
          if (!item.cancelled) { item.result = result; item.state = 'ready'; item.expires = Date.now() + 5 * 60_000 }
        }).catch(() => {
          if (!item.cancelled) { item.state = 'failed'; item.expires = Date.now() + 60_000 }
        }).finally(() => {
          try { rmSync(item.path, { force: true }) } catch { /* Startup removes abandoned files. */ }
          if (item.cancelled) this.jobs.delete(token)
        })
        return
      }
      case 'status': {
        count(1)
        const item = this.job(user, session, string(args[0], 64))
        if (item.state === 'failed') throw new Error('The office server could not complete the Gemini scan.')
        if (item.state === 'uploading') throw new Error('Upload is incomplete.')
        return { state: item.state, ...(item.result ? { result: item.result } : {}) }
      }
      case 'cancel': {
        count(1)
        const token = string(args[0], 64)
        const item = this.jobs.get(token)
        if (!item) return
        if (item.userId !== user.id || item.session !== session) throw new Error('Scan expired.')
        this.discard(token, item)
        return
      }
      default: throw new Error('Unsupported scanner action.')
    }
  }
  private job(user: AuthUser, session: string, token: string): Job {
    this.expire()
    const item = this.jobs.get(token)
    if (!item || item.cancelled || item.userId !== user.id || item.session !== session) throw new Error('Scan expired.')
    item.expires = Date.now() + 5 * 60_000
    return item
  }
  private discard(token: string, item: Job) {
    item.cancelled = true
    item.chunks = []
    if (item.state !== 'processing') {
      this.jobs.delete(token)
      try { rmSync(item.path, { force: true }) } catch { /* Startup removes abandoned files. */ }
    }
  }
  private expire() {
    const now = Date.now()
    for (const [token, item] of this.jobs) if (item.expires < now) this.discard(token, item)
  }
}
