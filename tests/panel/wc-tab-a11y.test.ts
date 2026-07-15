import { beforeEach, describe, expect, it } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-a11y';
import type { WcTabA11y } from '../../entrypoints/panel/components/tabs/wc-tab-a11y';
import type { WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const node = (ariaRefs: WCNode['ariaRefs']): WCNode =>
  ({
    id: '1',
    tagName: 't',
    framework: 'lit',
    attributes: {},
    properties: {},
    methods: [],
    children: [],
    ariaRefs,
  }) as unknown as WCNode;

describe('<wc-tab-a11y>', () => {
  beforeEach(cleanup);

  it('renders empty-state when there are no aria refs', async () => {
    const el = await renderLit<WcTabA11y>('wc-tab-a11y', { node: node([]) });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders one row per aria ref with ids and a cross-root badge', async () => {
    const el = await renderLit<WcTabA11y>('wc-tab-a11y', {
      node: node([
        { attribute: 'aria-controls', ids: ['x', 'y'], crossRoot: true },
        { attribute: 'aria-labelledby', ids: ['z'], crossRoot: false },
      ]),
    });
    const rows = el.querySelectorAll('.aria-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('.aria-id')).toHaveLength(2);
    expect(rows[0].querySelector('.aria-cross')).not.toBeNull();
    expect(rows[1].querySelector('.aria-cross')).toBeNull();
  });
});
