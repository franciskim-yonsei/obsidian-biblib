import { CslName, Contributor } from '../types/citation';

/**
 * Normalize contributor/name data between Obsidian-friendly frontmatter storage
 * and CSL-compatible structures used by exports and the editing UI.
 */
export class NameParser {
    /**
     * Convert any supported name input into a list of storage-friendly strings.
     */
    static toStorageStrings(input: unknown): string[] {
        return this.toCslNames(input)
            .map(name => this.formatName(name))
            .filter(Boolean);
    }

    /**
     * Convert any supported name input into CSL name objects.
     */
    static toCslNames(input: unknown): CslName[] {
        if (input == null || input === '') {
            return [];
        }

        const values = Array.isArray(input) ? input : [input];
        return values
            .map(value => this.normalizeName(value))
            .filter((value): value is CslName => value !== undefined);
    }

    /**
     * Convert any supported name input into role-aware contributors.
     */
    static toContributors(input: unknown, role: string): Contributor[] {
        return this.toCslNames(input).map(name => ({
            role,
            ...name
        }));
    }

    private static normalizeName(value: unknown): CslName | undefined {
        if (typeof value === 'string') {
            const literal = value.trim();
            return literal ? { literal } : undefined;
        }

        if (typeof value !== 'object' || value === null) {
            return undefined;
        }

        const name = value as Record<string, unknown>;
        const family = typeof name.family === 'string' ? name.family.trim() : '';
        const given = typeof name.given === 'string' ? name.given.trim() : '';
        const literal = typeof name.literal === 'string' ? name.literal.trim() : '';
        const droppingParticle = typeof name['dropping-particle'] === 'string'
            ? name['dropping-particle'].trim()
            : '';
        const nonDroppingParticle = typeof name['non-dropping-particle'] === 'string'
            ? name['non-dropping-particle'].trim()
            : '';
        const suffix = typeof name.suffix === 'string' ? name.suffix.trim() : '';

        if (!family && !given && !literal) {
            const fullName = typeof name.name === 'string' ? name.name.trim() : '';
            return fullName ? { literal: fullName } : undefined;
        }

        const normalized: CslName = {};
        if (family) normalized.family = family;
        if (given) normalized.given = given;
        if (literal) normalized.literal = literal;
        if (droppingParticle) normalized['dropping-particle'] = droppingParticle;
        if (nonDroppingParticle) normalized['non-dropping-particle'] = nonDroppingParticle;
        if (suffix) normalized.suffix = suffix;

        return normalized;
    }

    private static formatName(name: CslName): string {
        if (name.literal?.trim()) {
            return name.literal.trim();
        }

        const parts = [
            name.given,
            name['dropping-particle'],
            name['non-dropping-particle'],
            name.family,
            name.suffix
        ]
            .map(part => part?.trim())
            .filter((part): part is string => Boolean(part));

        return parts.join(' ').replace(/\s+/g, ' ').trim();
    }
}
