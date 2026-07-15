import { beforeEach, describe, expect, it } from 'vitest';
import '../../entrypoints/panel/components/wc-prop-value';
import type { WcPropValue } from '../../entrypoints/panel/components/wc-prop-value';
import { cleanup, renderLit } from './helpers';

describe('<wc-prop-value>', () => {
  beforeEach(cleanup);

  it('renders a primitive string with quotes and val-string class', async () => {
    const el = await renderLit<WcPropValue>('wc-prop-value', { value: 'hello' });
    const span = el.querySelector('.pv-prim');
    expect(span?.classList.contains('val-string')).toBe(true);
    expect(span?.textContent).toBe('"hello"');
  });

  it('renders null with val-null class', async () => {
    const el = await renderLit<WcPropValue>('wc-prop-value', { value: null });
    const span = el.querySelector('.pv-prim');
    expect(span?.classList.contains('val-null')).toBe(true);
    expect(span?.textContent).toBe('null');
  });

  it('renders an object with collapsed preview by default', async () => {
    const el = await renderLit<WcPropValue>('wc-prop-value', { value: { a: 1, b: 'two' } });
    expect(el.querySelector('.pv-obj')).not.toBeNull();
    expect(el.querySelector('.pv-tree')).toBeNull();
    expect(el.querySelector('.pv-preview')?.textContent).toContain('a: 1');
  });

  it('expands children when toggled and recurses', async () => {
    const el = await renderLit<WcPropValue>('wc-prop-value', { value: { nested: { x: 1 } } });
    el.querySelector<HTMLButtonElement>('.pv-toggle')?.click();
    await el.updateComplete;
    expect(el.querySelector('.pv-tree')).not.toBeNull();
    expect(el.querySelector('wc-prop-value')).not.toBeNull();
  });

  it('clamps depth at MAX_DEPTH (5) with a placeholder row', async () => {
    const deep = { a: { a: { a: { a: { a: { a: 'leaf' } } } } } };
    const el = await renderLit<WcPropValue>('wc-prop-value', { value: deep, depth: 5 });
    el.querySelector<HTMLButtonElement>('.pv-toggle')?.click();
    await el.updateComplete;
    expect(el.querySelector('.pv-depth-limit')).not.toBeNull();
  });
});
