import { Setting } from 'obsidian';
import BibliographyPlugin from '../../../main';

/**
 * Renders edit modal settings section
 */
export function renderEditModalSettingsSection(containerEl: HTMLElement, plugin: BibliographyPlugin): void {
    new Setting(containerEl).setName('Edit literature note settings').setHeading();

    containerEl.createEl('p', {
        text: 'Configure default behavior when editing existing literature notes.',
        cls: 'setting-item-description'
    });

    new Setting(containerEl)
        .setName('Regenerate citekey by default')
        .setDesc('When editing a note, regenerate the citekey if relevant data changes')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.editRegenerateCitekeyDefault)
            .onChange(async (value) => {
                plugin.settings.editRegenerateCitekeyDefault = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Regenerate note body by default')
        .setDesc('When editing a note, regenerate the note body from the header template')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.editRegenerateBodyDefault)
            .onChange(async (value) => {
                plugin.settings.editRegenerateBodyDefault = value;
                await plugin.saveSettings();
            }));

    new Setting(containerEl)
        .setName('Rename file on citekey change')
        .setDesc('When the citekey changes during edit, rename the file to match')
        .addToggle(toggle => toggle
            .setValue(plugin.settings.editRenameFileOnCitekeyChange)
            .onChange(async (value) => {
                plugin.settings.editRenameFileOnCitekeyChange = value;
                await plugin.saveSettings();
            }));
}
