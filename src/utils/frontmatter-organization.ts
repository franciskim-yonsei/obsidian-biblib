import { normalizeFrontmatterFieldOrder } from '../types/settings';

/**
 * Reorders frontmatter keys according to user preferences while preserving the
 * original relative order of fields that are not explicitly listed.
 */
export function organizeFrontmatter(
  frontmatter: Record<string, any>,
  preferredOrder: unknown
): Record<string, any> {
  const normalizedOrder = normalizeFrontmatterFieldOrder(preferredOrder);
  const organized: Record<string, any> = {};

  for (const key of normalizedOrder) {
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      organized[key] = frontmatter[key];
    }
  }

  for (const key of Object.keys(frontmatter)) {
    if (!Object.prototype.hasOwnProperty.call(organized, key)) {
      organized[key] = frontmatter[key];
    }
  }

  return organized;
}
