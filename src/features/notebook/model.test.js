import { describe, expect, it } from 'vitest';
import { parse, removePhotoReference, serialize } from './model.js';

describe('notebook photo references', () => {
  it('round-trips stable local asset identifiers in the existing source format', () => {
    const source = `![${'a'.repeat(64)}]`;

    expect(serialize(parse(source))).toBe(source);
  });

  it('removes only one matching image block and preserves neighboring content', () => {
    const source = '# Topic\n![same] first copy\nNotes between\n![same] second copy\n![other]';

    expect(removePhotoReference(source, 'same')).toEqual({
      text: '# Topic\nNotes between\n![same] second copy\n![other]',
      removed: true,
    });
  });

  it('leaves the source untouched when the image is not present', () => {
    const source = 'Text\n![existing]';

    expect(removePhotoReference(source, 'missing')).toEqual({ text: source, removed: false });
  });
});
