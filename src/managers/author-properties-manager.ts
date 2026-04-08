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

    const parts = [name.given, name.family]
        .filter((part): part is string => Boolean(part?.trim()))
        .map(part => part.trim());

    return parts.join(' ');
}

function getStructuredAuthors(value: unknown): CslName[] {
    return NameParser.toCslNames(value).map(author => cloneAuthor(author));
}

function isAuthorValue(value: unknown): boolean {
    return (
        value == null ||
        typeof value === 'string' ||
        Array.isArray(value) ||
        (typeof value === 'object' && value !== null)
    );
}

class AuthorPropertyWidgetRenderer implements MetadataWidgetRenderer {
    private authors: CslName[];
    private editingIndex: number | null = null;
    private addingNew = false;
    private cleanupActiveFormListeners: (() => void) | null = null;

    constructor(
        private readonly containerEl: HTMLElement,
        value: unknown,
        private readonly context: MetadataWidgetRenderContext,
    ) {
        this.authors = getStructuredAuthors(value);
        containerEl.addClass('yaml-struct-author-widget');
        containerEl.setAttribute('tabindex', '0');
        containerEl.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && (this.addingNew || this.editingIndex !== null)) {
                event.preventDefault();
                event.stopPropagation();
                this.editingIndex = null;
                this.addingNew = false;
                this.renderWidget();
                return;
            }

            if ((event.key === 'Enter' || event.key === ' ') && !this.addingNew && this.editingIndex === null) {
                event.preventDefault();
                this.addingNew = true;
                this.renderWidget();
            }
        });
        this.renderWidget();
    }

    focus(): void {
        this.containerEl.focus();
    }

    private commit(): void {
        this.clearActiveFormListeners();
        this.editingIndex = null;
        this.addingNew = false;
        this.renderWidget();
        this.context.onChange([...this.authors]);
    }

    private clearActiveFormListeners(): void {
        this.cleanupActiveFormListeners?.();
        this.cleanupActiveFormListeners = null;
    }

    private registerActiveFormListeners(onDismiss: () => void): void {
        this.clearActiveFormListeners();

        const handlePointerDown = (event: Event): void => {
            const target = event.target;
            if (target instanceof Node && this.containerEl.contains(target)) {
                return;
            }
            onDismiss();
        };

        const handleFocusIn = (event: Event): void => {
            const target = event.target;
            if (target instanceof Node && this.containerEl.contains(target)) {
                return;
            }
            onDismiss();
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('focusin', handleFocusIn, true);
        this.cleanupActiveFormListeners = () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('focusin', handleFocusIn, true);
        };
    }

    private renderWidget(): void {
        this.clearActiveFormListeners();
        this.containerEl.empty();

        this.authors.forEach((author, index) => {
            if (this.editingIndex === index) {
                this.renderInlineForm(this.containerEl, author, index);
            } else {
                this.renderChip(this.containerEl, author, index);
            }
        });

        if (this.addingNew) {
            this.renderAddForm(this.containerEl);
        } else {
            const addButton = this.containerEl.createEl('button', {
                cls: 'yaml-struct-add-chip-btn clickable-icon',
                attr: { type: 'button', 'aria-label': 'Add author' },
            });
            setIcon(addButton, 'plus');
            addButton.addEventListener('click', () => {
                this.editingIndex = null;
                this.addingNew = true;
                this.renderWidget();
            });
        }
    }

    private renderChip(container: HTMLElement, author: CslName, index: number): void {
        const chip = container.createSpan({ cls: 'yaml-struct-author-chip' });

        const label = chip.createSpan({
            cls: 'yaml-struct-chip-label',
            text: formatCslName(author) || '?',
        });
        label.addEventListener('click', () => {
            this.editingIndex = index;
            this.addingNew = false;
            this.renderWidget();
        });

        const removeButton = chip.createEl('button', {
            cls: 'yaml-struct-chip-remove',
            attr: { type: 'button', 'aria-label': 'Remove' },
        });
        removeButton.setText('×');
        removeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.authors.splice(index, 1);
            this.editingIndex = null;
            this.commit();
        });
    }

    private renderInlineForm(container: HTMLElement, author: CslName, index: number): void {
        this.renderForm(container, author, (given, family) => {
            if (given || family) {
                // Preserve all existing CslName fields; only overwrite given/family
                this.authors[index] = { ...this.authors[index], given: given || undefined, family: family || undefined };
            } else {
                this.authors.splice(index, 1);
            }
            this.editingIndex = null;
            this.commit();
        }, () => {
            this.editingIndex = null;
            this.renderWidget();
        });
    }

    private renderAddForm(container: HTMLElement): void {
        this.renderForm(container, null, (given, family) => {
            if (given || family) {
                this.authors.push({ ...(given && { given }), ...(family && { family }) });
                this.addingNew = false;
                this.commit();
            } else {
                this.addingNew = false;
                this.renderWidget();
            }
        }, () => {
            this.addingNew = false;
            this.renderWidget();
        });
    }

    private renderForm(
        container: HTMLElement,
        initial: CslName | null,
        onConfirm: (given: string, family: string) => void,
        onCancel: () => void,
    ): void {
        const form = container.createSpan({ cls: 'yaml-struct-inline-form' });

        const givenInput = form.createEl('input', {
            type: 'text',
            attr: { placeholder: 'Given' },
        });
        givenInput.value = initial?.given ?? '';

        const familyInput = form.createEl('input', {
            type: 'text',
            attr: { placeholder: 'Family' },
        });
        familyInput.value = initial?.family ?? '';

        let dismissed = false;
        const hasValues = (): boolean => Boolean(givenInput.value.trim() || familyInput.value.trim());
        const confirm = (): void => {
            if (dismissed) {
                return;
            }
            dismissed = true;
            onConfirm(givenInput.value.trim(), familyInput.value.trim());
        };

        const cancel = (): void => {
            if (dismissed) {
                return;
            }
            dismissed = true;
            onCancel();
        };

        const dismissIfFocusLeftForm = (): void => {
            window.setTimeout(() => {
                if (dismissed) {
                    return;
                }

                const activeElement = document.activeElement;
                if (activeElement instanceof Node && form.contains(activeElement)) {
                    return;
                }

                if (hasValues()) {
                    confirm();
                } else {
                    cancel();
                }
            }, 0);
        };

        this.registerActiveFormListeners(() => {
            if (hasValues()) {
                confirm();
            } else {
                cancel();
            }
        });

        givenInput.addEventListener('blur', dismissIfFocusLeftForm);
        familyInput.addEventListener('blur', dismissIfFocusLeftForm);

        givenInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                familyInput.focus();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancel();
            }
        });

        familyInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                confirm();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancel();
            }
        });

        const confirmButton = form.createEl('button', {
            cls: 'yaml-struct-form-confirm',
            attr: { type: 'button', 'aria-label': 'Confirm' },
        });
        confirmButton.setText('✓');
        confirmButton.addEventListener('mousedown', (event) => {
            event.preventDefault();
            confirm();
        });
        confirmButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                confirm();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                cancel();
            }
        });
        confirmButton.addEventListener('blur', dismissIfFocusLeftForm);

        window.setTimeout(() => givenInput.focus(), 0);
    }
}

function createWidget(_plugin: BibliographyPlugin): MetadataTypeWidget {
    return {
        name: () => 'CSL authors',
        type: BIBLIB_AUTHOR_WIDGET_TYPE,
        icon: 'lucide-users',
        validate: isAuthorValue,
        render: (containerEl, value, context) => new AuthorPropertyWidgetRenderer(containerEl, value, context),
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

    private normalizeField(fieldName: string): string {
        return fieldName.trim().toLowerCase();
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
        const normalizedFieldName = this.normalizeField(fieldName);
        if (!normalizedFieldName) {
            return;
        }

        const metadataTypeManager = this.manager();
        if (!this.originalAssignments.has(normalizedFieldName)) {
            this.originalAssignments.set(normalizedFieldName, metadataTypeManager.assignedWidgets[normalizedFieldName] ?? null);
        }

        metadataTypeManager.assignedWidgets[normalizedFieldName] = {
            name: fieldName.trim() || fieldName,
            widget: BIBLIB_AUTHOR_WIDGET_TYPE,
        };
        metadataTypeManager.trigger('changed', normalizedFieldName);
    }

    private unbindField(fieldName: string): void {
        const normalizedFieldName = this.normalizeField(fieldName);
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
