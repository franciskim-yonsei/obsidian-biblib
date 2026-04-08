import { App } from 'obsidian';
import { BibliographyBuilder } from '../bibliography-builder';
import { DEFAULT_SETTINGS } from '../../types/settings';

describe('BibliographyBuilder', () => {
  it('reconstructs flat date strings as CSL dates for export', () => {
    const builder = new BibliographyBuilder(new App() as any, DEFAULT_SETTINGS);

    const normalized = (builder as any).normalizeFrontmatterForExport({
      id: 'example2024',
      type: 'webpage',
      title: 'Example Reference',
      issued: '2024-03-15',
      accessed: '2026-04-08'
    });

    expect(normalized.issued).toEqual({ 'date-parts': [[2024, 3, 15]] });
    expect(normalized.accessed).toEqual({ 'date-parts': [[2026, 4, 8]] });
  });

  it('falls back to year/month/day fields when issued is absent', () => {
    const builder = new BibliographyBuilder(new App() as any, DEFAULT_SETTINGS);

    const normalized = (builder as any).normalizeFrontmatterForExport({
      id: 'example2024',
      type: 'article-journal',
      title: 'Example Reference',
      year: '2024',
      month: '3'
    });

    expect(normalized.issued).toEqual({ 'date-parts': [[2024, 3]] });
  });

  it('preserves structured authors for export', () => {
    const builder = new BibliographyBuilder(new App() as any, DEFAULT_SETTINGS);

    const normalized = (builder as any).normalizeFrontmatterForExport({
      id: 'example2024',
      type: 'article-journal',
      title: 'Example Reference',
      author: [
        { family: 'Smith', given: 'Jane' },
        { literal: 'World Health Organization' }
      ]
    });

    expect(normalized.author).toEqual([
      { family: 'Smith', given: 'Jane' },
      { literal: 'World Health Organization' }
    ]);
  });
});
