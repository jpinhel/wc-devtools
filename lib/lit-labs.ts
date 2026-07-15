import type { SerializableValue, WCContextInfo, WCSignalInfo, WCTaskInfo } from '../types/wc';
import { serializeValue } from './inspector-core';

interface GetSignalLike {
  get(): unknown;
}
interface ValueSignalLike {
  value: unknown;
}
type SignalLike = GetSignalLike | ValueSignalLike;

// `signal-polyfill` (TC39 proposal-signals, re-exported by `@lit-labs/signals`)
// stamps `Symbol("SIGNAL")` on State/Computed instances.
const TC39_BRAND_DESCRIPTION = 'SIGNAL';

// `@preact/signals-core` stamps `Symbol.for("preact-signals")` on `Signal.prototype.brand`.
const PREACT_BRAND = Symbol.for('preact-signals');

function isTc39Signal(value: object): value is GetSignalLike {
  const v = value as { get?: unknown };
  if (typeof v.get !== 'function') return false;
  for (const s of Object.getOwnPropertySymbols(value)) {
    if (s.description === TC39_BRAND_DESCRIPTION) return true;
  }
  return false;
}

function isPreactSignal(value: object): value is ValueSignalLike {
  return (value as { brand?: unknown }).brand === PREACT_BRAND;
}

/**
 * Detects signal values across libraries — BRAND-ONLY, no shape heuristics.
 * - TC39 `signal-polyfill` (used by `@lit-labs/signals`): `Signal.State` /
 *   `Signal.Computed` instances with `[Symbol("SIGNAL")]` brand and `.get()`.
 * - `@preact/signals-core`: `Signal` / `Computed` instances with
 *   `Symbol.for("preact-signals")` on `prototype.brand` and `.value` accessor.
 *
 * A `{ get, set }` shape fallback used to exist here but matched every `Map`,
 * so Lit internals (`_$AL`, `_$changedProperties`…) showed up as bogus
 * "signals" on components that use none. Correctness over coverage.
 */
export function isSignal(value: unknown): value is SignalLike {
  if (!value || typeof value !== 'object') return false;
  return isPreactSignal(value) || isTc39Signal(value);
}

function readSignal(v: SignalLike): unknown {
  return 'get' in v && typeof v.get === 'function' ? v.get() : (v as ValueSignalLike).value;
}

// Internal signal-shaped properties that `SignalWatcher` from `@lit-labs/signals`
// stamps onto the host element. Hide them from the panel — they are framework
// plumbing, not user-defined state.
const INTERNAL_SIGNAL_KEYS = new Set(['__performUpdateSignal', '__forceUpdateSignal']);

export function serializeSignals(element: Element): WCSignalInfo[] {
  const out: WCSignalInfo[] = [];
  const visited = new WeakSet<object>();
  for (const key of Object.getOwnPropertyNames(element)) {
    if (INTERNAL_SIGNAL_KEYS.has(key)) continue;
    let v: unknown;
    try {
      v = (element as unknown as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (!isSignal(v)) continue;
    let value: SerializableValue;
    try {
      value = serializeValue(readSignal(v), 0, visited) as SerializableValue;
    } catch {
      value = '[unreadable]';
    }
    out.push({ label: key, value });
  }
  return out;
}

export function serializeContextRequests(element: Element): WCContextInfo[] | undefined {
  const lookup = (
    window as unknown as {
      __wc_devtools_context_requests?: (el: Element) => { key: string }[] | undefined;
    }
  ).__wc_devtools_context_requests;
  if (!lookup) return undefined;
  const raw = lookup(element);
  if (!raw || raw.length === 0) return undefined;
  return raw.map((r) => ({ key: r.key }));
}

// `@lit/task` exposes Task instances with a numeric `.status` enum:
// 0 = initial, 1 = pending, 2 = complete, 3 = error.
const TASK_STATUS_NAMES: ('initial' | 'pending' | 'complete' | 'error')[] = [
  'initial',
  'pending',
  'complete',
  'error',
];

interface TaskLike {
  status: number;
  value?: unknown;
  error?: unknown;
}

function isTaskLike(v: unknown): v is TaskLike {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  // Tasks have a numeric `.status` and a `.run()` method on the prototype.
  if (typeof o.status !== 'number') return false;
  if (o.status < 0 || o.status > 3) return false;
  const proto = Object.getPrototypeOf(v) as Record<string, unknown> | null;
  if (!proto) return false;
  return typeof (proto as { run?: unknown }).run === 'function';
}

export function serializeTasks(element: Element): WCTaskInfo[] {
  const out: WCTaskInfo[] = [];
  const visited = new WeakSet<object>();
  for (const key of Object.getOwnPropertyNames(element)) {
    let v: unknown;
    try {
      v = (element as unknown as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (!isTaskLike(v)) continue;
    const status = TASK_STATUS_NAMES[v.status] ?? 'initial';
    const entry: WCTaskInfo = { label: key, status };
    if (status === 'complete') {
      try {
        entry.value = serializeValue(v.value, 0, visited) as SerializableValue;
      } catch {
        entry.value = '[unreadable]';
      }
    } else if (status === 'error') {
      entry.error = String(v.error);
    }
    out.push(entry);
  }
  return out;
}
