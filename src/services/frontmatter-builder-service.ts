import { stringifyYaml } from 'obsidian';
import { BibliographyPluginSettings, parseLiteratureNoteTags } from '../types';
import { Citation, Contributor, AdditionalField } from '../types/citation';
import { TemplateEngine } from '../utils/template-engine';
import { TemplateVariableBuilderService } from './template-variable-builder-service';
import { processYamlArray } from '../utils/yaml-utils';
import { DateParser } from '../utils/date-parser';
import { NameParser } from '../utils/name-parser';
import { organizeFrontmatter } from '../utils/frontmatter-organization';
import { CSL_ALL_CSL_FIELDS } from '../utils/csl-variables';

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
      const { citation, contributors, additionalFields, attachmentPaths, attachmentAliases, pluginSettings, relatedNotePaths } = data;
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
      
      // Preserve standard CSL fields supplied by parsers without accepting
      // arbitrary custom/additional frontmatter fields.
      this.addAdditionalFieldsToFrontmatter(frontmatter, additionalFields);

      this.addBuiltInWorkflowFields(
        frontmatter,
        citation,
        contributors,
        attachmentPaths,
        relatedNotePaths,
        attachmentAliases
      );
      
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
  
  /**
   * Add additional fields to frontmatter object
   * @param frontmatter The frontmatter object to modify
   * @param additionalFields Array of additional fields to add
   */
  private addAdditionalFieldsToFrontmatter(
    frontmatter: Record<string, any>, 
    additionalFields: AdditionalField[]
  ): void {
    additionalFields.forEach((field) => {
      // Filter out fields without names or values, and reject non-CSL custom fields.
      if (!field.name || field.name.trim() === '' || !CSL_ALL_CSL_FIELDS.has(field.name)) {
        return;
      }
      
      // For date fields, check if value exists and is not empty
      if (field.type === 'date') {
        if (field.value == null || 
            (typeof field.value === 'string' && field.value.trim() === '') ||
            (typeof field.value === 'object' && (!field.value['date-parts'] || field.value['date-parts'].length === 0))) {
          return;
        }
      } else {
        // For non-date fields, check standard empty conditions
        if (field.value == null || field.value === '') {
          return;
        }
      }
      
      let valueToAdd = field.value;
      
      // Format value based on field type
      if (field.type === 'date') {
        valueToAdd = DateParser.toStorageString(field.value);
        if (!valueToAdd) {
          return;
        }
      } else if (field.type === 'number') {
        // Ensure numbers are stored as numbers, not strings
        // Handle various possible value types for conversion to number
        const stringValue = String(field.value);
        const numValue = parseFloat(stringValue);
        valueToAdd = isNaN(numValue) ? field.value : numValue;
      }
      
      // Add the potentially modified value to frontmatter
      frontmatter[field.name] = valueToAdd;
    });
  }
  
  private addBuiltInWorkflowFields(
    frontmatter: Record<string, any>,
    citation: Citation,
    contributors: Contributor[],
    attachmentPaths?: string[],
    relatedNotePaths?: string[],
    attachmentAliases?: string[]
  ): void {
    if (!frontmatter.year) {
      const issued = DateParser.parse(citation.issued ?? DateParser.fromFields(
        citation.year != null ? String(citation.year) : '',
        citation.month != null ? String(citation.month) : undefined,
        citation.day != null ? String(citation.day) : undefined
      ));
      if (issued?.year) {
        frontmatter.year = String(issued.year);
      }
    }

    if (!frontmatter.dateCreated) {
      frontmatter.dateCreated = new Date().toISOString().split('T')[0];
    }

    if (!frontmatter['reading-status']) {
      frontmatter['reading-status'] = 'to-read';
    }

    if (!frontmatter.aliases && citation.title) {
      frontmatter.aliases = [citation.title];
    }

    if (!frontmatter['author-links']) {
      const authorLinks = contributors
        .filter(contributor => contributor.role === 'author')
        .map(contributor => {
          if (contributor.literal) return contributor.literal;
          const family = contributor.family || '';
          const given = contributor.given || '';
          return [given, family].filter(Boolean).join(' ');
        })
        .filter(Boolean)
        .map(name => `[[Author/${name}]]`);

      if (authorLinks.length > 0) {
        frontmatter['author-links'] = authorLinks;
      }
    }

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
  
  /**
   * Process custom frontmatter fields from plugin settings
   * @param frontmatter The frontmatter object to modify
   * @param citation The citation data
   * @param contributors Array of contributors
   * @param attachmentPaths Optional paths to attachments
   * @param pluginSettings Plugin settings containing custom field definitions
   */
  private async processCustomFrontmatterFields(
    frontmatter: Record<string, any>,
    citation: Citation,
    contributors: Contributor[],
    attachmentPaths?: string[],
    pluginSettings?: BibliographyPluginSettings,
    relatedNotePaths?: string[],
    attachmentAliases?: string[]
  ): Promise<void> {
    if (!pluginSettings?.customFrontmatterFields?.length) {
      return;
    }
    
    // Build template variables
    const templateVariables = this.templateVariableBuilder.buildVariables(
      citation, 
      contributors, 
      attachmentPaths,
      relatedNotePaths,
      attachmentAliases
    );
    
    // Filter to enabled custom fields
    const enabledFields = pluginSettings.customFrontmatterFields.filter(field => field.enabled);
    
    // Process each enabled custom field
    for (const field of enabledFields) {
      // Special case handling for attachment fields with direct passthrough
      if (field.name === 'pdflink' && field.template === '{{pdflink}}') {
        if (templateVariables.pdflink?.length > 0) {
          frontmatter[field.name] = templateVariables.pdflink;
        }
        continue;
      }
      
      if (field.name === 'attachment' && field.template === '{{attachment}}') {
        if (templateVariables.attachments?.length > 0) {
          frontmatter[field.name] = templateVariables.attachments;
        }
        continue;
      }
      
      // Skip if field name already exists in frontmatter (don't overwrite standard fields)
      if (frontmatter.hasOwnProperty(field.name)) {
        continue;
      }
      
      // Determine if this looks like an array/object template
      const isArrayTemplate = field.template.trim().startsWith('[') && 
                             field.template.trim().endsWith(']');
      
      // Render the template with appropriate options
      const renderedValue = TemplateEngine.render(
        field.template,
        templateVariables, 
        { yamlArray: isArrayTemplate }
      );
      
      // Handle different types of rendered values
      if ((renderedValue.startsWith('[') && renderedValue.endsWith(']')) || 
          (renderedValue.startsWith('{') && renderedValue.endsWith('}'))) {
        try {
          // For array templates, process with our shared utility function first
          const processedValue = isArrayTemplate ? processYamlArray(renderedValue) : renderedValue;
          
          // Parse as JSON for arrays and objects
          frontmatter[field.name] = JSON.parse(processedValue);
        } catch (e) {
          // Special handling for array templates that should be empty arrays
          if (isArrayTemplate && (renderedValue.trim() === '[]' || renderedValue.trim() === '[ ]')) {
            frontmatter[field.name] = [];
          } else if (isArrayTemplate && 
                    (renderedValue.includes('{{pdflink}}') || renderedValue.includes('{{attachment}}')) && 
                    templateVariables.attachments?.length > 0) {
            // Handle array template containing attachments
            frontmatter[field.name] = templateVariables.attachments || [];
          } else {
            // Use as string if JSON parsing fails and no special case
            frontmatter[field.name] = renderedValue;
          }
        }
      } else if (renderedValue.trim() === '') {
        // For truly empty values in array templates, add empty array
        if (isArrayTemplate) {
          frontmatter[field.name] = [];
        }
        // Otherwise, don't add empty fields at all
      } else {
        // If the field value contains variable references that didn't render
        if (renderedValue.includes('{{pdflink}}') || renderedValue.includes('{{attachment}}')) {
          // Don't add the field if the template wasn't properly rendered
          // This indicates the attachment variable wasn't available
        } else {
          // Use as string for non-array/object values
          frontmatter[field.name] = renderedValue;
        }
      }
    }
  }
}
