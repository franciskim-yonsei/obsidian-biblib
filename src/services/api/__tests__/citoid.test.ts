import { CitoidService } from '../citoid';
import { requestUrl } from 'obsidian';
import Cite from 'citation-js';

jest.mock('obsidian', () => ({
  requestUrl: jest.fn(),
  Notice: jest.fn()
}));

jest.mock('citation-js', () => ({
  __esModule: true,
  default: {
    async: jest.fn()
  }
}));

const mockRequestUrl = requestUrl as jest.MockedFunction<typeof requestUrl>;
const mockCiteAsync = Cite.async as jest.MockedFunction<typeof Cite.async>;

const mockResponse = (text: string, status = 200) => ({
  text,
  json: {},
  status,
  headers: {} as Record<string, string>,
  arrayBuffer: new ArrayBuffer(0)
});

const validBibTeX = `@article{smith2023,
  author = {Smith, John},
  title = {A Great Paper},
  year = {2023},
  journal = {Journal of Testing}
}`;

describe('CitoidService', () => {
  let service: CitoidService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CitoidService();
  });

  describe('fetchCitoidBibTeX', () => {
    it('fetches valid BibTeX from Citoid', async () => {
      mockRequestUrl.mockResolvedValueOnce(mockResponse(validBibTeX));

      await expect(service.fetchCitoidBibTeX(' 10.1234/test.doi ')).resolves.toBe(validBibTeX);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: expect.stringContaining('10.1234%2Ftest.doi'),
        method: 'GET',
        headers: {
          'Accept': 'application/x-bibtex',
          'User-Agent': 'Obsidian-BibLib'
        }
      });
    });

    it('accepts leading whitespace in a valid BibTeX response', async () => {
      const response = `  \n${validBibTeX}`;
      mockRequestUrl.mockResolvedValueOnce(mockResponse(response));

      await expect(service.fetchCitoidBibTeX('10.1234/test')).resolves.toBe(response);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('returns null for non-BibTeX content without repeating the same endpoint', async () => {
      mockRequestUrl.mockResolvedValueOnce(mockResponse('Not valid BibTeX'));

      await expect(service.fetchCitoidBibTeX('10.1234/test')).resolves.toBeNull();
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('returns null after a network error', async () => {
      mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

      await expect(service.fetchCitoidBibTeX('10.1234/test')).resolves.toBeNull();
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('Citation.js fallback', () => {
    it('returns valid BibTeX', async () => {
      mockCiteAsync.mockResolvedValueOnce({
        format: jest.fn().mockReturnValue(validBibTeX)
      } as any);

      await expect(service.fetchCitationJsBibTeX('10.1234/test')).resolves.toBe(validBibTeX);
      expect(mockCiteAsync).toHaveBeenCalledWith('10.1234/test');
    });

    it('rejects invalid output', async () => {
      mockCiteAsync.mockResolvedValueOnce({
        format: jest.fn().mockReturnValue('Still invalid')
      } as any);

      await expect(service.fetchCitationJsBibTeX('10.1234/test')).rejects.toThrow(
        'All metadata lookup methods failed'
      );
    });

    it('runs after one failed Citoid request', async () => {
      mockRequestUrl.mockResolvedValueOnce(mockResponse('Invalid'));
      mockCiteAsync.mockResolvedValueOnce({
        format: jest.fn().mockReturnValue(validBibTeX)
      } as any);

      await expect(service.fetchBibTeX('10.1234/test')).resolves.toBe(validBibTeX);
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
      expect(mockCiteAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetchGoogleBooksCitoidBibTeX', () => {
    it('retries a valid ISBN as a Google Books page and validates the response ISBN', async () => {
      const bookBibTeX = '@book{foley2019, title={Growth and Distribution}, isbn={9780674986428}}';
      mockRequestUrl.mockResolvedValueOnce(mockResponse(bookBibTeX));

      await expect(service.fetchGoogleBooksCitoidBibTeX('0-674-98642-3')).resolves.toBe(bookBibTeX);
      expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
        url: expect.stringContaining(encodeURIComponent('https://books.google.com/books?vid=ISBN9780674986428'))
      }));
    });

    it('rejects generic page metadata that does not contain the requested ISBN', async () => {
      mockRequestUrl.mockResolvedValueOnce(mockResponse('@misc{generic, title={Enable JavaScript}}'));

      await expect(service.fetchGoogleBooksCitoidBibTeX('9780674986428')).resolves.toBeNull();
    });

    it('does not query Citoid for a non-ISBN identifier', async () => {
      await expect(service.fetchGoogleBooksCitoidBibTeX('1080520553')).resolves.toBeNull();
      expect(mockRequestUrl).not.toHaveBeenCalled();
    });
  });

  describe('fetchOpenLibraryCsl', () => {
    const openLibraryRecord = {
      'ISBN:9780674986428': {
        title: 'Growth and Distribution',
        subtitle: 'Second Edition',
        authors: [
          { name: 'Duncan K. Foley' },
          { name: 'Thomas R. Michl' },
          { name: 'Daniele Tavani' }
        ],
        number_of_pages: 416,
        identifiers: {
          isbn_10: ['0674986423'],
          isbn_13: ['9780674986428']
        },
        publishers: [{ name: 'Harvard University Press' }],
        publish_date: 'Feb 11, 2019',
        publish_places: [{ name: 'Cambridge, Massachusetts' }],
        subjects: [{ name: 'Economic development' }, { name: 'Income distribution' }],
        url: 'https://openlibrary.org/books/OL27338071M/Growth_and_Distribution'
      }
    };

    it('resolves and maps an ISBN-13 record', async () => {
      mockRequestUrl.mockResolvedValueOnce(mockResponse(JSON.stringify(openLibraryRecord)));

      const result = await service.fetchOpenLibraryCsl('978-0-674-98642-8');

      expect(result).toMatchObject({
        type: 'book',
        title: 'Growth and Distribution: Second Edition',
        ISBN: '9780674986428',
        edition: 'Second',
        publisher: 'Harvard University Press',
        'publisher-place': 'Cambridge, Massachusetts',
        'number-of-pages': 416,
        issued: { 'date-parts': [[2019, 2, 11]] }
      });
      expect(result?.author).toEqual([
        { family: 'Foley', given: 'Duncan K.' },
        { family: 'Michl', given: 'Thomas R.' },
        { family: 'Tavani', given: 'Daniele' }
      ]);
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://openlibrary.org/api/books?bibkeys=ISBN:9780674986428&format=json&jscmd=data',
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Obsidian-BibLib'
        }
      });
    });

    it('accepts an ISBN prefix and ISBN-10', async () => {
      const isbn10Record = {
        'ISBN:0674986423': openLibraryRecord['ISBN:9780674986428']
      };
      mockRequestUrl.mockResolvedValueOnce(mockResponse(JSON.stringify(isbn10Record)));

      const result = await service.fetchOpenLibraryCsl('ISBN: 0-674-98642-3');

      expect(result?.ISBN).toBe('0674986423');
      expect(mockRequestUrl).toHaveBeenCalledTimes(1);
    });

    it('returns null when Open Library has no record', async () => {
      mockRequestUrl.mockResolvedValueOnce(mockResponse('{}'));

      await expect(service.fetchOpenLibraryCsl('9780674986428')).resolves.toBeNull();
    });

    it('does not query Open Library for an invalid ISBN or OCLC number', async () => {
      await expect(service.fetchOpenLibraryCsl('1080520553')).resolves.toBeNull();
      await expect(service.fetchOpenLibraryCsl('not-an-isbn')).resolves.toBeNull();
      expect(mockRequestUrl).not.toHaveBeenCalled();
    });
  });

  describe('fetchPubMedCsl', () => {
    it('fetches CSL for PMID-prefixed identifiers', async () => {
      mockRequestUrl.mockResolvedValueOnce(
        mockResponse(JSON.stringify({ id: 'pmid:31209238', title: 'Test article' }))
      );

      const result = await service.fetchPubMedCsl('pmid:31209238');

      expect(result).toEqual({ id: 'pmid:31209238', title: 'Test article' });
      expect(mockRequestUrl).toHaveBeenCalledWith({
        url: 'https://api.ncbi.nlm.nih.gov/lit/ctxp/v1/pubmed/?format=csl&id=31209238',
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Obsidian-BibLib'
        }
      });
    });

    it('fetches CSL for a bare numeric PubMed identifier', async () => {
      mockRequestUrl.mockResolvedValueOnce(
        mockResponse(JSON.stringify({ id: 'pmid:31209238', title: 'Test article' }))
      );

      await expect(service.fetchPubMedCsl('31209238')).resolves.toMatchObject({ title: 'Test article' });
    });

    it('fetches CSL for PMC identifiers', async () => {
      mockRequestUrl.mockResolvedValueOnce(
        mockResponse(JSON.stringify({ id: 'pmid:31281945', title: 'PMC article' }))
      );

      await expect(service.fetchPubMedCsl('PMC6613236')).resolves.toMatchObject({ title: 'PMC article' });
      expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://api.ncbi.nlm.nih.gov/lit/ctxp/v1/pmc/?format=csl&id=6613236'
      }));
    });

    it('treats the NCBI no-result array as no result', async () => {
      mockRequestUrl.mockResolvedValueOnce(mockResponse('[]'));

      await expect(service.fetchPubMedCsl('31209238')).resolves.toBeNull();
    });

    it('does not reinterpret 10- or 13-digit identifiers as PMIDs', async () => {
      await expect(service.fetchPubMedCsl('0674986423')).resolves.toBeNull();
      await expect(service.fetchPubMedCsl('9780674986428')).resolves.toBeNull();
      expect(mockRequestUrl).not.toHaveBeenCalled();
    });

    it('returns null for non-PubMed identifiers', async () => {
      await expect(service.fetchPubMedCsl('10.1234/test.doi')).resolves.toBeNull();
      expect(mockRequestUrl).not.toHaveBeenCalled();
    });
  });
});
