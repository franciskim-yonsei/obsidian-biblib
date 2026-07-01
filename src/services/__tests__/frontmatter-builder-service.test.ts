import { FrontmatterBuilderService } from '../frontmatter-builder-service';
import { TemplateVariableBuilderService } from '../template-variable-builder-service';
import { DEFAULT_SETTINGS } from '../../types/settings';

describe('FrontmatterBuilderService', () => {
  it('stores structured authors in frontmatter without a flat mirror field', async () => {
    const service = new FrontmatterBuilderService(new TemplateVariableBuilderService());

    const yaml = await service.buildYamlFrontmatter({
      citation: {
        id: 'example2024',
        type: 'webpage',
        title: 'Example Reference',
        year: '2024',
        month: '3',
        day: '15'
      },
      contributors: [
        { role: 'author', family: 'Smith', given: 'Jane' }
      ],
      additionalFields: [
        {
          name: 'accessed',
          type: 'date',
          value: { 'date-parts': [[2026, 4, 8]] }
        }
      ],
      attachmentPaths: [],
      pluginSettings: DEFAULT_SETTINGS
    });

    expect(yaml).toContain('issued: 2024-03-15');
    expect(yaml).not.toContain('accessed:');
    expect(yaml).toContain('author:');
    expect(yaml).toContain('family: Smith');
    expect(yaml).toContain('given: Jane');
    expect(yaml).not.toContain('authors:');
    expect(yaml).not.toContain('- Jane Smith');
    expect(yaml).not.toContain('date-parts');
  });

  it('stores abbreviated container titles in frontmatter', async () => {
    const service = new FrontmatterBuilderService(new TemplateVariableBuilderService());

    const yaml = await service.buildYamlFrontmatter({
      citation: {
        id: 'smith_2026_nat.commun',
        type: 'article-journal',
        title: 'Example Article',
        'container-title': 'Nature Communications',
        'container-title-short': 'Nat.Commun.'
      },
      contributors: [
        { role: 'author', family: 'Smith', given: 'Jane' }
      ],
      additionalFields: [],
      attachmentPaths: [],
      pluginSettings: DEFAULT_SETTINGS
    });

    expect(yaml).toContain('container-title: Nature Communications');
    expect(yaml).toContain('container-title-short: Nat.Commun.');
  });

  it('writes built-in attachment links without custom frontmatter settings', async () => {
    const service = new FrontmatterBuilderService(new TemplateVariableBuilderService());

    const yaml = await service.buildYamlFrontmatter({
      citation: {
        id: 'groves.bronner-fraser_2000_Development',
        type: 'article-journal',
        title: 'Competence, specification and commitment in otic placode induction',
        issued: { 'date-parts': [[2000, 8, 15]] }
      },
      contributors: [
        { role: 'author', family: 'Groves', given: 'Andrew K.' },
        { role: 'author', family: 'Bronner-Fraser', given: 'Marianne' }
      ],
      additionalFields: [
        { name: 'ISSN', type: 'standard', value: '0950-1991' },
        { name: 'PMID', type: 'standard', value: '10903174' },
        { name: 'source', type: 'standard', value: 'journals.biologists.com' }
      ],
      attachmentPaths: ['Attachments/groves.bronner-fraser_2000_Development/groves_bronner-fraser_2000_Development.pdf'],
      pluginSettings: DEFAULT_SETTINGS
    });

    expect(yaml).toContain('attachment:');
    expect(yaml).toContain('Attachments/groves.bronner-fraser_2000_Development/groves_bronner-fraser_2000_Development.pdf');
    expect(yaml).not.toContain('reading-status:');
    expect(yaml).not.toContain('aliases:');
    expect(yaml).not.toContain('author-links:');
    expect(yaml).not.toContain('dateCreated:');
    expect(yaml).not.toContain('year:');
    expect(yaml).not.toContain('ISSN:');
    expect(yaml).not.toContain('PMID:');
    expect(yaml).not.toContain('source:');
  });

  it('applies the configured frontmatter field order before serializing YAML', async () => {
    const service = new FrontmatterBuilderService(new TemplateVariableBuilderService());

    const yaml = await service.buildYamlFrontmatter({
      citation: {
        id: 'example2026',
        type: 'article-journal',
        title: 'Ordered Reference',
        DOI: '10.1234/example',
        year: '2026'
      },
      contributors: [
        { role: 'author', family: 'Smith', given: 'Jane' }
      ],
      additionalFields: [
        {
          name: 'accessed',
          type: 'date',
          value: { 'date-parts': [[2026, 4, 8]] }
        }
      ],
      attachmentPaths: [],
      pluginSettings: {
        ...DEFAULT_SETTINGS,
        frontmatterFieldOrder: ['title', 'id', 'author', 'DOI', 'tags']
      }
    });

    const titleIndex = yaml.indexOf('title: Ordered Reference');
    const idIndex = yaml.indexOf('id: example2026');
    const authorIndex = yaml.indexOf('author:');
    const doiIndex = yaml.indexOf('DOI: 10.1234/example');
    const tagsIndex = yaml.indexOf('tags:');

    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeGreaterThanOrEqual(0);
    expect(authorIndex).toBeGreaterThanOrEqual(0);
    expect(doiIndex).toBeGreaterThanOrEqual(0);
    expect(tagsIndex).toBeGreaterThanOrEqual(0);

    expect(titleIndex).toBeLessThan(idIndex);
    expect(idIndex).toBeLessThan(authorIndex);
    expect(authorIndex).toBeLessThan(doiIndex);
    expect(doiIndex).toBeLessThan(tagsIndex);
  });
});
