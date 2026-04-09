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
    expect(yaml).toContain('accessed: 2026-04-08');
    expect(yaml).toContain('author:');
    expect(yaml).toContain('family: Smith');
    expect(yaml).toContain('given: Jane');
    expect(yaml).not.toContain('authors:');
    expect(yaml).not.toContain('- Jane Smith');
    expect(yaml).not.toContain('date-parts');
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
        frontmatterFieldOrder: ['title', 'id', 'author', 'accessed', 'DOI', 'tags']
      }
    });

    const titleIndex = yaml.indexOf('title: Ordered Reference');
    const idIndex = yaml.indexOf('id: example2026');
    const authorIndex = yaml.indexOf('author:');
    const accessedIndex = yaml.indexOf('accessed: 2026-04-08');
    const doiIndex = yaml.indexOf('DOI: 10.1234/example');
    const tagsIndex = yaml.indexOf('tags:');

    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeGreaterThanOrEqual(0);
    expect(authorIndex).toBeGreaterThanOrEqual(0);
    expect(accessedIndex).toBeGreaterThanOrEqual(0);
    expect(doiIndex).toBeGreaterThanOrEqual(0);
    expect(tagsIndex).toBeGreaterThanOrEqual(0);

    expect(titleIndex).toBeLessThan(idIndex);
    expect(idIndex).toBeLessThan(authorIndex);
    expect(authorIndex).toBeLessThan(accessedIndex);
    expect(accessedIndex).toBeLessThan(doiIndex);
    expect(doiIndex).toBeLessThan(tagsIndex);
  });
});
