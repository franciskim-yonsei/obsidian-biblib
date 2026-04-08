import { FrontmatterBuilderService } from '../frontmatter-builder-service';
import { TemplateVariableBuilderService } from '../template-variable-builder-service';
import { DEFAULT_SETTINGS } from '../../types/settings';

describe('FrontmatterBuilderService', () => {
  it('stores structured authors plus an Obsidian-friendly authors list', async () => {
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
    expect(yaml).toContain('authors:');
    expect(yaml).toContain('- Jane Smith');
    expect(yaml).not.toContain('date-parts');
  });
});
