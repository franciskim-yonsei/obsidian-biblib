import { hasLiteratureNoteTag, matchesLiteratureNoteTagHierarchy, parseLiteratureNoteTags } from '../settings';

describe('parseLiteratureNoteTags', () => {
	describe('single tag handling', () => {
		it('should return single tag as array', () => {
			expect(parseLiteratureNoteTags('literature_note')).toEqual(['literature_note']);
		});

		it('should trim whitespace from single tag', () => {
			expect(parseLiteratureNoteTags('  literature_note  ')).toEqual(['literature_note']);
		});
	});

	describe('comma-separated tags', () => {
		it('should split comma-separated tags', () => {
			expect(parseLiteratureNoteTags('literature_note,excalidraw')).toEqual(['literature_note', 'excalidraw']);
		});

		it('should handle commas with spaces', () => {
			expect(parseLiteratureNoteTags('literature_note, excalidraw')).toEqual(['literature_note', 'excalidraw']);
		});

		it('should handle multiple commas with varying spaces', () => {
			expect(parseLiteratureNoteTags('tag1,  tag2 ,tag3')).toEqual(['tag1', 'tag2', 'tag3']);
		});
	});

	describe('space-separated tags', () => {
		it('should split space-separated tags', () => {
			expect(parseLiteratureNoteTags('literature_note excalidraw')).toEqual(['literature_note', 'excalidraw']);
		});

		it('should handle multiple spaces between tags', () => {
			expect(parseLiteratureNoteTags('tag1    tag2   tag3')).toEqual(['tag1', 'tag2', 'tag3']);
		});
	});

	describe('mixed separators', () => {
		it('should handle mix of commas and spaces', () => {
			expect(parseLiteratureNoteTags('tag1, tag2 tag3')).toEqual(['tag1', 'tag2', 'tag3']);
		});
	});

	describe('empty and edge cases', () => {
		it('should return empty array for empty string', () => {
			expect(parseLiteratureNoteTags('')).toEqual([]);
		});

		it('should return empty array for whitespace only', () => {
			expect(parseLiteratureNoteTags('   ')).toEqual([]);
		});

		it('should filter out empty tags from multiple separators', () => {
			expect(parseLiteratureNoteTags('tag1,,tag2')).toEqual(['tag1', 'tag2']);
		});

		it('should handle tabs as separators', () => {
			expect(parseLiteratureNoteTags('tag1\ttag2')).toEqual(['tag1', 'tag2']);
		});
	});
});

describe('matchesLiteratureNoteTagHierarchy', () => {
	it('matches the exact configured tag', () => {
		expect(matchesLiteratureNoteTagHierarchy('literature_note', 'literature_note')).toBe(true);
	});

	it('matches hierarchical subtags', () => {
		expect(matchesLiteratureNoteTagHierarchy('literature_note/reading', 'literature_note')).toBe(true);
		expect(matchesLiteratureNoteTagHierarchy('literature_note/reading/deep', 'literature_note')).toBe(true);
	});

	it('does not match unrelated tags with the same prefix', () => {
		expect(matchesLiteratureNoteTagHierarchy('literature_notes', 'literature_note')).toBe(false);
		expect(matchesLiteratureNoteTagHierarchy('literature_note-ish/subtag', 'literature_note')).toBe(false);
	});

	it('normalizes leading hash characters', () => {
		expect(matchesLiteratureNoteTagHierarchy('#literature_note/subtag', 'literature_note')).toBe(true);
		expect(matchesLiteratureNoteTagHierarchy('literature_note/subtag', '#literature_note')).toBe(true);
	});
});

describe('hasLiteratureNoteTag', () => {
	it('returns true for exact tag matches', () => {
		expect(hasLiteratureNoteTag(['literature_note'], 'literature_note')).toBe(true);
	});

	it('returns true for hierarchical tag matches', () => {
		expect(hasLiteratureNoteTag(['literature_note/reading'], 'literature_note')).toBe(true);
	});

	it('supports multiple configured tags', () => {
		expect(hasLiteratureNoteTag(['project/reference'], 'literature_note, project')).toBe(true);
	});

	it('returns false when no configured tag matches', () => {
		expect(hasLiteratureNoteTag(['project/reference'], 'literature_note')).toBe(false);
	});

	it('supports single-string frontmatter tags', () => {
		expect(hasLiteratureNoteTag('literature_note/subtag', 'literature_note')).toBe(true);
	});
});
