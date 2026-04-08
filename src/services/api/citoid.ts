import { requestUrl, Notice } from 'obsidian';
// CitoidService only provides BibTeX fetching; JSON metadata via Citation.js
import Cite from 'citation-js';
import '@citation-js/plugin-isbn';
import '@citation-js/plugin-doi';
import '@citation-js/plugin-wikidata';

import '@citation-js/plugin-bibtex';

type PubMedSource = 'pubmed' | 'pmc';

interface ParsedPubMedIdentifier {
    source: PubMedSource;
    id: string;
}

export class CitoidService {
    private apiUrl: string = 'https://en.wikipedia.org/api/rest_v1/data/citation/bibtex/';

    constructor() {
        // Fixed BibTeX endpoint; no CrossRef fallback
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

        if (/^\d+$/.test(trimmed)) {
            return { source: 'pubmed', id: trimmed };
        }

        return null;
    }

    async fetchPubMedCsl(identifier: string): Promise<any | null> {
        const parsed = this.parsePubMedIdentifier(identifier);
        if (!parsed) {
            return null;
        }

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

            return JSON.parse(resp.text);
        } catch (err) {
            console.warn(`NCBI ${parsed.source.toUpperCase()} lookup failed for ${identifier}:`, err);
            return null;
        }
    }

    /**
     * Fetch BibTeX from Citoid API using DOI or URL.
     * @param identifier URL, DOI, or ISBN
     * @returns Promise resolving to BibTeX string
     */
    async fetchBibTeX(identifier: string): Promise<string> {
        const cleaned = encodeURIComponent(identifier.trim());
        // Attempt to fetch BibTeX at configured endpoint
        const fetchBib = async (baseUrl: string): Promise<string | null> => {
            const fullUrl = `${baseUrl}${cleaned}`;

            try {
                const resp = await requestUrl({
                    url: fullUrl,
                    method: 'GET',
                    headers: {
                        'Accept': 'application/x-bibtex',
                        'User-Agent': 'Obsidian-BibLib'
                    }
                });

                return resp.text;
            } catch (err) {
                console.warn(`Citoid endpoint ${fullUrl} failed:`, err);
                return null;
            }
        };

        try {
            let text = await fetchBib(this.apiUrl);
            // If the response is not valid BibTeX (doesn't start with '@'), try fallback to '/bibtex/' path
            if (!text || !text.trim().startsWith('@')) {
                // Fallback to try retrieving valid BibTeX
                // Derive fallback base URL: replace 'mediawiki/' with 'bibtex/', or append 'bibtex/'
                let fallbackBase = this.apiUrl;
                if (fallbackBase.includes('/mediawiki/')) {
                    fallbackBase = fallbackBase.replace(/\/mediawiki\/$/, '/bibtex/');
                } else if (!fallbackBase.includes('/bibtex/')) {
                    fallbackBase = fallbackBase.replace(/\/?$/, '/') + 'bibtex/';
                }
                text = await fetchBib(fallbackBase);

                if (!text || !text.trim().startsWith('@')) {
                    // Try citation-js as final fallback
                    console.log('Citoid endpoints failed, attempting fallback metadata lookup');
                    new Notice('Using fallback metadata lookup for identifier');

                    try {
                        const data = await Cite.async(identifier);
                        const bibliography = data.format('bibtex');

                        if (!bibliography || !bibliography.trim().startsWith('@')) {
                            throw new Error('citation-js did not return valid BibTeX');
                        }

                        text = bibliography;
                    } catch (citeErr) {
                        console.error('citation-js fallback failed:', citeErr);
                        throw new Error(`All BibTeX fetch methods failed. Last error: ${citeErr.message}`);
                    }
                }
            }
            return text!;
        } catch (err) {
            console.error('Error fetching BibTeX from Citoid:', err);
            throw err;
        }
    }

}
