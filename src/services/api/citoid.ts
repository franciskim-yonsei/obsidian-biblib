import { requestUrl, Notice } from 'obsidian';
import Cite from 'citation-js';
import '@citation-js/plugin-isbn';
import '@citation-js/plugin-doi';
import '@citation-js/plugin-wikidata';
import '@citation-js/plugin-bibtex';
import { DateParser } from '../../utils/date-parser';

type PubMedSource = 'pubmed' | 'pmc';

interface ParsedPubMedIdentifier {
    source: PubMedSource;
    id: string;
}

interface OpenLibraryNamedValue {
    name?: string;
}

interface OpenLibraryRecord {
    title?: string;
    subtitle?: string;
    authors?: OpenLibraryNamedValue[];
    number_of_pages?: number;
    identifiers?: {
        isbn_10?: string[];
        isbn_13?: string[];
    };
    publishers?: OpenLibraryNamedValue[];
    publish_date?: string;
    publish_places?: OpenLibraryNamedValue[];
    subjects?: OpenLibraryNamedValue[];
    notes?: string | { value?: string };
    url?: string;
}

export class CitoidService {
    private readonly apiUrl = 'https://en.wikipedia.org/api/rest_v1/data/citation/bibtex/';

    private isValidIsbn10(isbn: string): boolean {
        if (!/^\d{9}[\dX]$/.test(isbn)) return false;

        const sum = isbn.split('').reduce((total, character, index) => {
            const value = character === 'X' ? 10 : Number(character);
            return total + value * (10 - index);
        }, 0);

        return sum % 11 === 0;
    }

    private isValidIsbn13(isbn: string): boolean {
        if (!/^97[89]\d{10}$/.test(isbn)) return false;

        const sum = isbn.split('').reduce((total, character, index) => {
            return total + Number(character) * (index % 2 === 0 ? 1 : 3);
        }, 0);

        return sum % 10 === 0;
    }

    private parseIsbnIdentifier(identifier: string): string | null {
        const normalized = identifier
            .trim()
            .replace(/^isbn(?:-1[03])?\s*:?\s*/i, '')
            .replace(/[\s-]/g, '')
            .toUpperCase();

        if (this.isValidIsbn10(normalized) || this.isValidIsbn13(normalized)) {
            return normalized;
        }

        return null;
    }

    private toIsbn13(isbn: string): string {
        if (isbn.length === 13) return isbn;

        const stem = `978${isbn.slice(0, 9)}`;
        const sum = stem.split('').reduce((total, character, index) => {
            return total + Number(character) * (index % 2 === 0 ? 1 : 3);
        }, 0);
        return `${stem}${(10 - (sum % 10)) % 10}`;
    }

    private parsePubMedIdentifier(identifier: string): ParsedPubMedIdentifier | null {
        const trimmed = identifier.trim();

        const pmcidMatch = trimmed.match(/^pmcid:\s*pmc?(\d+)$/i);
        if (pmcidMatch) {
            return { source: 'pmc', id: pmcidMatch[1] };
        }

        const pmcMatch = trimmed.match(/^pmc(\d+)$/i);
        if (pmcMatch) {
            return { source: 'pmc', id: pmcMatch[1] };
        }

        const pmidMatch = trimmed.match(/^pmid:\s*(\d+)$/i);
        if (pmidMatch) {
            return { source: 'pubmed', id: pmidMatch[1] };
        }

        // Current PMIDs are at most eight digits. Allow one digit of growth,
        // but do not reinterpret 10- or 13-digit book identifiers as PMIDs.
        if (/^\d{1,9}$/.test(trimmed)) {
            return { source: 'pubmed', id: trimmed };
        }

        return null;
    }

    private parseOpenLibraryAuthor(name: unknown): { family: string; given?: string } | undefined {
        if (typeof name !== 'string' || !name.trim()) return undefined;

        const trimmed = name.trim();
        const commaParts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
        if (commaParts.length > 1) {
            return {
                family: commaParts[0],
                ...(commaParts.slice(1).join(' ') && { given: commaParts.slice(1).join(' ') })
            };
        }

        const parts = trimmed.split(/\s+/);
        const family = parts.pop();
        if (!family) return undefined;

        const given = parts.join(' ');
        return { family, ...(given && { given }) };
    }

    private openLibraryRecordToCsl(record: OpenLibraryRecord, isbn: string): Record<string, any> | null {
        if (!record.title) return null;

        const subtitle = record.subtitle?.trim();
        const title = subtitle && !record.title.toLowerCase().includes(subtitle.toLowerCase())
            ? `${record.title}: ${subtitle}`
            : record.title;
        const authors = (record.authors || [])
            .map(author => this.parseOpenLibraryAuthor(author.name))
            .filter((author): author is { family: string; given?: string } => author !== undefined);
        const issued = DateParser.toCslDate(DateParser.parse(record.publish_date));
        const publisher = (record.publishers || []).map(value => value.name).filter(Boolean).join('; ');
        const publisherPlace = (record.publish_places || []).map(value => value.name).filter(Boolean).join('; ');
        const keywords = (record.subjects || []).map(value => value.name).filter(Boolean).join(', ');
        const note = typeof record.notes === 'string' ? record.notes : record.notes?.value;
        const editionMatch = subtitle?.match(/^(.+?)\s+edition$/i);

        return {
            type: 'book',
            title,
            ...(authors.length > 0 && { author: authors }),
            ...(issued && { issued }),
            ISBN: isbn,
            ...(publisher && { publisher }),
            ...(publisherPlace && { 'publisher-place': publisherPlace }),
            ...(editionMatch && { edition: editionMatch[1] }),
            ...(record.number_of_pages && { 'number-of-pages': record.number_of_pages }),
            ...(keywords && { keyword: keywords }),
            ...(note && { note }),
            ...(record.url && { URL: record.url })
        };
    }

    async fetchOpenLibraryCsl(identifier: string): Promise<Record<string, any> | null> {
        const isbn = this.parseIsbnIdentifier(identifier);
        if (!isbn) return null;

        const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
        try {
            const resp = await requestUrl({
                url,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Obsidian-BibLib'
                }
            });
            const data = JSON.parse(resp.text) as Record<string, OpenLibraryRecord>;
            const record = data[`ISBN:${isbn}`];
            return record ? this.openLibraryRecordToCsl(record, isbn) : null;
        } catch (err) {
            console.warn(`Open Library lookup failed for ISBN ${isbn}:`, err);
            return null;
        }
    }

    async fetchPubMedCsl(identifier: string): Promise<Record<string, any> | null> {
        const parsed = this.parsePubMedIdentifier(identifier);
        if (!parsed) return null;

        const url = `https://api.ncbi.nlm.nih.gov/lit/ctxp/v1/${parsed.source}/?format=csl&id=${parsed.id}`;
        try {
            const resp = await requestUrl({
                url,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'Obsidian-BibLib'
                }
            });
            const data = JSON.parse(resp.text);

            // NCBI returns [] with HTTP 200 when no record exists.
            if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length === 0) {
                return null;
            }

            return data as Record<string, any>;
        } catch (err) {
            console.warn(`NCBI ${parsed.source.toUpperCase()} lookup failed for ${identifier}:`, err);
            return null;
        }
    }

    async fetchCitoidBibTeX(identifier: string): Promise<string | null> {
        const cleaned = encodeURIComponent(identifier.trim());
        const fullUrl = `${this.apiUrl}${cleaned}`;

        try {
            const resp = await requestUrl({
                url: fullUrl,
                method: 'GET',
                headers: {
                    'Accept': 'application/x-bibtex',
                    'User-Agent': 'Obsidian-BibLib'
                }
            });
            return resp.text && resp.text.trim().startsWith('@') ? resp.text : null;
        } catch (err) {
            console.warn(`Citoid endpoint ${fullUrl} failed:`, err);
            return null;
        }
    }

    async fetchGoogleBooksCitoidBibTeX(identifier: string): Promise<string | null> {
        const parsedIsbn = this.parseIsbnIdentifier(identifier);
        if (!parsedIsbn) return null;

        const isbn13 = this.toIsbn13(parsedIsbn);
        const googleBooksUrl = `https://books.google.com/books?vid=ISBN${isbn13}`;
        const result = await this.fetchCitoidBibTeX(googleBooksUrl);
        if (!result) return null;

        // Citoid may return generic page metadata for an unsuccessful web
        // lookup. Only accept this fallback when it includes the requested ISBN.
        const normalizedResult = result.replace(/[\s-]/g, '');
        return normalizedResult.includes(isbn13) ? result : null;
    }

    async fetchCitationJsBibTeX(identifier: string): Promise<string> {
        new Notice('Using fallback metadata lookup for identifier');

        try {
            const data = await Cite.async(identifier);
            const bibliography = data.format('bibtex');
            if (!bibliography || !bibliography.trim().startsWith('@')) {
                throw new Error('citation-js did not return valid BibTeX');
            }
            return bibliography;
        } catch (err) {
            console.error('citation-js fallback failed:', err);
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`All metadata lookup methods failed. Last error: ${message}`);
        }
    }

    /**
     * Fetch BibTeX using Citoid, then Citation.js. Specialized CSL lookups for
     * ISBN and PubMed identifiers are orchestrated by CitationService.
     */
    async fetchBibTeX(identifier: string): Promise<string> {
        const citoidResult = await this.fetchCitoidBibTeX(identifier);
        return citoidResult || this.fetchCitationJsBibTeX(identifier);
    }
}
