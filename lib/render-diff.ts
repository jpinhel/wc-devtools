import type { SerializableValue, WCNode } from '../types/wc';

export interface PropChange {
  from: SerializableValue;
  to: SerializableValue;
}

/**
 * Returns a record of property names whose serialized value changed between
 * `prev` and `curr`. Both arguments must describe the SAME node (same id).
 * Comparison is structural via JSON.stringify — adequate for the
 * SerializableValue domain, which never contains functions or DOM refs.
 */
export function diffNodeProps(prev: WCNode | null, curr: WCNode): Record<string, PropChange> {
  if (!prev || prev.id !== curr.id) return {};
  const out: Record<string, PropChange> = {};
  const keys = new Set([...Object.keys(prev.properties), ...Object.keys(curr.properties)]);
  for (const k of keys) {
    const a = prev.properties[k];
    const b = curr.properties[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[k] = { from: a as SerializableValue, to: b as SerializableValue };
    }
  }
  return out;
}
