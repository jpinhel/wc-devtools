import { describe, expect, it } from 'vitest';
import { isSignal, serializeSignals, serializeTasks } from '../lib/lit-labs';

// TC39 signal-polyfill stamps `Symbol("SIGNAL")` on State/Computed instances.
// `@lit-labs/signals` re-exports those, so the brand is the same.
function brandedSignal(value: unknown) {
  const s = { get: () => value, set: () => undefined };
  Object.defineProperty(s, Symbol('SIGNAL'), { value: true });
  return s;
}

function tc39Computed(value: unknown) {
  const s = { get: () => value };
  Object.defineProperty(s, Symbol('SIGNAL'), { value: true });
  return s;
}

class ShapedSignal {
  constructor(public _v: unknown) {}
  get() {
    return this._v;
  }
  set(v: unknown) {
    this._v = v;
  }
}

// `@preact/signals-core` stamps `Symbol.for("preact-signals")` on the prototype
// and reads via `.value`.
const PREACT_BRAND = Symbol.for('preact-signals');
class PreactSignal {
  brand = PREACT_BRAND;
  constructor(public value: unknown) {}
  peek() {
    return this.value;
  }
}

describe('isSignal', () => {
  it('detects brand-symbol signals', () => {
    expect(isSignal(brandedSignal(42))).toBe(true);
  });

  it('rejects un-branded { get, set } shapes (previously matched every Map)', () => {
    expect(isSignal(new ShapedSignal(7))).toBe(false);
  });

  it('detects TC39 Computed-style signals via SIGNAL brand (no .set)', () => {
    expect(isSignal(tc39Computed(123))).toBe(true);
  });

  it('detects preact signals via brand on prototype', () => {
    expect(isSignal(new PreactSignal(42))).toBe(true);
  });

  it('rejects plain functions', () => {
    expect(isSignal(() => 42)).toBe(false);
    expect(isSignal(function plain() {})).toBe(false);
  });

  it('rejects plain objects with no get', () => {
    expect(isSignal({})).toBe(false);
    expect(isSignal({ get: 42 })).toBe(false);
  });

  it('rejects Maps — Lit internals like _$AL/_$changedProperties are Maps', () => {
    expect(isSignal(new Map())).toBe(false);
  });

  it('rejects null + primitives', () => {
    expect(isSignal(null)).toBe(false);
    expect(isSignal(42)).toBe(false);
    expect(isSignal('hello')).toBe(false);
  });
});

describe('serializeSignals', () => {
  it('returns one entry per own signal property', () => {
    const el = document.createElement('div');
    (el as unknown as Record<string, unknown>).counter = brandedSignal(42);
    (el as unknown as Record<string, unknown>).name = brandedSignal('hello');
    const sigs = serializeSignals(el);
    expect(sigs).toHaveLength(2);
    expect(sigs.find((s) => s.label === 'counter')?.value).toBe(42);
    expect(sigs.find((s) => s.label === 'name')?.value).toBe('hello');
  });

  it('returns empty when element has no signal-shaped properties', () => {
    const el = document.createElement('div');
    expect(serializeSignals(el)).toEqual([]);
  });

  it('reads preact signals via .value accessor', () => {
    const el = document.createElement('div');
    (el as unknown as Record<string, unknown>).count = new PreactSignal(99);
    (el as unknown as Record<string, unknown>).label = new PreactSignal('hi');
    const sigs = serializeSignals(el);
    expect(sigs).toHaveLength(2);
    expect(sigs.find((s) => s.label === 'count')?.value).toBe(99);
    expect(sigs.find((s) => s.label === 'label')?.value).toBe('hi');
  });

  it('handles signals that throw on .get()', () => {
    const el = document.createElement('div');
    const broken = brandedSignal(undefined);
    broken.get = () => {
      throw new Error('not initialised');
    };
    (el as unknown as Record<string, unknown>).bad = broken;
    const sigs = serializeSignals(el);
    expect(sigs).toHaveLength(1);
    expect(sigs[0].value).toBe('[unreadable]');
  });
});

class TaskMock {
  constructor(
    public status: number,
    public value?: unknown,
    public error?: unknown,
  ) {}
  run() {
    return Promise.resolve();
  }
}

describe('serializeTasks', () => {
  it('returns one entry per Task-shaped own property', () => {
    const el = document.createElement('div');
    (el as unknown as Record<string, unknown>).fetchUser = new TaskMock(2, { id: 1 });
    (el as unknown as Record<string, unknown>).saveOrder = new TaskMock(1);
    const tasks = serializeTasks(el);
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.label === 'fetchUser')?.status).toBe('complete');
    expect(tasks.find((t) => t.label === 'fetchUser')?.value).toEqual({ id: 1 });
    expect(tasks.find((t) => t.label === 'saveOrder')?.status).toBe('pending');
  });

  it('captures error message when status is error', () => {
    const el = document.createElement('div');
    (el as unknown as Record<string, unknown>).bad = new TaskMock(3, undefined, new Error('boom'));
    const tasks = serializeTasks(el);
    expect(tasks[0].status).toBe('error');
    expect(tasks[0].error).toContain('boom');
  });

  it('returns empty when no Task-shaped properties', () => {
    const el = document.createElement('div');
    expect(serializeTasks(el)).toEqual([]);
  });

  it('rejects objects with status but no run() on proto', () => {
    const el = document.createElement('div');
    (el as unknown as Record<string, unknown>).fake = { status: 1 };
    expect(serializeTasks(el)).toEqual([]);
  });
});
