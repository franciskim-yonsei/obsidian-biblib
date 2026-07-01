import { App, Notice, Plugin, TFile } from 'obsidian';
import { BibliographyModal } from '../ui/modals/bibliography-modal';
import { ChapterModal } from '../ui/modals/chapter-modal';
import { BulkImportModal } from '../ui/modals/bulk-import-modal';
import { EditBibliographyModal } from '../ui/modals/edit-bibliography-modal';
import { AddAttachmentModal } from '../ui/modals/add-attachment-modal';
import { BibliographyPluginSettings, hasLiteratureNoteTag } from '../types/settings';
import { BibliographyBuilder } from '../services/bibliography-builder';
import { ServiceManager } from './service-manager';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants';

/**
 * Manages command registration for the Bibliography plugin
 */
export class CommandRegistry {
    constructor(
        private app: App,
        private plugin: Plugin,
        private settings: BibliographyPluginSettings,
        private serviceManager: ServiceManager
    ) {}

    /**
     * Register all commands for the plugin
     */
    public registerCommands(): void {
        this.registerLiteratureNoteCommands();
        this.registerBibliographyCommands();
    }

    /**
     * Register literature note and chapter-related commands
     */
    private registerLiteratureNoteCommands(): void {
        // Create literature note command
        this.plugin.addCommand({
            id: 'create-literature-note',
            name: 'Create literature note',
            callback: () => {
                new BibliographyModal(
                    this.app,
                    this.settings,
                    this.serviceManager.getCitoidService(),
                    this.serviceManager.getCitationService(),
                    this.serviceManager.getNoteCreationService(),
                    true
                ).open();
            },
        });

        // Edit literature note command
        this.plugin.addCommand({
            id: 'edit-literature-note',
            name: 'Edit literature note',
            checkCallback: (checking) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return false;

                const cache = this.app.metadataCache.getFileCache(activeFile);
                if (!cache || !cache.frontmatter) return false;

                const frontmatter = cache.frontmatter;
                if (!hasLiteratureNoteTag(frontmatter.tags, this.settings.literatureNoteTag)) {
                    return false;
                }

                if (checking) return true;

                new EditBibliographyModal(
                    this.app,
                    this.settings,
                    this.serviceManager.getCitoidService(),
                    this.serviceManager.getCitationService(),
                    this.serviceManager.getNoteCreationService(),
                    activeFile
                ).open();
                return true;
            },
        });

        // Add attachment to current literature note command
        this.plugin.addCommand({
            id: 'add-attachment-to-current-note',
            name: 'Add attachment to current literature note',
            checkCallback: (checking) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile || !this.isLiteratureNote(activeFile)) return false;
                if (checking) return true;

                this.openAddAttachmentModal(activeFile);
                return true;
            },
        });

        // Create book chapter entry command
        this.plugin.addCommand({
            id: 'create-chapter-entry',
            name: 'Create book chapter entry',
            callback: () => {
                new ChapterModal(
                    this.app,
                    this.settings,
                    this.serviceManager.getCitationService(),
                    this.serviceManager.getNoteCreationService()
                ).open();
            },
        });

        // Bulk import references command
        this.plugin.addCommand({
            id: 'bulk-import-references',
            name: 'Bulk import references',
            callback: () => {
                new BulkImportModal(
                    this.app,
                    this.settings,
                    this.serviceManager.getNoteCreationService()
                ).open();
            },
        });

        // Create chapter from current book command
        this.plugin.addCommand({
            id: 'create-chapter-from-current-book',
            name: 'Create chapter from current book',
            checkCallback: (checking) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return false;

                const cache = this.app.metadataCache.getFileCache(activeFile);
                if (!cache || !cache.frontmatter) return false;

                const frontmatter = cache.frontmatter;
                if (!frontmatter.type || !['book', 'collection', 'document'].includes(frontmatter.type)) {
                    return false;
                }

                if (!hasLiteratureNoteTag(frontmatter.tags, this.settings.literatureNoteTag)) {
                    return false;
                }

                if (checking) return true;

                new ChapterModal(
                    this.app,
                    this.settings,
                    this.serviceManager.getCitationService(),
                    this.serviceManager.getNoteCreationService(),
                    activeFile.path
                ).open();
                return true;
            },
        });
    }

    private isLiteratureNote(file: TFile): boolean {
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        return !!frontmatter && hasLiteratureNoteTag(frontmatter.tags, this.settings.literatureNoteTag);
    }

    private openAddAttachmentModal(file: TFile): void {
        const cache = this.app.metadataCache.getFileCache(file);
        const citekey = cache?.frontmatter?.id || cache?.frontmatter?.citekey || file.basename.replace(/^@/, '');

        new AddAttachmentModal(
            this.app,
            file,
            citekey,
            this.serviceManager.getAttachmentManager()
        ).open();
    }

    /**
     * Register bibliography export and build commands
     */
    private registerBibliographyCommands(): void {
        // Build bibliography command
        this.plugin.addCommand({
            id: 'build-bibliography',
            name: 'Build bibliography',
            callback: async () => {
                try {
                    new Notice(SUCCESS_MESSAGES.BIBLIOGRAPHY_BUILDING);
                    const builder = new BibliographyBuilder(this.app, this.settings);
                    await builder.buildBibliography();
                } catch (error) {
                    console.error('Error building bibliography:', error);
                    new Notice(ERROR_MESSAGES.BIBLIOGRAPHY_BUILD_FAILED);
                }
            },
        });

        // Export BibTeX command
        this.plugin.addCommand({
            id: 'export-bibtex',
            name: 'Export bibliography as BibTeX',
            callback: async () => {
                try {
                    new Notice(SUCCESS_MESSAGES.BIBTEX_EXPORTING);
                    const builder = new BibliographyBuilder(this.app, this.settings);
                    await builder.exportBibTeX();
                } catch (_error) {
                    // Errors are logged by BibliographyBuilder
                }
            },
        });
    }
}
