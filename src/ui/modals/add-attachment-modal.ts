import { App, ButtonComponent, Modal, Notice, Setting, TFile } from 'obsidian';
import { AttachmentManagerService } from '../../services/attachment-manager-service';
import { AttachmentData, AttachmentType } from '../../types/citation';

export class AddAttachmentModal extends Modal {
    private aliasInput: HTMLInputElement;
    private urlInput: HTMLInputElement;
    private isProcessing = false;

    constructor(
        app: App,
        private file: TFile,
        private citekey: string,
        private attachmentManager: AttachmentManagerService
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('bibliography-modal');
        contentEl.createEl('h2', { text: 'Add attachment to current literature note' });

        new Setting(contentEl)
            .setName('Attachment alias')
            .setDesc('Optional display name for the frontmatter link, e.g. SI')
            .addText(text => {
                this.aliasInput = text.inputEl;
                text.setPlaceholder('e.g., SI');
            });

        new Setting(contentEl)
            .setName('Download URL')
            .setDesc('Paste a URL to download and store, or leave blank and import a local file')
            .addText(text => {
                this.urlInput = text.inputEl;
                this.urlInput.type = 'url';
                this.urlInput.addClass('bibliography-input-full');
                text.setPlaceholder('https://example.org/file.pdf');
            });

        const buttonContainer = contentEl.createDiv({ cls: 'bibliography-form-buttons' });

        new ButtonComponent(buttonContainer)
            .setButtonText('Import local file')
            .onClick(() => this.importLocalFile());

        new ButtonComponent(buttonContainer)
            .setButtonText('Download URL')
            .setCta()
            .onClick(() => this.downloadUrl());

        new ButtonComponent(buttonContainer)
            .setButtonText('Cancel')
            .onClick(() => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private getAlias(): string | undefined {
        return this.aliasInput?.value.trim() || undefined;
    }

    private importLocalFile(): void {
        if (this.isProcessing) return;

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '*/*';
        input.onchange = () => {
            const selected = input.files?.[0];
            if (!selected) return;

            void this.addAttachment({
                type: AttachmentType.IMPORT,
                file: selected,
                filename: selected.name,
                alias: this.getAlias()
            });
        };
        input.click();
    }

    private downloadUrl(): void {
        if (this.isProcessing) return;

        const sourceUrl = this.urlInput?.value.trim();
        if (!sourceUrl) {
            new Notice('Enter a URL to download, or use Import local file.');
            return;
        }

        void this.addAttachment({
            type: AttachmentType.DOWNLOAD,
            url: sourceUrl,
            alias: this.getAlias()
        });
    }

    private async addAttachment(attachment: AttachmentData): Promise<void> {
        this.isProcessing = true;
        try {
            const importedPath = await this.attachmentManager.importAttachment(attachment, this.citekey);
            if (!importedPath) return;

            const linkAlias = attachment.alias || this.defaultAttachmentAlias(importedPath);
            const formattedLink = `[[${importedPath}|${linkAlias}]]`;

            await this.app.fileManager.processFrontMatter(this.file, (frontmatter) => {
                const existing = frontmatter.attachment;
                if (Array.isArray(existing)) {
                    if (!existing.includes(formattedLink)) existing.push(formattedLink);
                } else if (typeof existing === 'string' && existing.trim()) {
                    frontmatter.attachment = existing === formattedLink ? [existing] : [existing, formattedLink];
                } else {
                    frontmatter.attachment = [formattedLink];
                }
            });

            new Notice(`Attachment added to ${this.file.basename}`);
            this.close();
        } catch (error) {
            console.error('Error adding attachment to current note:', error);
            new Notice('Error adding attachment. Check console.');
        } finally {
            this.isProcessing = false;
        }
    }

    private defaultAttachmentAlias(path: string): string {
        if (path.endsWith('.pdf')) return 'PDF';
        if (path.endsWith('.epub')) return 'EPUB';
        return path.split('.').pop()?.toUpperCase() || 'FILE';
    }
}
