import { describe, expect, it } from 'vitest'
import { parsePassportMrz } from './mrz'
import { extractIraqiPassport, mergeGeminiPassport, passportFieldNames, type GeminiPassportFields, type PassportOcrPage, type PassportOcrWord } from './passportProfiles'

function page(tokens: Array<[string, number, number]>): PassportOcrPage {
  const words: PassportOcrWord[] = tokens.map(([text, x, y]) => ({
    text,
    confidence: 93,
    bbox: { x0: x, y0: y, x1: x + text.length * 9, y1: y + 15 }
  }))
  return { source: 'original', words, width: 1200, height: 800 }
}

const visibleIraqiFields = page([
  ['Passport', 825, 80], ['No', 900, 80], ['B45804596', 815, 105],
  ['Full', 330, 165], ['Name', 370, 165], ['DLAWAR', 330, 190], ['QADIR', 390, 190], ['MOHAMMAD', 440, 190],
  ['Surname', 330, 225], ['MOHAMMAD', 330, 250],
  ['Date', 330, 290], ['of', 365, 290], ['Birth', 385, 290],
  ['Nationality', 650, 290], ['Sex', 830, 290],
  ['01.07.1978', 330, 315], ['IRAQI', 650, 315], ['M', 830, 315], ['Male', 850, 315],
  ['Date', 330, 420], ['of', 365, 420], ['Issue', 385, 420], ['12.05.2026', 330, 445],
  ['Date', 330, 510], ['of', 365, 510], ['Expiry', 385, 510], ['11.05.2034', 330, 535]
])

function geminiFields(overrides: Partial<GeminiPassportFields> = {}): GeminiPassportFields {
  return Object.fromEntries(passportFieldNames.map((field) => [
    field,
    { value: null, confidence: 0, ...overrides[field] }
  ])) as GeminiPassportFields
}

describe('Iraqi passport visual profile', () => {
  it('uses printed labels and field positions to extract visible biodata', () => {
    const result = extractIraqiPassport([visibleIraqiFields], null)
    expect(result.profile).toBe('iraqi')
    expect(result.fields).toEqual({
      firstName: 'DLAWAR',
      surname: 'MOHAMMAD',
      fullName: 'DLAWAR QADIR MOHAMMAD',
      dateOfBirth: '1978-07-01',
      passportNumber: 'B45804596',
      nationality: 'IRAQI',
      gender: 'Male',
      issueDate: '2026-05-12',
      expiryDate: '2034-05-11'
    })
    expect(Object.values(result.assessments).every((field) => field.sources.includes('visible'))).toBe(true)
  })

  it('does not use a country-code field as nationality', () => {
    const onlyCountryCode = page([['Country', 500, 90], ['Code', 565, 90], ['IRQ', 630, 110]])
    expect(extractIraqiPassport([onlyCountryCode], null).fields.nationality).toBe('')
    const mrz = parsePassportMrz([
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
    ].join('\n'))
    expect(extractIraqiPassport([onlyCountryCode], mrz).fields.nationality).toBe('')
  })

  it('keeps visible values when MRZ disagrees and flags them for manual review', () => {
    const mrz = parsePassportMrz([
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
    ].join('\n'))
    const result = extractIraqiPassport([visibleIraqiFields], mrz)
    expect(result.fields.passportNumber).toBe('B45804596')
    expect(result.fields.fullName).toBe('DLAWAR QADIR MOHAMMAD')
    expect(result.assessments.passportNumber.conflict).toBe(true)
    expect(result.assessments.fullName.needsReview).toBe(true)
  })

  it('flags disagreement between preprocessing passes rather than silently correcting it', () => {
    const conflictingPass = page([
      ['Passport', 825, 80], ['No', 900, 80], ['B45804597', 815, 105]
    ])
    const result = extractIraqiPassport([visibleIraqiFields, conflictingPass], null)
    expect(result.assessments.passportNumber.conflict).toBe(true)
    expect(result.assessments.passportNumber.needsReview).toBe(true)
  })

  it('uses MRZ only as a review-required fallback when the visible label is unavailable', () => {
    const mrz = parsePassportMrz([
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
    ].join('\n'))
    const result = extractIraqiPassport([], mrz)
    expect(result.fields.passportNumber).toBe('L898902C3')
    expect(result.assessments.passportNumber.sources).toEqual(['mrz'])
    expect(result.assessments.passportNumber.needsReview).toBe(true)
  })

  it('keeps Gemini values unverified and flags disagreement with local visible OCR', () => {
    const local = extractIraqiPassport([visibleIraqiFields], null)
    const result = mergeGeminiPassport(geminiFields({
      firstName: { value: 'DLAWAR', confidence: 87 },
      surname: { value: 'MOHAMMAD', confidence: 91 },
      fullName: { value: 'DLAWAR QADIR MOHAMMAD', confidence: 88 },
      passportNumber: { value: 'B45804597', confidence: 94 },
      dateOfBirth: { value: '1978-07-01', confidence: 90 },
      nationality: { value: 'IRAQI', confidence: 92 },
      gender: { value: 'Male', confidence: 80 },
      issueDate: { value: '2026-05-12', confidence: 82 },
      expiryDate: { value: '2034-05-11', confidence: 85 }
    }), local)

    expect(result.fields.passportNumber).toBe('B45804597')
    expect(result.assessments.passportNumber.conflict).toBe(true)
    expect(result.assessments.passportNumber.sources).toContain('gemini')
    expect(Object.values(result.assessments).every((field) => field.needsReview)).toBe(true)
  })

  it('rejects invalid Gemini values instead of normalizing or guessing them', () => {
    const local = extractIraqiPassport([], null)
    const result = mergeGeminiPassport(geminiFields({
      passportNumber: { value: 'IRQ', confidence: 99 },
      issueDate: { value: '31/04/2026', confidence: 99 },
      nationality: { value: 'IRAQI', confidence: 90 }
    }), local)

    expect(result.fields.passportNumber).toBe('')
    expect(result.fields.issueDate).toBe('')
    expect(result.fields.nationality).toBe('IRAQI')
    expect(result.assessments.issueDate.needsReview).toBe(true)
  })

  it('accepts partial Gemini results and does not use MRZ-only values as visible recognition', () => {
    const mrz = parsePassportMrz([
      'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
      'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
    ].join('\n'))
    const local = extractIraqiPassport([], mrz)
    const result = mergeGeminiPassport(geminiFields({
      fullName: { value: 'ANNA MARIA ERIKSSON', confidence: 83 },
      nationality: { value: 'IRAQI', confidence: 88 }
    }), local)

    expect(result.fields.firstName).toBe('ANNA')
    expect(result.assessments.firstName.confidence).toBe(83)
    expect(result.fields.passportNumber).toBe('')
    expect(result.assessments.passportNumber.sources).toEqual([])
    expect(result.fields.nationality).toBe('IRAQI')
    expect(Object.values(result.assessments).every((field) => field.needsReview)).toBe(true)
  })
})
