import { setIcon } from 'obsidian';
import BibliographyPlugin from '../../main';
import {
    getMetadataTypeManager,
    type MetadataAssignedWidget,
    type MetadataTypeManager,
    type MetadataTypeWidget,
    type MetadataWidgetRenderContext,
    type MetadataWidgetRenderer,
} from '../internal/obsidian-metadata';
import type { CslName } from '../types/citation';
import { StructuredAuthorEditorModal } from '../ui/modals/structured-author-editor-modal';
import { NameParser } from '../utils/name-parser';

const AUTHOR_FIELD = 'author';
const BIBLIB_AUTHOR_WIDGET_TYPE = 'biblib-csl-authors';

function cloneAuthor(author: CslName): CslName {
    return { ...author };
}

function formatCslName(name: CslName): string {
    if (name.literal?.trim()) {
        return name.literal.trim();
    }

    const parts = [
        name.given,
        name['dropping-particle'],
        name['non-dropping-particle'],
        name.family,
    ]
        .filter((part): part is string => Boolean(part?.trim()))
        .map(part => part.trim());

    let display = parts.join(' ').trim();
    if (name.suffix?.trim()) {
        display = display ? `${display}, ${name.suffix.trim()}` : name.suffix.trim();
    }

    return display;
}

function getDisplayNames(value: unknown): string[] {
    return NameParser.toCslNames(value)
        .map(author => formatCslName(author).trim())
        .filter(author => author.length > 0);
}

function isAuthorValue(value: unknown): boolean {
    return (
        value == null ||
        Array.isArray(value) ||
        (typeof value === 'object' && value !== null)
    );
}

class AuthorPropertyWidgetRenderer implements MetadataWidgetRenderer {
    private readonly authors: CslName[];
    private readonly triggerEl: HTMLButtonElement;
    private isEditing = false;

    constructor(
        private readonly plugin: BibliographyPlugin,
        containerEl: HTMLElement,
        value: unknown,
        private readonly context: MetadataWidgetRenderContext,
    ) {
        this.authors = NameParser.toCslNames(value).map(author => cloneAuthor(author));
        containerEl.addClass('yaml-struct-property-widget', 'multi-select-container');

        const names = getDisplayNames(value);
        this.triggerEl = containerEl.createEl('button', {
            cls: 'yaml-struct-author-trigger',
            attr: {
                type: 'button',
                'aria-label': names.length > 0 ? 'Edit authors' : 'Set authors',
                title: names.length > 0 ? 'Edit authors' : 'Set authors',
            },
        });

        const listEl = this.triggerEl.createDiv({ cls: 'yaml-struct-author-preview' });
        if (names.length === 0) {
            listEl.createSpan({
                cls: 'yaml-struct-author-placeholder',
                text: 'No authors',
            });
        } else {
            for (const name of names) {
                const pillEl = listEl.createDiv({ cls: 'yaml-struct-author-pill multi-select-pill' });
                pillEl.createSpan({ cls: 'multi-select-pill-content', text: name });
            }
        }

        const actionEl = this.triggerEl.createSpan({ cls: 'yaml-struct-author-action clickable-icon' });
        setIcon(actionEl, names.length > 0 ? 'pencil' : 'plus');

        this.triggerEl.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            void this.openEditor();
        });

        containerEl.addEventListener('dblclick', event => {
            event.preventDefault();
            event.stopPropagation();
            void this.openEditor();
        });
    }

    focus(): void {
        this.triggerEl.focus();
    }

    private async openEditor(): Promise<void> {
        if (this.isEditing) {
            return;
        }

        this.isEditing = true;
        try {
            const result = await new StructuredAuthorEditorModal(this.plugin.app, {
                fileName: this.context.sourcePath || 'current note',
                authorField: this.context.key,
                initialAuthors: this.authors,
            }).openAndGetResult();

            if (!result.saved) {
                return;
            }

            this.context.onChange(result.authors.length > 0 ? result.authors : []);
            this.context.blur();
        } finally {
            this.isEditing = false;
        }
    }
}

function createWidget(plugin: BibliographyPlugin): MetadataTypeWidget {
    return {
        name: () => 'CSL authors',
        type: BIBLIB_AUTHOR_WIDGET_TYPE,
        icon: 'lucide-users',
        validate: isAuthorValue,
        render: (containerEl, value, context) => new AuthorPropertyWidgetRenderer(plugin, containerEl, value, context),
    };
}

export class AuthorPropertiesManager {
    private readonly originalAssignments = new Map<string, MetadataAssignedWidget | null>();
    private previousWidget: MetadataTypeWidget | null = null;

    constructor(private readonly plugin: BibliographyPlugin) {}

    onload(): void {
        this.registerWidget();
        this.bindField(AUTHOR_FIELD);
    }

    onunload(): void {
        this.unbindField(AUTHOR_FIELD);
        this.unregisterWidget();
    }

    private manager(): MetadataTypeManager {
        return getMetadataTypeManager(this.plugin.app);
    }

    private registerWidget(): void {
        const metadataTypeManager = this.manager();
        this.previousWidget = metadataTypeManager.registeredTypeWidgets[BIBLIB_AUTHOR_WIDGET_TYPE] ?? null;
        metadataTypeManager.registeredTypeWidgets[BIBLIB_AUTHOR_WIDGET_TYPE] = createWidget(this.plugin);
    }

    private unregisterWidget(): void {
        const metadataTypeManager = this.manager();
        if (this.previousWidget) {
            metadataTypeManager.registeredTypeWidgets[BIBLIB_AUTHOR_WIDGET_TYPE] = this.previousWidget;
        } else {
            delete metadataTypeManager.registeredTypeWidgets[BIBLIB_AUTHOR_WIDGET_TYPE];
        }
    }

    private bindField(fieldName: string): void {
        const normalizedFieldName = fieldName.toLowerCase();
        if (!normalizedFieldName) {
            return;
        }

        const metadataTypeManager = this.manager();
        if (!this.originalAssignments.has(normalizedFieldName)) {
            this.originalAssignments.set(normalizedFieldName, metadataTypeManager.assignedWidgets[normalizedFieldName] ?? null);
        }

        metadataTypeManager.assignedWidgets[normalizedFieldName] = {
            name: fieldName,
            widget: BIBLIB_AUTHOR_WIDGET_TYPE,
        };
        metadataTypeManager.trigger('changed', normalizedFieldName);
    }

    private unbindField(fieldName: string): void {
        const normalizedFieldName = fieldName.toLowerCase();
        if (!normalizedFieldName) {
            return;
        }

        const metadataTypeManager = this.manager();
        const originalAssignment = this.originalAssignments.get(normalizedFieldName);
        if (originalAssignment) {
            metadataTypeManager.assignedWidgets[normalizedFieldName] = originalAssignment;
        } else {
            delete metadataTypeManager.assignedWidgets[normalizedFieldName];
        }
        metadataTypeManager.trigger('changed', normalizedFieldName);
    }
}
