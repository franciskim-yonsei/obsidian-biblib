import nlmJournalData from '../data/nlm-journal-abbreviations.json';

interface NlmJournalAbbreviationData {
    title: Record<string, string>;
    issn: Record<string, string>;
}

const data = nlmJournalData as NlmJournalAbbreviationData;

/**
 * Normalize journal titles/abbreviations for matching against the bundled NLM
 * PubMed journal list. This intentionally ignores punctuation, accents, case,
 * and leading English articles so inputs like "J. Neurosci." and
 * "The Journal of Neuroscience" match the NLM entry.
 */
export function normalizeJournalLookupKey(value: unknown): string {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[’']/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(the|a|an)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stripSubtitle(title: string): string {
    return title.split(':')[0].trim();
}

function stripParenthetical(title: string): string {
    return title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleKeys(title: string): string[] {
    return [
        title,
        stripSubtitle(title),
        stripParenthetical(stripSubtitle(title))
    ]
        .map(normalizeJournalLookupKey)
        .filter(Boolean)
        .filter((key, index, keys) => keys.indexOf(key) === index);
}

function issnKeys(issn: string): string[] {
    const raw = issn.trim().toUpperCase();
    const compact = raw.replace(/[^0-9X]/g, '');
    const keys = [raw];

    if (compact) {
        keys.push(compact);
        if (compact.length === 8) {
            keys.push(`${compact.slice(0, 4)}-${compact.slice(4)}`);
        }
    }

    return keys.filter((key, index) => key && keys.indexOf(key) === index);
}

function lookupByIssn(issn: unknown): string | undefined {
    if (!issn) return undefined;

    const issns = Array.isArray(issn) ? issn : String(issn).split(/[;,]\s*/);
    for (const value of issns) {
        for (const key of issnKeys(String(value))) {
            const abbr = data.issn[key];
            if (abbr) return abbr;
        }
    }

    return undefined;
}

function lookupByTitle(title: unknown): string | undefined {
    if (!title || typeof title !== 'string') return undefined;

    for (const key of titleKeys(title)) {
        const abbr = data.title[key];
        if (abbr) return abbr;
    }

    return undefined;
}

/**
 * Look up the official NLM/PubMed journal abbreviation from ISSN or journal
 * title. ISSN is preferred when available; title lookup falls back through
 * punctuation-insensitive and subtitle-stripped forms.
 */
export function lookupNlmJournalAbbreviation(title?: unknown, issn?: unknown): string | undefined {
    return lookupByIssn(issn) || lookupByTitle(title);
}
