import { Modal, type App } from 'obsidian';
import type { CslName } from '../../types/citation';
import { NameParser } from '../../utils/name-parser';

const CSL_TEXT_FIELDS = [
    'family',
    'given',
    'literal',
    'suffix',
    'non-dropping-particle',
    'dropping-particle',
] as const;

const CSL_BOOLEAN_FIELDS = [
    'comma-suffix',
    'static-ordering',
    'parse-names',
] as const;

type CslTextField = typeof CSL_TEXT_FIELDS[number];
type CslBooleanField = typeof CSL_BOOLEAN_FIELDS[number];

interface StructuredAuthorEditorModalOptions {
    fileName: string;
    authorField: string;
    initialAuthors: CslName[];
}

export interface StructuredAuthorEditorResult {
    saved: boolean;
    authors: CslName[];
}

function createEmptyAuthor(): CslName {
    return {};
}

function cloneAuthor(author: CslName): CslName {
    return { ...author };
}

export class StructuredAuthorEditorModal extends Modal {
    private readonly authors: CslName[];
    private resolvePromise?: (result: StructuredAuthorEditorResult) => void;
    private didSubmit = false;

    constructor(app: App, private readonly options: StructuredAuthorEditorModalOptions) {
        super(app);
        this.authors = options.initialAuthors.length > 0
            ? options.initialAuthors.map(author => cloneAuthor(author))
            : [createEmptyAuthor()];
    }

    openAndGetResult(): Promise<StructuredAuthorEditorResult> {
        return new Promise(resolve => {
            this.resolvePromise = resolve;
            this.open();
        });
    }

    onOpen(): void {
        this.render();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.didSubmit) {
            this.resolvePromise?.({ saved: false, authors: [] });
        }
    }

    private render(): void {
        this.contentEl.empty();

        const wrapper = this.contentEl.createDiv({ cls: 'yaml-struct-modal yaml-struct-author-modal' });
        wrapper.createEl('h2', { text: `Edit authors for ${this.options.fileName}` });
        wrapper.createEl('p', {
            text: `This edits the structured "${this.options.authorField}" field directly in frontmatter.`,
            cls: 'yaml-struct-help',
        });

        const list = wrapper.createDiv({ cls: 'yaml-struct-author-list' });
        this.authors.forEach((author, index) => this.renderAuthorCard(list, author, index));

        const addButton = wrapper.createEl('button', { text: 'Add author' });
        addButton.addEventListener('click', () => {
            this.authors.push(createEmptyAuthor());
            this.render();
        });

        const actions = wrapper.createDiv({ cls: 'yaml-struct-modal-actions' });
        const cancelButton = actions.createEl('button', { text: 'Cancel' });
        cancelButton.addEventListener('click', () => this.close());

        const saveButton = actions.createEl('button', { text: 'Save authors', cls: 'mod-cta' });
        saveButton.addEventListener('click', () => this.submit());
    }

    private renderAuthorCard(container: HTMLElement, author: CslName, index: number): void {
        const card = container.createDiv({ cls: 'yaml-struct-author-card' });
        const header = card.createDiv({ cls: 'yaml-struct-author-header' });
        header.createEl('h3', { text: `Author ${index + 1}` });

        const headerActions = header.createDiv({ cls: 'yaml-struct-author-header-actions' });
        const upButton = headerActions.createEl('button', { text: '↑' });
        upButton.disabled = index === 0;
        upButton.addEventListener('click', () => this.moveAuthor(index, index - 1));

        const downButton = headerActions.createEl('button', { text: '↓' });
        downButton.disabled = index === this.authors.length - 1;
        downButton.addEventListener('click', () => this.moveAuthor(index, index + 1));

        const removeButton = headerActions.createEl('button', { text: 'Remove' });
        removeButton.addEventListener('click', () => {
            this.authors.splice(index, 1);
            if (this.authors.length === 0) {
                this.authors.push(createEmptyAuthor());
            }
            this.render();
        });

        const grid = card.createDiv({ cls: 'yaml-struct-author-grid' });
        for (const field of CSL_TEXT_FIELDS) {
            this.renderTextField(grid, author, field);
        }

        const flags = card.createDiv({ cls: 'yaml-struct-checkbox-grid' });
        for (const field of CSL_BOOLEAN_FIELDS) {
            this.renderBooleanField(flags, author, field);
        }
    }

    private renderTextField(container: HTMLElement, author: CslName, fieldName: CslTextField): void {
        const field = container.createDiv({ cls: 'yaml-struct-field' });
        field.createEl('label', { text: fieldName });
        const input = field.createEl('input', { type: 'text' });
        input.value = author[fieldName] ?? '';
        input.addEventListener('input', () => {
            const value = input.value.trim();
            if (value) {
                author[fieldName] = value;
            } else {
                delete author[fieldName];
            }
        });
    }

    private renderBooleanField(container: HTMLElement, author: CslName, fieldName: CslBooleanField): void {
        const field = container.createDiv({ cls: 'yaml-struct-checkbox' });
        const input = field.createEl('input', { type: 'checkbox' });
        input.checked = author[fieldName] ?? false;
        input.addEventListener('change', () => {
            if (input.checked) {
                author[fieldName] = true;
            } else {
                delete author[fieldName];
            }
        });
        field.createEl('label', { text: fieldName });
    }

    private moveAuthor(from: number, to: number): void {
        if (to < 0 || to >= this.authors.length) {
            return;
        }

        const [entry] = this.authors.splice(from, 1);
        if (!entry) {
            return;
        }

        this.authors.splice(to, 0, entry);
        this.render();
    }

    private submit(): void {
        const normalizedAuthors = NameParser.toCslNames(this.authors);
        this.didSubmit = true;
        this.resolvePromise?.({ saved: true, authors: normalizedAuthors });
        this.close();
    }
}
