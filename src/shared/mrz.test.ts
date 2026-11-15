import { describe, expect, it } from 'vitest'
import { parsePassportMrz } from './mrz'

describe('passport MRZ parsing', () => {
  const validMrz = [
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
    'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
  ].join('\n')

  it('extracts TD3 passport data and validates check digits', () => {
    expect(parsePassportMrz(validMrz)).toMatchObject({
      fullName: 'ANNA MARIA ERIKSSON',
      firstName: 'ANNA MARIA',
      surname: 'ERIKSSON',
      passportNumber: 'L898902C3',
      nationality: 'UTO',
      dateOfBirth: '1974-08-12',
      gender: 'Female',
      expiryDate: '2012-04-15',
      checkDigitsValid: true
    })
  })

  it('reports an invalid check digit without discarding extracted fields', () => {
    const invalid = validMrz.replace('L898902C36', 'L898902C37')
    expect(parsePassportMrz(invalid)).toMatchObject({ passportNumber: 'L898902C3', checkDigitsValid: false })
  })

  it('returns null when no passport MRZ is present', () => {
    expect(parsePassportMrz('Passport scan without machine-readable zone')).toBeNull()
  })

})
