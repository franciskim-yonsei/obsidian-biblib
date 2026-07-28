import { CitationService } from '../citation-service';
import { CitoidService } from '../api/citoid';

describe('CitationService identifier lookup', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses Open Library when Citoid cannot resolve a valid ISBN', async () => {
        jest.spyOn(CitoidService.prototype, 'fetchPubMedCsl').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchCitoidBibTeX').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchGoogleBooksCitoidBibTeX').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchOpenLibraryCsl').mockResolvedValue({
            type: 'book',
            title: 'Growth and Distribution: Second Edition',
            author: [{ family: 'Foley', given: 'Duncan K.' }],
            issued: { 'date-parts': [[2019]] },
            ISBN: '9780674986428'
        });
        const citationJsFallback = jest
            .spyOn(CitoidService.prototype, 'fetchCitationJsBibTeX')
            .mockRejectedValue(new Error('should not be called'));

        const result = await new CitationService().fetchNormalized('9780674986428');

        expect(result).toMatchObject({
            type: 'book',
            title: 'Growth and Distribution: Second Edition',
            ISBN: '9780674986428'
        });
        expect(result.id).toBeTruthy();
        expect(citationJsFallback).not.toHaveBeenCalled();
    });

    it('uses a validated Google Books page before the Open Library fallback', async () => {
        jest.spyOn(CitoidService.prototype, 'fetchPubMedCsl').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchCitoidBibTeX').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchGoogleBooksCitoidBibTeX').mockResolvedValue(`
            @book{foley2019,
                title = {Growth and Distribution: Second Edition},
                author = {Foley, Duncan K. and Michl, Thomas R. and Tavani, Daniele},
                isbn = {9780674986428},
                year = {2019}
            }
        `);
        const openLibraryLookup = jest.spyOn(CitoidService.prototype, 'fetchOpenLibraryCsl');

        const result = await new CitationService().fetchNormalized('9780674986428');

        expect(result.author).toHaveLength(3);
        expect(result.author[2]).toMatchObject({ family: 'Tavani', given: 'Daniele' });
        expect(openLibraryLookup).not.toHaveBeenCalled();
    });

    it('uses direct PubMed data before broad lookup services', async () => {
        jest.spyOn(CitoidService.prototype, 'fetchPubMedCsl').mockResolvedValue({
            id: 'pmid:31209238',
            type: 'article-journal',
            title: 'Test article',
            author: [{ family: 'Smith', given: 'Jane' }],
            issued: { 'date-parts': [[2019]] }
        });
        const citoidLookup = jest.spyOn(CitoidService.prototype, 'fetchCitoidBibTeX');
        const googleBooksLookup = jest.spyOn(CitoidService.prototype, 'fetchGoogleBooksCitoidBibTeX');
        const openLibraryLookup = jest.spyOn(CitoidService.prototype, 'fetchOpenLibraryCsl');

        const result = await new CitationService().fetchNormalized('PMID:31209238');

        expect(result.title).toBe('Test article');
        expect(result.id).not.toMatch(/^pmid:/i);
        expect(citoidLookup).not.toHaveBeenCalled();
        expect(googleBooksLookup).not.toHaveBeenCalled();
        expect(openLibraryLookup).not.toHaveBeenCalled();
    });

    it('uses Citation.js only after direct services return no data', async () => {
        jest.spyOn(CitoidService.prototype, 'fetchPubMedCsl').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchCitoidBibTeX').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchGoogleBooksCitoidBibTeX').mockResolvedValue(null);
        jest.spyOn(CitoidService.prototype, 'fetchOpenLibraryCsl').mockResolvedValue(null);
        const fallbackLookup = jest.spyOn(CitoidService.prototype, 'fetchCitationJsBibTeX').mockResolvedValue(`
            @article{smith2024,
                title = {Fallback result},
                author = {Smith, Jane},
                year = {2024}
            }
        `);

        const result = await new CitationService().fetchNormalized('10.1234/example');

        expect(result.title).toBe('Fallback result');
        expect(fallbackLookup).toHaveBeenCalledWith('10.1234/example');
    });
});
