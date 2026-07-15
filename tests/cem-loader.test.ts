import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCem } from '../lib/cem-loader';

const fixturePath = resolve(__dirname, 'fixtures/cem-sample.json');

describe('parseCem', () => {
  it('indexes elements by tagName', () => {
    const raw = readFileSync(fixturePath, 'utf8');
    const idx = parseCem(JSON.parse(raw));
    expect(idx.has('demo-card')).toBe(true);
    expect(idx.get('demo-card')?.description).toMatch(/card with a header slot/);
  });

  it('extracts attributes + events + slots + parts + css props', () => {
    const raw = readFileSync(fixturePath, 'utf8');
    const card = parseCem(JSON.parse(raw)).get('demo-card');
    expect(card?.attributes?.[0].name).toBe('title');
    expect(card?.events?.[0].name).toBe('demo-click');
    expect(card?.slots?.[1].name).toBe('footer');
    expect(card?.cssParts?.[0].name).toBe('header');
    expect(card?.cssProperties?.[0].default).toBe('white');
  });

  it('returns empty map on null or non-object input', () => {
    expect(parseCem(null).size).toBe(0);
    expect(parseCem(42).size).toBe(0);
    expect(parseCem('string').size).toBe(0);
  });

  it('returns empty map when modules is missing or wrong shape', () => {
    expect(parseCem({}).size).toBe(0);
    expect(parseCem({ modules: 'not-an-array' }).size).toBe(0);
  });

  it('skips declarations that are not class kind or have no tagName', () => {
    const raw = {
      modules: [
        {
          declarations: [
            { kind: 'function', name: 'foo' },
            { kind: 'class', name: 'NoTag' },
            { kind: 'class', name: 'Has', tagName: 'has-tag' },
          ],
        },
      ],
    };
    const idx = parseCem(raw);
    expect(idx.size).toBe(1);
    expect(idx.has('has-tag')).toBe(true);
  });
});
