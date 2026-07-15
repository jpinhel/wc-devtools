import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../entrypoints/panel/components/tabs/wc-tab-events';
import type { WcTabEvents } from '../../entrypoints/panel/components/tabs/wc-tab-events';
import type { EventLogEntry, WCNode } from '../../types/wc';
import { cleanup, renderLit } from './helpers';

const mkNode = (id: string): WCNode =>
  ({
    id,
    tagName: 't',
    framework: 'lit',
    attributes: {},
    properties: {},
    methods: [],
    children: [],
  }) as unknown as WCNode;

const ev = (nodeId: string, type: string, ts: number): EventLogEntry => ({
  nodeId,
  eventType: type,
  detail: null,
  bubbles: false,
  timestamp: ts,
});

describe('<wc-tab-events>', () => {
  beforeEach(cleanup);

  it('emits dispatch-event with parsed detail from the dispatch form', async () => {
    const el = await renderLit<WcTabEvents>('wc-tab-events', {
      node: mkNode('1'),
      eventLog: [],
    });
    const handler = vi.fn();
    el.addEventListener('dispatch-event', handler as EventListener);

    const typeInput = el.querySelector<HTMLInputElement>('.event-dispatch-input--type');
    const detailInput = el.querySelector<HTMLInputElement>('.event-dispatch-input--detail');
    if (!typeInput || !detailInput) throw new Error('dispatch form missing');
    typeInput.value = 'my-event';
    typeInput.dispatchEvent(new Event('input'));
    detailInput.value = '{"value": 1}';
    detailInput.dispatchEvent(new Event('input'));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.event-dispatch-btn')?.click();

    expect(handler).toHaveBeenCalledOnce();
    const evt = handler.mock.calls[0][0] as CustomEvent<{
      nodeId: string;
      eventType: string;
      detail: unknown;
    }>;
    expect(evt.detail).toEqual({ nodeId: '1', eventType: 'my-event', detail: { value: 1 } });
  });

  it('shows an error and does not emit when detail is invalid JSON', async () => {
    const el = await renderLit<WcTabEvents>('wc-tab-events', {
      node: mkNode('1'),
      eventLog: [],
    });
    const handler = vi.fn();
    el.addEventListener('dispatch-event', handler as EventListener);

    const typeInput = el.querySelector<HTMLInputElement>('.event-dispatch-input--type');
    const detailInput = el.querySelector<HTMLInputElement>('.event-dispatch-input--detail');
    if (!typeInput || !detailInput) throw new Error('dispatch form missing');
    typeInput.value = 'my-event';
    typeInput.dispatchEvent(new Event('input'));
    detailInput.value = '{broken';
    detailInput.dispatchEvent(new Event('input'));
    await el.updateComplete;
    el.querySelector<HTMLButtonElement>('.event-dispatch-btn')?.click();
    await el.updateComplete;

    expect(handler).not.toHaveBeenCalled();
    expect(el.querySelector('.event-dispatch-error')).not.toBeNull();
  });

  it('shows empty-state when no events for this node', async () => {
    const el = await renderLit<WcTabEvents>('wc-tab-events', {
      node: mkNode('1'),
      eventLog: [],
    });
    expect(el.querySelector('.empty-state')).not.toBeNull();
  });

  it('lists matching events most-recent first', async () => {
    const el = await renderLit<WcTabEvents>('wc-tab-events', {
      node: mkNode('1'),
      eventLog: [ev('1', 'click', 1), ev('1', 'focus', 2), ev('2', 'blur', 3)],
    });
    const rows = el.querySelectorAll('.event-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('focus');
    expect(rows[1].textContent).toContain('click');
  });

  it('emits clear-events when the clear button is clicked', async () => {
    const el = await renderLit<WcTabEvents>('wc-tab-events', {
      node: mkNode('1'),
      eventLog: [ev('1', 'click', 1)],
    });
    const handler = vi.fn();
    el.addEventListener('clear-events', handler as EventListener);
    el.querySelector<HTMLButtonElement>('.clear-btn')?.click();
    expect(handler).toHaveBeenCalledOnce();
  });
});
