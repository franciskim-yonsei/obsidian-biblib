import { organizeFrontmatter } from '../frontmatter-organization';

describe('organizeFrontmatter', () => {
  it('places configured fields first and preserves unspecified field order', () => {
    const organized = organizeFrontmatter(
      {
        title: 'Example Title',
        customA: 'A',
        id: 'example2026',
        customB: 'B',
        tags: ['literature_note']
      },
      ['id', 'title', 'tags']
    );

    expect(Object.keys(organized)).toEqual(['id', 'title', 'tags', 'customA', 'customB']);
  });

  it('ignores blank and duplicate entries in the preferred order', () => {
    const organized = organizeFrontmatter(
      {
        title: 'Example Title',
        id: 'example2026',
        tags: ['literature_note']
      },
      ['title', ' ', 'title', 'id']
    );

    expect(Object.keys(organized)).toEqual(['title', 'id', 'tags']);
  });
});
