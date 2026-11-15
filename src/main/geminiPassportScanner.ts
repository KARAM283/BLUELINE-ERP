import { GoogleGenAI, Type } from '@google/genai'
import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GeminiPassportFields, PassportExtraction } from '../shared/passportProfiles'
import type { GeminiSettings, GeminiUsage, PassportDiagnostics, PassportProvider } from '../shared/types'
import { mergeGeminiPassport } from '../shared/passportProfiles'

export type GeminiModel = string
type StoredGeminiSettings = { encryptedApiKey: string; model: GeminiModel; provider: PassportProvider }

const defaultModel: GeminiModel = 'gemini-2.5-flash'
const requestTimeoutMs = 45_000
const maxAttempts = 3
const emptyUsage: GeminiUsage = { requests: 0, successes: 0, failures: 0, promptTokens: 0, candidateTokens: 0, lastUsedAt: null }

const fieldSchema = {
  type: Type.OBJECT,
  properties: {
    value: { type: Type.STRING, nullable: true, description: 'The exact visible value or null if unreadable or absent. Never infer.' },
    confidence: { type: Type.NUMBER, minimum: 0, maximum: 100, description: 'Visual legibility confidence from 0 to 100. This is not human verification.' }
  },
  required: ['value', 'confidence']
} as const

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    firstName: fieldSchema,
    surname: fieldSchema,
    fullName: fieldSchema,
    passportNumber: fieldSchema,
    issueDate: fieldSchema,
    expiryDate: fieldSchema,
    dateOfBirth: fieldSchema,
    nationality: fieldSchema,
    gender: fieldSchema
  },
  required: ['firstName', 'surname', 'fullName', 'passportNumber', 'issueDate', 'expiryDate', 'dateOfBirth', 'nationality', 'gender']
} as const

function isModel(value: unknown): value is GeminiModel {
  return typeof value === 'string' && /^gemini-[a-zA-Z0-9._-]{1,100}$/.test(value)
}

function isProvider(value: unknown): value is PassportProvider {
  return value === 'ocr' || value === 'gemini'
}

function normalizeResponse(value: unknown): GeminiPassportFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GeminiPassportError('PASSPORT_VALIDATION_ERROR', 'Gemini returned JSON with an invalid passport response shape.', diagnostic('', {
      apiConnection: 'success', imageProcessing: 'success', request: 'success', response: 'success', jsonParsing: 'success', validation: 'failed'
    }))
  }
  const response = value as Record<string, unknown>
  const keys = ['firstName', 'surname', 'fullName', 'passportNumber', 'issueDate', 'expiryDate', 'dateOfBirth', 'nationality', 'gender'] as const
  const normalized = {} as GeminiPassportFields
  for (const key of keys) {
    const candidate = response[key]
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      normalized[key] = { value: null, confidence: 0 }
      continue
    }
    const field = candidate as { value?: unknown; confidence?: unknown }
    if ((field.value !== null && typeof field.value !== 'string')
      || (field.confidence !== undefined && (typeof field.confidence !== 'number' || !Number.isFinite(field.confidence)))) {
      normalized[key] = { value: null, confidence: 0 }
      continue
    }
    normalized[key] = {
      value: typeof field.value === 'string' && field.value.trim() ? field.value.trim().slice(0, 120) : null,
      confidence: typeof field.confidence === 'number' ? Math.max(0, Math.min(100, field.confidence)) : 0
    }
  }
  return normalized
}

function apiErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const status = (error as { status?: number; code?: number } | null)?.status
    ?? (error as { status?: number; code?: number } | null)?.code
  if (status === 401 || status === 403 || /API key|invalid credential|permission denied/i.test(message)) {
    return 'Gemini rejected the API key or this key does not have permission. Check the key and try again.'
  }
  if (status === 429 || /quota|rate limit|resource exhausted/i.test(message)) {
    return 'Gemini request quota or rate limit was reached. Wait a moment and retry.'
  }
  if (/abort|timeout|timed out/i.test(message)) return 'Gemini request timed out. Check the connection and retry.'
  if (/fetch failed|network|ENOTFOUND|ECONN/i.test(message)) return 'Could not connect to Gemini. Check the internet connection and retry.'
  return 'Gemini could not recognize this passport. Retry, check the connection, or switch to local OCR.'
}

export type GeminiFailureCategory =
  | 'API_AUTHENTICATION_ERROR'
  | 'API_CONNECTION_ERROR'
  | 'MODEL_NOT_AVAILABLE'
  | 'IMAGE_PROCESSING_ERROR'
  | 'IMAGE_UPLOAD_ERROR'
  | 'GEMINI_EMPTY_RESPONSE'
  | 'GEMINI_RESPONSE_PARSE_ERROR'
  | 'PASSPORT_VALIDATION_ERROR'
  | 'IPC_HANDLER_ERROR'

export class GeminiPassportError extends Error {
  constructor(
    readonly category: GeminiFailureCategory,
    message: string,
    readonly diagnostics: PassportDiagnostics
  ) {
    super(message)
    this.name = 'GeminiPassportError'
  }
}

function failureCategory(error: unknown): GeminiFailureCategory {
  if (error instanceof GeminiPassportError) return error.category
  const message = error instanceof Error ? error.message : ''
  const status = (error as { status?: number; code?: number } | null)?.status
    ?? (error as { status?: number; code?: number } | null)?.code
  if (status === 401 || status === 403 || /API key|invalid credential|permission denied/i.test(message)) return 'API_AUTHENTICATION_ERROR'
  if (status === 404 || /\b404\b|model.{0,50}(not found|unavailable|does not exist)/i.test(message)) return 'MODEL_NOT_AVAILABLE'
  if (/schema|response.?format|invalid argument|structured output/i.test(message)) return 'PASSPORT_VALIDATION_ERROR'
  if (/image|mime|media type|payload|file too large|unsupported format/i.test(message)) return 'IMAGE_UPLOAD_ERROR'
  if (/fetch failed|network|ENOTFOUND|ECONN|socket|connection/i.test(message)) return 'API_CONNECTION_ERROR'
  if (/payload|image|mime|media type|file too large|unsupported format/i.test(message)) return 'IMAGE_UPLOAD_ERROR'
  if (/empty response|no text candidate/i.test(message)) return 'GEMINI_EMPTY_RESPONSE'
  return 'API_CONNECTION_ERROR'
}

function safeFailureMessage(error: unknown, apiKey?: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(apiKey || /\u0000/, '[redacted]')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted image data]')
    .replace(/\b[A-Za-z0-9+/]{160,}={0,2}\b/g, '[redacted encoded data]')
    .replace(/(?:key|api_key|authorization)\s*[:=]\s*["']?[^,\s"']+/gi, 'credential=[redacted]')
    .slice(0, 1000)
}

function diagnostic(
  model: string,
  stages: PassportDiagnostics['stages'],
  values: Partial<Pick<PassportDiagnostics, 'category' | 'message' | 'attempts' | 'responsePreview'>> = {}
): PassportDiagnostics {
  return { model, stages, ...values }
}

async function retryRequest<T>(action: (signal: AbortSignal) => Promise<T>, onAttempt?: () => void): Promise<{ value: T; attempts: number }> {
  let lastError: unknown
  let attempts = 0
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    attempts += 1
    onAttempt?.()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      return { value: await action(controller.signal), attempts }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
    const status = (lastError as { status?: number; code?: number } | null)?.status
      ?? (lastError as { status?: number; code?: number } | null)?.code
    if (status !== undefined && status !== 429 && status < 500) break
    if (attempt + 1 < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
  }
  const category = failureCategory(lastError)
  const message = `${category}: ${apiErrorMessage(lastError)}${lastError instanceof Error && lastError.message ? ` Details: ${safeFailureMessage(lastError)}` : ''}`
  throw Object.assign(new Error(message), { attempts, category })
}

export class GeminiPassportScanner {
  private readonly configPath: string
  private readonly usagePath: string

  constructor(userDataPath: string) {
    this.configPath = join(userDataPath, 'gemini-config.json')
    this.usagePath = join(userDataPath, 'gemini-usage.json')
  }

  async getSettings(): Promise<GeminiSettings> {
    const config = await this.readConfig()
    return {
      configured: Boolean(config?.encryptedApiKey),
      model: config?.model ?? defaultModel,
      provider: config?.provider ?? 'ocr',
      usage: await this.readUsage()
    }
  }

  async listModels(apiKeyInput?: string): Promise<Array<{ id: string; displayName: string }>> {
    if (apiKeyInput !== undefined && typeof apiKeyInput !== 'string') throw new Error('The Gemini API key format is invalid.')
    const apiKey = apiKeyInput?.trim() || await this.readApiKey()
    if (!apiKey) throw new Error('Enter a Gemini API key before loading supported models.')
    const result = await retryRequest(async (signal) => {
      const client = new GoogleGenAI({ apiKey })
      const pager = await client.models.list({ config: { pageSize: 100, abortSignal: signal, httpOptions: { timeout: requestTimeoutMs } } })
      const models: Array<{ id: string; displayName: string }> = []
      for await (const model of pager) {
        const id = model.name?.replace(/^models\//, '')
        if (!id || !/^gemini-[a-zA-Z0-9._-]+$/.test(id) || !model.supportedActions?.includes('generateContent')) continue
        models.push({ id, displayName: model.displayName || id })
        if (models.length >= 100) break
      }
      return models.sort((a, b) => a.displayName.localeCompare(b.displayName))
    })
    if (!result.value.length) throw new Error('This API key has no supported Gemini content-generation models available.')
    return result.value
  }

  async saveSettings(input: { apiKey?: string; model: unknown; provider: unknown }): Promise<GeminiSettings> {
    if (!isModel(input.model) || !isProvider(input.provider)) throw new Error('Select a supported Gemini model and passport recognition engine.')
    const current = await this.readConfig()
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('The Gemini API key format is invalid.')
    const apiKey = input.apiKey?.trim()
    if (apiKey && (apiKey.length > 512 || /[\r\n]/.test(apiKey))) throw new Error('The Gemini API key format is invalid.')
    if (input.provider === 'gemini' && !apiKey && !current?.encryptedApiKey) {
      throw new Error('Enter and save a Gemini API key before selecting Gemini as the recognition engine.')
    }
    if (apiKey && !safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure credential storage is unavailable on this device. The API key was not saved.')
    }
    const encryptedApiKey = apiKey
      ? safeStorage.encryptString(apiKey).toString('base64')
      : current?.encryptedApiKey ?? ''
    await this.writeConfig({ encryptedApiKey, model: input.model, provider: input.provider })
    return this.getSettings()
  }

  async testConnection(input: { apiKey?: string; model: unknown }): Promise<{ ok: true; model: GeminiModel }> {
    const model = input.model
    if (!isModel(model)) throw new Error('Select a supported Gemini model.')
    if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new Error('The Gemini API key format is invalid.')
    const key = input.apiKey?.trim() || await this.readApiKey()
    if (!key) throw new Error('Enter a Gemini API key before testing the connection.')
    await retryRequest(async (signal) => {
      const client = new GoogleGenAI({ apiKey: key })
      await client.models.get({ model, config: { abortSignal: signal, httpOptions: { timeout: requestTimeoutMs } } })
    })
    return { ok: true, model }
  }

  async diagnoseConnection(model: string): Promise<PassportDiagnostics> {
    const stages: PassportDiagnostics['stages'] = {
      apiConnection: 'pending', imageProcessing: 'skipped', request: 'skipped',
      response: 'skipped', jsonParsing: 'skipped', validation: 'skipped'
    }
    try {
      const key = await this.readApiKey()
      if (!key) throw new GeminiPassportError('API_AUTHENTICATION_ERROR', 'No Gemini API key is configured.', diagnostic(model, { ...stages, apiConnection: 'failed' }))
      await this.testConnection({ model })
      return diagnostic(model, { ...stages, apiConnection: 'success' })
    } catch (error) {
      const category = failureCategory(error)
      return diagnostic(model, { ...stages, apiConnection: 'failed' }, {
        category,
        message: error instanceof Error ? safeFailureMessage(error) : 'Gemini connection test failed.'
      })
    }
  }

  async inspectImage(
    filePath: string,
    mimeType: string,
    local: PassportExtraction,
    model: GeminiModel
  ): Promise<{ extraction: PassportExtraction; diagnostics: PassportDiagnostics }> {
    const stages: PassportDiagnostics['stages'] = {
      apiConnection: 'pending', imageProcessing: 'pending', request: 'pending',
      response: 'pending', jsonParsing: 'pending', validation: 'pending'
    }
    let apiKey = ''
    try {
      apiKey = await this.readApiKey()
      if (!apiKey) throw Object.assign(new Error('Gemini is selected but no API key is configured. Add it in Settings or switch to local OCR.'), { category: 'API_AUTHENTICATION_ERROR' })
      stages.apiConnection = 'pending'
    } catch (error) {
      stages.apiConnection = 'failed'
      throw this.makeScanError(error, model, stages)
    }

    let image: Buffer
    try {
      image = await readFile(filePath)
      if (!image.length) throw new Error('The selected passport file is empty.')
      if (image.length > 25 * 1024 * 1024) throw new Error('Passport image must be smaller than 25 MB.')
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mimeType)) throw new Error(`Unsupported passport MIME type: ${mimeType || 'missing'}.`)
      const validSignature = mimeType === 'image/jpeg'
        ? image[0] === 0xff && image[1] === 0xd8
        : mimeType === 'image/png'
          ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : image.subarray(0, 5).toString('ascii') === '%PDF-'
      if (!validSignature) throw new Error(`The file contents do not match the detected ${mimeType} format.`)
      stages.imageProcessing = 'success'
    } catch (error) {
      stages.imageProcessing = 'failed'
      throw this.makeScanError(error, model, stages, 'IMAGE_PROCESSING_ERROR')
    }
    const prompt = `You are a visual passport-field reader using the Iraqi passport profile. Inspect the provided original passport image and locate fields by their printed labels and physical positions, never by OCR text order. For Iraqi passports, read Passport No from the upper-right field; Full Name from the middle-left; Surname from its dedicated labeled field below Full Name; Date of Issue and Date of Expiry from their own labels; Nationality only from the dedicated Nationality label; never use country code IRQ as nationality or a code-zone value as the passport number. Read First Name as only the first given-name token from the visible Full Name; read Surname from its own labeled field. Use the MRZ only as corroboration and never as the sole source. Preserve spelling exactly as visibly printed. Do not infer, guess, autocorrect, or fill missing data. For an unreadable or absent field, set value to null and confidence to 0. For readable dates return YYYY-MM-DD only when unambiguous; otherwise null. For every other value provide a 0-100 estimate of visual legibility, not verification. If the image is not an Iraqi passport biodata page, return all values null and confidence 0.`
    let attempts = 0
    let usage: { promptTokens: number; candidateTokens: number } = { promptTokens: 0, candidateTokens: 0 }
    let responseText = ''
    try {
      const result = await retryRequest(async (signal) => {
        const client = new GoogleGenAI({ apiKey })
        const response = await client.models.generateContent({
          model,
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { data: image.toString('base64'), mimeType } }
            ]
          }],
          config: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema,
            abortSignal: signal,
            httpOptions: { timeout: requestTimeoutMs }
          }
        })
        usage = {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          candidateTokens: response.usageMetadata?.candidatesTokenCount ?? 0
        }
        const text = response.text
          ?? response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('')
          ?? ''
        if (!text.trim()) throw new Error('GEMINI_EMPTY_RESPONSE: Gemini returned no text candidate.')
        return { text, response }
      }, () => { attempts += 1 })
      responseText = result.value.text
      stages.request = 'success'
      stages.response = 'success'
      stages.apiConnection = 'success'
    } catch (error) {
      await this.recordUsage(attempts, false, usage)
      stages.request = 'failed'
      const category = failureCategory(error)
      if (category === 'API_AUTHENTICATION_ERROR' || category === 'API_CONNECTION_ERROR') stages.apiConnection = 'failed'
      else stages.apiConnection = 'success'
      if (category === 'IMAGE_UPLOAD_ERROR') stages.imageProcessing = 'failed'
      throw this.makeScanError(error, model, stages, category, attempts, apiKey)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(responseText)
      stages.jsonParsing = 'success'
    } catch (error) {
      await this.recordUsage(attempts, false, usage)
      stages.jsonParsing = 'failed'
      throw this.makeScanError(error, model, stages, 'GEMINI_RESPONSE_PARSE_ERROR', attempts, apiKey, responseText)
    }
    try {
      const extraction = mergeGeminiPassport(normalizeResponse(parsed), local)
      stages.validation = 'success'
      await this.recordUsage(attempts, true, usage)
      return { extraction, diagnostics: diagnostic(model, stages, { attempts }) }
    } catch (error) {
      await this.recordUsage(attempts, false, usage)
      stages.validation = 'failed'
      throw this.makeScanError(error, model, stages, 'PASSPORT_VALIDATION_ERROR', attempts, apiKey, responseText)
    }
  }

  private makeScanError(
    error: unknown,
    model: string,
    stages: PassportDiagnostics['stages'],
    forcedCategory?: GeminiFailureCategory,
    attempts?: number,
    apiKey?: string,
    response?: string
  ): GeminiPassportError {
    const category = forcedCategory ?? (error as { category?: GeminiFailureCategory } | null)?.category ?? failureCategory(error)
    const safeDetails = safeFailureMessage(error, apiKey)
    const message = error instanceof GeminiPassportError
      ? error.message
      : `${category}: ${apiErrorMessage(error)}${safeDetails ? ` Details: ${safeDetails}` : ''}`
    return new GeminiPassportError(category, message, diagnostic(model, stages, {
      category,
      message,
      attempts,
      ...(response ? { responsePreview: response.slice(0, 1200) } : {})
    }))
  }

  private async readUsage(): Promise<GeminiUsage> {
    try {
      const parsed = JSON.parse(await readFile(this.usagePath, 'utf8')) as Partial<GeminiUsage>
      return {
        requests: Number.isSafeInteger(parsed.requests) && Number(parsed.requests) >= 0 ? Number(parsed.requests) : 0,
        successes: Number.isSafeInteger(parsed.successes) && Number(parsed.successes) >= 0 ? Number(parsed.successes) : 0,
        failures: Number.isSafeInteger(parsed.failures) && Number(parsed.failures) >= 0 ? Number(parsed.failures) : 0,
        promptTokens: Number.isSafeInteger(parsed.promptTokens) && Number(parsed.promptTokens) >= 0 ? Number(parsed.promptTokens) : 0,
        candidateTokens: Number.isSafeInteger(parsed.candidateTokens) && Number(parsed.candidateTokens) >= 0 ? Number(parsed.candidateTokens) : 0,
        lastUsedAt: typeof parsed.lastUsedAt === 'string' ? parsed.lastUsedAt : null
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...emptyUsage }
      throw new Error('Gemini usage statistics could not be read.')
    }
  }

  private async recordUsage(requests: number, succeeded: boolean, tokens: { promptTokens: number; candidateTokens: number }): Promise<void> {
    const current = await this.readUsage()
    const updated: GeminiUsage = {
      requests: current.requests + requests,
      successes: current.successes + (succeeded ? 1 : 0),
      failures: current.failures + (succeeded ? 0 : 1),
      promptTokens: current.promptTokens + tokens.promptTokens,
      candidateTokens: current.candidateTokens + tokens.candidateTokens,
      lastUsedAt: new Date().toISOString()
    }
    const temporaryPath = join(dirname(this.usagePath), `.gemini-usage-${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, JSON.stringify(updated), { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.usagePath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw new Error(`Gemini usage statistics could not be saved: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async readConfig(): Promise<StoredGeminiSettings | null> {
    try {
      const contents = await readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(contents) as Partial<StoredGeminiSettings>
      if (typeof parsed.encryptedApiKey !== 'string' || !isModel(parsed.model) || !isProvider(parsed.provider)) {
        throw new Error('Gemini settings are damaged. Reconfigure the Gemini connection in Settings.')
      }
      return parsed as StoredGeminiSettings
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async readApiKey(): Promise<string> {
    const config = await this.readConfig()
    if (!config?.encryptedApiKey) return ''
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable. Reconfigure Gemini in Settings.')
    try {
      return safeStorage.decryptString(Buffer.from(config.encryptedApiKey, 'base64'))
    } catch {
      throw new Error('The stored Gemini credential cannot be decrypted. Re-enter the API key in Settings.')
    }
  }

  private async writeConfig(config: StoredGeminiSettings): Promise<void> {
    const temporaryPath = join(dirname(this.configPath), `.gemini-config-${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.configPath)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw new Error(`Unable to save Gemini settings securely: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
