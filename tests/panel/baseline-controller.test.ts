import { ReactiveElement } from 'lit';
import { describe, expect, it } from 'vitest';
import { BaselineController } from '../../entrypoints/panel/controllers/baseline-controller';
import type { WCNode } from '../../types/wc';

class TestHost extends ReactiveElement {}
customElements.define('test-host-baseline', TestHost);

const node = (id: string, props: Record<string, unknown>): WCNode =>
  ({
    id,
    tagName: 't',
    framework: 'vanilla',
    attributes: {},
    properties: props,
    methods: [],
    children: [],
  }) as unknown as WCNode;

describe('BaselineController', () => {
  it('records the first snapshot of every node it sees', () => {
    const host = new TestHost();
    const ctrl = new BaselineController(host);
    ctrl.observe([node('a', { foo: 1 })]);
    expect(ctrl.baselines.get('a')?.properties).toEqual({ foo: 1 });
  });

  it('does not overwrite an existing baseline on subsequent updates', () => {
    const host = new TestHost();
    const ctrl = new BaselineController(host);
    ctrl.observe([node('a', { foo: 1 })]);
    ctrl.observe([node('a', { foo: 99 })]);
    expect(ctrl.baselines.get('a')?.properties.foo).toBe(1);
  });

  it('drops baselines for ids that disappear from the tree', () => {
    const host = new TestHost();
    const ctrl = new BaselineController(host);
    ctrl.observe([node('a', { foo: 1 }), node('b', { bar: 2 })]);
    ctrl.observe([node('a', { foo: 1 })]);
    expect(ctrl.baselines.has('b')).toBe(false);
  });

  it('reset() clears every baseline', () => {
    const host = new TestHost();
    const ctrl = new BaselineController(host);
    ctrl.observe([node('a', { foo: 1 })]);
    ctrl.reset();
    expect(ctrl.baselines.size).toBe(0);
  });
});
