import { NameParser } from '../name-parser';

describe('NameParser', () => {
  it('formats structured contributors as storage strings', () => {
    expect(NameParser.toStorageStrings([
      { family: 'Smith', given: 'Jane' },
      { literal: 'World Health Organization' }
    ])).toEqual([
      'Jane Smith',
      'World Health Organization'
    ]);
  });

  it('converts stored string lists back into literal contributors', () => {
    expect(NameParser.toContributors(['Jane Smith'], 'author')).toEqual([
      {
        role: 'author',
        literal: 'Jane Smith'
      }
    ]);
  });

  it('preserves structured CSL objects during normalization', () => {
    expect(NameParser.toCslNames([
      { family: 'Smith', given: 'Jane' }
    ])).toEqual([
      { family: 'Smith', given: 'Jane' }
    ]);
  });

  it('preserves CSL boolean name flags during normalization', () => {
    expect(NameParser.toCslNames([
      {
        family: 'Smith',
        given: 'Jane',
        'comma-suffix': true,
        'static-ordering': true,
        'parse-names': false
      }
    ])).toEqual([
      {
        family: 'Smith',
        given: 'Jane',
        'comma-suffix': true,
        'static-ordering': true,
        'parse-names': false
      }
    ]);
  });
});
