import type { PassportMrz } from './mrz'

export const passportFieldNames = [
  'firstName',
  'surname',
  'fullName',
  'dateOfBirth',
  'passportNumber',
  'nationality',
  'gender',
  'issueDate',
  'expiryDate'
] as const

export type PassportFieldName = typeof passportFieldNames[number]
export type PassportFieldValues = Record<PassportFieldName, string>
export type PassportFieldSource = 'visible' | 'mrz' | 'gemini'
export type PassportFieldAssessment = {
  value: string
  confidence: number
  sources: PassportFieldSource[]
  needsReview: boolean
  conflict: boolean
}
export type PassportAssessments = Record<PassportFieldName, PassportFieldAssessment>
export type PassportOcrWord = {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}
export type PassportOcrPage = {
  source: 'original' | 'enhanced' | 'deskew-clockwise' | 'deskew-counterclockwise'
  words: PassportOcrWord[]
  width: number
  height: number
}
export type PassportExtraction = {
  profile: 'iraqi'
  fields: PassportFieldValues
  assessments: PassportAssessments
}
export type GeminiPassportField = { value: string | null; confidence: number }
export type GeminiPassportFields = Record<PassportFieldName, GeminiPassportField>

type LabelName = 'fullName' | 'surname' | 'dateOfBirth' | 'passportNumber' | 'nationality' | 'gender' | 'issueDate' | 'expiryDate'
type OcrLine = { words: PassportOcrWord[]; text: string; x0: number; y0: number; x1: number; y1: number }
type VisibleCandidate = { value: string; confidence: number }

const labelPatterns: Record<LabelName, RegExp> = {
  fullName: /\bfull\s*name\b/i,
  surname: /\bsurname\b|\bfamily\s*name\b/i,
  dateOfBirth: /\bdate\s*of\s*birth\b/i,
  passportNumber: /\bpassport\s*(?:no|number)\b/i,
  nationality: /\bnationality\b/i,
  gender: /\bsex\b|\bgender\b/i,
  issueDate: /\bdate\s*of\s*issue\b/i,
  expiryDate: /\bdate\s*of\s*expiry\b/i
}
const labelRegions: Record<LabelName, { x: [number, number]; y: [number, number] }> = {
  fullName: { x: [0.12, 0.72], y: [0.08, 0.58] },
  surname: { x: [0.12, 0.72], y: [0.12, 0.7] },
  dateOfBirth: { x: [0.1, 0.72], y: [0.12, 0.74] },
  passportNumber: { x: [0.52, 0.99], y: [0.02, 0.4] },
  nationality: { x: [0.3, 0.98], y: [0.12, 0.76] },
  gender: { x: [0.48, 0.99], y: [0.12, 0.76] },
  issueDate: { x: [0.1, 0.78], y: [0.3, 0.9] },
  expiryDate: { x: [0.1, 0.78], y: [0.35, 0.98] }
}

function makeLines(words: PassportOcrWord[]): OcrLine[] {
  const sorted = words.filter((word) => word.text.trim()).slice().sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
  const lines: OcrLine[] = []
  for (const word of sorted) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2
    const line = lines.find((candidate) => {
      const height = Math.max(candidate.y1 - candidate.y0, word.bbox.y1 - word.bbox.y0)
      const centerOfLine = (candidate.y0 + candidate.y1) / 2
      return Math.abs(center - centerOfLine) <= height * 0.65
    })
    if (line) {
      line.words.push(word)
      line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0)
      line.x0 = Math.min(line.x0, word.bbox.x0)
      line.y0 = Math.min(line.y0, word.bbox.y0)
      line.x1 = Math.max(line.x1, word.bbox.x1)
      line.y1 = Math.max(line.y1, word.bbox.y1)
      line.text = line.words.map((item) => item.text).join(' ')
    } else {
      lines.push({ words: [word], text: word.text, ...word.bbox })
    }
  }
  return lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
}

function findLabel(lines: OcrLine[], field: LabelName): { line: OcrLine; startX: number; endIndex: number } | null {
  const pattern = labelPatterns[field]
  for (const line of lines) {
    const match = pattern.exec(line.text)
    if (!match) continue
    const before = line.text.slice(0, match.index).trim().split(/\s+/).filter(Boolean).length
    const matched = match[0].trim().split(/\s+/).length
    const startIndex = Math.min(before, line.words.length - 1)
    const endIndex = Math.min(before + matched - 1, line.words.length - 1)
    const startWord = line.words[startIndex]
    return { line, startX: startWord?.bbox.x0 ?? line.x0, endIndex }
  }
  return null
}

function startsPrintedLabel(text: string): boolean {
  return /^(?:full|surname|family|date|passport|nationality|sex|gender)\b/i.test(text)
}

function readVisibleValue(lines: OcrLine[], field: LabelName, page: PassportOcrPage): VisibleCandidate | null {
  const found = findLabel(lines, field)
  if (!found) return null
  const { line: labelLine, startX, endIndex } = found
  const sameLine: PassportOcrWord[] = []
  for (const [index, word] of labelLine.words.entries()) {
    if (index <= endIndex) continue
    if (startsPrintedLabel(word.text)) break
    sameLine.push(word)
  }
  let valueWords = sameLine
  let belowLine = false
  let value = normalizeVisibleValue(field, valueWords.map((word) => word.text).join(' '))
  if (!value) {
    const lineHeight = Math.max(1, labelLine.y1 - labelLine.y0)
    const candidates = lines
      .filter((line) => line.y0 > labelLine.y0 && line.y0 - labelLine.y1 <= Math.max(lineHeight * 4, page.height * 0.075))
      .map((line) => ({
        line,
        distance: Math.abs(line.y0 - labelLine.y1),
        valueWords: contiguousWordsNearestLabel(line.words, startX, page.width)
      }))
      .filter((candidate) => candidate.valueWords.length > 0)
      .sort((a, b) => a.distance - b.distance)
    valueWords = candidates[0]?.valueWords ?? []
    belowLine = valueWords.length > 0
    value = normalizeVisibleValue(field, valueWords.map((word) => word.text).join(' '))
  }
  if (!value) return null
  const wordConfidence = valueWords.reduce((sum, word) => sum + Math.max(0, Math.min(100, word.confidence)), 0) / valueWords.length
  const labelCenterX = (labelLine.x0 + labelLine.x1) / 2 / page.width
  const labelCenterY = (labelLine.y0 + labelLine.y1) / 2 / page.height
  const expected = labelRegions[field]
  const locationMatches = labelCenterX >= expected.x[0] && labelCenterX <= expected.x[1]
    && labelCenterY >= expected.y[0] && labelCenterY <= expected.y[1]
  const confidence = Math.round(Math.max(0, Math.min(100, wordConfidence * (belowLine ? 0.88 : 0.92) + (locationMatches ? 8 : -15))))
  return { value, confidence }
}

function contiguousWordsNearestLabel(words: PassportOcrWord[], labelX: number, pageWidth: number): PassportOcrWord[] {
  const sorted = words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0)
  let anchor = -1
  let nearestDistance = Infinity
  for (const [index, word] of sorted.entries()) {
    if (startsPrintedLabel(word.text)) continue
    const distance = Math.abs(word.bbox.x0 - labelX)
    if (distance < nearestDistance) {
      nearestDistance = distance
      anchor = index
    }
  }
  if (anchor < 0 || nearestDistance > pageWidth * 0.22) return []
  const result = [sorted[anchor]]
  const maxGap = Math.max(18, pageWidth * 0.04)
  for (let index = anchor + 1; index < sorted.length; index += 1) {
    const previous = result[result.length - 1]
    const current = sorted[index]
    if (startsPrintedLabel(current.text) || current.bbox.x0 - previous.bbox.x1 > maxGap) break
    result.push(current)
  }
  return result
}

function normalizeVisibleValue(field: LabelName, raw: string): string {
  const clean = raw.replace(/^[^\p{L}\d]+|[^\p{L}\d./-]+$/gu, '').replace(/\s+/g, ' ').trim()
  if (field === 'gender') {
    const genderTokens = clean.toLowerCase().split(/[^a-z]+/).filter(Boolean)
    const recognized = new Set(genderTokens
      .map((token) => token === 'm' || token === 'male' ? 'Male' : token === 'f' || token === 'female' ? 'Female' : '')
      .filter(Boolean))
    return recognized.size === 1 ? [...recognized][0] : ''
  }
  if (field === 'dateOfBirth' || field === 'issueDate' || field === 'expiryDate') return normalizeVisibleDate(clean)
  if (field === 'passportNumber') {
    const value = clean.replace(/[^a-z0-9]/gi, '')
    return /^[A-Z0-9]{7,12}$/i.test(value) && /[A-Z]/i.test(value) && /\d/.test(value) ? value : ''
  }
  return clean
}

function normalizeVisibleDate(value: string): string {
  const match = value.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/)
  if (!match) return ''
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function normalizeComparable(field: PassportFieldName, value: string): string {
  return field === 'fullName' || field === 'firstName' || field === 'surname' || field === 'nationality'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
    : value.trim().toLocaleLowerCase()
}

function validField(field: PassportFieldName, value: string): boolean {
  if (!value) return false
  if (field === 'passportNumber') return /^[A-Z0-9]{7,12}$/i.test(value) && /[A-Z]/i.test(value) && /\d/.test(value)
  if (field === 'dateOfBirth' || field === 'issueDate' || field === 'expiryDate') return isValidIsoDate(value)
  if (field === 'gender') return value === 'Male' || value === 'Female'
  return true
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function mergeGeminiPassport(
  geminiFields: GeminiPassportFields,
  local: PassportExtraction
): PassportExtraction {
  const fields = { ...local.fields }
  const assessments = { ...local.assessments }

  for (const field of passportFieldNames) {
    const result = geminiFields[field]
    const inferredFromFullName = field === 'firstName' && !result.value
      ? geminiFields.fullName.value?.trim().split(/\s+/)[0] ?? null
      : null
    const rawValue = typeof result.value === 'string'
      ? result.value.trim()
      : inferredFromFullName ?? ''
    const value = rawValue.length <= 120 ? rawValue : ''
    const normalizedValue = field === 'gender' && /^m(?:ale)?$/i.test(value)
      ? 'Male'
      : field === 'gender' && /^f(?:emale)?$/i.test(value) ? 'Female' : value
    const validatedValue = normalizedValue && validField(field, normalizedValue) ? normalizedValue : ''
    const localAssessment = local.assessments[field]
    const hasConflict = Boolean(validatedValue && localAssessment.value
      && normalizeComparable(field, validatedValue) !== normalizeComparable(field, localAssessment.value))

    if (validatedValue) {
      fields[field] = validatedValue
      assessments[field] = {
        value: validatedValue,
        confidence: Number.isFinite(result.confidence)
          ? Math.round(Math.max(0, Math.min(100, field === 'firstName' && inferredFromFullName
            ? geminiFields.fullName.confidence
            : result.confidence)))
          : 0,
        sources: ['gemini', ...(localAssessment.value ? localAssessment.sources : [])],
        needsReview: true,
        conflict: hasConflict || localAssessment.conflict
      }
    } else if (localAssessment.value && localAssessment.sources.includes('visible')) {
      fields[field] = localAssessment.value
      assessments[field] = { ...localAssessment, needsReview: true }
    } else {
      fields[field] = ''
      assessments[field] = {
        value: '',
        confidence: 0,
        sources: [],
        needsReview: true,
        conflict: false
      }
    }
  }

  if (fields.issueDate && fields.expiryDate && fields.issueDate >= fields.expiryDate) {
    for (const field of ['issueDate', 'expiryDate'] as const) {
      assessments[field] = { ...assessments[field], needsReview: true, conflict: true }
    }
  }

  return { profile: 'iraqi', fields, assessments }
}

function mrzValue(field: PassportFieldName, mrz: PassportMrz): string {
  switch (field) {
    case 'firstName': return mrz.firstName.split(/\s+/)[0] ?? ''
    case 'surname': return mrz.surname
    case 'fullName': return mrz.fullName
    case 'dateOfBirth': return mrz.dateOfBirth
    case 'passportNumber': return mrz.passportNumber
    case 'nationality': return ''
    case 'gender': return mrz.gender
    case 'issueDate': return ''
    case 'expiryDate': return mrz.expiryDate
  }
}

function emptyAssessment(): PassportFieldAssessment {
  return { value: '', confidence: 0, sources: [], needsReview: true, conflict: false }
}

export function extractIraqiPassport(
  pages: PassportOcrPage[],
  mrz: PassportMrz | null
): PassportExtraction {
  const values = Object.fromEntries(passportFieldNames.map((field) => [field, ''])) as PassportFieldValues
  const assessments = Object.fromEntries(passportFieldNames.map((field) => [field, emptyAssessment()])) as PassportAssessments
  const visibleCandidates = new Map<PassportFieldName, VisibleCandidate[]>()
  const fieldLabels: Array<[PassportFieldName, LabelName]> = [
    ['fullName', 'fullName'],
    ['surname', 'surname'],
    ['dateOfBirth', 'dateOfBirth'],
    ['passportNumber', 'passportNumber'],
    ['nationality', 'nationality'],
    ['gender', 'gender'],
    ['issueDate', 'issueDate'],
    ['expiryDate', 'expiryDate']
  ]

  for (const page of pages) {
    const lines = makeLines(page.words)
    for (const [field, label] of fieldLabels) {
      const candidate = readVisibleValue(lines, label, page)
      if (candidate) visibleCandidates.set(field, [...(visibleCandidates.get(field) ?? []), candidate])
    }
  }

  for (const field of fieldLabels.map(([name]) => name)) {
    const candidates = visibleCandidates.get(field) ?? []
    if (!candidates.length) continue
    candidates.sort((a, b) => b.confidence - a.confidence)
    const chosen = candidates[0]
    const conflicts = candidates.some((candidate) => normalizeComparable(field, candidate.value) !== normalizeComparable(field, chosen.value))
    values[field] = chosen.value
    assessments[field] = {
      value: chosen.value,
      confidence: chosen.confidence,
      sources: ['visible'],
      needsReview: chosen.confidence < 80 || conflicts || !validField(field, chosen.value),
      conflict: conflicts
    }
  }

  const fullName = values.fullName
  if (fullName && !values.firstName) {
    const firstName = fullName.split(/\s+/)[0]
    values.firstName = firstName
    assessments.firstName = { ...assessments.fullName, value: firstName }
  }

  if (mrz) {
    for (const field of passportFieldNames) {
      const value = mrzValue(field, mrz)
      if (!value) continue
      const current = assessments[field]
      if (!current.value) {
        values[field] = value
        assessments[field] = {
          value,
          confidence: mrz.checkDigitsValid ? 60 : 40,
          sources: ['mrz'],
          needsReview: true,
          conflict: false
        }
      } else if (normalizeComparable(field, current.value) !== normalizeComparable(field, value)) {
        assessments[field] = { ...current, needsReview: true, conflict: true, sources: [...current.sources, 'mrz'] }
      } else {
        assessments[field] = { ...current, confidence: Math.min(100, current.confidence + (mrz.checkDigitsValid ? 5 : 0)), sources: [...current.sources, 'mrz'] }
      }
    }
  }

  if (values.issueDate && values.expiryDate && values.issueDate >= values.expiryDate) {
    for (const field of ['issueDate', 'expiryDate'] as const) {
      assessments[field] = { ...assessments[field], needsReview: true }
    }
  }

  values.firstName = values.firstName.trim()
  values.surname = values.surname.trim()
  if (!values.fullName && (values.firstName || values.surname)) {
    values.fullName = [values.firstName, values.surname].filter(Boolean).join(' ')
    assessments.fullName = { ...assessments.firstName, value: values.fullName, needsReview: true }
  }
  return { profile: 'iraqi', fields: values, assessments }
}
