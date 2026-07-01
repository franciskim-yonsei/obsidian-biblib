import { Setting } from 'obsidian';
import BibliographyPlugin from '../../../main';
import {
    FavoriteLanguage,
    DEFAULT_FRONTMATTER_FIELD_ORDER,
    normalizeFrontmatterFieldOrder
} from '../../types/settings';

/**
 * Renders frontmatter organization section
 */
export function renderFrontmatterOrganizationSection(
    containerEl: HTMLElement,
    plugin: BibliographyPlugin,
    refreshDisplay: () => void
): void {
    plugin.settings.frontmatterFieldOrder = normalizeFrontmatterFieldOrder(plugin.settings.frontmatterFieldOrder);

    new Setting(containerEl)
        .setName('Frontmatter organization')
        .setHeading();

    containerEl.createEl('p', {
        text: 'One field per line, in the order you want them in the YAML frontmatter. Fields not listed are appended afterwards in their existing order.',
        cls: 'setting-item-description'
    });

    const textarea = containerEl.createEl('textarea', {
        attr: {
            rows: '14',
            spellcheck: 'false',
            placeholder: 'id\ntitle\nauthor\n...'
        }
    });
    textarea.style.cssText = 'width: 100%; font-family: var(--font-monospace); font-size: var(--font-smaller); resize: vertical; padding: 8px; box-sizing: border-box; margin-bottom: 8px; display: block;';
    textarea.value = plugin.settings.frontmatterFieldOrder.join('\n');

    textarea.addEventListener('blur', async () => {
        const lines = textarea.value
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0);
        plugin.settings.frontmatterFieldOrder = normalizeFrontmatterFieldOrder(lines);
        textarea.value = plugin.settings.frontmatterFieldOrder.join('\n');
        await plugin.saveSettings();
    });

    new Setting(containerEl)
        .addButton(button => button
            .setButtonText('Reset to defaults')
            .onClick(async () => {
                plugin.settings.frontmatterFieldOrder = [...DEFAULT_FRONTMATTER_FIELD_ORDER];
                textarea.value = plugin.settings.frontmatterFieldOrder.join('\n');
                await plugin.saveSettings();
            })
        );
}

/**
 * Renders favorite languages section
 */
export function renderFavoriteLanguagesSection(
    containerEl: HTMLElement,
    plugin: BibliographyPlugin,
    refreshDisplay: () => void
): void {
    new Setting(containerEl).setName('Favorite languages').setHeading();

    containerEl.createEl('p', {
        text: 'Configure frequently used languages to appear at the top of language dropdowns in modals.',
        cls: 'setting-item-description'
    });

    const favLangsContainer = containerEl.createDiv({ cls: 'favorite-languages-container' });

    if (plugin.settings.favoriteLanguages) {
        plugin.settings.favoriteLanguages.forEach((lang, index) => {
            addFavoriteLanguageRow(lang, index, favLangsContainer, plugin, refreshDisplay);
        });
    }

    new Setting(containerEl)
        .setName('Add favorite language')
        .addButton(button => button
            .setButtonText('Add language')
            .onClick(async () => {
                const newLang = {
                    code: '',
                    name: ''
                };

                if (!plugin.settings.favoriteLanguages) {
                    plugin.settings.favoriteLanguages = [];
                }
                plugin.settings.favoriteLanguages.push(newLang);
                await plugin.saveSettings();

                addFavoriteLanguageRow(newLang, plugin.settings.favoriteLanguages.length - 1, favLangsContainer, plugin, refreshDisplay);
            })
        );
}

/**
 * Adds a favorite language row to the settings
 */
function addFavoriteLanguageRow(
    lang: FavoriteLanguage,
    index: number,
    container: HTMLElement,
    plugin: BibliographyPlugin,
    refreshDisplay: () => void
): void {
    const langEl = container.createDiv({ cls: 'favorite-language-row' });

    new Setting(langEl)
        .setName('')
        .addText(text => text
            .setPlaceholder('Language code (e.g., en, nb, fi)')
            .setValue(lang.code)
            .onChange(async (value) => {
                plugin.settings.favoriteLanguages[index].code = value.trim();
                await plugin.saveSettings();
            }))
        .addText(text => text
            .setPlaceholder('Language name (e.g., English, Norwegian)')
            .setValue(lang.name)
            .onChange(async (value) => {
                plugin.settings.favoriteLanguages[index].name = value.trim();
                await plugin.saveSettings();
            }))
        .addButton(button => button
            .setIcon('up-chevron-glyph')
            .setTooltip('Move up')
            .setDisabled(index === 0)
            .onClick(async () => {
                if (index > 0) {
                    const langs = plugin.settings.favoriteLanguages;
                    [langs[index - 1], langs[index]] = [langs[index], langs[index - 1]];
                    await plugin.saveSettings();
                    refreshDisplay();
                }
            }))
        .addButton(button => button
            .setIcon('down-chevron-glyph')
            .setTooltip('Move down')
            .setDisabled(index === plugin.settings.favoriteLanguages.length - 1)
            .onClick(async () => {
                if (index < plugin.settings.favoriteLanguages.length - 1) {
                    const langs = plugin.settings.favoriteLanguages;
                    [langs[index], langs[index + 1]] = [langs[index + 1], langs[index]];
                    await plugin.saveSettings();
                    refreshDisplay();
                }
            }))
        .addButton(button => button
            .setIcon('trash')
            .setTooltip('Remove')
            .onClick(async () => {
                plugin.settings.favoriteLanguages.splice(index, 1);
                await plugin.saveSettings();
                langEl.remove();
            }));
}
