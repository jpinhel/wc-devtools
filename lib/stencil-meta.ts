import type { WCPropMeta } from '../types/wc';

// Stencil 4.x MEMBER_FLAGS bit field. Source:
// https://github.com/ionic-team/stencil/blob/main/src/utils/constants.ts
const MEMBER_FLAGS = {
  Prop: 1 << 0,
  PropMutable: 1 << 1,
  PropString: 1 << 2,
  PropNumber: 1 << 3,
  PropBoolean: 1 << 4,
  PropAny: 1 << 5,
  State: 1 << 6,
  Method: 1 << 7,
  Element: 1 << 8,
  Event: 1 << 9,
  ReflectAttr: 1 << 15,
} as const;

interface StencilCmpMeta {
  $members$?: Record<string, [flags: number, attrName?: string]>;
}

interface StencilCtor {
  cmpMeta$?: StencilCmpMeta;
}

/**
 * Extracts per-member metadata from a Stencil component constructor's `cmpMeta$.$members$`.
 *
 * MEMBER_FLAGS encode whether each declared member is a `@Prop`, `@State`, `@Method`,
 * `@Element`, `@Event`, plus modifiers like `reflect`. We surface only Props and States
 * — Methods/Events/Element refs belong in their own panel sections (Methods tab, Events tab).
 */
export function extractStencilPropMeta(ctor: unknown): Record<string, WCPropMeta> {
  const out: Record<string, WCPropMeta> = {};
  if (!ctor || typeof ctor !== 'object') return out;
  const members = (ctor as StencilCtor).cmpMeta$?.$members$;
  if (!members) return out;
  for (const [name, entry] of Object.entries(members)) {
    if (!Array.isArray(entry)) continue;
    const flags = entry[0];
    if (typeof flags !== 'number') continue;
    if (flags & MEMBER_FLAGS.Method) continue;
    if (flags & MEMBER_FLAGS.Event) continue;
    if (flags & MEMBER_FLAGS.Element) continue;
    const isState = (flags & MEMBER_FLAGS.State) !== 0;
    const isProp = (flags & MEMBER_FLAGS.Prop) !== 0;
    if (!isState && !isProp) continue;
    out[name] = {
      kind: isState ? 'state' : 'prop',
      reflects: (flags & MEMBER_FLAGS.ReflectAttr) !== 0,
    };
  }
  return out;
}
