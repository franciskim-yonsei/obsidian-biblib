import { stringifyYaml } from 'obsidian';
import { BibliographyPluginSettings, parseLiteratureNoteTags } from '../types';
import { Citation, Contributor, AdditionalField } from '../types/citation';
import { TemplateVariableBuilderService } from './template-variable-builder-service';
import { DateParser } from '../utils/date-parser';
import { NameParser } from '../utils/name-parser';
import { organizeFrontmatter } from '../utils/frontmatter-organization';

/**
 * Input for building a YAML frontmatter
 */
export interface FrontmatterInput {
  citation: Citation; // Core CSL data
  contributors: Contributor[];
  additionalFields: AdditionalField[]; // Fields not part of core CSL structure
  attachmentPaths?: string[]; // Normalized paths in vault if attachments exist
  attachmentAliases?: string[]; // Optional aliases aligned with attachmentPaths
  pluginSettings: BibliographyPluginSettings; // To access custom fields, tag etc.
  relatedNotePaths?: string[]; // Paths to related notes
}

/**
 * Service responsible for generating YAML frontmatter based on citation data and settings
 */
export class FrontmatterBuilderService {
  private templateVariableBuilder: TemplateVariableBuilderService;
  
  constructor(templateVariableBuilder: TemplateVariableBuilderService) {
    this.templateVariableBuilder = templateVariableBuilder;
  }
  
  /**
   * Build YAML frontmatter string from citation data and settings
   * @param data The input data for frontmatter generation
   * @returns Formatted YAML frontmatter string
   */
  async buildYamlFrontmatter(data: FrontmatterInput): Promise<string> {
    try {
      const { citation, contributors, attachmentPaths, attachmentAliases, pluginSettings, relatedNotePaths } = data;
      const issuedString = DateParser.toStorageString(
        citation.issued ?? DateParser.fromFields(
          citation.year != null ? String(citation.year) : '',
          citation.month != null ? String(citation.month) : undefined,
          citation.day != null ? String(citation.day) : undefined
        )
      );
      
      // Build base frontmatter object from essential citation fields
      const frontmatter: Record<string, any> = {
        id: citation.id,
        type: citation.type,
        title: citation.title,
        ...(issuedString && { issued: issuedString }),
        // Add standard CSL fields (only if they have values)
        ...(citation['title-short'] && { 'title-short': citation['title-short'] }),
        ...(citation.page && { page: citation.page }),
        ...(citation.URL && { URL: citation.URL }),
        ...(citation.DOI && { DOI: citation.DOI }),
        ...(citation['container-title'] && { 'container-title': citation['container-title'] }),
        ...(citation['container-title-short'] && { 'container-title-short': citation['container-title-short'] }),
        ...(citation.publisher && { publisher: citation.publisher }),
        ...(citation['publisher-place'] && { 'publisher-place': citation['publisher-place'] }),
        ...(citation.edition && { 
          edition: isNaN(Number(citation.edition)) ? citation.edition : Number(citation.edition) 
        }),
        ...(citation.volume && { 
          volume: isNaN(Number(citation.volume)) ? citation.volume : Number(citation.volume) 
        }),
        ...(citation.number && { 
          number: isNaN(Number(citation.number)) ? citation.number : Number(citation.number) 
        }),
        ...(citation.language && { language: citation.language }),
        ...(citation.abstract && { abstract: citation.abstract }),
        
        // Ensure literature note tags are always present, while preserving any existing tags
        // Parse the literatureNoteTag setting which may contain multiple comma/space-separated tags
        tags: citation.tags && Array.isArray(citation.tags)
          ? [...new Set([...citation.tags, ...parseLiteratureNoteTags(pluginSettings.literatureNoteTag)])]
          : parseLiteratureNoteTags(pluginSettings.literatureNoteTag)
      };
      
      // Add contributors to frontmatter, preserving all CSL contributor properties
      this.addContributorsToFrontmatter(frontmatter, contributors);
      
      this.addBuiltInAttachmentFields(frontmatter, attachmentPaths, attachmentAliases, relatedNotePaths);
      
      const organizedFrontmatter = organizeFrontmatter(
        frontmatter,
        pluginSettings.frontmatterFieldOrder
      );

      // Generate formatted YAML
      return stringifyYaml(organizedFrontmatter);
    } catch (error) {
      console.error('Error creating frontmatter:', error);
      throw error;
    }
  }
  
  /**
   * Add contributors to frontmatter object
   * @param frontmatter The frontmatter object to modify
   * @param contributors Array of contributors to add
   */
  private addContributorsToFrontmatter(
    frontmatter: Record<string, any>, 
    contributors: Contributor[]
  ): void {
    const contributorsByRole: Record<string, Contributor[]> = {};

    contributors.forEach(contributor => {
      if (!(contributor.family || contributor.given || contributor.literal)) {
        return;
      }

      if (!contributorsByRole[contributor.role]) {
        contributorsByRole[contributor.role] = [];
      }

      contributorsByRole[contributor.role].push(contributor);
    });

    Object.entries(contributorsByRole).forEach(([role, roleContributors]) => {
      if (role === 'author') {
        frontmatter.author = roleContributors.map(({ role: _role, ...personData }) => personData);
        return;
      }

      const storedNames = NameParser.toStorageStrings(roleContributors);
      if (storedNames.length > 0) {
        frontmatter[role] = storedNames;
      }
    });
  }
  
  private addBuiltInAttachmentFields(
    frontmatter: Record<string, any>,
    attachmentPaths?: string[],
    attachmentAliases?: string[],
    relatedNotePaths?: string[]
  ): void {
    if (attachmentPaths?.length) {
      frontmatter.attachment = attachmentPaths.map((path, index) => {
        const alias = attachmentAliases?.[index]?.trim() || this.defaultAttachmentAlias(path);
        return `[[${path}|${alias}]]`;
      });
    }

    if (relatedNotePaths?.length) {
      frontmatter.related = relatedNotePaths;
    }
  }

  private defaultAttachmentAlias(path: string): string {
    if (path.endsWith('.pdf')) return 'PDF';
    if (path.endsWith('.epub')) return 'EPUB';
    return path.split('.').pop()?.toUpperCase() || 'FILE';
  }
}
