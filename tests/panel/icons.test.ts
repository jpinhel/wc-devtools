import { describe, expect, it } from 'vitest';
import { icon } from '../../entrypoints/panel/icons';

describe('icon()', () => {
  it('returns an svg string for a known icon', () => {
    const html = icon('chevron-right', { size: 10 });
    expect(html).toMatch(/^<svg[\s\S]*<\/svg>$/);
    expect(html).toContain('width="10"');
    expect(html).toContain('height="10"');
  });

  it('throws on an unknown icon name', () => {
    expect(() => icon('not-a-real-icon' as never)).toThrow();
  });
});
