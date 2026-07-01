import { lookupNlmJournalAbbreviation, normalizeJournalLookupKey } from '../nlm-journal-abbreviations';

describe('NLM journal abbreviation lookup', () => {
    it('normalizes punctuation and leading articles', () => {
        expect(normalizeJournalLookupKey('The Journal of Neuroscience')).toBe('journal of neuroscience');
        expect(normalizeJournalLookupKey('J. Neurosci.')).toBe('j neurosci');
    });

    it('finds NLM abbreviations by full journal title', () => {
        expect(lookupNlmJournalAbbreviation('Journal of Neuroscience')).toBe('J Neurosci');
        expect(lookupNlmJournalAbbreviation('Nature Communications')).toBe('Nat Commun');
    });

    it('matches title variants with subtitles or parentheticals', () => {
        expect(lookupNlmJournalAbbreviation('The Journal of Neuroscience')).toBe('J Neurosci');
        expect(lookupNlmJournalAbbreviation('Development')).toBe('Development');
    });

    it('finds NLM abbreviations by ISSN', () => {
        expect(lookupNlmJournalAbbreviation(undefined, '0270-6474')).toBe('J Neurosci');
        expect(lookupNlmJournalAbbreviation(undefined, '20411723')).toBe('Nat Commun');
    });

    it('recognizes already abbreviated dotted inputs', () => {
        expect(lookupNlmJournalAbbreviation('J. Neurosci.')).toBe('J Neurosci');
    });
});
