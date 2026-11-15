export type PassportMrz = {
  fullName: string
  firstName: string
  surname: string
  passportNumber: string
  nationality: string
  dateOfBirth: string
  gender: string
  expiryDate: string
  checkDigitsValid: boolean
}

function checkDigit(value: string): number {
  const weights = [7, 3, 1]
  const valueOf = (char: string) => {
    if (char === '<') return 0
    if (char >= '0' && char <= '9') return Number(char)
    if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 55
    return -1
  }
  return [...value].reduce((sum, char, index) => sum + valueOf(char) * weights[index % weights.length], 0) % 10
}

function decodeDate(value: string, kind: 'birth' | 'expiry'): string {
  if (!/^\d{6}$/.test(value)) return ''
  const yy = Number(value.slice(0, 2))
  const month = value.slice(2, 4)
  const day = value.slice(4, 6)
  const currentYear = new Date().getFullYear() % 100
  const year = kind === 'birth'
    ? (yy > currentYear ? 1900 + yy : 2000 + yy)
    : (yy < currentYear ? 2000 + yy : 1900 + yy)
  const date = new Date(Date.UTC(year, Number(month) - 1, Number(day)))
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return ''
  return `${year}-${month}-${day}`
}

export function parsePassportMrz(text: string): PassportMrz | null {
  const lines = text.toUpperCase().split(/\r?\n/).map((line) => line.replace(/[^A-Z0-9<]/g, '')).filter((line) => line.length >= 40)
  const line1 = lines.find((line) => line.startsWith('P<') && line.length >= 44)?.slice(0, 44)
  if (!line1) return null
  const line2 = lines.find((line) => line !== line1 && line.length >= 44)?.slice(0, 44)
  if (!line2) return null
  const nameParts = line1.slice(5).split('<<')
  const surname = (nameParts[0] ?? '').replace(/</g, ' ').trim()
  const givenNames = (nameParts[1] ?? '').replace(/</g, ' ').trim()
  const passportNumber = line2.slice(0, 9).replace(/</g, '').trim()
  const birth = line2.slice(13, 19)
  const expiry = line2.slice(21, 27)
  const composite = line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43)
  const valid = /^\d$/.test(line2[9]) && /^\d$/.test(line2[19]) && /^\d$/.test(line2[27])
    && /^\d$/.test(line2[43])
    && checkDigit(line2.slice(0, 9)) === Number(line2[9])
    && checkDigit(birth) === Number(line2[19])
    && checkDigit(expiry) === Number(line2[27])
    && checkDigit(composite) === Number(line2[43])
  return {
    fullName: [givenNames, surname].filter(Boolean).join(' '),
    firstName: givenNames,
    surname,
    passportNumber,
    nationality: line2.slice(10, 13).replace(/</g, ''),
    dateOfBirth: decodeDate(birth, 'birth'),
    gender: line2[20] === 'F' ? 'Female' : line2[20] === 'M' ? 'Male' : '',
    expiryDate: decodeDate(expiry, 'expiry'),
    checkDigitsValid: valid
  }
}
